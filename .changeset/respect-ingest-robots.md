---
'@chatcops/ingest': minor
---

Respect robots.txt by default during ingestion, with per-origin policy caching, allow/disallow matching and crawl-delay scheduling. Add respectRobots to opt out for network sources; local files are unaffected.

Report unavailable robots policies as per-origin errors and skip pruning during outages, instead of treating them as successful runs blocked by explicit rules.
