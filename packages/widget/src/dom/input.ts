export interface InputOptions {
  placeholder: string;
  onSend: (text: string) => void;
}

export class Input {
  private area: HTMLDivElement;
  private textarea: HTMLTextAreaElement;
  private sendBtn: HTMLButtonElement;
  private onSend: (text: string) => void;

  constructor(parent: HTMLElement, options: InputOptions) {
    this.onSend = options.onSend;

    this.area = document.createElement('div');
    this.area.className = 'cc-input-area';

    this.textarea = document.createElement('textarea');
    this.textarea.className = 'cc-input';
    this.textarea.placeholder = options.placeholder;
    this.textarea.rows = 1;
    this.textarea.addEventListener('input', () => this.autoResize());
    this.textarea.addEventListener('keydown', (e) => this.handleKeydown(e));

    this.sendBtn = document.createElement('button');
    this.sendBtn.className = 'cc-send-btn';
    this.sendBtn.disabled = true;
    this.sendBtn.setAttribute('aria-label', 'Send message');
    this.sendBtn.innerHTML = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>';
    this.sendBtn.addEventListener('click', () => this.send());

    this.textarea.addEventListener('input', () => {
      this.sendBtn.disabled = this.textarea.value.trim().length === 0;
    });

    this.area.appendChild(this.textarea);
    this.area.appendChild(this.sendBtn);
    parent.appendChild(this.area);
  }

  focus(): void {
    this.textarea.focus();
  }

  setDisabled(disabled: boolean): void {
    this.textarea.disabled = disabled;
    this.sendBtn.disabled = disabled || this.textarea.value.trim().length === 0;
  }

  clear(): void {
    this.textarea.value = '';
    this.sendBtn.disabled = true;
    this.autoResize();
  }

  private send(): void {
    const text = this.textarea.value.trim();
    if (!text) return;
    this.onSend(text);
    this.clear();
  }

  private handleKeydown(e: KeyboardEvent): void {
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
