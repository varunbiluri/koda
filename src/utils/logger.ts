export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  SILENT = 4,
}

/** Default for one-shot CLI commands (`koda build`, etc.). */
const CLI_DEFAULT = LogLevel.INFO;
/** Interactive REPL — silent unless something breaks; use /verbose for internals. */
const REPL_DEFAULT = LogLevel.ERROR;

let currentLevel = CLI_DEFAULT;

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function getLogLevel(): LogLevel {
  return currentLevel;
}

/** Parse KODA_LOG env value (debug|info|warn|error|silent). Returns undefined if unset/invalid. */
export function parseLogLevel(name: string | undefined): LogLevel | undefined {
  if (!name) return undefined;
  switch (name.trim().toLowerCase()) {
    case 'debug':  return LogLevel.DEBUG;
    case 'info':   return LogLevel.INFO;
    case 'warn':
    case 'warning': return LogLevel.WARN;
    case 'error':  return LogLevel.ERROR;
    case 'silent':
    case 'quiet':  return LogLevel.SILENT;
    default:       return undefined;
  }
}

/** Apply KODA_LOG when set; otherwise use CLI default (INFO). */
export function configureLogLevelFromEnv(): void {
  const fromEnv = parseLogLevel(process.env.KODA_LOG);
  setLogLevel(fromEnv ?? CLI_DEFAULT);
}

/** Claude Code–style REPL: errors only unless /verbose or KODA_LOG overrides. */
export function applyReplLogDefaults(): void {
  const fromEnv = parseLogLevel(process.env.KODA_LOG);
  setLogLevel(fromEnv ?? REPL_DEFAULT);
}

/** Restore default log level after REPL exits. */
export function applyCliLogDefaults(): void {
  configureLogLevelFromEnv();
}

export const logger = {
  debug(...args: unknown[]): void {
    if (currentLevel <= LogLevel.DEBUG) {
      console.debug('[koda:debug]', ...args);
    }
  },
  info(...args: unknown[]): void {
    if (currentLevel <= LogLevel.INFO) {
      console.log('[koda]', ...args);
    }
  },
  warn(...args: unknown[]): void {
    if (currentLevel <= LogLevel.WARN) {
      console.warn('[koda:warn]', ...args);
    }
  },
  error(...args: unknown[]): void {
    if (currentLevel <= LogLevel.ERROR) {
      console.error('[koda:error]', ...args);
    }
  },
};
