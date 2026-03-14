import type {
  AIProvider,
  AIConfig,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionStreamChunk,
  ModelInfo,
} from '../types.js';
import { logger } from '../../utils/logger.js';

export class AzureAIProvider implements AIProvider {
  private endpoint: string;
  private apiKey: string;
  private model: string;
  private apiVersion: string;

  constructor(config: AIConfig) {
    this.endpoint = config.endpoint.replace(/\/$/, ''); // Remove trailing slash
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.apiVersion = config.apiVersion ?? '2024-05-01-preview';
  }

  private getDeploymentUrl(): string {
    return `${this.endpoint}/openai/deployments/${this.model}/chat/completions?api-version=${this.apiVersion}`;
  }

  private getUrl(path: string): string {
    return `${this.endpoint}${path}?api-version=${this.apiVersion}`;
  }

  /**
   * Fetch all deployment IDs from the Azure OpenAI resource.
   * Used by the setup wizard before a model has been chosen.
   */
  static async fetchDeployments(
    endpoint: string,
    apiKey: string,
    apiVersion = '2024-05-01-preview',
  ): Promise<string[]> {
    const base = endpoint.replace(/\/$/, '');
    const url = `${base}/openai/deployments?api-version=${apiVersion}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'api-key': apiKey },
    });
    if (!response.ok) {
      throw new Error(`Azure API error: ${response.status} ${response.statusText}`);
    }
    const data = (await response.json()) as { data?: Array<{ id: string }> };
    return (data.data ?? []).map((d) => d.id);
  }

  /** Lightweight connection test — sends a minimal request to the deployment endpoint. */
  async testConnection(): Promise<void> {
    const url = this.getDeploymentUrl();
    logger.debug(`Testing connection to ${url}`);
    const response = await fetch(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      logger.error(`Azure API error: ${response.status} ${text}`);
      throw new Error(`Azure API error: ${response.status} ${response.statusText}`);
    }
  }

  private getHeaders(stream: boolean = false): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'api-key': this.apiKey,
    };
    if (stream) {
      headers['Accept'] = 'text/event-stream';
    }
    return headers;
  }

  async sendChatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const url = this.getDeploymentUrl();

    logger.debug(`Azure API request to ${url}`);

    const response = await fetch(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        ...request,
        stream: false,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`Azure API error: ${response.status} ${errorText}`);
      throw new Error(`Azure API request failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data as ChatCompletionResponse;
  }

  async streamChatCompletion(
    request: ChatCompletionRequest,
    onChunk: (chunk: string) => void,
  ): Promise<void> {
    const url = this.getDeploymentUrl();

    logger.debug(`Azure API streaming request to ${url}`);

    const response = await fetch(url, {
      method: 'POST',
      headers: this.getHeaders(true),
      body: JSON.stringify({
        ...request,
        stream: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`Azure API error: ${response.status} ${errorText}`);
      throw new Error(`Azure API request failed: ${response.status} ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error('Response body is null');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === 'data: [DONE]') continue;
          if (!trimmed.startsWith('data: ')) continue;

          try {
            const json = trimmed.slice(6); // Remove 'data: ' prefix
            const chunk: ChatCompletionStreamChunk = JSON.parse(json);

            const content = chunk.choices[0]?.delta?.content;
            if (content) {
              onChunk(content);
            }
          } catch (err) {
            logger.warn(`Failed to parse SSE chunk: ${trimmed}`);
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    const url = this.getUrl('/openai/deployments');

    logger.debug(`Fetching models from ${url}`);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'api-key': this.apiKey,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`Azure API error: ${response.status} ${errorText}`);
      throw new Error(`Failed to fetch models: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as { data?: Array<{ id: string; model: string }> };

    // Azure returns { data: [ { id: "...", model: "...", ... } ] }
    const deployments = data.data ?? [];
    return deployments.map((d) => ({
      id: d.id,
      name: d.model,
      capabilities: ['chat'],
    }));
  }
}
