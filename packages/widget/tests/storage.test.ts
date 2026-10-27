import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ConversationStorage, keyStore } from '../src/storage.js';

describe('ConversationStorage', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null when no conversation saved', () => {
    const storage = new ConversationStorage('test');
    expect(storage.load()).toBeNull();
  });

  it('saves and loads a conversation', () => {
    const storage = new ConversationStorage('test');
    const convo = {
      id: 'conv-1',
      messages: [{ id: 'm1', role: 'user' as const, content: 'Hello', timestamp: Date.now() }],
      updatedAt: Date.now(),
    };

    storage.save(convo);
    const loaded = storage.load();
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe('conv-1');
    expect(loaded!.messages).toHaveLength(1);
  });

  it('clears conversation', () => {
    const storage = new ConversationStorage('test');
    storage.save({ id: 'conv-1', messages: [], updatedAt: Date.now() });
    storage.clear();
    expect(storage.load()).toBeNull();
  });

  it('uses different keys for different sites', () => {
    const storage1 = new ConversationStorage('site-a');
    const storage2 = new ConversationStorage('site-b');

    storage1.save({ id: 'conv-a', messages: [], updatedAt: Date.now() });
    expect(storage2.load()).toBeNull();
  });

  it('keeps pre-chat answers with the conversation', () => {
    const storage = new ConversationStorage();
    storage.save({ id: 'conv-1', messages: [], userData: { name: 'Alice', email: 'alice@example.com' }, preChatDone: true, updatedAt: Date.now() });
    expect(storage.load()).toMatchObject({ userData: { name: 'Alice', email: 'alice@example.com' }, preChatDone: true });
  });

  it('ignores pre-chat answers that are not an object', () => {
    localStorage.setItem('chatcops_conversation', JSON.stringify({ id: 'c', messages: [], userData: ['x'], updatedAt: Date.now() }));
    expect(new ConversationStorage().load()).toMatchObject({ userData: undefined, preChatDone: false });
  });

  it.each([
    ['local', () => localStorage, () => sessionStorage],
    ['session', () => sessionStorage, () => localStorage],
  ] as const)('persistence %s writes only to its own storage', (mode, own, other) => {
    const storage = new ConversationStorage('m', mode);
    storage.save({ id: 'conv-1', messages: [], updatedAt: Date.now() });
    expect(own().getItem('chatcops_conversation_m')).not.toBeNull();
    expect(other().getItem('chatcops_conversation_m')).toBeNull();
    expect(new ConversationStorage('m', mode).load()?.id).toBe('conv-1');
  });

  it("persistence none keeps the conversation in memory and touches no storage", () => {
    const setItem = vi.spyOn(localStorage, 'setItem');
    const getItem = vi.spyOn(sessionStorage, 'getItem');
    const storage = new ConversationStorage(undefined, 'none');
    storage.save({ id: 'conv-1', messages: [], updatedAt: Date.now() });
    expect(storage.load()?.id).toBe('conv-1');
    expect(new ConversationStorage(undefined, 'none').load()).toBeNull();
    expect(setItem).not.toHaveBeenCalled();
    expect(getItem).not.toHaveBeenCalled();
  });

  it('drops a conversation older than historyTtlDays when it is read', () => {
    const day = 24 * 60 * 60 * 1000;
    const storage = new ConversationStorage(undefined, 'local', 7);
    storage.save({ id: 'old', messages: [], updatedAt: 1_000_000 });
    expect(storage.load(1_000_000 + 6 * day)?.id).toBe('old');
    expect(storage.load(1_000_000 + 8 * day)).toBeNull();
    expect(localStorage.getItem('chatcops_conversation')).toBeNull();
  });

  it('defaults to a 30 day history', () => {
    const day = 24 * 60 * 60 * 1000;
    const storage = new ConversationStorage();
    storage.save({ id: 'c', messages: [], updatedAt: 0 });
    expect(storage.load(29 * day)?.id).toBe('c');
    expect(storage.load(31 * day)).toBeNull();
  });

  it('uses 30 days when historyTtlDays is not a usable number', () => {
    const day = 24 * 60 * 60 * 1000;
    for (const bad of [Number.NaN, -1, Number.POSITIVE_INFINITY]) {
      const storage = new ConversationStorage(undefined, 'local', bad);
      storage.save({ id: 'c', messages: [], updatedAt: 0 });
      expect(storage.load(29 * day)?.id).toBe('c');
      expect(storage.load(31 * day)).toBeNull();
    }
  });

  it('never throws when storage is blocked or full', () => {
    const blocked = () => {
      throw new Error('SecurityError');
    };
    const broken = { getItem: blocked, setItem: blocked, removeItem: blocked };
    vi.stubGlobal('localStorage', broken);
    vi.stubGlobal('sessionStorage', broken);
    try {
      for (const mode of ['local', 'session'] as const) {
        const store = keyStore(mode);
        expect(() => store.set('k', 'v')).not.toThrow();
        expect(store.get('k')).toBeNull();
        expect(() => store.remove('k')).not.toThrow();
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([
    ['empty object', '{}'],
    ['empty array', '[]'],
    ['array of objects', JSON.stringify([{ id: '1' }])],
    ['missing id', JSON.stringify({ messages: [] })],
    ['invalid id (number)', JSON.stringify({ id: 123, messages: [] })],
    ['invalid id (object)', JSON.stringify({ id: {}, messages: [] })],
    ['invalid id (null)', JSON.stringify({ id: null, messages: [] })],
    ['missing messages', JSON.stringify({ id: 'conv-1' })],
    ['non-array messages (string)', JSON.stringify({ id: 'conv-1', messages: 'hello' })],
    ['non-array messages (object)', JSON.stringify({ id: 'conv-1', messages: {} })],
    ['non-array messages (null)', JSON.stringify({ id: 'conv-1', messages: null })],
    ['non-array messages (number)', JSON.stringify({ id: 'conv-1', messages: 42 })],
    ['invalid json', 'not-valid-json'],
    ['primitive number', '123'],
    ['primitive string', '"plain-string"'],
    ['primitive boolean', 'true'],
    ['primitive null', 'null'],
  ])('removes the stored key and returns null for invalid top-level data: %s', (_, value) => {
    const key = 'chatcops_conversation_site-a';
    localStorage.setItem(key, value);
    const storage = new ConversationStorage('site-a');

    expect(storage.load()).toBeNull();
    expect(localStorage.getItem(key)).toBeNull();
  });

  it('removes only the specific stored key on invalid data without touching other keys', () => {
    localStorage.setItem('chatcops_conversation', '{}');
    localStorage.setItem('chatcops_conversation_other', JSON.stringify({ id: 'other', messages: [] }));

    const storage = new ConversationStorage();
    expect(storage.load()).toBeNull();
    expect(localStorage.getItem('chatcops_conversation')).toBeNull();
    expect(localStorage.getItem('chatcops_conversation_other')).not.toBeNull();
  });

  it('filters messages to retain only objects with role exactly user or assistant and string content', () => {
    const storage = new ConversationStorage('test');
    const validUser = { id: 'm1', role: 'user' as const, content: 'Hello', timestamp: 100 };
    const validAssistant = { id: 'm2', role: 'assistant' as const, content: 'Hi there!', timestamp: 200 };
    const validEmptyContent = { id: 'm7', role: 'assistant' as const, content: '', timestamp: 700 };
    const updatedAt = Date.now();
    const conversationData = {
      id: 'conv-1',
      updatedAt,
      metadata: { topic: 'support' },
      messages: [
        validUser,
        null,
        'not an object',
        123,
        [],
        {},
        { id: 'm3', role: 'system', content: 'system message', timestamp: 300 },
        { id: 'm4', role: 'USER', content: 'cased role', timestamp: 400 },
        { id: 'm5', role: 'assistant', content: 42, timestamp: 500 },
        { id: 'm6', role: 'user' },
        validAssistant,
        validEmptyContent,
      ],
    };

    localStorage.setItem('chatcops_conversation_test', JSON.stringify(conversationData));

    const loaded = storage.load();
    expect(loaded).not.toBeNull();
    expect(loaded?.id).toBe('conv-1');
    expect(loaded?.updatedAt).toBe(updatedAt);
    expect((loaded as unknown as Record<string, unknown> | null)?.metadata).toEqual({ topic: 'support' });
    expect(loaded?.messages).toEqual([validUser, validAssistant, validEmptyContent]);
    expect(localStorage.getItem('chatcops_conversation_test')).not.toBeNull();
  });
});
