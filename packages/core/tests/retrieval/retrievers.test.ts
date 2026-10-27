import { describe, expect, it, vi } from 'vitest';
import {
  hybridRetriever,
  memoryVectors,
  reciprocalRankFusion,
  retrievalQueryText,
  vectorRetriever,
  type ChatMessage,
  type Embedder,
  type Reranker,
  type ScoredRecord,
  type VectorStore,
} from '../../src/index.js';

/**
 * A stand-in for a real model: each topic word lights up one dimension, so
 * "refund" and "returns" land near each other and far from "shipping".
 */
const TOPICS = [['refund', 'refunds', 'returns', 'money'], ['ship', 'shipping', 'delivery', 'canada'], ['office', 'lisbon', 'team']];
function topicEmbedder(dimensions = 4): Embedder & { calls: Array<{ texts: string[]; kind: string; signal?: AbortSignal }> } {
  const calls: Array<{ texts: string[]; kind: string; signal?: AbortSignal }> = [];
  return {
    id: 'test:topics@4',
    dimensions,
    calls,
    async embed(texts, kind, options = {}) {
      calls.push({ texts, kind, signal: options.signal });
      return texts.map((text) => {
        const vector = new Float32Array(dimensions);
        const words = text.toLowerCase().split(/\W+/);
        TOPICS.forEach((topic, i) => {
          vector[i] = words.filter((word) => topic.includes(word)).length;
        });
        vector[dimensions - 1] = 0.01;
        return vector;
      });
    },
  };
}

const DOCS = [
  { id: 'refunds', text: 'Refunds go back to your card within 14 days of the returns arriving.', locale: 'en' },
  { id: 'shipping', text: 'Shipping to Canada takes five to seven days. Delivery is tracked.', locale: 'en' },
  { id: 'office', text: 'Our team works from an office in Lisbon.', locale: 'en' },
  // Its meaning (the Lisbon team) has nothing to do with deliveries; only its exact words match.
  { id: 'sku', text: 'Part number XK-4471 fits the 2024 model from the Lisbon team.', locale: 'en' },
  { id: 'refunds-de', text: 'Refunds dauern 14 Tage.', locale: 'de' },
];

async function indexed(embedder = topicEmbedder()): Promise<VectorStore> {
  const store = memoryVectors({ dimensions: embedder.dimensions });
  const vectors = await embedder.embed(DOCS.map((doc) => doc.text), 'document');
  await store.upsert(
    DOCS.map((doc, i) => ({
      id: doc.id,
      vector: vectors[i],
      text: doc.text,
      source: { id: `https://example.test/${doc.id}`, url: `https://example.test/${doc.id}` },
      metadata: { locale: doc.locale },
    }))
  );
  embedder.calls?.splice(0);
  return store;
}

const user = (content: string): ChatMessage => ({ id: content, role: 'user', content, timestamp: 0 });
const assistant = (content: string): ChatMessage => ({ id: content, role: 'assistant', content, timestamp: 0 });

describe('vectorRetriever', () => {
  it('embeds the question as a query and returns the closest chunks with their source', async () => {
    const embedder = topicEmbedder();
    const retriever = vectorRetriever({ store: await indexed(embedder), embedder });
    const signal = new AbortController().signal;

    const chunks = await retriever.retrieve({ text: 'How long do refunds take for returns?', topK: 2, signal });
    expect(chunks.map((c) => c.id)).toEqual(['refunds', 'refunds-de']);
    expect(chunks[0]).toMatchObject({ text: DOCS[0].text, source: { url: 'https://example.test/refunds' }, metadata: { locale: 'en' } });
    expect(embedder.calls).toEqual([{ texts: ['How long do refunds take for returns?'], kind: 'query', signal }]);
  });

  it('passes the filter to the store and defaults to 5 chunks', async () => {
    const embedder = topicEmbedder();
    const store = await indexed(embedder);
    const query = vi.spyOn(store, 'query');
    const chunks = await vectorRetriever({ store, embedder }).retrieve({ text: 'refunds and money back please', filter: { locale: 'en' } });

    expect(chunks.map((c) => c.id)).not.toContain('refunds-de');
    expect(chunks.length).toBeLessThanOrEqual(5);
    expect(query).toHaveBeenCalledWith(expect.objectContaining({ topK: 20, filter: { locale: 'en' } }));
  });

  it('fetches at least topK candidates when topK is above the candidate count', async () => {
    const embedder = topicEmbedder();
    const store = await indexed(embedder);
    const query = vi.spyOn(store, 'query');
    await vectorRetriever({ store, embedder, candidates: 2 }).retrieve({ text: 'refunds for my order', topK: 4 });
    expect(query).toHaveBeenCalledWith(expect.objectContaining({ topK: 4 }));
  });

  it('refuses an embedder whose vectors are a different size than the store', async () => {
    expect(() => vectorRetriever({ store: memoryVectors({ dimensions: 8 }), embedder: topicEmbedder(4) })).toThrow(
      'The embedder (test:topics@4) makes 4-dimension vectors, but the store holds 8.'
    );
  });

  it('hands the candidates to a reranker and keeps its top ones', async () => {
    const embedder = topicEmbedder();
    const rerank = vi.fn<Reranker['rerank']>(async (_query, chunks) => [...chunks].reverse());
    const retriever = vectorRetriever({ store: await indexed(embedder), embedder, candidates: 3, reranker: { rerank } });
    const chunks = await retriever.retrieve({ text: 'Do refunds include shipping costs?', topK: 2 });

    expect(rerank).toHaveBeenCalledWith('Do refunds include shipping costs?', expect.any(Array), 2, { signal: undefined });
    expect(rerank.mock.calls[0][1]).toHaveLength(3);
    expect(chunks).toHaveLength(2);
  });
});

describe('hybridRetriever', () => {
  it('finds a chunk only its exact words match, which vector search alone misses', async () => {
    const embedder = topicEmbedder();
    const store = await indexed(embedder);
    const question = 'Which delivery model does part XK-4471 fit?';

    const byMeaning = await vectorRetriever({ store, embedder }).retrieve({ text: question, topK: 2 });
    expect(byMeaning.map((c) => c.id)).not.toContain('sku');

    const hybrid = await hybridRetriever({ store, embedder }).retrieve({ text: question, topK: 2 });
    expect(hybrid.map((c) => c.id)).toEqual(['shipping', 'sku']);
  });

  it('ranks a chunk both searches find above one only a single search finds', async () => {
    const embedder = topicEmbedder();
    const chunks = await hybridRetriever({ store: await indexed(embedder), embedder }).retrieve({
      text: 'shipping delivery to Canada',
      topK: 3,
    });
    expect(chunks[0].id).toBe('shipping');
    expect(chunks[0].score).toBeCloseTo(2 / 61, 6);
  });

  it('passes the filter to both searches', async () => {
    const embedder = topicEmbedder();
    const store = await indexed(embedder);
    const keyword = vi.spyOn(store, 'keywordQuery' as never) as unknown as ReturnType<typeof vi.fn>;
    const query = vi.spyOn(store, 'query');
    const chunks = await hybridRetriever({ store, embedder }).retrieve({ text: 'refunds take how many days?', filter: { locale: 'de' } });

    expect(chunks.map((c) => c.id)).toEqual(['refunds-de']);
    expect(query).toHaveBeenCalledWith(expect.objectContaining({ filter: { locale: 'de' } }));
    expect(keyword).toHaveBeenCalledWith(expect.objectContaining({ filter: { locale: 'de' } }));
  });

  it('needs a store with keyword search', () => {
    const store = memoryVectors({ dimensions: 4 });
    const withoutKeywords: VectorStore = { dimensions: 4, upsert: store.upsert, query: store.query, deleteBySource: store.deleteBySource };
    expect(() => hybridRetriever({ store: withoutKeywords, embedder: topicEmbedder() })).toThrow('needs a store with keywordQuery');
  });
});

describe('reciprocalRankFusion', () => {
  const record = (id: string, score = 1): ScoredRecord => ({ id, text: id, score, source: { id, url: `https://x.test/${id}` } });

  it('scores 1 / (k + rank) per list and sums them', () => {
    const fused = reciprocalRankFusion([[record('a'), record('b')], [record('b'), record('c')]], 60);
    expect(fused.map((c) => c.id)).toEqual(['b', 'a', 'c']);
    expect(fused[0].score).toBeCloseTo(1 / 62 + 1 / 61, 10);
    expect(fused[1].score).toBeCloseTo(1 / 61, 10);
    expect(fused[2].score).toBeCloseTo(1 / 62, 10);
  });

  it('ignores the original scores, which are on different scales', () => {
    const fused = reciprocalRankFusion([[record('a', 0.99)], [record('b', 4000)]]);
    expect(fused[0].score).toBe(fused[1].score);
    // Ties are broken by id, so the order is stable.
    expect(fused.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('weights rank more with a smaller k', () => {
    const lists = [[record('a'), record('b')]];
    const gap = (k: number) => {
      const [first, second] = reciprocalRankFusion(lists, k);
      return first.score - second.score;
    };
    expect(gap(1)).toBeGreaterThan(gap(60));
  });

  it('handles no lists and empty lists', () => {
    expect(reciprocalRankFusion([])).toEqual([]);
    expect(reciprocalRankFusion([[], []])).toEqual([]);
  });
});

describe('retrievalQueryText', () => {
  const history = [user('Do you ship to Canada?'), assistant('Yes, we ship to Canada.')];

  it('uses a full question on its own', () => {
    const question = 'What is the warranty period for the standing desks you sell?';
    expect(retrievalQueryText(question, history)).toBe(question);
  });

  it('adds the previous question to a short follow-up', () => {
    expect(retrievalQueryText('How long does it take?', history)).toBe('Do you ship to Canada?\nHow long does it take?');
  });

  it('adds it to a longer message that starts like a follow-up', () => {
    expect(retrievalQueryText('And what about the extra customs fees for orders over 200 dollars?', history)).toBe(
      'Do you ship to Canada?\nAnd what about the extra customs fees for orders over 200 dollars?'
    );
  });

  it('skips assistant messages and empty ones, and leaves a first question alone', () => {
    expect(retrievalQueryText('Price?', [user('   '), assistant('Hi!')])).toBe('Price?');
    expect(retrievalQueryText('  Price?  ')).toBe('Price?');
  });

  it("doesn't mistake a word that only starts like a cue for one", () => {
    const question = 'Andorra deliveries: which carrier handles them and how fast are they usually?';
    expect(retrievalQueryText(question, history)).toBe(question);
  });
});

describe('retrievers with follow-up questions', () => {
  it('searches with the previous question for a short follow-up', async () => {
    const embedder = topicEmbedder();
    const retriever = vectorRetriever({ store: await indexed(embedder), embedder });
    const chunks = await retriever.retrieve({
      text: 'How long does it take?',
      topK: 1,
      history: [user('Do you ship to Canada?'), assistant('Yes.')],
    });
    expect(embedder.calls[0].texts).toEqual(['Do you ship to Canada?\nHow long does it take?']);
    expect(chunks[0].id).toBe('shipping');
  });
});
