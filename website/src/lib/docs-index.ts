import {
  hybridRetriever,
  memoryVectors,
  openaiEmbedder,
  retrieverKnowledge,
  type KnowledgeSource,
  type Retriever,
  type VectorRecord,
} from '@chatcops/core';

// The docs bot's knowledge: the index scripts/docs-index.mjs builds from the
// docs pages (public/docs-index/), searched in memory with hybrid search.
// Shared by the chat endpoint, which reads the files from the Worker's
// assets, and the evals, which read them from disk. Plain imports only, so
// Node can load it outside Astro.

interface DocsIndexFile {
  embedder: string;
  dimensions: number;
  chunks: Array<Pick<VectorRecord, 'id' | 'text' | 'source' | 'metadata'>>;
}

/** Reads one file of the index: `chunks.json` or `vectors.bin`. */
export type ReadIndexFile = (name: 'chunks.json' | 'vectors.bin') => Promise<ArrayBuffer>;

/**
 * Knowledge from the docs index. The index loads on the first question, once
 * per Worker instance, and the question is embedded with the same OpenAI
 * model the index was built with.
 */
export function docsKnowledge(read: ReadIndexFile, openaiApiKey: string): KnowledgeSource {
  let loaded: Promise<Retriever> | undefined;
  const load = async () => {
    const [chunksFile, vectorsFile] = await Promise.all([read('chunks.json'), read('vectors.bin')]);
    const index = JSON.parse(new TextDecoder().decode(chunksFile)) as DocsIndexFile;
    const vectors = new Float32Array(vectorsFile);
    if (vectors.length !== index.chunks.length * index.dimensions) {
      throw new Error(`The docs index is damaged: ${vectors.length} numbers for ${index.chunks.length} chunks of ${index.dimensions}.`);
    }
    const embedder = openaiEmbedder({ apiKey: openaiApiKey, dimensions: index.dimensions });
    if (embedder.id !== index.embedder) {
      throw new Error(`The docs index was built with ${index.embedder}, not ${embedder.id}. Run npm run docs-index again.`);
    }
    const store = memoryVectors({ dimensions: index.dimensions });
    await store.upsert(
      index.chunks.map((chunk, i) => ({ ...chunk, vector: vectors.subarray(i * index.dimensions, (i + 1) * index.dimensions) }))
    );
    return hybridRetriever({ store, embedder });
  };
  const search = () => {
    // A failed load is tried again on the next question instead of being kept.
    loaded ??= load().catch((error: unknown) => {
      loaded = undefined;
      throw error;
    });
    return loaded;
  };
  return retrieverKnowledge({ retrieve: async (query) => (await search()).retrieve(query) }, { topK: 5 });
}
