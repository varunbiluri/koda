/**
 * Bracketed-paste + multiline paste handling for the Koda REPL.
 *
 * Node readline is single-line. Pasting a web page fires newlines that submit
 * partial input and echo remaining characters one-per-line. We intercept paste
 * blobs, collapse whitespace, and insert one clean line (Claude Code–style input).
 */

import * as readline from 'node:readline';

const BRACKET_START = '\x1b[200~';
const BRACKET_END   = '\x1b[201~';
const MAX_PASTE_CHARS = 32_000;

type ReadlineExt = readline.Interface & { line?: string; cursor?: number };

export interface PasteHandlerOptions {
  /** When true, swallow keyboard/paste input (agent running, pause menu, etc.). */
  isInputBlocked?: () => boolean;
  onTruncated?: (originalLen: number, max: number) => void;
}

export interface PasteHandlerHandle {
  isPasting: () => boolean;
  detach: () => void;
}

let pasteActive = false;

/** Shared flag for slash-menu refresh — skip per-char work during paste. */
export function isPasteActive(): boolean {
  return pasteActive;
}

/** Enable terminal bracketed paste mode (iTerm, Terminal.app, Cursor, VS Code). */
export function enableBracketedPaste(): void {
  if (process.stdout.isTTY) {
    process.stdout.write('\x1b[?2004h');
  }
}

export function disableBracketedPaste(): void {
  if (process.stdout.isTTY) {
    process.stdout.write('\x1b[?2004l');
  }
}

/** Collapse multiline / tabbed clipboard text into one REPL line. */
export function collapsePaste(raw: string): string {
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n+/g, ' ')
    .replace(/\t/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function applyPasteToReadline(
  rl: readline.Interface,
  raw: string,
  onTruncated?: PasteHandlerOptions['onTruncated'],
): void {
  let text = collapsePaste(raw);
  if (text.length > MAX_PASTE_CHARS) {
    onTruncated?.(text.length, MAX_PASTE_CHARS);
    text = text.slice(0, MAX_PASTE_CHARS);
  }
  if (!text) return;

  const rlExt = rl as ReadlineExt;
  rl.write(null, { ctrl: true, name: 'u' });
  rl.write(text);
  rlExt.line = text;
  rlExt.cursor = text.length;
}

/**
 * Intercept multiline clipboard paste before readline splits on `\n`.
 * Must be attached with prependListener (before slash-menu handlers).
 */
export function attachPasteHandler(
  rl: readline.Interface,
  options: PasteHandlerOptions = {},
): PasteHandlerHandle {
  if (!process.stdin.isTTY) {
    return { isPasting: () => false, detach: () => undefined };
  }

  readline.emitKeypressEvents(process.stdin, rl);

  let bracketOpen = false;
  let bracketBuf = '';

  const finishPaste = (raw: string): void => {
    pasteActive = false;
    bracketOpen = false;
    bracketBuf = '';
    applyPasteToReadline(rl, raw, options.onTruncated);
    rl.resume();
  };

  const onKeypress = (str: string, key: readline.Key | undefined): void => {
    if (options.isInputBlocked?.()) {
      if (str === BRACKET_START) {
        bracketOpen = true;
        bracketBuf = '';
        pasteActive = true;
        rl.pause();
      } else if (bracketOpen) {
        if (str.includes(BRACKET_END)) {
          bracketBuf += str.split(BRACKET_END)[0] ?? '';
          finishPaste(bracketBuf);
        } else {
          bracketBuf += str;
        }
      }
      return;
    }

    if (str === BRACKET_START) {
      bracketOpen = true;
      bracketBuf = '';
      pasteActive = true;
      rl.pause();
      return;
    }

    if (bracketOpen) {
      if (str.includes(BRACKET_END)) {
        bracketBuf += str.split(BRACKET_END)[0] ?? '';
        finishPaste(bracketBuf);
      } else {
        bracketBuf += str;
      }
      return;
    }

    // Some terminals deliver the whole paste as one keypress (no bracketed mode).
    if (
      str &&
      str.length > 1 &&
      !str.startsWith('\x1b') &&
      !(key?.ctrl) &&
      !(key?.meta) &&
      key?.name !== 'return'
    ) {
      pasteActive = true;
      rl.pause();
      process.nextTick(() => finishPaste(str));
    }
  };

  process.stdin.prependListener('keypress', onKeypress);

  return {
    isPasting: () => pasteActive || bracketOpen,
    detach: () => {
      process.stdin.removeListener('keypress', onKeypress);
      pasteActive = false;
      bracketOpen = false;
      bracketBuf = '';
    },
  };
}
