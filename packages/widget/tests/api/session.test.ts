import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatClient } from '../../src/api/client.js';
import type { WidgetChatChunk } from '../../src/api/types.js';
import { turnstileToken } from '../../src/api/turnstile.js';

vi.mock('../../src/api/turnstile.js', () => ({ turnstileToken: vi.fn(async () => 'ts-token') }));

const API = 'https://api.test/chat';
const KEY = `chatcops-session:${API}`;

const v1Reply = () =>
  new Response(
    [
      'data: {"type":"start","protocol":1,"conversationId":"c","messageId":"m1","capabilities":{"session":true}}',
      'data: {"type":"text-delta","id":"t1","delta":"Hi"}',
      'data: {"type":"finish","reason":"stop"}',
      'data: [DONE]',
      '',
    ].join('\n\n'),
    { status: 200 }
  );
const unauthorized = (code = 'session_required') => new Response(JSON.stringify({ error: { code } }), { status: 401 });
const minted = (conversationId: string, token = 'tok-1') =>
  new Response(JSON.stringify({ token, conversationId, expiresAt: Date.now() + 900_000 }), { status: 200 });

async function collect(client: ChatClient, conversationId = 'c1'): Promise<WidgetChatChunk[]> {
  const chunks: WidgetChatChunk[] = [];
  for await (const chunk of client.sendMessage({ conversationId, message: 'Hello' })) chunks.push(chunk);
  return chunks;
}

const calls = (fetch: ReturnType<typeof vi.fn>) =>
  fetch.mock.calls.map(([url, init]) => ({
    url: String(url),
    auth: (init?.headers as Record<string, string> | undefined)?.Authorization,
    body: JSON.parse(String(init?.body)),
  }));

beforeEach(() => {
  localStorage.clear();
  vi.mocked(turnstileToken).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ChatClient with session tokens', () => {
  it('gets a token on 401, retries once with it, and keeps it for the next message', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(minted('c1'))
      .mockResolvedValueOnce(v1Reply())
      .mockResolvedValueOnce(v1Reply());
    const client = new ChatClient({ apiUrl: API });

    expect((await collect(client)).slice(0, 3)).toEqual([{ messageId: 'm1' }, { content: 'Hi' }, { done: true }]);
    await collect(client);

    expect(calls(fetch as never)).toEqual([
      { url: API, auth: undefined, body: expect.objectContaining({ conversationId: 'c1' }) },
      { url: 'https://api.test/chat/session', auth: undefined, body: { conversationId: 'c1' } },
      { url: API, auth: 'Bearer tok-1', body: expect.objectContaining({ conversationId: 'c1' }) },
      { url: API, auth: 'Bearer tok-1', body: expect.objectContaining({ conversationId: 'c1' }) },
    ]);
    expect(JSON.parse(localStorage.getItem(KEY) ?? '{}')).toMatchObject({ token: 'tok-1', conversationId: 'c1' });
  });

  it('sends the saved token to resume the conversation after a reload, even once it has expired', async () => {
    localStorage.setItem(KEY, JSON.stringify({ token: 'old', conversationId: 'c1' }));
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(unauthorized('token_expired'))
      .mockResolvedValueOnce(minted('c1', 'new'))
      .mockResolvedValueOnce(v1Reply());

    await collect(new ChatClient({ apiUrl: API }));

    const [first, session, retry] = calls(fetch as never);
    expect(first.auth).toBe('Bearer old');
    expect(session.body).toEqual({ conversationId: 'c1', previousToken: 'old' });
    expect(retry.auth).toBe('Bearer new');
  });

  it("doesn't send another conversation's token, and moves to the id the server gives", async () => {
    localStorage.setItem(KEY, JSON.stringify({ token: 'old', conversationId: 'c0' }));
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(minted('server-id'))
      .mockResolvedValueOnce(v1Reply());

    const chunks = await collect(new ChatClient({ apiUrl: API }));

    expect(chunks[0]).toEqual({ conversationId: 'server-id' });
    const [first, , retry] = calls(fetch as never);
    expect(first.auth).toBeUndefined();
    expect(retry.body.conversationId).toBe('server-id');
  });

  it('reports the 401 when the server has no session endpoint', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(new Response('{}', { status: 404 }));
    expect(await collect(new ChatClient({ apiUrl: API }))).toEqual([{ error: 'HTTP 401' }]);
  });

  it('keeps working when storage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(minted('c1'))
      .mockResolvedValueOnce(v1Reply())
      .mockResolvedValueOnce(v1Reply());
    const client = new ChatClient({ apiUrl: API });

    expect((await collect(client)).at(-1)).toEqual({ done: true });
    await collect(client);
    expect(calls(fetch as never)[3].auth).toBe('Bearer tok-1');
  });

  it('passes Turnstile for a new session, and skips it when resuming with the saved token', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(minted('c1'))
      .mockResolvedValueOnce(v1Reply())
      .mockResolvedValueOnce(unauthorized('token_expired'))
      .mockResolvedValueOnce(minted('c1', 'tok-2'))
      .mockResolvedValueOnce(v1Reply());
    const client = new ChatClient({ apiUrl: API, turnstileSiteKey: 'site-key' });

    await collect(client);
    await collect(client);

    const sessions = calls(fetch as never).filter((call) => call.url.endsWith('/session'));
    expect(sessions[0].body).toEqual({ conversationId: 'c1', turnstileToken: 'ts-token' });
    expect(sessions[1].body).toEqual({ conversationId: 'c1', previousToken: 'tok-1' });
    expect(turnstileToken).toHaveBeenCalledTimes(1);
    expect(turnstileToken).toHaveBeenCalledWith('site-key');
  });

  it('drops a saved token the server refused, so the next try runs Turnstile', async () => {
    localStorage.setItem(KEY, JSON.stringify({ token: 'too-old', conversationId: 'c1' }));
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(unauthorized('token_expired'))
      .mockResolvedValueOnce(new Response('{"error":{"code":"turnstile_failed"}}', { status: 401 }))
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(minted('c2'))
      .mockResolvedValueOnce(v1Reply());
    const client = new ChatClient({ apiUrl: API, turnstileSiteKey: 'site-key' });

    expect(await collect(client)).toEqual([{ error: 'HTTP 401' }]);
    expect(turnstileToken).not.toHaveBeenCalled();
    await collect(client);

    const [, , retryFirst, session] = calls(fetch as never);
    expect(retryFirst.auth).toBeUndefined();
    expect(session.body).toEqual({ conversationId: 'c1', turnstileToken: 'ts-token' });
  });

  it.each([
    ['/api/chat', '/api/chat/session'],
    ['/api/chat/', '/api/chat/session'],
    ['https://api.test/chat?site=acme', 'https://api.test/chat/session?site=acme'],
  ])('asks %s/session for the token', async (apiUrl, sessionUrl) => {
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(new Response('{}', { status: 404 }));
    await collect(new ChatClient({ apiUrl }));
    expect(String(fetch.mock.calls[1][0])).toBe(sessionUrl);
  });
});
