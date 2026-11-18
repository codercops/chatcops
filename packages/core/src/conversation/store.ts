import type { Conversation } from '../types.js';
import type { ConversationStore } from '../storage/types.js';

export type { ConversationStore } from '../storage/types.js';

/**
 * The 0.4 in-memory store. Unbounded and without `append`; `memoryStorage()`
 * replaces it.
 */
export class MemoryStore implements ConversationStore {
  private store = new Map<string, Conversation>();

  async get(id: string): Promise<Conversation | null> {
    return this.store.get(id) ?? null;
  }

  async save(conversation: Conversation): Promise<void> {
    this.store.set(conversation.id, conversation);
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }
}
