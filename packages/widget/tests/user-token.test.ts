import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ChatCops from '../src/index.js';
import { Widget } from '../src/widget.js';

const API = 'https://api.test/chat';

const reply = () =>
  new Response(
    ['data: {"type":"start","protocol":1,"conversationId":"c","messageId":"m1"}', 'data: {"type":"text-delta","id":"t","delta":"Hi"}', 'data: {"type":"finish","reason":"stop"}', 'data: [DONE]', ''].join('\n\n'),
    { status: 200 }
  );
const unauthorized = () => new Response(JSON.stringify({ error: { code: 'session_required' } }), { status: 401 });
const minted = () => new Response(JSON.stringify({ token: 'tok', conversationId: 'c1', expiresAt: Date.now() + 900_000 }), { status: 200 });

/** The identity sent with each /session request, as the page's fetch sees it. */
function sessionRequests() {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    const hasToken = (init?.headers as Record<string, string> | undefined)?.Authorization;
    if (url.endsWith('/session')) return minted();
    return hasToken ? reply() : unauthorized();
  });
  return () =>
    fetch.mock.calls.filter(([url]) => String(url).endsWith('/session')).map(([, init]) => JSON.parse(String(init?.body)).userToken);
}

let widget: Widget | undefined;
beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
});
afterEach(() => {
  widget?.destroy();
  widget = undefined;
  ChatCops.destroy();
  vi.restoreAllMocks();
});

describe('userToken as a function', () => {
  it('is called when the visitor first sends a message, not when the page loads', async () => {
    const sent = sessionRequests();
    const userToken = vi.fn(async () => 'fresh.token');
    widget = new Widget({ apiUrl: API, userToken });
    widget.init();
    widget.open();
    expect(userToken).not.toHaveBeenCalled();

    await widget.sendMessage('Hello');
    expect(userToken).toHaveBeenCalledTimes(1);
    expect(sent()).toEqual(['fresh.token']);
  });

  it('works through ChatCops.init() in the npm and single-file builds', async () => {
    const sent = sessionRequests();
    widget = ChatCops.init({ apiUrl: API, userToken: () => 'from.init' });
    await ChatCops.sendMessage('Hello');
    expect(sent()).toEqual(['from.init']);
  });

  it('is replaced by the token of setUser()', async () => {
    const sent = sessionRequests();
    const userToken = vi.fn(() => 'from.config');
    widget = new Widget({ apiUrl: API, userToken });
    widget.init();
    widget.setUser({ name: 'Ada', token: 'from.setUser' });
    await widget.sendMessage('Hello');
    expect(sent()).toEqual(['from.setUser']);
    expect(userToken).not.toHaveBeenCalled();
  });

  it('sends nothing when setUser(null) signs the visitor out', async () => {
    const sent = sessionRequests();
    widget = new Widget({ apiUrl: API, userToken: () => 'from.config' });
    widget.init();
    widget.setUser(null);
    await widget.sendMessage('Hello');
    expect(sent()).toEqual([undefined]);
  });

  it('still takes a fixed string', async () => {
    const sent = sessionRequests();
    widget = new Widget({ apiUrl: API, userToken: 'fixed.token' });
    widget.init();
    await widget.sendMessage('Hello');
    expect(sent()).toEqual(['fixed.token']);
  });
});

describe('setUser with a token function', () => {
  type Internals = { messages: Array<{ role: string; content: string }> };
  const said = (w: Widget, text: string) => (w as unknown as Internals).messages.some((m) => m.content === text);
  const remember = (w: Widget, text: string) => (w as unknown as Internals).messages.push({ role: 'user', content: text });

  it('calls the function when a session is requested, not when setUser() is called', async () => {
    const sent = sessionRequests();
    const token = vi.fn(async () => 'fresh.from.setUser');
    widget = new Widget({ apiUrl: API });
    widget.init();
    widget.setUser({ name: 'Ada', token });
    expect(token).not.toHaveBeenCalled();

    await widget.sendMessage('Hello');
    expect(token).toHaveBeenCalledTimes(1);
    expect(sent()).toEqual(['fresh.from.setUser']);
  });

  it('keeps the chat when the same function is passed again', () => {
    widget = new Widget({ apiUrl: API });
    widget.init();
    const token = () => 'signed';
    widget.setUser({ token });
    remember(widget, 'A question');
    widget.setUser({ name: 'Ada', token });
    expect(said(widget, 'A question')).toBe(true);
  });

  it('clears the chat for a different function, a string, or null', () => {
    widget = new Widget({ apiUrl: API });
    widget.init();
    const first = () => 'one';
    for (const next of [() => 'one', 'a.string.token', undefined, null] as const) {
      widget.setUser({ token: first });
      remember(widget, 'Visitor A wrote this');
      widget.setUser(next === null ? null : { token: next });
      expect(said(widget, 'Visitor A wrote this')).toBe(false);
    }
  });

  it('clears the chat when a function is replaced by a user with no token', () => {
    widget = new Widget({ apiUrl: API });
    widget.init();
    widget.setUser({ token: () => 'one' });
    remember(widget, 'A question');
    widget.setUser({ name: 'Ada' });
    expect(said(widget, 'A question')).toBe(false);
  });

  it('keeps the chat when a function is given to a visitor who was anonymous', () => {
    widget = new Widget({ apiUrl: API });
    widget.init();
    remember(widget, 'A question');
    widget.setUser({ token: () => 'signed' });
    expect(said(widget, 'A question')).toBe(true);
  });

  it('takes a function through ChatCops.setUser() in the npm and single-file builds', async () => {
    const sent = sessionRequests();
    widget = ChatCops.init({ apiUrl: API });
    ChatCops.setUser({ token: async () => 'through.ChatCops' });
    await ChatCops.sendMessage('Hello');
    expect(sent()).toEqual(['through.ChatCops']);
  });

  it('is replaced by a later string, which is sent instead', async () => {
    const sent = sessionRequests();
    const token = vi.fn(() => 'from.function');
    widget = new Widget({ apiUrl: API });
    widget.init();
    widget.setUser({ token });
    widget.setUser({ token: 'a.string.token' });
    await widget.sendMessage('Hello');
    expect(sent()).toEqual(['a.string.token']);
    expect(token).not.toHaveBeenCalled();
  });
});
