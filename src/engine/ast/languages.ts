export interface LanguageConfig {
  name: string;
  extensions: string[];
  grammarModule: string;
  grammarExport?: string; // For modules with named exports (e.g., tree-sitter-typescript)
}

export const SUPPORTED_LANGUAGES: LanguageConfig[] = [
  {
    name: 'typescript',
    extensions: ['.ts', '.tsx', '.mts', '.cts'],
    grammarModule: 'tree-sitter-typescript',
    grammarExport: 'typescript',
  },
  {
    name: 'python',
    extensions: ['.py', '.pyi'],
    grammarModule: 'tree-sitter-python',
  },
];

export function getLanguageConfig(language: string): LanguageConfig | undefined {
  return SUPPORTED_LANGUAGES.find(l => l.name === language);
}

export function isLanguageSupported(language: string): boolean {
  return SUPPORTED_LANGUAGES.some(l => l.name === language);
}
