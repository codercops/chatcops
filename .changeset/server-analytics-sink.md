---
"@chatcops/server": minor
---

With `analytics: true` and a `storage` that has an event sink, the server writes analytics events there too, buffered with `BufferedEventSink` and flushed before each reply's stream ends, so serverless runtimes don't drop them. `chatcopsAnalyticsHandler` then counts from the store, so the stats cover every instance, for `?from=` and `?to=` in milliseconds (default: the last 30 days). The handler's new `analyticsStats(range)` does the same; `getAnalytics()` still describes this process only.
