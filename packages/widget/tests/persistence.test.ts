import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Widget, type WidgetConfig } from '../src/widget.js';

type Internals = {
  shadow: ShadowRoot;
  messages: Array<{ id: string; role: string; content: string }>;
  conversationId: string;
  saveHistory(): void;
  handleSend(text: string): Promise<void>;
};
const internals = (widget: Widget) => widget as unknown as Internals;

/** Wraps both storages so every call is counted, then passes through. */
function countStorage() {
  const calls: string[] = [];
  const wrap = (name: string, target: Storage) => ({
    getItem(key: string) {
      calls.push(`${name}.get ${key}`);
      return target.getItem(key);
    },
    setItem(key: string, value: string) {
      calls.push(`${name}.set ${key}`);
      target.setItem(key, value);
    },
    removeItem(key: string) {
      calls.push(`${name}.remove ${key}`);
      target.removeItem(key);
    },
  });
  const local = localStorage;
  const session = sessionStorage;
  vi.stubGlobal('localStorage', wrap('local', local));
  vi.stubGlobal('sessionStorage', wrap('session', session));
  return { calls, local, session };
}

const saved = (id: string, content = 'Earlier question') =>
  JSON.stringify({
    id,
    messages: [{ id: 'm1', role: 'user', content, timestamp: Date.now() }],
    updatedAt: Date.now(),
  });

let widget: Widget | undefined;
const start = (config: Partial<WidgetConfig> = {}): Widget => {
  const created = new Widget({ apiUrl: 'https://api.test/chat', ...config });
  created.init();
  widget = created;
  return created;
};

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  widget?.destroy();
  widget = undefined;
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('widget persistence', () => {
  it('touches no storage when a popup is set up, only when it opens', () => {
    const { calls } = countStorage();
    const w = start({ welcomeBubble: { text: 'Need help?', delay: 60_000, showOnce: true } });
    expect(calls).toEqual([]);

    w.open();
    expect(calls).toContain('local.get chatcops_conversation');
  });

  it('reads the bubble flag when the bubble is due, not before', async () => {
    vi.useFakeTimers();
    const { calls } = countStorage();
    start({ welcomeBubble: { text: 'Need help?', delay: 1000, showOnce: true } });

    await vi.advanceTimersByTimeAsync(999);
    expect(calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toEqual(['local.get chatcops_bubble_shown', 'local.set chatcops_bubble_shown']);
  });

  it('restores a saved conversation on open', () => {
    localStorage.setItem('chatcops_conversation', saved('conv-1'));
    const w = start();
    expect(internals(w).messages.some((m) => m.content === 'Earlier question')).toBe(false);

    w.open();
    expect(internals(w).conversationId).toBe('conv-1');
    expect(internals(w).messages.some((m) => m.content === 'Earlier question')).toBe(true);
  });

  it('restores an inline chat at mount, since it is already on screen', () => {
    const box = document.createElement('div');
    box.id = 'box';
    document.body.appendChild(box);
    localStorage.setItem('chatcops_conversation', saved('conv-inline'));

    const w = start({ mode: 'inline', container: '#box' });
    expect(internals(w).conversationId).toBe('conv-inline');
  });

  it('adds a message sent before opening to the saved conversation', async () => {
    localStorage.setItem('chatcops_conversation', saved('conv-2'));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 500 }));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const w = start();

    await internals(w).handleSend('Another question');
    expect(internals(w).conversationId).toBe('conv-2');
    expect(internals(w).messages.map((m) => m.content)).toContain('Earlier question');
  });

  it('skips the pre-chat form for a saved conversation from before the form was recorded', async () => {
    localStorage.setItem('chatcops_conversation', saved('conv-old-version'));
    const w = start({ preChatForm: { enabled: true, fields: [{ name: 'name', label: 'Name', type: 'text' }] } });
    w.open();
    await vi.dynamicImportSettled();

    expect(internals(w).shadow.querySelector('.cc-panel')).not.toBeNull();
    expect(internals(w).shadow.querySelector('.cc-prechat')).toBeNull();
  });

  it("keeps a 'session' conversation in sessionStorage only", () => {
    const w = start({ persistence: 'session' });
    w.open();
    internals(w).saveHistory();

    expect(sessionStorage.getItem('chatcops_conversation')).not.toBeNull();
    expect(localStorage.getItem('chatcops_conversation')).toBeNull();
  });

  it('refuses persistHistory, which 1.0 removed, rather than saving what a site asked not to', () => {
    expect(() => new Widget({ apiUrl: '/chat', persistHistory: false } as never)).toThrow("Use persistence: 'none'");
  });

  it('stores nothing with persistence: none', () => {
    const config = { persistence: 'none' as const };
    const { calls } = countStorage();
    const w = start({ ...config, welcomeBubble: { text: 'Hi', delay: 0, showOnce: true } });
    w.open();
    internals(w).saveHistory();
    expect(calls).toEqual([]);
  });

  it('starts fresh when the saved conversation is older than historyTtlDays', () => {
    const old = JSON.parse(saved('conv-old')) as { updatedAt: number };
    old.updatedAt = Date.now() - 8 * 24 * 60 * 60 * 1000;
    localStorage.setItem('chatcops_conversation', JSON.stringify(old));

    const w = start({ historyTtlDays: 7 });
    w.open();
    expect(internals(w).conversationId).not.toBe('conv-old');
    expect(localStorage.getItem('chatcops_conversation')).toBeNull();
  });
});
