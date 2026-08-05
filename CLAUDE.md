# CLAUDE.md

@AGENTS.md

Everything above (imported from AGENTS.md) is binding. Below is the Claude-Code-specific wiring.

N10 adds a reusable client-runtime pallet and ABI under `pallets/bleavit-client/` and
`crates/bleavit-client-abi/`, plus the standalone `runtime/bleavit-client-runtime/` harness,
`app/packages/bleavit-client-ts/`, and client Zombienet drills. The client pallet is never
added to Bleavit's production `construct_runtime!`; update the executable quickstart binding when
changing its drill helper.

## Skills (invoke with `/name`; auto-invoke when the description matches)

| Skill | Use for |
|---|---|
| `/implement [id]` | The session driver: PLAN.md milestones, spec-first, verified, PLAN updated — closing one and continuing to the next. Default entry point for "continue"/"next step". |
| `/spec-audit [scope]` | Compliance sweep of implemented code against `docs/architecture/` (report-only; logs to PLAN.md · Audit log). |
| `/sync-docs` | Re-true README/PLAN/AGENTS/CLAUDE and the `.claude`/`.codex` assets against the actual repo. |
| `/new-pallet <name>` | Scaffold a FRAME pallet with spec-cited stubs, mock, test/benchmark stubs, try-state hook. |

## Subagents (delegate via the Agent tool)

| Agent | Role |
|---|---|
| `spec-reviewer` | Read-only compliance audit of a component vs its owning doc. Run it before marking any milestone ✅ (R-6). |
| `test-engineer` | Authors the doc-15 test obligations (PT suites, limit-coverage, negative origin tests, try-state, differential vectors). |
| `doc-curator` | End-of-session living-document sync when the delta is large. |

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
model/effort and disclose the substitution in PLAN.md — losing the provider must not
lose the independent-second-opinion pattern.

**Parallel Codex jobs and the worktree rule (R-13's operational corollary).** A
`workspace-write` job's turn-level snapshot/restore reverts concurrent edits in the same
tree — *including files it was told not to touch*. So `read-only` jobs (review, audit,
adversarial refutation, derivation checking) may fan out freely in one tree, but two
**authoring** jobs must never share a worktree: give each its own `git worktree` and
merge back serially.

## Hooks (installed via `.claude/settings.json` — expect these behaviors)

- **SessionStart** injects git state + PLAN.md focus/milestones/last log rows. Trust it
  for orientation, but still read PLAN.md before implementing.
- **Stop guard** (`stop-plan-guard.sh`) blocks ending a session when the tree changed
  but PLAN.md wasn't updated. Comply (update PLAN.md) instead of retrying.

  **Its exact condition is about the *working tree*, not the session** (clarified
  2026-07-29): it blocks when `git status --porcelain` shows non-`PLAN.md` changes
  **and** PLAN.md itself is *clean*. Two consequences that are not obvious and that
  cost a session real time:

  1. **Committing PLAN.md incrementally re-arms it.** A session that commits its
     PLAN update, then keeps working, makes PLAN clean while other files stay dirty —
     so the guard fires again, and again, however thoroughly PLAN already describes
     the work. Do not answer that by appending near-duplicate Session log rows; the
     log is append-only and padding it to satisfy a checker degrades the one artifact
     the next session actually reads. Either finish and commit the remaining work, or
     leave the PLAN edit **uncommitted** alongside it so the pending state is
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
- **Stop guard (`guard-plan-tables.sh`)** blocks ending a session if any PLAN.md
  Markdown table is structurally broken (orphaned rows severed from their header by
  a blank line, wrong cell count, unescaped `|` — GFM splits cells on pipes even
  inside backticks; escape as `\|`). Standing user instruction (2026-07-17): PLAN.md
  table formatting must never drift/break. Fix the reported rows (same checker as
  the docs CI job: `python3 tools/ci/check-plan-tables.py`) instead of retrying.

- **Stop guard (`guard-track-goal.sh`)** blocks ending a session while a declared track
  still has open milestones (rule R-5). Added 2026-08-04 by explicit user instruction,
  after several sessions ended at a milestone boundary and had to be restarted with
  "continue".

  **It is opt-in and does nothing without `.claude/session-goal`**, a one-line file:

  ```
  track: F
  ```

  With it present the hook counts that track's milestone rows in PLAN.md and blocks with
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

## Memory notes

Auto-memory exists for this project. PLAN.md — not memory — is the canonical
implementation status; keep memories as pointers (e.g. "status lives in PLAN.md"),
never as duplicated status that can go stale.
