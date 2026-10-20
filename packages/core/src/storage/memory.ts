import type { AnalyticsEvent, ChatMessage, Conversation } from '../types.js';
import { ConflictError } from './errors.js';
import type {
  AppendOptions,
  ChatCopsStorage,
  ConversationStore,
  ConversationSummary,
  CounterStore,
  CounterValue,
  EventCount,
  EventQuery,
  EventSink,
  KeyValueStore,
  ListQuery,
} from './types.js';

export interface MemoryStorageOptions {
  /** Least recently used conversations go first past this. Default 1000. */
  maxConversations?: number;
  /** Conversations not touched for this long are dropped. Default 7 days. */
  conversationTtlMs?: number;
  /** Counters and keys each, past which expired ones are swept and then the oldest dropped. Default 10,000. */
  maxKeys?: number;
  /** Oldest events go first past this. Default 10,000. */
  maxEvents?: number;
  /** Clock, for tests. */
  now?: () => number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/**
 * Keeps everything in this process. Fine for local development and a single
 * long-running server; on serverless each instance has its own copy, so
 * conversations and limits don't carry over between requests.
 *
 * Every capability is bounded, and nothing runs on a timer: expired entries
 * are dropped when they're next read or when a map reaches its cap. Objects
 * are copied in and out, so callers can't change stored data by accident.
 */
export function memoryStorage(options: MemoryStorageOptions = {}): ChatCopsStorage {
  const now = options.now ?? Date.now;
  return {
    conversations: new MemoryConversationStore(
      options.maxConversations ?? 1000,
      options.conversationTtlMs ?? 7 * DAY_MS,
      now
    ),
    counters: new MemoryCounterStore(options.maxKeys ?? 10_000, now),
    kv: new MemoryKeyValueStore(options.maxKeys ?? 10_000, now),
    events: new MemoryEventSink(options.maxEvents ?? 10_000),
  };
}

class MemoryConversationStore implements ConversationStore {
  private readonly records = new Map<string, Conversation>();

  constructor(
    private readonly maxConversations: number,
    private readonly ttlMs: number,
    private readonly now: () => number
  ) {}

  async get(id: string): Promise<Conversation | null> {
    const record = this.read(id);
    return record ? structuredClone(record) : null;
  }

  async save(conversation: Conversation): Promise<void> {
    const current = this.read(conversation.id);
    this.write({
      ...structuredClone(conversation),
      version: (current?.version ?? 0) + 1,
      updatedAt: this.now(),
    });
  }

  async delete(id: string): Promise<void> {
    this.records.delete(id);
  }

  async append(id: string, messages: ChatMessage[], options: AppendOptions = {}): Promise<{ version: number }> {
    const current = this.read(id);
    const version = current?.version ?? 0;
    if (options.expectedVersion !== undefined && options.expectedVersion !== version) {
      throw new ConflictError(id, options.expectedVersion, version);
    }

    const time = this.now();
    const metadata =
      options.metadata || current?.metadata ? { ...current?.metadata, ...structuredClone(options.metadata) } : undefined;
    this.write({
      id,
      messages: [...(current?.messages ?? []), ...structuredClone(messages)],
      ...(metadata ? { metadata } : {}),
      version: version + 1,
      createdAt: current?.createdAt ?? time,
      updatedAt: time,
    });
    return { version: version + 1 };
  }

  async updateMessage(id: string, message: ChatMessage): Promise<boolean> {
    const current = this.read(id);
    const index = current?.messages.findIndex((m) => m.id === message.id) ?? -1;
    if (!current || index === -1) return false;

    const messages = [...current.messages];
    messages[index] = structuredClone(message);
    this.write({ ...current, messages, version: (current.version ?? 0) + 1, updatedAt: this.now() });
    return true;
  }

  async removeMessage(id: string, messageId: string): Promise<boolean> {
    const current = this.read(id);
    if (!current?.messages.some((m) => m.id === messageId)) return false;

    this.write({
      ...current,
      messages: current.messages.filter((m) => m.id !== messageId),
      version: (current.version ?? 0) + 1,
      updatedAt: this.now(),
    });
    return true;
  }

  async list(query: ListQuery): Promise<{ items: ConversationSummary[]; cursor?: string }> {
    const all = [...this.records.values()]
      .filter((c) => !this.expired(c))
      .filter((c) => query.updatedAfter === undefined || c.updatedAt > query.updatedAfter)
      .sort((a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

    let start = 0;
    if (query.cursor) {
      const index = all.findIndex((c) => cursorOf(c) === query.cursor);
      start = index === -1 ? all.length : index + 1;
    }
    const page = all.slice(start, start + query.limit);
    const items = page.map((c) => ({
      id: c.id,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      messageCount: c.messages.length,
      ...(c.metadata ? { metadata: structuredClone(c.metadata) } : {}),
    }));
    const last = page.at(-1);
    return start + page.length < all.length && last ? { items, cursor: cursorOf(last) } : { items };
  }

  async purge(before: number): Promise<number> {
    let removed = 0;
    for (const [id, conversation] of this.records) {
      if (conversation.updatedAt < before) {
        this.records.delete(id);
        removed++;
      }
    }
    return removed;
  }

  /** Returns the live record (not a copy) and marks it as recently used. */
  private read(id: string): Conversation | undefined {
    const record = this.records.get(id);
    if (!record) return undefined;
    if (this.expired(record)) {
      this.records.delete(id);
      return undefined;
    }
    this.records.delete(id);
    this.records.set(id, record);
    return record;
  }

  private write(conversation: Conversation): void {
    this.records.delete(conversation.id);
    this.records.set(conversation.id, conversation);
    while (this.records.size > this.maxConversations) {
      const oldest = this.records.keys().next().value;
      if (oldest === undefined) break;
      this.records.delete(oldest);
    }
  }

  private expired(conversation: Conversation): boolean {
    return this.now() - conversation.updatedAt > this.ttlMs;
  }
}

function cursorOf(conversation: Conversation): string {
  return `${conversation.updatedAt}:${conversation.id}`;
}

interface Expiring<T> {
  value: T;
  expiresAt: number;
}

/** A map whose entries expire, swept when it reaches its cap. */
class ExpiringMap<T> {
  private readonly entries = new Map<string, Expiring<T>>();

  constructor(
    private readonly maxKeys: number,
    private readonly now: () => number
  ) {}

  get(key: string): Expiring<T> | undefined {
    const entry = this.entries.get(key);
    if (entry && entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry;
  }

  set(key: string, entry: Expiring<T>): void {
    this.entries.delete(key);
    this.entries.set(key, entry);
    if (this.entries.size <= this.maxKeys) return;

    const time = this.now();
    for (const [k, e] of this.entries) {
      if (e.expiresAt <= time) this.entries.delete(k);
    }
    while (this.entries.size > this.maxKeys) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  delete(key: string): void {
    this.entries.delete(key);
  }
}

class MemoryCounterStore implements CounterStore {
  private readonly counters: ExpiringMap<number>;

  constructor(
    maxKeys: number,
    private readonly now: () => number
  ) {
    this.counters = new ExpiringMap(maxKeys, now);
  }

  async increment(key: string, by: number, ttlMs: number): Promise<CounterValue> {
    const current = this.counters.get(key);
    const entry = current
      ? { value: current.value + by, expiresAt: current.expiresAt }
      : { value: by, expiresAt: this.now() + ttlMs };
    this.counters.set(key, entry);
    return { ...entry };
  }

  async get(key: string): Promise<CounterValue | null> {
    const entry = this.counters.get(key);
    return entry ? { ...entry } : null;
  }
}

const NO_EXPIRY = Number.POSITIVE_INFINITY;

class MemoryKeyValueStore implements KeyValueStore {
  private readonly values: ExpiringMap<unknown>;

  constructor(
    maxKeys: number,
    private readonly now: () => number
  ) {
    this.values = new ExpiringMap(maxKeys, now);
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    const entry = this.values.get(key);
    return entry ? (structuredClone(entry.value) as T) : null;
  }

  async set(key: string, value: unknown, options: { ttlMs?: number } = {}): Promise<void> {
    this.values.set(key, { value: structuredClone(value), expiresAt: this.expiry(options.ttlMs) });
  }

  async setIfAbsent(key: string, value: unknown, options: { ttlMs?: number } = {}): Promise<boolean> {
    if (this.values.get(key)) return false;
    this.values.set(key, { value: structuredClone(value), expiresAt: this.expiry(options.ttlMs) });
    return true;
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }

  private expiry(ttlMs: number | undefined): number {
    return ttlMs === undefined ? NO_EXPIRY : this.now() + ttlMs;
  }
}

class MemoryEventSink implements EventSink {
  private events: AnalyticsEvent[] = [];

  constructor(private readonly maxEvents: number) {}

  async write(events: AnalyticsEvent[]): Promise<void> {
    this.events.push(...structuredClone(events));
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }
  }

  async query(query: EventQuery): Promise<EventCount[]> {
    const size = query.groupBy === 'hour' ? HOUR_MS : DAY_MS;
    const counts = new Map<string, EventCount>();
    for (const event of this.events) {
      if (event.timestamp < query.from || event.timestamp >= query.to) continue;
      if (query.type && event.type !== query.type) continue;
      const bucket = Math.floor(event.timestamp / size) * size;
      const key = `${bucket}:${event.type}`;
      const count = counts.get(key);
      if (count) count.count++;
      else counts.set(key, { bucket, type: event.type, count: 1 });
    }
    return [...counts.values()].sort((a, b) => a.bucket - b.bucket || (a.type < b.type ? -1 : 1));
  }
}
