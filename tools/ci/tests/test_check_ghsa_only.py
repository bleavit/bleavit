"""Negative gates for the GHSA-only supply-chain leg (15 §4.5).

The leg exists because cargo-audit is structurally blind to advisories RustSec
does not carry. These tests pin the three behaviors that make it worth having:
it fires on a GHSA-only advisory, it stays quiet about everything RustSec
already covers (so it never duplicates .cargo/audit.toml or inherits its
informational warnings), and a waiver cannot outlive its advisory.
"""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "check-ghsa-only.py"
SPEC = importlib.util.spec_from_file_location("check_ghsa_only", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
checker = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = checker
SPEC.loader.exec_module(checker)

REPO_ROOT = Path(__file__).resolve().parents[3]
WAIVERS = REPO_ROOT / "tools/ci/ghsa-waivers.toml"

YAMUX = {
    "id": "GHSA-vxx9-2994-q338",
    "aliases": ["CVE-2026-32314"],
    "summary": "Yamux vulnerable to remote Panic via malformed Data frame",
}
# The shape RustSec-carried advisories take in OSV: the GHSA record cross-links
# the RUSTSEC id, which is what makes it cargo-audit's responsibility, not ours.
WASMTIME_GHSA = {
    "id": "GHSA-jhxm-h53p-jm7w",
    "aliases": ["CVE-2026-34971", "RUSTSEC-2026-0096"],
    "summary": "sandbox escape",
}
WASMTIME_RUSTSEC = {
    "id": "RUSTSEC-2026-0096",
    "aliases": ["CVE-2026-34971", "GHSA-jhxm-h53p-jm7w"],
    "summary": "sandbox escape",
}
LRU_INFORMATIONAL = {
    "id": "RUSTSEC-2026-0002",
    "aliases": ["GHSA-rhfx-m35p-ff5j"],
    "summary": "IterMut violates Stacked Borrows",
}


def report(*packages: tuple[str, str, list[dict]]) -> dict:
    return {
        "results": [
            {
                "packages": [
                    {"package": {"name": name, "version": version}, "vulnerabilities": vulns}
                    for name, version, vulns in packages
                ]
            }
        ]
    }


def fake_scanner(directory: Path, document: dict) -> Path:
    """A stub standing in for the pinned osv-scanner, emitting `document`."""
    path = directory / "osv-scanner"
    path.write_text(
        textwrap.dedent(
            f"""\
            #!/usr/bin/env python3
            import json
            print(json.dumps({document!r}))
            raise SystemExit(1)  # osv-scanner exits non-zero when it finds anything
            """
        ),
        encoding="utf-8",
    )
    path.chmod(0o755)
    return path


def run(document: dict, waivers: Path) -> subprocess.CompletedProcess:
    with tempfile.TemporaryDirectory() as tmp:
        directory = Path(tmp)
        scanner = fake_scanner(directory, document)
        lockfile = directory / "Cargo.lock"
        lockfile.write_text("", encoding="utf-8")
        return subprocess.run(
            [
                sys.executable,
                str(SCRIPT),
                "--scanner",
                str(scanner),
                "--waivers",
                str(waivers),
                "--lockfile",
                str(lockfile),
            ],
            text=True,
            capture_output=True,
            check=False,
        )


def waiver_file(directory: Path, body: str) -> Path:
    path = directory / "waivers.toml"
    path.write_text(textwrap.dedent(body), encoding="utf-8")
    return path


MINIMAL_WAIVER = """\
    [[waiver]]
    id = "GHSA-vxx9-2994-q338"
    aliases = ["CVE-2026-32314"]
    package = "yamux"
    version = "0.12.1"
    reason = "linked but never instantiated"
    blocked_by = "libp2p-yamux 0.46.0"
    clears_when = "upstream drops yamux 0.12"
"""


class RustSecCoverageTests(unittest.TestCase):
    def test_rustsec_id_is_cargo_audits_responsibility(self) -> None:
        self.assertTrue(checker.rustsec_covered(WASMTIME_RUSTSEC))

    def test_ghsa_aliasing_a_rustsec_id_is_covered(self) -> None:
        self.assertTrue(checker.rustsec_covered(WASMTIME_GHSA))

    def test_ghsa_with_no_rustsec_alias_is_the_blind_spot(self) -> None:
        self.assertFalse(checker.rustsec_covered(YAMUX))


class GateTests(unittest.TestCase):
    def test_unwaived_ghsa_only_advisory_fails(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            waivers = waiver_file(Path(tmp), "")
            completed = run(report(("yamux", "0.12.1", [YAMUX])), waivers)
        self.assertEqual(completed.returncode, 1, completed.stdout)
        self.assertIn("GHSA-vxx9-2994-q338", completed.stderr)

    def test_waived_ghsa_only_advisory_passes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            waivers = waiver_file(Path(tmp), MINIMAL_WAIVER)
            completed = run(report(("yamux", "0.12.1", [YAMUX])), waivers)
        self.assertEqual(completed.returncode, 0, completed.stderr)

    def test_rustsec_carried_findings_are_left_to_cargo_audit(self) -> None:
        """No waiver needed for wasmtime/lru: audit.toml and its informational
        classification own them. This is what keeps the two lists from
        duplicating — and keeps the keeper workspace waiver-free."""
        with tempfile.TemporaryDirectory() as tmp:
            waivers = waiver_file(Path(tmp), "")
            completed = run(
                report(
                    ("wasmtime", "35.0.0", [WASMTIME_GHSA, WASMTIME_RUSTSEC]),
                    ("lru", "0.12.5", [LRU_INFORMATIONAL]),
                ),
                waivers,
            )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertIn("GHSA-only findings (invisible to cargo-audit): 0", completed.stdout)

    def test_waiver_cannot_outlive_its_advisory(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            waivers = waiver_file(Path(tmp), MINIMAL_WAIVER)
            completed = run(report(("yamux", "0.13.10", [])), waivers)
        self.assertEqual(completed.returncode, 1, completed.stdout)
        self.assertIn("match no current finding", completed.stderr)

    def test_waiver_missing_a_required_field_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            waivers = waiver_file(
                Path(tmp),
                """\
                [[waiver]]
                id = "GHSA-vxx9-2994-q338"
                package = "yamux"
                version = "0.12.1"
                """,
            )
            completed = run(report(("yamux", "0.12.1", [YAMUX])), waivers)
        self.assertEqual(completed.returncode, 1, completed.stdout)
        self.assertIn("missing", completed.stderr)


class CommittedWaiverTests(unittest.TestCase):
    def test_committed_waivers_parse_and_carry_their_justification(self) -> None:
        waivers = checker.load_waivers(WAIVERS)
        self.assertIn("GHSA-vxx9-2994-q338", waivers)
        for identifier, waiver in waivers.items():
            self.assertTrue(waiver["blocked_by"].strip(), identifier)
            self.assertTrue(waiver["clears_when"].strip(), identifier)


class CompatParserTests(unittest.TestCase):
    """The 3.10 fallback must agree with tomllib on the committed file."""

    def test_compat_parser_matches_the_committed_waivers(self) -> None:
        rows = checker.parse_waivers_toml_compat(WAIVERS.read_text(encoding="utf-8"))
        self.assertEqual([row["id"] for row in rows], ["GHSA-vxx9-2994-q338"])
        self.assertEqual(rows[0]["aliases"], ["CVE-2026-32314"])
        self.assertEqual(rows[0]["package"], "yamux")

    @unittest.skipIf(checker.tomllib is None, "tomllib requires Python 3.11+")
    def test_compat_parser_agrees_with_tomllib(self) -> None:
        with WAIVERS.open("rb") as handle:
            expected = checker.tomllib.load(handle)["waiver"]
        actual = checker.parse_waivers_toml_compat(WAIVERS.read_text(encoding="utf-8"))
        self.assertEqual(actual, expected)


if __name__ == "__main__":
    unittest.main()
