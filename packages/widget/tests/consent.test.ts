import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLoader, type PanelModule } from '../src/loader/loader.js';
import { configFromScript } from '../src/script-config.js';
import ChatCops from '../src/index.js';
import { Widget, type WidgetConfig } from '../src/widget.js';

const API = 'https://api.test/chat';
const CONVERSATION_KEY = 'chatcops_conversation';
const SESSION_KEY = `chatcops-session:${API}`;
const BUBBLE_KEY = 'chatcops_bubble_shown';

type Internals = { shadow: ShadowRoot; messages: Array<{ id: string; content: string }> };
const shadowOf = (widget: Widget) => (widget as unknown as Internals).shadow;
const messagesOf = (widget: Widget) => (widget as unknown as Internals).messages;
const noticeOf = (widget: Widget) => shadowOf(widget).querySelector('.cc-consent');
const buttonOf = (widget: Widget) => shadowOf(widget).querySelector<HTMLButtonElement>('.cc-consent-btn');
const panelOf = (widget: Widget) => shadowOf(widget).querySelector('.cc-panel') as HTMLElement;
const inputOf = (widget: Widget) => shadowOf(widget).querySelector('.cc-input') as HTMLTextAreaElement;

/** Wraps both storages so every call is counted (`get chatcops_x`, `set ...`, `remove ...`), then passes through. */
function spyOnStorage() {
  const calls: string[] = [];
  const wrap = (target: Storage) => ({
    getItem(key: string) {
      calls.push(`get ${key}`);
      return target.getItem(key);
    },
    setItem(key: string, value: string) {
      calls.push(`set ${key}`);
      target.setItem(key, value);
    },
    removeItem(key: string) {
      calls.push(`remove ${key}`);
      target.removeItem(key);
    },
  });
  const local = localStorage;
  const session = sessionStorage;
  vi.stubGlobal('localStorage', wrap(local));
  vi.stubGlobal('sessionStorage', wrap(session));
  return calls;
}

const savedConversation = JSON.stringify({
  id: 'conv-1',
  messages: [{ id: 'm1', role: 'user', content: 'Earlier question', timestamp: Date.now() }],
  updatedAt: Date.now(),
});

let widget: Widget | undefined;
const start = (config: Partial<WidgetConfig> = {}): Widget => {
  const created = new Widget({ apiUrl: API, waitForConsent: true, ...config });
  created.init();
  widget = created;
  return created;
};

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  widget?.destroy();
  widget = undefined;
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('waiting for consent', () => {
  it('touches no storage and calls no API while the chat is set up, opened and used', async () => {
    const calls = spyOnStorage();
    const fetch = vi.spyOn(globalThis, 'fetch');
    const w = start({ welcomeBubble: { text: 'Need help?', delay: 0 }, autoOpen: true, persistence: 'session' });

    w.open();
    await w.sendMessage('Hello');
    await w.sendMessage('Hello again', { open: false });
    w.newConversation();
    w.clear();
    w.setUser({ name: 'Ada', email: 'ada@example.com', token: 'jwt' });
    w.setUser(null);
    w.setConsent(false);
    w.close();

    expect(calls).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('touches no storage in an inline chat, which is on screen from the start', () => {
    const calls = spyOnStorage();
    const box = document.createElement('div');
    box.id = 'box';
    document.body.appendChild(box);
    const w = start({ mode: 'inline', container: '#box' });

    expect(calls).toEqual([]);
    expect(noticeOf(w)?.textContent).toContain('Chat is available once you accept functional cookies.');
  });

  it('does not show the welcome bubble', async () => {
    vi.useFakeTimers();
    const calls = spyOnStorage();
    const w = start({ welcomeBubble: { text: 'Need help?', delay: 1000 } });
    await vi.advanceTimersByTimeAsync(5000);

    expect(shadowOf(w).querySelector('.cc-bubble')).toBeNull();
    expect(calls).toEqual([]);
  });

  it('shows the notice with a button instead of the conversation when the chat opens', () => {
    const onConsentRequest = vi.fn();
    const w = start({ onConsentRequest });
    w.open();

    expect(noticeOf(w)?.firstChild?.textContent).toBe('Chat is available once you accept functional cookies.');
    expect(buttonOf(w)?.textContent).toBe('Cookie settings');
    expect(messagesOf(w)).toEqual([]);
    expect(shadowOf(w).querySelector('.cc-message')).toBeNull();
    expect(inputOf(w).closest('.cc-hidden')).not.toBeNull();
  });

  it('calls onConsentRequest from the button', () => {
    const onConsentRequest = vi.fn();
    const w = start({ onConsentRequest });
    w.open();
    expect(onConsentRequest).not.toHaveBeenCalled();

    buttonOf(w)?.click();
    expect(onConsentRequest).toHaveBeenCalledTimes(1);
  });

  it('leaves the button out without onConsentRequest', () => {
    const w = start();
    w.open();
    expect(noticeOf(w)).not.toBeNull();
    expect(buttonOf(w)).toBeNull();
  });

  it('uses the site’s own wording for the notice and the button', () => {
    const w = start({
      onConsentRequest: () => undefined,
      strings: { consentNotice: 'Accept cookies to chat.', consentButton: 'Open the banner' },
    });
    w.open();
    expect(noticeOf(w)?.textContent).toBe('Accept cookies to chat.Open the banner');
  });

  it('shows the notice once however often the chat is opened', () => {
    const w = start({ onConsentRequest: () => undefined });
    w.open();
    w.close();
    w.open();
    expect(shadowOf(w).querySelectorAll('.cc-consent')).toHaveLength(1);
  });

  it('puts the notice in the tab order', () => {
    const w = start({ onConsentRequest: () => undefined });
    w.open();
    expect(buttonOf(w)?.tabIndex).toBe(0);
    expect(buttonOf(w)?.disabled).toBe(false);
  });

  it('leaves a site without waitForConsent as it was', () => {
    localStorage.setItem(CONVERSATION_KEY, savedConversation);
    const w = start({ waitForConsent: undefined });
    w.open();

    expect(noticeOf(w)).toBeNull();
    expect(messagesOf(w).some((m) => m.content === 'Earlier question')).toBe(true);
  });
});

describe('setConsent(true)', () => {
  it('turns the notice into the normal chat, with the saved conversation', () => {
    localStorage.setItem(CONVERSATION_KEY, savedConversation);
    const calls = spyOnStorage();
    const w = start({ onConsentRequest: () => undefined });
    w.open();
    expect(calls).toEqual([]);

    w.setConsent(true);
    expect(noticeOf(w)).toBeNull();
    expect(calls).toContain(`get ${CONVERSATION_KEY}`);
    expect(messagesOf(w).some((m) => m.content === 'Earlier question')).toBe(true);
    expect(panelOf(w).classList.contains('cc-visible')).toBe(true);
  });

  it('shows the welcome message when nothing was saved', () => {
    const w = start();
    w.open();
    w.setConsent(true);
    expect(messagesOf(w).map((m) => m.id)).toEqual(['welcome']);
  });

  it('does not open a chat that is closed, and opens it normally afterwards', () => {
    const calls = spyOnStorage();
    const w = start();
    w.setConsent(true);

    expect(panelOf(w).classList.contains('cc-visible')).toBe(false);
    expect(calls).toEqual([]);
    w.open();
    expect(calls).toContain(`get ${CONVERSATION_KEY}`);
    expect(noticeOf(w)).toBeNull();
  });

  it('lets a message be sent, and saves the conversation', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 500 }));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const w = start();
    w.open();
    w.setConsent(true);

    await w.sendMessage('Hello');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(CONVERSATION_KEY)).toContain('Hello');
  });

  it('starts an inline chat that was waiting', () => {
    localStorage.setItem(CONVERSATION_KEY, savedConversation);
    const box = document.createElement('div');
    box.id = 'box';
    document.body.appendChild(box);
    const w = start({ mode: 'inline', container: '#box' });
    expect(noticeOf(w)).not.toBeNull();

    w.setConsent(true);
    expect(noticeOf(w)).toBeNull();
    expect(messagesOf(w).some((m) => m.content === 'Earlier question')).toBe(true);
  });

  it('starts the welcome bubble that was held back', async () => {
    vi.useFakeTimers();
    const w = start({ welcomeBubble: { text: 'Need help?', delay: 1000 } });
    await vi.advanceTimersByTimeAsync(2000);
    w.setConsent(true);
    await vi.advanceTimersByTimeAsync(1000);

    expect(shadowOf(w).querySelector('.cc-bubble')).not.toBeNull();
    expect(localStorage.getItem(BUBBLE_KEY)).toBe('1');
  });

  it('works before init()', () => {
    localStorage.setItem(CONVERSATION_KEY, savedConversation);
    const created = new Widget({ apiUrl: API, waitForConsent: true });
    created.setConsent(true);
    created.init();
    widget = created;
    created.open();

    expect(noticeOf(created)).toBeNull();
    expect(messagesOf(created).some((m) => m.content === 'Earlier question')).toBe(true);
  });

  it('is harmless when called twice, or when the site never waited', () => {
    const calls = spyOnStorage();
    const w = start({ waitForConsent: false });
    w.setConsent(true);
    w.setConsent(true);
    expect(calls).toEqual([]);
  });
});

describe('setConsent(false)', () => {
  it('closes the chat and removes the conversation, the session token and the bubble flag', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 500 }));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onClose = vi.fn();
    const w = start({ waitForConsent: false, onClose, welcomeBubble: { text: 'Hi', delay: 0 } });
    w.open();
    await w.sendMessage('Hello');
    localStorage.setItem(SESSION_KEY, JSON.stringify({ token: 'secret', conversationId: 'c' }));
    localStorage.setItem(BUBBLE_KEY, '1');
    expect(localStorage.getItem(CONVERSATION_KEY)).toContain('Hello');

    w.setConsent(false);
    expect(panelOf(w).classList.contains('cc-visible')).toBe(false);
    expect(onClose).toHaveBeenCalled();
    expect(localStorage.getItem(CONVERSATION_KEY)).toBeNull();
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();
    expect(localStorage.getItem(BUBBLE_KEY)).toBeNull();
    expect(messagesOf(w)).toEqual([]);
  });

  it('removes what a session store kept, too', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 500 }));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const w = start({ waitForConsent: false, persistence: 'session' });
    await w.sendMessage('Hello');
    sessionStorage.setItem(SESSION_KEY, 'token');

    w.setConsent(false);
    expect(sessionStorage.getItem(CONVERSATION_KEY)).toBeNull();
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it('shows the notice again on the next open, and then touches no storage', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 500 }));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const w = start({ waitForConsent: false, onConsentRequest: () => undefined });
    w.open();
    await w.sendMessage('Hello').catch(() => undefined);
    w.setConsent(false);

    const calls = spyOnStorage();
    const fetch = vi.mocked(globalThis.fetch);
    fetch.mockClear();
    w.open();
    expect(noticeOf(w)).not.toBeNull();
    expect(buttonOf(w)).not.toBeNull();
    expect(shadowOf(w).querySelector('.cc-message')).toBeNull();
    await w.sendMessage('Still there?');
    expect(calls).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('can be given again: the chat comes back, and starts a new conversation', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 500 }));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const w = start({ waitForConsent: false });
    w.open();
    await w.sendMessage('Before');
    w.setConsent(false);
    w.open();
    w.setConsent(true);

    expect(noticeOf(w)).toBeNull();
    expect(messagesOf(w).map((m) => m.id)).toEqual(['welcome']);
  });

  it('stops a reply that is still coming', async () => {
    let signal: AbortSignal | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, options) => {
      signal = options?.signal ?? undefined;
      return new Promise<Response>(() => undefined);
    });
    const w = start({ waitForConsent: false });
    void w.sendMessage('Hello');
    await Promise.resolve();
    expect(signal?.aborted).toBe(false);

    w.setConsent(false);
    expect(signal?.aborted).toBe(true);
  });

  it('puts an inline chat back to the notice', () => {
    const box = document.createElement('div');
    box.id = 'box';
    document.body.appendChild(box);
    const w = start({ waitForConsent: false, mode: 'inline', container: '#box' });
    expect(noticeOf(w)).toBeNull();

    w.setConsent(false);
    expect(noticeOf(w)).not.toBeNull();
    expect(messagesOf(w)).toEqual([]);
  });

  it('makes a site that never set waitForConsent wait', () => {
    const w = start({ waitForConsent: undefined });
    w.setConsent(false);
    w.open();
    expect(noticeOf(w)).not.toBeNull();
  });
});

describe('the script tag loader', () => {
  const widgetPanel = (): Promise<PanelModule> => Promise.resolve({ Widget });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const host = () => document.querySelector('#chatcops-root') as HTMLElement;
  const noticeInHost = () => host()?.shadowRoot?.querySelector('.cc-consent') ?? null;

  it('waits for consent, then opens the normal chat when setConsent(true) comes after init()', async () => {
    const calls = spyOnStorage();
    const loader = createLoader(widgetPanel);
    loader.init({ apiUrl: API, waitForConsent: true, onConsentRequest: () => undefined });
    loader.open();
    await settle();
    expect(noticeInHost()).not.toBeNull();
    expect(calls).toEqual([]);

    loader.setConsent(true);
    expect(noticeInHost()).toBeNull();
    expect(calls).toContain(`get ${CONVERSATION_KEY}`);
    loader.destroy();
  });

  it('keeps setConsent(true) from before init() and before the chat loads', async () => {
    const loader = createLoader(widgetPanel);
    loader.setConsent(true);
    loader.init({ apiUrl: API, waitForConsent: true });
    loader.open();
    await settle();

    expect(noticeInHost()).toBeNull();
    loader.destroy();
  });

  it('keeps setConsent(true) from before the chat loads, when it comes after init()', async () => {
    const loader = createLoader(widgetPanel);
    loader.init({ apiUrl: API, waitForConsent: true });
    loader.setConsent(true);
    loader.open();
    await settle();

    expect(noticeInHost()).toBeNull();
    loader.destroy();
  });

  it('uses the last answer when setConsent() is called more than once before the chat loads', async () => {
    const loader = createLoader(widgetPanel);
    loader.init({ apiUrl: API, waitForConsent: true });
    loader.setConsent(true);
    loader.setConsent(false);
    loader.open();
    await settle();

    expect(noticeInHost()).not.toBeNull();
    loader.destroy();
  });

  it('removes what the chat saved when consent is withdrawn', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 500 }));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const loader = createLoader(widgetPanel);
    loader.init({ apiUrl: API, waitForConsent: true });
    loader.setConsent(true);
    await loader.sendMessage('Hello');
    expect(localStorage.getItem(CONVERSATION_KEY)).toContain('Hello');

    loader.setConsent(false);
    expect(localStorage.getItem(CONVERSATION_KEY)).toBeNull();
    loader.destroy();
  });

  it('touches no storage and does not call the API from setConsent(false) or the launcher while waiting', async () => {
    const calls = spyOnStorage();
    const fetch = vi.spyOn(globalThis, 'fetch');
    const loader = createLoader(widgetPanel);
    loader.init({ apiUrl: API, waitForConsent: true, welcomeBubble: { text: 'Hi', delay: 0 } });
    loader.setConsent(false);
    await settle();
    await loader.sendMessage('Hello');

    expect(calls).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
    loader.destroy();
  });
});

describe('data-wait-for-consent', () => {
  const script = (data: Record<string, string>) => {
    const el = document.createElement('script');
    Object.assign(el.dataset, { apiUrl: API, ...data });
    return el;
  };

  it.each([
    [{ waitForConsent: '' }, true],
    [{ waitForConsent: 'true' }, true],
    [{ waitForConsent: 'false' }, false],
    [{ waitForConsent: 'flase' }, undefined],
    [{ waitForConsent: 'yes' }, undefined],
    [{}, undefined],
  ])('reads %j as %s', (data, expected) => {
    expect(configFromScript(script(data))?.waitForConsent).toBe(expected);
  });
});

describe('ChatCops.setConsent (npm build and single file)', () => {
  const init = (config: Partial<WidgetConfig> = {}): Widget => {
    widget = ChatCops.init({ apiUrl: API, waitForConsent: true, ...config });
    return widget;
  };

  afterEach(() => {
    ChatCops.destroy();
    ChatCops.setConsent(false);
  });

  it('does nothing without a chat, and does not throw', () => {
    ChatCops.destroy();
    expect(() => ChatCops.setConsent(true)).not.toThrow();
  });

  it('accepts consent after init(), replacing the notice', () => {
    ChatCops.setConsent(false);
    const w = init();
    w.open();
    expect(noticeOf(w)).not.toBeNull();

    ChatCops.setConsent(true);
    expect(noticeOf(w)).toBeNull();
    expect(messagesOf(w).map((m) => m.id)).toEqual(['welcome']);
  });

  it('accepts consent before init(), so the chat starts without the notice', () => {
    ChatCops.setConsent(true);
    const w = init();
    w.open();
    expect(noticeOf(w)).toBeNull();
    expect(messagesOf(w).map((m) => m.id)).toEqual(['welcome']);
  });

  it('keeps a refusal before init(), and touches no storage while waiting', () => {
    const calls = spyOnStorage();
    ChatCops.setConsent(false);
    const w = init();
    w.open();
    expect(noticeOf(w)).not.toBeNull();
    expect(calls).toEqual([]);
  });

  it('uses the last call made before init()', () => {
    ChatCops.setConsent(true);
    ChatCops.setConsent(false);
    const w = init();
    w.open();
    expect(noticeOf(w)).not.toBeNull();
  });

  it('keeps the answer through destroy() and a second init()', () => {
    ChatCops.setConsent(true);
    init();
    ChatCops.destroy();
    const w = init();
    w.open();
    expect(noticeOf(w)).toBeNull();
  });

  it('withdraws consent on a running chat: clears what it saved', () => {
    ChatCops.setConsent(true);
    const w = init();
    w.open();
    localStorage.setItem(CONVERSATION_KEY, savedConversation);
    ChatCops.setConsent(false);
    expect(localStorage.getItem(CONVERSATION_KEY)).toBeNull();
    w.open();
    expect(noticeOf(w)).not.toBeNull();
  });

  it('resolves sendMessage() without sending while consent is missing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    ChatCops.setConsent(false);
    init();
    await expect(ChatCops.sendMessage('hello')).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
