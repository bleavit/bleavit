from __future__ import annotations

import shutil
import tempfile
import unittest
from pathlib import Path

import support  # noqa: F401 - inserts tools/monitoring on sys.path.

import attestation_monitor
import chain_alerts_exporter
import check_alert_coverage as checker


ROOT = Path(__file__).resolve().parents[3]
EXPORTED = {
    "chain-exporter": set(chain_alerts_exporter.SERIES),
    "attestation-monitor": set(attestation_monitor.SERIES),
}


def fixture_root(directory: str) -> Path:
    root = Path(directory)
    spec_dir = root / "docs" / "architecture"
    rule_dir = root / "deploy" / "monitoring" / "prometheus" / "rules"
    tool_dir = root / "tools" / "monitoring"
    spec_dir.mkdir(parents=True)
    rule_dir.mkdir(parents=True)
    tool_dir.mkdir(parents=True)
    shutil.copy2(ROOT / "docs" / "architecture" / "12-release-and-operations.md", spec_dir)
    shutil.copy2(
        ROOT / "deploy" / "monitoring" / "prometheus" / "rules" / "bleavit-alerts.yml",
        rule_dir,
    )
    shutil.copy2(ROOT / "tools" / "monitoring" / "series-inventory.toml", tool_dir)
    return root


class CoverageCheckerTests(unittest.TestCase):
    def test_current_tree_is_complete(self) -> None:
        failures, rows, inventory = checker.validate(ROOT)
        self.assertEqual(failures, [])
        self.assertEqual(len(rows), 20)
        self.assertEqual(len(inventory), 32)

    def test_strict_extractor_rejects_table_header_drift(self) -> None:
        document = (ROOT / "docs" / "architecture" / "12-release-and-operations.md").read_text(encoding="utf-8")
        broken = document.replace("| Domain | Key series | Alert (example) | Runbook |", "| Area | Key series | Alert (example) | Runbook |", 1)
        with self.assertRaisesRegex(checker.CoverageError, "header drift"):
            checker.extract_rows(broken)

    def test_broken_runbook_binding_fails(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = fixture_root(directory)
            path = root / "deploy" / "monitoring" / "prometheus" / "rules" / "bleavit-alerts.yml"
            path.write_text(path.read_text(encoding="utf-8").replace("runbook: RB-INTAKE", "runbook: RB-MARKET", 1), encoding="utf-8")
            failures, _, _ = checker.validate(root, exported=EXPORTED)
            self.assertTrue(any("does not match" in failure for failure in failures))

    def test_missing_metric_inventory_fails(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = fixture_root(directory)
            path = root / "deploy" / "monitoring" / "prometheus" / "rules" / "bleavit-alerts.yml"
            path.write_text(path.read_text(encoding="utf-8").replace("bleavit_chain_tick_lag_blocks", "bleavit_unknown_tick_lag", 1), encoding="utf-8")
            failures, _, _ = checker.validate(root, exported=EXPORTED)
            self.assertTrue(any("missing from series-inventory" in failure for failure in failures))

    def test_missing_page_severity_fails(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = fixture_root(directory)
            path = root / "deploy" / "monitoring" / "prometheus" / "rules" / "bleavit-alerts.yml"
            path.write_text(path.read_text(encoding="utf-8").replace("severity: page, runbook: RB-LEDGER", "severity: warning, runbook: RB-LEDGER", 1), encoding="utf-8")
            failures, _, _ = checker.validate(root, exported=EXPORTED)
            self.assertTrue(any("lacks severity: page" in failure for failure in failures))

    def test_declared_exporter_metric_must_exist_in_module_registry(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = fixture_root(directory)
            broken = {key: set(value) for key, value in EXPORTED.items()}
            broken["chain-exporter"].remove("bleavit_chain_tick_lag_blocks")
            failures, _, _ = checker.validate(root, exported=broken)
            self.assertTrue(any("not in the chain-exporter SERIES" in failure for failure in failures))


if __name__ == "__main__":
    unittest.main()
