import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import type { AIConfig } from './types.js';
import { KodaError, ErrorCode } from '../utils/errors.js';

const CONFIG_DIR = path.join(os.homedir(), '.koda');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export async function saveConfig(config: AIConfig): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

export async function loadConfig(): Promise<AIConfig> {
  try {
    const content = await fs.readFile(CONFIG_FILE, 'utf-8');
    return JSON.parse(content) as AIConfig;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new KodaError(
        'No configuration found. Run "koda login" to set up your AI credentials.',
        ErrorCode.INDEX_NOT_FOUND,
      );
    }
    throw new KodaError(
      `Failed to load configuration: ${(err as Error).message}`,
      ErrorCode.INDEX_CORRUPTED,
      err as Error,
    );
  }
}

export async function configExists(): Promise<boolean> {
  try {
    await fs.access(CONFIG_FILE);
    return true;
  } catch {
    return false;
  }
}

export async function updateModel(model: string): Promise<void> {
  const config = await loadConfig();
  config.model = model;
  await saveConfig(config);
}
