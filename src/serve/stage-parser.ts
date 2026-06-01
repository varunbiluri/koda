export type ToolKind =
  | 'READ'
  | 'SEARCH'
  | 'WRITE'
  | 'RUN'
  | 'VERIFY'
  | 'COMMIT'
  | 'GIT'
  | 'PLAN'
  | 'ROUTER'
  | 'INFO'
  | 'WARN';

export interface ParsedStage {
  kind: ToolKind;
  detail: string;
  raw: string;
  isTool: boolean;
}

const TOOL_PREFIXES: Array<[string, ToolKind]> = [
  ['READ ', 'READ'],
  ['SEARCH ', 'SEARCH'],
  ['WRITE ', 'WRITE'],
  ['RUN ', 'RUN'],
  ['GIT ', 'GIT'],
  ['COMMIT ', 'COMMIT'],
  ['PLAN ', 'PLAN'],
];

/** Map raw agent stage strings to structured tool kinds for the desktop UI. */
export function parseToolStage(raw: string): ParsedStage {
  const trimmed = raw.trim();
  const upper = trimmed.toUpperCase();

  for (const [prefix, kind] of TOOL_PREFIXES) {
    if (trimmed.startsWith(prefix) || upper.startsWith(prefix)) {
      return { kind, detail: trimmed.slice(prefix.length).trim(), raw: trimmed, isTool: true };
    }
  }

  if (upper.startsWith('INFO ROUTER') || upper.includes('ROUTER:')) {
    return { kind: 'ROUTER', detail: trimmed.replace(/^INFO\s+ROUTER:?/i, '').trim(), raw: trimmed, isTool: true };
  }
  if (upper.startsWith('INFO VERIFY') || upper.startsWith('VERIFY')) {
    return { kind: 'VERIFY', detail: trimmed.replace(/^INFO\s+VERIFY:?/i, '').trim(), raw: trimmed, isTool: true };
  }
  if (upper.startsWith('WARN VERIFY') || upper.includes('VERIFY:')) {
    return { kind: 'VERIFY', detail: trimmed, raw: trimmed, isTool: true };
  }
  if (upper.startsWith('INFO GRAPH') || upper.startsWith('INFO STEP') || upper.startsWith('INFO ENV')) {
    return { kind: 'INFO', detail: trimmed, raw: trimmed, isTool: false };
  }
  if (upper.startsWith('WARN ')) {
    return { kind: 'WARN', detail: trimmed.slice(5).trim(), raw: trimmed, isTool: false };
  }
  if (upper.startsWith('INFO ')) {
    return { kind: 'INFO', detail: trimmed.slice(5).trim(), raw: trimmed, isTool: false };
  }
  if (upper.includes('BASH') || upper.includes('SHELL')) {
    return { kind: 'RUN', detail: trimmed, raw: trimmed, isTool: true };
  }

  return { kind: 'INFO', detail: trimmed, raw: trimmed, isTool: false };
}

export function diffStats(oldContent: string, newContent: string): { added: number; removed: number } {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  const oldSet = new Set(oldLines);
  const newSet = new Set(newLines);
  let added = 0;
  let removed = 0;
  for (const line of newLines) if (!oldSet.has(line)) added += 1;
  for (const line of oldLines) if (!newSet.has(line)) removed += 1;
  return { added, removed };
}
