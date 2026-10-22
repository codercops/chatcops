import type { ChatMessage } from '@chatcops/core';

/** What the hook gets for each new row. */
export interface RowHookContext {
  table: 'conversations' | 'messages';
  conversationId: string;
  /** The metadata passed with this write (`append` options or the saved conversation). */
  metadata?: Record<string, unknown>;
  /** The message being inserted, for the messages table. */
  message?: ChatMessage;
}

export type RowHookFunction = (context: RowHookContext) => Record<string, unknown>;

/**
 * Columns you've added to the conversations and messages tables, by name.
 * The `{ name: type }` form from `@chatcops/store-postgres` works too, so one
 * config fits both stores; SQLite stores each value with its own type, so the
 * type is ignored here.
 */
export type ExtraColumns = string[] | Record<string, string>;

const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;
const RESERVED = new Set(['id', 'metadata', 'version', 'created_at', 'updated_at', 'conversation_id', 'seq', 'message']);

/** A checked hook: the columns it may set, and a function that refuses any others. */
export interface RowHook {
  columns: string[];
  /** The values for `columns`, in order, ready to bind. */
  values(context: RowHookContext): unknown[];
}

export function checkRowHook(extraColumns: ExtraColumns | undefined, rowHook: RowHookFunction | undefined): RowHook | undefined {
  if (!rowHook && !extraColumns) return undefined;
  if (!rowHook || !extraColumns) throw new Error('sqliteStorage needs both extraColumns and rowHook, or neither.');

  const columns = Array.isArray(extraColumns) ? extraColumns : Object.keys(extraColumns);
  for (const name of columns) {
    if (!IDENTIFIER.test(name)) throw new Error(`extraColumns: "${name}" isn't a plain lowercase column name.`);
    if (RESERVED.has(name)) throw new Error(`extraColumns: "${name}" is one of the store's own columns.`);
  }
  const allowed = new Set(columns);

  return {
    columns,
    values(context) {
      const row = rowHook(context) ?? {};
      for (const key of Object.keys(row)) {
        if (!allowed.has(key)) {
          throw new Error(`rowHook returned "${key}", which isn't in extraColumns. Declare it there first.`);
        }
      }
      return columns.map((name) => bindable(name, row[name]));
    },
  };
}

/** node:sqlite binds strings, numbers, bigints, bytes and null. Booleans are stored as the integers 1 and 0. */
function bindable(name: string, value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value ? 1n : 0n;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint' || value instanceof Uint8Array) return value;
  throw new Error(`rowHook returned an unsupported value (${typeof value}) for "${name}". Use a string, number, boolean or null.`);
}
