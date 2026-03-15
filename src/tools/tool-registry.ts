import type { ToolDefinitionForAI } from '../ai/types.js';
import { readFile, writeFile, searchCode, listFiles } from './filesystem-tools.js';
import { gitBranch, gitStatus, gitDiff, gitLog, gitAdd, gitCommit, gitPush, gitCreatePr, createKodaCommit } from './git-tools.js';
import { runTerminal } from './terminal-tools.js';
import { applyPatch } from './patch-tools.js';
import { fetchUrl } from './web-tools.js';

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
            'Execute a shell command in the repository root. Use only for safe, read-only commands (e.g. ls, cat, grep). Destructive commands require user approval.',
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
    ];
  }

  /**
   * Execute a tool by name with the arguments provided by the AI.
   * Always returns a string — the AI receives this as the tool result.
   *
   * @param onStage - Optional callback for emitting a user-visible progress message
   *                  specific to this tool call (e.g. "📖  reading src/auth.ts").
   */
  async execute(
    name: string,
    args: Record<string, unknown>,
    onStage?: (message: string) => void,
  ): Promise<string> {
    switch (name) {
      case 'read_file': {
        const filePath = String(args['path'] ?? '');
        onStage?.(`📖  reading ${filePath}`);
        const result = await readFile(filePath, this.rootPath);
        if (!result.success) return `Error: ${result.error}`;
        const content = result.data ?? '';
        return content.length > 8000
          ? content.slice(0, 8000) + '\n\n[...truncated — file exceeds 8000 characters]'
          : content;
      }

      case 'search_code': {
        const query = String(args['query'] ?? '');
        onStage?.(`🔍  searching for "${query}"`);
        const result = await searchCode(query, this.rootPath);
        if (!result.success) return `Error: ${result.error}`;
        const hits = result.data ?? [];
        if (hits.length === 0) return 'No results found.';
        return hits
          .slice(0, 30)
          .map((h) => `${h.file}:${h.line}: ${h.content}`)
          .join('\n');
      }

      case 'list_files': {
        const dirPath = String(args['path'] ?? '.');
        onStage?.(`📁  listing ${dirPath}`);
        const result = await listFiles(dirPath, this.rootPath);
        return result.success ? (result.data ?? []).join('\n') : `Error: ${result.error}`;
      }

      case 'git_branch': {
        onStage?.('🔧  git branch');
        const result = await gitBranch(this.rootPath);
        return result.success ? (result.data ?? 'unknown') : `Error: ${result.error}`;
      }

      case 'git_status': {
        onStage?.('🔧  git status');
        const result = await gitStatus(this.rootPath);
        return result.success ? (result.data ?? '') : `Error: ${result.error}`;
      }

      case 'git_diff': {
        onStage?.('🔧  git diff');
        const result = await gitDiff(this.rootPath);
        return result.success ? (result.data ?? '') : `Error: ${result.error}`;
      }

      case 'git_log': {
        onStage?.('🔧  git log');
        const count = typeof args['count'] === 'number' ? args['count'] : 10;
        const result = await gitLog(count, this.rootPath);
        return result.success ? (result.data ?? '') : `Error: ${result.error}`;
      }

      case 'run_terminal': {
        const command = String(args['command'] ?? '');
        onStage?.(`⚙  running: ${command}`);
        const result = await runTerminal(command, this.rootPath);
        if (!result.success) return `Error: ${result.error}`;
        return result.data?.stdout ?? '';
      }

      case 'write_file': {
        const filePath = String(args['path'] ?? '');
        onStage?.(`✏  writing ${filePath}`);
        const result = await writeFile(filePath, String(args['content'] ?? ''), this.rootPath);
        return result.success ? 'File written successfully.' : `Error: ${result.error}`;
      }

      case 'apply_patch': {
        const filePath = String(args['filePath'] ?? '');
        const startLine = Number(args['startLine'] ?? 1);
        const endLine = Number(args['endLine'] ?? startLine);
        const replacement = String(args['replacement'] ?? '');
        onStage?.(`✏  patching ${filePath} (lines ${startLine}–${endLine})`);
        const result = await applyPatch(filePath, startLine, endLine, replacement, this.rootPath);
        if (!result.success) return `Error: ${result.error}`;
        const d = result.data!;
        return `Patched ${d.filePath}: replaced ${d.linesReplaced} line(s) with ${d.linesInserted} line(s).`;
      }

      case 'git_add': {
        const files = Array.isArray(args['files']) ? (args['files'] as string[]) : [];
        onStage?.(`🔧  git add ${files.join(' ')}`);
        const errors: string[] = [];
        for (const f of files) {
          const result = await gitAdd(String(f), this.rootPath);
          if (!result.success) errors.push(result.error ?? f);
        }
        return errors.length === 0
          ? `Staged: ${files.join(', ')}`
          : `Errors: ${errors.join('; ')}`;
      }

      case 'git_commit': {
        const message = String(args['message'] ?? '');
        onStage?.('🔧  git commit');
        const result = await gitCommit(message, this.rootPath);
        return result.success ? (result.data ?? 'Committed.') : `Error: ${result.error}`;
      }

      case 'git_push': {
        const branch = String(args['branch'] ?? '');
        onStage?.(`🔧  git push origin ${branch}`);
        const result = await gitPush(branch, this.rootPath);
        return result.success ? (result.data ?? 'Pushed.') : `Error: ${result.error}`;
      }

      case 'git_create_pr': {
        const title = String(args['title'] ?? '');
        const body = String(args['body'] ?? '');
        onStage?.('🔧  creating pull request');
        const result = await gitCreatePr(title, body, this.rootPath);
        return result.success ? (result.data ?? 'Pull request created.') : `Error: ${result.error}`;
      }

      case 'fetch_url': {
        const url = String(args['url'] ?? '');
        onStage?.(`🌐  fetching ${url}`);
        const result = await fetchUrl(url);
        return result.success ? (result.data ?? '') : `Error: ${result.error}`;
      }

      case 'koda_commit': {
        const message = String(args['message'] ?? '');
        const files = Array.isArray(args['files']) ? (args['files'] as string[]) : ['.'];
        onStage?.('🤖  committing as Koda AI');
        const result = await createKodaCommit(message, this.rootPath, files);
        if (!result.success) return `Error: ${result.error}`;
        return `✔ Committed ${result.data!.hash} — ${message}\nCo-authored-by: Koda AI`;
      }

      default:
        return `Unknown tool: ${name}`;
    }
  }
}
