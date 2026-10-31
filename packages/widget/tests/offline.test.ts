import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Widget } from '../src/widget.js';
import { mockChatStream } from './helpers/stream.js';

type Internals = {
  shadow: ShadowRoot;
  messages: Array<{ id: string; role: string; content: string; status?: string; errorType?: string }>;
  isStreaming: boolean;
};
const internals = (widget: Widget) => widget as unknown as Internals;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const chat = (w: Widget) => internals(w).messages.filter((m) => m.id !== 'welcome');
const shadow = (w: Widget) => internals(w).shadow;
const waitingNotes = (w: Widget) => [...shadow(w).querySelectorAll('.cc-message-waiting')].map((el) => el.textContent);
const part = (delta: string) => `data: ${JSON.stringify({ type: 'text-delta', id: 't', delta })}\n\n`;
const start = (messageId: string) => `data: ${JSON.stringify({ type: 'start', protocol: 1, conversationId: 'c', messageId })}\n\n`;
const finish = 'data: {"type":"finish","reason":"stop"}\n\ndata: [DONE]\n\n';

let online = true;
const goOffline = () => {
  online = false;
};
const goOnline = () => {
  online = true;
  window.dispatchEvent(new Event('online'));
};

let widget: Widget;
const begin = (config: Partial<ConstructorParameters<typeof Widget>[0]> = {}) => {
  widget = new Widget({ apiUrl: '/chat', ...config });
  widget.init();
  widget.open();
  return widget;
};
const type = (text: string) => {
  const box = shadow(widget).querySelector('.cc-input') as HTMLTextAreaElement;
  box.value = text;
  box.dispatchEvent(new Event('input', { bubbles: true }));
  (shadow(widget).querySelector('.cc-send-btn') as HTMLButtonElement).click();
};
const answer = (stream: ReturnType<typeof mockChatStream>, id: string, text: string) => {
  stream.send(start(id));
  stream.send(part(text));
  stream.send(finish);
  stream.close();
};

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  sessionStorage.clear();
  online = true;
  vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online);
});
afterEach(() => {
  widget?.destroy();
  vi.restoreAllMocks();
});

describe('a message sent while offline', () => {
  it('is shown as waiting and not sent', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    begin();
    goOffline();
    type('Are you there?');
    await tick();

    expect(fetch).not.toHaveBeenCalled();
    expect(shadow(widget).textContent).toContain('Are you there?');
    expect(waitingNotes(widget)).toEqual(["Will send when you're back online"]);
    expect(internals(widget).isStreaming).toBe(false);
    expect((shadow(widget).querySelector('.cc-input') as HTMLTextAreaElement).disabled).toBe(false);
  });

  it('is announced through the reply live region', async () => {
    begin();
    goOffline();
    type('Are you there?');
    const live = shadow(widget).querySelector('.cc-reply-announcement');
    expect(live?.textContent).toBe("Will send when you're back online");
    expect(live?.getAttribute('aria-live')).toBe('polite');
  });

  it('uses the wording of the locale, and English where it has none', async () => {
    begin({ strings: { messageWaiting: 'Wird gesendet, sobald du online bist' } });
    goOffline();
    type('Hallo');
    expect(waitingNotes(widget)).toEqual(['Wird gesendet, sobald du online bist']);
  });

  it('is sent, once, when the connection is back, and the note goes', async () => {
    const onMessage = vi.fn();
    begin({ onMessage });
    goOffline();
    type('Are you there?');
    await tick();
    expect(onMessage).not.toHaveBeenCalled();

    const stream = mockChatStream();
    goOnline();
    await tick();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))).toMatchObject({ message: 'Are you there?' });
    expect(waitingNotes(widget)).toEqual([]);
    answer(stream, 'srv-1', 'Yes, I am.');
    await tick();
    await tick();

    expect(chat(widget).map((m) => m.content)).toEqual(['Are you there?', 'Yes, I am.']);
    expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({ role: 'user', content: 'Are you there?' }));
    goOnline();
    await tick();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('is not kept in storage while it waits', async () => {
    begin({ siteId: 'offline-test' });
    goOffline();
    type('A secret question');
    await tick();
    const stored = JSON.stringify({ ...localStorage, ...sessionStorage });
    expect(stored).not.toContain('A secret question');
  });

  it('leaves messages sent while online alone', async () => {
    begin();
    const stream = mockChatStream();
    type('Online question');
    await tick();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(waitingNotes(widget)).toEqual([]);
    answer(stream, 'srv-1', 'Answer');
    await tick();
    goOnline();
    await tick();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('several messages waiting', () => {
  it('go in order, one at a time', async () => {
    begin();
    goOffline();
    type('First');
    type('Second');
    await tick();
    expect(waitingNotes(widget)).toHaveLength(2);

    const first = mockChatStream();
    goOnline();
    await tick();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body)).message).toBe('First');
    expect(internals(widget).isStreaming).toBe(true);

    const second = mockChatStream();
    answer(first, 'srv-1', 'Reply one');
    await tick();
    await tick();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body)).message).toBe('Second');
    answer(second, 'srv-2', 'Reply two');
    await tick();
    await tick();

    expect(chat(widget).map((m) => m.content)).toEqual(['First', 'Reply one', 'Second', 'Reply two']);
    expect(waitingNotes(widget)).toEqual([]);
  });

  it('keep going after one fails, which gets the normal error and Retry', async () => {
    begin();
    goOffline();
    type('First');
    type('Second');
    await tick();

    const first = mockChatStream();
    const second = mockChatStream();
    goOnline();
    await tick();
    first.fail();
    await tick();
    await tick();
    answer(second, 'srv-2', 'Reply two');
    await tick();
    await tick();

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(shadow(widget).querySelector('.cc-message-retry')).not.toBeNull();
    expect(chat(widget).map((m) => m.content)).toContain('Reply two');
    expect(chat(widget).some((m) => m.status === 'error')).toBe(true);
  });

  it('stop and wait again if the connection drops during the send', async () => {
    begin();
    goOffline();
    type('First');
    type('Second');
    await tick();

    const first = mockChatStream();
    goOnline();
    await tick();
    goOffline();
    answer(first, 'srv-1', 'Reply one');
    await tick();
    await tick();

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(waitingNotes(widget)).toHaveLength(1);

    const second = mockChatStream();
    goOnline();
    await tick();
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body)).message).toBe('Second');
    answer(second, 'srv-2', 'Reply two');
    await tick();
    await tick();
    expect(chat(widget).map((m) => m.content)).toEqual(['First', 'Reply one', 'Second', 'Reply two']);
  });
});

describe('cleaning up', () => {
  it('listens for online while the widget exists, and removes the listener in destroy()', async () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    begin();
    const listener = add.mock.calls.find(([type]) => type === 'online')?.[1];
    expect(listener).toBeDefined();

    goOffline();
    type('Waiting');
    await tick();
    widget.destroy();
    expect(remove).toHaveBeenCalledWith('online', listener);

    const fetch = vi.spyOn(globalThis, 'fetch');
    goOnline();
    await tick();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('drops waiting messages when the conversation starts over', async () => {
    begin();
    goOffline();
    type('Old question');
    await tick();
    widget.newConversation();
    await tick();
    expect(waitingNotes(widget)).toEqual([]);

    const fetch = vi.spyOn(globalThis, 'fetch');
    goOnline();
    await tick();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does nothing when the connection comes back and nothing is waiting', async () => {
    begin();
    const fetch = vi.spyOn(globalThis, 'fetch');
    goOnline();
    await tick();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('sendMessage() while offline', () => {
  it('resolves without waiting for the reply, and the message waits like a typed one', async () => {
    begin();
    goOffline();
    await expect(widget.sendMessage('From the page')).resolves.toBeUndefined();
    expect(waitingNotes(widget)).toHaveLength(1);
  });
});
