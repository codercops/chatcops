import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { memoryStorage, memoryVectors, type Embedder, type KeyValueStore } from '@chatcops/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chunkId, discover, globToRegExp, ingest, manifestKeys, type IngestConfig } from '../src/index.js';
import { fixtureSite, type FixtureSite } from './site.js';

/** Counts what it's asked to embed; every text gets the same small vector. */
function countingEmbedder(id = 'test:counting@4'): Embedder & { texts: string[] } {
  const texts: string[] = [];
  return {
    id,
    dimensions: 4,
    texts,
    async embed(batch) {
      texts.push(...batch);
      return batch.map((text) => Float32Array.from([1, text.length % 7, 0, 1]));
    },
  };
}

let site: FixtureSite;
beforeAll(async () => {
  site = await fixtureSite();
});
afterAll(async () => {
  await site.close();
});

const discoverOptions = () => ({ fetch, userAgent: 'test', timeoutMs: 5000 });

describe('discover', () => {
  it('reads a sitemap index, plain and gzipped sitemaps, and drops fragments and duplicates', async () => {
    const { pages, errors } = await discover([{ type: 'sitemap', url: `${site.url}/sitemap.xml` }], discoverOptions());
    expect(errors).toEqual([]);
    expect(pages.map((p) => p.url.replace(site.url, '')).sort()).toEqual(['/files/manual.pdf', '/ja/pricing', '/pricing', '/refunds']);
  });

  it('filters with include and exclude globs', async () => {
    const { pages } = await discover([{ type: 'sitemap', url: `${site.url}/sitemap.xml` }], {
      ...discoverOptions(),
      include: [`${site.url}/**`],
      exclude: ['**/ja/**', '**.pdf'],
    });
    expect(pages.map((p) => p.url.replace(site.url, '')).sort()).toEqual(['/pricing', '/refunds']);
  });

  it('reports a missing sitemap or a page that is not one, and keeps going', async () => {
    const { pages, errors } = await discover(
      [
        { type: 'sitemap', url: `${site.url}/missing.xml` },
        { type: 'sitemap', url: `${site.url}/broken.xml` },
        { type: 'urls', urls: [`${site.url}/pricing`, 'mailto:hi@acme.test', 'not a url'] },
      ],
      discoverOptions()
    );
    expect(errors).toEqual([`${site.url}/missing.xml: HTTP 404`, `${site.url}/broken.xml: not a sitemap (no <urlset> or <sitemapindex>)`]);
    expect(pages.map((p) => p.url)).toEqual([`${site.url}/pricing`]);
  });

  it('reads a folder of Markdown and HTML files as pages under a base URL', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'chatcops-ingest-'));
    mkdirSync(join(dir, 'guide'));
    writeFileSync(join(dir, 'index.md'), '# Home');
    writeFileSync(join(dir, 'guide', 'install.mdx'), '# Install');
    writeFileSync(join(dir, 'guide', 'faq.html'), '<p>FAQ</p>');
    writeFileSync(join(dir, 'notes.txt'), 'ignored');
    try {
      const { pages } = await discover([{ type: 'directory', path: dir, baseUrl: 'https://docs.acme.test/' }], discoverOptions());
      expect(pages.map((p) => p.url)).toEqual(['https://docs.acme.test/', 'https://docs.acme.test/guide/faq', 'https://docs.acme.test/guide/install']);
      expect(pages.every((p) => p.file?.startsWith(dir))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('turns globs into anchored patterns', () => {
    expect(globToRegExp('https://acme.test/docs/*').test('https://acme.test/docs/a')).toBe(true);
    expect(globToRegExp('https://acme.test/docs/*').test('https://acme.test/docs/a/b')).toBe(false);
    expect(globToRegExp('https://acme.test/**').test('https://acme.test/docs/a/b')).toBe(true);
    expect(globToRegExp('https://acme.test/doc?').test('https://acme.test/docs')).toBe(true);
  });
});

describe('ingest', () => {
  let kv: KeyValueStore;
  const setup = (overrides: Partial<IngestConfig> = {}) => {
    const embedder = countingEmbedder();
    const store = memoryVectors({ dimensions: 4 });
    kv = memoryStorage().kv as KeyValueStore;
    const config: IngestConfig = { sources: [{ type: 'sitemap', url: `${site.url}/sitemap.xml` }], embedder, store, manifest: kv, ...overrides };
    return { embedder, store, config };
  };

  it('indexes every HTML page, skips non-HTML, and keeps the page and section on each chunk', async () => {
    const { embedder, store, config } = setup();
    const events: string[] = [];
    const stats = await ingest({ ...config, onEvent: (e) => e.type === 'page' && events.push(`${e.status}`) });

    expect(stats).toMatchObject({ discovered: 4, indexed: 3, skipped: 1, failed: 0, errors: [] });
    expect(stats.embedded).toBe(embedder.texts.length);
    expect(stats.chunks).toBe(embedder.texts.length);
    expect(events.filter((e) => e === 'indexed')).toHaveLength(3);

    const [hit] = await store.query({ vector: Float32Array.from([1, 0, 0, 1]), topK: 1, filter: { locale: 'ja' } });
    expect(hit.source).toMatchObject({ id: `${site.url}/ja/pricing`, url: `${site.url}/ja/pricing`, title: '料金' });
    const keyword = await store.keywordQuery?.({ text: 'Enterprise SSO', topK: 1 });
    expect(keyword?.[0]).toMatchObject({ id: chunkId(`${site.url}/pricing`, 1), source: { section: 'Pricing > Enterprise' } });
    // Hidden injection text never reaches the index.
    expect(embedder.texts.join('\n')).not.toContain('Ignore previous instructions');
  });

  it('embeds nothing on a second run when nothing changed', async () => {
    const { embedder, config } = setup();
    await ingest(config);
    const first = embedder.texts.length;
    const stats = await ingest(config);
    expect(embedder.texts.length).toBe(first);
    expect(stats).toMatchObject({ indexed: 0, unchanged: 3, embedded: 0 });
    // ETags from the first run made the pages answer 304.
    expect(site.requests.filter((path) => path === '/pricing').length).toBeGreaterThanOrEqual(2);
  });

  it('re-embeds only the page that changed, and replaces its old chunks', async () => {
    const { embedder, store, config } = setup();
    await ingest(config);
    embedder.texts.length = 0;
    const original = (await import('./site.js')).PAGES['/refunds'];
    site.set('/refunds', original.replace('30 days', '60 days'));
    try {
      const stats = await ingest(config);
      expect(stats).toMatchObject({ indexed: 1, unchanged: 2 });
      expect(embedder.texts.every((text) => text.startsWith('Refund policy'))).toBe(true);
      const found = await store.keywordQuery?.({ text: '60 days', topK: 5 });
      expect(found?.[0].text).toContain('60 days');
      const old = await store.keywordQuery?.({ text: '30 days', topK: 5 });
      expect(old?.some((r) => r.text.includes('30 days'))).toBe(false);
    } finally {
      site.set('/refunds', original);
    }
  });

  it('re-embeds everything with force', async () => {
    const { embedder, config } = setup();
    await ingest(config);
    const first = embedder.texts.length;
    const stats = await ingest({ ...config, force: true });
    expect(stats.indexed).toBe(3);
    expect(embedder.texts.length).toBe(first * 2);
  });

  it('prunes pages that are no longer discovered', async () => {
    const { store, config } = setup();
    await ingest(config);
    const stats = await ingest({ ...config, sources: [{ type: 'urls', urls: [`${site.url}/pricing`] }], prune: true });
    expect(stats.pruned).toBe(2);
    expect(await kv.get(manifestKeys('default').page(`${site.url}/refunds`))).toBeNull();
    expect(await kv.get(manifestKeys('default').pages)).toEqual([`${site.url}/pricing`]);
    const left = await store.query({ vector: Float32Array.from([1, 1, 0, 1]), topK: 50 });
    expect(new Set(left.map((r) => r.source.id))).toEqual(new Set([`${site.url}/pricing`]));
  });

  it('never prunes after a discovery error, since a broken sitemap would look like every page was removed', async () => {
    const { store, config } = setup();
    await ingest(config);
    const before = (await store.query({ vector: Float32Array.from([1, 1, 0, 1]), topK: 50 })).length;
    const stats = await ingest({ ...config, sources: [{ type: 'sitemap', url: `${site.url}/missing.xml` }], prune: true });
    expect(stats.pruned).toBe(0);
    expect(stats.pruneSkipped).toContain('1 discovery error');
    expect((await store.query({ vector: Float32Array.from([1, 1, 0, 1]), topK: 50 })).length).toBe(before);
  });

  it('writes and embeds nothing in a dry run, but still counts', async () => {
    const { embedder, store, config } = setup();
    const stats = await ingest({ ...config, dryRun: true });
    expect(stats.indexed).toBe(3);
    expect(stats.chunks).toBeGreaterThan(0);
    expect(embedder.texts).toEqual([]);
    expect(await store.query({ vector: Float32Array.from([1, 1, 0, 1]), topK: 5 })).toEqual([]);
    expect(await kv.get(manifestKeys('default').meta)).toBeNull();
  });

  it('refuses an embedder that is not the one the index was built with, or that does not fit the store', async () => {
    const { config } = setup();
    await ingest(config);
    await expect(ingest({ ...config, embedder: countingEmbedder('other:model@4') })).rejects.toThrow(
      'Index "default" was built with test:counting@4, not other:model@4.'
    );
    await expect(ingest({ ...config, store: memoryVectors({ dimensions: 8 }) })).rejects.toThrow('the store holds 8');
    // A different index name is a separate index.
    await expect(ingest({ ...config, index: 'v2', embedder: countingEmbedder('other:model@4'), dryRun: true })).resolves.toBeDefined();
  });

  it('counts a page that fails and carries on with the rest', async () => {
    const { config } = setup({ sources: [{ type: 'urls', urls: [`${site.url}/pricing`, `${site.url}/gone`] }] });
    const reasons: string[] = [];
    const stats = await ingest({ ...config, onEvent: (e) => e.type === 'page' && e.reason && reasons.push(e.reason) });
    expect(stats).toMatchObject({ indexed: 1, failed: 1 });
    expect(reasons).toContain('HTTP 404');
  });

  it('uses a selector for matching pages and adds custom metadata', async () => {
    const { store, config } = setup({ sources: [{ type: 'urls', urls: [`${site.url}/pricing`] }] });
    await ingest({ ...config, selectors: { '**/pricing': 'table' }, metadata: (doc) => ({ collection: 'docs', titled: !!doc.title }) });
    const all = await store.query({ vector: Float32Array.from([1, 1, 0, 1]), topK: 10, filter: { collection: 'docs' } });
    expect(all).toHaveLength(1);
    expect(all[0].text).toContain('| Team | $20 |');
    expect(all[0].text).not.toContain('Enterprise plans include SSO');
    expect(all[0].metadata).toEqual({ locale: 'en', collection: 'docs', titled: true });
  });

  it('reads directory sources from disk without fetching', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'chatcops-ingest-'));
    writeFileSync(join(dir, 'install.md'), '---\ntitle: Install\n---\n\nRun `npm i chatcops`.');
    try {
      const { store, config } = setup({ sources: [{ type: 'directory', path: dir, baseUrl: 'https://docs.acme.test/' }] });
      const requests = site.requests.length;
      const stats = await ingest(config);
      expect(stats.indexed).toBe(1);
      expect(site.requests.length).toBe(requests);
      const [hit] = await store.query({ vector: Float32Array.from([1, 1, 0, 1]), topK: 1 });
      expect(hit).toMatchObject({ text: 'Install\n\nRun `npm i chatcops`.', source: { url: 'https://docs.acme.test/install', title: 'Install' } });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
