import type { CounterStore, CounterValue } from '@chatcops/core';
import { decodeEvalResult, formatSlotPrefix } from './adapter.js';
import type { RedisLike } from './types.js';

const INCREMENT_SCRIPT = `
local by = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])

local serverTime = redis.call('TIME')
local now = tonumber(serverTime[1]) * 1000 + math.floor(tonumber(serverTime[2]) / 1000)

local pttl = redis.call('PTTL', KEYS[1])

if pttl >= 0 then
  local current = redis.call('HGET', KEYS[1], 'value')
  local newVal = (current and tonumber(current) or 0) + by
  local expiresAt = now + pttl
  local newValStr = string.format('%.17g', newVal)
  local expiresAtStr = string.format('%.17g', expiresAt)
  redis.call('HSET', KEYS[1], 'value', newValStr, 'expiresAt', expiresAtStr)
  return cjson.encode({ newValStr, expiresAtStr })
else
  local newVal = by
  local newValStr = string.format('%.17g', newVal)
  if ttl <= 0 then
    local expiresAtStr = string.format('%.17g', now)
    return cjson.encode({ newValStr, expiresAtStr })
  else
    local expiresAt = now + ttl
    local expiresAtStr = string.format('%.17g', expiresAt)
    redis.call('HSET', KEYS[1], 'value', newValStr, 'expiresAt', expiresAtStr)
    redis.call('PEXPIRE', KEYS[1], ttl)
    return cjson.encode({ newValStr, expiresAtStr })
  end
end
`;

const GET_SCRIPT = `
local pttl = redis.call('PTTL', KEYS[1])
if pttl < 0 then
  return nil
end

local serverTime = redis.call('TIME')
local now = tonumber(serverTime[1]) * 1000 + math.floor(tonumber(serverTime[2]) / 1000)

local val = redis.call('HGET', KEYS[1], 'value')
if not val then
  return nil
end

local numVal = tonumber(val)
local valStr = numVal and string.format('%.17g', numVal) or tostring(val)
local expiresAt = now + pttl
local expiresAtStr = string.format('%.17g', expiresAt)
return cjson.encode({ valStr, expiresAtStr })
`;

export class RedisCounterStore implements CounterStore {
  private readonly slotPrefix: string;

  constructor(
    private readonly redis: RedisLike,
    prefix: string
  ) {
    this.slotPrefix = formatSlotPrefix(prefix);
  }

  private key(key: string): string {
    return `${this.slotPrefix}:counter:${key}`;
  }

  async increment(key: string, by: number, ttlMs: number): Promise<CounterValue> {
    const roundedTtl = Math.ceil(ttlMs);
    const raw = await this.redis.eval<[number, number], unknown>(
      INCREMENT_SCRIPT,
      [this.key(key)],
      [by, roundedTtl]
    );

    const res = decodeEvalResult<[string, string]>(raw);
    return {
      value: Number(res[0]),
      expiresAt: Number(res[1]),
    };
  }

  async get(key: string): Promise<CounterValue | null> {
    const raw = await this.redis.eval<[], unknown>(
      GET_SCRIPT,
      [this.key(key)],
      []
    );

    if (!raw) return null;
    const res = decodeEvalResult<[string, string] | null>(raw);
    if (!res) return null;

    return {
      value: Number(res[0]),
      expiresAt: Number(res[1]),
    };
  }
}
