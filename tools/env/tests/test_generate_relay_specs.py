from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "tools/env/generate-relay-specs.sh"
PASEO_COMMIT = "1" * 40


class GenerateRelaySpecsTests(unittest.TestCase):
    @staticmethod
    def write_executable(path: Path, body: str) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(body, encoding="utf-8")
        path.chmod(0o755)

    def test_prebuilt_primary_survives_the_second_generator_handoff(self) -> None:
        """No real Cargo, Git, network, or chain-spec tool runs in this proof."""
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            env_dir = root / "tools/env"
            deploy_dir = root / "tools/deploy"
            env_dir.mkdir(parents=True)
            deploy_dir.mkdir(parents=True)
            shutil.copy2(SCRIPT, env_dir / SCRIPT.name)
            (env_dir / "pins.env").write_text(
                f"PASEO_CSG_TAG=fixture\nPASEO_CSG_COMMIT={PASEO_COMMIT}\n",
                encoding="utf-8",
            )
            (root / "zombienet/genesis").mkdir(parents=True)
            (root / "zombienet/genesis/drill-overrides.json").write_text(
                "{}\n", encoding="utf-8"
            )
            (deploy_dir / "validate-chain-spec.py").write_text(
                "raise SystemExit(0)\n", encoding="utf-8"
            )

            target = root / "target"
            cache = target / "env/paseo-chain-spec-generator-src/.git"
            cache.mkdir(parents=True)
            fake_bin = root / "fake-bin"
            fake_bin.mkdir()
            cargo_capture = root / "cargo-invocations.jsonl"
            deploy_capture = root / "deploy-invocations.jsonl"

            self.write_executable(
                fake_bin / "git",
                textwrap.dedent(
                    f"""\
                    #!/usr/bin/env python3
                    import sys
                    if sys.argv[-2:] == ["rev-parse", "HEAD"]:
                        print("{PASEO_COMMIT}")
                    raise SystemExit(0)
                    """
                ),
            )
            self.write_executable(
                fake_bin / "cargo",
                textwrap.dedent(
                    """\
                    #!/usr/bin/env python3
                    import json
                    import os
                    import sys
                    from pathlib import Path

                    target = Path(os.environ["CARGO_TARGET_DIR"])
                    capture = Path(os.environ["BLEAVIT_TEST_CARGO_CAPTURE"])
                    with capture.open("a", encoding="utf-8") as handle:
                        handle.write(json.dumps(sys.argv[1:]) + "\\n")
                    if "fast-timing" in " ".join(sys.argv[1:]):
                        wasm = target / (
                            "release/wbuild/bleavit-runtime/"
                            "bleavit_runtime.compact.compressed.wasm"
                        )
                        wasm.parent.mkdir(parents=True, exist_ok=True)
                        wasm.write_bytes(b"test-only-fast-runtime")
                    else:
                        generator = target / "release/chain-spec-generator"
                        generator.parent.mkdir(parents=True, exist_ok=True)
                        generator.write_text(
                            "#!/usr/bin/env python3\\n"
                            "import json\\n"
                            "print(json.dumps({'genesis': {'runtimeGenesis': {"
                            "'code': '0x00', 'patch': {}}}}))\\n",
                            encoding="utf-8",
                        )
                        generator.chmod(0o755)
                    """
                ),
            )

            # The relay generator's subject is the handoff into this existing
            # deploy stage and the builder it leaves behind.  This fixture
            # records the argument and models the builder's byte embedding;
            # the deploy generator's own behavioral test covers its internals.
            self.write_executable(
                target / "tools/bin/chain-spec-builder",
                textwrap.dedent(
                    """\
                    #!/usr/bin/env python3
                    import json
                    import sys
                    from pathlib import Path

                    args = sys.argv[1:]
                    if args == ["--version"]:
                        print("chain-spec-builder 19.0.0")
                        raise SystemExit(0)
                    if "display-preset" in args:
                        print(json.dumps({
                            "balances": {"balances": []},
                            "guardian": {"members": []},
                        }))
                        raise SystemExit(0)
                    output = Path(args[args.index("--chain-spec-path") + 1])
                    output.parent.mkdir(parents=True, exist_ok=True)
                    if "convert-to-raw" in args:
                        source = Path(args[args.index("convert-to-raw") + 1])
                        document = json.loads(source.read_text(encoding="utf-8"))
                        code = document.get("genesis", {}).get(
                            "runtimeGenesis", {}
                        ).get("code", "0x00")
                        result = {
                            "genesis": {"raw": {"top": {"0x3a636f6465": code}}}
                        }
                    else:
                        runtime = Path(args[args.index("--runtime") + 1])
                        result = {"genesis": {"runtimeGenesis": {
                            "code": "0x" + runtime.read_bytes().hex(),
                        }}}
                    output.write_text(
                        json.dumps(result) + "\\n", encoding="utf-8"
                    )
                    """
                ),
            )
            self.write_executable(
                deploy_dir / "generate-chain-specs.sh",
                textwrap.dedent(
                    """\
                    #!/usr/bin/env python3
                    import json
                    import os
                    import sys
                    from pathlib import Path

                    capture = Path(os.environ["BLEAVIT_TEST_DEPLOY_CAPTURE"])
                    with capture.open("a", encoding="utf-8") as handle:
                        handle.write(json.dumps(sys.argv[1:]) + "\\n")
                    runtime = Path(sys.argv[sys.argv.index("--runtime-wasm") + 1])
                    code = "0x" + runtime.read_bytes().hex()
                    root = Path.cwd()
                    canonical = root / "deploy/chain-specs/out"
                    canonical.mkdir(parents=True, exist_ok=True)
                    for name in ("bleavit-dev.json", "bleavit-local.json"):
                        (canonical / name).write_text(json.dumps({
                            "genesis": {"runtimeGenesis": {"code": code}},
                        }) + "\\n", encoding="utf-8")
                    """
                ),
            )

            primary = root / "oci-primary.wasm"
            primary.write_bytes(b"exact-oci-primary")
            environment = {
                **os.environ,
                "PATH": str(fake_bin) + os.pathsep + os.environ["PATH"],
                "CARGO_TARGET_DIR": str(target),
                "BLEAVIT_TEST_CARGO_CAPTURE": str(cargo_capture),
                "BLEAVIT_TEST_DEPLOY_CAPTURE": str(deploy_capture),
            }
            completed = subprocess.run(
                [str(env_dir / SCRIPT.name), "--runtime-wasm", str(primary)],
                cwd=root,
                env=environment,
                capture_output=True,
                text=True,
            )
            self.assertEqual(completed.returncode, 0, completed.stderr)

            invocations = [
                json.loads(line)
                for line in deploy_capture.read_text(encoding="utf-8").splitlines()
            ]
            self.assertEqual(invocations, [["--runtime-wasm", str(primary.resolve())]])

            expected = "0x" + primary.read_bytes().hex()
            ordinary = root / "zombienet/specs/out"
            for name in (
                "bleavit-drill.json",
                "bleavit-drill-raw.json",
                "bleavit-drill-migration.json",
            ):
                document = json.loads((ordinary / name).read_text(encoding="utf-8"))
                if name.endswith("-raw.json"):
                    actual = document["genesis"]["raw"]["top"]["0x3a636f6465"]
                else:
                    actual = document["genesis"]["runtimeGenesis"]["code"]
                self.assertEqual(actual, expected, name)

            fast_expected = "0x" + b"test-only-fast-runtime".hex()
            for name in (
                "bleavit-drill-fast.json",
                "bleavit-drill-fast-coretime.json",
            ):
                document = json.loads((ordinary / name).read_text(encoding="utf-8"))
                self.assertEqual(
                    document["genesis"]["runtimeGenesis"]["code"],
                    fast_expected,
                    name,
                )


if __name__ == "__main__":
    unittest.main()
