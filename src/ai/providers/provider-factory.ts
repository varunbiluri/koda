import type { AIProvider, AIConfig } from '../types.js';
import { loadConfig } from '../config-store.js';
import { AzureAIProvider } from './azure-provider.js';
import { OpenAIProvider } from './openai-provider.js';
import { AnthropicProvider } from './anthropic-provider.js';
import { OllamaProvider } from './ollama-provider.js';

/** Create the AI provider for the given config. */
export function createProvider(config: AIConfig): AIProvider {
  switch (config.provider) {
    case 'azure':
      return new AzureAIProvider(config);
    case 'openai':
      return new OpenAIProvider(config);
    case 'anthropic':
      return new AnthropicProvider(config);
    case 'ollama':
      return new OllamaProvider(config);
    default:
      throw new Error(`Unknown provider: ${String((config as AIConfig).provider)}`);
  }
}

/** Load config from disk and return the matching provider. */
export async function loadProvider(): Promise<AIProvider> {
  const config = await loadConfig();
  return createProvider(config);
}
