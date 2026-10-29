import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Messages, lastBlockBoundary } from '../../src/dom/messages.js';
import { getWidgetLocale, registerWidgetLocale } from '../../src/i18n.js';
import { renderMarkdown } from '../../src/markdown.js';

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

describe('lastBlockBoundary', () => {
  it('is just past the last blank line, and any more newlines after it', () => {
    expect(lastBlockBoundary('one line', 0)).toBe(0);
    expect(lastBlockBoundary('a\n\nb', 0)).toBe(3);
    expect(lastBlockBoundary('a\n\n\n\nb\n\nc', 0)).toBe(8);
    expect(lastBlockBoundary('a\n\nb', 3)).toBe(3);
    expect(lastBlockBoundary('a\n\n', 0)).toBe(3);
  });

  it('never splits inside a code fence', () => {
    expect(lastBlockBoundary('```\nx\n\ny', 0)).toBe(0);
    const closed = '```\nx\n\ny\n```\n\nafter';
    expect(lastBlockBoundary(closed, 0)).toBe(closed.indexOf('after'));
    expect(lastBlockBoundary('text\n\n```js\nopen\n\nstill open', 0)).toBe(6);
  });
});

describe('streaming replies', () => {
  let parent: HTMLDivElement;
  let messages: Messages;
  const reply = (content: string, status: 'streaming' | 'complete' | 'error' = 'streaming') => ({ id: 'r', role: 'assistant' as const, content, status });
  const content = () => parent.querySelector('.cc-message-content') as HTMLElement;
  const log = () => parent.querySelector('.cc-messages') as HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    parent = document.createElement('div');
    document.body.appendChild(parent);
    // No wait between renders here, so each test only has to wait a frame.
    messages = new Messages(parent, undefined, { streamIntervalMs: 0 });
    messages.addMessage(reply(''));
  });

  afterEach(() => vi.restoreAllMocks());

  it('shows the first text at once, then batches what follows into one render a frame', async () => {
    messages.updateMessage(reply('Hello'));
    expect(content().textContent).toBe('Hello');

    messages.updateMessage(reply('Hello there'));
    messages.updateMessage(reply('Hello there, friend'));
    expect(content().textContent).toBe('Hello');
    await frame();
    expect(content().textContent).toBe('Hello there, friend');
  });

  it('renders finished blocks once and leaves them alone', async () => {
    messages.updateMessage(reply('First paragraph.\n\nSecond'));
    const first = content().firstChild;
    expect(first?.textContent).toBe('First paragraph.');

    for (const text of [
      'First paragraph.\n\nSecond paragraph',
      'First paragraph.\n\nSecond paragraph grows.\n\nThird',
      'First paragraph.\n\nSecond paragraph grows.\n\nThird one.',
    ]) {
      messages.updateMessage(reply(text));
      await frame();
    }
    expect(content().firstChild).toBe(first);
    expect((first as Node).isConnected).toBe(true);
    expect(content().textContent).toBe('First paragraph.Second paragraph grows.Third one.');
  });

  it('keeps a code fence whole until it closes', async () => {
    messages.updateMessage(reply('Run:\n\n```\nnpm i\n\nnpm test'));
    await frame();
    expect(content().querySelector('pre')).toBeNull();
    messages.updateMessage(reply('Run:\n\n```\nnpm i\n\nnpm test\n```\n\nDone.'));
    await frame();
    expect(content().querySelector('pre code')?.textContent).toBe('npm i\n\nnpm test');
  });

  it('renders the whole reply the usual way when it completes', async () => {
    const text = '# Plans\n\nThe **Team** plan:\n\n- one\n- two\n\n```\ncode\n\nmore\n```\n\nThat is all.';
    let sent = '';
    for (const piece of text.match(/[\s\S]{1,7}/g) ?? []) {
      sent += piece;
      messages.updateMessage(reply(sent));
    }
    await frame();
    messages.updateMessage(reply(text, 'complete'));
    expect(content().innerHTML).toBe(renderMarkdown(text));
    expect(parent.querySelector('.cc-stream-tail')).toBeNull();
  });

  it('starts over when the text is replaced instead of extended', async () => {
    messages.updateMessage(reply('Old answer.\n\nMore'));
    messages.updateMessage(reply('New'));
    expect(content().textContent).toBe('New');
  });

  it('cancels a pending render when the reply fails, is removed or the log is cleared', async () => {
    messages.updateMessage(reply('Hello'));
    messages.updateMessage(reply('Hello again'));
    messages.updateMessage({ ...reply('Hello again', 'error'), errorText: 'Cut off.' });
    await frame();
    expect(parent.querySelector('.cc-message-error-note')?.textContent).toBe('Cut off.');
    expect(parent.querySelector('.cc-stream-tail')).toBeNull();

    messages.addMessage({ id: 's', role: 'assistant', content: '', status: 'streaming' });
    messages.updateMessage({ id: 's', role: 'assistant', content: 'a', status: 'streaming' });
    messages.updateMessage({ id: 's', role: 'assistant', content: 'ab', status: 'streaming' });
    messages.removeMessage('s');
    messages.clear();
    await frame();
    expect(parent.querySelector('.cc-message')).toBeNull();
  });

  it('follows new text only while the log is at the bottom', async () => {
    const el = log();
    let scrollTop = 0;
    Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => 1000 });
    Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => 400 });
    Object.defineProperty(el, 'scrollTop', { configurable: true, get: () => scrollTop, set: (v: number) => (scrollTop = v) });

    scrollTop = 580; // within 48px of the bottom
    messages.updateMessage(reply('Hello'));
    expect(scrollTop).toBe(1000);

    scrollTop = 200; // the visitor scrolled up to read
    messages.updateMessage(reply('Hello there'));
    await frame();
    expect(scrollTop).toBe(200);
    messages.updateMessage(reply('Hello there', 'complete'));
    expect(scrollTop).toBe(200);
    messages.addMessage({ id: 'r2', role: 'assistant', content: 'Next' });
    expect(scrollTop).toBe(200);

    messages.addMessage({ id: 'u', role: 'user', content: 'Me' });
    expect(scrollTop).toBe(1000);
  });

  it('waits the interval between renders', async () => {
    const slow = new Messages(parent, undefined, { streamIntervalMs: 80 });
    slow.addMessage({ id: 'x', role: 'assistant', content: '', status: 'streaming' });
    const text = () => (parent.querySelectorAll('.cc-message-content')[1] as HTMLElement).textContent;
    slow.updateMessage({ id: 'x', role: 'assistant', content: 'One', status: 'streaming' });
    slow.updateMessage({ id: 'x', role: 'assistant', content: 'One two', status: 'streaming' });
    await frame();
    expect(text()).toBe('One');
    await new Promise((resolve) => setTimeout(resolve, 120));
    await frame();
    expect(text()).toBe('One two');
  });
});

describe('reply scrolling', () => {
  let parent: HTMLDivElement;
  let messages: Messages;
  let log: HTMLDivElement;
  let pill: HTMLButtonElement;
  let height: number;

  beforeEach(() => {
    document.body.innerHTML = '';
    parent = document.createElement('div');
    document.body.appendChild(parent);
    messages = new Messages(parent);
    log = parent.querySelector('.cc-messages') as HTMLDivElement;
    pill = parent.querySelector('.cc-new-reply') as HTMLButtonElement;
    height = 1000;
    Object.defineProperties(log, {
      scrollHeight: { get: () => height },
      clientHeight: { value: 300 },
    });
  });

  it('shows a button outside the live log for a new message while scrolled up', () => {
    log.scrollTop = 100;
    messages.addMessage({ id: '1', role: 'assistant', content: 'Hello' });
    expect(pill.hidden).toBe(false);
    expect(pill.type).toBe('button');
    expect(pill.textContent).toBe('New reply ↓');
    expect(pill.classList.contains('cc-suggestion')).toBe(false);
    expect(pill.closest('[aria-live]')).toBeNull();
    expect(log.scrollTop).toBe(100);
  });

  it('shows for streamed text without pulling the log down', () => {
    messages.addMessage({ id: '1', role: 'assistant', content: 'Hel', status: 'streaming' });
    log.scrollTop = 100;
    messages.updateMessage({ id: '1', role: 'assistant', content: 'Hello', status: 'streaming' });
    expect(log.scrollTop).toBe(100);
    expect(pill).not.toBeNull();
    expect(pill.hidden).toBe(false);
  });

  it.each([0, 48])('follows new content within %i pixels of the bottom', (distance) => {
    log.scrollTop = 700 - distance;
    // The decision must use the old height, even if the new message is tall.
    const append = log.appendChild.bind(log);
    vi.spyOn(log, 'appendChild').mockImplementation((node) => {
      height = 1400;
      return append(node);
    });
    messages.addMessage({ id: '1', role: 'assistant', content: 'Hello' });
    expect(pill.hidden).toBe(true);
    expect(log.scrollTop).toBe(1400);
    messages.updateMessage({ id: '1', role: 'assistant', content: 'Hello again' });
    expect(pill.hidden).toBe(true);
  });

  it('hides when the visitor scrolls back within 48px of the bottom', () => {
    messages.addMessage({ id: '1', role: 'assistant', content: 'Hello' });
    log.scrollTop = 651;
    log.dispatchEvent(new Event('scroll'));
    expect(pill.hidden).toBe(false);
    log.scrollTop = 652;
    log.dispatchEvent(new Event('scroll'));
    expect(pill.hidden).toBe(true);
  });

  it.each([false, true])('scrolls and hides on click (reduced motion: %s)', (reduced) => {
    messages.addMessage({ id: '1', role: 'assistant', content: 'Hello' });
    const scroll = vi.spyOn(log, 'scrollTo').mockImplementation(() => {});
    const media = vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: reduced } as MediaQueryList);
    pill.click();
    expect(media).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
    expect(scroll).toHaveBeenCalledWith({ top: 1000, behavior: reduced ? 'instant' : 'smooth' });
    expect(pill.hidden).toBe(true);
    media.mockRestore();
  });

  it('does not show or scroll for typing alone while reading earlier messages', () => {
    log.scrollTop = 100;
    messages.showTyping();
    expect(pill.hidden).toBe(true);
    expect(log.scrollTop).toBe(100);
    messages.addMessage({ id: '1', role: 'assistant', content: 'Hello' });
    expect(pill.hidden).toBe(false);
    messages.clear();
    expect(pill.hidden).toBe(true);
  });

  it('hides the pill with the log for the pre-chat form', () => {
    messages.addMessage({ id: '1', role: 'assistant', content: 'Hello' });
    messages.setVisible(false);
    expect(pill.closest('.cc-hidden')).toBeTruthy();
    messages.setVisible(true);
    expect(pill.closest('.cc-hidden')).toBeNull();
  });

  it('refreshes the button when the panel updates its locale labels', () => {
    const actions = { newReplyLabel: 'New reply' };
    const localized = document.createElement('div');
    const log = new Messages(localized, actions);
    actions.newReplyLabel = 'Nouvelle réponse';
    log.refreshReplyLabel();
    expect(localized.querySelector('.cc-new-reply')?.textContent).toBe('Nouvelle réponse ↓');
  });

  it('uses locale overrides and falls back to English for older registered locales', () => {
    const { newReply: _newReply, ...olderStrings } = getWidgetLocale('en');
    registerWidgetLocale('old', olderStrings as ReturnType<typeof getWidgetLocale>);
    expect(getWidgetLocale('old').newReply).toBe('New reply');
    // Existing locale files are partial and are merged with English by the widget.
    const locale = getWidgetLocale('fr', { retryButton: 'Réessayer' });
    expect(locale.newReply).toBe('New reply');
    const localized = document.createElement('div');
    new Messages(localized, { newReplyLabel: 'Nouvelle réponse' });
    expect(localized.querySelector('.cc-new-reply')?.textContent).toBe('Nouvelle réponse ↓');
  });
});
