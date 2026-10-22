import type { ChatCopsStorage } from '@chatcops/core';
import { CloudflareConversations } from './conversations.js';
import { type ChatCopsCounter, D1Counters, DoCounters } from './counters.js';
import { CloudflareEvents } from './events.js';
import { D1KvStore } from './kv.js';
import { checkRowHook, type ExtraColumns, type RowHookFunction } from './row-hook.js';
import { ensureSchema } from './schema.js';
import type { D1Database, DurableObjectNamespace } from './types.js';

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
} from './types.js';
export type { ExtraColumns, RowHookContext, RowHookFunction } from './row-hook.js';

export interface CloudflareStorageOptions {
  /** The D1 database binding. Required. */
  d1: D1Database;
  /** Optional Durable Object namespace for exact distributed counters. */
  counters?: DurableObjectNamespace<ChatCopsCounter>;
  /**
   * Columns you've added to the conversations and messages tables (with your
   * own `ALTER TABLE`), filled in by `rowHook` when a row is created.
   */
  extraColumns?: ExtraColumns;
  /**
   * Values for `extraColumns` on each new conversation and message row. Runs
   * on insert only, never on update. Returning a key that isn't declared in
   * `extraColumns` throws, and nothing from that write is stored. Values are
   * bound as parameters, never put into the SQL.
   */
  rowHook?: RowHookFunction;
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
  const hook = checkRowHook(options.extraColumns, options.rowHook);

  return {
    conversations: new CloudflareConversations(options.d1, now, ensure, hook),
    counters: options.counters
      ? new DoCounters(options.counters)
      : new D1Counters(options.d1, now, ensure),
    // Turn locks need an atomic setIfAbsent, which Workers KV doesn't have,
    // so key-value data always lives in D1.
    kv: new D1KvStore(options.d1, now, ensure),
    events: new CloudflareEvents(options.d1, ensure),
    close: async () => {},
  };
}
