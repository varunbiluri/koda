import Parser from 'tree-sitter';
import { getLanguageConfig } from './languages.js';
import { logger } from '../../utils/logger.js';

const parserCache = new Map<string, Parser>();

export async function getParser(language: string): Promise<Parser | null> {
  if (parserCache.has(language)) {
    return parserCache.get(language)!;
  }

  const config = getLanguageConfig(language);
  if (!config) {
    return null;
  }

  try {
    const mod = await import(config.grammarModule);
    // Handle ESM default export wrapping: module may export as mod.default.X or mod.X
    let grammar: unknown;
    if (config.grammarExport) {
      grammar = mod[config.grammarExport] ?? mod.default?.[config.grammarExport];
    } else {
      grammar = mod.default ?? mod;
    }

    const parser = new Parser();
    parser.setLanguage(grammar);
    parserCache.set(language, parser);
    logger.debug(`Loaded parser for ${language}`);
    return parser;
  } catch (err) {
    logger.warn(`Failed to load parser for ${language}: ${err}`);
    return null;
  }
}

export function clearParserCache(): void {
  parserCache.clear();
}
