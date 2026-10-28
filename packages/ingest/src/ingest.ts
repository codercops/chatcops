import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { VectorRecord } from '@chatcops/core';
import { chunkDoc } from './chunk.js';
import { discover, globToRegExp } from './discover.js';
import { extractHtml, extractMarkdown } from './extract.js';
import { robotsFor, type Robots } from './robots.js';
import type { DiscoveredPage, ExtractedDoc, IngestConfig, IngestStats } from './types.js';

export const DEFAULT_USER_AGENT = 'ChatCopsBot/0.1 (+https://chat.codercops.com/bot)';

/** What the manifest remembers about an indexed page. */
interface PageRecord {
  contentHash: string;
  chunkIds: string[];
  etag?: string;
  lastModified?: string;
}

interface IndexMeta {
  embedder: string;
  dimensions: number;
}

type Fetched =
  | { kind: 'page'; doc: ExtractedDoc; etag?: string; lastModified?: string }
  | { kind: 'not-modified' }
  | { kind: 'skip'; reason: string };

/**
 * Builds or refreshes a knowledge index: discovers pages, fetches and
 * extracts each one, splits it into chunks, embeds them and writes them to
 * the store. Pages that haven't changed since the last run (same ETag, or
 * the same extracted text) aren't embedded again, so re-running costs
 * nothing until the site changes. Refuses to mix embedders in one index.
 */
export async function ingest(config: IngestConfig): Promise<IngestStats> {
  const index = config.index ?? 'default';
  const rawFetch = config.fetch ?? fetch;
  const userAgent = config.userAgent ?? DEFAULT_USER_AGENT;
  const timeoutMs = config.timeoutMs ?? 30_000;
  const keys = manifestKeys(index);
  const { embedder, store, manifest } = config;
  const policies = new Map<string, Promise<Robots>>();
  const lastRequest = new Map<string, number>();
  const queues = new Map<string, Promise<void>>();

  async function scheduled(url: string, init?: RequestInit, delay = 0): Promise<Response> {
    const origin = new URL(url).origin;
    const start = async () => {
      const due = (lastRequest.get(origin) ?? -Infinity) + delay * 1000;
      // Timers can fire early; use a monotonic clock and recheck the deadline.
      while (performance.now() < due) await new Promise((resolve) => setTimeout(resolve, Math.ceil(due - performance.now())));
      lastRequest.set(origin, performance.now());
      return { response: rawFetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) }) };
    };
    const started = delay > 0 ? (queues.get(origin) ?? Promise.resolve()).then(start) : start();
    queues.set(origin, started.then(() => {}));
    return (await started).response;
  }

  function policy(url: string): Promise<Robots> {
    const origin = new URL(url).origin;
    let pending = policies.get(origin);
    if (!pending) {
      pending = robotsFor(origin, ((input, init) => scheduled(String(input), {
        ...init, headers: { 'user-agent': userAgent }, signal: AbortSignal.timeout(timeoutMs),
      })) as typeof fetch);
      policies.set(origin, pending);
    }
    return pending;
  }

  const send: typeof fetch = async (input, init) => {
    const url = String(input);
    const rules = config.respectRobots === false ? undefined : await policy(url);
    return scheduled(url, init, rules?.crawlDelay);
  };

  if (embedder.dimensions !== store.dimensions) {
    throw new Error(
      `The embedder (${embedder.id}) makes ${embedder.dimensions}-dimension vectors, but the store holds ${store.dimensions}.`
    );
  }
  const meta = await manifest.get<IndexMeta>(keys.meta);
  if (meta && meta.embedder !== embedder.id) {
    throw new Error(
      `Index "${index}" was built with ${meta.embedder}, not ${embedder.id}. Vectors from different embedders can't be searched together: use the same embedder, or build a new index with another name.`
    );
  }

  const found = await discover(config.sources, { fetch: send, userAgent, timeoutMs, include: config.include, exclude: config.exclude });
  if (config.maxPages !== undefined && config.maxPages >= 0 && found.pages.length > config.maxPages) {
    found.pages = found.pages.slice(0, Math.floor(config.maxPages));
    // Pages left out aren't removed pages, so pruning a partial run isn't safe either.
    found.errors.push(`stopped at --max-pages ${config.maxPages}`);
  }
  config.onEvent?.({ type: 'discovered', pages: found.pages.length, errors: found.errors });

  const stats: IngestStats = {
    discovered: found.pages.length,
    indexed: 0,
    unchanged: 0,
    skipped: 0,
    failed: 0,
    pruned: 0,
    chunks: 0,
    embedded: 0,
    errors: found.errors,
  };
  if (!config.dryRun) await manifest.set(keys.meta, { embedder: embedder.id, dimensions: embedder.dimensions } satisfies IndexMeta);

  const selectors = Object.entries(config.selectors ?? {}).map(([glob, selector]) => ({ test: globToRegExp(glob), selector }));
  const selectorFor = (url: string) => selectors.find((entry) => entry.test.test(url))?.selector;

  async function load(page: DiscoveredPage, previous: PageRecord | null): Promise<Fetched> {
    if (page.file) {
      const source = await readFile(page.file, 'utf8');
      const doc = /\.html?$/i.test(page.file) ? extractHtml(source, page.url, selectorFor(page.url)) : extractMarkdown(source, page.url);
      return { kind: 'page', doc };
    }
    if (config.respectRobots !== false && !(await policy(page.url)).allowed(page.url)) {
      return { kind: 'skip', reason: 'blocked by robots.txt' };
    }
    const headers: Record<string, string> = { 'user-agent': userAgent, accept: 'text/html,application/xhtml+xml' };
    if (previous && !config.force) {
      if (previous.etag) headers['if-none-match'] = previous.etag;
      if (previous.lastModified) headers['if-modified-since'] = previous.lastModified;
    }
    const response = await send(page.url, { headers, signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' });
    if (response.status === 304) return { kind: 'not-modified' };
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const type = response.headers.get('content-type') ?? '';
    if (type && !/html/i.test(type)) return { kind: 'skip', reason: `not HTML (${type.split(';')[0]})` };
    const doc = extractHtml(await response.text(), page.url, selectorFor(page.url));
    return {
      kind: 'page',
      doc,
      ...(response.headers.get('etag') ? { etag: response.headers.get('etag') as string } : {}),
      ...(response.headers.get('last-modified') ? { lastModified: response.headers.get('last-modified') as string } : {}),
    };
  }

  async function process(page: DiscoveredPage): Promise<void> {
    const pageKey = keys.page(page.url);
    const previous = await manifest.get<PageRecord>(pageKey);
    try {
      const fetched = await load(page, previous);
      if (fetched.kind === 'skip') {
        stats.skipped++;
        config.onEvent?.({ type: 'page', url: page.url, status: 'skipped', reason: fetched.reason });
        return;
      }
      if (fetched.kind === 'not-modified') {
        stats.unchanged++;
        config.onEvent?.({ type: 'page', url: page.url, status: 'unchanged' });
        return;
      }
      const contentHash = sha256(fetched.doc.markdown);
      if (previous && previous.contentHash === contentHash && !config.force) {
        stats.unchanged++;
        if (!config.dryRun && (fetched.etag !== previous.etag || fetched.lastModified !== previous.lastModified)) {
          await manifest.set(pageKey, { ...previous, etag: fetched.etag, lastModified: fetched.lastModified });
        }
        config.onEvent?.({ type: 'page', url: page.url, status: 'unchanged' });
        return;
      }
      const chunks = chunkDoc(fetched.doc, config.chunk);
      if (!chunks.length) {
        stats.skipped++;
        config.onEvent?.({ type: 'page', url: page.url, status: 'skipped', reason: 'no text' });
        return;
      }
      stats.chunks += chunks.length;
      if (config.dryRun) {
        stats.indexed++;
        config.onEvent?.({ type: 'page', url: page.url, status: 'indexed', chunks: chunks.length });
        return;
      }
      const vectors = await embedder.embed(chunks.map((chunk) => chunk.text), 'document');
      stats.embedded += chunks.length;
      const metadata = {
        ...(fetched.doc.lang ? { locale: fetched.doc.lang } : {}),
        ...config.metadata?.(fetched.doc),
      };
      const records: VectorRecord[] = chunks.map((chunk, i) => ({
        id: chunkId(page.url, chunk.index),
        vector: vectors[i],
        text: chunk.text,
        source: {
          id: page.url,
          url: page.url,
          ...(fetched.doc.title ? { title: fetched.doc.title } : {}),
          ...(chunk.section ? { section: chunk.section } : {}),
        },
        ...(Object.keys(metadata).length ? { metadata } : {}),
      }));
      // The new chunks are embedded before the old ones go, so a failed
      // embedding never leaves the page out of the index.
      if (previous) await store.deleteBySource(page.url);
      await store.upsert(records);
      await manifest.set(pageKey, {
        contentHash,
        chunkIds: records.map((record) => record.id),
        ...(fetched.etag ? { etag: fetched.etag } : {}),
        ...(fetched.lastModified ? { lastModified: fetched.lastModified } : {}),
      } satisfies PageRecord);
      stats.indexed++;
      config.onEvent?.({ type: 'page', url: page.url, status: 'indexed', chunks: chunks.length });
    } catch (error) {
      stats.failed++;
      config.onEvent?.({ type: 'page', url: page.url, status: 'failed', reason: error instanceof Error ? error.message : String(error) });
    }
  }

  await inPool(found.pages, Math.max(1, config.concurrency ?? 4), process);

  const known = new Set((await manifest.get<string[]>(keys.pages)) ?? []);
  const discovered = new Set(found.pages.map((page) => page.url));
  if (config.prune) {
    if (found.errors.length) {
      stats.pruneSkipped = `${found.errors.length} discovery error(s): a page missing from a broken sitemap isn't a removed page`;
    } else if (!config.dryRun) {
      for (const url of known) {
        if (discovered.has(url)) continue;
        await store.deleteBySource(url);
        await manifest.delete(keys.page(url));
        known.delete(url);
        stats.pruned++;
        config.onEvent?.({ type: 'pruned', url });
      }
    } else {
      stats.pruned = [...known].filter((url) => !discovered.has(url)).length;
    }
  }
  if (!config.dryRun) {
    for (const url of discovered) {
      if (await manifest.get(keys.page(url))) known.add(url);
    }
    await manifest.set(keys.pages, [...known].sort());
  }
  return stats;
}

/** Where the manifest keeps an index's records, under one prefix per index. */
export function manifestKeys(index: string) {
  const prefix = `chatcops:ingest:${index}`;
  return {
    meta: `${prefix}:meta`,
    pages: `${prefix}:pages`,
    page: (url: string) => `${prefix}:page:${url}`,
  };
}

/** Stable per page and position, so re-indexing a page replaces its chunks. */
export function chunkId(url: string, index: number): string {
  return sha256(`${url}#${index}`);
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

async function inPool<T>(items: T[], size: number, run: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await run(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
}
