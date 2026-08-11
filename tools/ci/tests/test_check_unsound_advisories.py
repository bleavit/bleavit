"""Negative gates for the unsound supply-chain leg (15 §4.5; R-7).

`cargo-audit` fails on a RustSec *vulnerability* and merely prints an
*informational* one. The GitHub Advisory Database does not draw that line: it
grades RUSTSEC-2024-0429 (`glib` 0.18.5, unsound `VariantStrIter`) as a medium
vulnerability, and Dependabot reported it against `app/Cargo.lock` while every
gate in this repository was green. Leg 2 allowed it; leg 3 skipped it by
contract. Neither was misconfigured — between them was a class nothing failed on.

These tests pin the behaviors that make the leg worth having: it fires on an
untriaged `unsound` finding, it leaves `unmaintained` alone (the line is
deliberate, not an oversight), a waiver cannot outlive its advisory, a waiver
cannot cross workspaces, undefined behavior a shipped artifact reaches cannot be
waived at all, and a `constrained` argument cannot be made without citing where.
"""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "check-unsound-advisories.py"
SPEC = importlib.util.spec_from_file_location("check_unsound_advisories", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
checker = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = checker
SPEC.loader.exec_module(checker)

REPO_ROOT = Path(__file__).resolve().parents[3]
WAIVERS = REPO_ROOT / "tools/ci/unsound-waivers.toml"

GLIB = {
    "kind": "unsound",
    "advisory": {
        "id": "RUSTSEC-2024-0429",
        "title": "Unsoundness in `Iterator` and `DoubleEndedIterator` impls",
    },
    "package": {"name": "glib", "version": "0.18.5"},
    "versions": {"patched": [">=0.20.0"]},
}
UNMAINTAINED = {
    "kind": "unmaintained",
    "advisory": {"id": "RUSTSEC-2024-0415", "title": "gtk is unmaintained"},
    "package": {"name": "gtk", "version": "0.18.2"},
    "versions": {"patched": []},
}

WAIVED_GLIB = """\
[[waiver]]
id = "RUSTSEC-2024-0429"
package = "glib"
version = "0.18.5"
workspace = "app"
exposure = "unreachable"
reason = "fixture"
blocked_by = "fixture pin"
clears_when = "never"
triaged = "2026-08-11"
"""


def report(*rows: dict) -> dict:
    warnings: dict[str, list[dict]] = {}
    for row in rows:
        warnings.setdefault(row["kind"], []).append(row)
    return {"settings": {"ignore": []}, "warnings": warnings}


def run(reports: dict[str, dict], waivers: str) -> subprocess.CompletedProcess:
    with tempfile.TemporaryDirectory() as tmp:
        directory = Path(tmp)
        waiver_file = directory / "unsound-waivers.toml"
        waiver_file.write_text(waivers, encoding="utf-8")
        arguments = ["--waivers", str(waiver_file)]
        for workspace, document in reports.items():
            path = directory / f"{workspace}.json"
            path.write_text(json.dumps(document), encoding="utf-8")
            arguments += ["--report", f"{workspace}={path}"]
        return subprocess.run(
            [sys.executable, str(SCRIPT), *arguments],
            text=True,
            capture_output=True,
            check=False,
        )


class UnsoundAdvisoryGateTests(unittest.TestCase):
    def test_untriaged_unsound_advisory_fails(self) -> None:
        """The defect this leg exists for: RUSTSEC-2024-0429 with no triage."""
        completed = run({"app": report(GLIB)}, "")
        self.assertEqual(completed.returncode, 1, completed.stdout)
        self.assertIn("RUSTSEC-2024-0429", completed.stderr)
        self.assertIn("UNWAIVED", completed.stdout)

    def test_triaged_unsound_advisory_passes(self) -> None:
        completed = run({"app": report(GLIB)}, WAIVED_GLIB)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertIn("exposure: unreachable", completed.stdout)

    def test_unmaintained_is_not_gated(self) -> None:
        """The line is deliberate and this test is what keeps it deliberate.

        `unmaintained` names no defect and no mechanism, GHSA raises no advisory
        for it, and this repository carries about thirty. Gating them would fill
        the waiver file with entries nobody can act on and would push a reviewer
        to skim the one entry that matters. If that judgement ever changes it
        changes in `GATED_WARNING_KINDS`, and this test fails first.
        """
        completed = run({"app": report(UNMAINTAINED)}, "")
        self.assertEqual(completed.returncode, 0, completed.stderr)

    def test_stale_waiver_fails(self) -> None:
        """An exemption can never outlive the advisory that justified it (SQ-155).

        This leg also closes the obvious way around the file: adding the id to a
        workspace's `.cargo/audit.toml` `ignore` list drops the warning from the
        report, which is exactly the empty-report case below.
        """
        completed = run({"app": report(UNMAINTAINED)}, WAIVED_GLIB)
        self.assertEqual(completed.returncode, 1, completed.stdout)
        self.assertIn("match no current finding", completed.stderr)

    def test_waiver_does_not_cross_workspaces(self) -> None:
        """15 §4.5 clause 4, applied to the triage rather than to the audit.

        "Unreachable" is a claim about one dependency graph. `event-listener`
        stood in both the root workspace and `keeper/` when this leg was written,
        and a key without the workspace would have let one argument excuse a
        graph nobody looked at.
        """
        completed = run({"root": report(GLIB)}, WAIVED_GLIB)
        self.assertEqual(completed.returncode, 1, completed.stdout)
        # Both classes report: the app waiver is now stale AND root is unwaived.
        self.assertIn("UNWAIVED", completed.stdout)
        self.assertIn("match no current finding", completed.stderr)

    def test_triggerable_exposure_is_refused(self) -> None:
        """R-7: undefined behavior a shipped artifact reaches is not waivable.

        Refused at load time rather than at match time, so the file cannot even
        hold such an entry.
        """
        completed = run(
            {"app": report(GLIB)}, WAIVED_GLIB.replace("unreachable", "triggerable")
        )
        self.assertEqual(completed.returncode, 1, completed.stdout)
        self.assertIn("not waivable", completed.stderr)

    def test_constrained_exposure_requires_call_sites(self) -> None:
        """The middle state concedes the affected code runs, so it must cite it.

        `memmap2` is why the field has three states: its affected function IS
        called by parity-db, and a yes/no field would have forced either a false
        "no" or an unwaivable gate. The concession is only reviewable if the
        entry names the call site a reader must re-check when the pin moves.
        """
        completed = run(
            {"app": report(GLIB)}, WAIVED_GLIB.replace("unreachable", "constrained")
        )
        self.assertEqual(completed.returncode, 1, completed.stdout)
        self.assertIn("names no call_sites", completed.stderr)

    def test_unknown_exposure_is_refused(self) -> None:
        completed = run({"app": report(GLIB)}, WAIVED_GLIB.replace("unreachable", "fine"))
        self.assertEqual(completed.returncode, 1, completed.stdout)
        self.assertIn("must be one of", completed.stderr)

    def test_report_without_warnings_object_fails_closed(self) -> None:
        """A report this checker cannot read is not a clean report.

        Without this the leg would print `0 findings` and pass for any input
        shape it did not recognise, which is the failure mode every gate in this
        directory is written against.
        """
        completed = run({"app": {"settings": {"ignore": []}}}, "")
        self.assertEqual(completed.returncode, 1, completed.stdout)
        self.assertIn("no `warnings` object", completed.stderr)

    def test_missing_required_field_is_refused(self) -> None:
        completed = run(
            {"app": report(GLIB)}, WAIVED_GLIB.replace('blocked_by = "fixture pin"\n', "")
        )
        self.assertEqual(completed.returncode, 1, completed.stdout)
        self.assertIn("blocked_by", completed.stderr)


class CommittedWaiverFileTests(unittest.TestCase):
    def test_committed_waivers_load(self) -> None:
        waivers = checker.load_waivers(WAIVERS)
        self.assertTrue(waivers, "the committed waiver file has no entries")
        for key, row in waivers.items():
            self.assertIn(row["exposure"], ("unreachable", "constrained"), key)
            self.assertTrue(row["reason"].strip(), key)
            self.assertTrue(row["blocked_by"].strip(), key)
            self.assertTrue(row["clears_when"].strip(), key)

    @unittest.skipIf(checker.tomllib is None, "tomllib needs Python 3.11+")
    def test_both_parsers_agree_on_the_committed_file(self) -> None:
        """tomllib runs in CI, the compat parser backs the local gate on 3.10.

        A security gate whose waiver file means two different things depending on
        the Python version is the worst way for it to be wrong, so the two are
        compared rather than trusted. The sibling checkers carry the same hazard
        and the same comment; this is the assertion.

        Skipped where tomllib is absent, which is exactly where the compat parser
        is the only parser — `test_committed_waivers_load` covers it there.
        """
        compat = checker.parse_waivers_toml_compat(WAIVERS.read_text(encoding="utf-8"))
        with WAIVERS.open("rb") as handle:
            native = checker.tomllib.load(handle).get("waiver", [])
        self.assertEqual(compat, native)


if __name__ == "__main__":
    unittest.main()
