#!/usr/bin/env bash
# Fails when a PR changes package source without adding a changeset.
# Usage: check-changeset.sh <base ref>, for example origin/dev
set -euo pipefail

base="$1"
range="$base...HEAD"

changed_src=$(git diff --name-only "$range" -- 'packages/*/src/**' || true)
if [ -z "$changed_src" ]; then
  echo "No package source changed, so no changeset is needed."
  exit 0
fi

added_changesets=$(git diff --name-only --diff-filter=A "$range" -- '.changeset/*.md' | grep -v '^.changeset/README.md$' || true)
if [ -n "$added_changesets" ]; then
  echo "Changeset found:"
  echo "$added_changesets"
  exit 0
fi

echo "::error::This PR changes package source but adds no changeset. Run \`pnpm changeset\` and commit the file it creates. If the change shouldn't be released (an internal refactor, for example), run \`pnpm changeset --empty\`."
echo "Changed source files:"
echo "$changed_src"
exit 1
