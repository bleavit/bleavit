"""The supply-chain gate must notice a lockfile nobody wired into it.

The defect these tests pin down is a coverage hole, not a wrong answer. The gate
named `Cargo.lock` and `keeper/Cargo.lock` inline; `app/Cargo.lock` and
`fuzz/Cargo.lock` were committed later and were audited by nothing, while the
Supply-chain CI job stayed green throughout. So the load-bearing test here is the
one that fails when a lockfile appears with no row — the rest guard the manifest's
own integrity, since a manifest the checker cannot trust is a work list the gate
cannot trust.

The hole outlived its cargo instance one ecosystem over: `app/pnpm-lock.yaml`
backs the bundle a browser executes and was audited by nothing at all, and no
amount of care about the cargo list could have reported it (SQ-985). Discovery is
therefore tested across ecosystems, and the npm legs here are what fail if it
narrows back to cargo.
"""

from __future__ import annotations

import importlib.util
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
CHECKER = REPO_ROOT / "tools/ci/check-audited-workspaces.py"
MANIFEST = REPO_ROOT / "tools/ci/audited-workspaces.toml"


def load_checker():
    spec = importlib.util.spec_from_file_location("check_audited_workspaces", CHECKER)
    module = importlib.util.module_from_spec(spec)
    sys.modules["check_audited_workspaces"] = module
    spec.loader.exec_module(module)
    return module


checker = load_checker()


def git(*args: str, cwd: Path) -> None:
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True)


def make_repo(root: Path, lockfiles: list[str]) -> None:
    """A throwaway git repository holding exactly the named lockfiles.

    Discovery reads `git ls-files`, so the fixture has to be a real repository
    with real tracked files. Writing the files without committing them would
    exercise a different code path than the one that matters.
    """
    git("init", "-q", cwd=root)
    git("config", "user.email", "test@example.invalid", cwd=root)
    git("config", "user.name", "test", cwd=root)
    for lockfile in lockfiles:
        path = root / lockfile
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("# fixture\n", encoding="utf-8")
    git("add", "-A", cwd=root)
    git("commit", "-qm", "fixture", cwd=root)


def manifest_text(rows: list[tuple[str, ...]]) -> str:
    """Build a manifest from `(name, directory, lockfile[, ecosystem])` tuples.

    The ecosystem defaults to cargo so the cargo-shaped cases stay readable, and
    the npm cases name it. A row that omitted it entirely would be rejected by
    the checker, which is itself covered below.
    """
    out = []
    for row in rows:
        name, directory, lockfile = row[0], row[1], row[2]
        ecosystem = row[3] if len(row) > 3 else "cargo"
        out.append(
            "[[workspace]]\n"
            f'name = "{name}"\n'
            f'ecosystem = "{ecosystem}"\n'
            f'directory = "{directory}"\n'
            f'lockfile = "{lockfile}"\n'
            'audit_config = ""\n'
            'ships = "fixture"\n'
        )
    return "\n".join(out)


class CoverageTests(unittest.TestCase):
    def test_committed_manifest_matches_the_repository(self) -> None:
        """The real manifest and the real repository agree right now."""
        rows, errors = checker.check(MANIFEST, REPO_ROOT)
        self.assertEqual(errors, [], f"committed manifest is out of date: {errors}")
        self.assertEqual(
            {row["lockfile"] for row in rows},
            set(checker.discover_lockfiles(REPO_ROOT)),
        )

    def test_every_known_lockfile_is_declared(self) -> None:
        """Regression pin for the exact holes that were open.

        Each lockfile is named literally, so deleting a row fails here with the
        name of what stopped being audited rather than with a count that has to
        be interpreted. `app/pnpm-lock.yaml` is the highest-consequence one and
        was the last to be covered by anything (SQ-985).
        """
        declared = {row["lockfile"] for row in checker.load_workspaces(MANIFEST)}
        for lockfile in (
            "Cargo.lock",
            "keeper/Cargo.lock",
            "app/Cargo.lock",
            "fuzz/Cargo.lock",
            "app/pnpm-lock.yaml",
        ):
            self.assertIn(lockfile, declared)

    def test_the_npm_lockfile_is_classified_as_npm(self) -> None:
        """Routing, not just presence.

        A row declaring `app/pnpm-lock.yaml` as cargo would hand it to
        `cargo metadata` and to `check-ghsa-only.py`, whose skip rule would let
        every npm finding through with nothing behind it. The ecosystem is what
        the gate switches on, so it is asserted rather than assumed.
        """
        rows = {row["lockfile"]: row["ecosystem"] for row in checker.load_workspaces(MANIFEST)}
        self.assertEqual(rows["app/pnpm-lock.yaml"], "npm")
        self.assertEqual(rows["app/Cargo.lock"], "cargo")

    def test_an_unclassified_npm_lockfile_fails_the_check(self) -> None:
        """The defect one ecosystem over: a pnpm lockfile that nothing audits.

        This is the test that would have failed while `app/pnpm-lock.yaml` went
        unscanned, and the one that fails if discovery ever narrows back to
        `*Cargo.lock`.
        """
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            make_repo(root, ["Cargo.lock", "app/pnpm-lock.yaml"])
            manifest = root / "manifest.toml"
            manifest.write_text(manifest_text([("root", ".", "Cargo.lock")]), encoding="utf-8")
            _rows, errors = checker.check(manifest, root)
            self.assertEqual(len(errors), 1, errors)
            self.assertIn("app/pnpm-lock.yaml", errors[0])
            self.assertIn("Nothing audits it", errors[0])

    def test_every_npm_lockfile_name_is_discovered(self) -> None:
        """A second package manager arriving by accident must fail, not ship.

        A stray `npm install` beside a pnpm workspace writes `package-lock.json`
        and resolves a second, independent dependency tree. Each name is checked
        rather than trusting one pathspec, because a name missing from
        `LOCKFILE_NAMES` is a lockfile the gate cannot notice at all.
        """
        for basename in checker.LOCKFILE_NAMES["npm"]:
            with self.subTest(basename=basename):
                with tempfile.TemporaryDirectory() as temporary:
                    root = Path(temporary)
                    make_repo(root, ["Cargo.lock", f"web/{basename}"])
                    manifest = root / "manifest.toml"
                    manifest.write_text(
                        manifest_text([("root", ".", "Cargo.lock")]), encoding="utf-8"
                    )
                    _rows, errors = checker.check(manifest, root)
                    self.assertEqual(len(errors), 1, errors)
                    self.assertIn(f"web/{basename}", errors[0])

    def test_a_lookalike_name_is_not_discovered(self) -> None:
        """`*yarn.lock` also matches `my-yarn.lock`, which is not a lockfile.

        Discovery re-checks the basename rather than trusting the pathspec. A
        gate that demanded a row for every file ending in those characters would
        be switched off rather than fixed.
        """
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            make_repo(root, ["Cargo.lock", "docs/my-yarn.lock", "docs/notes-Cargo.lock"])
            manifest = root / "manifest.toml"
            manifest.write_text(manifest_text([("root", ".", "Cargo.lock")]), encoding="utf-8")
            _rows, errors = checker.check(manifest, root)
            self.assertEqual(errors, [])

    def test_a_fifth_lockfile_fails_the_check(self) -> None:
        """The defect being fixed: a new lockfile that nothing audits."""
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            make_repo(root, ["Cargo.lock", "keeper/Cargo.lock", "tools/embedded/Cargo.lock"])
            manifest = root / "manifest.toml"
            manifest.write_text(
                manifest_text([("root", ".", "Cargo.lock"), ("keeper", "keeper", "keeper/Cargo.lock")]),
                encoding="utf-8",
            )
            _rows, errors = checker.check(manifest, root)
            self.assertEqual(len(errors), 1, errors)
            self.assertIn("tools/embedded/Cargo.lock", errors[0])
            self.assertIn("Nothing audits it", errors[0])

    def test_a_stale_row_fails_the_check(self) -> None:
        """A row whose lockfile git no longer tracks is also a mismatch.

        Without this direction the manifest could keep naming a deleted
        workspace, and the gate would fail later inside `cargo metadata` with a
        message about a missing file rather than about a stale classification.
        """
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            make_repo(root, ["Cargo.lock"])
            manifest = root / "manifest.toml"
            manifest.write_text(
                manifest_text([("root", ".", "Cargo.lock"), ("gone", "gone", "gone/Cargo.lock")]),
                encoding="utf-8",
            )
            _rows, errors = checker.check(manifest, root)
            self.assertEqual(len(errors), 1, errors)
            self.assertIn("gone/Cargo.lock", errors[0])
            self.assertIn("git does not track it", errors[0])

    def test_untracked_lockfile_is_not_counted(self) -> None:
        """Only committed lockfiles are owed coverage.

        A lockfile in the working tree that git ignores is not something a
        release ships, and demanding a row for it would make the gate fail on a
        developer's scratch workspace.
        """
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            make_repo(root, ["Cargo.lock"])
            (root / "scratch").mkdir()
            (root / "scratch/Cargo.lock").write_text("# untracked\n", encoding="utf-8")
            manifest = root / "manifest.toml"
            manifest.write_text(manifest_text([("root", ".", "Cargo.lock")]), encoding="utf-8")
            _rows, errors = checker.check(manifest, root)
            self.assertEqual(errors, [])


class ManifestIntegrityTests(unittest.TestCase):
    def test_directory_and_lockfile_must_agree(self) -> None:
        """A row pointing at another workspace's lockfile would audit one and scan the other."""
        with tempfile.TemporaryDirectory() as temporary:
            manifest = Path(temporary) / "manifest.toml"
            manifest.write_text(manifest_text([("app", "app", "keeper/Cargo.lock")]), encoding="utf-8")
            with self.assertRaises(SystemExit) as caught:
                checker.load_workspaces(manifest)
            self.assertIn("owns", str(caught.exception))

    def test_duplicate_names_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            manifest = Path(temporary) / "manifest.toml"
            manifest.write_text(
                manifest_text([("app", "app", "app/Cargo.lock"), ("app", "fuzz", "fuzz/Cargo.lock")]),
                encoding="utf-8",
            )
            with self.assertRaises(SystemExit) as caught:
                checker.load_workspaces(manifest)
            self.assertIn("duplicate workspace name", str(caught.exception))

    def test_an_npm_row_may_not_claim_a_cargo_lockfile(self) -> None:
        """The ecosystem decides which basenames a directory owns.

        Without this, a row could label `Cargo.lock` as npm and route it to the
        checker that demands a waiver for everything, or label a pnpm lockfile as
        cargo and route it to `cargo metadata`. Both are silent misroutes rather
        than errors, which is why the pairing is validated at load.
        """
        with tempfile.TemporaryDirectory() as temporary:
            manifest = Path(temporary) / "manifest.toml"
            manifest.write_text(
                manifest_text([("app-npm", "app", "app/Cargo.lock", "npm")]), encoding="utf-8"
            )
            with self.assertRaises(SystemExit) as caught:
                checker.load_workspaces(manifest)
            self.assertIn("npm directory", str(caught.exception))

    def test_a_cargo_row_may_not_claim_an_npm_lockfile(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            manifest = Path(temporary) / "manifest.toml"
            manifest.write_text(
                manifest_text([("app", "app", "app/pnpm-lock.yaml", "cargo")]), encoding="utf-8"
            )
            with self.assertRaises(SystemExit) as caught:
                checker.load_workspaces(manifest)
            self.assertIn("cargo directory", str(caught.exception))

    def test_an_unknown_ecosystem_is_rejected(self) -> None:
        """A typo must not silently drop a lockfile out of every leg."""
        with tempfile.TemporaryDirectory() as temporary:
            manifest = Path(temporary) / "manifest.toml"
            manifest.write_text(
                manifest_text([("web", "web", "web/pnpm-lock.yaml", "pnpm")]), encoding="utf-8"
            )
            with self.assertRaises(SystemExit) as caught:
                checker.load_workspaces(manifest)
            self.assertIn("unknown ecosystem", str(caught.exception))

    def test_missing_required_key_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            manifest = Path(temporary) / "manifest.toml"
            manifest.write_text(
                '[[workspace]]\nname = "app"\necosystem = "cargo"\n'
                'directory = "app"\nlockfile = "app/Cargo.lock"\n',
                encoding="utf-8",
            )
            with self.assertRaises(SystemExit) as caught:
                checker.load_workspaces(manifest)
            self.assertIn("is missing", str(caught.exception))

    def test_empty_manifest_is_rejected(self) -> None:
        """An empty manifest would otherwise mean an empty work list and a green gate."""
        with tempfile.TemporaryDirectory() as temporary:
            manifest = Path(temporary) / "manifest.toml"
            manifest.write_text("# nothing here\n", encoding="utf-8")
            with self.assertRaises(SystemExit) as caught:
                checker.load_workspaces(manifest)
            self.assertIn("declares no workspaces", str(caught.exception))

    def test_git_failure_is_not_read_as_full_coverage(self) -> None:
        """A discovery failure must never look like "no extra lockfiles"."""
        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaises(SystemExit) as caught:
                checker.discover_lockfiles(Path(temporary))
            self.assertIn("refusing to treat that as full coverage", str(caught.exception))


class CommandLineTests(unittest.TestCase):
    """The `--print` plumbing the gate script routes on.

    These assert the SHAPE of the output, and take the expected counts from the
    manifest rather than restating them. A test that hard-coded "5 rows" would
    fail the day a sixth workspace is classified — which is the day the manifest
    is right and the test is wrong, and the wrong half is the one a hurried
    session edits. The rows below are named individually because membership is
    the property worth pinning; the total is not.
    """

    def test_print_emits_machine_readable_rows_on_stdout(self) -> None:
        declared = load_checker().load_workspaces(MANIFEST)
        completed = subprocess.run(
            [sys.executable, str(CHECKER), "--print"],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        rows = [line.split("\t") for line in completed.stdout.splitlines() if line]
        self.assertEqual(len(rows), len(declared))
        self.assertTrue(all(len(row) == 4 for row in rows))
        self.assertIn(["app", "cargo", "app", "app/Cargo.lock"], rows)
        self.assertIn(["fuzz", "cargo", "fuzz", "fuzz/Cargo.lock"], rows)
        self.assertIn(["root", "cargo", ".", "Cargo.lock"], rows)
        self.assertIn(["app-npm", "npm", "app", "app/pnpm-lock.yaml"], rows)
        self.assertIn(["explainer-npm", "npm", "explainer", "explainer/package-lock.json"], rows)

    def test_ecosystem_filter_selects_only_that_ecosystems_rows(self) -> None:
        """The gate routes on this, so an over-broad filter would misroute a leg."""
        declared = load_checker().load_workspaces(MANIFEST)
        for ecosystem in sorted({row["ecosystem"] for row in declared}):
            expected = sum(1 for row in declared if row["ecosystem"] == ecosystem)
            with self.subTest(ecosystem=ecosystem):
                completed = subprocess.run(
                    [sys.executable, str(CHECKER), "--print", "--ecosystem", ecosystem],
                    cwd=REPO_ROOT,
                    capture_output=True,
                    text=True,
                )
                self.assertEqual(completed.returncode, 0, completed.stderr)
                rows = [line.split("\t") for line in completed.stdout.splitlines() if line]
                self.assertEqual(len(rows), expected)
                self.assertTrue(all(row[1] == ecosystem for row in rows))

    def test_every_row_is_reachable_through_some_ecosystem_filter(self) -> None:
        """The per-ecosystem work lists must partition the manifest, not sample it.

        The gate builds each leg's arguments from one filtered run. If a row's
        ecosystem were spelled in a way no filter selects, that workspace would
        be classified — passing the coverage check — and still handed to no leg.
        That is the original hole wearing the manifest's own clothes.
        """
        checker_module = load_checker()
        declared = checker_module.load_workspaces(MANIFEST)
        seen: list[str] = []
        for ecosystem in sorted(checker_module.LOCKFILE_NAMES):
            completed = subprocess.run(
                [sys.executable, str(CHECKER), "--print", "--ecosystem", ecosystem],
                cwd=REPO_ROOT,
                capture_output=True,
                text=True,
            )
            self.assertEqual(completed.returncode, 0, completed.stderr)
            seen.extend(line.split("\t")[3] for line in completed.stdout.splitlines() if line)
        self.assertEqual(sorted(seen), sorted(row["lockfile"] for row in declared))

    def test_the_ecosystem_filter_does_not_narrow_the_coverage_check(self) -> None:
        """Narrowing the work list must never narrow what the repository is checked against.

        A `--print --ecosystem cargo` run that ignored an unclassified pnpm
        lockfile would let the gate route four cargo legs and report success,
        while the file the bundle is built from stayed unaudited. That is the
        original defect with an extra flag on it.
        """
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            make_repo(root, ["Cargo.lock", "app/pnpm-lock.yaml"])
            manifest = root / "manifest.toml"
            manifest.write_text(manifest_text([("root", ".", "Cargo.lock")]), encoding="utf-8")
            completed = subprocess.run(
                [
                    sys.executable,
                    str(CHECKER),
                    "--print",
                    "--ecosystem",
                    "cargo",
                    "--manifest",
                    str(manifest),
                    "--repo-root",
                    str(root),
                ],
                capture_output=True,
                text=True,
            )
            self.assertEqual(completed.returncode, 1)
            self.assertEqual(completed.stdout.strip(), "")
            self.assertIn("app/pnpm-lock.yaml", completed.stderr)

    def test_print_stays_silent_on_stdout_when_the_check_fails(self) -> None:
        """`--print` feeds the gate's work list, so it must emit nothing on failure.

        A checker that printed rows and then exited non-zero would let a caller
        that ignored the status audit a list it never verified.
        """
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            make_repo(root, ["Cargo.lock", "extra/Cargo.lock"])
            manifest = root / "manifest.toml"
            manifest.write_text(manifest_text([("root", ".", "Cargo.lock")]), encoding="utf-8")
            completed = subprocess.run(
                [sys.executable, str(CHECKER), "--print", "--manifest", str(manifest), "--repo-root", str(root)],
                capture_output=True,
                text=True,
            )
            self.assertEqual(completed.returncode, 1)
            self.assertEqual(completed.stdout.strip(), "")
            self.assertIn("extra/Cargo.lock", completed.stderr)


if __name__ == "__main__":
    unittest.main()
