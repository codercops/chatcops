import type { ScoredRecord, VectorStore } from '../storage/types.js';
import { retrievalQueryText } from './query.js';
import type { Embedder, RetrievalQuery, RetrievedChunk, Reranker, Retriever } from './types.js';

export interface VectorRetrieverOptions {
  store: VectorStore;
  /** The same embedder the index was built with. */
  embedder: Embedder;
  /** Records fetched before reranking. Default 20, and never fewer than `topK`. */
  candidates?: number;
  /** Optional: reorders the candidates before the top ones are kept. */
  reranker?: Reranker;
}

export interface HybridRetrieverOptions extends VectorRetrieverOptions {
  /** The k in reciprocal rank fusion. Default 60. */
  rrfK?: number;
}

const DEFAULT_TOP_K = 5;
const DEFAULT_CANDIDATES = 20;

/** Searches by meaning only: the query is embedded and compared with every chunk. */
export function vectorRetriever(options: VectorRetrieverOptions): Retriever {
  checkDimensions(options);
  return {
    async retrieve(query) {
      const { text, topK, candidates } = plan(query, options);
      const [vector] = await options.embedder.embed([text], 'query', { signal: query.signal });
      const found = await options.store.query({ vector, topK: candidates, filter: query.filter });
      return finish(text, found.map(toChunk), topK, options.reranker, query.signal);
    },
  };
}

/**
 * Searches by meaning and by words, and merges the two lists by rank
 * (reciprocal rank fusion). Words catch what meaning misses: product names,
 * error codes, part numbers. The store needs `keywordQuery`.
 */
export function hybridRetriever(options: HybridRetrieverOptions): Retriever {
  checkDimensions(options);
  const { store } = options;
  if (!store.keywordQuery) {
    throw new Error('hybridRetriever needs a store with keywordQuery. Use vectorRetriever for this store.');
  }
  const keywordQuery = store.keywordQuery.bind(store);
  const k = options.rrfK ?? 60;
  return {
    async retrieve(query) {
      const { text, topK, candidates } = plan(query, options);
      const [byMeaning, byWords] = await Promise.all([
        options.embedder
          .embed([text], 'query', { signal: query.signal })
          .then(([vector]) => store.query({ vector, topK: candidates, filter: query.filter })),
        keywordQuery({ text, topK: candidates, filter: query.filter }),
      ]);
      const fused = reciprocalRankFusion([byMeaning, byWords], k).slice(0, candidates);
      return finish(text, fused, topK, options.reranker, query.signal);
    },
  };
}

/**
 * Merges ranked lists: each record scores `1 / (k + rank)` in every list it's
 * in (rank from 1), summed. Records high in both lists win; scores on
 * different scales (cosine, BM25) never have to be compared.
 */
export function reciprocalRankFusion(lists: ScoredRecord[][], k = 60): RetrievedChunk[] {
  const fused = new Map<string, RetrievedChunk>();
  for (const list of lists) {
    list.forEach((record, index) => {
      const add = 1 / (k + index + 1);
      const seen = fused.get(record.id);
      if (seen) seen.score += add;
      else fused.set(record.id, { ...toChunk(record), score: add });
    });
  }
  return [...fused.values()].sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
}

function plan(query: RetrievalQuery, options: VectorRetrieverOptions) {
  const topK = Math.max(1, Math.floor(query.topK ?? DEFAULT_TOP_K));
  return {
    text: retrievalQueryText(query.text, query.history),
    topK,
    candidates: Math.max(topK, options.candidates ?? DEFAULT_CANDIDATES),
  };
}

async function finish(
  text: string,
  chunks: RetrievedChunk[],
  topK: number,
  reranker: Reranker | undefined,
  signal: AbortSignal | undefined
): Promise<RetrievedChunk[]> {
  if (!reranker || chunks.length === 0) return chunks.slice(0, topK);
  return (await reranker.rerank(text, chunks, topK, { signal })).slice(0, topK);
}

function toChunk(record: ScoredRecord): RetrievedChunk {
  return {
    id: record.id,
    text: record.text,
    score: record.score,
    source: record.source,
    ...(record.metadata ? { metadata: record.metadata } : {}),
  };
}

function checkDimensions({ store, embedder }: VectorRetrieverOptions): void {
  if (store.dimensions !== embedder.dimensions) {
    throw new Error(
      `The embedder (${embedder.id}) makes ${embedder.dimensions}-dimension vectors, but the store holds ${store.dimensions}. Use the embedder the index was built with.`
    );
  }
}
