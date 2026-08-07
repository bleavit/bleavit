"""Negative gates for the npm supply-chain leg (14 §3.6 TH-44; SQ-985).

TH-44 names "`npm audit`/OSV CI" among its mitigations and nothing implemented
it, so `app/pnpm-lock.yaml` — the lockfile behind the bundle a browser executes —
was outside every supply-chain gate this repository runs.

These tests pin the four behaviors that make the leg worth having: it fires on an
unwaived advisory, it skips NOTHING (the contract difference from
`check-ghsa-only.py`, and the one a copy of that checker would have got wrong), a
waiver cannot outlive its advisory, and a package that reaches the bundle cannot
be waived at all.
"""

from __future__ import annotations

import importlib.util
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "check-npm-advisories.py"
SPEC = importlib.util.spec_from_file_location("check_npm_advisories", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
checker = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = checker
SPEC.loader.exec_module(checker)

REPO_ROOT = Path(__file__).resolve().parents[3]
WAIVERS = REPO_ROOT / "tools/ci/npm-advisory-waivers.toml"

OTEL = {
    "id": "GHSA-8988-4f7v-96qf",
    "aliases": ["CVE-2026-54285"],
    "summary": "OpenTelemetry Core: Unbounded memory allocation in W3C Baggage propagation",
}
# An npm advisory that happens to carry a RUSTSEC-shaped alias. `check-ghsa-only.py`
# would SKIP this and hand it to a cargo-audit run that never scans an npm
# lockfile. Nothing may skip it here.
ALIASED = {
    "id": "GHSA-fake-alias-0001",
    "aliases": ["CVE-2026-00001", "RUSTSEC-2026-0001"],
    "summary": "a record that cross-links a RustSec id",
}


def report(*packages: tuple[str, str, list[dict]], ecosystem: str = "npm") -> dict:
    return {
        "results": [
            {
                "packages": [
                    {
                        "package": {"name": name, "version": version, "ecosystem": ecosystem},
                        "vulnerabilities": vulns,
                    }
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
            # 1 = scanned, findings present; 0 = scanned, none. Both mean the scan
            # ran, which is what the checker requires.
            raise SystemExit(1)
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
        lockfile = directory / "pnpm-lock.yaml"
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


def waiver_body(
    identifier: str = "GHSA-8988-4f7v-96qf",
    package: str = "@opentelemetry/core",
    version: str = "1.30.1",
    reaches_bundle: str = "no",
) -> str:
    return f"""\
    [[waiver]]
    id = "{identifier}"
    package = "{package}"
    version = "{version}"
    reaches_bundle = "{reaches_bundle}"
    reason = "fixture"
    blocked_by = "fixture pin"
    clears_when = "fixture condition"
    triaged = "2026-08-07"
    """


class VerdictTests(unittest.TestCase):
    def test_unwaived_advisory_fails(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            waivers = waiver_file(Path(tmp), waiver_body(identifier="GHSA-other-0000"))
            document = report(("@opentelemetry/core", "1.30.1", [OTEL]))
            # The stale leg fires too; the unwaived one is what this asserts.
            completed = run(document, waivers)
        self.assertEqual(completed.returncode, 1)
        self.assertIn("UNWAIVED", completed.stdout)
        self.assertIn("npm advisories with no waiver", completed.stderr)
        self.assertIn("@opentelemetry/core", completed.stderr)

    def test_waived_advisory_passes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            waivers = waiver_file(Path(tmp), waiver_body())
            completed = run(report(("@opentelemetry/core", "1.30.1", [OTEL])), waivers)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertIn("every npm advisory is triaged", completed.stdout)
        self.assertIn("reaches_bundle: no", completed.stdout)

    def test_nothing_is_skipped_for_a_rustsec_alias(self) -> None:
        """The contract difference from `check-ghsa-only.py`, and the reason this
        checker exists rather than one more `--lockfile` on that one.

        That checker skips any finding cross-linking a RUSTSEC id, because
        cargo-audit gates those. cargo-audit never scans an npm lockfile, so the
        same rule here would drop a real finding on the floor with nothing behind
        it. A checker built by copying that one would pass this input; this one
        must not.
        """
        with tempfile.TemporaryDirectory() as tmp:
            waivers = waiver_file(Path(tmp), waiver_body())
            document = report(
                ("@opentelemetry/core", "1.30.1", [OTEL]),
                ("some-package", "2.0.0", [ALIASED]),
            )
            completed = run(document, waivers)
        self.assertEqual(completed.returncode, 1)
        self.assertIn("GHSA-fake-alias-0001", completed.stderr)
        self.assertIn("npm advisories in 1 lockfile(s): 2", completed.stdout)

    def test_a_stale_waiver_fails(self) -> None:
        """An exemption cannot outlive the advisory that justified it (SQ-155)."""
        with tempfile.TemporaryDirectory() as tmp:
            waivers = waiver_file(Path(tmp), waiver_body())
            completed = run(report(("@opentelemetry/core", "2.10.0", [])), waivers)
        self.assertEqual(completed.returncode, 1)
        self.assertIn("match no current finding", completed.stderr)
        self.assertIn("GHSA-8988-4f7v-96qf", completed.stderr)

    def test_a_version_bump_makes_the_waiver_stale(self) -> None:
        """The version is part of the key, so old reasoning cannot cover a new
        resolution silently. The whole triage of the committed waiver is about
        1.30.1's import path — 2.x is a different package graph."""
        with tempfile.TemporaryDirectory() as tmp:
            waivers = waiver_file(Path(tmp), waiver_body())
            completed = run(report(("@opentelemetry/core", "1.31.0", [OTEL])), waivers)
        self.assertEqual(completed.returncode, 1)
        self.assertIn("UNWAIVED", completed.stdout)
        self.assertIn("match no current finding", completed.stderr)

    def test_a_clean_lockfile_with_no_waivers_passes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            waivers = waiver_file(Path(tmp), "# nothing waived\n")
            completed = run(report(("left-pad", "1.0.0", [])), waivers)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertIn("npm advisories in 1 lockfile(s): 0", completed.stdout)


class BundleReachabilityTests(unittest.TestCase):
    def test_a_bundle_reaching_waiver_is_refused(self) -> None:
        """TH-44's impact is "hostile code in the bundle", so that case is not
        waivable at all. Refusing at load means the file cannot even hold one."""
        with tempfile.TemporaryDirectory() as tmp:
            waivers = waiver_file(Path(tmp), waiver_body(reaches_bundle="yes"))
            with self.assertRaises(SystemExit) as caught:
                checker.load_waivers(waivers)
        self.assertIn("cannot be", str(caught.exception))
        self.assertIn("Patch the dependency", str(caught.exception))

    def test_a_bundle_reaching_waiver_fails_the_gate_end_to_end(self) -> None:
        """Not only the loader: the gate must go red, since a reviewer reads the
        exit status and not the loader's call graph."""
        with tempfile.TemporaryDirectory() as tmp:
            waivers = waiver_file(Path(tmp), waiver_body(reaches_bundle="yes"))
            completed = run(report(("@opentelemetry/core", "1.30.1", [OTEL])), waivers)
        self.assertNotEqual(completed.returncode, 0)
        self.assertIn("reaches_bundle", completed.stderr)

    def test_an_unknown_reachability_value_is_refused(self) -> None:
        """"unknown" is not an answer. A waiver whose containment is untriaged is
        the state SQ-985 found and is exactly what must not be admitted."""
        for value in ("unknown", "maybe", "", "NO"):
            with self.subTest(value=value):
                with tempfile.TemporaryDirectory() as tmp:
                    waivers = waiver_file(Path(tmp), waiver_body(reaches_bundle=value))
                    with self.assertRaises(SystemExit) as caught:
                        checker.load_waivers(waivers)
                self.assertIn("reaches_bundle", str(caught.exception))

    def test_every_committed_waiver_declares_containment(self) -> None:
        waivers = checker.load_waivers(WAIVERS)
        self.assertTrue(waivers, "the committed waiver file declares nothing")
        for key, row in waivers.items():
            self.assertEqual(row["reaches_bundle"], "no", key)


class WaiverSchemaTests(unittest.TestCase):
    def test_a_missing_required_key_is_refused(self) -> None:
        for key in sorted(checker.REQUIRED_WAIVER_KEYS):
            with self.subTest(key=key):
                body = "\n".join(
                    line
                    for line in textwrap.dedent(waiver_body()).splitlines()
                    if not line.startswith(f"{key} = ")
                )
                with tempfile.TemporaryDirectory() as tmp:
                    waivers = waiver_file(Path(tmp), body + "\n")
                    with self.assertRaises(SystemExit) as caught:
                        checker.load_waivers(waivers)
                self.assertIn(key, str(caught.exception))

    def test_a_duplicate_waiver_is_refused(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            waivers = waiver_file(Path(tmp), waiver_body() + waiver_body())
            with self.assertRaises(SystemExit) as caught:
                checker.load_waivers(waivers)
        self.assertIn("duplicate waiver", str(caught.exception))

    def test_the_committed_waiver_file_loads(self) -> None:
        waivers = checker.load_waivers(WAIVERS)
        self.assertIn(
            ("GHSA-8988-4f7v-96qf", "@opentelemetry/core", "1.30.1"),
            waivers,
        )

    def test_the_compat_parser_agrees_with_tomllib(self) -> None:
        """The local gate runs 3.10 and CI runs 3.12, so the two parsers must
        read the committed file identically. A silent disagreement about a
        security gate's waiver file is the worst kind."""
        if checker.tomllib is None:
            self.skipTest("tomllib requires Python 3.11+")
        with WAIVERS.open("rb") as handle:
            expected = checker.tomllib.load(handle)["waiver"]
        actual = checker.parse_waivers_toml_compat(WAIVERS.read_text(encoding="utf-8"))
        self.assertEqual(actual, expected)

    def test_a_hash_inside_a_quoted_value_survives(self) -> None:
        """A reason naming an issue (`see #76`) must not be truncated, because
        tomllib would not truncate it and the two parsers would then disagree."""
        rows = checker.parse_waivers_toml_compat(
            textwrap.dedent(
                """\
                [[waiver]]
                id = "GHSA-x"
                reason = "blocked upstream, see #76 # not a comment"
                """
            )
        )
        self.assertEqual(rows[0]["reason"], "blocked upstream, see #76 # not a comment")


class FailClosedTests(unittest.TestCase):
    """A scan that did not happen is never a clean scan."""

    def scanner_that(self, directory: Path, body: str) -> Path:
        path = directory / "osv-scanner"
        path.write_text("#!/usr/bin/env python3\n" + textwrap.dedent(body), encoding="utf-8")
        path.chmod(0o755)
        return path

    def run_with(self, scanner: Path, waivers: Path, directory: Path) -> subprocess.CompletedProcess:
        lockfile = directory / "pnpm-lock.yaml"
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

    def test_a_failed_scan_fails_the_gate(self) -> None:
        """osv-scanner exits 127/128 when it cannot reach the OSV API or cannot
        find a package source. Neither means "nothing found"."""
        for code in (127, 128, 2):
            with self.subTest(code=code):
                with tempfile.TemporaryDirectory() as tmp:
                    directory = Path(tmp)
                    scanner = self.scanner_that(directory, f"raise SystemExit({code})\n")
                    waivers = waiver_file(directory, "# nothing waived\n")
                    completed = self.run_with(scanner, waivers, directory)
                self.assertNotEqual(completed.returncode, 0)
                self.assertIn("refusing to", completed.stderr)

    def test_empty_output_on_a_successful_exit_fails_the_gate(self) -> None:
        """Exit 0 with no JSON is not an empty finding set, it is no scan."""
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            scanner = self.scanner_that(directory, "raise SystemExit(0)\n")
            waivers = waiver_file(directory, "# nothing waived\n")
            completed = self.run_with(scanner, waivers, directory)
        self.assertNotEqual(completed.returncode, 0)
        self.assertIn("produced no output", completed.stderr)

    def test_non_json_output_fails_the_gate(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            scanner = self.scanner_that(directory, "print('not json')\nraise SystemExit(1)\n")
            waivers = waiver_file(directory, "# nothing waived\n")
            completed = self.run_with(scanner, waivers, directory)
        self.assertNotEqual(completed.returncode, 0)
        self.assertIn("is not JSON", completed.stderr)

    def test_a_non_npm_ecosystem_fails_the_gate(self) -> None:
        """The routing guard. A cargo lockfile wired into this leg would demand
        npm-shaped waivers for advisories cargo-audit already gates, and the
        reverse misroute is the silent one — so the ecosystem is asserted rather
        than assumed."""
        with tempfile.TemporaryDirectory() as tmp:
            waivers = waiver_file(Path(tmp), "# nothing waived\n")
            document = report(("yamux", "0.12.1", [OTEL]), ecosystem="crates.io")
            completed = run(document, waivers)
        self.assertNotEqual(completed.returncode, 0)
        self.assertIn("ecosystem routing", completed.stderr)

    def test_a_package_with_no_declared_ecosystem_fails_the_gate(self) -> None:
        """The scanner is digest-pinned, so the field is always present. Treating
        its absence as npm would make a future scanner change fail open."""
        with tempfile.TemporaryDirectory() as tmp:
            waivers = waiver_file(Path(tmp), "# nothing waived\n")
            document = {
                "results": [
                    {
                        "packages": [
                            {
                                "package": {"name": "left-pad", "version": "1.0.0"},
                                "vulnerabilities": [OTEL],
                            }
                        ]
                    }
                ]
            }
            completed = run(document, waivers)
        self.assertNotEqual(completed.returncode, 0)
        self.assertIn("ecosystem routing", completed.stderr)


class SharedDriverTests(unittest.TestCase):
    def test_both_checkers_use_one_driver(self) -> None:
        """The fail-closed rule is written down once.

        Two copies would drift, and the copy that drifted would be the one
        nobody re-read. This asserts identity rather than equality of behavior,
        because equal-today is what drift starts from.
        """
        ghsa_script = REPO_ROOT / "tools/ci/check-ghsa-only.py"
        spec = importlib.util.spec_from_file_location("check_ghsa_only_probe", ghsa_script)
        ghsa = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(ghsa)
        self.assertEqual(ghsa.SCAN_OK, checker.SCAN_OK)
        self.assertEqual(ghsa.scan.__code__, checker.scan.__code__)
        self.assertEqual(checker.SCAN_OK, frozenset({0, 1}))


if __name__ == "__main__":
    unittest.main()
