import type { Queryable } from '../src/queryable.js';
import { PostgresVectorStore } from '../src/vectors.js';
import { describe, expect, it, vi } from 'vitest';

const row = {
  id: 'chunk-1',
  text: 'A pricing page',
  source: { id: 'pricing', url: 'https://example.test/pricing' },
  metadata: { page: 1 },
  score: 0.75,
};

function fakeDb() {
  const calls: Array<{ text: string; params?: unknown[] }> = [];
  let db: Queryable;
  const query = vi.fn(async (text: string, params?: unknown[]) => {
    calls.push({ text, params });
    return { rows: text.includes('WITH nearest') || text.includes('WITH search') ? [row] : [] };
  });
  db = {
    query: query as Queryable['query'],
    transaction: async (run) => run(db),
  };
  return { db, calls, query };
}

describe('PostgresVectorStore', () => {
  it('splits words before building the Postgres keyword vector', async () => {
    const { db, calls } = fakeDb();
    const store = new PostgresVectorStore(4, db, 'chatcops_vector_chunks');
    await store.upsert([
      {
        id: 'chunk-1',
        vector: new Float32Array([1, 0, 0, 0]),
        text: '料金プラン for Japan',
        source: row.source,
      },
    ]);

    expect(calls[0].text).toContain("to_tsvector('simple', $7)");
    expect(calls[0].text).toContain('$3::text::jsonb');
    expect(calls[0].text).toContain('$5::text::jsonb');
    expect(calls[0].text).toContain('$6::text::vector');
    expect(calls[0].params?.[5]).toBe('[1,0,0,0]');
    expect(calls[0].params?.[6]).toContain('料金');
  });

  it('uses a local iterative scan for filtered cosine search and returns scored records', async () => {
    const { db, calls } = fakeDb();
    const store = new PostgresVectorStore(4, db, 'chatcops_vector_chunks');
    const results = await store.query({ vector: new Float32Array([1, 0, 0, 0]), topK: 2, filter: { page: 1 } });

    expect(calls[0].text).toBe("SET LOCAL hnsw.iterative_scan = 'relaxed_order'");
    expect(calls[1].text).toContain('ORDER BY embedding <=> $1::text::vector');
    expect(calls[1].text).toContain('metadata -> $2::text = $3::text::jsonb');
    expect(calls[1].params).toEqual(['[1,0,0,0]', 'page', '1', 2]);
    expect(results).toEqual([{ ...row, score: 0.75 }]);
  });

  it('uses simple-config keyword ranking with segmented query words', async () => {
    const { db, calls } = fakeDb();
    const store = new PostgresVectorStore(4, db, 'chatcops_vector_chunks');
    await store.keywordQuery({ text: '料金プラン', topK: 3 });

    expect(calls[0].text).toContain("plainto_tsquery('simple', $1)");
    expect(calls[0].text).toContain('ts_rank(keyword_vector, search.query)');
    expect(calls[0].params?.[0]).toContain('料金');
  });

  it('rejects invalid dimensions and vectors', async () => {
    const { db } = fakeDb();
    expect(() => new PostgresVectorStore(0, db, 'chunks')).toThrow(/dimensions/);
    const store = new PostgresVectorStore(4, db, 'chunks');
    await expect(
      store.upsert([{ id: 'bad', text: 'bad', source: row.source, vector: new Float32Array([1, 2]) }])
    ).rejects.toThrow(/dimensions/);
    await expect(
      store.query({ vector: new Float32Array([1, Number.NaN, 0, 0]), topK: 1 })
    ).rejects.toThrow(/finite/);
  });
});
