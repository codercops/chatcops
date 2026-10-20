export interface BubbleOptions {
  text: string;
  delay?: number;
  showOnce?: boolean;
  position: 'bottom-right' | 'bottom-left';
  dismissLabel: string;
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
    this.setHidden(true);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'cc-bubble-close';
    closeBtn.setAttribute('aria-label', options.dismissLabel);
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
      this.setHidden(false);
    }, options.delay ?? 3000);
  }

  hide(): void {
    this.el.classList.remove('cc-visible');
    this.setHidden(true);
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  private setHidden(hidden: boolean): void {
    this.el.toggleAttribute('inert', hidden);
    if (hidden) this.el.setAttribute('aria-hidden', 'true');
    else this.el.removeAttribute('aria-hidden');
  }

  destroy(): void {
    this.hide();
    this.el.remove();
  }
}
