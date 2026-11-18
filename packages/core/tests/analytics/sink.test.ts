import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnalyticsCollector } from '../../src/analytics/collector.js';
import { BufferedEventSink, statsFromSink } from '../../src/analytics/sink.js';
import { memoryStorage } from '../../src/storage/memory.js';
import type { AnalyticsEvent } from '../../src/types.js';

describe('BufferedEventSink', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('uses a batch size of 50 and a flush interval of 2000ms by default', async () => {
    vi.useFakeTimers();
    const write = vi.fn(async (_events: AnalyticsEvent[]) => {});
    const buffered = new BufferedEventSink({ write });

    buffered.track('timer:event');
    await vi.advanceTimersByTimeAsync(1999);
    expect(write).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0][0].map((event) => event.type)).toEqual(['timer:event']);
    expect(vi.getTimerCount()).toBe(0);

    for (let index = 0; index < 49; index++) buffered.track('test:event');
    expect(write).toHaveBeenCalledTimes(1);
    buffered.track('test:event');
    await vi.advanceTimersByTimeAsync(0);
    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls[1][0]).toHaveLength(50);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not create a timer in the constructor', () => {
    vi.useFakeTimers();

    new BufferedEventSink({ write: async () => {} });

    expect(vi.getTimerCount()).toBe(0);
  });

  it('creates a timer on the first event in an empty buffer', () => {
    vi.useFakeTimers();
    const buffered = new BufferedEventSink({ write: async () => {} });

    buffered.track('test:event');

    expect(vi.getTimerCount()).toBe(1);
  });

  it('flushes queued events when the configured timer expires', async () => {
    vi.useFakeTimers();
    const write = vi.fn(async (_events: AnalyticsEvent[]) => {});
    const buffered = new BufferedEventSink({ write }, { flushMs: 100 });

    buffered.track('test:event');
    await vi.advanceTimersByTimeAsync(99);
    expect(write).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);

    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0][0].map((event) => event.type)).toEqual(['test:event']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('starts a flush immediately when maxBatch is reached', async () => {
    vi.useFakeTimers();
    const write = vi.fn(async (_events: AnalyticsEvent[]) => {});
    const buffered = new BufferedEventSink({ write }, { maxBatch: 2, flushMs: 10_000 });

    buffered.track('first');
    buffered.track('second');
    await vi.advanceTimersByTimeAsync(0);

    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0][0].map((event) => event.type)).toEqual(['first', 'second']);
  });

  it('allows repeated flushes when the buffer is empty', async () => {
    const write = vi.fn(async (_events: AnalyticsEvent[]) => {});
    const buffered = new BufferedEventSink({ write });

    await buffered.flush();
    await buffered.flush();

    expect(write).not.toHaveBeenCalled();
  });

  it('shares concurrent flushes without writing an event twice', async () => {
    let releaseWrite!: () => void;
    const writeGate = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const write = vi.fn(async (_events: AnalyticsEvent[]) => writeGate);
    const buffered = new BufferedEventSink({ write });

    buffered.track('one');
    const firstFlush = buffered.flush();
    const secondFlush = buffered.flush();

    expect(secondFlush).toBe(firstFlush);
    await Promise.resolve();
    expect(write).toHaveBeenCalledTimes(1);
    releaseWrite();
    await Promise.all([firstFlush, secondFlush]);

    expect(write.mock.calls.flatMap(([events]) => events.map((event) => event.type))).toEqual(['one']);
  });

  it('retains and flushes events tracked while a write is in flight', async () => {
    let releaseFirstWrite!: () => void;
    const firstWriteGate = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve;
    });
    const write = vi
      .fn()
      .mockImplementationOnce(async (_events: AnalyticsEvent[]) => firstWriteGate)
      .mockImplementation(async (_events: AnalyticsEvent[]) => {});
    const buffered = new BufferedEventSink({ write }, { maxBatch: 10, flushMs: 10_000 });

    buffered.track('first');
    const flush = buffered.flush();
    await Promise.resolve();
    expect(write).toHaveBeenCalledTimes(1);

    buffered.track('second');
    releaseFirstWrite();
    await flush;

    expect(write.mock.calls.map(([events]) => events.map((event) => event.type))).toEqual([['first'], ['second']]);
  });

  it('logs one formatted line and drops a failed batch', async () => {
    const write = vi.fn(async (_events: AnalyticsEvent[]) => {
      throw new Error('storage unavailable');
    });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const buffered = new BufferedEventSink({ write }, { maxBatch: 1 });

    buffered.track('failed:event');
    await buffered.flush();

    expect(write).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('[chatcops] analytics write failed: storage unavailable');
    await buffered.flush();
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('does not throw from track when the automatic write fails', async () => {
    const write = vi.fn(async (_events: AnalyticsEvent[]) => {
      throw new Error('write failed');
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const buffered = new BufferedEventSink({ write }, { maxBatch: 1 });

    expect(() => buffered.track('test:event')).not.toThrow();
    await buffered.flush();

    expect(write).toHaveBeenCalledTimes(1);
  });

  it('handles synchronous write failures like rejected writes', async () => {
    const write = vi.fn((_events: AnalyticsEvent[]) => {
      throw new Error('synchronous write failure');
    });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const buffered = new BufferedEventSink({ write });

    buffered.track('test:event');
    await buffered.flush();

    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('[chatcops] analytics write failed: synchronous write failure');
  });

  it('clears the timer when a manual flush starts', async () => {
    vi.useFakeTimers();
    const buffered = new BufferedEventSink({ write: async () => {} }, { flushMs: 10_000 });

    buffered.track('test:event');
    expect(vi.getTimerCount()).toBe(1);

    await buffered.flush();

    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the timer after an automatic flush', async () => {
    vi.useFakeTimers();
    const buffered = new BufferedEventSink({ write: async () => {} }, { flushMs: 100 });

    buffered.track('test:event');
    await vi.advanceTimersByTimeAsync(100);

    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('statsFromSink', () => {
  it('throws an actionable error when querying is unsupported', async () => {
    await expect(statsFromSink({ write: async () => {} }, { from: 0, to: 1 })).rejects.toThrow(
      'Event sink does not support querying'
    );
  });

  it('counts all supported event types and preserves the AnalyticsStats shape', async () => {
    const storage = memoryStorage();
    const eventsSink = storage.events;
    if (!eventsSink) throw new Error('memoryStorage did not provide an event sink');
    await eventsSink.write([
      { type: 'conversation.started', data: { conversationId: 'one' }, timestamp: 1 },
      { type: 'message.sent', timestamp: 2 },
      { type: 'message.received', timestamp: 3 },
      { type: 'lead.captured', timestamp: 4 },
      { type: 'other:event', timestamp: 5 },
    ]);

    await expect(statsFromSink(eventsSink, { from: 0, to: 10 })).resolves.toEqual({
      totalConversations: 1,
      totalMessages: 2,
      leadsCaptured: 1,
      averageMessagesPerConversation: 2,
      eventCounts: {
        'conversation.started': 1,
        'message.sent': 1,
        'message.received': 1,
        'lead.captured': 1,
        'other:event': 1,
      },
    });
  });

  it('counts events a store saved under the names from before 0.8 with the new ones', async () => {
    const storage = memoryStorage();
    const eventsSink = storage.events;
    if (!eventsSink) throw new Error('memoryStorage did not provide an event sink');
    // Written by a server before 0.8, then by one after it.
    await eventsSink.write([
      { type: 'conversation:started', timestamp: 1 },
      { type: 'message:sent', timestamp: 2 },
      { type: 'lead:captured', timestamp: 3 },
      { type: 'conversation.started', timestamp: 4 },
      { type: 'message.sent', timestamp: 5 },
      { type: 'lead.captured', timestamp: 6 },
    ]);

    const stats = await statsFromSink(eventsSink, { from: 0, to: 10 });
    expect(stats).toMatchObject({ totalConversations: 2, totalMessages: 2, leadsCaptured: 2 });
    expect(stats.eventCounts['message.sent']).toBe(2);
    expect(stats.eventCounts['message:sent']).toBeUndefined();
  });

  it('counts every conversation:started event as one conversation', async () => {
    const storage = memoryStorage();
    const eventsSink = storage.events;
    if (!eventsSink) throw new Error('memoryStorage did not provide an event sink');
    await eventsSink.write([
      { type: 'conversation.started', data: { conversationId: 'same-id' }, timestamp: 1 },
      { type: 'conversation.started', data: { conversationId: 'same-id' }, timestamp: 2 },
    ]);

    await expect(statsFromSink(eventsSink, { from: 0, to: 10 })).resolves.toMatchObject({
      totalConversations: 2,
      eventCounts: { 'conversation.started': 2 },
    });
  });

  it('uses inclusive from and exclusive to range boundaries', async () => {
    const storage = memoryStorage();
    const eventsSink = storage.events;
    if (!eventsSink) throw new Error('memoryStorage did not provide an event sink');
    await eventsSink.write([
      { type: 'message.sent', timestamp: 9 },
      { type: 'message.sent', timestamp: 10 },
      { type: 'message.sent', timestamp: 19 },
      { type: 'message.sent', timestamp: 20 },
    ]);

    await expect(statsFromSink(eventsSink, { from: 10, to: 20 })).resolves.toMatchObject({
      totalMessages: 2,
      eventCounts: { 'message.sent': 2 },
    });
  });

  it('matches AnalyticsCollector stats for equivalent in-range events', async () => {
    const storage = memoryStorage();
    const eventsSink = storage.events;
    if (!eventsSink) throw new Error('memoryStorage did not provide an event sink');
    const events: AnalyticsEvent[] = [
      { type: 'conversation.started', data: { conversationId: 'one' }, timestamp: 10 },
      { type: 'conversation.started', data: { conversationId: 'two' }, timestamp: 11 },
      { type: 'message.sent', data: { messageId: 'sent' }, timestamp: 12 },
      { type: 'message.received', data: { messageId: 'received' }, timestamp: 13 },
      { type: 'lead.captured', data: { leadId: 'lead' }, timestamp: 14 },
      { type: 'other:event', timestamp: 15 },
    ];
    await eventsSink.write(events);
    const collector = new AnalyticsCollector();
    for (const { type, data } of events) collector.track(type, data);

    await expect(statsFromSink(eventsSink, { from: 10, to: 16 })).resolves.toEqual(collector.getStats());
  });
});
