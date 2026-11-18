# Widget translations

One file per language, named by its language code (`de.ts`, `pt.ts`, `ja.ts`).
Each is built to `dist/locales/<code>.js`. The script tag loader fetches it
next to the panel when `locale` (or `data-locale`) asks for that language, and
bundler users import it from `@chatcops/widget/locales/<code>`.

```ts
import type { WidgetLocaleStrings } from '../i18n.js';

const de: Partial<WidgetLocaleStrings> = {
  welcomeMessage: 'Wie kann ich helfen?',
  // ...every key in WidgetLocaleStrings
};

export default de;
```

- Import types only. A runtime import would pull shared code into the file,
  and `tests/locales.test.ts` fails on it.
- Translate every key. A missing key falls back to English, and the test lists
  which ones are missing.
- Keep `{name}`, `{label}`, `{seconds}` and other placeholders as they are.
