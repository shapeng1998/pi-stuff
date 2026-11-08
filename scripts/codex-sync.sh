#!/usr/bin/env bash
# List upstream openai/codex commits since the web extension's baseline, for the paths it mirrors.
# Baseline is read from "openai/codex@<sha>" in extensions/web/index.ts; bump it after syncing.
set -euo pipefail
cd "$(dirname "$0")/.."

base=${BASE:-$(grep -o 'openai/codex@[0-9a-f]*' extensions/web/index.ts | head -1 | cut -d@ -f2)}
since=$(gh api "repos/openai/codex/commits/$base" --jq .commit.committer.date)
paths=(
  codex-rs/codex-api/src/search.rs
  codex-rs/codex-api/src/endpoint/search.rs
  codex-rs/ext/web-search
  codex-rs/tools/src/response_history.rs
  codex-rs/models-manager/models.json # truncation_policy, experimental_supported_tools
)

echo "baseline $base ($since)"
for p in "${paths[@]}"; do
  gh api "repos/openai/codex/commits?path=$p&since=$since&per_page=50" \
    --jq ".[] | select(.sha | startswith(\"$base\") | not) | \"  \(.commit.committer.date[:10]) \(.sha[:8]) \(.commit.message | split(\"\n\")[0])\"" |
    sed "1s|^|$p\n|"
done
echo "diff: https://github.com/openai/codex/compare/$base...main"
