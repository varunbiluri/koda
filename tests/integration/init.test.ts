import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { runIndexingPipeline } from '../../src/engine/indexing-pipeline.js';
import { loadIndex, loadIndexMetadata } from '../../src/store/index-store.js';

const FIXTURE_PROJECT = path.resolve(__dirname, '../fixtures/sample-project');
const KODA_DIR = path.join(FIXTURE_PROJECT, '.koda');

describe('init integration', () => {
  beforeEach(async () => {
    // Clean up any previous .koda directory
    await fs.rm(KODA_DIR, { recursive: true, force: true });
  });

  afterEach(async () => {
    await fs.rm(KODA_DIR, { recursive: true, force: true });
  });

  it('creates .koda directory with expected files', async () => {
    await runIndexingPipeline(FIXTURE_PROJECT, { force: true });

    const files = await fs.readdir(KODA_DIR);
    expect(files).toContain('meta.json');
    expect(files).toContain('files.json');
    expect(files).toContain('chunks.json');
    expect(files).toContain('graph.json');
    expect(files).toContain('vectors.json');
    expect(files).toContain('vocabulary.json');
  });

  it('produces valid metadata', async () => {
    await runIndexingPipeline(FIXTURE_PROJECT, { force: true });

    const meta = await loadIndexMetadata(FIXTURE_PROJECT);
    expect(meta.version).toBe('0.1.0');
    expect(meta.fileCount).toBeGreaterThan(0);
    expect(meta.chunkCount).toBeGreaterThan(0);
    expect(meta.rootPath).toBe(FIXTURE_PROJECT);
  });

  it('can load the full index after saving', async () => {
    await runIndexingPipeline(FIXTURE_PROJECT, { force: true });

    const index = await loadIndex(FIXTURE_PROJECT);
    expect(index.files.length).toBeGreaterThan(0);
    expect(index.chunks.length).toBeGreaterThan(0);
    expect(index.vectors.length).toBe(index.chunks.length);
    expect(index.vocabulary.terms.length).toBeGreaterThan(0);
  });

  it('collects progress events', async () => {
    const stages: string[] = [];
    await runIndexingPipeline(FIXTURE_PROJECT, {
      force: true,
      onProgress(stage) { stages.push(stage); },
    });

    expect(stages.length).toBeGreaterThan(0);
    expect(stages[0]).toContain('Discovering');
  });
});
