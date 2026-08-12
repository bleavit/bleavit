# Splitting PLAN.md into item files and day files

**Date:** 2026-08-12
**Status:** implemented 2026-08-12 on `plan/split-tree`
**Owner:** complete; the `plan/` item tree and renderer own ongoing maintenance

`PLAN.md` is 4,369,718 bytes. GitHub refuses to render a Markdown file above
1 MB, so the file does not display there at all. This design replaces the single
file with one file per item and one file per day, plus generated indexes.

Rule R-4 is unchanged by this design. `PLAN.md` and the `plan/` tree remain the
single source of implementation status, and they still never restate
`docs/architecture/`.

## 1. What is wrong today

### 1.1 The file cannot be read on GitHub

| Section | Size | Lines |
|---|---|---|
| Session log | 1.54 MB | 870 |
| Spec questions | 0.94 MB | 644 |
| Milestones | 0.50 MB | 255 |
| Decision log | 0.44 MB | 269 |
| Current focus | 0.41 MB | 3,713 |
| Verification log | 0.30 MB | 231 |
| Audit log, Unplanned changes, Track E | 0.05 MB | 78 |
| **Total** | **4.37 MB** | **6,079** |

### 1.2 The width problem is prose inside table cells

One milestone row, F8, is **45,564 characters in a single cell**. One spec
question row is 31,230. One session-log row is 22,480. A table cell holding an
essay forces horizontal scrolling in any file, of any size. Splitting the file
without moving that prose reproduces the same defect in a smaller file.

### 1.3 Current focus has become a second session log

The section is 3,712 lines of dated blockquote narrative, newest first,
separated by two `---` rules. The section a fresh session must read first is the
third largest in the file.

### 1.4 Every branch edits the same three sections

Rule R-9 already records this: `Current focus`, `Milestones` and `Session log`
are touched by nearly every pull request, and the rule recommends `rerere`
because the same conflict shapes recur. The conflict class is a property of the
single-file layout.

## 2. Decisions taken

Three decisions were taken by the user on 2026-08-12. They fix the shape of
everything below.

1. **Prose lives in one file per item**, not in table cells and not in a
   structured data file. Tables become generated, narrow indexes.
2. **Chronological logs split by day.** A per-month file would reach about
   1.5 MB at the measured cadence, which breaches the same GitHub limit on a
   slower clock.
3. **Gates read the per-item frontmatter**, not the generated tables. This ends
   the escaped-pipe defect class, which has cost this repository rows at least
   four times.

## 3. File layout

Two rules decide where anything goes. There are no exceptions.

- **An item with a stable id that other files cite gets its own file.**
- **A record that carries only a date goes in a file for that day.**

```
PLAN.md                                  # ~150 lines: current focus + the index
plan/
  milestones/F8.md                       # 126 files
  questions/SQ-615.md                    # 583 files
  verifications/V-383.md                 # 224 files
  log/2026/08/2026-08-09.md              # session entries written that day
  decisions/2026/08/2026-08-09.md        # decisions ruled that day
  audits/2026/08/2026-08-09.md           # audit records
  changes/2026/08/2026-08-09.md          # unplanned changes
  MILESTONES.md                          # generated index
  QUESTIONS.md                           # generated index
  VERIFICATIONS.md                       # generated index
  DECISIONS.md                           # generated index
```

`PLAN.md` keeps its name and its path. Rule R-3 and `stop-plan-guard.sh` refer to
it by name, and both keep working. It shrinks to the current focus plus links to
the indexes.

The largest file in the resulting tree is about 55 KB.

## 4. The frontmatter contract

Every item file opens with `---` frontmatter in the strict subset that
`deploy/runbooks/*.md` already uses, parsed the way `tools/deploy/check-runbooks.py`
already parses it: plain or double-quoted single-line scalars, `- ` list items,
no tabs, and a parser that **refuses** any syntax it does not understand. This
design adds no `pyyaml` dependency, because that precedent adds none.

### 4.1 Milestone

```yaml
---
id: F8
track: F
title: FE-6 packages/local-index — three-layer history, gap-tolerant coverage, candles
spec: ["10 §6", "10 §7"]
depends: [F3]
status: done            # pending | active | blocked | done
verify: [V-201, V-383]
---
```

The body carries the prose that used to sit in the Notes cell.

### 4.2 Spec question

```yaml
---
id: SQ-615
title: Does 11 §11.8 require a frozen surface for the guardian console reads?
spec_ref: "02 §7.4"
raised: 2026-07-19
status: resolved        # open | resolved
resolved: 2026-08-06
batch: B7
---
```

### 4.3 Verification record

```yaml
---
id: V-383
date: 2026-08-09
milestone: F28
title: F28 style-coverage gate proved bidirectional against a seeded dead rule
---
```

### 4.4 Day files

A day file carries no frontmatter, because it holds records rather than one item.
Each record is a level-2 heading whose first line is a `key: value` block in the
same strict subset. The renderer reads those blocks to build `DECISIONS.md`, and
refuses a heading that carries none.

```markdown
# Decisions — 2026-08-09

## Track F compat verdict reaches the shell without a new contract bump
ref: D-13
spec_refs: ["10 §5.2"]

The classifier probes exactly the frozen set, so an unfrozen read is one the
compat lattice cannot fail on…
```

`log/`, `decisions/`, `audits/` and `changes/` all use this shape. Only
`decisions/` is indexed, because only decisions are cited from elsewhere by
topic. Session entries, audits and unplanned changes are read by date.

### 4.5 Why the enum matters

Four gates today ask whether a status cell **begins with** the word "open". They
read it that way because an open row's prose legitimately contains the word
"resolved". `status` is an enum, so that reading disappears.

### 4.6 What stops being a checked claim

Three claims become structurally impossible rather than policed.

- **Duplicate ids.** `plan/verifications/V-383.md` cannot exist twice, so
  `check-plan-tables.py`'s V-id uniqueness check has nothing left to catch.
- **Batch assignment.** `batch:` is a field on the question, so "every open
  question sits in exactly one batch" cannot be violated.
- **Table structure.** The renderer escapes what it writes, so an unescaped `|`
  cannot sever a row.

## 5. The renderer

`tools/plan/render.py` reads the item files and writes the four indexes and
`PLAN.md`'s index block.

- `--write` regenerates.
- `--check` fails when the committed output differs from a fresh render.

That is the contract `regenerate-weights.py --check` and
`generate-vectors.py --check` already use in this repository.

Generated tables carry the id, a truncated title, the refs and the status glyph.
**Prose never enters a cell.** The glyph is rendered from the enum, so `⬜ 🔨 ⛔ ✅`
stay in the human view and leave the machine surface.

This satisfies the standing user instruction of 2026-07-17 more strongly than a
checker does. A generated table cannot drift. `check-plan-tables.py` keeps
policing the hand-written living documents, where the risk stays real.

## 6. Consumer migration

`tools/plan/model.py` holds the strict frontmatter parser and one loader per item
kind. Every gate imports it, so there is one parser to test rather than seven.

| Consumer | Change |
|---|---|
| `stop-plan-guard.sh` | **Change this first.** It watches `git status --porcelain -- PLAN.md`. After the split the tree can change with `plan/` updated and `PLAN.md` clean, so the guard fires wrongly. Widen it to `PLAN.md plan/`. |
| `guard-track-goal.sh` | Read `plan/milestones/*.md`, filter on `track:`, count `status: done`. The `> **PARKED:**` escape still reads `PLAN.md` and does not change. |
| `session-context.sh` | Read the short Current focus, open milestones from frontmatter, and the newest day file. The row truncation added 2026-08-12 becomes unnecessary. |
| `check-unreadable-obligations.py` | Replace the status-prefix reading with `status == "open"`. |
| `check-release-blocker-citations.py` | Same. |
| `check-client-surface-obligations.py` | Same. |
| `check-limit-coverage.py` | Take milestone ids and the done set from frontmatter. Drops a regex that matches any row whose first cell is alphanumeric, header rows included. |
| `check_alert_coverage.py` | Same. Drops the "exactly one `## Milestones` heading" requirement. |
| `check-spec-question-batches.py` | Keeps only the check that `batch:` names a declared batch. |
| `check-plan-tables.py` | Keeps the living documents and `docs/architecture/`. Drops V-id uniqueness. |
| `.github/workflows/ci.yml` | Add `python3 tools/plan/render.py --check` to the `docs` job. |

### 6.1 A claim this design made, and which turned out to be false

An earlier draft of this section asserted that `check_alert_coverage.py` misses a
second milestone table under `## Track E`. **That is wrong, and it was checked
during implementation rather than believed.**

`PLAN.md` has one `## Milestones` heading holding all 117 milestone rows,
including `### Track E — Protocol revenue and treasury sustainability` (E1 to E6)
as a level-3 subsection. The separate level-2 `## Track E — crossover arithmetic
and the self-funding statement` is an analysis section carrying a
`| Quantity | Value | Source |` table and no milestones at all.

Both the old parse and the new one see all 117 milestones with identical
statuses, and no monitoring seam's expiry changes. The record is kept here rather
than deleted, because a design that quietly drops a falsified claim teaches the
next reader nothing.

## 7. Conversion, and the losslessness proof

`tools/plan/migrate.py` runs once. It reads the current tables, writes the item
and day files, then verifies itself:

1. Extract every prose block from `PLAN.md` and normalize whitespace and GFM
   escapes.
2. Extract the same from every emitted file.
3. Assert the two multisets are equal, and print the byte accounting.

A dropped block or an invented one fails the run. Nothing is committed until the
proof passes.

### 7.1 The one part that is not mechanical

The Current focus stack has no per-entry delimiters beyond two `---` rules and
dated bold leads. Blocks whose date the converter can read go to that day's file.
Blocks whose date is ambiguous go to `plan/log/unsorted-current-focus.md`,
intact, for a later session to file. The converter never guesses a date, because
filing a finding under the wrong day is worse than an honest holding file.

## 8. Verification

- `tools/plan/tests/` — the parser accepts the runbook subset and refuses tabs,
  unknown syntax and duplicate keys. The loader refuses a file whose `id:` does
  not match its filename. The renderer's `--check` catches a hand-edited index.
- Every existing gate test keeps running. Each fixture changes from inline
  `PLAN.md` text to a temporary `plan/` tree.
- A migration test proves losslessness on a reduced fixture.
- The four Stop guards run green against the converted tree before the commit.
- `python3 tools/ci/check-doc-links.py` passes, because the indexes link to real
  files.

## 9. Non-goals

- **No summarizing or pruning of history.** Every byte of prose moves, and the
  proof in section 7 enforces that.
- **No change to `docs/architecture/`.** This design touches status, never spec.
- **No new runtime dependency.** The parser is hand-written, matching the
  runbook precedent.
- **No web view, no database, no search index.** GitHub renders the tree.

## 10. Risks

| Risk | Assessment |
|---|---|
| `git blame` on moved prose points at the migration commit | Accepted. `git log --follow PLAN.md` still reaches the history. Per-line attribution for moved text does not survive, and no split preserves it. |
| A gate rewrite loses a guarantee | Each gate keeps its existing tests, which fail if a guarantee is dropped. The gates are rewritten one at a time, not together. |
| About 1,000 new files | Each is small and single-purpose. The tree is browsable on GitHub, which the current file is not. |
| The renderer becomes a second source of truth | It cannot. `--check` in CI fails on any divergence, and the item files are the only input. |

## 11. Effort

Several sessions. A new module, a renderer, a migrator, seven gates, three
hooks, about 1,000 emitted files, and the R-3 updates to `AGENTS.md` and
`CLAUDE.md`.

End state: a `PLAN.md` of roughly 150 lines, a largest file of about 55 KB, and
every table narrow enough to read without horizontal scrolling.
