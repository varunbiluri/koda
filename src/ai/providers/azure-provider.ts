import type {
  AIProvider,
  AIConfig,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionStreamChunk,
  ModelInfo,
} from '../types.js';
import { logger } from '../../utils/logger.js';

/** Shape returned by fetchDeployments — both the deployment id and the underlying model name. */
export interface DeploymentInfo {
  id: string;
  model: string;
}

/**
 * Models that support the /chat/completions endpoint.
 * Matched against the `model` field returned by Azure (not the deployment id).
 */
export const CHAT_ALLOWED_PATTERNS: RegExp[] = [
  /^gpt-4/,
  /^gpt-35/,
  /^o1/,
  /^o3/,
];

/** Model name fragments that indicate the deployment is NOT a chat model. */
export const CHAT_BLOCKED_PATTERNS: RegExp[] = [
  /codex/i,
  /embedding/i,
  /image/i,
  /whisper/i,
  /dall-e/i,
  /tts/i,
];

export class AzureAIProvider implements AIProvider {
  private endpoint: string;
  private apiKey: string;
  private model: string;
  private apiVersion: string;
  private readonly v1Api: boolean;

  constructor(config: AIConfig) {
    this.endpoint = config.endpoint.replace(/\/$/, ''); // Remove trailing slash
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.apiVersion = config.apiVersion ?? '2024-05-01-preview';
    this.v1Api = AzureAIProvider.isFoundryV1Endpoint(this.endpoint);
  }

  /** Azure AI Foundry / OpenAI v1-compatible base (supports DeepSeek, Grok, etc.). */
  static isFoundryV1Endpoint(endpoint: string): boolean {
    const base = endpoint.replace(/\/$/, '');
    return /\/openai\/v1$/i.test(base);
  }

  private chatCompletionsUrl(): string {
    if (this.v1Api) {
      return `${this.endpoint}/chat/completions`;
    }
    return `${this.endpoint}/openai/deployments/${this.model}/chat/completions?api-version=${this.apiVersion}`;
  }

  private deploymentsListUrl(): string {
    if (this.v1Api) {
      return `${this.endpoint}/models`;
    }
    return `${this.endpoint}/openai/deployments?api-version=${this.apiVersion}`;
  }

  /** @deprecated use chatCompletionsUrl */
  private getDeploymentUrl(): string {
    return this.chatCompletionsUrl();
  }

  private getUrl(path: string): string {
    return `${this.endpoint}${path}?api-version=${this.apiVersion}`;
  }

  /**
   * Fetch all deployments from the Azure OpenAI resource.
   * Returns both the deployment id and the underlying model name so the wizard
   * can filter by chat compatibility before presenting choices to the user.
   */
  static async fetchDeployments(
    endpoint: string,
    apiKey: string,
    apiVersion = '2024-05-01-preview',
  ): Promise<DeploymentInfo[]> {
    const base = endpoint.replace(/\/$/, '');

    if (AzureAIProvider.isFoundryV1Endpoint(base)) {
      const url = `${base}/models`;
      const response = await fetch(url, {
        method: 'GET',
        headers: { 'api-key': apiKey },
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Azure API error: ${response.status} ${response.statusText}${body ? ` — ${body}` : ''}`);
      }
      const data = (await response.json()) as { data?: Array<{ id: string }> };
      return (data.data ?? []).map((d) => ({ id: d.id, model: d.id }));
    }

    const url = `${base}/openai/deployments?api-version=${apiVersion}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'api-key': apiKey },
    });
    if (!response.ok) {
      throw new Error(`Azure API error: ${response.status} ${response.statusText}`);
    }
    const data = (await response.json()) as { data?: Array<{ id: string; model?: string }> };
    return (data.data ?? []).map((d) => ({ id: d.id, model: d.model ?? d.id }));
  }

  /**
   * Return only deployments whose underlying model supports /chat/completions.
   * Rejects embeddings, codex, image-generation, whisper, TTS, and DALL-E deployments.
   */
  static filterChatCompatible(
    deployments: DeploymentInfo[],
    endpoint?: string,
  ): DeploymentInfo[] {
    if (endpoint && AzureAIProvider.isFoundryV1Endpoint(endpoint)) {
      return deployments.filter((d) => !CHAT_BLOCKED_PATTERNS.some((p) => p.test(d.model)));
    }
    return deployments.filter(
      (d) =>
        CHAT_ALLOWED_PATTERNS.some((p) => p.test(d.model)) &&
        !CHAT_BLOCKED_PATTERNS.some((p) => p.test(d.model)),
    );
  }

  /**
   * Validate that a specific deployment can handle chat/completions requests.
   * Sends a minimal single-token request; throws if the model rejects it
   * (e.g. OperationNotSupported for non-chat models).
   */
  static async validateChatDeployment(
    endpoint: string,
    apiKey: string,
    deploymentId: string,
    apiVersion = '2024-05-01-preview',
  ): Promise<void> {
    const base = endpoint.replace(/\/$/, '');

    if (AzureAIProvider.isFoundryV1Endpoint(base)) {
      const url = `${base}/chat/completions`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
        body: JSON.stringify({
          model: deploymentId,
          messages: [{ role: 'user', content: 'test' }],
          max_tokens: 1,
        }),
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Azure API error: ${response.status} ${response.statusText}${body ? ` — ${body}` : ''}`);
      }
      return;
    }

    const url = `${base}/openai/deployments/${deploymentId}/chat/completions?api-version=${apiVersion}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'test' }],
        max_tokens: 1,
      }),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Azure API error: ${response.status} ${response.statusText}${body ? ` — ${body}` : ''}`);
    }
  }

  /** Lightweight connection test — sends a minimal request to the deployment endpoint. */
  async testConnection(): Promise<void> {
    const url = this.chatCompletionsUrl();
    logger.debug(`Testing connection to ${url}`);
    const response = await fetch(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        ...(this.v1Api ? { model: this.model } : {}),
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
    const url = this.chatCompletionsUrl();

    logger.debug(`Azure API request to ${url}`);

    const response = await fetch(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        ...request,
        ...(this.v1Api ? { model: this.model } : {}),
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
    const url = this.chatCompletionsUrl();

    logger.debug(`Azure API streaming request to ${url}`);

    const response = await fetch(url, {
      method: 'POST',
      headers: this.getHeaders(true),
      body: JSON.stringify({
        ...request,
        ...(this.v1Api ? { model: this.model } : {}),
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
    const url = this.deploymentsListUrl();

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

    const data = (await response.json()) as {
      data?: Array<{ id: string; model?: string }>;
    };

    const deployments = data.data ?? [];
    return deployments.map((d) => ({
      id: d.id,
      name: d.model ?? d.id,
      capabilities: ['chat'],
    }));
  }
}
