import { describe, expect, it } from 'vitest';
import { cloudflareStorage } from '../src/index.js';
import { getMiniflareBindings } from './miniflare.js';

describe('Cloudflare vector keyword search', () => {
  it('matches partial questions and ranks records by matching terms', async () => {
    const { d1, vectorize } = await getMiniflareBindings();
    const store = cloudflareStorage({ d1, vectorize, vectorDimensions: 4 }).vectors;
    if (!store?.keywordQuery) throw new Error('Vector store is not configured');

    await store.upsert([
      {
        id: 'partial-question',
        vector: Float32Array.from([1, 0, 0, 0]),
        text: 'Refund information is available.',
        source: { id: 'partial-question', url: 'https://example.com/partial' },
      },
      {
        id: 'full-question',
        vector: Float32Array.from([1, 0, 0, 0]),
        text: 'Refund shipping timeline details are available.',
        source: { id: 'full-question', url: 'https://example.com/full' },
      },
    ]);

    const results = await store.keywordQuery({ text: 'refund shipping timeline', topK: 2 });
    expect(results.map((result) => result.id)).toEqual(['full-question', 'partial-question']);
  });
});
