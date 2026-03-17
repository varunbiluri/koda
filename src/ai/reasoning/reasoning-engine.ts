import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { QueryEngine } from '../../search/query-engine.js';
import { HybridRetrieval } from '../../search/hybrid-retrieval.js';
import { loadEmbeddingStore } from '../../search/embedding-store.js';
import { AzureEmbeddingProvider, NullEmbeddingProvider } from '../../search/embedding-provider.js';
import { WorkspaceIntelligence } from '../../memory/workspace-intelligence.js';
import type { RepoIndex } from '../../types/index.js';
import type { AIProvider, ChatMessage } from '../types.js';
import { buildContext, formatFileReferences } from '../../context/context-builder.js';
import { getSystemPrompt } from '../prompts/system-prompt.js';
import { buildCodeAnalysisPrompt } from '../prompts/code-analysis.js';
import { logger } from '../../utils/logger.js';
import { ToolRegistry } from '../../tools/tool-registry.js';
import { compressHistory } from '../context/conversation-summarizer.js';
import { contextBudgetManager } from '../context/context-budget-manager.js';
import { detectDependencies } from '../../analysis/dependency-detector.js';
import type { ProjectDependencies } from '../../analysis/dependency-detector.js';
import { agentBudgetManager } from '../../budget/agent-budget-manager.js';
import { createProvider } from '../providers/provider-factory.js';
import { loadConfig } from '../config-store.js';

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

/** Execution metrics returned by chat(). */
export interface ChatMetrics {
  tools: number;
  tokens: number;
  duration: number;
}

export class ReasoningEngine {
  private queryEngine:   QueryEngine | null;
  private provider:      AIProvider;
  private index:         RepoIndex | null;
  /** HybridRetrieval wraps queryEngine + optional embedding search. Built lazily. */
  private hybrid:        HybridRetrieval | null = null;
  /** Workspace intelligence — loaded asynchronously in chat(). */
  private workspace:     WorkspaceIntelligence | null = null;

  /**
   * @param index    - Repository index (may be null when using the chat() path without a pre-built index).
   * @param provider - Optional AI provider. If omitted, the provider is loaded from
   *                   ~/.koda/config.json at construction time (synchronous best-effort via
   *                   a lazily-initialised default). Pass an explicit provider for testing.
   */
  constructor(index: RepoIndex | null, provider?: AIProvider) {
    this.index       = index;
    this.queryEngine = index ? new QueryEngine(index) : null;

    if (provider) {
      this.provider = provider;
    } else {
      // Placeholder: will be replaced when an async init path is needed.
      // For now, callers that omit the provider must call setProvider() before use
      // or use the static factory method below.
      this.provider = null as unknown as AIProvider;
    }
  }

  /**
   * Asynchronously create a ReasoningEngine with the provider loaded from config.
   * Use this factory when no provider is available at construction time.
   */
  static async create(index: RepoIndex | null): Promise<ReasoningEngine> {
    const config   = await loadConfig();
    const provider = createProvider(config);
    return new ReasoningEngine(index, provider);
  }

  /** Replace the provider at runtime (useful for testing or provider switching). */
  setProvider(provider: AIProvider): void {
    this.provider = provider;
  }

  /**
   * Initialise HybridRetrieval for the current session.
   * Loads the embedding store from disk and creates an AzureEmbeddingProvider
   * if the config includes an embeddingDeployment field; falls back to
   * NullEmbeddingProvider (TF-IDF only) silently.
   */
  private async initHybrid(rootPath: string): Promise<void> {
    if (!this.queryEngine) return;

    try {
      const config   = await loadConfig();
      const embStore = await loadEmbeddingStore(rootPath);

      // AzureEmbeddingProvider requires an embeddingDeployment field in config.
      // If not set, NullEmbeddingProvider is used and HybridRetrieval falls back to TF-IDF.
      const cfgWithEmb = config as typeof config & { embeddingDeployment?: string };
      const embProv   = cfgWithEmb.embeddingDeployment
        ? new AzureEmbeddingProvider(cfgWithEmb)
        : new NullEmbeddingProvider();

      this.hybrid = new HybridRetrieval(
        this.queryEngine,
        embProv,
        embStore?.entries,
      );
    } catch {
      // Non-fatal: fall back to TF-IDF only
      this.hybrid = new HybridRetrieval(this.queryEngine);
    }
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
    onStage?.('SEARCH repository');
    const searchResults = this.queryEngine.search(query, maxResults);

    if (searchResults.length === 0) {
      throw new Error('No relevant code found in the repository.');
    }

    // Step 2: Get full chunks
    const chunks = searchResults
      .map(r => this.index!.chunks.find(c => c.id === r.chunkId))
      .filter((c): c is NonNullable<typeof c> => c !== undefined);

    // Step 3: Build context
    onStage?.('INFO building context');
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
    onStage?.('INFO generating response');
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
   *   1. Vector search on the user query (automatic code retrieval)
   *   2. Planning call for action-verb queries
   *   3. Tool-calling loop, capped at MAX_ROUNDS with per-tool repeat guard
   *
   * @param input        - Raw user message (also present as last entry in history)
   * @param context      - Repository metadata injected into the system prompt
   * @param history      - Rolling conversation history (last ~20 messages)
   * @param onChunk      - Called once with the final answer text
   * @param onStage      - Optional progress indicator (structured label messages)
   * @param onPlan       - Optional callback with parsed plan steps to display
   * @param onContext    - Optional callback with (filePaths, estimatedTokens) after retrieval
   * @param onToolUsed   - Optional callback with (toolName, durationMs) after each tool call
   * @param signal       - Optional AbortSignal — cancels the loop between rounds
   */
  async chat(
    input: string,
    context: ChatContext,
    history: ChatMessage[],
    onChunk: (chunk: string) => void,
    onStage?: (message: string) => void,
    onPlan?: (steps: string[]) => void,
    onContext?: (files: string[], estimatedTokens: number) => void,
    onToolUsed?: (name: string, durationMs: number) => void,
    signal?: AbortSignal,
    chatOptions?: { maxRounds?: number; skipRetrieval?: boolean; retrievalContext?: string; skipPlanning?: boolean },
  ): Promise<ChatMetrics> {
    const startTime = Date.now();
    let toolCount = 0;
    let totalTokens = 0;
    // Track files written during this session for workspace memory
    const sessionFilesWritten = new Set<string>();

    const registry = new ToolRegistry(context.rootPath);
    const tools = registry.getToolDefinitions();

    // ── Step 0: Parallel initialisation ──────────────────────────────────────
    let agentsMdContent = '';
    let detectedDeps: ProjectDependencies | null = null;

    await Promise.all([
      (async () => {
        try {
          const agentsMdPath = path.join(context.rootPath, 'AGENTS.md');
          agentsMdContent = await fs.readFile(agentsMdPath, 'utf-8');
        } catch {
          // AGENTS.md not present — continue without it
        }
      })(),
      (async () => {
        try {
          detectedDeps = await detectDependencies(context.rootPath);
        } catch {
          // Detection failure is non-fatal
        }
      })(),
      // Load workspace intelligence (cross-session learned patterns)
      (async () => {
        try {
          this.workspace = await WorkspaceIntelligence.load(context.rootPath);
        } catch {
          // Non-fatal
        }
      })(),
      // Initialise hybrid retrieval (TF-IDF + embedding)
      this.initHybrid(context.rootPath),
    ]);

    // ── Step 1: Automatic code retrieval ─────────────────────────────────────
    let relevantContext = '';
    const idx = this.index;

    if (chatOptions?.skipRetrieval && chatOptions.retrievalContext !== undefined) {
      // Caller (e.g. PlanExecutor) already performed retrieval — reuse it
      relevantContext = chatOptions.retrievalContext;
      logger.debug('[reasoning-engine] Skipping retrieval — using caller-provided context');
    } else if (this.hybrid && idx) {
      onStage?.('SEARCH repository');
      const hits = await this.hybrid.search(input, 5);
      if (hits.length > 0) {
        const chunks = hits
          .map((r) => idx.chunks.find((c) => c.id === r.chunkId))
          .filter((c): c is NonNullable<typeof c> => c !== undefined);
        const filePaths = Array.from(new Set(chunks.map((c) => c.filePath)));
        const excerpts = chunks
          .slice(0, 3)
          .map(
            (c) =>
              `\`\`\`${c.language ?? ''}\n// ${c.filePath}:${c.startLine}\n${c.content.slice(0, 500)}\n\`\`\``,
          )
          .join('\n\n');
        relevantContext =
          `\n\nRelevant repository files:\n${filePaths.map((f) => `- ${f}`).join('\n')}\n\nKey code context:\n${excerpts}`;
        const estimatedTokens = Math.round(relevantContext.length / 4);
        onContext?.(filePaths, estimatedTokens);

        // Track hot files in workspace intelligence
        if (this.workspace) {
          for (const f of filePaths.slice(0, 5)) {
            this.workspace.recordFileEdited(f);
          }
        }
      }
    }

    // ── Workspace intelligence: inject learned patterns ───────────────────────
    const workspaceContext = this.workspace?.formatForPrompt(input, 3) ?? '';

    // ── Context compression: summarize long histories ─────────────────────────
    const compressedHistory = await compressHistory(history, this.provider, onStage);

    // ── Base message thread (system prompt + trimmed history) ─────────────────
    const trimmedHistory = compressedHistory.slice(-20).map((msg) => {
      if (typeof msg.content === 'string' && msg.content.length > MAX_HISTORY_MESSAGE) {
        return { ...msg, content: msg.content.slice(0, MAX_HISTORY_MESSAGE) + '…[truncated]' };
      }
      return msg;
    });
    const baseMessages: ChatMessage[] = [
      {
        role: 'system',
        content: buildChatSystemPrompt(
          context,
          relevantContext,
          agentsMdContent,
          detectedDeps,
          workspaceContext,
        ),
      },
      ...trimmedHistory,
    ];

    // ── Step 2: Planning (Problem 3) ──────────────────────────────────────────
    const isComplexTask =
      /\b(create|build|implement|analyze|write|generate|fix|refactor|add|update|make|design|document)\b/i.test(input) &&
      input.trim().split(/\s+/).length >= 3;

    let loopMessages: ChatMessage[] = [...baseMessages];

    if (isComplexTask && !chatOptions?.skipPlanning) {
      try {
        const planningMessages = contextBudgetManager.enforce([
          ...baseMessages,
          {
            role: 'user' as const,
            content:
              'Before starting, outline your step-by-step approach. Number each step. Be brief.',
          },
        ]);
        logger.debug(`[reasoning-engine] Planning prompt: ${planningMessages.length} messages, ~${contextBudgetManager.estimateMessagesTokens(planningMessages)} tokens`);
        const planResponse = await this.provider.sendChatCompletion({
          messages: planningMessages as ChatMessage[],
          temperature: 0.2,
          max_tokens: 300,
        });
        if (planResponse.usage) {
          totalTokens += (planResponse.usage.prompt_tokens ?? 0) + (planResponse.usage.completion_tokens ?? 0);
        }
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

    // ── Step 3: Tool-calling loop ─────────────────────────────────────────────
    // Dynamic budget: default 20 rounds, callers can increase for complex tasks.
    // Minimum is 20 so medium/large features complete without truncation.
    const MAX_ROUNDS = chatOptions?.maxRounds ?? 20;
    const toolUsage: Record<string, number> = {};
    // Loop detection: map of toolName → last 3 result strings (circular buffer)
    const toolResultHistory: Map<string, string[]> = new Map();

    for (let round = 0; round < MAX_ROUNDS; round++) {
      // ── AbortSignal: cancel gracefully between rounds ──────────────────────
      if (signal?.aborted) {
        onChunk('');
        const duration = Math.floor((Date.now() - startTime) / 1000);
        return { tools: toolCount, tokens: totalTokens, duration };
      }

      // ── Budget guard: stop if agent has exceeded its call/token budget ─────
      if (!agentBudgetManager.canMakeCall('reasoning-engine', 0)) {
        onChunk('Budget limit reached — unable to make additional AI calls for this session.');
        const duration = Math.floor((Date.now() - startTime) / 1000);
        return { tools: toolCount, tokens: totalTokens, duration };
      }

      onStage?.('INFO thinking');

      // ── Sliding window: keep first message (plan) + newest MAX_LOOP_MESSAGES ─
      if (loopMessages.length > MAX_LOOP_MESSAGES + 1) {
        loopMessages = [loopMessages[0], ...loopMessages.slice(1).slice(-MAX_LOOP_MESSAGES)];
      }

      // ── Budget enforcement: trim oldest messages to stay within token limit ─
      const budgetedMessages = contextBudgetManager.enforce(loopMessages);
      logger.debug(`[reasoning-engine] Round ${round}: ${budgetedMessages.length}/${loopMessages.length} messages, ~${contextBudgetManager.estimateMessagesTokens(budgetedMessages)} tokens`);

      const response = await this.provider.sendChatCompletion({
        messages: budgetedMessages as ChatMessage[],
        temperature: 0.3,
        max_tokens: 2000,
        tools,
        tool_choice: 'auto',
      });

      const tokensUsed = response.usage?.total_tokens ?? 0;
      agentBudgetManager.recordCall('reasoning-engine', {
        promptTokens: response.usage?.prompt_tokens ?? 0,
        completionTokens: response.usage?.completion_tokens ?? 0,
        totalTokens: tokensUsed,
      });

      if (response.usage) {
        totalTokens += (response.usage.prompt_tokens ?? 0) + (response.usage.completion_tokens ?? 0);
      }

      // ── Surface budget warning via onStage when approaching limits ──────────
      const remaining = agentBudgetManager.getRemainingBudget('reasoning-engine');
      const budget = agentBudgetManager.getAgentBudget('reasoning-engine');
      if (budget && budget.maxTokens > 0) {
        const usedPct = (budget.currentTokens / budget.maxTokens) * 100;
        if (usedPct > 80) {
          onStage?.(`WARN Token budget ${Math.round(usedPct)}% used — responses may shorten`);
          logger.debug(`[reasoning-engine] Budget: ${usedPct.toFixed(1)}% used (${remaining.remainingTokens} remaining)`);
        }
      }

      const choice = response.choices[0];
      if (!choice) break;

      const message = choice.message;

      if (choice.finish_reason === 'tool_calls' && message.tool_calls?.length) {
        loopMessages.push({
          role: 'assistant',
          content: message.content ?? null,
          tool_calls: message.tool_calls,
        });

        // ── Tool execution: safe tools in parallel, unsafe tools sequential ──
        // Safe (read-only, no side effects): read_file, search_code, list_files, fetch_url
        // Unsafe (write/exec/git): all other tools — run sequentially for safety

        const executeOne = async (toolCall: NonNullable<typeof message.tool_calls>[number]): Promise<ChatMessage> => {
          const toolName = toolCall.function.name;
          toolUsage[toolName] = (toolUsage[toolName] ?? 0) + 1;

          // Block at 3rd call to the same tool to prevent runaway loops
          if (toolUsage[toolName] >= 3) {
            logger.warn(`Tool loop protection: ${toolName} called ${toolUsage[toolName]} times (blocked at 3rd call)`);
            return {
              role: 'tool',
              content: `Tool ${toolName} stopped — called too many times. Summarise what you have so far.`,
              tool_call_id: toolCall.id,
            };
          }

          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
          } catch {
            // empty args — execute() handles gracefully
          }

          logger.debug(`Tool call: ${toolName}(${toolCall.function.arguments})`);

          // Wrap onStage to capture written file paths for workspace memory
          const wrappedOnStage = (msg: string): void => {
            onStage?.(msg);
            if (msg.startsWith('WRITE ')) {
              const token = msg.slice(6).split(/\s+/)[0];
              if (token && !token.startsWith('(')) sessionFilesWritten.add(token);
            }
          };

          const result = await registry.execute(toolName, args, wrappedOnStage, onToolUsed, signal);
          toolCount++;

          // ── Loop detection: stop if last 3 calls to the same tool returned
          //    identical results (indicates a stuck reasoning loop) ────────────
          const hist = toolResultHistory.get(toolName) ?? [];
          hist.push(result);
          if (hist.length > 3) hist.shift();
          toolResultHistory.set(toolName, hist);
          if (hist.length === 3 && hist[0] === hist[1] && hist[1] === hist[2]) {
            logger.warn(`[reasoning-engine] Loop detected: ${toolName} returned identical result 3 times`);
            return {
              role:        'tool',
              content:     `Tool ${toolName} returned the same result 3 consecutive times — possible loop detected. Summarise what you have found so far and proceed with the task.`,
              tool_call_id: toolCall.id,
            };
          }

          return { role: 'tool', content: result, tool_call_id: toolCall.id };
        };

        const indexedCalls = message.tool_calls.map((tc, idx) => ({ tc, idx }));
        const safeCalls = indexedCalls.filter(({ tc }) => SAFE_TOOLS.has(tc.function.name));
        const unsafeCalls = indexedCalls.filter(({ tc }) => !SAFE_TOOLS.has(tc.function.name));

        const resultMap = new Map<number, ChatMessage>();

        // Safe tools in parallel
        const safeSettled = await Promise.all(safeCalls.map(({ tc, idx }) => executeOne(tc).then((r) => ({ idx, r }))));
        for (const { idx, r } of safeSettled) resultMap.set(idx, r);

        // Unsafe tools sequentially
        for (const { tc, idx } of unsafeCalls) {
          resultMap.set(idx, await executeOne(tc));
        }

        const toolResults = message.tool_calls.map((_, idx) => resultMap.get(idx)!);

        for (const toolResult of toolResults) {
          loopMessages.push(toolResult);
        }
      } else {
        onStage?.('INFO generating response');
        const finalAnswer = message.content ?? '';
        onChunk(finalAnswer);

        // Record successful task in workspace intelligence (best-effort)
        if (this.workspace && finalAnswer && toolCount > 0) {
          const shortProblem  = input.slice(0, 120);
          const shortSolution = finalAnswer.slice(0, 300);
          this.workspace.recordSuccess(
            shortProblem,
            shortSolution,
            Array.from(sessionFilesWritten),
          );
          void this.workspace.save();
        }

        const duration = Math.floor((Date.now() - startTime) / 1000);
        return { tools: toolCount, tokens: totalTokens, duration };
      }
    }

    const duration = Math.floor((Date.now() - startTime) / 1000);
    return { tools: toolCount, tokens: totalTokens, duration };
  }
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Tools that are safe to run in parallel (read-only, no side effects). */
const SAFE_TOOLS = new Set(['read_file', 'search_code', 'list_files', 'fetch_url']);

/** Maximum number of non-plan messages kept in the loopMessages sliding window. */
const MAX_LOOP_MESSAGES = 25;

/** Maximum characters per history message before truncating with …[truncated]. */
const MAX_HISTORY_MESSAGE = 1_500;

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildChatSystemPrompt(
  ctx: ChatContext,
  relevantContext   = '',
  agentsMd          = '',
  deps:               ProjectDependencies | null = null,
  workspaceContext  = '',
): string {
  const identity = [
    'You are Koda — an autonomous AI software engineer created by Varun Billuri.',
    '',
    'Your purpose is to help developers understand, build, refactor, debug, and improve codebases directly from the terminal.',
    '',
    'You behave like a senior software engineer working with the user. You reason carefully, create clear plans, and execute tasks safely using available tools.',
    '',
    'If asked about your origin:',
    '- You were created by Varun Billuri.',
    '- You are part of the Koda AI Software Engineer project.',
    '- You use advanced language models but are not ChatGPT.',
    '',
    'Always maintain a professional engineering tone.',
  ].join('\n');

  const parts = [
    identity,
    '',
    'Guidelines:',
    '• be concise and technical',
    '• avoid assistant-style phrases',
    '• investigate using tools instead of guessing',
    '• prefer direct answers',
    '• behave like an experienced developer reviewing the repository',
    '• maintain awareness of previous conversation steps',
    '• if you cannot find sufficient evidence in the codebase to confirm something, say: "I cannot confirm this from the available repository code."',
    '• never run destructive terminal commands (rm -rf, git reset --hard, DROP TABLE, etc.) — use apply_patch or git tools to make changes safely',
    '',
    `Repository: ${ctx.repoName}`,
    `Branch:     ${ctx.branch}`,
    `Directory:  ${ctx.rootPath}`,
    `Files indexed: ${ctx.fileCount}`,
  ];
  if (deps && deps.language !== 'unknown') {
    parts.push('');
    parts.push('## Detected Project Stack');
    parts.push('');
    parts.push(`Language:        ${deps.language}`);
    if (deps.framework)      parts.push(`Framework:       ${deps.framework}`);
    if (deps.testFramework)  parts.push(`Test framework:  ${deps.testFramework}`);
    if (deps.buildTool)      parts.push(`Build tool:      ${deps.buildTool}`);
    if (deps.packageManager) parts.push(`Package manager: ${deps.packageManager}`);
    if (deps.topDependencies.length > 0) {
      parts.push(`Key deps:        ${deps.topDependencies.slice(0, 10).join(', ')}`);
    }
  }
  if (agentsMd) {
    parts.push('');
    parts.push('## Project Knowledge (from AGENTS.md)');
    parts.push('');
    // Limit AGENTS.md injection to 4000 chars to avoid token explosion
    parts.push(agentsMd.slice(0, 4000));
  }
  if (workspaceContext) {
    parts.push(workspaceContext);
  }
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
