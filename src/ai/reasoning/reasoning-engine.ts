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
   * Pipeline:
   *   1. Vector search on the user query (Problem 6 — automatic code retrieval)
   *   2. Planning call for action-verb queries (Problem 3)
   *   3. Tool-calling loop, capped at MAX_ROUNDS with per-tool repeat guard (Problem 2)
   *
   * @param input   - Raw user message (also present as last entry in history)
   * @param context - Repository metadata injected into the system prompt
   * @param history - Rolling conversation history (last ~20 messages)
   * @param onChunk - Called once with the final answer text
   * @param onStage - Optional progress indicator (generic stage messages)
   * @param onPlan  - Optional callback with parsed plan steps to display
   */
  async chat(
    input: string,
    context: ChatContext,
    history: ChatMessage[],
    onChunk: (chunk: string) => void,
    onStage?: (message: string) => void,
    onPlan?: (steps: string[]) => void,
  ): Promise<void> {
    const registry = new ToolRegistry(context.rootPath);
    const tools = registry.getToolDefinitions();

    // ── Step 1: Automatic code retrieval (Problem 6) ─────────────────────────
    let relevantContext = '';
    const qe = this.queryEngine;
    const idx = this.index;
    if (qe && idx) {
      onStage?.('🔍  searching repository');
      const hits = qe.search(input, 5);
      if (hits.length > 0) {
        const chunks = hits
          .map((r) => idx.chunks.find((c) => c.id === r.chunkId))
          .filter((c): c is NonNullable<typeof c> => c !== undefined);
        const filePaths = Array.from(new Set(chunks.map((c) => c.filePath)));
        const excerpts = chunks
          .slice(0, 3)
          .map((c) => `\`\`\`${c.language ?? ''}\n// ${c.filePath}:${c.startLine}\n${c.content.slice(0, 500)}\n\`\`\``)
          .join('\n\n');
        relevantContext =
          `\n\nRelevant repository files:\n${filePaths.map((f) => `- ${f}`).join('\n')}\n\nKey code context:\n${excerpts}`;
      }
    }

    // ── Base message thread (system prompt + trimmed history) ─────────────────
    const trimmedHistory = history.slice(-20);
    const baseMessages: ChatMessage[] = [
      { role: 'system', content: buildChatSystemPrompt(context, relevantContext) },
      ...trimmedHistory,
    ];

    // ── Step 2: Planning (Problem 3) ──────────────────────────────────────────
    const isComplexTask =
      /\b(create|build|implement|analyze|write|generate|fix|refactor|add|update|make|design|document)\b/i.test(input) &&
      input.trim().split(/\s+/).length >= 3;

    let loopMessages: ChatMessage[] = [...baseMessages];

    if (isComplexTask) {
      try {
        const planResponse = await this.provider.sendChatCompletion({
          messages: [
            ...baseMessages,
            {
              role: 'user',
              content:
                'Before starting, outline your step-by-step approach. Number each step. Be brief.',
            },
          ],
          temperature: 0.2,
          max_tokens: 300,
        });
        const planText = planResponse.choices[0]?.message?.content ?? '';
        const steps = parsePlanSteps(planText);
        if (steps.length >= 2 && onPlan) {
          onPlan(steps);
        }
        if (planText) {
          // Include the plan as context for the tool execution loop
          loopMessages = [...baseMessages, { role: 'assistant', content: planText }];
        }
      } catch {
        // Planning failed — proceed without plan
      }
    }

    // ── Step 3: Tool-calling loop (Problems 2 & 4) ────────────────────────────
    const MAX_ROUNDS = 5;
    const toolUsage: Record<string, number> = {};

    for (let round = 0; round < MAX_ROUNDS; round++) {
      onStage?.('🧠  thinking');

      const response = await this.provider.sendChatCompletion({
        messages: loopMessages,
        temperature: 0.3,
        max_tokens: 2000,
        tools,
        tool_choice: 'auto',
      });

      const choice = response.choices[0];
      if (!choice) break;

      const message = choice.message;

      if (choice.finish_reason === 'tool_calls' && message.tool_calls?.length) {
        loopMessages.push({
          role: 'assistant',
          content: message.content ?? null,
          tool_calls: message.tool_calls,
        });

        for (const toolCall of message.tool_calls) {
          const toolName = toolCall.function.name;
          toolUsage[toolName] = (toolUsage[toolName] ?? 0) + 1;

          // Tool loop protection (Problem 2)
          if (toolUsage[toolName] > 3) {
            logger.warn(`Tool loop protection: ${toolName} called ${toolUsage[toolName]} times`);
            loopMessages.push({
              role: 'tool',
              content: `Tool ${toolName} stopped — called too many times. Summarise what you have so far.`,
              tool_call_id: toolCall.id,
            });
            continue;
          }

          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
          } catch {
            // empty args — execute() handles gracefully
          }

          logger.debug(`Tool call: ${toolName}(${toolCall.function.arguments})`);
          // Detailed stage message emitted inside execute() (Problem 4)
          const result = await registry.execute(toolName, args, onStage);

          loopMessages.push({
            role: 'tool',
            content: result,
            tool_call_id: toolCall.id,
          });
        }
      } else {
        onStage?.('✏  generating response');
        onChunk(message.content ?? '');
        return;
      }
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildChatSystemPrompt(ctx: ChatContext, relevantContext = ''): string {
  const parts = [
    'You are Koda, a senior software engineer working inside this repository.',
    '',
    'You collaborate with the user on this codebase.',
    '',
    'Guidelines:',
    '• be concise and technical',
    '• avoid assistant-style phrases',
    '• investigate using tools instead of guessing',
    '• prefer direct answers',
    '• behave like an experienced developer reviewing the repository',
    '• maintain awareness of previous conversation steps',
    '',
    `Repository: ${ctx.repoName}`,
    `Branch:     ${ctx.branch}`,
    `Directory:  ${ctx.rootPath}`,
    `Files indexed: ${ctx.fileCount}`,
  ];
  if (relevantContext) {
    parts.push(relevantContext);
  }
  return parts.join('\n');
}

/**
 * Parse a numbered or bulleted plan from model text.
 * Returns an empty array if fewer than 2 steps are found.
 */
function parsePlanSteps(text: string): string[] {
  const steps: string[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const match = line.match(/^(?:step\s*\d+[.:):\s]+|\d+[.)]\s+|[-•*]\s+)(.+)/i);
    if (match?.[1]) steps.push(match[1].trim());
  }
  return steps.length >= 2 ? steps : [];
}
