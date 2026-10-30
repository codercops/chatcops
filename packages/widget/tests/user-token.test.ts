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
