---
"@chatcops/widget": minor
---

Light, dark and auto themes. `theme.mode` (`data-theme-mode`) is `auto` by default and follows the visitor's system setting, switching live; `light` and `dark` pin one. `theme.accentDark` (`data-accent-dark`) sets a separate accent for dark mode.

**This changes how existing sites look:** the widget used to be dark everywhere, and is now light on light systems. Set `theme.mode: 'dark'` to keep the old look, which is exactly the dark preset. A config that sets `bgColor` or `textColor` without `mode` keeps the mode its colors were made for, so custom dark themes don't turn into light text on light panels. Errors and code blocks now use the `--cc-danger`, `--cc-code-bg` and `--cc-pre-bg` tokens.
