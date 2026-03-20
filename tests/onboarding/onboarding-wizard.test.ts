/**
 * OnboardingWizard — unit tests
 */

import { describe, it, expect } from 'vitest';
import { OnboardingWizard } from '../../src/onboarding/onboarding-wizard.js';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';

describe('OnboardingWizard.isFirstRun', () => {
  it('returns true when .koda/onboarded does not exist', async () => {
    const dir = path.join(os.tmpdir(), 'koda-onboard-' + Date.now());
    await fs.mkdir(dir, { recursive: true });
    expect(await OnboardingWizard.isFirstRun(dir)).toBe(true);
  });

  it('returns false after markOnboarded', async () => {
    const dir = path.join(os.tmpdir(), 'koda-onboard-' + Date.now());
    await fs.mkdir(dir, { recursive: true });
    await OnboardingWizard.markOnboarded(dir);
    expect(await OnboardingWizard.isFirstRun(dir)).toBe(false);
  });
});

describe('OnboardingWizard.detectProfile', () => {
  it('detects Node.js from package.json', async () => {
    const dir = path.join(os.tmpdir(), 'koda-profile-' + Date.now());
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({ devDependencies: { vitest: '*' } }),
      'utf8',
    );
    const wizard   = new OnboardingWizard(dir);
    const profile  = await wizard.detectProfile(100);
    expect(profile.runtime).toBe('Node.js');
    expect(profile.testRunner).toBe('vitest');
    expect(profile.fileCount).toBe(100);
  });

  it('detects unknown for empty directory', async () => {
    const dir = path.join(os.tmpdir(), 'koda-empty-' + Date.now());
    await fs.mkdir(dir, { recursive: true });
    const wizard  = new OnboardingWizard(dir);
    const profile = await wizard.detectProfile(0);
    expect(profile.runtime).toBe('unknown');
  });
});
