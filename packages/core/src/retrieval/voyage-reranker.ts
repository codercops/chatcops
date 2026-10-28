import { postWithRetries } from './http.js';
import type { Reranker } from './types.js';

export interface VoyageRerankerOptions {
  apiKey: string;
  /** Default `rerank-3`, Voyage's current recommended model. */
  model?: string;
  /** Default `https://api.voyageai.com/v1`, or a proxy for it. */
  baseUrl?: string;
  /** For tests and proxies. */
  fetch?: typeof fetch;
}

interface VoyageRerankResponse {
  data?: Array<{ index?: number; relevance_score?: number }>;
}

/** Reranks retrieved chunks with Voyage AI's Reranker API. */
export function voyageReranker(options: VoyageRerankerOptions): Reranker {
  const model = options.model ?? 'rerank-3';
  const baseUrl = (options.baseUrl ?? 'https://api.voyageai.com/v1').replace(/\/$/, '');
  const send = options.fetch ?? fetch;

  return {
    async rerank(query, chunks, topN, rerankOptions = {}) {
      const limit = Math.floor(topN);
      if (chunks.length === 0 || limit <= 0) return [];

      const response = await postWithRetries(
        'Voyage',
        send,
        {
          url: `${baseUrl}/rerank`,
          headers: { authorization: `Bearer ${options.apiKey}` },
          body: { query, documents: chunks.map((chunk) => chunk.text), model, top_k: Math.min(limit, chunks.length) },
        },
        rerankOptions.signal,
        'rerank'
      );

      const body = (await response.json()) as VoyageRerankResponse;
      if (!body || typeof body !== 'object' || !Array.isArray(body.data)) {
        throw new Error('Voyage returned an invalid rerank response: data must be an array.');
      }
      return body.data.slice(0, limit).map(({ index, relevance_score }) => {
        if (
          typeof index !== 'number' ||
          !Number.isInteger(index) ||
          index < 0 ||
          index >= chunks.length ||
          typeof relevance_score !== 'number' ||
          !Number.isFinite(relevance_score)
        ) {
          throw new Error('Voyage returned an invalid rerank result.');
        }
        const chunk = chunks[index];
        if (!chunk) throw new Error('Voyage returned an invalid rerank result.');
        return { ...chunk, score: relevance_score };
      });
    },
  };
}
