import { afterEach, describe, expect, it, vi } from 'vitest';
import { cohereReranker, type RetrievedChunk } from '../../src/index.js';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const chunks: RetrievedChunk[] = [
  { id: 'a', text: 'First document', score: 0.2, source: { id: 'docs', url: 'https://example.test/a' } },
  { id: 'b', text: 'Second document', score: 0.1, source: { id: 'docs', url: 'https://example.test/b' }, metadata: { kind: 'guide' } },
  { id: 'c', text: 'Third document', score: 0.05, source: { id: 'docs', url: 'https://example.test/c' } },
];

afterEach(() => vi.useRealTimers());

describe('cohereReranker', () => {
  it('sends the query and documents, then maps ranked indexes and relevance scores', async () => {
    const send = vi.fn(async () => json({ results: [{ index: 2, relevance_score: 0.91 }, { index: 0, relevance_score: 0.72 }] }));
    const reranker = cohereReranker({ apiKey: 'test-key', model: 'rerank-v4.0-pro', baseUrl: 'https://proxy.test/v2/', fetch: send });

    const result = await reranker.rerank('question', chunks, 2);

    expect(send).toHaveBeenCalledTimes(1);
    const [url, init] = send.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://proxy.test/v2/rerank');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ authorization: 'Bearer test-key', 'content-type': 'application/json' });
    expect(JSON.parse(String(init.body))).toEqual({ model: 'rerank-v4.0-pro', query: 'question', documents: chunks.map((chunk) => chunk.text), top_n: 2 });
    expect(result).toEqual([
      { ...chunks[2], score: 0.91 },
      { ...chunks[0], score: 0.72 },
    ]);
  });

  it('uses rerank-v5.0-pro by default and asks for no more than available documents', async () => {
    const send = vi.fn(async () => json({ results: [{ index: 1, relevance_score: 0.8 }, { index: 0, relevance_score: 0.4 }] }));
    const reranker = cohereReranker({ apiKey: 'k', fetch: send });
    await reranker.rerank('q', chunks.slice(0, 2), 8);
    expect(JSON.parse(String((send.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toMatchObject({ model: 'rerank-v5.0-pro', top_n: 2 });
  });

  it('returns no results and makes no request for empty candidates or a non-positive topN', async () => {
    const send = vi.fn(async () => json({ results: [] }));
    const reranker = cohereReranker({ apiKey: 'k', fetch: send });
    expect(await reranker.rerank('q', [], 3)).toEqual([]);
    expect(await reranker.rerank('q', chunks, 0)).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });

  it('surfaces client API errors without retrying', async () => {
    const send = vi.fn(async () => json({ message: 'Invalid model' }, 400));
    const reranker = cohereReranker({ apiKey: 'k', fetch: send });
    await expect(reranker.rerank('q', chunks, 1)).rejects.toThrow('Cohere rerank failed with HTTP 400: {"message":"Invalid model"}');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('retries rate limits and server errors through the shared HTTP helper', async () => {
    vi.useFakeTimers();
    const send = vi.fn().mockResolvedValueOnce(json({}, 429, { 'retry-after': '2' })).mockResolvedValueOnce(json({}, 503)).mockResolvedValueOnce(json({ results: [{ index: 0, relevance_score: 1 }] }));
    const reranker = cohereReranker({ apiKey: 'k', fetch: send });
    const result = reranker.rerank('q', chunks, 1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(send).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect((await result)[0].id).toBe('a');
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('rejects malformed results and indexes outside the submitted documents', async () => {
    const malformed = cohereReranker({ apiKey: 'k', fetch: async () => json({}) });
    await expect(malformed.rerank('q', chunks, 2)).rejects.toThrow('results must be an array');
    const invalidIndex = cohereReranker({ apiKey: 'k', fetch: async () => json({ results: [{ index: 9, relevance_score: 0.2 }] }) });
    await expect(invalidIndex.rerank('q', chunks, 2)).rejects.toThrow('invalid rerank result');
  });

  it('passes the abort signal to fetch and stops retry waiting when aborted', async () => {
    const send = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.signal).toBeDefined();
      return json({}, 429, { 'retry-after': '30' });
    });
    const controller = new AbortController();
    const reranker = cohereReranker({ apiKey: 'k', fetch: send });
    const result = reranker.rerank('q', chunks, 1, { signal: controller.signal });
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    controller.abort(new Error('request cancelled'));
    await expect(result).rejects.toThrow('request cancelled');
  });
});
