"""The supply-chain gate must notice a cargo lockfile nobody wired into it.

The defect these tests pin down is a coverage hole, not a wrong answer. The gate
named `Cargo.lock` and `keeper/Cargo.lock` inline; `app/Cargo.lock` and
`fuzz/Cargo.lock` were committed later and were audited by nothing, while the
Supply-chain CI job stayed green throughout. So the load-bearing test here is the
one that fails when a fifth lockfile appears — the rest guard the manifest's own
integrity, since a manifest the checker cannot trust is a work list the gate
cannot trust.
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


def manifest_text(rows: list[tuple[str, str, str]]) -> str:
    out = []
    for name, directory, lockfile in rows:
        out.append(
            "[[workspace]]\n"
            f'name = "{name}"\n'
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

    def test_all_four_known_lockfiles_are_declared(self) -> None:
        """Regression pin for the exact hole that was open.

        `app/Cargo.lock` and `fuzz/Cargo.lock` are named literally, so deleting
        either row fails here with the name of what stopped being audited rather
        than with a count that has to be interpreted.
        """
        declared = {row["lockfile"] for row in checker.load_workspaces(MANIFEST)}
        for lockfile in ("Cargo.lock", "keeper/Cargo.lock", "app/Cargo.lock", "fuzz/Cargo.lock"):
            self.assertIn(lockfile, declared)

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

    def test_missing_required_key_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            manifest = Path(temporary) / "manifest.toml"
            manifest.write_text(
                '[[workspace]]\nname = "app"\ndirectory = "app"\nlockfile = "app/Cargo.lock"\n',
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
    def test_print_emits_machine_readable_rows_on_stdout(self) -> None:
        completed = subprocess.run(
            [sys.executable, str(CHECKER), "--print"],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        rows = [line.split("\t") for line in completed.stdout.splitlines() if line]
        self.assertEqual(len(rows), 4)
        self.assertTrue(all(len(row) == 3 for row in rows))
        self.assertIn(["app", "app", "app/Cargo.lock"], rows)
        self.assertIn(["fuzz", "fuzz", "fuzz/Cargo.lock"], rows)
        self.assertIn(["root", ".", "Cargo.lock"], rows)

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
