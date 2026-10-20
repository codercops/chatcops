import { describe, expect, it } from 'vitest';
import { memoryStorage } from '../../src/storage/memory.js';
import type { ChatMessage } from '../../src/types.js';

const msg = (id: string): ChatMessage => ({ id, role: 'user', content: id, timestamp: 0 });

function clock(start = 1_000_000) {
  let time = start;
  return { now: () => time, advance: (ms: number) => { time += ms; } };
}

describe('memoryStorage limits', () => {
  it('drops the least recently used conversation past maxConversations', async () => {
    const { conversations } = memoryStorage({ maxConversations: 2 });
    await conversations.append?.('a', [msg('1')]);
    await conversations.append?.('b', [msg('1')]);
    await conversations.get('a'); // a is now more recent than b
    await conversations.append?.('c', [msg('1')]);

    expect(await conversations.get('a')).not.toBeNull();
    expect(await conversations.get('b')).toBeNull();
    expect(await conversations.get('c')).not.toBeNull();
  });

  it('drops conversations idle for longer than conversationTtlMs', async () => {
    const time = clock();
    const { conversations } = memoryStorage({ conversationTtlMs: 1000, now: time.now });
    await conversations.append?.('a', [msg('1')]);
    time.advance(999);
    expect(await conversations.get('a')).not.toBeNull();
    time.advance(2);
    expect(await conversations.get('a')).toBeNull();
    expect((await conversations.list?.({ limit: 10 }))?.items).toEqual([]);
  });

  it('starts an expired conversation again at version 1', async () => {
    const time = clock();
    const { conversations } = memoryStorage({ conversationTtlMs: 1000, now: time.now });
    await conversations.append?.('a', [msg('1')]);
    time.advance(5000);
    expect(await conversations.append?.('a', [msg('2')])).toEqual({ version: 1 });
  });

  it('expires counters and keys on the clock', async () => {
    const time = clock();
    const { counters, kv } = memoryStorage({ now: time.now });
    await counters?.increment('k', 2, 100);
    await kv?.set('v', 'x', { ttlMs: 100 });
    await kv?.set('forever', 'y');
    time.advance(100);
    expect(await counters?.get('k')).toBeNull();
    expect(await kv?.get('v')).toBeNull();
    expect(await kv?.get('forever')).toBe('y');
  });

  it('sweeps expired keys first, then drops the oldest, past maxKeys', async () => {
    const time = clock();
    const { counters } = memoryStorage({ maxKeys: 3, now: time.now });
    await counters?.increment('expiring', 1, 10);
    await counters?.increment('old', 1, 60_000);
    await counters?.increment('mid', 1, 60_000);
    time.advance(20);
    await counters?.increment('new', 1, 60_000);
    // Over the cap: the expired one goes, the rest stay.
    expect(await counters?.get('old')).not.toBeNull();

    await counters?.increment('newest', 1, 60_000);
    // Still over with nothing expired: the oldest goes.
    expect(await counters?.get('old')).toBeNull();
    expect(await counters?.get('mid')).not.toBeNull();
    expect(await counters?.get('newest')).not.toBeNull();
  });

  it('keeps only the newest maxEvents events', async () => {
    const { events } = memoryStorage({ maxEvents: 2 });
    await events?.write([
      { type: 'a', timestamp: 1 },
      { type: 'b', timestamp: 2 },
      { type: 'c', timestamp: 3 },
    ]);
    const counts = await events?.query?.({ from: 0, to: 10, groupBy: 'hour' });
    expect(counts?.map((c) => c.type)).toEqual(['b', 'c']);
  });

  it('copies values in, so later changes by the caller are not stored', async () => {
    const { kv, conversations } = memoryStorage();
    const value = { list: [1] };
    await kv?.set('k', value);
    value.list.push(2);
    expect(await kv?.get('k')).toEqual({ list: [1] });

    const message = msg('1');
    await conversations.append?.('c', [message]);
    message.content = 'changed';
    expect((await conversations.get('c'))?.messages[0]?.content).toBe('1');
  });

  it('counts events by hour', async () => {
    const { events } = memoryStorage();
    const hour = 60 * 60 * 1000;
    await events?.write([
      { type: 'x', timestamp: hour + 1 },
      { type: 'x', timestamp: hour + 2 },
      { type: 'y', timestamp: hour + 3 },
      { type: 'x', timestamp: 2 * hour + 1 },
    ]);
    expect(await events?.query?.({ from: 0, to: 3 * hour, groupBy: 'hour' })).toEqual([
      { bucket: hour, type: 'x', count: 2 },
      { bucket: hour, type: 'y', count: 1 },
      { bucket: 2 * hour, type: 'x', count: 1 },
    ]);
  });
});
