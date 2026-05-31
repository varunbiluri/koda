/**
 * Multi-provider setup wizard — Azure, OpenAI, Anthropic, Ollama.
 */

import prompts from 'prompts';
import chalk from 'chalk';
import type { Ora } from 'ora';
import { saveConfig } from '../config-store.js';
import type { AIConfig } from '../types.js';
import {
  AzureAIProvider,
  type DeploymentInfo,
} from './azure-provider.js';
import { OpenAIProvider } from './openai-provider.js';
import { AnthropicProvider } from './anthropic-provider.js';
import { OllamaProvider, OLLAMA_DEFAULT_ENDPOINT } from './ollama-provider.js';
import { createProvider } from './provider-factory.js';

export interface SetupWizardUI {
  renderSetupHeader(): void;
  renderError(message: string, hint?: string): void;
  renderInfo(message: string): void;
  renderThinking(): Ora;
  stopSpinner(success: boolean, message?: string): void;
}

const PROVIDER_CHOICES = [
  { title: 'Azure OpenAI', value: 'azure' as const },
  { title: 'OpenAI', value: 'openai' as const },
  { title: 'Anthropic', value: 'anthropic' as const },
  { title: 'Ollama (local, free)', value: 'ollama' as const },
];

/**
 * Run an interactive setup wizard to configure an AI provider.
 *
 * @returns `true` when a provider is successfully configured and saved, `false` otherwise.
 */
export async function runProviderSetup(ui: SetupWizardUI): Promise<boolean> {
  ui.renderSetupHeader();
  prompts.override({});

  const { provider } = await prompts({
    type:   'select',
    name:   'provider',
    message: 'Select AI provider',
    choices: PROVIDER_CHOICES,
  });

  if (!provider) {
    ui.renderError('Setup cancelled.');
    return false;
  }

  switch (provider) {
    case 'azure':
      return setupAzure(ui);
    case 'openai':
      return setupOpenAI(ui);
    case 'anthropic':
      return setupAnthropic(ui);
    case 'ollama':
      return setupOllama(ui);
    default:
      ui.renderError('Unknown provider.');
      return false;
  }
}

/**
 * Interactively collect an Azure endpoint and API key, fetch chat-capable deployments, validate a selected deployment, and persist the Azure provider configuration.
 *
 * @param ui - UI callbacks for rendering prompts, spinners, and messages during the interactive setup
 * @returns `true` if the provider was successfully configured and saved, `false` otherwise
 */

async function setupAzure(ui: SetupWizardUI): Promise<boolean> {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { endpoint } = await prompts({
      type:     'text',
      name:     'endpoint',
      message:  'Azure endpoint',
      hint:     'e.g. https://your-resource.openai.azure.com',
      validate: (v: string) =>
        v.startsWith('https://') ? true : 'Endpoint must start with https://',
    });
    if (!endpoint) {
      ui.renderError('Setup cancelled.');
      return false;
    }

    const { apiKey } = await prompts({
      type:    'password',
      name:    'apiKey',
      message: 'API key',
    });
    if (!apiKey) {
      ui.renderError('Setup cancelled.');
      return false;
    }

    const cleanEndpoint = endpoint.replace(/\/$/, '');
    console.log();
    const fetchSpinner = ui.renderThinking();
    fetchSpinner.text = 'Fetching deployments…';

    let allDeployments: DeploymentInfo[];
    try {
      allDeployments = await AzureAIProvider.fetchDeployments(cleanEndpoint, apiKey);
      ui.stopSpinner(true);
    } catch {
      ui.stopSpinner(false, 'Azure connection failed');
      console.log();
      const { retry } = await prompts({
        type:    'confirm',
        name:    'retry',
        message: 'Retry setup?',
        initial: true,
      });
      if (retry) {
        console.log();
        continue;
      }
      return false;
    }

    if (allDeployments.length === 0) {
      ui.renderError('No deployments found in this Azure resource.');
      return false;
    }

    const deployments = AzureAIProvider.filterChatCompatible(allDeployments);
    if (deployments.length === 0) {
      console.log();
      console.log(`  ${chalk.red('✖')}  No compatible chat models found.`);
      console.log(`  Create a deployment using ${chalk.cyan('gpt-4o')} or ${chalk.cyan('gpt-4o-mini')}.`);
      console.log();
      return false;
    }

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { deployment } = await prompts({
        type:    'select',
        name:    'deployment',
        message: 'Select a model deployment',
        choices: deployments.map((d) => ({
          title: `${d.id} (${d.model})`,
          value: d.id,
        })),
      });
      if (!deployment) {
        ui.renderError('Setup cancelled.');
        return false;
      }

      console.log();
      const validateSpinner = ui.renderThinking();
      validateSpinner.text = 'Validating deployment…';

      try {
        await AzureAIProvider.validateChatDeployment(cleanEndpoint, apiKey, deployment);
        ui.stopSpinner(true);
      } catch {
        ui.stopSpinner(false, 'Selected model does not support chat completions.');
        const { retryModel } = await prompts({
          type:    'confirm',
          name:    'retryModel',
          message: 'Retry model selection?',
          initial: true,
        });
        if (retryModel) continue;
        return false;
      }

      await saveConfig({
        provider:   'azure',
        endpoint:   cleanEndpoint,
        apiKey,
        model:      deployment,
        apiVersion: '2024-05-01-preview',
      });

      console.log();
      console.log(`  ${chalk.green('✔')} Azure connection successful`);
      console.log(`  ${chalk.green('✔')} Model: ${chalk.cyan(deployment)}`);
      console.log();
      return true;
    }
  }
}

/**
 * Run the OpenAI provider setup flow: collect credentials and endpoint, fetch available models, prompt for a model if needed, validate the selection, and persist the resulting configuration.
 *
 * @returns `true` if the provider was successfully configured and saved, `false` otherwise.
 */

async function setupOpenAI(ui: SetupWizardUI): Promise<boolean> {
  const { apiKey } = await prompts({
    type:    'password',
    name:    'apiKey',
    message: 'OpenAI API key',
  });
  if (!apiKey) {
    ui.renderError('Setup cancelled.');
    return false;
  }

  const { endpoint } = await prompts({
    type:    'text',
    name:    'endpoint',
    message: 'API endpoint (optional)',
    initial: OpenAIProvider.defaultEndpoint,
  });

  const cleanEndpoint = (endpoint || OpenAIProvider.defaultEndpoint).replace(/\/$/, '');

  console.log();
  const spinner = ui.renderThinking();
  spinner.text = 'Fetching models…';

  let models;
  try {
    models = await OpenAIProvider.fetchModels(apiKey, cleanEndpoint);
    ui.stopSpinner(true);
  } catch {
    ui.stopSpinner(false, 'OpenAI connection failed');
    ui.renderError('Could not connect. Check your API key and endpoint.');
    return false;
  }

  if (models.length === 0) {
    const { model } = await prompts({
      type:    'text',
      name:    'model',
      message: 'Model name',
      initial: 'gpt-4o',
    });
    if (!model) return false;
    return saveAndValidate(ui, {
      provider: 'openai',
      endpoint: cleanEndpoint,
      apiKey,
      model,
    });
  }

  const { model } = await prompts({
    type:    'select',
    name:    'model',
    message: 'Select a model',
    choices: models.slice(0, 30).map((m) => ({ title: m.name, value: m.id })),
  });
  if (!model) {
    ui.renderError('Setup cancelled.');
    return false;
  }

  return saveAndValidate(ui, {
    provider: 'openai',
    endpoint: cleanEndpoint,
    apiKey,
    model,
  });
}

/**
 * Configure the Anthropic provider by collecting credentials and a model, validating the selection, and saving the configuration.
 *
 * Prompts the user for an API key and optional endpoint, retrieves available models (or asks for a model name if none are returned), and then validates and persists the resulting configuration.
 *
 * @returns `true` if the provider was successfully configured and saved, `false` otherwise.
 */

async function setupAnthropic(ui: SetupWizardUI): Promise<boolean> {
  const { apiKey } = await prompts({
    type:    'password',
    name:    'apiKey',
    message: 'Anthropic API key',
  });
  if (!apiKey) {
    ui.renderError('Setup cancelled.');
    return false;
  }

  const { endpoint } = await prompts({
    type:    'text',
    name:    'endpoint',
    message: 'API endpoint (optional)',
    initial: AnthropicProvider.defaultEndpoint,
  });

  const cleanEndpoint = (endpoint || AnthropicProvider.defaultEndpoint).replace(/\/$/, '');

  console.log();
  const spinner = ui.renderThinking();
  spinner.text = 'Fetching models…';

  let models;
  try {
    models = await AnthropicProvider.fetchModels(apiKey, cleanEndpoint);
    ui.stopSpinner(true);
  } catch {
    ui.stopSpinner(false, 'Anthropic connection failed');
    ui.renderError('Could not connect. Check your API key.');
    return false;
  }

  let model: string;
  if (models.length === 0) {
    const result = await prompts({
      type:    'text',
      name:    'model',
      message: 'Model name',
      initial: 'claude-sonnet-4-20250514',
    });
    if (!result.model) return false;
    model = result.model;
  } else {
    const result = await prompts({
      type:    'select',
      name:    'model',
      message: 'Select a model',
      choices: models.slice(0, 30).map((m) => ({ title: m.name, value: m.id })),
    });
    if (!result.model) {
      ui.renderError('Setup cancelled.');
      return false;
    }
    model = result.model;
  }

  return saveAndValidate(ui, {
    provider: 'anthropic',
    endpoint: cleanEndpoint,
    apiKey,
    model,
  });
}

/**
 * Guides the user through configuring an Ollama provider.
 *
 * Prompts for an Ollama endpoint, fetches local models from that endpoint, asks the user to select a model, and then validates and persists the chosen configuration.
 *
 * @returns `true` if the Ollama provider was configured and saved, `false` otherwise.
 */

async function setupOllama(ui: SetupWizardUI): Promise<boolean> {
  const { endpoint } = await prompts({
    type:    'text',
    name:    'endpoint',
    message: 'Ollama endpoint',
    initial: OLLAMA_DEFAULT_ENDPOINT,
  });
  if (!endpoint) {
    ui.renderError('Setup cancelled.');
    return false;
  }

  const cleanEndpoint = endpoint.replace(/\/$/, '');

  console.log();
  const spinner = ui.renderThinking();
  spinner.text = 'Fetching local models…';

  let models;
  try {
    models = await OllamaProvider.fetchModels(cleanEndpoint);
    ui.stopSpinner(true);
  } catch {
    ui.stopSpinner(false, 'Ollama connection failed');
    ui.renderError(
      'Could not connect to Ollama.',
      'Start Ollama and run `ollama pull llama3` first.',
    );
    return false;
  }

  if (models.length === 0) {
    ui.renderError('No models found.', 'Run `ollama pull llama3` then retry.');
    return false;
  }

  const { model } = await prompts({
    type:    'select',
    name:    'model',
    message: 'Select a local model',
    choices: models.map((m) => ({ title: m.name, value: m.id })),
  });
  if (!model) {
    ui.renderError('Setup cancelled.');
    return false;
  }

  return saveAndValidate(ui, {
    provider: 'ollama',
    endpoint: cleanEndpoint,
    apiKey:   'ollama',
    model,
  });
}

/**
 * Validate the provided AI configuration by testing the provider connection, then persist it.
 *
 * Shows a spinner while testing connectivity, renders errors on failure, and saves the configuration on success.
 *
 * @param ui - UI helper used for progress display, spinners, and error/info rendering
 * @param config - AI configuration to validate and save (provider, endpoint/key, model, etc.)
 * @returns `true` if the connection test succeeded and the configuration was saved, `false` otherwise.
 */
async function saveAndValidate(ui: SetupWizardUI, config: AIConfig): Promise<boolean> {
  console.log();
  const spinner = ui.renderThinking();
  spinner.text = 'Validating connection…';

  try {
    const provider = createProvider(config);
    await provider.testConnection();
    ui.stopSpinner(true);
  } catch (err) {
    ui.stopSpinner(false, 'Connection test failed');
    ui.renderError((err as Error).message);
    return false;
  }

  await saveConfig(config);

  console.log();
  console.log(`  ${chalk.green('✔')} ${config.provider} configured`);
  console.log(`  ${chalk.green('✔')} Model: ${chalk.cyan(config.model)}`);
  console.log();
  return true;
}
