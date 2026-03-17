import chalk from 'chalk';
import ora, { type Ora } from 'ora';
import type { FilePatch } from '../../patch/types.js';
import type { ChatMetrics } from '../../ai/reasoning/reasoning-engine.js';
import type { ExecutionPlan, PlanStep } from '../../ai/reasoning/planning-engine.js';
import type { ExecutionMetrics } from '../../execution/plan-executor.js';

export interface HeaderContext {
  repoName: string;
  branch: string;
  indexStatus: 'ready' | 'missing' | 'stale';
  model: string;
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
  private _timeline: Array<{ name: string; durationMs: number }> = [];

  readonly planTracker = new PlanTracker();

  // Called by conversation-engine after each chat() response
  updateContext(files: string[], tokens: number): void {
    this._contextFiles = files;
    this._contextTokens = tokens;
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

  setTimeline(entries: Array<{ name: string; durationMs: number }>): void {
    this._timeline = entries;
  }

  get tokensUsed(): number { return this._tokensUsed; }

  resetSessionState(): void {
    this._contextFiles = [];
    this._contextTokens = 0;
    this._toolUsage = {};
    this._planSteps = [];
    this._tokensUsed = 0;
    this._timeline = [];
    this.planTracker.reset();
  }

  // ── Header ────────────────────────────────────────────────────────────────

  renderHeader(ctx: HeaderContext): void {
    console.log();
    console.log(chalk.bold('  Koda') + chalk.gray(' — AI Software Engineer'));
    console.log(chalk.gray('  v0.1.1'));
    console.log();
    console.log(
      chalk.gray('  repo   ') + chalk.white(ctx.repoName) +
      chalk.gray('   branch  ') + chalk.white(ctx.branch),
    );
    console.log(
      chalk.gray('  index  ') + formatIndexStatus(ctx.indexStatus) +
      chalk.gray('   model   ') + chalk.white(ctx.model),
    );
    console.log();
  }

  renderWelcome(question = 'What would you like to build?'): void {
    console.log(chalk.gray('  ' + question));
    console.log();
  }

  renderPrompt(): void {
    process.stdout.write(chalk.cyan('  > '));
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
    const text = `${label.trim()} ${detail}`;
    if (this.spinner?.isSpinning) {
      this.spinner.text = text;
    } else {
      process.stdout.write(`  ${label} ${chalk.gray(detail)}\n`);
    }
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

  /** Write a one-line stage/operation message. Stops spinner first. */
  stream(raw: string): void {
    this._stopTimer();
    if (this.spinner?.isSpinning) {
      this.spinner.stop();
      this.spinner = null;
      console.log();
    }
    const { label, detail } = parseStage(raw);
    process.stdout.write(`  ${label} ${chalk.gray(detail)}\n`);
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
    this.planTracker.setSteps(steps);
  }

  /**
   * Advance the plan tracker to the next step.
   * Call this after each step completes.
   */
  advancePlan(): void {
    this.planTracker.advance();
  }

  /**
   * Render the full execution summary after a MEDIUM-path feature run.
   */
  renderFeatureExecutionSummary(
    metrics: Omit<ExecutionMetrics, 'verificationStatus'> & { verificationStatus: string },
  ): void {
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
    this.addTokens(metrics.tokens);
    const tokensK = metrics.tokens >= 1000
      ? (metrics.tokens / 1000).toFixed(0) + 'k'
      : String(metrics.tokens);
    console.log(
      `  ${L.OK} ${chalk.gray(metrics.tools + ' tool' + (metrics.tools !== 1 ? 's' : '') + ' · ' + tokensK + ' tokens · ' + metrics.duration + 's')}`,
    );
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
    console.log('  ' + chalk.bold('Natural language commands:'));
    console.log();
    const cmds: [string, string][] = [
      ['explain <symbol>',   'Understand code in the repository'],
      ['add <feature>',      'Build new functionality'],
      ['fix <issue>',        'Debug and fix problems'],
      ['refactor <target>',  'Improve code quality'],
      ['find <term>',        'Search the codebase'],
      ['status',             'Show repository and index status'],
      ['help',               'Show this message'],
      ['quit',               'Exit Koda'],
    ];
    for (const [cmd, desc] of cmds) {
      console.log(`  ${chalk.cyan(cmd.padEnd(22))} ${chalk.gray(desc)}`);
    }
    console.log();
    console.log('  ' + chalk.bold('Slash commands:'));
    console.log();
    const slash: [string, string][] = [
      ['/context',  'Files retrieved in last response'],
      ['/tools',    'Tools used this session'],
      ['/plan',     'Last generated execution plan'],
      ['/budget',   'Token usage for this session'],
      ['/history',  'Message count in current session'],
      ['/diff',     'Show pending git changes'],
      ['/clear',    'Clear the terminal screen'],
      ['/reset',    'Clear screen and session history'],
      ['/help',     'Show this message'],
    ];
    for (const [cmd, desc] of slash) {
      console.log(`  ${chalk.cyan(cmd.padEnd(22))} ${chalk.gray(desc)}`);
    }
    console.log();
  }

  renderSetupHeader(): void {
    console.log();
    console.log(chalk.bold('  Koda Setup'));
    console.log(chalk.gray('  Configure your Azure AI Foundry connection'));
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
    const used = this._tokensUsed;
    const pct = budgetMax > 0 ? Math.round((used / budgetMax) * 100) : 0;
    const usedStr = used >= 1000 ? (used / 1000).toFixed(1) + 'k' : String(used);
    const maxStr  = budgetMax >= 1000 ? (budgetMax / 1000).toFixed(0) + 'k' : String(budgetMax);
    const color = pct > 80 ? chalk.red : pct > 50 ? chalk.yellow : chalk.green;
    console.log();
    console.log(`  ${chalk.bold('BUDGET')}`);
    console.log(`  ${color(pct + '%').padEnd(8)} ${usedStr} / ${maxStr} tokens`);
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
