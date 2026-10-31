import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Widget } from '../src/widget.js';
import { mockChatStream } from './helpers/stream.js';

type Internals = {
  shadow: ShadowRoot;
  messages: Array<{ id: string; role: string; content: string; status?: string; errorType?: string }>;
  isStreaming: boolean;
};
const internals = (widget: Widget) => widget as unknown as Internals;
/** The conversation without the welcome message. */
const chat = (widget: Widget) => internals(widget).messages.filter((m) => m.id !== 'welcome');
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const button = (widget: Widget) => internals(widget).shadow.querySelector('.cc-send-btn') as HTMLButtonElement;
const textarea = (widget: Widget) => internals(widget).shadow.querySelector('.cc-input') as HTMLTextAreaElement;
const part = (delta: string) => `data: ${JSON.stringify({ type: 'text-delta', id: 't', delta })}\n\n`;
const start = (messageId = 'srv-1') => `data: ${JSON.stringify({ type: 'start', protocol: 1, conversationId: 'c', messageId })}\n\n`;
const finish = 'data: {"type":"finish","reason":"stop"}\n\ndata: [DONE]\n\n';

let widget: Widget;
const begin = (config: Partial<ConstructorParameters<typeof Widget>[0]> = {}) => {
  widget = new Widget({ apiUrl: '/chat', ...config });
  widget.init();
  widget.open();
  return widget;
};

/** Asks a question and streams the first words of the reply, leaving the response open. */
async function streaming(stream: ReturnType<typeof mockChatStream>, text = 'Partial answer') {
  const sent = widget.sendMessage('A question');
  await tick();
  stream.send(start());
  stream.send(part(text));
  await tick();
  return { sent };
}

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  widget?.destroy();
  vi.restoreAllMocks();
});

describe('the Stop button', () => {
  it('replaces Send while a reply streams, and goes back after', async () => {
    begin();
    expect(button(widget).getAttribute('aria-label')).toBe('Send');
    const stream = mockChatStream();
    const { sent } = await streaming(stream);

    expect(button(widget).getAttribute('aria-label')).toBe('Stop');
    expect(button(widget).disabled).toBe(false);
    expect(textarea(widget).disabled).toBe(true);

    stream.send(finish);
    stream.close();
    await sent;
    expect(button(widget).getAttribute('aria-label')).toBe('Send');
    expect(textarea(widget).disabled).toBe(false);
  });

  it('uses the Stop string of the locale, with English as the fallback', async () => {
    begin({ strings: { stopButton: 'Stoppen' } });
    const stream = mockChatStream();
    await streaming(stream);
    expect(button(widget).getAttribute('aria-label')).toBe('Stoppen');
    widget.destroy();

    begin({ locale: 'de' });
    const next = mockChatStream();
    await streaming(next);
    expect(button(widget).getAttribute('aria-label')).toMatch(/\S/);
  });

  it('shows the new wording when strings change during a reply', async () => {
    begin();
    const stream = mockChatStream();
    await streaming(stream);
    widget.update({ strings: { stopButton: 'Halt' } });
    expect(button(widget).getAttribute('aria-label')).toBe('Halt');
  });

  it('stops the request, keeps what streamed, and leaves no error', async () => {
    const onError = vi.fn();
    const onMessage = vi.fn();
    begin({ onError, onMessage });
    const stream = mockChatStream();
    const { sent } = await streaming(stream, 'The first half');
    button(widget).click();
    await sent;

    expect(stream.signal.aborted).toBe(true);
    const reply = internals(widget).messages.at(-1);
    expect(reply).toBeDefined();
    expect(reply).toMatchObject({ role: 'assistant', content: 'The first half', status: 'complete' });
    expect(reply?.errorType).toBeUndefined();
    expect(onError).not.toHaveBeenCalled();
    expect(onMessage).toHaveBeenLastCalledWith(expect.objectContaining({ content: 'The first half', status: 'complete' }));
    const shadow = internals(widget).shadow;
    expect(shadow.querySelector('.cc-message-error-note')).toBeNull();
    expect(shadow.querySelector('.cc-message-retry')).toBeNull();
    expect(shadow.querySelector('.cc-message-regenerate')).not.toBeNull();
    expect(shadow.textContent).toContain('The first half');
    expect(internals(widget).isStreaming).toBe(false);
    expect(button(widget).getAttribute('aria-label')).toBe('Send');
    expect(textarea(widget).disabled).toBe(false);
  });

  it('lets the visitor regenerate the stopped reply', async () => {
    begin();
    const stream = mockChatStream();
    const { sent } = await streaming(stream);
    button(widget).click();
    await sent;

    const again = mockChatStream();
    const fetchCalls = vi.mocked(fetch).mock.calls.length;
    (internals(widget).shadow.querySelector('.cc-message-regenerate') as HTMLButtonElement).click();
    await tick();
    expect(vi.mocked(fetch).mock.calls.length).toBe(fetchCalls + 1);
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls.at(-1)?.[1]?.body));
    expect(body).toMatchObject({ message: 'A question', regenerate: { assistantMessageId: 'srv-1' } });
    again.send(start('srv-2'));
    again.send(part('A better answer'));
    again.send(finish);
    again.close();
    await tick();
    expect(internals(widget).messages.at(-1)).toMatchObject({ content: 'A better answer', status: 'complete' });
  });

  it('answers a new question after a stop', async () => {
    begin();
    const stream = mockChatStream();
    const { sent } = await streaming(stream);
    button(widget).click();
    await sent;

    const next = mockChatStream();
    const second = widget.sendMessage('Another question');
    await tick();
    next.send(start('srv-2'));
    next.send(part('Fresh'));
    next.send(finish);
    next.close();
    await second;
    expect(chat(widget).map((m) => m.content)).toEqual(['A question', 'Partial answer', 'Another question', 'Fresh']);
  });

  it('stopping before any text arrives ends the request with no reply and no error', async () => {
    const onError = vi.fn();
    begin({ onError });
    const stream = mockChatStream();
    const sent = widget.sendMessage('A question');
    await tick();
    expect(button(widget).getAttribute('aria-label')).toBe('Stop');
    button(widget).click();
    await sent;

    expect(stream.signal.aborted).toBe(true);
    expect(onError).not.toHaveBeenCalled();
    expect(chat(widget).map((m) => m.role)).toEqual(['user']);
    expect(internals(widget).shadow.querySelector('.cc-message-error-note')).toBeNull();
    expect(internals(widget).shadow.querySelector('.cc-typing')).toBeNull();
    expect(button(widget).getAttribute('aria-label')).toBe('Send');
    expect(textarea(widget).disabled).toBe(false);
  });

  it('is not stopped again by a second click, and does nothing once the reply is done', async () => {
    begin();
    const stream = mockChatStream();
    const { sent } = await streaming(stream);
    button(widget).click();
    button(widget).click();
    await sent;
    expect(chat(widget).filter((m) => m.role === 'assistant')).toHaveLength(1);

    const next = mockChatStream();
    const second = widget.sendMessage('Next');
    await tick();
    next.send(start('srv-2'));
    next.send(part('Done'));
    next.send(finish);
    next.close();
    await second;
    expect(next.signal.aborted).toBe(false);
    expect(internals(widget).messages.at(-1)).toMatchObject({ content: 'Done', status: 'complete' });
  });

  it('a stop does not turn a later failure into a stopped reply', async () => {
    begin();
    const stream = mockChatStream();
    const { sent } = await streaming(stream);
    button(widget).click();
    await sent;

    const next = mockChatStream();
    const second = widget.sendMessage('Next');
    await tick();
    next.send(start('srv-2'));
    next.send(part('Half'));
    await tick();
    next.fail();
    await second;
    expect(internals(widget).messages.at(-1)).toMatchObject({ status: 'error', errorType: 'network' });
  });

  it('puts Send back when the conversation is reset during a reply', async () => {
    begin();
    const stream = mockChatStream();
    await streaming(stream);
    widget.newConversation();
    await tick();
    expect(button(widget).getAttribute('aria-label')).toBe('Send');
    expect(textarea(widget).disabled).toBe(false);
  });

  it('keeps a stopped reply in the saved conversation as a normal one', async () => {
    begin({ siteId: 'stop-test' });
    const stream = mockChatStream();
    const { sent } = await streaming(stream, 'Saved half');
    button(widget).click();
    await sent;
    const saved = Object.entries(localStorage).find(([key]) => key.includes('conversation'));
    expect(saved?.[1]).toContain('Saved half');
    expect(saved?.[1]).not.toContain('"error"');
  });
});
