import * as path from 'node:path';
import chalk from 'chalk';
import { detectIntent } from './intent-detector.js';
import { UIRenderer } from './ui-renderer.js';
import { loadIndexMetadata } from '../../store/index-store.js';
import { configExists, loadConfig } from '../../ai/config-store.js';
import { AzureAIProvider } from '../../ai/providers/azure-provider.js';
import { ReasoningEngine } from '../../ai/reasoning/reasoning-engine.js';
import { QueryEngine } from '../../search/query-engine.js';
import { TaskRouter, TaskComplexity } from '../../orchestrator/task-router.js';
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

  constructor(ui?: UIRenderer) {
    this.ui = ui ?? new UIRenderer();
  }

  getHistoryLength(): number { return 0; } // stateless — no history

  resetHistory(): void {
    this.sessionId = `session-${Date.now()}`;
    this.ui.resetSessionState();
  }

  /**
   * Previously loaded session history from disk; now a no-op.
   * ReasoningEngine is stateless — history is not used between calls.
   */
  async loadPersistedSession(_rootPath: string): Promise<number> {
    return 0;
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
      return { handled: true, shouldQuit: false };
    }

    // ── 3. Status (index metadata — no AI needed) ────────────────────────────
    if (normalized === 'status') {
      return this.handleStatus(ctx);
    }

    // ── 4. Greeting (deterministic — avoid wasting an AI call) ───────────────
    const detected = detectIntent(input);
    if (detected.intent === 'greeting') {
      return this.handleGreeting();
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
    this.ui.renderThinking();
    this.lastTimeline = [];
    this.ui.resetSessionState();

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
      const provider = new AzureAIProvider(config);

      if (route === TaskComplexity.COMPLEX && ctx.index) {
        // ── COMPLEX path — DAG-based parallel execution via GraphScheduler ─
        logger.info(`[router] Routing to graph scheduler — ${reason}`);
        assistantResponse = await this._runWithGraphScheduler(input, ctx, provider, signal, onDiff);
        // Rendering already done inside _runWithGraphScheduler
      } else if (route === TaskComplexity.MEDIUM) {
        // ── MEDIUM path — planning + structured execution + verification ───
        logger.info(`[router] Routing to feature execution pipeline — ${reason}`);
        assistantResponse = await this._runWithPipeline(input, ctx, provider, signal, onDiff);
      } else {
        // ── SIMPLE path — ReasoningEngine.chat() ─────────────────────────
        logger.info(`[router] Routing to reasoning engine — ${reason}`);

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
          // SIMPLE path: default 20 rounds (no per-step capping)
          undefined,
          onDiff,
        );

        this.lastTimeline = timeline;
        this.ui.setTimeline(timeline);
        this.ui.renderStreamEnd();

        if (metrics) {
          this.ui.renderExecutionSummary(metrics);
          if (timeline.length > 0) {
            this.ui.renderTimeline(timeline);
          }
        }
      }

    } catch (err) {
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
    provider: AzureAIProvider,
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
      // ── Fallback: GraphScheduler failed → ReasoningEngine.chat() ─────────
      const errMsg = (err as Error).message;
      logger.warn(`[graph-scheduler] Failed (${errMsg}); falling back to reasoning engine`);
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
      if (metrics) this.ui.renderExecutionSummary(metrics);

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
    provider: AzureAIProvider,
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
      // ── Graceful fallback: orchestrator failed → ReasoningEngine.chat() ──
      const errMsg = (err as Error).message;
      logger.warn(`[router] Orchestrator failed (${errMsg}); falling back to reasoning engine`);
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
    provider: AzureAIProvider,
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

      const { response, metrics: execMetrics } = await executor.execute(
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

      // ── Phase 3: Verification loop (with step context for targeted fixes) ──
      const verifier = new VerificationLoop(provider, ctx.index, chatContext);
      const verResult = await verifier.runWithRetry(
        ctx.rootPath,
        [], // stateless
        (stage) => this.ui.stream(stage),
        signal,
        executor.getStepContexts(),
      );

      // ── Phase 4: Execution summary ───────────────────────────────────────
      this.ui.renderFeatureExecutionSummary({
        ...execMetrics,
        verificationStatus: verResult.passed ? 'PASSED' : 'FAILED',
      });

      return assistantResponse;

    } catch (err) {
      // ── Graceful fallback: pipeline failed → ReasoningEngine.chat() ──────
      const errMsg = (err as Error).message;
      logger.warn(`[pipeline] Failed (${errMsg}); falling back to reasoning engine`);
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
    return { handled: true, shouldQuit: false };
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
    return { handled: true, shouldQuit: false };
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
