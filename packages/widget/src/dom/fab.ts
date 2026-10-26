import { CHAT_ICON, CLOSE_ICON } from './icons.js';
import { PANEL_ID } from './panel.js';

export interface FABOptions {
  position: 'bottom-right' | 'bottom-left';
  openLabel: string;
  closeLabel: string;
  onClick: () => void;
}

export class FAB {
  private el: HTMLButtonElement;
  private badge: HTMLDivElement;
  private openLabel: string;
  private closeLabel: string;

  constructor(root: ShadowRoot, options: FABOptions) {
    this.openLabel = options.openLabel;
    this.closeLabel = options.closeLabel;

    this.el = document.createElement('button');
    this.el.className = 'cc-fab cc-pulse';
    this.el.setAttribute('aria-label', this.openLabel);
    this.el.setAttribute('aria-expanded', 'false');
    this.el.setAttribute('aria-controls', PANEL_ID);
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
    this.el.innerHTML = open ? CLOSE_ICON : CHAT_ICON;
    if (!open) this.el.appendChild(this.badge);
    this.el.classList.toggle('cc-open', open);
    this.el.setAttribute('aria-label', open ? this.closeLabel : this.openLabel);
    this.el.setAttribute('aria-expanded', String(open));
  }

  focus(): void {
    this.el.focus();
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
