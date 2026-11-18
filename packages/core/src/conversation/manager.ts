import { consoleLogger, type Logger } from '../logger.js';
import { warnOnce } from '../providers/base.js';
import { DEFAULT_MAX_HISTORY_TOKENS, trimHistory } from '../providers/history.js';
import { type ConversationStoreWithAppend, isLegacyConversationStore, withAppend } from '../storage/adapt.js';
import { memoryStorage } from '../storage/memory.js';
import type { AppendOptions, ChatCopsStorage, KeyValueStore } from '../storage/types.js';
import type { ChatMessage, Conversation } from '../types.js';
import type { ConversationStore } from './store.js';

export interface ConversationManagerOptions {
  /** Where everything is stored. Takes precedence over `store`. */
  storage?: ChatCopsStorage;
  /** A conversation store on its own, as in 0.4. */
  store?: ConversationStore;
  /**
   * Most messages kept per conversation. Older ones are removed after each
   * write; system messages stay. Default 100.
   */
  maxMessages?: number;
  /** Token budget for the history sent to the model. Default 32,000. */
  maxHistoryTokens?: number;
  /** Where warnings go. Default `consoleLogger()`. */
  logger?: Logger;
}

/** Releases a turn lock. Safe to call more than once. */
export type ReleaseTurn = () => Promise<void>;

/**
 * Reads and writes conversations through a store. Writes are appends, so two
 * server instances answering the same conversation don't overwrite each
 * other's messages, as long as the store implements `append`.
 */
export class ConversationManager {
  private readonly store: ConversationStoreWithAppend;
  private readonly kv: KeyValueStore | undefined;
  private readonly maxMessages: number;
  private readonly maxHistoryTokens: number;
  private readonly localTurns = new Set<string>();

  constructor(options: ConversationManagerOptions = {}) {
    const store = options.storage?.conversations ?? options.store ?? memoryStorage().conversations;
    if (isLegacyConversationStore(store)) {
      warnOnce(
        options.logger ?? consoleLogger(),
        'legacy-conversation-store',
        "The conversation store has no append(), so each write saves the whole conversation. That's fine on one server, but two instances writing the same conversation can lose a message. The store packages (@chatcops/store-*) have append()."
      );
    }
    this.store = withAppend(store);
    this.kv = options.storage?.kv;
    this.maxMessages = options.maxMessages ?? 100;
    this.maxHistoryTokens = options.maxHistoryTokens ?? DEFAULT_MAX_HISTORY_TOKENS;
  }

  /**
   * The stored conversation, or a new empty one. A new conversation isn't
   * saved until its first message is added.
   */
  async getOrCreate(id: string): Promise<Conversation> {
    const existing = await this.store.get(id);
    if (existing) return existing;
    const time = Date.now();
    return { id, messages: [], version: 0, createdAt: time, updatedAt: time };
  }

  /** Adds one message and returns the conversation as stored afterwards. */
  async addMessage(conversationId: string, message: ChatMessage): Promise<Conversation> {
    await this.appendMessages(conversationId, [message]);
    return this.getOrCreate(conversationId);
  }

  /**
   * Adds messages atomically and returns the new version. Pass
   * `expectedVersion` to fail with a `ConflictError` when another request
   * wrote first.
   */
  async appendMessages(
    conversationId: string,
    messages: ChatMessage[],
    options?: AppendOptions
  ): Promise<{ version: number }> {
    const result = await this.store.append(conversationId, messages, options);
    await this.enforceMaxMessages(conversationId);
    return result;
  }

  /** Replaces a stored message with the same id. Resolves `false` when there's none. */
  updateMessage(conversationId: string, message: ChatMessage): Promise<boolean> {
    return this.store.updateMessage(conversationId, message);
  }

  async getMessages(conversationId: string): Promise<ChatMessage[]> {
    const conversation = await this.store.get(conversationId);
    return conversation?.messages ?? [];
  }

  /**
   * The messages to send to the model: user and assistant turns within the
   * token budget, keeping the first user message and the newest ones.
   */
  async getHistory(conversationId: string): Promise<ChatMessage[]> {
    return trimHistory(await this.getMessages(conversationId), this.maxHistoryTokens);
  }

  async removeMessage(conversationId: string, messageId: string): Promise<void> {
    await this.store.removeMessage(conversationId, messageId);
  }

  async deleteConversation(id: string): Promise<void> {
    await this.store.delete(id);
  }

  /**
   * Makes sure only one reply is generated for a conversation at a time.
   * Resolves a release function, or `null` when another turn holds the lock.
   * The lock expires after `ttlMs` in case a server dies mid-turn.
   *
   * With `storage.kv` (and `setIfAbsent`) the lock holds across instances;
   * otherwise only within this process.
   */
  async acquireTurn(conversationId: string, ttlMs = 120_000): Promise<ReleaseTurn | null> {
    const key = `turn:${conversationId}`;
    const kv = this.kv;

    if (kv?.setIfAbsent) {
      const token = crypto.randomUUID();
      if (!(await kv.setIfAbsent(key, token, { ttlMs }))) return null;
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        // Only delete the lock if it's still ours; it may have expired and
        // been taken by another turn.
        if ((await kv.get<string>(key)) === token) await kv.delete(key);
      };
    }

    if (this.localTurns.has(key)) return null;
    this.localTurns.add(key);
    const timer = setTimeout(() => this.localTurns.delete(key), ttlMs);
    (timer as { unref?: () => void }).unref?.();
    let released = false;
    return async () => {
      if (released) return;
      released = true;
      clearTimeout(timer);
      this.localTurns.delete(key);
    };
  }

  /**
   * Removes the oldest non-system messages past `maxMessages`, one atomic
   * remove each, then any assistant turns left at the front, so the stored
   * history still opens with the visitor (Gemini rejects one that doesn't).
   */
  private async enforceMaxMessages(conversationId: string): Promise<void> {
    const messages = await this.getMessages(conversationId);
    if (messages.length <= this.maxMessages) return;

    const turns = messages.filter((m) => m.role !== 'system');
    let cut = messages.length - this.maxMessages;
    while (cut < turns.length && turns[cut].role === 'assistant') cut++;
    for (const message of turns.slice(0, cut)) {
      await this.store.removeMessage(conversationId, message.id);
    }
  }
}
