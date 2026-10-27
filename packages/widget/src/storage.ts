import type { MessageErrorType } from './dom/messages.js';

/** Where the widget keeps the conversation: nowhere (`none`), this tab (`session`) or this browser (`local`). */
export type Persistence = 'none' | 'session' | 'local';

/** A string store: localStorage, sessionStorage, or memory for `none`. Never throws. */
export interface KeyStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

interface StoredConversation {
  id: string;
  messages: Array<{
    id: string;
    role: 'user' | 'assistant';
    content: string;
    status?: 'streaming' | 'complete' | 'error';
    errorType?: MessageErrorType;
    timestamp: number;
  }>;
  /** Pre-chat answers, kept with the conversation so a restored chat has them too. */
  userData?: Record<string, string>;
  /** The pre-chat form was submitted for this conversation. */
  preChatDone?: boolean;
  updatedAt: number;
}

const KEY_PREFIX = 'chatcops_conversation';
const DAY_MS = 24 * 60 * 60 * 1000;

/** The store for a persistence mode. Every call is wrapped, since storage can be blocked or full. */
export function keyStore(persistence: Persistence): KeyStore {
  if (persistence === 'none') {
    const memory = new Map<string, string>();
    return {
      get: (key) => memory.get(key) ?? null,
      set: (key, value) => void memory.set(key, value),
      remove: (key) => void memory.delete(key),
    };
  }
  const storage = () => (persistence === 'local' ? localStorage : sessionStorage);
  return {
    get(key) {
      try {
        return storage().getItem(key);
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        storage().setItem(key, value);
      } catch {
        // Full or blocked: the conversation still works on this page.
      }
    },
    remove(key) {
      try {
        storage().removeItem(key);
      } catch {
        // Ignore
      }
    },
  };
}

/**
 * The saved conversation for one widget. Nothing here runs until the widget
 * reads or saves, so constructing it touches no storage.
 */
export class ConversationStorage {
  readonly store: KeyStore;
  private key: string;
  private ttlMs: number;

  /** Without a siteId the key is the one the widget has always used. */
  constructor(siteId?: string, persistence: Persistence = 'local', historyTtlDays = 30) {
    this.store = keyStore(persistence);
    this.key = siteId ? `${KEY_PREFIX}_${siteId}` : KEY_PREFIX;
    // A bad value (NaN, negative) falls back to the default instead of keeping history forever.
    this.ttlMs = (Number.isFinite(historyTtlDays) && historyTtlDays >= 0 ? historyTtlDays : 30) * DAY_MS;
  }

  /** The saved conversation, or null when there is none, it's unreadable, or it expired. */
  load(now = Date.now()): StoredConversation | null {
    const raw = this.store.get(this.key);
    if (raw === null) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.clear();
      return null;
    }

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed) ||
      typeof (parsed as Record<string, unknown>).id !== 'string' ||
      !Array.isArray((parsed as Record<string, unknown>).messages)
    ) {
      this.clear();
      return null;
    }

    const record = parsed as Record<string, unknown>;
    if (typeof record.updatedAt === 'number' && now - record.updatedAt > this.ttlMs) {
      this.clear();
      return null;
    }

    const messages = (record.messages as unknown[]).filter(
      (msg): msg is StoredConversation['messages'][number] =>
        typeof msg === 'object' &&
        msg !== null &&
        !Array.isArray(msg) &&
        ((msg as Record<string, unknown>).role === 'user' || (msg as Record<string, unknown>).role === 'assistant') &&
        typeof (msg as Record<string, unknown>).content === 'string'
    );
    const userData = record.userData;
    return {
      ...record,
      id: record.id as string,
      messages,
      userData: userData && typeof userData === 'object' && !Array.isArray(userData) ? (userData as Record<string, string>) : undefined,
      preChatDone: record.preChatDone === true,
    } as StoredConversation;
  }

  save(conversation: StoredConversation): void {
    const filtered = {
      ...conversation,
      messages: conversation.messages.filter((m) => m.status !== 'error').map(({ status, ...message }) => message),
    };
    this.store.set(this.key, JSON.stringify(filtered));
  }

  clear(): void {
    this.store.remove(this.key);
  }
}
