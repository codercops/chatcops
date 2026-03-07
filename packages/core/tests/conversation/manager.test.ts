import { describe, it, expect } from 'vitest';
import { ConversationManager } from '../../src/conversation/manager.js';
import type { ChatMessage } from '../../src/types.js';

function makeMessage(role: 'user' | 'assistant', content: string): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    timestamp: Date.now(),
  };
}

describe('ConversationManager', () => {
  it('creates a new conversation', async () => {
    const manager = new ConversationManager();
    const convo = await manager.getOrCreate('test-1');

    expect(convo.id).toBe('test-1');
    expect(convo.messages).toHaveLength(0);
  });

  it('returns existing conversation', async () => {
    const manager = new ConversationManager();
    await manager.getOrCreate('test-1');
    await manager.addMessage('test-1', makeMessage('user', 'Hello'));

    const convo = await manager.getOrCreate('test-1');
    expect(convo.messages).toHaveLength(1);
  });

  it('adds messages', async () => {
    const manager = new ConversationManager();
    await manager.addMessage('conv-1', makeMessage('user', 'Hello'));
    await manager.addMessage('conv-1', makeMessage('assistant', 'Hi there!'));

    const messages = await manager.getMessages('conv-1');
    expect(messages).toHaveLength(2);
    expect(messages[0].content).toBe('Hello');
    expect(messages[1].content).toBe('Hi there!');
  });

  it('enforces max message limit', async () => {
    const manager = new ConversationManager({ maxMessages: 5 });

    for (let i = 0; i < 10; i++) {
      await manager.addMessage('conv-1', makeMessage('user', `Message ${i}`));
    }

    const messages = await manager.getMessages('conv-1');
    expect(messages.length).toBeLessThanOrEqual(5);
    expect(messages[messages.length - 1].content).toBe('Message 9');
  });

  it('deletes a conversation', async () => {
    const manager = new ConversationManager();
    await manager.addMessage('conv-1', makeMessage('user', 'Hello'));
    await manager.deleteConversation('conv-1');

    const messages = await manager.getMessages('conv-1');
    expect(messages).toHaveLength(0);
  });

  it('maxMessages correctly limits total including system messages', async () => {
    const manager = new ConversationManager({ maxMessages: 5 });

    // Add a system message
    await manager.addMessage('conv-sys', {
      id: 'sys-1',
      role: 'system',
      content: 'System prompt',
      timestamp: Date.now(),
    });

    // Add enough user messages to trigger trimming
    for (let i = 0; i < 10; i++) {
      await manager.addMessage('conv-sys', makeMessage('user', `Message ${i}`));
    }

    const messages = await manager.getMessages('conv-sys');
    // Total should not exceed maxMessages (5), including the system message
    expect(messages.length).toBeLessThanOrEqual(5);
    // System message should be preserved
    expect(messages.some((m) => m.role === 'system')).toBe(true);
  });

  it('returns empty messages for non-existent conversation', async () => {
    const manager = new ConversationManager();
    const messages = await manager.getMessages('nope');
    expect(messages).toHaveLength(0);
  });
});
