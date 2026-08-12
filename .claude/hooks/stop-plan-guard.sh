#!/usr/bin/env bash
# Stop hook — enforces rule R-3 (AGENTS.md): PLAN.md must reflect every session
# that changed the repository. Blocks at most once (stop_hook_active).
set -euo pipefail

INPUT=$(cat)
ACTIVE=$(jq -r '.stop_hook_active // false' <<<"$INPUT")
[ "$ACTIVE" = "true" ] && exit 0

cd "${CLAUDE_PROJECT_DIR:-$(pwd)}"
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

# Repo changed but PLAN.md untouched → ask for the doc-sync pass.
CHANGES=$(git status --porcelain 2>/dev/null | grep -vE '\.claude/settings\.local\.json$' || true)
[ -z "$CHANGES" ] && exit 0

# The plan tree is PLAN.md plus plan/. A session that records its work in
# plan/log/<date>.md satisfies R-3 exactly as a Session log row used to.
NONPLAN=$(grep -vE '(^|[[:space:]])(PLAN\.md|plan/)' <<<"$CHANGES" || true)
PLAN_TOUCHED=$(git status --porcelain -- PLAN.md plan 2>/dev/null || true)

if [ -n "$NONPLAN" ] && [ -z "$PLAN_TOUCHED" ]; then
  jq -n '{decision:"block", reason:"The working tree has changes but PLAN.md and plan/ were not updated (rule R-3, AGENTS.md). Before stopping: (1) set the status of the affected milestone(s) in PLAN.md; (2) append an entry to plan/log/<YYYY>/<MM>/<YYYY-MM-DD>.md; (3) if the repo layout, commands, or workflow changed, refresh README.md / AGENTS.md / CLAUDE.md as well (or run /sync-docs). If the changes pre-date this session or are trivial, still record one entry saying exactly that, so the next session inherits accurate state."}'
  exit 0
fi
exit 0
