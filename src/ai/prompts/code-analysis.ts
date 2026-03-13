import type { IndexMetadata } from '../../types/index.js';

export interface CodeAnalysisPromptParams {
  query: string;
  context: string;
  metadata: IndexMetadata;
  fileReferences: string;
}

export function buildCodeAnalysisPrompt(params: CodeAnalysisPromptParams): string {
  const { query, context, metadata, fileReferences } = params;

  return `# Repository Analysis Request

## User Query
${query}

## Repository Information
- Root: ${metadata.rootPath}
- Total Files: ${metadata.fileCount}
- Total Code Chunks: ${metadata.chunkCount}
- Dependencies: ${metadata.edgeCount}

## Relevant Code Context

The following code has been retrieved from the repository as the most relevant to the query:
${context}

## Files Referenced
${fileReferences}

## Instructions

Analyze the provided code context and answer the user's query. Make sure to:
1. Reference specific files and line numbers from the context above
2. Explain the relationships between components
3. Provide a clear, structured answer
4. Use the actual code snippets to illustrate your points

Your response should be technical and precise, directly addressing the query while leveraging the code context provided.`;
}
