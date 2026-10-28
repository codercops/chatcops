import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Messages } from '../../src/dom/messages.js';

describe('Messages', () => {
  let parent: HTMLDivElement;
  let messages: Messages;

  beforeEach(() => {
    document.body.innerHTML = '';
    parent = document.createElement('div');
    document.body.appendChild(parent);
    messages = new Messages(parent);
  });

  it('creates a messages container', () => {
    expect(parent.querySelector('.cc-messages')).toBeTruthy();
  });

  it('adds a user message', () => {
    messages.addMessage({ id: '1', role: 'user', content: 'Hello' });
    const msg = parent.querySelector('.cc-message-user');
    expect(msg).toBeTruthy();
    expect(msg?.textContent).toBe('Hello');
  });

  it('renders suggestions as buttons in a labelled group and removes them after selection', () => {
    const onSelect = vi.fn();
    messages.showSuggestions(['Compare plans', 'Book a demo'], 'Suggested questions', onSelect);

    const group = parent.querySelector('.cc-suggestions');
    expect(group?.getAttribute('role')).toBe('group');
    expect(group?.getAttribute('aria-label')).toBe('Suggested questions');
    const buttons = Array.from(group?.querySelectorAll('button') ?? []);
    expect(buttons.map((button) => button.textContent)).toEqual(['Compare plans', 'Book a demo']);
    expect(buttons.every((button) => button.type === 'button')).toBe(true);

    buttons[0].click();
    expect(onSelect).toHaveBeenCalledWith('Compare plans');
    messages.addMessage({ id: 'visitor-1', role: 'user', content: 'Compare plans' });
    expect(parent.querySelector('.cc-suggestions')).toBeNull();
  });

  it('adds an assistant message with markdown', () => {
    messages.addMessage({ id: '2', role: 'assistant', content: '**Bold** reply' });
    const msg = parent.querySelector('.cc-message-assistant');
    expect(msg).toBeTruthy();
    expect(msg?.innerHTML).toContain('<strong>Bold</strong>');
  });

  it('updates an existing message', () => {
    messages.addMessage({ id: '3', role: 'assistant', content: 'Hello' });
    messages.updateMessage({ id: '3', role: 'assistant', content: 'Hello world' });
    const msg = parent.querySelector('[data-id="3"]');
    expect(msg?.textContent).toContain('Hello world');
  });

  it('shows and removes typing indicator', () => {
    messages.showTyping();
    expect(parent.querySelector('.cc-typing')).toBeTruthy();

    messages.removeTyping();
    expect(parent.querySelector('.cc-typing')).toBeNull();
  });

  it('announces new messages politely', () => {
    const container = parent.querySelector('.cc-messages')!;
    expect(container.getAttribute('role')).toBe('log');
    expect(container.getAttribute('aria-live')).toBe('polite');
  });

  it('announces only the completed assistant text outside the muted log', () => {
    const log = parent.querySelector('.cc-messages') as HTMLElement;
    const announcement = parent.querySelector('.cc-reply-announcement') as HTMLElement;
    expect(announcement.parentElement).toBe(parent);
    expect(announcement.classList.contains('cc-sr-only')).toBe(true);
    expect(announcement.getAttribute('aria-live')).toBe('polite');
    expect(announcement.getAttribute('aria-atomic')).toBe('true');

    messages.addMessage({ id: 'visitor', role: 'user', content: 'Hi' });
    expect(announcement.textContent).toBe('');
    messages.beginReply();
    expect(log.getAttribute('aria-live')).toBe('off');
    messages.addMessage({ id: 'reply', role: 'assistant', content: '**Hel**', status: 'streaming' });
    messages.updateMessage({ id: 'reply', role: 'assistant', content: '**Hello** world', status: 'streaming' });
    expect(announcement.textContent).toBe('');

    const completed = { id: 'reply', role: 'assistant' as const, content: '**Hello** world', status: 'complete' as const };
    messages.updateMessage(completed);
    messages.finishReply(completed);
    expect(announcement.textContent).toBe('Hello world');
    expect(log.getAttribute('aria-live')).toBe('polite');
  });

  it('clears the old announcement for a new reply and includes a partial reply error once', () => {
    const announcement = parent.querySelector('.cc-reply-announcement') as HTMLElement;
    messages.addMessage({ id: 'reply', role: 'assistant', content: 'Partial', status: 'streaming' });
    messages.beginReply();
    const failed = { id: 'reply', role: 'assistant' as const, content: 'Partial', status: 'error' as const, errorText: 'Connection lost.' };
    messages.updateMessage(failed);
    messages.finishReply(failed);
    expect(announcement.textContent).toBe('Partial Connection lost.');

    messages.beginReply();
    expect(announcement.textContent).toBe('');
    expect(parent.querySelector('.cc-messages')?.getAttribute('aria-live')).toBe('off');
    messages.finishReply();
    expect(parent.querySelector('.cc-messages')?.getAttribute('aria-live')).toBe('polite');
  });

  it('gives the typing indicator text and hides the dots', () => {
    messages = new Messages(parent, { typingLabel: 'Escribiendo...' });
    messages.showTyping();
    const typing = parent.querySelectorAll('.cc-typing')[0]!;
    expect(typing.querySelector('.cc-sr-only')?.textContent).toBe('Escribiendo...');
    typing.querySelectorAll('.cc-typing-dot').forEach((dot) => {
      expect(dot.getAttribute('aria-hidden')).toBe('true');
    });
  });

  it('marks a streaming message busy until it completes', () => {
    messages.addMessage({ id: '5', role: 'assistant', content: 'Hel', status: 'streaming' });
    const el = parent.querySelector('[data-id="5"]')!;
    expect(el.getAttribute('aria-busy')).toBe('true');

    messages.updateMessage({ id: '5', role: 'assistant', content: 'Hello', status: 'complete' });
    expect(el.hasAttribute('aria-busy')).toBe(false);
  });

  it('removes typing indicator when adding a message', () => {
    messages.showTyping();
    messages.addMessage({ id: '4', role: 'assistant', content: 'Done' });
    expect(parent.querySelector('.cc-typing')).toBeNull();
  });

  it('clears all messages', () => {
    messages.addMessage({ id: '1', role: 'user', content: 'Hello' });
    messages.addMessage({ id: '2', role: 'assistant', content: 'Hi' });
    messages.clear();
    expect(parent.querySelectorAll('.cc-message').length).toBe(0);
  });

  it('escapes HTML in user messages', () => {
    messages.addMessage({ id: '5', role: 'user', content: '<script>alert("xss")</script>' });
    const msg = parent.querySelector('.cc-message-user');
    expect(msg?.innerHTML).not.toContain('<script>');
  });

  it('renders a retry button for error messages', () => {
    messages = new Messages(parent, {
      onRetry: () => undefined,
      retryLabel: 'Retry now',
    });

    messages.addMessage({
      id: 'error-1',
      role: 'assistant',
      content: 'Something went wrong.',
      status: 'error',
      errorType: 'provider_error',
    });

    const retryButton = parent.querySelector('.cc-message-retry');
    expect(retryButton).toBeTruthy();
    expect(retryButton?.textContent).toContain('Retry now');
  });

  it('does not render a retry button for complete assistant messages', () => {
    messages = new Messages(parent, {
      onRetry: () => undefined,
    });

    messages.addMessage({
      id: 'assistant-1',
      role: 'assistant',
      content: 'All good.',
      status: 'complete',
    });

    expect(parent.querySelector('.cc-message-retry')).toBeNull();
  });

  it('removes a message by id', () => {
    messages.addMessage({ id: 'remove-1', role: 'assistant', content: 'Remove me' });

    messages.removeMessage('remove-1');

    expect(parent.querySelector('[data-id="remove-1"]')).toBeNull();
  });

  it('updates and removes a message whose id has a quote and a backslash', () => {
    const id = 'msg-"1"\\x';
    messages.addMessage({ id, role: 'assistant', content: 'Hello' });

    messages.updateMessage({ id, role: 'assistant', content: 'Hello world' });
    const msg = parent.querySelector('.cc-message-assistant') as HTMLDivElement;
    expect(msg.dataset.id).toBe(id);
    expect(msg.textContent).toContain('Hello world');

    messages.removeMessage(id);
    expect(parent.querySelector('.cc-message-assistant')).toBeNull();
  });

  it('shows a regenerate button on the selected assistant message', () => {
    messages = new Messages(parent, {
      onRegenerate: () => undefined,
      regenerateLabel: 'Try again',
    });

    messages.addMessage({ id: 'assistant-a', role: 'assistant', content: 'First', status: 'complete' });
    messages.addMessage({ id: 'assistant-b', role: 'assistant', content: 'Second', status: 'complete' });

    messages.showRegenerateButton('assistant-b');

    expect(parent.querySelector('[data-id="assistant-a"] .cc-message-regenerate')).toBeNull();
    const regenerateButton = parent.querySelector('[data-id="assistant-b"] .cc-message-regenerate');
    expect(regenerateButton).toBeTruthy();
    expect(regenerateButton?.textContent).toContain('Try again');
  });

  it('renders sources as a labelled nav with links', () => {
    messages = new Messages(parent, { sourcesLabel: 'Sources' });
    messages.addMessage({
      id: 'src-1',
      role: 'assistant',
      content: 'See the docs.',
      status: 'complete',
      sources: [
        { url: 'https://example.com/pricing', title: 'Pricing' },
        { url: 'https://example.com/docs' },
      ],
    });

    const nav = parent.querySelector('.cc-message-sources');
    expect(nav).toBeTruthy();
    expect(nav?.getAttribute('aria-label')).toBe('Sources');
    const links = Array.from(nav?.querySelectorAll('a') ?? []);
    expect(links).toHaveLength(2);
    expect(links[0].textContent).toBe('Pricing');
    expect(links[0].getAttribute('href')).toBe('https://example.com/pricing');
    expect(links[0].getAttribute('target')).toBe('_blank');
    expect(links[0].getAttribute('rel')).toBe('noopener noreferrer');
    expect(links[1].textContent).toBe('example.com');
  });

  it('does not render a sources section for replies without sources', () => {
    messages.addMessage({ id: 'no-src', role: 'assistant', content: 'No sources here.', status: 'complete' });
    expect(parent.querySelector('.cc-message-sources')).toBeNull();
  });

  it('drops non-http(s) URLs from the sources list', () => {
    messages.addMessage({
      id: 'bad-src',
      role: 'assistant',
      content: 'Reply.',
      status: 'complete',
      sources: [
        { url: 'javascript:alert(1)', title: 'XSS' },
        { url: 'data:text/html,hi', title: 'Data' },
      ],
    });
    expect(parent.querySelector('.cc-message-sources')).toBeNull();
  });
});
