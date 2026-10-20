import type { ChatMessage, Conversation } from '../types.js';
import type { ConversationStore } from './store.js';
import { MemoryStore } from './store.js';

export class ConversationManager {
  private store: ConversationStore;
  private maxMessages: number;

  constructor(options?: { store?: ConversationStore; maxMessages?: number }) {
    this.store = options?.store ?? new MemoryStore();
    this.maxMessages = options?.maxMessages ?? 100;
  }

  async getOrCreate(id: string): Promise<Conversation> {
    const existing = await this.store.get(id);
    if (existing) return existing;

    const conversation: Conversation = {
      id,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await this.store.save(conversation);
    return conversation;
  }

  async addMessage(conversationId: string, message: ChatMessage): Promise<Conversation> {
    const conversation = await this.getOrCreate(conversationId);
    conversation.messages.push(message);
    conversation.updatedAt = Date.now();

    if (conversation.messages.length > this.maxMessages) {
      const systemMessages = conversation.messages.filter((m) => m.role === 'system');
      let recentMessages = conversation.messages
        .filter((m) => m.role !== 'system')
        .slice(-(this.maxMessages - systemMessages.length));
      // Never start the kept history with an assistant turn; some providers
      // (Gemini) reject a conversation that doesn't open with the user.
      const firstUser = recentMessages.findIndex((m) => m.role === 'user');
      recentMessages = firstUser === -1 ? [] : recentMessages.slice(firstUser);
      conversation.messages = [...systemMessages, ...recentMessages];
    }

    await this.store.save(conversation);
    return conversation;
  }

  async getMessages(conversationId: string): Promise<ChatMessage[]> {
    const conversation = await this.store.get(conversationId);
    return conversation?.messages ?? [];
  }

  async removeMessage(conversationId: string, messageId: string): Promise<void> {
    const conversation = await this.store.get(conversationId);
    if (!conversation) return;

    conversation.messages = conversation.messages.filter((message) => message.id !== messageId);
    conversation.updatedAt = Date.now();
    await this.store.save(conversation);
  }

  async deleteConversation(id: string): Promise<void> {
    await this.store.delete(id);
  }
}
