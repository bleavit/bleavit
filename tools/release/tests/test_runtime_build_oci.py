from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
WRAPPER = ROOT / "tools/release/build-runtime-oci.sh"
WORKER = ROOT / "tools/release/build-runtime.sh"


class RuntimeBuildOciTests(unittest.TestCase):
    def _fake_repository(
        self, root: Path, capture: Path
    ) -> tuple[Path, dict[str, str]]:
        release = root / "tools" / "release"
        release.mkdir(parents=True)
        wrapper = release / WRAPPER.name
        shutil.copy2(WRAPPER, wrapper)
        profiles = release / "runtime_profiles.py"
        profiles.write_text(
            """#!/usr/bin/env python3
import sys

field = sys.argv[sys.argv.index("--field") + 1]
values = {
    "primary_profile": "bootstrap",
    "recovery_profile": "bootstrap-recovery",
    "build_image": "docker.io/example/runtime@sha256:" + "1" * 64,
    "build_image_id": "sha256:" + "2" * 64,
    "build_platform": "linux/amd64",
    "build_upstream_tag": "reviewed-tag",
    "toolchain": "1.89.0",
}
print(values[field])
""",
            encoding="utf-8",
        )
        (root / "tracked.txt").write_text("clean\n", encoding="utf-8")

        fake_bin = root / "fake-bin"
        fake_bin.mkdir()
        docker = fake_bin / "docker"
        docker.write_text(
            """#!/usr/bin/env python3
import os
import sys
from pathlib import Path

args = sys.argv[1:]
capture = Path(os.environ["BLEAVIT_TEST_DOCKER_CAPTURE"])
with capture.open("a", encoding="utf-8") as stream:
    stream.write("\\0".join(args) + "\\n")
if args[:2] == ["image", "inspect"]:
    print("sha256:" + "2" * 64)
elif args and args[0] == "run":
    mount = next(arg for arg in args if arg.startswith("type=bind,src=") and arg.endswith(",dst=/out"))
    out = Path(mount.split(",", 2)[1].removeprefix("src="))
    for relative in ("runtime.wasm", "build-info.json", "recovery/runtime.wasm", "recovery/build-info.json"):
        target = out / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("fixture", encoding="utf-8")
""",
            encoding="utf-8",
        )
        docker.chmod(0o755)

        subprocess.run(["git", "init", "-q"], cwd=root, check=True)
        subprocess.run(["git", "config", "user.email", "test@example.invalid"], cwd=root, check=True)
        subprocess.run(["git", "config", "user.name", "Test"], cwd=root, check=True)
        subprocess.run(["git", "add", "."], cwd=root, check=True)
        subprocess.run(["git", "commit", "-qm", "fixture"], cwd=root, check=True)
        environment = {
            **os.environ,
            "PATH": str(fake_bin) + os.pathsep + os.environ["PATH"],
            "BLEAVIT_TEST_DOCKER_CAPTURE": str(capture),
        }
        return wrapper, environment

    def test_shell_entrypoints_are_syntactically_valid(self) -> None:
        result = subprocess.run(
            ["bash", "-n", str(WRAPPER), str(WORKER)],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_host_cannot_emit_an_oci_attributed_build_record(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            environment = os.environ.copy()
            for key in tuple(environment):
                if key.startswith("BLEAVIT_RUNTIME_BUILD_"):
                    environment.pop(key)
            result = subprocess.run(
                [str(WORKER), directory, "bootstrap"],
                cwd=ROOT,
                env=environment,
                capture_output=True,
                text=True,
            )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("build-runtime-oci.sh", result.stderr)

    def test_wrapper_verifies_and_confines_the_exact_image(self) -> None:
        source = WRAPPER.read_text(encoding="utf-8")
        for required in (
            'docker pull --platform "$platform" "$image"',
            "docker image inspect --format '{{.Id}}'",
            '[[ "$actual_image_id" != "$image_id" ]]',
            "docker run --rm --pull=never",
            "--read-only",
            "--cap-drop=ALL",
            "--security-opt=no-new-privileges",
            'dst=/src,readonly',
            'BLEAVIT_RUNTIME_BUILD_IMAGE="$image"',
            '--env SOURCE_DATE_EPOCH="$source_date_epoch"',
            '--env BLEAVIT_SOURCE_COMMIT="$source_commit"',
            "--no-self-update",
            '/src/tools/release/build-runtime.sh /out/recovery',
        ):
            self.assertIn(required, source)

    def test_clean_repository_commit_is_passed_across_the_oci_boundary(self) -> None:
        with tempfile.TemporaryDirectory() as directory, tempfile.TemporaryDirectory() as output:
            root = Path(directory)
            external = Path(output)
            capture = external / "docker-args.txt"
            wrapper, environment = self._fake_repository(root, capture)
            commit = subprocess.run(
                ["git", "rev-parse", "HEAD"],
                cwd=root,
                check=True,
                capture_output=True,
                text=True,
            ).stdout.strip()
            result = subprocess.run(
                [str(wrapper), str(external / "artifacts"), "bootstrap"],
                cwd=root,
                env=environment,
                capture_output=True,
                text=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn(
                f"BLEAVIT_SOURCE_COMMIT={commit}",
                capture.read_text(encoding="utf-8"),
            )

    def test_dirty_repository_is_rejected_before_docker(self) -> None:
        with tempfile.TemporaryDirectory() as directory, tempfile.TemporaryDirectory() as output:
            root = Path(directory)
            external = Path(output)
            capture = external / "docker-args.txt"
            wrapper, environment = self._fake_repository(root, capture)
            (root / "tracked.txt").write_text("dirty\n", encoding="utf-8")
            result = subprocess.run(
                [str(wrapper), str(external / "artifacts"), "bootstrap"],
                cwd=root,
                env=environment,
                capture_output=True,
                text=True,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("requires a clean source tree", result.stderr)
            self.assertFalse(capture.exists(), "Docker ran before the dirty-tree refusal")

    def test_wrapper_requires_both_profile_outputs(self) -> None:
        source = WRAPPER.read_text(encoding="utf-8")
        for artifact in (
            "runtime.wasm",
            "build-info.json",
            "recovery/runtime.wasm",
            "recovery/build-info.json",
        ):
            self.assertIn(artifact, source)

    def test_worker_hints_out_of_tree_wasm_build_at_the_read_only_workspace(self) -> None:
        source = WORKER.read_text(encoding="utf-8")
        self.assertIn('export WASM_BUILD_WORKSPACE_HINT="$repo_root"', source)
        self.assertIn(
            '"WASM_BUILD_WORKSPACE_HINT": os.environ["WASM_BUILD_WORKSPACE_HINT"]',
            source,
        )
        self.assertIn('commit = os.environ["BLEAVIT_SOURCE_COMMIT"]', source)
        self.assertNotIn('command("git", "rev-parse", "HEAD")', source)


if __name__ == "__main__":
    unittest.main()
