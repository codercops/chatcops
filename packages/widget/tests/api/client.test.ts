import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChatClient } from '../../src/api/client.js';
import type { WidgetChatChunk } from '../../src/api/types.js';
import { mockChatStream } from '../helpers/stream.js';

describe('ChatClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('sends a message and yields chunks', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"content":"Hello"}\n\n'));
        controller.enqueue(encoder.encode('data: {"content":" world"}\n\n'));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(stream, { status: 200 })
    );

    const client = new ChatClient({ apiUrl: 'https://api.test/chat' });
    const chunks: unknown[] = [];

    for await (const chunk of client.sendMessage({
      conversationId: 'test',
      message: 'Hi',
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toEqual({ content: 'Hello' });
    expect(chunks[1]).toEqual({ content: ' world' });
    expect(chunks[2]).toEqual({ done: true });
  });

  it('handles rate limit response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('', { status: 429 })
    );

    const client = new ChatClient({ apiUrl: 'https://api.test/chat' });
    const chunks: unknown[] = [];

    for await (const chunk of client.sendMessage({
      conversationId: 'test',
      message: 'Hi',
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual({ error: 'rate_limit' });
  });

  it('handles network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network failed'));

    const client = new ChatClient({ apiUrl: 'https://api.test/chat' });
    const chunks: unknown[] = [];

    for await (const chunk of client.sendMessage({
      conversationId: 'test',
      message: 'Hi',
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual({ error: 'network' });
  });

  it('handles HTTP error response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('', { status: 500 })
    );

    const client = new ChatClient({ apiUrl: 'https://api.test/chat' });
    const chunks: unknown[] = [];

    for await (const chunk of client.sendMessage({
      conversationId: 'test',
      message: 'Hi',
    })) {
      chunks.push(chunk);
    }

    expect(chunks[0]).toEqual({ error: 'HTTP 500' });
  });
});

describe('ChatClient inactivity timeout', () => {
  const request = { conversationId: 'test', message: 'Hi' };

  async function collect(stream: AsyncIterable<WidgetChatChunk>) {
    const chunks: WidgetChatChunk[] = [];
    for await (const chunk of stream) chunks.push(chunk);
    return chunks;
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('completes fifty seconds of streaming with chunks every five seconds', async () => {
    const transport = mockChatStream();
    const client = new ChatClient({ apiUrl: '/chat' });
    const result = collect(client.sendMessage(request));

    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(5000);
      expect(transport.signal.aborted).toBe(false);
      transport.send('data: {"content":"Hello"}\n\n');
      await vi.advanceTimersByTimeAsync(0);
    }
    transport.send('data: [DONE]\n\n');

    expect(await result).toEqual([
      ...Array.from({ length: 10 }, () => ({ content: 'Hello' })),
      { done: true },
    ]);
    expect(vi.getTimerCount()).toBe(0);
    expect(transport.body.locked).toBe(false);
  });

  it.each([true, false])('times out without activity (response headers received: %s)', async (respond) => {
    const transport = mockChatStream(respond);
    const client = new ChatClient({ apiUrl: '/chat', timeout: 1000 });
    const result = collect(client.sendMessage(request));

    await vi.advanceTimersByTimeAsync(999);
    expect(transport.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    expect(await result).toEqual([{ error: 'timeout' }]);
    expect(transport.signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('starts a fresh inactivity interval after a received chunk', async () => {
    const transport = mockChatStream();
    const client = new ChatClient({ apiUrl: '/chat', timeout: 1000 });
    const result = collect(client.sendMessage(request));

    await vi.advanceTimersByTimeAsync(800);
    transport.send('data: {"content":"Partial"}\n\n');
    await vi.advanceTimersByTimeAsync(999);
    expect(transport.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    expect(await result).toEqual([{ content: 'Partial' }, { error: 'timeout' }]);
    expect(vi.getTimerCount()).toBe(0);
    expect(transport.body.locked).toBe(false);
  });

  it('counts heartbeat, malformed and partial transport data without changing SSE parsing', async () => {
    const transport = mockChatStream();
    const client = new ChatClient({ apiUrl: '/chat', timeout: 1000 });
    const result = collect(client.sendMessage(request));

    for (const data of [': heartbeat\n\n', 'data: not-json\n\n', 'data: {"content":', '"Hello"}\n\n']) {
      await vi.advanceTimersByTimeAsync(800);
      expect(transport.signal.aborted).toBe(false);
      transport.send(data);
      await vi.advanceTimersByTimeAsync(0);
    }
    transport.close();

    expect(await result).toEqual([{ content: 'Hello' }, { done: true }]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not treat an empty transport chunk as activity', async () => {
    const transport = mockChatStream();
    const client = new ChatClient({ apiUrl: '/chat', timeout: 1000 });
    const result = collect(client.sendMessage(request));

    await vi.advanceTimersByTimeAsync(800);
    transport.send('');
    await vi.advanceTimersByTimeAsync(200);

    expect(await result).toEqual([{ error: 'timeout' }]);
  });

  it.each([undefined, 2000, 0])('respects a per-call timeout of %s', async (timeout) => {
    const transport = mockChatStream(false);
    const client = new ChatClient({ apiUrl: '/chat', timeout: 1000 });
    const result = collect(client.sendMessage(request, { timeout }));
    const interval = timeout ?? 1000;
    if (interval > 0) {
      await vi.advanceTimersByTimeAsync(interval - 1);
      expect(transport.signal.aborted).toBe(false);
    }
    await vi.advanceTimersByTimeAsync(interval === 0 ? 0 : 1);

    expect(await result).toEqual([{ error: 'timeout' }]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['before request', 'waiting for response', 'reading'] as const)(
    'preserves external abort %s', async (phase) => {
      const external = new AbortController();
      if (phase === 'before request') external.abort();
      const remove = vi.spyOn(external.signal, 'removeEventListener');
      const transport = mockChatStream(phase === 'reading');
      const client = new ChatClient({ apiUrl: '/chat' });
      const result = collect(client.sendMessage(request, { signal: external.signal }));

      await vi.advanceTimersByTimeAsync(0);
      external.abort();

      expect(await result).toEqual([{ error: 'aborted' }]);
      expect(transport.signal.aborted).toBe(true);
      expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it.each(['done', 'eof', 'failure', 'early exit'] as const)(
    'cleans timers, listeners and the reader on %s without aborting a later request', async (ending) => {
      const external = new AbortController();
      const remove = vi.spyOn(external.signal, 'removeEventListener');
      const transport = mockChatStream();
      const client = new ChatClient({ apiUrl: '/chat', timeout: 1000 });
      const stream = client.sendMessage(request, { signal: external.signal });
      const first = stream.next();
      transport.send('data: {"content":"Partial"}\n\n');
      expect(await first).toMatchObject({ value: { content: 'Partial' } });
      await vi.advanceTimersByTimeAsync(500);

      if (ending === 'early exit') {
        await stream.return(undefined);
      } else {
        if (ending === 'done') transport.send('data: [DONE]\n\n');
        if (ending === 'eof') transport.close();
        if (ending === 'failure') transport.fail();
        const terminal = await stream.next();
        expect(terminal.value).toEqual(ending === 'failure' ? { error: 'network' } : { done: true });
        // Cleanup must happen even if the consumer pauses at the terminal yield.
        expect(vi.getTimerCount()).toBe(0);
        await stream.return(undefined);
      }
      expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
      expect(transport.body.locked).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
      if (ending === 'done' || ending === 'early exit') expect(transport.cancel).toHaveBeenCalledOnce();

      const nextTransport = mockChatStream(false);
      const next = collect(client.sendMessage(request));
      await vi.advanceTimersByTimeAsync(501);
      expect(nextTransport.signal.aborted).toBe(false);
      external.abort();
      expect(transport.signal.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(499);
      expect(await next).toEqual([{ error: 'timeout' }]);
    }
  );

  it.each([429, 500, 204])('cleans up a terminal HTTP response (%s)', async (status) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status }));
    const external = new AbortController();
    const remove = vi.spyOn(external.signal, 'removeEventListener');
    const client = new ChatClient({ apiUrl: '/chat' });
    const stream = client.sendMessage(request, { signal: external.signal });

    expect((await stream.next()).value).toEqual({
      error: status === 429 ? 'rate_limit' : status === 500 ? 'HTTP 500' : 'No response body',
    });
    expect(vi.getTimerCount()).toBe(0);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    await stream.return(undefined);
  });
});
