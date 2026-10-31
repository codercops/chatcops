import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Input } from '../../src/dom/input.js';

describe('Input', () => {
  let parent: HTMLDivElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    parent = document.createElement('div');
    document.body.appendChild(parent);
  });

  it('limits chat messages to 10000 characters', () => {
    new Input(parent, {
      placeholder: 'Type a message...',
      sendLabel: 'Send',
      stopLabel: 'Stop',
      onSend: vi.fn(),
      onStop: vi.fn(),
    });

    const textarea = parent.querySelector(
      'textarea.cc-input',
    ) as HTMLTextAreaElement;

    expect(textarea.maxLength).toBe(10_000);
  });
});

describe('Input keyboard behavior', () => {
  let input: Input;
  let textarea: HTMLTextAreaElement;
  let sendButton: HTMLButtonElement;
  let onSend: ReturnType<typeof vi.fn>;
  let onStop: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    document.body.innerHTML = '';
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: 'open' });
    const parent = document.createElement('div');
    root.appendChild(parent);
    onSend = vi.fn();
    onStop = vi.fn();
    input = new Input(parent, { placeholder: 'Type here...', sendLabel: 'Send', stopLabel: 'Stop', onSend, onStop });
    textarea = root.querySelector('.cc-input') as HTMLTextAreaElement;
    sendButton = root.querySelector('.cc-send-btn') as HTMLButtonElement;
  });

  function type(text: string): void {
    textarea.value = text;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function enter(options: KeyboardEventInit = {}): KeyboardEvent {
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      keyCode: 13,
      bubbles: true,
      cancelable: true,
      ...options,
    });
    textarea.dispatchEvent(event);
    return event;
  }

  it('sends trimmed text and clears the input on Enter', () => {
    type('  Hello world  ');

    const event = enter();

    expect(onSend).toHaveBeenCalledExactlyOnceWith('Hello world');
    expect(textarea.value).toBe('');
    expect(sendButton.disabled).toBe(true);
    expect(event.defaultPrevented).toBe(true);
  });

  it('leaves Shift+Enter available without sending or clearing text', () => {
    type('Hello world');

    const event = enter({ shiftKey: true });

    expect(onSend).not.toHaveBeenCalled();
    expect(textarea.value).toBe('Hello world');
    expect(event.defaultPrevented).toBe(false);
  });

  it.each([
    { name: 'isComposing is true', isComposing: true, keyCode: 13 },
    { name: 'keyCode is 229 while isComposing is false', isComposing: false, keyCode: 229 },
  ])('preserves text and candidate confirmation when $name, then allows ordinary Enter', ({ isComposing, keyCode }) => {
    textarea.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    type('  日本語  ');

    const event = enter({ isComposing, keyCode });

    expect(onSend).not.toHaveBeenCalled();
    expect(textarea.value).toBe('  日本語  ');
    expect(sendButton.disabled).toBe(false);
    expect(event.defaultPrevented).toBe(false);

    textarea.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '日本語' }));
    const ordinaryEnter = enter({ isComposing: false, keyCode: 13 });

    expect(onSend).toHaveBeenCalledExactlyOnceWith('日本語');
    expect(textarea.value).toBe('');
    expect(sendButton.disabled).toBe(true);
    expect(ordinaryEnter.defaultPrevented).toBe(true);
  });

  it('does not send whitespace-only text', () => {
    type(' \t\n ');

    enter();

    expect(onSend).not.toHaveBeenCalled();
    expect(textarea.value).toBe(' \t\n ');
    expect(sendButton.disabled).toBe(true);
  });

  it('locks the text and turns the button into Stop while a reply streams, and restores both after', () => {
    type('Hello world');

    input.setStreaming(true);

    expect(textarea.disabled).toBe(true);
    expect(sendButton.disabled).toBe(false);
    expect(sendButton.getAttribute('aria-label')).toBe('Stop');
    expect(sendButton.querySelector('rect')).not.toBeNull();
    expect(textarea.value).toBe('Hello world');

    input.setStreaming(false);

    expect(textarea.disabled).toBe(false);
    expect(sendButton.disabled).toBe(false);
    expect(sendButton.getAttribute('aria-label')).toBe('Send');
    expect(sendButton.querySelector('path')).not.toBeNull();
    expect(textarea.value).toBe('Hello world');
  });

  it('leaves Send disabled for an empty box after a reply', () => {
    input.setStreaming(true);
    input.setStreaming(false);
    expect(sendButton.disabled).toBe(true);
  });

  it('leaves the Stop button enabled when sending starts the stream, as the widget does', () => {
    onSend.mockImplementation(() => input.setStreaming(true));
    type('A question');

    sendButton.click();

    expect(onSend).toHaveBeenCalledExactlyOnceWith('A question');
    expect(textarea.value).toBe('');
    expect(sendButton.getAttribute('aria-label')).toBe('Stop');
    expect(sendButton.disabled).toBe(false);
  });

  it('calls onStop, not onSend, when the button is clicked while streaming', () => {
    type('Typed before');
    input.setStreaming(true);

    sendButton.click();

    expect(onStop).toHaveBeenCalledOnce();
    expect(onSend).not.toHaveBeenCalled();
    expect(textarea.value).toBe('Typed before');
  });

  it('shows new labels at once, whichever button is showing', () => {
    input.setLabels('Ask here', 'Go', 'Halt');
    expect(sendButton.getAttribute('aria-label')).toBe('Go');
    input.setStreaming(true);
    expect(sendButton.getAttribute('aria-label')).toBe('Halt');
    input.setLabels('Ask here', 'Verzenden', 'Stoppen');
    expect(sendButton.getAttribute('aria-label')).toBe('Stoppen');
  });

  it('still sends trimmed text and clears the input when the button is clicked', () => {
    type('  Send by button  ');

    sendButton.click();

    expect(onSend).toHaveBeenCalledExactlyOnceWith('Send by button');
    expect(textarea.value).toBe('');
    expect(sendButton.disabled).toBe(true);
  });

  it('labels the textarea with the placeholder', () => {
    expect(textarea.getAttribute('aria-label')).toBe('Type here...');
  });
});
