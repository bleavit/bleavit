"""Mutation tests for the F15 ops-handbook gate.

Every binding this checker declares is bidirectional, and the two directions are
different failures. A test that only proved the checker passes on the committed
files would prove nothing about either: the interesting question is whether each
direction *fires*, so each case below breaks exactly one thing and asserts the
message that must appear.
"""

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "check-ops-handbook.py"
REPO = Path(__file__).resolve().parents[3]
MODULE_SPEC = importlib.util.spec_from_file_location("check_ops_handbook", SCRIPT)
if MODULE_SPEC is None or MODULE_SPEC.loader is None:
    raise RuntimeError("ops-handbook checker module must be importable")
checker = importlib.util.module_from_spec(MODULE_SPEC)
sys.modules[MODULE_SPEC.name] = checker
MODULE_SPEC.loader.exec_module(checker)


DOC = """# Synthetic operations document

## 6. Operational layer

### 6.1 Owned-and-funded ops table (normative)

| Service | Commitment (MUST) | Owner role | Funding line ([08](ref.md)) |
|---|---|---|---|
| **WSS bootnodes** | Run them | Bootnode program coordinator | `ops.bootnodes` |
| **Served-state window** | Retain state | Infrastructure coordinator | `ops.rpc_archive` |
| **Monitoring & alerting** | Run the stack | Monitoring coordinator | `ops.monitoring` |
| **Release operations** | Ship releases | Release operations lead | `ops.arweave` |

### 6.2 Bootnode program

Synthetic bootnode program.

### 6.3 Monitoring and alerting

| Domain | Key series | Alert (example) | Runbook |
|---|---|---|---|
| Markets | market_series | book loss | RB-MON |
| Collateralization | drift | any drift | RB-MON (page immediately) |

New rows owned by this document:

| Domain | Key series | Alert | Runbook |
|---|---|---|---|
| Bootnodes | dial | < 8 dialable | RB-BOOT |
| Served-state window | retention | window < 30 d | RB-BOOT |
| Release integrity | compare | any mismatch | RB-REL (page immediately) |

### 6.4 Incident response

Carried forward: **Hostile release** — repoint to the last good TXID.
**Wrong-chain-spec** (release gate) — publish a patch release.

### 6.5 Phase-gate wiring

Synthetic phase gates.
"""

HANDBOOK = """# Synthetic ops handbook

## Role assignments

| Service | Owner role | Funding line | Holder |
|---|---|---|---|
| WSS bootnodes | Bootnode program coordinator | ops.bootnodes | VACANT |
| Served-state window | Infrastructure coordinator | ops.rpc_archive | VACANT |
| Monitoring & alerting | Monitoring coordinator | ops.monitoring | VACANT |
| Release operations | Release operations lead | ops.arweave | VACANT |

## Monitoring and alerting (12 §6.3)

| First responder | Alert domains (12 §6.3) |
|---|---|
| Bootnode program coordinator | Bootnodes, Served-state window |
| Monitoring coordinator | Collateralization, Markets |
| Release operations lead | Release integrity |

| Alert domain | First responder | Escalation partner (12 §6.1 row owner) |
|---|---|---|
| Served-state window | Bootnode program coordinator | Infrastructure coordinator |

## Incident response (12 §6.4)

| Incident class (12 §6.4) | Accountable role | Standing response |
|---|---|---|
| Hostile release | Release operations lead | RB-REL § Hostile release |
| Wrong-chain-spec | Release operations lead | RB-REL § Wrong-chain-spec |

## Current state

Nothing is seated.
"""


def facts(owner, escalation="Page nobody.", sections=("Escalation",)):
    return checker.RunbookFacts(
        owner_role=owner, escalation=escalation, sections=frozenset(sections)
    )


def runbooks(overrides=None):
    base = {
        "RB-BOOT": facts(
            "Bootnode program coordinator",
            escalation="Page the Infrastructure coordinator for served state.",
        ),
        "RB-MON": facts("Monitoring coordinator"),
        "RB-REL": facts(
            "Release operations lead",
            sections=("Escalation", "Hostile release", "Wrong-chain-spec"),
        ),
    }
    base.update(overrides or {})
    return base


def run(doc=DOC, handbook=HANDBOOK, books=None, strict=False):
    return checker.check(doc, handbook, runbooks() if books is None else books, strict)


class FixtureTest(unittest.TestCase):
    def test_synthetic_fixture_passes(self):
        self.assertEqual(run(), [])


class ServiceBindingTest(unittest.TestCase):
    """12 §6.1 — the binding F15 shipped with, which had no committed test."""

    def test_dropped_service_is_a_commitment_nobody_owns(self):
        handbook = HANDBOOK.replace(
            "| Monitoring & alerting | Monitoring coordinator | ops.monitoring | VACANT |\n",
            "",
        )
        failures = run(handbook=handbook)
        self.assertTrue(
            any("A dropped row is a commitment nobody owns." in f for f in failures),
            failures,
        )

    def test_invented_service_is_a_commitment_nobody_made(self):
        handbook = HANDBOOK.replace(
            "| Release operations | Release operations lead | ops.arweave | VACANT |",
            "| Release operations | Release operations lead | ops.arweave | VACANT |\n"
            "| Imaginary service | Monitoring coordinator | ops.monitoring | VACANT |",
        )
        failures = run(handbook=handbook)
        self.assertTrue(
            any("An invented row is a commitment nobody made." in f for f in failures),
            failures,
        )

    def test_wrong_owner_role_fires(self):
        handbook = HANDBOOK.replace(
            "| WSS bootnodes | Bootnode program coordinator |",
            "| WSS bootnodes | Monitoring coordinator |",
        )
        failures = run(handbook=handbook)
        self.assertTrue(
            any("12 §6.1 owns it to 'Bootnode program coordinator'" in f for f in failures),
            failures,
        )

    def test_wrong_funding_line_fires(self):
        handbook = HANDBOOK.replace("ops.bootnodes | VACANT", "ops.monitoring | VACANT")
        failures = run(handbook=handbook)
        self.assertTrue(
            any("12 §6.1 funds it from 'ops.bootnodes'" in f for f in failures), failures
        )

    def test_blank_holder_is_refused(self):
        handbook = HANDBOOK.replace(
            "| WSS bootnodes | Bootnode program coordinator | ops.bootnodes | VACANT |",
            "| WSS bootnodes | Bootnode program coordinator | ops.bootnodes |  |",
        )
        with self.assertRaises(SystemExit) as caught:
            run(handbook=handbook)
        self.assertIn("A vacancy is declared as VACANT", str(caught.exception))

    def test_strict_refuses_a_declared_vacancy(self):
        failures = run(strict=True)
        self.assertTrue(
            any("4 service(s) have no accountable person" in f for f in failures), failures
        )

    def test_missing_service_table_stops_the_gate(self):
        doc = DOC.replace("### 6.1 Owned-and-funded ops table (normative)", "### 6.1 Gone")
        with self.assertRaises(SystemExit) as caught:
            run(doc=doc)
        self.assertIn("has nothing to read", str(caught.exception))

    def test_service_table_without_rows_stops_the_gate(self):
        doc = DOC
        for row in (
            "| **WSS bootnodes** | Run them | Bootnode program coordinator | `ops.bootnodes` |\n",
            "| **Served-state window** | Retain state | Infrastructure coordinator | `ops.rpc_archive` |\n",
            "| **Monitoring & alerting** | Run the stack | Monitoring coordinator | `ops.monitoring` |\n",
            "| **Release operations** | Ship releases | Release operations lead | `ops.arweave` |\n",
        ):
            doc = doc.replace(row, "")
        with self.assertRaises(SystemExit) as caught:
            run(doc=doc)
        self.assertIn("comparing against nothing", str(caught.exception))


class RosterBindingTest(unittest.TestCase):
    """12 §6.3 — every alert domain has a first responder, and only real ones do."""

    def test_dropped_domain_leaves_an_alert_nobody_answers_for(self):
        handbook = HANDBOOK.replace(
            "| Monitoring coordinator | Collateralization, Markets |",
            "| Monitoring coordinator | Markets |",
        )
        failures = run(handbook=handbook)
        self.assertTrue(
            any(
                "12 §6.3 alerts on 'Collateralization' and the handbook rosters no first "
                "responder" in f
                for f in failures
            ),
            failures,
        )

    def test_invented_domain_is_a_commitment_nobody_made(self):
        handbook = HANDBOOK.replace(
            "| Monitoring coordinator | Collateralization, Markets |",
            "| Monitoring coordinator | Collateralization, Markets, Sunspots |",
        )
        failures = run(handbook=handbook)
        self.assertTrue(
            any("An invented domain is a commitment nobody made." in f for f in failures),
            failures,
        )

    def test_wrong_first_responder_fires(self):
        handbook = HANDBOOK.replace(
            "| Monitoring coordinator | Collateralization, Markets |",
            "| Release operations lead | Collateralization, Markets |",
        )
        failures = run(handbook=handbook)
        self.assertTrue(
            any("the handbook rosters 'Release operations lead'" in f for f in failures),
            failures,
        )

    def test_a_domain_cannot_have_two_first_responders(self):
        handbook = HANDBOOK.replace(
            "| Release operations lead | Release integrity |",
            "| Release operations lead | Release integrity, Markets |",
        )
        failures = run(handbook=handbook)
        self.assertTrue(
            any("one domain has one first responder" in f for f in failures), failures
        )

    def test_a_role_cannot_be_listed_twice(self):
        handbook = HANDBOOK.replace(
            "| Release operations lead | Release integrity |",
            "| Release operations lead | Release integrity |\n"
            "| Release operations lead | Markets |",
        )
        failures = run(handbook=handbook)
        self.assertTrue(
            any("one role holds one list of domains" in f for f in failures), failures
        )

    def test_unreadable_runbook_cannot_supply_an_owner(self):
        books = runbooks()
        del books["RB-MON"]
        failures = run(books=books)
        self.assertTrue(
            any(
                "no readable runbook of that id declares an owner role" in f
                for f in failures
            ),
            failures,
        )

    def test_runbook_owner_must_be_a_role_doc_12_names(self):
        failures = run(books=runbooks({"RB-MON": facts("Ghost coordinator")}))
        self.assertTrue(
            any("which 12 §6.1 does not name as an owner role" in f for f in failures),
            failures,
        )

    def test_both_alert_tables_must_parse(self):
        doc = DOC.replace(
            "| Domain | Key series | Alert | Runbook |\n|---|---|---|---|\n", ""
        )
        with self.assertRaises(SystemExit) as caught:
            run(doc=doc)
        self.assertIn("expected 2", str(caught.exception))

    def test_missing_alert_section_stops_the_gate(self):
        doc = DOC.replace("### 6.3 Monitoring and alerting", "### 6.3 Gone")
        with self.assertRaises(SystemExit) as caught:
            run(doc=doc)
        self.assertIn("has nothing to read", str(caught.exception))

    def test_unparsable_alert_row_stops_the_gate(self):
        doc = DOC.replace("| Markets | market_series | book loss | RB-MON |", "| Markets |")
        with self.assertRaises(SystemExit) as caught:
            run(doc=doc)
        self.assertIn("unparsable 12 §6.3 alert row", str(caught.exception))

    def test_a_domain_split_across_runbooks_has_no_single_responder(self):
        doc = DOC.replace(
            "| Release integrity | compare | any mismatch | RB-REL (page immediately) |",
            "| Release integrity | compare | any mismatch | RB-REL (page immediately) |\n"
            "| Markets | other | other trigger | RB-BOOT |",
        )
        with self.assertRaises(SystemExit) as caught:
            run(doc=doc)
        self.assertIn("no single first responder", str(caught.exception))

    def test_missing_roster_table_stops_the_gate(self):
        handbook = HANDBOOK.replace("| First responder | Alert domains (12 §6.3) |", "")
        with self.assertRaises(SystemExit) as caught:
            run(handbook=handbook)
        self.assertIn("expected exactly 1", str(caught.exception))

    def test_missing_monitoring_section_stops_the_gate(self):
        handbook = HANDBOOK.replace("## Monitoring and alerting (12 §6.3)", "## Gone")
        with self.assertRaises(SystemExit) as caught:
            run(handbook=handbook)
        self.assertIn("no published first responder", str(caught.exception))


class EscalationBindingTest(unittest.TestCase):
    """12 §6.3's cross-row rule: name the other §6.1 row's owner."""

    def test_undeclared_required_pair_fires(self):
        handbook = HANDBOOK.replace(
            "| Served-state window | Bootnode program coordinator | Infrastructure coordinator |",
            "| Bootnodes | Bootnode program coordinator | Infrastructure coordinator |",
        )
        failures = run(handbook=handbook)
        self.assertTrue(
            any(
                "12 §6.3 requires the other row's owner to be named." in f for f in failures
            ),
            failures,
        )

    def test_wrong_partner_fires(self):
        handbook = HANDBOOK.replace(
            "| Served-state window | Bootnode program coordinator | Infrastructure coordinator |",
            "| Served-state window | Bootnode program coordinator | Monitoring coordinator |",
        )
        failures = run(handbook=handbook)
        self.assertTrue(
            any(
                "the handbook escalates to 'Monitoring coordinator'" in f for f in failures
            ),
            failures,
        )

    def test_partner_must_be_a_role_doc_12_names(self):
        handbook = HANDBOOK.replace(
            "| Served-state window | Bootnode program coordinator | Infrastructure coordinator |",
            "| Served-state window | Bootnode program coordinator | Night porter |",
        )
        failures = run(handbook=handbook)
        self.assertTrue(
            any("is not a role 12 §6.1 names as an owner" in f for f in failures), failures
        )

    def test_partner_equal_to_responder_escalates_to_nobody(self):
        handbook = HANDBOOK.replace(
            "| Served-state window | Bootnode program coordinator | Infrastructure coordinator |",
            "| Served-state window | Bootnode program coordinator | Bootnode program coordinator |",
        )
        failures = run(handbook=handbook)
        self.assertTrue(
            any("escalates to nobody" in f for f in failures), failures
        )

    def test_runbook_must_name_the_partner_in_its_escalation(self):
        books = runbooks(
            {
                "RB-BOOT": facts(
                    "Bootnode program coordinator",
                    escalation="Page the bootnode coordinator.",
                )
            }
        )
        failures = run(books=books)
        self.assertTrue(
            any(
                "its Escalation section does not name 'Infrastructure coordinator'" in f
                for f in failures
            ),
            failures,
        )

    def test_pair_for_an_unknown_domain_fires(self):
        handbook = HANDBOOK.replace(
            "| Served-state window | Bootnode program coordinator | Infrastructure coordinator |",
            "| Served-state window | Bootnode program coordinator | Infrastructure coordinator |\n"
            "| Sunspots | Monitoring coordinator | Infrastructure coordinator |",
        )
        failures = run(handbook=handbook)
        self.assertTrue(
            any(
                "declares an escalation partner for 'Sunspots', which 12 §6.3 does not "
                "alert on" in f
                for f in failures
            ),
            failures,
        )

    def test_pair_responder_must_match_the_roster(self):
        handbook = HANDBOOK.replace(
            "| Served-state window | Bootnode program coordinator | Infrastructure coordinator |",
            "| Served-state window | Monitoring coordinator | Infrastructure coordinator |",
        )
        failures = run(handbook=handbook)
        self.assertTrue(
            any("the roster derives 'Bootnode program coordinator'" in f for f in failures),
            failures,
        )


class IncidentBindingTest(unittest.TestCase):
    """12 §6.4 — every incident class has an owner and a written response."""

    def test_dropped_class_has_nobody_to_route_it_to(self):
        handbook = HANDBOOK.replace(
            "| Wrong-chain-spec | Release operations lead | RB-REL § Wrong-chain-spec |\n", ""
        )
        failures = run(handbook=handbook)
        self.assertTrue(
            any(
                "12 §6.4 names the incident class 'Wrong-chain-spec'" in f for f in failures
            ),
            failures,
        )

    def test_invented_class_is_a_commitment_nobody_made(self):
        handbook = HANDBOOK.replace(
            "| Wrong-chain-spec | Release operations lead | RB-REL § Wrong-chain-spec |",
            "| Wrong-chain-spec | Release operations lead | RB-REL § Wrong-chain-spec |\n"
            "| Meteor strike | Release operations lead | RB-REL § Hostile release |",
        )
        failures = run(handbook=handbook)
        self.assertTrue(
            any("An invented class is a commitment nobody made." in f for f in failures),
            failures,
        )

    def test_response_must_name_a_readable_runbook(self):
        handbook = HANDBOOK.replace("RB-REL § Hostile release", "RB-GHOST § Hostile release")
        failures = run(handbook=handbook)
        self.assertTrue(
            any("is not a runbook this gate can read" in f for f in failures), failures
        )

    def test_response_must_name_a_section_that_exists(self):
        handbook = HANDBOOK.replace("RB-REL § Hostile release", "RB-REL § Hostile takeover")
        failures = run(handbook=handbook)
        self.assertTrue(
            any("has no section 'Hostile takeover'" in f for f in failures), failures
        )

    def test_accountable_role_must_be_the_runbooks_owner(self):
        handbook = HANDBOOK.replace(
            "| Hostile release | Release operations lead |",
            "| Hostile release | Monitoring coordinator |",
        )
        failures = run(handbook=handbook)
        self.assertTrue(
            any("RB-REL answers to 'Release operations lead'" in f for f in failures),
            failures,
        )

    def test_accountable_role_must_be_a_role_doc_12_names(self):
        handbook = HANDBOOK.replace(
            "| Hostile release | Release operations lead |", "| Hostile release | Night porter |"
        )
        failures = run(handbook=handbook)
        self.assertTrue(
            any("is not a role 12 §6.1 names as an owner" in f for f in failures), failures
        )

    def test_malformed_response_cell_fires(self):
        handbook = HANDBOOK.replace("RB-REL § Hostile release", "ask the release lead")
        failures = run(handbook=handbook)
        self.assertTrue(
            any("does not name a runbook section as" in f for f in failures), failures
        )

    def test_missing_incident_section_in_the_doc_stops_the_gate(self):
        doc = DOC.replace("### 6.4 Incident response", "### 6.4 Gone")
        with self.assertRaises(SystemExit) as caught:
            run(doc=doc)
        self.assertIn("has nothing to read", str(caught.exception))

    def test_incident_section_without_classes_stops_the_gate(self):
        doc = DOC.replace("**Hostile release**", "Hostile release").replace(
            "**Wrong-chain-spec**", "Wrong-chain-spec"
        )
        with self.assertRaises(SystemExit) as caught:
            run(doc=doc)
        self.assertIn("comparing against nothing", str(caught.exception))

    def test_missing_incident_table_stops_the_gate(self):
        handbook = HANDBOOK.replace("## Incident response (12 §6.4)", "## Gone")
        with self.assertRaises(SystemExit) as caught:
            run(handbook=handbook)
        self.assertIn("no accountable role", str(caught.exception))


class RunbookLoadingTest(unittest.TestCase):
    def test_missing_directory_is_reported_rather_than_skipped(self):
        with tempfile.TemporaryDirectory() as directory:
            books, problems = checker.load_runbooks(Path(directory) / "absent")
        self.assertEqual(books, {})
        self.assertTrue(any("does not exist" in problem for problem in problems), problems)

    def test_runbook_without_frontmatter_is_reported(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            (path / "RB-GOOD.md").write_text(
                "---\nid: RB-GOOD\nowner_role: Monitoring coordinator\n---\n\n"
                "## Escalation\n\nPage somebody.\n",
                encoding="utf-8",
            )
            (path / "RB-BAD.md").write_text("no frontmatter here\n", encoding="utf-8")
            books, problems = checker.load_runbooks(path)
        self.assertEqual(set(books), {"RB-GOOD"})
        self.assertEqual(books["RB-GOOD"].owner_role, "Monitoring coordinator")
        self.assertIn("Escalation", books["RB-GOOD"].sections)
        self.assertTrue(any("RB-BAD.md" in problem for problem in problems), problems)


class RepositoryTest(unittest.TestCase):
    def test_committed_files_agree(self):
        books, problems = checker.load_runbooks(REPO / "deploy" / "runbooks")
        self.assertEqual(problems, [])
        failures = checker.check(
            (REPO / "docs/architecture/12-release-and-operations.md").read_text(
                encoding="utf-8"
            ),
            (REPO / "deploy/ops-handbook/README.md").read_text(encoding="utf-8"),
            books,
            strict=False,
        )
        self.assertEqual(failures, [])

    def test_strict_still_reports_the_vacancies(self):
        books, _problems = checker.load_runbooks(REPO / "deploy" / "runbooks")
        failures = checker.check(
            (REPO / "docs/architecture/12-release-and-operations.md").read_text(
                encoding="utf-8"
            ),
            (REPO / "deploy/ops-handbook/README.md").read_text(encoding="utf-8"),
            books,
            strict=True,
        )
        self.assertEqual(len(failures), 1)
        self.assertIn("have no accountable person", failures[0])


if __name__ == "__main__":
    unittest.main()
