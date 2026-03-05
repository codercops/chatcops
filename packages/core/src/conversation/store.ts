import type { Conversation } from '../types.js';

export interface ConversationStore {
  get(id: string): Promise<Conversation | null>;
  save(conversation: Conversation): Promise<void>;
  delete(id: string): Promise<void>;
}

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
