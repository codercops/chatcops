import { batchSizeFor, checkedVectors, inBatches, postWithRetries } from './http.js';
import type { Embedder } from './types.js';

export interface VoyageEmbedderOptions {
  apiKey: string;
  /** Default `voyage-4-large`. */
  model?: string;
  /**
   * Vector length. Default 1024, which every planned store can index and every
   * current Voyage model can produce. Only the models that take
   * `output_dimension` (`voyage-4`, `voyage-4-large`, `voyage-4-lite`,
   * `voyage-3.5`, `voyage-3.5-lite`, `voyage-3-large` and `voyage-code-3`) can
   * change it, to 256, 512, 1024 or 2048. For any other model, set the model's
   * own length.
   */
  dimensions?: number;
  /** Default `https://api.voyageai.com/v1`, or a proxy for it. */
  baseUrl?: string;
  /**
   * Texts per request. Default 128, and at most 1000, which is what Voyage
   * accepts. Every model also limits the tokens in one request (120,000 for
   * `voyage-4-large`), so lower this for very long texts.
   */
  batchSize?: number;
  /** For tests and proxies. */
  fetch?: typeof fetch;
}

const MAX_BATCH_SIZE = 1000;
// The models whose docs list `output_dimension`. The others make one fixed length.
const SHORTENABLE = /^voyage-(?:4|3\.5|3-large|code-3)(?:-|$)/;

/**
 * Embeddings from Voyage AI's API, with `fetch` only. Queries and documents are
 * embedded differently (`input_type`), so `kind` is sent on. Rate limits and
 * server errors are retried twice, waiting as long as `retry-after` says (or
 * 1s, then 2s).
 */
export function voyageEmbedder(options: VoyageEmbedderOptions): Embedder {
  const model = options.model ?? 'voyage-4-large';
  const dimensions = options.dimensions ?? 1024;
  const baseUrl = (options.baseUrl ?? 'https://api.voyageai.com/v1').replace(/\/$/, '');
  const batchSize = batchSizeFor(options.batchSize, 128, MAX_BATCH_SIZE);
  const send = options.fetch ?? fetch;
  const shortens = SHORTENABLE.test(model);

  return {
    id: `voyage:${model}@${dimensions}`,
    dimensions,
    embed: (texts, kind, embedOptions = {}) =>
      inBatches(texts, batchSize, async (input) => {
        const response = await postWithRetries(
          'Voyage',
          send,
          {
            url: `${baseUrl}/embeddings`,
            headers: { authorization: `Bearer ${options.apiKey}` },
            body: { model, input, input_type: kind, ...(shortens ? { output_dimension: dimensions } : {}) },
          },
          embedOptions.signal
        );
        const body = (await response.json()) as { data?: Array<{ index: number; embedding: number[] }> };
        const data = [...(body.data ?? [])].sort((a, b) => a.index - b.index);
        return checkedVectors('Voyage', model, data.map((item) => item.embedding), input.length, dimensions);
      }),
  };
}
