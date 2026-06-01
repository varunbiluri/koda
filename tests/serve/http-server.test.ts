import { describe, it, expect, afterEach } from 'vitest';
import { ServeServer } from '../../src/serve/http-server.js';

describe('ServeServer', () => {
  let server: ServeServer | null = null;

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
  });

  it('serves health without auth', async () => {
    server = new ServeServer({ rootPath: process.cwd(), port: 0, token: 'test-token' });
    await server.start();
    const { port, host } = server.getAddress();

    const res = await fetch(`http://${host}:${port}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('rejects status without token', async () => {
    server = new ServeServer({ rootPath: process.cwd(), port: 0, token: 'secret' });
    await server.start();
    const { port, host } = server.getAddress();

    const res = await fetch(`http://${host}:${port}/api/status`);
    expect(res.status).toBe(401);
  });

  it('returns repo status with token', async () => {
    server = new ServeServer({ rootPath: process.cwd(), port: 0, token: 'secret' });
    await server.start();
    const { port, host } = server.getAddress();

    const res = await fetch(`http://${host}:${port}/api/status`, {
      headers: { Authorization: 'Bearer secret' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rootPath).toBe(process.cwd());
    expect(body).toHaveProperty('repoName');
    expect(body).toHaveProperty('provider');
  });

  it('lists and creates threads', async () => {
    server = new ServeServer({ rootPath: process.cwd(), port: 0, token: 'secret' });
    await server.start();
    const { port, host } = server.getAddress();
    const headers = { Authorization: 'Bearer secret', 'Content-Type': 'application/json' };

    const create = await fetch(`http://${host}:${port}/api/threads`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ title: 'Test thread' }),
    });
    expect(create.status).toBe(201);

    const list = await fetch(`http://${host}:${port}/api/threads`, { headers });
    const body = await list.json();
    expect(body.threads.length).toBeGreaterThan(0);
  });
});
