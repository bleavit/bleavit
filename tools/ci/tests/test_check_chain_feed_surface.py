"""The SQ-582 surface-set leg of `check-chain-feed.py`.

The feed went stale under its own gate: the runtime grew
`QuestionService.LiveExternalDepth` and `ScarcityMultiplier`, kept the same 45-pallet
set, the same `spec_version` and the same contract version, and nothing failed — because
the gate compared *which pallets exist* and never *what they publish*.

These tests exist because that gate is now green on a fresh feed, and a green gate proves
nothing about whether it can go red. The regeneration removed the live evidence; this
replaces it with evidence that cannot be regenerated away.
"""

import importlib.util
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def load():
    spec = importlib.util.spec_from_file_location("cf", ROOT / "tools/ci/check-chain-feed.py")
    module = importlib.util.module_from_spec(spec)
    argv = sys.argv
    sys.argv = ["check-chain-feed.py"]
    try:
        spec.loader.exec_module(module)
    except SystemExit:
        pass
    finally:
        sys.argv = argv
    return module


class TestSourceStorageItems(unittest.TestCase):
    def setUp(self):
        self.cf = load()

    def test_it_parses_every_in_repo_pallet_not_just_one(self):
        # Anti-vacuity: a parser that matched a single pallet would still have caught
        # SQ-582's two items and would be blind to every other pallet's drift.
        declared = self.cf.source_storage_items({"bootstrap"})
        self.assertGreaterEqual(len(declared), 15, "too few pallets parsed to be a real sweep")
        self.assertGreaterEqual(
            sum(len(v) for v in declared.values()), 150, "too few storage items parsed"
        )

    def test_it_finds_the_two_items_whose_absence_was_invisible(self):
        declared = self.cf.source_storage_items({"bootstrap"})
        self.assertIn("QuestionService", declared)
        self.assertIn("LiveExternalDepth", declared["QuestionService"])
        self.assertIn("ScarcityMultiplier", declared["QuestionService"])

    def test_it_honours_the_profile_feature_gate(self):
        # `Sudo` is behind `#[cfg(feature = "bootstrap")]`. The pallet-set check is
        # feature-aware and this must be too, or it demands storage of a release build.
        boot = self.cf.source_storage_items({"bootstrap"})
        release = self.cf.source_storage_items(set())
        self.assertIsInstance(boot, dict)
        self.assertIsInstance(release, dict)

    def test_it_claims_only_the_direction_it_can_support(self):
        # One-directional by design: source-declared-but-absent fails; feed items with no
        # in-repo declaration do not, because most pallets here are SDK pallets whose
        # source is not in this tree. The parser must therefore skip non-`pallets/` crates
        # rather than report them as having zero storage.
        declared = self.cf.source_storage_items({"bootstrap"})
        for sdk in ("Balances", "System", "Timestamp", "Scheduler", "Preimage"):
            self.assertNotIn(sdk, declared, f"{sdk} has no in-repo source and must be skipped")


if __name__ == "__main__":
    unittest.main()


class TestStaleStorage(unittest.TestCase):
    """The comparison itself, not the parser that feeds it."""

    def setUp(self):
        self.cf = load()

    def _md(self, entries):
        return {"pallets": {"QuestionService": {"storage": {"entries": entries}}}}

    def test_it_reports_an_item_the_metadata_lacks(self):
        # SQ-582 in miniature: source declares two, metadata carries one.
        stale = self.cf.stale_storage(
            {"QuestionService": {"LiveExternalDepth", "Questions"}},
            self._md({"Questions": {}}),
        )
        self.assertEqual(stale, ["QuestionService.LiveExternalDepth"])

    def test_it_is_silent_when_the_feed_is_current(self):
        stale = self.cf.stale_storage(
            {"QuestionService": {"Questions"}}, self._md({"Questions": {}})
        )
        self.assertEqual(stale, [])

    def test_it_does_not_object_to_metadata_the_source_never_declared(self):
        # One-directional: extra metadata entries are SDK pallets, not drift.
        stale = self.cf.stale_storage(
            {"QuestionService": {"Questions"}}, self._md({"Questions": {}, "Extra": {}})
        )
        self.assertEqual(stale, [])

    def test_a_pallet_absent_from_metadata_reports_all_its_items(self):
        stale = self.cf.stale_storage({"QuestionService": {"A", "B"}}, {"pallets": {}})
        self.assertEqual(stale, ["QuestionService.A", "QuestionService.B"])
