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

function gitExec(rootPath: string, args: string): string {
  return execSync(`git ${args}`, {
    cwd: rootPath,
    stdio: ['pipe', 'pipe', 'pipe'],
    encoding: 'utf-8',
  }).trim();
}

/** @internal exported for tests */
export function truncateDiff(diff: string, maxChars = MAX_DIFF_CHARS): string {
  if (diff.length <= maxChars) return diff;
  return `${diff.slice(0, maxChars)}\n\n... (diff truncated for LLM)`;
}

/** @internal exported for tests */
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

/** @internal exported for tests */
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
 * Run the /commit flow: staged diff → proposed message → approval → git commit.
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
    let unstaged = '';
    try {
      unstaged = gitExec(rootPath, 'status --porcelain');
    } catch {
      unstaged = '';
    }

    if (!unstaged) {
      ui.renderInfo('Nothing to commit — working tree clean.');
      console.log();
      return;
    }

    const fileCount = unstaged.split('\n').filter(Boolean).length;
    ui.renderInfo(`Nothing staged — ${fileCount} changed file(s).`);
    console.log(chalk.gray('  Will stage all changes (git add -A), then commit.'));
    console.log();
    console.log(chalk.gray(unstaged.split('\n').map((l) => `  ${l}`).join('\n')));
    console.log();

    const stageOk = await permissionGate.requestApproval(
      'git_add',
      'Stage all changes (git add -A)',
    );
    if (!stageOk) {
      ui.renderInfo('Commit cancelled.');
      console.log();
      return;
    }

    try {
      gitExec(rootPath, 'add -A');
      stagedDiff = gitExec(rootPath, 'diff --staged');
      nameStatus = gitExec(rootPath, 'diff --staged --name-status');
    } catch (err) {
      ui.renderError(`Could not stage changes: ${(err as Error).message}`);
      console.log();
      return;
    }

    if (!stagedDiff) {
      ui.renderError('Nothing staged after git add -A.');
      console.log();
      return;
    }
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
