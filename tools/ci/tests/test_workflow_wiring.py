"""Structural checks on `.github/workflows/ci.yml`'s own wiring.

Every gate this repository owns is verified by something. The *workflow that invokes
them* was not, and that gap cost a red CI run: three steps added to the `app` job ran
`pnpm` from the repository root, because the sibling steps carry a **per-step**
`working-directory: app` and the job declares no `defaults`. pnpm reported
`ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND` and — the part worth the test — corepack fell back
to downloading the newest pnpm, because without `app/package.json` there is no
`packageManager` pin to honour. So the failure mode is not merely "step fails": a step in
the wrong directory silently loses the version pin the repository depends on.

`tools/ci/check-ci-parity.py` cannot catch this. It runs each *gate* in a CI-shaped
checkout and compares behaviour; it never reads the workflow, so a gate that is correct
and invoked wrongly passes it. These tests read the workflow instead.

**The binding is bidirectional, and the two directions fail differently.** A step naming
a script that does not exist fails loudly the first time the job runs. A *script that no
step names* never fails at all — it is a suite that exists, passes locally, is cited in
PLAN.md as a gate, and has never executed in CI. That direction was missing until
2026-08-05, and it was hiding fourteen gates and 296 assertions: every suite belonging to
`local-index`, `providers`, `verify`, the three handoff formats and the generated
schema/skill artifacts, plus the 02 §7.7 foreign-feed gate. So the inverse is asserted
here, and an exemption costs an entry with a stated reason.
"""

from __future__ import annotations

import pathlib
import re
import unittest

import yaml

ROOT = pathlib.Path(__file__).resolve().parents[3]
WORKFLOWS = ROOT / ".github" / "workflows"

# Jobs whose tooling lives in a subdirectory, and the directory it lives in.
#
# `desktop-shell` (F22) is here for the same reason `app` is, and it is the case that shows
# why the map is a map: it is a *Rust* job, and its two pnpm steps exist only to produce the
# attested release tree the shell embeds. A `pnpm install` from the repository root there
# would fail exactly as it did on the `app` job — and, worse, would take corepack's newest
# pnpm rather than the pin, because the pin lives in `app/package.json`.
#
# Its directory is `second-environment/app` and not `app` because it checks out into its own
# path — 12 §1.1's stated difference between the two build environments (F13). That makes the
# map earn its keep a second time: the two jobs run the same commands from two directories,
# and a step copied from one job to the other now lands in the wrong one.
SUBDIRECTORY_JOBS = {"app": "app", "desktop-shell": "second-environment/app"}

_REGENERATOR = (
    "a `--write` regenerator; its `:check` counterpart is the gate. Running a "
    "regenerator in CI would rewrite the artifact it is supposed to be comparing "
    "against, so it would pass unconditionally"
)

# Scripts that deliberately have no CI step. Exact in **both** directions: an entry
# naming a script that no longer exists is itself a failure, because a stale exemption
# silently covers whatever later takes that name.
UNWIRED_BY_DESIGN = {
    "typecheck": "`build` already runs `tsc -b`; wiring both compiles the graph twice",
    "clean": "a developer utility that deletes build output",
    "test": (
        "the local aggregate. CI enumerates the gates individually so a failure names "
        "the gate that failed — and so that dropping a suite from the aggregate cannot "
        "remove it from CI in the same edit, unnoticed"
    ),
    "descriptors:generate": _REGENERATOR,
    "surface:generate": _REGENERATOR,
    "schemas:generate": _REGENERATOR,
    "skills:generate": _REGENERATOR,
}

# **Every** `pnpm run <script>` in a step body — not the first, and not one per line.
#
# Both narrower versions were written and both were wrong, in the same way the gate below
# exists to catch. Matching only a step's opening command missed the other three suites in
# a `run: |` block; anchoring per line then missed the second half of
# `pnpm run check:chain-literals && pnpm run check:chain-literals:witness`, and reported
# three *wired* witness legs as unwired. A parser that sees less than the shell does will
# either miss a gate or invent one, and a checker that cries wolf gets switched off as
# surely as one that never fires.
_PNPM_RUN = re.compile(r"pnpm run ([A-Za-z0-9:_-]+)")


def load(name: str) -> dict:
    return yaml.safe_load((WORKFLOWS / name).read_text(encoding="utf-8"))


def app_scripts() -> dict:
    import json

    return json.loads((ROOT / "app" / "package.json").read_text(encoding="utf-8"))["scripts"]


def scripts_wired_in_ci() -> set:
    spec = load("ci.yml")
    wired = set()
    for step in spec["jobs"]["app"]["steps"]:
        wired.update(_PNPM_RUN.findall(step.get("run") or ""))
    return wired


class WorkflowWiring(unittest.TestCase):
    def test_every_pnpm_step_runs_in_its_package_directory(self) -> None:
        for workflow in sorted(WORKFLOWS.glob("*.yml")):
            spec = yaml.safe_load(workflow.read_text(encoding="utf-8"))
            for job_name, job in (spec.get("jobs") or {}).items():
                expected = SUBDIRECTORY_JOBS.get(job_name)
                if expected is None:
                    continue
                job_default = ((job.get("defaults") or {}).get("run") or {}).get(
                    "working-directory"
                )
                for step in job.get("steps") or []:
                    command = (step.get("run") or "").strip()
                    if not command.startswith(("pnpm", "npx", "node ")):
                        continue
                    where = step.get("working-directory", job_default)
                    self.assertEqual(
                        where,
                        expected,
                        f"{workflow.name} · job {job_name} · step "
                        f"{step.get('name')!r} runs {command.splitlines()[0]!r} from "
                        f"{where!r}; it must run from {expected!r}, or the pnpm version "
                        "pin in that directory's package.json is silently not applied",
                    )

    def test_app_job_gates_are_declared_as_package_scripts(self) -> None:
        """A step naming a script that does not exist fails only when the job runs."""
        scripts = set(app_scripts())
        for script in sorted(scripts_wired_in_ci()):
            self.assertIn(
                script,
                scripts,
                f"ci.yml runs `pnpm run {script}`, which app/package.json does not define",
            )

    def test_every_app_script_is_wired_into_ci_or_exempt(self) -> None:
        """The inverse, and the direction that fails silently.

        A suite nobody invokes passes locally forever and never runs in CI. Nothing else
        in this repository notices: `check-ci-parity.py` runs gates it is given, the
        firewall checks imports, and PLAN.md cites the suite as a gate because it exists.
        """
        wired = scripts_wired_in_ci()
        for name in sorted(app_scripts()):
            if name in UNWIRED_BY_DESIGN:
                self.assertNotIn(
                    name,
                    wired,
                    f"`{name}` is listed in UNWIRED_BY_DESIGN and also wired into "
                    "ci.yml; one of the two is wrong",
                )
                continue
            self.assertIn(
                name,
                wired,
                f"app/package.json defines `{name}` but no ci.yml step runs it, so it "
                "never executes in CI. Add a step, or add it to UNWIRED_BY_DESIGN with "
                "the reason it must not run there",
            )

    def test_exemptions_name_scripts_that_exist(self) -> None:
        """A stale exemption is worse than none: it pre-approves whatever takes the name."""
        scripts = set(app_scripts())
        for name, reason in UNWIRED_BY_DESIGN.items():
            self.assertIn(
                name,
                scripts,
                f"UNWIRED_BY_DESIGN exempts `{name}`, which app/package.json no longer "
                "defines; drop the entry rather than leaving it to cover a future script",
            )
            self.assertTrue(reason.strip(), f"the exemption for `{name}` states no reason")

    def test_no_suite_script_selects_tests_by_extension(self) -> None:
        """A per-suite `test` script must not glob a file extension.

        `node --test *.test.js` in a directory that has migrated to TypeScript matches
        nothing, and Node reports `# tests 0` with **exit 0** — a green pass having executed
        nothing. Six suites were already in that state when the migration was half done
        (contexts, firewall, llm-handoff, mock-runtime, providers, receipts), and every
        further slice would have joined them silently, one directory at a time.

        Bare `node --test` discovers `.js` and `.ts` alike, so the selection cannot drift
        from the files again. The root `pnpm run test:<suite>` scripts are unaffected — they
        go through `tools/run-suite.ts`, which globs `{js,ts}` explicitly — which is exactly
        why nothing went red: CI ran the suites, and only a developer running the package's
        own script got the silent zero.
        """
        suites = sorted((ROOT / "app" / "tests").glob("*/package.json"))
        self.assertGreater(len(suites), 10, "the suite glob found almost nothing; it is wrong")
        for manifest in suites:
            import json

            script = ((json.loads(manifest.read_text(encoding="utf-8")).get("scripts")) or {}).get(
                "test"
            )
            if script is None:
                continue
            self.assertNotIn(
                "*.test.",
                script,
                f"app/tests/{manifest.parent.name} selects its tests by extension "
                f"({script!r}). A directory that migrates to TypeScript then matches nothing "
                "and exits 0. Use bare `node --test`, which discovers both",
            )

    def test_every_suite_directory_holds_a_discoverable_test(self) -> None:
        """The other half: a script that can find files, in a directory that has none.

        Asserted separately because the check above is satisfied by an empty directory —
        `node --test` with nothing to discover is the same silent zero arrived at from the
        other side.
        """
        for manifest in sorted((ROOT / "app" / "tests").glob("*/package.json")):
            directory = manifest.parent
            import json

            if "test" not in ((json.loads(manifest.read_text(encoding="utf-8")).get("scripts")) or {}):
                continue
            found = list(directory.glob("*.test.js")) + list(directory.glob("*.test.ts"))
            self.assertTrue(
                found,
                f"app/tests/{directory.name} declares a `test` script but holds no "
                "`*.test.js` or `*.test.ts` file, so running it proves nothing",
            )

    def test_every_release_build_publishes_its_digests(self) -> None:
        """12 §1.1's evidence, bound to the builds rather than listed beside them (F13).

        Both `release:build` runs already happened on independent runners and **neither
        published anything**, so nothing compared them and a divergence between the two
        would have shipped. The binding is derived: whichever jobs run `release:build` are
        the environments, so adding a third one without its manifest fails here rather than
        silently leaving it out of the comparison.
        """
        jobs = load("ci.yml")["jobs"]
        builders = {
            name: job
            for name, job in jobs.items()
            if any("pnpm run release:build" in (step.get("run") or "") for step in job["steps"])
        }
        self.assertEqual(
            sorted(builders),
            ["app", "desktop-shell"],
            "the set of jobs that build a release tree changed; every one of them is one of "
            "12 §1.1's environments and must publish a manifest",
        )
        for name, job in builders.items():
            with self.subTest(name):
                commands = " ".join(step.get("run") or "" for step in job["steps"])
                self.assertIn(
                    "pnpm run release:manifest",
                    commands,
                    f"job {name} builds a release tree and publishes no digests, so nothing "
                    "can compare it with the other environment",
                )
                uploads = [
                    step
                    for step in job["steps"]
                    if str(step.get("uses", "")).startswith("actions/upload-artifact")
                ]
                self.assertEqual(
                    len(uploads),
                    1,
                    f"job {name} must upload exactly one repro manifest",
                )
                self.assertEqual(
                    uploads[0]["with"]["if-no-files-found"],
                    "error",
                    f"job {name} would upload nothing silently; the comparison job would then "
                    "fail for a reason that names the wrong thing",
                )

    def test_the_two_environments_are_named_apart(self) -> None:
        """One id twice is one environment, and the checker refuses it — but it would refuse
        it *in CI*, having already spent two full builds getting there."""
        jobs = load("ci.yml")["jobs"]
        declared = re.findall(
            r"pnpm run release:manifest -- --environment ([a-z0-9-]+)",
            "\n".join(
                step.get("run") or "" for job in jobs.values() for step in job["steps"]
            ),
        )
        self.assertEqual(len(declared), 2, f"expected two build environments, found {declared}")
        self.assertEqual(len(set(declared)), 2, f"both environments declare the id {declared[0]!r}")

    def test_the_second_environment_really_is_a_second_one(self) -> None:
        """The stated difference, asserted where deleting it is cheap enough to happen.

        `check-release-reproducibility.py` fails when the two manifests agree on every
        recorded axis, so removing the nested checkout turns the gate red rather than
        quietly weakening it — but only after both builds have run. This says the same
        thing in under a second.
        """
        jobs = load("ci.yml")["jobs"]
        checkout_paths = {}
        for name in ("app", "desktop-shell"):
            for step in jobs[name]["steps"]:
                if str(step.get("uses", "")).startswith("actions/checkout"):
                    checkout_paths[name] = (step.get("with") or {}).get("path")
        self.assertNotEqual(
            checkout_paths["app"],
            checkout_paths["desktop-shell"],
            "both build environments check out to the same path, so they differ only in "
            "which virtual machine ran them — a repeatability check wearing a "
            "reproducibility check's name (12 §1.1)",
        )

    def test_the_comparison_job_consumes_both_manifests(self) -> None:
        """A comparison that waited on one build, or downloaded one artifact, would pass
        while proving half of what it claims."""
        jobs = load("ci.yml")["jobs"]
        comparison = jobs["release-reproducibility"]
        self.assertEqual(sorted(comparison["needs"]), ["app", "desktop-shell"])
        uploaded = {
            step["with"]["name"]
            for name in ("app", "desktop-shell")
            for step in jobs[name]["steps"]
            if str(step.get("uses", "")).startswith("actions/upload-artifact")
        }
        downloaded = {
            step["with"]["name"]
            for step in comparison["steps"]
            if str(step.get("uses", "")).startswith("actions/download-artifact")
        }
        self.assertEqual(
            uploaded,
            downloaded,
            "the comparison job does not download exactly the manifests the build jobs "
            "publish; a renamed artifact fails the download rather than the comparison, "
            "which is a red job that says nothing about reproducibility",
        )
        self.assertIn(
            "tools/ci/check-release-reproducibility.py",
            " ".join(step.get("run") or "" for step in comparison["steps"]),
        )

    def test_concurrency_never_cancels_on_main(self) -> None:
        """R-12's rule: pushing to a branch supersedes its own run; `main` never does.

        On `main` each run is the record for its own commit, so cancelling one destroys
        evidence rather than saving time.
        """
        for name in ("ci.yml", "sweep.yml"):
            spec = load(name)
            group = (spec.get("concurrency") or {}).get("cancel-in-progress")
            self.assertIsNotNone(
                group, f"{name} lost its concurrency block; duplicate runs will queue"
            )
            self.assertIn(
                "main",
                str(group),
                f"{name}'s cancel-in-progress does not exempt main: "
                "a re-run would cancel the record of an earlier commit",
            )


if __name__ == "__main__":
    unittest.main()
