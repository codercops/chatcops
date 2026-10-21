# Recorded provider responses

Real response bodies from each provider's API, replayed in tests through a stubbed `fetch` (`tests/helpers/replay-fetch.ts`), so the SDK's own stream parser runs as it does live.

Each case is a folder of `NN.request.json` (what the provider sent) and `NN.response.sse` (what came back), one pair per request. A folder with a `SYNTHETIC` file was edited by hand; the file says how.

To record them again (it costs a few cents):

```bash
pnpm --filter @chatcops/core build
cd packages/core && node --env-file=../../.env scripts/record-fixtures.mjs claude
```

Only bodies are stored, never headers, and the script refuses to write a body that contains an API key. CI also checks these files for key patterns.
