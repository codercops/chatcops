import { describe, expect, it } from 'vitest';
import { matchesFilter, memoryVectors, segmentWords, type VectorRecord } from '../../src/index.js';

const record = (id: string, vector: number[], extra: Partial<VectorRecord> = {}): VectorRecord => ({
  id,
  vector: Float32Array.from(vector),
  text: `Text ${id}`,
  source: { id: 'page', url: 'https://example.test/' },
  ...extra,
});

describe('memoryVectors', () => {
  it('needs a positive whole number of dimensions', () => {
    for (const dimensions of [0, -1, 1.5, Number.NaN]) {
      expect(() => memoryVectors({ dimensions })).toThrow('positive whole number');
    }
    expect(memoryVectors({ dimensions: 3 }).dimensions).toBe(3);
  });

  it('refuses an upsert past maxRecords and stores none of it, but replacing records is fine', async () => {
    const store = memoryVectors({ dimensions: 2, maxRecords: 2 });
    await store.upsert([record('a', [1, 0]), record('b', [0, 1])]);
    await expect(store.upsert([record('c', [1, 1])])).rejects.toThrow('at most 2 records');
    await store.upsert([record('a', [0, 1])]);
    expect((await store.query({ vector: Float32Array.from([1, 1]), topK: 5 })).map((r) => r.id).sort()).toEqual(['a', 'b']);
  });

  it('rejects NaN and Infinity in a vector, and stores nothing from that upsert', async () => {
    const store = memoryVectors({ dimensions: 2 });
    await expect(store.upsert([record('ok', [1, 0]), record('bad', [Number.NaN, 0])])).rejects.toThrow('finite');
    await expect(store.query({ vector: Float32Array.from([Infinity, 0]), topK: 1 })).rejects.toThrow('finite');
    expect(await store.query({ vector: Float32Array.from([1, 0]), topK: 5 })).toEqual([]);
  });

  it('scores a zero vector as 0 rather than NaN', async () => {
    const store = memoryVectors({ dimensions: 2 });
    await store.upsert([record('zero', [0, 0]), record('x', [1, 0])]);
    const results = await store.query({ vector: Float32Array.from([1, 0]), topK: 5 });
    expect(results.map((r) => [r.id, r.score])).toEqual([['x', 1], ['zero', 0]]);
    expect(await store.query({ vector: Float32Array.from([0, 0]), topK: 5 })).toEqual([
      expect.objectContaining({ id: 'x', score: 0 }),
      expect.objectContaining({ id: 'zero', score: 0 }),
    ]);
  });

  it('returns nothing for topK below 1, and rounds a fractional topK down', async () => {
    const store = memoryVectors({ dimensions: 2 });
    await store.upsert([record('a', [1, 0]), record('b', [0, 1])]);
    expect(await store.query({ vector: Float32Array.from([1, 0]), topK: 0 })).toEqual([]);
    expect(await store.query({ vector: Float32Array.from([1, 0]), topK: Number.NaN })).toEqual([]);
    expect(await store.query({ vector: Float32Array.from([1, 0]), topK: 1.9 })).toHaveLength(1);
  });

  it('breaks score ties by id, so results are stable', async () => {
    const store = memoryVectors({ dimensions: 2 });
    await store.upsert([record('b', [1, 0]), record('a', [1, 0]), record('c', [1, 0])]);
    expect((await store.query({ vector: Float32Array.from([1, 0]), topK: 3 })).map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('has no keyword results for a query with no words', async () => {
    const store = memoryVectors({ dimensions: 2 });
    await store.upsert([record('a', [1, 0], { text: 'Hello there' })]);
    expect(await store.keywordQuery?.({ text: '  ?! ', topK: 5 })).toEqual([]);
    expect(await memoryVectors({ dimensions: 2 }).keywordQuery?.({ text: 'hello', topK: 5 })).toEqual([]);
  });
});

describe('segmentWords', () => {
  it('lowercases, normalizes and drops punctuation', () => {
    expect(segmentWords('Hello, WORLD! Ｆｕｌｌ-width')).toEqual(['hello', 'world', 'full', 'width']);
  });

  it('splits Japanese and Chinese, which have no spaces', () => {
    expect(segmentWords('料金プランは月額です')).toContain('料金');
    expect(segmentWords('我们的价格按月计算')).toContain('价格');
  });
});

describe('matchesFilter', () => {
  it('matches every key, by value or any of a list, with the same type', () => {
    const metadata = { locale: 'de', page: 1, public: true };
    expect(matchesFilter(metadata, {})).toBe(true);
    expect(matchesFilter(metadata, { locale: 'de', public: true })).toBe(true);
    expect(matchesFilter(metadata, { locale: ['en', 'de'] })).toBe(true);
    expect(matchesFilter(metadata, { page: '1' })).toBe(false);
    expect(matchesFilter(metadata, { missing: 'x' })).toBe(false);
    expect(matchesFilter(undefined, { locale: 'de' })).toBe(false);
    // Inherited properties aren't metadata.
    expect(matchesFilter(metadata, { toString: 'x' })).toBe(false);
  });
});
