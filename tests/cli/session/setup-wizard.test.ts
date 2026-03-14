/**
 * Tests for the improved setup wizard:
 *  - Deployment fetch from Azure API
 *  - Arrow-key selection via prompts
 *  - Retry logic on connection failure
 *  - Hidden API key input (password type)
 *  - Config saved with correct shape
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionManager } from '../../../src/cli/session/session-manager.js';
import { UIRenderer } from '../../../src/cli/session/ui-renderer.js';
import { ConversationEngine } from '../../../src/cli/session/conversation-engine.js';

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('prompts', () => {
  const fn = vi.fn();
  (fn as unknown as { override: ReturnType<typeof vi.fn> }).override = vi.fn();
  return { default: fn };
});

vi.mock('../../../src/ai/providers/azure-provider.js', () => {
  class AzureAIProvider {
    static fetchDeployments = vi.fn();
    testConnection = vi.fn();
    listModels = vi.fn();
  }
  return { AzureAIProvider };
});

vi.mock('../../../src/ai/config-store.js', () => ({
  configExists: vi.fn().mockResolvedValue(false),
  loadConfig: vi.fn().mockResolvedValue({
    provider: 'azure',
    endpoint: 'https://test.openai.azure.com',
    apiKey: 'k',
    model: 'gpt-4o',
  }),
  saveConfig: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/store/index-store.js', () => ({
  loadIndex: vi.fn().mockRejectedValue(new Error('no index')),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeUI(): UIRenderer {
  return {
    renderHeader: vi.fn(),
    renderWelcome: vi.fn(),
    renderPrompt: vi.fn(),
    renderThinking: vi.fn().mockReturnValue({
      text: '',
      isSpinning: false,
      stop: vi.fn(),
      succeed: vi.fn(),
      fail: vi.fn(),
    }),
    renderStage: vi.fn(),
    stopSpinner: vi.fn(),
    renderResponse: vi.fn(),
    renderStreamChunk: vi.fn(),
    renderStreamEnd: vi.fn(),
    renderPlan: vi.fn(),
    renderPatchPreview: vi.fn(),
    renderError: vi.fn(),
    renderInfo: vi.fn(),
    renderSuccess: vi.fn(),
    renderHelp: vi.fn(),
    renderSetupHeader: vi.fn(),
    renderDivider: vi.fn(),
    renderMeta: vi.fn(),
  } as unknown as UIRenderer;
}

function makeEngine(): ConversationEngine {
  return {
    process: vi.fn().mockResolvedValue({ handled: true, shouldQuit: false }),
  } as unknown as ConversationEngine;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AzureAIProvider.fetchDeployments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns deployment IDs from Azure API response', async () => {
    const { AzureAIProvider } = await import('../../../src/ai/providers/azure-provider.js');

    vi.mocked(AzureAIProvider.fetchDeployments).mockResolvedValue(['gpt-4o', 'gpt-5.1-codex-mini']);

    const ids = await AzureAIProvider.fetchDeployments('https://test.openai.azure.com', 'key');
    expect(ids).toEqual(['gpt-4o', 'gpt-5.1-codex-mini']);
  });

  it('throws on non-OK HTTP response', async () => {
    const { AzureAIProvider } = await import('../../../src/ai/providers/azure-provider.js');

    vi.mocked(AzureAIProvider.fetchDeployments).mockRejectedValue(
      new Error('Azure API error: 401 Unauthorized'),
    );

    await expect(
      AzureAIProvider.fetchDeployments('https://test.openai.azure.com', 'bad-key'),
    ).rejects.toThrow('401');
  });

  it('returns empty array when data field is absent', async () => {
    const { AzureAIProvider } = await import('../../../src/ai/providers/azure-provider.js');

    vi.mocked(AzureAIProvider.fetchDeployments).mockResolvedValue([]);

    const ids = await AzureAIProvider.fetchDeployments('https://test.openai.azure.com', 'key');
    expect(ids).toEqual([]);
  });
});

describe('setup wizard — happy path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('saves config with endpoint, apiKey, and selected deployment', async () => {
    const prompts = (await import('prompts')).default as ReturnType<typeof vi.fn>;
    const { AzureAIProvider } = await import('../../../src/ai/providers/azure-provider.js');
    const { saveConfig } = await import('../../../src/ai/config-store.js');

    vi.mocked(AzureAIProvider.fetchDeployments).mockResolvedValue(['gpt-4o', 'gpt-5.1-codex-mini']);

    // Simulate: endpoint → apiKey → deployment selection
    prompts
      .mockResolvedValueOnce({ endpoint: 'https://test.openai.azure.com' })
      .mockResolvedValueOnce({ apiKey: 'my-secret-key' })
      .mockResolvedValueOnce({ deployment: 'gpt-4o' });

    const ui = makeUI();
    const manager = new SessionManager(ui, makeEngine());
    const result = await manager.runSetupWizard();

    expect(result).toBe(true);
    expect(saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'azure',
        endpoint: 'https://test.openai.azure.com',
        apiKey: 'my-secret-key',
        model: 'gpt-4o',
      }),
    );
  });

  it('strips trailing slash from endpoint before saving', async () => {
    const prompts = (await import('prompts')).default as ReturnType<typeof vi.fn>;
    const { AzureAIProvider } = await import('../../../src/ai/providers/azure-provider.js');
    const { saveConfig } = await import('../../../src/ai/config-store.js');

    vi.mocked(AzureAIProvider.fetchDeployments).mockResolvedValue(['gpt-4o']);
    prompts
      .mockResolvedValueOnce({ endpoint: 'https://test.openai.azure.com/' })
      .mockResolvedValueOnce({ apiKey: 'k' })
      .mockResolvedValueOnce({ deployment: 'gpt-4o' });

    const manager = new SessionManager(makeUI(), makeEngine());
    await manager.runSetupWizard();

    expect(saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'https://test.openai.azure.com' }),
    );
  });

  it('shows success confirmation messages after saving', async () => {
    const prompts = (await import('prompts')).default as ReturnType<typeof vi.fn>;
    const { AzureAIProvider } = await import('../../../src/ai/providers/azure-provider.js');

    vi.mocked(AzureAIProvider.fetchDeployments).mockResolvedValue(['gpt-5.1-codex-mini']);
    prompts
      .mockResolvedValueOnce({ endpoint: 'https://test.openai.azure.com' })
      .mockResolvedValueOnce({ apiKey: 'k' })
      .mockResolvedValueOnce({ deployment: 'gpt-5.1-codex-mini' });

    const logs: string[] = [];
    vi.mocked(console.log).mockImplementation((...args) => logs.push(args.join(' ')));

    const manager = new SessionManager(makeUI(), makeEngine());
    await manager.runSetupWizard();

    expect(logs.some((l) => l.includes('Azure connection successful'))).toBe(true);
    expect(logs.some((l) => l.includes('gpt-5.1-codex-mini'))).toBe(true);
  });
});

describe('setup wizard — arrow key selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('passes all deployment IDs as select choices', async () => {
    const prompts = (await import('prompts')).default as ReturnType<typeof vi.fn>;
    const { AzureAIProvider } = await import('../../../src/ai/providers/azure-provider.js');

    vi.mocked(AzureAIProvider.fetchDeployments).mockResolvedValue(['gpt-4o', 'gpt-4-turbo', 'gpt-5']);

    prompts
      .mockResolvedValueOnce({ endpoint: 'https://test.openai.azure.com' })
      .mockResolvedValueOnce({ apiKey: 'k' })
      .mockImplementationOnce((opts) => {
        // Verify the select prompt receives all choices
        expect(opts.type).toBe('select');
        expect(opts.choices).toHaveLength(3);
        expect(opts.choices.map((c: { value: string }) => c.value)).toEqual(['gpt-4o', 'gpt-4-turbo', 'gpt-5']);
        return Promise.resolve({ deployment: 'gpt-4-turbo' });
      });

    const manager = new SessionManager(makeUI(), makeEngine());
    await manager.runSetupWizard();
  });
});

describe('setup wizard — retry on failure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('retries from step 1 when Azure request fails and user confirms retry', async () => {
    const prompts = (await import('prompts')).default as ReturnType<typeof vi.fn>;
    const { AzureAIProvider } = await import('../../../src/ai/providers/azure-provider.js');

    // First attempt fails, second succeeds
    vi.mocked(AzureAIProvider.fetchDeployments)
      .mockRejectedValueOnce(new Error('Azure API error: 403'))
      .mockResolvedValueOnce(['gpt-4o']);

    prompts
      // First attempt
      .mockResolvedValueOnce({ endpoint: 'https://test.openai.azure.com' })
      .mockResolvedValueOnce({ apiKey: 'bad-key' })
      // Retry confirm → yes
      .mockResolvedValueOnce({ retry: true })
      // Second attempt
      .mockResolvedValueOnce({ endpoint: 'https://test.openai.azure.com' })
      .mockResolvedValueOnce({ apiKey: 'good-key' })
      .mockResolvedValueOnce({ deployment: 'gpt-4o' });

    const manager = new SessionManager(makeUI(), makeEngine());
    const result = await manager.runSetupWizard();

    expect(result).toBe(true);
    expect(AzureAIProvider.fetchDeployments).toHaveBeenCalledTimes(2);
  });

  it('returns false without saving when user declines retry', async () => {
    const prompts = (await import('prompts')).default as ReturnType<typeof vi.fn>;
    const { AzureAIProvider } = await import('../../../src/ai/providers/azure-provider.js');
    const { saveConfig } = await import('../../../src/ai/config-store.js');

    vi.mocked(AzureAIProvider.fetchDeployments).mockRejectedValue(new Error('403'));

    prompts
      .mockResolvedValueOnce({ endpoint: 'https://test.openai.azure.com' })
      .mockResolvedValueOnce({ apiKey: 'k' })
      .mockResolvedValueOnce({ retry: false });

    const manager = new SessionManager(makeUI(), makeEngine());
    const result = await manager.runSetupWizard();

    expect(result).toBe(false);
    expect(saveConfig).not.toHaveBeenCalled();
  });

  it('shows error message when no deployments are found', async () => {
    const prompts = (await import('prompts')).default as ReturnType<typeof vi.fn>;
    const { AzureAIProvider } = await import('../../../src/ai/providers/azure-provider.js');

    vi.mocked(AzureAIProvider.fetchDeployments).mockResolvedValue([]);

    prompts
      .mockResolvedValueOnce({ endpoint: 'https://test.openai.azure.com' })
      .mockResolvedValueOnce({ apiKey: 'k' });

    const ui = makeUI();
    const manager = new SessionManager(ui, makeEngine());
    const result = await manager.runSetupWizard();

    expect(result).toBe(false);
    expect(ui.renderError).toHaveBeenCalledWith(expect.stringContaining('No deployments'));
  });
});

describe('setup wizard — cancellation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('returns false when endpoint prompt is cancelled', async () => {
    const prompts = (await import('prompts')).default as ReturnType<typeof vi.fn>;

    // prompts returns undefined values on Ctrl+C cancel
    prompts.mockResolvedValueOnce({ endpoint: undefined });

    const manager = new SessionManager(makeUI(), makeEngine());
    const result = await manager.runSetupWizard();

    expect(result).toBe(false);
  });

  it('returns false when API key prompt is cancelled', async () => {
    const prompts = (await import('prompts')).default as ReturnType<typeof vi.fn>;
    const { AzureAIProvider } = await import('../../../src/ai/providers/azure-provider.js');

    vi.mocked(AzureAIProvider.fetchDeployments).mockResolvedValue(['gpt-4o']);

    prompts
      .mockResolvedValueOnce({ endpoint: 'https://test.openai.azure.com' })
      .mockResolvedValueOnce({ apiKey: undefined });

    const manager = new SessionManager(makeUI(), makeEngine());
    const result = await manager.runSetupWizard();

    expect(result).toBe(false);
  });

  it('returns false when deployment selection is cancelled', async () => {
    const prompts = (await import('prompts')).default as ReturnType<typeof vi.fn>;
    const { AzureAIProvider } = await import('../../../src/ai/providers/azure-provider.js');
    const { saveConfig } = await import('../../../src/ai/config-store.js');

    vi.mocked(AzureAIProvider.fetchDeployments).mockResolvedValue(['gpt-4o']);

    prompts
      .mockResolvedValueOnce({ endpoint: 'https://test.openai.azure.com' })
      .mockResolvedValueOnce({ apiKey: 'k' })
      .mockResolvedValueOnce({ deployment: undefined });

    const manager = new SessionManager(makeUI(), makeEngine());
    const result = await manager.runSetupWizard();

    expect(result).toBe(false);
    expect(saveConfig).not.toHaveBeenCalled();
  });
});

describe('setup wizard — API key is a password prompt', () => {
  it('uses type:password for the API key prompt', async () => {
    const prompts = (await import('prompts')).default as ReturnType<typeof vi.fn>;
    const { AzureAIProvider } = await import('../../../src/ai/providers/azure-provider.js');

    vi.mocked(AzureAIProvider.fetchDeployments).mockResolvedValue(['gpt-4o']);
    vi.spyOn(console, 'log').mockImplementation(() => {});

    prompts
      .mockResolvedValueOnce({ endpoint: 'https://test.openai.azure.com' })
      .mockImplementationOnce((opts) => {
        expect(opts.type).toBe('password');
        return Promise.resolve({ apiKey: 'secret' });
      })
      .mockResolvedValueOnce({ deployment: 'gpt-4o' });

    const manager = new SessionManager(makeUI(), makeEngine());
    await manager.runSetupWizard();
  });
});
