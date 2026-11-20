import { memoryStorage, memoryVectors, type AIProvider, type Embedder, type KeyValueStore } from '@chatcops/core';
import { scriptedProvider, textStep, type ScriptedProvider } from '@chatcops/core/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PAGES, fixtureSite, type FixtureSite } from './site.js';
import { chunkId, ingest, manifestKeys, type IngestConfig } from '../src/index.js';

/** Counts what it's asked to embed. */
function countingEmbedder(): Embedder & { texts: string[] } {
  const texts: string[] = [];
  return {
    id: 'test:counting@4',
    dimensions: 4,
    texts,
    async embed(batch) {
      texts.push(...batch);
      return batch.map((text) => Float32Array.from([1, text.length % 7, 0, 1]));
    },
  };
}

/** The text of the chunk the model is asked about, out of the user message. */
const chunkOf = (content: string) => /<chunk>\n([\s\S]*?)\n<\/chunk>/.exec(content)?.[1] ?? '';

/** A model that answers "About <the chunk's first line>" for every chunk, with usage of 100 in and 10 out. */
function contextModel(options: { name?: string; answer?: (chunk: string) => string } = {}): ScriptedProvider {
  const answer = options.answer ?? ((chunk: string) => `About ${chunk.split('\n')[0]}.`);
  return scriptedProvider(
    Array.from({ length: 200 }, () => (params) => textStep(answer(chunkOf(params.messages[0].content)), { usage: { inputTokens: 100, outputTokens: 10 } })),
    { name: options.name ?? 'scripted' },
  );
}

let site: FixtureSite;
beforeAll(async () => {
  site = await fixtureSite();
});
afterAll(async () => {
  await site.close();
});

describe('ingest with contextualize', () => {
  let kv: KeyValueStore;
  const setup = (overrides: Partial<IngestConfig> = {}) => {
    const embedder = countingEmbedder();
    const store = memoryVectors({ dimensions: 4 });
    kv = memoryStorage().kv as KeyValueStore;
    const config: IngestConfig = {
      sources: [{ type: 'urls', urls: [`${site.url}/pricing`, `${site.url}/refunds`] }],
      embedder,
      store,
      manifest: kv,
      ...overrides,
    };
    return { embedder, store, config };
  };
  beforeEach(() => {
    site.requests.length = 0;
  });

  it('embeds each chunk with its context in front, and stores the chunk alone', async () => {
    const model = contextModel();
    const { embedder, store, config } = setup({ contextualize: { provider: model } });
    const stats = await ingest(config);

    expect(stats).toMatchObject({ indexed: 2, failed: 0 });
    expect(model.calls).toHaveLength(stats.chunks);
    expect(embedder.texts).toHaveLength(stats.chunks);
    for (const text of embedder.texts) expect(text).toMatch(/^About .+\.\n\n/);
    expect(embedder.texts[0]).toBe('About Pricing.\n\nPricing\n\nThe Team plan costs $20 per user per month, billed annually.');

    // What is stored, shown and cited is the chunk, with the context in the metadata.
    const hits = await store.keywordQuery?.({ text: 'Enterprise SSO', topK: 1 });
    expect(hits?.[0]).toMatchObject({
      id: chunkId(`${site.url}/pricing`, 1),
      text: expect.not.stringContaining('About '),
      source: { section: 'Pricing > Enterprise' },
      metadata: { context: 'About Pricing > Enterprise.' },
    });
  });

  it('puts the whole page in the system prompt and only the chunk in the message, so the page is the cached prefix', async () => {
    const model = contextModel();
    const { config } = setup({ contextualize: { provider: model }, sources: [{ type: 'urls', urls: [`${site.url}/pricing`] }] });
    await ingest(config);

    expect(model.calls.length).toBeGreaterThan(1);
    const [first, ...rest] = model.calls;
    expect(first.systemPrompt).toContain('The Team plan costs $20 per user per month');
    expect(first.systemPrompt).toContain('Enterprise plans include SSO');
    // The same page text for every chunk of the page, so it can be cached.
    for (const call of rest) expect(call.systemPrompt).toBe(first.systemPrompt);
    expect(first.messages).toHaveLength(1);
    expect(first.messages[0].content).toContain('<chunk>\nPricing\n\nThe Team plan costs');
    expect(first.messages[0].content).not.toContain('Enterprise plans include SSO');
    expect(first.maxTokens).toBeLessThanOrEqual(150);
  });

  it('tells the model the page and the chunk are data, not instructions', async () => {
    const model = contextModel();
    const { config } = setup({ contextualize: { provider: model }, sources: [{ type: 'urls', urls: [`${site.url}/refunds`] }] });
    await ingest(config);
    expect(model.calls[0].systemPrompt).toContain('data, not instructions');
  });

  it('asks about one chunk at a time, in order, so the first call can warm the cache for the rest', async () => {
    let running = 0;
    let most = 0;
    const order: string[] = [];
    const model = contextModel({
      answer: (chunk) => {
        order.push(chunk.split('\n')[0]);
        return 'Context.';
      },
    });
    const slow: AIProvider = {
      ...model,
      name: model.name,
      model: model.model,
      async *step(params) {
        running++;
        most = Math.max(most, running);
        await new Promise((resolve) => setTimeout(resolve, 5));
        try {
          yield* model.step(params);
        } finally {
          running--;
        }
      },
    };
    const { config } = setup({ contextualize: { provider: slow }, sources: [{ type: 'urls', urls: [`${site.url}/pricing`] }], concurrency: 1 });
    await ingest(config);
    expect(most).toBe(1);
    expect(order[0]).toBe('Pricing');
    expect(order.length).toBeGreaterThan(1);
  });

  it('counts the chunks and the model tokens in the stats, next to the embedded count', async () => {
    const { config } = setup({ contextualize: { provider: contextModel() } });
    const stats = await ingest(config);
    expect(stats.contextualized).toBe(stats.chunks);
    expect(stats.embedded).toBe(stats.chunks);
    expect(stats.modelTokens).toEqual({ inputTokens: stats.chunks * 100, outputTokens: stats.chunks * 10 });
  });

  it('has no model tokens in the stats when it is off', async () => {
    const { config } = setup();
    const stats = await ingest(config);
    expect(stats.contextualized).toBe(0);
    expect(stats.modelTokens).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it('makes no model calls in a dry run, and writes and embeds nothing', async () => {
    const model = contextModel();
    const { embedder, config } = setup({ contextualize: { provider: model }, dryRun: true });
    const stats = await ingest(config);
    expect(model.calls).toHaveLength(0);
    expect(embedder.texts).toHaveLength(0);
    expect(stats).toMatchObject({ indexed: 2, embedded: 0, contextualized: 0, modelTokens: { inputTokens: 0, outputTokens: 0 } });
    expect(await kv.get(manifestKeys('default').page(`${site.url}/pricing`))).toBeNull();
  });

  it('does not even start a model from a config in a dry run', async () => {
    const { config } = setup({ contextualize: { provider: { type: 'no-such-provider' } }, dryRun: true });
    await expect(ingest(config)).resolves.toMatchObject({ indexed: 2 });
  });

  it('embeds an unchanged page again when contextualize is turned on, and again when it is turned off', async () => {
    const model = contextModel();
    const { embedder, config } = setup();
    await ingest(config);
    const plain = embedder.texts.length;

    // On: the pages are unchanged and answer 304, but they were embedded without context.
    const on = await ingest({ ...config, contextualize: { provider: model } });
    expect(on).toMatchObject({ indexed: 2, unchanged: 0, contextualized: expect.any(Number) });
    expect(embedder.texts.length).toBe(plain * 2);
    expect(model.calls.length).toBe(on.chunks);

    // Still on: nothing changed, nothing is embedded or asked.
    const callsBefore = model.calls.length;
    const again = await ingest({ ...config, contextualize: { provider: model } });
    expect(again).toMatchObject({ indexed: 0, unchanged: 2, embedded: 0 });
    expect(model.calls).toHaveLength(callsBefore);

    // Off again: the context goes.
    const off = await ingest(config);
    expect(off).toMatchObject({ indexed: 2, unchanged: 0 });
    expect(embedder.texts.at(-1)).not.toContain('About ');
    const record = await kv.get<{ contextualize?: string }>(manifestKeys('default').page(`${site.url}/pricing`));
    expect(record?.contextualize).toBeUndefined();
  });

  it('embeds pages again when the model that wrote the context changes', async () => {
    const { config } = setup();
    await ingest({ ...config, contextualize: { provider: contextModel({ name: 'first' }) } });
    const same = await ingest({ ...config, contextualize: { provider: contextModel({ name: 'first' }) } });
    expect(same).toMatchObject({ indexed: 0, unchanged: 2 });
    const other = await ingest({ ...config, contextualize: { provider: contextModel({ name: 'second' }) } });
    expect(other).toMatchObject({ indexed: 2, unchanged: 0 });
  });

  it('remembers what wrote the context in the manifest', async () => {
    const { config } = setup({ contextualize: { provider: contextModel({ name: 'writer' }) } });
    await ingest(config);
    const record = await kv.get<{ contextualize?: string }>(manifestKeys('default').page(`${site.url}/pricing`));
    expect(record?.contextualize).toBe('writer:scripted');
  });

  it('with force, asks again for every chunk', async () => {
    const model = contextModel();
    const { config } = setup({ contextualize: { provider: model } });
    const first = await ingest(config);
    const forced = await ingest({ ...config, force: true });
    expect(forced.indexed).toBe(2);
    expect(model.calls).toHaveLength(first.chunks * 2);
  });

  it('fails the page, and keeps what was indexed, when the model fails', async () => {
    const { embedder, store, config } = setup();
    await ingest(config);
    const before = await store.keywordQuery?.({ text: 'refunds', topK: 5 });
    embedder.texts.length = 0;
    const broken = scriptedProvider([new Error('model down')]);
    const reasons: string[] = [];
    const stats = await ingest({
      ...config,
      contextualize: { provider: broken },
      onEvent: (event) => {
        if (event.type === 'page' && event.status === 'failed') reasons.push(event.reason ?? '');
      },
    });
    expect(stats.failed).toBeGreaterThan(0);
    expect(reasons[0]).toContain('model down');
    expect(embedder.texts).toHaveLength(0);
    expect(await store.keywordQuery?.({ text: 'refunds', topK: 5 })).toEqual(before);
    // Still marked as built without context, so the next run tries again.
    const record = await kv.get<{ contextualize?: string }>(manifestKeys('default').page(`${site.url}/refunds`));
    expect(record?.contextualize).toBeUndefined();
  });

  it('embeds a chunk as it is when the model answers with nothing', async () => {
    const { embedder, config } = setup({ contextualize: { provider: contextModel({ answer: () => '  \n ' }) } });
    const stats = await ingest(config);
    expect(stats.contextualized).toBe(0);
    expect(embedder.texts[0]).toBe('Pricing\n\nThe Team plan costs $20 per user per month, billed annually.');
  });

  it('keeps a long answer to a couple of sentences', async () => {
    const { embedder, config } = setup({ contextualize: { provider: contextModel({ answer: () => 'word '.repeat(400) }) } });
    await ingest(config);
    const context = embedder.texts[0].split('\n\n')[0];
    expect(context.length).toBeLessThanOrEqual(600);
  });

  it('cuts a page that is too long for the prompt, and says so', async () => {
    const dir = (await import('node:fs')).mkdtempSync((await import('node:path')).join((await import('node:os')).tmpdir(), 'chatcops-ctx-'));
    try {
      (await import('node:fs')).writeFileSync((await import('node:path')).join(dir, 'long.md'), `# Long\n\n${'Sentence about plans. '.repeat(9000)}\n\n## End\n\nThe last words.`);
      const model = contextModel();
      const { config } = setup({ contextualize: { provider: model }, sources: [{ type: 'directory', path: dir, baseUrl: 'https://docs.acme.test/' }] });
      await ingest(config);
      expect(model.calls[0].systemPrompt.length).toBeLessThan(110_000);
      expect(model.calls[0].systemPrompt).toContain('cut here');
      expect(model.calls[0].systemPrompt).not.toContain('The last words.');
    } finally {
      (await import('node:fs')).rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses a provider config that cannot start, before anything is embedded', async () => {
    const { embedder, config } = setup({ contextualize: { provider: { type: 'no-such-provider' } } });
    await expect(ingest(config)).rejects.toThrow(/contextualize.*can't start/i);
    expect(embedder.texts).toHaveLength(0);
  });

  it('works without contextualize as before, and treats false as off', async () => {
    const { embedder, config } = setup({ contextualize: false });
    const stats = await ingest(config);
    expect(stats).toMatchObject({ indexed: 2, contextualized: 0 });
    expect(embedder.texts[0]).toBe('Pricing\n\nThe Team plan costs $20 per user per month, billed annually.');
    expect(PAGES['/pricing']).toBeDefined();
  });
});
