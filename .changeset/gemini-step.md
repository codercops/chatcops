---
"@chatcops/core": minor
---

Add `GeminiProvider.step()`. Thought signatures stay on the parts they came with and go back to Gemini on the next step. Calls from another provider get the placeholder signature Google documents, so a conversation can switch to Gemini 3 partway through. Safety, recitation and blocklist stops are reported as `content-filter`. Function call ids that Gemini didn't send are made up locally and never sent back.
