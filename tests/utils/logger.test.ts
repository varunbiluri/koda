import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  LogLevel,
  parseLogLevel,
  applyReplLogDefaults,
  applyCliLogDefaults,
  getLogLevel,
  setLogLevel,
} from '../../src/utils/logger.js';

describe('logger', () => {
  const origEnv = process.env.KODA_LOG;

  afterEach(() => {
    if (origEnv === undefined) delete process.env.KODA_LOG;
    else process.env.KODA_LOG = origEnv;
    applyCliLogDefaults();
  });

  it('parseLogLevel accepts common names', () => {
    expect(parseLogLevel('debug')).toBe(LogLevel.DEBUG);
    expect(parseLogLevel('INFO')).toBe(LogLevel.INFO);
    expect(parseLogLevel('warn')).toBe(LogLevel.WARN);
    expect(parseLogLevel('quiet')).toBe(LogLevel.SILENT);
    expect(parseLogLevel('nope')).toBeUndefined();
  });

  it('applyReplLogDefaults uses WARN when KODA_LOG unset', () => {
    delete process.env.KODA_LOG;
    applyReplLogDefaults();
    expect(getLogLevel()).toBe(LogLevel.WARN);
  });

  it('applyReplLogDefaults respects KODA_LOG', () => {
    process.env.KODA_LOG = 'debug';
    applyReplLogDefaults();
    expect(getLogLevel()).toBe(LogLevel.DEBUG);
  });

  it('applyCliLogDefaults restores INFO by default', () => {
    delete process.env.KODA_LOG;
    setLogLevel(LogLevel.SILENT);
    applyCliLogDefaults();
    expect(getLogLevel()).toBe(LogLevel.INFO);
  });
});
