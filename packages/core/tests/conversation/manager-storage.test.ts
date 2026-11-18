import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConversationManager } from '../../src/conversation/manager.js';
import { MemoryStore } from '../../src/conversation/store.js';
import { isConflictError } from '../../src/storage/errors.js';
import { memoryStorage } from '../../src/storage/memory.js';
import type { ChatMessage } from '../../src/types.js';

const msg = (id: string, role: ChatMessage['role'] = 'user'): ChatMessage => ({ id, role, content: id, timestamp: 0 });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ConversationManager on storage', () => {
  it('writes through append, never by saving the whole conversation', async () => {
    const storage = memoryStorage();
    const append = vi.spyOn(storage.conversations, 'append');
    const save = vi.spyOn(storage.conversations, 'save');
    const manager = new ConversationManager({ storage });

    await manager.addMessage('c1', msg('u1'));
    await manager.addMessage('c1', msg('a1', 'assistant'));

    expect(append).toHaveBeenCalledTimes(2);
    expect(save).not.toHaveBeenCalled();
    expect((await manager.getMessages('c1')).map((m) => m.id)).toEqual(['u1', 'a1']);
  });

  it('does not save a conversation just for reading it', async () => {
    const storage = memoryStorage();
    const manager = new ConversationManager({ storage });
    const conversation = await manager.getOrCreate('new');
    expect(conversation).toMatchObject({ id: 'new', messages: [], version: 0 });
    expect(await storage.conversations.get('new')).toBeNull();
  });

  it('loses no message when two instances share a store', async () => {
    const storage = memoryStorage();
    const a = new ConversationManager({ storage });
    const b = new ConversationManager({ storage });
    await Promise.all(
      Array.from({ length: 10 }, (_, i) => (i % 2 ? a : b).addMessage('shared', msg(`m${i}`)))
    );
    expect(await a.getMessages('shared')).toHaveLength(10);
  });

  it('fails an append with a stale version and updates messages in place', async () => {
    const manager = new ConversationManager({ storage: memoryStorage() });
    const { version } = await manager.appendMessages('c1', [msg('u1'), msg('a1', 'assistant')]);
    await expect(manager.appendMessages('c1', [msg('u2')], { expectedVersion: version - 1 })).rejects.toSatisfy(isConflictError);

    expect(await manager.updateMessage('c1', { ...msg('a1', 'assistant'), content: 'final' })).toBe(true);
    expect((await manager.getMessages('c1'))[1].content).toBe('final');
  });

  it('warns once for a 0.4 store and still works', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = new MemoryStore();
    const manager = new ConversationManager({ store });
    new ConversationManager({ store: new MemoryStore() });
    await manager.addMessage('c1', msg('u1'));

    expect(await manager.getMessages('c1')).toHaveLength(1);
    const appendWarnings = warn.mock.calls.filter((call) => String(call[0]).includes('no append()'));
    expect(appendWarnings.length).toBeLessThanOrEqual(1);
  });

  it('keeps maxMessages without leaving an assistant turn first, and keeps system messages', async () => {
    const manager = new ConversationManager({ storage: memoryStorage(), maxMessages: 4 });
    await manager.addMessage('c1', msg('sys', 'system'));
    for (const [id, role] of [['u1', 'user'], ['a1', 'assistant'], ['u2', 'user'], ['a2', 'assistant'], ['u3', 'user']] as const) {
      await manager.addMessage('c1', msg(id, role));
    }
    expect((await manager.getMessages('c1')).map((m) => m.id)).toEqual(['sys', 'u2', 'a2', 'u3']);
  });

  it('gives the model a trimmed history', async () => {
    const manager = new ConversationManager({ storage: memoryStorage(), maxHistoryTokens: 30 });
    const big = (id: string, role: ChatMessage['role']): ChatMessage => ({ ...msg(id, role), content: 'x'.repeat(35) }); // 14 tokens
    for (const [id, role] of [['u1', 'user'], ['a1', 'assistant'], ['u2', 'user']] as const) {
      await manager.addMessage('c1', big(id, role));
    }
    expect((await manager.getHistory('c1')).map((m) => m.id)).toEqual(['u1', 'u2']);
    expect(await manager.getMessages('c1')).toHaveLength(3);
  });
});

describe('ConversationManager.acquireTurn', () => {
  it('lets one turn at a time hold a conversation across instances sharing kv', async () => {
    const storage = memoryStorage();
    const a = new ConversationManager({ storage });
    const b = new ConversationManager({ storage });

    const release = await a.acquireTurn('c1');
    expect(release).toBeTypeOf('function');
    expect(await b.acquireTurn('c1')).toBeNull();
    expect(await b.acquireTurn('other')).toBeTypeOf('function');

    await release?.();
    await release?.();
    expect(await b.acquireTurn('c1')).toBeTypeOf('function');
  });

  it('does not release a lock that expired and was taken by another turn', async () => {
    let time = 1_000_000;
    const storage = memoryStorage({ now: () => time });
    const a = new ConversationManager({ storage });
    const b = new ConversationManager({ storage });

    const releaseA = await a.acquireTurn('c1', 1000);
    time += 1001;
    const releaseB = await b.acquireTurn('c1', 1000);
    expect(releaseB).toBeTypeOf('function');

    await releaseA?.();
    expect(await a.acquireTurn('c1', 1000)).toBeNull();
  });

  it('falls back to a lock in this process without kv', async () => {
    vi.useFakeTimers();
    try {
      const manager = new ConversationManager({ store: memoryStorage().conversations });
      const release = await manager.acquireTurn('c1', 5000);
      expect(await manager.acquireTurn('c1', 5000)).toBeNull();
      await release?.();
      expect(await manager.acquireTurn('c1', 5000)).toBeTypeOf('function');
      // An abandoned lock expires.
      expect(await manager.acquireTurn('c1', 5000)).toBeNull();
      vi.advanceTimersByTime(5001);
      expect(await manager.acquireTurn('c1', 5000)).toBeTypeOf('function');
    } finally {
      vi.useRealTimers();
    }
  });
});
