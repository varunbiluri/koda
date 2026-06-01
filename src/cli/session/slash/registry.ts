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
  { name: '/pr',       description: 'Push branch and open GitHub PR (gh CLI)', category: 'git' },
  { name: '/diff',     description: 'Show pending git changes', category: 'git' },
  { name: '/worktree', description: 'Git worktree (enter|merge|discard|list|clean)', category: 'git' },
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
  { name: '/trust',       description: 'Auto-approve run/write tools for this session', category: 'tools' },
  { name: '/verbose',     description: 'Toggle detailed tool traces + debug logs', category: 'tools' },

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

export function findSlashCommand(cmd: string): SlashCommandDef | undefined {
  const lower = cmd.toLowerCase();
  return SLASH_COMMANDS.find(
    (d) => d.name === lower || d.aliases?.includes(lower),
  );
}

export function getCommandsByCategory(): Map<SlashCommandCategory, SlashCommandDef[]> {
  const map = new Map<SlashCommandCategory, SlashCommandDef[]>();
  for (const def of SLASH_COMMANDS) {
    const list = map.get(def.category) ?? [];
    list.push(def);
    map.set(def.category, list);
  }
  return map;
}

/** Resolve primary command name from input (first token). */
export function parseSlashCommand(input: string): { cmd: string; args: string[] } {
  const parts = input.trim().split(/\s+/);
  const cmd = (parts[0] ?? '').toLowerCase();
  return { cmd, args: parts.slice(1) };
}

/** Map aliases to canonical command names for routing. */
export function canonicalSlashCommand(cmd: string): string {
  const def = findSlashCommand(cmd);
  return def?.name ?? cmd;
}
