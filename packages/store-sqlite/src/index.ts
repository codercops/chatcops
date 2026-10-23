import {
  ConflictError,
  type AnalyticsEvent,
  type AppendOptions,
  type ChatCopsStorage,
  type ChatMessage,
  type Conversation,
  type ConversationStore,
  type CounterStore,
  type EventQuery,
  type EventSink,
  type KeyValueStore,
  type ListQuery,
} from '@chatcops/core';
import { all, get, openDatabase, run, transaction, type SqliteDatabase } from './database.js';
import { checkRowHook, type ExtraColumns, type RowHook, type RowHookContext, type RowHookFunction } from './row-hook.js';
import { initializeSchema } from './schema.js';

export type { ExtraColumns, RowHookContext, RowHookFunction } from './row-hook.js';

export interface SqliteStorageOptions {
  /** A database file, or `:memory:`. */
  path?: string;
  /** An open `node:sqlite` `DatabaseSync`, or a compatible better-sqlite3 database. */
  database?: SqliteDatabase;
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
}

interface ConversationRow { id: string; metadata: string | null; version: number; created_at: number; updated_at: number }
interface MessageRow { message: string }
interface RunResult { changes?: number | bigint; lastInsertRowid?: number | bigint }

const json = (value: unknown): string | null => value === undefined ? null : JSON.stringify(value);
const changes = (result: RunResult): number => Number(result.changes ?? 0);
const now = () => Date.now();

class SqliteConversations implements ConversationStore {
  private readonly conversationInsert: string;
  private readonly messageInsert: string;

  constructor(
    private readonly db: SqliteDatabase,
    private readonly clock: () => number,
    private readonly hook?: RowHook
  ) {
    const extra = hook?.columns.map((name) => `, ${name}`).join('') ?? '';
    const marks = hook?.columns.map(() => ', ?').join('') ?? '';
    this.conversationInsert = `INSERT INTO chatcops_conversations (id, metadata, version, created_at, updated_at${extra}) VALUES (?, ?, ?, ?, ?${marks})`;
    this.messageInsert = `INSERT INTO chatcops_messages (conversation_id, seq, id, message${extra}) VALUES (?, ?, ?, ?${marks})`;
  }

  /** The hook's values for one new row, or nothing without a hook. */
  private extra(context: RowHookContext): unknown[] {
    return this.hook ? this.hook.values(context) : [];
  }

  private insertMessages(id: string, after: number, messages: ChatMessage[], metadata: Record<string, unknown> | undefined): void {
    for (const [index, message] of messages.entries()) {
      run(
        this.db,
        this.messageInsert,
        id,
        after + index + 1,
        message.id,
        JSON.stringify(message),
        ...this.extra({ table: 'messages', conversationId: id, metadata, message })
      );
    }
  }

  get(id: string): Promise<Conversation | null> {
    const row = get<ConversationRow>(this.db, 'SELECT * FROM chatcops_conversations WHERE id = ?', id);
    if (!row) return Promise.resolve(null);
    const messages = all<MessageRow>(
      this.db,
      'SELECT message FROM chatcops_messages WHERE conversation_id = ? ORDER BY seq',
      id
    ).map((m) => JSON.parse(m.message) as ChatMessage);
    return Promise.resolve({
      id: row.id,
      messages,
      ...(row.metadata ? { metadata: JSON.parse(row.metadata) } : {}),
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  save(conversation: Conversation): Promise<void> {
    transaction(this.db, () => {
      const current = get<ConversationRow>(this.db, 'SELECT version FROM chatcops_conversations WHERE id = ?', conversation.id);
      const version = (current?.version ?? 0) + 1;
      // The hook's columns are only in the INSERT half, so an update never changes them.
      run(
        this.db,
        `${this.conversationInsert}
         ON CONFLICT(id) DO UPDATE SET
           metadata = excluded.metadata,
           version = excluded.version,
           created_at = excluded.created_at,
           updated_at = excluded.updated_at`,
        conversation.id,
        json(conversation.metadata),
        version,
        conversation.createdAt,
        this.clock(),
        ...this.extra({ table: 'conversations', conversationId: conversation.id, metadata: conversation.metadata })
      );
      run(this.db, 'DELETE FROM chatcops_messages WHERE conversation_id = ?', conversation.id);
      this.insertMessages(conversation.id, 0, conversation.messages, conversation.metadata);
    });
    return Promise.resolve();
  }

  delete(id: string): Promise<void> {
    run(this.db, 'DELETE FROM chatcops_conversations WHERE id = ?', id);
    return Promise.resolve();
  }

  async append(id: string, messages: ChatMessage[], options: AppendOptions = {}): Promise<{ version: number }> {
    const version = transaction(this.db, () => {
      const current = get<ConversationRow>(this.db, 'SELECT version, metadata FROM chatcops_conversations WHERE id = ?', id);
      const actual = current?.version ?? 0;
      if (options.expectedVersion !== undefined && options.expectedVersion !== actual) throw new ConflictError(id, options.expectedVersion, actual);
      const time = this.clock();
      const metadata = options.metadata || current?.metadata
        ? { ...(current?.metadata ? JSON.parse(current.metadata) : {}), ...(options.metadata ?? {}) }
        : undefined;
      if (!current) {
        run(
          this.db,
          this.conversationInsert,
          id,
          json(metadata),
          1,
          time,
          time,
          ...this.extra({ table: 'conversations', conversationId: id, metadata: options.metadata })
        );
      } else {
        run(
          this.db,
          'UPDATE chatcops_conversations SET metadata = ?, version = version + 1, updated_at = ? WHERE id = ?',
          json(metadata),
          time,
          id
        );
      }
      const last = get<{ seq: number }>(this.db, 'SELECT COALESCE(MAX(seq), 0) AS seq FROM chatcops_messages WHERE conversation_id = ?', id)?.seq ?? 0;
      this.insertMessages(id, last, messages, options.metadata);
      return actual + 1;
    });
    return { version };
  }

  updateMessage(id: string, message: ChatMessage): Promise<boolean> {
    const result = transaction(this.db, () => {
      const updated = run<RunResult>(
        this.db,
        'UPDATE chatcops_messages SET message = ? WHERE conversation_id = ? AND id = ?',
        JSON.stringify(message),
        id,
        message.id
      );
      if (!changes(updated)) return false;
      run(this.db, 'UPDATE chatcops_conversations SET version = version + 1, updated_at = ? WHERE id = ?', this.clock(), id);
      return true;
    });
    return Promise.resolve(result);
  }

  removeMessage(id: string, messageId: string): Promise<boolean> {
    const result = transaction(this.db, () => {
      const removed = run<RunResult>(this.db, 'DELETE FROM chatcops_messages WHERE conversation_id = ? AND id = ?', id, messageId);
      if (!changes(removed)) return false;
      run(this.db, 'UPDATE chatcops_conversations SET version = version + 1, updated_at = ? WHERE id = ?', this.clock(), id);
      return true;
    });
    return Promise.resolve(result);
  }

  list(query: ListQuery): Promise<{
    items: Array<{
      id: string;
      createdAt: number;
      updatedAt: number;
      messageCount: number;
      metadata?: Record<string, unknown>;
    }>;
    cursor?: string;
  }> {
    const separator = query.cursor?.indexOf(':') ?? -1;
    const cursorTime = separator === -1 ? null : Number(query.cursor?.slice(0, separator));
    const cursorId = separator === -1 ? null : query.cursor?.slice(separator + 1) ?? null;
    const rows = all<ConversationRow & { message_count: number }>(
      this.db,
      `SELECT c.*, COUNT(m.seq) AS message_count
       FROM chatcops_conversations c
       LEFT JOIN chatcops_messages m ON m.conversation_id = c.id
       WHERE (? IS NULL OR c.updated_at > ?)
         AND (? IS NULL OR c.updated_at < ? OR (c.updated_at = ? AND c.id > ?))
       GROUP BY c.id
       ORDER BY c.updated_at DESC, c.id ASC
       LIMIT ?`,
      query.updatedAfter ?? null,
      query.updatedAfter ?? null,
      cursorTime,
      cursorTime,
      cursorTime,
      cursorId,
      query.limit + 1
    );
    const page = rows.slice(0, query.limit);
    const items = page.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      messageCount: Number(row.message_count),
      ...(row.metadata ? { metadata: JSON.parse(row.metadata) } : {}),
    }));
    const last = page.at(-1);
    return Promise.resolve(rows.length > query.limit && last ? { items, cursor: `${last.updated_at}:${last.id}` } : { items });
  }

  purge(before: number): Promise<number> {
    return Promise.resolve(
      changes(run<RunResult>(this.db, 'DELETE FROM chatcops_conversations WHERE updated_at < ?', before))
    );
  }
}

class SqliteCounters implements CounterStore {
  constructor(private readonly db: SqliteDatabase, private readonly clock: () => number) {}
  increment(key: string, by: number, ttlMs: number): Promise<{ value: number; expiresAt: number }> {
    const time = this.clock();
    const row = get<{ value: number; expires_at: number }>(
      this.db,
      `INSERT INTO chatcops_counters (key, value, expires_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         value = CASE WHEN chatcops_counters.expires_at <= ?
           THEN excluded.value ELSE chatcops_counters.value + excluded.value END,
         expires_at = CASE WHEN chatcops_counters.expires_at <= ?
           THEN excluded.expires_at ELSE chatcops_counters.expires_at END
       RETURNING value, expires_at`,
      key,
      by,
      time + ttlMs,
      time,
      time
    );
    if (!row) throw new Error('SQLite counter upsert did not return a row');
    return Promise.resolve({ value: Number(row.value), expiresAt: Number(row.expires_at) });
  }

  get(key: string): Promise<{ value: number; expiresAt: number } | null> {
    const row = get<{ value: number; expires_at: number }>(
      this.db,
      'SELECT value, expires_at FROM chatcops_counters WHERE key = ? AND expires_at > ?',
      key,
      this.clock()
    );
    return Promise.resolve(row ? { value: Number(row.value), expiresAt: Number(row.expires_at) } : null);
  }
}

class SqliteKv implements KeyValueStore {
  constructor(private readonly db: SqliteDatabase, private readonly clock: () => number) {}
  get<T = unknown>(key: string): Promise<T | null> {
    const row = get<{ value: string }>(
      this.db,
      'SELECT value FROM chatcops_kv WHERE key = ? AND (expires_at IS NULL OR expires_at > ?)',
      key,
      this.clock()
    );
    return Promise.resolve(row ? (JSON.parse(row.value) as T) : null);
  }

  set(key: string, value: unknown, options: { ttlMs?: number } = {}): Promise<void> {
    run(
      this.db,
      `INSERT INTO chatcops_kv (key, value, expires_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value,
         expires_at = excluded.expires_at`,
      key,
      JSON.stringify(value),
      options.ttlMs === undefined ? null : this.clock() + options.ttlMs
    );
    return Promise.resolve();
  }

  setIfAbsent(key: string, value: unknown, options: { ttlMs?: number } = {}): Promise<boolean> {
    const result = run<RunResult>(
      this.db,
      `INSERT INTO chatcops_kv (key, value, expires_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at
       WHERE chatcops_kv.expires_at IS NOT NULL AND chatcops_kv.expires_at <= ?`,
      key,
      JSON.stringify(value),
      options.ttlMs === undefined ? null : this.clock() + options.ttlMs,
      this.clock()
    );
    return Promise.resolve(changes(result) > 0);
  }

  delete(key: string): Promise<void> {
    run(this.db, 'DELETE FROM chatcops_kv WHERE key = ?', key);
    return Promise.resolve();
  }
}

class SqliteEvents implements EventSink {
  constructor(private readonly db: SqliteDatabase) {}
  write(events: AnalyticsEvent[]): Promise<void> {
    for (const event of events) {
      run(
        this.db,
        'INSERT INTO chatcops_events (type, data, created_at) VALUES (?, ?, ?)',
        event.type,
        json(event.data),
        event.timestamp
      );
    }
    return Promise.resolve();
  }

  query(query: EventQuery): Promise<Array<{ bucket: number; type: string; count: number }>> {
    const size = query.groupBy === 'hour' ? 3_600_000 : 86_400_000;
    const rows = all<{ bucket: number; type: string; count: number }>(
      this.db,
      `SELECT CAST((created_at / ?) AS INTEGER) * ? AS bucket, type, COUNT(*) AS count
       FROM chatcops_events
       WHERE created_at >= ? AND created_at < ? AND (? IS NULL OR type = ?)
       GROUP BY bucket, type
       ORDER BY bucket, type`,
      size,
      size,
      query.from,
      query.to,
      query.type ?? null,
      query.type ?? null
    );
    return Promise.resolve(rows.map((row) => ({ bucket: Number(row.bucket), type: row.type, count: Number(row.count) })));
  }
}

export function sqliteStorage(options: SqliteStorageOptions): ChatCopsStorage {
  if ((!options.path && !options.database) || (options.path && options.database)) throw new Error('sqliteStorage requires exactly one of path or database');
  const hook = checkRowHook(options.extraColumns, options.rowHook);
  const database = options.database ?? openDatabase(options.path ?? '');
  initializeSchema(database);
  const clock = now;
  return {
    conversations: new SqliteConversations(database, clock, hook),
    counters: new SqliteCounters(database, clock),
    kv: new SqliteKv(database, clock),
    events: new SqliteEvents(database),
    close: options.database ? async () => {} : async () => database.close?.(),
  };
}

export type { SqliteDatabase } from './database.js';
