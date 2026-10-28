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
