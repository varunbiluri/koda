import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createProvider } from '../../src/ai/providers/provider-factory.js';
import { OpenAIProvider } from '../../src/ai/providers/openai-provider.js';
import { AnthropicProvider } from '../../src/ai/providers/anthropic-provider.js';
import { OllamaProvider } from '../../src/ai/providers/ollama-provider.js';
import { AzureAIProvider } from '../../src/ai/providers/azure-provider.js';
import type { AIConfig, ChatCompletionResponse } from '../../src/ai/types.js';

const mockFetch = vi.fn();
global.fetch = mockFetch as typeof fetch;

describe('createProvider', () => {
  it('returns Azure provider', () => {
    const p = createProvider({
      provider: 'azure',
      endpoint: 'https://x.openai.azure.com',
      apiKey:   'k',
      model:    'gpt-4o',
    });
    expect(p).toBeInstanceOf(AzureAIProvider);
  });

  it('returns OpenAI provider', () => {
    const p = createProvider({
      provider: 'openai',
      endpoint: 'https://api.openai.com/v1',
      apiKey:   'k',
      model:    'gpt-4o',
    });
    expect(p).toBeInstanceOf(OpenAIProvider);
  });

  it('returns Anthropic provider', () => {
    const p = createProvider({
      provider: 'anthropic',
      endpoint: 'https://api.anthropic.com',
      apiKey:   'k',
      model:    'claude-sonnet-4-20250514',
    });
    expect(p).toBeInstanceOf(AnthropicProvider);
  });

  it('returns Ollama provider', () => {
    const p = createProvider({
      provider: 'ollama',
      endpoint: 'http://localhost:11434/v1',
      apiKey:   'ollama',
      model:    'llama3',
    });
    expect(p).toBeInstanceOf(OllamaProvider);
  });
});

describe('OpenAIProvider', () => {
  beforeEach(() => mockFetch.mockClear());

  it('sends chat completion to /chat/completions', async () => {
    const response: ChatCompletionResponse = {
      id: 'id',
      choices: [{
        index: 0,
        message: { role: 'assistant', content: 'hi' },
        finish_reason: 'stop',
      }],
    };
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => response });

    const provider = new OpenAIProvider({
      provider: 'openai',
      endpoint: 'https://api.openai.com/v1',
      apiKey:   'sk-test',
      model:    'gpt-4o',
    });

    const result = await provider.sendChatCompletion({
      messages: [{ role: 'user', content: 'Hello' }],
    });

    expect(result.choices[0].message.content).toBe('hi');
    expect(mockFetch.mock.calls[0][0]).toBe('https://api.openai.com/v1/chat/completions');
    expect(mockFetch.mock.calls[0][1].headers.Authorization).toBe('Bearer sk-test');
  });
});

describe('AnthropicProvider', () => {
  beforeEach(() => mockFetch.mockClear());

  it('converts tool_use responses to OpenAI tool_calls format', async () => {
    mockFetch.mockResolvedValueOnce({
      ok:   true,
      json: async () => ({
        id:          'msg_1',
        type:        'message',
        role:        'assistant',
        content: [{
          type:  'tool_use',
          id:    'toolu_1',
          name:  'read_file',
          input: { path: 'src/index.ts' },
        }],
        stop_reason: 'tool_use',
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    });

    const provider = new AnthropicProvider({
      provider: 'anthropic',
      endpoint: 'https://api.anthropic.com',
      apiKey:   'sk-ant',
      model:    'claude-sonnet-4-20250514',
    });

    const result = await provider.sendChatCompletion({
      messages: [{ role: 'user', content: 'read index' }],
      tools: [{
        type: 'function',
        function: {
          name:        'read_file',
          description: 'Read file',
          parameters:  { type: 'object', properties: {} },
        },
      }],
    });

    const tc = result.choices[0].message.tool_calls?.[0];
    expect(tc?.function.name).toBe('read_file');
    expect(JSON.parse(tc?.function.arguments ?? '{}')).toEqual({ path: 'src/index.ts' });
    expect(result.choices[0].finish_reason).toBe('tool_calls');
  });
});

describe('OllamaProvider', () => {
  beforeEach(() => mockFetch.mockClear());

  it('lists models from /api/tags', async () => {
    mockFetch.mockResolvedValueOnce({
      ok:   true,
      json: async () => ({ models: [{ name: 'llama3' }, { name: 'mistral' }] }),
    });

    const models = await OllamaProvider.fetchModels('http://localhost:11434/v1');
    expect(models.map((m) => m.id)).toEqual(['llama3', 'mistral']);
    expect(mockFetch.mock.calls[0][0]).toBe('http://localhost:11434/api/tags');
  });
});
