import type { AnalyticsEvent, EventCount, EventQuery, EventSink } from '@chatcops/core';
import { decodeEvalResult, formatSlotPrefix, normalizeList } from './adapter.js';
import type { RedisLike } from './types.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
// Retain event hashes for 90 days
const DEFAULT_EVENT_TTL_MS = 90 * DAY_MS;

const WRITE_SCRIPT = `
local ttl = tonumber(ARGV[1])
local numPairs = tonumber(ARGV[2])

for i = 1, numPairs do
  local hour = ARGV[2 + (i - 1) * 3 + 1]
  local eventType = ARGV[2 + (i - 1) * 3 + 2]
  local keyIdx = tonumber(ARGV[2 + (i - 1) * 3 + 3])
  local hashKey = KEYS[keyIdx]

  redis.call('ZADD', KEYS[1], tonumber(hour), hour)
  redis.call('HINCRBY', hashKey, eventType, 1)
  if ttl > 0 then
    redis.call('PEXPIRE', hashKey, ttl)
  end
end
return 1
`;

const GET_HOURS_SCRIPT = `
local from = tonumber(ARGV[1])
local to = tonumber(ARGV[2])
local hours = redis.call('ZRANGEBYSCORE', KEYS[1], from, '(' .. to)
if #hours == 0 then
  return '[]'
end
return cjson.encode(hours)
`;

const GET_COUNTS_SCRIPT = `
local filterType = ARGV[1]
local results = {}

for i = 2, #KEYS do
  local hashKey = KEYS[i]
  local hourStr = ARGV[i]
  local hour = tonumber(hourStr)
  if filterType ~= '' then
    local count = redis.call('HGET', hashKey, filterType)
    if count then
      table.insert(results, { hour, filterType, tonumber(count) })
    end
  else
    local all = redis.call('HGETALL', hashKey)
    for j = 1, #all, 2 do
      local t = all[j]
      local c = tonumber(all[j + 1])
      table.insert(results, { hour, t, c })
    end
  end
end

if #results == 0 then
  return '[]'
end
return cjson.encode(results)
`;

/**
 * RedisEventSink collects analytics events and aggregates counts using hourly count hashes.
 *
 * Events are stored in hourly buckets ({<prefix>}:events:<hour>) and indexed in a sorted set
 * ({<prefix>}:events:hours). This design provides several critical guarantees:
 * 1. Historical & Out-of-Order Timestamps: Unlike Redis Streams (XADD) which require monotonically
 *    increasing entry IDs and reject or misorder past timestamps, hourly hashes increment counters
 *    into the appropriate historical hour bucket seamlessly.
 * 2. Efficient Aggregation: Event counts are pre-aggregated inside Redis hashes (HINCRBY), avoiding
 *    the need to download and scan raw event payloads over the network.
 * 3. Cluster Compatibility: All keys are hash-tagged with {<prefix>} and all keys accessed in scripts
 *    are explicitly passed through the KEYS array.
 *
 * Query Semantics:
 * Because events are pre-aggregated into 1-hour UTC buckets, queries round `from` down to the start
 * of its UTC hour (Math.floor(from / HOUR_MS) * HOUR_MS) and `to` up to the end of its UTC hour
 * (Math.ceil(to / HOUR_MS) * HOUR_MS) to select all hourly buckets overlapping the requested window.
 */
export class RedisEventSink implements EventSink {
  private readonly hoursKey: string;
  private readonly slotPrefix: string;

  constructor(
    private readonly redis: RedisLike,
    prefix: string,
    private readonly ttlMs: number = DEFAULT_EVENT_TTL_MS
  ) {
    this.slotPrefix = formatSlotPrefix(prefix);
    this.hoursKey = `${this.slotPrefix}:events:hours`;
  }

  private hourKey(hour: number | string): string {
    return `${this.slotPrefix}:events:${hour}`;
  }

  async write(events: AnalyticsEvent[]): Promise<void> {
    if (events.length === 0) return;

    // Map each unique hour to a key in KEYS to ensure all accessed keys are passed in KEYS
    const hourKeyMap = new Map<number, string>();
    for (const event of events) {
      const hour = Math.floor(event.timestamp / HOUR_MS) * HOUR_MS;
      if (!hourKeyMap.has(hour)) {
        hourKeyMap.set(hour, this.hourKey(hour));
      }
    }

    const uniqueHours = Array.from(hourKeyMap.keys());
    const keys: string[] = [this.hoursKey];
    const hourToKeyIdx = new Map<number, number>();

    for (let i = 0; i < uniqueHours.length; i++) {
      const hour = uniqueHours[i];
      const hKey = hourKeyMap.get(hour);
      if (hKey) {
        keys.push(hKey);
        // 1-based index in KEYS: KEYS[1] is hoursKey, so KEYS[2 + i] is the hourKey
        hourToKeyIdx.set(hour, 2 + i);
      }
    }

    const scriptArgs: (string | number)[] = [this.ttlMs, events.length];
    for (const event of events) {
      const hour = Math.floor(event.timestamp / HOUR_MS) * HOUR_MS;
      const keyIdx = hourToKeyIdx.get(hour) ?? 2;
      scriptArgs.push(hour, event.type, keyIdx);
    }

    await this.redis.eval(
      WRITE_SCRIPT,
      keys,
      scriptArgs
    );
  }

  async query(query: EventQuery): Promise<EventCount[]> {
    const filterType = query.type ?? '';

    // Hour-rounding semantics: round `from` down to start of hour, `to` up to end of hour
    const fromHour = Math.floor(query.from / HOUR_MS) * HOUR_MS;
    const toHour = Math.ceil(query.to / HOUR_MS) * HOUR_MS;

    // Step 1: Query which hour buckets exist in the [fromHour, toHour) window
    const rawHours = await this.redis.eval<(string | number)[], unknown>(
      GET_HOURS_SCRIPT,
      [this.hoursKey],
      [fromHour, toHour]
    );

    const hours = normalizeList<string>(decodeEvalResult<string[]>(rawHours));
    if (hours.length === 0) {
      return [];
    }

    // Step 2: Pass all required hour keys in KEYS for cluster-safe reading
    const keys: string[] = [this.hoursKey];
    const scriptArgs: (string | number)[] = [filterType];

    for (const h of hours) {
      keys.push(this.hourKey(h));
      scriptArgs.push(h);
    }

    const rawCounts = await this.redis.eval<(string | number)[], unknown>(
      GET_COUNTS_SCRIPT,
      keys,
      scriptArgs
    );

    const results = normalizeList<[number, string, number]>(
      decodeEvalResult<[number, string, number][]>(rawCounts)
    );
    if (results.length === 0) {
      return [];
    }

    const bucketSize = query.groupBy === 'hour' ? HOUR_MS : DAY_MS;
    const counts = new Map<string, EventCount>();

    if (results) {
      for (const [hour, type, count] of results) {
        const bucket = Math.floor(Number(hour) / bucketSize) * bucketSize;
        const key = `${bucket}:${type}`;
        const existing = counts.get(key);
        if (existing) {
          existing.count += count;
        } else {
          counts.set(key, { bucket, type, count });
        }
      }
    }

    return Array.from(counts.values()).sort(
      (a, b) => a.bucket - b.bucket || (a.type < b.type ? -1 : 1)
    );
  }
}
