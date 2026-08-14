"""Tests for the 12 §1.1 two-environment byte-identical gate (F13).

Every case here is an outcome a healthy release never produces, which is the only place
a gate like this is ever really exercised: on a good day it compares two identical maps
and prints one line, and so would a checker that compared nothing at all.

Four groups, and the middle two are the reason this file is longer than a diff test:

  * **The files.** A difference must fail *and name the path*, in both directions — a
    file only in one environment is as much a divergence as a file whose digest moved,
    and a loop over one map sees only half of them.
  * **The comparison's own preconditions.** Two manifests from the *same* environment,
    from two different commits, or built from two different recipes all compare
    identically and prove nothing; a manifest whose declared tree digest does not match
    its own file map proves something about the producer rather than about a build.
    Each is refused with its own sentence.
  * **The recipe axes** (SQ-1009). 12 §1.1 fixes `SOURCE_DATE_EPOCH`, so the two
    environments must carry the same one — and the refusal must name the *recipe*, since
    the same divergence reported as a file diff invites the repair that unsets the
    variable. The anti-vacuity case is two manifests differing in nothing else.
  * **The digest convention.** `app/fixtures/tree-digest-cases.json` is read in place
    here and by `app/tests/release/repro-manifest.test.ts`, so the Python consumer and
    the TypeScript producer are bound to one definition of a tree hash rather than to
    two that currently agree.
"""

from __future__ import annotations

import copy
import importlib.util
import json
import pathlib
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[3]
CHECKER = ROOT / "tools" / "ci" / "check-release-reproducibility.py"
FIXTURE = ROOT / "app" / "fixtures" / "tree-digest-cases.json"


def _load_checker():
    spec = importlib.util.spec_from_file_location("check_release_reproducibility", CHECKER)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


checker = _load_checker()

HASH_A = "a" * 64
HASH_B = "b" * 64
HASH_C = "c" * 64
COMMIT = "c13aace095c510f06262e6eeb09ae6a215b7f38b"
RECIPE = "d" * 64
# The commit time `source-date-epoch.ts` would derive. A decimal string, because that is what
# an environment variable is and what the producer records.
EPOCH = "1786017411"


def manifest(
    environment_id: str,
    files: dict[str, str] | None = None,
    *,
    build_path: str = "/home/runner/work/bleavit/bleavit/app",
    commit: str = COMMIT,
    recipe: str = RECIPE,
    epoch: str | None = EPOCH,
) -> dict:
    files = {"dist/index.html": HASH_A, "release-out/release.json": HASH_B} if files is None else files
    return {
        "schema": checker.SCHEMA,
        "environment": {
            "id": environment_id,
            "substantive": {
                "node": "v22.19.0",
                "pnpm": "10.23.0",
                "platform": "linux",
                "arch": "x64",
                "osRelease": "6.11.0-1018-azure",
                "imageOs": "ubuntu24",
                "imageVersion": "20250101.1",
                "buildPath": build_path,
                "home": "/home/runner",
                "cpuCount": 4,
                "sourceDateEpoch": epoch,
            },
            "incidental": {"hostname": f"runner-{environment_id}", "runner": "GitHub Actions 1"},
        },
        "sourceCommit": commit,
        "buildRecipeDigest": recipe,
        "treeDigest": checker.tree_digest(files),
        "files": files,
    }


def pair(second_build_path: str = "/home/runner/work/bleavit/bleavit/second-environment/app"):
    """The healthy case: two ids, one stated difference, identical output."""
    return manifest("app"), manifest("desktop-shell", build_path=second_build_path)


class TreeDigest(unittest.TestCase):
    """The convention, against the fixture the TypeScript producer also reads."""

    def setUp(self) -> None:
        self.fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))

    def test_fixture_is_not_empty(self) -> None:
        """A fixture that lost its cases would let every assertion below pass vacuously."""
        self.assertGreaterEqual(len(self.fixture["cases"]), 4)
        self.assertGreaterEqual(len(self.fixture["refusals"]), 3)

    def test_every_case_reproduces(self) -> None:
        for case in self.fixture["cases"]:
            with self.subTest(case["name"]):
                self.assertEqual(
                    checker.tree_digest(case["files"]),
                    case["treeDigest"],
                    f"{case['name']}: {case['why']}",
                )

    def test_every_refusal_is_refused(self) -> None:
        for case in self.fixture["refusals"]:
            with self.subTest(case["name"]):
                with self.assertRaises(ValueError):
                    checker.tree_digest(case["files"])

    def test_insertion_order_does_not_move_the_digest(self) -> None:
        """Asserted here as well as in the fixture, because the fixture states it and this
        proves it: `sorted()` is what makes the digest a function of the tree."""
        forward = {"dist/a.js": HASH_A, "dist/b.js": HASH_B, "dist/c.js": HASH_C}
        backward = {"dist/c.js": HASH_C, "dist/b.js": HASH_B, "dist/a.js": HASH_A}
        self.assertEqual(checker.tree_digest(forward), checker.tree_digest(backward))

    def test_a_rename_changes_the_digest(self) -> None:
        """The path is committed to. A digest over the file hashes alone would call a tree
        with every file renamed a faithful reproduction of the original."""
        before = {"dist/app.js": HASH_A}
        after = {"dist/main.js": HASH_A}
        self.assertNotEqual(checker.tree_digest(before), checker.tree_digest(after))


class Files(unittest.TestCase):
    def test_identical_environments_pass(self) -> None:
        failures, report = checker.check(*pair())
        self.assertEqual(failures, [], failures)
        self.assertTrue(any("byte-identical" in line for line in report), report)

    def test_a_changed_file_fails_and_names_it(self) -> None:
        first, second = pair()
        second["files"]["dist/index.html"] = HASH_C
        second["treeDigest"] = checker.tree_digest(second["files"])
        failures, _ = checker.check(first, second)
        self.assertTrue(failures)
        self.assertIn("dist/index.html", "\n".join(failures))
        # Both digests, not just the path: an operator comparing two logs needs the values.
        self.assertIn(HASH_A, "\n".join(failures))
        self.assertIn(HASH_C, "\n".join(failures))

    def test_a_file_only_in_the_first_environment_fails(self) -> None:
        first, second = pair()
        first["files"]["dist/extra.js"] = HASH_C
        first["treeDigest"] = checker.tree_digest(first["files"])
        failures, _ = checker.check(first, second)
        self.assertIn("only in app: dist/extra.js", "\n".join(failures))

    def test_a_file_only_in_the_second_environment_fails(self) -> None:
        """The direction a one-sided loop misses. A file the second builder emitted and the
        first did not is exactly as much of a divergence as a digest that moved."""
        first, second = pair()
        second["files"]["dist/extra.js"] = HASH_C
        second["treeDigest"] = checker.tree_digest(second["files"])
        failures, _ = checker.check(first, second)
        self.assertIn("only in desktop-shell: dist/extra.js", "\n".join(failures))

    def test_every_differing_path_is_reported_not_the_first(self) -> None:
        first, second = pair()
        second["files"] = {"dist/index.html": HASH_C, "release-out/release.json": HASH_C}
        second["treeDigest"] = checker.tree_digest(second["files"])
        failures, _ = checker.check(first, second)
        joined = "\n".join(failures)
        self.assertIn("dist/index.html", joined)
        self.assertIn("release-out/release.json", joined)
        self.assertIn("2 of 2 release file(s)", joined)

    def test_an_empty_file_map_is_refused(self) -> None:
        """Two empty maps compare equal. Read as `{}` this gate would pass unconditionally
        on the day a build emitted nothing."""
        first, second = pair()
        second["files"] = {}
        with self.assertRaises(ValueError):
            checker.check(first, second)


class Preconditions(unittest.TestCase):
    def test_one_environment_twice_is_refused(self) -> None:
        first, second = manifest("app"), manifest("app")
        failures, _ = checker.check(first, second)
        self.assertTrue(any("one environment" in failure for failure in failures), failures)

    def test_no_substantive_difference_is_refused(self) -> None:
        """The vacuity case, and the reason `desktop-shell` checks out into its own path.

        Two ids and identical environments is a repeatability check wearing a
        reproducibility check's name; nothing in a green log distinguishes them.
        """
        first, second = pair(second_build_path="/home/runner/work/bleavit/bleavit/app")
        failures, _ = checker.check(first, second)
        self.assertTrue(
            any("agree on every recorded environment axis" in failure for failure in failures),
            failures,
        )

    def test_incidental_facts_cannot_supply_the_difference(self) -> None:
        """`hostname` differs between any two runners and means nothing. It is recorded, and
        it must not be able to satisfy the requirement above."""
        first, second = pair(second_build_path="/home/runner/work/bleavit/bleavit/app")
        second["environment"]["incidental"]["hostname"] = "an-entirely-different-machine"
        failures, _ = checker.check(first, second)
        self.assertTrue(
            any("agree on every recorded environment axis" in failure for failure in failures),
            failures,
        )

    def test_an_unknown_axis_is_not_a_difference(self) -> None:
        """`null` is "not observable here", not a value. Counting it would let an axis one
        runner cannot report stand in for independence it never demonstrated."""
        first, second = pair(second_build_path="/home/runner/work/bleavit/bleavit/app")
        second["environment"]["substantive"]["imageOs"] = None
        failures, _ = checker.check(first, second)
        self.assertTrue(
            any("agree on every recorded environment axis" in failure for failure in failures),
            failures,
        )

    def test_a_missing_axis_is_refused_rather_than_counted(self) -> None:
        """One side not recording an axis is a difference between two versions of the
        producer, not between two environments."""
        first, second = pair()
        del second["environment"]["substantive"]["imageOs"]
        failures, _ = checker.check(first, second)
        self.assertTrue(any("different environment axes" in failure for failure in failures), failures)

    def test_an_empty_substantive_block_is_refused(self) -> None:
        first, second = pair()
        second["environment"]["substantive"] = {}
        with self.assertRaises(ValueError):
            checker.check(first, second)

    def test_different_commits_are_refused(self) -> None:
        first, second = pair()
        second["sourceCommit"] = "0" * 40
        failures, _ = checker.check(first, second)
        self.assertTrue(any("different commits" in failure for failure in failures), failures)

    def test_different_recipes_are_refused(self) -> None:
        first, second = pair()
        second["buildRecipeDigest"] = "e" * 64
        failures, _ = checker.check(first, second)
        self.assertTrue(any("different recipes" in failure for failure in failures), failures)

    def test_a_manifest_that_misstates_its_own_digest_is_refused(self) -> None:
        """The self-consistent-lie case: identical file maps, and one declared digest that
        describes neither. Evidence about a producer, not about a build."""
        first, second = pair()
        second["treeDigest"] = "f" * 64
        failures, _ = checker.check(first, second)
        self.assertTrue(
            any("does not describe itself" in failure for failure in failures), failures
        )
        self.assertIn("desktop-shell", "\n".join(failures))


class RecipeAxes(unittest.TestCase):
    """Refusal 4 — 12 §1.1's `SOURCE_DATE_EPOCH`, as something that can fail (SQ-1009).

    Every case here is a way the *recipe* diverged while the file maps stayed identical,
    which is the only shape this refusal can catch and the shape a file-map diff reports
    as a mystery.
    """

    def test_a_differing_epoch_is_refused(self) -> None:
        """The anti-vacuity case: two manifests that differ in **nothing else**.

        The whole refusal exists for this pair. Their files are byte-identical, their
        commits and recipe digests agree, and the only thing between them is the variable
        12 §1.1 fixes — so a gate that had not been taught about it prints one green line.
        """
        first, second = manifest("app"), manifest("desktop-shell", epoch="1786017412")
        failures, _ = checker.check(first, second)
        self.assertTrue(
            any("different SOURCE_DATE_EPOCH values" in failure for failure in failures),
            failures,
        )

    def test_the_refusal_names_the_recipe_and_not_the_bytes(self) -> None:
        """The wording is load-bearing, not decoration.

        A recipe divergence reported as "these files differ" has an obvious cheapest
        repair — unset the variable — and that repair is the failure the convention
        exists to prevent, arriving through the gate meant to catch it. So the sentence
        must say *recipe*, name the variable an operator would set, and there must be no
        file-level failure alongside it inviting the other reading.
        """
        first, second = manifest("app"), manifest("desktop-shell", epoch="1786017412")
        joined = "\n".join(checker.check(first, second)[0])
        self.assertIn("SOURCE_DATE_EPOCH", joined)
        self.assertIn("recipe divergence and not a file difference", joined)
        self.assertNotIn("byte-identical across the two environments", joined)

    def test_a_differing_epoch_cannot_supply_the_independence_difference(self) -> None:
        """The axis that must never move cannot be the one proving two environments.

        It is recorded in `substantive` because the producer reads it off the
        environment, and a comparator that took it at face value would let a *defect*
        satisfy refusal 1. Both failures must fire on the pair above: the recipe
        diverged, and nothing else about the two environments differed at all.
        """
        first, second = manifest("app"), manifest("desktop-shell", epoch="1786017412")
        failures, _ = checker.check(first, second)
        self.assertTrue(
            any("agree on every recorded environment axis" in failure for failure in failures),
            failures,
        )

    def test_an_unset_epoch_on_one_side_is_refused(self) -> None:
        """`null` is an honest answer about a machine and a dishonest one about a recipe.

        Everywhere else in this manifest it means "not observable here". 12 §1.1 fixes
        this value, so an unset one is a build that did not follow the recipe.
        """
        first, second = manifest("app"), manifest("desktop-shell", epoch=None)
        failures, _ = checker.check(first, second)
        self.assertTrue(
            any("desktop-shell recorded no SOURCE_DATE_EPOCH" in failure for failure in failures),
            failures,
        )

    def test_unsetting_it_on_both_sides_does_not_buy_silence(self) -> None:
        """The repair the refusal's own wording warns against.

        Two `null`s compare equal, so an equality-only rule would go green on exactly the
        pair that proves nobody set the variable.
        """
        first = manifest("app", epoch=None)
        second = manifest("desktop-shell", epoch=None)
        failures, _ = checker.check(first, second)
        self.assertTrue(
            any("app and desktop-shell recorded no SOURCE_DATE_EPOCH" in f for f in failures),
            failures,
        )

    def test_deleting_the_axis_from_both_producers_does_not_buy_silence(self) -> None:
        """The same repair, one level further: remove the evidence rather than the value.

        Deleting the key from *both* sides keeps the key sets equal, so the producer-drift
        check never fires and every equality test ever written passes over an absent key.
        """
        first, second = pair()
        del first["environment"]["substantive"]["sourceDateEpoch"]
        del second["environment"]["substantive"]["sourceDateEpoch"]
        failures, _ = checker.check(first, second)
        self.assertTrue(
            any("recorded no SOURCE_DATE_EPOCH" in failure for failure in failures), failures
        )

    def test_deleting_the_axis_from_one_producer_still_reaches_the_recipe_check(self) -> None:
        """A key-set mismatch is reported, and it does not swallow the recipe finding.

        The axis check returns early on producer drift — correctly, since the tally would
        be meaningless — and the recipe axes are evaluated on that path too, so a manifest
        that dropped the key is not merely "an older tool".
        """
        first, second = pair()
        del second["environment"]["substantive"]["sourceDateEpoch"]
        failures, _ = checker.check(first, second)
        joined = "\n".join(failures)
        self.assertIn("different environment axes", joined)
        self.assertIn("recorded no SOURCE_DATE_EPOCH", joined)

    def test_the_agreed_value_is_reported_on_the_healthy_path(self) -> None:
        """Evidence, not silence. A gate that mentions the epoch only when it fails leaves
        a reader unable to tell "both carried the same one" from "nobody looked"."""
        failures, report = checker.check(*pair())
        self.assertEqual(failures, [], failures)
        self.assertTrue(
            any(f"agree on SOURCE_DATE_EPOCH: {EPOCH}" in line for line in report), report
        )

    def test_every_recipe_axis_is_named_by_the_variable_an_operator_sets(self) -> None:
        """The classification is data, and a future axis must arrive with its own name.

        `RECIPE_AXES` maps the manifest's JSON key to the environment variable, so the
        failure names the thing to fix rather than the field it was recorded under. An
        entry mapping a key to itself would quietly reintroduce the JSON-key wording.
        """
        self.assertEqual(checker.RECIPE_AXES["sourceDateEpoch"], "SOURCE_DATE_EPOCH")
        for axis, variable in checker.RECIPE_AXES.items():
            self.assertNotEqual(axis, variable)


class Cli(unittest.TestCase):
    """The entry point, because everything above tests `check()` and CI runs the file."""

    def run_on(self, first: dict, second: dict) -> subprocess.CompletedProcess:
        with tempfile.TemporaryDirectory() as directory:
            paths = []
            for name, document in (("a.json", first), ("b.json", second)):
                path = pathlib.Path(directory) / name
                path.write_text(json.dumps(document), encoding="utf-8")
                paths.append(str(path))
            return subprocess.run(
                ["python3", str(CHECKER), *paths], capture_output=True, text=True, cwd=ROOT
            )

    def test_identical_builds_exit_zero(self) -> None:
        result = self.run_on(*pair())
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("byte-identical release", result.stdout)

    def test_a_divergence_exits_one_and_names_the_path(self) -> None:
        first, second = pair()
        second["files"]["dist/index.html"] = HASH_C
        second["treeDigest"] = checker.tree_digest(second["files"])
        result = self.run_on(first, second)
        self.assertEqual(result.returncode, 1)
        self.assertIn("dist/index.html", result.stderr)

    def test_a_recipe_divergence_exits_one_and_names_the_variable(self) -> None:
        """Through the real entry point, because the wording only helps if it is printed."""
        result = self.run_on(manifest("app"), manifest("desktop-shell", epoch="1786017412"))
        self.assertEqual(result.returncode, 1)
        self.assertIn("SOURCE_DATE_EPOCH", result.stderr)

    def test_a_foreign_schema_is_refused(self) -> None:
        first, second = pair()
        second["schema"] = "bleavit.app-release.v1"
        result = self.run_on(first, second)
        self.assertEqual(result.returncode, 1)
        self.assertIn("schema", result.stderr)

    def test_a_missing_manifest_is_refused_not_skipped(self) -> None:
        result = subprocess.run(
            ["python3", str(CHECKER), "nowhere.json", "also-nowhere.json"],
            capture_output=True,
            text=True,
            cwd=ROOT,
        )
        self.assertEqual(result.returncode, 1)
        self.assertIn("FAIL", result.stderr)


class TheHealthyCaseIsReachable(unittest.TestCase):
    """Anti-vacuity for this file, not for the checker.

    Every test above asserts a refusal. If the healthy shape had drifted so that nothing
    could pass, all of them would still be green — the failure mode that made
    `check:embedded-tree`'s first witness leg worthless.
    """

    def test_the_fixtures_this_file_builds_do_pass(self) -> None:
        failures, _ = checker.check(*pair())
        self.assertEqual(failures, [])

    def test_and_a_single_byte_makes_them_fail(self) -> None:
        first, second = pair()
        second["files"] = copy.deepcopy(second["files"])
        second["files"]["dist/index.html"] = HASH_C
        second["treeDigest"] = checker.tree_digest(second["files"])
        failures, _ = checker.check(first, second)
        self.assertTrue(failures)


if __name__ == "__main__":
    unittest.main()
