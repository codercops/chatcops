import type { AnalyticsEvent, EventCount, EventQuery, EventSink } from '@chatcops/core';
import type { D1Database } from './types.js';

const json = (value: unknown): string | null => (value === undefined ? null : JSON.stringify(value));

export class CloudflareEvents implements EventSink {
  constructor(
    private readonly db: D1Database,
    private readonly ensure: () => Promise<void>
  ) {}

  async write(events: AnalyticsEvent[]): Promise<void> {
    if (events.length === 0) return;
    await this.ensure();
    const stmts = events.map((event) =>
      this.db
        .prepare('INSERT INTO chatcops_events (type, data, created_at) VALUES (?, ?, ?)')
        .bind(event.type, json(event.data), event.timestamp)
    );
    await this.db.batch(stmts);
  }

  async query(query: EventQuery): Promise<EventCount[]> {
    await this.ensure();
    const size = query.groupBy === 'hour' ? 3_600_000 : 86_400_000;
    const { results } = await this.db
      .prepare(`
        SELECT CAST((created_at / ?) AS INTEGER) * ? AS bucket, type, COUNT(*) AS count
        FROM chatcops_events
        WHERE created_at >= ? AND created_at < ? AND (? IS NULL OR type = ?)
        GROUP BY bucket, type
        ORDER BY bucket, type
      `)
      .bind(
        size,
        size,
        query.from,
        query.to,
        query.type ?? null,
        query.type ?? null
      )
      .all<{ bucket: number; type: string; count: number }>();

    return results.map((row) => ({
      bucket: Number(row.bucket),
      type: row.type,
      count: Number(row.count),
    }));
  }
}
