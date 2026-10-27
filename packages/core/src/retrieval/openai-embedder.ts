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
  /** Texts per request. Default 128. */
  batchSize?: number;
  /** For tests and proxies. */
  fetch?: typeof fetch;
}

const MAX_ATTEMPTS = 3;

/**
 * Embeddings from OpenAI's API, with `fetch` only. Rate limits and server
 * errors are retried twice, waiting as long as `retry-after` says (or 1s, then
 * 2s).
 */
export function openaiEmbedder(options: OpenAIEmbedderOptions): Embedder {
  const model = options.model ?? 'text-embedding-3-small';
  const dimensions = options.dimensions ?? 1024;
  const baseUrl = (options.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '');
  const batchSize = options.batchSize ?? 128;
  const send = options.fetch ?? fetch;
  const shortens = model.startsWith('text-embedding-3');

  async function request(input: string[], signal?: AbortSignal): Promise<Float32Array[]> {
    for (let attempt = 1; ; attempt++) {
      const response = await send(`${baseUrl}/embeddings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${options.apiKey}` },
        body: JSON.stringify({ model, input, encoding_format: 'float', ...(shortens ? { dimensions } : {}) }),
        signal,
      });
      if (response.ok) {
        const body = (await response.json()) as { data?: Array<{ index: number; embedding: number[] }> };
        const data = [...(body.data ?? [])].sort((a, b) => a.index - b.index);
        if (data.length !== input.length) {
          throw new Error(`OpenAI returned ${data.length} embeddings for ${input.length} texts.`);
        }
        return data.map(({ embedding }) => {
          if (embedding.length !== dimensions) {
            throw new Error(`OpenAI returned ${embedding.length} dimensions from ${model}, but the embedder is set to ${dimensions}.`);
          }
          return Float32Array.from(embedding);
        });
      }
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt >= MAX_ATTEMPTS) {
        // The body explains the error and never holds the key.
        const detail = (await response.text().catch(() => '')).slice(0, 300);
        throw new Error(`OpenAI embeddings failed with HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
      }
      const wait = Number(response.headers.get('retry-after'));
      await sleep(Number.isFinite(wait) && wait > 0 ? Math.min(wait, 30) * 1000 : 1000 * attempt, signal);
    }
  }

  return {
    id: `openai:${model}@${dimensions}`,
    dimensions,
    async embed(texts, _kind, embedOptions = {}) {
      const vectors: Float32Array[] = [];
      for (let start = 0; start < texts.length; start += batchSize) {
        vectors.push(...(await request(texts.slice(start, start + batchSize), embedOptions.signal)));
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
