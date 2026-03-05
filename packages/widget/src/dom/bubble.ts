export interface BubbleOptions {
  text: string;
  delay?: number;
  showOnce?: boolean;
  position: 'bottom-right' | 'bottom-left';
  onClick: () => void;
}

const BUBBLE_SHOWN_KEY = 'chatcops_bubble_shown';

export class WelcomeBubble {
  private el: HTMLDivElement;
  private timerId: ReturnType<typeof setTimeout> | null = null;

  constructor(root: ShadowRoot, options: BubbleOptions) {
    this.el = document.createElement('div');
    this.el.className = 'cc-bubble';
    if (options.position === 'bottom-left') {
      this.el.classList.add('cc-left');
    }

    this.el.textContent = options.text;

    const closeBtn = document.createElement('button');
    closeBtn.className = 'cc-bubble-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.hide();
    });
    this.el.appendChild(closeBtn);

    this.el.addEventListener('click', () => {
      this.hide();
      options.onClick();
    });

    root.appendChild(this.el);

    if (options.showOnce) {
      try {
        if (sessionStorage.getItem(BUBBLE_SHOWN_KEY)) return;
        sessionStorage.setItem(BUBBLE_SHOWN_KEY, '1');
      } catch {
        // Ignore
      }
    }

    this.timerId = setTimeout(() => {
      this.el.classList.add('cc-visible');
    }, options.delay ?? 3000);
  }

  hide(): void {
    this.el.classList.remove('cc-visible');
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  destroy(): void {
    this.hide();
    this.el.remove();
  }
}
