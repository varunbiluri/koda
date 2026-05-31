/**
 * Claude Code–style slash command registry.
 * Grouped by category for /help display.
 */

export interface SlashCommandDef {
  name:        string;
  description: string;
  aliases?:    string[];
  category:    SlashCommandCategory;
  /** When true, command shows guidance only or is not fully implemented — tagged [wip] in /help. */
  wip?:        boolean;
}

export type SlashCommandCategory =
  | 'session'
  | 'context'
  | 'git'
  | 'tools'
  | 'config'
  | 'mcp'
  | 'skills'
  | 'platform'
  | 'help';

export const SLASH_CATEGORY_LABELS: Record<SlashCommandCategory, string> = {
  session:  'Session',
  context:  'Context & memory',
  git:      'Git & code',
  tools:    'Tools & diagnostics',
  config:   'Config & auth',
  mcp:      'MCP servers',
  skills:   'Skills & tasks',
  platform: 'Platform',
  help:     'Help & exit',
};

/** Full slash command catalog (Claude Code–aligned). */
export const SLASH_COMMANDS: SlashCommandDef[] = [
  // Help & exit
  { name: '/help',     description: 'Show all commands', category: 'help' },
  { name: '/exit',     description: 'Exit Koda', category: 'help', aliases: ['/quit'] },

  // Session
  { name: '/clear',    description: 'Clear terminal screen', category: 'session' },
  { name: '/compact',  description: 'Clear session UI (engine is stateless per turn)', category: 'session', aliases: ['/reset'] },
  { name: '/resume',   description: 'Resume previous session state', category: 'session', wip: true },
  { name: '/share',    description: 'Export session summary to file', category: 'session' },
  { name: '/rewind',   description: 'Undo last agent turn', category: 'session', wip: true },

  // Context & memory
  { name: '/context',  description: 'Files retrieved in last response', category: 'context' },
  { name: '/cost',     description: 'Token usage, ref rate, and KEI this session', category: 'context', aliases: ['/budget'] },
  { name: '/history',  description: 'Message count in session', category: 'context', wip: true },
  { name: '/memory',   description: 'Show learned workspace patterns', category: 'context' },

  // Git & code
  { name: '/commit',   description: 'AI commit message from staged diff + approval', category: 'git' },
  { name: '/diff',     description: 'Show pending git changes', category: 'git' },
  { name: '/review',   description: 'Run code review on recent changes', category: 'git' },
  { name: '/pr_comments', description: 'Show PR review comments (gh CLI)', category: 'git' },
  { name: '/undo',     description: 'Revert file changes', category: 'git', wip: true },

  // Tools & diagnostics
  { name: '/tools',    description: 'Tools used this session', category: 'tools' },
  { name: '/plan',     description: 'Last generated execution plan', category: 'tools' },
  { name: '/doctor',   description: 'Environment health check', category: 'tools' },
  { name: '/init',     description: 'Index this repository', category: 'tools' },
  { name: '/status',   description: 'Repository and index status', category: 'tools' },
  { name: '/permissions', description: 'Show tool permission tiers', category: 'tools' },

  // Config & auth
  { name: '/config',   description: 'Show AI configuration', category: 'config' },
  { name: '/login',    description: 'Configure AI provider', category: 'config' },
  { name: '/logout',   description: 'Clear stored credentials', category: 'config' },
  { name: '/model',    description: 'Show current model', category: 'config' },
  { name: '/theme',    description: 'Toggle terminal theme hint', category: 'config', wip: true },
  { name: '/vim',      description: 'Toggle vim-style input', category: 'config', wip: true },

  // MCP
  { name: '/mcp',      description: 'Manage MCP servers (list|add|remove|tools|reconnect)', category: 'mcp' },

  // Skills & tasks
  { name: '/skills',   description: 'List available skills', category: 'skills' },
  { name: '/tasks',    description: 'Show task / execution info', category: 'skills', wip: true },
  { name: '/agents',   description: 'List registered agents', category: 'skills' },

  // Platform (informational — not native integrations yet)
  { name: '/desktop',  description: 'Desktop integration info', category: 'platform', wip: true },
  { name: '/mobile',   description: 'Mobile integration info', category: 'platform', wip: true },
];

/**
 * Finds the registered slash command definition matching the provided command name or alias, case-insensitively.
 *
 * @param cmd - The command string to look up; may be a canonical name or an alias (matching is case-insensitive).
 * @returns The corresponding `SlashCommandDef` if a match is found, `undefined` otherwise.
 */
export function findSlashCommand(cmd: string): SlashCommandDef | undefined {
  const lower = cmd.toLowerCase();
  return SLASH_COMMANDS.find(
    (d) => d.name === lower || d.aliases?.includes(lower),
  );
}

/**
 * Group registered slash commands by their category.
 *
 * @returns A Map keyed by `SlashCommandCategory` where each value is an array of `SlashCommandDef` in that category.
 */
export function getCommandsByCategory(): Map<SlashCommandCategory, SlashCommandDef[]> {
  const map = new Map<SlashCommandCategory, SlashCommandDef[]>();
  for (const def of SLASH_COMMANDS) {
    const list = map.get(def.category) ?? [];
    list.push(def);
    map.set(def.category, list);
  }
  return map;
}

/**
 * Parse a raw slash-command string into its command token and arguments.
 *
 * @param input - The raw input string provided by the user.
 * @returns An object with `cmd` set to the first token lowercased (or `''` if no token) and `args` containing the remaining tokens in order.
 */
export function parseSlashCommand(input: string): { cmd: string; args: string[] } {
  const parts = input.trim().split(/\s+/);
  const cmd = (parts[0] ?? '').toLowerCase();
  return { cmd, args: parts.slice(1) };
}

/**
 * Return the canonical slash command name for a given command or alias.
 *
 * @param cmd - The command or alias to normalize (lookup is case-insensitive).
 * @returns The registered canonical command name if a match is found, otherwise the original `cmd`.
 */
export function canonicalSlashCommand(cmd: string): string {
  const def = findSlashCommand(cmd);
  return def?.name ?? cmd;
}
