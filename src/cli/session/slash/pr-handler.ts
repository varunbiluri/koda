/**
 * /pr and natural-language PR creation — fast path (no MEDIUM pipeline).
 *
 * Flow: branch check → draft PR text → show plan → push (if needed) → print PR URL.
 */

import { execSync } from 'node:child_process';
import chalk from 'chalk';
import type { UIRenderer } from '../ui-renderer.js';
import { VERSION } from '../../../constants.js';
import { configExists, loadConfig } from '../../../ai/config-store.js';
import { createProvider } from '../../../ai/providers/provider-factory.js';
import { gitPush } from '../../../tools/git-tools.js';
import { permissionGate } from '../../../runtime/permission-gate.js';
import { truncateDiff, sanitizeCommitMessage } from './commit-handler.js';

const PR_REQUEST_PATTERNS: RegExp[] = [
  /\b(create|open|make|submit|start|crate|need\s+to)\s+(a\s+)?(pull\s+request|pr)\b/i,
  /\bgh\s+pr\s+create\b/i,
  /\bcan\s+we\s+create\s+(a\s+)?pr\b/i,
  /\b(open|create)\s+(a\s+)?pr\b/i,
  /\bbranch\b.{0,24}\b(and|then)\b.{0,24}\b(create|open)\s+(a\s+)?(pr|pull\s+request)\b/i,
];

const BRANCH_STOP_WORDS = new Set([
  'for', 'to', 'and', 'the', 'a', 'an', 'creating', 'create', 'pr', 'pull', 'request',
  'new', 'branch', 'then', 'with', 'from', 'my', 'this', 'that', 'crearte', 'name', 'called', 'named',
]);

/** Branch setup only — not "open PR now". */
export function isBranchOnlyRequest(input: string): boolean {
  const t = input.trim();
  const mentionsBranch =
    /\b(create|make|crate|new)\b.*\bbranch\b/i.test(t) ||
    /\bbranch\b.*\b(for|to)\b/i.test(t);
  if (!mentionsBranch) return false;

  if (/\bbranch\b.{0,30}\b(and|then)\b.{0,30}\b(create|open)\s+(a\s+)?(pr|pull\s+request)\b/i.test(t)) {
    return false;
  }
  if (/\b(create|open|make|submit|start|crate|need\s+to)\s+(a\s+)?(pull\s+request|pr)\b/i.test(t) &&
      !/\bbranch\b\s+for\b/i.test(t)) {
    return false;
  }
  return true;
}

export function isPrRequest(input: string): boolean {
  if (isBranchOnlyRequest(input)) return false;
  return PR_REQUEST_PATTERNS.some((p) => p.test(input.trim()));
}

function isValidBranchToken(token: string): boolean {
  if (!token || token.length < 2) return false;
  if (BRANCH_STOP_WORDS.has(token.toLowerCase())) return false;
  if (!/^[a-z0-9][a-z0-9/_.-]*$/i.test(token)) return false;
  return token.includes('/') || token.includes('-') || token.includes('_') || token.length >= 4;
}

/** Switch to an existing branch or create it from the current HEAD. */
function checkoutOrCreateBranch(rootPath: string, name: string): void {
  try {
    gitExec(rootPath, `rev-parse --verify ${name}`);
    gitExec(rootPath, `checkout ${name}`);
  } catch {
    gitExec(rootPath, `checkout -b ${name}`);
  }
}

/** Infer branch name from user text or version naming convention. */
export function suggestBranchName(userHint: string): string | null {
  const patterns: RegExp[] = [
    // "with the branch name called 1st-pr-with-koda" / "branch name pr-with-koda"
    /\b(?:with\s+(?:the\s+)?)?branch\s+name(?:\s+(?:called|named))?\s+[`"']?([a-zA-Z0-9/_.-]+)[`"']?/i,
    /\bbranch\s+[`"']([a-zA-Z0-9/_.-]+)[`"']/i,
    /\bbranch\s+(?:named|called)\s+[`"']?([a-zA-Z0-9/_.-]+)[`"']?/i,
    // "on branch chore/my-feature" — path-style only
    /\bon\s+branch\s+([a-zA-Z0-9/_.-]+\/[a-zA-Z0-9/_.-]+)/i,
    /\bbranch\s+([a-zA-Z0-9/_.-]+\/[a-zA-Z0-9/_.-]+)/i,
  ];

  for (const pattern of patterns) {
    const m = userHint.match(pattern);
    if (m?.[1] && isValidBranchToken(m[1])) return m[1];
  }

  if (/\b(version|versions|v0\.|release\/|same versions)\b/i.test(userHint)) {
    return `release/v${VERSION}`;
  }

  return null;
}

export interface SlashPrOptions {
  rootPath: string;
  ui:       UIRenderer;
  /** Raw user text — used to infer branch naming preferences. */
  userHint?: string;
}

function gitExec(rootPath: string, args: string): string {
  return execSync(`git ${args}`, {
    cwd: rootPath,
    stdio: ['pipe', 'pipe', 'pipe'],
    encoding: 'utf-8',
  }).trim();
}

/** Default branch when user did not specify a valid name. */
export function defaultBranchName(userHint: string): string {
  if (/\bpull\s+request\b/i.test(userHint) || /\bpr\b/i.test(userHint)) {
    return `feat/pr-${Date.now().toString(36).slice(-6)}`;
  }
  return `feat/koda-${Date.now().toString(36).slice(-6)}`;
}

function resolveBaseBranch(rootPath: string): string {
  try {
    const sym = gitExec(rootPath, 'symbolic-ref refs/remotes/origin/HEAD');
    const m = sym.match(/origin\/(.+)$/);
    if (m?.[1]) return m[1];
  } catch {
    // fall through
  }
  try {
    gitExec(rootPath, 'rev-parse --verify main');
    return 'main';
  } catch {
    return 'master';
  }
}

/** Refresh origin/base so PR counts match GitHub (not stale local main). */
function refreshRemoteBase(rootPath: string, baseBranch: string): void {
  try {
    gitExec(rootPath, `fetch origin ${baseBranch} --quiet`);
  } catch {
    // offline or no remote — fall back to local base ref
  }
}

/** Prefer origin/base for comparisons — GitHub PRs use the remote default branch. */
function resolveCompareRef(rootPath: string, baseBranch: string): string {
  try {
    gitExec(rootPath, `rev-parse --verify origin/${baseBranch}`);
    return `origin/${baseBranch}`;
  } catch {
    return baseBranch;
  }
}

function countCommitsAhead(rootPath: string, compareRef: string): number {
  try {
    return parseInt(gitExec(rootPath, `rev-list --count ${compareRef}..HEAD`), 10) || 0;
  } catch {
    return 0;
  }
}

function isMergedIntoRemoteBase(rootPath: string, compareRef: string): boolean {
  try {
    gitExec(rootPath, `merge-base --is-ancestor HEAD ${compareRef}`);
    return true;
  } catch {
    return false;
  }
}

function hasUncommittedChanges(rootPath: string): boolean {
  try {
    return gitExec(rootPath, 'status --porcelain').length > 0;
  } catch {
    return false;
  }
}

/** True when origin does not have this branch at the current HEAD. */
function needsPushForPr(rootPath: string, branch: string): boolean {
  try {
    const local = gitExec(rootPath, 'rev-parse HEAD');
    const remote = gitExec(rootPath, `rev-parse origin/${branch}`);
    return local !== remote;
  } catch {
    return true;
  }
}

function normalizeGitHubRepoUrl(remoteUrl: string): string | null {
  const raw = remoteUrl.trim();
  if (!raw) return null;

  // SSH format: git@github.com:owner/repo.git
  const ssh = raw.match(/^git@github\.com:(.+?)(?:\.git)?$/i);
  if (ssh?.[1]) return `https://github.com/${ssh[1]}`;

  // HTTPS format: https://github.com/owner/repo(.git)
  const https = raw.match(/^https?:\/\/github\.com\/(.+?)(?:\.git)?$/i);
  if (https?.[1]) return `https://github.com/${https[1]}`;

  return null;
}

/** @internal exported for tests */
export function buildPrCreateUrl(remoteUrl: string, baseBranch: string, branch: string): string | null {
  const repoUrl = normalizeGitHubRepoUrl(remoteUrl);
  if (!repoUrl) return null;
  const head = encodeURIComponent(branch);
  const base = encodeURIComponent(baseBranch);
  return `${repoUrl}/compare/${base}...${head}?expand=1`;
}

async function generatePrContent(
  rootPath: string,
  compareRef: string,
  baseLabel: string,
  branch: string,
): Promise<{ title: string; body: string }> {
  const provider = createProvider(await loadConfig());
  const log = gitExec(rootPath, `log ${compareRef}..HEAD --oneline --no-decorate`).slice(0, 4000);
  let diffStat = '';
  try {
    diffStat = gitExec(rootPath, `diff ${compareRef}...HEAD --stat`).slice(0, 8000);
  } catch {
    diffStat = gitExec(rootPath, 'diff --stat HEAD~5..HEAD').slice(0, 8000);
  }

  const response = await provider.sendChatCompletion({
    messages: [
      {
        role: 'system',
        content:
          'You write GitHub pull request titles and bodies. ' +
          'Reply with JSON only: {"title":"...","body":"..."}. ' +
          'Title: concise, imperative, under 72 chars. ' +
          'Body: summary bullets + test plan section.',
      },
      {
        role: 'user',
        content: [
          `Branch: ${branch} → ${baseLabel}`,
          '',
          'Commits:',
          log || '(no commits ahead of base)',
          '',
          'Diff stat:',
          truncateDiff(diffStat, 6000),
        ].join('\n'),
      },
    ],
    temperature: 0.2,
    max_tokens: 600,
  });

  const raw = response.choices[0]?.message?.content ?? '';
  try {
    const json = JSON.parse(raw.replace(/^```json?\s*|\s*```$/g, '').trim()) as {
      title?: string;
      body?: string;
    };
    const title = sanitizeCommitMessage(json.title ?? '').split('\n')[0] ?? '';
    const body  = (json.body ?? '').trim();
    if (title) return { title, body: body || title };
  } catch {
    // fall through
  }

  const fallbackTitle = sanitizeCommitMessage(raw).split('\n')[0] || `Update ${branch}`;
  return { title: fallbackTitle, body: fallbackTitle };
}

/**
 * Fast PR creation — optional branch creation + explicit plan + open PR URL.
 */
export async function runSlashPr(opts: SlashPrOptions): Promise<string | null> {
  const { rootPath, ui, userHint = '' } = opts;

  let branch: string;
  try {
    branch = gitExec(rootPath, 'branch --show-current');
  } catch {
    ui.renderError('Git not available in this directory.');
    console.log();
    return null;
  }

  if (!branch) {
    ui.renderError('Detached HEAD — checkout a branch first.');
    console.log();
    return null;
  }

  const desiredBranch = suggestBranchName(userHint);
  if (desiredBranch && desiredBranch !== branch) {
    const renameOk = await permissionGate.requestApproval(
      'run_terminal',
      `git checkout -b ${desiredBranch}`,
    );
    if (!renameOk) {
      ui.renderInfo('PR cancelled.');
      console.log();
      return null;
    }
    try {
      ui.stream(`GIT checkout ${desiredBranch}`);
      checkoutOrCreateBranch(rootPath, desiredBranch);
      branch = desiredBranch;
      ui.renderInfo(`Switched to branch ${branch}`);
    } catch (err) {
      ui.renderError(`Could not create branch: ${(err as Error).message}`);
      console.log();
      return null;
    }
  }

  const baseBranch = resolveBaseBranch(rootPath);
  refreshRemoteBase(rootPath, baseBranch);
  const compareRef = resolveCompareRef(rootPath, baseBranch);
  const remoteUrl = gitExec(rootPath, 'remote get-url origin');
  const prUrl = buildPrCreateUrl(remoteUrl, baseBranch, branch);

  if (!prUrl) {
    ui.renderError(
      'Origin remote is not a GitHub URL.',
      'Set origin to github.com or open PR manually from your Git host.',
    );
    console.log();
    return null;
  }

  const ahead = countCommitsAhead(rootPath, compareRef);

  if (ahead === 0) {
    if (isMergedIntoRemoteBase(rootPath, compareRef)) {
      if (hasUncommittedChanges(rootPath)) {
        ui.renderInfo(
          `Branch ${branch} has no new commits vs ${baseBranch}, but you have uncommitted changes. ` +
          'Run /commit to stage and commit them, then run /pr again.',
        );
      } else {
        ui.renderInfo(
          `No new commits — ${branch} is already on ${baseBranch}. ` +
          'These changes look merged already.',
        );
      }
    } else {
      if (hasUncommittedChanges(rootPath)) {
        ui.renderInfo(
          `No commits on ${branch} yet, but you have uncommitted changes. ` +
          'Run /commit to stage and commit them, then run /pr again.',
        );
      } else {
        ui.renderInfo(`No commits ahead of ${baseBranch}. Commit changes first (/commit).`);
      }
    }
    console.log();
    return null;
  }

  let title: string;
  let body: string;

  if (await configExists()) {
    ui.stream('INFO generating PR title and description');
    try {
      ({ title, body } = await generatePrContent(rootPath, compareRef, baseBranch, branch));
    } catch (err) {
      ui.renderError((err as Error).message, 'Run /login or set title manually: /pr your title');
      console.log();
      return null;
    }
  } else {
    title = `Changes on ${branch}`;
    body  = title;
  }

  console.log();
  console.log(chalk.bold('  Proposed pull request'));
  console.log();
  console.log(chalk.cyan(`  ${title}`));
  console.log();
  console.log(chalk.gray(body.split('\n').map((l) => `  ${l}`).join('\n')));
  console.log();
  console.log(chalk.gray(`  ${branch} → ${baseBranch} · ${ahead} commit(s)`));
  console.log();

  const shouldPush = needsPushForPr(rootPath, branch);
  console.log(chalk.bold('  Plan'));
  console.log();
  if (shouldPush) {
    console.log(chalk.gray(`  1. Push branch ${branch} to origin`));
    console.log(chalk.gray(`  2. Create PR ${branch} → ${baseBranch}`));
  } else {
    console.log(chalk.gray(`  1. Create PR ${branch} → ${baseBranch}`));
  }
  console.log();

  if (shouldPush) {
    const pushOk = await permissionGate.requestApproval(
      'git_push',
      `Push branch ${branch} to origin before opening PR`,
    );
    if (!pushOk) {
      ui.renderInfo('PR cancelled.');
      console.log();
      return null;
    }

    ui.stream(`GIT push ${branch}`);
    const pushResult = await gitPush(branch, rootPath);
    if (!pushResult.success) {
      ui.renderError(pushResult.error ?? 'git push failed');
      console.log();
      return null;
    }
  }

  const approved = await permissionGate.requestApproval(
    'git_create_pr',
    `Open PR URL for ${branch} → ${baseBranch}`,
  );
  if (!approved) {
    ui.renderInfo('PR cancelled.');
    console.log();
    return null;
  }

  ui.renderSuccess('PR draft ready.');
  console.log(chalk.gray('  Open this URL to create the PR:'));
  console.log(chalk.cyan(`  ${prUrl}`));
  console.log();
  return prUrl;
}

/** Create a git branch only — commit + /pr when ready. */
export async function runSlashBranch(opts: SlashPrOptions): Promise<boolean> {
  const { rootPath, ui, userHint = '' } = opts;

  let current: string;
  try {
    current = gitExec(rootPath, 'branch --show-current');
  } catch {
    ui.renderError('Git not available in this directory.');
    console.log();
    return false;
  }

  if (!current) {
    ui.renderError('Detached HEAD — checkout a branch first.');
    console.log();
    return false;
  }

  const desired = suggestBranchName(userHint) ?? defaultBranchName(userHint);
  if (desired === current) {
    ui.renderInfo(`Already on branch ${current}.`);
    console.log();
    return true;
  }

  const ok = await permissionGate.requestApproval(
    'run_terminal',
    `git checkout -b ${desired}`,
  );
  if (!ok) {
    ui.renderInfo('Branch creation cancelled.');
    console.log();
    return false;
  }

  try {
    checkoutOrCreateBranch(rootPath, desired);
    ui.renderSuccess(`Switched to branch ${desired}`);
    ui.renderInfo('Commit your changes, then run /pr to open a pull request.');
    console.log();
    return true;
  } catch (err) {
    ui.renderError(`Could not create branch: ${(err as Error).message}`);
    console.log();
    return false;
  }
}
