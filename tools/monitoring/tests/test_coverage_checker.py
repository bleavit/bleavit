from __future__ import annotations

import shutil
import tempfile
import unittest
from pathlib import Path

import support  # noqa: F401 - inserts tools/monitoring on sys.path.

import attestation_monitor
import chain_alerts_exporter
import check_alert_coverage as checker
import relay_finality_monitor


ROOT = Path(__file__).resolve().parents[3]
EXPORTED = {
    "chain-exporter": set(chain_alerts_exporter.SERIES),
    "attestation-monitor": set(attestation_monitor.SERIES),
    "relay-monitor": set(relay_finality_monitor.SERIES),
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
    shutil.copy2(ROOT / "PLAN.md", root / "PLAN.md")
    return root


def milestone_plan(*, b13: str = "⬜", o3: str = "⬜") -> str:
    return f"""# PLAN fixture

## Milestones

### Owners

| ID | Milestone | Spec | Depends | Status | Notes |
|---|---|---|---|---|---|
| B13 | Runtime telemetry | 12 §6.3 | — | {b13} | |
| O3 | Bootnode probes | 12 §6.2 | — | {o3} | |

## Next section
"""


class CoverageCheckerTests(unittest.TestCase):
    def test_current_tree_is_complete(self) -> None:
        failures, rows, inventory = checker.validate(ROOT)
        self.assertEqual(failures, [])
        self.assertEqual(len(rows), 21)
        self.assertEqual(len(inventory), 35)

    def test_relay_finality_row_is_bound_to_the_relay_monitor(self) -> None:
        _failures, rows, inventory = checker.validate(ROOT, exported=EXPORTED)
        row = next(row for row in rows if row.domain == "Relay finality")
        self.assertEqual(row.runbook, "RB-KEEPER")
        self.assertFalse(row.page_immediately)
        self.assertEqual(
            row.key_series,
            "relay best height, relay finalized height, finality stagnation seconds",
        )
        self.assertEqual(
            row.threshold, "finalized stagnant > 1800 s [VERIFY] while best is ahead"
        )
        relay = {
            name for name, entry in inventory.items() if entry["source"] == "relay-monitor"
        }
        self.assertEqual(relay, set(relay_finality_monitor.RELAY_FAMILIES))
        self.assertTrue(relay <= set(relay_finality_monitor.SERIES))

    def test_relay_monitor_registry_is_checked_like_the_other_exporters(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = fixture_root(directory)
            broken = {key: set(value) for key, value in EXPORTED.items()}
            broken["relay-monitor"].remove("bleavit_relay_finality_stagnation_seconds")
            failures, _, _ = checker.validate(root, exported=broken)
            self.assertTrue(
                any("not in the relay-monitor SERIES" in failure for failure in failures),
                failures,
            )

    def test_relay_row_without_its_rule_fails(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = fixture_root(directory)
            path = root / "deploy" / "monitoring" / "prometheus" / "rules" / "bleavit-alerts.yml"
            document = path.read_text(encoding="utf-8")
            path.write_text(
                document.replace('domain: "Relay finality"', 'domain: "Keepers"', 1),
                encoding="utf-8",
            )
            failures, _, _ = checker.validate(root, exported=EXPORTED)
            self.assertTrue(
                any("'Relay finality' has no alert rule" in failure for failure in failures),
                failures,
            )

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

    def test_pending_seam_owners_are_allowed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = fixture_root(directory)
            (root / "PLAN.md").write_text(milestone_plan(), encoding="utf-8")
            failures, _, _ = checker.validate(root, exported=EXPORTED)
            self.assertEqual(failures, [])

    def test_seam_expires_when_owner_is_complete(self) -> None:
        samples = (("O3", {"o3": "✅"}, "bleavit_bootnode_browser_dial_success"),)
        for owner, statuses, series in samples:
            with self.subTest(owner=owner), tempfile.TemporaryDirectory() as directory:
                root = fixture_root(directory)
                (root / "PLAN.md").write_text(
                    milestone_plan(**statuses), encoding="utf-8"
                )
                failures, _, _ = checker.validate(root, exported=EXPORTED)
                self.assertTrue(
                    any(series in failure and owner in failure for failure in failures),
                    failures,
                )

    def test_missing_seam_owner_row_fails_loudly(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = fixture_root(directory)
            plan = milestone_plan().replace(
                "| O3 | Bootnode probes | 12 §6.2 | — | ⬜ | |\n", ""
            )
            (root / "PLAN.md").write_text(plan, encoding="utf-8")
            failures, _, _ = checker.validate(root, exported=EXPORTED)
            self.assertTrue(
                any(
                    "bleavit_bootnode_browser_dial_success" in failure
                    and "was not found" in failure
                    for failure in failures
                ),
                failures,
            )


if __name__ == "__main__":
    unittest.main()
