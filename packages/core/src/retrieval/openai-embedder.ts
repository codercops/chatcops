import { batchSizeFor, checkedVectors, inBatches, postWithRetries } from './http.js';
import type { Embedder } from './types.js';

export interface OpenAIEmbedderOptions {
  apiKey: string;
  /** Default `text-embedding-3-small`. */
  model?: string;
  /**
   * Vector length. Default 1024, which every planned store can index. Only
   * the `text-embedding-3` models can shorten their vectors; for others, set
   * the model's own length.
   */
  dimensions?: number;
  /** Default `https://api.openai.com/v1`, or any OpenAI-compatible API. */
  baseUrl?: string;
  /** Texts per request. Default 128, and at most 2048, which is what OpenAI accepts. */
  batchSize?: number;
  /** For tests and proxies. */
  fetch?: typeof fetch;
}

const MAX_BATCH_SIZE = 2048;

/**
 * Embeddings from OpenAI's API, with `fetch` only. Rate limits and server
 * errors are retried twice, waiting as long as `retry-after` says (or 1s, then
 * 2s).
 */
export function openaiEmbedder(options: OpenAIEmbedderOptions): Embedder {
  const model = options.model ?? 'text-embedding-3-small';
  const dimensions = options.dimensions ?? 1024;
  const baseUrl = (options.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '');
  const batchSize = batchSizeFor(options.batchSize, 128, MAX_BATCH_SIZE);
  const send = options.fetch ?? fetch;
  const shortens = model.startsWith('text-embedding-3');

  return {
    id: `openai:${model}@${dimensions}`,
    dimensions,
    embed: (texts, _kind, embedOptions = {}) =>
      inBatches(texts, batchSize, async (input) => {
        const response = await postWithRetries(
          'OpenAI',
          send,
          {
            url: `${baseUrl}/embeddings`,
            headers: { authorization: `Bearer ${options.apiKey}` },
            body: { model, input, encoding_format: 'float', ...(shortens ? { dimensions } : {}) },
          },
          embedOptions.signal
        );
        const body = (await response.json()) as { data?: Array<{ index: number; embedding: number[] }> };
        const data = [...(body.data ?? [])].sort((a, b) => a.index - b.index);
        return checkedVectors('OpenAI', model, data.map((item) => item.embedding), input.length, dimensions);
      }),
  };
}
