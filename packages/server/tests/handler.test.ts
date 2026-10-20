import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@chatcops/core', () => {
  type ChatMessage = {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: number;
    metadata?: Record<string, unknown>;
  };

  type Conversation = {
    id: string;
    messages: ChatMessage[];
    metadata?: Record<string, unknown>;
    createdAt: number;
    updatedAt: number;
  };

  class ConversationManager {
    private readonly conversations = new Map<string, Conversation>();

    async getOrCreate(id: string) {
      const existing = this.conversations.get(id);
      if (existing) {
        return existing;
      }

      const now = Date.now();
      const conversation: Conversation = {
        id,
        messages: [],
        createdAt: now,
        updatedAt: now,
      };
      this.conversations.set(id, conversation);
      return conversation;
    }

    async addMessage(conversationId: string, message: ChatMessage) {
      const conversation = await this.getOrCreate(conversationId);
      conversation.messages.push(message);
      conversation.updatedAt = Date.now();
      return conversation;
    }

    async getMessages(conversationId: string) {
      const conversation = await this.getOrCreate(conversationId);
      return [...conversation.messages];
    }

    async removeMessage(conversationId: string, messageId: string) {
      const conversation = await this.getOrCreate(conversationId);
      conversation.messages = conversation.messages.filter((message) => message.id !== messageId);
      conversation.updatedAt = Date.now();
    }
  }

  class AnalyticsCollector {
    private totalConversations = 0;
    private leadsCapture = 0;

    track(event: string) {
      if (event === 'conversation:started') {
        this.totalConversations += 1;
      }

      if (event === 'lead:captured') {
        this.leadsCapture += 1;
      }
    }

    getStats() {
      return {
        totalConversations: this.totalConversations,
        leadsCapture: this.leadsCapture,
      };
    }
  }

  return {
    createProvider: vi.fn(),
    ConversationManager,
    AnalyticsCollector,
    toolToDefinition: (tool: {
      name: string;
      description: string;
      parameters: Record<string, { type: 'string' | 'number' | 'boolean'; description: string; enum?: string[] }>;
      required: string[];
    }) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      required: tool.required,
    }),
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

  it('warns once when the deprecated i18n option is set', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { cleanup } = createChatHandler({
      provider: { type: 'openai', apiKey: 'test-key' },
      systemPrompt: 'Test',
      i18n: { defaultLocale: 'en', locales: {} },
    });
    cleanup();

    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toContain('i18n');
  });

  it('does not warn when i18n is not set', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { cleanup } = createChatHandler({
      provider: { type: 'openai', apiKey: 'test-key' },
      systemPrompt: 'Test',
    });
    cleanup();

    expect(warnSpy).not.toHaveBeenCalled();
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

  it('accepts a very long page URL but only sends the start of it, outside the system prompt', async () => {
    const prompts: string[] = [];
    const lastUserMessages: string[] = [];
    mockedCreateProvider.mockResolvedValue({
      name: 'test-provider',
      async *chat(params) {
        prompts.push(params.systemPrompt ?? '');
        lastUserMessages.push(params.messages.at(-1)?.content ?? '');
        yield 'ok';
      },
      async chatSync() {
        return '';
      },
    });

    const { handleChat } = createChatHandler({
      provider: { type: 'openai', apiKey: 'test-key' },
      systemPrompt: 'Test',
      cors: '*',
    });

    const url = `https://example.com/page?token=${'a'.repeat(5000)}`;
    const events: Array<Record<string, unknown>> = [];
    for await (const chunk of handleChat({
      conversationId: 'conv-long-url',
      message: 'Hello',
      pageContext: { url, title: 'Pricing' },
    })) {
      events.push(JSON.parse(chunk));
    }

    expect(events).toEqual([{ content: 'ok' }, { done: true }]);
    expect(lastUserMessages[0]).toContain(`Page: ${url.slice(0, 2000)}`);
    expect(lastUserMessages[0]).not.toContain(url.slice(0, 2001));
    expect(prompts[0]).not.toContain('example.com');
  });

  it('passes the configured tool timeout into the provider chat params', async () => {
    const receivedTimeouts: Array<number | undefined> = [];

    mockedCreateProvider.mockResolvedValue({
      name: 'test-provider',
      async *chat(params) {
        receivedTimeouts.push(params.toolTimeoutMs);
        yield 'Configured timeout received.';
      },
      async chatSync() {
        return '';
      },
    });

    const { handleChat } = createChatHandler({
      provider: { type: 'openai', apiKey: 'test-key' },
      systemPrompt: 'Test',
      cors: '*',
      toolTimeoutMs: 2_500,
    });

    for await (const _chunk of handleChat({
      conversationId: 'conv-timeout',
      message: 'Hello',
    })) {
      // Drain the stream.
    }

    expect(receivedTimeouts).toEqual([2_500]);
  });

  it('passes maxTokens and temperature from the config into the provider chat params', async () => {
    const received: Array<{ maxTokens?: number; temperature?: number }> = [];

    mockedCreateProvider.mockResolvedValue({
      name: 'test-provider',
      async *chat(params) {
        received.push({ maxTokens: params.maxTokens, temperature: params.temperature });
        yield 'ok';
      },
      async chatSync() {
        return '';
      },
    });

    const withOptions = createChatHandler({
      provider: { type: 'openai', apiKey: 'test-key' },
      systemPrompt: 'Test',
      maxTokens: 4096,
      temperature: 0.2,
    });
    const withoutOptions = createChatHandler({
      provider: { type: 'openai', apiKey: 'test-key' },
      systemPrompt: 'Test',
    });

    for (const { handleChat } of [withOptions, withoutOptions]) {
      for await (const _chunk of handleChat({ conversationId: 'conv-params', message: 'Hello' })) {
        // Drain the stream.
      }
    }
    withOptions.cleanup();
    withoutOptions.cleanup();

    expect(received).toEqual([
      { maxTokens: 4096, temperature: 0.2 },
      { maxTokens: undefined, temperature: undefined },
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

  it('returns success: true from tool executor without waiting for webhook completion', async () => {
    let resolveWebhookFetch!: (response: Response) => void;
    const unresolvedFetchPromise = new Promise<Response>((resolve) => {
      resolveWebhookFetch = resolve;
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => unresolvedFetchPromise);

    let executorResult: unknown = null;

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
        executorResult = await params.toolExecutor?.({
          id: 'tool-1',
          name: 'capture_lead',
          input: { email: 'lead@example.com' },
        });

        yield 'Lead captured successfully.';
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

    const generator = handleChat({
      conversationId: 'conv-unresolved',
      message: 'My email is lead@example.com',
    });

    // Advance to first chunk: tool executor returns immediately without waiting for unresolved fetch
    const firstChunk = await generator.next();

    expect(leadTool.execute).toHaveBeenCalledWith({ email: 'lead@example.com' });
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(executorResult).toEqual({
      success: true,
      data: { email: 'lead@example.com' },
      message: 'Lead stored',
    });
    expect(firstChunk.done).toBe(false);

    // The visitor gets done: true right away, but the generator stays open
    // until the webhook finishes, so serverless runtimes don't cut it off.
    let isStreamFinished = false;
    const remaining: string[] = [];
    const streamCompletionPromise = (async () => {
      for await (const chunk of generator) {
        remaining.push(chunk);
      }
      isStreamFinished = true;
    })();

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(remaining.map((chunk) => JSON.parse(chunk))).toContainEqual({ done: true });
    expect(isStreamFinished).toBe(false);

    // Resolving fetch allows the generator to finish awaiting pending webhooks
    resolveWebhookFetch(new Response('OK', { status: 200 }));
    await streamCompletionPromise;
    expect(isStreamFinished).toBe(true);
  });

  it('awaits pending webhook delivery before returning provider_error when provider throws', async () => {
    let resolveWebhookFetch!: (response: Response) => void;
    const unresolvedFetchPromise = new Promise<Response>((resolve) => {
      resolveWebhookFetch = resolve;
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => unresolvedFetchPromise);
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    let executorResult: unknown = null;

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
        executorResult = await params.toolExecutor?.({
          id: 'tool-1',
          name: 'capture_lead',
          input: { email: 'lead@example.com' },
        });

        throw new Error('Provider failed after tool execution');
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

    const generator = handleChat({
      conversationId: 'conv-provider-error',
      message: 'My email is lead@example.com',
    });

    const events: Array<Record<string, unknown>> = [];
    let isStreamFinished = false;

    const streamCompletionPromise = (async () => {
      for await (const chunk of generator) {
        events.push(JSON.parse(chunk));
      }
      isStreamFinished = true;
    })();

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(leadTool.execute).toHaveBeenCalledWith({ email: 'lead@example.com' });
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(executorResult).toEqual({
      success: true,
      data: { email: 'lead@example.com' },
      message: 'Lead stored',
    });
    expect(isStreamFinished).toBe(false);
    expect(events).toEqual([]);

    resolveWebhookFetch(new Response('OK', { status: 200 }));
    await streamCompletionPromise;

    expect(isStreamFinished).toBe(true);
    expect(events).toEqual([{ error: 'provider_error' }]);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[chatcops] Provider error:',
      expect.any(Error)
    );
  });

  it('excludes the previous assistant message from provider history when regenerating', async () => {
    const receivedMessages: Array<Array<{ role: string; content: string }>> = [];

    mockedCreateProvider.mockResolvedValue({
      name: 'test-provider',
      async *chat(params) {
        receivedMessages.push(
          params.messages.map((message) => ({
            role: message.role,
            content: message.content,
          }))
        );
        yield receivedMessages.length === 1 ? 'First reply' : 'Regenerated reply';
      },
      async chatSync() {
        return '';
      },
    });

    const { handleChat } = createChatHandler({
      provider: { type: 'claude', apiKey: 'test-key' },
      systemPrompt: 'Test',
      cors: '*',
    });

    for await (const _chunk of handleChat({
      conversationId: 'conv-regenerate',
      message: 'Hello there',
      messageId: 'user-1',
    })) {
      // Drain initial response.
    }

    for await (const _chunk of handleChat({
      conversationId: 'conv-regenerate',
      message: 'Hello there',
      messageId: 'user-1',
      regenerate: true,
    })) {
      // Drain regenerated response.
    }

    expect(receivedMessages).toEqual([
      [{ role: 'user', content: 'Hello there' }],
      [{ role: 'user', content: 'Hello there' }],
    ]);
  });

  it('preserves the old assistant message when regenerate fails', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const receivedMessages: Array<Array<{ role: string; content: string }>> = [];
    let shouldFail = false;

    mockedCreateProvider.mockResolvedValue({
      name: 'test-provider',
      async *chat(params) {
        receivedMessages.push(
          params.messages.map((message) => ({
            role: message.role,
            content: message.content,
          }))
        );
        if (shouldFail) {
          throw new Error('Provider failed during regenerate');
        }
        yield receivedMessages.length === 1 ? 'Initial reply' : 'Follow up reply';
      },
      async chatSync() {
        return '';
      },
    });

    const { handleChat } = createChatHandler({
      provider: { type: 'claude', apiKey: 'test-key' },
      systemPrompt: 'Test',
      cors: '*',
    });

    for await (const _chunk of handleChat({
      conversationId: 'conv-failed-regen',
      message: 'Hello there',
      messageId: 'user-1',
    })) {
      // Drain initial response.
    }

    shouldFail = true;
    const errorEvents: Array<Record<string, unknown>> = [];
    for await (const chunk of handleChat({
      conversationId: 'conv-failed-regen',
      message: 'Hello there',
      messageId: 'user-1',
      regenerate: true,
    })) {
      errorEvents.push(JSON.parse(chunk));
    }
    expect(errorEvents).toEqual([{ error: 'provider_error' }]);

    shouldFail = false;
    for await (const _chunk of handleChat({
      conversationId: 'conv-failed-regen',
      message: 'Next question',
      messageId: 'user-2',
    })) {
      // Drain response.
    }

    expect(receivedMessages[2]).toEqual([
      { role: 'user', content: 'Hello there' },
      { role: 'assistant', content: 'Initial reply' },
      { role: 'user', content: 'Next question' },
    ]);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[chatcops] Provider error:',
      expect.any(Error)
    );
  });

  it('retrying regenerate after a failure does not delete earlier answers', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const receivedMessages: Array<Array<{ role: string; content: string }>> = [];
    let shouldFail = false;

    mockedCreateProvider.mockResolvedValue({
      name: 'test-provider',
      async *chat(params) {
        receivedMessages.push(
          params.messages.map((message) => ({
            role: message.role,
            content: message.content,
          }))
        );
        if (shouldFail) {
          throw new Error('Provider failed during regenerate');
        }
        yield `Reply ${receivedMessages.length}`;
      },
      async chatSync() {
        return '';
      },
    });

    const { handleChat } = createChatHandler({
      provider: { type: 'claude', apiKey: 'test-key' },
      systemPrompt: 'Test',
      cors: '*',
    });

    // Turn 1
    for await (const _chunk of handleChat({
      conversationId: 'conv-retry-earlier',
      message: 'First question',
      messageId: 'user-1',
    })) {}

    // Turn 2
    for await (const _chunk of handleChat({
      conversationId: 'conv-retry-earlier',
      message: 'Second question',
      messageId: 'user-2',
    })) {}

    // Regenerate Turn 2 fails
    shouldFail = true;
    for await (const _chunk of handleChat({
      conversationId: 'conv-retry-earlier',
      message: 'Second question',
      messageId: 'user-2',
      regenerate: true,
    })) {}

    // Retry regenerate Turn 2 succeeds
    shouldFail = false;
    for await (const _chunk of handleChat({
      conversationId: 'conv-retry-earlier',
      message: 'Second question',
      messageId: 'user-2',
      regenerate: true,
    })) {}

    expect(receivedMessages[3]).toEqual([
      { role: 'user', content: 'First question' },
      { role: 'assistant', content: 'Reply 1' },
      { role: 'user', content: 'Second question' },
    ]);

    // Subsequent Turn 3
    for await (const _chunk of handleChat({
      conversationId: 'conv-retry-earlier',
      message: 'Third question',
      messageId: 'user-3',
    })) {}

    expect(receivedMessages[4]).toEqual([
      { role: 'user', content: 'First question' },
      { role: 'assistant', content: 'Reply 1' },
      { role: 'user', content: 'Second question' },
      { role: 'assistant', content: 'Reply 4' },
      { role: 'user', content: 'Third question' },
    ]);
  });

  it('successfully replaces exactly one assistant message upon regenerate', async () => {
    const receivedMessages: Array<Array<{ role: string; content: string }>> = [];

    mockedCreateProvider.mockResolvedValue({
      name: 'test-provider',
      async *chat(params) {
        receivedMessages.push(
          params.messages.map((message) => ({
            role: message.role,
            content: message.content,
          }))
        );
        yield receivedMessages.length === 3 ? 'Regenerated reply 2' : `Reply ${receivedMessages.length}`;
      },
      async chatSync() {
        return '';
      },
    });

    const { handleChat } = createChatHandler({
      provider: { type: 'claude', apiKey: 'test-key' },
      systemPrompt: 'Test',
      cors: '*',
    });

    // Turn 1
    for await (const _chunk of handleChat({
      conversationId: 'conv-replace-one',
      message: 'First question',
      messageId: 'user-1',
    })) {}

    // Turn 2
    for await (const _chunk of handleChat({
      conversationId: 'conv-replace-one',
      message: 'Second question',
      messageId: 'user-2',
    })) {}

    // Regenerate Turn 2
    for await (const _chunk of handleChat({
      conversationId: 'conv-replace-one',
      message: 'Second question',
      messageId: 'user-2',
      regenerate: true,
    })) {}

    // Turn 3
    for await (const _chunk of handleChat({
      conversationId: 'conv-replace-one',
      message: 'Third question',
      messageId: 'user-3',
    })) {}

    const assistantMessages = receivedMessages[3].filter((m) => m.role === 'assistant');
    expect(assistantMessages).toEqual([
      { role: 'assistant', content: 'Reply 1' },
      { role: 'assistant', content: 'Regenerated reply 2' },
    ]);
    expect(assistantMessages).toHaveLength(2);
    expect(receivedMessages[3]).toEqual([
      { role: 'user', content: 'First question' },
      { role: 'assistant', content: 'Reply 1' },
      { role: 'user', content: 'Second question' },
      { role: 'assistant', content: 'Regenerated reply 2' },
      { role: 'user', content: 'Third question' },
    ]);
  });

  it('restores user message when regenerating an unknown conversation', async () => {
    const receivedMessages: Array<Array<{ id: string; role: string; content: string }>> = [];

    mockedCreateProvider.mockResolvedValue({
      name: 'test-provider',
      async *chat(params) {
        receivedMessages.push(
          params.messages.map((message) => ({
            id: message.id,
            role: message.role,
            content: message.content,
          }))
        );
        yield 'Recovered reply';
      },
      async chatSync() {
        return '';
      },
    });

    const { handleChat } = createChatHandler({
      provider: { type: 'claude', apiKey: 'test-key' },
      systemPrompt: 'Test',
      cors: '*',
    });

    for await (const _chunk of handleChat({
      conversationId: 'conv-unknown-regen',
      message: 'Hello from unknown',
      messageId: 'user-unknown-1',
      regenerate: true,
    })) {
      // Drain response.
    }

    expect(receivedMessages).toEqual([
      [{ id: 'user-unknown-1', role: 'user', content: 'Hello from unknown' }],
    ]);
  });

  it('keeps repeated regenerate retries with the same messageId idempotent', async () => {
    const receivedMessages: Array<Array<{ id: string; role: string; content: string }>> = [];

    mockedCreateProvider.mockResolvedValue({
      name: 'test-provider',
      async *chat(params) {
        receivedMessages.push(
          params.messages.map((message) => ({
            id: message.id,
            role: message.role,
            content: message.content,
          }))
        );
        yield receivedMessages.length === 1 ? 'First reply' : 'Retried reply';
      },
      async chatSync() {
        return '';
      },
    });

    const { handleChat } = createChatHandler({
      provider: { type: 'claude', apiKey: 'test-key' },
      systemPrompt: 'Test',
      cors: '*',
    });

    for await (const _chunk of handleChat({
      conversationId: 'conv-retry-regen',
      message: 'Retry message',
      messageId: 'user-retry-1',
      regenerate: true,
    })) {
      // Drain first turn.
    }

    for await (const _chunk of handleChat({
      conversationId: 'conv-retry-regen',
      message: 'Retry message',
      messageId: 'user-retry-1',
      regenerate: true,
    })) {
      // Drain retry turn.
    }

    expect(receivedMessages).toEqual([
      [{ id: 'user-retry-1', role: 'user', content: 'Retry message' }],
      [{ id: 'user-retry-1', role: 'user', content: 'Retry message' }],
    ]);
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

  it('accepts regenerate metadata', () => {
    const result = chatRequestSchema.safeParse({
      conversationId: 'conv-1',
      message: 'Hello',
      messageId: 'msg-1',
      regenerate: true,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.messageId).toBe('msg-1');
      expect(result.data.regenerate).toBe(true);
    }
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

  it('limits how many pre-chat fields a request can carry, and how long their names are', () => {
    const fields = (count: number) => Object.fromEntries(Array.from({ length: count }, (_, i) => [`field${i}`, 'x']));
    const parse = (userData: Record<string, string>) =>
      chatRequestSchema.safeParse({ conversationId: 'conv-1', message: 'Hello', userData }).success;

    expect(parse(fields(50))).toBe(true);
    expect(parse(fields(51))).toBe(false);
    expect(parse({ ['k'.repeat(100)]: 'x' })).toBe(true);
    expect(parse({ ['k'.repeat(101)]: 'x' })).toBe(false);
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
      expect(result.data.regenerate).toBeUndefined();
    }
  });
});
