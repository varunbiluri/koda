import * as path from 'node:path';
import chalk from 'chalk';
import { detectIntent } from './intent-detector.js';
import { UIRenderer } from './ui-renderer.js';
import { loadIndexMetadata } from '../../store/index-store.js';
import { configExists, loadConfig } from '../../ai/config-store.js';
import { createProvider } from '../../ai/providers/provider-factory.js';
import type { AIProvider } from '../../ai/types.js';
import { ReasoningEngine } from '../../ai/reasoning/reasoning-engine.js';
import { QueryEngine } from '../../search/query-engine.js';
import { TaskRouter, TaskComplexity, isContextQuestion, isIdentityQuestion } from '../../orchestrator/task-router.js';
import { logger } from '../../utils/logger.js';
import type { RepoIndex } from '../../types/index.js';
// loadSession/saveSession removed — ReasoningEngine is stateless; no cross-call history is persisted
import { PlanningEngine } from '../../ai/reasoning/planning-engine.js';
import { PlanExecutor } from '../../execution/plan-executor.js';
import { VerificationLoop } from '../../execution/verification-engine.js';
import { RepoContextAnalyzer } from '../../intelligence/repo-context-analyzer.js';
import { DagVerification } from '../../intelligence/dag-verification.js';
import { TaskMemoryStore } from '../../intelligence/task-memory-store.js';
import { GlobalMemoryStore } from '../../intelligence/global-memory-store.js';
import { ASTRepoGraph } from '../../intelligence/ast-repo-graph.js';
import { ProactiveAdvisor } from '../../intelligence/proactive-advisor.js';
import { ImpactAnalyzer } from '../../intelligence/impact-analyzer.js';
import { LearningLoop } from '../../intelligence/learning-loop.js';
import { ConfidenceEngine } from '../../intelligence/confidence-engine.js';
import { persistTurnMetrics } from './session-metrics.js';
import { emptyChatMetrics, mergeChatMetrics } from '../../product/task-telemetry.js';
import type { ChatMetrics } from '../../ai/reasoning/reasoning-engine.js';
import { agentBudgetManager } from '../../budget/agent-budget-manager.js';
import { isPrRequest, isBranchOnlyRequest, runSlashPr, runSlashBranch } from './slash/pr-handler.js';
import { isWorktreeCleanupRequest, runWorktreeCleanup } from './slash/worktree-handler.js';
import { WorktreeSession } from '../../runtime/worktree-session.js';

export interface ConversationContext {
  rootPath: string;
  index: RepoIndex | null;
  hasConfig: boolean;
  branch?: string;
}

export interface ConversationResponse {
  handled: boolean;
  shouldQuit: boolean;
  output?: string;
  /** When true, skip busy spinner / Ctrl+C hint (immediate deterministic reply). */
  instant?: boolean;
}

/**
 * ConversationEngine — AI-first conversational interface.
 *
 * Routing priority (fastest / cheapest check first):
 *   1. quit / exit        → immediate exit (no AI)
 *   2. help / ?           → static help text (no AI)
 *   3. status             → index metadata (no AI)
 *   4. greeting           → deterministic intro (no AI)
 *   5. hasConfig = true   → AI-first: ReasoningEngine.chat() with full tool set
 *   6. hasConfig = false
 *      + index present    → local vector search fallback
 *      + no index         → error with guidance
 */
export class ConversationEngine {
  private ui: UIRenderer;
  // History accumulation removed: ReasoningEngine.chat() is explicitly stateless —
  // it rebuilds context from the repo index on every call. Persisting a history
  // array that chat() ignores creates false UX expectations (multi-turn continuity
  // that doesn't actually work). Callers should not pass history to chat().
  private sessionId: string = `session-${Date.now()}`;
  /** Timeline entries from the last chat() call. */
  private lastTimeline: Array<{ name: string; durationMs: number }> = [];
  /** Task complexity router — classifies every incoming query before execution. */
  private readonly taskRouter = new TaskRouter();
  private turnMetrics: ChatMetrics = emptyChatMetrics();

  constructor(ui?: UIRenderer) {
    this.ui = ui ?? new UIRenderer();
  }

  getHistoryLength(): number { return 0; } // stateless — no history

  resetHistory(): void {
    this.sessionId = `session-${Date.now()}`;
    this.turnMetrics = emptyChatMetrics();
    this.ui.resetSessionState();
  }

  private async finalizeTurn(
    input:   string,
    ctx:     ConversationContext,
    route:   string,
    metrics: ChatMetrics,
    success = true,
  ): Promise<void> {
    this.turnMetrics = mergeChatMetrics(this.turnMetrics, metrics);
    this.ui.recordChatMetrics(metrics);
    await persistTurnMetrics(ctx.rootPath, 'chat', input, success, route, metrics);
  }

  /**
   * Previously loaded session history from disk; now a no-op.
   * ReasoningEngine is stateless — history is not used between calls.
   */
  async loadPersistedSession(_rootPath: string): Promise<number> {
    return 0;
  }

  /** True when process() returns immediately without LLM / pipeline work. */
  isInstantTurn(input: string, ctx: ConversationContext): boolean {
    const normalized = input.trim().toLowerCase();
    if (['quit', 'exit', 'bye', 'q', ':q', 'goodbye'].includes(normalized)) return true;
    if (normalized === 'help' || normalized === '?' || normalized === 'status') return true;
    if (detectIntent(input).intent === 'greeting') return true;
    if (/\breview\b.*\b(pr|pull request)\b/i.test(normalized) ||
        /\b(pr|pull request)\b.*\breview\b/i.test(normalized)) return true;
    if (isIdentityQuestion(input)) return true;
    if (isContextQuestion(input)) return true;
    if (isPrRequest(input)) return false;
    if (isWorktreeCleanupRequest(input)) return false;
    return false;
  }

  async process(
    input: string,
    ctx: ConversationContext,
    signal?: AbortSignal,
    onDiff?: (filePath: string, oldContent: string, newContent: string) => Promise<boolean>,
  ): Promise<ConversationResponse> {
    const normalized = input.trim().toLowerCase();

    // ── 1. Quit ──────────────────────────────────────────────────────────────
    if (['quit', 'exit', 'bye', 'q', ':q', 'goodbye'].includes(normalized)) {
      return { handled: true, shouldQuit: true };
    }

    // ── 2. Help ──────────────────────────────────────────────────────────────
    if (normalized === 'help' || normalized === '?') {
      this.ui.renderHelp();
      return { handled: true, shouldQuit: false, instant: true };
    }

    // ── 3. Status (index metadata — no AI needed) ────────────────────────────
    if (normalized === 'status') {
      const r = await this.handleStatus(ctx);
      return { ...r, instant: true };
    }

    // ── 4. Greeting (deterministic — avoid wasting an AI call) ───────────────
    const detected = detectIntent(input);
    if (detected.intent === 'greeting') {
      return this.handleGreeting();
    }

    // ── 4.5 PR review capability question (deterministic, no tool churn) ─────
    if (/\breview\b.*\b(pr|pull request)\b/i.test(normalized) ||
        /\b(pr|pull request)\b.*\breview\b/i.test(normalized)) {
      this.ui.renderStreamChunk(
        'Yes — I can review PRs for bugs, regressions, security risks, and missing tests.\n' +
        'Share a PR URL or run /review for local changes.',
      );
      this.ui.renderStreamEnd();
      return { handled: true, shouldQuit: false, instant: true };
    }

    // ── 4.6 Identity (who are you / what can you do) ─────────────────────────
    if (isIdentityQuestion(input)) {
      return this.handleIdentity();
    }

    // ── 4.7 Session / repo context (deterministic — no pipeline) ────────────
    if (isContextQuestion(input)) {
      return this.handleSessionAwareness(ctx);
    }

    // ── 4.8 Worktree cleanup (git ops, not AI pipeline) ─────────────────────
    if (isWorktreeCleanupRequest(input)) {
      return this.handleWorktreeCleanup(input, ctx);
    }

    // ── 5. AI-first path ─────────────────────────────────────────────────────
    if (ctx.hasConfig) {
      return this.handleWithAI(input, ctx, signal, onDiff);
    }

    // ── 6. No AI config ──────────────────────────────────────────────────────
    if (!ctx.index) {
      this.ui.renderError(
        'No AI configuration and no repository index.',
        'Run `koda login` to configure AI, or `koda init` to index the repository.',
      );
      return { handled: true, shouldQuit: false };
    }

    return this.handleLocalSearch(input, ctx.index);
  }

  // ── AI-first handler (with Task Router) ───────────────────────────────────

  private async handleWithAI(
    input: string,
    ctx: ConversationContext,
    signal?: AbortSignal,
    onDiff?: (filePath: string, oldContent: string, newContent: string) => Promise<boolean>,
  ): Promise<ConversationResponse> {
    if (isIdentityQuestion(input)) {
      return this.handleIdentity();
    }
    if (isContextQuestion(input)) {
      return this.handleSessionAwareness(ctx);
    }
    if (isWorktreeCleanupRequest(input)) {
      return this.handleWorktreeCleanup(input, ctx);
    }

    // ── Git fast paths (before spinner — avoids double ora instances) ─────────
    if (isBranchOnlyRequest(input)) {
      await runSlashBranch({ rootPath: ctx.rootPath, ui: this.ui, userHint: input });
      return { handled: true, shouldQuit: false };
    }
    if (isPrRequest(input)) {
      const url = await runSlashPr({ rootPath: ctx.rootPath, ui: this.ui, userHint: input });
      const msg = url
        ? `Pull request opened: ${url}`
        : 'PR flow ended — see messages above.';
      this.ui.renderStreamChunk(msg);
      this.ui.renderStreamEnd();
      return { handled: true, shouldQuit: false };
    }

    this.ui.renderThinking('Working');
    this.lastTimeline = [];
    this.ui.resetSessionState();
    // Per-turn token tally — avoids session-wide budget warnings on long pipelines.
    agentBudgetManager.resetAgentBudget('reasoning-engine');

    let assistantResponse = '';

    try {
      // ── Step 0: Classify task complexity ─────────────────────────────────
      const filePaths      = this._preRetrieve(input, ctx);
      const classification = this.taskRouter.classify(input, filePaths);
      const { complexity, confidence, reason } = classification;

      logger.debug(
        `[router] complexity=${complexity} confidence=${confidence.toFixed(2)} reason="${reason}"`,
      );

      // Safety fallback: low-confidence classifications always use the SIMPLE path
      const route: TaskComplexity =
        confidence < TaskRouter.SAFETY_FLOOR ? TaskComplexity.SIMPLE : complexity;

      if (route !== complexity) {
        logger.debug('[router] Low confidence — overriding to SIMPLE');
      }

      // Show routing decision in the terminal
      this.ui.stream(`INFO ROUTER: ${this._routeLabel(route)} (${Math.round(confidence * 100)}% confidence)`);

      // ── Step 1: Route execution ───────────────────────────────────────────
      const config   = await loadConfig();
      const provider = createProvider(config);

      if (route === TaskComplexity.COMPLEX && ctx.index) {
        // ── COMPLEX path — DAG-based parallel execution via GraphScheduler ─
        logger.debug(`[router] Routing to graph scheduler — ${reason}`);
        assistantResponse = await this._runWithGraphScheduler(input, ctx, provider, signal, onDiff);
        // Rendering already done inside _runWithGraphScheduler
      } else if (route === TaskComplexity.MEDIUM) {
        // ── MEDIUM path — planning + structured execution + verification ───
        logger.debug(`[router] Routing to feature execution pipeline — ${reason}`);
        assistantResponse = await this._runWithPipeline(input, ctx, provider, signal, onDiff);
      } else {
        // ── SIMPLE path — ReasoningEngine.chat() ─────────────────────────
        logger.debug(`[router] Routing to reasoning engine — ${reason}`);

        const engine   = new ReasoningEngine(ctx.index, provider);
        const timeline: Array<{ name: string; durationMs: number }> = [];

        const metrics = await engine.chat(
          input,
          {
            repoName:  path.basename(ctx.rootPath),
            branch:    ctx.branch ?? 'unknown',
            rootPath:  ctx.rootPath,
            fileCount: ctx.index?.metadata.fileCount ?? 0,
          },
          [], // stateless — no cross-call history
          (chunk) => {
            assistantResponse += chunk;
            this.ui.renderStreamChunk(chunk);
          },
          (stage) => this.ui.stream(stage),
          (steps) => {
            this.ui.setLastPlan(steps);
            this.ui.renderPlan(steps);
          },
          (files, tokens) => {
            this.ui.updateContext(files, tokens);
            this.ui.renderContext(files, tokens);
          },
          (toolName, durationMs) => {
            this.ui.recordToolUsed(toolName);
            timeline.push({ name: toolName, durationMs });
          },
          signal,
          { route: 'simple' },
          onDiff,
        );

        this.lastTimeline = timeline;
        this.ui.setTimeline(timeline);
        this.ui.renderStreamEnd();

        if (metrics) {
          this.ui.renderExecutionSummary(metrics);
          await this.finalizeTurn(input, ctx, 'simple', metrics);
          if (timeline.length > 0) {
            this.ui.renderTimeline(timeline);
          }
        }
      }

      // Ensure users always see a textual answer, even if tool-only path produced none.
      if (!assistantResponse.trim()) {
        const fallback = 'Done. I did not produce a textual response — try rephrasing or ask for a specific action.';
        this.ui.renderStreamChunk(fallback);
        this.ui.renderStreamEnd();
      }

    } catch (err) {
      if (signal?.aborted || (err as Error).name === 'AbortError') throw err;
      this.ui.stopSpinner(false, (err as Error).message);
    }

    return { handled: true, shouldQuit: false };
  }

  // ── Task Router helpers ────────────────────────────────────────────────────

  /**
   * Quick TF-IDF retrieval pass used solely to collect file paths for the
   * task complexity classifier.  Non-fatal: returns [] on any error.
   * This is a lightweight search (topK=5) that runs in < 1 ms for typical
   * repositories and does NOT duplicate the full retrieval inside chat().
   */
  private _preRetrieve(input: string, ctx: ConversationContext): string[] {
    if (!ctx.index) return [];
    try {
      const qe   = new QueryEngine(ctx.index);
      const hits = qe.search(input, 5);
      return [
        ...new Set(
          hits
            .map((h) => ctx.index!.chunks.find((c) => c.id === h.chunkId)?.filePath)
            .filter((f): f is string => f !== undefined),
        ),
      ];
    } catch {
      return [];
    }
  }

  /**
   * Return a human-readable route description for the UI stream line.
   * Format matches the INFO ROUTER prefix expected by parseStage().
   */
  private _routeLabel(route: TaskComplexity): string {
    switch (route) {
      case TaskComplexity.SIMPLE:    return 'SIMPLE task — reasoning engine';
      case TaskComplexity.MEDIUM:    return 'MEDIUM task — single-agent reasoning';
      case TaskComplexity.COMPLEX:   return 'COMPLEX task — multi-agent orchestration';
      case TaskComplexity.DELEGATED: return 'DELEGATED task — supervisor agent';
    }
  }

  /**
   * Execute a COMPLEX task using the DAG-based GraphScheduler.
   *
   * Pipeline:
   *   1. TaskGraphBuilder.build() — LLM decomposes the task into a typed DAG
   *   2. GraphScheduler.run()     — executes nodes in parallel, respecting deps
   *   3. Format SchedulerResult   — surface completion stats and node outputs
   *
   * Falls back to ReasoningEngine.chat() on any graph build or scheduler error.
   */
  private async _runWithGraphScheduler(
    input:    string,
    ctx:      ConversationContext,
    provider: AIProvider,
    signal?:  AbortSignal,
    onDiff?:  (filePath: string, oldContent: string, newContent: string) => Promise<boolean>,
  ): Promise<string> {
    const chatContext = {
      repoName:  path.basename(ctx.rootPath),
      branch:    ctx.branch ?? 'unknown',
      rootPath:  ctx.rootPath,
      fileCount: ctx.index?.metadata.fileCount ?? 0,
    };

    let assistantResponse = '';

    try {
      this.ui.stream('INFO GRAPH: building execution DAG');

      // ── Step 1: Build DAG ────────────────────────────────────────────────
      const { TaskGraphBuilder } = await import('../../planning/task-graph-builder.js');
      const builder = new TaskGraphBuilder(provider);

      // ── Part 6: Detect repo environment for context-aware planning ───────
      const repoEnv = await RepoContextAnalyzer.analyze(ctx.rootPath);
      this.ui.stream(`INFO ENV: ${repoEnv.runtime}${repoEnv.framework ? ` · ${repoEnv.framework}` : ''} · build=${repoEnv.buildCommand} · test=${repoEnv.testCommand}`);

      // ── Autonomous Intelligence: load cross-task memory + learning data ──
      const [globalMemory, learner] = await Promise.all([
        GlobalMemoryStore.load(ctx.rootPath),
        LearningLoop.load(ctx.rootPath),
      ]);

      // ── Autonomous Intelligence: build AST-powered repo graph ────────────
      const filePaths = ctx.index?.chunks.map((c) => c.filePath) ?? [];
      const repoGraph = await ASTRepoGraph.build(ctx.rootPath, [...new Set(filePaths)]);
      const impactAnalyzer = new ImpactAnalyzer(ctx.rootPath, repoGraph);
      const advisor = new ProactiveAdvisor(ctx.rootPath, repoGraph);

      // Retrieve compact repo context for graph prompting (best-effort)
      let repoContext: string = repoEnv.formatForPrompt();
      if (ctx.index) {
        try {
          const { getRepoIntelligenceCache } = await import('../../cache/repo-intelligence-cache.js');
          const cache = await getRepoIntelligenceCache(ctx.rootPath);
          const archSummary = (await cache.getArchitectureSummary()) ?? undefined;
          if (archSummary) repoContext += '\n\n' + archSummary;
        } catch {
          // non-fatal
        }
      }

      // ── Global memory context hint ────────────────────────────────────────
      const memHint = globalMemory.getContextHint(input);
      if (memHint) {
        repoContext += '\n\n' + memHint;
        this.ui.stream(`INFO MEMORY: injecting context from ${globalMemory.taskCount} past task(s)`);
      }

      // ── AST symbol context for smarter planning ───────────────────────────
      const topFiles = (ctx.index?.chunks ?? [])
        .sort((a: { filePath: string }, b: { filePath: string }) => a.filePath.localeCompare(b.filePath))
        .map((c: { filePath: string }) => c.filePath)
        .slice(0, 20);
      const symbolCtx = repoGraph.buildSymbolContext(topFiles);
      if (symbolCtx) repoContext += '\n\n' + symbolCtx;

      // ── Learning loop hint ────────────────────────────────────────────────
      const learnerStats = learner.getStats();
      if (learnerStats.totalObservations > 0) {
        this.ui.stream(`INFO LEARN: ${learnerStats.totalObservations} observations across ${learnerStats.failureTypesLearned} failure type(s)`);
      }

      // ── Part 4: Create task memory store for this execution ───────────────
      const taskMemory = new TaskMemoryStore();

      const graph = await builder.build(input, repoContext);
      const allNodes = graph.getAllNodes();
      this.ui.stream(`INFO GRAPH: ${allNodes.length} nodes — launching scheduler`);

      // ── Part 1: Initialise DAG visualizer with all nodes in pending state ─
      this.ui.dagStart(
        allNodes.map((n) => ({ id: n.id, description: n.description })),
      );

      // ── Step 2: Run via GraphScheduler ───────────────────────────────────
      const { GraphScheduler } = await import('../../execution/graph-scheduler.js');
      const scheduler = new GraphScheduler(provider, ctx.index, chatContext);

      const nodeOutputs: Array<{ id: string; output: string }> = [];

      const result = await scheduler.run(graph, {
        maxParallel: 3,
        signal,
        onNodeStart: (node) => {
          this.ui.dagNodeStart(node.id);
        },
        onNodeComplete: (node, nodeResult) => {
          this.ui.dagNodeDone(node.id, nodeResult.durationMs);
          // ── Part 4: record decision in task memory ────────────────────────
          taskMemory.recordDecision(node.id, `${node.type} completed in ${nodeResult.durationMs}ms`);
          for (const f of nodeResult.filesModified ?? []) taskMemory.recordFileTouched(f);
          if (nodeResult.output?.trim()) {
            nodeOutputs.push({ id: node.id, output: nodeResult.output });
            // Stream the node's output so the user sees incremental progress
            this.ui.renderStreamChunk(`\n**[${node.id}]** ${nodeResult.output.slice(0, 600)}\n`);
            assistantResponse += `\n**[${node.id}]** ${nodeResult.output.slice(0, 600)}\n`;
          }
        },
        onNodeFailed: (node, error) => {
          this.ui.dagNodeFailed(node.id);
          this.ui.stream(`WARN NODE_FAILED: ${node.id} — ${error.slice(0, 120)}`);
          // ── Part 4: record error in task memory ───────────────────────────
          taskMemory.recordError(node.id, error);
        },
        onRetry: (node, attempt) => {
          this.ui.stream(`INFO RETRY: ${node.id} attempt=${attempt}`);
        },
        onRecoveryInserted: (recoveryId, parentId) => {
          this.ui.stream(`INFO RECOVERY: inserted ${recoveryId} after ${parentId}`);
        },
        onChunk: (_nodeId, chunk) => {
          // Individual node chunks are already captured in onNodeComplete
          // Avoid double-streaming here; just accumulate silently
          void chunk;
        },
      });

      // ── Part 3: Post-execution verification ──────────────────────────────
      let verificationPassed = true;
      if (result.failed === 0) {
        try {
          this.ui.stream('INFO VERIFY: running post-execution checks');
          const verifier = new DagVerification(ctx.rootPath, {
            buildCmd: repoEnv.buildCommand,
            testCmd:  repoEnv.testCommand,
          });
          const verResult = await verifier.verify({
            onStage: (msg) => this.ui.stream(msg),
            signal,
          });
          verificationPassed = verResult.passed;
          this.ui.stream(`INFO VERIFY: ${verResult.summary} (${verResult.durationMs}ms)`);

          if (!verResult.passed) {
            const fixPrompt = verifier.buildFixPrompt(verResult);
            this.ui.stream('WARN VERIFY: failures detected — inserting fix node');
            taskMemory.recordDecision('dag_verification', `Verification failed: ${verResult.summary}`);
            // Record failures in learning loop
            for (const check of verResult.checks.filter((c) => !c.passed)) {
              if (check.analysis) {
                learner.recordOutcome(check.analysis.type, check.analysis.fixPrompt.slice(0, 80), false);
                globalMemory.recordIssue(`${check.name} ${check.analysis.type}`);
              }
            }
            this.ui.renderStreamChunk(`\n**Verification failed.** Fix required:\n\`\`\`\n${fixPrompt.slice(0, 800)}\n\`\`\`\n`);
            assistantResponse += `\n**Verification failed.** ${verResult.summary}`;
          } else {
            // Record successful verification in learning loop
            for (const check of verResult.checks) {
              if (check.analysis) {
                learner.recordOutcome(check.analysis.type, check.analysis.fixPrompt.slice(0, 80), true);
              }
            }
          }
        } catch (verErr) {
          logger.warn(`[dag-verification] Skipped: ${(verErr as Error).message}`);
        }
      }

      // ── Part 4: Task memory summary ───────────────────────────────────────
      if (!taskMemory.isEmpty()) {
        this.ui.stream(`INFO MEMORY: ${taskMemory.formatSummary()}`);
      }

      // ── Part 5: Impact analysis for changed files ─────────────────────────
      const touchedFiles = taskMemory.filesTouched;
      if (touchedFiles.length > 0) {
        const impactReport = impactAnalyzer.analyze(touchedFiles);
        const impactWarn   = impactAnalyzer.formatWarning(impactReport);
        if (impactWarn) this.ui.stream(impactWarn);
      }

      // ── Part 3: Proactive suggestions ────────────────────────────────────
      try {
        const suggestions = await advisor.suggest(touchedFiles);
        for (const line of advisor.formatForStream(suggestions)) {
          this.ui.stream(line);
        }
      } catch {
        // non-fatal
      }

      // ── Confidence scoring ────────────────────────────────────────────────
      const confidence = ConfidenceEngine.assessWithMemory(
        {
          retries:            result.retries,
          verificationPassed: verificationPassed,
          impactLevel:        touchedFiles.length > 0
            ? impactAnalyzer.analyze(touchedFiles).level
            : 'LOW',
        },
        input,
        globalMemory,
      );
      this.ui.stream(ConfidenceEngine.formatStage(confidence));

      // Record semantic patterns from verification results
      if (!verificationPassed) {
        globalMemory.recordSemanticPattern(
          input.slice(0, 120),
          'Execution completed but verification failed',
          'Re-run verification after fixing reported issues',
          'Verification failure indicates code quality issue post-execution',
          'execution_complete → verification_failed',
        );
      }

      // ── Global memory: persist task record ───────────────────────────────
      globalMemory.recordTask({
        description:  input.slice(0, 120),
        succeeded:    result.failed === 0 && verificationPassed,
        durationMs:   result.durationMs,
        filesChanged: touchedFiles,
        retries:      result.retries,
      });
      await Promise.all([globalMemory.save(), learner.save()]);

      // ── Step 3: Completion summary ───────────────────────────────────────
      this.ui.renderStreamEnd();

      const summary = result.failed === 0
        ? `All ${result.completed} nodes completed successfully.`
        : `${result.completed} nodes succeeded, ${result.failed} failed.`;

      if (result.failedNodes.length > 0) {
        this.ui.stream(`WARN Failed nodes: ${result.failedNodes.join(', ')}`);
      }

      this.ui.renderCompletionSummary({
        status:       result.failed === 0 && verificationPassed ? 'ok' : 'failed',
        stepsOrNodes: result.completed + result.failed,
        toolCalls:    result.totalToolCalls,
        durationMs:   result.durationMs,
        filesChanged: taskMemory.filesTouched,
      });

      assistantResponse += `\n${summary}`;
      return assistantResponse;

    } catch (err) {
      if (signal?.aborted) throw err;
      // ── Fallback: GraphScheduler failed → ReasoningEngine.chat() ─────────
      const errMsg = (err as Error).message;
      logger.debug(`[graph-scheduler] Failed (${errMsg}); falling back to reasoning engine`);
      this.ui.stream(`WARN Graph execution error — falling back to reasoning engine`);

      const engine  = new ReasoningEngine(ctx.index, provider);
      const metrics = await engine.chat(
        input,
        {
          repoName:  path.basename(ctx.rootPath),
          branch:    ctx.branch ?? 'unknown',
          rootPath:  ctx.rootPath,
          fileCount: ctx.index?.metadata.fileCount ?? 0,
        },
        [],
        (chunk) => { assistantResponse += chunk; this.ui.renderStreamChunk(chunk); },
        (stage)  => this.ui.stream(stage),
        undefined,
        undefined,
        undefined,
        signal,
        undefined,
        onDiff,
      );

      this.ui.renderStreamEnd();
      if (metrics) {
        this.ui.renderExecutionSummary(metrics);
        await this.finalizeTurn(input, ctx, 'complex', metrics);
      }

      return assistantResponse;
    }
  }

  /**
   * Execute the task using the full AgentOrchestrator via ExecutionEngine.
   * DEPRECATED: kept for reference only — COMPLEX tasks now route to
   * _runWithGraphScheduler. This method is no longer called from the main path.
   *
   * Falls back to ReasoningEngine.chat() if:
   *   - ExecutionEngine.execute() throws
   *   - No repository index is available
   */
  private async _runWithOrchestrator(
    input:    string,
    ctx:      ConversationContext,
    provider: AIProvider,
    signal?:  AbortSignal,
  ): Promise<string> {
    // Lazy-import to keep the startup path fast and avoid any circular deps
    const { ExecutionEngine } = await import('../../execution/execution-engine.js');
    const execEngine = new ExecutionEngine();

    let assistantResponse = '';

    try {
      this.ui.stream('INFO ROUTER: launching agent orchestrator');

      const report = await execEngine.execute(input, ctx.rootPath, { skipTests: false });

      const lines: string[] = [
        report.success
          ? 'Agent orchestrator completed the task successfully.'
          : 'Agent orchestrator completed with errors.',
        '',
        report.summary,
      ];

      if (report.filesModified.length > 0) {
        lines.push('', '**Files modified:**');
        report.filesModified.forEach((f) => lines.push(`- \`${f}\``));
      }

      if (report.errors.length > 0) {
        lines.push('', '**Errors:**');
        report.errors.forEach((e) => lines.push(`- ${e}`));
      }

      assistantResponse = lines.join('\n');
      this.ui.renderStreamChunk(assistantResponse);
      this.ui.renderStreamEnd();

      return assistantResponse;
    } catch (err) {
      if (signal?.aborted) throw err;
      // ── Graceful fallback: orchestrator failed → ReasoningEngine.chat() ──
      const errMsg = (err as Error).message;
      logger.debug(`[router] Orchestrator failed (${errMsg}); falling back to reasoning engine`);
      this.ui.stream(`WARN Orchestrator error — falling back to reasoning engine`);

      const engine   = new ReasoningEngine(ctx.index, provider);
      const timeline: Array<{ name: string; durationMs: number }> = [];

      const metrics = await engine.chat(
        input,
        {
          repoName:  path.basename(ctx.rootPath),
          branch:    ctx.branch ?? 'unknown',
          rootPath:  ctx.rootPath,
          fileCount: ctx.index?.metadata.fileCount ?? 0,
        },
        [], // stateless
        (chunk) => {
          assistantResponse += chunk;
          this.ui.renderStreamChunk(chunk);
        },
        (stage)              => this.ui.stream(stage),
        (steps)              => { this.ui.setLastPlan(steps); this.ui.renderPlan(steps); },
        (files, tokens)      => { this.ui.updateContext(files, tokens); this.ui.renderContext(files, tokens); },
        (toolName, durationMs) => { this.ui.recordToolUsed(toolName); timeline.push({ name: toolName, durationMs }); },
        signal,
      );

      this.lastTimeline = timeline;
      this.ui.setTimeline(timeline);
      this.ui.renderStreamEnd();

      if (metrics) {
        this.ui.renderExecutionSummary(metrics);
        await this.finalizeTurn(input, ctx, 'medium', metrics);
        if (timeline.length > 0) this.ui.renderTimeline(timeline);
      }

      return assistantResponse;
    }
  }

  // ── Feature Execution Pipeline (MEDIUM route) ─────────────────────────────

  /**
   * Execute a MEDIUM-complexity task through the full Feature Execution Pipeline:
   *   1. Context Discovery + Planning  (PlanningEngine.generateExecutionPlan)
   *   2. Structured Execution          (PlanExecutor.execute)
   *   3. Verification Loop             (VerificationLoop.runWithRetry)
   *   4. Execution Summary display
   *
   * Falls back to ReasoningEngine.chat() on any planning/execution failure.
   */
  private async _runWithPipeline(
    input:    string,
    ctx:      ConversationContext,
    provider: AIProvider,
    signal?:  AbortSignal,
    onDiff?:  (filePath: string, oldContent: string, newContent: string) => Promise<boolean>,
  ): Promise<string> {
    const chatContext = {
      repoName:  path.basename(ctx.rootPath),
      branch:    ctx.branch ?? 'unknown',
      rootPath:  ctx.rootPath,
      fileCount: ctx.index?.metadata.fileCount ?? 0,
    };

    let assistantResponse = '';

    try {
      // ── Phase 1: Generate execution plan ────────────────────────────────
      this.ui.stream('PLAN generating execution plan');

      const planner = new PlanningEngine(provider, ctx.index);
      const plan    = await planner.generateExecutionPlan(input, ctx.rootPath);

      if (plan.steps.length === 0) {
        logger.warn('[pipeline] Empty plan — falling back to reasoning engine');
        throw new Error('Planning returned empty plan');
      }

      // Display plan via PlanTracker
      this.ui.renderExecutionPlan(plan);

      // ── Phase 2: Structured step-by-step execution ──────────────────────
      const executor = new PlanExecutor(provider, ctx.index, chatContext);

      const { response, metrics: execMetrics, worktreePath, taskName, autoWorktree } =
        await executor.execute(
        plan,
        [], // stateless
        (step, idx) => {
          // Advance the plan tracker as each step begins
          if (idx > 0) this.ui.advancePlan();
          this.ui.stream(`INFO Step ${step.id}/${plan.steps.length}: ${step.description}`);
        },
        (stage) => {
          this.ui.stream(stage);
          // Track tool usage for /tools slash command
          if (stage.startsWith('READ ') || stage.startsWith('WRITE ') ||
              stage.startsWith('RUN ')  || stage.startsWith('GIT ')   ||
              stage.startsWith('SEARCH ')) {
            // Extract tool name for UI tracking (best-effort)
          }
        },
        (chunk) => {
          assistantResponse += chunk;
          this.ui.renderStreamChunk(chunk);
        },
        signal,
      );

      // Advance tracker past the last step
      this.ui.advancePlan();
      this.ui.renderStreamEnd();

      if (response && !assistantResponse) {
        assistantResponse = response;
      }

      const execRoot = worktreePath ?? ctx.rootPath;
      const execChatContext = { ...chatContext, rootPath: execRoot };

      // ── Phase 3: Verification loop (with step context for targeted fixes) ──
      const verifier = new VerificationLoop(provider, ctx.index, execChatContext);
      const verResult = await verifier.runWithRetry(
        execRoot,
        [], // stateless
        (stage) => this.ui.stream(stage),
        signal,
        executor.getStepContexts(),
      );

      if (autoWorktree && taskName) {
        if (verResult.passed) {
          await executor.mergeWorktree(taskName);
          this.ui.stream('WORKTREE merged into main');
        } else {
          await executor.removeWorktree(taskName);
          this.ui.stream('WORKTREE discarded (verification failed)');
        }
      }

      // ── Phase 4: Execution summary ───────────────────────────────────────
      this.ui.renderFeatureExecutionSummary({
        ...execMetrics,
        verificationStatus: verResult.passed ? 'PASSED' : 'FAILED',
      });

      return assistantResponse;

    } catch (err) {
      if (signal?.aborted) throw err;
      // ── Graceful fallback: pipeline failed → ReasoningEngine.chat() ──────
      const errMsg = (err as Error).message;
      logger.debug(`[pipeline] Failed (${errMsg}); falling back to reasoning engine`);
      this.ui.stream(`WARN Pipeline error — falling back to reasoning engine`);

      const engine   = new ReasoningEngine(ctx.index, provider);
      const timeline: Array<{ name: string; durationMs: number }> = [];

      const metrics = await engine.chat(
        input,
        {
          repoName:  path.basename(ctx.rootPath),
          branch:    ctx.branch ?? 'unknown',
          rootPath:  ctx.rootPath,
          fileCount: ctx.index?.metadata.fileCount ?? 0,
        },
        [], // stateless
        (chunk) => {
          assistantResponse += chunk;
          this.ui.renderStreamChunk(chunk);
        },
        (stage)                => this.ui.stream(stage),
        (steps)                => { this.ui.setLastPlan(steps); this.ui.renderPlan(steps); },
        (files, tokens)        => { this.ui.updateContext(files, tokens); this.ui.renderContext(files, tokens); },
        (toolName, durationMs) => { this.ui.recordToolUsed(toolName); timeline.push({ name: toolName, durationMs }); },
        signal,
        undefined,
        onDiff,
      );

      this.lastTimeline = timeline;
      this.ui.setTimeline(timeline);
      this.ui.renderStreamEnd();

      if (metrics) {
        this.ui.renderExecutionSummary(metrics);
        await this.finalizeTurn(input, ctx, 'medium', metrics);
        if (timeline.length > 0) this.ui.renderTimeline(timeline);
      }

      return assistantResponse;
    }
  }

  // ── Fast-path handlers ────────────────────────────────────────────────────

  private handleGreeting(): ConversationResponse {
    console.log();
    console.log(`  Hello! I'm ${chalk.cyan('Koda')}, your AI software engineer.`);
    console.log();
    console.log('  You can ask me to:');
    console.log();
    console.log(`  ${chalk.cyan('•')} ${chalk.white('explain')} ${chalk.gray('code or architecture')}`);
    console.log(`  ${chalk.cyan('•')} ${chalk.white('add')}     ${chalk.gray('new features')}`);
    console.log(`  ${chalk.cyan('•')} ${chalk.white('fix')}     ${chalk.gray('bugs and errors')}`);
    console.log(`  ${chalk.cyan('•')} ${chalk.white('refactor')} ${chalk.gray('existing modules')}`);
    console.log();
    console.log(`  ${chalk.gray('What would you like to build?')}`);
    console.log();
    return { handled: true, shouldQuit: false, instant: true };
  }

  private handleIdentity(): ConversationResponse {
    this.ui.renderStreamChunk(
      "I'm **Koda** — a terminal coding agent for this repository.\n\n" +
      'I can explain code, fix bugs, review changes, and handle git workflows (`/commit`, `/pr`, `/worktree`). ' +
      'File writes and shell commands need your approval unless `/trust` is on.\n\n' +
      'Run `/help` for commands · `/status` for index info · `/context` for last retrieved files.',
    );
    this.ui.renderStreamEnd();
    return { handled: true, shouldQuit: false, instant: true };
  }

  private async handleWorktreeCleanup(
    input: string,
    ctx: ConversationContext,
  ): Promise<ConversationResponse> {
    const includeClaude = /\b(all|every)\b/i.test(input);
    await runWorktreeCleanup(ctx.rootPath, this.ui, { includeClaude });
    return { handled: true, shouldQuit: false };
  }

  private async handleSessionAwareness(ctx: ConversationContext): Promise<ConversationResponse> {
    const repoName = path.basename(ctx.rootPath);
    const branch   = ctx.branch ?? 'unknown';
    const snap     = this.ui.getContextSnapshot();

    let indexLine = 'not indexed (run `koda init`)';
    try {
      const meta = await loadIndexMetadata(ctx.rootPath);
      indexLine = `${meta.fileCount} files · ${meta.chunkCount} chunks · ${meta.edgeCount} deps`;
    } catch { /* no index */ }

    let modelLine = 'not configured (run `koda login`)';
    if (ctx.hasConfig) {
      try {
        const cfg = await loadConfig();
        modelLine = `${cfg.provider} / ${cfg.model ?? 'default'}`;
      } catch {
        modelLine = 'configured';
      }
    }

    let worktreeLine = 'main repo';
    try {
      const wt = await WorktreeSession.load(ctx.rootPath);
      const active = wt.getActive();
      if (active) {
        worktreeLine = `active · branch ${active.branchName} · ${active.worktreePath}`;
      }
    } catch { /* ok */ }

    const lines: string[] = [
      `Repo:     ${repoName} (${ctx.rootPath})`,
      `Branch:   ${branch}`,
      `Index:    ${indexLine}`,
      `Model:    ${modelLine}`,
      `Worktree: ${worktreeLine}`,
      '',
      'Each turn is stateless — I search the index for your question and do not retain prior chat unless you paste it.',
    ];

    if (snap.files.length > 0) {
      lines.push('', 'Last retrieved context this session:');
      for (const f of snap.files.slice(0, 8)) lines.push(`  · ${f}`);
      if (snap.files.length > 8) lines.push(`  · … +${snap.files.length - 8} more`);
      lines.push(`(${snap.files.length} files · ~${snap.tokens} tokens)`);
    } else {
      lines.push('', 'No files retrieved yet this session. Ask a codebase question or run /context.');
    }

    lines.push('', 'Slash: /status · /context · /help · /worktree list');

    this.ui.renderStreamChunk(lines.join('\n'));
    this.ui.renderStreamEnd();
    return { handled: true, shouldQuit: false, instant: true };
  }

  private async handleStatus(ctx: ConversationContext): Promise<ConversationResponse> {
    try {
      const meta = await loadIndexMetadata(ctx.rootPath);
      const hasConfig = await configExists();
      console.log();
      console.log(`  ${chalk.gray('Files indexed:')} ${chalk.white(String(meta.fileCount))}`);
      console.log(`  ${chalk.gray('Code chunks:')}  ${chalk.white(String(meta.chunkCount))}`);
      console.log(`  ${chalk.gray('Dependencies:')} ${chalk.white(String(meta.edgeCount))}`);
      console.log(
        `  ${chalk.gray('AI config:')}    ${
          hasConfig ? chalk.green('configured') : chalk.yellow('not configured (run koda login)')
        }`,
      );
      console.log(`  ${chalk.gray('Indexed at:')}   ${chalk.white(meta.createdAt)}`);
      console.log();
    } catch {
      this.ui.renderError('No index found.', 'Run `koda init` to index this repository.');
    }
    return { handled: true, shouldQuit: false, instant: true };
  }

  // ── Local search fallback (no AI config) ─────────────────────────────────

  private async handleLocalSearch(query: string, index: RepoIndex): Promise<ConversationResponse> {
    const engine = new QueryEngine(index);
    const results = engine.search(query, 8);

    if (results.length === 0) {
      this.ui.renderError(
        `No results found for "${query}".`,
        'Run `koda login` to enable AI-powered answers, or try a different search term.',
      );
      return { handled: true, shouldQuit: false };
    }

    console.log();
    console.log(`  ${chalk.bold(`Results for: "${query}"`)}`);
    console.log();

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const chunk = index.chunks.find((c) => c.id === r.chunkId);
      if (!chunk) continue;

      console.log(
        `  ${chalk.cyan(`${i + 1}.`)} ${chalk.bold(chunk.filePath)}` +
        chalk.gray(`#${chunk.name}`) +
        chalk.gray(` (${chunk.type})`) +
        chalk.yellow(` [${r.score.toFixed(3)}]`),
      );
      console.log(`     ${chalk.gray(`Lines ${chunk.startLine}–${chunk.endLine}`)}`);

      const preview = chunk.content.split('\n').slice(0, 3).join('\n');
      console.log(chalk.gray('     ' + preview.replace(/\n/g, '\n     ')));
      console.log();
    }

    return { handled: true, shouldQuit: false };
  }
}
