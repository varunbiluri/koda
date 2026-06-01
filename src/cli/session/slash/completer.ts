/**
 * Slash command autocomplete — Claude Code–style live menu when typing "/".
 */

import * as readline from 'node:readline';
import { SLASH_COMMANDS, type SlashCommandDef } from './registry.js';
import { isPasteActive } from '../paste-handler.js';

/** True when a command name matches a partially typed slash token. */
function commandMatchesToken(name: string, token: string): boolean {
  const lower = name.toLowerCase();
  if (lower.startsWith(token)) return true;
  if (token.length >= 3 && lower.startsWith(token.slice(0, -1)) && lower.length > token.length) {
    return true;
  }
  // Typo tolerance: `/inti` → `/init` (transposed/extra chars after `/in`)
  if (token.length >= 4 && lower.startsWith('/in') && Math.abs(lower.length - token.length) <= 1) {
    let diff = 0;
    const len = Math.max(lower.length, token.length);
    for (let i = 0; i < len; i++) {
      if ((lower[i] ?? '') !== (token[i] ?? '')) diff++;
    }
    if (diff <= 2) return true;
  }
  return false;
}

/** Match slash commands (and aliases) by typed prefix. */
export function filterSlashCommands(partial: string, limit = SLASH_COMMANDS.length): SlashCommandDef[] {
  const token = partial.trim().split(/\s/)[0]?.toLowerCase() ?? '';
  if (!token.startsWith('/')) return [];

  return SLASH_COMMANDS.filter((def) => {
    if (commandMatchesToken(def.name, token)) return true;
    return def.aliases?.some((alias) => commandMatchesToken(alias, token)) ?? false;
  }).slice(0, limit);
}

/** readline completer — Tab completes slash commands. */
export function slashCompleter(line: string): [string[], string] {
  if (!line.startsWith('/')) return [[], line];
  const token = line.split(/\s/)[0] ?? line;
  const hits = filterSlashCommands(token, 50).map((d) => d.name);
  return [hits.length > 0 ? hits : SLASH_COMMANDS.map((d) => d.name), token];
}

export interface SlashMenuHandle {
  clear: () => void;
  detach: () => void;
  /** Apply menu selection to a partial slash line (e.g. `/int` → `/init`). */
  resolveInput: (line: string) => string;
}

type ReadlineExt = readline.Interface & { line?: string; cursor?: number };

function readlineBuffer(rl: readline.Interface): string {
  return (rl as ReadlineExt).line ?? '';
}

/** Replace the current readline input with a slash command (keeps trailing args). */
function applySlashCommand(rl: readline.Interface, command: string): void {
  const rlExt = rl as ReadlineExt;
  const current = rlExt.line ?? '';
  const rest = current.includes(' ') ? current.slice(current.indexOf(' ')) : '';
  const newLine = command + rest;

  rl.write(null, { ctrl: true, name: 'u' });
  rl.write(newLine);
  rlExt.line = newLine;
  rlExt.cursor = newLine.length;
}

type ReadlineHistory = readline.Interface & { history: string[] };

/** Prevent Up/Down from walking REPL history while the slash menu is open. */
function suspendReadlineHistory(rl: readline.Interface, saved: string[] | null): string[] | null {
  if (saved !== null) return saved;
  const hist = (rl as ReadlineHistory).history ?? [];
  (rl as ReadlineHistory).history = [];
  return hist;
}

function resumeReadlineHistory(rl: readline.Interface, saved: string[] | null): null {
  if (saved !== null) {
    (rl as ReadlineHistory).history = saved;
  }
  return null;
}

/** Undo readline history navigation when arrow keys leak through. */
function restoreReadlineLine(rl: readline.Interface, saved: string): void {
  const fix = (): void => {
    const rlExt = rl as ReadlineExt;
    if ((rlExt.line ?? '') !== saved) {
      rl.write(null, { ctrl: true, name: 'u' });
      rl.write(saved);
      rlExt.line = saved;
      rlExt.cursor = saved.length;
    }
  };
  process.nextTick(fix);
  setImmediate(fix);
}

/**
 * Show a live slash-command menu while the user types (Claude Code–style).
 * Up/Down navigate; Tab or Enter applies the highlighted command.
 */
export function attachSlashMenu(
  rl: readline.Interface,
  render: (commands: SlashCommandDef[], selectedIndex: number) => void,
): SlashMenuHandle {
  if (!process.stdin.isTTY) {
    return { clear: () => undefined, resolveInput: (l) => l.trim(), detach: () => undefined };
  }

  readline.emitKeypressEvents(process.stdin, rl);

  let visible = false;
  let lastKey = '';
  let selectedIndex = 0;
  let lastMatches: SlashCommandDef[] = [];
  let savedHistory: string[] | null = null;

  const closeMenu = (): void => {
    if (visible) {
      render([], 0);
      visible = false;
      lastKey = '';
      selectedIndex = 0;
      lastMatches = [];
    }
    savedHistory = resumeReadlineHistory(rl, savedHistory);
  };

  const refresh = (): void => {
    const line = readlineBuffer(rl);
    const token = line.split(/\s/)[0] ?? '';

    if (!token.startsWith('/')) {
      closeMenu();
      return;
    }

    savedHistory = suspendReadlineHistory(rl, savedHistory);

    const key = token.toLowerCase();
    const matches = filterSlashCommands(token);
    if (key !== lastKey) {
      selectedIndex = 0;
    }
    if (selectedIndex >= matches.length) {
      selectedIndex = Math.max(0, matches.length - 1);
    }

    lastKey = key;
    lastMatches = matches;
    visible = matches.length > 0;
    render(matches, selectedIndex);
  };

  const onKeypress = (_str: string, key: readline.Key | undefined): void => {
    if (isPasteActive()) return;

    if (!key) {
      setImmediate(refresh);
      return;
    }

    const line = readlineBuffer(rl);
    const token = line.split(/\s/)[0] ?? '';
    const menuOpen = token.startsWith('/') && lastMatches.length > 0;

    if (menuOpen && (key.name === 'up' || key.name === 'down')) {
      selectedIndex = key.name === 'up'
        ? Math.max(0, selectedIndex - 1)
        : Math.min(lastMatches.length - 1, selectedIndex + 1);
      render(lastMatches, selectedIndex);
      restoreReadlineLine(rl, line);
      return;
    }

    if (menuOpen && key.name === 'tab') {
      const selected = lastMatches[selectedIndex];
      if (selected) {
        applySlashCommand(rl, selected.name);
      }
      setImmediate(refresh);
      return;
    }

    if (menuOpen && key.name === 'return') {
      const selected = lastMatches[selectedIndex];
      if (selected && selected.name !== token.toLowerCase()) {
        applySlashCommand(rl, selected.name);
      }
      setImmediate(refresh);
      return;
    }

    setImmediate(refresh);
  };

  const resolveInput = (line: string): string => {
    const trimmed = line.trim();
    const token = trimmed.split(/\s/)[0]?.toLowerCase() ?? '';
    if (!token.startsWith('/') || lastMatches.length === 0) return trimmed;

    const selected = lastMatches[selectedIndex];
    if (!selected) return trimmed;
    if (selected.name === token) return trimmed;

    const rest = trimmed.includes(' ') ? trimmed.slice(trimmed.indexOf(' ')) : '';
    return selected.name + rest;
  };

  process.stdin.prependListener('keypress', onKeypress);

  return {
    clear: closeMenu,
    resolveInput,
    detach: () => {
      process.stdin.removeListener('keypress', onKeypress);
      closeMenu();
    },
  };
}
