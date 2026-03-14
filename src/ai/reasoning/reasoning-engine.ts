import { QueryEngine } from '../../search/query-engine.js';
import type { RepoIndex } from '../../types/index.js';
import type { AIProvider, ChatMessage } from '../types.js';
import { buildContext, formatFileReferences } from '../../context/context-builder.js';
import { getSystemPrompt } from '../prompts/system-prompt.js';
import { buildCodeAnalysisPrompt } from '../prompts/code-analysis.js';
import { logger } from '../../utils/logger.js';
import { ToolRegistry } from '../../tools/tool-registry.js';

export interface ReasoningOptions {
  maxResults?: number;
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
}

export interface ReasoningResult {
  answer: string;
  filesAnalyzed: string[];
  chunksUsed: number;
  contextTruncated: boolean;
}

/** Repository context injected into the chat system prompt. */
export interface ChatContext {
  repoName: string;
  branch: string;
  rootPath: string;
  fileCount: number;
}

export class ReasoningEngine {
  private queryEngine: QueryEngine | null;
  private provider: AIProvider;
  private index: RepoIndex | null;

  /**
   * @param index - Repository index (may be null when using the chat() path without a pre-built index).
   */
  constructor(index: RepoIndex | null, provider: AIProvider) {
    this.index = index;
    this.queryEngine = index ? new QueryEngine(index) : null;
    this.provider = provider;
  }

  async analyze(
    query: string,
    options: ReasoningOptions = {},
  ): Promise<ReasoningResult> {
    const {
      maxResults = 10,
      maxTokens = 8000,
      temperature = 0.3,
    } = options;

    logger.debug(`Analyzing query: ${query}`);

    // Step 1: Vector search
    if (!this.queryEngine || !this.index) {
      throw new Error('Repository index not loaded. Run `koda init` first.');
    }
    const searchResults = this.queryEngine.search(query, maxResults);

    if (searchResults.length === 0) {
      throw new Error('No relevant code found in the repository.');
    }

    // Step 2: Get full chunks
    const chunks = searchResults
      .map(r => this.index!.chunks.find(c => c.id === r.chunkId))
      .filter((c): c is NonNullable<typeof c> => c !== undefined);

    logger.debug(`Found ${chunks.length} relevant chunks`);

    // Step 3: Build context
    const contextResult = buildContext(chunks, maxTokens);
    const fileReferences = formatFileReferences(contextResult.chunks);

    logger.debug(
      `Context built: ${contextResult.estimatedTokens} tokens, ${contextResult.chunks.length} chunks`,
    );

    if (contextResult.truncated) {
      logger.warn('Context was truncated due to token limit');
    }

    // Step 4: Build prompt
    const userPrompt = buildCodeAnalysisPrompt({
      query,
      context: contextResult.context,
      metadata: this.index.metadata,
      fileReferences,
    });

    const messages: ChatMessage[] = [
      { role: 'system', content: getSystemPrompt() },
      { role: 'user', content: userPrompt },
    ];

    // Step 5: Call AI model
    const response = await this.provider.sendChatCompletion({
      messages,
      temperature,
      max_tokens: 2000,
    });

    const answer = response.choices[0]?.message?.content ?? '';

    const filesAnalyzed = Array.from(
      new Set(contextResult.chunks.map(c => c.filePath)),
    );

    return {
      answer,
      filesAnalyzed,
      chunksUsed: contextResult.chunks.length,
      contextTruncated: contextResult.truncated,
    };
  }

  async analyzeStream(
    query: string,
    onChunk: (chunk: string) => void,
    options: ReasoningOptions = {},
    onStage?: (message: string) => void,
  ): Promise<Omit<ReasoningResult, 'answer'>> {
    const {
      maxResults = 10,
      maxTokens = 8000,
      temperature = 0.3,
    } = options;

    logger.debug(`Analyzing query (streaming): ${query}`);

    // Step 1: Vector search
    if (!this.queryEngine || !this.index) {
      throw new Error('Repository index not loaded. Run `koda init` first.');
    }
    onStage?.('🔍  reading files');
    const searchResults = this.queryEngine.search(query, maxResults);

    if (searchResults.length === 0) {
      throw new Error('No relevant code found in the repository.');
    }

    // Step 2: Get full chunks
    const chunks = searchResults
      .map(r => this.index!.chunks.find(c => c.id === r.chunkId))
      .filter((c): c is NonNullable<typeof c> => c !== undefined);

    // Step 3: Build context
    onStage?.('🧠  planning changes');
    const contextResult = buildContext(chunks, maxTokens);
    const fileReferences = formatFileReferences(contextResult.chunks);

    // Step 4: Build prompt
    const userPrompt = buildCodeAnalysisPrompt({
      query,
      context: contextResult.context,
      metadata: this.index.metadata,
      fileReferences,
    });

    const messages: ChatMessage[] = [
      { role: 'system', content: getSystemPrompt() },
      { role: 'user', content: userPrompt },
    ];

    // Step 5: Stream AI model response
    onStage?.('✏  generating response');
    await this.provider.streamChatCompletion(
      {
        messages,
        temperature,
        max_tokens: 2000,
      },
      onChunk,
    );

    const filesAnalyzed = Array.from(
      new Set(contextResult.chunks.map(c => c.filePath)),
    );

    return {
      filesAnalyzed,
      chunksUsed: contextResult.chunks.length,
      contextTruncated: contextResult.truncated,
    };
  }

  /**
   * AI-first conversational interface with automatic tool usage.
   *
   * The model receives the full tool catalogue and decides when to call
   * read_file, search_code, git_branch, etc.  The loop continues until
   * the model produces a final text answer (finish_reason !== 'tool_calls').
   *
   * @param input   - Raw user message
   * @param context - Repository metadata injected into the system prompt
   * @param onChunk - Called once with the final answer text
   * @param onStage - Optional progress indicator callback
   */
  async chat(
    input: string,
    context: ChatContext,
    onChunk: (chunk: string) => void,
    onStage?: (message: string) => void,
  ): Promise<void> {
    const registry = new ToolRegistry(context.rootPath);
    const tools = registry.getToolDefinitions();

    const messages: ChatMessage[] = [
      { role: 'system', content: buildChatSystemPrompt(context) },
      { role: 'user', content: input },
    ];

    const MAX_ROUNDS = 5;

    for (let round = 0; round < MAX_ROUNDS; round++) {
      onStage?.('🧠  thinking');

      const response = await this.provider.sendChatCompletion({
        messages,
        temperature: 0.3,
        max_tokens: 2000,
        tools,
        tool_choice: 'auto',
      });

      const choice = response.choices[0];
      if (!choice) break;

      const message = choice.message;

      if (choice.finish_reason === 'tool_calls' && message.tool_calls?.length) {
        // Append the assistant turn (contains tool_calls)
        messages.push({
          role: 'assistant',
          content: message.content ?? null,
          tool_calls: message.tool_calls,
        });

        // Execute each requested tool and append results
        for (const toolCall of message.tool_calls) {
          onStage?.(toolStageMessage(toolCall.function.name));
          logger.debug(`Tool call: ${toolCall.function.name}(${toolCall.function.arguments})`);

          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
          } catch {
            // leave args empty — registry.execute handles missing args gracefully
          }

          const result = await registry.execute(toolCall.function.name, args);

          messages.push({
            role: 'tool',
            content: result,
            tool_call_id: toolCall.id,
          });
        }
      } else {
        // Final answer — emit and return
        onStage?.('✏  generating response');
        onChunk(message.content ?? '');
        return;
      }
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildChatSystemPrompt(ctx: ChatContext): string {
  return [
    'You are Koda, an AI software engineer assistant.',
    '',
    `Repository: ${ctx.repoName}`,
    `Branch:     ${ctx.branch}`,
    `Directory:  ${ctx.rootPath}`,
    `Files indexed: ${ctx.fileCount}`,
    '',
    'You have tools to explore the repository, read files, inspect git state, and run safe commands.',
    'Use them whenever you need accurate information to answer the user.',
    'For simple conversational questions answer directly without calling any tools.',
  ].join('\n');
}

function toolStageMessage(toolName: string): string {
  switch (toolName) {
    case 'read_file':    return '🔍  reading files';
    case 'search_code': return '🔍  searching code';
    case 'list_files':  return '📁  listing files';
    case 'git_branch':
    case 'git_status':
    case 'git_diff':
    case 'git_log':     return '🌿  checking git';
    case 'run_terminal': return '⚡  running command';
    case 'write_file':  return '✏  writing file';
    default:            return `🔧  using ${toolName}`;
  }
}
