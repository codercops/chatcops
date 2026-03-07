import { describe, it, expect, vi, afterEach } from 'vitest';
import { chatRequestSchema } from '../src/config.js';
import { createChatHandler } from '../src/handler.js';

describe('createChatHandler', () => {
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
