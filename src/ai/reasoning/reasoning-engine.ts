import { QueryEngine } from '../../search/query-engine.js';
import type { RepoIndex } from '../../types/index.js';
import type { AIProvider, ChatMessage } from '../types.js';
import { buildContext, formatFileReferences } from '../../context/context-builder.js';
import { getSystemPrompt } from '../prompts/system-prompt.js';
import { buildCodeAnalysisPrompt } from '../prompts/code-analysis.js';
import { logger } from '../../utils/logger.js';

export interface ReasoningOptions {
  maxResults?: number;
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
}

export interface ReasoningResult {
  answer: string;
  filesAnalyzed: string[];
  chunksUsed: number;
  contextTruncated: boolean;
}

export class ReasoningEngine {
  private queryEngine: QueryEngine;
  private provider: AIProvider;
  private index: RepoIndex;

  constructor(index: RepoIndex, provider: AIProvider) {
    this.index = index;
    this.queryEngine = new QueryEngine(index);
    this.provider = provider;
  }

  async analyze(
    query: string,
    options: ReasoningOptions = {},
  ): Promise<ReasoningResult> {
    const {
      maxResults = 10,
      maxTokens = 8000,
      temperature = 0.3,
    } = options;

    logger.debug(`Analyzing query: ${query}`);

    // Step 1: Vector search
    const searchResults = this.queryEngine.search(query, maxResults);

    if (searchResults.length === 0) {
      throw new Error('No relevant code found in the repository.');
    }

    // Step 2: Get full chunks
    const chunks = searchResults
      .map(r => this.index.chunks.find(c => c.id === r.chunkId))
      .filter((c): c is NonNullable<typeof c> => c !== undefined);

    logger.debug(`Found ${chunks.length} relevant chunks`);

    // Step 3: Build context
    const contextResult = buildContext(chunks, maxTokens);
    const fileReferences = formatFileReferences(contextResult.chunks);

    logger.debug(
      `Context built: ${contextResult.estimatedTokens} tokens, ${contextResult.chunks.length} chunks`,
    );

    if (contextResult.truncated) {
      logger.warn('Context was truncated due to token limit');
    }

    // Step 4: Build prompt
    const userPrompt = buildCodeAnalysisPrompt({
      query,
      context: contextResult.context,
      metadata: this.index.metadata,
      fileReferences,
    });

    const messages: ChatMessage[] = [
      { role: 'system', content: getSystemPrompt() },
      { role: 'user', content: userPrompt },
    ];

    // Step 5: Call AI model
    const response = await this.provider.sendChatCompletion({
      messages,
      temperature,
      max_tokens: 2000,
    });

    const answer = response.choices[0]?.message?.content ?? '';

    const filesAnalyzed = Array.from(
      new Set(contextResult.chunks.map(c => c.filePath)),
    );

    return {
      answer,
      filesAnalyzed,
      chunksUsed: contextResult.chunks.length,
      contextTruncated: contextResult.truncated,
    };
  }

  async analyzeStream(
    query: string,
    onChunk: (chunk: string) => void,
    options: ReasoningOptions = {},
  ): Promise<Omit<ReasoningResult, 'answer'>> {
    const {
      maxResults = 10,
      maxTokens = 8000,
      temperature = 0.3,
    } = options;

    logger.debug(`Analyzing query (streaming): ${query}`);

    // Step 1: Vector search
    const searchResults = this.queryEngine.search(query, maxResults);

    if (searchResults.length === 0) {
      throw new Error('No relevant code found in the repository.');
    }

    // Step 2: Get full chunks
    const chunks = searchResults
      .map(r => this.index.chunks.find(c => c.id === r.chunkId))
      .filter((c): c is NonNullable<typeof c> => c !== undefined);

    // Step 3: Build context
    const contextResult = buildContext(chunks, maxTokens);
    const fileReferences = formatFileReferences(contextResult.chunks);

    // Step 4: Build prompt
    const userPrompt = buildCodeAnalysisPrompt({
      query,
      context: contextResult.context,
      metadata: this.index.metadata,
      fileReferences,
    });

    const messages: ChatMessage[] = [
      { role: 'system', content: getSystemPrompt() },
      { role: 'user', content: userPrompt },
    ];

    // Step 5: Stream AI model response
    await this.provider.streamChatCompletion(
      {
        messages,
        temperature,
        max_tokens: 2000,
      },
      onChunk,
    );

    const filesAnalyzed = Array.from(
      new Set(contextResult.chunks.map(c => c.filePath)),
    );

    return {
      filesAnalyzed,
      chunksUsed: contextResult.chunks.length,
      contextTruncated: contextResult.truncated,
    };
  }
}
