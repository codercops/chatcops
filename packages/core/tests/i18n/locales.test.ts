import { describe, it, expect } from 'vitest';
import { getLocale, getAvailableLocales } from '../../src/i18n/index.js';
import { en } from '../../src/i18n/en.js';
import type { LocaleStrings } from '../../src/i18n/types.js';

describe('i18n', () => {
  it('returns English as default locale', () => {
    const locale = getLocale('en');
    expect(locale.welcomeMessage).toBe(en.welcomeMessage);
    expect(locale.sendButton).toBe('Send');
  });

  it('returns English for unknown locale', () => {
    const locale = getLocale('xx');
    expect(locale).toEqual(en);
  });

  it('returns Spanish locale', () => {
    const locale = getLocale('es');
    expect(locale.sendButton).toBe('Enviar');
  });

  it('returns Hindi locale', () => {
    const locale = getLocale('hi');
    expect(locale.sendButton).toBe('Bhejen');
  });

  it('lists available locales', () => {
    const locales = getAvailableLocales();
    expect(locales).toContain('en');
    expect(locales).toContain('es');
    expect(locales).toContain('hi');
    expect(locales).toContain('fr');
    expect(locales).toContain('de');
    expect(locales).toContain('ja');
    expect(locales).toContain('zh');
    expect(locales).toContain('ar');
    expect(locales.length).toBe(8);
  });

  it('all locales have all required keys', () => {
    const requiredKeys: (keyof LocaleStrings)[] = [
      'welcomeMessage', 'inputPlaceholder', 'sendButton', 'closeButton',
      'errorGeneric', 'errorNetwork', 'errorRateLimit', 'typingIndicator',
      'poweredBy', 'newConversation', 'welcomeBubbleDefault',
    ];

    for (const code of getAvailableLocales()) {
      const locale = getLocale(code);
      for (const key of requiredKeys) {
        expect(locale[key], `${code}.${key}`).toBeTruthy();
      }
    }
  });
});
