---
"@chatcops/widget": minor
---

More of the widget API, on `window.ChatCops` (script tag builds) and the npm default export: `toggle()`, `sendMessage(text, { open? })` to send as the visitor from your own buttons, `newConversation()` to start fresh, `clear()` to also remove the saved transcript and pre-chat answers, `registerLocale(code, strings, { dir? })` for a language the widget doesn't ship, and `version`. With the script tag loader they work before the chat has loaded: the first call loads it. A reply still coming when the conversation is reset is stopped and never lands in the new one. `WidgetLocaleStrings` is exported for typing your strings.
