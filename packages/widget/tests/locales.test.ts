import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getWidgetLocale, type WidgetLocaleStrings } from '../src/i18n.js';

const en = getWidgetLocale('en');
const dir = resolve(__dirname, '../src/locales');
const codes = readdirSync(dir)
  .filter((file) => file.endsWith('.ts'))
  .map((file) => file.slice(0, -3));
const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();

describe('widget translations (src/locales)', () => {
  it('are named by a lowercase language code', () => {
    for (const code of codes) expect(code, `${code}.ts`).toMatch(/^[a-z]{2,3}$/);
  });

  it.each(codes)('%s has only known keys, keeps the placeholders, and imports nothing at runtime', async (code) => {
    const source = readFileSync(resolve(dir, `${code}.ts`), 'utf-8');
    expect(source.replace(/import type[^;]+;/g, '')).not.toMatch(/^\s*import\s/m);

    const strings = ((await import(`../src/locales/${code}.ts`)) as { default: Partial<WidgetLocaleStrings> }).default;
    for (const [key, value] of Object.entries(strings)) {
      expect(Object.keys(en), `unknown key ${key}`).toContain(key);
      expect(typeof value, key).toBe('string');
      expect((value as string).trim(), key).not.toBe('');
      expect(placeholders(value as string), key).toEqual(placeholders(en[key as keyof WidgetLocaleStrings]));
    }
    const missing = Object.keys(en).filter((key) => !(key in strings));
    // Missing keys fall back to English. Listed so a reviewer sees them.
    if (missing.length > 0) console.warn(`[locales] ${code} falls back to English for: ${missing.join(', ')}`);
  });

  it('are each built to dist/locales/<code>.js', () => {
    for (const code of codes) {
      const built = resolve(__dirname, `../dist/locales/${code}.js`);
      expect(existsSync(built), `dist/locales/${code}.js`).toBe(true);
      expect(readFileSync(built, 'utf-8')).not.toMatch(/\bimport\s*[("{*]|\bfrom\s*["']/);
    }
  });
});
