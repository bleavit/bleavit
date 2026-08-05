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
SUBDIRECTORY_JOBS = {"app": "app"}

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
