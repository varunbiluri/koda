import * as fs   from 'node:fs/promises';
import * as path from 'node:path';
import type { EmbeddingProvider } from './embedding-provider.js';

export interface StoredEmbedding {
  chunkId:  string;
  vector:   number[];
  /** djb2 fingerprint of the chunk text — used to detect stale entries. */
  textHash: string;
}

export interface EmbeddingStore {
  entries:   StoredEmbedding[];
  createdAt: string;
  model:     string;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Lightweight djb2 hash used as a cheap text fingerprint. */
function djb2(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h) ^ text.charCodeAt(i);
    h >>>= 0;
  }
  return h.toString(16).padStart(8, '0');
}

function storePath(rootPath: string): string {
  return path.join(rootPath, '.koda', 'embeddings.json');
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function loadEmbeddingStore(rootPath: string): Promise<EmbeddingStore | null> {
  try {
    const raw = await fs.readFile(storePath(rootPath), 'utf-8');
    return JSON.parse(raw) as EmbeddingStore;
  } catch {
    return null;
  }
}

export async function saveEmbeddingStore(
  rootPath: string,
  store: EmbeddingStore,
): Promise<void> {
  const dir = path.join(rootPath, '.koda');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(storePath(rootPath), JSON.stringify(store, null, 2), 'utf-8');
}

/**
 * Build or refresh the embedding store from a list of text chunks.
 *
 * Chunks whose text has not changed since the last build are served from the
 * cache (same djb2 hash + same model name).  Only new or changed chunks are
 * sent to the embedding provider.
 *
 * @param chunks    - Pairs of { id, text } to embed.
 * @param provider  - EmbeddingProvider (Azure, local, null, etc.).
 * @param rootPath  - Repository root (locates .koda/embeddings.json).
 * @param modelName - Model identifier stored alongside vectors for invalidation.
 * @param batchSize - Texts per API call (default 50).
 */
export async function buildEmbeddingStore(
  chunks:    Array<{ id: string; text: string }>,
  provider:  EmbeddingProvider,
  rootPath:  string,
  modelName  = 'unknown',
  batchSize  = 50,
): Promise<EmbeddingStore> {
  const existing   = await loadEmbeddingStore(rootPath);
  const cachedById = new Map<string, StoredEmbedding>(
    (existing?.entries ?? []).map((e) => [e.chunkId, e]),
  );

  const toEmbed: Array<{ id: string; text: string }> = [];
  const kept:    StoredEmbedding[]                   = [];

  for (const chunk of chunks) {
    const hash   = djb2(chunk.text);
    const cached = cachedById.get(chunk.id);
    if (cached && cached.textHash === hash && existing?.model === modelName) {
      kept.push(cached);
    } else {
      toEmbed.push(chunk);
    }
  }

  const fresh: StoredEmbedding[] = [];

  for (let i = 0; i < toEmbed.length; i += batchSize) {
    const batch   = toEmbed.slice(i, i + batchSize);
    const texts   = batch.map((c) => c.text);
    const vectors = await provider.embedBatch(texts);

    for (let j = 0; j < batch.length; j++) {
      const item = batch[j]!;
      fresh.push({
        chunkId:  item.id,
        vector:   vectors[j] ?? [],
        textHash: djb2(item.text),
      });
    }
  }

  const store: EmbeddingStore = {
    entries:   [...kept, ...fresh],
    createdAt: new Date().toISOString(),
    model:     modelName,
  };

  await saveEmbeddingStore(rootPath, store);
  return store;
}
