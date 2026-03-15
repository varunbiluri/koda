import * as fs from 'node:fs/promises';
import * as path from 'node:path';

// ── Public types ──────────────────────────────────────────────────────────────

export interface RunRecord {
  /** Unique run ID (timestamp-based). */
  runId: string;
  task: string;
  startedAt: string;
  finishedAt: string;
  success: boolean;
  iterations: number;
  stepCount: number;
}

// ── Persistence ───────────────────────────────────────────────────────────────

/**
 * Persist a run record to `.koda/history/run-<runId>.json`.
 * Returns the absolute path of the written file.
 */
export async function saveRunRecord(record: RunRecord, rootPath: string): Promise<string> {
  const dir = path.join(rootPath, '.koda', 'history');
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `run-${record.runId}.json`);
  await fs.writeFile(filePath, JSON.stringify(record, null, 2), 'utf-8');
  return filePath;
}

/**
 * Load all run records from `.koda/history/`, sorted oldest-first.
 * Returns an empty array if the directory does not exist.
 */
export async function loadRunHistory(rootPath: string): Promise<RunRecord[]> {
  const dir = path.join(rootPath, '.koda', 'history');
  try {
    const files = (await fs.readdir(dir))
      .filter((f) => f.startsWith('run-') && f.endsWith('.json'))
      .sort();
    return await Promise.all(
      files.map(async (f) => {
        const raw = await fs.readFile(path.join(dir, f), 'utf-8');
        return JSON.parse(raw) as RunRecord;
      }),
    );
  } catch {
    return [];
  }
}

/** Generate a run ID from the current timestamp (safe for filenames). */
export function makeRunId(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}
