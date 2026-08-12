"""Gates for the unreadable-obligation expiry checker.

The checker exists because `rows.ts` claimed its declarations expire "by the row
closing, not by somebody remembering to delete a comment" and nothing enforced
it: contract v28 resolved SQ-615, SQ-616 and SQ-619 while three `blocking`
entries stayed behind, closing the guardian console, the upgrade crank and the
registry challenge panel for reasons that no longer held.

These tests pin the parser (which must find every entry, including the trailing
disposition) and the one rule (a cited question must be open), plus the
anti-vacuity direction — a resolved citation must be *rejected*, or the check
passes everything.
"""

from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "check-unreadable-obligations.py"
SPEC = importlib.util.spec_from_file_location("check_unreadable_obligations", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
checker = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = checker
SPEC.loader.exec_module(checker)

REPO_ROOT = Path(__file__).resolve().parents[3]


def write_question(
    root: Path,
    identifier: str,
    *,
    status: str,
    spec_ref: str = "02 §7",
    raised: str = "2026-01-01",
    resolved: str | None = None,
    batch: str = "X",
) -> None:
    """Write a minimal `plan/questions/<identifier>.md` frontmatter fixture."""
    directory = root / "plan" / "questions"
    directory.mkdir(parents=True, exist_ok=True)
    lines = [
        "---",
        f"id: {identifier}",
        f"title: {identifier} title",
        f"spec_ref: {spec_ref}",
        f"raised: {raised}",
        f"status: {status}",
    ]
    if resolved:
        lines.append(f"resolved: {resolved}")
    lines += [
        f"batch: {batch if status == 'open' else 'none'}",
        "---",
        "",
        "## Question",
        "",
        f"{identifier} question body.",
        "",
        "## Status",
        "",
        status,
        "",
    ]
    (directory / f"{identifier}.md").write_text("\n".join(lines), encoding="utf-8")


SOURCE = """const UNREADABLE = {
  'P-13': [
    unread(
      'P-13',
      'the bond this report will hold',
      'The bond is value-scaled and 02 freezes no surface publishing it.',
      'SQ-598',
      'blocking',
    ),
  ],
  'O-1': [
    unread(
      'O-1',
      'your account carries no retained ejection',
      'The offence record lives in a pallet-internal store.',
      'SQ-564',
      'stated',
    ),
  ],
};
"""


class TestParser(unittest.TestCase):
    def test_finds_every_declaration_with_its_disposition(self) -> None:
        found = [(sq, disposition) for _, sq, disposition in checker.declarations(SOURCE)]
        self.assertEqual(found, [("SQ-598", "blocking"), ("SQ-564", "stated")])

    def test_reads_frontmatter_status_and_not_a_keyword(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            write_question(root, "SQ-598", status="open")
            write_question(root, "SQ-615", status="resolved", resolved="2026-08-06")
            status, errors = checker.load_question_statuses(root)
            self.assertEqual(errors, [])
            self.assertEqual(status["SQ-598"], "open")
            self.assertEqual(status["SQ-615"], "resolved")


class TestRule(unittest.TestCase):
    def _status(self, root: Path) -> dict[str, str]:
        status, errors = checker.load_question_statuses(root)
        self.assertEqual(errors, [])
        return status

    def test_a_resolved_citation_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            write_question(root, "SQ-564", status="open")
            write_question(root, "SQ-615", status="resolved", resolved="2026-08-06")
            status = self._status(root)
            stale = SOURCE.replace("'SQ-598',", "'SQ-615',")
            offenders = [
                sq for _, sq, _ in checker.declarations(stale) if status.get(sq) != "open"
            ]
            self.assertEqual(offenders, ["SQ-615"], "a resolved citation passed — the check is vacuous")

    def test_an_unknown_citation_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            write_question(root, "SQ-598", status="open")
            status = self._status(root)
            unknown = SOURCE.replace("'SQ-564',", "'SQ-9999',")
            offenders = [
                sq for _, sq, _ in checker.declarations(unknown) if status.get(sq) != "open"
            ]
            self.assertEqual(offenders, ["SQ-9999"])


class TestAntiVacuity(unittest.TestCase):
    def test_an_unparsable_tree_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            # No plan/questions/ directory at all.
            status, errors = checker.load_question_statuses(root)
            self.assertEqual(status, {})
            self.assertTrue(errors, "a missing plan/questions/ tree must report an error, not silence")


class TestRepository(unittest.TestCase):
    def test_the_shipped_table_passes(self) -> None:
        self.assertEqual(checker.main(), 0)

    def test_the_declarations_are_reachable(self) -> None:
        # A parser that stopped matching would report zero and exit 0, which is why
        # the shipped file's count is asserted to be non-zero here rather than in
        # the checker's own success path.
        source = (REPO_ROOT / "app/packages/transaction-builder/src/rows.ts").read_text(encoding="utf-8")
        self.assertGreater(len(checker.declarations(source)), 0)


if __name__ == "__main__":
    unittest.main()
