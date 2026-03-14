import type { ToolDefinitionForAI } from '../ai/types.js';
import { readFile, writeFile, searchCode, listFiles } from './filesystem-tools.js';
import { gitBranch, gitStatus, gitDiff, gitLog } from './git-tools.js';
import { runTerminal } from './terminal-tools.js';

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
    ];
  }

  /**
   * Execute a tool by name with the arguments provided by the AI.
   * Always returns a string — the AI receives this as the tool result.
   */
  async execute(name: string, args: Record<string, unknown>): Promise<string> {
    switch (name) {
      case 'read_file': {
        const result = await readFile(String(args['path'] ?? ''), this.rootPath);
        return result.success ? (result.data ?? '') : `Error: ${result.error}`;
      }

      case 'search_code': {
        const result = await searchCode(String(args['query'] ?? ''), this.rootPath);
        if (!result.success) return `Error: ${result.error}`;
        const hits = result.data ?? [];
        if (hits.length === 0) return 'No results found.';
        return hits
          .slice(0, 30)
          .map((h) => `${h.file}:${h.line}: ${h.content}`)
          .join('\n');
      }

      case 'list_files': {
        const result = await listFiles(String(args['path'] ?? '.'), this.rootPath);
        return result.success ? (result.data ?? []).join('\n') : `Error: ${result.error}`;
      }

      case 'git_branch': {
        const result = await gitBranch(this.rootPath);
        return result.success ? (result.data ?? 'unknown') : `Error: ${result.error}`;
      }

      case 'git_status': {
        const result = await gitStatus(this.rootPath);
        return result.success ? (result.data ?? '') : `Error: ${result.error}`;
      }

      case 'git_diff': {
        const result = await gitDiff(this.rootPath);
        return result.success ? (result.data ?? '') : `Error: ${result.error}`;
      }

      case 'git_log': {
        const count = typeof args['count'] === 'number' ? args['count'] : 10;
        const result = await gitLog(count, this.rootPath);
        return result.success ? (result.data ?? '') : `Error: ${result.error}`;
      }

      case 'run_terminal': {
        const result = await runTerminal(String(args['command'] ?? ''), this.rootPath);
        if (!result.success) return `Error: ${result.error}`;
        return result.data?.stdout ?? '';
      }

      case 'write_file': {
        const result = await writeFile(
          String(args['path'] ?? ''),
          String(args['content'] ?? ''),
          this.rootPath,
        );
        return result.success ? 'File written successfully.' : `Error: ${result.error}`;
      }

      default:
        return `Unknown tool: ${name}`;
    }
  }
}
