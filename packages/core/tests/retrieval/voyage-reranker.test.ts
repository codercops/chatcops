import { afterEach, describe, expect, it, vi } from 'vitest';
import { hybridRetriever, memoryVectors, voyageReranker, type Embedder, type RetrievedChunk } from '../../src/index.js';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const chunks: RetrievedChunk[] = [
  { id: 'a', text: 'First document', score: 0.2, source: { id: 'docs', url: 'https://example.test/a' } },
  { id: 'b', text: 'Second document', score: 0.1, source: { id: 'docs', url: 'https://example.test/b' }, metadata: { kind: 'guide' } },
  { id: 'c', text: 'Third document', score: 0.05, source: { id: 'docs', url: 'https://example.test/c' } },
];

afterEach(() => vi.useRealTimers());

describe('voyageReranker', () => {
  it('sends Voyage rerank request data and maps the ordered response indexes and relevance scores', async () => {
    const send = vi.fn(async () => json({ object: 'list', data: [{ index: 2, relevance_score: 0.91 }, { index: 0, relevance_score: 0.72 }] }));
    const reranker = voyageReranker({ apiKey: 'test-key', model: 'rerank-3-lite', baseUrl: 'https://proxy.test/v1/', fetch: send });

    const result = await reranker.rerank('question', chunks, 2);

    expect(send).toHaveBeenCalledTimes(1);
    const [url, init] = send.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://proxy.test/v1/rerank');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ authorization: 'Bearer test-key', 'content-type': 'application/json' });
    expect(JSON.parse(String(init.body))).toEqual({ query: 'question', documents: chunks.map((chunk) => chunk.text), model: 'rerank-3-lite', top_k: 2 });
    expect(result).toEqual([
      { ...chunks[2], score: 0.91 },
      { ...chunks[0], score: 0.72 },
    ]);
  });

  it('uses rerank-3 by default and caps top_k to the requested number and available documents', async () => {
    const send = vi.fn(async () => json({ object: 'list', data: [{ index: 1, relevance_score: 0.8 }] }));
    const reranker = voyageReranker({ apiKey: 'k', fetch: send });
    await reranker.rerank('q', chunks.slice(0, 2), 1);
    expect(JSON.parse(String((send.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toMatchObject({ model: 'rerank-3', top_k: 1 });
  });

  it('returns no results and makes no request for empty candidates or a non-positive topN', async () => {
    const send = vi.fn(async () => json({ object: 'list', data: [] }));
    const reranker = voyageReranker({ apiKey: 'k', fetch: send });
    expect(await reranker.rerank('q', [], 3)).toEqual([]);
    expect(await reranker.rerank('q', chunks, 0)).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });

  it('surfaces client API errors without retrying', async () => {
    const send = vi.fn(async () => json({ detail: 'Provided model is not supported.' }, 400));
    const reranker = voyageReranker({ apiKey: 'k', fetch: send });
    await expect(reranker.rerank('q', chunks, 1)).rejects.toThrow(
      'Voyage rerank failed with HTTP 400: {"detail":"Provided model is not supported."}'
    );
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('retries rate limits and server errors through the shared HTTP helper', async () => {
    vi.useFakeTimers();
    const send = vi
      .fn()
      .mockResolvedValueOnce(json({}, 429, { 'retry-after': '2' }))
      .mockResolvedValueOnce(json({}, 503))
      .mockResolvedValueOnce(json({ object: 'list', data: [{ index: 0, relevance_score: 1 }] }));
    const reranker = voyageReranker({ apiKey: 'k', fetch: send });
    const result = reranker.rerank('q', chunks, 1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(send).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect((await result)[0].id).toBe('a');
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('rejects malformed result data and indexes outside the submitted documents', async () => {
    const malformed = voyageReranker({ apiKey: 'k', fetch: async () => json({ object: 'list' }) });
    await expect(malformed.rerank('q', chunks, 2)).rejects.toThrow('data must be an array');
    const invalidIndex = voyageReranker({ apiKey: 'k', fetch: async () => json({ object: 'list', data: [{ index: 9, relevance_score: 0.2 }] }) });
    await expect(invalidIndex.rerank('q', chunks, 2)).rejects.toThrow('invalid rerank result');
  });

  it('passes the abort signal to fetch and stops retry waiting when aborted', async () => {
    const send = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.signal).toBeDefined();
      return json({}, 429, { 'retry-after': '30' });
    });
    const controller = new AbortController();
    const reranker = voyageReranker({ apiKey: 'k', fetch: send });
    const result = reranker.rerank('q', chunks, 1, { signal: controller.signal });
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    controller.abort(new Error('request cancelled'));
    await expect(result).rejects.toThrow('request cancelled');
  });

  it('reranks real hybridRetriever results with Voyage order and scores', async () => {
    const documents = [
      { id: 'alpha', text: 'Refund order support: first answer.', source: { id: 'a', url: 'https://example.test/a' } },
      { id: 'bravo', text: 'Refund order support: second answer.', source: { id: 'b', url: 'https://example.test/b' } },
      { id: 'charlie', text: 'Refund order support: third answer.', source: { id: 'c', url: 'https://example.test/c' } },
    ];
    const embedder: Embedder = {
      id: 'test:constant@2',
      dimensions: 2,
      async embed(texts) {
        return texts.map(() => Float32Array.from([1, 0]));
      },
    };
    const store = memoryVectors({ dimensions: embedder.dimensions });
    await store.upsert(
      documents.map((document) => ({
        ...document,
        vector: Float32Array.from([1, 0]),
      }))
    );
    const query = 'refund order support';
    const initial = await hybridRetriever({ store, embedder, candidates: 3 }).retrieve({ text: query, topK: 3 });
    expect(initial).toHaveLength(3);
    const scores = [0.97, 0.82, 0.64];
    const send = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const { documents: sentDocuments } = JSON.parse(String(init?.body)) as { documents: string[] };
      expect(sentDocuments).toEqual(initial.map((chunk) => chunk.text));
      return json({
        object: 'list',
        data: [
          { index: 2, relevance_score: scores[0] },
          { index: 0, relevance_score: scores[1] },
          { index: 1, relevance_score: scores[2] },
        ],
      });
    });
    const retriever = hybridRetriever({
      store,
      embedder,
      candidates: 3,
      reranker: voyageReranker({ apiKey: 'test-key', fetch: send }),
    });

    const reranked = await retriever.retrieve({ text: query, topK: 3 });

    expect(send).toHaveBeenCalledTimes(1);
    expect(initial.map((chunk) => chunk.id)).not.toEqual([initial[2].id, initial[0].id, initial[1].id]);
    expect(reranked.map((chunk) => chunk.id)).toEqual([initial[2].id, initial[0].id, initial[1].id]);
    expect(reranked.map((chunk) => chunk.score)).toEqual(scores);
  });
});
