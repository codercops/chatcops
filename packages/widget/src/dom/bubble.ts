import type { KeyStore } from '../storage.js';

export interface BubbleOptions {
  text: string;
  /** Where "already shown" is remembered, with the widget's persistence. */
  store: KeyStore;
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

    this.setHidden(true);

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'cc-bubble-trigger';
    trigger.textContent = options.text;
    trigger.addEventListener('click', () => {
      this.hide();
      options.onClick();
    });

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'cc-bubble-close';
    closeBtn.setAttribute('aria-label', options.dismissLabel);
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.hide();
    });
    this.el.append(trigger, closeBtn);

    root.appendChild(this.el);

    // Checked when the bubble is due, not before, so a page that never shows
    // it never touches storage.
    this.timerId = setTimeout(() => {
      if (options.showOnce) {
        if (options.store.get(BUBBLE_SHOWN_KEY)) return;
        options.store.set(BUBBLE_SHOWN_KEY, '1');
      }
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
