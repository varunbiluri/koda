import type { AIProvider, AIConfig } from '../types.js';
import { loadConfig } from '../config-store.js';
import { AzureAIProvider } from './azure-provider.js';
import { OpenAIProvider } from './openai-provider.js';
import { AnthropicProvider } from './anthropic-provider.js';
import { OllamaProvider } from './ollama-provider.js';

/**
 * Create an AI provider implementation based on the provided configuration.
 *
 * @param config - Configuration object whose `provider` field selects which AI provider to instantiate.
 * @returns An `AIProvider` instance corresponding to `config.provider`.
 * @throws Error if `config.provider` is not a recognized provider (message: `Unknown provider: <provider>`).
 */
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

/**
 * Load persisted AI configuration and instantiate the corresponding AIProvider.
 *
 * @returns The constructed AIProvider based on the loaded configuration
 */
export async function loadProvider(): Promise<AIProvider> {
  const config = await loadConfig();
  return createProvider(config);
}
