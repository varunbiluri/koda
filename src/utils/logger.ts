export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  SILENT = 4,
}

let currentLevel = LogLevel.INFO;

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function getLogLevel(): LogLevel {
  return currentLevel;
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
