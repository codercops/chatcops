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