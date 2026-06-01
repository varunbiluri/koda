import * as fs from 'node:fs/promises';
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
import { permissionGate } from '../../runtime/permission-gate.js';
import { runProviderSetup } from '../../ai/providers/provider-setup.js';
import { attachSlashMenu, slashCompleter, type SlashMenuHandle } from './slash/completer.js';
import {
  attachPasteHandler,
  disableBracketedPaste,
  enableBracketedPaste,
  isPasteActive,
  type PasteHandlerHandle,
} from './paste-handler.js';
import { applyCliLogDefaults, applyReplLogDefaults, LogLevel, setLogLevel, getLogLevel } from '../../utils/logger.js';
import { WorktreeSession } from '../../runtime/worktree-session.js';
import type { RepoIndex } from '../../types/index.js';
import {
  clearReadlineInput,
  normalizePauseChoice,
  renderPauseMenu,
} from './pause-menu.js';

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
  /** True while an AI turn is in flight — blocks concurrent line handlers. */
  private busy = false;
  /** Suppress suggestion chips until the user has sent at least one message. */
  private showSuggestions = false;
  /** Live slash-command menu attached to readline. */
  private slashMenu: SlashMenuHandle | null = null;
  private pasteHandler: PasteHandlerHandle | null = null;
  /** Double Ctrl+C within this window cancels immediately. */
  private lastSigintAt = 0;
  /** True when the user explicitly quit — distinguishes from accidental stdin disconnect. */
  private shuttingDown = false;
  /** Git worktree session (enter / merge / discard). */
  private worktreeSession: WorktreeSession | null = null;

  constructor(ui?: UIRenderer, engine?: ConversationEngine) {
    this.ui = ui ?? new UIRenderer();
    this.engine = engine ?? new ConversationEngine(this.ui);
  }

  async start(rootPath: string = process.cwd()): Promise<void> {
    applyReplLogDefaults();

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

    // 4. Worktree session (restore if previously entered)
    this.worktreeSession = await WorktreeSession.load(rootPath);
    const effectiveRoot   = this.worktreeSession.getEffectiveRoot();
    const effectiveBranch = getGitBranch(effectiveRoot);
    const activeWorktree  = this.worktreeSession.getActive();

    // 5. Connect MCP (optional) before rendering dashboard
    mcpManager.setRootPath(rootPath);
    const mcpIssues = await mcpManager.ensureConnected(rootPath);
    const recentActivity = await loadRecentActivity(rootPath);

    // 6. Render Claude Code–style welcome dashboard
    this.headerCtx = {
      repoName,
      branch: effectiveBranch,
      indexStatus,
      model,
      rootPath: effectiveRoot,
      mcpIssues,
      recentActivity,
      worktree: activeWorktree ?? undefined,
    };
    this.ui.renderHeader(this.headerCtx);

    if (activeWorktree) {
      this.ui.renderInfo(`Resumed worktree · ${activeWorktree.branchName}`);
      console.log();
    }

    // 7. Setup wizard if no config
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

    // 8. Suggest init if no index
    if (indexStatus === 'missing') {
      this.ui.renderInfo('No index found. Run `koda init` to index this repository, or type "init" to do it now.');
      console.log();
    }

    // 9. Restore persisted session history
    const restoredCount = await this.engine.loadPersistedSession(rootPath);
    if (restoredCount > 0) {
      this.ui.renderInfo(`Resumed session · ${restoredCount} messages`);
      console.log();
    }

    // 10. Start conversation loop
    await this.loop({
      rootPath: effectiveRoot,
      index,
      hasConfig: await configExists(),
      branch: effectiveBranch,
    });
  }

  private async loop(ctx: ConversationContext): Promise<void> {
    enableBracketedPaste();

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
      historySize: 100,
      completer: slashCompleter,
    });
    permissionGate.bindReadline(this.rl);
    permissionGate.bindBeforePrompt(() => this.ui.stopSpinner());
    this.slashMenu = attachSlashMenu(this.rl, (cmds, selectedIndex) => {
      this.ui.renderSlashMenu(cmds, selectedIndex);
    });
    // Attach paste handler last so its prependListener runs before slash-menu arrows.
    this.pasteHandler = attachPasteHandler(this.rl, {
      isInputBlocked: () => this.busy || this.pauseMenuActive,
      onTruncated: (len, max) => {
        this.ui.renderInfo(`Paste trimmed to ${max.toLocaleString()} chars (was ${len.toLocaleString()}).`);
      },
    });
    this.rl.once('close', () => {
      permissionGate.unbindReadline();
      this.slashMenu?.detach();
      this.pasteHandler?.detach();
      disableBracketedPaste();
    });

    // ── Ctrl+C: pause menu when task is active, else exit ────────────────────
    this.rl.on('SIGINT', () => {
      if (this.activeAbort && !this.pauseMenuActive) {
        const now = Date.now();
        if (now - this.lastSigintAt < 900) {
          this.activeAbort.abort();
          this.activeAbort = null;
          this.pauseMenuActive = false;
          this.ui.stopSpinner(false, 'cancelled');
          console.log();
          this.ui.renderInfo('Task cancelled.');
          console.log();
          this.busy = false;
          ask();
          this.lastSigintAt = 0;
          return;
        }
        this.lastSigintAt = now;

        this.pauseMenuActive = true;
        clearReadlineInput(this.rl!);
        renderPauseMenu();

        this.rl!.question(chalk.cyan('  Choice [1/2/3]: '), (answer) => {
          this.pauseMenuActive = false;
          const choice = normalizePauseChoice(answer);

          if (choice === 'cancel') {
            this.activeAbort?.abort();
            this.activeAbort = null;
            this.busy = false;
            this.ui.stopSpinner(false, 'cancelled');
            console.log();
            this.ui.renderInfo('Task cancelled.');
            console.log();
            ask();
          } else if (choice === 'modify') {
            this.activeAbort?.abort();
            this.activeAbort = null;
            this.busy = false;
            this.ui.stopSpinner(false, 'cancelled');
            console.log();
            this.ui.renderInfo('Enter a revised instruction:');
            ask();
          } else {
            console.log();
            this.ui.renderInfo('Resuming…');
            console.log();
          }
        });
      } else if (!this.activeAbort && !this.pauseMenuActive) {
        this.shuttingDown = true;
        console.log('\n\n  ' + chalk.gray('Goodbye!'));
        this.rl?.close();
      }
    });

    const ask = (): void => {
      if ((process.stdout as NodeJS.WriteStream & { _lastChar?: string })._lastChar !== '\n') {
        process.stdout.write('\n');
      }
      const active = this.worktreeSession?.getActive();
      if (active) {
        this.ui.renderWorktreePromptBanner(active);
      }
      if (this.showSuggestions) {
        this._renderSuggestions(ctx);
        this.ui.renderPrompt('');
      } else {
        this.ui.renderPrompt(active ? 'Work in isolation — /worktree merge when done' : undefined);
      }
    };

    ask();

    this.rl.on('line', async (rawLine) => {
      if (this.busy || this.pauseMenuActive) return;

      let input = rawLine.trim();
      if (!input) { ask(); return; }

      // Apply slash-menu selection before clearing (e.g. `/int` + Enter → `/init`)
      if (input.startsWith('/') && this.slashMenu) {
        input = this.slashMenu.resolveInput(input);
      }

      this.slashMenu?.clear();

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
          toggleVerbose:   () => this.toggleVerboseLogs(),
          worktreeSession: this.worktreeSession ?? undefined,
          onWorktreeRootChange: (root, branch) => {
            ctx.rootPath = root;
            ctx.branch = branch;
          },
        });
        if (result === 'quit') {
          this.shuttingDown = true;
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
      this.showSuggestions = true;

      const instant = this.engine.isInstantTurn(input, ctx);
      if (!instant) {
        this.activeAbort = new AbortController();
        this.busy = true;
        console.log(chalk.gray('  Ctrl+C pause · Ctrl+C twice cancel'));
      }

      // ── Diff-first approval callback (Part 2 — Diff-First Editing) ─────────
      const onDiff = async (filePath: string, oldContent: string, newContent: string): Promise<boolean> => {
        this.ui.renderDiffPreview(filePath, oldContent, newContent);
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
        const response = await this.engine.process(
          input,
          ctx,
          this.activeAbort?.signal,
          onDiff,
        );
        if (response.shouldQuit) {
          this.shuttingDown = true;
          console.log('\n  ' + chalk.gray('Goodbye!'));
          this.rl?.close();
          return;
        }
      } catch (err) {
        const aborted =
          (err as Error).name === 'AbortError' ||
          (err as DOMException).name === 'AbortError';
        if (aborted) {
          this.ui.stopSpinner(false, 'cancelled');
          this.ui.renderInfo('Task cancelled.');
        } else {
          this.ui.renderError((err as Error).message);
        }
      } finally {
        if (!instant) {
          this.activeAbort = null;
          this.busy = false;
        }
        if (process.stdin.isPaused()) {
          process.stdin.resume();
        }
      }

      ask();
    });

    await new Promise<void>((resolve) => {
      this.rl!.on('close', () => {
        applyCliLogDefaults();
        if (!this.shuttingDown) {
          console.log(
            '\n  ' + chalk.yellow('Session ended unexpectedly.') +
            chalk.gray(' Run `node bin/koda.js` again to continue.'),
          );
        }
        resolve();
      });
    });
  }

  /** Toggle internal logs + tool-stage lines. Returns new verbose state. */
  toggleVerboseLogs(): boolean {
    const verbose = getLogLevel() <= LogLevel.DEBUG || this.ui.isStreamVerbose();
    if (verbose) {
      setLogLevel(LogLevel.ERROR);
      this.ui.setStreamVerbose(false);
      return false;
    }
    setLogLevel(LogLevel.DEBUG);
    this.ui.setStreamVerbose(true);
    return true;
  }

  isVerboseLogging(): boolean {
    return getLogLevel() <= LogLevel.DEBUG || this.ui.isStreamVerbose();
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


async function loadRecentActivity(rootPath: string): Promise<string[]> {
  try {
    const raw = await fs.readFile(path.join(rootPath, '.koda', 'metrics.json'), 'utf8');
    const store = JSON.parse(raw) as { recentTasks?: Array<{ description?: string }> };
    return (store.recentTasks ?? [])
      .map((t) => t.description?.trim())
      .filter((d): d is string => Boolean(d));
  } catch {
    return [];
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
