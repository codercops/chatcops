import type { ChatCopsStorage } from '@chatcops/core';
import { PostgresConversationStore } from './conversations.js';
import { PostgresCounterStore, PostgresEventSink, PostgresKeyValueStore } from './counters.js';
import type { Queryable } from './queryable.js';
import { checkRowHook, type ExtraColumns, type RowHookFunction } from './row-hook.js';
import { tableNames } from './schema.js';

export { fromNeon, fromPostgresJs, type NeonSql, type PostgresJsSql, type Queryable } from './queryable.js';
export { migrate, MIGRATIONS, tableNames, type MigrateOptions, type TableNames } from './schema.js';
export { PostgresConversationStore } from './conversations.js';
export type { ExtraColumns, RowHookContext, RowHookFunction } from './row-hook.js';
export { PostgresCounterStore, PostgresEventSink, PostgresKeyValueStore } from './counters.js';

export interface PostgresStorageOptions {
  /** A `pg` `Pool`, or a wrapped postgres.js or Neon client (`fromPostgresJs`, `fromNeon`). */
  db: Queryable;
  /** Default `chatcops_`. Lets several apps share one database. */
  tablePrefix?: string;
  /**
   * Columns you've added to the conversations and messages tables (with your
   * own migration), filled in by `rowHook` when a row is created. Names, or
   * names and SQL types: `{ workspace_id: 'uuid' }`.
   */
  extraColumns?: ExtraColumns;
  /**
   * Values for `extraColumns` on each new conversation and message row. Runs
   * on insert only, never on update. Returning a key that isn't declared in
   * `extraColumns` throws. Values are sent as query parameters, never put
   * into the SQL.
   */
  rowHook?: RowHookFunction;
  /** Clock, for tests. */
  now?: () => number;
}

/**
 * Everything ChatCops stores, in Postgres: conversations, rate limit
 * counters, keys (turn locks) and analytics events. Run `migrate(db)` (or
 * `npx chatcops-postgres migrate`) once before first use.
 *
 * Works with any driver: every write is a single statement, so nothing needs
 * a transaction or a dedicated connection.
 */
export function postgresStorage(options: PostgresStorageOptions): ChatCopsStorage {
  const t = tableNames(options.tablePrefix);
  const now = options.now ?? Date.now;
  return {
    conversations: new PostgresConversationStore(options.db, t, now, checkRowHook(options.extraColumns, options.rowHook)),
    counters: new PostgresCounterStore(options.db, t, now),
    kv: new PostgresKeyValueStore(options.db, t, now),
    events: new PostgresEventSink(options.db, t),
  };
}
