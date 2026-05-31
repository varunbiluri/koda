/**
 * Slash commands — barrel export (Claude Code–style REPL commands).
 */
export {
  handleSlashCommand,
  type SlashHandlerContext,
  type SlashResult,
  SLASH_COMMANDS,
  SLASH_CATEGORY_LABELS,
  getCommandsByCategory,
} from './slash/router.js';

export {
  findSlashCommand,
  parseSlashCommand,
  type SlashCommandDef,
  type SlashCommandCategory,
} from './slash/registry.js';
