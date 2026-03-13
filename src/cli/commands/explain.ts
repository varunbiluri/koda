import { Command } from 'commander';
import { SymbolIndex } from '../../symbols/symbol-index.js';
import { SymbolProvider } from '../../lsp/symbol-provider.js';
import { join } from 'path';
import { existsSync } from 'fs';
import chalk from 'chalk';

export function createExplainCommand(): Command {
  return new Command('explain')
    .description('Explain a symbol from the codebase')
    .argument('<symbol>', 'Symbol name to explain')
    .option('--root <path>', 'Repository root path', process.cwd())
    .action(async (symbolName: string, options: { root: string }) => {
      const rootPath = options.root;
      const indexPath = join(rootPath, '.koda', 'symbols');

      if (!existsSync(indexPath)) {
        console.error(chalk.red('No symbol index found. Run `koda init` first.'));
        process.exit(1);
      }

      const index = new SymbolIndex(indexPath);
      await index.load();

      const provider = new SymbolProvider(index);
      const info = provider.getHoverInfo(symbolName);

      if (!info) {
        console.log(chalk.yellow(`Symbol '${symbolName}' not found in index.`));
        process.exit(0);
      }

      const { symbol, definedIn, callers } = info;

      console.log(chalk.bold(`\n${symbol.type.toUpperCase()}: ${symbol.qualifiedName}`));
      console.log(chalk.gray(`Defined in: ${definedIn}:${symbol.location.line}`));

      if (symbol.signature) {
        console.log(chalk.cyan('\nSignature:'));
        console.log(`  ${symbol.signature}`);
      }

      if (symbol.docstring) {
        console.log(chalk.cyan('\nDocumentation:'));
        console.log(`  ${symbol.docstring}`);
      }

      if (callers.length > 0) {
        console.log(chalk.cyan(`\nCallers (${callers.length}):`));
        for (const caller of callers.slice(0, 10)) {
          console.log(`  - ${caller.qualifiedName} (${caller.location.filePath}:${caller.location.line})`);
        }
        if (callers.length > 10) {
          console.log(`  ... and ${callers.length - 10} more`);
        }
      }

      const refs = provider.findReferences(symbolName);
      if (refs.files.length > 0) {
        console.log(chalk.cyan('\nReferenced in files:'));
        for (const f of refs.files.slice(0, 10)) {
          console.log(`  ${f}`);
        }
      }

      console.log();
    });
}
