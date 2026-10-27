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

const MAX_ATTEMPTS = 3;
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
  const batchSize = Math.min(Math.max(Math.floor(options.batchSize ?? 128) || 1, 1), MAX_BATCH_SIZE);
  const send = options.fetch ?? fetch;
  const shortens = SHORTENABLE.test(model);

  async function request(input: string[], kind: 'document' | 'query', signal?: AbortSignal): Promise<Float32Array[]> {
    for (let attempt = 1; ; attempt++) {
      const response = await send(`${baseUrl}/embeddings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${options.apiKey}` },
        body: JSON.stringify({ model, input, input_type: kind, ...(shortens ? { output_dimension: dimensions } : {}) }),
        signal,
      });
      if (response.ok) {
        const body = (await response.json()) as { data?: Array<{ index: number; embedding: number[] }> };
        const data = [...(body.data ?? [])].sort((a, b) => a.index - b.index);
        if (data.length !== input.length) {
          throw new Error(`Voyage returned ${data.length} embeddings for ${input.length} texts.`);
        }
        return data.map(({ embedding }) => {
          if (embedding.length !== dimensions) {
            throw new Error(`Voyage returned ${embedding.length} dimensions from ${model}, but the embedder is set to ${dimensions}.`);
          }
          return Float32Array.from(embedding);
        });
      }
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt >= MAX_ATTEMPTS) {
        // The body explains the error (`{"detail": "..."}`) and never holds the key.
        const detail = (await response.text().catch(() => '')).slice(0, 300);
        throw new Error(`Voyage embeddings failed with HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
      }
      const wait = Number(response.headers.get('retry-after'));
      await sleep(Number.isFinite(wait) && wait > 0 ? Math.min(wait, 30) * 1000 : 1000 * attempt, signal);
    }
  }

  return {
    id: `voyage:${model}@${dimensions}`,
    dimensions,
    async embed(texts, kind, embedOptions = {}) {
      const vectors: Float32Array[] = [];
      for (let start = 0; start < texts.length; start += batchSize) {
        vectors.push(...(await request(texts.slice(start, start + batchSize), kind, embedOptions.signal)));
      }
      return vectors;
    },
  };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener('abort', abort);
      resolve();
    }
    function abort() {
      clearTimeout(timer);
      reject(signal?.reason);
    }
    signal?.addEventListener('abort', abort, { once: true });
  });
}
