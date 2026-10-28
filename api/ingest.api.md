# @chatcops/ingest public API

Made by `node scripts/api-snapshot.mjs` from the built types. Don't edit it by hand: change the code, build, and run the script again.

## `@chatcops/ingest`

```ts
export interface Chunk {
    index: number;
    text: string;
    section?: string;
}

export declare function chunkDoc(doc: ExtractedDoc, options?: ChunkOptions): Chunk[];

export declare function chunkId(url: string, index: number): string;

export interface ChunkOptions {
    targetTokens?: number;
    overlapTokens?: number;
}

export declare const DEFAULT_USER_AGENT = "ChatCopsBot/0.1 (+https://chat.codercops.com/bot)";

export declare function discover(sources: IngestSource[], options: DiscoverOptions): Promise<Discovery>;

export interface DiscoveredPage {
    url: string;
    file?: string;
}

export interface DiscoverOptions {
    fetch: typeof fetch;
    userAgent: string;
    timeoutMs: number;
    include?: string[];
    exclude?: string[];
}

export interface Discovery {
    pages: DiscoveredPage[];
    errors: string[];
}

export declare function estimateTokens(text: string): number;

export interface ExtractedDoc {
    url: string;
    title?: string;
    lang?: string;
    description?: string;
    markdown: string;
}

export declare function extractHtml(html: string, url: string, selector?: string): ExtractedDoc;

export declare function extractMarkdown(source: string, url: string): ExtractedDoc;

export declare function globToRegExp(glob: string): RegExp;

export declare function ingest(config: IngestConfig): Promise<IngestStats>;

export interface IngestConfig {
    index?: string;
    sources: IngestSource[];
    include?: string[];
    exclude?: string[];
    selectors?: Record<string, string>;
    userAgent?: string;
    respectRobots?: boolean;
    maxPages?: number;
    concurrency?: number;
    timeoutMs?: number;
    chunk?: {
        overlapTokens?: number;
        targetTokens?: number;
    };
    embedder: Embedder;
    store: VectorStore;
    manifest: KeyValueStore;
    metadata?: (doc: ExtractedDoc) => Record<string, MetadataValue>;
    dryRun?: boolean;
    force?: boolean;
    prune?: boolean;
    onEvent?: (event: IngestEvent) => void;
    fetch?: typeof fetch;
}

export type IngestEvent = {
    errors: string[];
    pages: number;
    type: 'discovered';
} | {
    chunks?: number;
    reason?: string;
    status: 'indexed' | 'unchanged' | 'skipped' | 'failed';
    type: 'page';
    url: string;
} | {
    type: 'pruned';
    url: string;
};

export type IngestSource = {
    type: 'sitemap';
    url: string;
} | {
    type: 'urls';
    urls: string[];
} | {
    baseUrl: string;
    path: string;
    type: 'directory';
};

export interface IngestStats {
    discovered: number;
    indexed: number;
    unchanged: number;
    skipped: number;
    failed: number;
    pruned: number;
    chunks: number;
    embedded: number;
    errors: string[];
    pruneSkipped?: string;
}

export declare function manifestKeys(index: string): {
    meta: string;
    page: (url: string) => string;
    pages: string;
};

export declare function normalizeUrl(url: string): string | undefined;

export declare function parseRobots(text: string): Robots;

export interface Robots {
    allowed(url: string): boolean;
    sitemaps: string[];
    unavailable?: string;
    crawlDelay?: number;
}

export declare function robotsFor(origin: string, send?: typeof fetch): Promise<Robots>;
```
