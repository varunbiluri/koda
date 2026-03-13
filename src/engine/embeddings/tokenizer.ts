// Code-aware stop words (language keywords that don't carry semantic meaning)
const STOP_WORDS = new Set([
  // JS/TS keywords
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while',
  'do', 'switch', 'case', 'break', 'continue', 'new', 'this', 'class',
  'extends', 'implements', 'import', 'export', 'from', 'default', 'async',
  'await', 'try', 'catch', 'finally', 'throw', 'typeof', 'instanceof',
  'void', 'null', 'undefined', 'true', 'false', 'in', 'of',
  'interface', 'type', 'enum', 'public', 'private', 'protected', 'static',
  'readonly', 'abstract', 'declare', 'module', 'namespace',
  // Python keywords
  'def', 'class', 'self', 'cls', 'none', 'and', 'or', 'not', 'is',
  'with', 'as', 'pass', 'raise', 'yield', 'lambda', 'global', 'nonlocal',
  'elif', 'except', 'finally',
  // Common low-value tokens
  'string', 'number', 'boolean', 'any', 'object', 'array',
]);

/**
 * Split camelCase and PascalCase identifiers.
 * "getUserName" -> ["get", "user", "name"]
 */
function splitCamelCase(token: string): string[] {
  return token
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/\s+/);
}

/**
 * Split snake_case and kebab-case identifiers.
 * "get_user_name" -> ["get", "user", "name"]
 */
function splitSnakeCase(token: string): string[] {
  return token.toLowerCase().split(/[_-]+/).filter(Boolean);
}

/**
 * Tokenize a code string into meaningful terms.
 * - Splits camelCase/PascalCase
 * - Splits snake_case/kebab-case
 * - Removes stop words
 * - Removes single-character tokens
 * - Lowercases everything
 */
export function tokenize(text: string): string[] {
  // Extract word-like tokens (identifiers, words)
  const rawTokens = text.match(/[a-zA-Z_$][a-zA-Z0-9_$]*/g) ?? [];

  const result: string[] = [];

  for (const raw of rawTokens) {
    // Split compound identifiers
    let parts: string[];
    if (raw.includes('_') || raw.includes('-')) {
      parts = splitSnakeCase(raw);
    } else {
      parts = splitCamelCase(raw);
    }

    for (const part of parts) {
      const lower = part.toLowerCase();
      if (lower.length <= 1) continue;
      if (STOP_WORDS.has(lower)) continue;
      result.push(lower);
    }
  }

  return result;
}
