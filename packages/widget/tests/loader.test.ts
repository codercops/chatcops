import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLoader, panelUrlFor, type PanelModule } from '../src/loader/loader.js';
import { Widget } from '../src/widget.js';

/** The panel chunk, as the loader would import it, with a way to hold or fail the load. */
function panel() {
  let release: (() => void) | undefined;
  let held = false;
  let fail: Error | undefined;
  const load = vi.fn(
    () =>
      new Promise<PanelModule>((resolvePanel, reject) => {
        const done = () => (fail ? reject(fail) : resolvePanel({ Widget }));
        if (held) release = done;
        else done();
      })
  );
  return {
    load,
    hold: () => (held = true),
    release: () => release?.(),
    failWith: (error: Error) => (fail = error),
    succeed: () => (fail = undefined),
  };
}

const host = () => document.querySelector('#chatcops-root') as HTMLElement | null;
const shadow = () => host()?.shadowRoot ?? null;
const launcherButton = () => shadow()?.querySelector('.cc-fab') as HTMLButtonElement | null;
const settle = () => new Promise((resolveTick) => setTimeout(resolveTick, 0));

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('the script tag loader', () => {
  it('shows a launcher without loading the chat, touching storage or the network', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const fetch = vi.spyOn(globalThis, 'fetch');
    const { load } = panel();
    const loader = createLoader(load);

    loader.init({ apiUrl: 'https://api.test/chat', theme: { accent: '#16a34a', position: 'bottom-left' } });

    expect(launcherButton()).not.toBeNull();
    expect(launcherButton()?.getAttribute('aria-label')).toBe('Open chat');
    expect(launcherButton()?.classList.contains('cc-left')).toBe(true);
    expect(host()?.style.getPropertyValue('--cc-accent')).toBe('#16a34a');
    expect(shadow()?.querySelector('.cc-panel')).toBeNull();
    expect(load).not.toHaveBeenCalled();
    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    loader.destroy();
  });

  it('starts loading the chat when the launcher is hovered or focused', () => {
    const { load } = panel();
    const loader = createLoader(load);
    loader.init({ apiUrl: 'https://api.test/chat' });

    launcherButton()?.dispatchEvent(new Event('pointerenter'));
    expect(load).toHaveBeenCalledTimes(1);
    // Still the launcher: prefetching doesn't swap anything in.
    expect(shadow()?.querySelector('.cc-panel')).toBeNull();
    loader.destroy();
  });

  it('asks the chat to prefetch what the config needs once it has loaded on hover', async () => {
    const prefetch = vi.fn();
    const load = vi.fn(() => Promise.resolve({ Widget, prefetch }));
    const loader = createLoader(load);
    const config = { apiUrl: 'https://api.test/chat', preChatForm: { enabled: true, fields: [] } };
    loader.init(config);

    launcherButton()?.dispatchEvent(new Event('focus'));
    await settle();
    expect(prefetch).toHaveBeenCalledWith(config);
    loader.destroy();
  });

  it('swaps in the chat on click and opens it, with handlers registered before', async () => {
    const { load } = panel();
    const loader = createLoader(load);
    const opened = vi.fn();
    loader.on('open', opened);
    loader.init({ apiUrl: 'https://api.test/chat', strings: { openChat: 'Chat with us' } });
    expect(launcherButton()?.getAttribute('aria-label')).toBe('Chat with us');

    launcherButton()?.click();
    await settle();

    expect(document.querySelectorAll('.chatcops-root')).toHaveLength(1);
    expect(shadow()?.querySelector('.cc-panel.cc-visible')).not.toBeNull();
    expect(opened).toHaveBeenCalledTimes(1);
    loader.destroy();
    expect(document.querySelector('.chatcops-root')).toBeNull();
  });

  it('opens on open() and loads the chat only once for several calls', async () => {
    const { load } = panel();
    const loader = createLoader(load);
    loader.init({ apiUrl: 'https://api.test/chat' });

    loader.open();
    loader.open();
    await settle();

    expect(load).toHaveBeenCalledTimes(1);
    expect(shadow()?.querySelector('.cc-panel.cc-visible')).not.toBeNull();
    loader.close();
    expect(shadow()?.querySelector('.cc-panel.cc-visible')).toBeNull();
    loader.destroy();
  });

  it('loads an inline chat right away', async () => {
    const container = document.createElement('div');
    container.id = 'inline-box';
    document.body.appendChild(container);
    const { load } = panel();
    const loader = createLoader(load);

    loader.init({ apiUrl: 'https://api.test/chat', mode: 'inline', container: '#inline-box' });
    await settle();

    expect(load).toHaveBeenCalledTimes(1);
    expect(container.querySelector('#chatcops-root')?.shadowRoot?.querySelector('.cc-panel.cc-inline')).not.toBeNull();
    loader.destroy();
  });

  it('runs autoOpen itself, and the chat it loads does not open again', async () => {
    vi.useFakeTimers();
    const { load } = panel();
    const loader = createLoader(load);
    const opened = vi.fn();
    loader.on('open', opened);
    loader.init({ apiUrl: 'https://api.test/chat', autoOpen: 500 });

    await vi.advanceTimersByTimeAsync(499);
    expect(load).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(opened).toHaveBeenCalledTimes(1);

    loader.close();
    await vi.advanceTimersByTimeAsync(5000);
    expect(opened).toHaveBeenCalledTimes(1);
    loader.destroy();
  });

  it('loads the chat when the welcome bubble is due, and shows the bubble then', async () => {
    vi.useFakeTimers();
    const { load } = panel();
    const loader = createLoader(load);
    loader.init({ apiUrl: 'https://api.test/chat', welcomeBubble: { text: 'Need help?', delay: 2000 } });

    await vi.advanceTimersByTimeAsync(1999);
    expect(load).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(10);
    const bubble = shadow()?.querySelector('.cc-bubble');
    expect(bubble?.classList.contains('cc-visible')).toBe(true);
    expect(bubble?.textContent).toContain('Need help?');
    loader.destroy();
  });

  it('keeps the launcher and says so when the chat fails to load, then retries on the next click', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const chunk = panel();
    chunk.failWith(new Error('Failed to fetch dynamically imported module'));
    const loader = createLoader(chunk.load);
    loader.init({ apiUrl: 'https://api.test/chat' });

    launcherButton()?.click();
    await settle();

    expect(launcherButton()?.dataset.state).toBe('error');
    expect(launcherButton()?.getAttribute('aria-label')).toBe('Connection error. Please check your network.');
    expect(error).toHaveBeenCalledWith('[chatcops] The chat could not load:', 'Failed to fetch dynamically imported module');

    chunk.succeed();
    launcherButton()?.click();
    await settle();
    expect(shadow()?.querySelector('.cc-panel.cc-visible')).not.toBeNull();
    loader.destroy();
  });

  it('does nothing with a chat that finishes loading after destroy() or a new init()', async () => {
    const chunk = panel();
    chunk.hold();
    const loader = createLoader(chunk.load);
    loader.init({ apiUrl: 'https://api.test/chat', siteId: 'first' });
    loader.open();
    loader.destroy();
    chunk.release();
    await settle();
    expect(document.querySelector('.chatcops-root')).toBeNull();
  });

  it('removes handlers with off() or the function on() returns', async () => {
    const { load } = panel();
    const loader = createLoader(load);
    const kept = vi.fn();
    const removed = vi.fn();
    loader.on('open', kept);
    const unsubscribe = loader.on('open', removed);
    unsubscribe();
    loader.init({ apiUrl: 'https://api.test/chat' });
    loader.open();
    await settle();

    expect(kept).toHaveBeenCalledTimes(1);
    expect(removed).not.toHaveBeenCalled();
    loader.off('open', kept);
    loader.close();
    loader.open();
    expect(kept).toHaveBeenCalledTimes(1);
    loader.destroy();
  });
});

describe('panelUrlFor', () => {
  it.each([
    ['https://cdn.jsdelivr.net/npm/@chatcops/widget/dist/chatcops.min.js', 'https://cdn.jsdelivr.net/npm/@chatcops/widget/dist/chatcops.panel.js?v=0.7.0'],
    ['https://cdn.jsdelivr.net/npm/@chatcops/widget@0.7.0/dist/chatcops.min.js', 'https://cdn.jsdelivr.net/npm/@chatcops/widget@0.7.0/dist/chatcops.panel.js?v=0.7.0'],
    // The bare package URL a CDN serves the main file from.
    ['https://cdn.jsdelivr.net/npm/@chatcops/widget', 'https://cdn.jsdelivr.net/npm/@chatcops/widget/dist/chatcops.panel.js?v=0.7.0'],
    ['https://cdn.jsdelivr.net/npm/@chatcops/widget@0.7/', 'https://cdn.jsdelivr.net/npm/@chatcops/widget@0.7/dist/chatcops.panel.js?v=0.7.0'],
    ['https://unpkg.com/@chatcops/widget@0.7.0', 'https://unpkg.com/@chatcops/widget@0.7.0/dist/chatcops.panel.js?v=0.7.0'],
    // Self-hosted, renamed, with a cache-busting query.
    ['https://acme.test/assets/chat.js?v=3', 'https://acme.test/assets/chatcops.panel.js?v=0.7.0'],
  ])('%s', (loader, panelUrl) => {
    expect(panelUrlFor(loader, '0.7.0')).toBe(panelUrl);
  });
});

describe('the built loader (dist/chatcops.min.js)', () => {
  it('sets window.ChatCops and shows the launcher from the script tag alone', () => {
    const code = readFileSync(resolve(__dirname, '../dist/chatcops.min.js'), 'utf-8');
    const script = document.createElement('script');
    script.dataset.apiUrl = 'https://api.test/chat';
    // Not added to the page, so nothing tries to fetch it; currentScript is all the loader reads.
    script.src = 'https://cdn.test/npm/@chatcops/widget/dist/chatcops.min.js';
    Object.defineProperty(document, 'readyState', { value: 'complete', configurable: true });
    Object.defineProperty(document, 'currentScript', { value: script, configurable: true });

    window.eval(code);

    const api = (window as unknown as { ChatCops: Record<string, unknown> }).ChatCops;
    for (const method of ['init', 'open', 'close', 'destroy', 'on', 'off']) expect(typeof api[method]).toBe('function');
    expect(launcherButton()).not.toBeNull();
    // The panel URL carries this package's version, for caches (see panelUrlFor).
    const { version } = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf-8')) as { version: string };
    expect(code).toContain('chatcops.panel.js');
    expect(code).toContain(`"${version}"`);
    (api.destroy as () => void)();
    Object.defineProperty(document, 'currentScript', { value: null, configurable: true });
  });
});
