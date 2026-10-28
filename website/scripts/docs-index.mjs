// Builds the docs bot's knowledge index from the docs pages in this repo:
// public/docs-index/chunks.json (the text and where it's from) and
// public/docs-index/vectors.bin (the embeddings, float32, in chunk order).
// The chat endpoint and the evals load them with src/lib/docs-index.ts.
//
//   npm run docs-index        (needs OPENAI_API_KEY; the npm script reads the repo's .env)
//
// Run it again when the docs change. CI warns when the index is out of date.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { memoryStorage, openaiEmbedder } from '@chatcops/core';
import { ingest } from '@chatcops/ingest';
import { DOCS_INDEX_DIMENSIONS, docsPages, SITE } from './docs-pages.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'docs-index');

if (!process.env.OPENAI_API_KEY) {
  console.error('docs-index needs OPENAI_API_KEY (the npm script reads it from the repo .env).');
  process.exit(2);
}
const embedder = openaiEmbedder({ apiKey: process.env.OPENAI_API_KEY, dimensions: DOCS_INDEX_DIMENSIONS });

// ingest() writes to a vector store; this one only keeps what it's given.
const records = new Map();
const store = {
  dimensions: embedder.dimensions,
  async upsert(batch) {
    for (const record of batch) records.set(record.id, record);
  },
  async query() {
    return [];
  },
  async deleteBySource(sourceId) {
    for (const [id, record] of records) if (record.source.id === sourceId) records.delete(id);
  },
};

const stats = await ingest({
  sources: [{ type: 'directory', path: join(root, 'src', 'content', 'docs'), baseUrl: SITE }],
  embedder,
  store,
  manifest: memoryStorage().kv,
});
if (stats.failed || stats.errors.length) {
  console.error(`Indexing failed: ${stats.failed} pages failed, ${stats.errors.join('; ')}`);
  process.exit(1);
}

// Starlight serves every page with a trailing slash, so citations link there.
const withSlash = (url) => (url.endsWith('/') ? url : `${url}/`);
const chunks = [...records.values()].sort((a, b) => a.id.localeCompare(b.id));
const vectors = new Float32Array(chunks.length * embedder.dimensions);
chunks.forEach((chunk, i) => vectors.set(chunk.vector, i * embedder.dimensions));

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'vectors.bin'), Buffer.from(vectors.buffer));
writeFileSync(
  join(out, 'chunks.json'),
  `${JSON.stringify(
    {
      embedder: embedder.id,
      dimensions: embedder.dimensions,
      // What the index was built from, so CI can tell when the docs changed since.
      pages: docsPages(root),
      chunks: chunks.map(({ id, text, source, metadata }) => ({
        id,
        text,
        source: { ...source, id: withSlash(source.id), url: withSlash(source.url) },
        ...(metadata ? { metadata } : {}),
      })),
    },
    null,
    1
  )}\n`
);
console.log(`Indexed ${stats.indexed} pages into ${chunks.length} chunks (${embedder.id}).`);
