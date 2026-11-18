import type { RetrievalQuery, RetrievedChunk } from '../retrieval/types.js';

export interface KnowledgeSource {
  type: string;
  /** Text added to the model's context for a message. */
  getContext(query: string): Promise<string>;
  /**
   * The matching chunks themselves, with the conversation so far for
   * follow-up questions. When a source has this, the server uses it instead
   * of `getContext`, so answers can say which page they came from.
   */
  retrieve?(query: RetrievalQuery): Promise<RetrievedChunk[]>;
}
