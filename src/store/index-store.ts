import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { KODA_DIR, VERSION } from '../constants.js';
import { KodaError, ErrorCode } from '../utils/errors.js';
import type { RepoIndex, IndexMetadata, Vocabulary } from '../types/repo-index.js';
import type { FileInfo, CodeChunk, DependencyEdge, VectorEntry } from '../types/index.js';
import type { DependencyNode } from '../types/dependency.js';

function kodaDir(rootPath: string): string {
  return path.join(rootPath, KODA_DIR);
}

export async function saveIndex(rootPath: string, index: RepoIndex): Promise<void> {
  const dir = kodaDir(rootPath);

  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (err) {
    throw new KodaError(
      `Cannot create ${KODA_DIR} directory: ${(err as Error).message}`,
      ErrorCode.PERMISSION_DENIED,
      err as Error,
    );
  }

  await Promise.all([
    fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify(index.metadata, null, 2)),
    fs.writeFile(path.join(dir, 'files.json'), JSON.stringify(index.files)),
    fs.writeFile(path.join(dir, 'chunks.json'), JSON.stringify(index.chunks)),
    fs.writeFile(path.join(dir, 'graph.json'), JSON.stringify(index.edges)),
    fs.writeFile(path.join(dir, 'vectors.json'), JSON.stringify(index.vectors)),
    fs.writeFile(path.join(dir, 'vocabulary.json'), JSON.stringify(index.vocabulary)),
  ]);
}

export async function loadIndexMetadata(rootPath: string): Promise<IndexMetadata> {
  const metaPath = path.join(kodaDir(rootPath), 'meta.json');

  try {
    const raw = await fs.readFile(metaPath, 'utf-8');
    return JSON.parse(raw) as IndexMetadata;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new KodaError('No index found', ErrorCode.INDEX_NOT_FOUND);
    }
    throw new KodaError(
      `Failed to read index metadata: ${(err as Error).message}`,
      ErrorCode.INDEX_CORRUPTED,
      err as Error,
    );
  }
}

export async function loadIndex(rootPath: string): Promise<RepoIndex> {
  const dir = kodaDir(rootPath);

  try {
    const [metaRaw, filesRaw, chunksRaw, graphRaw, vectorsRaw, vocabRaw] = await Promise.all([
      fs.readFile(path.join(dir, 'meta.json'), 'utf-8'),
      fs.readFile(path.join(dir, 'files.json'), 'utf-8'),
      fs.readFile(path.join(dir, 'chunks.json'), 'utf-8'),
      fs.readFile(path.join(dir, 'graph.json'), 'utf-8'),
      fs.readFile(path.join(dir, 'vectors.json'), 'utf-8'),
      fs.readFile(path.join(dir, 'vocabulary.json'), 'utf-8'),
    ]);

    const metadata = JSON.parse(metaRaw) as IndexMetadata;
    const files = JSON.parse(filesRaw) as FileInfo[];
    const chunks = JSON.parse(chunksRaw) as CodeChunk[];
    const edges = JSON.parse(graphRaw) as DependencyEdge[];
    const vectors = JSON.parse(vectorsRaw) as VectorEntry[];
    const vocabulary = JSON.parse(vocabRaw) as Vocabulary;

    // Reconstruct nodes from edges and files
    const inDegree = new Map<string, number>();
    const outDegree = new Map<string, number>();
    for (const f of files) {
      inDegree.set(f.path, 0);
      outDegree.set(f.path, 0);
    }
    for (const e of edges) {
      inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
      outDegree.set(e.source, (outDegree.get(e.source) ?? 0) + 1);
    }
    const nodes: DependencyNode[] = files.map(f => ({
      filePath: f.path,
      inDegree: inDegree.get(f.path) ?? 0,
      outDegree: outDegree.get(f.path) ?? 0,
    }));

    return { metadata, files, chunks, edges, nodes, vectors, vocabulary };
  } catch (err) {
    if (err instanceof KodaError) throw err;
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new KodaError('No index found', ErrorCode.INDEX_NOT_FOUND);
    }
    throw new KodaError(
      `Failed to load index: ${(err as Error).message}`,
      ErrorCode.INDEX_CORRUPTED,
      err as Error,
    );
  }
}

export async function indexExists(rootPath: string): Promise<boolean> {
  try {
    await fs.access(path.join(kodaDir(rootPath), 'meta.json'));
    return true;
  } catch {
    return false;
  }
}
