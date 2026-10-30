import { renderMarkdown } from '../markdown.js';

const RETRY_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M17.65 6.35A7.96 7.96 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>';
const REGENERATE_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46A7.93 7.93 0 0020 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74A7.93 7.93 0 004 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/></svg>';
const COPY_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>';

export type MessageStatus = 'streaming' | 'complete' | 'error';
export type MessageErrorType = 'rate_limit' | 'network' | 'provider_error' | 'timeout' | 'budget' | 'budget_daily' | 'unavailable' | 'cut_off';

export interface MessageData {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  status?: MessageStatus;
  errorType?: MessageErrorType;
  /** Shown under the content when a reply fails after some of it already streamed. */
  errorText?: string;
  sources?: Array<{ url: string; title?: string }>;
}

export interface MessageActions {
  onRetry?: (messageId: string) => void;
  onRegenerate?: (messageId: string) => void;
  retryLabel?: string;
  regenerateLabel?: string;
  typingLabel?: string;
  sourcesLabel?: string;
  copyLabel?: string;
  copySuccessLabel?: string;
  copyFailureLabel?: string;
}

/** How close to the bottom (px) the log has to be for new text to scroll it. */
const FOLLOW_SLACK = 48;
/**
 * Least time between renders of a streaming reply. Each render repaints the
 * log, so 20 a second looks live without repainting on every frame.
 */
const STREAM_INTERVAL_MS = 50;

/**
 * A reply that's streaming. The text up to the last blank line outside a code
 * fence is rendered once, into its own block, and never touched again; only
 * the open block after it re-renders, at most 20 times a second. That keeps
 * a long reply O(n) instead of re-rendering all of it on every chunk.
 */
interface Stream {
  text: string;
  /** Where the open block starts in `text`. */
  committed: number;
  tail: HTMLElement;
  frame?: number;
  /** When it last rendered (`performance.now()`). */
  renderedAt: number;
}

export class Messages {
  private container: HTMLDivElement;
  private streams = new Map<string, Stream>();
  private streamIntervalMs: number;
  private announcement: HTMLDivElement;
  private typingEl: HTMLDivElement | null = null;
  private suggestionsEl: HTMLDivElement | null = null;
  private disclosureEl: HTMLElement | null = null;
  private actions?: MessageActions;
  private announcementVersion = 0;

  constructor(parent: HTMLElement, actions?: MessageActions, options: { streamIntervalMs?: number } = {}) {
    this.actions = actions;
    this.streamIntervalMs = options.streamIntervalMs ?? STREAM_INTERVAL_MS;
    this.container = document.createElement('div');
    this.container.className = 'cc-messages';
    this.container.setAttribute('role', 'log');
    this.container.setAttribute('aria-live', 'polite');
    parent.appendChild(this.container);

    this.announcement = document.createElement('div');
    this.announcement.className = 'cc-reply-announcement cc-sr-only';
    this.announcement.setAttribute('aria-live', 'polite');
    this.announcement.setAttribute('aria-atomic', 'true');
    parent.appendChild(this.announcement);
  }

  beginReply(): void {
    this.announcementVersion++;
    this.announcement.textContent = '';
    this.container.setAttribute('aria-live', 'off');
  }

  finishReply(msg?: MessageData): void {
    if (msg?.role === 'assistant' && (msg.status === 'complete' || msg.status === 'error')) {
      this.announcementVersion++;
      const rendered = this.findMessage(msg.id);
      const content = rendered?.querySelector('.cc-message-content')?.textContent?.trim() ?? '';
      const error = rendered?.querySelector('.cc-message-error-note')?.textContent?.trim() ?? '';
      this.announcement.textContent = [content, error && error !== content ? error : ''].filter(Boolean).join(' ');
    }
    this.container.setAttribute('aria-live', 'polite');
  }

  addMessage(msg: MessageData): HTMLDivElement {
    // The visitor's own message always brings the log down; a reply only
    // when they haven't scrolled up to read.
    const follow = msg.role === 'user' || this.nearBottom();
    this.removeTyping();
    if (msg.role === 'user') this.removeSuggestions();
    const el = this.createMessageElement(msg);
    this.container.appendChild(el);
    if (follow) this.scrollToBottom();
    return el;
  }

  updateMessage(msg: MessageData): void {
    const el = this.findMessage(msg.id);
    if (!el) return;
    if (msg.role === 'assistant' && msg.status === 'streaming' && el.dataset.status === 'streaming') {
      this.stream(el, msg);
      return;
    }
    this.endStream(msg.id);
    const follow = this.nearBottom();
    this.renderMessageElement(el, msg);
    if (follow) this.scrollToBottom();
  }

  /** Takes the reply's text so far, and renders what changed on the next frame. */
  private stream(el: HTMLDivElement, msg: MessageData): void {
    let stream = this.streams.get(msg.id);
    if (!stream || !appended(stream.text, msg.content)) {
      this.endStream(msg.id);
      const content = el.querySelector('.cc-message-content');
      if (!content) return;
      content.innerHTML = '';
      const tail = document.createElement('div');
      tail.className = 'cc-stream-tail';
      content.appendChild(tail);
      stream = { text: msg.content, committed: 0, tail, renderedAt: 0 };
      this.streams.set(msg.id, stream);
      // The first text shows at once; what follows is batched per frame.
      this.renderStream(stream);
      return;
    }
    stream.text = msg.content;
    if (stream.frame === undefined) this.schedule(stream);
  }

  /** Renders on the next frame that's at least the interval after the last render. */
  private schedule(stream: Stream): void {
    stream.frame = nextFrame(() => {
      stream.frame = undefined;
      if (performance.now() - stream.renderedAt < this.streamIntervalMs) this.schedule(stream);
      else this.renderStream(stream);
    });
  }

  private renderStream(stream: Stream): void {
    stream.renderedAt = performance.now();
    const follow = this.nearBottom();
    const boundary = lastBlockBoundary(stream.text, stream.committed);
    if (boundary > stream.committed) {
      // Its own block, so the browser keeps its layout while the tail changes.
      // The renderer writes paragraphs as text and <br>, which would otherwise
      // make the whole reply one run of lines laid out again every frame.
      stream.tail.insertAdjacentHTML('beforebegin', `<div class="cc-block">${renderMarkdown(stream.text.slice(stream.committed, boundary))}</div>`);
      stream.committed = boundary;
    }
    stream.tail.innerHTML = renderMarkdown(stream.text.slice(stream.committed));
    if (follow) this.scrollToBottom();
  }

  private endStream(id: string): void {
    const stream = this.streams.get(id);
    if (stream?.frame !== undefined) cancelFrame(stream.frame);
    this.streams.delete(id);
  }

  private nearBottom(): boolean {
    const { scrollHeight, scrollTop, clientHeight } = this.container;
    return scrollHeight - scrollTop - clientHeight <= FOLLOW_SLACK;
  }

  showTyping(): void {
    if (this.typingEl) return;
    this.typingEl = document.createElement('div');
    this.typingEl.className = 'cc-typing';
    this.typingEl.innerHTML = `<span class="cc-sr-only">${this.escapeHtml(this.actions?.typingLabel ?? 'Typing...')}</span><div class="cc-typing-dot" aria-hidden="true"></div><div class="cc-typing-dot" aria-hidden="true"></div><div class="cc-typing-dot" aria-hidden="true"></div>`;
    this.container.appendChild(this.typingEl);
    this.scrollToBottom();
  }

  removeTyping(): void {
    if (this.typingEl) {
      this.typingEl.remove();
      this.typingEl = null;
    }
  }

  showSuggestions(suggestions: string[], label: string, onSelect: (suggestion: string) => void): void {
    this.removeSuggestions();
    if (suggestions.length === 0) return;

    const group = document.createElement('div');
    group.className = 'cc-suggestions';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', label);
    for (const suggestion of suggestions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'cc-suggestion';
      button.textContent = suggestion;
      button.addEventListener('click', () => onSelect(suggestion));
      group.appendChild(button);
    }
    this.container.appendChild(group);
    this.suggestionsEl = group;
  }

  removeSuggestions(): void {
    this.suggestionsEl?.remove();
    this.suggestionsEl = null;
  }

  clear(): void {
    this.announcementVersion++;
    for (const id of [...this.streams.keys()]) this.endStream(id);
    this.container.innerHTML = '';
    this.typingEl = null;
    // A new conversation starts with the disclosure too.
    if (this.disclosureEl) this.container.prepend(this.disclosureEl);
  }

  /**
   * The note that visitors are talking to an AI, always first in the log.
   * Only http(s) links become a "Learn more" link.
   */
  setDisclosure(text?: string, learnMore?: { url: string; label: string }): void {
    this.disclosureEl?.remove();
    this.disclosureEl = null;
    if (!text) return;
    const note = document.createElement('div');
    note.className = 'cc-disclosure';
    note.setAttribute('role', 'note');
    note.textContent = text;
    if (learnMore && /^https?:\/\//i.test(learnMore.url)) {
      const link = document.createElement('a');
      link.href = learnMore.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = learnMore.label;
      note.append(' ', link);
    }
    this.disclosureEl = note;
    this.container.prepend(note);
  }

  removeMessage(id: string): void {
    this.endStream(id);
    const el = this.findMessage(id);
    el?.remove();
  }

  clearRegenerateButtons(): void {
    this.container.querySelectorAll('.cc-message-regenerate').forEach((button) => {
      button.remove();
    });
    this.cleanupEmptyActionContainers();
  }

  showRegenerateButton(messageId: string): void {
    this.clearRegenerateButtons();

    if (!this.actions?.onRegenerate) return;

    const msgEl = this.findMessage(messageId);
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

  private findMessage(id: string): HTMLDivElement | null {
    const found = Array.from(this.container.children).find((el) => (el as HTMLElement).dataset.id === id);
    return (found as HTMLDivElement | undefined) ?? null;
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
    if (msg.role === 'assistant' && msg.id !== 'welcome') {
      el.dataset.aiGenerated = 'true';
    }

    if (msg.status) {
      el.dataset.status = msg.status;
    } else {
      delete el.dataset.status;
    }

    if (msg.status === 'streaming') {
      el.setAttribute('aria-busy', 'true');
    } else {
      el.removeAttribute('aria-busy');
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

    if (msg.role === 'assistant' && Array.isArray(msg.sources) && msg.sources.length > 0) {
      const safeUrls = msg.sources.filter((s) => typeof s.url === 'string' && (s.url.startsWith('http://') || s.url.startsWith('https://')));
      if (safeUrls.length > 0) {
        const nav = document.createElement('nav');
        nav.className = 'cc-message-sources';
        nav.setAttribute('aria-label', this.actions?.sourcesLabel ?? 'Sources');
        const ol = document.createElement('ol');
        for (const source of safeUrls) {
          const li = document.createElement('li');
          const a = document.createElement('a');
          a.href = source.url;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          try {
            a.textContent = source.title ?? new URL(source.url).hostname;
          } catch {
            a.textContent = source.title ?? source.url;
          }
          li.appendChild(a);
          ol.appendChild(li);
        }
        nav.appendChild(ol);
        el.appendChild(nav);
      }
    }

    if (msg.status === 'error' && msg.errorText) {
      const note = document.createElement('div');
      note.className = 'cc-message-error-note';
      note.textContent = msg.errorText;
      el.appendChild(note);
    }

    const actions = this.createActionsContainer(msg);
    if (actions) {
      el.appendChild(actions);
    }
  }

  private createActionsContainer(msg: MessageData): HTMLDivElement | null {
    const canCopy = msg.role === 'assistant' && msg.id !== 'welcome' && msg.status !== 'streaming' && msg.status !== 'error' && msg.content.trim() !== '';
    const canRetry = msg.status === 'error' && this.actions?.onRetry;
    if (!canCopy && !canRetry) {
      return null;
    }

    const actions = document.createElement('div');
    actions.className = 'cc-message-actions';
    if (canCopy) {
      actions.appendChild(this.createActionButton({
        className: 'cc-message-copy',
        label: this.actions?.copyLabel ?? 'Copy reply',
        icon: COPY_ICON,
        onClick: () => this.copyReply(msg.id),
      }));
    }
    if (canRetry) {
      actions.appendChild(this.createActionButton({
        className: 'cc-message-retry',
        label: this.actions?.retryLabel ?? 'Retry',
        icon: RETRY_ICON,
        onClick: () => this.actions?.onRetry?.(msg.id),
      }));
    }
    return actions;
  }

  /** Start the clipboard write in the click handler so it keeps user activation. */
  private copyReply(messageId: string): void {
    const content = this.findMessage(messageId)?.querySelector<HTMLElement>('.cc-message-content');
    const text = content ? readableText(content) : '';
    const version = this.announcementVersion;
    const announce = (message: string) => {
      if (version === this.announcementVersion) this.announcement.textContent = message;
    };

    try {
      const clipboard = navigator.clipboard;
      if (!clipboard?.writeText || !text) {
        announce(this.actions?.copyFailureLabel ?? 'Could not copy reply.');
        return;
      }
      Promise.resolve(clipboard.writeText(text)).then(
        () => announce(this.actions?.copySuccessLabel ?? 'Reply copied.'),
        () => announce(this.actions?.copyFailureLabel ?? 'Could not copy reply.'),
      );
    } catch {
      announce(this.actions?.copyFailureLabel ?? 'Could not copy reply.');
    }
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

function readableText(element: HTMLElement): string {
  if (typeof element.innerText === 'string') return element.innerText.trim();

  let text = '';
  const blockTags = new Set(['BLOCKQUOTE', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'OL', 'P', 'PRE', 'UL']);
  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? '';
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = (node as Element).tagName;
    if (tag === 'BR') {
      text += '\n';
      return;
    }
    const isBlock = blockTags.has(tag);
    if (isBlock && text && !text.endsWith('\n')) text += '\n';
    node.childNodes.forEach(visit);
    if (isBlock && !text.endsWith('\n')) text += '\n';
  };
  visit(element);
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Where the open block starts: just after the last blank line (and any more
 * newlines) that isn't inside a ``` fence, scanning from `from`, which is
 * itself outside a fence.
 */
export function lastBlockBoundary(text: string, from: number): number {
  let inFence = false;
  let last = from;
  let i = from;
  while (i < text.length) {
    if (text.startsWith('```', i)) {
      inFence = !inFence;
      i += 3;
    } else if (!inFence && text.startsWith('\n\n', i)) {
      i += 2;
      while (text[i] === '\n') i++;
      last = i;
    } else {
      i++;
    }
  }
  return last;
}

/** Whether `next` is `previous` with more text after it. Checks the end only, so it stays cheap on long replies. */
function appended(previous: string, next: string): boolean {
  if (next.length < previous.length) return false;
  const from = Math.max(0, previous.length - 32);
  return next.slice(from, previous.length) === previous.slice(from);
}

const nextFrame = (fn: () => void): number =>
  typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : (setTimeout(fn, 16) as unknown as number);
const cancelFrame = (id: number): void => (typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame(id) : clearTimeout(id));
