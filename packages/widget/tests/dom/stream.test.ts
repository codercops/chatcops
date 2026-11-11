import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Messages, lastBlockBoundary } from '../../src/dom/messages.js';
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

  describe('new reply pill', () => {
    const pill = () => parent.querySelector('.cc-pill') as HTMLButtonElement;

    it('creates a button without redundant live region announcements and uses default or custom text', () => {
      const button = pill();
      expect(button).not.toBeNull();
      expect(button.tagName).toBe('BUTTON');
      expect(button.type).toBe('button');
      expect(button.textContent).toBe('New reply ↓');
      expect(button.classList.contains('cc-hidden')).toBe(true);
      expect(button.getAttribute('aria-live')).toBeNull();
      expect(button.getAttribute('role')).toBeNull();
      expect(button.getAttribute('aria-label')).toBeNull();

      const customParent = document.createElement('div');
      new Messages(customParent, { newReply: 'Nouveaux messages ↓' });
      const customPill = customParent.querySelector('.cc-pill') as HTMLButtonElement;
      expect(customPill.textContent).toBe('Nouveaux messages ↓');
    });

    it('shows the pill when text arrives while scrolled up, and not when at the bottom', async () => {
      const el = log();
      let scrollTop = 580;
      Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => 1000 });
      Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => 400 });
      Object.defineProperty(el, 'scrollTop', { configurable: true, get: () => scrollTop, set: (v: number) => (scrollTop = v) });

      // When near bottom, pill stays hidden
      messages.updateMessage(reply('At bottom'));
      expect(pill().classList.contains('cc-hidden')).toBe(true);

      // Scroll up
      scrollTop = 200;
      messages.updateMessage(reply('Text arrives while scrolled up'));
      expect(pill().classList.contains('cc-hidden')).toBe(false);

      // Streaming chunks keep pill visible
      messages.updateMessage(reply('Text arrives while scrolled up more'));
      await frame();
      expect(pill().classList.contains('cc-hidden')).toBe(false);

      // addMessage also shows pill when scrolled up
      pill().classList.add('cc-hidden');
      messages.addMessage({ id: 'r-next', role: 'assistant', content: 'Another reply' });
      expect(pill().classList.contains('cc-hidden')).toBe(false);
    });

    it('hides the pill when scrolled down by hand', () => {
      const el = log();
      let scrollTop = 200;
      Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => 1000 });
      Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => 400 });
      Object.defineProperty(el, 'scrollTop', { configurable: true, get: () => scrollTop, set: (v: number) => (scrollTop = v) });

      messages.updateMessage(reply('Hello'));
      expect(pill().classList.contains('cc-hidden')).toBe(false);

      // Scroll by hand close to the bottom
      scrollTop = 600;
      el.dispatchEvent(new Event('scroll'));
      expect(pill().classList.contains('cc-hidden')).toBe(true);
    });

    it('scrolls to bottom and hides on click, respecting prefers-reduced-motion', async () => {
      const el = log();
      let scrollTop = 200;
      let smoothScrollCalled = false;
      Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => 1000 });
      Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => 400 });
      Object.defineProperty(el, 'scrollTop', { configurable: true, get: () => scrollTop, set: (v: number) => (scrollTop = v) });
      el.scrollTo = vi.fn().mockImplementation((options: ScrollToOptions) => {
        if (options.behavior === 'smooth') {
          smoothScrollCalled = true;
          scrollTop = options.top as number;
        }
      });

      // Default (no reduced motion): smooth scrolls
      messages.updateMessage(reply('Hello'));
      expect(pill().classList.contains('cc-hidden')).toBe(false);

      pill().click();
      expect(pill().classList.contains('cc-hidden')).toBe(true);
      expect(smoothScrollCalled).toBe(true);
      expect(scrollTop).toBe(1000);

      // With prefers-reduced-motion: reduce: jumps immediately
      smoothScrollCalled = false;
      scrollTop = 200;
      window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: query.includes('prefers-reduced-motion: reduce'),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));

      messages.updateMessage(reply('Hello reduced motion'));
      await frame();
      expect(pill().classList.contains('cc-hidden')).toBe(false);

      pill().click();
      expect(pill().classList.contains('cc-hidden')).toBe(true);
      expect(smoothScrollCalled).toBe(false);
      expect(scrollTop).toBe(1000);
    });
  });
});
