export type ChunkType =
  | 'function'
  | 'class'
  | 'interface'
  | 'type_alias'
  | 'enum'
  | 'import'
  | 'export'
  | 'variable'
  | 'misc';

export interface CodeChunk {
  id: string;           // Unique identifier: filePath#name
  filePath: string;     // Relative path
  name: string;         // Symbol name or 'misc_N'
  type: ChunkType;
  content: string;      // Source code text
  startLine: number;
  endLine: number;
  language: string;
}
