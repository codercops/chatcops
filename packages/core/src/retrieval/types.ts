import type { MetadataFilter, MetadataValue, VectorSource } from '../storage/types.js';
import type { ChatMessage } from '../types.js';

/** Turns text into vectors. The same embedder has to build an index and search it. */
export interface Embedder {
  /**
   * Names the model and size, such as `openai:text-embedding-3-small@1024`.
   * Stored with an index, so searching it with a different embedder is caught.
   */
  readonly id: string;
  readonly dimensions: number;
  /**
   * One vector per text, in order. Some models embed a search query
   * differently from the documents it searches, hence `kind`.
   */
  embed(texts: string[], kind: 'document' | 'query', options?: { signal?: AbortSignal }): Promise<Float32Array[]>;
}

/** A piece of a page that matched a question. */
export interface RetrievedChunk {
  id: string;
  text: string;
  /** Higher is better. Only comparable between chunks from the same retriever. */
  score: number;
  source: VectorSource;
  metadata?: Record<string, MetadataValue>;
}

export interface RetrievalQuery {
  /** The visitor's latest message. */
  text: string;
  /** How many chunks to return. Retrievers default to 5. */
  topK?: number;
  filter?: MetadataFilter;
  /** The conversation before `text`, oldest first, for follow-up questions. */
  history?: ChatMessage[];
  signal?: AbortSignal;
}

export interface Retriever {
  retrieve(query: RetrievalQuery): Promise<RetrievedChunk[]>;
}
