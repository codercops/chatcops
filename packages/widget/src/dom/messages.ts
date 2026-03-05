import { renderMarkdown } from '../markdown.js';

export interface MessageData {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export class Messages {
  private container: HTMLDivElement;
  private typingEl: HTMLDivElement | null = null;

  constructor(parent: HTMLElement) {
    this.container = document.createElement('div');
    this.container.className = 'cc-messages';
    parent.appendChild(this.container);
  }

  addMessage(msg: MessageData): HTMLDivElement {
    this.removeTyping();
    const el = document.createElement('div');
    el.className = `cc-message cc-message-${msg.role}`;
    el.dataset.id = msg.id;
    el.innerHTML = msg.role === 'assistant' ? renderMarkdown(msg.content) : this.escapeHtml(msg.content);
    this.container.appendChild(el);
    this.scrollToBottom();
    return el;
  }

  updateMessage(id: string, content: string, isAssistant: boolean): void {
    const el = this.container.querySelector(`[data-id="${id}"]`) as HTMLDivElement | null;
    if (el) {
      el.innerHTML = isAssistant ? renderMarkdown(content) : this.escapeHtml(content);
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

  private scrollToBottom(): void {
    this.container.scrollTop = this.container.scrollHeight;
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
