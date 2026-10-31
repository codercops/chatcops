---
"@chatcops/server": patch
---

`verifyWebhook()` now checks `toleranceSec`: it must be a whole number of seconds, 0 or more, or the call throws a `RangeError`. Before, `NaN` and `Infinity` made the age check never reject, so a stale signature passed. The default of 300 seconds and `0` (the same second only) work as before.
