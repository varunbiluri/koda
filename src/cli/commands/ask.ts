import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { QueryEngine } from '../../search/query-engine.js';
import { loadIndex } from '../../store/index-store.js';
import { loadConfig, configExists } from '../../ai/config-store.js';
import { AzureAIProvider } from '../../ai/providers/azure-provider.js';
import { ReasoningEngine } from '../../ai/reasoning/reasoning-engine.js';
import { handleCliError } from '../errors.js';

export const askCommand = new Command('ask')
  .description('Search the codebase with a natural language query')
  .argument('<query>', 'Search query')
  .option('-n, --limit <number>', 'Number of results', '10')
  .option('--no-ai', 'Disable AI reasoning, show search results only')
  .action(async (query: string, options: { limit: string; ai: boolean }) => {
    try {
      const rootPath = process.cwd();
      const index = await loadIndex(rootPath);

      // Check if AI is available and enabled
      const hasConfig = await configExists();
      const useAI = options.ai && hasConfig;

      if (useAI) {
        // AI-powered analysis
        await runAIAnalysis(query, index, parseInt(options.limit, 10));
      } else {
        // Fallback to search-only mode
        if (!hasConfig && options.ai) {
          console.log(
            chalk.yellow('⚠ No AI configuration found. Run "koda login" to enable AI analysis.\n'),
          );
          console.log(chalk.gray('Showing search results instead:\n'));
        }
        await runSearchOnly(query, index, parseInt(options.limit, 10));
      }
    } catch (err) {
      handleCliError(err);
    }
  });

async function runAIAnalysis(query: string, index: any, limit: number): Promise<void> {
  const spinner = ora('Analyzing repository...').start();

  try {
    const config = await loadConfig();
    const provider = new AzureAIProvider(config);
    const engine = new ReasoningEngine(index, provider);

    spinner.text = 'Searching codebase...';

    let fullResponse = '';
    const metadata = await engine.analyzeStream(
      query,
      (chunk) => {
        if (spinner.isSpinning) {
          spinner.stop();
          console.log(chalk.bold('\n' + query + '\n'));
        }
        process.stdout.write(chalk.white(chunk));
        fullResponse += chunk;
      },
      { maxResults: limit },
    );

    if (spinner.isSpinning) {
      spinner.stop();
    }

    console.log('\n');

    // Show metadata
    console.log(chalk.gray('─'.repeat(60)));
    console.log(chalk.gray(`Files analyzed: ${metadata.filesAnalyzed.length}`));
    console.log(chalk.gray(`Code chunks: ${metadata.chunksUsed}`));
    if (metadata.contextTruncated) {
      console.log(chalk.yellow('⚠ Context was truncated due to size limits'));
    }
    console.log();
  } catch (err) {
    spinner.fail('AI analysis failed');
    console.log(chalk.yellow('\nFalling back to search results:\n'));
    await runSearchOnly(query, index, limit);
  }
}

async function runSearchOnly(query: string, index: any, limit: number): Promise<void> {
  const engine = new QueryEngine(index);
  const results = engine.search(query, limit);

  if (results.length === 0) {
    console.log(chalk.yellow('No results found.'));
    return;
  }

  console.log(chalk.bold(`Top ${results.length} results for: "${query}"\n`));

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const chunk = index.chunks.find((c: any) => c.id === r.chunkId);
    if (!chunk) continue;

    console.log(
      chalk.cyan(`${i + 1}. `) +
      chalk.bold(chunk.filePath) +
      chalk.gray(` #${chunk.name}`) +
      chalk.gray(` (${chunk.type})`) +
      chalk.yellow(` [score: ${r.score.toFixed(3)}]`),
    );
    console.log(chalk.gray(`   Lines ${chunk.startLine}-${chunk.endLine}`));

    const preview = chunk.content.split('\n').slice(0, 5).join('\n');
    console.log(chalk.gray('   ' + preview.replace(/\n/g, '\n   ')));
    console.log();
  }
}
