import * as path from 'node:path';
import chalk from 'chalk';
import { detectIntent } from './intent-detector.js';
import { UIRenderer } from './ui-renderer.js';
import { loadIndexMetadata } from '../../store/index-store.js';
import { configExists, loadConfig } from '../../ai/config-store.js';
import { AzureAIProvider } from '../../ai/providers/azure-provider.js';
import { ReasoningEngine } from '../../ai/reasoning/reasoning-engine.js';
import { QueryEngine } from '../../search/query-engine.js';
import type { ChatMessage } from '../../ai/types.js';
import type { RepoIndex } from '../../types/index.js';

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
  /** Rolling conversation history shared across all AI turns in this session. */
  private history: ChatMessage[] = [];

  constructor(ui?: UIRenderer) {
    this.ui = ui ?? new UIRenderer();
  }

  async process(input: string, ctx: ConversationContext): Promise<ConversationResponse> {
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
      return this.handleWithAI(input, ctx);
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

  // ── AI-first handler ───────────────────────────────────────────────────────

  private async handleWithAI(input: string, ctx: ConversationContext): Promise<ConversationResponse> {
    // Record the user turn before calling AI so the history is available inside chat()
    this.history.push({ role: 'user', content: input });

    this.ui.renderThinking();

    let assistantResponse = '';

    try {
      const config = await loadConfig();
      const provider = new AzureAIProvider(config);
      const engine = new ReasoningEngine(ctx.index, provider);

      const metrics = await engine.chat(
        input,
        {
          repoName: path.basename(ctx.rootPath),
          branch:   ctx.branch ?? 'unknown',
          rootPath: ctx.rootPath,
          fileCount: ctx.index?.metadata.fileCount ?? 0,
        },
        this.history,
        (chunk) => {
          assistantResponse += chunk;
          this.ui.renderStreamChunk(chunk);
        },
        (stage) => this.ui.stream(stage),
        (steps) => {
          this.ui.stream('🧠  planning');
          this.ui.renderPlan(steps);
        },
      );

      // Record the assistant turn so follow-up questions have context
      if (assistantResponse) {
        this.history.push({ role: 'assistant', content: assistantResponse });
      }

      this.ui.renderStreamEnd();
      if (metrics) {
        this.ui.renderExecutionSummary(metrics);
      }
    } catch (err) {
      // Remove the optimistically-pushed user message on failure
      this.history.pop();
      this.ui.stopSpinner(false, (err as Error).message);
    }

    return { handled: true, shouldQuit: false };
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
