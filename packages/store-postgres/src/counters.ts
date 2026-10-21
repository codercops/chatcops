import type { AnalyticsEvent, CounterStore, CounterValue, EventCount, EventQuery, EventSink, KeyValueStore } from '@chatcops/core';
import type { Queryable } from './queryable.js';
import type { TableNames } from './schema.js';
import { json, ms, toTime } from './sql.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** One upsert per increment, so concurrent increments never lose a count. */
export class PostgresCounterStore implements CounterStore {
  constructor(
    private readonly db: Queryable,
    private readonly t: TableNames,
    private readonly now: () => number
  ) {}

  async increment(key: string, by: number, ttlMs: number): Promise<CounterValue> {
    const now = this.now();
    const { rows } = await this.db.query<{ value: number; expires_ms: number }>(
      `INSERT INTO ${this.t.counters} AS k (key, value, expires_at)
      VALUES ($1, $2::float8, ${toTime('$4')})
      ON CONFLICT (key) DO UPDATE SET
        value = CASE WHEN k.expires_at <= ${toTime('$3')} THEN EXCLUDED.value ELSE k.value + EXCLUDED.value END,
        expires_at = CASE WHEN k.expires_at <= ${toTime('$3')} THEN EXCLUDED.expires_at ELSE k.expires_at END
      RETURNING value, ${ms('expires_at')} AS expires_ms`,
      [key, by, now, now + ttlMs]
    );
    return { value: Number(rows[0].value), expiresAt: Number(rows[0].expires_ms) };
  }

  async get(key: string): Promise<CounterValue | null> {
    const { rows } = await this.db.query<{ value: number; expires_ms: number }>(
      `SELECT value, ${ms('expires_at')} AS expires_ms FROM ${this.t.counters}
      WHERE key = $1 AND expires_at > ${toTime('$2')}`,
      [key, this.now()]
    );
    return rows[0] ? { value: Number(rows[0].value), expiresAt: Number(rows[0].expires_ms) } : null;
  }
}

/** JSON values with an optional expiry. Expired rows are ignored, and cleared by `purge()`. */
export class PostgresKeyValueStore implements KeyValueStore {
  constructor(
    private readonly db: Queryable,
    private readonly t: TableNames,
    private readonly now: () => number
  ) {}

  private expiry(ttlMs: number | undefined): number | null {
    return ttlMs === undefined ? null : this.now() + ttlMs;
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    const { rows } = await this.db.query<{ value: T }>(
      `SELECT value FROM ${this.t.kv}
      WHERE key = $1 AND (expires_at IS NULL OR expires_at > ${toTime('$2')})`,
      [key, this.now()]
    );
    return rows[0] ? rows[0].value : null;
  }

  async set(key: string, value: unknown, options: { ttlMs?: number } = {}): Promise<void> {
    await this.db.query(
      `INSERT INTO ${this.t.kv} (key, value, expires_at)
      VALUES ($1, $2::text::jsonb, CASE WHEN $3::float8 IS NULL THEN NULL ELSE ${toTime('$3')} END)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, expires_at = EXCLUDED.expires_at`,
      [key, json(value) ?? 'null', this.expiry(options.ttlMs)]
    );
  }

  async setIfAbsent(key: string, value: unknown, options: { ttlMs?: number } = {}): Promise<boolean> {
    // Inserts, or takes over an expired row. A live row is left alone.
    const { rows } = await this.db.query(
      `INSERT INTO ${this.t.kv} AS k (key, value, expires_at)
      VALUES ($1, $2::text::jsonb, CASE WHEN $3::float8 IS NULL THEN NULL ELSE ${toTime('$3')} END)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, expires_at = EXCLUDED.expires_at
      WHERE k.expires_at IS NOT NULL AND k.expires_at <= ${toTime('$4')}
      RETURNING 1`,
      [key, json(value) ?? 'null', this.expiry(options.ttlMs), this.now()]
    );
    return rows.length > 0;
  }

  async delete(key: string): Promise<void> {
    await this.db.query(`DELETE FROM ${this.t.kv} WHERE key = $1`, [key]);
  }
}

/** Events as rows, counted with SQL. Writes go in batches of up to 500 rows. */
export class PostgresEventSink implements EventSink {
  constructor(
    private readonly db: Queryable,
    private readonly t: TableNames
  ) {}

  async write(events: AnalyticsEvent[]): Promise<void> {
    for (let start = 0; start < events.length; start += 500) {
      const batch = events.slice(start, start + 500);
      const params: unknown[] = [];
      const rows = batch.map((event) => {
        const conversationId = typeof event.data?.conversationId === 'string' ? event.data.conversationId : null;
        params.push(event.type, conversationId, json(event.data), event.timestamp);
        const n = params.length;
        return `($${n - 3}::text, $${n - 2}::text, $${n - 1}::text::jsonb, ${toTime(`$${n}`)})`;
      });
      await this.db.query(
        `INSERT INTO ${this.t.events} (type, conversation_id, data, created_at) VALUES ${rows.join(', ')}`,
        params
      );
    }
  }

  async query(query: EventQuery): Promise<EventCount[]> {
    const size = query.groupBy === 'hour' ? HOUR_MS : DAY_MS;
    const { rows } = await this.db.query<{ bucket: number; type: string; count: number }>(
      `SELECT (floor(${ms('created_at')} / $3::float8) * $3::float8)::float8 AS bucket, type, count(*)::int AS count
      FROM ${this.t.events}
      WHERE created_at >= ${toTime('$1')} AND created_at < ${toTime('$2')}
        AND ($4::text IS NULL OR type = $4::text)
      GROUP BY 1, 2
      ORDER BY bucket, type COLLATE "C"`,
      [query.from, query.to, size, query.type ?? null]
    );
    return rows.map((row) => ({ bucket: Number(row.bucket), type: row.type, count: Number(row.count) }));
  }
}
