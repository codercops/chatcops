#!/usr/bin/env bash
# After a publish, dev has to catch up with production (the version commit).
# Opens a "sync: production into dev" PR when GH_TOKEN is a GitHub App token,
# because a PR opened with GITHUB_TOKEN doesn't trigger the CI that dev requires.
# Without a token it leaves instructions in the job summary instead.
set -euo pipefail

remote="${REMOTE:-origin}"
summary="${GITHUB_STEP_SUMMARY:-/dev/stdout}"

git fetch --quiet "$remote" production dev
behind=$(git rev-list --count "$remote/dev..$remote/production")

if [ "$behind" = "0" ]; then
  echo "dev already has everything on production."
  exit 0
fi

if [ -z "${GH_TOKEN:-}" ]; then
  {
    echo "### dev needs to catch up with production"
    echo
    echo "dev is $behind commit(s) behind production after this release. Set up the release bot (CONTRIBUTING.md, \"Releasing to production\") to get a PR for this automatically, or run:"
    echo
    echo '```bash'
    echo 'git fetch upstream && git push upstream upstream/production:dev'
    echo '```'
  } >> "$summary"
  echo "::warning::dev is $behind commit(s) behind production. See the job summary."
  exit 0
fi

existing=$(gh pr list --base dev --head production --state open --json number --jq '.[0].number // empty')
if [ -n "$existing" ]; then
  echo "Sync PR #$existing is already open."
  exit 0
fi

gh pr create --base dev --head production \
  --title "sync: production into dev" \
  --body "Brings the version commit and changelogs from the release back to \`dev\` ($behind commit(s)). Merge with a merge commit, not a squash, so \`dev\` and \`production\` share history."
