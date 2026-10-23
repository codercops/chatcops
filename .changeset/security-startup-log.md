---
"@chatcops/server": minor
---

The server logs its security settings once at startup (where the chat is allowed from, session tokens, Turnstile), plus an error or a warning for mistakes it can spot: an allowed origin without `http://` or `https://`, or with a path, query, fragment or trailing slash; an `http://` origin that isn't local; `"*"` next to other origins; a session secret that's also the value of a `NEXT_PUBLIC_`, `VITE_`, `PUBLIC_`, `NUXT_PUBLIC_`, `EXPO_PUBLIC_` or `REACT_APP_` variable; two secrets that are the same.
