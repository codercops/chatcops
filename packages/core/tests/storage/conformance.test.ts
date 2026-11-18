import type { Conversation, ConversationStore } from '../../src/index.js';
import { memoryStorage, memoryVectors, withAppend } from '../../src/index.js';
import { runStorageConformance } from '../../src/testing/index.js';

runStorageConformance('memoryStorage', () => memoryStorage());
runStorageConformance('memoryStorage with memoryVectors', () => ({ ...memoryStorage(), vectors: memoryVectors({ dimensions: 8 }) }));

/** A 0.4-style store: get, save and delete only, with no shared references. */
class JsonStore implements ConversationStore {
  private readonly rows = new Map<string, string>();
  async get(id: string): Promise<Conversation | null> {
    const raw = this.rows.get(id);
    return raw ? (JSON.parse(raw) as Conversation) : null;
  }
  async save(conversation: Conversation): Promise<void> {
    this.rows.set(conversation.id, JSON.stringify(conversation));
  }
  async delete(id: string): Promise<void> {
    this.rows.delete(id);
  }
}

// Within one process, withAppend makes a 0.4 store pass the conversation checks.
runStorageConformance('withAppend(0.4 store)', () => ({ conversations: withAppend(new JsonStore()) }));
