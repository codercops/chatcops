import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@chatcops/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@chatcops/core')>();
  return {
    ...actual,
    createProvider: vi.fn(),
  };
});

import type { Conversation, ConversationStore } from '@chatcops/core';
import { createProvider } from '@chatcops/core';
import { createChatHandler } from '../src/handler.js';

const mockedCreateProvider = vi.mocked(createProvider);

/**
 * A ConversationStore that JSON-serializes on save and JSON-deserializes on get.
 * This guarantees no object references are shared between the store and the handler,
 * proving that state is read and written strictly through the store interface.
 */
class JsonCloningConversationStore implements ConversationStore {
  private readonly records = new Map<string, string>();

  async get(id: string): Promise<Conversation | null> {
    const raw = this.records.get(id);
    if (!raw) return null;
    return JSON.parse(raw) as Conversation;
  }

  async save(conversation: Conversation): Promise<void> {
    this.records.set(conversation.id, JSON.stringify(conversation));
  }

  async delete(id: string): Promise<void> {
    this.records.delete(id);
  }

  getDirect(id: string): Conversation | null {
    const raw = this.records.get(id);
    if (!raw) return null;
    return JSON.parse(raw) as Conversation;
  }
}

describe('createChatHandler with custom ConversationStore', () => {
  beforeEach(() => {
    mockedCreateProvider.mockReset();
    mockedCreateProvider.mockResolvedValue({
      name: 'test-provider',
      async *chat() {
        yield 'Assistant response';
      },
      async chatSync() {
        return 'Assistant response';
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads and writes conversations through the supplied store across multiple turns without shared references', async () => {
    const store = new JsonCloningConversationStore();
    const providerCalls: Array<Array<{ role: string; content: string }>> = [];

    mockedCreateProvider.mockResolvedValue({
      name: 'test-provider',
      async *chat(params) {
        providerCalls.push(
          params.messages.map((m) => ({ role: m.role, content: m.content }))
        );
        yield providerCalls.length === 1 ? 'Hello! How can I help?' : 'I can help with that.';
      },
      async chatSync() {
        return '';
      },
    });

    const { handleChat } = createChatHandler({
      provider: { type: 'claude', apiKey: 'test-key' },
      systemPrompt: 'You are a helpful assistant.',
      conversationStore: store,
    });

    // First turn
    const firstEvents: Array<Record<string, unknown>> = [];
    for await (const chunk of handleChat({
      conversationId: 'conv-101',
      message: 'Hello there',
      messageId: 'user-msg-1',
    })) {
      firstEvents.push(JSON.parse(chunk));
    }

    expect(firstEvents).toEqual([
      { content: 'Hello! How can I help?' },
      { done: true },
    ]);
    expect(providerCalls[0]).toEqual([
      { role: 'user', content: 'Hello there' },
    ]);

    // Inspect the JSON-cloned store after turn 1
    const storedAfterTurn1 = store.getDirect('conv-101');
    expect(storedAfterTurn1).not.toBeNull();
    expect(storedAfterTurn1?.id).toBe('conv-101');
    expect(storedAfterTurn1?.messages).toHaveLength(2);
    expect(storedAfterTurn1?.messages[0]).toMatchObject({
      id: 'user-msg-1',
      role: 'user',
      content: 'Hello there',
    });
    expect(storedAfterTurn1?.messages[1]).toMatchObject({
      role: 'assistant',
      content: 'Hello! How can I help?',
    });

    // Second turn
    const secondEvents: Array<Record<string, unknown>> = [];
    for await (const chunk of handleChat({
      conversationId: 'conv-101',
      message: 'I have a question',
      messageId: 'user-msg-2',
    })) {
      secondEvents.push(JSON.parse(chunk));
    }

    expect(secondEvents).toEqual([
      { content: 'I can help with that.' },
      { done: true },
    ]);

    // Verify the provider received the history retrieved from the store
    expect(providerCalls[1]).toEqual([
      { role: 'user', content: 'Hello there' },
      { role: 'assistant', content: 'Hello! How can I help?' },
      { role: 'user', content: 'I have a question' },
    ]);

    // Inspect the JSON-cloned store after turn 2
    const storedAfterTurn2 = store.getDirect('conv-101');
    expect(storedAfterTurn2?.messages).toHaveLength(4);
    expect(storedAfterTurn2?.messages[2]).toMatchObject({
      id: 'user-msg-2',
      role: 'user',
      content: 'I have a question',
    });
    expect(storedAfterTurn2?.messages[3]).toMatchObject({
      role: 'assistant',
      content: 'I can help with that.',
    });
  });

  it('updates the store correctly when regenerating a response', async () => {
    const store = new JsonCloningConversationStore();
    const providerCalls: Array<Array<{ role: string; content: string }>> = [];

    mockedCreateProvider.mockResolvedValue({
      name: 'test-provider',
      async *chat(params) {
        providerCalls.push(
          params.messages.map((m) => ({ role: m.role, content: m.content }))
        );
        yield providerCalls.length === 1 ? 'Initial reply' : 'Regenerated reply';
      },
      async chatSync() {
        return '';
      },
    });

    const { handleChat } = createChatHandler({
      provider: { type: 'claude', apiKey: 'test-key' },
      systemPrompt: 'You are a helpful assistant.',
      conversationStore: store,
    });

    for await (const _chunk of handleChat({
      conversationId: 'conv-regen',
      message: 'Tell me a joke',
      messageId: 'msg-joke',
    })) {
      // Drain initial turn
    }

    const storedBeforeRegen = store.getDirect('conv-regen');
    expect(storedBeforeRegen?.messages).toHaveLength(2);
    expect(storedBeforeRegen?.messages[1].content).toBe('Initial reply');

    for await (const _chunk of handleChat({
      conversationId: 'conv-regen',
      message: 'Tell me a joke',
      messageId: 'msg-joke',
      regenerate: true,
    })) {
      // Drain regenerated turn
    }

    expect(providerCalls[1]).toEqual([
      { role: 'user', content: 'Tell me a joke' },
    ]);

    const storedAfterRegen = store.getDirect('conv-regen');
    expect(storedAfterRegen?.messages).toHaveLength(2);
    expect(storedAfterRegen?.messages[0].content).toBe('Tell me a joke');
    expect(storedAfterRegen?.messages[1].content).toBe('Regenerated reply');
  });

  it('shares state across separate handler instances using the same store', async () => {
    const sharedStore = new JsonCloningConversationStore();

    mockedCreateProvider.mockResolvedValue({
      name: 'test-provider',
      async *chat() {
        yield 'Response from instance A';
      },
      async chatSync() {
        return '';
      },
    });

    const handlerA = createChatHandler({
      provider: { type: 'claude', apiKey: 'test-key' },
      systemPrompt: 'You are a helpful assistant.',
      conversationStore: sharedStore,
    });

    for await (const _chunk of handlerA.handleChat({
      conversationId: 'conv-shared',
      message: 'First message to instance A',
      messageId: 'msg-1',
    })) {
      // Drain
    }

    let receivedHistoryByInstanceB: Array<{ role: string; content: string }> = [];
    mockedCreateProvider.mockResolvedValue({
      name: 'test-provider',
      async *chat(params) {
        receivedHistoryByInstanceB = params.messages.map((m) => ({
          role: m.role,
          content: m.content,
        }));
        yield 'Response from instance B';
      },
      async chatSync() {
        return '';
      },
    });

    const handlerB = createChatHandler({
      provider: { type: 'claude', apiKey: 'test-key' },
      systemPrompt: 'You are a helpful assistant.',
      conversationStore: sharedStore,
    });

    for await (const _chunk of handlerB.handleChat({
      conversationId: 'conv-shared',
      message: 'Second message to instance B',
      messageId: 'msg-2',
    })) {
      // Drain
    }

    expect(receivedHistoryByInstanceB).toEqual([
      { role: 'user', content: 'First message to instance A' },
      { role: 'assistant', content: 'Response from instance A' },
      { role: 'user', content: 'Second message to instance B' },
    ]);

    const stored = sharedStore.getDirect('conv-shared');
    expect(stored?.messages).toHaveLength(4);
  });

  it('preserves default in-memory behavior when conversationStore is omitted', async () => {
    mockedCreateProvider.mockResolvedValue({
      name: 'test-provider',
      async *chat() {
        yield 'Default reply';
      },
      async chatSync() {
        return '';
      },
    });

    const { handleChat } = createChatHandler({
      provider: { type: 'claude', apiKey: 'test-key' },
      systemPrompt: 'You are a helpful assistant.',
    });

    const events: Array<Record<string, unknown>> = [];
    for await (const chunk of handleChat({
      conversationId: 'conv-default',
      message: 'Hi',
    })) {
      events.push(JSON.parse(chunk));
    }

    expect(events).toEqual([
      { content: 'Default reply' },
      { done: true },
    ]);
  });
});
