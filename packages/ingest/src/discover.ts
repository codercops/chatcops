import { readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { gunzipSync } from 'node:zlib';
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
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
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

/** `*` matches within a path segment, `**` across segments, `?` one character. */
export function globToRegExp(glob: string): RegExp {
  let source = '';
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i];
    if (char === '*' && glob[i + 1] === '*') {
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
