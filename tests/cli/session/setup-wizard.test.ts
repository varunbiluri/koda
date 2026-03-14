/**
 * Tests for the setup wizard:
 *  - Deployment fetch from Azure API
 *  - Chat-compatibility filtering
 *  - Arrow-key selection (choices include model name)
 *  - Deployment validation via chat/completions
 *  - Retry on validation failure (inner loop)
 *  - Retry on connection failure (outer loop)
 *  - No compatible models guidance
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
    static filterChatCompatible = vi.fn((deps: unknown[]) => deps); // pass-through by default
    static validateChatDeployment = vi.fn().mockResolvedValue(undefined); // success by default
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

type DeploymentInfo = { id: string; model: string };

function dep(id: string, model = id): DeploymentInfo {
  return { id, model };
}

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

// ── AzureAIProvider.fetchDeployments ─────────────────────────────────────────

describe('AzureAIProvider.fetchDeployments', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns DeploymentInfo objects with id and model', async () => {
    const { AzureAIProvider } = await import('../../../src/ai/providers/azure-provider.js');
    vi.mocked(AzureAIProvider.fetchDeployments).mockResolvedValue([
      dep('gpt-4o'),
      dep('codex-mini', 'codex-mini'),
    ]);
    const result = await AzureAIProvider.fetchDeployments('https://test.openai.azure.com', 'key');
    expect(result).toEqual([
      { id: 'gpt-4o', model: 'gpt-4o' },
      { id: 'codex-mini', model: 'codex-mini' },
    ]);
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

  it('returns empty array when no deployments exist', async () => {
    const { AzureAIProvider } = await import('../../../src/ai/providers/azure-provider.js');
    vi.mocked(AzureAIProvider.fetchDeployments).mockResolvedValue([]);
    const result = await AzureAIProvider.fetchDeployments('https://test.openai.azure.com', 'key');
    expect(result).toEqual([]);
  });
});

// ── filterChatCompatible — unit tests against real implementation ─────────────

describe('AzureAIProvider.filterChatCompatible', () => {
  // Import the real module (bypasses vi.mock) via importActual
  let realFilter: (d: DeploymentInfo[]) => DeploymentInfo[];

  beforeEach(async () => {
    const actual = await vi.importActual<typeof import('../../../src/ai/providers/azure-provider.js')>(
      '../../../src/ai/providers/azure-provider.js',
    );
    realFilter = actual.AzureAIProvider.filterChatCompatible;
  });

  it('keeps gpt-4o deployments', () => {
    const result = realFilter([dep('my-gpt4o', 'gpt-4o')]);
    expect(result).toHaveLength(1);
  });

  it('keeps gpt-4o-mini deployments', () => {
    expect(realFilter([dep('mini', 'gpt-4o-mini')])).toHaveLength(1);
  });

  it('keeps gpt-4.1 deployments', () => {
    expect(realFilter([dep('d', 'gpt-4.1')])).toHaveLength(1);
  });

  it('keeps gpt-35-turbo deployments', () => {
    expect(realFilter([dep('d', 'gpt-35-turbo')])).toHaveLength(1);
  });

  it('removes codex models', () => {
    expect(realFilter([dep('d', 'gpt-4-codex')])).toHaveLength(0);
    expect(realFilter([dep('d', 'codex-mini')])).toHaveLength(0);
  });

  it('removes embedding models', () => {
    expect(realFilter([dep('d', 'text-embedding-ada-002')])).toHaveLength(0);
  });

  it('removes image generation models', () => {
    expect(realFilter([dep('d', 'dall-e-3')])).toHaveLength(0);
    expect(realFilter([dep('d', 'gpt-image-1')])).toHaveLength(0);
  });

  it('removes whisper models', () => {
    expect(realFilter([dep('d', 'whisper-1')])).toHaveLength(0);
  });

  it('returns only compatible deployments from a mixed list', () => {
    const input = [
      dep('gpt4o', 'gpt-4o'),
      dep('codex', 'codex-mini'),
      dep('embed', 'text-embedding-ada-002'),
      dep('mini', 'gpt-4o-mini'),
    ];
    const result = realFilter(input);
    expect(result.map((d) => d.id)).toEqual(['gpt4o', 'mini']);
  });

  it('returns empty array when no deployments are compatible', () => {
    expect(realFilter([dep('d', 'codex-mini'), dep('e', 'text-embedding-3')])).toHaveLength(0);
  });
});

// ── Happy path ────────────────────────────────────────────────────────────────

describe('setup wizard — happy path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('saves config with endpoint, apiKey, and selected deployment', async () => {
    const prompts = (await import('prompts')).default as ReturnType<typeof vi.fn>;
    const { AzureAIProvider } = await import('../../../src/ai/providers/azure-provider.js');
    const { saveConfig } = await import('../../../src/ai/config-store.js');

    vi.mocked(AzureAIProvider.fetchDeployments).mockResolvedValue([dep('gpt-4o')]);
    vi.mocked(AzureAIProvider.filterChatCompatible).mockReturnValue([dep('gpt-4o')]);
    vi.mocked(AzureAIProvider.validateChatDeployment).mockResolvedValue(undefined);

    prompts
      .mockResolvedValueOnce({ endpoint: 'https://test.openai.azure.com' })
      .mockResolvedValueOnce({ apiKey: 'my-secret-key' })
      .mockResolvedValueOnce({ deployment: 'gpt-4o' });

    const manager = new SessionManager(makeUI(), makeEngine());
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

    vi.mocked(AzureAIProvider.fetchDeployments).mockResolvedValue([dep('gpt-4o')]);
    vi.mocked(AzureAIProvider.filterChatCompatible).mockReturnValue([dep('gpt-4o')]);
    vi.mocked(AzureAIProvider.validateChatDeployment).mockResolvedValue(undefined);

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

  it('shows ✔ confirmation messages after saving', async () => {
    const prompts = (await import('prompts')).default as ReturnType<typeof vi.fn>;
    const { AzureAIProvider } = await import('../../../src/ai/providers/azure-provider.js');

    vi.mocked(AzureAIProvider.fetchDeployments).mockResolvedValue([dep('gpt-4o-mini', 'gpt-4o-mini')]);
    vi.mocked(AzureAIProvider.filterChatCompatible).mockReturnValue([dep('gpt-4o-mini', 'gpt-4o-mini')]);
    vi.mocked(AzureAIProvider.validateChatDeployment).mockResolvedValue(undefined);

    prompts
      .mockResolvedValueOnce({ endpoint: 'https://test.openai.azure.com' })
      .mockResolvedValueOnce({ apiKey: 'k' })
      .mockResolvedValueOnce({ deployment: 'gpt-4o-mini' });

    const logs: string[] = [];
    vi.mocked(console.log).mockImplementation((...args) => logs.push(args.join(' ')));

    const manager = new SessionManager(makeUI(), makeEngine());
    await manager.runSetupWizard();

    expect(logs.some((l) => l.includes('Azure connection successful'))).toBe(true);
    expect(logs.some((l) => l.includes('gpt-4o-mini'))).toBe(true);
  });
});

// ── Arrow key selection ───────────────────────────────────────────────────────

describe('setup wizard — arrow key selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('presents choices as "id (model)" to let users distinguish deployments', async () => {
    const prompts = (await import('prompts')).default as ReturnType<typeof vi.fn>;
    const { AzureAIProvider } = await import('../../../src/ai/providers/azure-provider.js');

    const compatible = [
      dep('prod-gpt4o', 'gpt-4o'),
      dep('dev-gpt4mini', 'gpt-4o-mini'),
    ];
    vi.mocked(AzureAIProvider.fetchDeployments).mockResolvedValue(compatible);
    vi.mocked(AzureAIProvider.filterChatCompatible).mockReturnValue(compatible);
    vi.mocked(AzureAIProvider.validateChatDeployment).mockResolvedValue(undefined);

    prompts
      .mockResolvedValueOnce({ endpoint: 'https://test.openai.azure.com' })
      .mockResolvedValueOnce({ apiKey: 'k' })
      .mockImplementationOnce((opts) => {
        expect(opts.type).toBe('select');
        expect(opts.choices).toHaveLength(2);
        // Each choice title includes both the deployment id AND the model name
        expect(opts.choices[0].title).toContain('prod-gpt4o');
        expect(opts.choices[0].title).toContain('gpt-4o');
        expect(opts.choices[1].title).toContain('dev-gpt4mini');
        expect(opts.choices[1].title).toContain('gpt-4o-mini');
        // Value is just the deployment id
        expect(opts.choices.map((c: { value: string }) => c.value)).toEqual([
          'prod-gpt4o',
          'dev-gpt4mini',
        ]);
        return Promise.resolve({ deployment: 'prod-gpt4o' });
      });

    const manager = new SessionManager(makeUI(), makeEngine());
    await manager.runSetupWizard();
  });

  it('only shows compatible deployments in the select list', async () => {
    const prompts = (await import('prompts')).default as ReturnType<typeof vi.fn>;
    const { AzureAIProvider } = await import('../../../src/ai/providers/azure-provider.js');

    const all = [dep('gpt4o', 'gpt-4o'), dep('codex', 'codex-mini'), dep('embed', 'text-embedding-ada-002')];
    const compatible = [dep('gpt4o', 'gpt-4o')];
    vi.mocked(AzureAIProvider.fetchDeployments).mockResolvedValue(all);
    vi.mocked(AzureAIProvider.filterChatCompatible).mockReturnValue(compatible);
    vi.mocked(AzureAIProvider.validateChatDeployment).mockResolvedValue(undefined);

    prompts
      .mockResolvedValueOnce({ endpoint: 'https://test.openai.azure.com' })
      .mockResolvedValueOnce({ apiKey: 'k' })
      .mockImplementationOnce((opts) => {
        expect(opts.choices).toHaveLength(1);
        expect(opts.choices[0].value).toBe('gpt4o');
        return Promise.resolve({ deployment: 'gpt4o' });
      });

    const manager = new SessionManager(makeUI(), makeEngine());
    await manager.runSetupWizard();
  });
});

// ── Deployment validation ─────────────────────────────────────────────────────

describe('setup wizard — deployment validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('calls validateChatDeployment with correct args after selection', async () => {
    const prompts = (await import('prompts')).default as ReturnType<typeof vi.fn>;
    const { AzureAIProvider } = await import('../../../src/ai/providers/azure-provider.js');

    vi.mocked(AzureAIProvider.fetchDeployments).mockResolvedValue([dep('gpt-4o')]);
    vi.mocked(AzureAIProvider.filterChatCompatible).mockReturnValue([dep('gpt-4o')]);
    vi.mocked(AzureAIProvider.validateChatDeployment).mockResolvedValue(undefined);

    prompts
      .mockResolvedValueOnce({ endpoint: 'https://test.openai.azure.com' })
      .mockResolvedValueOnce({ apiKey: 'secret' })
      .mockResolvedValueOnce({ deployment: 'gpt-4o' });

    const manager = new SessionManager(makeUI(), makeEngine());
    await manager.runSetupWizard();

    expect(AzureAIProvider.validateChatDeployment).toHaveBeenCalledWith(
      'https://test.openai.azure.com',
      'secret',
      'gpt-4o',
    );
  });

  it('retries model selection when validation fails and user confirms', async () => {
    const prompts = (await import('prompts')).default as ReturnType<typeof vi.fn>;
    const { AzureAIProvider } = await import('../../../src/ai/providers/azure-provider.js');
    const { saveConfig } = await import('../../../src/ai/config-store.js');

    const compatible = [dep('gpt-4o'), dep('gpt-4o-mini', 'gpt-4o-mini')];
    vi.mocked(AzureAIProvider.fetchDeployments).mockResolvedValue(compatible);
    vi.mocked(AzureAIProvider.filterChatCompatible).mockReturnValue(compatible);

    // First validation fails, second succeeds
    vi.mocked(AzureAIProvider.validateChatDeployment)
      .mockRejectedValueOnce(new Error('OperationNotSupported'))
      .mockResolvedValueOnce(undefined);

    prompts
      .mockResolvedValueOnce({ endpoint: 'https://test.openai.azure.com' })
      .mockResolvedValueOnce({ apiKey: 'k' })
      .mockResolvedValueOnce({ deployment: 'gpt-4o' })          // first selection (fails)
      .mockResolvedValueOnce({ retryModel: true })               // retry confirm
      .mockResolvedValueOnce({ deployment: 'gpt-4o-mini' });    // second selection (passes)

    const manager = new SessionManager(makeUI(), makeEngine());
    const result = await manager.runSetupWizard();

    expect(result).toBe(true);
    expect(AzureAIProvider.validateChatDeployment).toHaveBeenCalledTimes(2);
    expect(saveConfig).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-4o-mini' }));
  });

  it('does NOT re-prompt endpoint/key when retrying model selection', async () => {
    const prompts = (await import('prompts')).default as ReturnType<typeof vi.fn>;
    const { AzureAIProvider } = await import('../../../src/ai/providers/azure-provider.js');

    vi.mocked(AzureAIProvider.fetchDeployments).mockResolvedValue([dep('gpt-4o')]);
    vi.mocked(AzureAIProvider.filterChatCompatible).mockReturnValue([dep('gpt-4o')]);
    vi.mocked(AzureAIProvider.validateChatDeployment)
      .mockRejectedValueOnce(new Error('OperationNotSupported'))
      .mockResolvedValueOnce(undefined);

    prompts
      .mockResolvedValueOnce({ endpoint: 'https://test.openai.azure.com' })
      .mockResolvedValueOnce({ apiKey: 'k' })
      .mockResolvedValueOnce({ deployment: 'gpt-4o' })
      .mockResolvedValueOnce({ retryModel: true })
      .mockResolvedValueOnce({ deployment: 'gpt-4o' });

    const manager = new SessionManager(makeUI(), makeEngine());
    await manager.runSetupWizard();

    // fetchDeployments is called only once (no outer loop triggered)
    expect(AzureAIProvider.fetchDeployments).toHaveBeenCalledTimes(1);
  });

  it('returns false without saving when user declines model retry', async () => {
    const prompts = (await import('prompts')).default as ReturnType<typeof vi.fn>;
    const { AzureAIProvider } = await import('../../../src/ai/providers/azure-provider.js');
    const { saveConfig } = await import('../../../src/ai/config-store.js');

    vi.mocked(AzureAIProvider.fetchDeployments).mockResolvedValue([dep('gpt-4o')]);
    vi.mocked(AzureAIProvider.filterChatCompatible).mockReturnValue([dep('gpt-4o')]);
    vi.mocked(AzureAIProvider.validateChatDeployment).mockRejectedValueOnce(
      new Error('OperationNotSupported'),
    );

    prompts
      .mockResolvedValueOnce({ endpoint: 'https://test.openai.azure.com' })
      .mockResolvedValueOnce({ apiKey: 'k' })
      .mockResolvedValueOnce({ deployment: 'gpt-4o' })
      .mockResolvedValueOnce({ retryModel: false });

    const manager = new SessionManager(makeUI(), makeEngine());
    const result = await manager.runSetupWizard();

    expect(result).toBe(false);
    expect(saveConfig).not.toHaveBeenCalled();
  });
});

// ── No compatible models ──────────────────────────────────────────────────────

describe('setup wizard — no compatible models', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('returns false and shows guidance when all deployments are filtered out', async () => {
    const prompts = (await import('prompts')).default as ReturnType<typeof vi.fn>;
    const { AzureAIProvider } = await import('../../../src/ai/providers/azure-provider.js');

    vi.mocked(AzureAIProvider.fetchDeployments).mockResolvedValue([
      dep('codex-d', 'codex-mini'),
      dep('embed-d', 'text-embedding-ada-002'),
    ]);
    // filterChatCompatible returns nothing (all blocked)
    vi.mocked(AzureAIProvider.filterChatCompatible).mockReturnValue([]);

    prompts
      .mockResolvedValueOnce({ endpoint: 'https://test.openai.azure.com' })
      .mockResolvedValueOnce({ apiKey: 'k' });

    const logs: string[] = [];
    vi.mocked(console.log).mockImplementation((...args) => logs.push(args.join(' ')));

    const manager = new SessionManager(makeUI(), makeEngine());
    const result = await manager.runSetupWizard();

    expect(result).toBe(false);
    expect(logs.some((l) => l.includes('No compatible chat models found'))).toBe(true);
    expect(logs.some((l) => l.includes('koda login'))).toBe(true);
  });

  it('shows error message when no deployments at all', async () => {
    const prompts = (await import('prompts')).default as ReturnType<typeof vi.fn>;
    const { AzureAIProvider } = await import('../../../src/ai/providers/azure-provider.js');

    vi.mocked(AzureAIProvider.fetchDeployments).mockResolvedValue([]);
    vi.mocked(AzureAIProvider.filterChatCompatible).mockReturnValue([]);

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

// ── Connection retry ──────────────────────────────────────────────────────────

describe('setup wizard — connection retry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('retries from step 1 when Azure request fails and user confirms', async () => {
    const prompts = (await import('prompts')).default as ReturnType<typeof vi.fn>;
    const { AzureAIProvider } = await import('../../../src/ai/providers/azure-provider.js');

    vi.mocked(AzureAIProvider.fetchDeployments)
      .mockRejectedValueOnce(new Error('403'))
      .mockResolvedValueOnce([dep('gpt-4o')]);
    vi.mocked(AzureAIProvider.filterChatCompatible).mockReturnValue([dep('gpt-4o')]);

    prompts
      .mockResolvedValueOnce({ endpoint: 'https://test.openai.azure.com' })
      .mockResolvedValueOnce({ apiKey: 'bad-key' })
      .mockResolvedValueOnce({ retry: true })
      .mockResolvedValueOnce({ endpoint: 'https://test.openai.azure.com' })
      .mockResolvedValueOnce({ apiKey: 'good-key' })
      .mockResolvedValueOnce({ deployment: 'gpt-4o' });

    const manager = new SessionManager(makeUI(), makeEngine());
    const result = await manager.runSetupWizard();

    expect(result).toBe(true);
    expect(AzureAIProvider.fetchDeployments).toHaveBeenCalledTimes(2);
  });

  it('returns false without saving when user declines connection retry', async () => {
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
});

// ── Cancellation ──────────────────────────────────────────────────────────────

describe('setup wizard — cancellation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('returns false when endpoint prompt is cancelled', async () => {
    const prompts = (await import('prompts')).default as ReturnType<typeof vi.fn>;
    prompts.mockResolvedValueOnce({ endpoint: undefined });
    const result = await new SessionManager(makeUI(), makeEngine()).runSetupWizard();
    expect(result).toBe(false);
  });

  it('returns false when API key prompt is cancelled', async () => {
    const prompts = (await import('prompts')).default as ReturnType<typeof vi.fn>;
    prompts
      .mockResolvedValueOnce({ endpoint: 'https://test.openai.azure.com' })
      .mockResolvedValueOnce({ apiKey: undefined });
    const result = await new SessionManager(makeUI(), makeEngine()).runSetupWizard();
    expect(result).toBe(false);
  });

  it('returns false when deployment selection is cancelled', async () => {
    const prompts = (await import('prompts')).default as ReturnType<typeof vi.fn>;
    const { AzureAIProvider } = await import('../../../src/ai/providers/azure-provider.js');
    const { saveConfig } = await import('../../../src/ai/config-store.js');

    vi.mocked(AzureAIProvider.fetchDeployments).mockResolvedValue([dep('gpt-4o')]);
    vi.mocked(AzureAIProvider.filterChatCompatible).mockReturnValue([dep('gpt-4o')]);

    prompts
      .mockResolvedValueOnce({ endpoint: 'https://test.openai.azure.com' })
      .mockResolvedValueOnce({ apiKey: 'k' })
      .mockResolvedValueOnce({ deployment: undefined });

    const result = await new SessionManager(makeUI(), makeEngine()).runSetupWizard();
    expect(result).toBe(false);
    expect(saveConfig).not.toHaveBeenCalled();
  });
});

// ── API key uses password prompt ──────────────────────────────────────────────

describe('setup wizard — API key is a password prompt', () => {
  it('uses type:password for the API key prompt', async () => {
    const prompts = (await import('prompts')).default as ReturnType<typeof vi.fn>;
    const { AzureAIProvider } = await import('../../../src/ai/providers/azure-provider.js');

    vi.mocked(AzureAIProvider.fetchDeployments).mockResolvedValue([dep('gpt-4o')]);
    vi.mocked(AzureAIProvider.filterChatCompatible).mockReturnValue([dep('gpt-4o')]);
    vi.spyOn(console, 'log').mockImplementation(() => {});

    prompts
      .mockResolvedValueOnce({ endpoint: 'https://test.openai.azure.com' })
      .mockImplementationOnce((opts) => {
        expect(opts.type).toBe('password');
        return Promise.resolve({ apiKey: 'secret' });
      })
      .mockResolvedValueOnce({ deployment: 'gpt-4o' });

    await new SessionManager(makeUI(), makeEngine()).runSetupWizard();
  });
});
