import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import { memoryStorage, type AnalyticsEvent, type ChatCopsStorage, type EventSink } from '@chatcops/core';
import { scriptedProvider, textStep } from '@chatcops/core/testing/provider';
import { createChatHandler } from '../src/handler.js';
import { chatcopsAnalyticsHandler } from '../src/adapters/express.js';
import type { ChatCopsServerConfig } from '../src/config.js';

function config(storage: ChatCopsStorage, overrides: Partial<ChatCopsServerConfig> = {}): ChatCopsServerConfig {
  return {
    allowAnonymous: true,
    provider: scriptedProvider(Array.from({ length: 5 }, () => textStep('Hello'))),
    systemPrompt: 'Test',
    budgets: false,
    analytics: true,
    storage,
    ...overrides,
  };
}

/** Sends one message and reads the reply to the end. */
async function chat(handler: ReturnType<typeof createChatHandler>, conversationId: string) {
  for await (const _ of handler.handleChat({ conversationId, message: 'Hi' })) {
    // drain
  }
}

const DAY = 86_400_000;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('analytics on the storage event sink', () => {
  it('writes the events by the time the reply ends, and counts them across instances', async () => {
    const storage = memoryStorage();
    // Two server instances sharing one store, as on serverless.
    const first = createChatHandler(config(storage));
    const second = createChatHandler(config(storage));

    await chat(first, 'c1');
    await chat(second, 'c2');

    const now = Date.now();
    const written = await storage.events?.query?.({ from: now - DAY, to: now + 1 });
    expect(written).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'conversation.started', count: 2 }),
        expect.objectContaining({ type: 'message.sent', count: 2 }),
        expect.objectContaining({ type: 'message.received', count: 2 }),
      ])
    );

    expect(await first.analyticsStats()).toMatchObject({ totalConversations: 2, totalMessages: 4 });
    // getAnalytics() still describes this process only.
    expect(first.getAnalytics()).toMatchObject({ totalConversations: 1, totalMessages: 2 });
  });

  it('counts only the range asked for', async () => {
    const storage = memoryStorage();
    const handler = createChatHandler(config(storage));
    await chat(handler, 'c1');

    const now = Date.now();
    expect(await handler.analyticsStats({ from: now + DAY, to: now + 2 * DAY })).toMatchObject({ totalConversations: 0 });
    expect(await handler.analyticsStats({ from: now - DAY })).toMatchObject({ totalConversations: 1 });
  });

  it('falls back to this process for a sink that can only be written to', async () => {
    const write = vi.fn(async (_events: AnalyticsEvent[]) => undefined);
    const events: EventSink = { write };
    const handler = createChatHandler(config({ ...memoryStorage(), events }));
    await chat(handler, 'c1');

    expect(write).toHaveBeenCalled();
    expect(write.mock.calls.flatMap(([batch]) => batch.map((event) => event.type))).toEqual(['conversation.started', 'message.sent', 'message.received']);
    expect(await handler.analyticsStats()).toMatchObject({ totalConversations: 1 });
  });

  it('still answers when the sink fails, and logs it', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const events: EventSink = { write: async () => Promise.reject(new Error('db down')) };
    const handler = createChatHandler(config({ ...memoryStorage(), events }));

    const chunks: string[] = [];
    for await (const chunk of handler.handleChat({ conversationId: 'c1', message: 'Hi' })) chunks.push(chunk);

    expect(chunks.join('')).toContain('Hello');
    expect(error).toHaveBeenCalledWith('[chatcops] analytics write failed: db down');
  });

  it('writes nothing with analytics off', async () => {
    const storage = memoryStorage();
    const write = vi.spyOn(storage.events as EventSink, 'write');
    const handler = createChatHandler(config(storage, { analytics: false }));
    await chat(handler, 'c1');

    expect(write).not.toHaveBeenCalled();
    expect(await handler.analyticsStats()).toBeNull();
  });
});

describe('the Express analytics route', () => {
  function response() {
    const res = {
      statusCode: 200,
      body: undefined as unknown,
      setHeader: vi.fn(),
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(value: unknown) {
        this.body = value;
      },
    };
    return res;
  }
  const get = (query: Record<string, string> = {}) =>
    ({ method: 'GET', headers: { authorization: 'Bearer token' }, query }) as unknown as ExpressRequest;

  it('reads the sink for the range in the query', async () => {
    const storage = memoryStorage();
    const serverConfig = config(storage, { analyticsToken: 'token' });
    await chat(createChatHandler(serverConfig), 'other-instance');

    const res = response();
    await chatcopsAnalyticsHandler(serverConfig)(get({ from: String(Date.now() - DAY) }), res as unknown as ExpressResponse);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ totalConversations: 1 });

    const empty = response();
    await chatcopsAnalyticsHandler(serverConfig)(get({ from: String(Date.now() + DAY) }), empty as unknown as ExpressResponse);
    expect(empty.body).toMatchObject({ totalConversations: 0 });
  });

  it('refuses a range that is not a time in milliseconds', async () => {
    const res = response();
    await chatcopsAnalyticsHandler(config(memoryStorage(), { analyticsToken: 'token' }))(get({ from: 'yesterday' }), res as unknown as ExpressResponse);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'invalid_range' });
  });

  it('answers 500 when the sink cannot be read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const events: EventSink = { write: async () => undefined, query: async () => Promise.reject(new Error('db down')) };
    const res = response();
    await chatcopsAnalyticsHandler(config({ ...memoryStorage(), events }, { analyticsToken: 'token' }))(get(), res as unknown as ExpressResponse);
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'internal_error' });
  });
});
