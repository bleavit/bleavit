---
name: sync-docs
description: Bring the living documents — README.md, PLAN.md, plan/, AGENTS.md, CLAUDE.md and the .claude/.codex assets — back in line with the actual repository state. Use after ad-hoc changes, merges, or whenever the Stop hook reports stale plan state.
---

# Living-document synchronization

`docs/architecture/` is the spec and is NOT part of this skill's scope — leave it
alone here (changing it is a deliberate act under rule R-1, not a doc-sync).
Everything else that documents the repo must tell the truth after this skill runs.

## 1. Gather ground truth (never write from memory)

```
git status --porcelain && git diff --stat HEAD && git log --oneline -10
```

plus the actual tree (`ls`, workspace members in `Cargo.toml`, package manifests,
CI workflow names, test entry points). What exists is what may be documented as
existing; everything else is labeled planned.

## 2. Per-file contract

- **PLAN.md + plan/** — statuses match reality (a milestone with red gates is not
  done); Current focus names the actual next step; today's `plan/log/` file records
  the work; questions, verifications, decisions and audits reflect what happened.
  The tree stays reference-only: milestone frontmatter cites doc §, never restates
  spec content (rule R-4).
- **README.md** — status line, repo layout, and commands are currently true; links resolve.
  The opening paragraph (thank-you to Prof. Robin Hanson) and the closing line (Bon
  appétit) are pinned verbatim by rule R-11 — never reword, trim, or remove them.
- **AGENTS.md** — rules, session protocol, quality gates, and layout table match how the
  repo actually works now (e.g. gates gained a new suite → list it).
- **CLAUDE.md** — skills/subagents/hooks tables match the files under `.claude/`.
- **.codex/prompts/** — still mirror the `.claude/skills/` procedures they correspond to.

## 3. Apply and verify

- Minimal, surgical edits; append to day files, never rewrite their history.
- Check that every relative link you touched resolves.
- Delegate to the `doc-curator` subagent when the sync is large; do it inline when small.

## 4. Report

List each file changed and the one-line reason; flag anything that needs a human
decision (e.g. a milestone whose ✅ status looks unjustified) instead of deciding it.
