import type { ToolDefinitionForAI } from '../ai/types.js';
import { readFile, writeFile, searchCode, listFiles } from './filesystem-tools.js';
import { gitBranch, gitStatus, gitDiff, gitLog, gitAdd, gitCommit, gitPush, gitCreatePr, createKodaCommit } from './git-tools.js';
import { runTerminal } from './terminal-tools.js';
import { applyPatch } from './patch-tools.js';
import { fetchUrl } from './web-tools.js';
import { replaceText, insertAfterPattern } from './diff-tools.js';
import * as path from 'node:path';

/**
 * Commands that could cause irreversible data loss.
 * The run_terminal tool refuses to execute these — use apply_patch or git tools instead.
 */
const DESTRUCTIVE_PATTERNS: RegExp[] = [
  /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\b/i, // rm -rf / rm -fr
  /\brm\s+-r\b/i,                                   // rm -r (recursive)
  /\bgit\s+reset\s+--hard\b/,                       // git reset --hard
  /\bgit\s+clean\s+-[a-z]*f/,                       // git clean -f / -fd
  /\bgit\s+push\s+.*--force\b/,                     // git push --force
  /\bdrop\s+table\b/i,                              // SQL DROP TABLE
  /\btruncate\s+table\b/i,                          // SQL TRUNCATE TABLE
  /\bdd\s+if=/i,                                    // dd (disk destroyer)
  /\bmkfs\b/i,                                      // format filesystem
  /\b:>\s*\//,                                      // truncate root files
];

/**
 * ToolRegistry — exposes Koda's tool implementations as AI-callable definitions.
 *
 * Usage:
 *   const registry = new ToolRegistry(rootPath);
 *   const defs = registry.getToolDefinitions(); // pass to AI as tools[]
 *   const result = await registry.execute('git_branch', {}); // run a tool call
 */
export class ToolRegistry {
  constructor(private rootPath: string) {}

  getToolDefinitions(): ToolDefinitionForAI[] {
    return [
      {
        type: 'function',
        function: {
          name: 'read_file',
          description: 'Read the full contents of a file in the repository.',
          parameters: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'File path relative to the repository root.',
              },
            },
            required: ['path'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'search_code',
          description:
            'Search for a text pattern or symbol name across all source files in the repository. Returns matching file paths, line numbers, and line content.',
          parameters: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Text or symbol to search for.',
              },
            },
            required: ['query'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'list_files',
          description: 'List all files and directories inside a given directory.',
          parameters: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description:
                  'Directory path relative to the repository root. Use "." for the root.',
              },
            },
            required: ['path'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'git_branch',
          description: 'Return the name of the current git branch.',
          parameters: { type: 'object', properties: {}, required: [] },
        },
      },
      {
        type: 'function',
        function: {
          name: 'git_status',
          description:
            'Return the git status showing modified, staged, and untracked files.',
          parameters: { type: 'object', properties: {}, required: [] },
        },
      },
      {
        type: 'function',
        function: {
          name: 'git_diff',
          description: 'Return the current git diff showing all unstaged changes.',
          parameters: { type: 'object', properties: {}, required: [] },
        },
      },
      {
        type: 'function',
        function: {
          name: 'git_log',
          description: 'Return recent git commit history in one-line format.',
          parameters: {
            type: 'object',
            properties: {
              count: {
                type: 'number',
                description: 'Number of commits to show. Defaults to 10.',
              },
            },
            required: [],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'run_terminal',
          description:
            'Run terminal commands in the project environment. Potentially destructive commands such as rm -rf, git reset --hard, or system-level modifications are blocked by safety guards.',
          parameters: {
            type: 'object',
            properties: {
              command: {
                type: 'string',
                description: 'Shell command to execute.',
              },
            },
            required: ['command'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'write_file',
          description: 'Write or overwrite a file in the repository with new content.',
          parameters: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'File path relative to the repository root.',
              },
              content: {
                type: 'string',
                description: 'Full content to write to the file.',
              },
            },
            required: ['path', 'content'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'apply_patch',
          description:
            'Surgically replace a range of lines in a file. Prefer this over write_file for targeted edits to large files.',
          parameters: {
            type: 'object',
            properties: {
              filePath: {
                type: 'string',
                description: 'File path relative to the repository root.',
              },
              startLine: {
                type: 'number',
                description: 'First line to replace (1-indexed, inclusive).',
              },
              endLine: {
                type: 'number',
                description: 'Last line to replace (1-indexed, inclusive).',
              },
              replacement: {
                type: 'string',
                description: 'New content to insert in place of lines startLine..endLine.',
              },
            },
            required: ['filePath', 'startLine', 'endLine', 'replacement'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'git_add',
          description: 'Stage one or more files for a git commit.',
          parameters: {
            type: 'object',
            properties: {
              files: {
                type: 'array',
                items: { type: 'string' },
                description: 'List of file paths to stage, relative to the repository root.',
              },
            },
            required: ['files'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'git_commit',
          description: 'Create a git commit with the staged changes.',
          parameters: {
            type: 'object',
            properties: {
              message: {
                type: 'string',
                description: 'Commit message.',
              },
            },
            required: ['message'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'git_push',
          description: 'Push the current branch to the remote origin.',
          parameters: {
            type: 'object',
            properties: {
              branch: {
                type: 'string',
                description: 'Branch name to push.',
              },
            },
            required: ['branch'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'git_create_pr',
          description: 'Create a GitHub pull request using the gh CLI.',
          parameters: {
            type: 'object',
            properties: {
              title: {
                type: 'string',
                description: 'Pull request title.',
              },
              body: {
                type: 'string',
                description: 'Pull request description body.',
              },
            },
            required: ['title', 'body'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'fetch_url',
          description:
            'Fetch the text content of a URL (documentation, READMEs, API references). Response is truncated at 10 000 characters.',
          parameters: {
            type: 'object',
            properties: {
              url: {
                type: 'string',
                description: 'Fully-qualified URL to fetch.',
              },
            },
            required: ['url'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'koda_commit',
          description:
            'Stage files and create a git commit with Koda AI as a co-author. The developer remains the primary Git author; GitHub will display Koda AI in the contributor graph.',
          parameters: {
            type: 'object',
            properties: {
              message: {
                type: 'string',
                description: 'Commit message (short imperative summary).',
              },
              files: {
                type: 'array',
                items: { type: 'string' },
                description: 'Files to stage. Defaults to ["."] (all changes).',
              },
            },
            required: ['message'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'replace_text',
          description:
            'Replace the first occurrence of a specific text string in a file. Prefer this over write_file for surgical edits where you know the exact text to change.',
          parameters: {
            type: 'object',
            properties: {
              filePath: {
                type: 'string',
                description: 'Absolute or repository-relative file path.',
              },
              oldText: {
                type: 'string',
                description: 'Exact text to find and replace.',
              },
              newText: {
                type: 'string',
                description: 'Replacement text.',
              },
            },
            required: ['filePath', 'oldText', 'newText'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'insert_after_pattern',
          description:
            'Insert a block of text immediately after the first line that matches a given regex pattern in a file.',
          parameters: {
            type: 'object',
            properties: {
              filePath: {
                type: 'string',
                description: 'Absolute or repository-relative file path.',
              },
              pattern: {
                type: 'string',
                description: 'Regex pattern to match a line (first match wins).',
              },
              text: {
                type: 'string',
                description: 'Text to insert after the matched line.',
              },
            },
            required: ['filePath', 'pattern', 'text'],
          },
        },
      },
    ];
  }

  /**
   * Execute a tool by name with the arguments provided by the AI.
   * Always returns a string — the AI receives this as the tool result.
   *
   * @param onStage   - Progress message callback. Messages use the structured
   *                    label format: "READ src/auth.ts", "SEARCH \"query\"", etc.
   * @param onTiming  - Optional callback with (toolName, durationMs) after each call.
   *                    Used by the caller to build an execution timeline.
   */
  async execute(
    name: string,
    args: Record<string, unknown>,
    onStage?: (message: string) => void,
    onTiming?: (name: string, durationMs: number) => void,
  ): Promise<string> {
    const t0 = Date.now();
    const done = (result: string): string => {
      onTiming?.(name, Date.now() - t0);
      return result;
    };

    switch (name) {
      case 'read_file': {
        const filePath = String(args['path'] ?? '');
        onStage?.(`READ ${filePath}`);
        const result = await readFile(filePath, this.rootPath);
        if (!result.success) return done(`Error: ${result.error}`);
        const content = result.data ?? '';
        return done(
          content.length > 8000
            ? content.slice(0, 8000) + '\n\n[...truncated — file exceeds 8000 characters]'
            : content,
        );
      }

      case 'search_code': {
        const query = String(args['query'] ?? '');
        onStage?.(`SEARCH "${query}"`);
        const result = await searchCode(query, this.rootPath);
        if (!result.success) return done(`Error: ${result.error}`);
        const hits = result.data ?? [];
        if (hits.length === 0) return done('No results found.');
        return done(
          hits
            .slice(0, 30)
            .map((h) => `${h.file}:${h.line}: ${h.content}`)
            .join('\n'),
        );
      }

      case 'list_files': {
        const dirPath = String(args['path'] ?? '.');
        onStage?.(`READ ${dirPath}/`);
        const result = await listFiles(dirPath, this.rootPath);
        return done(result.success ? (result.data ?? []).join('\n') : `Error: ${result.error}`);
      }

      case 'git_branch': {
        onStage?.('GIT branch');
        const result = await gitBranch(this.rootPath);
        return done(result.success ? (result.data ?? 'unknown') : `Error: ${result.error}`);
      }

      case 'git_status': {
        onStage?.('GIT status');
        const result = await gitStatus(this.rootPath);
        return done(result.success ? (result.data ?? '') : `Error: ${result.error}`);
      }

      case 'git_diff': {
        onStage?.('GIT diff');
        const result = await gitDiff(this.rootPath);
        return done(result.success ? (result.data ?? '') : `Error: ${result.error}`);
      }

      case 'git_log': {
        onStage?.('GIT log');
        const count = typeof args['count'] === 'number' ? args['count'] : 10;
        const result = await gitLog(count, this.rootPath);
        return done(result.success ? (result.data ?? '') : `Error: ${result.error}`);
      }

      case 'run_terminal': {
        const command = String(args['command'] ?? '');

        // ── Safety: refuse destructive commands ──────────────────────────────
        if (DESTRUCTIVE_PATTERNS.some((p) => p.test(command))) {
          return done(
            `Error: Refusing to execute potentially destructive command: "${command}". ` +
            `Use apply_patch to edit files or git tools to manage the repository safely.`,
          );
        }

        onStage?.(`RUN ${command}`);
        const result = await runTerminal(command, this.rootPath);
        if (!result.success) return done(`Error: ${result.error}`);
        return done(result.data?.stdout ?? '');
      }

      case 'write_file': {
        const filePath = String(args['path'] ?? '');
        const lineCount = String(args['content'] ?? '').split('\n').length;
        onStage?.(`WRITE ${filePath} (${lineCount} lines)`);
        const result = await writeFile(filePath, String(args['content'] ?? ''), this.rootPath);
        return done(result.success ? 'File written successfully.' : `Error: ${result.error}`);
      }

      case 'apply_patch': {
        const filePath = String(args['filePath'] ?? '');
        const startLine = Number(args['startLine'] ?? 1);
        const endLine = Number(args['endLine'] ?? startLine);
        const replacement = String(args['replacement'] ?? '');
        onStage?.(`WRITE ${filePath} (lines ${startLine}–${endLine})`);
        const result = await applyPatch(filePath, startLine, endLine, replacement, this.rootPath);
        if (!result.success) return done(`Error: ${result.error}`);
        const d = result.data!;
        return done(`Patched ${d.filePath}: replaced ${d.linesReplaced} line(s) with ${d.linesInserted} line(s).`);
      }

      case 'git_add': {
        const files = Array.isArray(args['files']) ? (args['files'] as string[]) : [];
        onStage?.(`GIT add ${files.join(' ')}`);
        const errors: string[] = [];
        for (const f of files) {
          const result = await gitAdd(String(f), this.rootPath);
          if (!result.success) errors.push(result.error ?? f);
        }
        return done(
          errors.length === 0
            ? `Staged: ${files.join(', ')}`
            : `Errors: ${errors.join('; ')}`,
        );
      }

      case 'git_commit': {
        const message = String(args['message'] ?? '');
        onStage?.(`GIT commit "${message.slice(0, 50)}${message.length > 50 ? '…' : ''}"`);
        const result = await gitCommit(message, this.rootPath);
        return done(result.success ? (result.data ?? 'Committed.') : `Error: ${result.error}`);
      }

      case 'git_push': {
        const branch = String(args['branch'] ?? '');
        onStage?.(`GIT push origin ${branch}`);
        const result = await gitPush(branch, this.rootPath);
        return done(result.success ? (result.data ?? 'Pushed.') : `Error: ${result.error}`);
      }

      case 'git_create_pr': {
        const title = String(args['title'] ?? '');
        onStage?.(`GIT create-pr "${title.slice(0, 50)}${title.length > 50 ? '…' : ''}"`);
        const body = String(args['body'] ?? '');
        const result = await gitCreatePr(title, body, this.rootPath);
        return done(result.success ? (result.data ?? 'Pull request created.') : `Error: ${result.error}`);
      }

      case 'fetch_url': {
        const url = String(args['url'] ?? '');
        const display = url.length > 60 ? url.slice(0, 57) + '…' : url;
        onStage?.(`FETCH ${display}`);
        const result = await fetchUrl(url);
        return done(result.success ? (result.data ?? '') : `Error: ${result.error}`);
      }

      case 'koda_commit': {
        const message = String(args['message'] ?? '');
        const files = Array.isArray(args['files']) ? (args['files'] as string[]) : ['.'];
        onStage?.('COMMIT koda-ai');
        const result = await createKodaCommit(message, this.rootPath, files);
        if (!result.success) return done(`Error: ${result.error}`);
        return done(`Committed ${result.data!.hash} — ${message}\nCo-authored-by: Koda AI`);
      }

      case 'replace_text': {
        const filePath = String(args['filePath'] ?? '');
        onStage?.(`WRITE ${filePath} (replace text)`);
        const oldText = String(args['oldText'] ?? '');
        const newText = String(args['newText'] ?? '');
        const absPath = path.resolve(this.rootPath, filePath);
        try {
          return done(await replaceText(absPath, oldText, newText));
        } catch (err) {
          return done(`Error: ${(err as Error).message}`);
        }
      }

      case 'insert_after_pattern': {
        const filePath = String(args['filePath'] ?? '');
        const pattern = String(args['pattern'] ?? '');
        onStage?.(`WRITE ${filePath} (insert after /${pattern}/)`);
        const text = String(args['text'] ?? '');
        const absPath = path.resolve(this.rootPath, filePath);
        try {
          return done(await insertAfterPattern(absPath, pattern, text));
        } catch (err) {
          return done(`Error: ${(err as Error).message}`);
        }
      }

      default:
        return done(`Unknown tool: ${name}`);
    }
  }
}
