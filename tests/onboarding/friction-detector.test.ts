/**
 * FrictionDetector — unit tests
 */

import { describe, it, expect } from 'vitest';
import { FrictionDetector } from '../../src/onboarding/friction-detector.js';
import * as fs   from 'node:fs/promises';
import * as path from 'node:path';
import * as os   from 'node:os';

async function tmpDir() {
  const d = path.join(os.tmpdir(), 'koda-fd-' + Date.now());
  await fs.mkdir(d, { recursive: true });
  return d;
}

describe('FrictionDetector.detect', () => {
  it('returns no_config friction when .koda/config.json is missing', async () => {
    const dir = await tmpDir();
    const det = new FrictionDetector(dir);
    const frictions = await det.detect();
    const ids = frictions.map((f) => f.id);
    expect(ids).toContain('no_config');
  });

  it('returns no_index friction when index does not exist', async () => {
    const dir = await tmpDir();
    // create config but no index
    await fs.mkdir(path.join(dir, '.koda'), { recursive: true });
    await fs.writeFile(path.join(dir, '.koda', 'config.json'), '{}', 'utf8');
    const det = new FrictionDetector(dir);
    const frictions = await det.detect();
    const ids = frictions.map((f) => f.id);
    expect(ids).toContain('no_index');
  });

  it('returns no friction for a fully configured repo', async () => {
    const dir = await tmpDir();
    // Set up config + index + package.json with vitest
    await fs.mkdir(path.join(dir, '.koda'), { recursive: true });
    await fs.writeFile(path.join(dir, '.koda', 'config.json'), '{}', 'utf8');
    await fs.writeFile(path.join(dir, '.koda', 'index.json'),  '{}', 'utf8');
    await fs.writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({ devDependencies: { vitest: '*' } }),
      'utf8',
    );
    const det = new FrictionDetector(dir);
    const frictions = await det.detect();
    expect(frictions).toHaveLength(0);
  });

  it('no_config has BLOCK severity', async () => {
    const dir = await tmpDir();
    const det = new FrictionDetector(dir);
    const frictions = await det.detect();
    const noConfig = frictions.find((f) => f.id === 'no_config');
    expect(noConfig?.severity).toBe('BLOCK');
  });

  it('no_index has WARN severity', async () => {
    const dir = await tmpDir();
    await fs.mkdir(path.join(dir, '.koda'), { recursive: true });
    await fs.writeFile(path.join(dir, '.koda', 'config.json'), '{}', 'utf8');
    const det = new FrictionDetector(dir);
    const frictions = await det.detect();
    const noIndex = frictions.find((f) => f.id === 'no_index');
    expect(noIndex?.severity).toBe('WARN');
  });
});
