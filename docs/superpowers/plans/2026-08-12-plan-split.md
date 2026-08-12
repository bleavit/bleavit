# PLAN.md Split Implementation Plan

> **Status (2026-08-12):** implementation and local verification complete on
> `plan/split-tree`; published as draft [PR #301](https://github.com/bleavit/bleavit/pull/301).
> Readiness remains pending on the PR's CI.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single 4.37 MB `PLAN.md` with one file per item and one file per day, plus generated indexes, so the tree renders on GitHub and every gate parses exact fields instead of table cells.

**Architecture:** Items with a stable id (milestones, spec questions, verification records) each get a Markdown file whose frontmatter holds the machine fields and whose body holds the prose that used to sit in a table cell. Records that carry only a date go in a file for that day. `tools/plan/render.py` emits narrow human indexes from those files, gated by `--check` in CI. Every consumer moves from GFM cell parsing to frontmatter reading.

**Tech Stack:** Python 3.12, standard library only. Bash for the Claude Code hooks. No new dependency: the frontmatter parser is hand-written, matching `tools/deploy/check-runbooks.py`.

**Spec:** `docs/superpowers/specs/2026-08-12-plan-split-design.md`

## Global Constraints

- **No new dependency.** `pyyaml` is available in two CI jobs but must not be used here. `tools/deploy/check-runbooks.py` parses frontmatter by hand, and this tree follows it.
- **The parser refuses what it does not understand.** Plain or double-quoted single-line scalars, `  - ` block list items, no tabs, no flow syntax (`[`, `{`, `'`, `|`, `>`), no duplicate keys, no unknown keys. A permissive parser re-admits the ambiguity this work exists to remove.
- **Milestone status enum:** `pending`, `active`, `blocked`, `done`. Rendered as `⬜`, `🔨`, `⛔`, `✅`.
- **Question status enum:** `open`, `resolved`.
- **A file's `id:` must equal its filename stem.** `plan/milestones/F8.md` must declare `id: F8`.
- **Prose never enters a table cell.** Generated indexes carry ids, truncated titles, refs and a glyph.
- **Nothing is committed until the losslessness proof passes** (Task 3, step 5).
- **Commit style (R-9):** conventional commits scoped `plan`, following the existing `docs(plan): …` precedent on `main`. This work has no milestone id, so no `(ID)` suffix.
- **R-3:** `PLAN.md` is updated in the same session as any repository change. The Stop guard enforces it.
- **Branch first.** `main` is the default branch. Create `plan/split-tree` before Task 0.
- Tool tests live beside their tool and run with `python3 -m unittest discover -s <dir>`.

---

### Task 0: Fix the escaped-pipe misparse in two live gates

This ships independently of the split and fixes a defect that is wrong **today**. `PLAN.md` row `S7` (line 3896) has status `✅`, but its Milestone cell contains `boundary-screened \| consumer-validated \| unchecked`. Both gates below split on `|` without honouring the `\|` escape, so both read `13 §1, §2, §5; 15 §1 (I-6, I-14); 05 §5` as the status cell.

Effects: `guard-track-goal.sh` with `track: S` blocks a session forever on a finished milestone, and `check-limit-coverage.py` never lets an S7-owned key expire.

**Files:**
- Create: `tools/plan/__init__.py`
- Create: `tools/plan/gfm.py`
- Create: `tools/plan/tests/__init__.py`
- Create: `tools/plan/tests/test_gfm.py`
- Modify: `tools/ci/check-plan-tables.py:39-63` (delete `split_cells`, import it instead)
- Modify: `tools/limit-coverage/check-limit-coverage.py` (the `load_milestone_ids` body, around line 645)
- Modify: `.claude/hooks/guard-track-goal.sh` (the heredoc Python block, lines 40-80)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `tools.plan.gfm.split_cells(line: str) -> list[str]` — **moved verbatim** from `tools/ci/check-plan-tables.py:39`. It is already the repository's authority on GFM cell splitting, it already handles the `\|` escape, and it already treats the outer delimiters as optional. Do not write a second splitter: `PLAN.md` row SQ-523 omits its trailing pipe, and a splitter that demanded one would raise on real data.
  - `tools.plan.gfm.unescape_cell(text: str) -> str` — `\|` becomes a literal `|`. `split_cells` deliberately leaves the backslash in place, because its own job is counting cells. Every converter that writes a cell's text into frontmatter or a body must call this.
  - Both used by Tasks 3, 6, 8 and 9.

**Measured facts this task relies on** (verified against `PLAN.md` at `615c9ba8`):

| Table | Rows | Cells per row |
|---|---|---|
| Milestones | 126 | 6, uniformly |
| Spec questions | 583 questions + 11 batches | 5 and 3 respectively |
| Verification log | 224 | 5, uniformly |
| Decision log | 263 | 4, uniformly |
| Audit log | 12 | 4, uniformly |
| Session log | 864 | 4, uniformly |

Exactly one row in the whole file omits its trailing pipe (SQ-523, line 4472). Exactly one row carries escaped pipes in a way that misleads a naive splitter (S7, line 3896).

- [x] **Step 1: Write the failing test**

Create `tools/plan/tests/test_gfm.py`:

```python
"""The shared GFM cell splitter, and the unescaping its callers need.

PLAN.md row S7 carries `boundary-screened \\| consumer-validated \\| unchecked`
inside its Milestone cell. Two gates split on a bare "|", read that row as eight
cells, and took the Spec ref as the Status — so a finished milestone counted as
open. The row is valid GFM, so check-plan-tables.py passed it.

Row SQ-523 omits its trailing pipe, which GFM allows. Any splitter that demands
both outer delimiters raises on real data, which is why this module moves the
existing implementation rather than writing a new one.
"""

import unittest

from tools.plan.gfm import split_cells, unescape_cell


class SplitCellsTests(unittest.TestCase):
    def test_plain_row(self):
        row = "| F8 | FE-6 local-index | 10 §6 | F3 | ✅ | done |"
        self.assertEqual(
            split_cells(row),
            ["F8", "FE-6 local-index", "10 §6", "F3", "✅", "done"],
        )

    def test_escaped_pipe_stays_inside_its_cell(self):
        row = (
            "| S7 | binding site (boundary-screened \\| consumer-validated "
            "\\| unchecked) | 13 §1 | S6 | ✅ | Done 2026-08-01. |"
        )
        cells = split_cells(row)
        self.assertEqual(len(cells), 6)
        self.assertEqual(cells[0], "S7")
        self.assertEqual(cells[4], "✅")

    def test_missing_trailing_pipe_is_accepted(self):
        row = "| SQ-523 | question | 15 §4.5 | 2026-07-29 | resolved 2026-07-30"
        self.assertEqual(len(split_cells(row)), 5)

    def test_unescape_cell_is_separate_from_splitting(self):
        cells = split_cells("| a \\| b | c |")
        self.assertEqual(cells[0], "a \\| b")
        self.assertEqual(unescape_cell(cells[0]), "a | b")
```

- [x] **Step 2: Run the test to verify it fails**

```bash
cd /home/chralt/development/bleavit
python3 -m unittest discover -s tools/plan/tests -t . -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'tools.plan.gfm'`.

- [x] **Step 3: Move the existing splitter into a shared module**

Create `tools/plan/__init__.py` and `tools/plan/tests/__init__.py` as empty files.

Create `tools/plan/gfm.py`. Copy `split_cells`, `SEPARATOR_CELL_RE` and `is_separator_row` **verbatim** from `tools/ci/check-plan-tables.py:36-68`, keeping their docstrings, and add:

```python
def unescape_cell(text: str) -> str:
    """Turn a cell's `\\|` escapes into literal pipes.

    split_cells deliberately leaves the backslash in place, because its own job
    is counting cells rather than reading them. Every caller that writes a cell's
    text into frontmatter or a body calls this first.
    """
    return text.replace("\\|", "|")
```

Then in `tools/ci/check-plan-tables.py`, delete `SEPARATOR_CELL_RE`, `split_cells` and `is_separator_row`, and import them:

```python
sys.path.insert(0, str(ROOT))
from tools.plan.gfm import is_separator_row, split_cells  # noqa: E402
```

There must be exactly one implementation. The whole point of this task is that a second one disagreed with the first.

- [x] **Step 4: Run both test suites to verify they pass**

```bash
python3 -m unittest discover -s tools/plan/tests -t . -v
python3 -m unittest discover -s tools/ci/tests 2>&1 | grep -E '^(OK|FAILED|Ran )'
python3 tools/ci/check-plan-tables.py
```

Expected: PASS in both, and the table checker still reports every table well-formed. The `check-plan-tables.py` tests are the regression net for the move.

- [x] **Step 5: Write the failing test for the limit-coverage gate**

Append to `tools/limit-coverage/tests/test_check_limit_coverage.py`:

```python
    def test_escaped_pipe_row_reports_its_real_status(self):
        """S7's Milestone cell holds escaped pipes; its status is ✅, not the Spec ref."""
        plan = self.tmp / "PLAN.md"
        plan.write_text(
            "| ID | Milestone | Spec | Depends | Status | Notes |\n"
            "|---|---|---|---|---|---|\n"
            "| S7 | graph (a \\| b \\| c) | 13 §1 | S6 | ✅ | done |\n",
            encoding="utf-8",
        )
        identifiers, completed, failures = load_milestone_ids(plan)
        self.assertEqual(failures, [])
        self.assertIn("S7", identifiers)
        self.assertIn("S7", completed)
```

Add `load_milestone_ids` to that file's imports if it is not already imported, and set `self.tmp` from a `tempfile.TemporaryDirectory` in `setUp` if the class has none.

- [x] **Step 6: Run it to verify it fails**

```bash
python3 -m unittest discover -s tools/limit-coverage/tests -v 2>&1 | tail -20
```

Expected: FAIL — `'S7' not found in set()` for `completed`.

- [x] **Step 7: Fix `check-limit-coverage.py`**

Replace the body of the loop in `load_milestone_ids` (currently around line 645):

```python
    for line in text.splitlines():
        match = re.match(r"^\|\s*([A-Za-z][A-Za-z0-9]*)\s*\|", line)
        if not match:
            continue
        identifiers.add(match.group(1))
        cells = [cell.strip() for cell in line.split("|")]
        if len(cells) >= 6 and "✅" in cells[5]:
            completed.add(match.group(1))
```

with:

```python
    for line in text.splitlines():
        if not line.lstrip().startswith("|"):
            continue
        try:
            cells = split_cells(line)
        except ValueError:
            continue
        # A milestone row is: id | what | spec | depends | status | notes.
        if len(cells) != 6 or not re.fullmatch(r"[A-Za-z][A-Za-z0-9]*", cells[0]):
            continue
        identifiers.add(cells[0])
        if "✅" in cells[4]:
            completed.add(cells[0])
```

Add the import at the top of the file, after the existing imports:

```python
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from tools.plan.gfm import is_separator_row, split_cells, unescape_cell  # noqa: E402
```

Note the cell index moves from `cells[5]` to `cells[4]`, because `split_cells` drops the empty leading cell that `line.split("|")` produces.

- [x] **Step 8: Run both suites**

```bash
python3 -m unittest discover -s tools/limit-coverage/tests -v 2>&1 | tail -5
python3 tools/limit-coverage/check-limit-coverage.py
```

Expected: PASS, and the checker still exits 0 with its usual counts.

- [x] **Step 9: Fix `guard-track-goal.sh`**

In the heredoc Python block, replace:

```python
row = re.compile(rf"^\|\s*({re.escape(track)}\d+)\s*\|(.*)$", re.M)
done = 0
open_rows = []
for match in row.finditer(text):
    cells = [cell.strip() for cell in match.group(2).split("|")]
    if len(cells) < 5:
        continue
    status = cells[3]
```

with:

```python
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
```

and replace the two later uses of `match.group(1)` with `cells[0]`.

- [x] **Step 10: Prove the guard now reads S7 correctly**

```bash
printf 'track: S\n' > .claude/session-goal
bash .claude/hooks/guard-track-goal.sh <<< '{"stop_hook_active":false}'; echo "exit=$?"
rm .claude/session-goal
```

Expected: the guard reports Track S as complete or names a genuinely open S milestone. It must not name `S7`.

- [x] **Step 11: Run the full docs and tooling gate set**

```bash
python3 tools/ci/check-plan-tables.py
python3 -m unittest discover -s tools/ci/tests 2>&1 | grep -E '^(OK|FAILED|Ran )'
python3 -m unittest discover -s tools/limit-coverage/tests 2>&1 | grep -E '^(OK|FAILED|Ran )'
python3 -m unittest discover -s tools/plan/tests -t . 2>&1 | grep -E '^(OK|FAILED|Ran )'
```

Expected: all green.

- [x] **Step 12: Update PLAN.md and commit**

Add an *Unplanned changes* entry naming S7, both gates, and the effect of each. Then:

```bash
git checkout -b plan/split-tree
git add tools/plan tools/limit-coverage .claude/hooks/guard-track-goal.sh PLAN.md
git commit -m "fix(plan): honour the \\| escape when reading milestone status cells"
```

---

### Task 1: The strict frontmatter parser and item loaders

**Files:**
- Create: `tools/plan/model.py`
- Create: `tools/plan/tests/test_model.py`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `parse_frontmatter(path: Path) -> tuple[dict[str, str | list[str]], str]` — returns the frontmatter mapping and the body. Raises `PlanError` with a `path:line: message` string.
  - `Milestone` frozen dataclass: `id: str`, `track: str`, `title: str`, `spec: tuple[str, ...]`, `depends: tuple[str, ...]`, `status: str`, `verify: tuple[str, ...]`, `body: str`, `path: Path`.
  - `Question` frozen dataclass: `id: str`, `title: str`, `spec_ref: str`, `raised: str`, `status: str`, `resolved: str | None`, `batch: str`, `body: str`, `path: Path`.
  - `Verification` frozen dataclass: `id: str`, `date: str`, `milestone: str`, `title: str`, `body: str`, `path: Path`.
  - `load_milestones(root: Path) -> tuple[list[Milestone], list[str]]`, and the same shape for `load_questions` and `load_verifications`. The second element is the error list, empty on success.
  - `STATUS_GLYPHS: dict[str, str]` mapping the milestone enum to `⬜ 🔨 ⛔ ✅`.

- [x] **Step 1: Write the failing tests**

Create `tools/plan/tests/test_model.py`:

```python
"""The frontmatter parser refuses everything it does not understand.

It is deliberately narrower than YAML, matching tools/deploy/check-runbooks.py.
A permissive parser would re-admit the ambiguity the split exists to remove.
"""

import tempfile
import unittest
from pathlib import Path

from tools.plan.model import (
    PlanError,
    load_milestones,
    parse_frontmatter,
)

MILESTONE = """---
id: F8
track: F
title: FE-6 packages/local-index — three-layer history
spec: ["10 §6", "10 §7"]
depends: [F3]
status: done
verify: [V-201]
---

Three-layer history, gap-tolerant coverage, candles.
"""


class FrontmatterTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def write(self, name: str, text: str) -> Path:
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        return path

    def test_parses_scalars_lists_and_body(self):
        values, body = parse_frontmatter(self.write("F8.md", MILESTONE))
        self.assertEqual(values["id"], "F8")
        self.assertEqual(values["spec"], ["10 §6", "10 §7"])
        self.assertEqual(values["depends"], ["F3"])
        self.assertIn("gap-tolerant coverage", body)

    def test_rejects_a_tab(self):
        text = MILESTONE.replace("track: F", "track:\tF")
        with self.assertRaises(PlanError) as caught:
            parse_frontmatter(self.write("F8.md", text))
        self.assertIn("tabs are forbidden", str(caught.exception))

    def test_rejects_a_duplicate_key(self):
        text = MILESTONE.replace("status: done", "status: done\nstatus: pending")
        with self.assertRaises(PlanError) as caught:
            parse_frontmatter(self.write("F8.md", text))
        self.assertIn("duplicate", str(caught.exception))

    def test_rejects_block_scalar_syntax(self):
        text = MILESTONE.replace("title: FE-6 packages/local-index — three-layer history", "title: |")
        with self.assertRaises(PlanError) as caught:
            parse_frontmatter(self.write("F8.md", text))
        self.assertIn("unsupported frontmatter syntax", str(caught.exception))

    def test_rejects_a_missing_closing_delimiter(self):
        with self.assertRaises(PlanError) as caught:
            parse_frontmatter(self.write("F8.md", "---\nid: F8\n"))
        self.assertIn("no closing ---", str(caught.exception))


class LoadMilestonesTests(FrontmatterTests):
    def test_loads_a_milestone(self):
        self.write("plan/milestones/F8.md", MILESTONE)
        items, errors = load_milestones(self.root)
        self.assertEqual(errors, [])
        self.assertEqual(items[0].id, "F8")
        self.assertEqual(items[0].status, "done")
        self.assertEqual(items[0].spec, ("10 §6", "10 §7"))

    def test_id_must_match_the_filename(self):
        self.write("plan/milestones/F9.md", MILESTONE)
        _, errors = load_milestones(self.root)
        self.assertTrue(any("does not match its filename" in e for e in errors))

    def test_status_must_be_in_the_enum(self):
        self.write("plan/milestones/F8.md", MILESTONE.replace("status: done", "status: finished"))
        _, errors = load_milestones(self.root)
        self.assertTrue(any("status must be one of" in e for e in errors))

    def test_unknown_key_is_refused(self):
        self.write("plan/milestones/F8.md", MILESTONE.replace("track: F", "track: F\nowner: nobody"))
        _, errors = load_milestones(self.root)
        self.assertTrue(any("unknown key 'owner'" in e for e in errors))
```

- [x] **Step 2: Run to verify it fails**

```bash
python3 -m unittest discover -s tools/plan/tests -t . -v 2>&1 | tail -20
```

Expected: FAIL with `ImportError: cannot import name 'PlanError'`.

- [x] **Step 3: Write the implementation**

Create `tools/plan/model.py`:

```python
"""Strict frontmatter parsing and item loading for the plan/ tree.

The accepted grammar is deliberately narrow and matches
tools/deploy/check-runbooks.py:

    key: plain scalar
    key: "double quoted scalar"
    key: [flow, list, of, scalars]
    key:
      - block list item

Tabs, duplicate keys, unknown keys, and every other YAML construct are refused.
This module adds no dependency, because the runbook precedent adds none.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

TOP_LEVEL_RE = re.compile(r"^([a-z_]+):(?: (.*))?$")
BLOCK_ITEM_RE = re.compile(r"^  - (.+)$")

MILESTONE_STATUSES = ("pending", "active", "blocked", "done")
QUESTION_STATUSES = ("open", "resolved")
STATUS_GLYPHS = {"pending": "⬜", "active": "🔨", "blocked": "⛔", "done": "✅"}

MILESTONE_KEYS = {"id", "track", "title", "spec", "depends", "status", "verify"}
MILESTONE_LIST_KEYS = {"spec", "depends", "verify"}
QUESTION_KEYS = {"id", "title", "spec_ref", "raised", "status", "resolved", "batch"}
QUESTION_LIST_KEYS: set[str] = set()
VERIFICATION_KEYS = {"id", "date", "milestone", "title"}
VERIFICATION_LIST_KEYS: set[str] = set()

# A bare date, and a date that opens a longer string. Both are needed:
# 391 of 583 Raised cells read "2026-07-22 (SQ-66/SQ-320 contract-v7 comparison)",
# so demanding a bare date there would reject two thirds of the corpus.
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
DATE_PREFIX_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})(?:\D.*)?$")


class PlanError(Exception):
    """A frontmatter file this parser refuses to interpret."""


def _scalar(raw: str, label: str, line: int) -> str:
    if raw != raw.strip() or not raw:
        raise PlanError(f"{label}:{line}: scalar must be non-empty with no edge whitespace")
    if raw[0] in "'{|>":
        raise PlanError(f"{label}:{line}: unsupported frontmatter syntax; use a plain or double-quoted single-line scalar")
    if raw.startswith('"'):
        if len(raw) < 2 or not raw.endswith('"'):
            raise PlanError(f"{label}:{line}: unmatched double quote")
        value = raw[1:-1]
        if '"' in value or any(c in value for c in "\r\n\t"):
            raise PlanError(f"{label}:{line}: double-quoted scalar must be one literal line with no embedded quote")
        if not value:
            raise PlanError(f"{label}:{line}: scalar must be non-empty")
        return value
    return raw


def _flow_list(raw: str, label: str, line: int) -> list[str]:
    inner = raw[1:-1].strip()
    if not inner:
        return []
    items: list[str] = []
    for part in _split_flow(inner, label, line):
        items.append(_scalar(part.strip(), label, line))
    return items


def _split_flow(inner: str, label: str, line: int) -> list[str]:
    """Split a flow list on commas that are outside double quotes."""
    parts: list[str] = []
    current: list[str] = []
    in_quotes = False
    for character in inner:
        if character == '"':
            in_quotes = not in_quotes
            current.append(character)
        elif character == "," and not in_quotes:
            parts.append("".join(current))
            current = []
        else:
            current.append(character)
    if in_quotes:
        raise PlanError(f"{label}:{line}: unmatched double quote in flow list")
    parts.append("".join(current))
    return parts


def parse_frontmatter(path: Path) -> tuple[dict[str, str | list[str]], str]:
    """Return (values, body). Raises PlanError on anything unrecognised."""
    label = str(path)
    text = path.read_text(encoding="utf-8")
    lines = text.split("\n")
    if not lines or lines[0] != "---":
        raise PlanError(f"{label}:1: file must start with --- frontmatter")
    try:
        closing = lines.index("---", 1)
    except ValueError:
        raise PlanError(f"{label}:1: frontmatter has no closing --- delimiter") from None

    frontmatter = lines[1:closing]
    for number, line in enumerate(frontmatter, start=2):
        if "\t" in line:
            raise PlanError(f"{label}:{number}: tabs are forbidden in frontmatter")

    values: dict[str, str | list[str]] = {}
    index = 0
    while index < len(frontmatter):
        line = frontmatter[index]
        number = index + 2
        match = TOP_LEVEL_RE.fullmatch(line)
        if match is None:
            raise PlanError(f"{label}:{number}: expected an unindented top-level key")
        key, raw = match.groups()
        if key in values:
            raise PlanError(f"{label}:{number}: duplicate top-level key {key!r}")
        index += 1
        if raw is None:
            items: list[str] = []
            while index < len(frontmatter) and frontmatter[index].startswith("  "):
                item = BLOCK_ITEM_RE.fullmatch(frontmatter[index])
                if item is None:
                    raise PlanError(f"{label}:{index + 2}: list item must be exactly '  - <scalar>'")
                items.append(_scalar(item.group(1), label, index + 2))
                index += 1
            values[key] = items
        elif raw.startswith("["):
            if not raw.endswith("]"):
                raise PlanError(f"{label}:{number}: unterminated flow list")
            values[key] = _flow_list(raw, label, number)
        else:
            values[key] = _scalar(raw, label, number)

    body = "\n".join(lines[closing + 1 :]).strip("\n")
    return values, body


@dataclass(frozen=True)
class Milestone:
    id: str
    track: str
    title: str
    spec: tuple[str, ...]
    depends: tuple[str, ...]
    status: str
    verify: tuple[str, ...]
    body: str
    path: Path


@dataclass(frozen=True)
class Question:
    id: str
    title: str
    spec_ref: str
    raised: str
    status: str
    resolved: str | None
    batch: str
    body: str
    path: Path


@dataclass(frozen=True)
class Verification:
    id: str
    date: str | None
    milestone: str
    title: str
    body: str
    path: Path


def _check_keys(values, allowed, required, label, errors) -> bool:
    ok = True
    for key in sorted(set(values) - allowed):
        errors.append(f"{label}: unknown key {key!r}")
        ok = False
    for key in sorted(required - set(values)):
        errors.append(f"{label}: missing required key {key!r}")
        ok = False
    return ok


def _load(root: Path, subdir: str, build, errors: list[str]) -> list:
    directory = root / "plan" / subdir
    if not directory.is_dir():
        errors.append(f"plan/{subdir}: directory is missing")
        return []
    items = []
    for path in sorted(directory.glob("*.md")):
        label = f"plan/{subdir}/{path.name}"
        try:
            values, body = parse_frontmatter(path)
        except PlanError as error:
            errors.append(str(error))
            continue
        if values.get("id") != path.stem:
            errors.append(f"{label}: id {values.get('id')!r} does not match its filename")
            continue
        item = build(values, body, path, label, errors)
        if item is not None:
            items.append(item)
    return items


def load_milestones(root: Path) -> tuple[list[Milestone], list[str]]:
    errors: list[str] = []

    def build(values, body, path, label, errors):
        required = {"id", "track", "title", "spec", "depends", "status"}
        if not _check_keys(values, MILESTONE_KEYS, required, label, errors):
            return None
        status = values["status"]
        if status not in MILESTONE_STATUSES:
            errors.append(f"{label}: status must be one of {MILESTONE_STATUSES}, found {status!r}")
            return None
        for key in MILESTONE_LIST_KEYS:
            if key in values and not isinstance(values[key], list):
                errors.append(f"{label}: {key} must be a list")
                return None
        return Milestone(
            id=values["id"],
            track=values["track"],
            title=values["title"],
            spec=tuple(values["spec"]),
            depends=tuple(values["depends"]),
            status=status,
            verify=tuple(values.get("verify", [])),
            body=body,
            path=path,
        )

    return _load(root, "milestones", build, errors), errors


def load_questions(root: Path) -> tuple[list[Question], list[str]]:
    errors: list[str] = []

    def build(values, body, path, label, errors):
        required = {"id", "title", "spec_ref", "raised", "status", "batch"}
        if not _check_keys(values, QUESTION_KEYS, required, label, errors):
            return None
        status = values["status"]
        if status not in QUESTION_STATUSES:
            errors.append(f"{label}: status must be one of {QUESTION_STATUSES}, found {status!r}")
            return None
        # `raised` opens with a date and may carry a parenthetical after it.
        if not DATE_PREFIX_RE.fullmatch(values["raised"]):
            errors.append(f"{label}: raised must begin with YYYY-MM-DD, found {values['raised']!r}")
            return None
        resolved = values.get("resolved")
        # `resolved` is OPTIONAL even when the status is resolved: 10 of the 389
        # resolved rows record no date, and inventing one would be a fabrication.
        if resolved is not None and not DATE_RE.fullmatch(resolved):
            errors.append(f"{label}: resolved must be YYYY-MM-DD, found {resolved!r}")
            return None
        if status == "open" and resolved:
            errors.append(f"{label}: an open question must not carry a resolved: date")
            return None
        return Question(
            id=values["id"],
            title=values["title"],
            spec_ref=values["spec_ref"],
            raised=values["raised"],
            status=status,
            resolved=resolved,
            batch=values["batch"],
            body=body,
            path=path,
        )

    return _load(root, "questions", build, errors), errors


def load_verifications(root: Path) -> tuple[list[Verification], list[str]]:
    errors: list[str] = []

    def build(values, body, path, label, errors):
        # `date` is optional: 12 of the 224 verification rows carry no date in
        # their Status cell, and the converter must not invent one.
        required = {"id", "milestone", "title"}
        if not _check_keys(values, VERIFICATION_KEYS, required, label, errors):
            return None
        date = values.get("date")
        if date is not None and not DATE_RE.fullmatch(date):
            errors.append(f"{label}: date must be YYYY-MM-DD, found {date!r}")
            return None
        return Verification(
            id=values["id"],
            date=date,
            milestone=values["milestone"],
            title=values["title"],
            body=body,
            path=path,
        )

    return _load(root, "verifications", build, errors), errors
```

- [x] **Step 4: Run to verify it passes**

```bash
python3 -m unittest discover -s tools/plan/tests -t . -v 2>&1 | tail -5
```

Expected: PASS, 13 tests.

- [x] **Step 5: Commit**

```bash
git add tools/plan
git commit -m "feat(plan): strict frontmatter parser and item loaders for the plan/ tree"
```

---

### Task 2: Widen the Stop guard before any `plan/` file exists

This must land before Task 3 creates `plan/`. Until it does, a session that edits only `plan/` leaves `PLAN.md` clean and the guard blocks wrongly.

**Files:**
- Modify: `.claude/hooks/stop-plan-guard.sh:16-18`
- Create: `tools/ci/tests/test_stop_plan_guard.py`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing importable. The guard's contract becomes: block when the tree has non-plan changes **and** neither `PLAN.md` nor anything under `plan/` was touched.

- [x] **Step 1: Write the failing test**

Create `tools/ci/tests/test_stop_plan_guard.py`:

```python
"""The Stop guard must accept a plan/ edit as satisfying rule R-3.

After the split, a session records its work in plan/log/<date>.md rather than in
PLAN.md's Session log. A guard that watches PLAN.md alone would block every such
session, which is the opposite of what R-3 asks for.
"""

import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
GUARD = ROOT / ".claude" / "hooks" / "stop-plan-guard.sh"


def run_guard(repo: Path) -> str:
    result = subprocess.run(
        ["bash", str(GUARD)],
        input='{"stop_hook_active":false}',
        capture_output=True,
        text=True,
        cwd=repo,
        env={"PATH": "/usr/bin:/bin", "CLAUDE_PROJECT_DIR": str(repo)},
    )
    return result.stdout


class StopPlanGuardTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.repo = Path(self._tmp.name)
        subprocess.run(["git", "init", "-q"], cwd=self.repo, check=True)
        (self.repo / "PLAN.md").write_text("# plan\n", encoding="utf-8")
        (self.repo / "src.txt").write_text("one\n", encoding="utf-8")
        subprocess.run(["git", "add", "-A"], cwd=self.repo, check=True)
        subprocess.run(
            ["git", "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"],
            cwd=self.repo,
            check=True,
        )

    def tearDown(self):
        self._tmp.cleanup()

    def test_blocks_when_nothing_in_the_plan_tree_moved(self):
        (self.repo / "src.txt").write_text("two\n", encoding="utf-8")
        self.assertIn('"block"', run_guard(self.repo))

    def test_accepts_a_plan_directory_edit(self):
        (self.repo / "src.txt").write_text("two\n", encoding="utf-8")
        (self.repo / "plan" / "log" / "2026" / "08").mkdir(parents=True)
        (self.repo / "plan" / "log" / "2026" / "08" / "2026-08-12.md").write_text(
            "# Session log — 2026-08-12\n", encoding="utf-8"
        )
        self.assertEqual(run_guard(self.repo).strip(), "")

    def test_accepts_a_plan_md_edit(self):
        (self.repo / "src.txt").write_text("two\n", encoding="utf-8")
        (self.repo / "PLAN.md").write_text("# plan\nchanged\n", encoding="utf-8")
        self.assertEqual(run_guard(self.repo).strip(), "")
```

- [x] **Step 2: Run to verify it fails**

```bash
python3 -m unittest discover -s tools/ci/tests -v 2>&1 | grep -A5 'test_accepts_a_plan_directory_edit'
```

Expected: FAIL on `test_accepts_a_plan_directory_edit` — the guard emits a block.

- [x] **Step 3: Modify the guard**

In `.claude/hooks/stop-plan-guard.sh`, replace:

```bash
NONPLAN=$(grep -vE '(^|[[:space:]])PLAN\.md$' <<<"$CHANGES" || true)
PLAN_TOUCHED=$(git status --porcelain -- PLAN.md 2>/dev/null || true)
```

with:

```bash
# The plan tree is PLAN.md plus plan/. A session that records its work in
# plan/log/<date>.md satisfies R-3 exactly as a Session log row used to.
NONPLAN=$(grep -vE '(^|[[:space:]])(PLAN\.md|plan/)' <<<"$CHANGES" || true)
PLAN_TOUCHED=$(git status --porcelain -- PLAN.md plan 2>/dev/null || true)
```

Update the block message to say: *"append an entry to `plan/log/<YYYY>/<MM>/<YYYY-MM-DD>.md`"* in place of *"append a Session log row"*.

- [x] **Step 4: Run to verify it passes**

```bash
python3 -m unittest discover -s tools/ci/tests -v 2>&1 | grep -E '^(OK|FAILED|Ran )'
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add .claude/hooks/stop-plan-guard.sh tools/ci/tests/test_stop_plan_guard.py
git commit -m "fix(plan): let the Stop guard accept a plan/ edit as satisfying R-3"
```

---

### Task 3: Convert the milestones, and prove the conversion lost nothing

**Files:**
- Create: `tools/plan/migrate.py`
- Create: `tools/plan/tests/test_migrate.py`
- Create: `plan/milestones/*.md` (about 117 files, generated by the run)

**Interfaces:**
- Consumes: `tools.plan.gfm.split_cells`, `tools.plan.model.MILESTONE_STATUSES`.
- Produces:
  - `normalize_prose(text: str) -> str` — collapses whitespace, unescapes `\|`, strips Markdown emphasis markers. Used by the losslessness proof in every later migration task.
  - `prose_blocks(text: str) -> collections.Counter` — the multiset of normalized non-empty blocks in a document.
  - `migrate_milestones(plan_text: str, out: Path) -> list[Path]`.
  - CLI: `python3 tools/plan/migrate.py milestones --plan PLAN.md --out .`

- [x] **Step 1: Write the failing test**

Create `tools/plan/tests/test_migrate.py`:

```python
"""Conversion must be lossless, and must refuse to guess.

The proof compares the multiset of normalized prose blocks before and after. A
dropped block or an invented one fails the run, so no conversion is committed on
a promise.
"""

import tempfile
import unittest
from pathlib import Path

from tools.plan.migrate import migrate_milestones, prose_blocks
from tools.plan.model import load_milestones

PLAN = """## Milestones

### Track F — The canonical cross-platform client (`app/`)

| ID | Milestone | Spec | Depends | Status | Notes |
|---|---|---|---|---|---|
| F8 | FE-6 `packages/local-index` — three-layer history | 10 §6–§7 | F3 | ✅ | **Done.** Gap-tolerant coverage, candles. |
| F11 | FE-9 distribution — Vite build | 12 §1, §5 | F0 | 🔨 | Pipeline landed 2026-08-04. |

### Track S — Systemic verification

| ID | Milestone | Spec | Depends | Status | Notes |
|---|---|---|---|---|---|
| S7 | graph (a \\| b \\| c) | 13 §1 | S6 | ✅ | Done 2026-08-01. |
"""


class MigrateMilestonesTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def test_writes_one_file_per_milestone(self):
        written = migrate_milestones(PLAN, self.root)
        self.assertEqual(
            sorted(p.name for p in written), ["F11.md", "F8.md", "S7.md"]
        )

    def test_files_load_back_through_the_model(self):
        migrate_milestones(PLAN, self.root)
        items, errors = load_milestones(self.root)
        self.assertEqual(errors, [])
        by_id = {item.id: item for item in items}
        self.assertEqual(by_id["F8"].status, "done")
        self.assertEqual(by_id["F11"].status, "active")
        self.assertEqual(by_id["F8"].track, "F")
        self.assertEqual(by_id["F8"].depends, ("F3",))

    def test_escaped_pipes_survive_as_literal_pipes(self):
        migrate_milestones(PLAN, self.root)
        items, _ = load_milestones(self.root)
        s7 = next(item for item in items if item.id == "S7")
        self.assertEqual(s7.title, "graph (a | b | c)")
        self.assertEqual(s7.status, "done")

    def test_conversion_is_lossless(self):
        written = migrate_milestones(PLAN, self.root)
        before = prose_blocks(PLAN)
        after = sum(
            (prose_blocks(path.read_text(encoding="utf-8")) for path in written),
            start=type(before)(),
        )
        self.assertEqual(before - after, type(before)(), "blocks lost in conversion")

    def test_an_unknown_status_glyph_raises(self):
        bad = PLAN.replace("| ✅ | **Done.**", "| 🎉 | **Done.**")
        with self.assertRaises(ValueError):
            migrate_milestones(bad, self.root)
```

- [x] **Step 2: Run to verify it fails**

```bash
python3 -m unittest discover -s tools/plan/tests -t . -v 2>&1 | tail -10
```

Expected: FAIL with `ModuleNotFoundError: No module named 'tools.plan.migrate'`.

- [x] **Step 3: Write the implementation**

Create `tools/plan/migrate.py`:

```python
"""One-shot conversion of PLAN.md's tables into the plan/ item tree.

Every conversion carries its own losslessness proof: the multiset of normalized
prose blocks before must be a subset of the multiset after. The converter never
guesses. An unrecognised status glyph, a row with the wrong cell count, or a
track heading it cannot read is an error, not a default.
"""

from __future__ import annotations

import argparse
import collections
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from tools.plan.gfm import is_separator_row, split_cells, unescape_cell  # noqa: E402
from tools.plan.model import STATUS_GLYPHS  # noqa: E402

GLYPH_TO_STATUS = {glyph: status for status, glyph in STATUS_GLYPHS.items()}

TRACK_HEADING_RE = re.compile(r"^### Track ([A-Z]) — (.+)$")
MILESTONE_HEADER = ["ID", "Milestone", "Spec", "Depends", "Status", "Notes"]
_EMPHASIS = re.compile(r"[*_`]+")
_WHITESPACE = re.compile(r"\s+")


def normalize_prose(text: str) -> str:
    """Reduce a block to the words it carries, ignoring markup and escaping."""
    text = text.replace("\\|", "|")
    text = _EMPHASIS.sub("", text)
    return _WHITESPACE.sub(" ", text).strip()


def prose_blocks(text: str) -> collections.Counter:
    """The multiset of normalized non-empty blocks in a document."""
    blocks: collections.Counter = collections.Counter()
    for raw in re.split(r"\n\s*\n", text):
        for cell in re.split(r"(?<!\\)\|", raw):
            normalized = normalize_prose(cell)
            if normalized and normalized not in {"---", "ID", "Milestone", "Spec", "Depends", "Status", "Notes"}:
                blocks[normalized] += 1
    return blocks


def _yaml_scalar(value: str) -> str:
    """Emit a scalar the strict parser will read back identically."""
    if not value:
        raise ValueError("refusing to emit an empty scalar")
    if value[0] in "'\"[{|>-" or ": " in value or value != value.strip():
        escaped = value.replace('"', "'")
        return f'"{escaped}"'
    return value


def _yaml_list(values: list[str]) -> str:
    return "[" + ", ".join(_yaml_scalar(v) for v in values) + "]"


def _split_refs(cell: str) -> list[str]:
    if cell in {"—", "-", ""}:
        return []
    return [part.strip() for part in cell.split(";") if part.strip()]


def _split_depends(cell: str) -> list[str]:
    if cell in {"—", "-", ""}:
        return []
    return [part.strip() for part in re.split(r"[,/]", cell) if part.strip()]


def migrate_milestones(plan_text: str, out: Path) -> list[Path]:
    """Write plan/milestones/<ID>.md for every milestone row. Returns the paths."""
    directory = out / "plan" / "milestones"
    directory.mkdir(parents=True, exist_ok=True)

    written: list[Path] = []
    track: str | None = None
    in_milestones = False

    for number, line in enumerate(plan_text.split("\n"), start=1):
        if line.startswith("## "):
            in_milestones = line.strip() == "## Milestones"
            continue
        if not in_milestones:
            continue
        heading = TRACK_HEADING_RE.fullmatch(line.rstrip())
        if heading:
            track = heading.group(1)
            continue
        if not line.lstrip().startswith("|"):
            continue
        if is_separator_row(line):
            continue
        cells = split_cells(line)
        if cells == MILESTONE_HEADER:
            continue
        if len(cells) != 6:
            raise ValueError(f"PLAN.md:{number}: milestone row has {len(cells)} cells, expected 6")
        if track is None:
            raise ValueError(f"PLAN.md:{number}: milestone row appears before any '### Track X — ' heading")
        identifier, title, spec, depends, status_cell, notes = cells
        status = GLYPH_TO_STATUS.get(status_cell)
        if status is None:
            raise ValueError(f"PLAN.md:{number}: unrecognised status glyph {status_cell!r}")

        path = directory / f"{identifier}.md"
        if path.exists():
            raise ValueError(f"PLAN.md:{number}: duplicate milestone id {identifier!r}")
        lines = [
            "---",
            f"id: {identifier}",
            f"track: {track}",
            f"title: {_yaml_scalar(title)}",
            f"spec: {_yaml_list(_split_refs(spec))}",
            f"depends: {_yaml_list(_split_depends(depends))}",
            f"status: {status}",
            "---",
            "",
            notes,
            "",
        ]
        path.write_text("\n".join(lines), encoding="utf-8")
        written.append(path)
        print(f"wrote {path.relative_to(out)}", file=sys.stderr)

    return written


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("kind", choices=["milestones"])
    parser.add_argument("--plan", type=Path, default=Path("PLAN.md"))
    parser.add_argument("--out", type=Path, default=Path("."))
    args = parser.parse_args(argv)

    text = args.plan.read_text(encoding="utf-8")
    written = migrate_milestones(text, args.out)

    before = prose_blocks(_milestones_section(text))
    after: collections.Counter = collections.Counter()
    for path in written:
        after += prose_blocks(path.read_text(encoding="utf-8"))
    lost = before - after
    print(f"{len(written)} files, {sum(before.values())} blocks in, {sum(after.values())} blocks out")
    if lost:
        for block in list(lost)[:20]:
            print(f"LOST: {block[:160]}", file=sys.stderr)
        print(f"{len(lost)} distinct blocks lost in conversion", file=sys.stderr)
        return 1
    print("losslessness proof: OK")
    return 0


def _milestones_section(text: str) -> str:
    lines = text.split("\n")
    start = lines.index("## Milestones")
    for index in range(start + 1, len(lines)):
        if lines[index].startswith("## "):
            return "\n".join(lines[start:index])
    return "\n".join(lines[start:])


if __name__ == "__main__":
    raise SystemExit(main())
```

- [x] **Step 4: Run to verify it passes**

```bash
python3 -m unittest discover -s tools/plan/tests -t . -v 2>&1 | tail -5
```

Expected: PASS, 6 new tests.

- [x] **Step 5: Run the real conversion and read the proof**

```bash
python3 tools/plan/migrate.py milestones --plan PLAN.md --out .
```

Expected: about 117 files written, then `losslessness proof: OK`. **If any block is lost, stop and fix the converter.** Do not hand-edit an emitted file to make the proof pass — the proof exists to catch exactly that.

- [x] **Step 6: Verify the tree loads back cleanly**

```bash
python3 -c "
from pathlib import Path
import sys; sys.path.insert(0, '.')
from tools.plan.model import load_milestones
items, errors = load_milestones(Path('.'))
print(len(items), 'milestones,', len(errors), 'errors')
for e in errors[:20]: print(' ', e)
import collections; print(collections.Counter(i.status for i in items))
"
```

Expected: 0 errors, and a status count of `done 101 / pending 10 / active 6` over 117 milestones.

- [x] **Step 7: Commit**

```bash
git add tools/plan plan/milestones
git commit -m "feat(plan): convert the milestone tables into plan/milestones/ item files"
```

---

### Task 4: Render the milestone index, and gate it in CI

**Files:**
- Create: `tools/plan/render.py`
- Create: `tools/plan/tests/test_render.py`
- Create: `plan/MILESTONES.md` (generated)
- Modify: `.github/workflows/ci.yml` (the `docs` job)

**Interfaces:**
- Consumes: `tools.plan.model.load_milestones`, `tools.plan.model.STATUS_GLYPHS`.
- Produces:
  - `render_milestones(items: list[Milestone]) -> str`.
  - `escape_cell(text: str) -> str` — escapes `|` as `\|` so a rendered row can never be severed.
  - CLI: `python3 tools/plan/render.py --write` and `python3 tools/plan/render.py --check`.

- [x] **Step 1: Write the failing test**

Create `tools/plan/tests/test_render.py`:

```python
"""The renderer emits narrow rows and escapes what it writes.

A generated table cannot drift, which serves the 2026-07-17 standing instruction
more strongly than a checker does — but only if the renderer escapes the pipe
that severed rows before.
"""

import tempfile
import unittest
from pathlib import Path

from tools.plan.model import Milestone
from tools.plan.render import escape_cell, main, render_milestones


def milestone(**kwargs):
    defaults = dict(
        id="F8",
        track="F",
        title="FE-6 local-index",
        spec=("10 §6",),
        depends=("F3",),
        status="done",
        verify=(),
        body="",
        path=Path("plan/milestones/F8.md"),
    )
    defaults.update(kwargs)
    return Milestone(**defaults)


class RenderTests(unittest.TestCase):
    def test_row_carries_the_glyph_not_the_enum(self):
        out = render_milestones([milestone()])
        self.assertIn("| ✅ |", out)
        self.assertNotIn("done", out)

    def test_title_is_truncated_and_linked(self):
        long_title = "x" * 200
        out = render_milestones([milestone(title=long_title)])
        row = next(line for line in out.split("\n") if line.startswith("| F8 "))
        self.assertLess(len(row), 200)
        self.assertIn("[", row)
        self.assertIn("milestones/F8.md", row)

    def test_a_pipe_in_a_title_is_escaped(self):
        out = render_milestones([milestone(title="a | b")])
        self.assertIn("a \\| b", out)

    def test_escape_cell(self):
        self.assertEqual(escape_cell("a | b"), "a \\| b")

    def test_check_fails_on_a_hand_edited_index(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            (root / "plan" / "milestones").mkdir(parents=True)
            (root / "plan" / "milestones" / "F8.md").write_text(
                "---\nid: F8\ntrack: F\ntitle: t\nspec: [a]\ndepends: []\nstatus: done\n---\n\nbody\n",
                encoding="utf-8",
            )
            self.assertEqual(main(["--write", "--root", str(root)]), 0)
            self.assertEqual(main(["--check", "--root", str(root)]), 0)
            index = root / "plan" / "MILESTONES.md"
            index.write_text(index.read_text(encoding="utf-8") + "| tampered |\n", encoding="utf-8")
            self.assertEqual(main(["--check", "--root", str(root)]), 1)
```

- [x] **Step 2: Run to verify it fails**

```bash
python3 -m unittest discover -s tools/plan/tests -t . -v 2>&1 | tail -10
```

Expected: FAIL with `ModuleNotFoundError: No module named 'tools.plan.render'`.

- [x] **Step 3: Write the implementation**

Create `tools/plan/render.py`:

```python
"""Generate the human indexes from the plan/ item tree.

--write regenerates. --check fails when the committed output differs from a
fresh render, matching regenerate-weights.py --check and
generate-vectors.py --check. The item files are the only input, so the index can
never become a second source of truth.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from tools.plan.model import STATUS_GLYPHS, load_milestones  # noqa: E402

TITLE_WIDTH = 90
BANNER = "<!-- Generated by tools/plan/render.py. Do not edit by hand. -->"


def escape_cell(text: str) -> str:
    """GFM splits a cell on a bare pipe, even inside backticks."""
    return text.replace("|", "\\|")


def _truncate(text: str) -> str:
    if len(text) <= TITLE_WIDTH:
        return text
    return text[: TITLE_WIDTH - 1].rstrip() + "…"


def render_milestones(items) -> str:
    lines = [BANNER, "", "# Milestones", ""]
    for track in sorted({item.track for item in items}):
        lines += [f"## Track {track}", ""]
        lines += ["| ID | Milestone | Spec | Depends | Status |", "|---|---|---|---|---|"]
        for item in sorted(
            (i for i in items if i.track == track), key=lambda i: (len(i.id), i.id)
        ):
            # The two literals are kept apart so this source line is not itself a
            # Markdown link. check-doc-links.py matches link syntax anywhere in a
            # file, fenced code included, and would try to resolve the f-string.
            target = f"milestones/{item.id}.md"
            link = f"[{escape_cell(_truncate(item.title))}]" f"({target})"
            spec = escape_cell("; ".join(item.spec)) or "—"
            depends = escape_cell(", ".join(item.depends)) or "—"
            lines.append(
                f"| {item.id} | {link} | {spec} | {depends} | {STATUS_GLYPHS[item.status]} |"
            )
        lines.append("")
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--write", action="store_true")
    mode.add_argument("--check", action="store_true")
    parser.add_argument("--root", type=Path, default=Path("."))
    args = parser.parse_args(argv)

    items, errors = load_milestones(args.root)
    if errors:
        for error in errors:
            print(error, file=sys.stderr)
        return 1

    outputs = {args.root / "plan" / "MILESTONES.md": render_milestones(items)}

    failed = False
    for path, expected in outputs.items():
        if args.write:
            path.write_text(expected, encoding="utf-8")
            print(f"wrote {path}")
            continue
        actual = path.read_text(encoding="utf-8") if path.exists() else ""
        if actual != expected:
            print(f"{path}: differs from a fresh render; run tools/plan/render.py --write", file=sys.stderr)
            failed = True
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [x] **Step 4: Run to verify it passes**

```bash
python3 -m unittest discover -s tools/plan/tests -t . -v 2>&1 | tail -5
```

Expected: PASS, 5 new tests.

- [x] **Step 5: Generate the real index and read it**

```bash
python3 tools/plan/render.py --write
python3 tools/plan/render.py --check && echo "check clean"
awk '{ if (length($0) > 200) print FILENAME": "NR" is "length($0)" chars" }' plan/MILESTONES.md
```

Expected: the index is written, `--check` is clean, and **no row exceeds 200 characters**. If a row is longer, lower `TITLE_WIDTH`.

- [x] **Step 6: Wire it into CI**

In `.github/workflows/ci.yml`, in the `docs` job, after the `check-plan-tables.py` step, add:

```yaml
      - name: Plan index is freshly rendered
        run: python3 tools/plan/render.py --check
```

- [x] **Step 7: Verify the workflow-wiring suite still passes**

```bash
python3 -m unittest discover -s tools/ci/tests 2>&1 | grep -E '^(OK|FAILED|Ran )'
```

Expected: PASS. That suite reads `ci.yml` itself.

- [x] **Step 8: Commit**

```bash
git add tools/plan plan/MILESTONES.md .github/workflows/ci.yml
git commit -m "feat(plan): render the milestone index and gate its freshness in CI"
```

---

### Task 5: Move the four milestone consumers to frontmatter

> **Correction, made during implementation.** An earlier draft of this plan and
> of the spec claimed `check_alert_coverage.py` misses a second milestone table
> under `## Track E`. That is **false**. `PLAN.md` has one `## Milestones`
> heading holding all 117 rows, including `### Track E — Protocol revenue and
> treasury sustainability` (E1 to E6) as a level-3 subsection. The separate
> level-2 `## Track E — crossover arithmetic and the self-funding statement`
> carries a `| Quantity \| Value \| Source |`-shaped table and no milestones.
> Old and new parses both see 117 milestones with identical statuses, and no
> seam expiry changes. This task fixes no pre-existing gate defect: it changes
> how status is read, not what is read.

**Files:**
- Modify: `.claude/hooks/guard-track-goal.sh` (the heredoc Python block)
- Modify: `.claude/hooks/session-context.sh:30-52`
- Modify: `tools/limit-coverage/check-limit-coverage.py` (`load_milestone_ids`)
- Modify: `tools/monitoring/check_alert_coverage.py` (`load_milestone_statuses`, around line 240)
- Modify: `tools/monitoring/tests/test_coverage_checker.py` (its milestone fixtures)
- Modify: `tools/limit-coverage/tests/test_check_limit_coverage.py` (its milestone fixtures)

**Interfaces:**
- Consumes: `tools.plan.model.load_milestones`.
- Produces: nothing importable. Each consumer's contract is unchanged; only its input moves.

- [x] **Step 1: Change the monitoring gate's fixture to a plan/ tree**

In `tools/monitoring/tests/test_coverage_checker.py`, replace each fixture that writes a `PLAN.md` milestone table with one that writes item files:

```python
    def write_milestone(self, root, identifier, track, status):
        directory = root / "plan" / "milestones"
        directory.mkdir(parents=True, exist_ok=True)
        (directory / f"{identifier}.md").write_text(
            f"---\nid: {identifier}\ntrack: {track}\ntitle: t\n"
            f"spec: [a]\ndepends: []\nstatus: {status}\n---\n\nbody\n",
            encoding="utf-8",
        )
```

- [x] **Step 2: Run to verify it fails**

```bash
python3 -m unittest discover -s tools/monitoring/tests -v 2>&1 | tail -10
```

Expected: FAIL — the gate still reads `PLAN.md` and finds no milestone table.

- [x] **Step 3: Rewrite `load_milestone_statuses`**

Replace the whole function in `tools/monitoring/check_alert_coverage.py` with:

```python
def load_milestone_statuses(root: Path) -> tuple[dict[str, str], list[str]]:
    """Milestone id -> status enum, from the plan/ item tree.

    Replaces a GFM table parse that read the status by cell position, which
    is what let escaped pipes in row S7 be read as a status.
    """
    items, errors = load_milestones(root)
    return {item.id: item.status for item in items}, errors
```

Add the import, and update its one call site to pass the repository root rather than `root / "PLAN.md"`. Every comparison against `"✅"` becomes a comparison against `"done"`.

- [x] **Step 4: Run to verify it passes**

```bash
python3 -m unittest discover -s tools/monitoring/tests -v 2>&1 | grep -E '^(OK|FAILED|Ran )'
python3 tools/monitoring/check_alert_coverage.py
```

Expected: PASS, and the checker exits 0.

- [x] **Step 5: Do the same for `check-limit-coverage.py`**

Replace `load_milestone_ids` with:

```python
def load_milestone_ids(root: Path) -> tuple[set[str], set[str], list[str]]:
    items, errors = load_milestones(root)
    identifiers = {item.id for item in items}
    completed = {item.id for item in items if item.status == "done"}
    if not identifiers:
        return set(), set(), errors + ["plan/milestones/ contains no milestones"]
    return identifiers, completed, errors
```

Update its call site to pass `root` instead of `root / "PLAN.md"`, and update the fixtures in `tools/limit-coverage/tests/test_check_limit_coverage.py` to write item files.

- [x] **Step 6: Run both suites and both checkers**

```bash
python3 -m unittest discover -s tools/limit-coverage/tests 2>&1 | grep -E '^(OK|FAILED|Ran )'
python3 tools/limit-coverage/check-limit-coverage.py
```

Expected: PASS, exit 0.

- [x] **Step 7: Rewrite the track-goal guard's counting block**

Replace the heredoc Python's milestone loop with:

```python
sys.path.insert(0, ".")
from pathlib import Path
from tools.plan.model import load_milestones

items, errors = load_milestones(Path("."))
if errors:
    print("NOTRACK")
    raise SystemExit
rows = [i for i in items if i.track == track]
done = sum(1 for i in rows if i.status == "done")
open_rows = [i for i in rows if i.status != "done"]

if not rows:
    print("NOTRACK")
elif not open_rows:
    print("COMPLETE")
else:
    active = [i.id for i in open_rows if i.status == "active"]
    nxt = active[0] if active else open_rows[0].id
    print(f"OPEN {done} {len(open_rows)} {nxt}")
```

Keep the `> **PARKED:**` escape exactly as it is. It still reads `PLAN.md`.

- [x] **Step 8: Prove the guard against every track**

```bash
for t in M A B E N S F O G; do
  printf 'track: %s\n' "$t" > .claude/session-goal
  printf '%s: ' "$t"
  bash .claude/hooks/guard-track-goal.sh <<< '{"stop_hook_active":false}' | jq -r '.reason // "no block"' | head -c 120
  echo
done
rm .claude/session-goal
```

Expected: each track reports a plausible next milestone or no block. Compare against `plan/MILESTONES.md` by eye. **Track S must not name S7.**

- [x] **Step 9: Rewrite the session-context hook's milestone block**

Replace the awk block added on 2026-08-12 with:

```bash
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
```

- [x] **Step 10: Run the hook and read its whole output**

```bash
CLAUDE_PROJECT_DIR=$PWD .claude/hooks/session-context.sh | tee /tmp/hook.txt | head -60
wc -c /tmp/hook.txt
```

Expected: under 8,000 characters, and the milestone list matches `plan/MILESTONES.md`.

- [x] **Step 11: Commit**

```bash
git add .claude/hooks tools/limit-coverage tools/monitoring
git commit -m "refactor(plan): read milestone status from frontmatter in all four consumers"
```

---

### Task 6: Convert the spec questions

**Files:**
- Modify: `tools/plan/migrate.py` (add `migrate_questions`)
- Modify: `tools/plan/tests/test_migrate.py`
- Modify: `tools/plan/render.py` (add `render_questions`)
- Modify: `tools/plan/tests/test_render.py`
- Create: `plan/questions/*.md` (583 files)
- Create: `plan/QUESTIONS.md` (generated)

**Interfaces:**
- Consumes: `split_cells`, `prose_blocks`, `load_questions`.
- Produces: `migrate_questions(plan_text: str, out: Path) -> list[Path]`, `render_questions(items: list[Question]) -> str`.

The question table is `| ID | Question | Spec ref | Raised | Status |`. The batch index is a separate table, `| Batch | Rows | Members |`, whose Members cell lists the ids in that batch. The converter reads the batch index once, builds an id-to-batch map, and writes `batch:` onto each question. A question named by no batch, or by two, is an error.

The `Status` cell is prose. The converter takes the enum from its first word, takes a `resolved:` date from the first `YYYY-MM-DD` when there is one, and puts the **whole original cell** into the body under a `## Status` heading so the proof cannot lose it.

**The first word is not one of two words. It is one of ten**, measured over the 583 rows:

| First word | Rows | Maps to |
|---|---|---|
| `open` | 166 | `open` |
| `resolved` | 389 | `resolved` |
| `✅` | 7 | `resolved` |
| `closed` | 7 | `resolved` |
| `ruled` | 7 | `resolved` |
| `reconciled` | 3 | `resolved` |
| `ratified` | 1 | `resolved` |
| `largely` | 1 | `resolved` |
| `oracle` | 1 | `resolved` |
| `diagnosed;` | 1 | `resolved` |

Every non-`open` word maps to `resolved`, and that **preserves today's behavior exactly**: the four citation gates ask whether the cell begins with `open` and treat everything else as resolved, so all 28 already count as resolved. The converter must not improve on that reading while also moving the data — one change at a time.

**Four rows are genuinely partial** and the migration report must name them for a human ruling: `SQ-2` ("oracle portion resolved… the remaining three batch items"), `SQ-103` ("largely resolved"), `SQ-568` ("diagnosed; fix in verification"), `SQ-593` ("ruled 2026-08-05; execution pending"). They ship as `resolved`, unchanged from today, and the report says so out loud.

**10 of the 389 resolved rows carry no date.** `resolved:` is omitted for those rather than invented.

- [x] **Step 1: Write the failing test**

Append to `tools/plan/tests/test_migrate.py`:

```python
QUESTIONS = """## Spec questions

| Batch | Rows | Members |
|---|---|---|
| B7 | 2 | SQ-615, SQ-616 |

| ID | Question | Spec ref | Raised | Status |
|---|---|---|---|---|
| SQ-615 | Does 11 §11.8 need a frozen surface? | 02 §7.4 | 2026-07-19 | resolved 2026-08-06 — contract v28 froze it |
| SQ-616 | Which arm raises QueueFull? | 09 §1.2 | 2026-07-20 | open — the guard declares it, execute never returns it |
"""


class MigrateQuestionsTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def test_status_enum_and_batch_come_from_the_right_places(self):
        from tools.plan.migrate import migrate_questions
        from tools.plan.model import load_questions

        migrate_questions(QUESTIONS, self.root)
        items, errors = load_questions(self.root)
        self.assertEqual(errors, [])
        by_id = {i.id: i for i in items}
        self.assertEqual(by_id["SQ-615"].status, "resolved")
        self.assertEqual(by_id["SQ-615"].resolved, "2026-08-06")
        self.assertEqual(by_id["SQ-615"].batch, "B7")
        self.assertEqual(by_id["SQ-616"].status, "open")
        self.assertIsNone(by_id["SQ-616"].resolved)

    def test_the_whole_status_cell_survives_in_the_body(self):
        from tools.plan.migrate import migrate_questions

        migrate_questions(QUESTIONS, self.root)
        body = (self.root / "plan" / "questions" / "SQ-616.md").read_text(encoding="utf-8")
        self.assertIn("the guard declares it, execute never returns it", body)

    def test_a_question_in_no_batch_is_an_error(self):
        from tools.plan.migrate import migrate_questions

        text = QUESTIONS.replace("| B7 | 2 | SQ-615, SQ-616 |", "| B7 | 1 | SQ-615 |")
        with self.assertRaises(ValueError) as caught:
            migrate_questions(text, self.root)
        self.assertIn("SQ-616", str(caught.exception))
```

- [x] **Step 2: Run to verify it fails**

```bash
python3 -m unittest discover -s tools/plan/tests -t . -v 2>&1 | tail -10
```

Expected: FAIL with `ImportError: cannot import name 'migrate_questions'`.

- [x] **Step 3: Implement `migrate_questions`**

Add to `tools/plan/migrate.py`:

```python
QUESTION_HEADER = ["ID", "Question", "Spec ref", "Raised", "Status"]
BATCH_HEADER = ["Batch", "Rows", "Members"]
_DATE_IN_TEXT = re.compile(r"\b(\d{4}-\d{2}-\d{2})\b")

# The status vocabulary as it is, not as it ought to be. Every non-"open" word
# already counts as resolved for the four citation gates, which ask only whether
# the cell begins with "open". This map preserves that reading exactly; changing
# it is a separate decision from moving the data.
STATUS_WORDS = {
    "open": "open",
    "resolved": "resolved",
    "✅": "resolved",
    "closed": "resolved",
    "ruled": "resolved",
    "reconciled": "resolved",
    "ratified": "resolved",
    "largely": "resolved",
    "oracle": "resolved",
    "diagnosed;": "resolved",
}

# Rows whose status word admits the question is only partly settled. They ship
# as resolved, unchanged from today, and the run reports them for a human.
PARTIAL_WORDS = {"largely", "oracle", "diagnosed;"}


def _question_batches(section: str) -> dict[str, str]:
    """id -> batch label, read from the batch index table."""
    batches: dict[str, str] = {}
    for line in section.split("\n"):
        if not line.lstrip().startswith("|"):
            continue
        if is_separator_row(line):
            continue
        cells = split_cells(line)
        if cells == BATCH_HEADER or len(cells) != 3:
            continue
        label, _rows, members = cells
        if not re.fullmatch(r"B\d+", label):
            continue
        for member in re.findall(r"SQ-\d+", members):
            if member in batches:
                raise ValueError(f"{member} is named by both batch {batches[member]} and batch {label}")
            batches[member] = label
    return batches


def migrate_questions(plan_text: str, out: Path) -> list[Path]:
    section = _section(plan_text, "## Spec questions")
    batches = _question_batches(section)
    directory = out / "plan" / "questions"
    directory.mkdir(parents=True, exist_ok=True)

    written: list[Path] = []
    partial: list[str] = []
    for number, line in enumerate(section.split("\n"), start=1):
        if not line.lstrip().startswith("|"):
            continue
        if is_separator_row(line):
            continue
        cells = [unescape_cell(cell) for cell in split_cells(line)]
        if cells == QUESTION_HEADER or len(cells) != 5:
            continue
        if not re.fullmatch(r"SQ-\d+", cells[0]):
            continue
        identifier, question, spec_ref, raised, status_cell = cells

        word = status_cell.split()[0].strip("*_`.,").lower() if status_cell.split() else ""
        if word not in STATUS_WORDS:
            raise ValueError(
                f"spec question {identifier}: unknown status word {word!r}. "
                f"Add it to STATUS_WORDS only after reading the row — do not default it."
            )
        status = STATUS_WORDS[word]
        if word in PARTIAL_WORDS:
            partial.append(identifier)
        batch = batches.get(identifier)
        if batch is None:
            raise ValueError(f"spec question {identifier} is named by no batch")

        # A resolved row may carry no date. 10 of 389 do not, and inventing one
        # would be a fabrication the losslessness proof cannot catch.
        found = _DATE_IN_TEXT.search(status_cell)
        resolved = found.group(1) if (status == "resolved" and found) else None

        path = directory / f"{identifier}.md"
        if path.exists():
            raise ValueError(f"duplicate spec question id {identifier!r}")
        lines = [
            "---",
            f"id: {identifier}",
            f"title: {_yaml_scalar(question)}",
            f"spec_ref: {_yaml_scalar(spec_ref)}",
            f"raised: {raised}",
            f"status: {first}",
        ]
        if resolved:
            lines.append(f"resolved: {resolved}")
        lines += [f"batch: {batch}", "---", "", "## Status", "", status_cell, ""]
        path.write_text("\n".join(lines), encoding="utf-8")
        written.append(path)

    for identifier in batches:
        if not (directory / f"{identifier}.md").exists():
            raise ValueError(f"batch names {identifier}, which is not a row of the question table")
    if partial:
        print(
            "PARTIAL — these shipped as resolved, unchanged from today, and need a human ruling: "
            + ", ".join(sorted(partial)),
            file=sys.stderr,
        )
    return written


def _section(text: str, heading: str) -> str:
    lines = text.split("\n")
    start = lines.index(heading)
    for index in range(start + 1, len(lines)):
        if lines[index].startswith("## "):
            return "\n".join(lines[start:index])
    return "\n".join(lines[start:])
```

Replace the existing `_milestones_section` with a call to `_section(text, "## Milestones")` and delete it. Extend `main`'s `kind` choices to `["milestones", "questions"]` and dispatch on it, keeping the same proof.

- [x] **Step 4: Run to verify it passes**

```bash
python3 -m unittest discover -s tools/plan/tests -t . -v 2>&1 | tail -5
```

Expected: PASS.

- [x] **Step 5: Run the real conversion**

```bash
python3 tools/plan/migrate.py questions --plan PLAN.md --out .
ls plan/questions | wc -l
```

Expected: 583 files, and `losslessness proof: OK`. A raised `ValueError` names the exact question to fix. **Fix the converter or the source row, never the emitted file.**

- [x] **Step 6: Add `render_questions` and regenerate**

Add to `tools/plan/render.py`, following `render_milestones` exactly, grouping by `status` (open first) and emitting `| ID | Question | Spec ref | Raised | Batch |` with the id linked to its file. Add `plan/QUESTIONS.md` to the `outputs` dict. Add a test mirroring `test_check_fails_on_a_hand_edited_index`.

```bash
python3 tools/plan/render.py --write && python3 tools/plan/render.py --check && echo clean
```

- [x] **Step 7: Commit**

```bash
git add tools/plan plan/questions plan/QUESTIONS.md
git commit -m "feat(plan): convert the spec-question table into plan/questions/ item files"
```

---

### Task 7: Move the three spec-question gates to frontmatter

**Files:**
- Modify: `tools/ci/check-unreadable-obligations.py` (its `load_question_statuses`, around line 101)
- Modify: `tools/ci/check-release-blocker-citations.py` (same function, around line 95)
- Modify: `tools/ci/check-client-surface-obligations.py` (its open-question loader, around line 168)
- Modify: `tools/ci/check-spec-question-batches.py` (delete the structural half)
- Modify: `tools/ci/tests/test_check_spec_question_batches.py`, `tools/ci/tests/test_check_release_blocker_citations.py`

**Interfaces:**
- Consumes: `tools.plan.model.load_questions`.
- Produces: nothing importable.

- [x] **Step 1: Change one gate's fixtures first**

In `tools/ci/tests/test_check_release_blocker_citations.py`, replace each fixture that writes a `PLAN.md` question table with one writing `plan/questions/SQ-n.md` files, using the helper shape from Task 5 step 1.

- [x] **Step 2: Run to verify it fails**

```bash
python3 -m unittest discover -s tools/ci/tests -v 2>&1 | tail -12
```

Expected: FAIL — the gate reads `PLAN.md` and parses no questions.

- [x] **Step 3: Replace the loader in all three gates**

Each of the three files carries a near-identical `load_question_statuses`. Replace each with:

```python
def load_question_statuses(root: Path) -> tuple[dict[str, str], list[str]]:
    """`SQ-n` -> "open" | "resolved", from the plan/ item tree.

    Replaces a reading that asked whether a status *cell* began with the word
    "open" — necessary while the cell was prose, because an open row's prose
    legitimately contains the word "resolved". `status` is now an enum.
    """
    items, errors = load_questions(root)
    return {item.id: item.status for item in items}, errors
```

Update each call site to pass the repository root. Every `startswith("open")` test becomes `== "open"`.

- [x] **Step 4: Run every affected suite and checker**

```bash
python3 -m unittest discover -s tools/ci/tests 2>&1 | grep -E '^(OK|FAILED|Ran )'
python3 tools/ci/check-unreadable-obligations.py
python3 tools/ci/check-release-blocker-citations.py
python3 tools/ci/check-client-surface-obligations.py
```

Expected: PASS, and all three exit 0 with their usual counts.

- [x] **Step 5: Shrink the batch checker**

In `tools/ci/check-spec-question-batches.py`, delete the duplicate-id check, the per-batch row-count check and the two-batch check. Each is now impossible: an id is a filename, and `batch:` is one scalar on one file. Keep only:

```python
def check(root: Path) -> list[str]:
    """Every question's batch label must be one the index declares."""
    items, errors = load_questions(root)
    declared = declared_batches(root)          # unchanged, reads plan/QUESTIONS.md's batch table
    for item in items:
        if item.batch not in declared:
            errors.append(f"plan/questions/{item.id}.md: batch {item.batch!r} is not a declared batch")
    return errors
```

Delete the now-dead tests in `tools/ci/tests/test_check_spec_question_batches.py` and add one asserting an undeclared batch label fails.

- [x] **Step 6: Run the suite and the checker**

```bash
python3 -m unittest discover -s tools/ci/tests 2>&1 | grep -E '^(OK|FAILED|Ran )'
python3 tools/ci/check-spec-question-batches.py
```

Expected: PASS, exit 0.

- [x] **Step 7: Commit**

```bash
git add tools/ci
git commit -m "refactor(plan): read spec-question status from frontmatter in the three citation gates"
```

---

### Task 8: Convert the verification records

**Files:**
- Modify: `tools/plan/migrate.py` (add `migrate_verifications`)
- Modify: `tools/plan/render.py` (add `render_verifications`)
- Modify: `tools/plan/tests/test_migrate.py`, `tools/plan/tests/test_render.py`
- Modify: `tools/ci/check-plan-tables.py` (delete the V-id uniqueness check and its grandfather list at lines 121-160)
- Modify: `tools/ci/tests/test_check_plan_tables.py`
- Create: `plan/verifications/*.md` (224 files), `plan/VERIFICATIONS.md`

**Interfaces:**
- Consumes: `split_cells`, `prose_blocks`, `load_verifications`.
- Produces: `migrate_verifications(plan_text: str, out: Path) -> list[Path]`, `render_verifications(items) -> str`.

The table is `| ID | Item | Spec ref | Status | Result |`, uniformly 5 cells across all 224 rows. The `Item` cell becomes `title`. The `Status` cell usually carries the date, as in `**re-measured 2026-08-07**`.

**12 of the 224 rows carry no date at all** (`V-2`, `V-4`, `V-5`, `V-7`, `V-9`, `V-10`, `V-11`, `V-175`, `V-176`, `V-177` and two more). For those the converter **omits `date:`** rather than inventing one — `Verification.date` is `str | None` for exactly this reason. The run prints the ids it could not date, so the count is visible rather than assumed.

`milestone:` comes from the Result cell's first milestone-shaped token. When there is none, the converter writes `milestone: "—"` rather than guessing.

- [x] **Step 1: Write the failing test, mirroring Task 6 step 1**

Use a three-row `## Verification log` fixture: one dated row, one row whose Status cell carries no date, and one row whose Result names no milestone. Assert that the undated row loads with `date is None` and that **no exception is raised**, that the milestone-less row gets `"—"`, and that `prose_blocks` before equals after.

- [x] **Step 2: Run to verify it fails**

```bash
python3 -m unittest discover -s tools/plan/tests -t . -v 2>&1 | tail -10
```

- [x] **Step 3: Implement `migrate_verifications`**, following `migrate_questions` line for line: read the section, skip separators and the header, require 5 cells, require an id matching `V-\d+`, extract the date **when there is one**, refuse a duplicate filename, and write the frontmatter with the Status and Result cells in the body. Collect the undated ids and print them at the end, as `migrate_questions` prints its partial ids.

- [x] **Step 4: Run to verify it passes**

```bash
python3 -m unittest discover -s tools/plan/tests -t . -v 2>&1 | tail -5
```

- [x] **Step 5: Run the real conversion**

```bash
python3 tools/plan/migrate.py verifications --plan PLAN.md --out .
ls plan/verifications | wc -l
```

Expected: 224 files and `losslessness proof: OK`.

- [x] **Step 6: Delete the V-id uniqueness check**

In `tools/ci/check-plan-tables.py`, delete the grandfathered-duplicate list and the uniqueness pass, and the note explaining them. A duplicate is now a duplicate filename, which the filesystem refuses. Delete the corresponding tests and add one line to the module docstring saying where the guarantee moved.

- [x] **Step 7: Run everything touched**

```bash
python3 -m unittest discover -s tools/ci/tests 2>&1 | grep -E '^(OK|FAILED|Ran )'
python3 tools/ci/check-plan-tables.py
python3 tools/plan/render.py --write && python3 tools/plan/render.py --check && echo clean
```

- [x] **Step 8: Commit**

```bash
git add tools/plan tools/ci plan/verifications plan/VERIFICATIONS.md
git commit -m "feat(plan): convert the verification log into plan/verifications/ item files"
```

---

### Task 9: Convert the four day-file kinds

**Files:**
- Modify: `tools/plan/migrate.py` (add `migrate_day_records`)
- Modify: `tools/plan/render.py` (add `render_decisions`)
- Modify: `tools/plan/tests/test_migrate.py`
- Create: `plan/log/YYYY/MM/*.md`, `plan/decisions/YYYY/MM/*.md`, `plan/audits/YYYY/MM/*.md`, `plan/changes/YYYY/MM/*.md`, `plan/DECISIONS.md`

**Interfaces:**
- Consumes: `split_cells`, `prose_blocks`.
- Produces:
  - `migrate_day_records(section: str, kind: str, out: Path, columns: list[str]) -> list[Path]`.
  - `read_day_records(root: Path, kind: str) -> tuple[list[DayRecord], list[str]]` in `model.py`, where `DayRecord` carries `date: str`, `heading: str`, `fields: dict[str, str]`, `body: str`, `path: Path`.

Each source table has a different header, so `columns` names which cell becomes the heading and which become `key: value` lines:

| Kind | Source section | Header | Heading cell | Field cells |
|---|---|---|---|---|
| `log` | `## Session log` | `Date \| Milestone \| What was done \| What comes next` | Milestone | — |
| `decisions` | `## Decision log` | `Date \| Amendment \| Authorized by \| Docs touched` | Amendment | `authorized_by`, `docs_touched` |
| `audits` | `## Audit log` | `Date \| Scope \| Verdict \| Pointer` | Scope | `verdict`, `pointer` |
| `changes` | `## Unplanned changes` | bullet list, `- YYYY-MM-DD — **Title.** prose` | the bolded lead | — |

`changes` is a bullet list rather than a table, so it needs its own reader: split on `^- (\d{4}-\d{2}-\d{2}) — `, take the first bolded run as the heading, and keep the rest as the body including its indented continuation paragraphs.

**Three session-log rows carry a date range, not a date:** `2026-07-15–16`, `2026-08-07/08` and `2026-08-08/09`. The Decision log (263 rows) and Audit log (12 rows) have none — every first cell there is a bare date. The rule for a range is: **file the entry under its first date, and carry the original string in a `span:` field** so the range is not silently flattened.

```python
_DAY_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})")

def _day_and_span(cell: str) -> tuple[str, str | None]:
    text = cell.strip("*_` ")
    match = _DAY_RE.match(text)
    if match is None:
        raise ValueError(f"record date cell does not begin with a date: {cell[:40]!r}")
    day = match.group(1)
    return day, (text if text != day else None)
```

- [x] **Step 1: Write the failing test**

Append to `tools/plan/tests/test_migrate.py` a fixture per kind, and assert: the emitted path is `plan/<kind>/2026/08/2026-08-09.md`, two records on the same date land in **one** file in source order, and `prose_blocks` before equals after.

- [x] **Step 2: Run to verify it fails**

```bash
python3 -m unittest discover -s tools/plan/tests -t . -v 2>&1 | tail -10
```

- [x] **Step 3: Implement `migrate_day_records` and `read_day_records`**

The day-file shape is fixed by the spec:

```markdown
# Decisions — 2026-08-09

## Track F compat verdict reaches the shell without a new contract bump
authorized_by: user
docs_touched: 10 §5.2

The classifier probes exactly the frozen set…
```

`read_day_records` must refuse a `## ` heading whose next non-blank lines are not a `key: value` block when the kind declares fields, and must refuse a file whose `# ` title date does not match its path.

- [x] **Step 4: Run to verify it passes**

```bash
python3 -m unittest discover -s tools/plan/tests -t . -v 2>&1 | tail -5
```

- [x] **Step 5: Run all four conversions**

```bash
for kind in log decisions audits changes; do
  python3 tools/plan/migrate.py "$kind" --plan PLAN.md --out . || exit 1
done
find plan/log plan/decisions plan/audits plan/changes -name '*.md' | wc -l
ls -S $(find plan/log -name '*.md') | head -1 | xargs wc -c
```

Expected: every conversion prints `losslessness proof: OK`, and **the largest day file is under 200,000 bytes**. If one is larger, that day carried an unusual volume and stays as it is — the GitHub limit is 1 MB.

- [x] **Step 6: Add `render_decisions` and regenerate**

Only decisions are indexed. Emit `| Date | Amendment | Authorized by |` with the amendment linked to its day file and heading anchor. Add `plan/DECISIONS.md` to `outputs`.

```bash
python3 tools/plan/render.py --write && python3 tools/plan/render.py --check && echo clean
python3 tools/ci/check-doc-links.py | tail -1
```

Expected: clean, and every generated anchor resolves.

- [x] **Step 7: Commit**

```bash
git add tools/plan plan/log plan/decisions plan/audits plan/changes plan/DECISIONS.md
git commit -m "feat(plan): convert the session, decision, audit and change logs into day files"
```

---

### Task 10: Shrink Current focus and empty PLAN.md's converted sections

**Files:**
- Modify: `PLAN.md` (delete the seven converted sections, rewrite Current focus)
- Create: `plan/log/unsorted-current-focus.md`
- Modify: `tools/plan/migrate.py` (add `migrate_current_focus`)
- Modify: `tools/plan/tests/test_migrate.py`

**Interfaces:**
- Consumes: `prose_blocks`.
- Produces: `migrate_current_focus(plan_text: str, out: Path) -> tuple[list[Path], Path]` — returns the day files it could date, and the holding file.

The Current focus stack is 3,712 lines of dated blockquote narrative separated by two `---` rules. A block is datable when its first bolded run contains a `YYYY-MM-DD`. Every other block goes to the holding file **intact and in source order**. The converter never infers a date from position.

- [x] **Step 1: Write the failing test**

```python
FOCUS = """## Current focus

> **PARKED: 2026-08-09 — Track F's code is done.**
>
> Some prose about the park.

---

> **F27 is ✅ as of 2026-08-08.** Both R-6 conjuncts are met.

---

> **A block with no date at all.** It says something, but not when.
"""


class MigrateCurrentFocusTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def test_dated_blocks_go_to_their_day(self):
        from tools.plan.migrate import migrate_current_focus

        days, holding = migrate_current_focus(FOCUS, self.root)
        names = sorted(p.name for p in days)
        self.assertEqual(names, ["2026-08-08.md", "2026-08-09.md"])

    def test_undated_block_goes_to_the_holding_file_intact(self):
        from tools.plan.migrate import migrate_current_focus

        _, holding = migrate_current_focus(FOCUS, self.root)
        text = holding.read_text(encoding="utf-8")
        self.assertIn("A block with no date at all", text)
        self.assertIn("It says something, but not when", text)

    def test_no_block_is_dropped(self):
        from tools.plan.migrate import migrate_current_focus, prose_blocks

        days, holding = migrate_current_focus(FOCUS, self.root)
        after = prose_blocks(holding.read_text(encoding="utf-8"))
        for path in days:
            after += prose_blocks(path.read_text(encoding="utf-8"))
        self.assertEqual(prose_blocks(FOCUS) - after, type(after)())
```

- [x] **Step 2: Run to verify it fails**

```bash
python3 -m unittest discover -s tools/plan/tests -t . -v 2>&1 | tail -10
```

- [x] **Step 3: Implement `migrate_current_focus`** per the rule above, appending to an existing day file rather than overwriting one Task 9 wrote.

- [x] **Step 4: Run to verify it passes, then run it for real**

```bash
python3 -m unittest discover -s tools/plan/tests -t . -v 2>&1 | tail -5
python3 tools/plan/migrate.py current-focus --plan PLAN.md --out .
wc -c plan/log/unsorted-current-focus.md
```

Expected: `losslessness proof: OK`. Report the holding file's size — it is the honest measure of what could not be dated.

- [x] **Step 5: Rewrite PLAN.md**

Delete `## Milestones`, `## Spec questions`, `## Verification log`, `## Decision log`, `## Audit log`, `## Unplanned changes` and `## Session log`. Replace the Current focus body with the current park block only. Add an index:

The index is **generated**, by a `render_index()` added to `render.py` alongside the other four. Add it to the `outputs` dict keyed on `PLAN.md`, writing between two sentinel comments so the hand-written focus above it survives regeneration. It emits one row per kind, with the index file and the directory each as a Markdown link:

| What | Index file | Directory |
|---|---|---|
| Milestones | `plan/MILESTONES.md` | `plan/milestones/` |
| Spec questions | `plan/QUESTIONS.md` | `plan/questions/` |
| Verification records | `plan/VERIFICATIONS.md` | `plan/verifications/` |
| Decisions | `plan/DECISIONS.md` | `plan/decisions/` |
| Session log | none | `plan/log/` |
| Audits | none | `plan/audits/` |
| Unplanned changes | none | `plan/changes/` |

Build each link with the bracket and parenthesis in separate string literals, exactly as `render_milestones` does, and for the same reason.

- [x] **Step 6: Prove PLAN.md is small and the whole tree still parses**

```bash
wc -c PLAN.md
python3 tools/ci/check-plan-tables.py
python3 tools/ci/check-doc-links.py | tail -1
python3 tools/plan/render.py --check && echo clean
for g in stop-plan-guard guard-readme guard-plan-tables guard-track-goal; do
  bash .claude/hooks/$g.sh <<< '{"stop_hook_active":false}' >/dev/null 2>&1; echo "$g exit=$?"
done
find plan -name '*.md' | xargs wc -c | sort -n | tail -3
```

Expected: `PLAN.md` under 10,000 bytes, every gate green, every guard exit 0, and no file in `plan/` above 1 MB.

- [x] **Step 7: Commit**

```bash
git add PLAN.md plan tools/plan
git commit -m "feat(plan): shrink PLAN.md to its focus and index, and file the focus history by day"
```

---

### Task 11: Update the living documents and run the full gate set

**Files:**
- Modify: `AGENTS.md` (Ground truth, R-3, R-4, the Repository layout table, Quality gates)
- Modify: `CLAUDE.md` (the Hooks section)
- Modify: `README.md` (any pointer to PLAN.md's sections)
- Modify: `.claude/rules/quality-gates.md` (add the renderer)

**Interfaces:**
- Consumes: everything above.
- Produces: nothing importable.

- [x] **Step 1: Update `AGENTS.md`**

- *Ground truth*: `PLAN.md` **and the `plan/` tree** are the single source of implementation status.
- *R-3*: a session records its work in `plan/log/<YYYY>/<MM>/<YYYY-MM-DD>.md`, not in a Session log row.
- *R-4*: unchanged in force. Add that a milestone's prose lives in its own file's body.
- *Repository layout*: add a `plan/` row, and a `tools/plan/` row.
- *Quality gates* · Docs: add `python3 tools/plan/render.py --check`.

- [x] **Step 2: Update `CLAUDE.md`**

Rewrite the `stop-plan-guard.sh` bullet: the guard now watches `PLAN.md` **and** `plan/`, so committing a PLAN edit incrementally no longer re-arms it in the same way. Rewrite the `guard-track-goal.sh` bullet: it counts `status:` frontmatter, and the `> **PARKED:**` escape still lives in `PLAN.md`.

- [x] **Step 3: Update `.claude/rules/quality-gates.md`**

Add a `## Plan index` section: `render.py --check` fails when a committed index differs from a fresh render, and the item files are the only input, so an index can never become a second source of truth.

- [x] **Step 4: Run the complete gate set**

```bash
python3 tools/ci/check-plan-tables.py
python3 tools/ci/check-doc-links.py | tail -1
python3 tools/ci/check-verbatim-copies.py | tail -2
python3 tools/ci/check-spec-question-batches.py
python3 tools/ci/check-unreadable-obligations.py
python3 tools/ci/check-release-blocker-citations.py
python3 tools/ci/check-client-surface-obligations.py
python3 tools/ci/check-integration-abi.py
python3 tools/deploy/check-runbooks.py
python3 tools/deploy/check-signers.py
python3 tools/limit-coverage/check-limit-coverage.py
python3 tools/monitoring/check_alert_coverage.py
python3 tools/plan/render.py --check
for d in tools/ci/tests tools/deploy/tests tools/release/tests tools/phase-gates/tests \
         tools/env/tests tools/monitoring/tests tools/limit-coverage/tests; do
  echo "--- $d"; python3 -m unittest discover -s "$d" 2>&1 | grep -E '^(OK|FAILED|Ran )'
done
python3 -m unittest discover -s tools/plan/tests -t . 2>&1 | grep -E '^(OK|FAILED|Ran )'
```

Expected: every line green. Report any failure verbatim (R-10); do not proceed past one.

- [x] **Step 5: Prove CI parity before pushing**

```bash
python3 tools/ci/check-ci-parity.py
```

This is required here, because this work changes `tools/ci/`. It runs each environment-sensitive gate in a CI-shaped shallow clone and fails on any gate that depends on state only the worktree has.

- [x] **Step 6a: Record the work**

Add an entry to `plan/changes/2026/<MM>/<date>.md` — the new home for unplanned changes — covering the whole split, the S7 defect Task 0 fixed, and the size of `plan/log/unsorted-current-focus.md`.

- [x] **Step 6b: Commit and publish when the user explicitly requests it**

R-9 requires an explicit user request for commit, push and PR actions. The user gave
that instruction on 2026-08-12; commit `dd702c6b` was pushed and draft PR #301 opened.

```bash
git add AGENTS.md CLAUDE.md README.md .claude/rules/quality-gates.md plan PLAN.md
git commit -m "docs(plan): point the living documents at the plan/ tree"
git push -u origin plan/split-tree
gh pr create --draft --title "Split PLAN.md into item files and day files" --body-file docs/superpowers/specs/2026-08-12-plan-split-design.md
```

- [x] **Step 7a: Run the exhaustive gate once**

Per R-12, run the exhaustive gate exactly once for this state rather than after every commit.

```bash
export CARGO_TARGET_DIR=/tmp/$USER-plan-split/wtarget
export LIBCLANG_PATH=/tmp/$USER-plan-split/libclang
export WASM_BUILD_WORKSPACE_HINT=$PWD
mkdir -p "$LIBCLANG_PATH" && ln -sf /usr/lib/x86_64-linux-gnu/libclang-14.so.14.0.0 "$LIBCLANG_PATH/libclang.so"
readlink -f "$LIBCLANG_PATH/libclang.so" && ls -lL "$LIBCLANG_PATH/libclang.so"
tools/ci/rust-workspace-gates.sh
```

No Rust source changes in this plan, so this run is a regression check rather than a gate on new code.

- [ ] **Step 7b: Mark the PR ready after publication and green CI**

This is downstream of Step 6b and likewise remains a publication action rather than
unfinished implementation.

---

## Self-review

**Spec coverage.** Section 3 file layout → Tasks 3, 6, 8, 9, 10. Section 4 frontmatter contract → Task 1, with day files in Task 9. Section 5 renderer → Tasks 4, 6, 8, 9. Section 6 consumer migration → Tasks 2, 5, 7, 8, and the `ci.yml` step in Task 4. Section 6.1's claim was FALSIFIED during Task 5 — see the correction in that task and in the spec. Section 7 losslessness → Task 3 steps 1 and 5, repeated in every later conversion. Section 7.1 the undatable focus blocks → Task 10. Section 8 verification → every task's own steps, plus Task 11 steps 4 and 5. Section 9 non-goals → nothing here summarizes or prunes. Section 10 risks → the `git blame` cost is accepted in the spec and not re-litigated here.

**Additions beyond the spec.** Task 0 exists because reading the row shapes exposed a live defect the spec did not know about. It is separable and ships first.

**Validated against the real corpus, not assumed.** Every parsing rule in this plan was run against `PLAN.md` at `615c9ba8` before the plan was finalized. That run corrected six things a plausible-looking plan had wrong:

1. A second cell splitter was replaced by extracting the repository's existing `split_cells`. The new one demanded a trailing pipe, and row SQ-523 omits one.
2. `raised:` cannot be a bare date. 391 of 583 cells carry a parenthetical after it.
3. `resolved:` must be optional. 10 of 389 resolved rows record no date.
4. The question status vocabulary is ten words, not two. All 28 non-standard rows map to `resolved`, preserving today's gate behavior exactly.
5. `Verification.date` must be optional. 12 of 224 rows carry no date.
6. Three session-log rows carry a date range, so a day file needs a `span:` field.

Each of those would have failed the migration in the field, and items 2 to 6 would have failed it *silently* by defaulting.

**Facts the run confirmed, so the converters can be strict about them:** all 126 milestone rows have exactly 6 cells and sit under a `### Track X — ` heading, with statuses `✅ 101 / ⬜ 10 / 🔨 6`. All 224 verification rows have 5 cells. All 263 decision rows, all 12 audit rows and all 864 session rows have 4. The spec-question section holds 583 five-cell questions and 11 three-cell batches.

**Type consistency.** `split_cells` returns interior cells only, so every consumer indexes the status at `cells[4]`, not `cells[5]` — checked at each of the four use sites. `load_milestones`, `load_questions` and `load_verifications` all return `(items, errors)`. `parse_frontmatter` returns `(values, body)`. `main` in both `render.py` and `migrate.py` returns an `int` exit code and takes `argv: list[str] | None`. Status comparisons are against the enums `done`/`open`, never against a glyph, after Task 5.
