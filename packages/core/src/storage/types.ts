import type { AnalyticsEvent, ChatMessage, Conversation } from '../types.js';

export interface AppendOptions {
  /**
   * The version the caller last read. When the stored conversation has moved
   * on, the append fails with a `ConflictError` and writes nothing. A
   * conversation that doesn't exist yet is at version 0.
   */
  expectedVersion?: number;
  /** Merged into the conversation's metadata (shallow, new keys win). */
  metadata?: Record<string, unknown>;
}

export interface ConversationSummary {
  id: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  metadata?: Record<string, unknown>;
}

export interface ListQuery {
  limit: number;
  /** From the previous page's `cursor`. */
  cursor?: string;
  /** Only conversations updated after this time (ms). */
  updatedAfter?: number;
}

/**
 * Where conversations live.
 *
 * `get`, `save` and `delete` are the 0.4 interface and still all a store
 * needs. A store that also has `append` lets two server instances write to the
 * same conversation without losing messages; without it the server reads,
 * changes and writes back the whole conversation, and warns once.
 */
export interface ConversationStore {
  get(id: string): Promise<Conversation | null>;
  /** Replaces the whole conversation. */
  save(conversation: Conversation): Promise<void>;
  delete(id: string): Promise<void>;
  /**
   * Adds messages at the end, creating the conversation when it doesn't
   * exist, and returns the new version. Atomic: concurrent appends never
   * lose a message.
   */
  append?(id: string, messages: ChatMessage[], options?: AppendOptions): Promise<{ version: number }>;
  /** Replaces the message with the same id. Resolves `false` when there is none. */
  updateMessage?(id: string, message: ChatMessage): Promise<boolean>;
  /** Resolves `false` when there is no such message. */
  removeMessage?(id: string, messageId: string): Promise<boolean>;
  /** Most recently updated first. */
  list?(query: ListQuery): Promise<{ items: ConversationSummary[]; cursor?: string }>;
  /** Deletes conversations last updated before `before` (ms) and returns how many. */
  purge?(before: number): Promise<number>;
}

export interface CounterValue {
  value: number;
  /** When the counter resets (ms). */
  expiresAt: number;
}

/**
 * Atomic counters that reset after a while. Rate limits and token budgets
 * are built on this, so it has to be exact under concurrent requests.
 */
export interface CounterStore {
  /**
   * Adds `by` and returns the new value. A missing or expired counter starts
   * from zero and expires `ttlMs` from now; later increments keep that expiry.
   */
  increment(key: string, by: number, ttlMs: number): Promise<CounterValue>;
  get(key: string): Promise<CounterValue | null>;
}

export interface KeyValueStore {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown, options?: { ttlMs?: number }): Promise<void>;
  /** Sets the value only when the key is missing or expired. Resolves whether it did. */
  setIfAbsent?(key: string, value: unknown, options?: { ttlMs?: number }): Promise<boolean>;
  delete(key: string): Promise<void>;
}

export interface EventQuery {
  type?: string;
  /** Start time (ms), inclusive. */
  from: number;
  /** End time (ms), exclusive. */
  to: number;
  groupBy?: 'day' | 'hour';
}

export interface EventCount {
  /** Start of the bucket (ms, UTC). */
  bucket: number;
  type: string;
  count: number;
}

export interface EventSink {
  write(events: AnalyticsEvent[]): Promise<void>;
  query?(query: EventQuery): Promise<EventCount[]>;
}

export type MetadataValue = string | number | boolean;

/**
 * Which records a search may return. Every key has to match: a value matches
 * a record whose metadata has exactly that value (same type), and an array
 * matches any of its values. A record without the key never matches.
 *
 * ```ts
 * { locale: 'de', collection: ['docs', 'pricing'] }
 * ```
 */
export type MetadataFilter = Record<string, MetadataValue | MetadataValue[]>;

/** The page or document a chunk came from. */
export interface VectorSource {
  /** Groups a page's chunks, so they can be replaced or removed together. */
  id: string;
  url: string;
  title?: string;
  /** The heading path inside the page, such as `Pricing > Enterprise`. */
  section?: string;
  /** When the page last changed (ms). */
  updatedAt?: number;
}

/** One chunk of text and its embedding. */
export interface VectorRecord {
  id: string;
  vector: Float32Array;
  text: string;
  source: VectorSource;
  metadata?: Record<string, MetadataValue>;
}

/** A search result: the record without its vector, and how well it matched. */
export interface ScoredRecord {
  id: string;
  text: string;
  source: VectorSource;
  metadata?: Record<string, MetadataValue>;
  /**
   * Higher is better. `query` scores are cosine similarity (-1 to 1);
   * `keywordQuery` scores depend on the store (BM25 in memory). The two
   * aren't on the same scale, so hybrid search combines them by rank.
   */
  score: number;
}

export interface VectorQuery {
  vector: Float32Array;
  topK: number;
  filter?: MetadataFilter;
}

export interface KeywordQuery {
  text: string;
  topK: number;
  filter?: MetadataFilter;
}

/**
 * Embedded chunks for retrieval. Every vector has `dimensions` numbers; a
 * vector of another length is an error, both stored and searched.
 */
export interface VectorStore {
  readonly dimensions: number;
  /** Adds records, replacing any with the same id. */
  upsert(records: VectorRecord[]): Promise<void>;
  /** The `topK` nearest records by cosine similarity, best first. */
  query(query: VectorQuery): Promise<ScoredRecord[]>;
  /** Full-text search, for hybrid retrieval. Best first. */
  keywordQuery?(query: KeywordQuery): Promise<ScoredRecord[]>;
  /** Removes every record from that source. */
  deleteBySource(sourceId: string): Promise<void>;
}

/**
 * Everything the server stores. Only `conversations` is required. Without
 * `counters`, rate limits are kept per process; without `kv`, per-conversation
 * locks are too.
 */
export interface ChatCopsStorage {
  conversations: ConversationStore;
  counters?: CounterStore;
  kv?: KeyValueStore;
  events?: EventSink;
  /** Embedded chunks, for answering from the site's own pages. */
  vectors?: VectorStore;
  /** Closes connections, for scripts and tests. */
  close?(): Promise<void>;
}
