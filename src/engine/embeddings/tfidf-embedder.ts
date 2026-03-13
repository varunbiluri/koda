import natural from 'natural';
import type { SparseVector, VectorEntry } from '../../types/index.js';
import type { Vocabulary } from '../../types/repo-index.js';
import { tokenize } from './tokenizer.js';

const TfIdf = natural.TfIdf;

export interface EmbeddingResult {
  vectors: VectorEntry[];
  vocabulary: Vocabulary;
}

export function buildEmbeddings(
  chunks: Array<{ id: string; content: string; name: string }>,
): EmbeddingResult {
  const tfidf = new TfIdf();

  // Add each chunk's tokenized content as a document
  const tokenizedDocs: string[][] = [];
  for (const chunk of chunks) {
    const tokens = tokenize(chunk.content + ' ' + chunk.name);
    tokenizedDocs.push(tokens);
    tfidf.addDocument(tokens.join(' '));
  }

  // Build vocabulary from all unique terms
  const termSet = new Set<string>();
  for (const doc of tokenizedDocs) {
    for (const term of doc) {
      termSet.add(term);
    }
  }

  const terms = [...termSet].sort();
  const termToIndex: Record<string, number> = {};
  for (let i = 0; i < terms.length; i++) {
    termToIndex[terms[i]] = i;
  }

  const vocabulary: Vocabulary = { terms, termToIndex };

  // Build sparse vectors
  const vectors: VectorEntry[] = [];
  for (let docIdx = 0; docIdx < chunks.length; docIdx++) {
    const indices: number[] = [];
    const values: number[] = [];

    tfidf.listTerms(docIdx).forEach((item: { term: string; tfidf: number }) => {
      const idx = termToIndex[item.term];
      if (idx !== undefined) {
        indices.push(idx);
        values.push(item.tfidf);
      }
    });

    vectors.push({
      chunkId: chunks[docIdx].id,
      vector: { indices, values },
    });
  }

  return { vectors, vocabulary };
}

export function embedQuery(
  query: string,
  vocabulary: Vocabulary,
  documentCount: number,
): SparseVector {
  const tokens = tokenize(query);
  const tfidf = new TfIdf();

  // Add query as a single document
  tfidf.addDocument(tokens.join(' '));

  const indices: number[] = [];
  const values: number[] = [];

  tfidf.listTerms(0).forEach((item: { term: string; tfidf: number }) => {
    const idx = vocabulary.termToIndex[item.term];
    if (idx !== undefined) {
      indices.push(idx);
      values.push(item.tfidf);
    }
  });

  return { indices, values };
}
