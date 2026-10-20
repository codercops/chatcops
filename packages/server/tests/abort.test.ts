import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request as ExpressRequest, Response as ExpressResponse, NextFunction } from 'express';
import { MemoryStore, type ProviderChatParams } from '@chatcops/core';

// A provider that streams one chunk, then waits until it's aborted, the way a
// real SDK request does when the signal fires.
const seen: { signal?: AbortSignal; aborted: boolean } = { aborted: false };
vi.mock('@chatcops/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@chatcops/core')>();
  return {
    ...actual,
    createProvider: vi.fn().mockResolvedValue({
      name: 'slow',
      async *chat(params: ProviderChatParams) {
        seen.signal = params.signal;
        yield 'First words';
        await new Promise<void>((resolve, reject) => {
          if (!params.signal) return;
          const fail = () => {
            seen.aborted = true;
            reject(new DOMException('Aborted', 'AbortError'));
          };
          if (params.signal.aborted) return fail();
          params.signal.addEventListener('abort', () => {
            seen.aborted = true;
            reject(new DOMException('Aborted', 'AbortError'));
          }, { once: true });
          // Safety net so a broken test can't hang.
          setTimeout(resolve, 2000);
        });
        yield ' and a tail nobody should see';
      },
      async chatSync() {
        return '';
      },
    }),
  };
});

import { createChatHandler } from '../src/handler.js';
import { chatcopsVercelHandler } from '../src/adapters/vercel.js';
import { chatcopsCloudflareHandler } from '../src/adapters/cloudflare.js';
import { chatcopsMiddleware } from '../src/adapters/express.js';

const body = { conversationId: 'conv-abort', message: 'Write me a long essay' };
const waitFor = async (check: () => boolean) => {
  for (let i = 0; i < 100 && !check(); i += 1) await new Promise((r) => setTimeout(r, 10));
  expect(check()).toBe(true);
};

beforeEach(() => {
  seen.signal = undefined;
  seen.aborted = false;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('handleChat with a signal', () => {
  it('passes the signal to the provider, stops quietly and does not save the partial reply', async () => {
    const store = new MemoryStore();
    const { handleChat, cleanup } = createChatHandler({
      provider: { type: 'claude', apiKey: 'k' },
      systemPrompt: 'Test',
      conversationStore: store,
    });
    const controller = new AbortController();
    const chunks: string[] = [];

    for await (const chunk of handleChat(body, '1.2.3.4', { signal: controller.signal })) {
      chunks.push(chunk);
      controller.abort();
    }
    cleanup();

    expect(seen.signal).toBe(controller.signal);
    expect(seen.aborted).toBe(true);
    expect(chunks).toEqual([JSON.stringify({ content: 'First words' })]);
    const saved = await store.get('conv-abort');
    expect(saved?.messages.map((m) => m.role)).toEqual(['user']);
  });
});

describe('adapters stop the provider when the visitor disconnects', () => {
  it('Vercel: cancelling the response stream aborts the reply', async () => {
    const handler = chatcopsVercelHandler({ provider: { type: 'claude', apiKey: 'k' }, systemPrompt: 'Test' });
    const res = await handler(new Request('http://localhost/api/chat', { method: 'POST', body: JSON.stringify(body) }));
    const reader = res.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(first).toContain('First words');

    await reader.cancel();
    await waitFor(() => seen.aborted);
  });

  it('Cloudflare: a failed write after the visitor left aborts the reply', async () => {
    const handler = chatcopsCloudflareHandler({ provider: { type: 'claude', apiKey: 'k' }, systemPrompt: 'Test' });
    const waitUntil = vi.fn();
    const res = await handler(
      new Request('http://localhost/api/chat', { method: 'POST', body: JSON.stringify(body) }),
      {},
      { waitUntil }
    );
    const reader = res.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(first).toContain('First words');

    await reader.cancel();
    await waitFor(() => seen.aborted);
    expect(waitUntil).toHaveBeenCalledOnce();
    // The background work finishes without throwing.
    await expect(waitUntil.mock.calls[0][0]).resolves.toBeUndefined();
  });

  it('Express: the response closing early aborts the reply and writes nothing more', async () => {
    const writes: string[] = [];
    const listeners: Record<string, Array<() => void>> = {};
    let ended = false;
    const res = {
      writableFinished: false,
      setHeader: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      write: vi.fn((chunk: string) => {
        writes.push(chunk);
        // The visitor closes the tab right after the first chunk arrives.
        if (writes.length === 1) for (const l of listeners.close ?? []) l();
        return true;
      }),
      end: vi.fn(() => {
        ended = true;
      }),
      on: vi.fn((event: string, listener: () => void) => {
        listeners[event] ??= [];
        listeners[event].push(listener);
      }),
    };
    const req = { method: 'POST', body, ip: '127.0.0.1', socket: {} };

    await chatcopsMiddleware({ provider: { type: 'claude', apiKey: 'k' }, systemPrompt: 'Test' })(
      req as unknown as ExpressRequest,
      res as unknown as ExpressResponse,
      vi.fn() as unknown as NextFunction
    );

    expect(seen.aborted).toBe(true);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain('First words');
    expect(writes.join('')).not.toContain('[DONE]');
    expect(writes.join('')).not.toContain('internal_error');
    expect(ended).toBe(true);
  });
});
