export type { LocaleStrings } from './types.js';
export { en } from './en.js';
export { es } from './es.js';
export { hi } from './hi.js';
export { fr } from './fr.js';
export { de } from './de.js';
export { ja } from './ja.js';
export { zh } from './zh.js';
export { ar } from './ar.js';

import type { LocaleStrings } from './types.js';
import { en } from './en.js';
import { es } from './es.js';
import { hi } from './hi.js';
import { fr } from './fr.js';
import { de } from './de.js';
import { ja } from './ja.js';
import { zh } from './zh.js';
import { ar } from './ar.js';

const locales: Record<string, LocaleStrings> = { en, es, hi, fr, de, ja, zh, ar };

export function getLocale(code: string): LocaleStrings {
  return locales[code] ?? en;
}

export function getAvailableLocales(): string[] {
  return Object.keys(locales);
}
