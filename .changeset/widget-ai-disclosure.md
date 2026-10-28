---
"@chatcops/widget": minor
---

The chat now starts with a note that the visitor is talking to an AI ("You're chatting with an AI assistant. It can make mistakes."), as the EU AI Act asks (Article 50). It's on by default, stays first in the log (also after a new conversation), and has `role="note"`. `disclosure: { text, learnMoreUrl }` (or `data-disclosure-text`, `data-disclosure-url`) changes the wording and adds a link; `disclosure: false` (`data-disclosure="false"`) removes it and logs a console notice that telling visitors is then up to you. New locale strings: `disclosure`, `disclosureLearnMore`.
