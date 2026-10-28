---
"@chatcops/widget": patch
---

Long replies stream without slowing the page down: finished paragraphs render once, and only the one being written re-renders, at most once a frame, instead of the whole reply on every chunk. The log follows new text only while it's scrolled to the bottom, so a visitor reading an earlier message isn't pulled away. The finished reply renders exactly as before.
