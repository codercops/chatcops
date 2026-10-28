---
"@chatcops/core": minor
"@chatcops/server": minor
---

Answers now cite the pages they came from. Chunks from knowledge sources with `retrieve` are passed to the turn as `sources`, and each page the reply cites becomes a `source` part (once per page), streamed after the text and saved with the reply. Claude gets the chunks as `search_result` blocks and cites them natively; other providers get a numbered `<sources>` block and cite with `[n]`, and numbers that match no source are removed from the text. New in core: `sources` on `runTurn` and provider step params, `citations: 'native'` on providers, a `source` provider event, and `CitationParser`/`parseCitations`/`sourcePart`.
