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
  # Match the Status *cell* (column 5), not the row's prose. A description that
  # merely mentions ⬜/🔨/⛔ is not an open milestone, and matching the whole row
  # selected 194 rows where 16 are genuinely open. Cells escape pipes as `\|`
  # (GFM splits on a bare one), so mask those before splitting. Rows are also
  # truncated: PLAN.md rows carry full prose, and eight untruncated ones came to
  # 93k chars — past the size at which this hook's whole output is replaced by a
  # 2k preview, which is how every section below it stopped reaching sessions.
  awk '
    /^## (Milestones|Track E)/ {f=1; next}
    /^## / {f=0}
    !f {next}
    /^\|/ {
      line=$0; gsub(/\\\|/, "\001", line)
      n=split(line, c, "|")
      if (n < 7) next
      st=c[6]; gsub(/^[ \t]+|[ \t]+$/, "", st)
      if (st !~ /^(⬜|🔨|⛔)$/) next
      id=c[2]; gsub(/^[ \t]+|[ \t]+$/, "", id)
      ms=c[3]; gsub(/\001/, "|", ms); gsub(/^[ \t]+/, "", ms)
      printf "%s %s  %s\n", st, id, substr(ms, 1, 150)
      if (++k == 8) exit
    }
  ' PLAN.md || echo "(none found — check PLAN.md)"
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
