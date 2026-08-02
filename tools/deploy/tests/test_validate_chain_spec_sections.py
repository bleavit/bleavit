"""`ALLOWED_GENESIS_SECTIONS` must track `construct_runtime!`, not the presets.

The allowlist in `validate-chain-spec.py` exists so an unrecognised genesis
section fails loudly rather than silently defaulting a real one. It was first
written from the sections the dev/local presets emit, which is a strict subset
of what `RuntimeGenesisConfig` accepts — so `welfare`, `oracle`, `guardian` and
`attestor` were missing. Only the B7 drill genesis sets one of them
(`guardian`), so no per-commit gate touched the gap; it surfaced only when the
drill pipeline was next run end to end, well after the allowlist shipped.

This test closes that class: it derives the expected set from the runtime itself
and fails when a `construct_runtime!` pallet declaring `#[pallet::genesis_config]`
is absent from the allowlist. Adding a genesis-bearing pallet therefore forces a
deliberate decision about its genesis section instead of a silent rejection
later.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
RUNTIME_LIB = ROOT / "runtime" / "bleavit-runtime" / "src" / "lib.rs"
VALIDATOR = ROOT / "tools" / "deploy" / "validate-chain-spec.py"


def _camel(name: str) -> str:
    """`construct_runtime!` field name -> serde genesis key (leading lowercase)."""
    return name[0].lower() + name[1:]


def _runtime_pallets() -> list[tuple[str, str]]:
    """(genesis section, crate) for each construct_runtime! entry."""
    text = RUNTIME_LIB.read_text(encoding="utf-8")
    block = re.search(
        r"construct_runtime!\s*\(\s*pub enum Runtime\s*\{(.*?)\n\s*\}\s*\)", text, re.S
    )
    assert block, "construct_runtime! block not found — this test needs updating"
    entries = re.findall(
        r"^\s*([A-Za-z0-9_]+)\s*:\s*([a-z0-9_]+)(?:::<[^>]*>)?\s*=\s*\d+",
        block.group(1),
        re.M,
    )
    return [(_camel(name), crate) for name, crate in entries]


def _declares_genesis(crate: str) -> bool:
    path = ROOT / "pallets" / crate.replace("pallet_", "").replace("_", "-") / "src" / "lib.rs"
    if not path.exists():  # stock FRAME pallet, not vendored here
        return False
    return "#[pallet::genesis_config]" in path.read_text(encoding="utf-8")


def _allowlist() -> set[str]:
    text = VALIDATOR.read_text(encoding="utf-8")
    block = re.search(
        r"ALLOWED_GENESIS_SECTIONS = frozenset\(\s*\{(.*?)\}\s*\)", text, re.S
    )
    assert block, "ALLOWED_GENESIS_SECTIONS not found in validate-chain-spec.py"
    return set(re.findall(r'"([A-Za-z0-9_]+)"', block.group(1)))


class AllowedGenesisSectionsTracksRuntime(unittest.TestCase):
    def test_every_genesis_bearing_pallet_is_allowlisted(self) -> None:
        allowed = _allowlist()
        missing = sorted(
            section
            for section, crate in _runtime_pallets()
            if _declares_genesis(crate) and section not in allowed
        )
        self.assertEqual(
            missing,
            [],
            "these construct_runtime! pallets declare a #[pallet::genesis_config] but are "
            "absent from ALLOWED_GENESIS_SECTIONS, so validate-chain-spec.py would reject a "
            f"legitimate genesis patch that sets them: {missing}",
        )

    def test_the_check_can_actually_see_pallets(self) -> None:
        """Anti-vacuity: a regex that silently matches nothing would pass above."""
        pallets = _runtime_pallets()
        self.assertGreater(len(pallets), 20, "construct_runtime! parse returned too few entries")
        with_genesis = [s for s, c in pallets if _declares_genesis(c)]
        self.assertIn("guardian", with_genesis, "expected pallet-guardian to declare genesis")
        self.assertIn("constitution", with_genesis)


if __name__ == "__main__":
    unittest.main()
