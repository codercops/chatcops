# Contributing to ChatCops

Thanks for helping out. This guide covers setup, how we work, and what a good PR looks like.

## Hacktoberfest 2026

We're taking part in Hacktoberfest this year, and first-time contributors are very welcome.

1. Pick an open issue labeled [`hacktoberfest`](https://github.com/codercops/chatcops/issues?q=is%3Aissue+is%3Aopen+label%3Ahacktoberfest+no%3Aassignee) or [`good first issue`](https://github.com/codercops/chatcops/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22+no%3Aassignee) that nobody is assigned to.
2. Comment on it to ask for it. I'll assign it to you, usually within a day. Please don't start on an issue that's assigned to someone else.
3. Take one issue at a time. Once your PR is merged, grab the next one.
4. If you're assigned and there's no PR or update for 5 days, I'll free the issue up for someone else. Just comment if you need more time.
5. Open your PR against `dev` and put `Closes #<issue number>` in the description.

PRs count for Hacktoberfest once they're merged or labeled `hacktoberfest-accepted`. PRs that aren't linked to an issue, only reformat code, or change things nobody asked for will be closed, and spammy ones get the `spam` label. If you have an idea that isn't an issue yet, open an issue first so we can agree on it before you write code.

Stuck? Ask on the issue. Questions are welcome.

## Prerequisites

- **Node.js 22 or newer** (CI runs on 22)
- **pnpm 9.** The easiest way is `corepack enable`, which picks up the version pinned in `package.json`.

This is a pnpm workspace. `npm install` does not work here (it fails on `workspace:*` dependencies).

## Development setup

```bash
# Fork the repo on GitHub, then clone your fork
git clone https://github.com/<your-username>/chatcops.git
cd chatcops

# Add upstream remote
git remote add upstream https://github.com/codercops/chatcops.git

# Install dependencies
pnpm install

# Build all packages (do this before running tests)
pnpm -r build

# Run tests
pnpm test

# Typecheck
pnpm -r typecheck
```

Build before you test. The server tests import `@chatcops/core` from its `dist` folder, so on a fresh clone `pnpm test` fails until you've run `pnpm -r build`. If you change `packages/core`, rebuild it before running the server tests again.

`pnpm -r build` also builds the website. To build only the packages, run `pnpm --filter "./packages/*" build`.

## Project structure

```
packages/
  core/     @chatcops/core (AI providers, tools, knowledge base)
  widget/   @chatcops/widget (embeddable chat UI)
  server/   @chatcops/server (server handler + adapters)
website/    Marketing site + Starlight docs (Astro)
```

## Development workflow

1. Sync your fork's `dev` branch with upstream:
   ```bash
   git fetch upstream
   git checkout dev
   git merge upstream/dev
   ```
2. Create a branch for your change. Don't work directly on `dev`, or every PR you open will include commits from the others.
   ```bash
   git checkout -b fix/express-cors-example
   ```
3. Run tests: `pnpm test`
4. Run typecheck: `pnpm -r typecheck`
5. Add a changeset if your change affects a published package (`core`, `widget` or `server`): `pnpm changeset`. Docs and website changes don't need one.
6. Push your branch and open a PR against upstream `dev`.

### Branch strategy

- **`dev`** is the default branch. All development happens here.
- **`production`** is the release branch, merged from `dev` when cutting a release.
- PRs should target **`dev`** unless you're doing a production release.

### Releasing to production

When `dev` is ready to ship:

1. Make sure all changes that affect published packages have changesets:
   ```bash
   pnpm changeset
   ```
   This creates a changeset file describing the version bump (patch/minor/major) and a summary. Commit it to `dev`.

2. Create a PR from `dev` to `production` and merge it.

3. The **Release** workflow runs automatically on `production` push:
   - Builds, typechecks, and tests everything
   - If unreleased changesets exist, the Changesets action opens a **"Version Packages"** PR on `production` that bumps versions and updates changelogs
   - Merging that PR triggers the workflow again, which **publishes to npm** (via OIDC trusted publishing)

4. The website is auto-deployed to Cloudflare Workers by Workers Builds (the `chatcops-website` Worker, config in `website/wrangler.jsonc`). No manual step needed.

> **Note:** Only maintainers can merge into `production`. If you're a contributor, just make sure your PR to `dev` includes a changeset when needed.

## Widget development

```bash
cd packages/widget

# Rebuild the widget on every change
pnpm dev

# In a second terminal, serve the folder
pnpm exec vite
```

Then open `http://localhost:5173/dev.html`. Opening `dev.html` straight from disk doesn't work, because browsers block module scripts on `file://` URLs.

To test with a real backend, build the packages first, then run the Express example:

```bash
pnpm --filter "./packages/*" build
cd packages/server
ANTHROPIC_API_KEY=sk-... npx tsx src/examples/express-server.ts
```

`npx` downloads `tsx` the first time.

## Adding a new AI provider

1. Create `packages/core/src/providers/{name}.ts`
2. Implement the `AIProvider` interface
3. Add a format converter in `base.ts`
4. Register in the `createProvider` factory
5. Export from `index.ts`
6. Add tests

## Adding a new locale

There are two sets of strings:

- **Core strings** (`packages/core/src/i18n/`):
  1. Create `packages/core/src/i18n/{code}.ts`
  2. Export all `LocaleStrings` fields
  3. Register in `packages/core/src/i18n/index.ts`
  4. Add to the test in `packages/core/tests/i18n/locales.test.ts`
- **Widget UI strings** (`packages/widget/src/i18n.ts`). The widget is a zero-dependency bundle and doesn't import core, so a language has to be added here too before the widget UI shows it.

Use proper accents and native script (for example Devanagari for Hindi).

## Website development

```bash
pnpm --filter "./packages/*" build   # the site imports the built widget
cd website
pnpm dev
```

The site runs without any secrets. Only the live chat demo on the landing page needs `OPENAI_API_KEY`, and most contributors can skip it. If you want the demo or the visitor counter locally, put the values in `website/.dev.vars`:

```bash
OPENAI_API_KEY=sk-...
UPSTASH_REDIS_REST_URL=https://your-endpoint.upstash.io
UPSTASH_REDIS_REST_TOKEN=your-token-here
```

The visitor counter shows `-` without Upstash credentials. Google Analytics (`G-GLYL9J6QYX`) is hardcoded in the layout and Starlight config.

## Commit convention

Use conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`
