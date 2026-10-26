---
"@chatcops/widget": minor
---

Translations can now ship as one file per language in `dist/locales/<code>.js`. The script tag loader fetches the file for `locale` (or `data-locale`) next to the panel, at the same time as the panel, and falls back to English with a warning when there's none. Bundler users import `@chatcops/widget/locales/<code>` and pass it as `strings`. A site's own `strings` still win over the translation. No languages ship yet; they're added one per pull request.
