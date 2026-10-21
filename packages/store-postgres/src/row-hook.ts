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
 * Columns you've added to the conversations and messages tables, by name, or
 * by name and SQL type (default `text`), for example
 * `{ workspace_id: 'uuid', site_id: 'uuid' }`.
 */
export type ExtraColumns = string[] | Record<string, string>;

const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;
const SQL_TYPE = /^[a-z][a-z0-9_ ]{0,40}(\[\])?$/;
const RESERVED = new Set([
  'id', 'metadata', 'version', 'next_seq', 'created_at', 'updated_at',
  'conversation_id', 'seq', 'role', 'content', 'parts', 'status', 'usage', 'ai_generated', 'extra', 'sent_at',
]);

/** A checked hook: the columns it may set, and a function that refuses any others. */
export interface RowHook {
  columns: Array<[name: string, type: string]>;
  /** `, a, b` for an INSERT column list. */
  columnList: string;
  values(context: RowHookContext): Record<string, unknown>;
}

export function checkRowHook(extraColumns: ExtraColumns | undefined, rowHook: RowHookFunction | undefined): RowHook | undefined {
  if (!rowHook && !extraColumns) return undefined;
  if (!rowHook || !extraColumns) throw new Error('postgresStorage needs both extraColumns and rowHook, or neither.');

  const columns: Array<[string, string]> = Array.isArray(extraColumns)
    ? extraColumns.map((name) => [name, 'text'])
    : Object.entries(extraColumns);
  for (const [name, type] of columns) {
    if (!IDENTIFIER.test(name)) throw new Error(`extraColumns: "${name}" isn't a plain lowercase column name.`);
    if (RESERVED.has(name)) throw new Error(`extraColumns: "${name}" is one of the store's own columns.`);
    if (!SQL_TYPE.test(type)) throw new Error(`extraColumns: "${type}" isn't a SQL type name.`);
  }
  const allowed = new Set(columns.map(([name]) => name));

  return {
    columns,
    columnList: columns.map(([name]) => `, ${name}`).join(''),
    values(context) {
      const row = rowHook(context) ?? {};
      for (const key of Object.keys(row)) {
        if (!allowed.has(key)) {
          throw new Error(`rowHook returned "${key}", which isn't in extraColumns. Declare it there first.`);
        }
      }
      return row;
    },
  };
}
