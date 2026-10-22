import type { ChatCopsStorage } from '@chatcops/core';
import { CloudflareConversations } from './conversations.js';
import { type ChatCopsCounter, D1Counters, DoCounters } from './counters.js';
import { CloudflareEvents } from './events.js';
import { D1KvStore, WorkersKvStore } from './kv.js';
import { ensureSchema } from './schema.js';
import type { D1Database, DurableObjectNamespace, KVNamespace } from './types.js';

export { ChatCopsCounter } from './counters.js';
export { SCHEMA_SQL, SCHEMA_VERSION, initializeSchema } from './schema.js';
export type {
  D1Database,
  D1ExecResult,
  D1PreparedStatement,
  D1Result,
  DurableObjectId,
  DurableObjectNamespace,
  DurableObjectState,
  DurableObjectStorage,
  DurableObjectStub,
  KVNamespace,
} from './types.js';

export interface CloudflareStorageOptions {
  /** The D1 database binding. Required. */
  d1: D1Database;
  /** Optional Workers KV namespace for key-value data. */
  kv?: KVNamespace;
  /** Optional Durable Object namespace for exact distributed counters. */
  counters?: DurableObjectNamespace<ChatCopsCounter>;
  /** Optional custom clock for testing. */
  now?: () => number;
}

/**
 * Cloudflare storage for ChatCops: conversations, rate limit counters,
 * turn locks, and analytics events backed by Cloudflare D1, Workers KV,
 * and Durable Objects.
 */
export function cloudflareStorage(options: CloudflareStorageOptions): ChatCopsStorage {
  if (!options?.d1) {
    throw new Error('cloudflareStorage requires a D1 database');
  }

  const now = options.now ?? Date.now;
  const ensure = () => ensureSchema(options.d1);

  return {
    conversations: new CloudflareConversations(options.d1, now, ensure),
    counters: options.counters
      ? new DoCounters(options.counters)
      : new D1Counters(options.d1, now, ensure),
    kv: options.kv
      ? new WorkersKvStore(options.kv)
      : new D1KvStore(options.d1, now, ensure),
    events: new CloudflareEvents(options.d1, ensure),
    close: async () => {},
  };
}
