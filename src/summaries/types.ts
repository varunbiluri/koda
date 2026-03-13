/**
 * Hierarchical summary types for multi-level repository understanding
 */

export interface FileSummary {
  filePath: string;
  language: string;
  lineCount: number;
  purpose: string; // AI-generated summary of file purpose
  mainExports: string[]; // Key exports/classes/functions
  dependencies: string[]; // Imported files
  complexity: number; // 1-10 score
  lastModified?: string;
}

export interface ModuleSummary {
  modulePath: string; // Directory path
  name: string; // Module name
  purpose: string; // AI-generated module purpose
  files: FileSummary[];
  submodules: ModuleSummary[];
  totalFiles: number;
  totalLines: number;
  mainComponents: string[]; // Key components in this module
  dependencies: string[]; // External module dependencies
}

export interface RepositorySummary {
  rootPath: string;
  name: string;
  purpose: string; // Overall repository purpose
  architecture: string; // High-level architecture description
  modules: ModuleSummary[];
  totalFiles: number;
  totalLines: number;
  mainTechnologies: string[]; // Languages, frameworks used
  entryPoints: string[]; // Main files (index, main, etc.)
  createdAt: string;
  updatedAt: string;
}

export interface SummaryHierarchy {
  repository: RepositorySummary;
  modules: Map<string, ModuleSummary>;
  files: Map<string, FileSummary>;
}
