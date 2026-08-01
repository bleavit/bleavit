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


class CrossModuleConsistencyTests(unittest.TestCase):
    def test_every_duplicate_matches_after_exact_normalization(self):
        self.assertEqual(_inconsistent_groups(_documented_duplicates()), ())

    def test_mutation_control_detects_one_module_drift(self):
        groups = _documented_duplicates()
        groups["nav_floor.param"]["rollout"] += Decimal(1)
        self.assertEqual(_inconsistent_groups(groups), ("nav_floor.param",))
