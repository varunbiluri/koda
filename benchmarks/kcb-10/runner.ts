/**
 * KCB-10 — Koda Context Benchmark (10 tasks).
 *
 * Measures KEI, success rate, median tokens, and ref rate across a fixed fixture set.
 *
 * Usage:
 *   pnpm benchmark:kcb10
 *   pnpm benchmark:kcb10 --mock   # offline scoring with synthetic metrics
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreResults, type KcbTaskResult, type KcbScorecard } from './score.js';
import { DEFAULT_KEI_BASELINE_TOKENS } from '../../src/product/metrics.js';

export type { KcbTaskResult, KcbScorecard };
export { scoreResults };

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface KcbFixture {
  id:          string;
  kind:        'fix' | 'add' | 'refactor' | 'explain';
  description: string;
  /** Expected outcome keywords for mock/offline validation. */
  successHints?: string[];
}

/**
 * Load fixture definitions from the module-local `fixtures.json`.
 *
 * @returns The array of parsed `KcbFixture` objects.
 */
export async function loadFixtures(): Promise<KcbFixture[]> {
  const raw = await fs.readFile(path.join(__dirname, 'fixtures.json'), 'utf8');
  return JSON.parse(raw) as KcbFixture[];
}

/**
 * Run a deterministic offline benchmark that scores fixtures using synthetic, repeatable task metrics.
 *
 * @param version - Version identifier applied to the produced scorecard
 * @returns A KcbScorecard representing the scored mock results derived from synthetic per-task metrics
 */
export async function runMockBenchmark(version: string): Promise<KcbScorecard> {
  const fixtures = await loadFixtures();
  const results: KcbTaskResult[] = fixtures.map((f, i) => ({
    taskId:            f.id,
    kind:              f.kind,
    success:           i < 7,
    promptTokens:      28_000 + i * 1_500,
    completionTokens:    2_000 + i * 100,
    toolCalls:         12 + i,
    refRate:           0.45 + i * 0.03,
    toolResultsTotal:  14,
    toolResultsViaRef: Math.round(14 * (0.45 + i * 0.03)),
  }));

  return scoreResults(results, {
    version,
    baselineMedianTokens: DEFAULT_KEI_BASELINE_TOKENS,
  });
}

/**
 * Run the KCB-10 benchmark against the configured AI provider and return the scored results.
 *
 * Executes each benchmark fixture using the project's AI provider, aggregates per-task metrics,
 * scores the results into a KCB scorecard, and updates the product KEI baseline.
 *
 * @param rootPath - Path to the repository root used for indexing and as chat context
 * @param version - Version identifier to include in the produced scorecard
 * @returns The computed KcbScorecard for this benchmark run
 * @throws Error if no AI configuration is present (instructs to run `koda login`)
 */
export async function runLiveBenchmark(rootPath: string, version: string): Promise<KcbScorecard> {
  const { loadConfig, configExists } = await import('../../src/ai/config-store.js');
  const { createProvider } = await import('../../src/ai/providers/provider-factory.js');
  const { ReasoningEngine } = await import('../../src/ai/reasoning/reasoning-engine.js');
  const { loadIndex } = await import('../../src/store/index-store.js');
  const { ProductMetrics } = await import('../../src/product/metrics.js');

  if (!await configExists()) {
    throw new Error('No AI config — run `koda login` before live KCB-10');
  }

  const config   = await loadConfig();
  const provider = createProvider(config);
  const index    = await loadIndex(rootPath).catch(() => null);
  const fixtures = await loadFixtures();
  const results: KcbTaskResult[] = [];

  const chatContext = {
    repoName:  path.basename(rootPath),
    branch:    'kcb10',
    rootPath,
    fileCount: index?.metadata.fileCount ?? 0,
  };

  for (const fixture of fixtures) {
    process.stderr.write(`KCB-10 ${fixture.id}: ${fixture.description.slice(0, 60)}…\n`);
    const engine = new ReasoningEngine(index, provider);
    let output   = '';
    const metrics = await engine.chat(
      fixture.description,
      chatContext,
      [],
      (chunk) => { output += chunk; },
      (stage) => process.stderr.write(`  ${stage}\n`),
      undefined,
      undefined,
      undefined,
      undefined,
      { route: 'kcb10', skipPlanning: true, maxRounds: 10 },
    );
    results.push({
      taskId:            fixture.id,
      kind:              fixture.kind,
      success:           output.trim().length > 0 || metrics.tools > 0,
      promptTokens:      metrics.promptTokens,
      completionTokens:  metrics.completionTokens,
      toolCalls:         metrics.tools,
      refRate:           metrics.refRate,
      toolResultsTotal:  metrics.toolResultsTotal,
      toolResultsViaRef: metrics.toolResultsViaRef,
    });
  }

  const card = scoreResults(results, {
    version,
    baselineMedianTokens: DEFAULT_KEI_BASELINE_TOKENS,
  });

  const pm = await ProductMetrics.load(rootPath);
  pm.setKeiBaseline(DEFAULT_KEI_BASELINE_TOKENS);
  await pm.flush();

  return card;
}

/**
 * Run the KCB-10 benchmark (mock or live), print the resulting scorecard, and update leaderboards.
 *
 * The mode is chosen from CLI flags (`--live` to run live; `--mock` or absence of `--live` for mock).
 * Environment variables `KODA_BENCH_ROOT` and `KODA_VERSION` influence the benchmark root path and version.
 * In mock mode the scorecard note is set to indicate synthetic metrics. The final scorecard is emitted
 * as JSON to stdout and persisted to the rolling JSON leaderboard and the published Markdown leaderboard.
 */
async function main(): Promise<void> {
  const args     = process.argv.slice(2);
  const mock     = args.includes('--mock') || !args.includes('--live');
  const live     = args.includes('--live');
  const rootPath = process.env['KODA_BENCH_ROOT'] ?? process.cwd();
  const version  = process.env['KODA_VERSION'] ?? '0.1.2';

  const card = live
    ? await runLiveBenchmark(rootPath, version)
    : await runMockBenchmark(version);

  if (!live) card.note = 'Mock metrics — pass --live with provider config for real KCB-10.';

  console.log(JSON.stringify(card, null, 2));
  await writeLeaderboard(card);
  await publishLeaderboardMd(card);
}

/**
 * Publishes the provided scorecard as a Markdown leaderboard.
 *
 * @param latest - The latest KCB scorecard to publish as Markdown
 */
async function publishLeaderboardMd(latest: KcbScorecard): Promise<void> {
  const { writeLeaderboardMarkdown } = await import('./publish-leaderboard.js');
  await writeLeaderboardMarkdown(latest);
}

/**
 * Prepends a scorecard to the local rolling leaderboard file.
 *
 * Writes or creates leaderboard.json next to this module, keeping at most the 20 most recent scorecards.
 *
 * @param card - The latest KcbScorecard to add to the leaderboard
 */
async function writeLeaderboard(card: KcbScorecard): Promise<void> {
  const outPath = path.join(__dirname, 'leaderboard.json');
  let existing: KcbScorecard[] = [];
  try {
    existing = JSON.parse(await fs.readFile(outPath, 'utf8')) as KcbScorecard[];
  } catch { /* first run */ }
  existing.unshift(card);
  await fs.writeFile(outPath, JSON.stringify(existing.slice(0, 20), null, 2), 'utf8');
}

if (process.argv[1]?.endsWith('runner.ts') || process.argv[1]?.includes('kcb-10/runner')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
