import type { KeyValueStore } from '@chatcops/core';
import type { D1Database, KVNamespace } from './types.js';

export class WorkersKvStore implements KeyValueStore {
  constructor(private readonly kv: KVNamespace) {}

  async get<T = unknown>(key: string): Promise<T | null> {
    const text = await this.kv.get(key, 'text');
    if (typeof text !== 'string') return null;
    return JSON.parse(text) as T;
  }

  async set(key: string, value: unknown, options: { ttlMs?: number } = {}): Promise<void> {
    const expirationTtl =
      options.ttlMs !== undefined
        ? Math.max(60, Math.ceil(options.ttlMs / 1000))
        : undefined;
    await this.kv.put(key, JSON.stringify(value), expirationTtl ? { expirationTtl } : undefined);
  }

  async delete(key: string): Promise<void> {
    await this.kv.delete(key);
  }
}

export class D1KvStore implements KeyValueStore {
  constructor(
    private readonly db: D1Database,
    private readonly now: () => number,
    private readonly ensure: () => Promise<void>
  ) {}

  async get<T = unknown>(key: string): Promise<T | null> {
    await this.ensure();
    const row = await this.db
      .prepare('SELECT value FROM chatcops_kv WHERE key = ? AND (expires_at IS NULL OR expires_at > ?)')
      .bind(key, this.now())
      .first<{ value: string }>();

    return row ? (JSON.parse(row.value) as T) : null;
  }

  async set(key: string, value: unknown, options: { ttlMs?: number } = {}): Promise<void> {
    await this.ensure();
    await this.db
      .prepare(`
        INSERT INTO chatcops_kv (key, value, expires_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          expires_at = excluded.expires_at
      `)
      .bind(
        key,
        JSON.stringify(value),
        options.ttlMs === undefined ? null : this.now() + options.ttlMs
      )
      .run();
  }

  async setIfAbsent(key: string, value: unknown, options: { ttlMs?: number } = {}): Promise<boolean> {
    await this.ensure();
    const time = this.now();
    const result = await this.db
      .prepare(`
        INSERT INTO chatcops_kv (key, value, expires_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          expires_at = excluded.expires_at
        WHERE chatcops_kv.expires_at IS NOT NULL AND chatcops_kv.expires_at <= ?
      `)
      .bind(
        key,
        JSON.stringify(value),
        options.ttlMs === undefined ? null : time + options.ttlMs,
        time
      )
      .run();

    return (result.meta?.changes ?? 0) > 0;
  }

  async delete(key: string): Promise<void> {
    await this.ensure();
    await this.db.prepare('DELETE FROM chatcops_kv WHERE key = ?').bind(key).run();
  }
}
