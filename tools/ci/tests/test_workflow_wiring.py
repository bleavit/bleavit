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
"""

from __future__ import annotations

import pathlib
import unittest

import yaml

ROOT = pathlib.Path(__file__).resolve().parents[3]
WORKFLOWS = ROOT / ".github" / "workflows"

# Jobs whose tooling lives in a subdirectory, and the directory it lives in.
SUBDIRECTORY_JOBS = {"app": "app"}


def load(name: str) -> dict:
    return yaml.safe_load((WORKFLOWS / name).read_text(encoding="utf-8"))


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
        import json

        scripts = set(
            json.loads((ROOT / "app" / "package.json").read_text(encoding="utf-8"))["scripts"]
        )
        spec = load("ci.yml")
        for step in spec["jobs"]["app"]["steps"]:
            command = (step.get("run") or "").strip()
            if not command.startswith("pnpm run "):
                continue
            script = command.split()[2]
            self.assertIn(
                script,
                scripts,
                f"ci.yml runs `pnpm run {script}`, which app/package.json does not define",
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
