import {
  ConflictError,
  type AppendOptions,
  type ChatMessage,
  type Conversation,
  type ConversationStore,
  type ConversationSummary,
  type ListQuery,
} from '@chatcops/core';
import type { D1Database, D1PreparedStatement } from './types.js';

interface ConversationRow {
  id: string;
  metadata: string | null;
  version: number;
  created_at: number;
  updated_at: number;
}

interface MessageRow {
  message: string;
}

const json = (value: unknown): string | null => (value === undefined ? null : JSON.stringify(value));

export class CloudflareConversations implements ConversationStore {
  constructor(
    private readonly db: D1Database,
    private readonly now: () => number,
    private readonly ensure: () => Promise<void>
  ) {}

  async get(id: string): Promise<Conversation | null> {
    await this.ensure();
    const row = await this.db
      .prepare('SELECT * FROM chatcops_conversations WHERE id = ?')
      .bind(id)
      .first<ConversationRow>();
    if (!row) return null;

    const { results } = await this.db
      .prepare('SELECT message FROM chatcops_messages WHERE conversation_id = ? ORDER BY seq')
      .bind(id)
      .all<MessageRow>();

    const messages = results.map((m) => JSON.parse(m.message) as ChatMessage);
    return {
      id: row.id,
      messages,
      ...(row.metadata ? { metadata: JSON.parse(row.metadata) } : {}),
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async save(conversation: Conversation): Promise<void> {
    await this.ensure();
    const time = this.now();

    const stmts: D1PreparedStatement[] = [
      this.db
        .prepare(`
          INSERT INTO chatcops_conversations (id, metadata, version, created_at, updated_at)
          VALUES (?, ?, 1, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            metadata = excluded.metadata,
            version = chatcops_conversations.version + 1,
            updated_at = excluded.updated_at
        `)
        .bind(
          conversation.id,
          json(conversation.metadata),
          conversation.createdAt,
          time
        ),
      this.db.prepare('DELETE FROM chatcops_messages WHERE conversation_id = ?').bind(conversation.id),
    ];

    for (const [index, message] of conversation.messages.entries()) {
      stmts.push(
        this.db
          .prepare('INSERT INTO chatcops_messages (conversation_id, seq, id, message) VALUES (?, ?, ?, ?)')
          .bind(conversation.id, index + 1, message.id, JSON.stringify(message))
      );
    }

    await this.db.batch(stmts);
  }

  async delete(id: string): Promise<void> {
    await this.ensure();
    await this.db.batch([
      this.db.prepare('DELETE FROM chatcops_messages WHERE conversation_id = ?').bind(id),
      this.db.prepare('DELETE FROM chatcops_conversations WHERE id = ?').bind(id),
    ]);
  }

  async append(
    id: string,
    messages: ChatMessage[],
    options: AppendOptions = {}
  ): Promise<{ version: number }> {
    await this.ensure();
    const maxAttempts = 50;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, 5 + Math.random() * 15));
      }
      const current = await this.db
        .prepare(`
          SELECT version, metadata,
            (SELECT COALESCE(MAX(seq), 0) FROM chatcops_messages WHERE conversation_id = ?) AS max_seq
          FROM chatcops_conversations WHERE id = ?
        `)
        .bind(id, id)
        .first<{ version: number; metadata: string | null; max_seq: number }>();

      const actual = current?.version ?? 0;
      if (options.expectedVersion !== undefined && options.expectedVersion !== actual) {
        throw new ConflictError(id, options.expectedVersion, actual);
      }

      const time = this.now();
      const metadata =
        options.metadata || current?.metadata
          ? { ...(current?.metadata ? JSON.parse(current.metadata) : {}), ...(options.metadata ?? {}) }
          : undefined;

      const nextVersion = actual + 1;
      const lastSeq = Number(current?.max_seq ?? 0);

      const batch: D1PreparedStatement[] = [];

      if (!current) {
        batch.push(
          this.db
            .prepare(`
              INSERT INTO chatcops_conversations (id, metadata, version, created_at, updated_at)
              SELECT ?, ?, 1, ?, ?
              WHERE NOT EXISTS (SELECT 1 FROM chatcops_conversations WHERE id = ?)
            `)
            .bind(id, json(metadata), time, time, id)
        );
      } else {
        batch.push(
          this.db
            .prepare(`
              UPDATE chatcops_conversations
              SET metadata = ?, version = version + 1, updated_at = ?
              WHERE id = ? AND version = ?
            `)
            .bind(json(metadata), time, id, actual)
        );
      }

      for (const [index, msg] of messages.entries()) {
        batch.push(
          this.db
            .prepare(`
              INSERT INTO chatcops_messages (conversation_id, seq, id, message)
              SELECT ?, ?, ?, ?
              WHERE EXISTS (
                SELECT 1 FROM chatcops_conversations
                WHERE id = ? AND version = ? AND updated_at = ?
              )
            `)
            .bind(
              id,
              lastSeq + index + 1,
              msg.id,
              JSON.stringify(msg),
              id,
              nextVersion,
              time
            )
        );
      }

      try {
        const results = await this.db.batch(batch);
        const changes = results[0]?.meta?.changes ?? 0;

        if (changes === 0) {
          if (options.expectedVersion !== undefined) {
            const fresh = await this.db
              .prepare('SELECT version FROM chatcops_conversations WHERE id = ?')
              .bind(id)
              .first<{ version: number }>();
            const freshVersion = fresh?.version ?? 0;
            throw new ConflictError(id, options.expectedVersion, freshVersion);
          }
          continue;
        }

        return { version: nextVersion };
      } catch (err) {
        if (err instanceof ConflictError) throw err;
        const isUniqueConstraint =
          err instanceof Error && /UNIQUE constraint failed/i.test(err.message);
        if (!isUniqueConstraint) {
          throw err;
        }
        if (options.expectedVersion !== undefined) {
          const fresh = await this.db
            .prepare('SELECT version FROM chatcops_conversations WHERE id = ?')
            .bind(id)
            .first<{ version: number }>();
          const freshVersion = fresh?.version ?? 0;
          throw new ConflictError(id, options.expectedVersion, freshVersion);
        }
      }
    }

    throw new Error(`Failed to append to conversation ${id} after ${maxAttempts} attempts due to concurrency conflicts.`);
  }

  async updateMessage(id: string, message: ChatMessage): Promise<boolean> {
    await this.ensure();
    const time = this.now();
    const results = await this.db.batch([
      this.db
        .prepare('UPDATE chatcops_messages SET message = ? WHERE conversation_id = ? AND id = ?')
        .bind(JSON.stringify(message), id, message.id),
      this.db
        .prepare(`
          UPDATE chatcops_conversations
          SET version = version + 1, updated_at = ?
          WHERE id = ? AND EXISTS (SELECT 1 FROM chatcops_messages WHERE conversation_id = ? AND id = ?)
        `)
        .bind(time, id, id, message.id),
    ]);
    const changes = results[0]?.meta?.changes ?? 0;
    return changes > 0;
  }

  async removeMessage(id: string, messageId: string): Promise<boolean> {
    await this.ensure();
    const time = this.now();
    const results = await this.db.batch([
      this.db
        .prepare(`
          UPDATE chatcops_conversations
          SET version = version + 1, updated_at = ?
          WHERE id = ? AND EXISTS (SELECT 1 FROM chatcops_messages WHERE conversation_id = ? AND id = ?)
        `)
        .bind(time, id, id, messageId),
      this.db
        .prepare('DELETE FROM chatcops_messages WHERE conversation_id = ? AND id = ?')
        .bind(id, messageId),
    ]);
    const changes = results[1]?.meta?.changes ?? 0;
    return changes > 0;
  }

  async list(query: ListQuery): Promise<{ items: ConversationSummary[]; cursor?: string }> {
    await this.ensure();
    let cursorTime: number | null = null;
    let cursorId: string | null = null;

    if (query.cursor) {
      const separator = query.cursor.indexOf(':');
      cursorTime = separator === -1 ? null : Number(query.cursor.slice(0, separator));
      cursorId = separator === -1 ? null : query.cursor.slice(separator + 1);
      if (separator === -1 || !Number.isFinite(cursorTime)) {
        throw new Error(`Not a list cursor: "${query.cursor}".`);
      }
    }

    const { results } = await this.db
      .prepare(`
        SELECT c.*, COUNT(m.seq) AS message_count
        FROM chatcops_conversations c
        LEFT JOIN chatcops_messages m ON m.conversation_id = c.id
        WHERE (? IS NULL OR c.updated_at > ?)
          AND (? IS NULL OR c.updated_at < ? OR (c.updated_at = ? AND c.id > ?))
        GROUP BY c.id
        ORDER BY c.updated_at DESC, c.id ASC
        LIMIT ?
      `)
      .bind(
        query.updatedAfter ?? null,
        query.updatedAfter ?? null,
        cursorTime,
        cursorTime,
        cursorTime,
        cursorId,
        query.limit + 1
      )
      .all<ConversationRow & { message_count: number }>();

    const page = results.slice(0, query.limit);
    const items: ConversationSummary[] = page.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      messageCount: Number(row.message_count),
      ...(row.metadata ? { metadata: JSON.parse(row.metadata) } : {}),
    }));

    const last = page.at(-1);
    return results.length > query.limit && last
      ? { items, cursor: `${last.updated_at}:${last.id}` }
      : { items };
  }

  async purge(before: number): Promise<number> {
    await this.ensure();
    const result = await this.db
      .prepare('DELETE FROM chatcops_conversations WHERE updated_at < ?')
      .bind(before)
      .run();

    return result.meta?.changes ?? 0;
  }
}
