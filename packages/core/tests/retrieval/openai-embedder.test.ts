import { afterEach, describe, expect, it, vi } from 'vitest';
import { memoryVectors, openaiEmbedder } from '../../src/index.js';
import { replayFetch } from '../helpers/replay-fetch.js';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const embeddings = (vectors: number[][], order = vectors.map((_, i) => i)) => ({
  data: order.map((index) => ({ index, embedding: vectors[index] })),
});

afterEach(() => {
  vi.useRealTimers();
});

describe('openaiEmbedder', () => {
  it('embeds documents and a query from a recorded response, and the query finds its document', async () => {
    const replay = replayFetch('openai-embeddings', 'basic');
    const embedder = openaiEmbedder({ apiKey: 'test', dimensions: 8, fetch: replay.fetch });
    expect(embedder).toMatchObject({ id: 'openai:text-embedding-3-small@8', dimensions: 8 });

    const docs = await embedder.embed(['The Team plan costs $20 a month.', 'Our office is in Lisbon.'], 'document');
    const [query] = await embedder.embed(['How much is the Team plan?'], 'query');
    expect(replay.requests).toEqual(replay.recordedRequests);
    expect(docs.map((v) => v.length)).toEqual([8, 8]);
    expect(docs[0]).toBeInstanceOf(Float32Array);

    const store = memoryVectors({ dimensions: 8 });
    await store.upsert(
      docs.map((vector, i) => ({ id: `d${i}`, vector, text: `doc ${i}`, source: { id: 'p', url: 'https://example.test/' } }))
    );
    const [best] = await store.query({ vector: query, topK: 1 });
    expect(best.id).toBe('d0');
  });

  it('sends the key, model and size, and splits large inputs into batches in order', async () => {
    const send = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const input = JSON.parse(String(init?.body)).input as string[];
      // Answer out of order: the embedder sorts by index.
      return json(embeddings(input.map((text) => [Number(text), 0, 0]), input.map((_, i) => input.length - 1 - i)));
    });
    const embedder = openaiEmbedder({ apiKey: 'sk-test', dimensions: 3, batchSize: 2, baseUrl: 'https://proxy.test/v1/', fetch: send });
    const vectors = await embedder.embed(['1', '2', '3', '4', '5'], 'document');

    expect(vectors.map((v) => v[0])).toEqual([1, 2, 3, 4, 5]);
    expect(send).toHaveBeenCalledTimes(3);
    const [url, init] = send.mock.calls[0];
    expect(url).toBe('https://proxy.test/v1/embeddings');
    expect((init?.headers as Record<string, string> | undefined)?.authorization).toBe('Bearer sk-test');
    expect(JSON.parse(String(init?.body))).toEqual({ model: 'text-embedding-3-small', input: ['1', '2'], encoding_format: 'float', dimensions: 3 });
  });

  it.each([
    [0, 1],
    [-3, 1],
    [2.7, 2],
    [5000, 2048],
  ])('keeps batchSize %s to %s texts per request, so a bad value never stalls or overflows', async (batchSize, expected) => {
    const sizes: number[] = [];
    const send = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const input = JSON.parse(String(init?.body)).input as string[];
      sizes.push(input.length);
      return json(embeddings(input.map(() => [1])));
    });
    const texts = Array.from({ length: Math.max(expected, 2) * 2 + 1 }, (_, i) => `t${i}`);
    await openaiEmbedder({ apiKey: 'k', dimensions: 1, batchSize, fetch: send }).embed(texts, 'document');
    expect(Math.max(...sizes)).toBe(expected);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(texts.length);
  });

  it("doesn't ask older models for a size, and makes no request for no texts", async () => {
    const send = vi.fn(async () => json(embeddings([[1, 2]])));
    const embedder = openaiEmbedder({ apiKey: 'k', model: 'text-embedding-ada-002', dimensions: 2, fetch: send });
    expect(await embedder.embed([], 'query')).toEqual([]);
    expect(send).not.toHaveBeenCalled();
    await embedder.embed(['x'], 'query');
    expect(JSON.parse(String((send.mock.calls[0] as unknown as [string, RequestInit])[1].body))).not.toHaveProperty('dimensions');
  });

  it('fails clearly on the wrong length or count', async () => {
    const wrongLength = openaiEmbedder({ apiKey: 'k', dimensions: 3, fetch: async () => json(embeddings([[1, 2]])) });
    await expect(wrongLength.embed(['x'], 'query')).rejects.toThrow('returned 2 dimensions from text-embedding-3-small, but the embedder is set to 3');
    const wrongCount = openaiEmbedder({ apiKey: 'k', dimensions: 2, fetch: async () => json(embeddings([[1, 2]])) });
    await expect(wrongCount.embed(['x', 'y'], 'query')).rejects.toThrow('returned 1 embeddings for 2 texts');
  });

  it('reports a client error at once, with what the API said', async () => {
    const send = vi.fn(async () => json({ error: { message: 'Invalid model' } }, 400));
    const embedder = openaiEmbedder({ apiKey: 'k', fetch: send });
    await expect(embedder.embed(['x'], 'query')).rejects.toThrow('HTTP 400: {"error":{"message":"Invalid model"}}');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('retries rate limits and server errors, waiting as retry-after says', async () => {
    vi.useFakeTimers();
    const send = vi
      .fn()
      .mockResolvedValueOnce(json({}, 429, { 'retry-after': '2' }))
      .mockResolvedValueOnce(json({}, 503))
      .mockResolvedValueOnce(json(embeddings([[1, 0]])));
    const embedder = openaiEmbedder({ apiKey: 'k', dimensions: 2, fetch: send });
    const result = embedder.embed(['x'], 'query');

    await vi.advanceTimersByTimeAsync(1999);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(2);
    // No retry-after on the 503: 2s for the second attempt.
    await vi.advanceTimersByTimeAsync(2000);
    expect((await result)[0][0]).toBe(1);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('gives up after three attempts', async () => {
    vi.useFakeTimers();
    const send = vi.fn(async () => json({ error: 'busy' }, 500));
    const embedder = openaiEmbedder({ apiKey: 'k', fetch: send });
    const result = embedder.embed(['x'], 'query').catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(String(await result)).toContain('HTTP 500');
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('stops waiting to retry when the signal aborts', async () => {
    const send = vi.fn(async () => json({}, 429, { 'retry-after': '30' }));
    const embedder = openaiEmbedder({ apiKey: 'k', fetch: send });
    const controller = new AbortController();
    const result = embedder.embed(['x'], 'query', { signal: controller.signal });
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    controller.abort(new Error('visitor left'));
    await expect(result).rejects.toThrow('visitor left');
  });
});
