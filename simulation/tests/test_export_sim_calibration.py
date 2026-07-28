"""Tests for tools/simulation/export-sim-calibration.py (the G0 producer bridge)."""

from __future__ import annotations

import copy
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
EXPORTER = REPO_ROOT / "tools" / "simulation" / "export-sim-calibration.py"

spec = importlib.util.spec_from_file_location("export_sim_calibration", EXPORTER)
module = importlib.util.module_from_spec(spec)
sys.modules["export_sim_calibration"] = module
spec.loader.exec_module(module)

HEAD = "a" * 40


def fake_runner(check_returncode: int = 0, dirty: str = ""):
    def runner(command):
        if command[-1] == "HEAD":
            return subprocess.CompletedProcess(command, 0, stdout=HEAD + "\n", stderr="")
        if "--porcelain" in command:
            return subprocess.CompletedProcess(command, 0, stdout=dirty, stderr="")
        if "--check" in command:
            return subprocess.CompletedProcess(
                command, check_returncode, stdout="check output", stderr=""
            )
        raise AssertionError(f"unexpected command: {command}")

    return runner


def passing_document() -> dict:
    return {
        "proposal_count": 10_000,
        "outcome_digest_root": "ab" * 32,
        "violations": [],
        "metrics": {
            name: {
                "decidable_harm_false_pass_rate": rate,
                # The counts behind each rate now travel with it, so `0/0` and
                # `0/1000` stop rendering identically downstream (MAX-12).
                "decidable_harm": 1_000,
                "decidable_harm_false_pass_count": count,
            }
            for name, rate, count in (
                ("param", "0.004000", 4),
                ("treasury", "0.002500", 2),
                ("code", 0, 0),
                ("meta", "0.000000", 0),
            )
        },
        "published": {
            "designation": "published",
            "eligibility": {
                "all_decidable_harm_false_pass_lt_1pct": True,
                "sub_3p_brackets_clean": True,
                "by_class": {
                    "param": True,
                    "treasury": True,
                    "code": True,
                    "meta": True,
                },
            },
            "candidates": {
                "sec.flow_cap": "29",
                "sec.prize.param": 50_000,
                "sec.prize.code": 300_000,
                "sec.prize.meta": 600_000,
            },
            "tested_floor_inputs": {
                "dec.delta": {
                    "param": "0.015",
                    "treasury": "0.025",
                    "code": "0.040",
                    "meta": "0.060",
                },
                "pol.b_baseline": 25_000,
            },
        },
    }


class BuildEvidenceTests(unittest.TestCase):
    def test_passing_artifact_maps_classes_and_numbers(self):
        evidence = module.build_evidence(passing_document(), HEAD)
        self.assertEqual(evidence["schema"], "bleavit.sim-calibration.v1")
        self.assertEqual(evidence["git_commit"], HEAD)
        self.assertEqual(evidence["synthetic_proposals"], 10_000)
        rates = evidence["false_pass_rate"]
        self.assertEqual(set(rates), {"param", "trs", "code", "meta"})
        self.assertEqual(rates["trs"], 0.0025)
        self.assertEqual(rates["code"], 0.0)
        calibration = evidence["calibration"]
        self.assertEqual(calibration["dec.delta.trs"], 0.025)
        self.assertEqual(calibration["sec.flow_cap"], 29)
        self.assertEqual(calibration["pol.b_baseline"], 25_000)
        self.assertIsInstance(calibration["sec.flow_cap"], int)
        self.assertTrue(evidence["attack_cost_validation"]["validated"])
        self.assertTrue(evidence["attack_cost_validation"]["method"].strip())

    def test_values_block_preferred_over_candidates(self):
        document = passing_document()
        document["published"]["values"] = dict(
            document["published"]["candidates"], **{"sec.flow_cap": 31}
        )
        evidence = module.build_evidence(document, HEAD)
        self.assertEqual(evidence["calibration"]["sec.flow_cap"], 31)

    def test_refuses_candidates_only_designation(self):
        document = passing_document()
        document["published"]["designation"] = "candidates-only"
        with self.assertRaisesRegex(module.ExportError, "designation"):
            module.build_evidence(document, HEAD)

    def test_refuses_recorded_violations(self):
        document = passing_document()
        document["violations"] = [{"kind": "economic"}]
        with self.assertRaisesRegex(module.ExportError, "violation"):
            module.build_evidence(document, HEAD)

    def test_refuses_rate_at_or_above_one_percent(self):
        document = passing_document()
        document["metrics"]["treasury"]["decidable_harm_false_pass_rate"] = "0.010000"
        with self.assertRaisesRegex(module.ExportError, "strictly <"):
            module.build_evidence(document, HEAD)

    def test_refuses_failed_eligibility_flag(self):
        document = passing_document()
        document["published"]["eligibility"]["sub_3p_brackets_clean"] = False
        with self.assertRaisesRegex(module.ExportError, "sub_3p"):
            module.build_evidence(document, HEAD)

    def test_refuses_short_proposal_count(self):
        document = passing_document()
        document["proposal_count"] = 9_999
        with self.assertRaisesRegex(module.ExportError, ">= 10000"):
            module.build_evidence(document, HEAD)

    def test_refuses_missing_published_key(self):
        document = passing_document()
        del document["published"]["candidates"]["sec.flow_cap"]
        with self.assertRaisesRegex(module.ExportError, "sec.flow_cap"):
            module.build_evidence(document, HEAD)


class MainFlowTests(unittest.TestCase):
    def run_main(self, document: dict, runner, extra: list[str] | None = None) -> tuple[int, Path]:
        tmp = Path(tempfile.mkdtemp())
        artifact = tmp / "artifact.json"
        artifact.write_text(json.dumps(document), encoding="utf-8")
        out = tmp / "evidence.json"
        argv = ["--artifact", str(artifact), "--out", str(out)] + (extra or [])
        return module.main(argv, runner=runner), out

    def test_refuses_red_check(self):
        code, out = self.run_main(passing_document(), fake_runner(check_returncode=1))
        self.assertEqual(code, 1)
        self.assertFalse(out.exists())

    def test_refuses_dirty_tree(self):
        code, out = self.run_main(
            passing_document(),
            fake_runner(dirty=" M simulation/src/x.py\n"),
            extra=["--skip-check"],
        )
        self.assertEqual(code, 1)
        self.assertFalse(out.exists())

    def test_green_path_writes_consumer_valid_evidence(self):
        code, out = self.run_main(
            passing_document(), fake_runner(), extra=["--skip-check"]
        )
        self.assertEqual(code, 0)
        evidence = json.loads(out.read_text(encoding="utf-8"))
        self.assertEqual(evidence["schema"], "bleavit.sim-calibration.v1")
        self.assertEqual(evidence["git_commit"], HEAD)
        for value in evidence["false_pass_rate"].values():
            self.assertIsInstance(value, (int, float))
            self.assertNotIsInstance(value, bool)
            self.assertLess(value, 0.01)

    def test_current_committed_artifact_is_refused(self):
        """The real S4 artifact (candidates-only, violations recorded) must not export."""
        artifact = REPO_ROOT / "simulation" / "results" / "phase0-calibration.json"
        document = json.loads(artifact.read_text(encoding="utf-8"))
        if document.get("published", {}).get("designation") == "published":
            self.skipTest("artifact has been re-calibrated to a publishable state")
        with self.assertRaises(module.ExportError):
            module.build_evidence(copy.deepcopy(document), HEAD)


if __name__ == "__main__":
    unittest.main()


class Max12EvidenceDenominatorTests(unittest.TestCase):
    """A class that measured nothing must not export a perfect score."""

    def test_zero_denominator_refuses_export(self) -> None:
        document = passing_document()
        document["metrics"]["param"]["decidable_harm"] = 0
        document["metrics"]["param"]["decidable_harm_false_pass_count"] = 0
        with self.assertRaisesRegex(module.ExportError, "measured no decidable-harm"):
            module.false_pass_counts(document)

    def test_counts_are_exported_per_class(self) -> None:
        counts = module.false_pass_counts(passing_document())
        self.assertEqual(set(counts), {"param", "trs", "code", "meta"})
        self.assertEqual(counts["param"]["decidable_harm"], 1_000)
        self.assertEqual(counts["param"]["decidable_harm_false_pass_count"], 4)

    def test_numerator_above_denominator_refuses_export(self) -> None:
        document = passing_document()
        document["metrics"]["code"]["decidable_harm_false_pass_count"] = 1_001
        with self.assertRaisesRegex(module.ExportError, "exceeds denominator"):
            module.false_pass_counts(document)
