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
          locale: 'de',
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
      locale: 'de',
    });
  });

  it('leaves out what the tag does not set', () => {
    const config = configFromScript(script({ apiUrl: '/api/chat' }));
    expect(config).toMatchObject({ apiUrl: '/api/chat', mode: undefined, container: undefined, welcomeBubble: undefined, autoOpen: undefined });
  });
});
