import type { Index } from '@upstash/vector';
import type { VectorRecord } from '@chatcops/core';
import { describe, expect, it, vi } from 'vitest';
import { serializeFilter, upstashVectors } from '../src/index.js';

const record = (id: string, overrides: Partial<VectorRecord> = {}): VectorRecord => ({
  id,
  vector: new Float32Array([1, 0, 0, 0]),
  text: `text ${id}`,
  source: { id: 'page-1', url: 'https://example.test/page', title: 'Page' },
  metadata: { locale: 'en' },
  ...overrides,
});

function makeIndex(overrides: Record<string, unknown> = {}) {
  const index = {
    upsert: vi.fn(async () => 'Success'),
    query: vi.fn(async () => []),
    delete: vi.fn(async () => ({ deleted: 0 })),
    ...overrides,
  };
  return index as unknown as Index<Record<string, string | number | boolean>>;
}

describe('upstashVectors', () => {
  it('maps records to Upstash vectors, data, and metadata', async () => {
    const index = makeIndex();
    const vectors = upstashVectors({ index, dimensions: 4 });
    await vectors.upsert([record('r1')]);
    expect(index.upsert).toHaveBeenCalledWith([{
      id: 'r1', vector: [1, 0, 0, 0], data: 'text r1',
      metadata: { locale: 'en', __chatcops_source_id: 'page-1', __chatcops_source_url: 'https://example.test/page', __chatcops_source_title: 'Page' },
    }]);
  });

  it('handles empty upserts and optional source metadata', async () => {
    const index = makeIndex();
    const vectors = upstashVectors({ index, dimensions: 4 });
    await vectors.upsert([]);
    await vectors.upsert([record('r2', {
      metadata: undefined,
      source: { id: 'page-2', url: 'https://example.test/2', section: 'Plans', updatedAt: 123 },
    })]);
    expect(index.upsert).toHaveBeenCalledTimes(1);
    expect(index.upsert).toHaveBeenCalledWith([expect.objectContaining({
      id: 'r2',
      metadata: { __chatcops_source_id: 'page-2', __chatcops_source_url: 'https://example.test/2', __chatcops_source_section: 'Plans', __chatcops_source_updated_at: 123 },
    })]);
  });

  it('rejects invalid dimensions, nonfinite values, and reserved metadata fields', async () => {
    const index = makeIndex();
    expect(() => upstashVectors({ index, dimensions: 0 })).toThrow('positive whole number');
    expect(() => upstashVectors({ index: undefined as never, dimensions: 4 })).toThrow('requires an Upstash Vector index');
    const vectors = upstashVectors({ index, dimensions: 4 });
    await expect(vectors.upsert([record('nan', { vector: new Float32Array([Number.NaN, 0, 0, 0]) })])).rejects.toThrow('finite number');
    await expect(vectors.query({ vector: new Float32Array([0, 0, 0, Number.POSITIVE_INFINITY]), topK: 1 })).rejects.toThrow('finite number');
    await expect(vectors.upsert([record('reserved', { metadata: { __chatcops_source_id: 'spoofed' } })])).rejects.toThrow('reserved');
  });

  it('maps query fields and preserves best-first results and metadata', async () => {
    const index = makeIndex({ query: vi.fn(async () => [
      { id: 'first', data: 'best', score: 0.95, metadata: { locale: 'en', __chatcops_source_id: 'page-1', __chatcops_source_url: 'https://example.test/page', __chatcops_source_title: 'Page' } },
      { id: 'second', data: 'next', score: 0.8, metadata: { __chatcops_source_id: 'page-2', __chatcops_source_url: 'https://example.test/2' } },
    ]) });
    const vectors = upstashVectors({ index, dimensions: 4 });
    const found = await vectors.query({ vector: new Float32Array([1, 0, 0, 0]), topK: 2, filter: { locale: 'en' } });
    expect(index.query).toHaveBeenCalledWith({ vector: [1, 0, 0, 0], topK: 2, includeMetadata: true, includeData: true, filter: "(locale = 'en')" });
    expect(found).toEqual([
      { id: 'first', text: 'best', score: 0.9, source: { id: 'page-1', url: 'https://example.test/page', title: 'Page' }, metadata: { locale: 'en' } },
      { id: 'second', text: 'next', score: 0.6, source: { id: 'page-2', url: 'https://example.test/2' } },
    ]);
  });

  it('maps absent response fields to empty text and source defaults', async () => {
    const index = makeIndex({ query: vi.fn(async () => [{ id: 12, score: 0.5 }]) });
    const vectors = upstashVectors({ index, dimensions: 4 });
    await expect(vectors.query({ vector: new Float32Array(4), topK: 1 })).resolves.toEqual([
      { id: '12', text: '', score: 0, source: { id: '', url: '' } },
    ]);
  });

  it('serializes compound filters, accepted arrays, and safely escapes quoted strings', () => {
    expect(serializeFilter({ locale: ['en', 'de'], page: 1, public: true })).toBe("(locale = 'en' OR locale = 'de') AND (page = 1) AND (public = 1)");
    expect(serializeFilter({ page: 1 })).toBe('(page = 1)');
    expect(serializeFilter({ page: '1' })).toBe("(page = '1')");
    expect(serializeFilter({ public: false })).toBe('(public = 0)');
    const malicious = "x' OR public = true OR locale = 'x";
    expect(serializeFilter({ locale: malicious })).toBe("(locale = 'x\\' OR public = true OR locale = \\'x')");
    expect(serializeFilter({ locale: "a\\b" })).toBe("(locale = 'a\\\\b')");
    expect(serializeFilter({ locale: [] })).toContain('AND');
    expect(serializeFilter({})).toBe('');
  });

  it('deletes by escaped source id and leaves the keyword capability absent', async () => {
    const index = makeIndex();
    const vectors = upstashVectors({ index, dimensions: 4 });
    await vectors.deleteBySource("page' OR x = 'x");
    expect(index.delete).toHaveBeenCalledWith({ filter: "__chatcops_source_id = 'page\\' OR x = \\'x'" });
    expect(vectors.keywordQuery).toBeUndefined();
    expect(upstashVectors({ index, dimensions: 4, keywordSearch: true }).keywordQuery).toBeTypeOf('function');
  });

  it('uses Upstash sparse query mode for keyword search and preserves backend scores', async () => {
    const index = makeIndex({ query: vi.fn(async () => [
      { id: 'match', data: 'refund request', score: 2.25, metadata: { __chatcops_source_id: 'page-1', __chatcops_source_url: 'https://example.test/page' } },
    ]) });
    const vectors = upstashVectors({ index, dimensions: 4, keywordSearch: true });
    const results = await vectors.keywordQuery?.({ text: 'refund request', topK: 3, filter: { locale: 'en' } });
    expect(index.query).toHaveBeenCalledWith({
      data: 'refund request', topK: 3, queryMode: 'SPARSE', includeMetadata: true, includeData: true, filter: "(locale = 'en')",
    });
    expect(results?.[0]).toMatchObject({ id: 'match', score: 2.25, text: 'refund request', source: { id: 'page-1' } });
  });

  it('returns no keyword results for invalid limits or queries without words', async () => {
    const index = makeIndex();
    const vectors = upstashVectors({ index, dimensions: 4, keywordSearch: true });
    await expect(vectors.keywordQuery?.({ text: 'refund', topK: 0 })).resolves.toEqual([]);
    await expect(vectors.keywordQuery?.({ text: '?!', topK: 3 })).resolves.toEqual([]);
    expect(index.query).not.toHaveBeenCalled();
  });

  it('segments CJK keyword queries with the core tokenizer', async () => {
    const index = makeIndex();
    const vectors = upstashVectors({ index, dimensions: 4, keywordSearch: true });
    await vectors.keywordQuery?.({ text: '料金プランは月額です', topK: 5 });
    expect(index.query).toHaveBeenCalledWith(expect.objectContaining({ data: expect.stringContaining(' ') }));
  });

  it('rejects metadata keys outside Upstash filter identifier syntax', () => {
    expect(() => serializeFilter({ "locale' OR enabled": 'en' })).toThrow('Unsupported Upstash metadata field name');
    expect(() => serializeFilter({ 'page.count': 1 })).toThrow('Unsupported Upstash metadata field name');
  });

  it('returns empty for invalid topK without querying and rejects wrong dimensions', async () => {
    const index = makeIndex();
    const vectors = upstashVectors({ index, dimensions: 4 });
    expect(await vectors.query({ vector: new Float32Array(4), topK: 0 })).toEqual([]);
    expect(index.query).not.toHaveBeenCalled();
    await expect(vectors.upsert([record('bad', { vector: new Float32Array(3) })])).rejects.toThrow('dimensions');
  });

  it('omits absent and empty filters from the SDK request', async () => {
    const index = makeIndex();
    const vectors = upstashVectors({ index, dimensions: 4 });
    await vectors.query({ vector: new Float32Array(4), topK: 1 });
    await vectors.query({ vector: new Float32Array(4), topK: 1, filter: {} });
    expect(index.query).toHaveBeenNthCalledWith(1, { vector: [0, 0, 0, 0], topK: 1, includeMetadata: true, includeData: true });
    expect(index.query).toHaveBeenNthCalledWith(2, { vector: [0, 0, 0, 0], topK: 1, includeMetadata: true, includeData: true });
  });
});
