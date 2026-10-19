---
"@chatcops/widget": patch
---

The closed popup panel and the hidden welcome bubble are out of the tab order and hidden from screen readers. Escape closes the open popup and moves focus back to the launcher, which now has `aria-expanded` and `aria-controls`, and the panel is a labeled dialog.
