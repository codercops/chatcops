import { getSecret } from 'astro:env/server';

// Read per call: on Workers the credentials are secrets that only exist
// inside a request.
function upstash(): { url: string; token: string } {
  const url = getSecret('UPSTASH_REDIS_REST_URL');
  const token = getSecret('UPSTASH_REDIS_REST_TOKEN');
  if (!url || !token) throw new Error('Upstash credentials are not set');
  return { url, token };
}

async function redis(command: string[]): Promise<unknown> {
  const { url, token } = upstash();
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
  });
  if (!res.ok) throw new Error(`Upstash error: ${res.status}`);
  const data = await res.json();
  return data.result;
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Increments visitor count and returns today + total in a single EVAL command.
 * Uses one Redis command per call to stay within Upstash free tier (10K/day).
 *
 * With an IP, each visitor is counted once per UTC day: the script only
 * increments when `SET <seen key> 1 NX EX 86400` succeeds. The key holds a
 * SHA-256 hash of the IP and date, never the IP itself. Without an IP
 * (local dev) every call counts.
 */
export async function incrementVisitors(
  site: string,
  ip?: string | null,
): Promise<{ today: number; total: number }> {
  const date = new Date().toISOString().slice(0, 10);
  const todayKey = `${site}:today:${date}`;
  const totalKey = `${site}:total`;
  const ttl = 90 * 24 * 60 * 60; // 90 days TTL on daily keys

  const keys = [todayKey, totalKey];
  if (ip) keys.push(`${site}:seen:${date}:${await sha256Hex(`${ip}:${date}`)}`);

  const script = `
    if KEYS[3] and not redis.call('SET', KEYS[3], '1', 'NX', 'EX', 86400) then
      return {tonumber(redis.call('GET', KEYS[1]) or '0'), tonumber(redis.call('GET', KEYS[2]) or '0')}
    end
    local today = redis.call('INCR', KEYS[1])
    if today == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
    local total = redis.call('INCR', KEYS[2])
    return {today, total}
  `;

  const result = (await redis(['EVAL', script, String(keys.length), ...keys, String(ttl)])) as [number, number];
  return { today: result[0], total: result[1] };
}

/**
 * Returns current counts without incrementing.
 */
export async function getVisitors(site: string): Promise<{ today: number; total: number }> {
  const todayKey = `${site}:today:${new Date().toISOString().slice(0, 10)}`;
  const totalKey = `${site}:total`;

  const { url, token } = upstash();
  const res = await fetch(`${url}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([['GET', todayKey], ['GET', totalKey]]),
  });

  if (!res.ok) return { today: 0, total: 0 };
  const data = await res.json();
  return {
    today: parseInt(data[0]?.result || '0', 10),
    total: parseInt(data[1]?.result || '0', 10),
  };
}
