// Must match the message limit in packages/server/src/config.ts (chatRequestSchema).
const MAX_MESSAGE_LENGTH = 10_000;

const SEND_ICON = '<svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>';
const STOP_ICON = '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';

export interface InputOptions {
  placeholder: string;
  sendLabel: string;
  stopLabel: string;
  onSend: (text: string) => void;
  onStop: () => void;
}

export class Input {
  private area: HTMLDivElement;
  private textarea: HTMLTextAreaElement;
  private sendBtn: HTMLButtonElement;
  private onSend: (text: string) => void;
  private onStop: () => void;
  private sendLabel: string;
  private stopLabel: string;
  private streaming = false;

  constructor(parent: HTMLElement, options: InputOptions) {
    this.onSend = options.onSend;
    this.onStop = options.onStop;
    this.sendLabel = options.sendLabel;
    this.stopLabel = options.stopLabel;

    this.area = document.createElement('div');
    this.area.className = 'cc-input-area';

    this.textarea = document.createElement('textarea');
    this.textarea.className = 'cc-input';
    this.textarea.placeholder = options.placeholder;
    this.textarea.setAttribute('aria-label', options.placeholder);
    this.textarea.rows = 1;
    this.textarea.maxLength = MAX_MESSAGE_LENGTH;
    this.textarea.addEventListener('input', () => this.autoResize());
    this.textarea.addEventListener('keydown', (e) => this.handleKeydown(e));

    this.sendBtn = document.createElement('button');
    this.sendBtn.className = 'cc-send-btn';
    this.sendBtn.disabled = true;
    this.sendBtn.innerHTML = SEND_ICON;
    this.sendBtn.addEventListener('click', () => (this.streaming ? this.onStop() : this.send()));
    this.setLabels(options.placeholder, options.sendLabel, options.stopLabel);

    this.textarea.addEventListener('input', () => {
      this.sendBtn.disabled = this.textarea.value.trim().length === 0;
    });

    this.area.appendChild(this.textarea);
    this.area.appendChild(this.sendBtn);
    parent.appendChild(this.area);
  }

  setLabels(placeholder: string, sendLabel: string, stopLabel: string): void {
    this.textarea.placeholder = placeholder;
    this.textarea.setAttribute('aria-label', placeholder);
    this.sendLabel = sendLabel;
    this.stopLabel = stopLabel;
    this.sendBtn.setAttribute('aria-label', this.streaming ? stopLabel : sendLabel);
  }

  focus(): void {
    this.textarea.focus();
  }

  /** While a reply streams the text can't change and the send button is a Stop button. */
  setStreaming(streaming: boolean): void {
    this.streaming = streaming;
    this.textarea.disabled = streaming;
    this.sendBtn.disabled = !streaming && this.textarea.value.trim().length === 0;
    this.sendBtn.innerHTML = streaming ? STOP_ICON : SEND_ICON;
    this.sendBtn.setAttribute('aria-label', streaming ? this.stopLabel : this.sendLabel);
  }

  clear(): void {
    this.textarea.value = '';
    this.sendBtn.disabled = true;
    this.autoResize();
  }

  setVisible(visible: boolean): void {
    this.area.classList.toggle('cc-hidden', !visible);
  }

  private send(): void {
    const text = this.textarea.value.trim();
    if (!text) return;
    // Cleared first: onSend() starts the stream, which turns this button into an enabled Stop button.
    this.clear();
    this.onSend(text);
  }

  private handleKeydown(e: KeyboardEvent): void {
    // Safari may report isComposing as false when confirming an IME candidate.
    if (e.isComposing || e.keyCode === 229) return;

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.send();
    }
  }

  private autoResize(): void {
    this.textarea.style.height = 'auto';
    const maxHeight = 96; // 4 rows approx
    this.textarea.style.height = Math.min(this.textarea.scrollHeight, maxHeight) + 'px';
  }
}
