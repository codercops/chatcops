import {
  ConflictError,
  type AppendOptions,
  type ChatMessage,
  type Conversation,
  type ConversationStore,
  type ConversationSummary,
  type ListQuery,
} from '@chatcops/core';
import type { Queryable } from './queryable.js';
import type { RowHook } from './row-hook.js';
import type { TableNames } from './schema.js';
import { json, ms, param, toTime } from './sql.js';

const KNOWN_FIELDS = new Set(['id', 'role', 'content', 'parts', 'status', 'usage', 'aiGenerated', 'timestamp', 'metadata']);

interface MessageRow {
  id: string;
  role: ChatMessage['role'];
  content: string;
  parts: ChatMessage['parts'] | null;
  status: ChatMessage['status'] | null;
  usage: ChatMessage['usage'] | null;
  ai_generated: boolean | null;
  metadata: Record<string, unknown> | null;
  extra: Record<string, unknown> | null;
  sent_ms: number;
}

interface ConversationRow {
  id: string;
  metadata: Record<string, unknown> | null;
  version: number;
  created_ms: number;
  updated_ms: number;
  messages: MessageRow[];
}

/** The columns of a message, in insert order. */
const MESSAGE_COLUMNS = 'id, role, content, parts, status, usage, ai_generated, metadata, extra, sent_at';

function messageValues(message: ChatMessage): unknown[] {
  const extra = Object.fromEntries(Object.entries(message).filter(([key]) => !KNOWN_FIELDS.has(key)));
  return [
    message.id,
    message.role,
    message.content,
    json(message.parts),
    param(message.status),
    json(message.usage),
    param(message.aiGenerated),
    json(message.metadata),
    Object.keys(extra).length ? JSON.stringify(extra) : null,
    message.timestamp,
  ];
}

function toMessage(row: MessageRow): ChatMessage {
  return {
    ...(row.extra ?? {}),
    id: row.id,
    role: row.role,
    content: row.content,
    ...(row.parts ? { parts: row.parts } : {}),
    ...(row.status ? { status: row.status } : {}),
    ...(row.usage ? { usage: row.usage } : {}),
    ...(row.ai_generated !== null ? { aiGenerated: row.ai_generated } : {}),
    timestamp: Number(row.sent_ms),
    ...(row.metadata ? { metadata: row.metadata } : {}),
  };
}

export class PostgresConversationStore implements ConversationStore {
  constructor(
    private readonly db: Queryable,
    private readonly t: TableNames,
    private readonly now: () => number,
    private readonly hook?: RowHook
  ) {}

  /** The hook's extra columns for one new row, as SQL and bound params. */
  private extraFor(
    table: 'conversations' | 'messages',
    context: { conversationId: string; metadata?: Record<string, unknown>; message?: ChatMessage },
    params: unknown[]
  ): { columns: string; values: string } {
    if (!this.hook) return { columns: '', values: '' };
    const row = this.hook.values({ table, ...context });
    const values = this.hook.columns.map(([name, type]) => {
      params.push(row[name] ?? null);
      return `$${params.length}::${type}`;
    });
    return { columns: this.hook.columnList, values: values.map((v) => `, ${v}`).join('') };
  }

  /**
   * Inserts `messages` after the conversation's last sequence number. `conv`
   * is a CTE returning `next_seq` after the upsert, which already counts
   * these messages, so the first one gets `next_seq - count + 1`.
   */
  private insertMessages(
    conversationId: string,
    metadata: Record<string, unknown> | undefined,
    messages: ChatMessage[],
    params: unknown[],
    idParam: string
  ): string {
    let hookColumns = '';
    const rows = messages.map((message, i) => {
      const placeholders = messageValues(message).map((value) => {
        params.push(value);
        return `$${params.length}`;
      });
      const [id, role, content, parts, status, usage, ai, meta, extra, sent] = placeholders;
      const hooked = this.extraFor('messages', { conversationId, metadata, message }, params);
      hookColumns = hooked.columns;
      return `(${i + 1}, ${id}::text, ${role}::text, ${content}::text, ${parts}::text::jsonb, ${status}::text, ${usage}::text::jsonb, ${ai}::boolean, ${meta}::text::jsonb, ${extra}::text::jsonb, ${toTime(sent)}${hooked.values})`;
    });
    params.push(messages.length);
    const count = `$${params.length}::int`;
    const hookSelect = (this.hook?.columns ?? []).map(([name]) => `, v.${name}`).join('');
    return `ins AS (
      INSERT INTO ${this.t.messages} (conversation_id, seq, ${MESSAGE_COLUMNS}${hookColumns})
      SELECT ${idParam}, conv.next_seq - ${count} + v.ord, v.id, v.role, v.content, v.parts, v.status, v.usage, v.ai_generated, v.metadata, v.extra, v.sent_at${hookSelect}
      FROM conv, (VALUES ${rows.join(', ')}) AS v (ord, ${MESSAGE_COLUMNS}${hookColumns})
    )`;
  }

  async get(id: string): Promise<Conversation | null> {
    const { rows } = await this.db.query<ConversationRow>(
      `SELECT c.id, c.metadata, c.version, ${ms('c.created_at')} AS created_ms, ${ms('c.updated_at')} AS updated_ms,
        coalesce((
          SELECT jsonb_agg(to_jsonb(m) - 'conversation_id' || jsonb_build_object('sent_ms', ${ms('m.sent_at')}) ORDER BY m.seq)
          FROM ${this.t.messages} m WHERE m.conversation_id = c.id
        ), '[]'::jsonb) AS messages
      FROM ${this.t.conversations} c WHERE c.id = $1`,
      [id]
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      messages: row.messages.map(toMessage),
      ...(row.metadata ? { metadata: row.metadata } : {}),
      version: Number(row.version),
      createdAt: Number(row.created_ms),
      updatedAt: Number(row.updated_ms),
    };
  }

  /** Replaces the whole conversation, as 0.4 stores did. */
  async save(conversation: Conversation): Promise<void> {
    const params: unknown[] = [conversation.id, json(conversation.metadata), conversation.messages.length, conversation.createdAt, this.now()];
    const hooked = this.extraFor('conversations', { conversationId: conversation.id, metadata: conversation.metadata }, params);
    const insert = conversation.messages.length
      ? `, ${this.insertMessages(conversation.id, conversation.metadata, conversation.messages, params, '$1')}`
      : '';
    await this.db.query(
      `WITH conv AS (
        INSERT INTO ${this.t.conversations} AS c (id, metadata, version, next_seq, created_at, updated_at${hooked.columns})
        VALUES ($1, $2::text::jsonb, 1, $3::int, ${toTime('$4')}, ${toTime('$5')}${hooked.values})
        ON CONFLICT (id) DO UPDATE SET
          metadata = EXCLUDED.metadata,
          version = c.version + 1,
          next_seq = c.next_seq + EXCLUDED.next_seq,
          created_at = EXCLUDED.created_at,
          updated_at = EXCLUDED.updated_at
        RETURNING c.version, c.next_seq
      ),
      del AS (
        DELETE FROM ${this.t.messages}
        WHERE conversation_id = $1 AND seq <= (SELECT next_seq FROM conv) - $3::int
      )${insert}
      SELECT version FROM conv`,
      params
    );
  }

  async delete(id: string): Promise<void> {
    await this.db.query(`DELETE FROM ${this.t.conversations} WHERE id = $1`, [id]);
  }

  async append(id: string, messages: ChatMessage[], options: AppendOptions = {}): Promise<{ version: number }> {
    const expected = options.expectedVersion ?? null;
    const params: unknown[] = [id, json(options.metadata), messages.length, this.now(), expected];
    const hooked = this.extraFor('conversations', { conversationId: id, metadata: options.metadata }, params);
    const insert = messages.length ? `, ${this.insertMessages(id, options.metadata, messages, params, '$1')}` : '';

    // One statement, so it's atomic without a transaction. The upsert locks
    // the conversation row, and a concurrent append waits for it and then
    // sees the latest version and sequence number. A new conversation is only
    // created when no version, or version 0, was expected.
    const { rows } = await this.db.query<{ version: number }>(
      `WITH conv AS (
        INSERT INTO ${this.t.conversations} AS c (id, metadata, version, next_seq, created_at, updated_at${hooked.columns})
        SELECT $1, $2::text::jsonb, 1, $3::int, ${toTime('$4')}, ${toTime('$4')}${hooked.values}
        WHERE $5::int IS NULL OR $5::int = 0
          OR EXISTS (SELECT 1 FROM ${this.t.conversations} WHERE id = $1)
        ON CONFLICT (id) DO UPDATE SET
          version = c.version + 1,
          next_seq = c.next_seq + EXCLUDED.next_seq,
          updated_at = EXCLUDED.updated_at,
          metadata = CASE
            WHEN EXCLUDED.metadata IS NULL THEN c.metadata
            ELSE coalesce(c.metadata, '{}'::jsonb) || EXCLUDED.metadata
          END
        WHERE $5::int IS NULL OR c.version = $5::int
        RETURNING c.version, c.next_seq
      )${insert}
      SELECT version FROM conv`,
      params
    );

    const row = rows[0];
    if (row) return { version: Number(row.version) };

    const current = await this.db.query<{ version: number }>(
      `SELECT version FROM ${this.t.conversations} WHERE id = $1`,
      [id]
    );
    throw new ConflictError(id, expected ?? 0, Number(current.rows[0]?.version ?? 0));
  }

  async updateMessage(id: string, message: ChatMessage): Promise<boolean> {
    const values = messageValues(message);
    const { rows } = await this.db.query<{ updated: number }>(
      `WITH m AS (
        UPDATE ${this.t.messages} SET
          role = $3::text, content = $4::text, parts = $5::text::jsonb, status = $6::text, usage = $7::text::jsonb,
          ai_generated = $8::boolean, metadata = $9::text::jsonb, extra = $10::text::jsonb, sent_at = ${toTime('$11')}
        WHERE conversation_id = $1 AND id = $2
        RETURNING 1
      ),
      bump AS (
        UPDATE ${this.t.conversations} SET version = version + 1, updated_at = ${toTime('$12')}
        WHERE id = $1 AND EXISTS (SELECT 1 FROM m)
      )
      SELECT count(*)::int AS updated FROM m`,
      [id, ...values, this.now()]
    );
    return Number(rows[0]?.updated ?? 0) > 0;
  }

  async removeMessage(id: string, messageId: string): Promise<boolean> {
    const { rows } = await this.db.query<{ removed: number }>(
      `WITH m AS (
        DELETE FROM ${this.t.messages} WHERE conversation_id = $1 AND id = $2 RETURNING 1
      ),
      bump AS (
        UPDATE ${this.t.conversations} SET version = version + 1, updated_at = ${toTime('$3')}
        WHERE id = $1 AND EXISTS (SELECT 1 FROM m)
      )
      SELECT count(*)::int AS removed FROM m`,
      [id, messageId, this.now()]
    );
    return Number(rows[0]?.removed ?? 0) > 0;
  }

  async list(query: ListQuery): Promise<{ items: ConversationSummary[]; cursor?: string }> {
    let cursorTime: number | null = null;
    let cursorId: string | null = null;
    if (query.cursor) {
      const split = query.cursor.indexOf(':');
      cursorTime = Number(query.cursor.slice(0, split));
      cursorId = query.cursor.slice(split + 1);
      if (split === -1 || !Number.isFinite(cursorTime)) throw new Error(`Not a list cursor: "${query.cursor}".`);
    }

    const { rows } = await this.db.query<Omit<ConversationRow, 'messages'> & { message_count: number }>(
      `SELECT c.id, c.metadata, ${ms('c.created_at')} AS created_ms, ${ms('c.updated_at')} AS updated_ms,
        (SELECT count(*)::int FROM ${this.t.messages} m WHERE m.conversation_id = c.id) AS message_count
      FROM ${this.t.conversations} c
      WHERE ($1::float8 IS NULL OR c.updated_at > ${toTime('$1')})
        AND ($2::float8 IS NULL OR c.updated_at < ${toTime('$2')} OR (c.updated_at = ${toTime('$2')} AND c.id > $3::text))
      ORDER BY c.updated_at DESC, c.id ASC
      LIMIT $4::int`,
      [param(query.updatedAfter), cursorTime, cursorId, query.limit + 1]
    );

    const page = rows.slice(0, query.limit);
    const items = page.map((row) => ({
      id: row.id,
      createdAt: Number(row.created_ms),
      updatedAt: Number(row.updated_ms),
      messageCount: Number(row.message_count),
      ...(row.metadata ? { metadata: row.metadata } : {}),
    }));
    const last = items.at(-1);
    return rows.length > query.limit && last ? { items, cursor: `${last.updatedAt}:${last.id}` } : { items };
  }

  /**
   * Deletes conversations last updated before `before`, with their messages.
   * Also clears expired counters and keys, which nothing else removes.
   */
  async purge(before: number): Promise<number> {
    const { rows } = await this.db.query<{ purged: number }>(
      `WITH gone AS (
        DELETE FROM ${this.t.conversations} WHERE updated_at < ${toTime('$1')} RETURNING 1
      ),
      counters AS (DELETE FROM ${this.t.counters} WHERE expires_at <= ${toTime('$2')}),
      keys AS (DELETE FROM ${this.t.kv} WHERE expires_at <= ${toTime('$2')})
      SELECT count(*)::int AS purged FROM gone`,
      [before, this.now()]
    );
    return Number(rows[0]?.purged ?? 0);
  }
}
