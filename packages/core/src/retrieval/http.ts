const MAX_ATTEMPTS = 3;

export interface JsonPost {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

/**
 * POSTs JSON for an embedding API and returns the successful response. Rate
 * limits (429) and server errors (5xx) are retried twice, waiting as long as
 * `retry-after` says (at most 30s), or 1s then 2s; the abort signal stops a
 * wait. Anything else fails at once with the start of the response body,
 * which explains the error and never holds the key.
 */
export async function postWithRetries(provider: string, send: typeof fetch, post: JsonPost, signal?: AbortSignal): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    const response = await send(post.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...post.headers },
      body: JSON.stringify(post.body),
      signal,
    });
    if (response.ok) return response;
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt >= MAX_ATTEMPTS) {
      const detail = (await response.text().catch(() => '')).slice(0, 300);
      throw new Error(`${provider} embeddings failed with HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
    }
    const wait = Number(response.headers.get('retry-after'));
    await sleep(Number.isFinite(wait) && wait > 0 ? Math.min(wait, 30) * 1000 : 1000 * attempt, signal);
  }
}

/** A whole number of texts per request, from 1 to what the API accepts. */
export function batchSizeFor(value: number | undefined, fallback: number, max: number): number {
  return Math.min(Math.max(Math.floor(value ?? fallback) || 1, 1), max);
}

/** Runs `request` over `texts` in batches, keeping the order. */
export async function inBatches(texts: string[], size: number, request: (batch: string[]) => Promise<Float32Array[]>): Promise<Float32Array[]> {
  const vectors: Float32Array[] = [];
  for (let start = 0; start < texts.length; start += size) {
    vectors.push(...(await request(texts.slice(start, start + size))));
  }
  return vectors;
}

/** The vectors from a response, checked against the texts sent and the expected size. */
export function checkedVectors(provider: string, model: string, vectors: number[][], texts: number, dimensions: number): Float32Array[] {
  if (vectors.length !== texts) {
    throw new Error(`${provider} returned ${vectors.length} embeddings for ${texts} texts.`);
  }
  return vectors.map((values) => {
    if (values.length !== dimensions) {
      throw new Error(`${provider} returned ${values.length} dimensions from ${model}, but the embedder is set to ${dimensions}.`);
    }
    return Float32Array.from(values);
  });
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
