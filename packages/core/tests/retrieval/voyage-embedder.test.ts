import { afterEach, describe, expect, it, vi } from 'vitest';
import { memoryVectors, voyageEmbedder } from '../../src/index.js';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
// Voyage answers `{ object: 'list', data: [{ object: 'embedding', embedding, index }], model, usage }`.
const embeddings = (vectors: number[][], order = vectors.map((_, i) => i)) => ({
  object: 'list',
  data: order.map((index) => ({ object: 'embedding', embedding: vectors[index], index })),
  model: 'voyage-4-large',
  usage: { total_tokens: 8 },
});
const bodyOf = (call: unknown[]) => JSON.parse(String((call[1] as RequestInit).body));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('voyageEmbedder', () => {
  it('names its model and size, and defaults to voyage-4-large at 1024', () => {
    expect(voyageEmbedder({ apiKey: 'k' })).toMatchObject({ id: 'voyage:voyage-4-large@1024', dimensions: 1024 });
    expect(voyageEmbedder({ apiKey: 'k', model: 'voyage-3.5-lite', dimensions: 512 })).toMatchObject({
      id: 'voyage:voyage-3.5-lite@512',
      dimensions: 512,
    });
  });

  it('embeds documents and a query, and the query finds its document', async () => {
    // The first call is the documents, the second the query: the query sits closest to the first document.
    const send = vi
      .fn()
      .mockResolvedValueOnce(json(embeddings([[1, 0, 0], [0, 1, 0]])))
      .mockResolvedValueOnce(json(embeddings([[0.9, 0.1, 0]])));
    const embedder = voyageEmbedder({ apiKey: 'test', dimensions: 3, model: 'voyage-4', fetch: send });

    const docs = await embedder.embed(['The Team plan costs $20 a month.', 'Our office is in Lisbon.'], 'document');
    const [query] = await embedder.embed(['How much is the Team plan?'], 'query');
    expect(docs.map((v) => v.length)).toEqual([3, 3]);
    expect(docs[0]).toBeInstanceOf(Float32Array);

    const store = memoryVectors({ dimensions: 3 });
    await store.upsert(docs.map((vector, i) => ({ id: `d${i}`, vector, text: `doc ${i}`, source: { id: 'p', url: 'https://example.test/' } })));
    const [best] = await store.query({ vector: query, topK: 1 });
    expect(best.id).toBe('d0');
  });

  it('sends the key, the model, the texts and what kind of text it is', async () => {
    const send = vi.fn(async () => json(embeddings([[1, 0, 0]])));
    const embedder = voyageEmbedder({ apiKey: 'pa-test', dimensions: 3, baseUrl: 'https://proxy.test/v1/', fetch: send });

    await embedder.embed(['a document'], 'document');
    await embedder.embed(['a question'], 'query');

    const [url, init] = send.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://proxy.test/v1/embeddings');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'content-type': 'application/json', authorization: 'Bearer pa-test' });
    expect(bodyOf(send.mock.calls[0])).toEqual({ model: 'voyage-4-large', input: ['a document'], input_type: 'document', output_dimension: 3 });
    expect(bodyOf(send.mock.calls[1])).toEqual({ model: 'voyage-4-large', input: ['a question'], input_type: 'query', output_dimension: 3 });
  });

  it('uses https://api.voyageai.com/v1 and the global fetch when told nothing else', async () => {
    const send = vi.fn(async () => json(embeddings([[...Array(1024).fill(0)]])));
    vi.stubGlobal('fetch', send);
    await voyageEmbedder({ apiKey: 'k' }).embed(['x'], 'query');
    expect((send.mock.calls[0] as unknown as [string])[0]).toBe('https://api.voyageai.com/v1/embeddings');
  });

  it.each([
    ['voyage-4-large', true],
    ['voyage-4', true],
    ['voyage-4-lite', true],
    ['voyage-3.5', true],
    ['voyage-3.5-lite', true],
    ['voyage-3-large', true],
    ['voyage-code-3', true],
    ['voyage-finance-2', false],
    ['voyage-law-2', false],
    ['voyage-multilingual-2', false],
    ['voyage-3', false],
    ['voyage-3-lite', false],
    ['voyage-code-2', false],
    // Only these exact model names: a name that merely starts like one does not count.
    ['voyage-40', false],
    ['voyage-3.55', false],
    ['voyage-code-30', false],
    ['voyage-4-large-2026', true],
  ])('%s: asks for a size = %s', async (model, shortens) => {
    const send = vi.fn(async () => json(embeddings([[1, 2]])));
    await voyageEmbedder({ apiKey: 'k', model, dimensions: 2, fetch: send }).embed(['x'], 'document');
    const body = bodyOf(send.mock.calls[0]);
    if (shortens) expect(body.output_dimension).toBe(2);
    else expect(body).not.toHaveProperty('output_dimension');
  });

  it('makes no request for no texts', async () => {
    const send = vi.fn(async () => json(embeddings([[1, 2]])));
    expect(await voyageEmbedder({ apiKey: 'k', dimensions: 2, fetch: send }).embed([], 'query')).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });

  it('splits large inputs into batches in order, with the same kind in each', async () => {
    const send = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const input = JSON.parse(String(init?.body)).input as string[];
      // Answer out of order: the embedder sorts by index.
      return json(embeddings(input.map((text) => [Number(text), 0, 0]), input.map((_, i) => input.length - 1 - i)));
    });
    const embedder = voyageEmbedder({ apiKey: 'k', dimensions: 3, batchSize: 2, fetch: send });
    const vectors = await embedder.embed(['1', '2', '3', '4', '5'], 'document');

    expect(vectors.map((v) => v[0])).toEqual([1, 2, 3, 4, 5]);
    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls.map((call) => bodyOf(call).input)).toEqual([['1', '2'], ['3', '4'], ['5']]);
    expect(send.mock.calls.every((call) => bodyOf(call).input_type === 'document')).toBe(true);
  });

  it.each([
    [undefined, 128],
    [10, 10],
    [2.7, 2],
    [5000, 1000],
    [Infinity, 1000],
    [0, 1],
    [-3, 1],
    [Number.NaN, 1],
  ])('with batchSize %s puts at most %s texts in a request, and always moves on', async (batchSize, expected) => {
    const send = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const input = JSON.parse(String(init?.body)).input as string[];
      return json(embeddings(input.map(() => [1])));
    });
    // More texts than one batch, so a batch that is too big would show.
    const texts = Array.from({ length: Math.min(Math.max(expected + 1, 8), 1001) }, (_, i) => String(i));
    await voyageEmbedder({ apiKey: 'k', dimensions: 1, batchSize, fetch: send }).embed(texts, 'document');
    expect(Math.max(...send.mock.calls.map((call) => bodyOf(call).input.length))).toBe(expected);
  });

  it('fails clearly on the wrong length or count', async () => {
    const wrongLength = voyageEmbedder({ apiKey: 'k', dimensions: 3, fetch: async () => json(embeddings([[1, 2]])) });
    await expect(wrongLength.embed(['x'], 'query')).rejects.toThrow('returned 2 dimensions from voyage-4-large, but the embedder is set to 3');
    const wrongCount = voyageEmbedder({ apiKey: 'k', dimensions: 2, fetch: async () => json(embeddings([[1, 2]])) });
    await expect(wrongCount.embed(['x', 'y'], 'query')).rejects.toThrow('returned 1 embeddings for 2 texts');
    const noData = voyageEmbedder({ apiKey: 'k', dimensions: 2, fetch: async () => json({}) });
    await expect(noData.embed(['x'], 'query')).rejects.toThrow('returned 0 embeddings for 1 texts');
  });

  it('asks you to set the length of a model that has one fixed length', async () => {
    // voyage-law-2 makes 1024 numbers whatever it is asked for, so a size of 256 can never match.
    const embedder = voyageEmbedder({ apiKey: 'k', model: 'voyage-law-2', dimensions: 256, fetch: async () => json(embeddings([Array(1024).fill(0)])) });
    await expect(embedder.embed(['x'], 'document')).rejects.toThrow('returned 1024 dimensions from voyage-law-2, but the embedder is set to 256');
  });

  it('reports a client error at once, with what Voyage said', async () => {
    const send = vi.fn(async () => json({ detail: 'Provided model is not supported.' }, 400));
    const embedder = voyageEmbedder({ apiKey: 'k', fetch: send });
    await expect(embedder.embed(['x'], 'query')).rejects.toThrow('Voyage embeddings failed with HTTP 400: {"detail":"Provided model is not supported."}');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('cuts a long error body and never includes the key', async () => {
    const send = vi.fn(async () => new Response('x'.repeat(1000), { status: 401 }));
    const error = await voyageEmbedder({ apiKey: 'pa-secret-key', fetch: send }).embed(['x'], 'query').catch((e: Error) => e);
    expect((error as Error).message.length).toBeLessThan(400);
    expect((error as Error).message).not.toContain('pa-secret-key');
  });

  it('reports an error with no body, and one whose body cannot be read', async () => {
    const empty = voyageEmbedder({ apiKey: 'k', fetch: async () => new Response(null, { status: 403 }) });
    await expect(empty.embed(['x'], 'query')).rejects.toThrow(/^Voyage embeddings failed with HTTP 403$/);
    const unreadable = voyageEmbedder({
      apiKey: 'k',
      fetch: async () => ({ ok: false, status: 400, text: () => Promise.reject(new Error('stream broke')), headers: new Headers() }) as unknown as Response,
    });
    await expect(unreadable.embed(['x'], 'query')).rejects.toThrow(/^Voyage embeddings failed with HTTP 400$/);
  });

  it('retries rate limits and server errors, waiting as retry-after says', async () => {
    vi.useFakeTimers();
    const send = vi
      .fn()
      .mockResolvedValueOnce(json({}, 429, { 'retry-after': '2' }))
      .mockResolvedValueOnce(json({}, 503))
      .mockResolvedValueOnce(json(embeddings([[1, 0]])));
    const embedder = voyageEmbedder({ apiKey: 'k', dimensions: 2, model: 'voyage-4', fetch: send });
    const result = embedder.embed(['x'], 'query');

    await vi.advanceTimersByTimeAsync(1999);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(2);
    // No retry-after on the 503: 2s for the second attempt.
    await vi.advanceTimersByTimeAsync(1999);
    expect(send).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect((await result)[0][0]).toBe(1);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('waits 1s after the first failure when there is no retry-after, and never longer than 30s', async () => {
    vi.useFakeTimers();
    const send = vi.fn().mockResolvedValueOnce(json({}, 500)).mockResolvedValueOnce(json({}, 429, { 'retry-after': '600' })).mockResolvedValueOnce(json(embeddings([[1]])));
    const result = voyageEmbedder({ apiKey: 'k', dimensions: 1, fetch: send }).embed(['x'], 'query');
    await vi.advanceTimersByTimeAsync(999);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(send).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect((await result)[0][0]).toBe(1);
  });

  it('gives up after three attempts', async () => {
    vi.useFakeTimers();
    const send = vi.fn(async () => json({ detail: 'busy' }, 500));
    const embedder = voyageEmbedder({ apiKey: 'k', fetch: send });
    const result = embedder.embed(['x'], 'query').catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(String(await result)).toContain('HTTP 500');
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('does not retry other client errors', async () => {
    for (const status of [401, 403, 422]) {
      const send = vi.fn(async () => json({ detail: 'no' }, status));
      await expect(voyageEmbedder({ apiKey: 'k', fetch: send }).embed(['x'], 'query')).rejects.toThrow(`HTTP ${status}`);
      expect(send).toHaveBeenCalledTimes(1);
    }
  });

  it('passes the abort signal to fetch, and stops waiting to retry when it aborts', async () => {
    const send = vi.fn(async () => json({}, 429, { 'retry-after': '30' }));
    const embedder = voyageEmbedder({ apiKey: 'k', fetch: send });
    const controller = new AbortController();
    const result = embedder.embed(['x'], 'query', { signal: controller.signal });
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect((send.mock.calls[0] as unknown as [string, RequestInit])[1].signal).toBe(controller.signal);
    controller.abort(new Error('visitor left'));
    await expect(result).rejects.toThrow('visitor left');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('does not start waiting when the signal has already aborted', async () => {
    const send = vi.fn(async () => json({}, 503));
    const controller = new AbortController();
    controller.abort(new Error('already gone'));
    await expect(voyageEmbedder({ apiKey: 'k', fetch: send }).embed(['x'], 'query', { signal: controller.signal })).rejects.toThrow('already gone');
  });
});
