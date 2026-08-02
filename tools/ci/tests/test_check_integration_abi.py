from __future__ import annotations

import importlib.util
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "tools" / "ci" / "check-integration-abi.py"
SPEC = importlib.util.spec_from_file_location("check_integration_abi", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
checker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(checker)


ABI = """
pub const QUESTION_SERVICE_PALLET_INDEX: u8 = 66;
pub const REGISTER_QUESTION_CALL_INDEX: u8 = 0;
pub const BOND_ATTESTOR_CALL_INDEX: u8 = 1;
pub const OPEN_QUESTION_CALL_INDEX: u8 = 2;
pub const SEAL_QUESTION_CALL_INDEX: u8 = 3;
pub const SUBMIT_ATTESTATION_CALL_INDEX: u8 = 4;
pub const SETTLE_QUESTION_CALL_INDEX: u8 = 5;
pub const CLIENT_RECEIVER_PALLET_INDEX: u8 = 66;
pub const RECEIVE_REPORT_CALL_INDEX: u8 = 0;
"""

PRIMITIVES = """
pub const MAX_SERVICE_ATTESTORS: u32 = 16;
pub const ASSET_HUB_PARA_ID: u32 = 1000;
pub const USDC_PALLET_INSTANCE: u8 = 50;
pub const USDC_ASSET_INDEX: u128 = 1337;
"""

DOC = """# Integrating over XCM alone

`QuestionService` sits at pallet index 66, frozen.

| Call | Index | Reachable over XCM? | Arguments |
|---|---|---|---|
| `register` | 0 | **yes** | `RegisterInput` |
| `bond_attestor` | 1 | no — local signed | `u64` |
| `open` | 2 | **yes** | `u64` |
| `seal` | 3 | **yes** | `u64` |
| `submit_attestation` | 4 | no — local signed | `(u64, FixedU64)` |
| `settle` | 5 | no — local signed | `u64` |

{ parents: 1, interior: X3(Parachain(1000), PalletInstance(50), GeneralIndex(1337)) }

The push arrives as `[66, 0] ++ SCALE(ReportView)`.

| `attestors` | `BoundedVec<[u8; 32], 16>` | at least 3 |
"""


class IntegrationAbiBindingTests(unittest.TestCase):
    def make_root(self, doc: str = DOC, abi: str = ABI) -> Path:
        root = Path(tempfile.mkdtemp())
        (root / "docs" / "integration").mkdir(parents=True)
        (root / "crates" / "bleavit-client-abi" / "src").mkdir(parents=True)
        (root / "crates" / "futarchy-primitives" / "src").mkdir(parents=True)
        (root / checker.DOC).write_text(doc, encoding="utf-8")
        (root / checker.ABI).write_text(abi, encoding="utf-8")
        (root / checker.PRIMITIVES).write_text(PRIMITIVES, encoding="utf-8")
        return root

    def test_agreeing_doc_and_abi_pass(self) -> None:
        self.assertEqual(checker.validate(self.make_root()), [])

    def test_committed_tree_is_green(self) -> None:
        self.assertEqual(checker.validate(ROOT), [])

    def test_renumbered_call_is_caught(self) -> None:
        root = self.make_root(abi=ABI.replace("SEAL_QUESTION_CALL_INDEX: u8 = 3", "SEAL_QUESTION_CALL_INDEX: u8 = 9"))
        failures = checker.validate(root)
        self.assertTrue(any("`seal` is documented as index 3" in f for f in failures), failures)

    def test_call_documented_but_absent_from_the_abi_is_caught(self) -> None:
        root = self.make_root(doc=DOC.replace("| `settle` | 5 |", "| `resolve` | 5 |"))
        failures = checker.validate(root)
        self.assertTrue(any("not a frozen selector" in f for f in failures), failures)
        # The reverse direction must fire too: `settle` no longer has a row.
        self.assertTrue(any("no table row documents `settle`" in f for f in failures), failures)

    def test_advertising_a_signed_only_call_as_xcm_reachable_is_caught(self) -> None:
        # A doc that sends integrators to a call the ExternalClient filter always
        # refuses is worse than one that omits it.
        root = self.make_root(doc=DOC.replace("| `settle` | 5 | no — local signed |", "| `settle` | 5 | **yes** |"))
        failures = checker.validate(root)
        self.assertTrue(any("XCM-reachability" in f for f in failures), failures)

    def test_hiding_an_xcm_reachable_call_is_caught(self) -> None:
        root = self.make_root(doc=DOC.replace("| `open` | 2 | **yes** |", "| `open` | 2 | no — local signed |"))
        failures = checker.validate(root)
        self.assertTrue(any("XCM-reachability" in f for f in failures), failures)

    def test_stale_usdc_location_is_caught(self) -> None:
        root = self.make_root(doc=DOC.replace("GeneralIndex(1337)", "GeneralIndex(1338)"))
        failures = checker.validate(root)
        self.assertTrue(any("USDC location" in f for f in failures), failures)

    def test_stale_attestor_bound_is_caught(self) -> None:
        root = self.make_root(doc=DOC.replace("BoundedVec<[u8; 32], 16>", "BoundedVec<[u8; 32], 32>"))
        failures = checker.validate(root)
        self.assertTrue(any("attestor bound" in f for f in failures), failures)

    def test_stale_push_selector_is_caught(self) -> None:
        root = self.make_root(abi=ABI.replace("RECEIVE_REPORT_CALL_INDEX: u8 = 0", "RECEIVE_REPORT_CALL_INDEX: u8 = 1"))
        failures = checker.validate(root)
        self.assertTrue(any("push selector" in f for f in failures), failures)

    def test_stale_pallet_index_is_caught(self) -> None:
        root = self.make_root(abi=ABI.replace("QUESTION_SERVICE_PALLET_INDEX: u8 = 66", "QUESTION_SERVICE_PALLET_INDEX: u8 = 68"))
        failures = checker.validate(root)
        self.assertTrue(any("pallet index 68" in f for f in failures), failures)

    def test_missing_abi_constant_is_reported_not_silently_skipped(self) -> None:
        root = self.make_root(abi=ABI.replace("pub const OPEN_QUESTION_CALL_INDEX: u8 = 2;\n", ""))
        failures = checker.validate(root)
        self.assertTrue(any("OPEN_QUESTION_CALL_INDEX is absent" in f for f in failures), failures)


if __name__ == "__main__":
    unittest.main()
