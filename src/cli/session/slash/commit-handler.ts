/**
 * /commit slash command — staged diff → AI commit message → ASK approval → git commit.
 */

import { execSync } from 'node:child_process';
import chalk from 'chalk';
import type { UIRenderer } from '../ui-renderer.js';
import { configExists, loadConfig } from '../../../ai/config-store.js';
import { createProvider } from '../../../ai/providers/provider-factory.js';
import { gitCommit } from '../../../tools/git-tools.js';
import { permissionGate } from '../../../runtime/permission-gate.js';

const MAX_DIFF_CHARS = 12_000;
const DIFF_PREVIEW_LINES = 40;

export interface SlashCommitOptions {
  rootPath:    string;
  ui:          UIRenderer;
  /** Optional message from `/commit your message here` — skips LLM generation. */
  userMessage?: string;
}

/**
 * Execute a git command in the given repository directory and return its trimmed standard output.
 *
 * @param rootPath - Path to the Git repository to run the command in
 * @param args - Arguments to pass to the `git` command (e.g., `diff --staged`)
 * @returns The command's stdout with leading and trailing whitespace removed
 */
function gitExec(rootPath: string, args: string): string {
  return execSync(`git ${args}`, {
    cwd: rootPath,
    stdio: ['pipe', 'pipe', 'pipe'],
    encoding: 'utf-8',
  }).trim();
}

/**
 * Truncates a diff string to a maximum length and appends a clear truncation marker when truncated.
 *
 * @param diff - The diff text to truncate
 * @param maxChars - Maximum allowed characters for the returned diff (defaults to the module's max)
 * @returns The original `diff` if its length is within `maxChars`, otherwise the first `maxChars` characters followed by a truncation notice
 */
export function truncateDiff(diff: string, maxChars = MAX_DIFF_CHARS): string {
  if (diff.length <= maxChars) return diff;
  return `${diff.slice(0, maxChars)}\n\n... (diff truncated for LLM)`;
}

/**
 * Clean and normalize a raw commit message string.
 *
 * Removes surrounding fenced code blocks (triple backticks) and surrounding single or double quotes, and trims leading/trailing whitespace.
 *
 * @internal exported for tests
 * @param raw - The raw commit message text to sanitize (may include code fences or surrounding quotes)
 * @returns The sanitized commit message
 */
export function sanitizeCommitMessage(raw: string): string {
  let msg = raw.trim();
  if (msg.startsWith('```')) {
    msg = msg.replace(/^```[^\n]*\n?/, '').replace(/\n?```$/, '').trim();
  }
  // Drop surrounding quotes some models add
  if (
    (msg.startsWith('"') && msg.endsWith('"')) ||
    (msg.startsWith("'") && msg.endsWith("'"))
  ) {
    msg = msg.slice(1, -1).trim();
  }
  return msg;
}

/**
 * Produce a git commit message for the given staged diff using the configured AI provider.
 *
 * The staged diff is truncated if it exceeds the configured limit; the AI response is sanitized
 * to remove fences and surrounding quotes before being returned.
 *
 * @param stagedDiff - The full staged diff text to base the commit message on
 * @returns The sanitized commit message (subject line, optionally with a body after a blank line)
 * @throws Error if the model returns an empty commit message
 * @internal exported for tests
 */
export async function generateCommitMessage(stagedDiff: string): Promise<string> {
  const provider = createProvider(await loadConfig());
  const truncated = truncateDiff(stagedDiff);

  const response = await provider.sendChatCompletion({
    messages: [
      {
        role:    'system',
        content:
          'You write git commit messages. Follow conventional commits when appropriate. ' +
          'Reply with ONLY the commit message text (subject line; optional body after a blank line). ' +
          'No markdown, no quotes, no explanation.',
      },
      {
        role:    'user',
        content: `Write a concise git commit message for this staged diff:\n\n${truncated}`,
      },
    ],
    temperature: 0.2,
    max_tokens:  300,
  });

  const raw = response.choices[0]?.message?.content ?? '';
  const message = sanitizeCommitMessage(raw);
  if (!message) {
    throw new Error('Model returned an empty commit message');
  }
  return message;
}

/**
 * Orchestrates the interactive /commit flow: collects the staged diff, obtains a commit message
 * (from the user or by generating one from the staged diff), shows staged files and a diff preview,
 * requests user approval, and performs the git commit.
 *
 * @param opts - Options including the repository root path, a UI renderer, and an optional
 *               user-supplied commit message that bypasses AI generation
 */
export async function runSlashCommit(opts: SlashCommitOptions): Promise<void> {
  const { rootPath, ui, userMessage } = opts;

  let stagedDiff: string;
  let nameStatus: string;

  try {
    stagedDiff = gitExec(rootPath, 'diff --staged');
    nameStatus = gitExec(rootPath, 'diff --staged --name-status');
  } catch {
    ui.renderError('Git not available in this directory.');
    console.log();
    return;
  }

  if (!stagedDiff) {
    ui.renderInfo('Nothing staged. Stage files first, then run /commit again.');
    console.log(chalk.gray('  git add <file>   or ask Koda to stage changes'));
    try {
      const status = gitExec(rootPath, 'status --short');
      if (status) {
        console.log();
        console.log(chalk.gray(status.split('\n').map((l) => `  ${l}`).join('\n')));
      }
    } catch {
      // ignore
    }
    console.log();
    return;
  }

  let message: string;

  if (userMessage?.trim()) {
    message = sanitizeCommitMessage(userMessage);
  } else if (await configExists()) {
    console.log();
    const spinner = ui.renderThinking();
    spinner.text = 'Generating commit message from staged diff…';
    try {
      message = await generateCommitMessage(stagedDiff);
      ui.stopSpinner(true);
    } catch (err) {
      ui.stopSpinner(false, 'Could not generate commit message');
      ui.renderError((err as Error).message, 'Run /login or pass a message: /commit your message here');
      console.log();
      return;
    }
  } else {
    ui.renderError(
      'AI not configured — cannot generate a commit message.',
      'Run /login, or pass one: /commit your message here',
    );
    console.log();
    return;
  }

  // Show proposal
  console.log();
  console.log(chalk.bold('  Proposed commit'));
  console.log();
  console.log(chalk.cyan(message.split('\n').map((l) => `  ${l}`).join('\n')));
  console.log();
  console.log(chalk.bold('  Staged files'));
  console.log(chalk.gray(nameStatus.split('\n').map((l) => `  ${l}`).join('\n')));
  console.log();

  const diffLines = stagedDiff.split('\n');
  const preview = diffLines.slice(0, DIFF_PREVIEW_LINES).join('\n');
  console.log(chalk.bold('  Staged diff preview'));
  console.log(chalk.gray(preview.split('\n').map((l) => `  ${l}`).join('\n')));
  if (diffLines.length > DIFF_PREVIEW_LINES) {
    console.log(chalk.gray(`  … ${diffLines.length - DIFF_PREVIEW_LINES} more lines`));
  }
  console.log();

  const approved = await permissionGate.requestApproval(
    'git_commit',
    `Commit message:\n  ${message.split('\n').join('\n  ')}`,
  );

  if (!approved) {
    ui.renderInfo('Commit cancelled.');
    console.log();
    return;
  }

  const result = await gitCommit(message, rootPath);
  if (!result.success) {
    ui.renderError(result.error ?? 'git commit failed');
    console.log();
    return;
  }

  ui.renderSuccess('Committed successfully.');
  if (result.data) {
    console.log(chalk.gray(`  ${result.data.trim().split('\n')[0]}`));
  }
  console.log();
}
