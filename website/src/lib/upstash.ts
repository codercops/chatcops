import { getSecret } from 'astro:env/server';

// Read per call: on Workers the credentials are secrets that only exist
// inside a request.
function upstash(): { url: string; token: string } {
  const url = getSecret('UPSTASH_REDIS_REST_URL');
  const token = getSecret('UPSTASH_REDIS_REST_TOKEN');
  if (!url || !token) throw new Error('Upstash credentials are not set');
  return { url, token };
}

async function redis(command: string[]): Promise<any> {
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

/**
 * Increments visitor count and returns today + total in a single EVAL command.
 * Uses one Redis command per call to stay within Upstash free tier (10K/day).
 */
export async function incrementVisitors(site: string): Promise<{ today: number; total: number }> {
  const todayKey = `${site}:today:${new Date().toISOString().slice(0, 10)}`;
  const totalKey = `${site}:total`;
  const ttl = 90 * 24 * 60 * 60; // 90 days TTL on daily keys

  const script = `
    local today = redis.call('INCR', KEYS[1])
    if today == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
    local total = redis.call('INCR', KEYS[2])
    return {today, total}
  `;

  const result = await redis(['EVAL', script, '2', todayKey, totalKey, String(ttl)]);
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
