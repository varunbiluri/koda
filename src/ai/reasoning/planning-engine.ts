import { QueryEngine } from '../../search/query-engine.js';
import { HybridRetrieval } from '../../search/hybrid-retrieval.js';
import { analyzeArchitecture, formatArchitectureSummary } from '../../analysis/architecture-analyzer.js';
import type { AIProvider } from '../types.js';
import type { RepoIndex } from '../../types/index.js';
import type { CodeChunk } from '../../types/code-chunk.js';
import { getRepoIntelligenceCache } from '../../cache/repo-intelligence-cache.js';
import { logger } from '../../utils/logger.js';

// ── Public constants ──────────────────────────────────────────────────────────

export const MAX_PLAN_STEPS = 10;

// ── Public types ──────────────────────────────────────────────────────────────

export interface PlanStep {
  id: number;
  description: string;
  expectedFiles?: string[];
}

export interface ExecutionPlan {
  steps: PlanStep[];
  query: string;
  repositoryContext: string;
}

// ── PlanningEngine ────────────────────────────────────────────────────────────

/**
 * PlanningEngine — generates a structured execution plan for a given task.
 *
 * Pipeline:
 *   1. Architecture Discovery: ArchitectureAnalyzer detects entry points,
 *      modules, important files, API routes, and the dependency graph.
 *   2. Context Discovery: HybridRetrieval.search(query, 5) with multi-hop
 *      expansion to surface the most relevant files.
 *   3. Planning: single LLM call at temperature 0.2 → numbered PlanStep[]
 *
 * The architecture summary is injected into the planning prompt so the model
 * generates plans that respect the real module layout.
 */
export class PlanningEngine {
  constructor(
    private provider: AIProvider,
    private index: RepoIndex | null,
  ) {}

  /**
   * Generate a structured execution plan for the given task query.
   *
   * @param query    - The user's task description.
   * @param rootPath - Repository root for architecture analysis and embeddings.
   */
  async generateExecutionPlan(query: string, rootPath: string): Promise<ExecutionPlan> {
    // ── Phase 1: Architecture Discovery ──────────────────────────────────────
    let architectureBlock = '';
    let filePaths: string[] = [];

    // ── Architecture summary: check cache first ───────────────────────────
    const cache = await getRepoIntelligenceCache(rootPath);
    const cachedArch = await cache.getArchitectureSummary();

    // Run architecture analysis and hybrid retrieval in parallel
    const [archSummary, retrievalHits] = await Promise.all([
      cachedArch ? Promise.resolve(null) : analyzeArchitecture(rootPath, this.index),
      this._retrieveContext(query),
    ]);

    if (cachedArch) {
      architectureBlock = cachedArch;
      logger.debug('[planning-engine] Architecture summary served from cache');
    } else if (archSummary) {
      architectureBlock = formatArchitectureSummary(archSummary);
      // Persist to cache for subsequent calls
      await cache.setArchitectureSummary(architectureBlock);
      await cache.save();
    }

    // ── Phase 2: Context Discovery ────────────────────────────────────────────
    if (retrievalHits.length > 0 && this.index) {
      const chunks = retrievalHits
        .map((r) => this.index!.chunks.find((c) => c.id === r.chunkId))
        .filter((c): c is CodeChunk => c !== undefined);

      filePaths = Array.from(new Set(chunks.map((c) => c.filePath)));

      const retrievalContext = buildRetrievalSummary(filePaths, chunks);
      if (retrievalContext) {
        architectureBlock += retrievalContext;
      }

      logger.debug(`[planning-engine] Context: ${filePaths.length} files retrieved`);
    }

    logger.debug(`[planning-engine] Architecture summary length: ${architectureBlock.length} chars`);

    // ── Phase 3: Single LLM call to generate plan ─────────────────────────────
    const systemPrompt = [
      'You are Koda — an AI software engineer. Generate a concise, numbered execution plan.',
      '',
      'Rules:',
      `- Output ONLY numbered steps, one per line: "1 Step description"`,
      `- Maximum ${MAX_PLAN_STEPS} steps`,
      '- Each step should be specific and actionable',
      '- Reference actual file paths from the architecture summary when relevant',
      '- No preamble, no explanation — just the numbered list',
    ].join('\n');

    const contextBlock = architectureBlock ? `${architectureBlock}\n\n` : '';
    const userPrompt   = `${contextBlock}Task: ${query}\n\nGenerate the execution plan:`;

    const response = await this.provider.sendChatCompletion({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt },
      ],
      temperature: 0.2,
      max_tokens:  500,
    });

    const planText = response.choices[0]?.message?.content ?? '';
    logger.debug(`[planning-engine] Raw plan:\n${planText}`);

    const steps = parsePlanSteps(planText);

    return { steps, query, repositoryContext: architectureBlock };
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async _retrieveContext(query: string) {
    if (!this.index) return [];
    try {
      const qe     = new QueryEngine(this.index);
      // Pass the index so HybridRetrieval can do multi-hop expansion
      const hybrid = new HybridRetrieval(qe, undefined, undefined, this.index);
      return await hybrid.search(query, 5);
    } catch (err) {
      logger.warn(`[planning-engine] Retrieval failed: ${(err as Error).message}`);
      return [];
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildRetrievalSummary(
  filePaths: string[],
  chunks: Array<Pick<CodeChunk, 'filePath' | 'name' | 'type'>>,
): string {
  if (filePaths.length === 0) return '';

  const symbolSummary = chunks
    .slice(0, 5)
    .map((c) => `${c.name} (${c.type})`)
    .join(', ');

  return [
    '',
    '## Retrieved Context',
    '',
    'Relevant files:',
    ...filePaths.map((f) => `* ${f}`),
    '',
    `Key symbols: ${symbolSummary || 'none identified'}`,
  ].join('\n');
}

function parsePlanSteps(text: string): PlanStep[] {
  const steps: PlanStep[] = [];

  for (const raw of text.split('\n')) {
    const line  = raw.trim();
    const match = line.match(/^(\d+)[.):\s]\s*(.+)/);
    if (match?.[2]) {
      const id = parseInt(match[1], 10);
      if (id >= 1 && id <= MAX_PLAN_STEPS) {
        steps.push({ id, description: match[2].trim() });
      }
    }
  }

  // Sort by id in case the model reorders them
  return steps.sort((a, b) => a.id - b.id).slice(0, MAX_PLAN_STEPS);
}
