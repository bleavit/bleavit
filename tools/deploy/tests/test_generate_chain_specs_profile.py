from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "tools/deploy/generate-chain-specs.sh"


class GenerateChainSpecsProfileTests(unittest.TestCase):
    def test_developer_generator_uses_canonical_explicit_runtime_profile(self) -> None:
        script = SCRIPT.read_text(encoding="utf-8")
        self.assertIn("tools/release/runtime_profiles.py", script)
        self.assertIn("RUNTIME_PROFILE", script)
        self.assertIn("--field features", script)
        self.assertIn("--no-default-features", script)
        self.assertIn('--features "$runtime_features"', script)
        self.assertNotIn(
            "--release --features substrate-wasm-builder --locked", script
        )

    def test_release_generator_embeds_prebuilt_runtime_without_rebuilding_it(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            deploy = root / "tools" / "deploy"
            deploy.mkdir(parents=True)
            script = deploy / SCRIPT.name
            shutil.copy2(SCRIPT, script)

            validator = deploy / "validate-chain-spec.py"
            validator.write_text("raise SystemExit(0)\n", encoding="utf-8")

            target = root / "target"
            builder = target / "tools" / "bin" / "chain-spec-builder"
            builder.parent.mkdir(parents=True)
            builder.write_text(
                """#!/usr/bin/env python3
import json
import sys
from pathlib import Path

args = sys.argv[1:]
if args == ["--version"]:
    print("chain-spec-builder 19.0.0")
    raise SystemExit(0)
output = Path(args[args.index("--chain-spec-path") + 1])
runtime = Path(args[args.index("--runtime") + 1])
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps({
    "genesis": {"runtimeGenesis": {"code": "0x" + runtime.read_bytes().hex()}},
}) + "\\n", encoding="utf-8")
""",
                encoding="utf-8",
            )
            builder.chmod(0o755)

            fake_bin = root / "fake-bin"
            fake_bin.mkdir()
            cargo = fake_bin / "cargo"
            cargo.write_text(
                """#!/usr/bin/env bash
echo invoked >> "$BLEAVIT_TEST_CARGO_CAPTURE"
exit 97
""",
                encoding="utf-8",
            )
            cargo.chmod(0o755)

            runtime = root / "oci-primary.wasm"
            runtime.write_bytes(b"exact-oci-runtime-bytes")
            capture = root / "cargo-invocations"
            environment = {
                **os.environ,
                "PATH": str(fake_bin) + os.pathsep + os.environ["PATH"],
                "CARGO_TARGET_DIR": str(target),
                "BLEAVIT_TEST_CARGO_CAPTURE": str(capture),
            }
            completed = subprocess.run(
                [str(script), "--runtime-wasm", str(runtime)],
                cwd=root,
                env=environment,
                capture_output=True,
                text=True,
            )
            self.assertEqual(completed.returncode, 0, completed.stderr)
            self.assertFalse(
                capture.exists(),
                "release mode rebuilt the runtime despite a valid pinned builder",
            )
            expected = "0x" + runtime.read_bytes().hex()
            for name in ("bleavit-dev.json", "bleavit-local.json"):
                document = json.loads(
                    (root / "deploy" / "chain-specs" / "out" / name).read_text(
                        encoding="utf-8"
                    )
                )
                self.assertEqual(
                    document["genesis"]["runtimeGenesis"]["code"], expected
                )

    def test_release_generator_rejects_an_empty_runtime_before_tools_run(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            runtime = Path(directory) / "empty.wasm"
            runtime.touch()
            completed = subprocess.run(
                [str(SCRIPT), "--runtime-wasm", str(runtime)],
                cwd=ROOT,
                capture_output=True,
                text=True,
            )
        self.assertNotEqual(completed.returncode, 0)
        self.assertIn("non-empty regular file", completed.stderr)

    def test_environment_generator_passes_the_same_prebuilt_runtime_through(
        self,
    ) -> None:
        script = (ROOT / "tools/env/generate-relay-specs.sh").read_text(
            encoding="utf-8"
        )
        self.assertIn('runtime_args=(--runtime-wasm "$runtime_wasm")', script)
        self.assertIn(
            '"$repo_root/tools/deploy/generate-chain-specs.sh" "${runtime_args[@]}"',
            script,
        )
        self.assertIn('wasm="$runtime_wasm"', script)


if __name__ == "__main__":
    unittest.main()
