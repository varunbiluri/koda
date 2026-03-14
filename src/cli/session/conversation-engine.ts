import chalk from 'chalk';
import { detectIntent, type DetectedIntent } from './intent-detector.js';
import { UIRenderer } from './ui-renderer.js';
import { loadIndex } from '../../store/index-store.js';
import { loadIndexMetadata } from '../../store/index-store.js';
import { configExists, loadConfig } from '../../ai/config-store.js';
import { AzureAIProvider } from '../../ai/providers/azure-provider.js';
import { ReasoningEngine } from '../../ai/reasoning/reasoning-engine.js';
import { ExecutionEngine } from '../../execution/execution-engine.js';
import { QueryEngine } from '../../search/query-engine.js';
import type { RepoIndex } from '../../types/index.js';

export interface ConversationContext {
  rootPath: string;
  index: RepoIndex | null;
  hasConfig: boolean;
}

export interface ConversationResponse {
  handled: boolean;
  shouldQuit: boolean;
  output?: string;
}

/**
 * ConversationEngine — routes detected intents to the correct Koda pipeline.
 */
export class ConversationEngine {
  private ui: UIRenderer;

  constructor(ui?: UIRenderer) {
    this.ui = ui ?? new UIRenderer();
  }

  async process(input: string, ctx: ConversationContext): Promise<ConversationResponse> {
    const detected = detectIntent(input);

    switch (detected.intent) {
      case 'quit':
        return { handled: true, shouldQuit: true };

      case 'greeting':
        return this.handleGreeting();

      case 'help':
        this.ui.renderHelp();
        return { handled: true, shouldQuit: false };

      case 'status':
        return this.handleStatus(ctx);

      case 'explain':
      case 'search':
        return this.handleExplain(detected, ctx);

      case 'build':
        return this.handleBuild(detected, ctx);

      case 'fix':
        return this.handleFix(detected, ctx);

      case 'refactor':
        return this.handleRefactor(detected, ctx);

      default:
        return this.handleExplain(detected, ctx);
    }
  }

  private handleGreeting(): ConversationResponse {
    console.log();
    console.log(`  Hello! I'm ${chalk.cyan('Koda')}, your AI software engineer.`);
    console.log();
    console.log('  You can ask me to:');
    console.log();
    console.log(`  ${chalk.cyan('•')} ${chalk.white('explain')} ${chalk.gray('code or architecture')}`);
    console.log(`  ${chalk.cyan('•')} ${chalk.white('add')} ${chalk.gray('new features')}`);
    console.log(`  ${chalk.cyan('•')} ${chalk.white('fix')} ${chalk.gray('bugs and errors')}`);
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
      console.log(`  ${chalk.gray('AI config:')}    ${hasConfig ? chalk.green('configured') : chalk.yellow('not configured (run koda login)')}`);
      console.log(`  ${chalk.gray('Indexed at:')}   ${chalk.white(meta.createdAt)}`);
      console.log();
    } catch {
      this.ui.renderError('No index found.', 'Run `koda init` to index this repository.');
    }
    return { handled: true, shouldQuit: false };
  }

  private async handleExplain(
    detected: DetectedIntent,
    ctx: ConversationContext,
  ): Promise<ConversationResponse> {
    if (!ctx.index) {
      this.ui.renderError('Repository not indexed.', 'Run `koda init` first.');
      return { handled: true, shouldQuit: false };
    }

    if (!ctx.hasConfig) {
      // Fall back to local search (no AI config)
      return this.handleSearch(detected.subject, ctx.index, ctx);
    }

    return this.handleExplainWithAI(detected.subject, ctx.index, ctx);
  }

  private async handleExplainWithAI(
    query: string,
    index: RepoIndex,
    ctx: ConversationContext,
  ): Promise<ConversationResponse> {
    // AI-powered analysis
    this.ui.renderThinking();
    this.ui.renderStage('analyzing');

    try {
      const config = await loadConfig();
      const provider = new AzureAIProvider(config);
      const engine = new ReasoningEngine(index, provider);

      this.ui.renderStage('running');
      this.ui.stopSpinner(true);

      const meta = await engine.analyzeStream(
        query,
        (chunk) => {
          this.ui.renderStreamChunk(chunk);
        },
      );

      this.ui.renderStreamEnd();
      this.ui.renderMeta(meta.filesAnalyzed, meta.chunksUsed, meta.contextTruncated);
    } catch {
      this.ui.stopSpinner(false);
      // Fall back to local search on AI error
      return this.handleSearch(query, index);
    }

    return { handled: true, shouldQuit: false };
  }

  private async handleSearch(query: string, index: RepoIndex, ctx?: ConversationContext): Promise<ConversationResponse> {
    const engine = new QueryEngine(index);
    const results = engine.search(query, 8);

    if (results.length === 0) {
      // If AI is configured, route to reasoning engine instead of showing "no results"
      if (ctx?.hasConfig) {
        return this.handleExplainWithAI(query, index, ctx);
      }
      this.ui.renderError(`No results found for "${query}".`);
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

  private async handleBuild(
    detected: DetectedIntent,
    ctx: ConversationContext,
  ): Promise<ConversationResponse> {
    if (!ctx.hasConfig) {
      this.ui.renderError(
        'AI configuration required for build tasks.',
        'Run `koda login` to configure Azure credentials.',
      );
      return { handled: true, shouldQuit: false };
    }

    const task = detected.subject;
    console.log();

    // Show plan first
    this.ui.renderPlan([
      `Analyze repository structure for: ${task}`,
      'Plan implementation steps',
      'Run coding agents',
      'Run tests and verification',
      'Show patch preview',
    ]);

    const confirmed = await askConfirm('  Proceed? (y/n): ');
    if (!confirmed) {
      this.ui.renderInfo('Cancelled.');
      return { handled: true, shouldQuit: false };
    }

    this.ui.renderThinking();
    this.ui.renderStage('analyzing');

    try {
      const engine = new ExecutionEngine();
      this.ui.renderStage('planning');
      this.ui.renderStage('running');
      this.ui.renderStage('testing');

      const report = await engine.execute(task, ctx.rootPath, {});

      this.ui.stopSpinner(report.success);

      if (report.success) {
        this.ui.renderSuccess(`Task completed: ${task}`);
      } else {
        this.ui.renderError('Task completed with errors.');
      }

      if (report.filesModified.length > 0) {
        console.log(`  ${chalk.bold('Modified files:')}`);
        for (const f of report.filesModified) {
          console.log(`    ${chalk.cyan('·')} ${f}`);
        }
        console.log();
      }

      if (report.errors.length > 0) {
        for (const e of report.errors) {
          console.log(`  ${chalk.red('✖')} ${e}`);
        }
        console.log();
      }
    } catch (err) {
      this.ui.stopSpinner(false, (err as Error).message);
    }

    return { handled: true, shouldQuit: false };
  }

  private async handleFix(
    detected: DetectedIntent,
    ctx: ConversationContext,
  ): Promise<ConversationResponse> {
    return this.handleBuild(
      { ...detected, subject: `Fix the following issue: ${detected.subject}` },
      ctx,
    );
  }

  private async handleRefactor(
    detected: DetectedIntent,
    ctx: ConversationContext,
  ): Promise<ConversationResponse> {
    return this.handleBuild(
      { ...detected, subject: `Refactor the following: ${detected.subject}` },
      ctx,
    );
  }
}

async function askConfirm(prompt: string): Promise<boolean> {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    process.stdin.setEncoding('utf8');
    process.stdin.once('data', (data: string) => {
      const answer = data.toString().trim().toLowerCase();
      resolve(answer === 'y' || answer === 'yes');
    });
  });
}
