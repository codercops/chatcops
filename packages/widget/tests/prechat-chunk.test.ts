import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Widget, loadPreChatForm, prefetch } from '../src/widget.js';

const preChatForm = { enabled: true, fields: [{ name: 'name', label: 'Name', type: 'text' as const }] };
const shadow = () => document.querySelector('#chatcops-root')?.shadowRoot ?? null;

let widget: Widget | undefined;
beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  widget?.destroy();
  widget = undefined;
  vi.restoreAllMocks();
});

describe('the pre-chat form chunk', () => {
  it('shows the form once its chunk has loaded, with its styles added once', async () => {
    widget = new Widget({ apiUrl: 'https://api.test/chat', preChatForm, nonce: 'request-nonce' });
    widget.init();
    widget.open();
    await vi.dynamicImportSettled();

    expect(shadow()?.querySelector('.cc-prechat')).not.toBeNull();
    expect(shadow()?.querySelectorAll('style[data-cc-prechat]')).toHaveLength(1);
    expect(Array.from(shadow()?.querySelectorAll('style') ?? [], (style) => style.nonce)).toEqual(['request-nonce', 'request-nonce']);
    // The input stays hidden until the form is sent.
    expect(shadow()?.querySelector('.cc-input-area')?.classList.contains('cc-hidden')).toBe(true);
  });

  it('shows an inline form at mount', async () => {
    const box = document.createElement('div');
    box.id = 'box';
    document.body.appendChild(box);
    widget = new Widget({ apiUrl: 'https://api.test/chat', mode: 'inline', container: '#box', preChatForm });
    widget.init();
    await vi.dynamicImportSettled();

    expect(box.querySelector('#chatcops-root')?.shadowRoot?.querySelector('.cc-prechat')).not.toBeNull();
  });

  it('adds nothing when the widget is destroyed while the form loads', async () => {
    widget = new Widget({ apiUrl: 'https://api.test/chat', preChatForm });
    widget.init();
    widget.open();
    widget.destroy();
    await vi.dynamicImportSettled();
    expect(document.querySelector('.cc-prechat')).toBeNull();
    widget = undefined;
  });

  it('is only fetched by widgets with the form on', async () => {
    expect(prefetch({ apiUrl: '/chat' })).toBeUndefined();
    await expect(loadPreChatForm()).resolves.toHaveProperty('PreChatForm');
    // Loaded once and shared.
    expect(loadPreChatForm()).toBe(loadPreChatForm());
  });
});

describe('a pre-chat form chunk that fails to load', () => {
  it('logs it and opens the chat without the form, and the next widget tries again', async () => {
    vi.resetModules();
    vi.doMock('../src/dom/prechat-form.js', () => {
      throw new Error('Failed to fetch dynamically imported module');
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fresh = await import('../src/widget.js');
    const failing = new fresh.Widget({ apiUrl: 'https://api.test/chat', preChatForm });
    failing.init();
    failing.open();
    await vi.dynamicImportSettled();
    await new Promise((done) => setTimeout(done, 0));

    // Vitest rewrites a throwing mock's message, so only the prefix is checked.
    expect(error).toHaveBeenCalledWith('[chatcops] The pre-chat form could not load:', expect.any(String));
    expect(shadow()?.querySelector('.cc-prechat')).toBeNull();
    expect(shadow()?.querySelector('.cc-input-area')?.classList.contains('cc-hidden')).toBe(false);
    expect(shadow()?.querySelector('.cc-message-assistant')?.textContent).toContain('How can I help you today?');
    failing.destroy();

    vi.doUnmock('../src/dom/prechat-form.js');
    await expect(fresh.loadPreChatForm()).resolves.toHaveProperty('PreChatForm');
    vi.resetModules();
  });
});

describe('the built panel chunks (dist/chunks)', () => {
  const dist = resolve(__dirname, '../dist');
  const chunks = readdirSync(resolve(dist, 'chunks'));

  it('has the pre-chat form and Turnstile, imported by the panel relative to itself', () => {
    const panel = readFileSync(resolve(dist, 'chatcops.panel.js'), 'utf-8');
    for (const name of ['prechat-form', 'turnstile']) {
      const chunk = chunks.find((file) => file.startsWith(`${name}-`));
      expect(chunk).toBeDefined();
      expect(panel).toContain(`import("./chunks/${chunk}")`);
    }
  });

  it('imports nothing at runtime, so a chunk can never load a second copy of the panel', () => {
    for (const file of chunks) {
      const code = readFileSync(resolve(dist, 'chunks', file), 'utf-8');
      expect(code, file).not.toMatch(/\bimport\s*[("{*]|\bfrom\s*["']/);
    }
  });
});
