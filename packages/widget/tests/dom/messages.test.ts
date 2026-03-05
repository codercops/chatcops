import { describe, it, expect, beforeEach } from 'vitest';
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

  it('adds an assistant message with markdown', () => {
    messages.addMessage({ id: '2', role: 'assistant', content: '**Bold** reply' });
    const msg = parent.querySelector('.cc-message-assistant');
    expect(msg).toBeTruthy();
    expect(msg?.innerHTML).toContain('<strong>Bold</strong>');
  });

  it('updates an existing message', () => {
    messages.addMessage({ id: '3', role: 'assistant', content: 'Hello' });
    messages.updateMessage('3', 'Hello world', true);
    const msg = parent.querySelector('[data-id="3"]');
    expect(msg?.textContent).toContain('Hello world');
  });

  it('shows and removes typing indicator', () => {
    messages.showTyping();
    expect(parent.querySelector('.cc-typing')).toBeTruthy();

    messages.removeTyping();
    expect(parent.querySelector('.cc-typing')).toBeNull();
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
});
