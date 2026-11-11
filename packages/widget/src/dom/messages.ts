import { renderMarkdown } from '../markdown.js';

const svg = (d: string) => `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="${d}"/></svg>`;
const RETRY_ICON = svg('M17.65 6.35A7.96 7.96 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z');
const REGENERATE_ICON = svg('M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46A7.93 7.93 0 0020 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74A7.93 7.93 0 004 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z');
const COPY_ICON = svg('M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z');

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
  newReply?: string;
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
  private pill: HTMLButtonElement;

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

    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'cc-pill cc-hidden';
    pill.textContent = this.actions?.newReply ?? 'New reply ↓';
    pill.onclick = () => {
      if (matchMedia?.('(prefers-reduced-motion: reduce)')?.matches || !this.container.scrollTo) {
        this.scrollToBottom();
      } else {
        this.pill.classList.add('cc-hidden');
        this.container.scrollTo({ top: this.container.scrollHeight, behavior: 'smooth' });
      }
    };
    this.container.onscroll = () => {
      if (this.nearBottom()) pill.classList.add('cc-hidden');
    };
    parent.appendChild(pill);
    this.pill = pill;
  }

  beginReply(): void {
    this.announcementVersion++;
    this.announcement.textContent = '';
    this.container.setAttribute('aria-live', 'off');
  }

  finishReply(msg?: MessageData): void {
    if (msg?.role === 'assistant' && (msg.status === 'complete' || msg.status === 'error')) {
      this.announcementVersion++;
      const el = this.findMessage(msg.id);
      const c = el?.querySelector('.cc-message-content')?.textContent?.trim() ?? '';
      const e = el?.querySelector('.cc-message-error-note')?.textContent?.trim() ?? '';
      this.announcement.textContent = c && e && e !== c ? `${c} ${e}` : e || c;
    }
    this.container.setAttribute('aria-live', 'polite');
  }

  /** Puts a note under the visitor's message saying it is waiting to be sent (and announces it), or takes the note off. */
  setWaiting(id: string, note?: string): void {
    const el = this.findMessage(id);
    el?.querySelector('.cc-message-waiting')?.remove();
    if (!el || !note) return;
    const waiting = document.createElement('div');
    waiting.className = 'cc-message-waiting';
    waiting.textContent = note;
    el.appendChild(waiting);
    this.announcement.textContent = note;
  }

  addMessage(msg: MessageData): HTMLDivElement {
    // The visitor's own message always brings the log down; a reply only
    // when they haven't scrolled up to read.
    const follow = msg.role === 'user' || this.nearBottom();
    this.removeTyping();
    if (msg.role === 'user') this.removeSuggestions();
    const el = this.createMessageElement(msg);
    this.container.appendChild(el);
    follow ? this.scrollToBottom() : this.showPill();
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
    follow ? this.scrollToBottom() : this.showPill();
  }

  /** Takes the reply's text so far, and renders what changed on the next frame. */
  private stream(el: HTMLDivElement, msg: MessageData): void {
    let stream = this.streams.get(msg.id);
    if (!stream || !appended(stream.text, msg.content)) {
      this.endStream(msg.id);
      const content = el.querySelector('.cc-message-content');
      if (!content) return;
      const tail = document.createElement('div');
      tail.className = 'cc-stream-tail';
      content.replaceChildren(tail);
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
    follow ? this.scrollToBottom() : this.showPill();
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
    const dot = '<div class="cc-typing-dot" aria-hidden="true"></div>';
    this.typingEl = document.createElement('div');
    this.typingEl.className = 'cc-typing';
    this.typingEl.innerHTML = `<span class="cc-sr-only">${this.escapeHtml(this.actions?.typingLabel ?? 'Typing...')}</span>${dot}${dot}${dot}`;
    this.container.appendChild(this.typingEl);
    this.scrollToBottom();
  }

  removeTyping(): void {
    this.typingEl?.remove();
    this.typingEl = null;
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
      button.onclick = () => onSelect(suggestion);
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
    for (const id of this.streams.keys()) this.endStream(id);
    this.container.innerHTML = '';
    this.typingEl = null;
    this.pill.classList.add('cc-hidden');
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
    this.findMessage(id)?.remove();
  }

  clearRegenerateButtons(): void {
    this.container.querySelectorAll('.cc-message-regenerate').forEach((button) => {
      button.remove();
    });
    this.cleanupEmptyActionContainers();
  }

  showRegenerateButton(messageId: string): void {
    this.clearRegenerateButtons();
    const msgEl = this.findMessage(messageId);
    if (this.actions?.onRegenerate && msgEl?.classList.contains('cc-message-assistant')) {
      this.ensureActionsContainer(msgEl).appendChild(this.createActionButton(
        'cc-message-regenerate',
        this.actions.regenerateLabel ?? 'Regenerate',
        REGENERATE_ICON,
        () => this.actions?.onRegenerate?.(messageId),
      ));
    }
  }

  setVisible(visible: boolean): void {
    this.container.classList.toggle('cc-hidden', !visible);
    if (!visible) this.pill.classList.add('cc-hidden');
  }

  private showPill(): void {
    this.pill.classList.remove('cc-hidden');
  }

  private findMessage(id: string): HTMLDivElement | null {
    for (const el of this.container.children) {
      if ((el as HTMLElement).dataset?.id === id) return el as HTMLDivElement;
    }
    return null;
  }

  private scrollToBottom(): void {
    this.container.scrollTop = this.container.scrollHeight;
    this.pill.classList.add('cc-hidden');
  }

  private createMessageElement(msg: MessageData): HTMLDivElement {
    const el = document.createElement('div');
    this.renderMessageElement(el, msg);
    return el;
  }

  private renderMessageElement(el: HTMLDivElement, msg: MessageData): void {
    el.className = `cc-message cc-message-${msg.role}`;
    el.dataset.id = msg.id;
    if (msg.role === 'assistant' && msg.id !== 'welcome') el.dataset.aiGenerated = 'true';
    if (msg.status) el.dataset.status = msg.status;
    else delete el.dataset.status;
    if (msg.status === 'streaming') el.setAttribute('aria-busy', 'true');
    else el.removeAttribute('aria-busy');
    if (msg.errorType) el.dataset.errorType = msg.errorType;
    else delete el.dataset.errorType;

    el.innerHTML = '';

    const content = document.createElement('div');
    content.className = 'cc-message-content';
    content.innerHTML = msg.role === 'assistant' ? renderMarkdown(msg.content) : this.escapeHtml(msg.content);
    el.appendChild(content);

    if (msg.role === 'assistant' && msg.sources?.length) {
      const safeUrls = msg.sources.filter((s) => typeof s.url === 'string' && /^https?:\/\//i.test(s.url));
      if (safeUrls.length) {
        const nav = document.createElement('nav');
        nav.className = 'cc-message-sources';
        nav.setAttribute('aria-label', this.actions?.sourcesLabel ?? 'Sources');
        const ol = document.createElement('ol');
        for (const source of safeUrls) {
          const a = document.createElement('a');
          a.href = source.url;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          try {
            a.textContent = source.title ?? new URL(source.url).hostname;
          } catch {
            a.textContent = source.title ?? source.url;
          }
          const li = document.createElement('li');
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
    const canCopy = msg.role === 'assistant' && msg.id !== 'welcome' && msg.status !== 'streaming' && msg.status !== 'error' && msg.content.trim();
    const canRetry = msg.status === 'error' && this.actions?.onRetry;
    if (!canCopy && !canRetry) return null;

    const actions = document.createElement('div');
    actions.className = 'cc-message-actions';
    if (canCopy) {
      actions.appendChild(this.createActionButton(
        'cc-message-copy',
        this.actions?.copyLabel ?? 'Copy reply',
        COPY_ICON,
        () => this.copyReply(msg.id),
      ));
    }
    if (canRetry) {
      actions.appendChild(this.createActionButton(
        'cc-message-retry',
        this.actions?.retryLabel ?? 'Retry',
        RETRY_ICON,
        () => this.actions?.onRetry?.(msg.id),
      ));
    }
    return actions;
  }

  /** Start the clipboard write in the click handler so it keeps user activation. */
  private copyReply(messageId: string): void {
    const text = this.findMessage(messageId)?.querySelector<HTMLElement>('.cc-message-content')?.innerText.trim();
    const version = this.announcementVersion;
    const announce = (message: string) => {
      if (version === this.announcementVersion) this.announcement.textContent = message;
    };
    const fail = this.actions?.copyFailureLabel ?? 'Could not copy reply.';

    if (!text || !navigator.clipboard?.writeText) {
      announce(fail);
      return;
    }
    navigator.clipboard.writeText(text)
      .then(() => announce(this.actions?.copySuccessLabel ?? 'Reply copied.'))
      .catch(() => announce(fail));
  }

  private ensureActionsContainer(msgEl: HTMLDivElement): HTMLDivElement {
    let actions = msgEl.querySelector<HTMLDivElement>('.cc-message-actions');
    if (!actions) {
      actions = document.createElement('div');
      actions.className = 'cc-message-actions';
      msgEl.appendChild(actions);
    }
    return actions;
  }

  private cleanupEmptyActionContainers(): void {
    this.container.querySelectorAll('.cc-message-actions:empty').forEach((el) => {
      el.remove();
    });
  }

  private createActionButton(className: string, label: string, icon: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.innerHTML = `${icon}<span>${this.escapeHtml(label)}</span>`;
    button.onclick = onClick;
    return button;
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
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
function appended(prev: string, next: string): boolean {
  const from = Math.max(0, prev.length - 32);
  return next.length >= prev.length && next.slice(from, prev.length) === prev.slice(from);
}

const nextFrame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (fn: () => void) => setTimeout(fn, 16) as unknown as number;
const cancelFrame = typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : (id: number) => clearTimeout(id);
