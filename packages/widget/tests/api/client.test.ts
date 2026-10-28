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

  it.each([
    ['ends with [DONE]', ['data: {"content":"Hello"}\n\n', 'data: [DONE]\n\n'], { done: true }],
    ['ends with [DONE] and no newline', ['data: {"content":"Hello"}\n\n', 'data: [DONE]'], { done: true }],
    ['ends without [DONE]', ['data: {"content":"Hello"}\n\n'], { error: 'network' }],
    ['ends mid-event', ['data: {"content":"Hello"}\n\n', 'data: {"cont'], { error: 'network' }],
  ])('a stream that %s', async (_name, events, terminal) => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        for (const event of events) controller.enqueue(encoder.encode(event));
        controller.close();
      },
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(stream, { status: 200 }));

    const client = new ChatClient({ apiUrl: 'https://api.test/chat' });
    const chunks: unknown[] = [];
    for await (const chunk of client.sendMessage({ conversationId: 'test', message: 'Hi' })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([{ content: 'Hello' }, terminal]);
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
    transport.send('data: [DONE]\n\n');
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
        expect(terminal.value).toEqual(ending === 'done' ? { done: true } : { error: 'network' });
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

describe('ChatClient with protocol v1', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function respond(lines: string[]) {
    const body = lines.map((line) => `data: ${line}\n\n`).join('');
    return vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, { status: 200 }));
  }

  async function collect(request = { conversationId: 'c1', message: 'Hi' }) {
    const chunks: WidgetChatChunk[] = [];
    for await (const chunk of new ChatClient({ apiUrl: 'https://api.test/chat' }).sendMessage(request)) chunks.push(chunk);
    return chunks;
  }

  const part = (value: Record<string, unknown>) => JSON.stringify(value);

  it('asks for v1, and reads parts as the chunks the widget handles', async () => {
    const fetch = respond([
      part({ type: 'start', protocol: 1, conversationId: 'c1', messageId: 'srv-1' }),
      part({ type: 'text-start', id: 't1' }),
      part({ type: 'text-delta', id: 't1', delta: 'Hello' }),
      part({ type: 'lead-captured', lead: { email: 'a@b.test' } }),
      part({ type: 'text-end', id: 't1' }),
      part({ type: 'tool-call', toolCallId: 'x', toolName: 'y', input: {}, executor: 'server' }),
      part({ type: 'a-part-from-the-future', anything: true }),
      part({ type: 'finish', reason: 'stop' }),
      '[DONE]',
    ]);

    const chunks = await collect();

    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toMatchObject({ protocol: 1, conversationId: 'c1' });
    expect(chunks).toEqual([
      { messageId: 'srv-1' },
      { content: 'Hello' },
      { leadCaptured: true, leadData: { email: 'a@b.test' } },
      { done: true },
      { done: true },
    ]);
  });

  it('maps error codes to the errors the widget knows, and ignores the finish after one', async () => {
    respond([
      part({ type: 'start', protocol: 1, conversationId: 'c1', messageId: 'm' }),
      part({ type: 'error', code: 'rate_limited', retryable: true, retryAfterMs: 5000 }),
      part({ type: 'finish', reason: 'error' }),
      '[DONE]',
    ]);
    expect((await collect()).slice(1, 2)).toEqual([{ error: 'rate_limit', retryAfterMs: 5000 }]);

    respond([part({ type: 'error', code: 'timeout', retryable: true }), part({ type: 'finish', reason: 'error' }), '[DONE]']);
    expect((await collect())[0]).toEqual({ error: 'timeout' });

    respond([part({ type: 'error', code: 'budget_exceeded', retryable: false, scope: 'conversation' }), part({ type: 'finish', reason: 'error' }), '[DONE]']);
    expect((await collect())[0]).toEqual({ error: 'budget' });

    respond([part({ type: 'error', code: 'budget_exceeded', retryable: false, scope: 'ip' }), part({ type: 'finish', reason: 'error' }), '[DONE]']);
    expect((await collect())[0]).toEqual({ error: 'budget_daily' });

    respond([part({ type: 'error', code: 'provider_error', retryable: true }), part({ type: 'finish', reason: 'error' }), '[DONE]']);
    expect((await collect())[0]).toEqual({ error: 'provider_error' });
  });

  it('reads the error body of a refusal before the stream', async () => {
    const refuse = (status: number, body: string) => vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(body, { status }));

    refuse(429, JSON.stringify({ error: { code: 'rate_limited', retryAfterMs: 42_000 } }));
    expect(await collect()).toEqual([{ error: 'rate_limit', retryAfterMs: 42_000 }]);

    refuse(503, JSON.stringify({ error: { code: 'provider_unavailable' } }));
    expect(await collect()).toEqual([{ error: 'unavailable' }]);

    // A 0.5 server, or a proxy page: no JSON body.
    refuse(429, 'Too Many Requests');
    expect(await collect()).toEqual([{ error: 'rate_limit' }]);
    refuse(502, '<html>Bad gateway</html>');
    expect(await collect()).toEqual([{ error: 'HTTP 502' }]);
  });

  it('reports a v1 stream that ends without finish as cut off', async () => {
    respond([part({ type: 'start', protocol: 1, conversationId: 'c1', messageId: 'm' }), part({ type: 'text-delta', id: 't', delta: 'Half' }), '[DONE]']);
    expect((await collect()).at(-1)).toEqual({ error: 'cut_off' });
  });

  it('still reads the 0.5 format from older servers', async () => {
    respond([part({ content: 'Old' }), part({ done: true }), '[DONE]']);
    expect((await collect()).slice(0, 2)).toEqual([{ content: 'Old' }, { done: true }]);
  });

  it('maps a source part to a source chunk with url and title', async () => {
    respond([
      part({ type: 'start', protocol: 1, conversationId: 'c1', messageId: 'm' }),
      part({ type: 'source', sourceId: 'https://example.com/pricing', url: 'https://example.com/pricing', title: 'Pricing' }),
      part({ type: 'finish', reason: 'stop' }),
      '[DONE]',
    ]);
    const chunks = await collect();
    expect(chunks).toContainEqual({ source: { url: 'https://example.com/pricing', title: 'Pricing' } });
  });

  it('maps a source part without title to a source chunk with url only', async () => {
    respond([
      part({ type: 'start', protocol: 1, conversationId: 'c1', messageId: 'm' }),
      part({ type: 'source', sourceId: 'https://example.com/docs', url: 'https://example.com/docs' }),
      part({ type: 'finish', reason: 'stop' }),
      '[DONE]',
    ]);
    const chunks = await collect();
    expect(chunks).toContainEqual({ source: { url: 'https://example.com/docs', title: undefined } });
  });

  it('drops source parts with non-http(s) URLs', async () => {
    respond([
      part({ type: 'start', protocol: 1, conversationId: 'c1', messageId: 'm' }),
      part({ type: 'source', sourceId: 'javascript:alert(1)', url: 'javascript:alert(1)', title: 'XSS' }),
      part({ type: 'source', sourceId: 'data:text/html,hi', url: 'data:text/html,hi', title: 'Data' }),
      part({ type: 'finish', reason: 'stop' }),
      '[DONE]',
    ]);
    const chunks = await collect();
    expect(chunks.some((c) => 'source' in c)).toBe(false);
  });
});
