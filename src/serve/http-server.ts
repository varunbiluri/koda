import * as crypto from 'node:crypto';
import * as http from 'node:http';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { VERSION } from '../constants.js';
import { configExists, loadConfig } from '../ai/config-store.js';
import { loadIndex } from '../store/index-store.js';
import { mcpManager } from '../mcp/mcp-manager.js';
import { ConversationEngine } from '../cli/session/conversation-engine.js';
import { ProductMetrics } from '../product/metrics.js';
import { ApiUIRenderer } from './api-ui-renderer.js';
import { ApprovalStore } from './approval-store.js';
import { ThreadStore } from './thread-store.js';
import {
  fetchAnthropicModels,
  fetchAzureDeployments,
  fetchOllamaModels,
  fetchOpenAIModels,
  getConfigStatus,
  saveAndValidateConfig,
} from './config-service.js';
import type { ServeEvent, ServeServerOptions, ServeStatus } from './types.js';

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
} as const;

function getGitBranch(rootPath: string): string {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: rootPath,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'unknown';
  }
}

function writeSse(res: http.ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function parseJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function corsHeaders(origin: string | undefined): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin ?? '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

export class ServeServer {
  private server: http.Server | null = null;
  private readonly token: string;
  private readonly rootPath: string;
  private readonly host: string;
  private readonly port: number;
  private readonly autoApprove: boolean;
  private readonly approvals = new ApprovalStore();
  private readonly threads: ThreadStore;

  constructor(options: ServeServerOptions) {
    this.rootPath = path.resolve(options.rootPath);
    this.host = options.host ?? '127.0.0.1';
    this.port = options.port ?? 8787;
    this.token = options.token ?? crypto.randomBytes(24).toString('hex');
    this.autoApprove = options.autoApprove ?? false;
    this.threads = new ThreadStore(this.rootPath);
  }

  getAuthToken(): string {
    return this.token;
  }

  getAddress(): { host: string; port: number } {
    const addr = this.server?.address();
    const port = typeof addr === 'object' && addr ? addr.port : this.port;
    return { host: this.host, port };
  }

  async getStatus(): Promise<ServeStatus> {
    const repoName = path.basename(this.rootPath);
    const branch = getGitBranch(this.rootPath);
    const hasConfig = await configExists();

    let indexStatus: ServeStatus['indexStatus'] = 'missing';
    let fileCount: number | undefined;
    let chunkCount: number | undefined;
    let symbolCount: number | undefined;

    try {
      const index = await loadIndex(this.rootPath);
      indexStatus = 'ready';
      fileCount = index.metadata.fileCount;
      chunkCount = index.metadata.chunkCount;
      symbolCount = index.nodes?.length ?? 0;
    } catch {
      indexStatus = 'missing';
    }

    let model = 'not configured';
    let provider = 'none';
    if (hasConfig) {
      try {
        const cfg = await loadConfig();
        model = cfg.model;
        provider = cfg.provider;
      } catch {
        // ignore
      }
    }

    return {
      repoName,
      branch,
      indexStatus,
      model,
      provider,
      hasConfig,
      rootPath: this.rootPath,
      fileCount,
      chunkCount,
      symbolCount,
    };
  }

  private isAuthorized(req: http.IncomingMessage): boolean {
    const header = req.headers.authorization ?? '';
    const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
    const query = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`).searchParams.get('token');
    return bearer === this.token || query === this.token;
  }

  private unauthorized(res: http.ServerResponse): void {
    res.writeHead(401, JSON_HEADERS);
    res.end(JSON.stringify({ error: 'Unauthorized' }));
  }

  private async computeKei(): Promise<number> {
    try {
      const pm = await ProductMetrics.load(this.rootPath);
      return pm.computeKei();
    } catch {
      return 0;
    }
  }

  private async handleThreadsList(res: http.ServerResponse, origin?: string): Promise<void> {
    await this.threads.load();
    res.writeHead(200, { ...JSON_HEADERS, ...corsHeaders(origin) });
    res.end(JSON.stringify({ threads: this.threads.list() }));
  }

  private async handleThreadCreate(req: http.IncomingMessage, res: http.ServerResponse, origin?: string): Promise<void> {
    const body = (await parseJsonBody(req)) as { title?: string };
    const thread = await this.threads.create(body.title?.trim() || 'New thread');
    res.writeHead(201, { ...JSON_HEADERS, ...corsHeaders(origin) });
    res.end(JSON.stringify({ thread }));
  }

  private async handleApprovalsList(res: http.ServerResponse, origin?: string): Promise<void> {
    res.writeHead(200, { ...JSON_HEADERS, ...corsHeaders(origin) });
    res.end(JSON.stringify({ approvals: this.approvals.listPending() }));
  }

  private async handleApprovalAction(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    id: string,
    origin?: string,
  ): Promise<void> {
    const body = (await parseJsonBody(req)) as { action?: string };
    const approved = body.action === 'approve';
    const ok = this.approvals.resolve(id, approved);
    if (!ok) {
      res.writeHead(404, JSON_HEADERS);
      res.end(JSON.stringify({ error: 'Approval not found or already resolved' }));
      return;
    }
    res.writeHead(200, { ...JSON_HEADERS, ...corsHeaders(origin) });
    res.end(JSON.stringify({ id, approved }));
  }

  private async handleChat(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!this.isAuthorized(req)) {
      this.unauthorized(res);
      return;
    }

    let body: { message?: string; threadId?: string; autoApprove?: boolean };
    try {
      body = (await parseJsonBody(req)) as typeof body;
    } catch {
      res.writeHead(400, JSON_HEADERS);
      res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      return;
    }

    const message = body.message?.trim();
    if (!message) {
      res.writeHead(400, JSON_HEADERS);
      res.end(JSON.stringify({ error: 'Missing message' }));
      return;
    }

    await this.threads.load();
    let thread = body.threadId ? this.threads.get(body.threadId) : undefined;
    if (!thread) {
      thread = await this.threads.create(message.slice(0, 48));
    }
    await this.threads.appendMessage(thread.id, { role: 'user', content: message });

    const status = await this.getStatus();
    const index = status.indexStatus === 'ready' ? await loadIndex(this.rootPath) : null;
    const autoApprove = body.autoApprove ?? this.autoApprove;

    res.writeHead(200, {
      ...corsHeaders(req.headers.origin),
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    writeSse(res, 'thread', { threadId: thread.id, title: thread.title });

    let streamedOutput = '';
    const ui = new ApiUIRenderer((event) => {
      if (event.type === 'token') {
        streamedOutput += event.text;
      }
      if (event.type === 'context') {
        writeSse(res, 'context', {
          ...event,
          fileCount: status.fileCount,
          chunkCount: status.chunkCount,
          symbolCount: status.symbolCount,
          refs: ui.getSessionMetrics().toolResultsViaRef,
        });
        return;
      }
      writeSse(res, event.type, event);
    });

    const engine = new ConversationEngine(ui);

    mcpManager.setRootPath(this.rootPath);
    await mcpManager.ensureConnected(this.rootPath).catch(() => undefined);

    const result = await engine.process(
      message,
      {
        rootPath: this.rootPath,
        index,
        hasConfig: status.hasConfig,
        branch: status.branch,
      },
      undefined,
      async (filePath, oldContent, newContent) => {
        ui.renderDiffPreview(filePath, oldContent, newContent);

        if (autoApprove) return true;

        const approval = this.approvals.createWriteApproval(filePath, oldContent, newContent);
        writeSse(res, 'approval', { approval });

        const approved = await this.approvals.wait(approval.id);
        writeSse(res, 'approval_resolved', { id: approval.id, approved });
        return approved;
      },
    );

    const output = result.output ?? streamedOutput;
    if (output) {
      await this.threads.appendMessage(thread.id, { role: 'assistant', content: output });
    }

    const metrics = ui.getSessionMetrics();
    const kei = await this.computeKei();

    writeSse(res, 'done', {
      output,
      handled: result.handled,
      metrics,
      kei,
      threadId: thread.id,
      provider: status.provider,
      model: status.model,
    });
    res.end();
  }

  async start(): Promise<void> {
    this.server = http.createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      const origin = req.headers.origin;

      if (req.method === 'OPTIONS') {
        res.writeHead(204, corsHeaders(origin));
        res.end();
        return;
      }

      try {
        if (req.method === 'GET' && url.pathname === '/health') {
          res.writeHead(200, { ...JSON_HEADERS, ...corsHeaders(origin) });
          res.end(JSON.stringify({ ok: true, version: VERSION }));
          return;
        }

        if (req.method === 'GET' && url.pathname === '/api/config') {
          if (!this.isAuthorized(req)) return this.unauthorized(res);
          const config = await getConfigStatus();
          res.writeHead(200, { ...JSON_HEADERS, ...corsHeaders(origin) });
          res.end(JSON.stringify(config));
          return;
        }

        if (req.method === 'POST' && url.pathname === '/api/config/azure/deployments') {
          if (!this.isAuthorized(req)) return this.unauthorized(res);
          const body = (await parseJsonBody(req)) as { endpoint?: string; apiKey?: string };
          try {
            const deployments = await fetchAzureDeployments(body.endpoint ?? '', body.apiKey ?? '');
            res.writeHead(200, { ...JSON_HEADERS, ...corsHeaders(origin) });
            res.end(JSON.stringify({ deployments }));
          } catch (err) {
            res.writeHead(400, JSON_HEADERS);
            res.end(JSON.stringify({ error: (err as Error).message }));
          }
          return;
        }

        if (req.method === 'POST' && url.pathname === '/api/config/openai/models') {
          if (!this.isAuthorized(req)) return this.unauthorized(res);
          const body = (await parseJsonBody(req)) as { apiKey?: string; endpoint?: string };
          try {
            const models = await fetchOpenAIModels(body.apiKey ?? '', body.endpoint);
            res.writeHead(200, { ...JSON_HEADERS, ...corsHeaders(origin) });
            res.end(JSON.stringify({ models }));
          } catch (err) {
            res.writeHead(400, JSON_HEADERS);
            res.end(JSON.stringify({ error: (err as Error).message }));
          }
          return;
        }

        if (req.method === 'POST' && url.pathname === '/api/config/anthropic/models') {
          if (!this.isAuthorized(req)) return this.unauthorized(res);
          const body = (await parseJsonBody(req)) as { apiKey?: string; endpoint?: string };
          try {
            const models = await fetchAnthropicModels(body.apiKey ?? '', body.endpoint);
            res.writeHead(200, { ...JSON_HEADERS, ...corsHeaders(origin) });
            res.end(JSON.stringify({ models }));
          } catch (err) {
            res.writeHead(400, JSON_HEADERS);
            res.end(JSON.stringify({ error: (err as Error).message }));
          }
          return;
        }

        if (req.method === 'POST' && url.pathname === '/api/config/ollama/models') {
          if (!this.isAuthorized(req)) return this.unauthorized(res);
          const body = (await parseJsonBody(req)) as { endpoint?: string };
          try {
            const models = await fetchOllamaModels(body.endpoint);
            res.writeHead(200, { ...JSON_HEADERS, ...corsHeaders(origin) });
            res.end(JSON.stringify({ models }));
          } catch (err) {
            res.writeHead(400, JSON_HEADERS);
            res.end(JSON.stringify({ error: (err as Error).message }));
          }
          return;
        }

        if (req.method === 'POST' && url.pathname === '/api/config') {
          if (!this.isAuthorized(req)) return this.unauthorized(res);
          try {
            const body = (await parseJsonBody(req)) as Record<string, unknown>;
            const status = await saveAndValidateConfig(body as Parameters<typeof saveAndValidateConfig>[0]);
            res.writeHead(200, { ...JSON_HEADERS, ...corsHeaders(origin) });
            res.end(JSON.stringify({ ok: true, config: status }));
          } catch (err) {
            res.writeHead(400, JSON_HEADERS);
            res.end(JSON.stringify({ error: (err as Error).message }));
          }
          return;
        }

        if (req.method === 'GET' && url.pathname === '/api/status') {
          if (!this.isAuthorized(req)) return this.unauthorized(res);
          const status = await this.getStatus();
          res.writeHead(200, { ...JSON_HEADERS, ...corsHeaders(origin) });
          res.end(JSON.stringify({ ...status, version: VERSION }));
          return;
        }

        if (req.method === 'GET' && url.pathname === '/api/threads') {
          if (!this.isAuthorized(req)) return this.unauthorized(res);
          await this.handleThreadsList(res, origin);
          return;
        }

        if (req.method === 'POST' && url.pathname === '/api/threads') {
          if (!this.isAuthorized(req)) return this.unauthorized(res);
          await this.handleThreadCreate(req, res, origin);
          return;
        }

        if (req.method === 'GET' && url.pathname === '/api/approvals') {
          if (!this.isAuthorized(req)) return this.unauthorized(res);
          await this.handleApprovalsList(res, origin);
          return;
        }

        const approvalMatch = url.pathname.match(/^\/api\/approvals\/([^/]+)$/);
        if (req.method === 'POST' && approvalMatch) {
          if (!this.isAuthorized(req)) return this.unauthorized(res);
          await this.handleApprovalAction(req, res, approvalMatch[1], origin);
          return;
        }

        if (req.method === 'POST' && url.pathname === '/api/chat') {
          await this.handleChat(req, res);
          return;
        }

        res.writeHead(404, JSON_HEADERS);
        res.end(JSON.stringify({ error: 'Not found' }));
      } catch (err) {
        if (!res.headersSent) {
          res.writeHead(500, JSON_HEADERS);
          res.end(JSON.stringify({ error: (err as Error).message }));
        } else {
          writeSse(res, 'error', { message: (err as Error).message });
          res.end();
        }
      }
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(this.port, this.host, resolve);
    });
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve, reject) => {
      this.server!.close((err) => (err ? reject(err) : resolve()));
    });
    this.server = null;
  }
}
