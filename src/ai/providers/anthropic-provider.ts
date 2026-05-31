import type {
  AIProvider,
  AIConfig,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatMessage,
  ModelInfo,
  ToolCall,
  ToolDefinitionForAI,
} from '../types.js';
import { logger } from '../../utils/logger.js';

const ANTHROPIC_VERSION = '2023-06-01';

type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string };

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

interface AnthropicResponse {
  id: string;
  type: string;
  role: string;
  content: AnthropicContentBlock[];
  stop_reason: string | null;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

/**
 * Converts tool definitions into Anthropic-compatible tool descriptors.
 *
 * @param tools - Optional array of tool definitions provided to the AI.
 * @returns An array of objects each containing `name`, `description`, and `input_schema` for Anthropic, or `undefined` when `tools` is empty or not provided.
 */
function toAnthropicTools(tools?: ToolDefinitionForAI[]): Array<{
  name: string;
  description: string;
  input_schema: object;
}> | undefined {
  if (!tools?.length) return undefined;
  return tools.map((t) => ({
    name:         t.function.name,
    description:  t.function.description,
    input_schema: t.function.parameters,
  }));
}

/**
 * Convert internal chat messages into Anthropic-compatible system text and message blocks.
 *
 * The function concatenates `system`-role contents into a single system string (separated by double newlines), batches consecutive tool result messages into `tool_result` content blocks emitted as a user message, preserves user messages as Anthropic `user` messages, and represents assistant content and assistant tool calls as `text` and `tool_use` content blocks respectively.
 *
 * @param messages - Array of internal `ChatMessage` objects to transform
 * @returns An object with an optional `system` string and a `messages` array of `AnthropicMessage` ready for the Anthropic API
 */
function toAnthropicMessages(messages: ChatMessage[]): {
  system?: string;
  messages: AnthropicMessage[];
} {
  const systemParts: string[] = [];
  const out: AnthropicMessage[] = [];
  let pendingToolResults: AnthropicContentBlock[] = [];

  const flushToolResults = (): void => {
    if (pendingToolResults.length === 0) return;
    out.push({ role: 'user', content: pendingToolResults });
    pendingToolResults = [];
  };

  for (const msg of messages) {
    if (msg.role === 'system') {
      if (msg.content) systemParts.push(msg.content);
      continue;
    }

    if (msg.role === 'tool') {
      pendingToolResults.push({
        type:         'tool_result',
        tool_use_id:  msg.tool_call_id ?? '',
        content:      msg.content ?? '',
      });
      continue;
    }

    flushToolResults();

    if (msg.role === 'user') {
      out.push({ role: 'user', content: msg.content ?? '' });
      continue;
    }

    if (msg.role === 'assistant') {
      const blocks: AnthropicContentBlock[] = [];
      if (msg.content) blocks.push({ type: 'text', text: msg.content });
      for (const tc of msg.tool_calls ?? []) {
        let input: Record<string, unknown> = {};
        try {
          input = JSON.parse(tc.function.arguments || '{}') as Record<string, unknown>;
        } catch {
          // empty input
        }
        blocks.push({
          type:  'tool_use',
          id:    tc.id,
          name:  tc.function.name,
          input,
        });
      }
      out.push({
        role:    'assistant',
        content: blocks.length ? blocks : (msg.content ?? ''),
      });
    }
  }

  flushToolResults();
  return { system: systemParts.join('\n\n') || undefined, messages: out };
}

/**
 * Convert an Anthropic /v1/messages response into the local ChatCompletionResponse shape.
 *
 * @param data - The Anthropic response object to convert.
 * @returns A ChatCompletionResponse containing a single assistant choice with any extracted text, tool calls (if present), mapped finish reason, and token usage when available.
 */
function fromAnthropicResponse(data: AnthropicResponse): ChatCompletionResponse {
  const toolCalls: ToolCall[] = [];
  let textContent = '';

  for (const block of data.content) {
    if (block.type === 'text') textContent += block.text;
    if (block.type === 'tool_use') {
      toolCalls.push({
        id:   block.id,
        type: 'function',
        function: {
          name:      block.name,
          arguments: JSON.stringify(block.input ?? {}),
        },
      });
    }
  }

  const message: ChatMessage = {
    role:    'assistant',
    content: toolCalls.length ? (textContent || null) : textContent,
    ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
  };

  const finishReason =
    data.stop_reason === 'tool_use' ? 'tool_calls' : (data.stop_reason ?? 'stop');

  return {
    id: data.id,
    choices: [{ index: 0, message, finish_reason: finishReason }],
    usage: data.usage
      ? {
          prompt_tokens:     data.usage.input_tokens,
          completion_tokens: data.usage.output_tokens,
          total_tokens:      data.usage.input_tokens + data.usage.output_tokens,
        }
      : undefined,
  };
}

export class AnthropicProvider implements AIProvider {
  static readonly defaultEndpoint = 'https://api.anthropic.com';

  private baseUrl: string;
  private apiKey: string;
  private model: string;

  constructor(config: AIConfig) {
    this.baseUrl = (config.endpoint || AnthropicProvider.defaultEndpoint).replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.model = config.model;
  }

  private messagesUrl(): string {
    return `${this.baseUrl}/v1/messages`;
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type':      'application/json',
      'x-api-key':         this.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    };
  }

  /** Fetch models from Anthropic /v1/models. */
  static async fetchModels(apiKey: string, endpoint?: string): Promise<ModelInfo[]> {
    const base = (endpoint || AnthropicProvider.defaultEndpoint).replace(/\/$/, '');
    const response = await fetch(`${base}/v1/models`, {
      headers: {
        'x-api-key':         apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
    });
    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.status} ${response.statusText}`);
    }
    const data = (await response.json()) as { data?: Array<{ id: string; display_name?: string }> };
    return (data.data ?? []).map((m) => ({
      id:           m.id,
      name:         m.display_name ?? m.id,
      capabilities: ['chat'],
    }));
  }

  async testConnection(): Promise<void> {
    await this.sendChatCompletion({
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 1,
    });
  }

  async sendChatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const { system, messages } = toAnthropicMessages(request.messages);
    const tools = toAnthropicTools(request.tools);

    const body: Record<string, unknown> = {
      model:      this.model,
      max_tokens: request.max_tokens ?? 4096,
      messages,
    };
    if (system) body.system = system;
    if (tools?.length) body.tools = tools;
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.tool_choice === 'none') {
      body.tool_choice = { type: 'none' };
    } else if (request.tool_choice === 'required') {
      body.tool_choice = { type: 'any' };
    } else if (tools?.length) {
      body.tool_choice = { type: 'auto' };
    }

    logger.debug(`Anthropic API request to ${this.messagesUrl()}`);

    const response = await fetch(this.messagesUrl(), {
      method:  'POST',
      headers: this.headers(),
      body:    JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`Anthropic API error: ${response.status} ${errorText}`);
      throw new Error(`Anthropic API request failed: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as AnthropicResponse;
    return fromAnthropicResponse(data);
  }

  async streamChatCompletion(
    request: ChatCompletionRequest,
    onChunk: (chunk: string) => void,
  ): Promise<void> {
    // Tool calls use non-streaming path; text-only requests stream deltas.
    if (request.tools?.length) {
      const result = await this.sendChatCompletion({ ...request, stream: false });
      const content = result.choices[0]?.message?.content;
      if (content) onChunk(content);
      return;
    }

    const { system, messages } = toAnthropicMessages(request.messages);

    const response = await fetch(this.messagesUrl(), {
      method:  'POST',
      headers: { ...this.headers(), Accept: 'text/event-stream' },
      body:    JSON.stringify({
        model:      this.model,
        max_tokens: request.max_tokens ?? 4096,
        messages,
        system,
        stream:     true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Anthropic API request failed: ${response.status} ${errorText}`);
    }

    if (!response.body) throw new Error('Response body is null');

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
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (!payload || payload === '[DONE]') continue;
          try {
            const event = JSON.parse(payload) as {
              type?: string;
              delta?: { type?: string; text?: string };
            };
            if (event.type === 'content_block_delta' && event.delta?.text) {
              onChunk(event.delta.text);
            }
          } catch {
            // ignore malformed events
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    return AnthropicProvider.fetchModels(this.apiKey, this.baseUrl);
  }
}
