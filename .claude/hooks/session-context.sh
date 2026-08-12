#!/usr/bin/env bash
# SessionStart hook — injects the living project status into every new session
# (startup | resume | clear | compact) so implementation continues seamlessly
# across sessions. Output on stdout becomes context for the agent.
# No `pipefail`: every section below ends in `| head -N`, which closes the pipe and
# SIGPIPEs its upstream once the limit is reached. Under `pipefail` that made the
# whole script exit 141, and a non-zero SessionStart hook has its stdout discarded —
# so this context silently stopped reaching sessions once PLAN.md grew past `head -25`.
set -eu
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
  python3 - <<'PY' || echo "(none found — check plan/milestones/)"
import sys
from pathlib import Path
sys.path.insert(0, ".")
from tools.plan.model import STATUS_GLYPHS, load_milestones

items, errors = load_milestones(Path("."))
for error in errors[:3]:
    print(f"WARNING: {error}")
order = {"active": 0, "blocked": 1, "pending": 2}
rows = sorted((i for i in items if i.status != "done"), key=lambda i: (order[i.status], i.id))
for item in rows[:8]:
    print(f"{STATUS_GLYPHS[item.status]} {item.id}  {item.title[:150]}")
PY
  echo
  echo "--- Last session log entries ---"
  awk '/^## Session log/{f=1;next} /^## /{f=0} f' PLAN.md | grep -E '^\| 20[0-9]{2}-' | tail -3 | cut -c1-300 || echo "(no session log entries yet)"
else
  echo
  echo "WARNING: PLAN.md is missing. Recreate it per AGENTS.md · rule R-3 before any other work."
fi

echo
echo "Protocol reminder (AGENTS.md): implement from the spec · keep going past a closed milestone (R-5)"
echo "in docs/architecture/ · verify per doc 15 · update PLAN.md before stopping."
exit 0
