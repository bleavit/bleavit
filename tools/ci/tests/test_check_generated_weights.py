import importlib.util
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "tools" / "ci" / "check-generated-weights.py"
SPEC = importlib.util.spec_from_file_location("check_generated_weights", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)

MEASURED = """
// Generated fixture.
pub struct WeightInfo<T>(PhantomData<T>);
impl<T: frame_system::Config> pallet_example::WeightInfo for WeightInfo<T> {
\tfn measured() -> Weight {
\t\t// Minimum execution time: 1_000_000 picoseconds.
\t\tWeight::from_parts(1_100_000, 0)
\t}
}
"""

HAND_WRITTEN = """
pub struct WeightInfo<T>(PhantomData<T>);
impl<T: frame_system::Config> pallet_example::WeightInfo for WeightInfo<T> {
\tfn spliced() -> Weight {
\t\t// Hand-written because no fixture exercises it.
\t\tWeight::from_parts(1_800_000_000, 0)
\t}
}
"""


class ScanTests(unittest.TestCase):
    def scan(self, **files: str) -> dict:
        with tempfile.TemporaryDirectory() as raw:
            directory = Path(raw)
            for name, body in files.items():
                (directory / name).write_text(body, encoding="utf-8")
            return MODULE.scan(directory)

    def test_measured_function_is_recognized(self):
        found = self.scan(**{"pallet_a.rs": MEASURED})
        self.assertEqual(list(found.values()), [True])
        self.assertTrue(any(key[1] == "measured" for key in found))

    def test_hand_written_function_is_flagged(self):
        found = self.scan(**{"pallet_b.rs": HAND_WRITTEN})
        self.assertEqual(list(found.values()), [False])

    def test_mod_rs_is_ignored(self):
        self.assertEqual(self.scan(**{"mod.rs": HAND_WRITTEN}), {})


class EvaluateTests(unittest.TestCase):
    def test_unannotated_hand_written_weight_fails(self):
        found = {("w/pallet_b.rs", "spliced"): False}
        unannotated, stale, total = MODULE.evaluate(found, {})
        self.assertEqual(unannotated, ["w/pallet_b.rs::spliced"])
        self.assertEqual(stale, [])
        self.assertEqual(total, 1)

    def test_justified_override_passes(self):
        found = {("w/pallet_b.rs", "spliced"): False}
        overrides = {("w/pallet_b.rs", "spliced"): "fail-closed sentinel"}
        unannotated, stale, _ = MODULE.evaluate(found, overrides)
        self.assertEqual(unannotated, [])
        self.assertEqual(stale, [])

    def test_override_expires_once_the_function_is_measured(self):
        found = {("w/pallet_b.rs", "spliced"): True}
        overrides = {("w/pallet_b.rs", "spliced"): "fail-closed sentinel"}
        _, stale, _ = MODULE.evaluate(found, overrides)
        self.assertEqual(stale, ["w/pallet_b.rs::spliced (now carries a measured value)"])

    def test_override_expires_once_the_function_disappears(self):
        overrides = {("w/pallet_b.rs", "gone"): "fail-closed sentinel"}
        _, stale, _ = MODULE.evaluate({}, overrides)
        self.assertEqual(stale, ["w/pallet_b.rs::gone (function no longer present)"])


class OverrideFileTests(unittest.TestCase):
    def load(self, body: str) -> dict:
        with tempfile.TemporaryDirectory() as raw:
            path = Path(raw) / "overrides.toml"
            path.write_text(body, encoding="utf-8")
            return MODULE.load_overrides(path)

    def test_comments_and_blank_lines_are_skipped(self):
        self.assertEqual(self.load("# note\n\n"), {})

    def test_entry_is_parsed(self):
        parsed = self.load("w/pallet_b.rs spliced: because reasons\n")
        self.assertEqual(parsed, {("w/pallet_b.rs", "spliced"): "because reasons"})

    def test_missing_justification_is_rejected(self):
        with self.assertRaises(MODULE.CheckError):
            self.load("w/pallet_b.rs spliced:\n")

    def test_duplicate_entry_is_rejected(self):
        with self.assertRaises(MODULE.CheckError):
            self.load("w/a.rs f: one\nw/a.rs f: two\n")


class RepositoryTests(unittest.TestCase):
    def test_repository_state_passes_the_gate(self):
        found = MODULE.scan()
        overrides = MODULE.load_overrides()
        unannotated, stale, total = MODULE.evaluate(found, overrides)
        self.assertEqual(unannotated, [], "hand-written weights in generated files")
        self.assertEqual(stale, [], "stale generated-weight overrides")
        self.assertGreater(total, 0)

    def test_every_override_names_its_reason(self):
        for key, justification in MODULE.load_overrides().items():
            self.assertGreater(len(justification), 20, key)


if __name__ == "__main__":
    unittest.main()
