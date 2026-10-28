import type { Embedder, KeyValueStore, MetadataValue, VectorStore } from '@chatcops/core';

export type IngestSource =
  /** A sitemap, a sitemap index, or a gzipped one (`.xml.gz`). */
  | { type: 'sitemap'; url: string }
  /** Pages listed by hand. */
  | { type: 'urls'; urls: string[] }
  /** Local `.md`, `.mdx` and `.html` files, published under `baseUrl`. */
  | { type: 'directory'; path: string; baseUrl: string };

export interface IngestConfig {
  /** Names the index, so a new one can be built next to the old. Default `default`. */
  index?: string;
  sources: IngestSource[];
  /** Only URLs matching one of these globs (`*` within a path segment, `**` across them). */
  include?: string[];
  /** URLs matching any of these are skipped. */
  exclude?: string[];
  /** A CSS selector for the content, by URL glob, for pages where automatic extraction misses it. */
  selectors?: Record<string, string>;
  /** Default `ChatCopsBot/<version> (+https://chat.codercops.com/bot)`. */
  userAgent?: string;
  /** Obey robots.txt and crawl-delay for network sources. Default true. */
  respectRobots?: boolean;
  /** Index at most this many pages (after include/exclude), for a quick look at a big site. */
  maxPages?: number;
  /** Pages fetched at once. Default 4. */
  concurrency?: number;
  /** Per page. Default 30 seconds. */
  timeoutMs?: number;
  chunk?: { targetTokens?: number; overlapTokens?: number };
  embedder: Embedder;
  store: VectorStore;
  /** Remembers what was indexed, so unchanged pages aren't embedded again. */
  manifest: KeyValueStore;
  /** Extra metadata for every chunk of a page, such as `{ collection: 'docs' }`. */
  metadata?: (doc: ExtractedDoc) => Record<string, MetadataValue>;
  /** Discover, fetch, extract and chunk, but write nothing and embed nothing. */
  dryRun?: boolean;
  /** Re-embed every page, even unchanged ones. */
  force?: boolean;
  /**
   * Remove pages that are in the index but no longer discovered. Skipped when
   * discovery or robots.txt errors prevent verifying the site's pages.
   */
  prune?: boolean;
  /** Progress, one event per page and step. */
  onEvent?: (event: IngestEvent) => void;
  /** For tests and proxies. */
  fetch?: typeof fetch;
}

export interface DiscoveredPage {
  url: string;
  /** For directory sources: the file to read instead of fetching. */
  file?: string;
}

export interface ExtractedDoc {
  url: string;
  title?: string;
  /** From `<html lang>`, such as `de` or `pt-BR`. */
  lang?: string;
  description?: string;
  markdown: string;
}

export interface Chunk {
  /** 0-based position in the page. */
  index: number;
  /** What's embedded and stored: the heading path, then the text. */
  text: string;
  /** The headings above this chunk, such as `Pricing > Enterprise`. */
  section?: string;
}

export type IngestEvent =
  | { type: 'discovered'; pages: number; errors: string[] }
  | { type: 'page'; url: string; status: 'indexed' | 'unchanged' | 'skipped' | 'failed'; chunks?: number; reason?: string }
  | { type: 'pruned'; url: string };

export interface IngestStats {
  discovered: number;
  indexed: number;
  unchanged: number;
  skipped: number;
  failed: number;
  pruned: number;
  chunks: number;
  /** Texts sent to the embedder. 0 on a re-run where nothing changed. */
  embedded: number;
  /** Discovery problems and unavailable robots.txt policies, once per origin. */
  errors: string[];
  /** Why pruning didn't run, when it was asked for. */
  pruneSkipped?: string;
}
