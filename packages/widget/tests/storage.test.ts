import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ConversationStorage } from '../src/storage.js';

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

  it('generates a session ID', () => {
    const storage = new ConversationStorage();
    const id = storage.getSessionId();
    expect(id).toBeTruthy();
    expect(typeof id).toBe('string');
  });

  it('returns same session ID within session', () => {
    const storage = new ConversationStorage();
    const id1 = storage.getSessionId();
    const id2 = storage.getSessionId();
    expect(id1).toBe(id2);
  });

  it('uses different keys for different sites', () => {
    const storage1 = new ConversationStorage('site-a');
    const storage2 = new ConversationStorage('site-b');

    storage1.save({ id: 'conv-a', messages: [], updatedAt: Date.now() });
    expect(storage2.load()).toBeNull();
  });

  it('persists and restores pre-chat completion and userData', () => {
    const storage = new ConversationStorage();
    expect(storage.isPreChatCompleted('session-1')).toBe(false);
    expect(storage.getPreChatData('session-1')).toBeNull();

    storage.setPreChatCompleted('session-1', { name: 'Alice', email: 'alice@example.com' });
    expect(storage.isPreChatCompleted('session-1')).toBe(true);
    expect(storage.getPreChatData('session-1')).toEqual({ name: 'Alice', email: 'alice@example.com' });
  });

  it('swallows storage errors on pre-chat operations', () => {
    const storage = new ConversationStorage();

    const setItemSpy = vi.spyOn(sessionStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceeded');
    });
    expect(() => storage.setPreChatCompleted('session-2', { name: 'Bob' })).not.toThrow();
    expect(() => storage.setPreChatData('session-2', { name: 'Bob' })).not.toThrow();
    setItemSpy.mockRestore();

    const getItemSpy = vi.spyOn(sessionStorage, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(storage.isPreChatCompleted('session-2')).toBe(false);
    expect(storage.getPreChatData('session-2')).toBeNull();
    getItemSpy.mockRestore();
  });

  it('returns null when pre-chat data in storage is malformed', () => {
    const storage = new ConversationStorage();
    sessionStorage.setItem('chatcops-prechat-data-malformed', 'not-valid-json');
    expect(storage.getPreChatData('malformed')).toBeNull();

    sessionStorage.setItem('chatcops-prechat-data-array', JSON.stringify(['not', 'an', 'object']));
    expect(storage.getPreChatData('array')).toBeNull();
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
    const conversationData = {
      id: 'conv-1',
      updatedAt: 123456789,
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
    expect(loaded?.updatedAt).toBe(123456789);
    expect((loaded as unknown as Record<string, unknown> | null)?.metadata).toEqual({ topic: 'support' });
    expect(loaded?.messages).toEqual([validUser, validAssistant, validEmptyContent]);
    expect(localStorage.getItem('chatcops_conversation_test')).not.toBeNull();
  });
});
