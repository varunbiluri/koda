import chalk from 'chalk';
import { KodaError, ErrorCode } from '../utils/errors.js';

export function formatError(err: unknown): string {
  if (err instanceof KodaError) {
    switch (err.code) {
      case ErrorCode.INDEX_NOT_FOUND:
        return chalk.red('No index found. Run ') + chalk.yellow('koda init') + chalk.red(' first.');
      case ErrorCode.INDEX_CORRUPTED:
        return chalk.red('Index is corrupted. Run ') + chalk.yellow('koda init --force') + chalk.red(' to re-index.');
      case ErrorCode.PERMISSION_DENIED:
        return chalk.red(`Permission denied: ${err.message}`);
      default:
        return chalk.red(`Error: ${err.message}`);
    }
  }
  if (err instanceof Error) {
    return chalk.red(`Error: ${err.message}`);
  }
  return chalk.red(`Unknown error: ${String(err)}`);
}

export function handleCliError(err: unknown): never {
  console.error(formatError(err));
  process.exit(1);
}
