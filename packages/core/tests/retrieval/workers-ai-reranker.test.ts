import { describe, expect, it, vi } from 'vitest';
import { workersAiReranker, type RetrievedChunk } from '../../src/index.js';

const chunks: RetrievedChunk[] = [
  { id: 'first', text: 'First page', score: 0.2, source: { id: 'source-1', url: 'https://example.test/1' } },
  { id: 'second', text: 'Second page', score: 0.8, source: { id: 'source-2', url: 'https://example.test/2' } },
  { id: 'third', text: 'Third page', score: 0.5, source: { id: 'source-3', url: 'https://example.test/3' } },
];

describe('workersAiReranker', () => {
  it('sends the query and contexts to the default model, maps ids to chunks, applies scores and topN', async () => {
    const ai = {
      run: vi.fn(async () => ({ response: [{ id: 0, score: 0.2 }, { id: 2, score: 0.9 }, { id: 1, score: 0.6 }] })),
    };
    const reranker = workersAiReranker({ ai });

    const result = await reranker.rerank('Which page is best?', chunks, 2);

    expect(ai.run).toHaveBeenCalledWith('@cf/baai/bge-reranker-base', {
      query: 'Which page is best?',
      contexts: [{ text: 'First page' }, { text: 'Second page' }, { text: 'Third page' }],
      top_k: 2,
    });
    expect(result).toEqual([
      { ...chunks[2], score: 0.9 },
      { ...chunks[1], score: 0.6 },
    ]);
  });

  it('supports a custom model', async () => {
    const ai = { run: vi.fn(async () => ({ response: [{ id: 0, score: 0.7 }] })) };
    await workersAiReranker({ ai, model: 'custom-reranker' }).rerank('query', chunks.slice(0, 1), 1);
    expect(ai.run).toHaveBeenCalledWith('custom-reranker', expect.any(Object));
  });

  it('returns an empty list without calling the binding for empty input or zero topN', async () => {
    const ai = { run: vi.fn() };
    const reranker = workersAiReranker({ ai });

    await expect(reranker.rerank('query', [], 2)).resolves.toEqual([]);
    await expect(reranker.rerank('query', chunks, 0)).resolves.toEqual([]);
    expect(ai.run).not.toHaveBeenCalled();
  });

  it('rejects unexpected response shapes and invalid result entries', async () => {
    const reranker = workersAiReranker({ ai: { run: vi.fn().mockResolvedValue({ results: [] }) } });
    await expect(reranker.rerank('query', chunks, 2)).rejects.toThrow('invalid reranking response');

    const invalidResult = workersAiReranker({ ai: { run: vi.fn().mockResolvedValue({ response: [{ id: 9, score: 0.5 }] }) } });
    await expect(invalidResult.rerank('query', chunks, 2)).rejects.toThrow('invalid reranking result');
  });

  it('requires an AI binding with run()', () => {
    expect(() => workersAiReranker({} as never)).toThrow('requires an ai binding with a run() method');
  });
});
