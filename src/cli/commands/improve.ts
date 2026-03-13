import { Command } from 'commander';
import { BackgroundAgentManager } from '../../background/background-agent-manager.js';
import { DiffRenderer } from '../../preview/diff-renderer.js';
import { existsSync, readdirSync } from 'fs';
import { readFile } from 'fs/promises';
import { join } from 'path';
import chalk from 'chalk';
import { createInterface } from 'readline';

export function createImproveCommand(): Command {
  return new Command('improve')
    .description('Run all background agents against the working directory and show improvement suggestions')
    .option('--root <path>', 'Repository root path', process.cwd())
    .option('--yes', 'Apply all suggestions without confirmation', false)
    .action(async (options: { root: string; yes: boolean }) => {
      const rootPath = options.root;

      console.log(chalk.bold('Koda Improve — Running background agents...\n'));

      const agentManager = new BackgroundAgentManager(rootPath);

      // Collect source files
      const sourceFiles = collectSourceFiles(rootPath);

      if (sourceFiles.length === 0) {
        console.log(chalk.yellow('No source files found.'));
        return;
      }

      console.log(`Analyzing ${sourceFiles.length} files with ${agentManager.listAgents().length} agents...\n`);

      const results: Array<{ agentName: string; analysis: string; files: string[] }> = [];

      agentManager.on('result', (result) => {
        results.push(result);
        console.log(chalk.cyan(`[${result.agentName}]`) + ' ' + result.analysis);
      });

      await agentManager.trigger('onGitCommit', sourceFiles);

      if (results.length === 0) {
        console.log(chalk.green('\nNo issues found.'));
        return;
      }

      console.log(chalk.bold(`\n${results.length} analysis result(s) generated.`));

      // Check for stored patches in results dir
      const resultsDir = join(rootPath, '.koda', 'background-results');
      if (!existsSync(resultsDir)) {
        console.log('\nResults saved to .koda/background-results/');
        return;
      }

      const resultFiles = readdirSync(resultsDir).filter((f) => f.endsWith('.json'));
      console.log(`\nResults stored in .koda/background-results/ (${resultFiles.length} files)`);

      if (!options.yes) {
        const proceed = await confirm('Show full results? (y/N): ');
        if (!proceed) return;
      }

      for (const file of resultFiles.slice(-5)) {
        const content = await readFile(join(resultsDir, file), 'utf-8');
        const data = JSON.parse(content) as { agentName: string; analysis: string };
        console.log(chalk.bold(`\n=== ${data.agentName} ===`));
        console.log(data.analysis);
      }
    });
}

function collectSourceFiles(rootPath: string): string[] {
  const files: string[] = [];
  const extensions = ['.ts', '.js', '.py'];

  function walk(dir: string, depth = 0): void {
    if (depth > 5) return;
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue;
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath, depth + 1);
        } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
          files.push(fullPath);
        }
      }
    } catch {
      // Skip unreadable directories
    }
  }

  walk(rootPath);
  return files.slice(0, 100); // Limit to first 100 files
}

async function confirm(prompt: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}
