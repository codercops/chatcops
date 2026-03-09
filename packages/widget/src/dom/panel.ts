import { Messages, type MessageData } from './messages.js';
import { Input } from './input.js';

const BOT_ICON = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/></svg>`;
const CLOSE_ICON = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"/></svg>`;

export interface PanelOptions {
  position: 'bottom-right' | 'bottom-left';
  inline?: boolean;
  branding: {
    name: string;
    avatar?: string;
    subtitle: string;
  };
  placeholder: string;
  footerText: string;
  onSend: (text: string) => void;
  onClose: () => void;
}

export class Panel {
  private el: HTMLDivElement;
  private inline: boolean;
  messages: Messages;
  input: Input;

  constructor(root: ShadowRoot, options: PanelOptions) {
    this.inline = options.inline ?? false;
    this.el = document.createElement('div');
    this.el.className = 'cc-panel';
    if (options.inline) {
      this.el.classList.add('cc-inline');
    }
    if (options.position === 'bottom-left') {
      this.el.classList.add('cc-left');
    }

    // Header
    const header = document.createElement('div');
    header.className = 'cc-header';

    if (options.branding.avatar) {
      const img = document.createElement('img');
      img.className = 'cc-header-avatar';
      img.src = options.branding.avatar;
      img.alt = options.branding.name;
      header.appendChild(img);
    } else {
      const placeholder = document.createElement('div');
      placeholder.className = 'cc-header-avatar-placeholder';
      placeholder.innerHTML = BOT_ICON;
      header.appendChild(placeholder);
    }

    const info = document.createElement('div');
    info.className = 'cc-header-info';
    info.innerHTML = `<div class="cc-header-name">${this.escapeHtml(options.branding.name)}</div><div class="cc-header-subtitle">${this.escapeHtml(options.branding.subtitle)}</div>`;
    header.appendChild(info);

    if (!options.inline) {
      const closeBtn = document.createElement('button');
      closeBtn.className = 'cc-header-close';
      closeBtn.setAttribute('aria-label', 'Close chat');
      closeBtn.innerHTML = CLOSE_ICON;
      closeBtn.addEventListener('click', options.onClose);
      header.appendChild(closeBtn);
    }

    this.el.appendChild(header);

    // Messages
    this.messages = new Messages(this.el);

    // Input
    this.input = new Input(this.el, {
      placeholder: options.placeholder,
      onSend: options.onSend,
    });

    // Footer
    const footer = document.createElement('div');
    footer.className = 'cc-footer';
    footer.innerHTML = options.footerText;
    this.el.appendChild(footer);

    root.appendChild(this.el);
  }

  show(): void {
    this.el.classList.add('cc-visible');
    if (!this.inline) {
      this.input.focus();
    }
  }

  hide(): void {
    this.el.classList.remove('cc-visible');
  }

  get isVisible(): boolean {
    return this.el.classList.contains('cc-visible');
  }

  addMessage(msg: MessageData): HTMLDivElement {
    return this.messages.addMessage(msg);
  }

  destroy(): void {
    this.el.remove();
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
