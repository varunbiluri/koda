import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

/**
 * Replace the first occurrence of oldText with newText in a file.
 * Returns a success message with character counts.
 */
export async function replaceText(
  filePath: string,
  oldText: string,
  newText: string,
): Promise<string> {
  const content = await fs.readFile(filePath, 'utf-8');

  if (!content.includes(oldText)) {
    throw new Error(`Text not found in ${filePath}: "${oldText.slice(0, 80)}..."`);
  }

  const updated = content.replace(oldText, newText);
  await fs.writeFile(filePath, updated, 'utf-8');

  return (
    `Replaced ${oldText.length} characters with ${newText.length} characters in ${path.basename(filePath)}.`
  );
}

/**
 * Insert text after the first line matching a regex pattern.
 * Returns a success message with the matched line number.
 */
export async function insertAfterPattern(
  filePath: string,
  pattern: string,
  text: string,
): Promise<string> {
  let regex: RegExp;
  try {
    regex = new RegExp(pattern);
  } catch {
    // Fall back to literal string match
    regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  }

  const content = await fs.readFile(filePath, 'utf-8');
  const lines = content.split('\n');

  let matchedLine = -1;
  for (let i = 0; i < lines.length; i++) {
    if (regex.test(lines[i])) {
      matchedLine = i;
      break;
    }
  }

  if (matchedLine === -1) {
    throw new Error(`Pattern "${pattern}" not found in ${filePath}`);
  }

  lines.splice(matchedLine + 1, 0, text);
  await fs.writeFile(filePath, lines.join('\n'), 'utf-8');

  return `Inserted text after line ${matchedLine + 1} in ${path.basename(filePath)}.`;
}

/**
 * Validate TypeScript syntax by running tsc --noEmit.
 * Returns { valid: true } on success, or { valid: false, errors: [...] }.
 */
export async function validateSyntax(
  cwd: string,
): Promise<{ valid: boolean; errors: string[] }> {
  // Check if tsconfig.json exists
  try {
    await fs.access(path.join(cwd, 'tsconfig.json'));
  } catch {
    return { valid: true, errors: [] }; // Not a TypeScript project — skip validation
  }

  try {
    await execAsync('npx tsc --noEmit 2>&1', { cwd });
    return { valid: true, errors: [] };
  } catch (err) {
    const output = (err as { stdout?: string; stderr?: string }).stdout ?? '';
    const errors = output
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    return { valid: false, errors };
  }
}
