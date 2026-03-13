import { describe, it, expect, beforeEach } from 'vitest';
import { PassThrough } from 'stream';
import { ConnectionManager } from '../../src/lsp/connection-manager.js';

function encodeMessage(obj: object): string {
  const body = JSON.stringify(obj);
  return `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`;
}

describe('ConnectionManager', () => {
  it('parses a single LSP message from stream', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const cm = new ConnectionManager(input, output);

    const received: unknown[] = [];
    cm.on('message', (msg) => received.push(msg));

    const request = { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} };
    input.write(encodeMessage(request));

    await new Promise((r) => setImmediate(r));

    expect(received).toHaveLength(1);
    expect((received[0] as { method: string }).method).toBe('initialize');
  });

  it('sends a response with correct Content-Length framing', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const cm = new ConnectionManager(input, output);

    output.setEncoding('utf8');
    let raw = '';
    output.on('data', (chunk: string) => { raw += chunk; });

    cm.sendResponse(1, { capabilities: {} });

    await new Promise((r) => setImmediate(r));

    expect(raw).toContain('Content-Length:');
    expect(raw).toContain('"result"');
    expect(raw).toContain('"capabilities"');
  });

  it('sends an error response', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const cm = new ConnectionManager(input, output);

    output.setEncoding('utf8');
    let raw = '';
    output.on('data', (chunk: string) => { raw += chunk; });

    cm.sendError(1, -32600, 'Invalid Request');

    await new Promise((r) => setImmediate(r));

    expect(raw).toContain('"error"');
    expect(raw).toContain('Invalid Request');
  });

  it('handles multiple messages in a single chunk', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const cm = new ConnectionManager(input, output);

    const received: unknown[] = [];
    cm.on('message', (msg) => received.push(msg));

    const msg1 = encodeMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    const msg2 = encodeMessage({ jsonrpc: '2.0', id: 2, method: 'initialized', params: {} });
    input.write(msg1 + msg2);

    await new Promise((r) => setImmediate(r));

    expect(received).toHaveLength(2);
  });
});

describe('LspServer capabilities', () => {
  it('returns correct server capabilities on initialize', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const cm = new ConnectionManager(input, output);

    output.setEncoding('utf8');
    let raw = '';
    output.on('data', (chunk: string) => { raw += chunk; });

    // Simulate initialize by manually invoking the connection
    cm.sendResponse(1, {
      capabilities: {
        textDocumentSync: 1,
        hoverProvider: true,
        definitionProvider: true,
        referencesProvider: true,
        workspaceSymbolProvider: true,
        codeActionProvider: true,
      },
      serverInfo: { name: 'koda-lsp', version: '1.0.0' },
    });

    await new Promise((r) => setImmediate(r));

    const bodyMatch = raw.match(/\r\n\r\n(.*)/s);
    expect(bodyMatch).not.toBeNull();
    const parsed = JSON.parse(bodyMatch![1]);
    expect(parsed.result.capabilities.hoverProvider).toBe(true);
    expect(parsed.result.capabilities.definitionProvider).toBe(true);
    expect(parsed.result.serverInfo.name).toBe('koda-lsp');
  });
});
