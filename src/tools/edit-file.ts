import * as fs   from 'node:fs/promises';
import * as path from 'node:path';

// ── Public types ──────────────────────────────────────────────────────────────

export interface EditFileResult {
  success:      true;
  linesChanged: number;
  /** First 20 lines of the file after the edit, for self-verification. */
  preview:      string;
}

// ── editFile ──────────────────────────────────────────────────────────────────

/**
 * Content-addressed file editor.
 *
 * Rules:
 *   1. The file must exist.
 *   2. `oldString` must appear **exactly once** in the file.
 *   3. If `oldString` is not found → throws with a clear message.
 *   4. If `oldString` appears more than once → throws with match count.
 *   5. Performs an atomic in-place replacement and returns a preview.
 *
 * This replaces the fragile line-number-based `apply_patch` and the
 * first-occurrence-only `replace_text` tool.  By requiring an exact,
 * unique match the edit is guaranteed to target the correct code region
 * regardless of any prior edits that may have shifted line numbers.
 *
 * @param filePath  - Path relative to `rootPath` (or absolute).
 * @param oldString - Exact text to replace (must be unique in the file).
 * @param newString - Replacement text.
 * @param rootPath  - Repository root used to resolve relative paths.
 */
export async function editFile(
  filePath:  string,
  oldString: string,
  newString: string,
  rootPath:  string,
): Promise<EditFileResult> {
  const absPath = path.resolve(rootPath, filePath);

  let content: string;
  try {
    content = await fs.readFile(absPath, 'utf-8');
  } catch (err) {
    throw new Error(
      `edit_file: cannot read "${filePath}" — ${(err as NodeJS.ErrnoException).code ?? (err as Error).message}`,
    );
  }

  if (oldString === '') {
    throw new Error('edit_file: old_string must not be empty');
  }

  // Count occurrences without building a large array
  let count = 0;
  let pos   = 0;
  while ((pos = content.indexOf(oldString, pos)) !== -1) {
    count++;
    pos += oldString.length;
    if (count > 1) break; // no need to continue counting past 2
  }

  if (count === 0) {
    // Give the model a useful hint: show the first 5 lines around where
    // the string might be to aid retry.
    const hint = content.length > 200 ? content.slice(0, 200) + '…' : content;
    throw new Error(
      `edit_file: old_string not found in "${filePath}".\n` +
      `Searched for: ${JSON.stringify(oldString.slice(0, 120))}\n` +
      `File starts with: ${JSON.stringify(hint)}`,
    );
  }

  if (count > 1) {
    throw new Error(
      `edit_file: old_string matches ${count} locations in "${filePath}" — ` +
      `provide more context (surrounding lines) to make it unique.`,
    );
  }

  // Exactly one match — perform the replacement
  const newContent = content.slice(0, content.indexOf(oldString)) +
                     newString +
                     content.slice(content.indexOf(oldString) + oldString.length);

  await fs.writeFile(absPath, newContent, 'utf-8');

  const oldLines = oldString.split('\n').length;
  const newLines = newString.split('\n').length;

  // Return the first 20 lines of the modified file as a self-verification preview
  const preview = newContent.split('\n').slice(0, 20).join('\n');

  return {
    success:      true,
    linesChanged: Math.max(oldLines, newLines),
    preview,
  };
}
