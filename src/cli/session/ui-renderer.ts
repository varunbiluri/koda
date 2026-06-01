import * as os from 'node:os';
import chalk from 'chalk';
import ora, { type Ora } from 'ora';
import type { FilePatch } from '../../patch/types.js';
import type { ChatMetrics } from '../../ai/reasoning/reasoning-engine.js';
import { mergeChatMetrics, emptyChatMetrics } from '../../product/task-telemetry.js';
import type { ExecutionPlan, PlanStep } from '../../ai/reasoning/planning-engine.js';
import type { ExecutionMetrics } from '../../execution/plan-executor.js';
import { VERSION } from '../../constants.js';
import { SLASH_CATEGORY_LABELS, getCommandsByCategory, type SlashCommandCategory, type SlashCommandDef } from './slash/registry.js';

// ── Simple line-diff utility (no external dependency) ─────────────────────────

/**
 * Generate a readable unified-style diff between two text blobs.
 * Uses a common-prefix/suffix heuristic — sufficient for typical file edits.
 */
export function simpleDiff(oldText: string, newText: string, filePath = ''): string {
  if (oldText === newText) return '(no changes)';

  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');

  // Common prefix lines
  let prefixLen = 0;
  while (
    prefixLen < oldLines.length &&
    prefixLen < newLines.length &&
    oldLines[prefixLen] === newLines[prefixLen]
  ) prefixLen++;

  // Common suffix lines
  let suffixLen = 0;
  while (
    suffixLen < oldLines.length - prefixLen &&
    suffixLen < newLines.length - prefixLen &&
    oldLines[oldLines.length - 1 - suffixLen] === newLines[newLines.length - 1 - suffixLen]
  ) suffixLen++;

  const CTX   = 2;        // context lines to show around the changed region
  const MAX_D = 40;       // max diff lines before truncating

  const out: string[] = [];
  if (filePath) {
    out.push(chalk.bold(`--- ${filePath}`));
    out.push(chalk.bold(`+++ ${filePath}`));
  }

  // Context before
  const ctxStart = Math.max(0, prefixLen - CTX);
  for (let k = ctxStart; k < prefixLen; k++) {
    out.push(chalk.gray(`  ${oldLines[k]}`));
  }

  // Removed
  const removeEnd = oldLines.length - suffixLen;
  let shown = 0;
  for (let k = prefixLen; k < removeEnd; k++) {
    if (shown >= MAX_D) { out.push(chalk.gray(`  … ${removeEnd - k} more removed`)); break; }
    out.push(chalk.red(`- ${oldLines[k]}`));
    shown++;
  }

  // Added
  const addEnd = newLines.length - suffixLen;
  shown = 0;
  for (let k = prefixLen; k < addEnd; k++) {
    if (shown >= MAX_D) { out.push(chalk.gray(`  … ${addEnd - k} more added`)); break; }
    out.push(chalk.green(`+ ${newLines[k]}`));
    shown++;
  }

  // Context after
  const ctxEnd = Math.min(oldLines.length, removeEnd + CTX);
  for (let k = removeEnd; k < ctxEnd; k++) {
    out.push(chalk.gray(`  ${oldLines[k]}`));
  }

  return out.join('\n');
}

export interface HeaderContext {
  repoName: string;
  branch: string;
  indexStatus: 'ready' | 'missing' | 'stale';
  model: string;
  rootPath?: string;
  mcpIssues?: string[];
  recentActivity?: string[];
  worktree?: {
    taskName: string;
    worktreePath: string;
    branchName: string;
  };
}

const DASHBOARD_WIDTH = 70;
const DASH_LEFT = 31;

function truncateVis(s: string, max: number): string {
  if (visLen(s) <= max) return s;
  const plain = s.replace(/\x1b\[[0-9;]*m/g, '');
  return plain.slice(0, max - 1) + '…';
}

function dashboardTop(title: string): string {
  const inner = DASHBOARD_WIDTH - 2;
  const side = Math.max(0, Math.floor((inner - title.length) / 2));
  const right = Math.max(0, inner - title.length - side);
  return '╭' + '─'.repeat(side) + title + '─'.repeat(right) + '╮';
}

function dashboardBottom(): string {
  return '╰' + '─'.repeat(DASHBOARD_WIDTH - 2) + '╯';
}

function shortenPath(p: string): string {
  const home = os.homedir();
  return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
}

function visLen(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, '').length;
}

function padRight(s: string, width: number): string {
  const pad = Math.max(0, width - visLen(s));
  return s + ' '.repeat(pad);
}

function dashboardRow(left: string, right: string): string {
  const border = chalk.cyan('│');
  return `${border} ${padRight(left, DASH_LEFT)}${border} ${padRight(right, DASHBOARD_WIDTH - DASH_LEFT - 5)} ${border}`;
}

export interface ProgressStage {
  label: string;
}

// ── Structured operation labels (7-char fixed width for visual alignment) ─────

const L = {
  READ:       chalk.cyan('READ   '),
  SEARCH:     chalk.cyan('SEARCH '),
  WRITE:      chalk.yellow('WRITE  '),
  RUN:        chalk.blue('RUN    '),
  GIT:        chalk.blue('GIT    '),
  FETCH:      chalk.blue('FETCH  '),
  COMMIT:     chalk.green('COMMIT '),
  PLAN:       chalk.bold.cyan('PLAN   '),
  CONTEXT:    chalk.gray('CONTEXT'),
  INFO:       chalk.gray('INFO   '),
  WARN:       chalk.yellow('WARN   '),
  ERROR:      chalk.red.bold('ERROR  '),
  OK:         chalk.green('OK     '),
  TOOLS:      chalk.bold('TOOLS  '),
  WORKTREE:   chalk.magenta('WKTREE '),
  PERMISSION: chalk.yellow('PERM   '),
  AGENT:      chalk.bold.magenta('AGENT  '),
} as const;

// Stage key → structured label (for legacy stage-key callers)
const STAGE_MAP: Record<string, string> = {
  analyzing:  'READ    analyzing repository',
  planning:   'PLAN    planning execution',
  thinking:   'INFO    thinking',
  running:    'RUN     running agents',
  testing:    'RUN     running tests',
  applying:   'WRITE   applying changes',
  generating: 'INFO    generating response',
};

/** Parse a raw stage string into label + detail for display. */
function parseStage(raw: string): { label: string; detail: string } {
  // Structured format emitted by tool-registry (e.g. "READ src/auth.ts")
  if (raw.startsWith('READ '))       return { label: L.READ,       detail: raw.slice(5) };
  if (raw.startsWith('SEARCH '))     return { label: L.SEARCH,     detail: raw.slice(7) };
  if (raw.startsWith('WRITE '))      return { label: L.WRITE,      detail: raw.slice(6) };
  if (raw.startsWith('RUN '))        return { label: L.RUN,        detail: raw.slice(4) };
  if (raw.startsWith('GIT '))        return { label: L.GIT,        detail: raw.slice(4) };
  if (raw.startsWith('FETCH '))      return { label: L.FETCH,      detail: raw.slice(6) };
  if (raw.startsWith('COMMIT '))     return { label: L.COMMIT,     detail: raw.slice(7) };
  if (raw.startsWith('WARN '))       return { label: L.WARN,       detail: raw.slice(5) };
  if (raw.startsWith('INFO '))       return { label: L.INFO,       detail: raw.slice(5) };
  if (raw.startsWith('PLAN '))       return { label: L.PLAN,       detail: raw.slice(5) };
  if (raw.startsWith('WORKTREE '))   return { label: L.WORKTREE,   detail: raw.slice(9) };
  if (raw.startsWith('PERMISSION ')) return { label: L.PERMISSION, detail: raw.slice(11) };
  if (raw.startsWith('AGENT '))      return { label: L.AGENT,      detail: raw.slice(6) };
  // Map legacy stage keys
  const mapped = STAGE_MAP[raw];
  if (mapped) return parseStage(mapped);
  // Fallback: strip emoji prefix and treat as INFO
  // Strip leading non-ASCII/symbol prefix (emoji) without u-flag for Node 18 compat
  const stripped = raw.replace(/^[^a-zA-Z0-9([\-]+/, '').trim();
  return { label: L.INFO, detail: stripped || raw };
}

/** Hide noisy tool traces unless /verbose is on. */
function isQuietStage(raw: string): boolean {
  if (raw.startsWith('READ '))       return true;
  if (raw.startsWith('SEARCH '))     return true;
  if (raw.startsWith('WRITE '))      return true;
  if (raw.startsWith('RUN '))        return true;
  if (raw.startsWith('GIT '))        return true;
  if (raw.startsWith('FETCH '))      return true;
  if (raw.startsWith('COMMIT '))     return true;
  if (raw.startsWith('AGENT '))      return true;
  if (raw.startsWith('INFO thinking')) return true;
  if (raw.startsWith('INFO generating')) return true;
  if (raw.startsWith('INFO CACHE'))  return true;
  if (raw.startsWith('INFO DISK'))   return true;
  if (raw.startsWith('INFO CACHE_HIT')) return true;
  if (raw.startsWith('INFO DISK_CACHE')) return true;
  if (raw.startsWith('INFO ROUTER:')) return true;
  if (raw.startsWith('INFO Step ')) return true;
  if (raw.startsWith('PLAN '))      return true;
  if (raw.startsWith('WORKTREE '))  return true;
  if (raw.startsWith('INFO Verification')) return true;
  if (raw.startsWith('WARN Token budget')) return true;
  return false;
}

// ── PlanTracker ───────────────────────────────────────────────────────────────

/**
 * Tracks the execution plan and updates its display as steps complete.
 *
 * Renders a compact plan list. When advance() is called, the current step
 * is marked OK and the next step becomes active. Uses ANSI cursor movement
 * to update in place so the plan stays visible without scrolling away.
 */
export class PlanTracker {
  private steps: string[] = [];
  private current = 0;
  private rendered = false;
  private lineCount = 0; // lines printed so we can rewind

  setSteps(steps: string[]): void {
    this.steps = [...steps];
    this.current = 0;
    this.rendered = false;
    this.lineCount = 0;
    this._render(false);
  }

  advance(): void {
    if (!this.rendered || this.current >= this.steps.length) return;
    this.current++;
    this._render(true);
  }

  reset(): void {
    this.steps = [];
    this.current = 0;
    this.rendered = false;
    this.lineCount = 0;
  }

  private _render(rewind: boolean): void {
    if (rewind && this.lineCount > 0) {
      process.stdout.write(`\x1B[${this.lineCount}A\x1B[0J`);
    }

    const lines: string[] = [];
    lines.push('');
    lines.push(`  ${L.PLAN}`);
    lines.push('');
    for (let i = 0; i < this.steps.length; i++) {
      lines.push(this._formatStep(i));
    }
    lines.push('');

    for (const l of lines) console.log(l);
    this.lineCount = lines.length;
    this.rendered = true;
  }

  private _formatStep(i: number): string {
    const num = chalk.gray(String(i + 1) + '.');
    const text = this.steps[i];
    if (i < this.current) {
      return `  ${chalk.green('OK')} ${num} ${chalk.gray(text)}`;
    } else if (i === this.current) {
      return `  ${chalk.cyan(' →')} ${num} ${text}`;
    }
    return `     ${num} ${chalk.gray(text)}`;
  }
}

// ── DagVisualizer ─────────────────────────────────────────────────────────────

type DagNodeState = 'pending' | 'running' | 'done' | 'failed';

interface DagNodeEntry {
  id:          string;
  description: string;
  state:       DagNodeState;
  durationMs?: number;
}

/**
 * DagVisualizer — live ANSI-rewind display of a DAG execution.
 *
 * Shows each node with its current state:
 *   ●  pending — waiting for dependencies
 *   →  running — executing now
 *   ✔  done    — completed successfully  (elapsed time shown)
 *   ✗  failed  — errored
 *
 * Uses the same cursor-rewind technique as PlanTracker so the DAG panel
 * stays fixed in the terminal without scrolling away.
 */
export class DagVisualizer {
  private nodes:     DagNodeEntry[] = [];
  private rendered = false;
  private lineCount = 0;

  setNodes(nodes: Array<{ id: string; description: string }>): void {
    this.nodes = nodes.map((n) => ({ ...n, state: 'pending' as DagNodeState }));
    this.rendered = false;
    this.lineCount = 0;
    this._render(false);
  }

  nodeStart(nodeId: string): void {
    const n = this.nodes.find((x) => x.id === nodeId);
    if (n) { n.state = 'running'; this._render(true); }
  }

  nodeDone(nodeId: string, durationMs: number): void {
    const n = this.nodes.find((x) => x.id === nodeId);
    if (n) { n.state = 'done'; n.durationMs = durationMs; this._render(true); }
  }

  nodeFailed(nodeId: string): void {
    const n = this.nodes.find((x) => x.id === nodeId);
    if (n) { n.state = 'failed'; this._render(true); }
  }

  reset(): void {
    this.nodes     = [];
    this.rendered  = false;
    this.lineCount = 0;
  }

  private _render(rewind: boolean): void {
    if (rewind && this.lineCount > 0) {
      process.stdout.write(`\x1B[${this.lineCount}A\x1B[0J`);
    }

    const lines: string[] = ['', `  ${L.PLAN} Execution DAG`, ''];
    for (const node of this.nodes) {
      lines.push(this._formatNode(node));
    }
    lines.push('');

    for (const l of lines) console.log(l);
    this.lineCount = lines.length;
    this.rendered  = true;
  }

  private _formatNode(node: DagNodeEntry): string {
    const desc = node.description.length > 55
      ? node.description.slice(0, 52) + '…'
      : node.description;
    const id = node.id.padEnd(18);
    const dur = node.durationMs !== undefined
      ? chalk.gray(` ${(node.durationMs / 1000).toFixed(1)}s`)
      : '';

    switch (node.state) {
      case 'pending': return `     ${chalk.gray('●')} ${chalk.gray(id)} ${chalk.gray(desc)}`;
      case 'running': return `  ${chalk.cyan(' →')} ${chalk.cyan(id)} ${desc}`;
      case 'done':    return `  ${chalk.green(' ✔')} ${chalk.green(id)} ${chalk.gray(desc)}${dur}`;
      case 'failed':  return `  ${chalk.red(' ✗')} ${chalk.red(id)} ${chalk.gray(desc)}`;
    }
  }
}

// ── UIRenderer ────────────────────────────────────────────────────────────────

/**
 * UIRenderer — all terminal output for the conversational Koda session.
 *
 * Design principles:
 *   • No emojis — structured operation labels (READ, SEARCH, WRITE, …)
 *   • Fixed-width labels for visual column alignment
 *   • Spinner carries a live elapsed timer
 *   • Streaming output includes lightweight markdown rendering
 *   • All session state tracked here for slash-command introspection
 */
export class UIRenderer {
  private spinner: Ora | null = null;
  private timerInterval: ReturnType<typeof setInterval> | null = null;
  private timerSeconds = 0;
  private timerLabel = '';
  private inCodeBlock = false;

  // ── Session-level state (exposed via slash commands) ──────────────────────
  private _contextFiles: string[] = [];
  private _contextTokens = 0;
  private _toolUsage: Record<string, number> = {};
  private _planSteps: string[] = [];
  private _tokensUsed = 0;
  private _sessionMetrics: ChatMetrics = emptyChatMetrics();
  private _timeline: Array<{ name: string; durationMs: number }> = [];
  private _slashMenuLines = 0;
  private _planStepIndex = 0;
  /** When false, hide per-tool READ/SEARCH/INFO noise (default REPL). */
  private _streamVerbose = false;

  readonly planTracker  = new PlanTracker();
  readonly dagVisualizer = new DagVisualizer();

  // Called by conversation-engine after each chat() response
  updateContext(files: string[], tokens: number): void {
    this._contextFiles = files;
    this._contextTokens = tokens;
  }

  getContextSnapshot(): { files: string[]; tokens: number } {
    return { files: [...this._contextFiles], tokens: this._contextTokens };
  }

  recordToolUsed(name: string): void {
    this._toolUsage[name] = (this._toolUsage[name] ?? 0) + 1;
  }

  setLastPlan(steps: string[]): void {
    this._planSteps = steps;
  }

  addTokens(n: number): void {
    this._tokensUsed += n;
  }

  recordChatMetrics(m: ChatMetrics): void {
    this._sessionMetrics = mergeChatMetrics(this._sessionMetrics, m);
    this.addTokens(m.tokens);
  }

  getSessionMetrics(): ChatMetrics {
    return this._sessionMetrics;
  }

  /** Toggle detailed tool-stage lines (READ, SEARCH, thinking, …). */
  setStreamVerbose(verbose: boolean): void {
    this._streamVerbose = verbose;
  }

  isStreamVerbose(): boolean {
    return this._streamVerbose;
  }

  setTimeline(entries: Array<{ name: string; durationMs: number }>): void {
    this._timeline = entries;
  }

  get tokensUsed(): number { return this._tokensUsed; }

  resetSessionState(): void {
    this._contextFiles = [];
    this._contextTokens = 0;
    this._toolUsage = {};
    this._planSteps = [];
    this._planStepIndex = 0;
    this._tokensUsed = 0;
    this._sessionMetrics = emptyChatMetrics();
    this._timeline = [];
    this.planTracker.reset();
    this.dagVisualizer.reset();
  }

  // ── Header ────────────────────────────────────────────────────────────────

  renderHeader(ctx: HeaderContext): void {
    const border  = chalk.cyan;
    const user    = os.userInfo().username;
    const cwd     = truncateVis(shortenPath(ctx.rootPath ?? process.cwd()), 28);
    const branch  = truncateVis(ctx.branch, 18);
    const index   = formatIndexStatus(ctx.indexStatus);
    const tips = ctx.indexStatus === 'missing'
      ? ['Run /init to index this repo', 'Type /help for all commands', 'Try "explain README.md"']
      : ['Type /help for all commands', 'Use /trust to skip approvals', 'Try "fix lint errors"'];

    const activity = (ctx.recentActivity ?? [])
      .filter((a) => a.length > 2)
      .slice(0, 3);
    const activityLines = activity.length > 0
      ? activity.map((a) => chalk.gray(truncateVis(a, 32)))
      : [chalk.gray('No recent activity')];

    console.log();
    console.log(border(dashboardTop(` Koda v${VERSION} `)));
    console.log(dashboardRow('', ''));
    console.log(dashboardRow(
      chalk.white(`Welcome back ${user}!`),
      chalk.bold('Tips for getting started'),
    ));
    console.log(dashboardRow(
      chalk.gray(`${ctx.model} · ${index}`),
      chalk.gray(tips[0] ?? ''),
    ));
    console.log(dashboardRow(
      chalk.gray(`${cwd} (${branch})`),
      chalk.gray(tips[1] ?? ''),
    ));
    if (ctx.worktree) {
      console.log(dashboardRow(
        chalk.magenta(`WKTREE ${truncateVis(ctx.worktree.branchName, 22)}`),
        chalk.gray('/worktree merge · discard'),
      ));
    }
    console.log(dashboardRow('', chalk.gray(tips[2] ?? '')));
    console.log(dashboardRow('', ''));
    console.log(dashboardRow('', chalk.bold('Recent activity')));
    for (let i = 0; i < 3; i++) {
      console.log(dashboardRow('', activityLines[i] ?? ''));
    }
    console.log(dashboardRow('', ''));
    console.log(border(dashboardBottom()));

    if (ctx.mcpIssues && ctx.mcpIssues.length > 0) {
      for (const issue of ctx.mcpIssues) {
        console.log(chalk.yellow(`  ⚠ MCP ${issue}`));
      }
      console.log(chalk.gray('  Fix with /mcp remove <name> or edit ~/.koda/mcp.json'));
    }

    console.log();
  }

  renderWorktreeHelp(active: HeaderContext['worktree'] | null | undefined): void {
    console.log();
    console.log('  ' + chalk.bold('Worktree commands'));
    console.log();
    if (active) {
      console.log(`  ${L.WORKTREE}${chalk.white('active')} ${chalk.gray(shortenPath(active.worktreePath))}`);
      console.log(`         ${chalk.gray('branch')} ${active.branchName}`);
      console.log();
    } else {
      console.log(`  ${chalk.gray('No active worktree — agents run in the main tree.')}`);
      console.log();
    }
    const rows: [string, string][] = [
      ['/worktree enter [name]', 'Create isolated branch + worktree (default: session)'],
      ['/worktree merge',          'Merge worktree branch into main and exit'],
      ['/worktree discard',        'Remove worktree without merging'],
      ['/worktree clean [--all]',  'Remove stale .koda worktrees (add --all for .claude too)'],
      ['/worktree list',           'Show all git worktrees'],
      ['/worktree status',         'Show this help'],
    ];
    for (const [cmd, desc] of rows) {
      console.log(`  ${chalk.cyan(cmd.padEnd(26))} ${chalk.gray(desc)}`);
    }
  }

  renderWorktreeEntered(active: NonNullable<HeaderContext['worktree']>): void {
    console.log();
    console.log(`  ${L.WORKTREE}${chalk.green('entered')} ${chalk.white(shortenPath(active.worktreePath))}`);
    console.log(`         ${chalk.gray('branch')} ${active.branchName}`);
    console.log(`  ${chalk.gray('Agents now run in the worktree. Merge or discard when done.')}`);
  }

  renderWorktreeMerged(active: NonNullable<HeaderContext['worktree']>): void {
    console.log();
    console.log(`  ${L.WORKTREE}${chalk.green('merged')} ${chalk.white(active.branchName)} → main`);
    console.log(`  ${chalk.gray('Back on main tree.')}`);
  }

  renderWorktreeDiscarded(active: NonNullable<HeaderContext['worktree']>): void {
    console.log();
    console.log(`  ${L.WORKTREE}${chalk.yellow('discarded')} ${chalk.white(active.branchName)}`);
    console.log(`  ${chalk.gray('Worktree removed — changes were not merged.')}`);
  }

  renderWorktreeList(
    entries: Array<{ path: string; branch: string; head: string }>,
    active: HeaderContext['worktree'] | null | undefined,
  ): void {
    console.log();
    console.log('  ' + chalk.bold('Git worktrees'));
    console.log();
    if (entries.length === 0) {
      console.log(chalk.gray('  (none)'));
      return;
    }
    for (const e of entries) {
      const isActive = active?.worktreePath === e.path;
      const mark = isActive ? chalk.green(' ●') : '  ';
      console.log(
        `${mark} ${chalk.cyan(shortenPath(e.path))} ${chalk.gray(e.branch || 'detached')}`,
      );
    }
  }

  /** Banner shown above prompt while in worktree mode. */
  renderWorktreePromptBanner(active: NonNullable<HeaderContext['worktree']>): void {
    console.log(
      chalk.magenta(`  WKTREE ${active.branchName}`) +
      chalk.gray(` · ${shortenPath(active.worktreePath)} · /worktree merge · discard`),
    );
  }

  renderWelcome(): void {
    // Welcome content is rendered inside renderHeader (Claude Code–style dashboard).
  }

  renderPrompt(hint = 'Try "explain src/auth.ts"'): void {
    this.clearSlashMenu();
    if (hint) {
      console.log(chalk.gray(`  ${hint}`));
    }
    process.stdout.write(chalk.cyan('> '));
  }

  /** Live slash-command picker (Claude Code–style) — pass [] to clear. */
  renderSlashMenu(commands: SlashCommandDef[], selectedIndex = 0): void {
    if (this._slashMenuLines > 0) {
      process.stdout.write(`\x1b[${this._slashMenuLines}A\x1b[0J`);
      this._slashMenuLines = 0;
    }
    if (commands.length === 0) return;

    const VISIBLE = 12;
    let start = 0;
    if (commands.length > VISIBLE) {
      start = Math.max(0, Math.min(selectedIndex - 4, commands.length - VISIBLE));
    }
    const end = Math.min(commands.length, start + VISIBLE);
    const window = commands.slice(start, end);

    const lines: string[] = [''];
    if (start > 0) {
      lines.push(chalk.gray(`  ↑ ${start} more above`));
    }
    for (let i = 0; i < window.length; i++) {
      const globalIndex = start + i;
      const { name, description, wip } = window[i]!;
      const active = globalIndex === selectedIndex;
      const namePadded = name.padEnd(16);
      const desc = wip ? `${description} wip` : description;

      if (active) {
        // High-contrast row — visible on dark and light terminals (not plain white/black text)
        lines.push('  ' + chalk.bgCyan.black.bold(`› ${namePadded} ${desc}`));
      } else {
        lines.push(`    ${chalk.cyan(namePadded)} ${chalk.gray(desc)}`);
      }
    }
    if (end < commands.length) {
      lines.push(chalk.gray(`  ↓ ${commands.length - end} more below`));
    }
    lines.push(chalk.gray('  ↑↓ select · Tab or Enter apply'));
    console.log(lines.join('\n'));
    this._slashMenuLines = lines.length;
  }

  clearSlashMenu(): void {
    this.renderSlashMenu([]);
  }

  // ── Spinner with live elapsed timer ──────────────────────────────────────

  renderThinking(label = 'thinking'): Ora {
    this._stopTimer();
    this.timerSeconds = 0;
    this.timerLabel = label;

    this.spinner = ora({
      text: `${label} (0s)`,
      prefixText: '  ',
      color: 'cyan',
    }).start();

    this.timerInterval = setInterval(() => {
      this.timerSeconds++;
      if (this.spinner?.isSpinning) {
        this.spinner.text = `${this.timerLabel} (${this.timerSeconds}s)`;
      }
    }, 1000);

    return this.spinner;
  }

  renderStage(raw: string): void {
    const { label, detail } = parseStage(raw);
    const text = detail ? `${label.trim()} ${detail}` : label.trim();
    this._updateActivity(text);
  }

  /** Human-readable one-liner for the live activity spinner. */
  private _activityDetail(raw: string): string {
    if (raw.startsWith('READ '))       return `Reading ${raw.slice(5)}`;
    if (raw.startsWith('SEARCH '))     return `Searching ${raw.slice(7)}`;
    if (raw.startsWith('WRITE '))      return `Writing ${raw.slice(6)}`;
    if (raw.startsWith('RUN '))        return `Running ${raw.slice(4)}`;
    if (raw.startsWith('GIT '))        return `Git ${raw.slice(4)}`;
    if (raw.startsWith('PLAN '))       return raw.slice(5);
    if (raw.startsWith('INFO Step '))  return raw.slice(5);
    if (raw.startsWith('INFO '))       return raw.slice(5);
    if (raw.startsWith('WORKTREE '))   return raw.slice(9);
    const { detail } = parseStage(raw);
    return detail || raw;
  }

  /** Keep a single Claude Code–style activity line that updates in place. */
  private _updateActivity(detail: string): void {
    this.timerLabel = detail;
    if (this.spinner?.isSpinning) {
      this.spinner.text = `${detail} (${this.timerSeconds}s)`;
      return;
    }
    this.renderThinking(detail);
  }

  stopSpinner(success = true, message?: string): void {
    this._stopTimer();
    if (!this.spinner) return;
    if (success) {
      message
        ? this.spinner.succeed(chalk.green(message))
        : this.spinner.stop();
    } else {
      this.spinner.fail(message ? chalk.red(message) : chalk.red('failed'));
    }
    this.spinner = null;
  }

  private _stopTimer(): void {
    if (this.timerInterval !== null) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  // ── Streaming output with markdown rendering ──────────────────────────────

  renderStreamChunk(chunk: string): void {
    if (this.spinner?.isSpinning) {
      this._stopTimer();
      this.spinner.stop();
      this.spinner = null;
      console.log();
    }
    process.stdout.write(this._renderMarkdown(chunk));
  }

  private _renderMarkdown(text: string): string {
    const lines = text.split('\n');
    return lines
      .map((line, idx) => {
        const isLast = idx === lines.length - 1;
        return this._renderLine(line) + (isLast ? '' : '\n');
      })
      .join('');
  }

  private _renderLine(line: string): string {
    // Code fence toggle
    if (line.trimStart().startsWith('```')) {
      this.inCodeBlock = !this.inCodeBlock;
      return '  ' + chalk.gray('─'.repeat(44));
    }
    if (this.inCodeBlock) {
      return '  ' + chalk.cyan(line);
    }
    // Headers
    if (line.startsWith('### ')) return '  ' + chalk.bold(line.slice(4));
    if (line.startsWith('## '))  return '  ' + chalk.bold.white(line.slice(3));
    if (line.startsWith('# '))   return '  ' + chalk.bold.white(line.slice(2));
    // Bullets
    if (/^(\s*)([-*])\s/.test(line)) {
      return line.replace(/^(\s*)([-*])\s/, (_m, sp: string) => `${sp}  ${chalk.cyan('•')} `);
    }
    // Inline formatting
    line = line.replace(/`([^`]+)`/g, (_m, c: string) => chalk.cyan(c));
    line = line.replace(/\*\*([^*]+)\*\*/g, (_m, t: string) => chalk.bold(t));
    line = line.replace(/\*([^*]+)\*/g, (_m, t: string) => chalk.italic(t));
    return line ? '  ' + line : '';
  }

  renderStreamEnd(): void {
    this.inCodeBlock = false;
    console.log('\n');
  }

  /** Write a one-line stage/operation message. Updates the activity spinner in quiet mode. */
  stream(raw: string): void {
    const quiet  = !this._streamVerbose && isQuietStage(raw);
    const detail = this._activityDetail(raw);

    if (quiet) {
      this._updateActivity(detail);
      return;
    }

    this._updateActivity(detail);
    const { label, detail: stageDetail } = parseStage(raw);
    process.stdout.write(`  ${label} ${chalk.gray(stageDetail)}\n`);
  }

  // ── Plan display ──────────────────────────────────────────────────────────

  renderPlan(steps: string[]): void {
    this.setLastPlan(steps);
    console.log();
    console.log(`  ${L.PLAN}`);
    console.log();
    steps.forEach((step, i) => {
      console.log(`  ${chalk.cyan(' →')} ${chalk.gray(String(i + 1) + '.')} ${step}`);
    });
    console.log();
  }

  // ── Structured execution plan display ────────────────────────────────────

  /**
   * Render a structured ExecutionPlan (from PlanningEngine).
   * Shows step numbers, descriptions, and wires up the PlanTracker for progress.
   */
  renderExecutionPlan(plan: ExecutionPlan): void {
    const steps = plan.steps.map((s: PlanStep) => s.description);
    this.setLastPlan(steps);
    this._planStepIndex = 0;
    if (this._streamVerbose) {
      this.planTracker.setSteps(steps);
    } else {
      this._updateActivity(`Planning · ${steps.length} steps`);
    }
  }

  /**
   * Advance the plan tracker to the next step.
   * Call this after each step completes.
   */
  advancePlan(): void {
    if (!this._streamVerbose) {
      this._planStepIndex++;
      if (this._planSteps.length > 0) {
        const step = this._planSteps[this._planStepIndex - 1];
        const label = step
          ? `Step ${this._planStepIndex}/${this._planSteps.length}: ${step}`
          : `Step ${this._planStepIndex}/${this._planSteps.length}`;
        this._updateActivity(label);
      }
      return;
    }
    this.planTracker.advance();
  }

  // ── DAG Visualizer API ────────────────────────────────────────────────────

  /** Initialise the live DAG panel with all nodes in pending state. */
  dagStart(nodes: Array<{ id: string; description: string }>): void {
    this.dagVisualizer.setNodes(nodes);
  }

  dagNodeStart(nodeId: string): void {
    this.dagVisualizer.nodeStart(nodeId);
  }

  dagNodeDone(nodeId: string, durationMs: number): void {
    this.dagVisualizer.nodeDone(nodeId, durationMs);
  }

  dagNodeFailed(nodeId: string): void {
    this.dagVisualizer.nodeFailed(nodeId);
  }

  // ── Diff preview ──────────────────────────────────────────────────────────

  /**
   * Render a diff between old and new content with a header line.
   * Used before write operations so users can see exactly what will change.
   */
  renderDiffPreview(filePath: string, oldContent: string, newContent: string): void {
    console.log();
    console.log(`  ${L.WRITE} ${chalk.bold(filePath)}`);
    console.log();
    const diff = simpleDiff(oldContent, newContent, filePath);
    diff.split('\n').forEach((line) => console.log('  ' + line));
    console.log();
  }

  // ── Smart input suggestions ───────────────────────────────────────────────

  /**
   * Show 2–4 contextual action hints above the prompt.
   * Displayed as: "  → fix the failing test" in gray/cyan.
   */
  renderSmartSuggestions(suggestions: string[]): void {
    if (suggestions.length === 0) return;
    console.log();
    for (const s of suggestions) {
      console.log(`  ${chalk.gray('→')} ${chalk.gray(s)}`);
    }
  }

  // ── Unified completion summary ────────────────────────────────────────────

  /**
   * Render a compact one-line completion summary that works for all three
   * routing paths (SIMPLE / MEDIUM / COMPLEX).
   */
  renderCompletionSummary(opts: {
    status:     'ok' | 'failed';
    stepsOrNodes: number;
    toolCalls:  number;
    durationMs: number;
    filesChanged: string[];
  }): void {
    const icon    = opts.status === 'ok' ? chalk.green('✔') : chalk.red('✗');
    const secs    = (opts.durationMs / 1000).toFixed(1) + 's';
    const steps   = opts.stepsOrNodes;
    const tools   = opts.toolCalls;
    const files   = opts.filesChanged.length;

    console.log(
      `  ${icon} ${chalk.gray(`${steps} step${steps !== 1 ? 's' : ''} · ${tools} tool${tools !== 1 ? 's' : ''} · ${files} file${files !== 1 ? 's' : ''} changed · ${secs}`)}`,
    );

    if (opts.filesChanged.length > 0) {
      opts.filesChanged.slice(0, 6).forEach((f) => {
        console.log(`    ${chalk.gray('•')} ${chalk.cyan(f)}`);
      });
      if (opts.filesChanged.length > 6) {
        console.log(`    ${chalk.gray(`… ${opts.filesChanged.length - 6} more`)}`);
      }
    }

    console.log();
  }

  /**
   * Render the full execution summary after a MEDIUM-path feature run.
   */
  renderFeatureExecutionSummary(
    metrics: Omit<ExecutionMetrics, 'verificationStatus'> & { verificationStatus: string },
  ): void {
    if (!this._streamVerbose) {
      const ver = metrics.verificationStatus === 'PASSED' ? chalk.green('✔') : chalk.red('✗');
      console.log(
        `  ${ver} ${chalk.gray(`${metrics.stepsExecuted} steps · ${metrics.totalToolCalls} tools · ${metrics.verificationStatus.toLowerCase()}`)}`,
      );
      console.log();
      return;
    }

    const verColor =
      metrics.verificationStatus === 'PASSED' ? chalk.green : chalk.red;

    console.log();
    console.log('  ' + chalk.bold('Execution Summary'));
    console.log();
    console.log(
      `  ${chalk.gray('Steps executed:')} ${chalk.white(String(metrics.stepsExecuted))}`,
    );
    console.log(
      `  ${chalk.gray('Files modified:')} ${chalk.white(String(metrics.filesModified.length))}`,
    );
    console.log(
      `  ${chalk.gray('Tools used:')}    ${chalk.white(String(metrics.totalToolCalls))}`,
    );
    console.log(
      `  ${chalk.gray('Verification:')}  ${verColor(metrics.verificationStatus)}`,
    );
    console.log();

    if (metrics.filesModified.length > 0) {
      console.log(`  ${L.WRITE} ${chalk.gray(metrics.filesModified.join(', '))}`);
      console.log();
    }
  }

  // ── Context visibility ────────────────────────────────────────────────────

  renderContext(files: string[], tokens: number): void {
    if (!this._streamVerbose) return;
    if (files.length === 0) return;
    console.log();
    console.log(`  ${L.CONTEXT}`);
    files.forEach(f => console.log(`  ${chalk.gray('  ' + f)}`));
    console.log(
      `  ${chalk.gray('  ' + files.length + ' file' + (files.length !== 1 ? 's' : '') + ' · ' + tokens + ' tokens')}`,
    );
    console.log();
  }

  // ── Execution timeline ────────────────────────────────────────────────────

  renderTimeline(entries: Array<{ name: string; durationMs: number }>): void {
    if (entries.length === 0) return;
    if (!this._streamVerbose) return;
    console.log();
    console.log('  ' + chalk.gray('Execution timeline:'));
    console.log();
    const parts = entries.map(e => {
      const secs = (e.durationMs / 1000).toFixed(1) + 's';
      return chalk.gray('[') + chalk.cyan(e.name + ' ' + secs) + chalk.gray(']');
    });
    console.log('  ' + parts.join(' '));
    console.log();
  }

  // ── Patch preview (multi-file change summary) ─────────────────────────────

  renderPatchPreview(patches: FilePatch[]): void {
    console.log();
    console.log('  ' + chalk.bold('About to modify:'));
    console.log();
    for (const patch of patches) {
      let added = 0;
      let removed = 0;
      for (const hunk of patch.hunks) {
        for (const line of hunk.lines) {
          if (line.startsWith('+')) added++;
          else if (line.startsWith('-')) removed++;
        }
      }
      const a = chalk.green('+' + added);
      const r = chalk.red('-' + removed);
      console.log(`  ${chalk.white(patch.filePath.padEnd(44))} ${a}  ${r}`);
    }
    console.log();
  }

  // ── Execution summary ─────────────────────────────────────────────────────

  renderExecutionSummary(metrics: ChatMetrics): void {
    this._stopTimer();
    if (this.spinner?.isSpinning) {
      this.spinner.stop();
      this.spinner = null;
    }
    const tokensK = metrics.tokens >= 1000
      ? (metrics.tokens / 1000).toFixed(0) + 'k'
      : String(metrics.tokens);
    const refPct  = metrics.toolResultsTotal > 0
      ? ` · ${Math.round(metrics.refRate * 100)}% refs`
      : '';
    console.log(
      `  ${L.OK} ${chalk.gray(metrics.tools + ' tool' + (metrics.tools !== 1 ? 's' : '') + ' · ' + tokensK + ' tokens' + refPct + ' · ' + metrics.duration + 's')}`,
    );
    console.log(`  ${chalk.gray('Total execution time:')} ${chalk.white(metrics.duration + 's')}`);
    console.log();
  }

  renderMeta(filesAnalyzed: string[], chunksUsed: number, truncated: boolean): void {
    console.log('  ' + chalk.gray('─'.repeat(60)));
    console.log(
      chalk.gray(`  files: ${filesAnalyzed.length}`) +
      chalk.gray(`   chunks: ${chunksUsed}`) +
      (truncated ? '   ' + chalk.yellow('WARN context truncated') : ''),
    );
    console.log();
  }

  // ── Error / Info / Success / Warn ─────────────────────────────────────────

  renderError(message: string, suggestion?: string): void {
    this._stopTimer();
    if (this.spinner?.isSpinning) {
      this.spinner.stop();
      this.spinner = null;
    }
    console.log();
    console.log(`  ${L.ERROR} ${message}`);
    if (suggestion) {
      console.log(`  ${chalk.gray('         ' + suggestion)}`);
    }
    console.log();
  }

  renderInfo(message: string): void {
    console.log(`  ${L.INFO} ${chalk.gray(message)}`);
  }

  renderSuccess(message: string): void {
    console.log(`  ${L.OK} ${message}`);
    console.log();
  }

  renderWarn(message: string): void {
    console.log(`  ${L.WARN} ${message}`);
  }

  renderBudgetWarning(pct: number): void {
    this.renderWarn(`Token budget ${pct}% used — responses may shorten`);
  }

  renderCompressionNotice(): void {
    this.renderInfo('Compressing conversation history');
  }

  renderCompressionDone(): void {
    this.renderWarn('Context compressed — older messages summarized');
  }

  // ── Help ──────────────────────────────────────────────────────────────────

  renderHelp(): void {
    console.log();
    console.log('  ' + chalk.bold('Natural language (just type):'));
    console.log();
    const cmds: [string, string][] = [
      ['explain <file|symbol>', 'Understand code in the repository'],
      ['fix <bug description>',   'Find root cause, patch, run tests'],
      ['add <feature>',           'Plan, implement, and verify'],
      ['refactor <path>',         'Improve code safely'],
      ['run tests',               'Execute test suite and report'],
      ['status',                  'Repository and index status'],
    ];
    for (const [cmd, desc] of cmds) {
      console.log(`  ${chalk.cyan(cmd.padEnd(26))} ${chalk.gray(desc)}`);
    }
    console.log();
    console.log('  ' + chalk.bold('Slash commands:'));
    console.log();

    const categoryOrder: SlashCommandCategory[] = [
      'help', 'session', 'context', 'git', 'tools', 'config', 'mcp', 'skills', 'platform',
    ];
    const byCategory = getCommandsByCategory();

    for (const category of categoryOrder) {
      const commands = byCategory.get(category);
      if (!commands?.length) continue;

      console.log(`  ${chalk.bold(SLASH_CATEGORY_LABELS[category])}`);
      for (const { name, description, wip } of commands) {
        const tag = wip ? chalk.yellow(' [wip]') : '';
        console.log(`    ${chalk.cyan(name.padEnd(22))}${tag} ${chalk.gray(description)}`);
      }
      console.log();
    }
    console.log('  ' + chalk.bold('CLI shortcuts (outside session):'));
    console.log();
    console.log(`  ${chalk.cyan('koda fix "<bug>"'.padEnd(26))} ${chalk.gray('One-shot autonomous fix')}`);
    console.log(`  ${chalk.cyan('koda add "<feature>"'.padEnd(26))} ${chalk.gray('One-shot feature build')}`);
    console.log(`  ${chalk.cyan('koda init'.padEnd(26))} ${chalk.gray('Index repository')}`);
    console.log(`  ${chalk.cyan('koda mcp list'.padEnd(26))} ${chalk.gray('Manage MCP servers')}`);
    console.log();
    console.log(`  ${chalk.gray('Commands marked')} ${chalk.yellow('[wip]')} ${chalk.gray('show guidance only or are not fully implemented yet.')}`);
    console.log();
  }

  renderSetupHeader(): void {
    console.log();
    console.log(chalk.bold('  Koda Setup'));
    console.log(chalk.gray('  Configure Azure, OpenAI, Anthropic, or Ollama'));
    console.log();
  }

  renderDivider(): void {
    console.log('  ' + chalk.gray('─'.repeat(60)));
  }

  // ── Slash command introspection ───────────────────────────────────────────

  slashContext(): void {
    if (this._contextFiles.length === 0) {
      this.renderInfo('No context retrieved yet — ask a question first.');
      return;
    }
    console.log();
    console.log(`  ${L.CONTEXT}`);
    this._contextFiles.forEach(f => console.log(`  ${chalk.gray('  ' + f)}`));
    console.log(`  ${chalk.gray('  ' + this._contextFiles.length + ' files · ' + this._contextTokens + ' tokens')}`);
    console.log();
  }

  slashTools(): void {
    const entries = Object.entries(this._toolUsage);
    if (entries.length === 0) {
      this.renderInfo('No tools used yet.');
      return;
    }
    console.log();
    console.log(`  ${L.TOOLS}`);
    entries.forEach(([tool, count]) => {
      console.log(`  ${chalk.gray(tool.padEnd(26))} x${count}`);
    });
    console.log();
  }

  slashPlan(): void {
    if (this._planSteps.length === 0) {
      this.renderInfo('No plan generated in this session.');
      return;
    }
    console.log();
    console.log(`  ${L.PLAN}`);
    console.log();
    this._planSteps.forEach((step, i) => {
      console.log(`  ${chalk.gray(String(i + 1) + '.')} ${step}`);
    });
    console.log();
  }

  slashBudget(budgetMax = 50_000): void {
    this.slashEfficiency(undefined, budgetMax);
  }

  slashEfficiency(
    productMetrics?: import('../../product/metrics.js').ProductMetrics | null,
    budgetMax = 50_000,
  ): void {
    const sm   = this._sessionMetrics;
    const used = sm.tokens > 0 ? sm.tokens : this._tokensUsed;
    const pct  = budgetMax > 0 ? Math.round((used / budgetMax) * 100) : 0;
    const usedStr = used >= 1000 ? (used / 1000).toFixed(1) + 'k' : String(used);
    const maxStr  = budgetMax >= 1000 ? (budgetMax / 1000).toFixed(0) + 'k' : String(budgetMax);
    const color   = pct > 80 ? chalk.red : pct > 50 ? chalk.yellow : chalk.green;
    const refPct  = sm.toolResultsTotal > 0 ? Math.round(sm.refRate * 100) : 0;

    console.log();
    console.log(`  ${chalk.bold('EFFICIENCY')}`);
    console.log(`  ${color(pct + '%').padEnd(8)} ${usedStr} / ${maxStr} session tokens`);
    if (refPct > 0) {
      console.log(`  ${chalk.gray('Ref rate:')}     ${refPct}% via references`);
    }
    if (sm.promptTokens > 0) {
      console.log(`  ${chalk.gray('Prompt:')}       ${sm.promptTokens.toLocaleString()} · Completion: ${sm.completionTokens.toLocaleString()}`);
    }
    if (productMetrics) {
      console.log();
      console.log(chalk.gray(productMetrics.formatEfficiencyReport(used, sm.refRate)));
    }
    console.log();
  }

  slashTimeline(): void {
    this.renderTimeline(this._timeline);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatIndexStatus(status: HeaderContext['indexStatus']): string {
  switch (status) {
    case 'ready':   return chalk.green('ready');
    case 'missing': return chalk.red('not indexed');
    case 'stale':   return chalk.yellow('stale');
  }
}
