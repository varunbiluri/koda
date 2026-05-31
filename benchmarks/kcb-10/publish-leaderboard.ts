/**
 * Generate leaderboard.md from the latest KCB-10 scorecard.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { KcbScorecard } from './score.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function writeLeaderboardMarkdown(latest: KcbScorecard): Promise<void> {
  const jsonPath = path.join(__dirname, 'leaderboard.json');
  let history: KcbScorecard[] = [latest];
  try {
    history = JSON.parse(await fs.readFile(jsonPath, 'utf8')) as KcbScorecard[];
  } catch { /* first run */ }

  const lines = [
    '# KCB-10 Leaderboard',
    '',
    'Koda Context Benchmark — 10 fixed tasks measuring **KEI**, success rate, median tokens, and **ref rate**.',
    '',
    '## Latest run',
    '',
    '| Metric | Value |',
    '|--------|-------|',
    `| Version | ${latest.version} |`,
    `| Run at | ${latest.runAt} |`,
    `| **KEI** | **${latest.kei}/100** |`,
    `| Success rate | ${Math.round(latest.successRate * 100)}% |`,
    `| Median tokens | ${latest.medianTokens.toLocaleString()} |`,
    `| Ref rate | ${Math.round(latest.medianRefRate * 100)}% |`,
    `| Baseline | ${latest.baselineMedianTokens.toLocaleString()} tokens |`,
    '',
  ];

  if (latest.note) {
    lines.push(`> ${latest.note}`, '');
  }

  lines.push('## History', '', '| Version | KEI | Success | Median tokens | Ref rate |', '|---------|-----|---------|---------------|----------|');

  for (const row of history.slice(0, 10)) {
    lines.push(
      `| ${row.version} | ${row.kei} | ${Math.round(row.successRate * 100)}% | ${row.medianTokens.toLocaleString()} | ${Math.round(row.medianRefRate * 100)}% |`,
    );
  }

  lines.push('', '---', '', 'Run: `pnpm benchmark:kcb10` (mock) · `pnpm benchmark:kcb10:live` (provider required)', '');

  await fs.writeFile(path.join(__dirname, 'leaderboard.md'), lines.join('\n'), 'utf8');
}

if (process.argv[1]?.includes('publish-leaderboard')) {
  const json = await fs.readFile(path.join(__dirname, 'leaderboard.json'), 'utf8');
  const latest = (JSON.parse(json) as KcbScorecard[])[0];
  await writeLeaderboardMarkdown(latest);
}
