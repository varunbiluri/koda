import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { ReviewAgent } from '../../src/agents/review-agent.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'koda-review-'));
  await fs.mkdir(path.join(tmpDir, 'src'), { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

async function write(rel: string, content: string) {
  const abs = path.join(tmpDir, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, 'utf-8');
}

describe('ReviewAgent', () => {
  it('returns empty issues for clean code', async () => {
    await write('src/utils.ts', 'export function add(a: number, b: number): number { return a + b; }\n');

    const agent = new ReviewAgent(tmpDir);
    const report = await agent.run();

    expect(report.filesReviewed).toBeGreaterThan(0);
    expect(report.issues.filter((i) => i.file.includes('utils'))).toHaveLength(0);
  });

  it('detects eval() as an error', async () => {
    await write('src/bad.ts', 'const result = eval(userInput);\n');

    const agent = new ReviewAgent(tmpDir);
    const report = await agent.run();

    const evalIssue = report.issues.find((i) => i.message.includes('eval()'));
    expect(evalIssue).toBeDefined();
    expect(evalIssue?.severity).toBe('error');
    expect(evalIssue?.file).toContain('bad.ts');
  });

  it('detects TODO comments as info', async () => {
    await write('src/todo.ts', '// TODO: implement this properly\nexport const x = 1;\n');

    const agent = new ReviewAgent(tmpDir);
    const report = await agent.run();

    const todoIssue = report.issues.find((i) => i.message.includes('TODO'));
    expect(todoIssue).toBeDefined();
    expect(todoIssue?.severity).toBe('info');
  });

  it('detects empty catch blocks as warnings', async () => {
    await write('src/safe.ts', 'try { doSomething(); } catch (e) {}\n');

    const agent = new ReviewAgent(tmpDir);
    const report = await agent.run();

    const catchIssue = report.issues.find((i) => i.message.includes('catch block'));
    expect(catchIssue).toBeDefined();
    expect(catchIssue?.severity).toBe('warning');
  });

  it('detects dangerouslySetInnerHTML as error', async () => {
    await write('src/comp.tsx', '<div dangerouslySetInnerHTML={{__html: userHtml}} />\n');

    const agent = new ReviewAgent(tmpDir);
    const report = await agent.run();

    const xssIssue = report.issues.find((i) => i.message.includes('XSS'));
    expect(xssIssue).toBeDefined();
    expect(xssIssue?.severity).toBe('error');
  });

  it('skips node_modules directory', async () => {
    await fs.mkdir(path.join(tmpDir, 'node_modules', 'foo'), { recursive: true });
    await write('node_modules/foo/index.ts', 'eval("bad");\n');

    const agent = new ReviewAgent(tmpDir);
    const report = await agent.run();

    const nodeModuleIssue = report.issues.find((i) => i.file.includes('node_modules'));
    expect(nodeModuleIssue).toBeUndefined();
  });

  it('reports line numbers', async () => {
    await write('src/lines.ts', 'const x = 1;\neval("bad");\nconst z = 3;\n');

    const agent = new ReviewAgent(tmpDir);
    const report = await agent.run();

    const evalIssue = report.issues.find((i) => i.message.includes('eval()'));
    expect(evalIssue?.line).toBe(2);
  });
});
