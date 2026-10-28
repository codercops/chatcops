---
"@chatcops/core": minor
"@chatcops/server": minor
---

A `Logger` for everything ChatCops writes: `logger` in the server config gets startup notes, refused requests and every error the server handles instead of throwing, each with a stable `event` name (`provider_error`, `tool_error`, `webhook_failed`, `origin_refused`, …). The default `consoleLogger()` prints the same `[chatcops] …` lines as before; `jsonLogger()` writes one JSON object per line, and any object with `debug`/`info`/`warn`/`error` works. Tools get the logger as `context.logger`, and `runTurn`, providers (`ProviderConfig.logger`), `ConversationManager` and `BufferedEventSink` take one too.

**Tool errors:** when a tool throws, the model now sees only `Tool failed: <name>`, and the full error is logged as `tool_error`. Before, the thrown message went to the model, which could repeat a database error or a connection string to the visitor. Return `{ success: false, message }` to tell the model something it can pass on. Timeouts and cancelled replies keep their messages.

Console lines for errors that come with an error object no longer end in a colon (`[chatcops] Provider error` and the error), and `describeBudgets` and `describeSecurity` no longer start with `[chatcops] `, since the logger adds it.
