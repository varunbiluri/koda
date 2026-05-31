import * as readline from 'node:readline';
import * as path from 'node:path';
import { execSync } from 'child_process';
import chalk from 'chalk';
import { UIRenderer } from './ui-renderer.js';
import { ConversationEngine, type ConversationContext } from './conversation-engine.js';
import { handleSlashCommand } from './slash-commands.js';
import { loadIndex } from '../../store/index-store.js';
import { configExists, loadConfig } from '../../ai/config-store.js';
import { mcpManager } from '../../mcp/mcp-manager.js';
import { runProviderSetup } from '../../ai/providers/provider-setup.js';
import type { RepoIndex } from '../../types/index.js';

/**
 * SessionManager — entry point for the conversational Koda session.
 *
 * Responsibilities:
 *  1. Detect repository context (name, branch, index status)
 *  2. Run setup wizard if Azure credentials are missing
 *  3. Drive the interactive conversation loop
 */
export class SessionManager {
  private ui: UIRenderer;
  private engine: ConversationEngine;
  private rl: readline.Interface | null = null;
  /** Abort controller for the currently-running AI task. */
  private activeAbort: AbortController | null = null;
  /** Whether the interrupt pause menu is currently showing. */
  private pauseMenuActive = false;
  /** Header context stored for /clear re-render. */
  private headerCtx: Parameters<UIRenderer['renderHeader']>[0] | null = null;
  /** Last input from the user — used for "modify plan" replay. */
  private lastInput = '';
  /** Tracks files modified in the last task (for smart suggestions). */
  private lastFilesChanged: string[] = [];
  /** Last task was a write operation (for smart suggestions). */
  private lastWasWrite = false;

  constructor(ui?: UIRenderer, engine?: ConversationEngine) {
    this.ui = ui ?? new UIRenderer();
    this.engine = engine ?? new ConversationEngine(this.ui);
  }

  async start(rootPath: string = process.cwd()): Promise<void> {
    // 1. Gather context
    const repoName = path.basename(rootPath);
    const branch = getGitBranch(rootPath);
    const hasConfig = await configExists();

    // 2. Load index (non-fatal if missing)
    let index: RepoIndex | null = null;
    let indexStatus: 'ready' | 'missing' | 'stale' = 'missing';
    try {
      index = await loadIndex(rootPath);
      indexStatus = 'ready';
    } catch {
      indexStatus = 'missing';
    }

    // 3. Get model name
    let model = 'not configured';
    if (hasConfig) {
      try {
        const cfg = await loadConfig();
        model = cfg.model;
      } catch {
        // ignore
      }
    }

    // 4. Render header
    this.headerCtx = { repoName, branch, indexStatus, model };
    this.ui.renderHeader(this.headerCtx);

    // 5. Setup wizard if no config
    if (!hasConfig) {
      const configured = await this.runSetupWizard();
      if (configured) {
        try {
          const cfg = await loadConfig();
          model = cfg.model;
        } catch {
          // ignore
        }
      }
    }

    // 6. Suggest init if no index
    if (indexStatus === 'missing') {
      this.ui.renderInfo('No index found. Run `koda init` to index this repository, or type "init" to do it now.');
      console.log();
    }

    // 7. Restore persisted session history
    const restoredCount = await this.engine.loadPersistedSession(rootPath);
    if (restoredCount > 0) {
      this.ui.renderInfo(`Resumed session · ${restoredCount} messages`);
      console.log();
    }

    // 8. Connect MCP servers in background (non-fatal)
    mcpManager.setRootPath(rootPath);
    mcpManager.ensureConnected(rootPath).catch(() => {
      // MCP optional — failures surfaced via /mcp list
    });

    // 9. Start conversation loop
    this.ui.renderWelcome();
    await this.loop({ rootPath, index, hasConfig: await configExists(), branch });
  }

  private async loop(ctx: ConversationContext): Promise<void> {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
      historySize: 100,
    });

    // ── Ctrl+C: pause menu when task is active, else exit ────────────────────
    this.rl.on('SIGINT', () => {
      if (this.activeAbort && !this.pauseMenuActive) {
        // Show pause menu without cancelling yet
        this.pauseMenuActive = true;
        process.stdout.write('\n\n');
        console.log(`  ${chalk.bold('Task paused')}  ${chalk.gray('(task is still running)')}`);
        console.log();
        console.log(`  ${chalk.cyan('[1]')} ${chalk.white('Resume')}      continue the current task`);
        console.log(`  ${chalk.cyan('[2]')} ${chalk.white('Cancel')}      stop the task`);
        console.log(`  ${chalk.cyan('[3]')} ${chalk.white('Modify')}      cancel and enter a revised instruction`);
        console.log();
        process.stdout.write(chalk.cyan('> '));

        const resumeListener = (line: string): void => {
          const choice = line.trim();
          this.rl?.removeListener('line', resumeListener);
          this.pauseMenuActive = false;

          if (choice === '2') {
            this.activeAbort?.abort();
            this.activeAbort = null;
            console.log();
            this.ui.renderInfo('Task cancelled.');
            console.log();
            ask();
          } else if (choice === '3') {
            this.activeAbort?.abort();
            this.activeAbort = null;
            console.log();
            this.ui.renderInfo('Enter a revised instruction:');
            ask();
          } else {
            // '1' or any other input → resume
            this.ui.renderInfo('Resuming…');
          }
        };

        this.rl?.once('line', resumeListener);
      } else if (!this.activeAbort && !this.pauseMenuActive) {
        console.log('\n\n  ' + chalk.gray('Goodbye!'));
        this.rl?.close();
      }
    });

    const ask = (): void => {
      if ((process.stdout as NodeJS.WriteStream & { _lastChar?: string })._lastChar !== '\n') {
        process.stdout.write('\n');
      }
      this._renderSuggestions(ctx);
      this.ui.renderPrompt();
    };

    ask();

    this.rl.on('line', async (rawLine) => {
      const input = rawLine.trim();
      if (!input) { ask(); return; }

      // ── Slash commands ──────────────────────────────────────────────────────
      if (input.startsWith('/')) {
        const result = await handleSlashCommand(input, {
          ui:              this.ui,
          engine:          this.engine,
          ctx,
          headerCtx:       this.headerCtx,
          runSetupWizard:  () => this.runSetupWizard(),
          handleInlineInit:(c) => this.handleInlineInit(c),
          handleDiff:      (c) => this.handleDiff(c),
        });
        if (result === 'quit') {
          this.rl?.close();
          return;
        }
        ask();
        return;
      }

      // ── Inline init ─────────────────────────────────────────────────────────
      if (input.toLowerCase() === 'init') {
        await this.handleInlineInit(ctx);
        ask();
        return;
      }

      // ── AI processing with cancellable AbortController ──────────────────────
      this.lastInput      = input;
      this.lastWasWrite   = false;
      this.lastFilesChanged = [];
      this.activeAbort = new AbortController();

      // ── Diff-first approval callback (Part 2 — Diff-First Editing) ─────────
      const onDiff = async (filePath: string, oldContent: string, newContent: string): Promise<boolean> => {
        this.ui.renderDiffPreview(filePath, oldContent, newContent);
        // Use the permission gate's readline prompt to ask [Y/n/e]
        const { permissionGate } = await import('../../runtime/permission-gate.js');
        const approved = await permissionGate.requestApprovalWithDiff(
          `write ${filePath}`,
          '', // diff already rendered above via renderDiffPreview
        );
        if (approved) {
          this.lastWasWrite = true;
          this.lastFilesChanged.push(filePath);
        }
        return approved;
      };

      try {
        const response = await this.engine.process(input, ctx, this.activeAbort.signal, onDiff);
        if (response.shouldQuit) {
          console.log('\n  ' + chalk.gray('Goodbye!'));
          this.rl?.close();
          return;
        }
      } catch (err) {
        this.ui.renderError((err as Error).message);
      } finally {
        this.activeAbort = null;
      }

      ask();
    });

    await new Promise<void>((resolve) => {
      this.rl!.on('close', resolve);
    });
  }

  private async handleDiff(ctx: ConversationContext): Promise<void> {
    const { execSync: exec } = await import('child_process');
    try {
      const diff = exec('git diff --stat HEAD', {
        cwd: ctx.rootPath,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).toString().trim();

      if (!diff) {
        this.ui.renderInfo('No pending changes.');
        console.log();
        return;
      }

      console.log();
      diff.split('\n').forEach(line => {
        if (line.includes('+') && !line.startsWith('---')) {
          process.stdout.write('  ' + line + '\n');
        } else {
          process.stdout.write('  ' + chalk.gray(line) + '\n');
        }
      });
      console.log();
    } catch {
      this.ui.renderError('Could not read git diff.', 'Ensure this is a git repository.');
    }
  }

  private async handleInlineInit(ctx: ConversationContext): Promise<void> {
    const { runIndexingPipeline } = await import('../../engine/indexing-pipeline.js');
    const { loadIndex: reloadIndex } = await import('../../store/index-store.js');

    const spinner = this.ui.renderThinking();
    this.ui.renderStage('analyzing');

    try {
      await runIndexingPipeline(ctx.rootPath, {
        force: false,
        onProgress: (stage: string) => {
          this.ui.renderStage(stage);
        },
      });
      ctx.index = await reloadIndex(ctx.rootPath);
      this.ui.stopSpinner(true, 'Repository indexed');
    } catch (err) {
      this.ui.stopSpinner(false, `Indexing failed: ${(err as Error).message}`);
    }
  }

  /**
   * Interactive setup wizard for Azure credentials.
   *
   * Flow:
   *  1.  Prompt for endpoint (validates https://)
   *  2.  Prompt for API key (hidden password input)
   *  3.  Fetch all deployments from Azure API           ← retries from step 1 on failure
   *  4.  Filter to chat-compatible models only
   *  4a. If none compatible, print guidance and exit
   *  5.  Arrow-key selection from compatible deployments (title: "id (model)")
   *  6.  Validate selected deployment via a minimal chat/completions request
   *                                                     ← retries step 5 on OperationNotSupported
   *  7.  Save config and print confirmation
   *
   * Returns true when credentials are saved, false if the user cancels.
   */
  async runSetupWizard(): Promise<boolean> {
    return runProviderSetup(this.ui);
  }

  /**
   * Render contextual action suggestions above the prompt (Part 5 — Smart Input).
   *
   * Suggestions are derived from the current session state:
   *  - If no index:          offer to run `koda init`
   *  - After a write:        offer git diff / commit
   *  - Default:              show common action starters
   */
  private _renderSuggestions(ctx: ConversationContext): void {
    const suggestions: string[] = [];

    if (!ctx.index) {
      suggestions.push('init — index this repository first');
    } else if (this.lastWasWrite && this.lastFilesChanged.length > 0) {
      suggestions.push('git status — review pending changes');
      suggestions.push('run the tests — verify the change');
    } else if (this.lastInput) {
      // Offer follow-up actions based on what the user just asked
      const l = this.lastInput.toLowerCase();
      if (l.includes('fix') || l.includes('bug')) {
        suggestions.push('run the tests — verify the fix');
        suggestions.push('explain the fix — describe what changed');
      } else if (l.includes('add') || l.includes('implement') || l.includes('create')) {
        suggestions.push('add tests for the new feature');
        suggestions.push('explain the implementation');
      } else if (l.includes('explain') || l.includes('how does')) {
        suggestions.push('find usages — search for call sites');
        suggestions.push('add a feature — build on this module');
      } else {
        // Generic starters
        suggestions.push('explain <file or symbol>');
        suggestions.push('fix <describe a bug>');
        suggestions.push('add <describe a feature>');
      }
    } else {
      suggestions.push('explain <file or symbol>');
      suggestions.push('fix <describe a bug>');
      suggestions.push('add <describe a feature>');
    }

    this.ui.renderSmartSuggestions(suggestions.slice(0, 3));
  }

  stop(): void {
    this.rl?.close();
  }
}


function getGitBranch(rootPath: string): string {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: rootPath,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
      .toString()
      .trim();
  } catch {
    return 'unknown';
  }
}
