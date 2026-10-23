import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Widget, type WidgetEventType } from '../src/widget.js';
import { mockChatStream } from './helpers/stream.js';
import { ConversationStorage } from '../src/storage.js';

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
  userData?: Record<string, string>;
  showChatView(): void;
  handleSend(text: string): Promise<void>;
  handleRetry(messageId: string): Promise<void>;
  handleRegenerate(messageId: string): Promise<void>;
  handlePreChatSubmit(data: Record<string, string>): void;
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

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('moves to the conversation id the server gives with a session token, and saves history under it', async () => {
    const reply = [
      'data: {"type":"start","protocol":1,"conversationId":"server-id","messageId":"m1"}',
      'data: {"type":"text-delta","id":"t1","delta":"Hello"}',
      'data: {"type":"finish","reason":"stop"}',
      'data: [DONE]',
      '',
    ].join('\n\n');
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('{"error":{"code":"session_required"}}', { status: 401 }))
      .mockResolvedValueOnce(new Response('{"token":"tok","conversationId":"server-id","expiresAt":0}', { status: 200 }))
      .mockResolvedValueOnce(new Response(reply, { status: 200 }))
      .mockResolvedValueOnce(new Response(reply, { status: 200 }));
    const widget = new Widget({ apiUrl: 'https://api.test/chat' });
    widget.init();

    await getInternals(widget).handleSend('Hi');
    await getInternals(widget).handleSend('Again');

    expect(JSON.parse(String(fetch.mock.calls[3][1]?.body)).conversationId).toBe('server-id');
    expect(JSON.parse(localStorage.getItem('chatcops_conversation') ?? '{}').id).toBe('server-id');
    widget.destroy();
  });

  it('does not open after destroy when auto-open is delayed', () => {
    vi.useFakeTimers();
    const onOpen = vi.fn();
    const widget = new Widget({ apiUrl: 'https://api.test/chat', autoOpen: 100, onOpen });
    widget.init();
    widget.destroy();
    vi.advanceTimersByTime(100);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it.each(['bottom-right', 'bottom-left'] as const)(
    'restores the %s launcher state after closing from the panel header',
    (position) => {
      const onOpen = vi.fn();
      const onClose = vi.fn();
      const widget = new Widget({
        apiUrl: 'https://api.test/chat',
        theme: { position },
        onOpen,
        onClose,
      });
      widget.init();

      const root = getInternals(widget).shadow;
      const launcher = root.querySelector('.cc-fab') as HTMLButtonElement;
      const panel = root.querySelector('.cc-panel') as HTMLElement;
      const headerClose = root.querySelector('.cc-header-close') as HTMLButtonElement;

      launcher.click();
      expect(launcher.classList.contains('cc-open')).toBe(true);
      expect(panel.classList.contains('cc-visible')).toBe(true);

      headerClose.click();
      expect(launcher.classList.contains('cc-open')).toBe(false);
      expect(launcher.getAttribute('aria-label')).toBe('Open chat');
      expect(panel.classList.contains('cc-visible')).toBe(false);
      expect(onClose).toHaveBeenCalledOnce();

      launcher.click();
      expect(launcher.classList.contains('cc-open')).toBe(true);
      expect(panel.classList.contains('cc-visible')).toBe(true);
      expect(onOpen).toHaveBeenCalledTimes(2);
      widget.destroy();
    }
  );

  it('closes the popup on Escape and moves focus back to the FAB', () => {
    const widget = new Widget({ apiUrl: 'https://api.test/chat' });
    widget.init();

    const root = getInternals(widget).shadow;
    const launcher = root.querySelector('.cc-fab') as HTMLButtonElement;
    launcher.click();
    const textarea = root.querySelector('.cc-panel textarea') as HTMLElement;
    expect(root.activeElement).toBe(textarea);

    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(root.querySelector('.cc-panel')?.classList.contains('cc-visible')).toBe(false);
    expect(launcher.getAttribute('aria-expanded')).toBe('false');
    expect(root.activeElement).toBe(launcher);

    widget.destroy();
  });

  it('keeps the welcome bubble inert and hidden from screen readers until it shows', () => {
    vi.useFakeTimers();
    const widget = new Widget({ apiUrl: 'https://api.test/chat', welcomeBubble: { text: 'Hi there', delay: 1000 } });
    widget.init();

    const bubble = getInternals(widget).shadow.querySelector('.cc-bubble') as HTMLElement;
    expect(bubble.hasAttribute('inert')).toBe(true);
    expect(bubble.getAttribute('aria-hidden')).toBe('true');

    vi.advanceTimersByTime(1000);
    expect(bubble.hasAttribute('inert')).toBe(false);
    expect(bubble.hasAttribute('aria-hidden')).toBe(false);

    widget.open();
    expect(bubble.hasAttribute('inert')).toBe(true);
    expect(bubble.getAttribute('aria-hidden')).toBe('true');

    widget.destroy();
  });

  it('strings: { closeButton } overrides the close aria-label on both the panel header and the FAB', () => {
    const widget = new Widget({
      apiUrl: 'https://api.test/chat',
      strings: { closeButton: 'Cerrar' },
    });
    widget.init();

    const root = getInternals(widget).shadow;
    const headerClose = root.querySelector('.cc-header-close') as HTMLButtonElement;
    const launcher = root.querySelector('.cc-fab') as HTMLButtonElement;

    expect(headerClose.getAttribute('aria-label')).toBe('Cerrar');

    launcher.click();
    expect(launcher.getAttribute('aria-label')).toBe('Cerrar');

    widget.destroy();
  });

  it('greeting: no name → shows site welcomeMessage as-is', () => {
    const widget = new Widget({
      apiUrl: 'https://api.test/chat',
      welcomeMessage: 'Welcome to Acme support.',
    });
    widget.init();

    getInternals(widget).showChatView();

    const welcome = getInternals(widget).messages.find((m) => m.id === 'welcome');
    expect(welcome?.content).toBe('Welcome to Acme support.');

    widget.destroy();
  });

  it('greeting: name + default locale → uses locale welcomeMessage', () => {
    const widget = new Widget({ apiUrl: 'https://api.test/chat' });
    widget.init();

    const internals = getInternals(widget);
    internals.messages.length = 0;
    internals.userData = { name: 'Alex' };
    internals.showChatView();

    const welcome = internals.messages.find((m) => m.id === 'welcome');
    expect(welcome?.content).toBe('Hi Alex! How can I help you today?');

    widget.destroy();
  });

  it('greeting: name + custom site welcomeMessage → site message is preserved', () => {
    const widget = new Widget({
      apiUrl: 'https://api.test/chat',
      welcomeMessage: 'Welcome to Acme support.',
    });
    widget.init();

    const internals = getInternals(widget);
    internals.messages.length = 0;
    internals.userData = { name: 'Alex' };
    internals.showChatView();

    const welcome = internals.messages.find((m) => m.id === 'welcome');
    expect(welcome?.content).toBe('Hi Alex! Welcome to Acme support.');

    widget.destroy();
  });

  it('greeting: dollar-sign patterns in name are not expanded by String.replace', () => {
    const widget = new Widget({ apiUrl: 'https://api.test/chat' });
    widget.init();

    const internals = getInternals(widget);
    internals.messages.length = 0;
    internals.userData = { name: 'A$&B' };
    internals.showChatView();

    const welcome = internals.messages.find((m) => m.id === 'welcome');
    expect(welcome?.content).toBe('Hi A$&B! How can I help you today?');

    widget.destroy();
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

  it('marks streamed assistant replies as ai generated, but not user or welcome messages', async () => {
    const widget = new Widget({ apiUrl: 'https://api.test/chat' });
    widget.init();
    getInternals(widget).showChatView();
    let streamingBubble: HTMLElement | null = null;
    getInternals(widget).client.sendMessage = vi.fn().mockImplementationOnce(async function* () {
      yield { content: 'Hel' };
      streamingBubble = getInternals(widget).shadow.querySelector('.cc-message-assistant[data-status="streaming"]');
      yield { content: 'lo' };
      yield { done: true };
    });

    await getInternals(widget).handleSend('Hi');

    const shadow = getInternals(widget).shadow;
    expect(streamingBubble?.dataset.aiGenerated).toBe('true');
    expect((shadow.querySelector('.cc-message-user') as HTMLElement).dataset.aiGenerated).toBeUndefined();
    const assistant = Array.from(shadow.querySelectorAll<HTMLElement>('.cc-message-assistant'));
    const welcome = assistant.find((el) => el.dataset.id === 'welcome');
    expect(welcome).toBeDefined();
    expect(welcome?.dataset.aiGenerated).toBeUndefined();
    expect(assistant.at(-1)?.dataset.aiGenerated).toBe('true');
  });

  it('keeps the ai generated mark on failed, retried and regenerated replies', async () => {
    const widget = new Widget({ apiUrl: 'https://api.test/chat' });
    widget.init();
    getInternals(widget).client.sendMessage = vi.fn()
      .mockImplementationOnce(async function* () {
        yield { error: 'provider_error' };
      })
      .mockImplementationOnce(async function* () {
        yield { content: 'Recovered' };
        yield { done: true };
      })
      .mockImplementationOnce(async function* () {
        yield { content: 'Again' };
        yield { done: true };
      });
    const lastBubble = () => {
      const bubble = Array.from(getInternals(widget).shadow.querySelectorAll<HTMLElement>('.cc-message-assistant')).at(-1);
      if (!bubble) throw new Error('no assistant bubble');
      return bubble;
    };
    const lastMessageId = () => {
      const id = getInternals(widget).messages.at(-1)?.id;
      if (!id) throw new Error('no message');
      return id;
    };

    await getInternals(widget).handleSend('Hi');
    expect(lastBubble().dataset.status).toBe('error');
    expect(lastBubble().dataset.aiGenerated).toBe('true');

    await getInternals(widget).handleRetry(lastMessageId());
    expect(lastBubble().textContent).toContain('Recovered');
    expect(lastBubble().dataset.aiGenerated).toBe('true');

    await getInternals(widget).handleRegenerate(lastMessageId());
    expect(lastBubble().textContent).toContain('Again');
    expect(lastBubble().dataset.aiGenerated).toBe('true');
  });

  it('keeps streamed text when an error arrives partway through and shows the error under it', async () => {
    const widget = new Widget({ apiUrl: 'https://api.test/chat' });
    widget.init();
    getInternals(widget).client.sendMessage = vi.fn().mockImplementationOnce(async function* () {
      yield { content: 'Here is the first half' };
      yield { content: ' of the answer' };
      yield { error: 'provider_error' };
    });

    await getInternals(widget).handleSend('Tell me everything');

    const failed = getInternals(widget).messages.at(-1)!;
    expect(failed).toMatchObject({ role: 'assistant', status: 'error', content: 'Here is the first half of the answer' });
    const bubbles = getInternals(widget).shadow.querySelectorAll('.cc-message-assistant');
    const bubble = bubbles[bubbles.length - 1];
    expect(bubble.querySelector('.cc-message-content')?.textContent).toContain('Here is the first half of the answer');
    expect(bubble.querySelector('.cc-message-error-note')?.textContent).toBeTruthy();
    expect(bubble.querySelector('.cc-message-retry')).toBeTruthy();
  });

  it('shows the error as the content when nothing streamed before it', async () => {
    const widget = new Widget({ apiUrl: 'https://api.test/chat' });
    widget.init();
    getInternals(widget).client.sendMessage = vi.fn().mockImplementationOnce(async function* () {
      yield { error: 'provider_error' };
    });

    await getInternals(widget).handleSend('Hi');

    const bubbles = getInternals(widget).shadow.querySelectorAll('.cc-message-assistant');
    const bubble = bubbles[bubbles.length - 1];
    expect(bubble.querySelector('.cc-message-content')?.textContent?.trim()).toBeTruthy();
    expect(bubble.querySelector('.cc-message-error-note')).toBeNull();
  });

  it('does not duplicate the bubble when the stream throws after some text', async () => {
    const widget = new Widget({ apiUrl: 'https://api.test/chat' });
    widget.init();
    getInternals(widget).client.sendMessage = vi.fn().mockImplementationOnce(async function* () {
      yield { content: 'Partial' };
      throw new Error('socket closed');
    });

    await getInternals(widget).handleSend('Hi');

    const ids = Array.from(getInternals(widget).shadow.querySelectorAll('.cc-message-assistant'))
      .map((el) => (el as HTMLElement).dataset.id);
    expect(new Set(ids).size).toBe(ids.length);
    const last = getInternals(widget).messages.at(-1)!;
    expect(last).toMatchObject({ status: 'error', content: 'Partial', errorType: 'network' });
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

  it("keeps the server's id for a v1 reply and regenerates it by that id", async () => {
    const widget = new Widget({ apiUrl: 'https://api.test/chat' });
    widget.init();
    const sendMessage = vi.fn()
      .mockImplementationOnce(async function* () {
        yield { messageId: 'srv-1' };
        yield { content: 'First' };
        yield { done: true };
      })
      .mockImplementationOnce(async function* () {
        yield { messageId: 'srv-2' };
        yield { content: 'Second' };
        yield { done: true };
      });
    getInternals(widget).client.sendMessage = sendMessage;

    await getInternals(widget).handleSend('Hi');
    const reply = getInternals(widget).messages.at(-1);
    expect(reply?.id).toBe('srv-1');
    expect(getInternals(widget).shadow.querySelector('[data-id="srv-1"]')).toBeTruthy();

    await getInternals(widget).handleRegenerate('srv-1');
    expect(sendMessage.mock.calls[1]?.[0]).toMatchObject({ regenerate: { assistantMessageId: 'srv-1' } });
    expect(getInternals(widget).messages.at(-1)).toMatchObject({ id: 'srv-2', content: 'Second' });
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

  it('keeps saved history and skips late callbacks when destroyed mid-stream', async () => {
    const onMessage = vi.fn();
    const onError = vi.fn();
    const widget = new Widget({
      apiUrl: 'https://api.test/chat',
      onMessage,
      onError,
    });
    widget.init();

    let releaseStream!: () => void;
    const streamGate = new Promise<void>((resolve) => {
      releaseStream = resolve;
    });

    const sendMessage = vi.fn()
      .mockImplementationOnce(async function* () {
        yield { content: 'First reply' };
        yield { done: true };
      })
      .mockImplementationOnce(async function* () {
        yield { content: 'Partial reply' };
        await streamGate;
        yield { content: ' and a late tail' };
        yield { done: true };
      });

    getInternals(widget).client.sendMessage = sendMessage;

    await getInternals(widget).handleSend('First question');
    expect(onMessage).toHaveBeenCalledTimes(2);

    const secondReply = getInternals(widget).handleSend('Second question');

    const messageEvent = vi.fn();
    const errorEvent = vi.fn();
    widget.on('message', messageEvent);
    widget.on('error', errorEvent);

    await vi.waitFor(() => {
      expect(getInternals(widget).shadow.textContent).toContain('Partial reply');
    });

    const secondCallOptions = sendMessage.mock.calls[1]?.[1] as { signal?: AbortSignal };
    const secondSignal = secondCallOptions?.signal;
    const signalAbortedBeforeDestroy = secondSignal?.aborted;
    const callsAtDestroy = onMessage.mock.calls.length;

    widget.destroy();

    releaseStream();
    await secondReply;

    expect(onMessage).toHaveBeenCalledTimes(callsAtDestroy);
    expect(onMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('late tail') })
    );
    expect(messageEvent).not.toHaveBeenCalled();
    expect(errorEvent).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();

    const raw = localStorage.getItem('chatcops_conversation');
    expect(raw).toBeTruthy();
    const stored = JSON.parse(raw!);
    expect(stored.messages).toHaveLength(2);
    expect(stored.messages[0]).toMatchObject({ role: 'user', content: 'First question' });
    expect(stored.messages[1]).toMatchObject({ role: 'assistant', content: 'First reply' });
    expect(raw).not.toContain('Second question');
    expect(raw).not.toContain('late tail');

    expect(secondSignal).toBeInstanceOf(AbortSignal);
    expect(signalAbortedBeforeDestroy).toBe(false);
    expect(secondSignal?.aborted).toBe(true);
  });

  it('restores pre-chat userData and greets by name across widget recreation', async () => {
    const config = {
      apiUrl: 'https://api.test/chat',
      preChatForm: {
        enabled: true,
        fields: [{ name: 'name', label: 'Name', type: 'text' as const, required: true }],
      },
    };

    const widget1 = new Widget(config);
    widget1.init();

    getInternals(widget1).handlePreChatSubmit({ name: 'Jordan' });

    const welcome1 = getInternals(widget1).messages.find((m) => m.id === 'welcome');
    expect(welcome1?.content).toBe('Hi Jordan! How can I help you today?');

    widget1.destroy();

    const widget2 = new Widget(config);
    widget2.init();

    expect(getInternals(widget2).shadow.querySelector('.cc-prechat')).toBeNull();
    const welcome2 = getInternals(widget2).messages.find((m) => m.id === 'welcome');
    expect(welcome2?.content).toBe('Hi Jordan! How can I help you today?');

    const sendMessage = vi.fn().mockImplementation(async function* () {
      yield { content: 'Echo' };
      yield { done: true };
    });
    getInternals(widget2).client.sendMessage = sendMessage;

    await getInternals(widget2).handleSend('Hello after recreation');
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0]?.[0]).toMatchObject({
      message: 'Hello after recreation',
      userData: { name: 'Jordan' },
    });

    widget2.destroy();
  });

  it('stops sending userData once a v1 server has answered, since it keeps the answers', async () => {
    const widget = new Widget({
      apiUrl: 'https://api.test/chat',
      preChatForm: { enabled: true, fields: [{ name: 'name', label: 'Name', type: 'text' as const }] },
    });
    widget.init();
    getInternals(widget).handlePreChatSubmit({ name: 'Taylor' });
    const sendMessage = vi.fn().mockImplementation(async function* () {
      yield { messageId: crypto.randomUUID() };
      yield { content: 'Echo' };
      yield { done: true };
    });
    getInternals(widget).client.sendMessage = sendMessage;

    await getInternals(widget).handleSend('First');
    await getInternals(widget).handleSend('Second');
    expect(sendMessage.mock.calls[0]?.[0]).toMatchObject({ userData: { name: 'Taylor' } });
    expect(sendMessage.mock.calls[1]?.[0]).not.toHaveProperty('userData');
  });

  it('sends userData with every request to a 0.5 server, which needs it each time', async () => {
    const widget = new Widget({
      apiUrl: 'https://api.test/chat',
      preChatForm: {
        enabled: true,
        fields: [{ name: 'name', label: 'Name', type: 'text' as const }],
      },
    });
    widget.init();

    getInternals(widget).handlePreChatSubmit({ name: 'Taylor', email: 'taylor@example.com' });

    const sendMessage = vi.fn().mockImplementation(async function* () {
      yield { content: 'Echo' };
      yield { done: true };
    });
    getInternals(widget).client.sendMessage = sendMessage;

    await getInternals(widget).handleSend('First query');
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0]?.[0]).toMatchObject({
      message: 'First query',
      userData: { name: 'Taylor', email: 'taylor@example.com' },
    });

    await getInternals(widget).handleSend('Second query');
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage.mock.calls[1]?.[0]).toMatchObject({
      message: 'Second query',
      userData: { name: 'Taylor', email: 'taylor@example.com' },
    });

    const assistantMessage = getInternals(widget).messages.at(-1);
    expect(assistantMessage?.role).toBe('assistant');
    await getInternals(widget).handleRegenerate(assistantMessage!.id);
    expect(sendMessage).toHaveBeenCalledTimes(3);
    expect(sendMessage.mock.calls[2]?.[0]).toMatchObject({
      message: 'Second query',
      regenerate: true,
      userData: { name: 'Taylor', email: 'taylor@example.com' },
    });

    widget.destroy();
  });

  it('does not store or send form answers when preChatForm is disabled', async () => {
    const storage = new ConversationStorage();
    const sessionId = storage.getSessionId();
    storage.setPreChatCompleted(sessionId, { name: 'IgnoredUser' });

    const widget = new Widget({
      apiUrl: 'https://api.test/chat',
      preChatForm: {
        enabled: false,
        fields: [{ name: 'name', label: 'Name', type: 'text' as const }],
      },
    });
    widget.init();

    expect(getInternals(widget).shadow.querySelector('.cc-prechat')).toBeNull();
    const welcome = getInternals(widget).messages.find((m) => m.id === 'welcome');
    expect(welcome?.content).toBe('How can I help you today?');
    expect(welcome?.content).not.toContain('IgnoredUser');

    const sendMessage = vi.fn().mockImplementation(async function* () {
      yield { content: 'Echo' };
      yield { done: true };
    });
    getInternals(widget).client.sendMessage = sendMessage;

    await getInternals(widget).handleSend('Test without preChat');
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0]?.[0].userData).toBeUndefined();

    widget.destroy();
  });

  it('handles storage failures gracefully during init and pre-chat submit', () => {
    const getItemSpy = vi.spyOn(sessionStorage, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });

    const widget1 = new Widget({
      apiUrl: 'https://api.test/chat',
      preChatForm: {
        enabled: true,
        fields: [{ name: 'name', label: 'Name', type: 'text' as const }],
      },
    });
    expect(() => widget1.init()).not.toThrow();
    widget1.destroy();

    getItemSpy.mockRestore();

    const widget2 = new Widget({
      apiUrl: 'https://api.test/chat',
      preChatForm: {
        enabled: true,
        fields: [{ name: 'name', label: 'Name', type: 'text' as const }],
      },
    });
    widget2.init();

    const setItemSpy = vi.spyOn(sessionStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceeded');
    });
    expect(() => getInternals(widget2).handlePreChatSubmit({ name: 'Morgan' })).not.toThrow();
    const welcome = getInternals(widget2).messages.find((m) => m.id === 'welcome');
    expect(welcome?.content).toBe('Hi Morgan! How can I help you today?');

    widget2.destroy();
    setItemSpy.mockRestore();
  });

  it('does not throw during init when {} is stored and shows the welcome message', () => {
    localStorage.setItem('chatcops_conversation', '{}');
    const widget = new Widget({ apiUrl: 'https://api.test/chat' });

    expect(() => widget.init()).not.toThrow();

    const internals = getInternals(widget);
    const welcome = internals.messages.find((m) => m.id === 'welcome');
    expect(welcome).toBeDefined();
    expect(welcome?.content).toBe('How can I help you today?');
    expect(internals.shadow.querySelector('.cc-message-assistant')?.textContent).toContain('How can I help you today?');
    expect(localStorage.getItem('chatcops_conversation')).toBeNull();

    widget.destroy();
  });
});

describe('Widget streaming timeout configuration', () => {
  let widget: Widget;

  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    sessionStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    widget?.destroy();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each([undefined, 750, 0])('uses the configured timeout (%s) through the real client', async (timeout) => {
    const transport = mockChatStream(false);
    const onError = vi.fn();
    widget = new Widget({ apiUrl: '/chat', timeout, persistHistory: false, onError });
    widget.init();
    const pending = getInternals(widget).handleSend('Hello');
    const interval = timeout ?? 30000;

    if (interval > 0) {
      await vi.advanceTimersByTimeAsync(interval - 1);
      expect(transport.signal.aborted).toBe(false);
    }
    await vi.advanceTimersByTimeAsync(interval === 0 ? 0 : 1);
    await pending;

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'timeout' }));
    expect(getInternals(widget).messages.at(-1)).toMatchObject({ status: 'error', errorType: 'timeout' });
    expect(getInternals(widget).shadow.querySelector<HTMLTextAreaElement>('.cc-input')!.disabled).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('destroy aborts the real stream without late errors or messages', async () => {
    const transport = mockChatStream();
    const onError = vi.fn();
    const onMessage = vi.fn();
    widget = new Widget({ apiUrl: '/chat', timeout: 1000, persistHistory: false, onError, onMessage });
    widget.init();
    const pending = getInternals(widget).handleSend('Hello');
    transport.send('data: {"content":"Partial reply"}\n\n');
    await vi.advanceTimersByTimeAsync(0);
    expect(getInternals(widget).shadow.textContent).toContain('Partial reply');

    widget.destroy();
    await pending;
    await vi.advanceTimersByTimeAsync(2000);

    expect(transport.signal.aborted).toBe(true);
    expect(transport.body.locked).toBe(false);
    expect(onError).not.toHaveBeenCalled();
    expect(onMessage).toHaveBeenCalledOnce(); // Only the original user message.
    expect(document.querySelector('#chatcops-root')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps the partial reply and adds the timeout error under it when an active stream later stalls', async () => {
    const transport = mockChatStream();
    widget = new Widget({ apiUrl: '/chat', timeout: 1000, persistHistory: false });
    widget.init();
    const pending = getInternals(widget).handleSend('Hello');
    transport.send('data: {"content":"Partial reply"}\n\n');
    await vi.advanceTimersByTimeAsync(0);
    expect(getInternals(widget).shadow.textContent).toContain('Partial reply');

    await vi.advanceTimersByTimeAsync(1000);
    await pending;

    const reply = getInternals(widget).messages.at(-1)!;
    expect(reply).toMatchObject({ status: 'error', errorType: 'timeout', content: 'Partial reply' });
    expect(getInternals(widget).shadow.textContent).toContain('Partial reply');
    expect(getInternals(widget).shadow.querySelector('.cc-message-error-note')?.textContent).toBeTruthy();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('returns an unsubscribe function from on() that removes the handler', () => {
    widget = new Widget({ apiUrl: '/chat' });
    const eventType: WidgetEventType = 'open';
    const onOpen = vi.fn();
    const unsub = widget.on(eventType, onOpen);
    widget.init();

    unsub();
    widget.open();

    expect(onOpen).not.toHaveBeenCalled();
  });
});
