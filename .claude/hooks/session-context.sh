#!/usr/bin/env bash
# SessionStart hook — injects the living project status into every new session
# (startup | resume | clear | compact) so implementation continues seamlessly
# across sessions. Output on stdout becomes context for the agent.
set -euo pipefail
cd "${CLAUDE_PROJECT_DIR:-$(pwd)}"

echo "=== Bleavit auto-context (SessionStart hook) ==="
echo
BRANCH=$(git branch --show-current 2>/dev/null || echo "?")
LAST=$(git log -1 --format='%h %s' 2>/dev/null || echo "no commits")
echo "Git: ${BRANCH} @ ${LAST}"
DIRTY=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
if [ "$DIRTY" != "0" ]; then
  echo "Working tree: ${DIRTY} changed path(s):"
  git status --short | head -15
else
  echo "Working tree: clean"
fi

if [ -f PLAN.md ]; then
  echo
  echo "--- PLAN.md · Current focus ---"
  awk '/^## Current focus/{f=1;next} /^## /{f=0} f' PLAN.md | sed '/^[[:space:]]*$/d' | head -25
  echo
  echo "--- Next pending / in-progress milestones ---"
  grep -E '^\|.*(⬜|🔨|⛔)' PLAN.md | head -8 || echo "(none found — check PLAN.md)"
  echo
  echo "--- Last session log entries ---"
  awk '/^## Session log/{f=1;next} /^## /{f=0} f' PLAN.md | grep -E '^\| 20[0-9]{2}-' | tail -3 || echo "(no session log entries yet)"
else
  echo
  echo "WARNING: PLAN.md is missing. Recreate it per AGENTS.md · rule R-3 before any other work."
fi

echo
echo "Protocol reminder (AGENTS.md): implement from the spec · keep going past a closed milestone (R-5)"
echo "in docs/architecture/ · verify per doc 15 · update PLAN.md before stopping."
exit 0
