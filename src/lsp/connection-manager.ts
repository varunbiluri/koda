import { EventEmitter } from 'events';
import { Readable, Writable } from 'stream';

export interface LspMessage {
  jsonrpc: '2.0';
  id?: number | string | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/**
 * ConnectionManager - Handles LSP message framing over stdin/stdout.
 * Implements Content-Length header + JSON body protocol.
 */
export class ConnectionManager extends EventEmitter {
  private buffer = '';

  constructor(
    private input: Readable,
    private output: Writable,
  ) {
    super();
    this.input.setEncoding('utf8');
    this.input.on('data', (chunk: string) => this.onData(chunk));
    this.input.on('end', () => this.emit('close'));
  }

  private onData(chunk: string): void {
    this.buffer += chunk;

    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) break;

      const header = this.buffer.slice(0, headerEnd);
      const contentLengthMatch = header.match(/Content-Length:\s*(\d+)/i);
      if (!contentLengthMatch) {
        this.buffer = this.buffer.slice(headerEnd + 4);
        continue;
      }

      const contentLength = parseInt(contentLengthMatch[1], 10);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + contentLength) break;

      const body = this.buffer.slice(bodyStart, bodyStart + contentLength);
      this.buffer = this.buffer.slice(bodyStart + contentLength);

      try {
        const message = JSON.parse(body) as LspMessage;
        this.emit('message', message);
      } catch {
        // Ignore malformed messages
      }
    }
  }

  private write(message: LspMessage): void {
    const body = JSON.stringify(message);
    const header = `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n`;
    this.output.write(header + body);
  }

  sendResponse(id: number | string | null, result: unknown): void {
    this.write({ jsonrpc: '2.0', id, result });
  }

  sendError(id: number | string | null, code: number, message: string, data?: unknown): void {
    this.write({ jsonrpc: '2.0', id, error: { code, message, data } });
  }

  sendNotification(method: string, params?: unknown): void {
    this.write({ jsonrpc: '2.0', method, params });
  }
}
