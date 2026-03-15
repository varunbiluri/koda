import type { AIProvider, AIConfig } from '../types.js';
import { AzureAIProvider } from './azure-provider.js';

/**
 * Return the appropriate AIProvider implementation for the given config.
 *
 * Currently only Azure is fully implemented. Stubs for openai, anthropic,
 * and ollama are present as a migration skeleton.
 */
export function createProvider(config: AIConfig): AIProvider {
  switch (config.provider) {
    case 'azure':
      return new AzureAIProvider(config);

    // case 'openai':
    //   throw new Error('Provider not yet implemented: openai');

    // case 'anthropic':
    //   throw new Error('Provider not yet implemented: anthropic');

    // case 'ollama':
    //   throw new Error('Provider not yet implemented: ollama');

    default:
      throw new Error(`Provider not yet implemented: ${String(config.provider)}`);
  }
}
