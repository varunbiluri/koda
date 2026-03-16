import type { ToolDefinitionForAI } from '../ai/types.js';
import { readFile, writeFile, searchCode, listFiles } from './filesystem-tools.js';
import { gitBranch, gitStatus, gitDiff, gitLog, gitAdd, gitCommit, gitPush, gitCreatePr, createKodaCommit } from './git-tools.js';
import { applyPatch } from './patch-tools.js';
import { fetchUrl } from './web-tools.js';
import { replaceText, insertAfterPattern } from './diff-tools.js';
import { editFile } from './edit-file.js';
import { RepoExplorer } from './repo-explorer.js';
import { SandboxManager } from '../runtime/sandbox-manager.js';
import { TOOL_OUTPUT_LIMITS, truncateOutput } from '../runtime/tool-output-limits.js';
import * as path from 'node:path';


/**
 * ToolRegistry — exposes Koda's tool implementations as AI-callable definitions.
 *
 * Usage:
 *   const registry = new ToolRegistry(rootPath);
 *   const defs = registry.getToolDefinitions(); // pass to AI as tools[]
 *   const result = await registry.execute('git_branch', {}); // run a tool call
 */
export class ToolRegistry {
  private sandbox:  SandboxManager;
  private explorer: RepoExplorer;

  constructor(private rootPath: string) {
    this.sandbox  = new SandboxManager(rootPath);
    this.explorer = new RepoExplorer(rootPath);
  }

  /**
   * Validate that a file path is inside the repository root.
   * Returns an error string if the path escapes the sandbox, or null if safe.
   */
  private assertPathSafe(filePath: string): string | null {
    // Resolve relative to rootPath so that "src/foo.ts" works correctly
    const abs  = path.resolve(this.rootPath, filePath);
    const root = path.resolve(this.rootPath);
    if (abs !== root && !abs.startsWith(root + path.sep)) {
      return `Error: File path escapes repository root: "${filePath}"`;
    }
    return null;
  }

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
          name: 'edit_file',
          description:
            'Make a targeted edit to an existing file by replacing an exact, unique string with new content. ' +
            'PREFERRED over write_file for editing existing files. ' +
            'Rules: (1) old_string must appear EXACTLY ONCE in the file — include enough surrounding context to make it unique. ' +
            '(2) Never use this to create new files — use write_file for that. ' +
            'Returns a preview of the file after the edit for self-verification.',
          parameters: {
            type: 'object',
            properties: {
              file_path: {
                type: 'string',
                description: 'File path relative to the repository root.',
              },
              old_string: {
                type: 'string',
                description:
                  'Exact string to find and replace. Must appear exactly once in the file. ' +
                  'Include 2–3 lines of surrounding context if the target line is not unique.',
              },
              new_string: {
                type: 'string',
                description: 'Replacement text for old_string.',
              },
            },
            required: ['file_path', 'old_string', 'new_string'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'replace_text',
          description:
            '[DEPRECATED — prefer edit_file which enforces uniqueness] ' +
            'Replace the first occurrence of a specific text string in a file.',
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
            '[DEPRECATED — prefer edit_file] ' +
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
      {
        type: 'function',
        function: {
          name: 'search_files',
          description:
            'Find files whose paths match a glob pattern (e.g. "src/**/*.ts", "tests/**/auth*"). ' +
            'Use this BEFORE read_file when you are not sure of the exact file path. ' +
            'Returns up to 500 relative file paths.',
          parameters: {
            type: 'object',
            properties: {
              pattern: {
                type: 'string',
                description:
                  'Glob pattern relative to the repository root. ' +
                  'Supports * (any chars except /), ** (any path segment), ? (single char).',
              },
            },
            required: ['pattern'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'grep_code',
          description:
            'Search all source files for lines matching a text string or regex. ' +
            'Use this to find usages of a symbol, identifier, or pattern across the codebase. ' +
            'Returns up to 100 matches with file path and line number.',
          parameters: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description:
                  'Text to search for. Can be a plain string (case-insensitive) or a ' +
                  'regex literal like "/export\\s+class/i".',
              },
              file_glob: {
                type: 'string',
                description: 'Optional glob pattern to restrict which files are searched (e.g. "**/*.ts").',
              },
            },
            required: ['query'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'list_directory',
          description:
            'List the immediate contents of a directory (non-recursive). ' +
            'Shows files and subdirectories with file sizes. ' +
            'Use this to orient yourself before diving deeper into a subdirectory.',
          parameters: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description:
                  'Directory path relative to the repository root. Use "." for the repository root.',
              },
            },
            required: ['path'],
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
    signal?: AbortSignal,
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
          truncateOutput(content, TOOL_OUTPUT_LIMITS.READ_FILE, 'use grep_code for targeted search'),
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
        if (!result.success) return done(`Error: ${result.error}`);
        return done(truncateOutput(result.data ?? '', TOOL_OUTPUT_LIMITS.GIT_DIFF, 'use grep_code or read_file for specific sections'));
      }

      case 'git_log': {
        onStage?.('GIT log');
        const count = typeof args['count'] === 'number' ? args['count'] : 10;
        const result = await gitLog(count, this.rootPath);
        return done(result.success ? (result.data ?? '') : `Error: ${result.error}`);
      }

      case 'run_terminal': {
        const command = String(args['command'] ?? '');
        onStage?.(`RUN ${command}`);
        const result = await this.sandbox.execute(command, { signal });
        if (result.exitCode !== 0) {
          const detail = result.stderr?.trim() || result.stdout?.trim() || 'non-zero exit';
          return done(`Error (exit ${result.exitCode}): ${detail}`);
        }
        return done(truncateOutput(result.stdout ?? '', TOOL_OUTPUT_LIMITS.RUN_TERMINAL, 'check exit code or redirect output'));
      }

      case 'write_file': {
        const filePath = String(args['path'] ?? '');
        const pathErr = this.assertPathSafe(filePath);
        if (pathErr) return done(pathErr);
        const content = String(args['content'] ?? '');
        const lineCount = content.split('\n').length;
        onStage?.(`WRITE ${filePath} (${lineCount} lines)`);
        const result = await writeFile(filePath, content, this.rootPath);
        if (!result.success) return done(`Error: ${result.error}`);
        // Self-verification: return first 20 lines so model can confirm the write
        const preview = content.split('\n').slice(0, 20).join('\n');
        return done(
          `File written successfully (${lineCount} lines).\n\nFile preview (first 20 lines):\n\`\`\`\n${preview}\n\`\`\``,
        );
      }

      case 'edit_file': {
        const filePath = String(args['file_path'] ?? '');
        const pathErr  = this.assertPathSafe(filePath);
        if (pathErr) return done(pathErr);
        const oldString = String(args['old_string'] ?? '');
        const newString = String(args['new_string'] ?? '');
        onStage?.(`WRITE ${filePath} (edit)`);
        try {
          const result = await editFile(filePath, oldString, newString, this.rootPath);
          return done(
            `Edited ${filePath} — ${result.linesChanged} line(s) changed.\n\n` +
            `File preview (first 20 lines — verify the change is correct):\n\`\`\`\n${result.preview}\n\`\`\``,
          );
        } catch (err) {
          return done(`Error: ${(err as Error).message}`);
        }
      }

      case 'apply_patch': {
        const filePath = String(args['filePath'] ?? '');
        const pathErr = this.assertPathSafe(filePath);
        if (pathErr) return done(pathErr);
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
        if (!result.success) return done(`Error: ${result.error}`);
        return done(truncateOutput(result.data ?? '', TOOL_OUTPUT_LIMITS.FETCH_URL, 'fetch a more specific URL or section'));
      }

      case 'koda_commit': {
        const message = String(args['message'] ?? '');
        const rawFiles = Array.isArray(args['files']) ? (args['files'] as string[]) : ['.'];
        // Guard each explicitly listed file (skip '.' which stages all changes)
        for (const f of rawFiles) {
          if (f === '.') continue;
          const pathErr = this.assertPathSafe(f);
          if (pathErr) return done(pathErr);
        }
        onStage?.('COMMIT koda-ai');
        const result = await createKodaCommit(message, this.rootPath, rawFiles);
        if (!result.success) return done(`Error: ${result.error}`);
        return done(`Committed ${result.data!.hash} — ${message}\nCo-authored-by: Koda AI`);
      }

      case 'replace_text': {
        const filePath = String(args['filePath'] ?? '');
        const pathErr = this.assertPathSafe(filePath);
        if (pathErr) return done(pathErr);
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
        const pathErr = this.assertPathSafe(filePath);
        if (pathErr) return done(pathErr);
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

      case 'search_files': {
        const pattern = String(args['pattern'] ?? '');
        onStage?.(`SEARCH files matching "${pattern}"`);
        try {
          const matches = await this.explorer.searchFiles(pattern);
          if (matches.length === 0) return done('No files found matching the pattern.');
          return done(matches.map((m) => m.relativePath).join('\n'));
        } catch (err) {
          return done(`Error: ${(err as Error).message}`);
        }
      }

      case 'grep_code': {
        const query    = String(args['query'] ?? '');
        const fileGlob = args['file_glob'] ? String(args['file_glob']) : undefined;
        onStage?.(`SEARCH grep "${query}"${fileGlob ? ` in ${fileGlob}` : ''}`);
        try {
          const matches = await this.explorer.grepCode(query, fileGlob);
          if (matches.length === 0) return done('No matches found.');
          const raw = matches.map((m) => `${m.file}:${m.line}: ${m.content}`).join('\n');
          return done(truncateOutput(raw, TOOL_OUTPUT_LIMITS.GREP_CODE, 'narrow the query or use file_glob'));
        } catch (err) {
          return done(`Error: ${(err as Error).message}`);
        }
      }

      case 'list_directory': {
        const dirPath = String(args['path'] ?? '.');
        onStage?.(`READ ${dirPath}/`);
        try {
          const entries = await this.explorer.listDirectory(dirPath);
          if (entries.length === 0) return done('Directory is empty.');
          const raw = entries
            .map((e) => {
              if (e.type === 'directory') return `${e.name}/`;
              const size = e.size !== undefined ? ` (${e.size} B)` : '';
              return `${e.name}${size}`;
            })
            .join('\n');
          return done(truncateOutput(raw, TOOL_OUTPUT_LIMITS.LIST_DIRECTORY, 'use search_files for deeper exploration'));
        } catch (err) {
          return done(`Error: ${(err as Error).message}`);
        }
      }

      default:
        return done(`Unknown tool: ${name}`);
    }
  }
}
