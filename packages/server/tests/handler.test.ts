import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@chatcops/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@chatcops/core')>();
  return {
    ...actual,
    createProvider: vi.fn(),
  };
});

import { createProvider } from '@chatcops/core';
import { chatRequestSchema } from '../src/config.js';
import { createChatHandler } from '../src/handler.js';

const mockedCreateProvider = vi.mocked(createProvider);

describe('createChatHandler', () => {
  beforeEach(() => {
    mockedCreateProvider.mockReset();
    mockedCreateProvider.mockResolvedValue({
      name: 'test-provider',
      async *chat() {},
      async chatSync() {
        return '';
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('cleanup function clears interval', () => {
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');

    const { cleanup } = createChatHandler({
      provider: { type: 'claude', apiKey: 'test-key' },
      systemPrompt: 'Test',
      cors: '*',
    });

    cleanup();
    expect(clearIntervalSpy).toHaveBeenCalledOnce();
  });

  it('passes a working tool executor into the streaming provider', async () => {
    const weatherTool = {
      name: 'get_weather',
      description: 'Look up the weather',
      parameters: {
        city: { type: 'string' as const, description: 'City name' },
      },
      required: ['city'],
      execute: vi.fn().mockResolvedValue({
        success: true,
        data: { forecast: 'sunny' },
        message: 'Sunny in Boston',
      }),
    };

    mockedCreateProvider.mockResolvedValue({
      name: 'test-provider',
      async *chat(params) {
        const toolResult = await params.toolExecutor?.({
          id: 'tool-1',
          name: 'get_weather',
          input: { city: 'Boston' },
        });

        yield `Forecast: ${(toolResult?.data as { forecast: string }).forecast}`;
      },
      async chatSync() {
        return '';
      },
    });

    const { handleChat } = createChatHandler({
      provider: { type: 'openai', apiKey: 'test-key' },
      systemPrompt: 'Test',
      cors: '*',
      tools: [weatherTool],
    });

    const events: Array<Record<string, unknown>> = [];
    for await (const chunk of handleChat({
      conversationId: 'conv-1',
      message: 'What is the weather in Boston?',
    })) {
      events.push(JSON.parse(chunk));
    }

    expect(weatherTool.execute).toHaveBeenCalledWith({ city: 'Boston' });
    expect(events).toEqual([
      { content: 'Forecast: sunny' },
      { done: true },
    ]);
  });

  it('tracks lead capture analytics when a tool succeeds', async () => {
    const leadTool = {
      name: 'capture_lead',
      description: 'Capture a lead',
      parameters: {
        email: { type: 'string' as const, description: 'Email address' },
      },
      required: ['email'],
      execute: vi.fn().mockResolvedValue({
        success: true,
        data: { email: 'lead@example.com' },
        message: 'Lead stored',
      }),
    };

    mockedCreateProvider.mockResolvedValue({
      name: 'test-provider',
      async *chat(params) {
        await params.toolExecutor?.({
          id: 'tool-1',
          name: 'capture_lead',
          input: { email: 'lead@example.com' },
        });

        yield 'Thanks, we will reach out shortly.';
      },
      async chatSync() {
        return '';
      },
    });

    const { handleChat, getAnalytics } = createChatHandler({
      provider: { type: 'claude', apiKey: 'test-key' },
      systemPrompt: 'Test',
      cors: '*',
      analytics: true,
      tools: [leadTool],
    });

    for await (const _chunk of handleChat({
      conversationId: 'conv-1',
      message: 'My email is lead@example.com',
    })) {
      // Drain the stream.
    }

    expect(leadTool.execute).toHaveBeenCalledWith({ email: 'lead@example.com' });
    expect(getAnalytics()).toMatchObject({
      totalConversations: 1,
      leadsCapture: 1,
    });
  });

  it('emits leadCaptured SSE metadata and dispatches webhook payload with conversation id', async () => {
    const leadTool = {
      name: 'capture_lead',
      description: 'Capture a lead',
      parameters: {
        email: { type: 'string' as const, description: 'Email address' },
      },
      required: ['email'],
      execute: vi.fn().mockResolvedValue({
        success: true,
        data: { email: 'lead@example.com' },
        message: 'Lead stored',
      }),
    };

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('', { status: 200 })
    );

    mockedCreateProvider.mockResolvedValue({
      name: 'test-provider',
      async *chat(params) {
        await params.toolExecutor?.({
          id: 'tool-1',
          name: 'capture_lead',
          input: { email: 'lead@example.com' },
        });

        yield 'Thanks, we will reach out shortly.';
      },
      async chatSync() {
        return '';
      },
    });

    const { handleChat } = createChatHandler({
      provider: { type: 'claude', apiKey: 'test-key' },
      systemPrompt: 'Test',
      cors: '*',
      tools: [leadTool],
      webhooks: [{ url: 'https://hooks.test/lead', events: ['lead:captured'] }],
    });

    const events: Array<Record<string, unknown>> = [];
    for await (const chunk of handleChat({
      conversationId: 'conv-42',
      message: 'My email is lead@example.com',
    })) {
      events.push(JSON.parse(chunk));
    }

    expect(events).toEqual([
      { leadCaptured: true, leadData: { email: 'lead@example.com' } },
      { content: 'Thanks, we will reach out shortly.' },
      { done: true },
    ]);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const requestBody = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body));
    expect(requestBody).toMatchObject({
      event: 'lead:captured',
      data: {
        lead: { email: 'lead@example.com' },
        conversationId: 'conv-42',
      },
    });
  });
});

describe('chatRequestSchema', () => {
  it('validates a minimal valid request', () => {
    const result = chatRequestSchema.safeParse({
      conversationId: 'conv-1',
      message: 'Hello',
    });
    expect(result.success).toBe(true);
  });

  it('validates request with page context', () => {
    const result = chatRequestSchema.safeParse({
      conversationId: 'conv-1',
      message: 'Hello',
      pageContext: {
        url: 'https://example.com',
        title: 'Home Page',
        description: 'Welcome',
      },
      locale: 'en',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty conversationId', () => {
    const result = chatRequestSchema.safeParse({
      conversationId: '',
      message: 'Hello',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty message', () => {
    const result = chatRequestSchema.safeParse({
      conversationId: 'conv-1',
      message: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects overly long message', () => {
    const result = chatRequestSchema.safeParse({
      conversationId: 'conv-1',
      message: 'a'.repeat(10001),
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid page URL', () => {
    const result = chatRequestSchema.safeParse({
      conversationId: 'conv-1',
      message: 'Hello',
      pageContext: {
        url: 'not-a-url',
        title: 'Page',
      },
    });
    expect(result.success).toBe(false);
  });

  it('allows missing optional fields', () => {
    const result = chatRequestSchema.safeParse({
      conversationId: 'conv-1',
      message: 'Hello',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.pageContext).toBeUndefined();
      expect(result.data.locale).toBeUndefined();
    }
  });
});
