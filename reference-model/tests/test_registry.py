"""Executes 13 §1/§2's registry bounds and cross-key safety claims.

The suite grounds the model in both checked-in limit registries, then searches
the lawful value graph.  A published claim which the graph falsifies is pinned
as a queryable failed finding; tests never pretend the desired property holds.
"""

from dataclasses import replace
from decimal import Decimal
import json
from pathlib import Path
import re
import unittest

from bleavit_reference_model.registry import (
    ATTACK_COST_CEILINGS,
    CLASS_NAV_FLOORS_USDC,
    COUPLINGS,
    KERNEL_BOUNDED_KEYS,
    REGISTRY,
    U128_MAX,
    AmendmentClass,
    BindingSite,
    DeltaKind,
    MARKET_BEARING,
    ProposalClass,
    coupling_findings,
    disables_class,
    kernel_hygiene,
    kernel_orphans,
    lower_slew_bound_1e9,
    min_breaking_sequence,
    param_key_bytes,
    path_to_value,
    post_amendment_reverification,
    reserve_probe_runway,
    self_sealing_corners,
)


ROOT = Path(__file__).resolve().parents[2]


def _classified_entries() -> list[dict[str, object]]:
    """Parse the tiny registry.toml subset with Python 3.10's stdlib."""
    entries: list[dict[str, object]] = []
    current: dict[str, object] | None = None
    source = (ROOT / "tools/limit-coverage/registry.toml").read_text(
        encoding="utf-8"
    )
    for raw in source.splitlines():
        line = raw.strip()
        if line == "[[entry]]":
            if current is not None:
                entries.append(current)
            current = {}
            continue
        if current is None:
            continue
        key = re.fullmatch(r'key = "([^"]+)"', line)
        if key:
            current["key"] = key.group(1)
        elif line == "genesis = true":
            current["genesis"] = True
        elif line == "genesis = false":
            current["genesis"] = False
    if current is not None:
        entries.append(current)
    return entries


def _coupling(name: str):
    return next(coupling for coupling in COUPLINGS if coupling.name == name)


class RegistryGroundingTests(unittest.TestCase):
    """The executable table must not drift from either repository artifact."""

    def test_seeded_key_bytes_match_both_checked_in_artifacts(self):
        json_keys = json.loads(
            (ROOT / "tools/limit-coverage/genesis-keys.json").read_text(
                encoding="utf-8"
            )
        )
        entries = _classified_entries()
        classified_genesis = [
            entry["key"] for entry in entries if entry.get("genesis") is True
        ]

        model_bytes = {param_key_bytes(key) for key in REGISTRY}
        json_bytes = {param_key_bytes(key) for key in json_keys}
        classified_bytes = {param_key_bytes(key) for key in classified_genesis}
        self.assertEqual(len(entries), 194)
        self.assertEqual(len(json_keys), 107)
        self.assertEqual(len(classified_genesis), 107)
        self.assertEqual(len(model_bytes), 107)
        self.assertEqual(model_bytes, json_bytes)
        self.assertEqual(model_bytes, classified_bytes)

    def test_every_record_is_typed_bounded_and_canonically_encodable(self):
        self.assertEqual(
            {key for key, record in REGISTRY.items() if record.kernel_bounded},
            set(KERNEL_BOUNDED_KEYS),
        )
        for key, record in REGISTRY.items():
            with self.subTest(key=key):
                self.assertEqual(len(param_key_bytes(key)), 16)
                self.assertLessEqual(record.minimum, record.value)
                self.assertLessEqual(record.value, record.maximum)
                low, high = record.admissible_interval()
                self.assertLessEqual(record.minimum, low)
                self.assertLessEqual(low, record.value)
                self.assertLessEqual(record.value, high)
                self.assertLessEqual(high, record.maximum)

    def test_max_delta_rounding_is_exact_and_asymmetric_where_specified(self):
        window = REGISTRY["dec.window"]
        self.assertEqual(window.max_delta.kind, DeltaKind.PERCENT)
        self.assertEqual(window.admissible_interval(), (34_560, 51_840))

        prize = replace(
            REGISTRY["sec.prize.meta"],
            value=3,
            minimum=0,
            maximum=100,
        )
        self.assertEqual(prize.max_delta.kind, DeltaKind.FACTOR)
        # 02 §4: the factor lower edge is ceil(3/2), not floor(3/2).
        self.assertEqual(prize.admissible_interval(), (2, 6))

        p_max = REGISTRY["gate.p_max"]
        self.assertEqual(p_max.admissible_interval(), (40_000_000, 60_000_000))

    def test_missing_numeric_floor_resolves_only_to_the_stored_type_floor(self):
        p_max = REGISTRY["gate.p_max"]
        self.assertEqual(p_max.value, 50_000_000)
        self.assertEqual(p_max.minimum, 0)
        self.assertEqual(p_max.maximum, 100_000_000)
        self.assertEqual(p_max.cooldown_epochs, 4)
        self.assertEqual(p_max.amendment_class, AmendmentClass.META_VALUES)


class CouplingTests(unittest.TestCase):
    """13 rule 7's relations, searched over record-admissible amendments."""

    def test_every_coupling_holds_at_the_seeded_registry(self):
        values = {key: record.value for key, record in REGISTRY.items()}
        for coupling in COUPLINGS:
            with self.subTest(coupling=coupling.name):
                self.assertTrue(coupling.holds(values))

    def test_sq_547_one_step_breaks_are_not_all_boundary_screened(self):
        """SQ-547. Rule 7 says these relations bind at their consumer.

        Four sigma/delta rows and epsilon/p-max instead have no comparison at
        all.  The welfare identity reaches a hard consumer error, and three
        additional registry relations are likewise one-write breakable.  The
        failed findings below are the executable contradiction.
        """
        failures = {
            finding.coupling.name
            for finding in coupling_findings()
            if not finding.ok
        }
        self.assertEqual(
            failures,
            {
                "dec-sigma-param",
                "dec-sigma-trs",
                "dec-sigma-code",
                "dec-sigma-meta",
                "gate-epsilon",
                "welfare-weights",
                "treasury-proposal-30d",
                "treasury-30d-180d",
                "reserve-timeout-interval",
            },
        )
        for finding in coupling_findings():
            if finding.coupling.name in failures:
                self.assertTrue(finding.breakable_in_one)
                self.assertIsNot(
                    finding.coupling.binding_site,
                    BindingSite.BOUNDARY_SCREENED,
                )

    def test_boundary_screened_pairs_are_positive_controls(self):
        controls = {
            coupling.name
            for coupling in COUPLINGS
            if coupling.binding_site is BindingSite.BOUNDARY_SCREENED
        }
        self.assertEqual(
            controls,
            {
                "gate-v-min-param",
                "gate-v-min-trs",
                "gate-v-min-code",
                "gate-v-min-meta",
                "redemption-fee",
            },
        )
        for name in controls:
            with self.subTest(coupling=name):
                self.assertIsNotNone(min_breaking_sequence(_coupling(name)))
        self.assertEqual(
            min_breaking_sequence(_coupling("redemption-fee")).steps,
            1,
        )

    def test_consumer_errors_have_computed_shortest_paths(self):
        welfare = min_breaking_sequence(_coupling("welfare-weights"))
        survival = min_breaking_sequence(_coupling("survival-knees"))
        security = min_breaking_sequence(_coupling("security-knees"))
        self.assertEqual((welfare.steps, welfare.elapsed_epochs), (1, 4))
        self.assertEqual((survival.steps, survival.elapsed_epochs), (8, 16))
        self.assertEqual((security.steps, security.elapsed_epochs), (10, 20))


class AmendmentGraphTests(unittest.TestCase):
    """Shortest paths through the joint max-delta/cooldown graph."""

    def test_sq_548_trailing_can_reach_the_decision_window(self):
        """SQ-548. 05 §3.1 requires trailing to be a strict sub-window.

        The published ranges admit a three-amendment/four-epoch path to
        `trailing >= window`.  The test quantifies the ranges and path; it does
        not pin one faulty table cell to another.
        """
        coupling = _coupling("decision-trailing-window")
        breach = min_breaking_sequence(coupling)
        self.assertEqual((breach.steps, breach.elapsed_epochs), (3, 4))
        final = dict(breach.final_values)
        self.assertGreaterEqual(final["dec.trailing"], final["dec.window"])
        self.assertFalse(coupling.holds(final))

    def test_window_floor_path_reproduces_percent_rounding(self):
        path = path_to_value("dec.window", REGISTRY["dec.window"].minimum)
        self.assertEqual(
            [amendment.after for amendment in path],
            [34_560, 27_648, 22_119, 17_696, 14_400],
        )
        self.assertEqual(path[-1].epoch, 10)
        for amendment in path:
            self.assertTrue(
                REGISTRY["dec.window"].step_admissible(
                    amendment.before,
                    amendment.after,
                )
            )

    def test_trade_phase_relation_is_safe_over_the_full_registry_box(self):
        self.assertIsNone(
            min_breaking_sequence(_coupling("decision-window-trade-phase"))
        )


class SelfSealingTests(unittest.TestCase):
    """A class must retain a route to amend the key which disables it."""

    def test_sq_546_reachable_corners_disable_their_own_repair(self):
        """SQ-546. 13's rationale protects only the loosening direction.

        The graph finds three tightening/oversizing corners whose disabled set
        contains the proposal class which owns repair.  Pinning the exact set
        is a registry/consumer change detector, not a claim about predicates
        which the model has not encoded.
        """
        corners = {corner.key: corner for corner in self_sealing_corners()}
        self.assertEqual(
            set(corners),
            {"dec.window", "gate.p_max", "sec.prize.meta"},
        )
        expected = {
            "dec.window": (14_400, 5, 10, "down"),
            "gate.p_max": (0, 5, 20, "down"),
            "sec.prize.meta": (1_200_000 * 1_000_000, 1, 2, "up"),
        }
        for key, (value, steps, epochs, direction) in expected.items():
            with self.subTest(key=key):
                corner = corners[key]
                self.assertEqual(
                    (
                        corner.value,
                        len(corner.amendments),
                        corner.elapsed_epochs,
                        corner.unsafe_direction,
                    ),
                    (value, steps, epochs, direction),
                )
                self.assertIn(corner.repair_class, corner.disabled_classes)
                self.assertFalse(corner.ok)

    def test_zero_p_max_has_no_finite_price_escape_on_the_recorded_grid(self):
        # A full default decision window contains 4,320 observation intervals.
        # Even the widest exact inward-rounded lower bound is one raw unit;
        # once there, every later positive interval remains at one, never zero.
        self.assertEqual(
            lower_slew_bound_1e9(500_000_000, 5_000_000, 4_320),
            1,
        )
        self.assertEqual(lower_slew_bound_1e9(1, 5_000_000, 4_320), 1)
        self.assertGreater(1, REGISTRY["gate.p_max"].minimum)
        self.assertEqual(disables_class("gate.p_max", 0), MARKET_BEARING)

    def test_meta_security_prize_outgrows_the_floor_nav_seed_budget(self):
        self.assertEqual(
            CLASS_NAV_FLOORS_USDC,
            {
                ProposalClass.PARAM: Decimal("4620989"),
                ProposalClass.TREASURY: Decimal("7393600"),
                ProposalClass.CODE: Decimal("13862944"),
                ProposalClass.META: Decimal("21256533"),
            },
        )
        ceiling = ATTACK_COST_CEILINGS[ProposalClass.META]
        self.assertEqual(ceiling.minimum_viable_nav, Decimal("21256533"))
        self.assertEqual(ceiling.max_seedable_prize, Decimal("669315.422810"))
        self.assertEqual(ceiling.attack_cost, Decimal("5007949.427282"))
        self.assertLess(Decimal(600_000), ceiling.max_seedable_prize)
        self.assertGreater(Decimal(1_200_000), ceiling.max_seedable_prize)
        # At cap-saturating organic depth step 9 itself could clear 1.2M; the
        # tighter failure is earlier, because Ask-scaled b cannot reach Seed.
        self.assertLessEqual(Decimal(3) * Decimal(1_200_000), ceiling.attack_cost)
        self.assertEqual(
            disables_class("sec.prize.meta", 1_200_000 * 1_000_000),
            frozenset({ProposalClass.META}),
        )

    def test_constitutional_repair_is_not_misreported_as_market_disabled(self):
        # One welfare-weight amendment invalidates every market consumer, but
        # its CONST repair projects to market-less Constitutional governance.
        disabled = disables_class("welfare.wP", 650_000_000)
        self.assertEqual(disabled, MARKET_BEARING)
        self.assertNotIn(ProposalClass.CONSTITUTIONAL, disabled)


class PostAmendmentReverificationTests(unittest.TestCase):
    """07 §8 first-arm resource checks versus later live Params changes."""

    def test_every_first_arm_only_resource_input_is_reported(self):
        findings = post_amendment_reverification()
        self.assertEqual(
            {finding.key for finding in findings},
            {
                "ops.probe_fee",
                "ops.probe_rate",
                "res.fail_thr",
                "res.probe_amount",
                "res.recover_thr",
            },
        )
        for finding in findings:
            with self.subTest(key=finding.key):
                self.assertFalse(finding.ok)
                self.assertTrue(
                    REGISTRY[finding.key].step_admissible(
                        finding.before,
                        finding.reachable_after_one,
                    )
                )

    def test_one_step_runway_increases_are_derived_in_micro_usdc(self):
        findings = {
            finding.key: finding for finding in post_amendment_reverification()
        }
        self.assertEqual(reserve_probe_runway(), 12_500_000)
        self.assertEqual(findings["ops.probe_fee"].requirement_after, 25_000_000)
        self.assertEqual(findings["ops.probe_rate"].requirement_after, 25_000_000)
        self.assertEqual(findings["res.fail_thr"].requirement_after, 645_000_000)
        self.assertEqual(
            findings["res.recover_thr"].requirement_after,
            642_500_000,
        )
        self.assertEqual(
            findings["res.probe_amount"].reachable_after_one,
            U128_MAX,
        )


class KernelHygieneTests(unittest.TestCase):
    """13 §2 symbols must be live in code or projected through metadata."""

    @classmethod
    def setUpClass(cls):
        cls.findings = kernel_hygiene(ROOT)

    def test_every_modelled_kernel_symbol_resolves_to_a_declaration(self):
        self.assertTrue(self.findings)
        self.assertEqual(
            [finding.constant.symbol for finding in self.findings if not finding.declared],
            [],
        )

    def test_quote_clamps_are_the_only_consumption_or_projection_orphans(self):
        orphans = kernel_orphans(ROOT)
        self.assertEqual(
            {finding.constant.symbol for finding in orphans},
            {"QUOTE_CLAMP_MIN_1E9", "QUOTE_CLAMP_MAX_1E9"},
        )
        for finding in orphans:
            self.assertFalse(finding.consumed)
            self.assertFalse(finding.projected)
            self.assertFalse(finding.ok)

    def test_lmsr_domain_bound_is_consumed_even_though_its_quote_clamps_are_not(self):
        domain = next(
            finding
            for finding in self.findings
            if finding.constant.symbol == "LMSR_DOMAIN_BOUND"
        )
        self.assertTrue(domain.consumed)
        self.assertTrue(domain.ok)


if __name__ == "__main__":
    unittest.main()
