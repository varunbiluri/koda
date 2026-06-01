import { configExists, loadConfig, saveConfig } from '../ai/config-store.js';
import type { AIConfig } from '../ai/types.js';
import { createProvider } from '../ai/providers/provider-factory.js';
import {
  AzureAIProvider,
  type DeploymentInfo,
} from '../ai/providers/azure-provider.js';
import { OpenAIProvider } from '../ai/providers/openai-provider.js';
import { AnthropicProvider } from '../ai/providers/anthropic-provider.js';
import { OllamaProvider, OLLAMA_DEFAULT_ENDPOINT } from '../ai/providers/ollama-provider.js';

export interface ConfigStatus {
  configured: boolean;
  provider?: AIConfig['provider'];
  model?: string;
  endpoint?: string;
  apiVersion?: string;
}

export interface ModelOption {
  id: string;
  name: string;
}

function maskEndpoint(endpoint: string): string {
  try {
    const u = new URL(endpoint);
    return `${u.protocol}//${u.hostname}${u.pathname !== '/' ? '/…' : ''}`;
  } catch {
    return 'configured';
  }
}

export async function getConfigStatus(): Promise<ConfigStatus> {
  const exists = await configExists();
  if (!exists) return { configured: false };

  try {
    const cfg = await loadConfig();
    return {
      configured: true,
      provider: cfg.provider,
      model: cfg.model,
      endpoint: maskEndpoint(cfg.endpoint),
      apiVersion: cfg.apiVersion,
    };
  } catch {
    return { configured: false };
  }
}

export async function fetchAzureDeployments(
  endpoint: string,
  apiKey: string,
): Promise<DeploymentInfo[]> {
  const clean = endpoint.replace(/\/$/, '');
  const all = await AzureAIProvider.fetchDeployments(clean, apiKey);
  return AzureAIProvider.filterChatCompatible(all, clean);
}

export async function fetchOpenAIModels(
  apiKey: string,
  endpoint?: string,
): Promise<ModelOption[]> {
  const ep = (endpoint || OpenAIProvider.defaultEndpoint).replace(/\/$/, '');
  const models = await OpenAIProvider.fetchModels(apiKey, ep);
  return models.slice(0, 40).map((m) => ({ id: m.id, name: m.name }));
}

export async function fetchAnthropicModels(
  apiKey: string,
  endpoint?: string,
): Promise<ModelOption[]> {
  const ep = (endpoint || AnthropicProvider.defaultEndpoint).replace(/\/$/, '');
  const models = await AnthropicProvider.fetchModels(apiKey, ep);
  return models.slice(0, 40).map((m) => ({ id: m.id, name: m.name }));
}

export async function fetchOllamaModels(endpoint?: string): Promise<ModelOption[]> {
  const ep = (endpoint || OLLAMA_DEFAULT_ENDPOINT).replace(/\/$/, '');
  const models = await OllamaProvider.fetchModels(ep);
  return models.map((m) => ({ id: m.id, name: m.name }));
}

export function normalizeConfig(input: Partial<AIConfig>): AIConfig {
  const provider = input.provider;
  if (!provider) throw new Error('Provider is required');

  const model = input.model?.trim();
  if (!model) throw new Error('Model is required');

  switch (provider) {
    case 'azure': {
      const endpoint = input.endpoint?.trim().replace(/\/$/, '');
      const apiKey = input.apiKey?.trim();
      if (!endpoint?.startsWith('https://')) throw new Error('Valid Azure endpoint required');
      if (!apiKey) throw new Error('API key is required');
      return {
        provider: 'azure',
        endpoint,
        apiKey,
        model,
        apiVersion: input.apiVersion ?? '2024-05-01-preview',
      };
    }
    case 'openai': {
      const apiKey = input.apiKey?.trim();
      if (!apiKey) throw new Error('API key is required');
      return {
        provider: 'openai',
        endpoint: (input.endpoint || OpenAIProvider.defaultEndpoint).replace(/\/$/, ''),
        apiKey,
        model,
      };
    }
    case 'anthropic': {
      const apiKey = input.apiKey?.trim();
      if (!apiKey) throw new Error('API key is required');
      return {
        provider: 'anthropic',
        endpoint: (input.endpoint || AnthropicProvider.defaultEndpoint).replace(/\/$/, ''),
        apiKey,
        model,
      };
    }
    case 'ollama': {
      return {
        provider: 'ollama',
        endpoint: (input.endpoint || OLLAMA_DEFAULT_ENDPOINT).replace(/\/$/, ''),
        apiKey: 'ollama',
        model,
      };
    }
    default:
      throw new Error(`Unknown provider: ${provider as string}`);
  }
}

export async function saveAndValidateConfig(input: Partial<AIConfig>): Promise<ConfigStatus> {
  const config = normalizeConfig(input);

  if (config.provider === 'azure') {
    await AzureAIProvider.validateChatDeployment(
      config.endpoint,
      config.apiKey,
      config.model,
    );
  } else {
    const provider = createProvider(config);
    await provider.testConnection();
  }

  await saveConfig(config);
  return getConfigStatus();
}
