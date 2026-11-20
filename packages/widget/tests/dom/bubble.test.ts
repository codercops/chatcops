import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Widget } from '../../src/widget.js';
import { WelcomeBubble } from '../../src/dom/bubble.js';
import { keyStore } from '../../src/storage.js';

type WidgetInternals = {
  shadow: ShadowRoot;
};

const getShadow = (widget: Widget) => (widget as unknown as WidgetInternals).shadow;
const bubbleOf = (widget: Widget) => getShadow(widget).querySelector('.cc-bubble') as HTMLElement;

describe('WelcomeBubble', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    sessionStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('adds cc-left class for position: bottom-left', () => {
    const host = document.createElement('div');
    const root = host.attachShadow({ mode: 'open' });
    new WelcomeBubble(root, {
      text: 'Need help?',
      store: keyStore('local'),
      position: 'bottom-left',
      dismissLabel: 'Dismiss',
      onClick: vi.fn(),
    });
    const bubble = root.querySelector('.cc-bubble');
    expect(bubble?.classList.contains('cc-left')).toBe(true);

    const widget = new Widget({
      apiUrl: 'https://api.test/chat',
      theme: { position: 'bottom-left' },
      welcomeBubble: { text: 'Need help?', delay: 1000 },
    });
    widget.init();
    expect(bubbleOf(widget).classList.contains('cc-left')).toBe(true);
    widget.destroy();
  });

  it('stays hidden for the next widget with persistence: local once shown', () => {
    const first = new Widget({
      apiUrl: 'https://api.test/chat',
      persistence: 'local',
      welcomeBubble: { text: 'Need help?', delay: 1000 },
    });
    first.init();
    expect(bubbleOf(first).classList.contains('cc-visible')).toBe(false);

    vi.advanceTimersByTime(1000);
    expect(bubbleOf(first).classList.contains('cc-visible')).toBe(true);
    first.destroy();

    const second = new Widget({
      apiUrl: 'https://api.test/chat',
      persistence: 'local',
      welcomeBubble: { text: 'Need help?', delay: 1000 },
    });
    second.init();
    expect(bubbleOf(second).classList.contains('cc-visible')).toBe(false);

    vi.advanceTimersByTime(1000);
    expect(bubbleOf(second).classList.contains('cc-visible')).toBe(false);
    second.destroy();
  });

  it('stays hidden for the next widget with persistence: session once shown', () => {
    const first = new Widget({
      apiUrl: 'https://api.test/chat',
      persistence: 'session',
      welcomeBubble: { text: 'Need help?', delay: 1000 },
    });
    first.init();
    expect(bubbleOf(first).classList.contains('cc-visible')).toBe(false);

    vi.advanceTimersByTime(1000);
    expect(bubbleOf(first).classList.contains('cc-visible')).toBe(true);
    first.destroy();

    const second = new Widget({
      apiUrl: 'https://api.test/chat',
      persistence: 'session',
      welcomeBubble: { text: 'Need help?', delay: 1000 },
    });
    second.init();
    expect(bubbleOf(second).classList.contains('cc-visible')).toBe(false);

    vi.advanceTimersByTime(1000);
    expect(bubbleOf(second).classList.contains('cc-visible')).toBe(false);
    second.destroy();
  });

  it('shows the bubble again on every page load with persistence: none', () => {
    const first = new Widget({
      apiUrl: 'https://api.test/chat',
      persistence: 'none',
      welcomeBubble: { text: 'Need help?', delay: 1000 },
    });
    first.init();
    expect(bubbleOf(first).classList.contains('cc-visible')).toBe(false);

    vi.advanceTimersByTime(1000);
    expect(bubbleOf(first).classList.contains('cc-visible')).toBe(true);
    first.destroy();

    const second = new Widget({
      apiUrl: 'https://api.test/chat',
      persistence: 'none',
      welcomeBubble: { text: 'Need help?', delay: 1000 },
    });
    second.init();
    expect(bubbleOf(second).classList.contains('cc-visible')).toBe(false);

    vi.advanceTimersByTime(1000);
    expect(bubbleOf(second).classList.contains('cc-visible')).toBe(true);
    second.destroy();
  });
});
