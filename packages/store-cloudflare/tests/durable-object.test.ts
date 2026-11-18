import { afterAll, describe, expect, it } from 'vitest';
import { cloudflareStorage } from '../src/index.js';
import { disposeMiniflare, getMiniflareBindings } from './miniflare.js';

describe('durable objects counters', () => {
  it('counts 50 concurrent increments exactly once', async () => {
    const { d1, counters } = await getMiniflareBindings();
    const storage = cloudflareStorage({ d1, counters });
    const countersStore = storage.counters;
    expect(countersStore).toBeDefined();
    if (!countersStore) throw new Error('counters not defined');

    const key = `do-race-${Date.now()}`;

    const results = await Promise.all(
      Array.from({ length: 50 }, () => countersStore.increment(key, 1, 60_000))
    );

    expect(results.map((r) => r.value).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 50 }, (_, i) => i + 1)
    );
    expect((await countersStore.get(key))?.value).toBe(50);
  });

  it('resets counter and cleans storage after ttl alarm fires', async () => {
    const { mf, d1, counters } = await getMiniflareBindings();
    const storage = cloudflareStorage({ d1, counters });
    const countersStore = storage.counters;
    expect(countersStore).toBeDefined();
    if (!countersStore) throw new Error('counters not defined');

    const key = `do-ttl-${Date.now()}`;

    await countersStore.increment(key, 5, 50);
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(await countersStore.get(key)).toBeNull();

    const doId = counters.idFromName(key);
    const doStorage = await mf.unsafeGetDurableObjectStorage('test-worker', 'ChatCopsCounter', {
      id: doId.toString(),
    });
    const kvTable = await doStorage.exec(
      "SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name='_cf_KV'"
    );
    expect(Number(kvTable[0]?.count ?? 0)).toBe(0);

    const next = await countersStore.increment(key, 2, 60_000);
    expect(next.value).toBe(2);
  });
});

afterAll(async () => {
  await disposeMiniflare();
});
