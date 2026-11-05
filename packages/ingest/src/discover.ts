import { readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { robotsFor, type Robots } from './robots.js';
import type { DiscoveredPage, IngestSource } from './types.js';

/** Sitemap indexes can point at more indexes; this many levels is plenty. */
const MAX_SITEMAP_DEPTH = 3;
const PAGE_FILES = /\.(md|mdx|html?)$/i;

export interface DiscoverOptions {
  fetch: typeof fetch;
  userAgent: string;
  timeoutMs: number;
  include?: string[];
  exclude?: string[];
  /** Pages fetched at once during crawl. Default 4. */
  concurrency?: number;
  /** Obey robots.txt during crawl. Default true. */
  respectRobots?: boolean;
  /** Limit total pages discovered. */
  maxPages?: number;
}

export interface Discovery {
  pages: DiscoveredPage[];
  /** One line per problem. Any entry means pruning isn't safe. */
  errors: string[];
}

/** Every page the sources list, once each, filtered by `include` and `exclude`. */
export async function discover(sources: IngestSource[], options: DiscoverOptions): Promise<Discovery> {
  const pages = new Map<string, DiscoveredPage>();
  const errors: string[] = [];
  const add = (page: DiscoveredPage) => {
    const url = normalizeUrl(page.url);
    if (url && !pages.has(url) && matches(url, options.include, options.exclude)) pages.set(url, { ...page, url });
  };

  for (const source of sources) {
    if (source.type === 'urls') {
      for (const url of source.urls) add({ url });
    } else if (source.type === 'sitemap') {
      await readSitemap(source.url, options, 0, new Set(), add, errors);
    } else if (source.type === 'crawl') {
      await crawlSite(source, options, add, errors);
    } else {
      try {
        for (const page of await readDirectory(source.path, source.baseUrl)) add(page);
      } catch (error) {
        errors.push(`${source.path}: ${message(error)}`);
      }
    }
  }
  return { pages: [...pages.values()], errors };
}

async function readSitemap(
  url: string,
  options: DiscoverOptions,
  depth: number,
  seen: Set<string>,
  add: (page: DiscoveredPage) => void,
  errors: string[]
): Promise<void> {
  if (seen.has(url)) return;
  seen.add(url);
  if (depth > MAX_SITEMAP_DEPTH) {
    errors.push(`${url}: sitemap indexes nested more than ${MAX_SITEMAP_DEPTH} deep`);
    return;
  }
  let xml: string;
  try {
    const response = await options.fetch(url, {
      headers: { 'user-agent': options.userAgent },
      signal: AbortSignal.timeout(options.timeoutMs),
    });
    if (!response.ok) {
      await cancelBody(response);
      throw new Error(`HTTP ${response.status}`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    // gzip's magic number; some servers send .xml.gz without saying so.
    xml = (bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : Buffer.from(bytes)).toString('utf8');
  } catch (error) {
    errors.push(`${url}: ${message(error)}`);
    return;
  }

  const locations = [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map((match) => decodeXml(match[1]));
  if (/<sitemapindex[\s>]/i.test(xml)) {
    for (const child of locations) await readSitemap(child, options, depth + 1, seen, add, errors);
  } else if (/<urlset[\s>]/i.test(xml)) {
    for (const location of locations) add({ url: location });
  } else {
    errors.push(`${url}: not a sitemap (no <urlset> or <sitemapindex>)`);
  }
}

/** Markdown and HTML files under `path`, with URLs under `baseUrl` (`docs/intro.md` is `<baseUrl>/docs/intro`). */
async function readDirectory(path: string, baseUrl: string): Promise<DiscoveredPage[]> {
  const entries = await readdir(path, { recursive: true, withFileTypes: true });
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return entries
    .filter((entry) => entry.isFile() && PAGE_FILES.test(entry.name))
    .map((entry) => {
      const file = join(entry.parentPath, entry.name);
      const route = relative(path, file)
        .split(sep)
        .join('/')
        .replace(PAGE_FILES, '')
        .replace(/(^|\/)index$/, '$1');
      return { url: new URL(route, base).href, file };
    })
    .sort((a, b) => a.url.localeCompare(b.url));
}

const DEFAULT_CRAWL_DEPTH = 3;
const DEFAULT_CRAWL_PAGES = 500;

async function cancelBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // A failed cleanup should not prevent crawling from continuing.
  }
}

/**
 * Crawl a site breadth-first from `url`, following same-origin `<a href>`
 * links. `maxDepth` is link hops from the start (depth 0); the start counts
 * toward `maxPages`. Other origins, `mailto:`, `tel:`, fragment-only links
 * and non-HTML responses are skipped. Robots.txt is respected when
 * `respectRobots` is not false. Already-fetched HTML is stored on each page
 * so extraction doesn't fetch again.
 */
async function crawlSite(
  source: Extract<IngestSource, { type: 'crawl' }>,
  options: DiscoverOptions,
  add: (page: DiscoveredPage) => void,
  errors: string[]
): Promise<void> {
  const maxDepth = source.maxDepth ?? DEFAULT_CRAWL_DEPTH;
  let effectiveMaxPages = source.maxPages ?? DEFAULT_CRAWL_PAGES;
  if (options.maxPages !== undefined && options.maxPages >= 0) {
    effectiveMaxPages = Math.min(effectiveMaxPages, Math.floor(options.maxPages));
  }
  if (effectiveMaxPages <= 0) {
    errors.push(`stopped at --max-pages ${effectiveMaxPages}`);
    return;
  }

  const startUrl = normalizeUrl(source.url);
  if (!startUrl) {
    errors.push(`${source.url}: not a valid URL`);
    return;
  }

  // Apply existing include/exclude rules before fetching, including the starting URL.
  if (!matches(startUrl, options.include, options.exclude)) {
    errors.push(`${startUrl}: does not match include/exclude rules`);
    return;
  }

  const concurrency = Math.max(1, options.concurrency ?? 4);
  const respectRobots = options.respectRobots !== false;

  const policies = new Map<string, Promise<Robots>>();
  async function getRobots(urlOrOrigin: string): Promise<Robots | undefined> {
    if (!respectRobots) return undefined;
    const fetchWithPolicy = options.fetch as typeof fetch & { policy?: (url: string) => Promise<Robots> };
    if (typeof fetchWithPolicy.policy === 'function') {
      return fetchWithPolicy.policy(urlOrOrigin);
    }
    const o = new URL(urlOrOrigin).origin;
    let pending = policies.get(o);
    if (!pending) {
      pending = robotsFor(o, ((input, init) =>
        options.fetch(String(input), {
          ...init,
          headers: { 'user-agent': options.userAgent, ...(init?.headers as Record<string, string>) },
          signal: AbortSignal.timeout(options.timeoutMs),
        })) as typeof fetch).then((rules) => {
        if (rules.unavailable) errors.push(`${o}/robots.txt unavailable (${rules.unavailable})`);
        return rules;
      });
      policies.set(o, pending);
    }
    return pending;
  }

  let startResponse: Response;
  try {
    startResponse = await options.fetch(startUrl, {
      headers: { 'user-agent': options.userAgent, accept: 'text/html,application/xhtml+xml' },
      signal: AbortSignal.timeout(options.timeoutMs),
      redirect: 'follow',
    });
  } catch (error) {
    errors.push(`${startUrl}: ${message(error)}`);
    return;
  }

  const canonicalStartUrl = normalizeUrl(startResponse.url || startUrl) ?? (startResponse.url || startUrl);

  if (!startResponse.ok) {
    await cancelBody(startResponse);
    errors.push(`${canonicalStartUrl}: HTTP ${startResponse.status}`);
    return;
  }

  const startType = startResponse.headers.get('content-type') ?? '';
  if (startType && !/html/i.test(startType)) {
    await cancelBody(startResponse);
    const mediaType = startType.split(';')[0].trim();
    errors.push(`${canonicalStartUrl}: not HTML${mediaType ? ` (${mediaType})` : ''}`);
    return;
  }

  if (!matches(canonicalStartUrl, options.include, options.exclude)) {
    await cancelBody(startResponse);
    errors.push(`${canonicalStartUrl}: does not match include/exclude rules`);
    return;
  }

  const origin = new URL(canonicalStartUrl).origin;

  let robots: Robots | undefined;
  if (respectRobots) {
    try {
      robots = await getRobots(canonicalStartUrl);
    } catch {
      robots = undefined;
    }
    if (robots && !robots.allowed(canonicalStartUrl)) {
      await cancelBody(startResponse);
      errors.push(`${canonicalStartUrl}: disallowed by robots.txt`);
      return;
    }
  }

  let startHtml: string;
  try {
    startHtml = await startResponse.text();
  } catch (error) {
    errors.push(`${canonicalStartUrl}: ${message(error)}`);
    return;
  }

  const seen = new Set<string>();
  seen.add(startUrl);
  seen.add(canonicalStartUrl);

  add({ url: canonicalStartUrl, html: startHtml });
  let count = 1;

  let currentLevel: string[] = [];
  if (maxDepth > 0) {
    for (const href of extractLinks(startHtml, canonicalStartUrl, origin)) {
      const normalized = normalizeUrl(href);
      if (!normalized || seen.has(normalized)) continue;
      if (!matches(normalized, options.include, options.exclude)) continue;
      if (robots && !robots.allowed(normalized)) continue;
      seen.add(normalized);
      currentLevel.push(normalized);
    }
  }

  if (count >= effectiveMaxPages) {
    if (currentLevel.length > 0) {
      errors.push(`stopped at --max-pages ${effectiveMaxPages}`);
    }
    return;
  }

  let depth = 1;
  while (currentLevel.length > 0 && depth <= maxDepth && count < effectiveMaxPages) {
    const nextLevel: string[] = [];
    const isLastDepth = depth >= maxDepth;
    const pagesByPosition: Array<DiscoveredPage | undefined> = new Array(currentLevel.length);
    const linksByPosition: string[][] = Array.from({ length: currentLevel.length }, () => []);

    let nextIndex = 0;
    let inFlight = 0;
    const waiters: Array<() => void> = [];
    const notifyWaiters = () => {
      while (waiters.length > 0) waiters.shift()?.();
    };

    async function worker(): Promise<void> {
      while (true) {
        if (count >= effectiveMaxPages) return;
        if (nextIndex >= currentLevel.length) return;

        if (count + inFlight >= effectiveMaxPages) {
          if (inFlight === 0) return;
          await new Promise<void>((resolve) => waiters.push(resolve));
          continue;
        }

        const index = nextIndex++;
        const url = currentLevel[index];
        inFlight++;

        try {
          if (robots && !robots.allowed(url)) continue;

          let response: Response;
          try {
            response = await options.fetch(url, {
              headers: { 'user-agent': options.userAgent, accept: 'text/html,application/xhtml+xml' },
              signal: AbortSignal.timeout(options.timeoutMs),
              redirect: 'follow',
            });
          } catch (error) {
            errors.push(`${url}: ${message(error)}`);
            continue;
          }

          const canonicalUrl = normalizeUrl(response.url || url) ?? (response.url || url);

          if (!response.ok) {
            await cancelBody(response);
            errors.push(`${canonicalUrl}: HTTP ${response.status}`);
            continue;
          }

          let finalOrigin: string;
          try {
            finalOrigin = new URL(canonicalUrl).origin;
          } catch {
            await cancelBody(response);
            continue;
          }

          // Skip subsequent pages whose final redirected URL is outside the established crawl origin.
          if (finalOrigin !== origin) {
            await cancelBody(response);
            seen.add(canonicalUrl);
            continue;
          }

          // If same-origin redirect target was already seen, skip.
          if (canonicalUrl !== url && seen.has(canonicalUrl)) {
            await cancelBody(response);
            continue;
          }

          if (!matches(canonicalUrl, options.include, options.exclude)) {
            await cancelBody(response);
            seen.add(canonicalUrl);
            continue;
          }

          if (robots && !robots.allowed(canonicalUrl)) {
            await cancelBody(response);
            seen.add(canonicalUrl);
            continue;
          }

          const type = response.headers.get('content-type') ?? '';
          if (type && !/html/i.test(type)) {
            await cancelBody(response);
            continue;
          }

          let html: string;
          try {
            html = await response.text();
          } catch (error) {
            errors.push(`${canonicalUrl}: ${message(error)}`);
            continue;
          }

          seen.add(canonicalUrl);
          pagesByPosition[index] = { url: canonicalUrl, html };
          count++;

          if (!isLastDepth) {
            linksByPosition[index] = extractLinks(html, canonicalUrl, origin);
          }
        } finally {
          inFlight--;
          notifyWaiters();
        }
      }
    }

    const workerCount = Math.min(concurrency, currentLevel.length);
    await Promise.all(Array.from({ length: workerCount }, worker));

    for (let i = 0; i < currentLevel.length; i++) {
      const page = pagesByPosition[i];
      if (page) {
        add(page);
      }
      if (!isLastDepth) {
        for (const href of linksByPosition[i]) {
          const normalized = normalizeUrl(href);
          if (!normalized || seen.has(normalized)) continue;
          if (!matches(normalized, options.include, options.exclude)) continue;
          if (robots && !robots.allowed(normalized)) continue;
          seen.add(normalized);
          nextLevel.push(normalized);
        }
      }
    }

    const previousLength = currentLevel.length;
    currentLevel = nextLevel;
    depth++;

    if (count >= effectiveMaxPages) {
      if (nextIndex < previousLength || currentLevel.length > 0) {
        if (!errors.includes(`stopped at --max-pages ${effectiveMaxPages}`)) {
          errors.push(`stopped at --max-pages ${effectiveMaxPages}`);
        }
      }
      break;
    }
  }
}

/** Same-origin `<a href>` links on a page, resolved and filtered. */
function extractLinks(html: string, baseUrl: string, origin: string): string[] {
  const links: string[] = [];
  const anchorRegex = /<a\s+[^>]*?(?<=\s)href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/gi;
  for (const match of html.matchAll(anchorRegex)) {
    const raw = match[1] ?? match[2] ?? match[3];
    if (!raw) continue;
    const clean = raw.replace(/&amp;/g, '&').trim();
    if (!clean) continue;
    // Skip mailto:, tel:, and other non-http(s) schemes.
    if (/^(mailto|tel|javascript|data|blob):/i.test(clean)) continue;
    // Skip fragment-only links.
    if (clean.startsWith('#')) continue;

    let resolved: URL;
    try {
      resolved = new URL(clean, baseUrl);
    } catch {
      continue;
    }
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') continue;
    // Same origin only.
    if (resolved.origin !== origin) continue;
    links.push(resolved.href);
  }
  return links;
}

/** The URL without its fragment, or undefined when it isn't http(s). */
export function normalizeUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
    parsed.hash = '';
    return parsed.href;
  } catch {
    return undefined;
  }
}

/**
 * `*` matches within a path segment, `**` across segments, `?` one character.
 * A double star followed by a slash also matches no segments at all, so
 * "docs, any folders, *.md" matches docs/a.md as well as docs/x/a.md.
 */
export function globToRegExp(glob: string): RegExp {
  let source = '';
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i];
    if (char === '*' && glob[i + 1] === '*' && glob[i + 2] === '/') {
      source += '(?:.*/)?';
      i += 2;
    } else if (char === '*' && glob[i + 1] === '*') {
      source += '.*';
      i++;
    } else if (char === '*') {
      source += '[^/]*';
    } else if (char === '?') {
      source += '[^/]';
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${source}$`);
}

export function matches(url: string, include?: string[], exclude?: string[]): boolean {
  if (include?.length && !include.some((glob) => globToRegExp(glob).test(url))) return false;
  return !exclude?.some((glob) => globToRegExp(glob).test(url));
}

function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
