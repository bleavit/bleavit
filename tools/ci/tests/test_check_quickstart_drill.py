from __future__ import annotations

import importlib.util
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "tools" / "ci" / "check-quickstart-drill.py"
SPEC = importlib.util.spec_from_file_location("check_quickstart_drill", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
checker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(checker)


SOURCE = "module.exports = { run() {} };\n"
DOC_TEMPLATE = (
    "# Quickstart\n\n"
    f"{checker.BEGIN}\n"
    "```javascript\n"
    f"{SOURCE}"
    "```\n"
    f"{checker.END}\n"
)
DRILL = 'client-collator-1: js-script ./js/client-quickstart.js with "register" within 300 seconds\n'


class QuickstartDrillBindingTests(unittest.TestCase):
    def make_root(self) -> Path:
        root = Path(tempfile.mkdtemp())
        (root / "docs" / "integration").mkdir(parents=True)
        (root / "zombienet" / "drills" / "js").mkdir(parents=True)
        (root / "docs" / "integration" / "quickstart.md").write_text(
            DOC_TEMPLATE, encoding="utf-8"
        )
        (root / "zombienet" / "drills" / "js" / "client-quickstart.js").write_text(
            SOURCE, encoding="utf-8"
        )
        (root / "zombienet" / "drills" / "10-client-integration.zndsl").write_text(
            DRILL, encoding="utf-8"
        )
        return root

    def test_matching_source_and_drill_pass(self) -> None:
        root = self.make_root()
        self.assertEqual(checker.validate(root, "node"), [])

    def test_source_drift_fails(self) -> None:
        root = self.make_root()
        (root / "zombienet" / "drills" / "js" / "client-quickstart.js").write_text(
            "module.exports = { run() { throw new Error('drift'); } };\n", encoding="utf-8"
        )
        failures = checker.validate(root, "node")
        self.assertTrue(any("differs" in failure for failure in failures), failures)

    def test_missing_drill_reference_fails(self) -> None:
        root = self.make_root()
        (root / "zombienet" / "drills" / "10-client-integration.zndsl").write_text(
            "Description: no helper\n", encoding="utf-8"
        )
        failures = checker.validate(root, "node")
        self.assertTrue(any("does not execute" in failure for failure in failures), failures)
