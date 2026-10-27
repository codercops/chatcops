import { batchSizeFor, checkedVectors, inBatches, postWithRetries } from './http.js';
import type { Embedder } from './types.js';

export interface GeminiEmbedderOptions {
  apiKey: string;
  /** Default `gemini-embedding-001`. */
  model?: string;
  /**
   * Vector length. Default 1024, which every planned store can index.
   */
  dimensions?: number;
  /** Default `https://generativelanguage.googleapis.com/v1beta`. */
  baseUrl?: string;
  /**
   * Texts per request. Default 100, and at most 100, which is what Gemini
   * accepts.
   */
  batchSize?: number;
  /** For tests and proxies. */
  fetch?: typeof fetch;
}

const MAX_BATCH_SIZE = 100;

/**
 * Embeddings from Google's Gemini API, with `fetch` only. Rate limits and
 * server errors are retried twice, waiting as long as `retry-after` says (or
 * 1s, then 2s).
 */
export function geminiEmbedder(options: GeminiEmbedderOptions): Embedder {
  const model = (options.model ?? 'gemini-embedding-001').replace(/^models\//, '');
  const dimensions = options.dimensions ?? 1024;
  const baseUrl = (options.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');
  const batchSize = batchSizeFor(options.batchSize, 100, MAX_BATCH_SIZE);
  const send = options.fetch ?? fetch;

  return {
    id: `gemini:${model}@${dimensions}`,
    dimensions,
    embed: (texts, kind, embedOptions = {}) =>
      inBatches(texts, batchSize, async (input) => {
        const taskType = kind === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT';
        const response = await postWithRetries(
          'Gemini',
          send,
          {
            url: `${baseUrl}/models/${model}:batchEmbedContents`,
            headers: { 'x-goog-api-key': options.apiKey },
            body: {
              requests: input.map((text) => ({
                model: `models/${model}`,
                content: { parts: [{ text }] },
                taskType,
                outputDimensionality: dimensions,
              })),
            },
          },
          embedOptions.signal
        );
        const body = (await response.json()) as { embeddings?: Array<{ values: number[] }> };
        return checkedVectors('Gemini', model, (body.embeddings ?? []).map((item) => item.values), input.length, dimensions);
      }),
  };
}
