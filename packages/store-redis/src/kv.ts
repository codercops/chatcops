import type { KeyValueStore } from '@chatcops/core';
import { formatSlotPrefix } from './adapter.js';
import type { RedisLike } from './types.js';

interface KvEnvelope<T = unknown> {
  __cc_kv: 1;
  v: T;
}

export class RedisKeyValueStore implements KeyValueStore {
  private readonly slotPrefix: string;

  constructor(
    private readonly redis: RedisLike,
    prefix: string
  ) {
    this.slotPrefix = formatSlotPrefix(prefix);
  }

  private key(key: string): string {
    return `${this.slotPrefix}:kv:${key}`;
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    const raw = await this.redis.get(this.key(key));
    if (raw === null || raw === undefined) return null;

    // Upstash with default automatic deserialization parses the envelope object directly
    if (typeof raw === 'object' && raw !== null && '__cc_kv' in raw) {
      return (raw as unknown as KvEnvelope<T>).v;
    }

    // ioredis returns raw string; clients with deserialization disabled also return string
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        if (parsed !== null && typeof parsed === 'object' && '__cc_kv' in parsed) {
          return (parsed as KvEnvelope<T>).v;
        }
        return parsed as T;
      } catch {
        return raw as unknown as T;
      }
    }

    return raw as T;
  }

  async set(key: string, value: unknown, options?: { ttlMs?: number }): Promise<void> {
    const fullKey = this.key(key);
    if (options?.ttlMs !== undefined) {
      const ttlMs = Math.ceil(options.ttlMs);
      if (ttlMs <= 0) {
        // Immediate expiry: key should not persist
        await this.redis.del(fullKey);
        return;
      }
      const payload: KvEnvelope = { __cc_kv: 1, v: value };
      await this.redis.set(fullKey, JSON.stringify(payload), { px: ttlMs });
      return;
    }
    const payload: KvEnvelope = { __cc_kv: 1, v: value };
    await this.redis.set(fullKey, JSON.stringify(payload));
  }

  async setIfAbsent(
    key: string,
    value: unknown,
    options?: { ttlMs?: number }
  ): Promise<boolean> {
    const fullKey = this.key(key);
    if (options?.ttlMs !== undefined) {
      const ttlMs = Math.ceil(options.ttlMs);
      if (ttlMs <= 0) {
        // Immediate expiry: returns true if key was absent, false if key was already present
        const script = `
          if redis.call('EXISTS', KEYS[1]) == 1 then
            return 0
          else
            return 1
          end
        `;
        const res = await this.redis.eval<[], number>(script, [fullKey], []);
        return Number(res) === 1;
      }
      const payload: KvEnvelope = { __cc_kv: 1, v: value };
      const res = await this.redis.set(fullKey, JSON.stringify(payload), {
        nx: true,
        px: ttlMs,
      });
      return res === 'OK' || res === true;
    }
    const payload: KvEnvelope = { __cc_kv: 1, v: value };
    const res = await this.redis.set(fullKey, JSON.stringify(payload), {
      nx: true,
    });
    return res === 'OK' || res === true;
  }

  async delete(key: string): Promise<void> {
    await this.redis.del(this.key(key));
  }
}
