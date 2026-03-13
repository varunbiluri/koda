import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AzureAIProvider } from '../../src/ai/providers/azure-provider.js';
import type { AIConfig, ChatCompletionResponse } from '../../src/ai/types.js';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch as any;

describe('AzureAIProvider', () => {
  const config: AIConfig = {
    provider: 'azure',
    endpoint: 'https://test.openai.azure.com',
    apiKey: 'test-key',
    model: 'gpt-4',
  };

  beforeEach(() => {
    mockFetch.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('constructs with correct configuration', () => {
    const provider = new AzureAIProvider(config);
    expect(provider).toBeDefined();
  });

  it('sends chat completion requests', async () => {
    const mockResponse: ChatCompletionResponse = {
      id: 'test-id',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'Test response' },
          finish_reason: 'stop',
        },
      ],
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const provider = new AzureAIProvider(config);
    const result = await provider.sendChatCompletion({
      messages: [{ role: 'user', content: 'Hello' }],
    });

    expect(result.choices[0].message.content).toBe('Test response');
    expect(mockFetch).toHaveBeenCalledOnce();

    // Verify request structure
    const callArgs = mockFetch.mock.calls[0];
    expect(callArgs[0]).toContain('openai/deployments/gpt-4/chat/completions');
    expect(callArgs[1].method).toBe('POST');
    expect(callArgs[1].headers['api-key']).toBe('test-key');
  });

  it('handles API errors gracefully', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => 'Invalid API key',
    });

    const provider = new AzureAIProvider(config);

    await expect(
      provider.sendChatCompletion({
        messages: [{ role: 'user', content: 'Hello' }],
      }),
    ).rejects.toThrow('Azure API request failed');
  });

  it('lists models from deployments endpoint', async () => {
    const mockDeployments = {
      data: [
        { id: 'gpt-4', model: 'gpt-4-0613' },
        { id: 'gpt-35-turbo', model: 'gpt-35-turbo-16k' },
      ],
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockDeployments,
    });

    const provider = new AzureAIProvider(config);
    const models = await provider.listModels();

    expect(models).toHaveLength(2);
    expect(models[0].id).toBe('gpt-4');
    expect(models[0].name).toBe('gpt-4-0613');
    expect(models[1].id).toBe('gpt-35-turbo');
  });

  it('uses correct API version', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [] }),
    });

    const provider = new AzureAIProvider(config);
    await provider.sendChatCompletion({
      messages: [{ role: 'user', content: 'test' }],
    });

    const callArgs = mockFetch.mock.calls[0];
    expect(callArgs[0]).toContain('api-version=2024-05-01-preview');
  });

  it('allows custom API version', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [] }),
    });

    const customConfig = { ...config, apiVersion: '2023-12-01' };
    const provider = new AzureAIProvider(customConfig);
    await provider.sendChatCompletion({
      messages: [{ role: 'user', content: 'test' }],
    });

    const callArgs = mockFetch.mock.calls[0];
    expect(callArgs[0]).toContain('api-version=2023-12-01');
  });
});
