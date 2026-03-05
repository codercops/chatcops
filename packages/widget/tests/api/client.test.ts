import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatClient } from '../../src/api/client.js';

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
