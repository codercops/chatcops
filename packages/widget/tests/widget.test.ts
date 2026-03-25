import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Widget } from '../src/widget.js';

type WidgetInternals = {
  client: {
    sendMessage: ReturnType<typeof vi.fn>;
  };
  shadow: ShadowRoot;
  messages: Array<{
    id: string;
    role: 'user' | 'assistant';
    content: string;
    status?: 'streaming' | 'complete' | 'error';
    errorType?: 'rate_limit' | 'network' | 'provider_error' | 'timeout';
  }>;
  isStreaming: boolean;
  handleSend(text: string): Promise<void>;
  handleRetry(messageId: string): Promise<void>;
  handleRegenerate(messageId: string): Promise<void>;
};

function getInternals(widget: Widget): WidgetInternals {
  return widget as unknown as WidgetInternals;
}

describe('Widget', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    sessionStorage.clear();
  });

  it('fires the leadCaptured callback and event when the stream includes lead data', async () => {
    const onLeadCaptured = vi.fn();
    const widget = new Widget({
      apiUrl: 'https://api.test/chat',
      onLeadCaptured,
    });
    widget.init();

    const eventHandler = vi.fn();
    widget.on('leadCaptured', eventHandler);

    const sendMessage = vi.fn(async function* () {
      yield { leadCaptured: true, leadData: { email: 'lead@example.com' } };
      yield { content: 'Thanks, we will follow up soon.' };
      yield { done: true };
    });

    getInternals(widget).client.sendMessage = sendMessage;

    await getInternals(widget).handleSend('Hello');

    expect(onLeadCaptured).toHaveBeenCalledWith({ email: 'lead@example.com' });
    expect(eventHandler).toHaveBeenCalledWith({ email: 'lead@example.com' });
  });

  it('retries a failed message with the same user message id and replaces the error bubble', async () => {
    const widget = new Widget({
      apiUrl: 'https://api.test/chat',
    });
    widget.init();

    const sendMessage = vi.fn()
      .mockImplementationOnce(async function* () {
        yield { error: 'provider_error' };
      })
      .mockImplementationOnce(async function* () {
        yield { content: 'Recovered response' };
        yield { done: true };
      });

    getInternals(widget).client.sendMessage = sendMessage;

    await getInternals(widget).handleSend('Retry me');

    const firstUserMessage = getInternals(widget).messages.find((message) => message.role === 'user');
    const errorMessage = getInternals(widget).messages.find((message) => message.status === 'error');

    expect(firstUserMessage).toBeTruthy();
    expect(errorMessage).toBeTruthy();
    expect(getInternals(widget).shadow.querySelector('.cc-message-retry')).toBeTruthy();

    await getInternals(widget).handleRetry(errorMessage!.id);

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage.mock.calls[0]?.[0]).toMatchObject({
      message: 'Retry me',
      messageId: firstUserMessage?.id,
    });
    expect(sendMessage.mock.calls[1]?.[0]).toMatchObject({
      message: 'Retry me',
      messageId: firstUserMessage?.id,
    });

    expect(getInternals(widget).messages.some((message) => message.id === errorMessage!.id)).toBe(false);
    expect(getInternals(widget).messages.at(-1)).toMatchObject({
      role: 'assistant',
      content: 'Recovered response',
      status: 'complete',
    });
  });

  it('regenerates the last assistant response and sends the regenerate flag', async () => {
    const widget = new Widget({
      apiUrl: 'https://api.test/chat',
    });
    widget.init();

    const sendMessage = vi.fn()
      .mockImplementationOnce(async function* () {
        yield { content: 'First response' };
        yield { done: true };
      })
      .mockImplementationOnce(async function* () {
        yield { content: 'Second response' };
        yield { done: true };
      });

    getInternals(widget).client.sendMessage = sendMessage;

    await getInternals(widget).handleSend('Regenerate me');

    const userMessage = getInternals(widget).messages.find((message) => message.role === 'user');
    const assistantMessage = getInternals(widget).messages.at(-1);

    expect(assistantMessage).toMatchObject({
      role: 'assistant',
      content: 'First response',
      status: 'complete',
    });
    expect(getInternals(widget).shadow.querySelector('.cc-message-regenerate')).toBeTruthy();

    await getInternals(widget).handleRegenerate(assistantMessage!.id);

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage.mock.calls[1]?.[0]).toMatchObject({
      message: 'Regenerate me',
      messageId: userMessage?.id,
      regenerate: true,
    });
    expect(getInternals(widget).messages.some((message) => message.id === assistantMessage!.id)).toBe(false);
    expect(getInternals(widget).messages.at(-1)).toMatchObject({
      role: 'assistant',
      content: 'Second response',
      status: 'complete',
    });
  });

  it('blocks retry and regenerate while streaming is active', async () => {
    const widget = new Widget({
      apiUrl: 'https://api.test/chat',
    });
    widget.init();

    const sendMessage = vi.fn();
    getInternals(widget).client.sendMessage = sendMessage;

    getInternals(widget).messages.push(
      { id: 'user-1', role: 'user', content: 'Hello' },
      { id: 'assistant-1', role: 'assistant', content: 'Answer', status: 'complete' },
      { id: 'assistant-err', role: 'assistant', content: 'Failed', status: 'error', errorType: 'provider_error' }
    );

    getInternals(widget).isStreaming = true;

    await getInternals(widget).handleRetry('assistant-err');
    await getInternals(widget).handleRegenerate('assistant-1');

    expect(sendMessage).not.toHaveBeenCalled();
    expect(getInternals(widget).messages).toHaveLength(4);
  });
});
