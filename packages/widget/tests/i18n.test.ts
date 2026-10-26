import { describe, expect, it } from 'vitest';
import { getWidgetLocale, type WidgetLocaleStrings } from '../src/i18n.js';
import hi from '../src/locales/hi.js';

const en = getWidgetLocale('en');

describe('Hindi widget locale', () => {
  it('provides a non-empty translation for every widget string', () => {
    for (const key of Object.keys(en) as Array<keyof WidgetLocaleStrings>) {
      expect(hi[key].trim(), key).not.toBe('');
    }
  });

  it('preserves the widget placeholders', () => {
    const placeholders = (value: string) => (value.match(/\{\w+\}/g) ?? []).sort();

    for (const key of Object.keys(en) as Array<keyof WidgetLocaleStrings>) {
      expect(placeholders(hi[key]), key).toEqual(placeholders(en[key]));
    }
  });

  it('falls back to English for an unknown locale code', () => {
    expect(getWidgetLocale('unknown')).toEqual(en);
  });
});
