let loading: Promise<unknown> | undefined;

/**
 * A Cloudflare Turnstile token, for the server to check before it issues a
 * session. Cloudflare's script loads only when this first runs, and the
 * challenge renders in the page itself (not the widget's shadow root), in a
 * box that stays empty unless the visitor has to click.
 */
export async function turnstileToken(siteKey: string): Promise<string> {
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.onload = resolve;
    script.onerror = reject;
    document.head.append(script);
  });
  await loading;
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;bottom:96px;right:24px;z-index:2147483647';
  document.body.append(box);
  try {
    return await new Promise<string>((resolve, reject) => {
      (window as unknown as { turnstile: { render(box: HTMLElement, options: object): void } }).turnstile.render(box, {
        sitekey: siteKey,
        appearance: 'interaction-only',
        callback: resolve,
        'error-callback': reject,
      });
    });
  } finally {
    box.remove();
  }
}
