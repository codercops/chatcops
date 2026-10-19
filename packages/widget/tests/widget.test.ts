import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Widget } from '../src/widget.js';
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

  it('sends userData with every request, not just the first', async () => {
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

  it('keeps the existing partial-error UI when an active stream later stalls', async () => {
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
    expect(reply).toMatchObject({ status: 'error', errorType: 'timeout' });
    expect(reply.content).not.toContain('Partial reply');
    expect(getInternals(widget).shadow.textContent).not.toContain('Partial reply');
    expect(vi.getTimerCount()).toBe(0);
  });
});
