import { afterEach, describe, expect, it, vi } from 'vitest';

type RenderOptions = { sitekey: string; appearance: string; callback(token: string): void; 'error-callback'(): void };

/** A fresh module each time, since it loads Cloudflare's script once per page. */
async function load() {
  vi.resetModules();
  return (await import('../../src/api/turnstile.js')).turnstileToken;
}

/**
 * Stands in for the browser loading Cloudflare's script, so nothing is
 * fetched: the script tag is kept, not added to the page.
 */
function serveScript(outcome: 'load' | 'error', render?: (box: HTMLElement, options: RenderOptions) => void) {
  const scripts: HTMLScriptElement[] = [];
  vi.spyOn(document.head, 'append').mockImplementation((...nodes) => {
    const script = nodes[0] as HTMLScriptElement;
    scripts.push(script);
    if (render) (window as unknown as { turnstile: unknown }).turnstile = { render };
    queueMicrotask(() => (outcome === 'load' ? script.onload : script.onerror)?.call(script, new Event(outcome)));
  });
  return scripts;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
  delete (window as unknown as { turnstile?: unknown }).turnstile;
});

describe('turnstileToken', () => {
  it('loads Cloudflare once, renders in the page and resolves with the token', async () => {
    const turnstileToken = await load();
    const render = vi.fn((box: HTMLElement, options: RenderOptions) => {
      expect(box.parentElement).toBe(document.body);
      queueMicrotask(() => options.callback(`token-${render.mock.calls.length}`));
    });
    const scripts = serveScript('load', render);

    expect(await turnstileToken('site-key')).toBe('token-1');
    expect(await turnstileToken('site-key')).toBe('token-2');

    expect(scripts).toHaveLength(1);
    expect(scripts[0].src).toBe('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit');
    expect(render.mock.calls[0][1]).toMatchObject({ sitekey: 'site-key', appearance: 'interaction-only' });
    // The box is gone once the token is in.
    expect(document.body.children).toHaveLength(0);
  });

  it('rejects when the challenge fails, and removes its box', async () => {
    const turnstileToken = await load();
    serveScript('load', (_box, options) => queueMicrotask(() => options['error-callback']()));
    await expect(turnstileToken('site-key')).rejects.toBeUndefined();
    expect(document.body.children).toHaveLength(0);
  });

  it("rejects when Cloudflare's script can't load", async () => {
    const turnstileToken = await load();
    serveScript('error');
    await expect(turnstileToken('site-key')).rejects.toBeInstanceOf(Event);
  });
});
