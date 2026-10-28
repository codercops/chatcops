---
"@chatcops/widget": minor
---

`ChatCops.update(changes)` changes the running chat without loading it again: the theme (all but `position`), `branding`, `placeholder`, `strings`, `disclosure`, `welcomeMessage` and `suggestions`. Fields left out keep their current values. A chat that has only its welcome message shows the new one; once the visitor has written, the new welcome message and suggestions are used from the next conversation. In the script tag build, calls made before the chat loads are kept until it does, and the launcher takes the new theme right away.
