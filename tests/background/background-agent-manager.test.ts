import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BackgroundAgentManager } from '../../src/background/background-agent-manager.js';
import { BackgroundTaskScheduler } from '../../src/background/background-task-scheduler.js';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

describe('BackgroundAgentManager', () => {
  let tmpDir: string;
  let manager: BackgroundAgentManager;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'koda-test-'));
    manager = new BackgroundAgentManager(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('registers built-in agents', () => {
    const agents = manager.listAgents();
    expect(agents).toContain('test-coverage-agent');
    expect(agents).toContain('security-scan-agent');
    expect(agents).toContain('performance-analysis-agent');
    expect(agents).toContain('dead-code-agent');
  });

  it('registers custom agent', () => {
    manager.register({
      name: 'custom-agent',
      triggers: ['onFileSave'],
      prompt: (files) => `Custom analysis for: ${files.join(', ')}`,
    });
    expect(manager.listAgents()).toContain('custom-agent');
  });

  it('emits result events on trigger', async () => {
    const results: string[] = [];
    manager.on('result', (r) => results.push(r.agentName));

    await manager.trigger('onFileSave', ['src/foo.ts']);

    // onFileSave triggers test-coverage-agent and security-scan-agent
    expect(results).toContain('test-coverage-agent');
    expect(results).toContain('security-scan-agent');
  });

  it('does not trigger agents for non-matching condition', async () => {
    const results: string[] = [];
    manager.on('result', (r) => results.push(r.agentName));

    await manager.trigger('onPullRequest', ['src/foo.ts']);

    // performance-analysis-agent and security-scan-agent trigger on onPullRequest
    expect(results).toContain('security-scan-agent');
    expect(results).toContain('performance-analysis-agent');
    // test-coverage-agent does NOT trigger on onPullRequest
    expect(results).not.toContain('test-coverage-agent');
  });

  it('stores results in .koda/background-results/', async () => {
    await manager.trigger('onFileSave', ['src/test.ts']);

    const { existsSync, readdirSync } = await import('fs');
    const resultsDir = join(tmpDir, '.koda', 'background-results');
    expect(existsSync(resultsDir)).toBe(true);
    const files = readdirSync(resultsDir);
    expect(files.length).toBeGreaterThan(0);
  });
});
