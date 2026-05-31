/**
 * Slash command router — Claude Code–style in-session commands + MCP management.
 */

import { execSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import chalk from 'chalk';
import type { UIRenderer, HeaderContext } from '../ui-renderer.js';
import type { ConversationEngine, ConversationContext } from '../conversation-engine.js';
import { configExists, loadConfig, saveConfig } from '../../../ai/config-store.js';
import { loadIndex, loadIndexMetadata } from '../../../store/index-store.js';
import { agentRegistry } from '../../../orchestrator/agent-registry.js';
import { skillRegistry } from '../../../skills/skill-registry.js';
import { mcpManager } from '../../../mcp/mcp-manager.js';
import { runMcpCommand } from '../../../mcp/cli-handlers.js';
import { runSlashCommit } from './commit-handler.js';
import { WorkspaceIntelligence } from '../../../memory/workspace-intelligence.js';
import {
  canonicalSlashCommand,
  parseSlashCommand,
  SLASH_CATEGORY_LABELS,
  getCommandsByCategory,
} from './registry.js';

export type SlashResult = 'continue' | 'quit';

export interface SlashHandlerContext {
  ui:              UIRenderer;
  engine:          ConversationEngine;
  ctx:             ConversationContext;
  headerCtx:       HeaderContext | null;
  runSetupWizard:  () => Promise<boolean>;
  handleInlineInit:(ctx: ConversationContext) => Promise<void>;
  handleDiff:      (ctx: ConversationContext) => Promise<void>;
}

/**
 * Route and execute an in-session slash command.
 *
 * @param input - The raw user-entered slash command string (for example `"/help"` or `"/commit message"`).
 * @param h - Handler context providing UI, engine, conversation context, and auxiliary handlers used to perform command actions.
 * @returns `'quit'` to terminate the session, `'continue'` to keep the session running.
 */
export async function handleSlashCommand(
  input: string,
  h: SlashHandlerContext,
): Promise<SlashResult> {
  const { cmd: rawCmd, args } = parseSlashCommand(input);
  const cmd = canonicalSlashCommand(rawCmd);

  switch (cmd) {
    case '/help':
      h.ui.renderHelp();
      return 'continue';

    case '/exit':
    case '/quit':
      await mcpManager.disconnectAll();
      console.log('\n  ' + chalk.gray('Goodbye!'));
      return 'quit';

    case '/clear':
      console.clear();
      if (h.headerCtx) h.ui.renderHeader(h.headerCtx);
      h.ui.renderWelcome();
      return 'continue';

    case '/compact':
    case '/reset':
      console.clear();
      h.engine.resetHistory();
      if (h.headerCtx) h.ui.renderHeader(h.headerCtx);
      h.ui.renderInfo('Context compressed — session history cleared.');
      console.log();
      h.ui.renderWelcome();
      return 'continue';

    case '/resume':
      h.ui.renderInfo('Session resume: Koda uses stateless turns — each message is self-contained.');
      h.ui.renderInfo('Use /memory for cross-session patterns saved in .koda/');
      console.log();
      return 'continue';

    case '/share':
      await exportSessionSummary(h.ctx.rootPath, h.ui);
      return 'continue';

    case '/rewind':
      h.ui.renderInfo('Use git to revert changes: /diff then git checkout <file>');
      console.log();
      return 'continue';

    case '/context':
      h.ui.slashContext();
      return 'continue';

    case '/budget':
    case '/cost': {
      const { ProductMetrics } = await import('../../../product/metrics.js');
      let pm = null as Awaited<ReturnType<typeof ProductMetrics.load>> | null;
      try { pm = await ProductMetrics.load(h.ctx.rootPath); } catch { /* ok */ }
      h.ui.slashEfficiency(pm);
      return 'continue';
    }

    case '/history':
      h.ui.renderInfo(`Session · ${h.engine.getHistoryLength()} messages (stateless engine)`);
      console.log();
      return 'continue';

    case '/memory':
      await showMemory(h.ctx.rootPath, h.ui);
      return 'continue';

    case '/commit':
      await runSlashCommit({
        rootPath:    h.ctx.rootPath,
        ui:          h.ui,
        userMessage: args.join(' ').trim() || undefined,
      });
      return 'continue';

    case '/diff':
      await h.handleDiff(h.ctx);
      return 'continue';

    case '/review':
      h.ui.renderInfo('Starting code review…');
      console.log();
      await h.engine.process('review recent changes for bugs, security issues, and code quality', h.ctx);
      return 'continue';

    case '/pr_comments':
      await showPrComments(h.ctx.rootPath, h.ui);
      return 'continue';

    case '/undo':
      h.ui.renderInfo('Revert a file: git checkout -- <path>');
      console.log();
      return 'continue';

    case '/tools':
      h.ui.slashTools();
      return 'continue';

    case '/plan':
      h.ui.slashPlan();
      return 'continue';

    case '/doctor':
      await runDoctor(h.ctx.rootPath, h.ui);
      return 'continue';

    case '/init':
      await h.handleInlineInit(h.ctx);
      return 'continue';

    case '/status':
      await showStatus(h.ctx, h.ui);
      return 'continue';

    case '/permissions':
      showPermissions(h.ui);
      return 'continue';

    case '/config':
      await showConfig(h.ui);
      return 'continue';

    case '/login': {
      const ok = await h.runSetupWizard();
      if (ok) {
        h.ctx.hasConfig = true;
        h.ui.renderInfo('Provider configured.');
        console.log();
      }
      return 'continue';
    }

    case '/logout':
      await handleLogout(h.ui);
      return 'continue';

    case '/model':
      await showModel(h.ui);
      return 'continue';

    case '/theme':
      h.ui.renderInfo('Theme: terminal colors follow your shell. Koda uses chalk for styling.');
      console.log();
      return 'continue';

    case '/vim':
      h.ui.renderInfo('Vim mode: use your terminal\'s line editing (emacs default). Full vim mode coming soon.');
      console.log();
      return 'continue';

    case '/mcp':
      await handleMcp(args, h);
      return 'continue';

    case '/skills':
      showSkills(h.ui);
      return 'continue';

    case '/tasks':
      h.ui.renderInfo('Tasks: describe work in natural language or use koda plan "<task>"');
      console.log();
      return 'continue';

    case '/agents':
      showAgents(h.ui);
      return 'continue';

    case '/desktop':
      h.ui.renderInfo('Desktop: use the VS Code extension — run `koda start-lsp` and connect from extensions/vscode');
      console.log();
      return 'continue';

    case '/mobile':
      h.ui.renderInfo('Mobile: Koda is terminal-first. Remote sessions via SSH + tmux work well.');
      console.log();
      return 'continue';

    default:
      h.ui.renderError(`Unknown command: ${input}`, 'Type /help for all commands.');
      return 'continue';
  }
}

/**
 * Runs an MCP subcommand and forwards its output to the UI.
 *
 * Executes the MCP command represented by `args` for the current session root and
 * routes informational and error messages to the provided UI renderer.
 *
 * @param args - The MCP subcommand name followed by its arguments
 * @param h - Handler context providing `ctx.rootPath` and UI rendering methods
 */

async function handleMcp(args: string[], h: SlashHandlerContext): Promise<void> {
  await runMcpCommand(args, h.ctx.rootPath, {
    info:  (msg) => h.ui.renderInfo(msg),
    error: (msg, hint) => h.ui.renderError(msg, hint),
  });
}

/**
 * Performs a health check and prints repository, index, agent, MCP, Git, and AI configuration status.
 *
 * Prints an "Doctor" header, then:
 * - reports index file and chunk counts (or suggests `/init` if not found),
 * - reports the number of registered agents,
 * - reports MCP connection status (connected/total),
 * - reports current Git branch (or "Git: unavailable"),
 * - reports whether AI is configured (or suggests `/login`),
 * and finally prints a "Health check complete" footer.
 *
 * @param rootPath - Path to the repository root to inspect
 * @param ui - UI renderer used to display the status lines
 */

async function runDoctor(rootPath: string, ui: UIRenderer): Promise<void> {
  console.log();
  console.log(chalk.bold('  Doctor'));
  console.log();

  try {
    const index = await loadIndex(rootPath);
    ui.renderInfo(`Index: ${index.files.length} files, ${index.chunks.length} chunks`);
  } catch {
    ui.renderInfo('Index: not found — /init');
  }

  ui.renderInfo(`Agents: ${agentRegistry.getAgentCount()} registered`);

  const mcpStatuses = await mcpManager.getStatuses(rootPath);
  ui.renderInfo(`MCP: ${mcpStatuses.filter((s) => s.connected).length}/${mcpStatuses.length} connected`);

  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: rootPath,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).toString().trim();
    ui.renderInfo(`Git: ${branch}`);
  } catch {
    ui.renderInfo('Git: unavailable');
  }

  ui.renderInfo((await configExists()) ? 'AI: configured' : 'AI: not configured — /login');

  console.log();
  console.log(chalk.green('  ✓ Health check complete'));
  console.log();
}

/**
 * Prints repository status information (path, branch, and index summary) to the UI.
 *
 * @param ctx - Conversation context containing `rootPath`, optional `branch`, and optional `index` used to report indexed file count
 * @param ui - UI renderer used to display the status lines
 */
async function showStatus(ctx: ConversationContext, ui: UIRenderer): Promise<void> {
  console.log();
  console.log(chalk.bold('  Status'));
  console.log();
  ui.renderInfo(`Repo: ${ctx.rootPath}`);
  ui.renderInfo(`Branch: ${ctx.branch ?? 'unknown'}`);
  if (ctx.index) {
    ui.renderInfo(`Index: ${ctx.index.files.length} files`);
  } else {
    ui.renderInfo('Index: not loaded — /init');
  }
  console.log();
}

/**
 * Displays the permission-tier legend with example capabilities for each tier.
 *
 * Prints three labeled tiers — `AUTO`, `ASK`, and `BLOCK` — with representative actions
 * or permissions for each tier to guide user expectations about automated vs. restricted operations.
 */
function showPermissions(ui: UIRenderer): void {
  console.log();
  console.log(chalk.bold('  Permission tiers'));
  console.log();
  console.log(`  ${chalk.green('AUTO')}   read_file, search_code, list_files, grep_code, fetch_url`);
  console.log(`  ${chalk.yellow('ASK')}    write_file, edit_file, run_terminal, git_commit, git_push`);
  console.log(`  ${chalk.red('BLOCK')}  rm -rf, git push --force, DROP TABLE, etc.`);
  console.log();
}

/**
 * Displays the current AI provider configuration (provider, model, and endpoint) or prompts the user to run `/login` if no configuration is present.
 *
 * If no configuration exists, informs the user via the UI and returns early.
 */
async function showConfig(ui: UIRenderer): Promise<void> {
  if (!(await configExists())) {
    ui.renderInfo('No configuration — run /login');
    console.log();
    return;
  }
  const config = await loadConfig();
  console.log();
  console.log(chalk.bold('  Configuration'));
  console.log();
  console.log(`  ${chalk.gray('Provider:')} ${config.provider}`);
  console.log(`  ${chalk.gray('Model:')}    ${config.model}`);
  console.log(`  ${chalk.gray('Endpoint:')} ${config.endpoint}`);
  console.log();
}

/**
 * Displays the configured AI model and provider, or prompts the user to run `/login` if no configuration exists.
 */
async function showModel(ui: UIRenderer): Promise<void> {
  if (!(await configExists())) {
    ui.renderInfo('No model configured — /login');
    console.log();
    return;
  }
  const config = await loadConfig();
  ui.renderInfo(`Model: ${config.model} (${config.provider})`);
  console.log();
}

/**
 * Removes stored CLI credentials by deleting the local Koda config file and notifies the user.
 *
 * If the credentials file exists it is deleted and a success message is shown; otherwise an informational message indicates no credentials were found.
 *
 * @param ui - UI renderer used to display messages to the user
 */
async function handleLogout(ui: UIRenderer): Promise<void> {
  try {
    const configPath = path.join(
      process.env.HOME ?? process.env.USERPROFILE ?? '',
      '.koda',
      'config.json',
    );
    await fs.unlink(configPath);
    ui.renderInfo('Credentials cleared. Run /login to reconfigure.');
  } catch {
    ui.renderInfo('No credentials file found.');
  }
  console.log();
}

/**
 * Display comments for the current pull request using the GitHub CLI.
 *
 * If comments are available, prints them to stdout. If the command fails
 * (for example because the `gh` CLI is unavailable or there is no open PR),
 * shows an informational message via the UI.
 *
 * @param rootPath - Repository root path to run the command in
 * @param ui - UI renderer used to show informational messages
 */
async function showPrComments(rootPath: string, ui: UIRenderer): Promise<void> {
  try {
    const out = execSync('gh pr view --comments', {
      cwd: rootPath,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).toString();
    console.log();
    console.log(out);
    console.log();
  } catch {
    ui.renderInfo('Requires gh CLI and an open PR in this repo.');
    console.log();
  }
}

/**
 * Displays workspace memory for the repository at the given root path.
 *
 * Loads the workspace intelligence store and prints a formatted memory summary to stdout.
 * If no learned patterns are available, renders an informational message via `ui`.
 * If the memory store cannot be loaded, renders a fallback informational message via `ui`.
 *
 * @param rootPath - Filesystem path of the repository to inspect
 * @param ui - UI renderer used to show informational messages
 */
async function showMemory(rootPath: string, ui: UIRenderer): Promise<void> {
  try {
    const ws = await WorkspaceIntelligence.load(rootPath);
    const formatted = ws.formatForPrompt('', 5);
    console.log();
    console.log(chalk.bold('  Workspace memory'));
    if (formatted) {
      console.log(formatted);
    } else {
      ui.renderInfo('No learned patterns yet — Koda builds memory as you work.');
    }
    console.log();
  } catch {
    ui.renderInfo('Memory store empty or unavailable.');
    console.log();
  }
}

/**
 * Write a compact markdown session summary to the repository's .koda/session-export.md file.
 *
 * The file includes an export timestamp, the repository path, and indexed file count when available.
 * The output directory is created if missing and the file is overwritten if it already exists.
 *
 * @param rootPath - Filesystem path to the repository where the session summary will be written
 */
async function exportSessionSummary(rootPath: string, ui: UIRenderer): Promise<void> {
  const outPath = path.join(rootPath, '.koda', 'session-export.md');
  const meta = await loadIndexMetadata(rootPath).catch(() => null);
  const lines = [
    '# Koda session export',
    '',
    `Exported: ${new Date().toISOString()}`,
    `Repo: ${rootPath}`,
    meta ? `Files indexed: ${meta.fileCount}` : '',
    '',
    '---',
    '',
    'Session is stateless — each turn is independent.',
    'Use /memory for cross-session patterns.',
  ].filter(Boolean);

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, lines.join('\n'), 'utf-8');
  ui.renderInfo(`Session summary written to ${outPath}`);
  console.log();
}

/**
 * Prints a brief list of registered skills with their IDs and truncated descriptions.
 *
 * Displays a header with the total skill count, outputs up to the first 20 skills (ID and up to 50 characters of description), and shows a hint indicating how many additional skills exist and how to list them all.
 */
function showSkills(ui: UIRenderer): void {
  const skills = skillRegistry.getAll();
  console.log();
  console.log(chalk.bold(`  Skills (${skills.length})`));
  console.log();
  for (const s of skills.slice(0, 20)) {
    console.log(`  ${chalk.cyan(s.id.padEnd(24))} ${chalk.gray(s.description.slice(0, 50))}`);
  }
  if (skills.length > 20) {
    console.log(chalk.gray(`  … ${skills.length - 20} more — run koda skills --list`));
  }
  console.log();
}

/**
 * Prints a concise list of registered agents to the terminal.
 *
 * Shows a header with the total agent count and prints up to the first 25 agents,
 * each on its own line with the agent name and a description truncated to 45 characters.
 */
function showAgents(ui: UIRenderer): void {
  const agents = agentRegistry.getAllAgents();
  console.log();
  console.log(chalk.bold(`  Agents (${agents.length})`));
  console.log();
  for (const a of agents.slice(0, 25)) {
    console.log(`  ${chalk.cyan(a.name.padEnd(28))} ${chalk.gray(a.description?.slice(0, 45) ?? '')}`);
  }
  console.log();
}

/** Re-export registry for help UI. */
export { SLASH_COMMANDS, SLASH_CATEGORY_LABELS, getCommandsByCategory } from './registry.js';
