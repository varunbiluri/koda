import type { AIConfig, ModelInfo } from '../types.js';
import { OpenAIProvider } from './openai-provider.js';

/** Default Ollama OpenAI-compatible base URL. */
export const OLLAMA_DEFAULT_ENDPOINT = 'http://localhost:11434/v1';

/**
 * Ollama provider — uses Ollama's OpenAI-compatible /v1/chat/completions API.
 */
export class OllamaProvider extends OpenAIProvider {
  constructor(config: AIConfig) {
    super(
      {
        ...config,
        endpoint: config.endpoint || OLLAMA_DEFAULT_ENDPOINT,
        apiKey:   config.apiKey || 'ollama',
      },
      { defaultEndpoint: OLLAMA_DEFAULT_ENDPOINT, requireAuth: false },
    );
  }

  /** Base URL without /v1 suffix (for native Ollama endpoints). */
  protected hostUrl(): string {
    return this.baseUrl.replace(/\/v1$/, '');
  }

  /** List locally pulled models via GET /api/tags. */
  static async fetchModels(endpoint?: string): Promise<ModelInfo[]> {
    const base = (endpoint || OLLAMA_DEFAULT_ENDPOINT).replace(/\/$/, '');
    const host = base.replace(/\/v1$/, '');
    const response = await fetch(`${host}/api/tags`);
    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
    }
    const data = (await response.json()) as { models?: Array<{ name: string }> };
    return (data.models ?? []).map((m) => ({
      id:           m.name,
      name:         m.name,
      capabilities: ['chat'],
    }));
  }

  override async listModels(): Promise<ModelInfo[]> {
    return OllamaProvider.fetchModels(this.baseUrl);
  }

  override async testConnection(): Promise<void> {
    const models = await this.listModels();
    if (models.length === 0) {
      throw new Error('No Ollama models found. Run `ollama pull llama3` first.');
    }
  }
}
