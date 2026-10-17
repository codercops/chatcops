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
      onSend: vi.fn(),
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

  beforeEach(() => {
    document.body.innerHTML = '';
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: 'open' });
    const parent = document.createElement('div');
    root.appendChild(parent);
    onSend = vi.fn();
    input = new Input(parent, { placeholder: 'Type here...', onSend });
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

  it('disables both controls and preserves text until they are enabled again', () => {
    type('Hello world');

    input.setDisabled(true);

    expect(textarea.disabled).toBe(true);
    expect(sendButton.disabled).toBe(true);
    expect(textarea.value).toBe('Hello world');

    input.setDisabled(false);

    expect(textarea.disabled).toBe(false);
    expect(sendButton.disabled).toBe(false);
    expect(textarea.value).toBe('Hello world');
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
