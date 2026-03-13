export interface FilePatch {
  filePath: string;
  oldContent: string;
  newContent: string;
  patch: string;  // Git-style unified diff
  hunks: PatchHunk[];
}

export interface PatchHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

export interface PatchResult {
  success: boolean;
  filePath: string;
  error?: string;
  applied?: boolean;
}
