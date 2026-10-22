import type { CounterStore, CounterValue } from '@chatcops/core';
import type { D1Database, DurableObjectNamespace, DurableObjectState } from './types.js';

const CloudflareWorkers =
  typeof navigator !== 'undefined' && (navigator as { userAgent?: string }).userAgent === 'Cloudflare-Workers'
    ? await import('cloudflare:workers')
    : null;

const BaseDurableObject =
  CloudflareWorkers?.DurableObject ??
  (class {
    ctx: DurableObjectState;
    env: unknown;
    constructor(ctx: DurableObjectState, env: unknown) {
      this.ctx = ctx;
      this.env = env;
    }
  } as unknown as typeof import('cloudflare:workers').DurableObject);

interface StoredCounter {
  value: number;
  expiresAt: number;
}

export class ChatCopsCounter extends BaseDurableObject {
  declare ctx: DurableObjectState;
  declare env: unknown;

  async increment(by: number, ttlMs: number): Promise<CounterValue> {
    const key = 'counter';
    const now = Date.now();
    const current = (await this.ctx.storage.get<StoredCounter>(key)) as StoredCounter | undefined;
    let next: StoredCounter;
    if (!current || current.expiresAt <= now) {
      next = { value: by, expiresAt: now + ttlMs };
      await this.ctx.storage.setAlarm(next.expiresAt);
    } else {
      next = { value: current.value + by, expiresAt: current.expiresAt };
    }
    await this.ctx.storage.put(key, next);
    return next;
  }

  async get(): Promise<CounterValue | null> {
    const key = 'counter';
    const current = (await this.ctx.storage.get<StoredCounter>(key)) as StoredCounter | undefined;
    if (!current || current.expiresAt <= Date.now()) {
      return null;
    }
    return current;
  }

  async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}

export class DoCounters implements CounterStore {
  constructor(private readonly namespace: DurableObjectNamespace<ChatCopsCounter>) {}

  async increment(key: string, by: number, ttlMs: number): Promise<CounterValue> {
    const id = this.namespace.idFromName(key);
    const stub = this.namespace.get(id);
    return await stub.increment(by, ttlMs);
  }

  async get(key: string): Promise<CounterValue | null> {
    const id = this.namespace.idFromName(key);
    const stub = this.namespace.get(id);
    return (await stub.get()) ?? null;
  }
}

export class D1Counters implements CounterStore {
  constructor(
    private readonly db: D1Database,
    private readonly now: () => number,
    private readonly ensure: () => Promise<void>
  ) {}

  async increment(key: string, by: number, ttlMs: number): Promise<CounterValue> {
    await this.ensure();
    const time = this.now();
    const row = await this.db
      .prepare(`
        INSERT INTO chatcops_counters (key, value, expires_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value = CASE WHEN chatcops_counters.expires_at <= ?
            THEN excluded.value ELSE chatcops_counters.value + excluded.value END,
          expires_at = CASE WHEN chatcops_counters.expires_at <= ?
            THEN excluded.expires_at ELSE chatcops_counters.expires_at END
        RETURNING value, expires_at
      `)
      .bind(key, by, time + ttlMs, time, time)
      .first<{ value: number; expires_at: number }>();

    if (!row) throw new Error('D1 counter upsert did not return a row');
    return { value: Number(row.value), expiresAt: Number(row.expires_at) };
  }

  async get(key: string): Promise<CounterValue | null> {
    await this.ensure();
    const row = await this.db
      .prepare('SELECT value, expires_at FROM chatcops_counters WHERE key = ? AND expires_at > ?')
      .bind(key, this.now())
      .first<{ value: number; expires_at: number }>();

    return row ? { value: Number(row.value), expiresAt: Number(row.expires_at) } : null;
  }
}
