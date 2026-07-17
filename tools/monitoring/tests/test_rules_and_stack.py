from __future__ import annotations

import unittest
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[3]
RULES = ROOT / "deploy" / "monitoring" / "prometheus" / "rules" / "bleavit-alerts.yml"


class RuleAndStackTests(unittest.TestCase):
    def test_exactly_twenty_structured_alert_rules(self) -> None:
        document = yaml.safe_load(RULES.read_text(encoding="utf-8"))
        rules = [rule for group in document["groups"] for rule in group["rules"]]
        self.assertEqual(len(rules), 20)
        self.assertEqual(len({rule["alert"] for rule in rules}), 20)
        self.assertEqual(len({rule["labels"]["domain"] for rule in rules}), 20)
        for rule in rules:
            self.assertIn("expr", rule)
            self.assertRegex(rule["labels"]["runbook"], r"^RB-[A-Z]+$")
            self.assertIn("key_series", rule["annotations"])
            self.assertIn("threshold", rule["annotations"])

    def test_only_spec_page_rows_are_immediate_pages(self) -> None:
        document = yaml.safe_load(RULES.read_text(encoding="utf-8"))
        page_domains = {
            rule["labels"]["domain"]
            for group in document["groups"]
            for rule in group["rules"]
            if rule["labels"]["severity"] == "page"
        }
        self.assertEqual(page_domains, {"Collateralization", "Release integrity"})

    def test_keeper_and_parameter_thresholds_are_explicit(self) -> None:
        text = RULES.read_text(encoding="utf-8")
        self.assertIn("bleavit_chain_tick_lag_blocks > 600", text)
        self.assertIn("bleavit_market_mid_window_coverage_percent < 96", text)
        self.assertIn("bleavit_chain_descriptor_lead_time_blocks", text)
        self.assertIn("bleavit_chain_keeper_budget_utilization_ratio > 0.8", text)

    def test_prometheus_scrapes_all_o5_jobs_and_keeps_o3_commented(self) -> None:
        path = ROOT / "deploy" / "monitoring" / "prometheus" / "prometheus.yml"
        text = path.read_text(encoding="utf-8")
        document = yaml.safe_load(text)
        jobs = {job["job_name"]: job for job in document["scrape_configs"]}
        self.assertEqual(
            set(jobs),
            {
                "bleavit-collators",
                "bleavit-keeper",
                "bleavit-chain-alerts",
                "bleavit-attestation-monitor",
            },
        )
        self.assertIn("keeper-1.example.invalid:9616", str(jobs["bleavit-keeper"]))
        self.assertIn("# - job_name: bleavit-browser-dial-probes", text)
        self.assertIn("operator-supplied placeholder", text)

    def test_alertmanager_routes_page_and_release_channels(self) -> None:
        path = ROOT / "deploy" / "monitoring" / "alertmanager" / "alertmanager.yml"
        text = path.read_text(encoding="utf-8")
        document = yaml.safe_load(text)
        routes = document["route"]["routes"]
        receivers = {receiver["name"] for receiver in document["receivers"]}
        self.assertEqual(
            receivers,
            {"ops-channel", "paging", "status-page", "community-channel"},
        )
        self.assertTrue(any(route["receiver"] == "paging" and route.get("continue") for route in routes))
        self.assertTrue(any(route["receiver"] == "status-page" and route.get("continue") for route in routes))
        self.assertTrue(any(route["receiver"] == "community-channel" for route in routes))
        self.assertIn("example.invalid", text)


if __name__ == "__main__":
    unittest.main()
