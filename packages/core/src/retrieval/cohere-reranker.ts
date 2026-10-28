import { postWithRetries } from './http.js';
import type { Reranker } from './types.js';

export interface CohereRerankerOptions {
  apiKey: string;
  /** Default `rerank-v5.0-pro`. */
  model?: string;
  /** Default `https://api.cohere.com/v2`, or a proxy for it. */
  baseUrl?: string;
  /** For tests and proxies. */
  fetch?: typeof fetch;
}

interface CohereRerankResponse {
  results?: Array<{ index?: number; relevance_score?: number }>;
}

/** Reranks retrieved chunks with Cohere's Rerank API. */
export function cohereReranker(options: CohereRerankerOptions): Reranker {
  const model = options.model ?? 'rerank-v5.0-pro';
  const baseUrl = (options.baseUrl ?? 'https://api.cohere.com/v2').replace(/\/$/, '');
  const send = options.fetch ?? fetch;

  return {
    async rerank(query, chunks, topN, rerankOptions = {}) {
      const limit = Math.floor(topN);
      if (chunks.length === 0 || limit <= 0) return [];

      const response = await postWithRetries(
        'Cohere',
        send,
        {
          url: `${baseUrl}/rerank`,
          headers: { authorization: `Bearer ${options.apiKey}` },
          body: { model, query, documents: chunks.map((chunk) => chunk.text), top_n: Math.min(limit, chunks.length) },
        },
        rerankOptions.signal,
        'rerank'
      );

      const body = (await response.json()) as CohereRerankResponse;
      if (!body || typeof body !== 'object' || !Array.isArray(body.results)) {
        throw new Error('Cohere returned an invalid rerank response: results must be an array.');
      }
      return body.results.slice(0, limit).map(({ index, relevance_score }) => {
        if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= chunks.length || typeof relevance_score !== 'number' || !Number.isFinite(relevance_score)) {
          throw new Error('Cohere returned an invalid rerank result.');
        }
        const chunk = chunks[index];
        if (!chunk) throw new Error('Cohere returned an invalid rerank result.');
        return { ...chunk, score: relevance_score };
      });
    },
  };
}
