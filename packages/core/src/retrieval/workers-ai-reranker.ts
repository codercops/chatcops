import type { Reranker } from './types.js';
import type { WorkersAiBinding } from './workers-ai-embedder.js';

export interface WorkersAiRerankerOptions {
  /** The Cloudflare Workers AI binding (`env.AI`). */
  ai: WorkersAiBinding;
  /** Default `@cf/baai/bge-reranker-base`. */
  model?: string;
}

const DEFAULT_MODEL = '@cf/baai/bge-reranker-base';

interface RerankerResult {
  id: number;
  score: number;
}

/** Reranks retrieved chunks with Cloudflare Workers AI via the native binding. */
export function workersAiReranker(options: WorkersAiRerankerOptions): Reranker {
  if (!options?.ai || typeof options.ai.run !== 'function') {
    throw new Error('workersAiReranker requires an ai binding with a run() method.');
  }

  const model = options.model ?? DEFAULT_MODEL;
  const ai = options.ai;

  return {
    async rerank(query, chunks, topN, rerankOptions = {}) {
      if (rerankOptions.signal?.aborted) throw rerankOptions.signal.reason;
      const requestedLimit = Number.isFinite(topN) && topN > 0 ? Math.floor(topN) : 0;
      if (!requestedLimit || !chunks.length) return [];
      const limit = Math.min(requestedLimit, chunks.length);

      const response = await ai.run(model, {
        query,
        contexts: chunks.map(({ text }) => ({ text })),
        top_k: limit,
      });
      if (rerankOptions.signal?.aborted) throw rerankOptions.signal.reason;

      if (!response || typeof response !== 'object' || !('response' in response) || !Array.isArray(response.response)) {
        throw new Error(`Workers AI returned an invalid reranking response for ${model}.`);
      }

      const ranked = (response.response as unknown[]).map((item): RerankerResult => {
        if (
          !item ||
          typeof item !== 'object' ||
          !('id' in item) ||
          !Number.isInteger(item.id) ||
          !('score' in item) ||
          typeof item.score !== 'number' ||
          !Number.isFinite(item.score) ||
          (item.id as number) < 0 ||
          (item.id as number) >= chunks.length
        ) {
          throw new Error(`Workers AI returned an invalid reranking result for ${model}.`);
        }
        return { id: item.id as number, score: item.score };
      });

      const seen = new Set<number>();
      for (const result of ranked) {
        if (seen.has(result.id)) throw new Error(`Workers AI returned a duplicate reranking result for ${model}.`);
        seen.add(result.id);
      }

      return ranked
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(({ id, score }) => ({ ...chunks[id], score }));
    },
  };
}
