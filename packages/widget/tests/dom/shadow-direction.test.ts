import { beforeEach, describe, expect, it } from 'vitest';
import { createShadowRoot, resolveDirection } from '../../src/dom/shadow.js';

describe('shadow host direction', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.documentElement.dir = '';
  });

  it.each([
    ['rtl', 'en', 'rtl'],
    ['ltr', 'ar-EG', 'ltr'],
    [undefined, 'ar-EG', 'rtl'],
    [undefined, 'he', 'rtl'],
    [undefined, 'fa-IR', 'rtl'],
    [undefined, 'ur', 'rtl'],
    [undefined, 'en-US', 'ltr'],
  ])('resolves %j and %j to %s', (dir, locale, expected) => {
    expect(resolveDirection(dir as 'ltr' | 'rtl' | 'auto' | undefined, locale)).toBe(expected);
  });

  it('falls back to the document direction', () => {
    document.dir = 'rtl';
    const shadow = createShadowRoot(undefined, { locale: 'en' });
    expect(shadow.host.dir).toBe('rtl');
  });

  it('sets direction and language on the host', () => {
    const shadow = createShadowRoot(undefined, { dir: 'rtl', locale: 'ar-EG' });
    expect(shadow.host.getAttribute('dir')).toBe('rtl');
    expect(shadow.host.getAttribute('lang')).toBe('ar-EG');
  });
});
