import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { RepoIndex } from '../types/index.js';

export interface ArchitectureReport {
  languages: string[];
  frameworks: string[];
  entrypoints: string[];
  keyModules: string[];
  promptFiles: string[];
  agentsMd: string;
}

/**
 * ArchitectureAgent — static analysis of a RepoIndex to generate AGENTS.md.
 *
 * Deliberately dependency-free (no AI call needed) so it works without a
 * provider config being set up.
 */
export class ArchitectureAgentMd {
  // Language detection by file extension
  private static readonly LANG_MAP: Record<string, string> = {
    ts: 'TypeScript',
    tsx: 'TypeScript (React)',
    js: 'JavaScript',
    jsx: 'JavaScript (React)',
    py: 'Python',
    java: 'Java',
    kt: 'Kotlin',
    go: 'Go',
    rs: 'Rust',
    rb: 'Ruby',
    cs: 'C#',
    cpp: 'C++',
    c: 'C',
    swift: 'Swift',
    php: 'PHP',
    scala: 'Scala',
    r: 'R',
    dart: 'Dart',
  };

  // Framework detection: file/path patterns → framework name
  private static readonly FRAMEWORK_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
    { pattern: /next\.config\.(js|ts)/, name: 'Next.js' },
    { pattern: /nuxt\.config\.(js|ts)/, name: 'Nuxt.js' },
    { pattern: /angular\.json/, name: 'Angular' },
    { pattern: /vue\.config\.(js|ts)/, name: 'Vue.js' },
    { pattern: /vite\.config\.(js|ts)/, name: 'Vite' },
    { pattern: /remix\.config\.(js|ts)/, name: 'Remix' },
    { pattern: /svelte\.config\.(js|ts)/, name: 'SvelteKit' },
    { pattern: /(fastapi|uvicorn)/, name: 'FastAPI' },
    { pattern: /django/, name: 'Django' },
    { pattern: /flask/, name: 'Flask' },
    { pattern: /spring/, name: 'Spring Boot' },
    { pattern: /express/, name: 'Express' },
    { pattern: /nestjs|@nestjs/, name: 'NestJS' },
    { pattern: /rails/, name: 'Ruby on Rails' },
    { pattern: /laravel/, name: 'Laravel' },
    { pattern: /gin\.go|gin-gonic/, name: 'Gin (Go)' },
    { pattern: /actix|axum|rocket/, name: 'Rust web framework' },
  ];

  // Entry-point file name patterns
  private static readonly ENTRY_PATTERNS = [
    /^src\/index\.(ts|tsx|js|jsx)$/,
    /^src\/main\.(ts|tsx|js|jsx)$/,
    /^index\.(ts|tsx|js|jsx)$/,
    /^main\.(ts|tsx|js|jsx|py|go|rs)$/,
    /^app\.(ts|tsx|js|jsx|py)$/,
    /^server\.(ts|tsx|js|jsx)$/,
    /^src\/app\.(ts|tsx|js|jsx)$/,
    /^src\/server\.(ts|tsx|js|jsx)$/,
    /manage\.py$/,
    /^cmd\/main\.go$/,
    /^main\.rs$/,
  ];

  // Keyword patterns that indicate a file defines prompts
  private static readonly PROMPT_KEYWORDS = [
    'system prompt',
    'systemPrompt',
    'system_prompt',
    'getSystemPrompt',
    'buildSystemPrompt',
    'openai',
    'gpt-4',
    'gpt-3',
    'claude',
    'anthropic',
    'langchain',
    'llamaindex',
    'system_message',
    'PromptTemplate',
  ];

  analyze(index: RepoIndex): ArchitectureReport {
    const filePaths = index.files.map((f) => f.path ?? (f as unknown as { filePath: string }).filePath ?? '');
    const chunkContents = index.chunks.map((c) => ({ file: c.filePath, content: c.content }));

    const languages = this.detectLanguages(filePaths);
    const frameworks = this.detectFrameworks(filePaths, chunkContents);
    const entrypoints = this.detectEntrypoints(filePaths);
    const keyModules = this.detectKeyModules(filePaths);
    const promptFiles = this.detectPromptFiles(chunkContents);

    const agentsMd = this.generateAgentsMd({
      languages,
      frameworks,
      entrypoints,
      keyModules,
      promptFiles,
      fileCount: index.metadata.fileCount,
      rootPath: index.metadata.rootPath,
    });

    return { languages, frameworks, entrypoints, keyModules, promptFiles, agentsMd };
  }

  async writeAgentsMd(rootPath: string, content: string): Promise<void> {
    const dest = path.join(rootPath, 'AGENTS.md');
    await fs.writeFile(dest, content, 'utf-8');
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private detectLanguages(filePaths: string[]): string[] {
    const found = new Set<string>();
    for (const fp of filePaths) {
      const ext = fp.split('.').pop()?.toLowerCase() ?? '';
      const lang = ArchitectureAgentMd.LANG_MAP[ext];
      if (lang) found.add(lang);
    }
    return Array.from(found).sort();
  }

  private detectFrameworks(
    filePaths: string[],
    chunks: { file: string; content: string }[],
  ): string[] {
    const found = new Set<string>();
    const allText = [
      ...filePaths,
      ...chunks.map((c) => c.content.slice(0, 500)),
    ].join('\n').toLowerCase();

    for (const { pattern, name } of ArchitectureAgentMd.FRAMEWORK_PATTERNS) {
      if (pattern.test(allText)) {
        found.add(name);
      }
    }
    return Array.from(found).sort();
  }

  private detectEntrypoints(filePaths: string[]): string[] {
    return filePaths.filter((fp) =>
      ArchitectureAgentMd.ENTRY_PATTERNS.some((p) => p.test(fp)),
    );
  }

  private detectKeyModules(filePaths: string[]): string[] {
    // Top-level src/* directories are "key modules"
    const dirs = new Set<string>();
    for (const fp of filePaths) {
      const parts = fp.replace(/^\.\//, '').split('/');
      if (parts.length >= 2 && (parts[0] === 'src' || parts[0] === 'lib' || parts[0] === 'app')) {
        dirs.add(`${parts[0]}/${parts[1]}`);
      }
    }
    return Array.from(dirs).sort();
  }

  private detectPromptFiles(chunks: { file: string; content: string }[]): string[] {
    const found = new Set<string>();
    for (const { file, content } of chunks) {
      const lower = content.toLowerCase();
      if (ArchitectureAgentMd.PROMPT_KEYWORDS.some((kw) => lower.includes(kw.toLowerCase()))) {
        found.add(file);
      }
    }
    return Array.from(found).sort();
  }

  private generateAgentsMd(opts: {
    languages: string[];
    frameworks: string[];
    entrypoints: string[];
    keyModules: string[];
    promptFiles: string[];
    fileCount: number;
    rootPath: string;
  }): string {
    const repoName = path.basename(opts.rootPath);
    const lines: string[] = [
      `# AGENTS.md — ${repoName}`,
      '',
      '> Auto-generated by [Koda](https://github.com/varunbiluri/koda). Re-run `koda init` to refresh.',
      '',
      '## Project Overview',
      '',
      `- **Repository**: ${repoName}`,
      `- **Indexed files**: ${opts.fileCount}`,
      '',
      '## Tech Stack',
      '',
    ];

    if (opts.languages.length > 0) {
      lines.push(`**Languages**: ${opts.languages.join(', ')}`);
      lines.push('');
    }
    if (opts.frameworks.length > 0) {
      lines.push(`**Frameworks**: ${opts.frameworks.join(', ')}`);
      lines.push('');
    }

    lines.push('## Architecture');
    lines.push('');

    if (opts.entrypoints.length > 0) {
      lines.push('### Entrypoints');
      lines.push('');
      for (const ep of opts.entrypoints) {
        lines.push(`- \`${ep}\``);
      }
      lines.push('');
    }

    if (opts.keyModules.length > 0) {
      lines.push('### Key Modules');
      lines.push('');
      for (const m of opts.keyModules) {
        lines.push(`- \`${m}/\``);
      }
      lines.push('');
    }

    if (opts.promptFiles.length > 0) {
      lines.push('## Prompts');
      lines.push('');
      lines.push('Files containing AI prompt definitions:');
      lines.push('');
      for (const pf of opts.promptFiles) {
        lines.push(`- \`${pf}\``);
      }
      lines.push('');
    }

    lines.push('## Rules for AI Agents');
    lines.push('');
    lines.push('- Always read existing code before proposing changes.');
    lines.push('- Prefer editing existing files over creating new ones.');
    lines.push('- Run `pnpm build` (or project equivalent) to verify TypeScript compiles.');
    lines.push('- Run tests before and after changes.');
    lines.push('- Do not commit secrets, credentials, or `.env` files.');
    lines.push('- Keep diffs minimal — only change what is necessary.');
    lines.push('');

    return lines.join('\n');
  }
}
