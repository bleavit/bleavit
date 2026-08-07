"""Gates for the release-blocker citation checker.

The checker exists because a readiness blocker outlived the question it named:
the Asset Hub descriptor blocker read "blocked on SQ-587" for three days after
SQ-587 was ruled and after F4 had landed every artifact the set needs. Neither
half could see it — the pipeline cannot know a question closed, and PLAN.md
cannot know who cites it.

These tests pin the scanner (it must find a citation wherever it sits, comment
or emitted string, since the stale one sat in both), the status reading, and the
two rejections. The anti-vacuity direction is the point: a resolved citation and
an unknown one must both be *rejected*, or the gate passes everything.
"""

from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "check-release-blocker-citations.py"
SPEC = importlib.util.spec_from_file_location("check_release_blocker_citations", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
checker = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = checker
SPEC.loader.exec_module(checker)

REPO_ROOT = Path(__file__).resolve().parents[3]

PLAN = """## Spec questions

| ID | Question | Spec ref | Raised | Status |
|---|---|---|---|---|
| SQ-720 | First | 10 §9.4 | 2026-01-01 | open — X (release format + consumers) |
| SQ-587 | Second | 02 §7.7 | 2026-01-01 | resolved 2026-08-04 — the rollout phases it |
| SQ-999 | Third | 12 §1.1 | 2026-01-01 | open — this row is not resolved yet |
"""

# The two shapes the stale citation actually had: a doc comment, and a string
# built by multi-line concatenation. A scanner that reads only one of them would
# have missed half of the defect it was written for.
SOURCE_TS = """/**
 * A doc comment mentioning SQ-720 as the reason this field is null.
 */
function readThing(): string[] {
  return [
    'the thing is unpinned, while 10 §9.4 budgets it ' +
      '(SQ-999)',
  ];
}
"""


class TestScanner(unittest.TestCase):
    def _scan(self, **files: str) -> list[tuple[str, int, str]]:
        with tempfile.TemporaryDirectory(dir=REPO_ROOT) as raw:
            directory = Path(raw)
            for name, text in files.items():
                (directory / name).write_text(text, encoding="utf-8")
            return [
                (Path(path).name, lineno, sq)
                for path, lineno, sq in checker.citations(directory)
            ]

    def test_finds_a_citation_in_a_comment_and_in_a_concatenated_string(self) -> None:
        found = self._scan(**{"build.ts": SOURCE_TS})
        self.assertEqual(found, [("build.ts", 2, "SQ-720"), ("build.ts", 7, "SQ-999")])

    def test_scans_the_declared_source_files_and_not_the_rest(self) -> None:
        found = self._scan(
            **{
                "build.ts": "// SQ-720\n",
                "sources.json": '{"note": "SQ-999"}\n',
                "README.md": "# SQ-587 is history and belongs here\n",
            }
        )
        self.assertEqual(
            sorted(sq for _, _, sq in found),
            ["SQ-720", "SQ-999"],
            "the scanner must read the pipeline's own sources, and only those",
        )


class TestStatus(unittest.TestCase):
    def test_reads_the_status_cell_and_not_a_keyword(self) -> None:
        # "this row is not resolved yet" contains the word "resolved"; what
        # decides is the cell's leading word, as the sibling checkers read it.
        status = checker.question_status(PLAN)
        self.assertEqual(status["SQ-720"], "open")
        self.assertEqual(status["SQ-999"], "open")
        self.assertEqual(status["SQ-587"], "resolved")


class TestRule(unittest.TestCase):
    def test_a_resolved_citation_is_rejected(self) -> None:
        status = checker.question_status(PLAN)
        stale = SOURCE_TS.replace("SQ-720", "SQ-587")
        offenders = [
            match.group(0)
            for match in checker.CITATION_RE.finditer(stale)
            if status.get(match.group(0)) != "open"
        ]
        self.assertEqual(offenders, ["SQ-587"], "a resolved citation passed — the check is vacuous")

    def test_an_unknown_citation_is_rejected(self) -> None:
        status = checker.question_status(PLAN)
        offenders = [
            match.group(0)
            for match in checker.CITATION_RE.finditer("// SQ-4242 does not exist")
            if status.get(match.group(0)) != "open"
        ]
        self.assertEqual(offenders, ["SQ-4242"])

    def test_an_unparsable_plan_fails_closed(self) -> None:
        self.assertEqual(checker.question_status("no table here at all"), {})


class TestRepository(unittest.TestCase):
    def test_the_shipped_pipeline_passes(self) -> None:
        self.assertEqual(checker.main(), 0)

    def test_the_pipeline_still_cites_at_least_one_question(self) -> None:
        # A scanner that stopped matching reports zero and exits 0. While any
        # readiness blocker names a question, that count must be non-zero — and
        # when the last one closes this assertion is what says so out loud
        # rather than the gate quietly becoming decorative.
        self.assertGreater(len(checker.citations(checker.RELEASE_DIR)), 0)


if __name__ == "__main__":
    unittest.main()
