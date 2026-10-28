---
"@chatcops/cli": minor
---

`chatcops test --record` saves every HTTP call the tests make (model, embeddings, tools that call APIs) to `__cassettes__/<eval file>.jsonl`, and `--replay` answers them from there without the network. Replay is the default when `CI` is set; `--live` calls the APIs anyway. Calls are matched by a hash of their method, URL and body, so a changed prompt, model or tool list fails with where the request changed and a note to re-record, instead of passing on an old answer. Headers and key-like query parameters are never saved, and responses over 4 kB are saved gzipped.
