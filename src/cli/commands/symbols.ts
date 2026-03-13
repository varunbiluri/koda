import { Command } from 'commander';
import { SymbolIndex } from '../../symbols/symbol-index.js';
import { SymbolGraph } from '../../symbols/symbol-graph.js';
import { join } from 'path';
import chalk from 'chalk';

export function createSymbolsCommand(): Command {
  const symbols = new Command('symbols');

  symbols
    .description('Search and analyze symbols in the codebase')
    .argument('[name]', 'Symbol name to search for')
    .option('--type <type>', 'Filter by symbol type (function, class, etc.)')
    .option('--file <file>', 'Filter by file path')
    .option('--callers', 'Show symbols that call this symbol')
    .option('--references', 'Show symbols referenced by this symbol')
    .option('--graph', 'Show full call graph')
    .action(async (name: string | undefined, options) => {
      console.log(chalk.blue('\n🔍 Koda Symbol Search\n'));

      try {
        const kodaDir = join(process.cwd(), '.koda');
        const symbolIndex = new SymbolIndex(join(kodaDir, 'symbols'));

        // Load index
        await symbolIndex.load();

        // Search symbols
        if (name) {
          const results = symbolIndex.search(name, 10);

          if (results.length === 0) {
            console.log(chalk.yellow(`No symbols found matching "${name}"\n`));
            process.exit(0);
          }

          console.log(chalk.bold(`Found ${results.length} symbol(s):\n`));

          for (const result of results) {
            const { symbol, score, matchReason } = result;

            console.log(chalk.cyan(`${symbol.name} (${symbol.type})`));
            console.log(`  ${chalk.gray(`Location: ${symbol.location.filePath}:${symbol.location.line}`)}`);
            console.log(`  ${chalk.gray(`Match: ${matchReason} (score: ${Math.round(score)}%)`)}`);

            if (symbol.signature) {
              console.log(`  ${chalk.gray(`Signature: ${symbol.signature}`)}`);
            }

            if (symbol.modifiers.length > 0) {
              console.log(`  ${chalk.gray(`Modifiers: ${symbol.modifiers.join(', ')}`)}`);
            }

            // Show callers if requested
            if (options.callers) {
              const callers = symbolIndex.getCallers(symbol.id);
              if (callers.length > 0) {
                console.log(`  ${chalk.yellow('Callers:')}`);
                callers.slice(0, 5).forEach((c) => {
                  console.log(`    - ${c.name} (${c.location.filePath})`);
                });
                if (callers.length > 5) {
                  console.log(`    ... and ${callers.length - 5} more`);
                }
              }
            }

            // Show references if requested
            if (options.references) {
              const refs = symbolIndex.getReferences(symbol.id);
              if (refs.length > 0) {
                console.log(`  ${chalk.yellow('References:')}`);
                refs.slice(0, 5).forEach((r) => {
                  console.log(`    - ${r.name} (${r.location.filePath})`);
                });
                if (refs.length > 5) {
                  console.log(`    ... and ${refs.length - 5} more`);
                }
              }
            }

            // Show graph if requested
            if (options.graph) {
              const symbolGraph = new SymbolGraph(symbolIndex);
              const deps = symbolGraph.getDependencies(symbol.id, 2);

              if (deps.length > 0) {
                console.log(`  ${chalk.yellow('Dependency Graph:')}`);
                deps.slice(0, 5).forEach((d) => {
                  console.log(`    └─> ${d.name} (${d.type})`);
                });
              }
            }

            console.log('');
          }
        } else {
          // Show statistics
          const stats = symbolIndex.getStatistics();

          console.log(chalk.bold('Symbol Index Statistics:\n'));
          console.log(`Total symbols: ${stats.totalSymbols}`);
          console.log(`Files indexed: ${stats.byFile}`);
          console.log(`Exported symbols: ${stats.exported}`);
          console.log(`Imported symbols: ${stats.imported}`);
          console.log('');

          console.log(chalk.bold('By Type:'));
          for (const [type, count] of Object.entries(stats.byType)) {
            console.log(`  ${type}: ${count}`);
          }
          console.log('');
        }

        console.log(chalk.green('✓ Done\n'));
      } catch (error) {
        console.error(chalk.red(`\n✗ Error: ${(error as Error).message}\n`));
        process.exit(1);
      }
    });

  return symbols;
}
