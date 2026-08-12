# CLAUDE.md

@AGENTS.md

Everything above (imported from AGENTS.md) is binding. Below is the Claude-Code-specific wiring.

N10 adds a reusable client-runtime pallet and ABI under `pallets/bleavit-client/` and
`crates/bleavit-client-abi/`, plus the standalone `runtime/bleavit-client-runtime/` harness,
`app/packages/bleavit-client-ts/`, and client Zombienet drills. The client pallet is never
added to Bleavit's production `construct_runtime!`; update the executable quickstart binding when
changing its drill helper.

## Skills and subagents

The four skills (`.claude/skills/`) and three subagents (`.claude/agents/`) are listed
into every session from their own frontmatter descriptions — read those rather than a
copy here, which could only drift. `/implement` is the default entry point for
"continue"/"next step"; `spec-reviewer` runs before any milestone is marked ✅ (R-6).

**Delegating to Codex.** R-13 (AGENTS.md) governs: explicit `--sandbox` on every
`codex exec`, `read-only` unless the job must author, no bypass flags. Note that the
`codex:codex-rescue` agent is a **forwarder, not an orchestrator** — it fires one async
companion `task` call and returns a job handle (`task-…`) rather than the findings, and
it refuses follow-up instructions like "poll and report". For a review round whose
constraints must actually reach Codex, prefer direct `codex exec` (with `</dev/null`),
or drive the companion runtime from the main loop:
`node ~/.claude/plugins/cache/openai-codex/codex/<ver>/scripts/codex-companion.mjs
status --all | result <job> | cancel <job>`. Model for this repo: **`gpt-5.6-luna`** at
**`max`** reasoning effort — pass both explicitly, as
`-m gpt-5.6-luna -c model_reasoning_effort="max"`. Both halves were set by explicit user
instruction and each replaced a prior pin: the effort was raised from `xhigh` on
2026-08-01, and the model was switched from `gpt-5.6-sol` on 2026-08-02. Verified
accepted by codex-cli 0.146.0 by reading `model:` / `reasoning effort:` back from the
job header rather than assuming the flags took.
If Codex hits a capacity/quota wall, fall back to Claude subagents at matched
model/effort and disclose the substitution in today's `plan/log/` entry — losing the provider must not
lose the independent-second-opinion pattern.

**Parallel Codex jobs and the worktree rule (R-13's operational corollary).** A
`workspace-write` job's turn-level snapshot/restore reverts concurrent edits in the same
tree — *including files it was told not to touch*. So `read-only` jobs (review, audit,
adversarial refutation, derivation checking) may fan out freely in one tree, but two
**authoring** jobs must never share a worktree: give each its own `git worktree` and
merge back serially.

## Output style

`.claude/output-styles/plain-technical-english.md` puts every reply and all newly
authored repo prose into a controlled register: ≤20-word instructions, ≤25-word
descriptions, active voice, one instruction per sentence, one name per thing, no
contractions, no semicolons, no Latin abbreviations. Read that file, not a summary
here. It sets `keep-coding-instructions: true`, so the built-in software-engineering
system prompt stays and only the register changes. It deliberately exempts code,
quoted spec text (paraphrasing normative text is an R-1 change), and README.md's
R-11 pinned lines. Note that **output styles do not reach subagents** —
`spec-reviewer`, `test-engineer`, `doc-curator` and Codex answer in their own voice,
so restate their findings yourself before they land in repo prose. Select it with
`/config` → *Output style* (the standalone `/output-style` command was removed in
Claude Code v2.1.91); the choice lands in the gitignored
`.claude/settings.local.json` and binds after `/clear`.

**Why it is not called "Simplified Technical English" (2026-08-06, user-raised).**
The style is *informed by* ASD-STE100 but deliberately does not reproduce it. That
standard's notice forbids reproduction "in whole or in part" without ASD's written
authority, its enumerated free-usage grant covers aerospace/defence bodies and
universities rather than projects like this one, and this repository is public and
GPL-3.0 — so a file that abridged it could neither be published here nor relicensed
under GPL. The shipped file is therefore organised around enforceable limits rather
than around the standard's own sections, carries no rule numbering, states every
constraint in its own words, and opens with a provenance-and-trademark notice. A
shingle check against the specification text finds no shared 5-word run except the
publisher's legal name and the standard's title. Keep it that way: **do not paste
rule text or the Part 2 dictionary into this file.** ASD distributes the standard
free to any writer at `asd-ste100.org` — reading it is unrestricted, and only
redistribution is not.

## Hooks (installed via `.claude/settings.json` — expect these behaviors)

- **SessionStart** injects git state, PLAN.md focus, milestone frontmatter, and the
  newest `plan/log/` records. Trust it for orientation, but still open the selected
  plan item before implementing.
- **Stop guard** (`stop-plan-guard.sh`) blocks ending a session when the tree changed
  but neither `PLAN.md` nor `plan/` was updated. Comply by updating the affected item
  and today's log instead of retrying.

  **Its exact condition is about the *working tree*, not the session** (clarified
  2026-08-12): it blocks when `git status --porcelain` shows changes outside the
  plan tree **and** both `PLAN.md` and `plan/` are clean. Two consequences matter:

  1. **Committing the plan update incrementally re-arms it.** A session that commits
     its item/log update, then keeps working, makes the plan tree clean while other
     files stay dirty. Do not answer that by appending near-duplicate log records.
     Either finish and commit the remaining work, or leave the plan edit
     **uncommitted** alongside it so the pending state is
     self-describing.
  2. **Background agents writing into the tree keep it armed.** When a subagent is
     still writing while you try to stop, the guard is correct to object: an unfinished
     write is exactly the state a next session cannot interpret. Treat a repeat block
     as a signal to wait for the agent or to record the in-flight state precisely —
     what exists, whether it compiles, which gates have *not* been run — rather than
     as an obstacle to route around.
- **Stop guard (`guard-readme.sh`)** blocks ending a session if README.md's pinned
  opening (thank-you to Prof. Robin Hanson) or closing (Bon appétit) line has been
  altered (rule R-11, AGENTS.md). Restore the exact wording instead of retrying.
- **Stop guard (`guard-plan-tables.sh`)** blocks ending a session if any hand-written
  living/spec Markdown table is structurally broken (orphaned rows severed from its header by
  a blank line, wrong cell count, unescaped `|` — GFM splits cells on pipes even
  inside backticks; escape as `\|`). Standing user instruction (2026-07-17): table
  formatting must never drift/break. Fix the reported rows (same checker as
  the docs CI job: `python3 tools/ci/check-plan-tables.py`) instead of retrying.

- **Stop guard (`guard-track-goal.sh`)** blocks ending a session while a declared track
  still has open milestones (rule R-5). Added 2026-08-04 by explicit user instruction,
  after several sessions ended at a milestone boundary and had to be restarted with
  "continue".

  **It is opt-in and does nothing without `.claude/session-goal`**, a one-line file:

  ```
  track: F
  ```

  With it present the hook counts `status:` in `plan/milestones/*.md` and blocks with
  the next one named. Two things about it are deliberate and worth knowing before trying
  to route around it:

  1. **The escape is a sentence, not a switch.** It stands down only when PLAN.md's
     *Current focus* contains a line beginning `> **PARKED:**`. A genuine external
     blocker — a credential, a device, an external commitment, a user ruling — is not
     something more work resolves, so blocking has to be escapable; but the escape is
     written into the artifact the next session reads. Deleting `.claude/session-goal`
     to get past it defeats the thing the user asked for.
  2. **It honours `stop_hook_active`**, so a stop is pushed back at most once per attempt.
     A hook that could never be satisfied would turn a wrong goal file into a session that
     cannot end.

  Closing a milestone and writing a report is not stopping, and waiting on CI is not a
  reason to stop — CI runs on a server while you build.

> There is no longer any write guard on `docs/architecture/`. The spec is editable;
> change it deliberately per rule R-1 (AGENTS.md · *Changing the specification*).

Permissions: common read-only git and cargo commands are pre-allowed. The `ask`
list is empty as of 2026-07-21 — the standing `Bash(git push*)` prompt was
removed by the user, so pushes are no longer gated by a permission prompt.
AGENTS.md R-9 still governs the *judgement*: commit and push only when the user
has asked or given standing instructions, and never publish or tag without an
explicit ask. Removing the prompt removed the reminder, not the rule.

**`Bash(git push*)` is on the `allow` list as of 2026-08-05, by explicit user
instruction, and removing the prompt was not enough on its own.** The allow/ask
lists are not the only gate: Claude Code's **auto-mode classifier** independently
refuses actions it reads as destructive, and it blocked
`git push --force-with-lease` three times in one session while `ask` was empty and
nothing in this file denied it. An explicit `allow` entry is what overrides it.
This matters more than it sounds, because **a force-push is routine here, not
exceptional**: `main` takes squash merges, so every merge orphans whatever was
stacked behind it — the same content under a new SHA — and each affected branch
must be `git rebase --onto`'d and force-pushed. Without the rule, every merge in a
stack strands the session. Prefer the pinned form
`--force-with-lease=<branch>:<sha>` over bare `--force-with-lease`: the bare form
takes its expected SHA from the remote-tracking ref, which **`git fetch` silently
refreshes**, so a fetch you ran for an unrelated reason can renew the lease against
commits you never looked at. **Derive that SHA with `git rev-parse`, never type
it** — a hand-written one is rejected as `stale info`, which reads like a real
lease failure and is not (2026-08-05).

**Retarget a stacked PR before merging its base, not after** (learned 2026-08-05).
`gh pr merge --delete-branch` removes the base branch, and GitHub **closes** every
PR targeting it — then refuses `reopenPullRequest` even once the branch is
recreated at its old tip, and a closed PR's base cannot be retargeted either. The
work is not lost (the head branch is untouched) but the PR is, along with its
review thread, so it must be re-proposed under a new number. Either
`gh pr edit <stacked> --base main` first, or merge without `--delete-branch` and
delete the branch once nothing points at it.

## Memory notes

Auto-memory exists for this project. `PLAN.md` plus `plan/` — not memory — is the canonical
implementation status; keep memories as pointers (e.g. "status lives in the plan tree"),
never as duplicated status that can go stale.
