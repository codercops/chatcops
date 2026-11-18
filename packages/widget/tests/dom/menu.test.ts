import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HeaderMenu, safePrivacyUrl } from '../../src/dom/menu.js';
import { Panel } from '../../src/dom/panel.js';
import { Widget } from '../../src/widget.js';

describe('HeaderMenu', () => {
  let root: ShadowRoot;
  let moreBtn: HTMLButtonElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    const host = document.createElement('div');
    document.body.appendChild(host);
    root = host.attachShadow({ mode: 'open' });
    moreBtn = document.createElement('button');
    moreBtn.className = 'cc-header-more';
    moreBtn.setAttribute('aria-haspopup', 'menu');
    moreBtn.setAttribute('aria-expanded', 'false');
    root.appendChild(moreBtn);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens and closes with aria-expanded and hidden attributes', () => {
    const menu = new HeaderMenu(moreBtn, {
      moreLabel: 'More options',
      newConversationLabel: 'New conversation',
      downloadTranscriptLabel: 'Download transcript',
      privacyLabel: 'Privacy',
    });
    root.appendChild(menu.el);

    expect(menu.el.getAttribute('role')).toBe('menu');
    expect(menu.isOpen).toBe(false);
    expect(moreBtn.getAttribute('aria-expanded')).toBe('false');

    menu.open();
    expect(menu.isOpen).toBe(true);
    expect(moreBtn.getAttribute('aria-expanded')).toBe('true');
    expect(root.activeElement).toBe(menu.items[0]);

    menu.close();
    expect(menu.isOpen).toBe(false);
    expect(moreBtn.getAttribute('aria-expanded')).toBe('false');
  });

  it('supports keyboard navigation with arrow keys, Home, End, Enter, Space and Escape', () => {
    const onNewConversation = vi.fn();
    const onDownloadTranscript = vi.fn();
    const menu = new HeaderMenu(moreBtn, {
      moreLabel: 'More options',
      newConversationLabel: 'New conversation',
      downloadTranscriptLabel: 'Download transcript',
      privacyLabel: 'Privacy',
      privacyUrl: 'https://example.com/privacy',
      onNewConversation,
      onDownloadTranscript,
    });
    root.appendChild(menu.el);
    menu.open();

    const items = menu.items;
    expect(items).toHaveLength(3);

    menu.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(root.activeElement).toBe(items[1]);

    menu.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(root.activeElement).toBe(items[2]);

    menu.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(root.activeElement).toBe(items[0]);

    menu.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(root.activeElement).toBe(items[2]);

    menu.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(root.activeElement).toBe(items[0]);

    menu.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onNewConversation).toHaveBeenCalledOnce();
    expect(menu.isOpen).toBe(false);

    menu.open();
    menu.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    menu.el.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(onDownloadTranscript).toHaveBeenCalledOnce();

    menu.open();
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    menu.el.dispatchEvent(event);
    expect(menu.isOpen).toBe(false);
    expect(root.activeElement).toBe(moreBtn);
  });

  it('only shows Privacy link with valid http/https URLs and never for javascript: URLs', () => {
    expect(safePrivacyUrl('https://example.com/privacy')).toBe('https://example.com/privacy');
    expect(safePrivacyUrl('http://example.com/privacy')).toBe('http://example.com/privacy');
    expect(safePrivacyUrl('javascript:alert(1)')).toBeUndefined();
    expect(safePrivacyUrl('data:text/html,x')).toBeUndefined();
    expect(safePrivacyUrl('')).toBeUndefined();

    const menu = new HeaderMenu(moreBtn, {
      moreLabel: 'More options',
      newConversationLabel: 'New conversation',
      downloadTranscriptLabel: 'Download transcript',
      privacyLabel: 'Privacy',
      privacyUrl: 'javascript:alert(1)',
    });
    root.appendChild(menu.el);
    expect(menu.el.querySelector('a')).toBeNull();

    menu.update({ privacyUrl: 'https://example.com/privacy' });
    const link = menu.el.querySelector('a') as HTMLAnchorElement;
    expect(link).not.toBeNull();
    expect(link.getAttribute('role')).toBe('menuitem');
    expect(link.getAttribute('href')).toBe('https://example.com/privacy');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });
});

describe('Panel header menu integration', () => {
  it('Escape closes menu only and restores focus to moreBtn without closing panel', async () => {
    document.body.innerHTML = '';
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: 'open' });

    const onClose = vi.fn();
    const panel = new Panel(root, {
      position: 'bottom-right',
      branding: { name: 'Bot', subtitle: 'Online' },
      placeholder: 'Type...',
      footerText: 'Powered by ChatCops',
      closeLabel: 'Close',
      sendLabel: 'Send',
      onSend: vi.fn(),
      onClose,
    });
    panel.show();

    const moreBtn = root.querySelector('.cc-header-more') as HTMLButtonElement;
    moreBtn.click();
    await vi.dynamicImportSettled();

    const menu = root.querySelector('.cc-header-menu');
    expect(menu?.hasAttribute('hidden')).toBe(false);

    const panelEl = root.querySelector('.cc-panel') as HTMLElement;
    panelEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(menu?.hasAttribute('hidden')).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    expect(root.activeElement).toBe(moreBtn);

    panelEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe('Widget menu actions', () => {
  let widget: Widget | undefined;

  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    sessionStorage.clear();
  });

  type Internals = {
    messages: Array<{ id: string; role: string; content: string }>;
    panel: { addMessage: (m: { id: string; role: string; content: string }) => void };
    downloadTranscript: () => void;
  };
  const internals = (w: Widget) => w as unknown as Internals;

  afterEach(() => {
    widget?.destroy();
    widget = undefined;
    vi.restoreAllMocks();
  });

  it('New conversation resets the log', async () => {
    widget = new Widget({ apiUrl: 'https://api.test/chat' });
    widget.init();
    widget.open();
    await vi.dynamicImportSettled();

    const shadow = document.querySelector('#chatcops-root')?.shadowRoot;
    const intern = internals(widget);
    intern.messages.push({ id: '1', role: 'user', content: 'Hello' });
    intern.panel.addMessage({ id: '1', role: 'user', content: 'Hello' });
    expect(shadow?.querySelectorAll('.cc-message-user')).toHaveLength(1);

    const moreBtn = shadow?.querySelector('.cc-header-more') as HTMLButtonElement;
    moreBtn.click();
    await vi.dynamicImportSettled();

    const newItem = shadow?.querySelector('[data-action="new"]') as HTMLElement;
    newItem.click();

    expect(shadow?.querySelectorAll('.cc-message-user')).toHaveLength(0);
    expect(intern.messages.filter((m) => m.role === 'user')).toHaveLength(0);
  });

  it('Download transcript creates a .txt file with the right text', async () => {
    widget = new Widget({ apiUrl: 'https://api.test/chat' });
    widget.init();
    widget.open();
    await vi.dynamicImportSettled();

    let capturedBlob: Blob | undefined;
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob: Blob) => {
      capturedBlob = blob;
      return 'blob:mock';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    let downloadedName = '';
    const originalClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      downloadedName = this.download;
    };

    try {
      const intern = internals(widget);
      intern.messages.push(
        { id: '1', role: 'user', content: 'Hello world' },
        { id: '2', role: 'assistant', content: 'Hi there!' }
      );
      intern.downloadTranscript();

      expect(downloadedName).toBe('transcript.txt');
      expect(capturedBlob).toBeDefined();
      const text = await capturedBlob?.text();
      expect(text).toBe('Assistant: How can I help you today?\n\nVisitor: Hello world\n\nAssistant: Hi there!');
    } finally {
      HTMLAnchorElement.prototype.click = originalClick;
    }
  });
});
