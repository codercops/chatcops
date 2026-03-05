import { describe, it, expect, beforeEach } from 'vitest';
import { ConversationStorage } from '../src/storage.js';

describe('ConversationStorage', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
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
});
