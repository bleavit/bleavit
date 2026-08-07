from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
GATE = REPO_ROOT / "tools/ci/supply-chain-gates.sh"
WORKSPACES_MANIFEST = REPO_ROOT / "tools/ci/audited-workspaces.toml"


def audited_rows() -> list[dict]:
    checker = REPO_ROOT / "tools/ci/check-audited-workspaces.py"
    spec = importlib.util.spec_from_file_location("check_audited_workspaces", checker)
    module = importlib.util.module_from_spec(spec)
    sys.modules["check_audited_workspaces"] = module
    spec.loader.exec_module(module)
    return module.load_workspaces(WORKSPACES_MANIFEST)


def audited_workspace_names() -> set[str]:
    """The CARGO workspace names only.

    The summary's `workspaces` block reports cargo-audit output, and cargo-audit
    never runs against an npm lockfile. The npm rows are disclosed under
    `npm_lockfiles` instead, and the same completeness rule is asserted there.
    """
    return {row["name"] for row in audited_rows() if row["ecosystem"] == "cargo"}


def audited_npm_lockfiles() -> set[str]:
    return {row["lockfile"] for row in audited_rows() if row["ecosystem"] == "npm"}


# The stub reports a different warning shape per workspace, keyed on the directory
# it was started in. That is the point of the fixture rather than decoration: the
# gate audits each workspace FROM ITS OWN ROOT (15 §4.5 clause 4), so a gate that
# quietly audited one workspace four times would still produce four rows, and only
# distinct per-directory output can tell the two apart.
STUB_AUDITOR = """#!/usr/bin/env python3
import json, os, sys
if '--version' in sys.argv:
    print('cargo-audit 0.22.2')
    raise SystemExit(0)
if '--json' in sys.argv:
    name = os.path.basename(os.getcwd())
    shapes = {
        'keeper': ([], {'unmaintained': [{}]}),
        'app':    ([], {'unmaintained': [{}, {}], 'unsound': [{}]}),
        'fuzz':   ([], {'unmaintained': [{}, {}, {}, {}]}),
    }
    ignore, warnings = shapes.get(name, (['RUSTSEC-2026-0001'], {'unmaintained': [{}, {}], 'unsound': [{}]}))
    print(json.dumps({'settings': {'ignore': ignore}, 'warnings': warnings}))
raise SystemExit(0)
"""

# Reporting one waived finding per ecosystem keeps the gate hermetic: this suite
# covers the summary, and each advisory leg has its own suite in tools/ci/tests/.
#
# The stub answers by ECOSYSTEM, keyed on the lockfile it was handed. That is not
# decoration: the npm checker asserts `package.ecosystem == "npm"` precisely so a
# misrouted lockfile fails loudly, so a stub that answered the same shape for both
# would pass a gate whose routing was wrong.
STUB_SCANNER = """#!/usr/bin/env python3
import json, sys
lockfile = next(a.split('=', 1)[1] for a in sys.argv if a.startswith('--lockfile='))
if lockfile.endswith('pnpm-lock.yaml'):
    package = {'name': 'demo-npm', 'version': '4.5.6', 'ecosystem': 'npm'}
    finding = {'id': 'GHSA-test-npm0', 'aliases': [], 'summary': 'npm fixture'}
else:
    package = {'name': 'demo', 'version': '1.2.3', 'ecosystem': 'crates.io'}
    finding = {'id': 'GHSA-test-0000', 'aliases': [], 'summary': 'fixture'}
print(json.dumps({'results': [{'packages': [{
    'package': package,
    'vulnerabilities': [finding],
}]}]}))
raise SystemExit(1)
"""

# A stub finding plus its matching waiver, rather than the committed file: this
# suite covers the summary, and pointing it at the real waivers would couple it to
# whatever is waived today.
STUB_WAIVERS = """\
[[waiver]]
id = "GHSA-test-0000"
package = "demo"
version = "1.2.3"
reason = "fixture"
blocked_by = "fixture pin"
clears_when = "never"
"""

STUB_NPM_WAIVERS = """\
[[waiver]]
id = "GHSA-test-npm0"
package = "demo-npm"
version = "4.5.6"
reaches_bundle = "no"
reason = "fixture"
blocked_by = "fixture pin"
clears_when = "never"
triaged = "2026-08-07"
"""


class SupplyChainSummaryTests(unittest.TestCase):
    def run_gate(self, root: Path) -> dict:
        auditor = root / "cargo-audit"
        auditor.write_text(STUB_AUDITOR, encoding="utf-8")
        auditor.chmod(0o755)
        scanner = root / "osv-scanner"
        scanner.write_text(STUB_SCANNER, encoding="utf-8")
        scanner.chmod(0o755)
        waivers = root / "ghsa-waivers.toml"
        waivers.write_text(STUB_WAIVERS, encoding="utf-8")
        npm_waivers = root / "npm-advisory-waivers.toml"
        npm_waivers.write_text(STUB_NPM_WAIVERS, encoding="utf-8")
        summary = root / "summary.json"

        environment = dict(os.environ)
        environment["BLEAVIT_AUDITOR"] = str(auditor)
        environment["BLEAVIT_OSV_SCANNER"] = str(scanner)
        environment["BLEAVIT_GHSA_WAIVERS"] = str(waivers)
        environment["BLEAVIT_NPM_WAIVERS"] = str(npm_waivers)
        completed = subprocess.run(
            [str(GATE), "--summary-out", str(summary)],
            cwd=REPO_ROOT,
            env=environment,
            text=True,
            capture_output=True,
            check=False,
            timeout=600,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        return json.loads(summary.read_text(encoding="utf-8"))

    def test_summary_covers_every_audited_workspace(self) -> None:
        """SQ-135's disclosure property, applied to every lockfile the gate audits.

        The gate once audited two of the repository's four cargo lockfiles, so a
        release manifest disclosed accepted risk on half the tree and said
        nothing about the rest. Binding the summary's workspace set to
        tools/ci/audited-workspaces.toml means a workspace can never be audited
        without also being disclosed.
        """
        with tempfile.TemporaryDirectory() as temporary:
            document = self.run_gate(Path(temporary))
        self.assertEqual(document["schema"], "bleavit.supply-chain.v4")
        self.assertEqual(set(document["workspaces"]), audited_workspace_names())
        self.assertIn("app", document["workspaces"])
        self.assertIn("fuzz", document["workspaces"])

    def test_summary_covers_every_audited_npm_lockfile(self) -> None:
        """The same disclosure property, one ecosystem over (SQ-985).

        `app/pnpm-lock.yaml` backs the bundle every user loads and was audited by
        nothing until 2026-08-07. Binding the disclosed set to
        tools/ci/audited-workspaces.toml means an npm lockfile can never be
        scanned without also being named, nor named without being scanned.
        """
        with tempfile.TemporaryDirectory() as temporary:
            document = self.run_gate(Path(temporary))
        self.assertEqual(set(document["npm_lockfiles"]), audited_npm_lockfiles())
        self.assertIn("app/pnpm-lock.yaml", document["npm_lockfiles"])

    def test_summary_discloses_ignores_and_warning_counts(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            document = self.run_gate(Path(temporary))
        self.assertEqual(document["ignored_advisory_ids"], ["RUSTSEC-2026-0001"])
        # SQ-135's disclosure property covers the GHSA-only waivers too:
        # cargo-audit's ignore list alone understates the accepted risk.
        self.assertEqual(
            document["waived_ghsa_only"],
            [{"id": "GHSA-test-0000", "package": "demo", "version": "1.2.3"}],
        )
        # v4: the npm leg's waivers are accepted risk in the dependency graph of
        # the bundle a browser executes (14 §3.6 TH-44), so they are disclosed on
        # the same terms. `reaches_bundle` travels with the entry because a reader
        # of the manifest cannot recover it.
        self.assertEqual(
            document["waived_npm"],
            [
                {
                    "id": "GHSA-test-npm0",
                    "package": "demo-npm",
                    "version": "4.5.6",
                    "reaches_bundle": "no",
                }
            ],
        )
        self.assertEqual(document["workspaces"]["root"]["allowed_warning_count"], 3)
        self.assertEqual(document["workspaces"]["keeper"]["allowed_warning_count"], 1)
        self.assertEqual(document["workspaces"]["app"]["allowed_warning_count"], 3)
        self.assertEqual(document["workspaces"]["fuzz"]["allowed_warning_count"], 4)

    def test_each_workspace_reports_its_own_exception_set(self) -> None:
        """Blast-radius containment, made visible in the artifact (15 §4.5 clause 4).

        Only the root workspace owns a `.cargo/audit.toml`. cargo-audit reads that
        file from its working directory, so a gate that started every run in the
        repository root would report the root's ignore list under all four names.
        The per-workspace lists are what makes that failure observable in the
        release manifest rather than only in a reviewer's memory.
        """
        with tempfile.TemporaryDirectory() as temporary:
            document = self.run_gate(Path(temporary))
        self.assertEqual(
            document["workspaces"]["root"]["ignored_advisory_ids"], ["RUSTSEC-2026-0001"]
        )
        for name in ("keeper", "app", "fuzz"):
            self.assertEqual(document["workspaces"][name]["ignored_advisory_ids"], [])
        # The top-level disclosure is the union, so nothing accepted anywhere can
        # be missing from what a release publishes.
        union = set()
        for row in document["workspaces"].values():
            union.update(row["ignored_advisory_ids"])
        self.assertEqual(sorted(union), document["ignored_advisory_ids"])


if __name__ == "__main__":
    unittest.main()
