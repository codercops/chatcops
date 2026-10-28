---
"@chatcops/core": minor
"@chatcops/server": minor
---

Analytics events are named `noun.verb` now: `conversation.started`, `message.sent`, `message.received` and `lead.captured`, also exported as `ANALYTICS_EVENTS`. The old `noun:verb` names keep working until 1.0. `track()` and `getEvents()` read them as the new ones, stats count events a store saved under either, and `eventCounts` has both keys, so the numbers carry on across the upgrade. Stats gain `leadsCaptured`. `leadsCapture`, the same number, is deprecated. A custom `EventSink` now receives the new names. Webhook event names don't change.
