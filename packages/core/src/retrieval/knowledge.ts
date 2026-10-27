import type { KnowledgeSource } from '../knowledge/base.js';
import type { MetadataFilter } from '../storage/types.js';
import { formatSources } from './sources.js';
import type { Retriever } from './types.js';

export interface RetrieverKnowledgeOptions {
  /** Chunks per message. Default 5. */
  topK?: number;
  /** Only search these records, such as `{ locale: 'de' }`. */
  filter?: MetadataFilter;
}

/**
 * A retriever as `knowledge` for the server. The server calls `retrieve` with
 * the conversation so far and gets the chunks themselves; `getContext` is the
 * same search as a block of text, for code that only knows the older contract.
 */
export function retrieverKnowledge(retriever: Retriever, options: RetrieverKnowledgeOptions = {}): KnowledgeSource {
  const topK = options.topK ?? 5;
  return {
    type: 'retriever',
    retrieve: (query) =>
      retriever.retrieve({
        ...query,
        topK: query.topK ?? topK,
        filter: options.filter || query.filter ? { ...options.filter, ...query.filter } : undefined,
      }),
    async getContext(query) {
      return formatSources(await retriever.retrieve({ text: query, topK, filter: options.filter }));
    },
  };
}
