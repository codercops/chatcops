import { describe, expect, it } from 'vitest';
import { configFromScript } from '../src/script-config.js';

function script(data: Record<string, string>): HTMLScriptElement {
  const el = document.createElement('script');
  Object.assign(el.dataset, data);
  return el;
}

describe('configFromScript', () => {
  it('needs data-api-url', () => {
    expect(configFromScript(script({ mode: 'inline' }))).toBeUndefined();
  });

  it('reads every data attribute the widget takes', () => {
    expect(
      configFromScript(
        script({
          apiUrl: 'https://api.test/chat',
          mode: 'inline',
          container: '#box',
          turnstileSiteKey: '0x4AAA',
          userToken: 'signed.user.token',
          accent: '#16a34a',
          textColor: '#111111',
          bgColor: '#fafafa',
          fontFamily: 'Inter',
          borderRadius: '8',
          position: 'bottom-left',
          brandName: 'Acme',
          brandAvatar: 'https://acme.test/a.png',
          brandSubtitle: 'Here to help',
          welcomeMessage: 'Hi!',
          welcomeBubble: 'Need help?',
          welcomeBubbleDelay: '1500',
          autoOpen: '2000',
          placeholder: 'Ask me',
          disclosureText: 'Acme Bot is an AI.',
          disclosureUrl: 'https://acme.test/ai',
          locale: 'de',
          dir: 'rtl',
          persistence: 'session',
          historyTtlDays: '7',
        })
      )
    ).toEqual({
      apiUrl: 'https://api.test/chat',
      mode: 'inline',
      container: '#box',
      turnstileSiteKey: '0x4AAA',
      userToken: 'signed.user.token',
      theme: { accent: '#16a34a', textColor: '#111111', bgColor: '#fafafa', fontFamily: 'Inter', borderRadius: '8', position: 'bottom-left' },
      branding: { name: 'Acme', avatar: 'https://acme.test/a.png', subtitle: 'Here to help' },
      welcomeMessage: 'Hi!',
      welcomeBubble: { text: 'Need help?', delay: 1500 },
      autoOpen: 2000,
      placeholder: 'Ask me',
      disclosure: { text: 'Acme Bot is an AI.', learnMoreUrl: 'https://acme.test/ai' },
      locale: 'de',
      dir: 'rtl',
      persistence: 'session',
      historyTtlDays: 7,
    });
  });

  it.each([
    ['mode', 'popup'],
    ['mode', 'inline'],
    ['themeMode', 'light'],
    ['themeMode', 'dark'],
    ['themeMode', 'auto'],
    ['position', 'bottom-right'],
    ['position', 'bottom-left'],
  ])('accepts documented %s value %s', (attribute, value) => {
    const config = configFromScript(script({ apiUrl: '/api/chat', [attribute]: value }));

    if (attribute === 'mode') expect(config?.mode).toBe(value);
    if (attribute === 'themeMode') expect(config?.theme.mode).toBe(value);
    if (attribute === 'position') expect(config?.theme.position).toBe(value);
  });

  it.each([
    ['mode', 'modal'],
    ['themeMode', 'system'],
    ['position', 'center'],
  ])('ignores invalid %s value %s and leaves the documented default unset', (attribute, value) => {
    const config = configFromScript(script({ apiUrl: '/api/chat', [attribute]: value }));

    if (attribute === 'mode') expect(config?.mode).toBeUndefined();
    if (attribute === 'themeMode') expect(config?.theme.mode).toBeUndefined();
    if (attribute === 'position') expect(config?.theme.position).toBeUndefined();
  });

  it('ignores a persistence mode or history length it does not know', () => {
    const config = configFromScript(script({ apiUrl: '/api/chat', persistence: 'cookie', historyTtlDays: 'forever' }));
    expect(config?.persistence).toBeUndefined();
    expect(config?.historyTtlDays).toBeUndefined();
  });

  it.each([
    ['true', true],
    ['false', false],
    ['0', 0],
    ['2000', 2000],
    ['2147483647', 2_147_483_647],
    ['2147483648', undefined],
    ['999999999999999999999999999999', undefined],
    ['1.5', undefined],
    ['', true],
  ])('parses data-auto-open="%s" as %s', (autoOpen, expected) => {
    expect(configFromScript(script({ apiUrl: '/api/chat', autoOpen }))?.autoOpen).toBe(expected);
  });

  it.each([
    ['3000', 3000],
    ['3s', undefined],
    ['1.5', undefined],
    ['', undefined],
  ])('reads data-welcome-bubble-delay="%s" as %s', (welcomeBubbleDelay, delay) => {
    const config = configFromScript(script({ apiUrl: '/api/chat', welcomeBubble: 'Need help?', welcomeBubbleDelay }));
    expect(config?.welcomeBubble).toEqual({ text: 'Need help?', delay });
  });

  it('turns the AI disclosure off with data-disclosure="false"', () => {
    expect(configFromScript(script({ apiUrl: '/api/chat', disclosure: 'false' }))?.disclosure).toBe(false);
    expect(configFromScript(script({ apiUrl: '/api/chat', disclosure: 'yes' }))?.disclosure).toEqual({ text: undefined, learnMoreUrl: undefined });
  });

  it('leaves out what the tag does not set', () => {
    const config = configFromScript(script({ apiUrl: '/api/chat' }));
    expect(config).toMatchObject({ apiUrl: '/api/chat', mode: undefined, container: undefined, welcomeBubble: undefined, autoOpen: undefined });
  });

  it('reads the nonce property from a script tag', () => {
    const tag = script({ apiUrl: '/api/chat' });
    tag.nonce = 'request-nonce';
    expect(configFromScript(tag)?.nonce).toBe('request-nonce');
  });
});
