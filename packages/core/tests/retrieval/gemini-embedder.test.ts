import { afterEach, describe, expect, it, vi } from 'vitest';
import { geminiEmbedder, memoryVectors } from '../../src/index.js';
import { replayFetch } from '../helpers/replay-fetch.js';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const embeddings = (vectors: number[][]) => ({
  embeddings: vectors.map((values) => ({ values })),
});

afterEach(() => {
  vi.useRealTimers();
});

describe('geminiEmbedder', () => {
  it('embeds documents and a query from a recorded response, and the query finds its document', async () => {
    const replay = replayFetch('gemini-embeddings', 'basic');
    const embedder = geminiEmbedder({ apiKey: 'test', dimensions: 8, fetch: replay.fetch });
    expect(embedder).toMatchObject({ id: 'gemini:gemini-embedding-001@8', dimensions: 8 });

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

  it('sends the key, model, task type and size, and splits large inputs into batches in order', async () => {
    const send = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const requests = (JSON.parse(String(init?.body)).requests as Array<{ content: { parts: Array<{ text: string }> } }>);
      return json(embeddings(requests.map((r) => [Number(r.content.parts[0].text), 0, 0])));
    });
    const embedder = geminiEmbedder({
      apiKey: 'gm-test',
      dimensions: 3,
      batchSize: 2,
      baseUrl: 'https://proxy.test/v1beta/',
      fetch: send,
    });
    const vectors = await embedder.embed(['1', '2', '3', '4', '5'], 'document');

    expect(vectors.map((v) => v[0])).toEqual([1, 2, 3, 4, 5]);
    expect(send).toHaveBeenCalledTimes(3);
    const [url, init] = send.mock.calls[0];
    expect(url).toBe('https://proxy.test/v1beta/models/gemini-embedding-001:batchEmbedContents');
    expect((init?.headers as Record<string, string> | undefined)?.['x-goog-api-key']).toBe('gm-test');
    expect(JSON.parse(String(init?.body))).toEqual({
      requests: [
        {
          model: 'models/gemini-embedding-001',
          content: { parts: [{ text: '1' }] },
          taskType: 'RETRIEVAL_DOCUMENT',
          outputDimensionality: 3,
        },
        {
          model: 'models/gemini-embedding-001',
          content: { parts: [{ text: '2' }] },
          taskType: 'RETRIEVAL_DOCUMENT',
          outputDimensionality: 3,
        },
      ],
    });

    await embedder.embed(['question'], 'query');
    const [, queryInit] = send.mock.calls[3];
    expect(JSON.parse(String(queryInit?.body)).requests[0].taskType).toBe('RETRIEVAL_QUERY');
  });

  it.each([
    [0, 1],
    [500, 100],
  ])('with batchSize %s clamps to at most %s texts in a request', async (batchSize, expected) => {
    const send = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const requests = JSON.parse(String(init?.body)).requests as unknown[];
      return json(embeddings(requests.map(() => [1])));
    });
    const texts = Array.from({ length: 101 }, (_, i) => String(i));
    await geminiEmbedder({ apiKey: 'k', dimensions: 1, batchSize, fetch: send }).embed(texts, 'document');
    expect(Math.max(...send.mock.calls.map((call) => (JSON.parse(String(call[1]?.body)).requests as unknown[]).length))).toBe(expected);
  });

  it('makes no request for no texts, and accepts model with models/ prefix', async () => {
    const send = vi.fn(async () => json(embeddings([[1, 2]])));
    const embedder = geminiEmbedder({ apiKey: 'k', model: 'models/gemini-embedding-001', dimensions: 2, fetch: send });
    expect(embedder).toMatchObject({ id: 'gemini:gemini-embedding-001@2', dimensions: 2 });
    expect(await embedder.embed([], 'query')).toEqual([]);
    expect(send).not.toHaveBeenCalled();
    await embedder.embed(['x'], 'query');
    expect((send.mock.calls[0] as unknown as [string, RequestInit])[0]).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents'
    );
  });

  it('fails clearly on the wrong length or count', async () => {
    const wrongLength = geminiEmbedder({ apiKey: 'k', dimensions: 3, fetch: async () => json(embeddings([[1, 2]])) });
    await expect(wrongLength.embed(['x'], 'query')).rejects.toThrow(
      'Gemini returned 2 dimensions from gemini-embedding-001, but the embedder is set to 3.'
    );
    const wrongCount = geminiEmbedder({ apiKey: 'k', dimensions: 2, fetch: async () => json(embeddings([[1, 2]])) });
    await expect(wrongCount.embed(['x', 'y'], 'query')).rejects.toThrow('Gemini returned 1 embeddings for 2 texts.');
  });

  it('reports a client error at once, with what the API said', async () => {
    const send = vi.fn(async () => json({ error: { message: 'Invalid model' } }, 400));
    const embedder = geminiEmbedder({ apiKey: 'k', fetch: send });
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
    const embedder = geminiEmbedder({ apiKey: 'k', dimensions: 2, fetch: send });
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
    const embedder = geminiEmbedder({ apiKey: 'k', fetch: send });
    const result = embedder.embed(['x'], 'query').catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(String(await result)).toContain('HTTP 500');
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('stops waiting to retry when the signal aborts', async () => {
    const send = vi.fn(async () => json({}, 429, { 'retry-after': '30' }));
    const embedder = geminiEmbedder({ apiKey: 'k', fetch: send });
    const controller = new AbortController();
    const result = embedder.embed(['x'], 'query', { signal: controller.signal });
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    controller.abort(new Error('visitor left'));
    await expect(result).rejects.toThrow('visitor left');
  });

  it('uses default model and dimensions when not specified', async () => {
    const embedder = geminiEmbedder({ apiKey: 'k' });
    expect(embedder).toMatchObject({ id: 'gemini:gemini-embedding-001@1024', dimensions: 1024 });
  });

  it('handles response without embeddings field and already aborted signal', async () => {
    const send = vi.fn(async () => json({}));
    const embedder = geminiEmbedder({ apiKey: 'k', dimensions: 2, fetch: send });
    await expect(embedder.embed(['x'], 'query')).rejects.toThrow('Gemini returned 0 embeddings for 1 texts.');

    const failSend = vi.fn(async () => json({}, 429));
    const retryEmbedder = geminiEmbedder({ apiKey: 'k', fetch: failSend });
    const controller = new AbortController();
    controller.abort(new Error('aborted immediately'));
    await expect(retryEmbedder.embed(['x'], 'query', { signal: controller.signal })).rejects.toThrow(
      'aborted immediately'
    );
  });
});
