import { describe, it, expect } from 'vitest';
import { normalizeConfig } from '../../src/serve/config-service.js';

describe('normalizeConfig', () => {
  it('normalizes ollama config', () => {
    const cfg = normalizeConfig({
      provider: 'ollama',
      model: 'llama3',
      endpoint: 'http://127.0.0.1:11434',
    });
    expect(cfg.provider).toBe('ollama');
    expect(cfg.apiKey).toBe('ollama');
  });

  it('requires https azure endpoint', () => {
    expect(() =>
      normalizeConfig({ provider: 'azure', model: 'gpt-4', endpoint: 'http://x', apiKey: 'k' }),
    ).toThrow(/endpoint/i);
  });
});
