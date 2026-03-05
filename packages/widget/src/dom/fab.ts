const CHAT_ICON = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12z"/><path d="M7 9h10v2H7zm0-3h10v2H7z"/></svg>`;
const CLOSE_ICON = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"/></svg>`;

export interface FABOptions {
  position: 'bottom-right' | 'bottom-left';
  onClick: () => void;
}

export class FAB {
  private el: HTMLButtonElement;
  private badge: HTMLDivElement;
  private isOpen = false;

  constructor(root: ShadowRoot, options: FABOptions) {
    this.el = document.createElement('button');
    this.el.className = 'cc-fab cc-pulse';
    this.el.setAttribute('aria-label', 'Open chat');
    if (options.position === 'bottom-left') {
      this.el.classList.add('cc-left');
    }
    this.el.innerHTML = CHAT_ICON;

    this.badge = document.createElement('div');
    this.badge.className = 'cc-fab-badge';
    this.el.appendChild(this.badge);

    this.el.addEventListener('click', () => {
      this.el.classList.remove('cc-pulse');
      options.onClick();
    });

    root.appendChild(this.el);
  }

  setOpen(open: boolean): void {
    this.isOpen = open;
    this.el.innerHTML = open ? CLOSE_ICON : CHAT_ICON;
    if (!open) this.el.appendChild(this.badge);
    this.el.classList.toggle('cc-open', open);
    this.el.setAttribute('aria-label', open ? 'Close chat' : 'Open chat');
  }

  showBadge(): void {
    this.badge.classList.add('cc-visible');
  }

  hideBadge(): void {
    this.badge.classList.remove('cc-visible');
  }

  destroy(): void {
    this.el.remove();
  }
}
