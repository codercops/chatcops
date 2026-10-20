---
"@chatcops/server": patch
---

A provider that fails to set up (an unknown `provider.type`, or an SDK that throws on a missing key) no longer stops the server process at startup. The failure is logged once with the `[chatcops] Provider setup failed:` prefix, without the API key or config, and every chat request gets the same `provider_error` a failed reply already gets.
