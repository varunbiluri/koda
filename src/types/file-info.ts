export interface FileInfo {
  path: string;         // Relative to repo root
  absolutePath: string;
  language: string;     // e.g. 'typescript', 'python'
  size: number;         // bytes
  hash: string;         // SHA-256 of content (for change detection)
}
