#!/usr/bin/env bash
# Stop hook — keep working the declared goal (rule R-5, AGENTS.md).
#
# R-5 already says "when a milestone closes, continue to the next item without waiting to
# be asked". In practice that was obeyed unevenly: closing a milestone produces a report,
# a report reads like an ending, and the session stopped with the track half done and the
# user typing "continue". This hook makes the rule mechanical, the same way
# `stop-plan-guard.sh` makes R-3 mechanical. Requested by the user, 2026-08-04.
#
# OPT-IN, and the opt-in is one line. Write the track into `.claude/session-goal`:
#
#     track: F
#
# With no such file the hook does nothing at all, so it cannot surprise a session that
# never asked for it. Delete the file when the goal changes or is met.
#
# ESCAPE, deliberately narrow and auditable: the guard stands down when PLAN.md's
# *Current focus* block contains a line beginning `> **PARKED:**`. Blocking must be
# escapable — a genuine external blocker (a credential, a device, an external commitment,
# a user ruling) is not something more work resolves — but the escape is a sentence
# written into the one artifact the next session reads, not a flag nobody sees.
#
# `stop_hook_active` is honoured, so a stop is pushed back at most once per attempt. That
# is a deliberate safety valve rather than an oversight: a hook that can never be satisfied
# turns a wrong goal file into a session that cannot end.
set -euo pipefail

INPUT=$(cat)
ACTIVE=$(jq -r '.stop_hook_active // false' <<<"$INPUT")
[ "$ACTIVE" = "true" ] && exit 0

cd "${CLAUDE_PROJECT_DIR:-$(pwd)}"
GOAL_FILE=".claude/session-goal"
[ -f "$GOAL_FILE" ] || exit 0
[ -f PLAN.md ] || exit 0

TRACK=$(sed -nE 's/^[[:space:]]*track:[[:space:]]*([A-Za-z]+)[[:space:]]*$/\1/p' "$GOAL_FILE" | head -1)
[ -n "$TRACK" ] || exit 0

REPORT=$(python3 - "$TRACK" <<'PY'
import re
import sys

track = sys.argv[1]
text = open("PLAN.md", encoding="utf-8").read()

# The escape is checked BEFORE the counting, so a parked session is never told to keep
# going at work it has just said it cannot do.
focus = re.search(r"^## Current focus$(.*?)^## ", text, re.M | re.S)
if focus and re.search(r"^>\s*\*\*PARKED:\*\*", focus.group(1), re.M):
    print("PARKED")
    raise SystemExit

sys.path.insert(0, ".")
from tools.plan.gfm import is_separator_row, split_cells

row = re.compile(rf"^\|\s*{re.escape(track)}\d+\s*\|.*$", re.M)
done = 0
open_rows = []
for match in row.finditer(text):
    try:
        cells = split_cells(match.group(0))
    except ValueError:
        continue
    # A milestone row is: id | what | spec | depends | status | notes.
    if len(cells) != 6:
        continue
    status = cells[4]
    if "✅" in status:          # ✅
        done += 1
    else:
        open_rows.append((cells[0], status))

if not open_rows and done == 0:
    print("NOTRACK")
elif not open_rows:
    print("COMPLETE")
else:
    in_progress = [row_id for row_id, status in open_rows if "\U0001f528" in status]   # 🔨
    nxt = in_progress[0] if in_progress else open_rows[0][0]
    print(f"OPEN {done} {len(open_rows)} {nxt}")
PY
)

case "$REPORT" in
  PARKED|COMPLETE|NOTRACK|"") exit 0 ;;
esac

read -r _ DONE REMAINING NEXT <<<"$REPORT"

jq -n --arg track "$TRACK" --arg done "$DONE" --arg remaining "$REMAINING" --arg next "$NEXT" \
  '{decision:"block", reason:("The session goal in .claude/session-goal is track " + $track + ", and it is not finished: " + $done + " milestones are ✅ and " + $remaining + " are still open. The next one is " + $next + ". Rule R-5 (AGENTS.md): when a milestone closes, continue to the next item without waiting to be asked — a session ends when the work or the user says so, not when a milestone happens to close. Writing a report is not stopping: open " + $next + ", read its Spec column, and keep going. Waiting on CI is not a reason to stop either; CI runs on a server while you build. If the track genuinely cannot proceed — it needs a credential, a device, an external commitment or a user ruling — say so by adding a line to PLAN.md Current focus beginning `> **PARKED:**` with the reason and what would unblock it, which is what the next session will read. Do not delete .claude/session-goal to get past this.")}'
exit 0
