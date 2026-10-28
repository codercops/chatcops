import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ChatCops from '../src/index.js';
import { createLoader, type PanelModule } from '../src/loader/loader.js';
import { Widget } from '../src/widget.js';
import { VERSION } from '../src/version.js';
import { mockChatStream } from './helpers/stream.js';

type Internals = {
  shadow: ShadowRoot;
  conversationId: string;
  messages: Array<{ role: string; content: string }>;
  userData?: Record<string, string>;
  isStreaming: boolean;
};
const internals = (widget: Widget) => widget as unknown as Internals;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const texts = (widget: Widget) => [...internals(widget).shadow.querySelectorAll('.cc-message')].map((el) => el.textContent);

/** A reply streamed in the 0.5 format, then the end of the stream. */
async function reply(stream: ReturnType<typeof mockChatStream>, text: string) {
  stream.send(`data: ${JSON.stringify({ content: text })}\n\n`);
  stream.send('data: [DONE]\n\n');
  stream.close();
}

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  ChatCops.destroy();
  vi.restoreAllMocks();
});

describe('Widget methods', () => {
  it('sendMessage opens the chat, sends as the visitor and resolves when the reply is done', async () => {
    const widget = new Widget({ apiUrl: '/chat' });
    widget.init();
    const opened = vi.fn();
    widget.on('open', opened);
    const stream = mockChatStream();
    const sent = widget.sendMessage('What does it cost?');
    await tick();
    await reply(stream, 'The Team plan is $19.');
    await sent;
    expect(opened).toHaveBeenCalledOnce();
    expect(internals(widget).messages.map((m) => m.content)).toContain('What does it cost?');
    expect(texts(widget).at(-1)).toContain('The Team plan is $19.');
    widget.destroy();
  });

  it('sendMessage with open: false sends without opening', async () => {
    const widget = new Widget({ apiUrl: '/chat' });
    widget.init();
    const opened = vi.fn();
    widget.on('open', opened);
    const stream = mockChatStream();
    const sent = widget.sendMessage('Hi', { open: false });
    await tick();
    await reply(stream, 'Hello!');
    await sent;
    expect(opened).not.toHaveBeenCalled();
    expect(internals(widget).messages.at(-1)?.content).toBe('Hello!');
    widget.destroy();
  });

  it('newConversation starts over with a new id, keeps the pre-chat answers, and drops a reply still coming', async () => {
    const widget = new Widget({ apiUrl: '/chat', welcomeMessage: 'Welcome!' });
    widget.init();
    widget.open();
    internals(widget).userData = { name: 'Sam' };
    const before = internals(widget).conversationId;
    const stream = mockChatStream();
    void widget.sendMessage('Tell me a long story');
    await tick();
    stream.send(`data: ${JSON.stringify({ content: 'Once upon' })}\n\n`);
    await tick();

    widget.newConversation();
    await tick();
    expect(internals(widget).conversationId).not.toBe(before);
    expect(internals(widget).isStreaming).toBe(false);
    expect(internals(widget).userData).toEqual({ name: 'Sam' });
    expect(texts(widget).join(' ')).not.toContain('Tell me a long story');
    expect(texts(widget).join(' ')).not.toContain('Once upon');
    expect(texts(widget).some((text) => text?.includes('Welcome!'))).toBe(true);
    expect(internals(widget).messages.every((m) => m.content !== 'Once upon')).toBe(true);
    widget.destroy();
  });

  it('clear also forgets the saved transcript and the pre-chat answers', async () => {
    const widget = new Widget({ apiUrl: '/chat', siteId: 'clear-test' });
    widget.init();
    const stream = mockChatStream();
    const sent = widget.sendMessage('Remember me');
    await tick();
    await reply(stream, 'Noted.');
    await sent;
    expect(localStorage.length).toBeGreaterThan(0);
    const saved = Object.keys(localStorage).find((key) => key.includes('conversation'));
    expect(saved).toBeDefined();

    internals(widget).userData = { name: 'Sam' };
    widget.clear();
    expect(saved && localStorage.getItem(saved)).toBeNull();
    expect(internals(widget).userData).toBeUndefined();
    expect(internals(widget).messages.some((m) => m.content === 'Remember me')).toBe(false);
    widget.destroy();
  });
});

describe('setUser and setContext', () => {
  const bodies = () => vi.mocked(globalThis.fetch).mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)));

  it('setContext sends the details as page context with each message, and null removes them', async () => {
    const widget = new Widget({ apiUrl: '/chat' });
    widget.init();
    widget.setContext({ plan: 'Team', seats: '12' });
    let stream = mockChatStream();
    let sent = widget.sendMessage('Can I add a seat?');
    await tick();
    await reply(stream, 'Yes.');
    await sent;
    widget.setContext(null);
    stream = mockChatStream();
    sent = widget.sendMessage('Thanks');
    await tick();
    await reply(stream, 'Anytime.');
    await sent;
    const [first, second] = bodies();
    expect(first.pageContext.data).toEqual({ plan: 'Team', seats: '12' });
    expect(second.pageContext.data).toBeUndefined();
    widget.destroy();
  });

  it('setUser sends name and email as visitor details with the first message, and greets by name', async () => {
    const widget = new Widget({ apiUrl: '/chat', welcomeMessage: 'How can I help?' });
    widget.init();
    widget.setUser({ name: 'Sam', email: 'sam@acme.test' });
    widget.newConversation();
    expect(texts(widget).join(' ')).toContain('Sam');
    const stream = mockChatStream();
    const sent = widget.sendMessage('Hi');
    await tick();
    await reply(stream, 'Hello Sam.');
    await sent;
    expect(bodies()[0].userData).toEqual({ name: 'Sam', email: 'sam@acme.test' });
    widget.destroy();
  });

  it('switching users or signing out clears the chat; signing in from anonymous keeps it', async () => {
    const widget = new Widget({ apiUrl: '/chat' });
    widget.init();
    const stream = mockChatStream();
    const sent = widget.sendMessage('A question');
    await tick();
    await reply(stream, 'An answer.');
    await sent;

    widget.setUser({ token: 'user-a' });
    expect(internals(widget).messages.some((m) => m.content === 'A question')).toBe(true);
    widget.setUser({ token: 'user-a' });
    expect(internals(widget).messages.some((m) => m.content === 'A question')).toBe(true);

    widget.setUser({ token: 'user-b' });
    expect(internals(widget).messages.some((m) => m.content === 'A question')).toBe(false);
    internals(widget).messages.push({ role: 'user', content: 'B wrote this' });
    widget.setUser(null);
    expect(internals(widget).messages.some((m) => m.content === 'B wrote this')).toBe(false);
    widget.destroy();
  });

  it('sends the visitor details again with the first message of a new conversation', async () => {
    const widget = new Widget({ apiUrl: '/chat', preChatForm: { enabled: true, fields: [{ name: 'name', label: 'Name', type: 'text' }] } });
    widget.init();
    internals(widget).userData = { name: 'Sam' };
    (internals(widget) as unknown as { v1: boolean; preChatDone: boolean }).v1 = true;
    (internals(widget) as unknown as { preChatDone: boolean }).preChatDone = true;
    let stream = mockChatStream();
    let sent = widget.sendMessage('First');
    await tick();
    await reply(stream, 'One.');
    await sent;
    stream = mockChatStream();
    sent = widget.sendMessage('Second');
    await tick();
    await reply(stream, 'Two.');
    await sent;
    widget.newConversation();
    stream = mockChatStream();
    sent = widget.sendMessage('Fresh start');
    await tick();
    await reply(stream, 'Three.');
    await sent;
    expect(bodies().map((body) => body.userData)).toEqual([{ name: 'Sam' }, undefined, { name: 'Sam' }]);
    widget.destroy();
  });
});

describe('the ChatCops API (npm and single-file builds)', () => {
  it('toggles, and has the version', () => {
    ChatCops.init({ apiUrl: '/chat' });
    const opened = vi.fn();
    const closed = vi.fn();
    ChatCops.on('open', opened);
    ChatCops.on('close', closed);
    ChatCops.toggle();
    ChatCops.toggle();
    expect(opened).toHaveBeenCalledOnce();
    expect(closed).toHaveBeenCalledOnce();
    expect(ChatCops.version).toBe(VERSION);
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('registerLocale adds a language, English for what it leaves out, and its direction', () => {
    ChatCops.registerLocale('xx', { sendButton: 'Send it', welcomeMessage: 'Hey there' }, { dir: 'rtl' });
    const widget = ChatCops.init({ apiUrl: '/chat', locale: 'xx' });
    widget.open();
    const root = internals(widget).shadow;
    expect((root.host as HTMLElement).dir).toBe('rtl');
    expect(root.querySelector('.cc-send-btn')?.getAttribute('aria-label')).toBe('Send it');
    expect(root.textContent).toContain('Hey there');
    // Not given, so English.
    expect(root.querySelector('.cc-input')?.getAttribute('placeholder')).toBe('Type a message...');
  });

  it('does nothing before init', async () => {
    ChatCops.destroy();
    expect(() => {
      ChatCops.toggle();
      ChatCops.newConversation();
      ChatCops.clear();
    }).not.toThrow();
    await expect(ChatCops.sendMessage('hi')).resolves.toBeUndefined();
  });
});

describe('the script tag loader API', () => {
  const panel = () => vi.fn(async (): Promise<PanelModule> => ({ Widget }));

  it('toggle loads and opens the chat, then closes it', async () => {
    const load = panel();
    const loader = createLoader(load);
    loader.init({ apiUrl: '/chat' });
    const opened = vi.fn();
    const closed = vi.fn();
    loader.on('open', opened);
    loader.on('close', closed);
    loader.toggle();
    await tick();
    await tick();
    expect(load).toHaveBeenCalledOnce();
    expect(opened).toHaveBeenCalledOnce();
    loader.toggle();
    expect(closed).toHaveBeenCalledOnce();
    expect(loader.version).toBe(VERSION);
    loader.destroy();
  });

  it('sendMessage loads the chat and sends', async () => {
    const loader = createLoader(panel());
    loader.init({ apiUrl: '/chat' });
    const stream = mockChatStream();
    const sent = loader.sendMessage('Hello from the page');
    await tick();
    await tick();
    await reply(stream, 'Hi!');
    await sent;
    const root = document.querySelector('.chatcops-root')?.shadowRoot;
    expect(root?.textContent).toContain('Hello from the page');
    expect(root?.textContent).toContain('Hi!');
    loader.destroy();
  });

  it('newConversation and clear load the chat and reset it', async () => {
    const loader = createLoader(panel());
    loader.init({ apiUrl: '/chat', welcomeMessage: 'Welcome!' });
    const clear = vi.spyOn(Widget.prototype, 'clear');
    const fresh = vi.spyOn(Widget.prototype, 'newConversation');
    loader.newConversation();
    loader.clear();
    await tick();
    await tick();
    expect(fresh).toHaveBeenCalledOnce();
    expect(clear).toHaveBeenCalledOnce();
    loader.destroy();
  });

  it('keeps setUser and setContext until the chat loads, without loading it or touching storage', async () => {
    const load = panel();
    const loader = createLoader(load);
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem');
    loader.setUser({ name: 'Sam', token: 'user-a' });
    loader.init({ apiUrl: '/chat', welcomeMessage: 'How can I help?' });
    loader.setContext({ plan: 'Team' });
    await tick();
    expect(load).not.toHaveBeenCalled();
    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();

    const setUser = vi.spyOn(Widget.prototype, 'setUser');
    const setContext = vi.spyOn(Widget.prototype, 'setContext');
    loader.open();
    await tick();
    await tick();
    expect(setUser).toHaveBeenCalledWith({ name: 'Sam', token: 'user-a' });
    expect(setContext).toHaveBeenCalledWith({ plan: 'Team' });
    loader.setContext(null);
    expect(setContext).toHaveBeenLastCalledWith(null);
    loader.destroy();
  });

  it('registerLocale uses the strings without fetching a file, and passes the direction to the panel', async () => {
    const loadLocale = vi.fn();
    const loader = createLoader(panel(), loadLocale);
    loader.registerLocale('yy', { openChat: 'Open it', sendButton: 'Go' }, { dir: 'rtl' });
    loader.init({ apiUrl: '/chat', locale: 'yy' });
    const launcher = document.querySelector('.chatcops-root') as HTMLElement;
    expect(launcher.dir).toBe('rtl');
    loader.open();
    await tick();
    await tick();
    expect(loadLocale).not.toHaveBeenCalled();
    const root = document.querySelector('.chatcops-root')?.shadowRoot;
    expect((root?.host as HTMLElement | undefined)?.dir).toBe('rtl');
    expect(root?.querySelector('.cc-send-btn')?.getAttribute('aria-label')).toBe('Go');
    loader.destroy();
  });
});
