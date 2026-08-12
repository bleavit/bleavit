from __future__ import annotations

import os
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
WRAPPER = ROOT / "tools/release/build-runtime-oci.sh"
WORKER = ROOT / "tools/release/build-runtime.sh"


class RuntimeBuildOciTests(unittest.TestCase):
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
            '/src/tools/release/build-runtime.sh /out/recovery',
        ):
            self.assertIn(required, source)

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


if __name__ == "__main__":
    unittest.main()
