---
"@chatcops/widget": minor
---

Clearer messages when a reply can't happen. The widget now reads the server's reason and says it: too many messages, with the wait in seconds when the server sends one; the conversation or the day's budget used up; the assistant unavailable (the provider couldn't be set up); or the reply cut off. Each one is a new `strings` key (`errorRateLimitWait`, `errorBudget`, `errorBudgetDaily`, `errorUnavailable`, `errorCutOff`). The script tag bundle's size budget goes from 14 kB to 14.5 kB (18 kB for ESM) to fit them.
