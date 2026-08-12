from __future__ import annotations

import re
import unittest
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[3]
WORKFLOW = ROOT / ".github/workflows/ci.yml"
IMAGE = re.compile(r"^node@sha256:([0-9a-f]{64})$")


class ReproBuildEnvironmentTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.jobs = yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))["jobs"]

    def test_both_release_builders_use_distinct_digest_pinned_images(self) -> None:
        identities: set[tuple[str, str]] = set()
        for name in ("app", "desktop-shell"):
            with self.subTest(name):
                job = self.jobs[name]
                image = job["container"]["image"]
                match = IMAGE.fullmatch(image)
                self.assertIsNotNone(
                    match,
                    f"{name} must execute in a node@sha256:<linux/amd64 manifest> image",
                )
                digest = f"sha256:{match.group(1)}"
                self.assertEqual(job["env"]["ImageVersion"], digest)
                self.assertRegex(job["env"]["ImageOS"], r"^debian-[a-z]+$")
                self.assertEqual(job["defaults"]["run"]["shell"], "bash")
                identities.add((job["env"]["ImageOS"], digest))
        self.assertEqual(
            len(identities),
            2,
            "the two manifests would claim independent environments with one image identity",
        )

    def test_builders_use_the_node_in_the_pinned_image(self) -> None:
        for name in ("app", "desktop-shell"):
            with self.subTest(name):
                job = self.jobs[name]
                actions = [str(step.get("uses", "")) for step in job["steps"]]
                self.assertFalse(
                    any(action.startswith("actions/setup-node@") for action in actions),
                    f"{name} replaces the digest-pinned image's Node after startup",
                )
                commands = "\n".join(step.get("run") or "" for step in job["steps"])
                self.assertIn("node --version", commands)
                self.assertIn(".nvmrc", commands)

    def test_environment_identity_is_recorded_before_mutable_package_installs(self) -> None:
        for name in ("app", "desktop-shell"):
            with self.subTest(name):
                commands = "\n".join(step.get("run") or "" for step in self.jobs[name]["steps"])
                manifest = commands.index("pnpm run release:manifest")
                apt = commands.index("apt-get update")
                self.assertLess(
                    manifest,
                    apt,
                    f"{name} mutates its pinned OCI environment before recording evidence",
                )

    def test_comparison_waits_for_and_downloads_both_image_builds(self) -> None:
        comparison = self.jobs["release-reproducibility"]
        self.assertEqual(sorted(comparison["needs"]), ["app", "desktop-shell"])
        uploads = {
            step["with"]["name"]
            for name in ("app", "desktop-shell")
            for step in self.jobs[name]["steps"]
            if str(step.get("uses", "")).startswith("actions/upload-artifact@")
        }
        downloads = {
            step["with"]["name"]
            for step in comparison["steps"]
            if str(step.get("uses", "")).startswith("actions/download-artifact@")
        }
        self.assertEqual(downloads, uploads)


if __name__ == "__main__":
    unittest.main()
