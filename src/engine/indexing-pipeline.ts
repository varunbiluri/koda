import * as fs from 'node:fs/promises';
import { VERSION, KODA_DIR } from '../constants.js';
import type { RepoIndex, IndexMetadata } from '../types/repo-index.js';
import type { CodeChunk } from '../types/index.js';
import { discoverFiles } from './file-discovery.js';
import { getParser } from './ast/parser-manager.js';
import { isLanguageSupported } from './ast/languages.js';
import { TypeScriptExtractor } from './ast/extractors/typescript-extractor.js';
import { PythonExtractor } from './ast/extractors/python-extractor.js';
import type { BaseExtractor, ExtractionResult } from './ast/extractors/base-extractor.js';
import { createChunks } from './chunking/chunker.js';
import { buildDependencyGraph, type FileImports } from './dependency/graph-builder.js';
import { buildEmbeddings } from './embeddings/tfidf-embedder.js';
import { saveIndex, indexExists } from '../store/index-store.js';
import { logger } from '../utils/logger.js';

export interface PipelineOptions {
  force?: boolean;
  onProgress?: (stage: string) => void;
}

export interface PipelineResult {
  metadata: IndexMetadata;
  warnings: string[];
}

function getExtractor(language: string): BaseExtractor | null {
  switch (language) {
    case 'typescript': return new TypeScriptExtractor();
    case 'python': return new PythonExtractor();
    default: return null;
  }
}

export async function runIndexingPipeline(
  rootPath: string,
  options: PipelineOptions = {},
): Promise<PipelineResult> {
  const { force = false, onProgress } = options;
  const warnings: string[] = [];

  const progress = (msg: string) => {
    logger.debug(msg);
    onProgress?.(msg);
  };

  // Check if already indexed
  if (!force && await indexExists(rootPath)) {
    progress('Index already exists. Use --force to re-index.');
  }

  // Step 1: File discovery
  progress('Discovering files...');
  const discovery = await discoverFiles(rootPath);
  warnings.push(...discovery.warnings);
  const files = discovery.files;
  progress(`Found ${files.length} files`);

  // Step 2: AST parsing + extraction
  progress('Parsing files and extracting symbols...');
  const allChunks: CodeChunk[] = [];
  const allFileImports: FileImports[] = [];

  for (const file of files) {
    if (!isLanguageSupported(file.language)) {
      // For unsupported languages, create a single chunk with the full content
      try {
        const content = await fs.readFile(file.absolutePath, 'utf-8');
        allChunks.push({
          id: `${file.path}#file`,
          filePath: file.path,
          name: 'file',
          type: 'misc',
          content,
          startLine: 1,
          endLine: content.split('\n').length,
          language: file.language,
        });
      } catch {
        warnings.push(`Failed to read: ${file.path}`);
      }
      continue;
    }

    const parser = await getParser(file.language);
    if (!parser) {
      warnings.push(`No parser available for ${file.language}: ${file.path}`);
      continue;
    }

    const extractor = getExtractor(file.language);
    if (!extractor) {
      warnings.push(`No extractor for ${file.language}: ${file.path}`);
      continue;
    }

    let content: string;
    try {
      content = await fs.readFile(file.absolutePath, 'utf-8');
    } catch {
      warnings.push(`Failed to read: ${file.path}`);
      continue;
    }

    let extraction: ExtractionResult;
    try {
      const tree = parser.parse(content);
      extraction = extractor.extract(tree, content);
    } catch (err) {
      warnings.push(`Parse error in ${file.path}: ${(err as Error).message}`);
      continue;
    }

    // Build chunks from extracted symbols
    const chunks = createChunks(file.path, file.language, extraction.symbols, content);
    allChunks.push(...chunks);

    // Collect imports for dependency graph
    allFileImports.push({
      filePath: file.path,
      imports: extraction.imports,
    });
  }

  progress(`Extracted ${allChunks.length} chunks from ${files.length} files`);

  // Step 3: Build dependency graph
  progress('Building dependency graph...');
  const graph = buildDependencyGraph(allFileImports, files);
  progress(`Found ${graph.edges.length} dependencies`);

  // Step 4: Build TF-IDF embeddings
  progress('Building search index...');
  const { vectors, vocabulary } = buildEmbeddings(allChunks);
  progress(`Built vectors for ${vectors.length} chunks (${vocabulary.terms.length} terms)`);

  // Step 5: Build metadata
  const metadata: IndexMetadata = {
    version: VERSION,
    createdAt: new Date().toISOString(),
    rootPath,
    fileCount: files.length,
    chunkCount: allChunks.length,
    edgeCount: graph.edges.length,
  };

  // Step 6: Save to .koda/
  progress('Saving index...');
  const index: RepoIndex = {
    metadata,
    files,
    chunks: allChunks,
    edges: graph.edges,
    nodes: graph.nodes,
    vectors,
    vocabulary,
  };

  await saveIndex(rootPath, index);
  progress('Done!');

  return { metadata, warnings };
}
