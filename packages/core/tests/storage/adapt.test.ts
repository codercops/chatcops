import { describe, expect, it, vi } from 'vitest';
import { MemoryStore } from '../../src/conversation/store.js';
import { isLegacyConversationStore, withAppend } from '../../src/storage/adapt.js';
import { ConflictError, isConflictError } from '../../src/storage/errors.js';
import { memoryStorage } from '../../src/storage/memory.js';

describe('withAppend', () => {
  it('returns a store that already has every method unchanged', () => {
    const { conversations } = memoryStorage();
    expect(isLegacyConversationStore(conversations)).toBe(false);
    expect(withAppend(conversations)).toBe(conversations);
  });

  it('builds the missing methods on get and save for a 0.4 store', async () => {
    const legacy = new MemoryStore();
    const save = vi.spyOn(legacy, 'save');
    expect(isLegacyConversationStore(legacy)).toBe(true);

    const store = withAppend(legacy);
    await store.append('c', [{ id: 'u1', role: 'user', content: 'Hi', timestamp: 0 }]);
    expect(save).toHaveBeenCalledTimes(1);
    expect((await legacy.get('c'))?.version).toBe(1);
  });

  it('keeps the store usable after a failed write', async () => {
    const legacy = new MemoryStore();
    const store = withAppend(legacy);
    await store.append('c', [{ id: 'u1', role: 'user', content: 'Hi', timestamp: 0 }]);
    await expect(store.append('c', [], { expectedVersion: 0 })).rejects.toBeInstanceOf(ConflictError);
    await expect(store.append('c', [{ id: 'u2', role: 'user', content: 'Again', timestamp: 0 }])).resolves.toEqual({ version: 2 });
  });

  it('leaves out list and purge when the store has neither', () => {
    const store = withAppend(new MemoryStore());
    expect(store.list).toBeUndefined();
    expect(store.purge).toBeUndefined();
  });
});

describe('isConflictError', () => {
  it('recognizes the error by its code, even from another copy of core', () => {
    expect(isConflictError(new ConflictError('c', 1, 2))).toBe(true);
    expect(isConflictError({ code: 'chatcops_conversation_conflict' })).toBe(true);
    expect(isConflictError(new Error('nope'))).toBe(false);
    expect(isConflictError(null)).toBe(false);
  });

  it('says which versions disagreed', () => {
    const error = new ConflictError('c1', 3, 4);
    expect(error.message).toContain('version 4, expected 3');
    expect(error.name).toBe('ConflictError');
  });
});
