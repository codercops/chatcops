import { renderMarkdown } from '../markdown.js';

const RETRY_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M17.65 6.35A7.96 7.96 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>';
const REGENERATE_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M17.65 6.35A7.96 7.96 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>';

export type MessageStatus = 'streaming' | 'complete' | 'error';
export type MessageErrorType = 'rate_limit' | 'network' | 'provider_error' | 'timeout';

export interface MessageData {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  status?: MessageStatus;
  errorType?: MessageErrorType;
}

export interface MessageActions {
  onRetry?: (messageId: string) => void;
  onRegenerate?: (messageId: string) => void;
  retryLabel?: string;
  regenerateLabel?: string;
}

export class Messages {
  private container: HTMLDivElement;
  private typingEl: HTMLDivElement | null = null;
  private actions?: MessageActions;

  constructor(parent: HTMLElement, actions?: MessageActions) {
    this.actions = actions;
    this.container = document.createElement('div');
    this.container.className = 'cc-messages';
    parent.appendChild(this.container);
  }

  addMessage(msg: MessageData): HTMLDivElement {
    this.removeTyping();
    const el = this.createMessageElement(msg);
    this.container.appendChild(el);
    this.scrollToBottom();
    return el;
  }

  updateMessage(msg: MessageData): void {
    const el = this.container.querySelector(`[data-id="${msg.id}"]`) as HTMLDivElement | null;
    if (el) {
      this.renderMessageElement(el, msg);
      this.scrollToBottom();
    }
  }

  showTyping(): void {
    if (this.typingEl) return;
    this.typingEl = document.createElement('div');
    this.typingEl.className = 'cc-typing';
    this.typingEl.innerHTML = '<div class="cc-typing-dot"></div><div class="cc-typing-dot"></div><div class="cc-typing-dot"></div>';
    this.container.appendChild(this.typingEl);
    this.scrollToBottom();
  }

  removeTyping(): void {
    if (this.typingEl) {
      this.typingEl.remove();
      this.typingEl = null;
    }
  }

  clear(): void {
    this.container.innerHTML = '';
    this.typingEl = null;
  }

  removeMessage(id: string): void {
    const el = this.container.querySelector(`[data-id="${id}"]`) as HTMLDivElement | null;
    el?.remove();
  }

  clearRegenerateButtons(): void {
    this.container.querySelectorAll('.cc-message-regenerate').forEach((button) => button.remove());
    this.cleanupEmptyActionContainers();
  }

  showRegenerateButton(messageId: string): void {
    this.clearRegenerateButtons();

    if (!this.actions?.onRegenerate) return;

    const msgEl = this.container.querySelector(`[data-id="${messageId}"]`) as HTMLDivElement | null;
    if (!msgEl || !msgEl.classList.contains('cc-message-assistant')) return;

    const actions = this.ensureActionsContainer(msgEl);
    actions.appendChild(this.createActionButton({
      className: 'cc-message-regenerate',
      label: this.actions.regenerateLabel ?? 'Regenerate',
      icon: REGENERATE_ICON,
      onClick: () => this.actions?.onRegenerate?.(messageId),
    }));
  }

  setVisible(visible: boolean): void {
    this.container.classList.toggle('cc-hidden', !visible);
  }

  private scrollToBottom(): void {
    this.container.scrollTop = this.container.scrollHeight;
  }

  private createMessageElement(msg: MessageData): HTMLDivElement {
    const el = document.createElement('div');
    this.renderMessageElement(el, msg);
    return el;
  }

  private renderMessageElement(el: HTMLDivElement, msg: MessageData): void {
    el.className = `cc-message cc-message-${msg.role}`;
    el.dataset.id = msg.id;

    if (msg.status) {
      el.dataset.status = msg.status;
    } else {
      delete el.dataset.status;
    }

    if (msg.errorType) {
      el.dataset.errorType = msg.errorType;
    } else {
      delete el.dataset.errorType;
    }

    el.innerHTML = '';

    const content = document.createElement('div');
    content.className = 'cc-message-content';
    content.innerHTML = msg.role === 'assistant' ? renderMarkdown(msg.content) : this.escapeHtml(msg.content);
    el.appendChild(content);

    const actions = this.createActionsContainer(msg);
    if (actions) {
      el.appendChild(actions);
    }
  }

  private createActionsContainer(msg: MessageData): HTMLDivElement | null {
    if (msg.status !== 'error' || !this.actions?.onRetry) {
      return null;
    }

    const actions = document.createElement('div');
    actions.className = 'cc-message-actions';
    actions.appendChild(this.createActionButton({
      className: 'cc-message-retry',
      label: this.actions.retryLabel ?? 'Retry',
      icon: RETRY_ICON,
      onClick: () => this.actions?.onRetry?.(msg.id),
    }));
    return actions;
  }

  private ensureActionsContainer(msgEl: HTMLDivElement): HTMLDivElement {
    const existing = msgEl.querySelector('.cc-message-actions') as HTMLDivElement | null;
    if (existing) {
      return existing;
    }

    const actions = document.createElement('div');
    actions.className = 'cc-message-actions';
    msgEl.appendChild(actions);
    return actions;
  }

  private cleanupEmptyActionContainers(): void {
    this.container.querySelectorAll('.cc-message-actions').forEach((container) => {
      if (!container.hasChildNodes()) {
        container.remove();
      }
    });
  }

  private createActionButton(options: {
    className: string;
    label: string;
    icon: string;
    onClick: () => void;
  }): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = options.className;
    button.innerHTML = `${options.icon}<span>${this.escapeHtml(options.label)}</span>`;
    button.addEventListener('click', options.onClick);
    return button;
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
