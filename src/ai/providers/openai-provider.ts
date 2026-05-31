import type {
  AIProvider,
  AIConfig,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ModelInfo,
} from '../types.js';
import { logger } from '../../utils/logger.js';
import { consumeOpenAiSseStream } from './openai-sse.js';

/** Model id prefixes suitable for chat/completions. */
const CHAT_MODEL_PREFIXES = ['gpt-', 'o1', 'o3', 'o4', 'chatgpt-'];

export class OpenAIProvider implements AIProvider {
  static readonly defaultEndpoint = 'https://api.openai.com/v1';

  protected baseUrl: string;
  protected apiKey: string;
  protected model: string;
  protected requireAuth: boolean;

  constructor(
    config: AIConfig,
    options?: { defaultEndpoint?: string; requireAuth?: boolean },
  ) {
    this.baseUrl = (config.endpoint || options?.defaultEndpoint || OpenAIProvider.defaultEndpoint)
      .replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.requireAuth = options?.requireAuth !== false;
  }

  protected chatUrl(): string {
    return `${this.baseUrl}/chat/completions`;
  }

  protected modelsUrl(): string {
    return `${this.baseUrl}/models`;
  }

  protected headers(stream = false): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.requireAuth && this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }
    if (stream) headers.Accept = 'text/event-stream';
    return headers;
  }

  /** Fetch available models from an OpenAI-compatible /models endpoint. */
  static async fetchModels(apiKey: string, endpoint?: string): Promise<ModelInfo[]> {
    const base = (endpoint || OpenAIProvider.defaultEndpoint).replace(/\/$/, '');
    const response = await fetch(`${base}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
    }
    const data = (await response.json()) as { data?: Array<{ id: string }> };
    return (data.data ?? [])
      .filter((m) => CHAT_MODEL_PREFIXES.some((p) => m.id.startsWith(p)))
      .map((m) => ({ id: m.id, name: m.id, capabilities: ['chat'] }));
  }

  async testConnection(): Promise<void> {
    await this.sendChatCompletion({
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 1,
    });
  }

  async sendChatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const url = this.chatUrl();
    logger.debug(`OpenAI API request to ${url}`);

    const response = await fetch(url, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ ...request, model: this.model, stream: false }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`OpenAI API error: ${response.status} ${errorText}`);
      throw new Error(`OpenAI API request failed: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as ChatCompletionResponse;
  }

  async streamChatCompletion(
    request: ChatCompletionRequest,
    onChunk: (chunk: string) => void,
  ): Promise<void> {
    const url = this.chatUrl();
    logger.debug(`OpenAI API streaming request to ${url}`);

    const response = await fetch(url, {
      method: 'POST',
      headers: this.headers(true),
      body: JSON.stringify({ ...request, model: this.model, stream: true }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`OpenAI API error: ${response.status} ${errorText}`);
      throw new Error(`OpenAI API request failed: ${response.status} ${response.statusText}`);
    }

    if (!response.body) throw new Error('Response body is null');
    await consumeOpenAiSseStream(response.body, onChunk);
  }

  async listModels(): Promise<ModelInfo[]> {
    const response = await fetch(this.modelsUrl(), {
      headers: this.headers(),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch models: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as { data?: Array<{ id: string }> };
    return (data.data ?? []).map((m) => ({
      id: m.id,
      name: m.id,
      capabilities: ['chat'],
    }));
  }
}
