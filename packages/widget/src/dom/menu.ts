import menuStyles from '../styles/menu.css?inline';

export interface HeaderMenuOptions {
  moreLabel?: string;
  newConversationLabel?: string;
  downloadTranscriptLabel?: string;
  privacyLabel?: string;
  privacyUrl?: string;
  onNewConversation?: () => void;
  onDownloadTranscript?: () => void;
}

export function safePrivacyUrl(url?: string): string | undefined {
  if (!url || typeof url !== 'string') return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.href;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function addMenuStyles(node: Node): void {
  const root = node.getRootNode();
  if (!(root instanceof ShadowRoot) || root.querySelector('style[data-cc-menu]')) return;
  const style = document.createElement('style');
  const existing = root.querySelector('style[nonce]') as HTMLStyleElement | null;
  if (existing?.nonce) style.nonce = existing.nonce;
  style.dataset.ccMenu = '';
  style.textContent = menuStyles;
  root.appendChild(style);
}

export class HeaderMenu {
  el: HTMLDivElement;
  private btn: HTMLButtonElement;
  private options: HeaderMenuOptions;

  constructor(button: HTMLButtonElement, options: HeaderMenuOptions) {
    this.btn = button;
    this.options = options;
    addMenuStyles(this.btn);

    const menu = document.createElement('div');
    menu.className = 'cc-header-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', options.moreLabel ?? 'More options');
    menu.setAttribute('hidden', '');
    this.el = menu;

    this.render();

    menu.addEventListener('click', (e) => {
      const item = (e.target as HTMLElement).closest<HTMLElement>('[role="menuitem"]');
      if (!item) return;
      this.close();
      const action = item.dataset.action;
      if (action === 'new') this.options.onNewConversation?.();
      else if (action === 'download') this.options.onDownloadTranscript?.();
    });

    menu.addEventListener('keydown', (e) => {
      const items = this.items;
      const idx = items.indexOf((menu.getRootNode() as ShadowRoot | Document).activeElement as HTMLElement);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        items[(idx + 1) % items.length]?.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        items[(idx - 1 + items.length) % items.length]?.focus();
      } else if (e.key === 'Home') {
        e.preventDefault();
        items[0]?.focus();
      } else if (e.key === 'End') {
        e.preventDefault();
        items[items.length - 1]?.focus();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.close();
        this.btn.focus();
      } else if (e.key === 'Tab') {
        this.close();
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        items[idx]?.click();
      }
    });
  }

  setButton(button: HTMLButtonElement): void {
    this.btn = button;
    this.btn.setAttribute('aria-haspopup', 'menu');
    this.btn.setAttribute('aria-expanded', String(this.isOpen));
  }

  get isOpen(): boolean {
    return !this.el.hasAttribute('hidden');
  }

  get items(): HTMLElement[] {
    return Array.from(this.el.querySelectorAll<HTMLElement>('[role="menuitem"]'));
  }

  open(focusLast = false): void {
    this.el.removeAttribute('hidden');
    this.btn.setAttribute('aria-expanded', 'true');
    const items = this.items;
    if (items.length > 0) {
      (focusLast ? items[items.length - 1] : items[0]).focus();
    }
  }

  close(): void {
    if (!this.isOpen) return;
    this.el.setAttribute('hidden', '');
    this.btn.setAttribute('aria-expanded', 'false');
  }

  update(options: Partial<HeaderMenuOptions>): void {
    Object.assign(this.options, options);
    this.render();
  }

  private render(): void {
    const {
      moreLabel = 'More options',
      newConversationLabel = 'New conversation',
      downloadTranscriptLabel = 'Download transcript',
      privacyLabel = 'Privacy',
      privacyUrl,
    } = this.options;
    this.el.setAttribute('aria-label', moreLabel);
    const validPrivacyUrl = safePrivacyUrl(privacyUrl);
    this.el.innerHTML =
      `<button type="button" role="menuitem" class="cc-menu-item" tabindex="-1" data-action="new">${this.escapeHtml(newConversationLabel)}</button>` +
      `<button type="button" role="menuitem" class="cc-menu-item" tabindex="-1" data-action="download">${this.escapeHtml(downloadTranscriptLabel)}</button>` +
      (validPrivacyUrl
        ? `<a role="menuitem" class="cc-menu-item" tabindex="-1" target="_blank" rel="noopener noreferrer" href="${this.escapeHtml(validPrivacyUrl)}">${this.escapeHtml(privacyLabel)}</a>`
        : '');
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

export function attachMenu(
  button: HTMLButtonElement,
  header: HTMLElement,
  options: HeaderMenuOptions,
  event?: Event,
  existingMenu?: HeaderMenu | null
): HeaderMenu {
  const menu = existingMenu ?? new HeaderMenu(button, options);
  menu.setButton(button);
  if (!header.contains(menu.el)) header.appendChild(menu.el);

  const openWithFocus = (focusLast?: boolean) => menu.open(focusLast);

  button.onclick = () => (menu.isOpen ? menu.close() : openWithFocus());
  button.onkeydown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openWithFocus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      openWithFocus(true);
    }
  };

  if (event) {
    if (event instanceof KeyboardEvent) {
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        openWithFocus(true);
      } else if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openWithFocus();
      }
    } else {
      openWithFocus();
    }
  }

  return menu;
}
