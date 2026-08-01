"""Cross-module guards for normative values shared by executable-spec modules.

The reference model is derived from architecture text, never from Rust artifacts.
When more than one model module consumes the same documented quantity, this suite
keeps those independent representations bound even when their exact Python types or
units differ.
"""

from decimal import Decimal
from fractions import Fraction
import unittest

from bleavit_reference_model import (
    disputes,
    frontend_budget,
    guardians,
    lifecycle,
    occupancy,
    oracle,
    pillars,
    registry,
    rollout,
    slate,
    spec_values,
    sustainability,
    threat_costs,
)


Exact = Decimal | Fraction | int


def _exact_fraction(value: Exact) -> Fraction:
    """Normalize exact numeric representations without passing through float."""
    return Fraction(value)


def _inconsistent_groups(
    groups: dict[str, dict[str, Exact]],
) -> tuple[str, ...]:
    """Return stable names for quantities whose module representations drift."""
    return tuple(
        name
        for name, definitions in groups.items()
        if len({_exact_fraction(value) for value in definitions.values()}) != 1
    )


def _documented_duplicates() -> dict[str, dict[str, Exact]]:
    """Collect every executable copy of the reviewed 08/13 normative values."""
    epoch = registry.REGISTRY["epoch.length"]
    nav_sources = {
        "sustainability": {
            "param": sustainability.NAV_FLOOR_PARAM,
            "treasury": sustainability.NAV_FLOOR_TREASURY,
            "code": sustainability.NAV_FLOOR_CODE,
            "meta": sustainability.NAV_FLOOR_META,
        },
        "slate": slate.NAV_FLOORS,
        "rollout": rollout.NAV_FLOORS,
        "registry": {
            "param": registry.CLASS_NAV_FLOORS_USDC[registry.ProposalClass.PARAM],
            "treasury": registry.CLASS_NAV_FLOORS_USDC[
                registry.ProposalClass.TREASURY
            ],
            "code": registry.CLASS_NAV_FLOORS_USDC[registry.ProposalClass.CODE],
            "meta": registry.CLASS_NAV_FLOORS_USDC[registry.ProposalClass.META],
        },
        "spec_values": spec_values.NAV_FLOORS_USDC,
    }
    groups = {
        f"nav_floor.{proposal_class}": {
            module: floors[proposal_class] for module, floors in nav_sources.items()
        }
        for proposal_class in ("param", "treasury", "code", "meta")
    }
    groups.update(
        {
            "epoch.length.default_blocks": {
                "registry": epoch.value,
                "lifecycle": lifecycle.EPOCH_LENGTH_DEFAULT,
                "disputes": disputes.EPOCH_LENGTH_DEFAULT,
                "occupancy.registry": occupancy.GENESIS.epoch_length,
                "occupancy.in_flight": (
                    occupancy.GENESIS_IN_FLIGHT.longest_length_in_force
                ),
                "sustainability": sustainability.EPOCH_LENGTH_BLOCKS,
                "oracle": oracle.EPOCH_LENGTH_BLOCKS,
                "pillars": pillars.EPOCH_LENGTH_BLOCKS,
                "guardians": guardians.EPOCH_LENGTH_DAYS_DEFAULT
                * lifecycle.BLOCKS_PER_DAY,
                "spec_values": spec_values.EPOCH_LENGTH_DEFAULT,
            },
            "epoch.length.minimum_blocks": {
                "registry": epoch.minimum,
                "lifecycle": lifecycle.EPOCH_LENGTH_MIN,
                "disputes": disputes.EPOCH_LENGTH_MIN,
                "occupancy": occupancy.BOUNDS["epoch.length"].minimum,
                "guardians": guardians.EPOCH_LENGTH_DAYS_MIN
                * lifecycle.BLOCKS_PER_DAY,
                "spec_values": spec_values.EPOCH_LENGTH_MIN,
            },
            "epoch.length.maximum_blocks": {
                "registry": epoch.maximum,
                "lifecycle": lifecycle.EPOCH_LENGTH_MAX,
                "disputes": disputes.EPOCH_LENGTH_MAX,
                "occupancy": occupancy.BOUNDS["epoch.length"].maximum,
                "guardians": guardians.EPOCH_LENGTH_DAYS_MAX
                * lifecycle.BLOCKS_PER_DAY,
                "spec_values": spec_values.EPOCH_LENGTH_MAX,
            },
            "epoch.length.max_delta": {
                "registry": Fraction(epoch.max_delta.amount, 100),
                "disputes": disputes.EPOCH_LENGTH_MAX_DELTA,
                "occupancy": occupancy.BOUNDS[
                    "epoch.length"
                ].max_delta_fraction,
                "spec_values": spec_values.EPOCH_LENGTH_MAX_DELTA,
            },
            "fee.vit_usdc_rate.reference": {
                "sustainability": sustainability.FEE_VIT_USDC_RATE_REF,
                "threat_costs": threat_costs.FEE_VIT_USDC_RATE_REF,
                "guardians": guardians.VIT_USDC_RATE_REF,
                "spec_values": spec_values.FEE_VIT_USDC_RATE_REF,
            },
            "fee.vit_usdc_rate.minimum": {
                "sustainability": sustainability.FEE_VIT_USDC_RATE_MIN,
                "threat_costs": threat_costs.FEE_VIT_USDC_RATE_MIN,
                "guardians": guardians.VIT_USDC_RATE_MIN,
                "spec_values": spec_values.FEE_VIT_USDC_RATE_MIN,
            },
            "fee.vit_usdc_rate.maximum": {
                "sustainability": sustainability.FEE_VIT_USDC_RATE_MAX,
                "threat_costs": threat_costs.FEE_VIT_USDC_RATE_MAX,
                "guardians": guardians.VIT_USDC_RATE_MAX,
                "spec_values": spec_values.FEE_VIT_USDC_RATE_MAX,
            },
            "rocksdb.read_ref_time": {
                "sustainability": sustainability.ROCKS_DB_READ_REF_TIME_PS,
                "threat_costs": threat_costs.ROCKSDB_READ_REF_TIME,
                "frontend_budget": frontend_budget.ROCKSDB_READ_REF_TIME,
            },
            "rocksdb.write_ref_time": {
                "sustainability": sustainability.ROCKS_DB_WRITE_REF_TIME_PS,
                "threat_costs": threat_costs.ROCKSDB_WRITE_REF_TIME,
                "frontend_budget": frontend_budget.ROCKSDB_WRITE_REF_TIME,
            },
        }
    )
    return groups


# ---------------------------------------------------------------------------
# Non-vacuity, and why it needs its own guard.
#
# Once a value is routed through :mod:`spec_values`, every consumer holds the
# SAME OBJECT, so comparing those consumers to each other compares an object
# with itself and can never fail. That is the correct outcome for a value with
# one home -- but it silently converts a consistency check into decoration, and
# a reader cannot tell the two apart by looking at a green suite. So the groups
# are classified here, and each class gets the assertion that can actually fail
# for it:
#
#   * SINGLE-HOMED -- every consumer imports the one definition. Module-vs-module
#     agreement is vacuous by construction; the falsifiable check is the
#     definition against the OWNING DOCUMENT, which is what
#     `DocumentGroundingTests` does.
#   * DUPLICATED -- at least two modules state the quantity independently
#     (`threat_costs`, `guardians`, `occupancy`, `pillars`, `oracle` and
#     `frontend_budget` deliberately keep their own). Module-vs-module agreement
#     is the real check, and it must stay non-vacuous.
SINGLE_HOMED = frozenset(
    {
        "nav_floor.param",
        "nav_floor.treasury",
        "nav_floor.code",
        "nav_floor.meta",
    }
)


def _distinct_objects(definitions: dict[str, Exact]) -> int:
    """How many genuinely separate objects a group holds (identity, not value)."""
    return len({id(value) for value in definitions.values()})


class CrossModuleConsistencyTests(unittest.TestCase):
    def test_every_duplicate_matches_after_exact_normalization(self):
        self.assertEqual(_inconsistent_groups(_documented_duplicates()), ())

    def test_no_duplicated_group_has_quietly_become_vacuous(self):
        """A group outside SINGLE_HOMED must hold >= 2 independent statements.

        Without this, routing one more module through `spec_values` would turn a
        real check green-forever without changing a single assertion.
        """
        for name, definitions in _documented_duplicates().items():
            if name in SINGLE_HOMED:
                continue
            with self.subTest(group=name):
                self.assertGreaterEqual(
                    _distinct_objects(definitions),
                    2,
                    f"{name} now shares one object across all consumers -- either "
                    f"add it to SINGLE_HOMED and ground it against the document, "
                    f"or restore an independent statement",
                )

    def test_single_homed_groups_really_are_single_homed(self):
        """The allowlist must describe reality, not excuse a drifted group."""
        for name in SINGLE_HOMED:
            with self.subTest(group=name):
                self.assertEqual(_distinct_objects(_documented_duplicates()[name]), 1)

    def test_mutation_control_patches_a_module_not_the_collected_dict(self):
        """Perturb a module attribute and re-collect, so the WIRING is tested.

        Mutating the returned dict only proves `_inconsistent_groups` compares;
        it says nothing about whether the collector reads the module at all.
        """
        original = guardians.VIT_USDC_RATE_REF
        try:
            guardians.VIT_USDC_RATE_REF = _exact_fraction(original) + Fraction(
                1, 1000
            )
            self.assertIn(
                "fee.vit_usdc_rate.reference",
                _inconsistent_groups(_documented_duplicates()),
            )
        finally:
            guardians.VIT_USDC_RATE_REF = original
        self.assertEqual(_inconsistent_groups(_documented_duplicates()), ())


class DocumentGroundingTests(unittest.TestCase):
    """Single-homed values are checked against the document, not each other."""

    def test_nav_floors_match_the_08_section_4_1_table(self):
        from pathlib import Path
        import re

        doc = (
            Path(__file__).resolve().parents[2]
            / "docs/architecture/08-treasury-and-economics.md"
        ).read_text(encoding="utf-8")
        published = {
            label.lower(): Decimal(figure.replace(",", ""))
            for label, figure in re.findall(
                r"\|\s*1 x (PARAM|TREASURY|CODE|META)[^|]*\|[^|]*\|\s*\*\*~?([\d,]+)\*\*",
                doc.replace("\u00d7", "x"),
            )
        }
        self.assertEqual(
            set(published), {"param", "treasury", "code", "meta"}, published
        )
        for proposal_class, figure in sorted(published.items()):
            with self.subTest(cls=proposal_class):
                self.assertEqual(
                    Fraction(spec_values.NAV_FLOORS_USDC[proposal_class]),
                    Fraction(figure),
                )
