/**
 * koda feedback
 *
 * Part 5 — Feedback loop (launch mission).
 *
 * Collects structured user feedback after a task:
 *   - Did it work? (y/n)
 *   - What confused or broke?
 *   - Which command was running?
 *
 * Saved to `.koda/feedback.json` for aggregation.
 * Also offers a GitHub Issues URL pre-filled with context.
 *
 * Usage:
 *   koda feedback                    # interactive prompt
 *   koda feedback --task fix         # pre-fill the last command
 *   koda feedback --worked           # quick "it worked" signal
 *   koda feedback --broke "message"  # quick failure report
 */

import { Command } from 'commander';
import chalk from 'chalk';
import * as fs   from 'node:fs/promises';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { ProductMetrics } from '../../product/metrics.js';

// ── Constants ──────────────────────────────────────────────────────────────────

const FEEDBACK_FILE   = path.join('.koda', 'feedback.json');
const ISSUES_URL      = 'https://github.com/varunbiluri/koda/issues/new?template=bug_report.md';
const MAX_FEEDBACK    = 500;

// ── Types ──────────────────────────────────────────────────────────────────────

interface FeedbackEntry {
  at:          string;    // ISO timestamp
  worked:      boolean;
  task?:       string;    // command used (fix / add / auto / …)
  description: string;   // what the user said
  version?:    string;   // koda version at feedback time
}

interface FeedbackStore {
  version: number;
  entries: FeedbackEntry[];
}

// ── Command ────────────────────────────────────────────────────────────────────

export function createFeedbackCommand(): Command {
  return new Command('feedback')
    .description('Share feedback — what worked, what broke, what confused you')
    .option('--worked',           'Quick signal: task completed successfully')
    .option('--broke <message>',  'Quick signal: describe what broke')
    .option('--task <command>',   'Which command were you running? (fix/add/auto/…)')
    .option('--open-issue',       'Open a GitHub issue (opens browser)')
    .action(async (options: {
      worked?:    boolean;
      broke?:     string;
      task?:      string;
      openIssue?: boolean;
    }) => {
      const rootPath = process.cwd();

      console.log();
      console.log(chalk.bold.blue('💬 Koda Feedback'));
      console.log(chalk.gray('   Your feedback directly shapes what gets fixed next.\n'));

      // ── Quick flags ─────────────────────────────────────────────────────────
      if (options.worked) {
        await _save(rootPath, { worked: true, description: '(quick signal: worked)', task: options.task });
        console.log(chalk.green('✓ Logged — thank you!\n'));
        return;
      }

      if (options.broke) {
        await _save(rootPath, { worked: false, description: options.broke, task: options.task });
        console.log(chalk.green('✓ Logged — thank you!\n'));
        _printIssueLink(options.broke, options.task);
        return;
      }

      if (options.openIssue) {
        console.log(chalk.cyan(`  Open this URL to file a GitHub issue:\n  ${ISSUES_URL}\n`));
        return;
      }

      // ── Interactive prompt ──────────────────────────────────────────────────
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const ask = (q: string): Promise<string> =>
        new Promise((r) => rl.question(q, r));

      try {
        const workedRaw = await ask(chalk.bold('  Did Koda complete the task? ') + chalk.gray('(y/n): '));
        const worked    = workedRaw.trim().toLowerCase().startsWith('y');

        let task = options.task;
        if (!task) {
          const taskRaw = await ask(chalk.bold('  Which command? ') + chalk.gray('(fix/add/auto/ask/other): '));
          task = taskRaw.trim() || 'other';
        }

        const prompt = worked
          ? chalk.bold('  What went well, or what could be smoother? ') + chalk.gray('(Enter to skip): ')
          : chalk.bold('  What broke or confused you? ') + chalk.gray('(be specific): ');
        const description = (await ask(prompt)).trim();

        if (!description && !worked) {
          console.log(chalk.yellow('\n  ⚠ No description provided — feedback not saved.\n'));
          rl.close();
          return;
        }

        await _save(rootPath, { worked, description: description || '(no description)', task });

        console.log();
        console.log(chalk.green('✓ Feedback saved to .koda/feedback.json'));

        if (!worked && description) {
          _printIssueLink(description, task);
        }

        // Show metrics context
        try {
          const metrics  = await ProductMetrics.load(rootPath);
          const oneliner = metrics.formatOneLiner();
          if (oneliner) console.log(chalk.gray(`\n  Your session: ${oneliner}`));
        } catch { /* non-fatal */ }

        console.log();
      } finally {
        rl.close();
      }
    });
}

// ── Helpers ────────────────────────────────────────────────────────────────────

async function _save(
  rootPath: string,
  opts: { worked: boolean; description: string; task?: string },
): Promise<void> {
  const file = path.join(rootPath, FEEDBACK_FILE);
  let store: FeedbackStore = { version: 1, entries: [] };

  try {
    const raw = await fs.readFile(file, 'utf8');
    store     = JSON.parse(raw);
  } catch { /* first run */ }

  const entry: FeedbackEntry = {
    at:          new Date().toISOString(),
    worked:      opts.worked,
    task:        opts.task,
    description: opts.description.slice(0, 1_000),
  };

  store.entries.unshift(entry);
  if (store.entries.length > MAX_FEEDBACK) {
    store.entries = store.entries.slice(0, MAX_FEEDBACK);
  }

  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(store, null, 2), 'utf8');
}

function _printIssueLink(description: string, task?: string): void {
  const body  = encodeURIComponent(
    `**Task:** \`koda ${task ?? ''}\`\n\n**What happened:**\n${description}\n\n**Steps to reproduce:**\n\n1. \n\n**Expected behaviour:**\n\n`,
  );
  const url   = `${ISSUES_URL}&body=${body}`;
  const short = url.length > 120 ? ISSUES_URL : url;
  console.log(chalk.gray(`\n  File a GitHub issue:\n  ${chalk.cyan(short)}\n`));
}
