import { describe, it, expect } from 'vitest';
import { detectIntent } from '../../../src/cli/session/intent-detector.js';

describe('detectIntent', () => {
  // --- quit ---
  it('detects quit for "quit"', () => {
    expect(detectIntent('quit').intent).toBe('quit');
  });
  it('detects quit for "exit"', () => {
    expect(detectIntent('exit').intent).toBe('quit');
  });
  it('detects quit for "bye"', () => {
    expect(detectIntent('bye').intent).toBe('quit');
  });

  // --- help ---
  it('detects help for "help"', () => {
    expect(detectIntent('help').intent).toBe('help');
  });
  it('detects help for "?"', () => {
    expect(detectIntent('?').intent).toBe('help');
  });
  it('detects help for "what can you do"', () => {
    expect(detectIntent('what can you do').intent).toBe('help');
  });

  // --- status ---
  it('detects status for "status"', () => {
    expect(detectIntent('status').intent).toBe('status');
  });
  it('detects status for "show index status"', () => {
    expect(detectIntent('show index status').intent).toBe('status');
  });

  // --- fix ---
  it('detects fix for "fix the login bug"', () => {
    const r = detectIntent('fix the login bug');
    expect(r.intent).toBe('fix');
    expect(r.subject).toContain('login bug');
  });
  it('detects fix for "there is a bug in auth"', () => {
    expect(detectIntent('there is a bug in auth').intent).toBe('fix');
  });
  it('detects fix for "debug the failing test"', () => {
    expect(detectIntent('debug the failing test').intent).toBe('fix');
  });
  it('detects fix for "the API is broken"', () => {
    expect(detectIntent('the API is broken').intent).toBe('fix');
  });

  // --- refactor ---
  it('detects refactor for "refactor the auth module"', () => {
    const r = detectIntent('refactor the auth module');
    expect(r.intent).toBe('refactor');
    expect(r.subject).toContain('auth module');
  });
  it('detects refactor for "clean up the database layer"', () => {
    expect(detectIntent('clean up the database layer').intent).toBe('refactor');
  });
  it('detects refactor for "optimize the query engine"', () => {
    expect(detectIntent('optimize the query engine').intent).toBe('refactor');
  });

  // --- build ---
  it('detects build for "add JWT authentication"', () => {
    const r = detectIntent('add JWT authentication');
    expect(r.intent).toBe('build');
    expect(r.subject).toContain('JWT authentication');
  });
  it('detects build for "create a new user service"', () => {
    expect(detectIntent('create a new user service').intent).toBe('build');
  });
  it('detects build for "implement rate limiting"', () => {
    expect(detectIntent('implement rate limiting').intent).toBe('build');
  });
  it('detects build for "build a REST API"', () => {
    expect(detectIntent('build a REST API').intent).toBe('build');
  });

  // --- search ---
  it('detects search for "find the authentication logic"', () => {
    expect(detectIntent('find the authentication logic').intent).toBe('search');
  });
  it('detects search for "where is the user model"', () => {
    expect(detectIntent('where is the user model').intent).toBe('search');
  });

  // --- explain (default) ---
  it('detects explain for "explain the auth flow"', () => {
    const r = detectIntent('explain the auth flow');
    expect(r.intent).toBe('explain');
    expect(r.subject).toContain('auth flow');
  });
  it('detects explain for "what is the token service"', () => {
    expect(detectIntent('what is the token service').intent).toBe('explain');
  });
  it('detects explain for "how does middleware work"', () => {
    expect(detectIntent('how does middleware work').intent).toBe('explain');
  });
  it('defaults to explain for unrecognized input', () => {
    expect(detectIntent('authentication flow').intent).toBe('explain');
  });

  // --- confidence + subject ---
  it('returns confidence > 0 for all intents', () => {
    const inputs = ['fix bug', 'add feature', 'refactor code', 'explain auth', 'find module', 'status', 'help', 'quit'];
    for (const input of inputs) {
      expect(detectIntent(input).confidence).toBeGreaterThan(0);
    }
  });

  it('extracts subject correctly for build intent', () => {
    const r = detectIntent('add OAuth2 support');
    expect(r.intent).toBe('build');
    expect(r.subject).toBe('OAuth2 support');
  });

  it('extracts subject correctly for fix intent', () => {
    const r = detectIntent('fix the null pointer error');
    expect(r.intent).toBe('fix');
    expect(r.subject).toContain('null pointer error');
  });

  it('handles empty string gracefully', () => {
    const r = detectIntent('');
    expect(r.intent).toBe('help');
  });

  it('handles whitespace-only input gracefully', () => {
    const r = detectIntent('   ');
    expect(r.intent).toBe('help');
  });

  // Priority: higher-weight intent wins when multiple keywords match
  it('fix takes priority over explain when both match', () => {
    // "explain why it is broken" — 'broken' triggers fix (weight 75) > explain (weight 50)
    const r = detectIntent('explain why it is broken');
    expect(r.intent).toBe('fix');
  });
});
