import { CHAT_ICON, CLOSE_ICON } from './icons.js';
import { PANEL_ID } from './panel.js';

export interface FABOptions {
  position: 'bottom-right' | 'bottom-left';
  openLabel: string;
  closeLabel: string;
  unreadLabel: string;
  onClick: () => void;
}

export class FAB {
  private el: HTMLButtonElement;
  private badge: HTMLDivElement;
  private openLabel: string;
  private closeLabel: string;
  private unreadLabel: string;

  constructor(root: ShadowRoot, options: FABOptions) {
    this.openLabel = options.openLabel;
    this.closeLabel = options.closeLabel;
    this.unreadLabel = options.unreadLabel;

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
    if (open) this.hideBadge();
    this.el.innerHTML = open ? CLOSE_ICON : CHAT_ICON;
    if (!open) this.el.appendChild(this.badge);
    this.el.classList.toggle('cc-open', open);
    this.el.setAttribute('aria-label', open ? this.closeLabel : this.openLabel);
    this.el.setAttribute('aria-expanded', String(open));
  }

  setLabels(openLabel: string, closeLabel: string, unreadLabel: string): void {
    this.openLabel = openLabel;
    this.closeLabel = closeLabel;
    this.unreadLabel = unreadLabel;
    const shown = this.badge.textContent;
    this.el.setAttribute(
      'aria-label',
      this.el.classList.contains('cc-open') ? closeLabel : shown ? `${openLabel}, ${unreadLabel.replace('{count}', shown)}` : openLabel
    );
  }

  focus(): void {
    this.el.focus();
  }

  showBadge(count = 1): void {
    if (count <= 0) {
      this.hideBadge();
      return;
    }
    const display = count > 9 ? '9+' : String(count);
    this.badge.textContent = display;
    if (!this.el.classList.contains('cc-open')) {
      const unread = this.unreadLabel.replace('{count}', display);
      this.el.setAttribute('aria-label', `${this.openLabel}, ${unread}`);
    }
    this.badge.classList.add('cc-visible');
  }

  hideBadge(): void {
    this.badge.classList.remove('cc-visible');
    this.badge.textContent = '';
    if (!this.el.classList.contains('cc-open')) {
      this.el.setAttribute('aria-label', this.openLabel);
    }
  }

  destroy(): void {
    this.el.remove();
  }
}
