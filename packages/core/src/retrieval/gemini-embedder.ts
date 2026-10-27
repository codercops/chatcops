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

const MAX_ATTEMPTS = 3;
const MAX_BATCH_SIZE = 100;

/**
 * Embeddings from Google's Gemini API, with `fetch` only. Rate limits and
 * server errors are retried twice, waiting as long as `retry-after` says (or
 * 1s, then 2s).
 */
export function geminiEmbedder(options: GeminiEmbedderOptions): Embedder {
  const rawModel = options.model ?? 'gemini-embedding-001';
  const model = rawModel.replace(/^models\//, '');
  const dimensions = options.dimensions ?? 1024;
  const baseUrl = (options.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');
  const batchSize = Math.min(Math.max(Math.floor(options.batchSize ?? 100) || 1, 1), MAX_BATCH_SIZE);
  const send = options.fetch ?? fetch;

  async function request(input: string[], kind: 'document' | 'query', signal?: AbortSignal): Promise<Float32Array[]> {
    const taskType = kind === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT';
    for (let attempt = 1; ; attempt++) {
      const response = await send(`${baseUrl}/models/${model}:batchEmbedContents`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': options.apiKey },
        body: JSON.stringify({
          requests: input.map((text) => ({
            model: `models/${model}`,
            content: { parts: [{ text }] },
            taskType,
            outputDimensionality: dimensions,
          })),
        }),
        signal,
      });
      if (response.ok) {
        const body = (await response.json()) as { embeddings?: Array<{ values: number[] }> };
        const data = body.embeddings ?? [];
        if (data.length !== input.length) {
          throw new Error(`Gemini returned ${data.length} embeddings for ${input.length} texts.`);
        }
        return data.map(({ values }) => {
          if (values.length !== dimensions) {
            throw new Error(`Gemini returned ${values.length} dimensions from ${model}, but the embedder is set to ${dimensions}.`);
          }
          return Float32Array.from(values);
        });
      }
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt >= MAX_ATTEMPTS) {
        // The body explains the error and never holds the key.
        const detail = (await response.text().catch(() => '')).slice(0, 300);
        throw new Error(`Gemini embeddings failed with HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
      }
      const wait = Number(response.headers.get('retry-after'));
      await sleep(Number.isFinite(wait) && wait > 0 ? Math.min(wait, 30) * 1000 : 1000 * attempt, signal);
    }
  }

  return {
    id: `gemini:${model}@${dimensions}`,
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
