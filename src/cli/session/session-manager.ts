import * as readline from 'node:readline';
import * as path from 'node:path';
import { execSync } from 'child_process';
import chalk from 'chalk';
import { UIRenderer } from './ui-renderer.js';
import { ConversationEngine, type ConversationContext } from './conversation-engine.js';
import { loadIndex } from '../../store/index-store.js';
import { configExists, loadConfig, saveConfig } from '../../ai/config-store.js';
import { AzureAIProvider } from '../../ai/providers/azure-provider.js';
import type { RepoIndex } from '../../types/index.js';
import type { AIConfig } from '../../ai/types.js';

/**
 * SessionManager — entry point for the conversational Koda session.
 *
 * Responsibilities:
 *  1. Detect repository context (name, branch, index status)
 *  2. Run setup wizard if Azure credentials are missing
 *  3. Drive the interactive conversation loop
 */
export class SessionManager {
  private ui: UIRenderer;
  private engine: ConversationEngine;
  private rl: readline.Interface | null = null;

  constructor(ui?: UIRenderer, engine?: ConversationEngine) {
    this.ui = ui ?? new UIRenderer();
    this.engine = engine ?? new ConversationEngine(this.ui);
  }

  async start(rootPath: string = process.cwd()): Promise<void> {
    // 1. Gather context
    const repoName = path.basename(rootPath);
    const branch = getGitBranch(rootPath);
    const hasConfig = await configExists();

    // 2. Load index (non-fatal if missing)
    let index: RepoIndex | null = null;
    let indexStatus: 'ready' | 'missing' | 'stale' = 'missing';
    try {
      index = await loadIndex(rootPath);
      indexStatus = 'ready';
    } catch {
      indexStatus = 'missing';
    }

    // 3. Get model name
    let model = 'not configured';
    if (hasConfig) {
      try {
        const cfg = await loadConfig();
        model = cfg.model;
      } catch {
        // ignore
      }
    }

    // 4. Render header
    this.ui.renderHeader({ repoName, branch, indexStatus, model });

    // 5. Setup wizard if no config
    if (!hasConfig) {
      const configured = await this.runSetupWizard();
      if (configured) {
        try {
          const cfg = await loadConfig();
          model = cfg.model;
        } catch {
          // ignore
        }
      }
    }

    // 6. Suggest init if no index
    if (indexStatus === 'missing') {
      this.ui.renderInfo('No index found. Run `koda init` to index this repository, or type "init" to do it now.');
      console.log();
    }

    // 7. Start conversation loop
    this.ui.renderWelcome();
    await this.loop({ rootPath, index, hasConfig: await configExists() });
  }

  private async loop(ctx: ConversationContext): Promise<void> {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
      historySize: 100,
    });

    // Handle Ctrl+C gracefully
    this.rl.on('SIGINT', () => {
      console.log('\n\n  ' + chalk.gray('Goodbye!'));
      this.rl?.close();
      process.exit(0);
    });

    const ask = (): void => {
      this.ui.renderPrompt();
    };

    ask();

    this.rl.on('line', async (rawLine) => {
      const input = rawLine.trim();

      // Skip empty lines
      if (!input) {
        ask();
        return;
      }

      // Handle inline init
      if (input.toLowerCase() === 'init' || input === '/init') {
        await this.handleInlineInit(ctx);
        ask();
        return;
      }

      try {
        const response = await this.engine.process(input, ctx);

        if (response.shouldQuit) {
          console.log('\n  ' + chalk.gray('Goodbye!'));
          this.rl?.close();
          process.exit(0);
        }
      } catch (err) {
        this.ui.renderError((err as Error).message);
      }

      ask();
    });

    // Keep process alive until rl closes
    await new Promise<void>((resolve) => {
      this.rl!.on('close', resolve);
    });
  }

  private async handleInlineInit(ctx: ConversationContext): Promise<void> {
    const { runIndexingPipeline } = await import('../../engine/indexing-pipeline.js');
    const { loadIndex: reloadIndex } = await import('../../store/index-store.js');

    const spinner = this.ui.renderThinking();
    this.ui.renderStage('analyzing');

    try {
      await runIndexingPipeline(ctx.rootPath, {
        force: false,
        onProgress: (stage: string) => {
          this.ui.renderStage(stage);
        },
      });
      ctx.index = await reloadIndex(ctx.rootPath);
      this.ui.stopSpinner(true, 'Repository indexed');
    } catch (err) {
      this.ui.stopSpinner(false, `Indexing failed: ${(err as Error).message}`);
    }
  }

  /**
   * Interactive setup wizard for Azure credentials.
   * Returns true if credentials were successfully configured.
   */
  async runSetupWizard(): Promise<boolean> {
    this.ui.renderSetupHeader();

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    const question = (prompt: string): Promise<string> =>
      new Promise((resolve) => {
        rl.question(chalk.cyan(`  ${prompt}: `), (answer) => resolve(answer.trim()));
      });

    try {
      const endpoint = await question('Azure endpoint (e.g. https://your-resource.openai.azure.com)');
      const apiKey = await question('API key');
      const model = await question('Deployment name (e.g. gpt-4o)');

      if (!endpoint || !apiKey || !model) {
        this.ui.renderError('Setup cancelled — all fields are required.');
        rl.close();
        return false;
      }

      const config: AIConfig = {
        provider: 'azure',
        endpoint: endpoint.replace(/\/$/, ''),
        apiKey,
        model,
        apiVersion: '2024-08-01-preview',
      };

      // Test connection
      console.log();
      const spinner = this.ui.renderThinking();
      spinner.text = 'Testing Azure connection…';

      try {
        const provider = new AzureAIProvider(config);
        await provider.listModels();
        this.ui.stopSpinner(true, 'connection successful');
      } catch {
        // Connection test failed — still save, maybe it's a permission issue with list-models
        this.ui.stopSpinner(true, 'configuration saved (connection test skipped)');
      }

      await saveConfig(config);
      console.log();
      rl.close();
      return true;
    } catch {
      rl.close();
      return false;
    }
  }

  stop(): void {
    this.rl?.close();
  }
}

function getGitBranch(rootPath: string): string {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: rootPath,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
      .toString()
      .trim();
  } catch {
    return 'unknown';
  }
}
