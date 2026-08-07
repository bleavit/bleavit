"""`SOURCE_DATE_EPOCH` on the chain side of the same convention — 12 §1.1 (SQ-1009).

`release_common.source_date_epoch` has been the chain pipeline's reader of 12 §1.1's fixed
epoch since B8, and nothing exercised it. It acquired a second implementation when the client
pipeline gained `app/tools/release/source-date-epoch.ts`, and the ruling that added that one
said to be consistent with this one.

Consistency asserted in one language is a claim. `app/fixtures/source-date-epoch-cases.json`
is read **in place** here and by `app/tests/release/source-date-epoch.test.ts`, so a
divergence turns one of the two suites red — the same discipline `tree-digest-cases.json` and
`crates/embedded-tree/fixtures/self-check-cases.json` already use for a comparison that lives
in two languages.

The corpus carries only strings the two must agree on. `int()` additionally accepts digit
underscores and non-ASCII digits, which the TypeScript parser refuses; that divergence is in
the stricter direction and is asserted over there rather than encoded here, since a corpus
carrying it could only be satisfied by loosening the stricter half.
"""

from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[1]
ROOT = TOOLS.parent.parent
CORPUS = ROOT / "app" / "fixtures" / "source-date-epoch-cases.json"


def _load():
    spec = importlib.util.spec_from_file_location(
        "release_common", TOOLS / "release_common.py"
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


release_common = _load()


class _Environment:
    """Set (or clear) `SOURCE_DATE_EPOCH` for one call and put the process back."""

    def __init__(self, value: str | None) -> None:
        self.value = value

    def __enter__(self) -> None:
        self.previous = os.environ.get("SOURCE_DATE_EPOCH")
        if self.value is None:
            os.environ.pop("SOURCE_DATE_EPOCH", None)
        else:
            os.environ["SOURCE_DATE_EPOCH"] = self.value

    def __exit__(self, *_: object) -> None:
        if self.previous is None:
            os.environ.pop("SOURCE_DATE_EPOCH", None)
        else:
            os.environ["SOURCE_DATE_EPOCH"] = self.previous


class SharedCorpus(unittest.TestCase):
    def setUp(self) -> None:
        self.corpus = json.loads(CORPUS.read_text(encoding="utf-8"))

    def test_the_corpus_is_not_empty(self) -> None:
        """A corpus that lost its cases would leave both suites passing over nothing, in two
        languages at once — which is the failure a shared fixture exists to prevent."""
        self.assertGreaterEqual(len(self.corpus["accepted"]), 5)
        self.assertGreaterEqual(len(self.corpus["refused"]), 6)

    def test_every_accepted_case_resolves_to_its_canonical_value(self) -> None:
        for case in self.corpus["accepted"]:
            with self.subTest(case["raw"]), _Environment(case["raw"]):
                self.assertEqual(
                    str(release_common.source_date_epoch(ROOT)),
                    case["canonical"],
                    f"{case['raw']!r}: {case['why']}",
                )

    def test_every_refused_case_is_refused(self) -> None:
        for case in self.corpus["refused"]:
            with self.subTest(case["raw"]), _Environment(case["raw"]):
                with self.assertRaises(ValueError, msg=f"{case['raw']!r}: {case['why']}"):
                    release_common.source_date_epoch(ROOT)


class Derivation(unittest.TestCase):
    def test_with_nothing_injected_the_epoch_is_the_source_commit_time(self) -> None:
        """Derived, never chosen (R-2). `release.json` publishes the source commit, so a
        third-party rebuilder recomputes this from the document rather than being told it."""
        head = subprocess.run(
            ["git", "show", "-s", "--format=%ct", "HEAD"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
        with _Environment(None):
            self.assertEqual(release_common.source_date_epoch(ROOT), int(head))

    def test_an_injected_value_wins_over_the_commit(self) -> None:
        """The clause that keeps a build from a source tarball working: an operator who
        states the value is not overruled by whatever history happens to be present."""
        with _Environment("1700000000"):
            self.assertEqual(release_common.source_date_epoch(ROOT), 1700000000)

    def test_the_negative_refusal_is_its_own_sentence(self) -> None:
        """An operator who typed a minus sign needs to be told about the minus sign, not
        that some string was unparseable."""
        with _Environment("-1"):
            with self.assertRaisesRegex(ValueError, "non-negative"):
                release_common.source_date_epoch(ROOT)
        with _Environment("12.0"):
            with self.assertRaisesRegex(ValueError, "integer"):
                release_common.source_date_epoch(ROOT)


class NoHistory(unittest.TestCase):
    def test_a_tree_with_no_git_history_falls_back_to_zero(self) -> None:
        """Recorded because it is a real difference between the two implementations.

        This side defaults to `0` when git cannot answer; the client side refuses and names
        `SOURCE_DATE_EPOCH` as the fix. Both are deterministic and neither can manufacture a
        false agreement — a `0` on one runner and a commit time on the other is exactly what
        `tools/ci/check-release-reproducibility.py`'s recipe refusal fails on. Asserted so
        the difference is a decision on the record rather than something a reader discovers.
        """
        with tempfile.TemporaryDirectory() as directory, _Environment(None):
            self.assertEqual(release_common.source_date_epoch(Path(directory)), 0)


if __name__ == "__main__":
    unittest.main()
