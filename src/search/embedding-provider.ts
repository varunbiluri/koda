import type { AIConfig } from '../ai/types.js';

/**
 * Minimal interface every embedding provider must implement.
 * Both single and batch paths are required — batch is used when
 * indexing chunks; single is used at query time.
 */
export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

/**
 * AzureEmbeddingProvider — calls Azure OpenAI Embeddings API.
 *
 * Requires a text-embedding deployment in the same Azure resource
 * as the chat deployment (e.g. text-embedding-ada-002 or
 * text-embedding-3-small).  The deployment name can be passed via
 * `embeddingDeployment`; it defaults to "text-embedding-ada-002".
 */
export class AzureEmbeddingProvider implements EmbeddingProvider {
  private endpoint: string;
  private apiKey: string;
  private deployment: string;
  private apiVersion: string;

  constructor(config: AIConfig & { embeddingDeployment?: string }) {
    this.endpoint   = config.endpoint.replace(/\/$/, '');
    this.apiKey     = config.apiKey;
    this.deployment = config.embeddingDeployment ?? 'text-embedding-ada-002';
    this.apiVersion = config.apiVersion ?? '2024-05-01-preview';
  }

  async embed(text: string): Promise<number[]> {
    const results = await this.embedBatch([text]);
    return results[0] ?? [];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const url =
      `${this.endpoint}/openai/deployments/${this.deployment}/embeddings` +
      `?api-version=${this.apiVersion}`;

    // Azure limits input to 8 192 tokens per item — truncate conservatively
    const safeTexts = texts.map((t) => t.slice(0, 32_000));

    const response = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': this.apiKey },
      body:    JSON.stringify({ input: safeTexts }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Azure Embeddings API ${response.status}: ${body}`);
    }

    const data = (await response.json()) as {
      data: Array<{ index: number; embedding: number[] }>;
    };

    // Restore original order (API returns them sorted by index, but be safe)
    const sorted = [...data.data].sort((a, b) => a.index - b.index);
    return sorted.map((d) => d.embedding);
  }
}

/**
 * NullEmbeddingProvider — returns empty vectors without making any network
 * call.  Used when no embedding deployment is configured so that
 * HybridRetrieval degrades gracefully to TF-IDF only.
 */
export class NullEmbeddingProvider implements EmbeddingProvider {
  async embed(_text: string): Promise<number[]>          { return []; }
  async embedBatch(texts: string[]): Promise<number[][]> { return texts.map(() => []); }
}
