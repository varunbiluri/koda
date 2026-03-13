import { Command } from 'commander';
import * as readline from 'node:readline';
import chalk from 'chalk';
import ora from 'ora';
import { runIndexingPipeline } from '../../engine/indexing-pipeline.js';
import { loadIndex } from '../../store/index-store.js';
import { QueryEngine } from '../../search/query-engine.js';
import { loadIndexMetadata } from '../../store/index-store.js';
import type { RepoIndex } from '../../types/index.js';

export const replCommand = new Command('repl')
  .description('Start interactive REPL mode')
  .action(async () => {
    console.log(chalk.bold('\nKoda Interactive Mode'));
    console.log(chalk.gray('Commands: /init, /ask <query>, /status, /quit\n'));

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: chalk.cyan('koda> '),
    });

    let index: RepoIndex | null = null;
    const rootPath = process.cwd();

    // Try to load existing index
    try {
      index = await loadIndex(rootPath);
      console.log(chalk.green('Loaded existing index.'));
    } catch {
      console.log(chalk.yellow('No index found. Use /init to index this repo.'));
    }

    rl.prompt();

    rl.on('line', async (line) => {
      const input = line.trim();
      if (!input) {
        rl.prompt();
        return;
      }

      if (input === '/quit' || input === '/exit') {
        console.log(chalk.gray('Goodbye!'));
        rl.close();
        return;
      }

      if (input === '/init') {
        const spinner = ora('Indexing...').start();
        try {
          const result = await runIndexingPipeline(rootPath, {
            force: true,
            onProgress(stage: string) { spinner.text = stage; },
          });
          index = await loadIndex(rootPath);
          spinner.succeed(`Indexed ${result.metadata.fileCount} files, ${result.metadata.chunkCount} chunks`);
        } catch (err) {
          spinner.fail(`Indexing failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        rl.prompt();
        return;
      }

      if (input === '/status') {
        try {
          const meta = await loadIndexMetadata(rootPath);
          console.log(`  Files: ${meta.fileCount} | Chunks: ${meta.chunkCount} | Deps: ${meta.edgeCount}`);
        } catch {
          console.log(chalk.yellow('No index. Use /init first.'));
        }
        rl.prompt();
        return;
      }

      if (input.startsWith('/ask ')) {
        const query = input.slice(5).trim();
        if (!query) {
          console.log(chalk.yellow('Usage: /ask <query>'));
          rl.prompt();
          return;
        }

        if (!index) {
          console.log(chalk.yellow('No index loaded. Use /init first.'));
          rl.prompt();
          return;
        }

        const engine = new QueryEngine(index);
        const results = engine.search(query, 5);

        if (results.length === 0) {
          console.log(chalk.yellow('No results found.'));
        } else {
          for (const r of results) {
            const chunk = index.chunks.find(c => c.id === r.chunkId);
            if (!chunk) continue;
            console.log(
              chalk.cyan(`  ${chunk.filePath}`) +
              chalk.gray(`#${chunk.name}`) +
              chalk.yellow(` [${r.score.toFixed(3)}]`)
            );
          }
        }
        rl.prompt();
        return;
      }

      // Default: treat as an ask query
      if (index) {
        const engine = new QueryEngine(index);
        const results = engine.search(input, 5);
        if (results.length === 0) {
          console.log(chalk.yellow('No results. Try /init if you haven\'t indexed yet.'));
        } else {
          for (const r of results) {
            const chunk = index.chunks.find(c => c.id === r.chunkId);
            if (!chunk) continue;
            console.log(
              chalk.cyan(`  ${chunk.filePath}`) +
              chalk.gray(`#${chunk.name}`) +
              chalk.yellow(` [${r.score.toFixed(3)}]`)
            );
          }
        }
      } else {
        console.log(chalk.yellow('No index loaded. Use /init first.'));
      }

      rl.prompt();
    });

    rl.on('close', () => {
      process.exit(0);
    });
  });
