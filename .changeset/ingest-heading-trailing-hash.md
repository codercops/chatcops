---
"@chatcops/ingest": patch
---

A heading that ends in `#` keeps it when the `#` is part of the title: `## Using C#` is "Using C#" in the heading path and the chunk's `section`, no longer "Using C". A closing run of `#` is dropped only when a space comes before it (`## Notes ##`), as in CommonMark.
