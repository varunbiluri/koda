import * as path from 'node:path';
import type { FileInfo } from '../../types/index.js';

const TS_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

export function resolveImportPath(
  importSource: string,
  importerPath: string,
  fileIndex: Map<string, FileInfo>,
): string | null {
  // Skip external/node modules
  if (!importSource.startsWith('.') && !importSource.startsWith('/')) {
    return null;
  }

  const importerDir = path.dirname(importerPath);
  const resolved = path.normalize(path.join(importerDir, importSource));

  // Try exact match
  if (fileIndex.has(resolved)) return resolved;

  // Try with extensions
  for (const ext of TS_EXTENSIONS) {
    const withExt = resolved + ext;
    if (fileIndex.has(withExt)) return withExt;
  }

  // Try as directory with index file
  for (const ext of TS_EXTENSIONS) {
    const indexPath = path.join(resolved, 'index' + ext);
    if (fileIndex.has(indexPath)) return indexPath;
  }

  // Try .py for Python
  if (fileIndex.has(resolved + '.py')) return resolved + '.py';

  return null;
}

export function buildFileIndex(files: FileInfo[]): Map<string, FileInfo> {
  const index = new Map<string, FileInfo>();
  for (const file of files) {
    index.set(file.path, file);
  }
  return index;
}
