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
});
