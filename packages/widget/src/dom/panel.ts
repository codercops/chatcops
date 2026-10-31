import { Messages, type MessageActions, type MessageData } from './messages.js';
import { Input } from './input.js';
import { CLOSE_ICON, MORE_ICON } from './icons.js';
import type { HeaderMenu } from './menu.js';

export const PANEL_ID = 'cc-panel';

const BOT_ICON = `<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/></svg>`;

let menuChunk: Promise<typeof import('./menu.js')> | undefined;

export function loadMenu(): Promise<typeof import('./menu.js')> {
  menuChunk ??= import('./menu.js').catch((error: unknown) => {
    menuChunk = undefined;
    throw error;
  });
  return menuChunk;
}

export interface PanelOptions {
  position: 'bottom-right' | 'bottom-left';
  inline?: boolean;
  preChatEnabled?: boolean;
  branding: {
    name: string;
    avatar?: string;
    subtitle: string;
  };
  placeholder: string;
  footerText: string;
  closeLabel: string;
  sendLabel: string;
  stopLabel: string;
  moreLabel?: string;
  newConversationLabel?: string;
  downloadTranscriptLabel?: string;
  privacyLabel?: string;
  privacyUrl?: string;
  messageActions?: MessageActions;
  onSend: (text: string) => void;
  onStop: () => void;
  onClose: () => void;
  onNewConversation?: () => void;
  onDownloadTranscript?: () => void;
}

/** The parts of the panel that `update()` can change. */
export type PanelLabels = Pick<
  PanelOptions,
  | 'branding'
  | 'placeholder'
  | 'footerText'
  | 'closeLabel'
  | 'sendLabel'
  | 'stopLabel'
  | 'moreLabel'
  | 'newConversationLabel'
  | 'downloadTranscriptLabel'
  | 'privacyLabel'
  | 'privacyUrl'
>;

export class Panel {
  private el: HTMLDivElement;
  private inline: boolean;
  private options: PanelOptions;
  private header: HTMLDivElement;
  private footer: HTMLDivElement;
  private moreBtn: HTMLButtonElement | null = null;
  private headerMenu: HeaderMenu | null = null;
  messages: Messages;
  input: Input;
  messagesContainer: HTMLElement;

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
    if (!options.inline) {
      this.el.id = PANEL_ID;
      this.el.setAttribute('role', 'dialog');
      this.el.setAttribute('aria-modal', 'true');
      this.el.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          if (this.headerMenu?.isOpen) {
            this.headerMenu.close();
            this.moreBtn?.focus();
            return;
          }
          options.onClose();
          return;
        }
        if (e.key !== 'Tab' || this.el.hasAttribute('inert')) return;

        const focusable = Array.from(this.el.querySelectorAll<HTMLElement>('*')).filter(
          (element) =>
            element.tabIndex >= 0 &&
            !element.matches(':disabled') &&
            !element.closest('[hidden], [inert], [aria-hidden="true"], .cc-hidden'),
        );
        if (focusable.length === 0) {
          e.preventDefault();
          return;
        }

        const activeElement = (this.el.getRootNode() as ShadowRoot).activeElement;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && (activeElement === first || !this.el.contains(activeElement))) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (activeElement === last || !this.el.contains(activeElement))) {
          e.preventDefault();
          first.focus();
        }
      });
      this.setHidden(true);
    }

    this.options = options;
    this.header = document.createElement('div');
    this.header.className = 'cc-header';
    this.renderHeader();
    this.el.appendChild(this.header);

    this.el.addEventListener('pointerdown', (e) => {
      if (this.headerMenu?.isOpen && !this.header.contains(e.target as Node)) {
        this.headerMenu.close();
      }
    });

    if (options.preChatEnabled) {
      this.messagesContainer = document.createElement('div');
      this.messagesContainer.className = 'cc-messages-wrapper';
      this.el.appendChild(this.messagesContainer);
    } else {
      this.messagesContainer = this.el;
    }
    this.messages = new Messages(this.messagesContainer, options.messageActions);

    // Input
    this.input = new Input(this.el, {
      placeholder: options.placeholder,
      sendLabel: options.sendLabel,
      stopLabel: options.stopLabel,
      onSend: options.onSend,
      onStop: options.onStop,
    });

    // Footer
    this.footer = document.createElement('div');
    this.footer.className = 'cc-footer';
    this.footer.innerHTML = options.footerText;
    this.el.appendChild(this.footer);

    root.appendChild(this.el);
  }

  /** New wording or branding, applied in place. */
  update(labels: PanelLabels, actionLabels?: Partial<MessageActions>): void {
    Object.assign(this.options, labels);
    // Messages reads its labels from this same object as it renders.
    if (this.options.messageActions) Object.assign(this.options.messageActions, actionLabels);
    this.renderHeader();
    this.headerMenu?.update(labels);
    this.input.setLabels(labels.placeholder, labels.sendLabel, labels.stopLabel);
    this.footer.innerHTML = labels.footerText;
  }

  private renderHeader(): void {
    const { branding, closeLabel, inline, onClose } = this.options;
    const active = (this.el.getRootNode() as ShadowRoot | Document).activeElement;
    const moreHadFocus = this.moreBtn && (this.moreBtn === active || this.headerMenu?.el.contains(active));
    const closeHadFocus = !inline && this.header.contains(active) && !moreHadFocus;

    this.header.replaceChildren();
    if (!inline) this.el.setAttribute('aria-label', branding.name);

    if (branding.avatar) {
      const img = document.createElement('img');
      img.className = 'cc-header-avatar';
      img.src = branding.avatar;
      img.alt = branding.name;
      this.header.appendChild(img);
    } else {
      const placeholder = document.createElement('div');
      placeholder.className = 'cc-header-avatar-placeholder';
      placeholder.innerHTML = BOT_ICON;
      this.header.appendChild(placeholder);
    }

    const info = document.createElement('div');
    info.className = 'cc-header-info';
    info.innerHTML = `<div class="cc-header-name">${this.escapeHtml(branding.name)}</div><div class="cc-header-subtitle">${this.escapeHtml(branding.subtitle)}</div>`;
    this.header.appendChild(info);

    const moreBtn = document.createElement('button');
    moreBtn.className = 'cc-header-more';
    moreBtn.setAttribute('aria-haspopup', 'menu');
    moreBtn.setAttribute('aria-expanded', 'false');
    moreBtn.setAttribute('aria-label', this.options.moreLabel ?? 'More options');
    moreBtn.innerHTML = MORE_ICON;
    this.moreBtn = moreBtn;

    const load = (e: Event) => {
      void loadMenu().then(({ attachMenu }) => {
        this.headerMenu = attachMenu(moreBtn, this.header, this.options, e, this.headerMenu);
      });
    };
    moreBtn.onclick = load;
    moreBtn.onkeydown = load;
    moreBtn.onpointerenter = () => void loadMenu();

    this.header.appendChild(moreBtn);
    if (this.headerMenu) {
      this.headerMenu.setButton(moreBtn);
      this.header.appendChild(this.headerMenu.el);
    }

    if (!inline) {
      const closeBtn = document.createElement('button');
      closeBtn.className = 'cc-header-close';
      closeBtn.setAttribute('aria-label', closeLabel);
      closeBtn.innerHTML = CLOSE_ICON;
      closeBtn.addEventListener('click', onClose);
      this.header.appendChild(closeBtn);
      if (closeHadFocus) closeBtn.focus();
    }

    if (moreHadFocus) moreBtn.focus();
  }

  show(): void {
    this.el.classList.add('cc-visible');
    if (!this.inline) {
      this.setHidden(false);
      this.input.focus();
    }
  }

  hide(): void {
    this.headerMenu?.close();
    this.el.classList.remove('cc-visible');
    if (!this.inline) this.setHidden(true);
  }

  containsFocus(): boolean {
    return this.el.contains((this.el.getRootNode() as ShadowRoot).activeElement);
  }

  get isVisible(): boolean {
    return this.el.classList.contains('cc-visible');
  }

  addMessage(msg: MessageData): HTMLDivElement {
    return this.messages.addMessage(msg);
  }

  /** The conversation and the input together; the pre-chat form and the consent notice replace them. */
  setBodyVisible(visible: boolean): void {
    this.messages.setVisible(visible);
    this.input.setVisible(visible);
  }

  destroy(): void {
    this.headerMenu?.close();
    this.el.remove();
  }

  // A closed popup can't be focused or read by screen readers.
  private setHidden(hidden: boolean): void {
    this.el.toggleAttribute('inert', hidden);
    if (hidden) this.el.setAttribute('aria-hidden', 'true');
    else this.el.removeAttribute('aria-hidden');
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
