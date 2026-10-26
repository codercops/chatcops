import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Panel } from '../../src/dom/panel.js';

describe('Panel', () => {
  let root: ShadowRoot;

  beforeEach(() => {
    document.body.innerHTML = '';
    const host = document.createElement('div');
    document.body.appendChild(host);
    root = host.attachShadow({ mode: 'open' });
  });

  function createPanel(overrides = {}) {
    return new Panel(root, {
      position: 'bottom-right',
      branding: { name: 'Test Bot', subtitle: 'Online' },
      placeholder: 'Type here...',
      footerText: 'Powered by ChatCops',
      closeLabel: 'Close',
      sendLabel: 'Send',
      onSend: vi.fn(),
      onClose: vi.fn(),
      ...overrides,
    });
  }

  it('renders panel structure', () => {
    createPanel();
    expect(root.querySelector('.cc-panel')).toBeTruthy();
    expect(root.querySelector('.cc-header')).toBeTruthy();
    expect(root.querySelector('.cc-messages')).toBeTruthy();
    expect(root.querySelector('.cc-input-area')).toBeTruthy();
    expect(root.querySelector('.cc-footer')).toBeTruthy();
  });

  it('displays branding name and subtitle', () => {
    createPanel();
    expect(root.querySelector('.cc-header-name')?.textContent).toBe('Test Bot');
    expect(root.querySelector('.cc-header-subtitle')?.textContent).toBe('Online');
  });

  it('starts hidden', () => {
    const panel = createPanel();
    expect(panel.isVisible).toBe(false);
  });

  it('shows and hides', () => {
    const panel = createPanel();
    panel.show();
    expect(panel.isVisible).toBe(true);

    panel.hide();
    expect(panel.isVisible).toBe(false);
  });

  it('calls onClose when close button clicked', () => {
    const onClose = vi.fn();
    createPanel({ onClose });
    const closeBtn = root.querySelector('.cc-header-close') as HTMLButtonElement;
    closeBtn.click();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('is a dialog that is inert and hidden from screen readers while closed', () => {
    const panel = createPanel();
    const el = root.querySelector('.cc-panel') as HTMLElement;
    expect(el.id).toBe('cc-panel');
    expect(el.getAttribute('role')).toBe('dialog');
    expect(el.getAttribute('aria-modal')).toBe('true');
    expect(el.getAttribute('aria-label')).toBe('Test Bot');
    expect(el.hasAttribute('inert')).toBe(true);
    expect(el.getAttribute('aria-hidden')).toBe('true');

    panel.show();
    expect(el.hasAttribute('inert')).toBe(false);
    expect(el.hasAttribute('aria-hidden')).toBe(false);

    panel.hide();
    expect(el.hasAttribute('inert')).toBe(true);
    expect(el.getAttribute('aria-hidden')).toBe('true');
  });

  it('calls onClose when Escape is pressed inside the panel', () => {
    const onClose = vi.fn();
    const panel = createPanel({ onClose });
    panel.show();
    const textarea = root.querySelector('.cc-panel textarea') as HTMLElement;
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('wraps Tab from the last focusable element to the first', () => {
    const panel = createPanel();
    panel.show();
    const closeButton = root.querySelector('.cc-header-close') as HTMLButtonElement;
    const textarea = root.querySelector('.cc-panel textarea') as HTMLTextAreaElement;
    textarea.focus();

    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    textarea.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(root.activeElement).toBe(closeButton);
  });

  it('wraps Shift+Tab from the first focusable element to the latest one', () => {
    const panel = createPanel({ preChatEnabled: true });
    panel.show();
    const closeButton = root.querySelector('.cc-header-close') as HTMLButtonElement;
    const submitButton = document.createElement('button');
    submitButton.textContent = 'Submit pre-chat form';
    submitButton.tabIndex = 0;
    const preChatInput = document.createElement('input');
    preChatInput.type = 'text';
    preChatInput.tabIndex = 0;
    const preChatForm = document.createElement('form');
    preChatForm.className = 'cc-prechat-fields';
    preChatForm.append(preChatInput, submitButton);
    panel.messagesContainer.appendChild(preChatForm);
    closeButton.focus();

    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    closeButton.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(root.activeElement).toBe(root.querySelector('.cc-panel textarea'));
  });

  it('recomputes focusable elements after they are added or removed', () => {
    const panel = createPanel();
    panel.show();
    const closeButton = root.querySelector('.cc-header-close') as HTMLButtonElement;
    const textarea = root.querySelector('.cc-panel textarea') as HTMLTextAreaElement;
    const retryButton = document.createElement('button');
    retryButton.textContent = 'Retry';
    retryButton.tabIndex = 0;
    root.querySelector('.cc-panel')?.appendChild(retryButton);

    textarea.focus();
    const tabFromTextarea = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    textarea.dispatchEvent(tabFromTextarea);
    expect(tabFromTextarea.defaultPrevented).toBe(false);

    retryButton.focus();
    const tabFromRetry = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    retryButton.dispatchEvent(tabFromRetry);
    expect(tabFromRetry.defaultPrevented).toBe(true);
    expect(root.activeElement).toBe(closeButton);

    retryButton.remove();
    textarea.focus();
    const tabAfterRetryIsRemoved = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    });
    textarea.dispatchEvent(tabAfterRetryIsRemoved);
    expect(tabAfterRetryIsRemoved.defaultPrevented).toBe(true);
    expect(root.activeElement).toBe(closeButton);
  });

  it('does not trap focus in a closed popup', () => {
    createPanel();
    const textarea = root.querySelector('.cc-panel textarea') as HTMLTextAreaElement;
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    textarea.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it('leaves the inline panel as it was', () => {
    const onClose = vi.fn();
    const panel = createPanel({ inline: true, onClose });
    const el = root.querySelector('.cc-panel') as HTMLElement;
    expect(el.id).toBe('');
    expect(el.hasAttribute('role')).toBe(false);
    expect(el.hasAttribute('aria-modal')).toBe(false);
    expect(el.hasAttribute('inert')).toBe(false);
    expect(el.hasAttribute('aria-hidden')).toBe(false);

    panel.show();
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onClose).not.toHaveBeenCalled();

    const textarea = root.querySelector('.cc-panel textarea') as HTMLTextAreaElement;
    textarea.focus();
    const tabEvent = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    textarea.dispatchEvent(tabEvent);
    expect(tabEvent.defaultPrevented).toBe(false);
  });

  it('renders avatar placeholder when no avatar URL', () => {
    createPanel();
    expect(root.querySelector('.cc-header-avatar-placeholder')).toBeTruthy();
    expect(root.querySelector('.cc-header-avatar')).toBeNull();
  });

  it('renders avatar image when URL provided', () => {
    createPanel({ branding: { name: 'Bot', subtitle: 'Online', avatar: 'https://example.com/avatar.png' } });
    const img = root.querySelector('.cc-header-avatar') as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.src).toBe('https://example.com/avatar.png');
  });
});
