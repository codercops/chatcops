# Contributing to ChatCops

## Development Setup

```bash
# Clone the repo
git clone https://github.com/codercops/chatcops.git
cd chatcops

# Install dependencies
pnpm install

# Build all packages
pnpm -r build

# Run tests
pnpm test

# Typecheck
pnpm -r typecheck
```

## Project Structure

```
packages/
  core/     - @chatcops/core (AI providers, tools, knowledge base)
  widget/   - @chatcops/widget (embeddable chat UI)
  server/   - @chatcops/server (server handler + adapters)
website/    - Marketing site + Starlight docs (Astro)
```

## Development Workflow

1. Create a branch: `git checkout -b feature/my-feature`
2. Make changes
3. Run tests: `pnpm test`
4. Run typecheck: `pnpm -r typecheck`
5. Add a changeset: `pnpm changeset`
6. Open a PR

## Widget Development

```bash
# Build widget in watch mode
cd packages/widget
pnpm dev

# Open dev.html in a browser for live testing
```

To test with a real backend, run the Express example:

```bash
cd packages/server
ANTHROPIC_API_KEY=sk-... npx tsx src/examples/express-server.ts
```

## Adding a New AI Provider

1. Create `packages/core/src/providers/{name}.ts`
2. Implement the `AIProvider` interface
3. Add a format converter in `base.ts`
4. Register in the `createProvider` factory
5. Export from `index.ts`
6. Add tests

## Adding a New Locale

1. Create `packages/core/src/i18n/{code}.ts`
2. Export all `LocaleStrings` fields
3. Register in `packages/core/src/i18n/index.ts`
4. Add to the test in `tests/i18n/locales.test.ts`

## Website Development

```bash
cd website
pnpm dev
```

The website requires a `.env.local` file with:

```bash
# Required — powers the live chat demo on the landing page
OPENAI_API_KEY=sk-...

# Optional — visitor counter (Upstash Redis)
UPSTASH_REDIS_REST_URL=https://your-endpoint.upstash.io
UPSTASH_REDIS_REST_TOKEN=your-token-here
```

The visitor counter gracefully degrades without Upstash credentials (displays `-`). Google Analytics (`G-GLYL9J6QYX`) is hardcoded in the layout and Starlight config.

## Commit Convention

Use conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`
