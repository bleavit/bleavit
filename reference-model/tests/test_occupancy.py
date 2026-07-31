"""Pins 13 §5's derived-value cross-checks and searches its admission screen.

13 §5 states four "normative derivations" and a screen that defends them, with
two worked laundering cases and one claim about *every* lawful amendment
sequence: "enumerating transitions closes instances while composing against
reality closes the class." This suite pins the derivations, reproduces both
worked cases, and searches the claim rather than restating it.
"""

import unittest
from fractions import Fraction

from bleavit_reference_model.occupancy import (
    BOUNDS,
    FROZEN,
    GENESIS,
    GENESIS_IN_FLIGHT,
    MARKET_ROW_BYTES,
    MAX_STORED_MARKETS,
    OCCUPANCY_KEYS,
    VAULT_ROW_BYTES_PINNED,
    DerivationRefused,
    Envelopes,
    InFlight,
    Registry,
    books,
    ceil_div,
    compose,
    derive,
    item1_compiled_max,
    item1_reachable_max,
    item1_stored_markets,
    item2_vaults,
    item3_reap_cells,
    item4_decision_critical,
    item4_full_window,
    reachable_slots_max,
    real_load,
    screen,
    search_breach,
    trade_phase_blocks,
)


class TestFrozenFigures(unittest.TestCase):
    """13 §5 items 1–4 at the genesis registry."""

    def test_genesis_sits_exactly_on_three_of_the_four_figures(self):
        # 13 §5 consequence (b): "The genesis registry sits exactly on three of
        # the four figures (52 vaults, 133,920 and 580,320 observations)".
        envelopes = derive(GENESIS)
        self.assertEqual(envelopes.vaults, 52)
        self.assertEqual(envelopes.decision_critical_obs, 133_920)
        self.assertEqual(envelopes.full_window_obs, 580_320)
        # Item 1 is the fourth, and genesis is far below it — the envelope is a
        # conservative archive bound, not an occupancy measurement.
        self.assertEqual(envelopes.stored_markets, 785)
        self.assertLess(envelopes.stored_markets, MAX_STORED_MARKETS)

    def test_genesis_breaches_nothing(self):
        self.assertEqual(derive(GENESIS).exceeds(FROZEN), ())

    def test_item1_at_compiled_bounds_is_2240(self):
        # 13 §5: "196 + 28·73 = 2,240 dominates every reachable history".
        self.assertEqual(item1_compiled_max(), MAX_STORED_MARKETS)
        self.assertEqual(books(BOUNDS["epoch.slots"].maximum), 73)
        batches = ceil_div(
            BOUNDS["ledger.archive"].maximum, BOUNDS["epoch.length"].minimum
        ) + 1
        self.assertEqual(batches, 28)
        self.assertEqual(196 + 28 * 73, MAX_STORED_MARKETS)

    def test_item1_byte_budget(self):
        # 2,240 × 205 B = 459,200 B ≈ 448.4 KiB, within the 512 KiB budget.
        self.assertEqual(MAX_STORED_MARKETS * MARKET_ROW_BYTES, 459_200)
        self.assertAlmostEqual(459_200 / 1024, 448.4, places=1)
        self.assertLess(459_200, FROZEN.stored_market_bytes)

    def test_item2_vaults_and_pinned_byte_budget(self):
        # "≤ 32 live + 4 cohorts × 5 settling = ≤ 52", budgeted at the **pinned**
        # 256 B rather than the measured 160 B.
        self.assertEqual(item2_vaults(5), 52)
        self.assertEqual(52 * VAULT_ROW_BYTES_PINNED, 13_312)
        self.assertEqual(FROZEN.vault_bytes, 13 * 1024)
        self.assertEqual(52 * VAULT_ROW_BYTES_PINNED, FROZEN.vault_bytes)

    def test_item3_is_key_independent(self):
        # 13 §5's table: "none — no §1 key moves item 3".
        self.assertEqual(item3_reap_cells(), 28)
        for key in OCCUPANCY_KEYS:
            bound = BOUNDS[key]
            for value in (bound.minimum, bound.maximum):
                registry = GENESIS.with_key(key, value)
                if key == "epoch.length":
                    continue  # exercised separately; must be a multiple of 21
                self.assertEqual(derive(registry).reap_cells, 28)

    def test_item4_both_legs(self):
        # 31 trading books × (43,200/10) = 133,920 decision-critical;
        # × (187,200/10) = 580,320 full-window.
        self.assertEqual(books(5), 31)
        self.assertEqual(ceil_div(43_200, 10), 4_320)
        self.assertEqual(31 * 4_320, 133_920)
        self.assertEqual(trade_phase_blocks(302_400), 187_200)
        self.assertEqual(31 * ceil_div(187_200, 10), 580_320)
        self.assertEqual(item4_decision_critical(GENESIS), 133_920)
        self.assertEqual(item4_full_window(GENESIS), 580_320)

    def test_trade_phase_is_thirteen_twentyfirsts(self):
        self.assertEqual(
            Fraction(trade_phase_blocks(302_400), 302_400), Fraction(13, 21)
        )
        self.assertEqual(trade_phase_blocks(302_400) / 14_400, 13.0)

    def test_every_division_rounds_up(self):
        # 13 §5: "Every division rounds up, so the error direction is against
        # the proposal (R-7)."
        self.assertEqual(ceil_div(43_200, 9), 4_800)
        self.assertEqual(ceil_div(51_840, 11), 4_713)  # 4712.7…
        self.assertEqual(ceil_div(1, 10), 1)

    def test_unreadable_or_zero_inputs_refuse_rather_than_pass(self):
        # G-1: a refusal, never "no envelope was breached".
        with self.assertRaises(DerivationRefused):
            item4_decision_critical(GENESIS.with_key("mkt.obs_interval", 0))
        with self.assertRaises(DerivationRefused):
            item1_stored_markets(GENESIS.with_key("epoch.length", 0))
        with self.assertRaises(DerivationRefused):
            compose(GENESIS, InFlight(longest_length_in_force=0))

    def test_epoch_length_must_keep_phase_boundaries_exact(self):
        # 05 §3.1: a multiple of 21 blocks "so all phase boundaries are exact".
        with self.assertRaises(DerivationRefused):
            trade_phase_blocks(302_401)


class TestReachability(unittest.TestCase):
    """What the screen admits, as against what 13 §1's ranges advertise."""

    def test_epoch_slots_cannot_exceed_five(self):
        # 13 §5: "the screen refuses every raise above 5". The row publishes
        # [1, 12]; item 2 caps it at the genesis default, so seven of the
        # twelve values are nominal.
        self.assertEqual(reachable_slots_max(), 5)
        self.assertEqual(BOUNDS["epoch.slots"].maximum, 12)
        self.assertGreater(item2_vaults(6), FROZEN.vaults)

    def test_raising_slots_is_refused_at_the_genesis_registry(self):
        verdict = screen(GENESIS, "epoch.slots", 6)
        self.assertFalse(verdict.admitted)
        self.assertEqual(verdict.error, "BudgetDerivationRequired")
        self.assertIn("item2.vaults", verdict.breaches)

    def test_item1_envelope_dominates_every_reachable_state(self):
        # The frozen 2,240 is evaluated at compiled bounds, two of which are
        # unreachable. Quantify the margin rather than assume it.
        self.assertEqual(item1_reachable_max(), 1_064)
        self.assertLess(item1_reachable_max(), item1_compiled_max())
        self.assertEqual(196 + 28 * books(5), 1_064)

    def test_consequence_b_boundaries(self):
        # 13 §5 (b): "raising `epoch.slots`, lowering `mkt.obs_interval`,
        # raising `dec.window` or raising `epoch.length` is refused at that
        # registry, and the opposite direction is ordinary business".
        refused = {
            "epoch.slots": 6,
            "mkt.obs_interval": 9,
            "dec.window": 51_840,
            "epoch.length": 332_640,
        }
        for key, value in refused.items():
            with self.subTest(key=key, direction="unsafe"):
                self.assertFalse(screen(GENESIS, key, value).admitted)
        admitted = {
            "epoch.slots": 4,
            "mkt.obs_interval": 11,
            "dec.window": 34_560,
            "epoch.length": 275_184,
        }
        for key, value in admitted.items():
            with self.subTest(key=key, direction="safe"):
                self.assertTrue(screen(GENESIS, key, value).admitted)

    def test_worked_reopening_routes_land_exactly_on_the_frozen_figures(self):
        # 13 §5 (c): "with `mkt.obs_interval` raised to 20, `dec.window` =
        # 86,400 passes the screen at exactly 133,920, and `epoch.length` =
        # 604,800 … passes at exactly 580,320."
        widened = GENESIS.with_key("mkt.obs_interval", 20)
        self.assertEqual(
            item4_decision_critical(widened.with_key("dec.window", 86_400)), 133_920
        )
        self.assertEqual(
            item4_full_window(widened.with_key("epoch.length", 604_800)), 580_320
        )

    def test_ledger_archive_is_an_input_never_a_trigger(self):
        # 13 §5 consequence (a). Lowering it shortens retention and is never
        # screened, even though it is an item-1 input.
        verdict = screen(GENESIS, "ledger.archive", 90 * 14_400)
        self.assertTrue(verdict.admitted)
        self.assertEqual(verdict.breaches, ())

    def test_equal_write_is_never_screened(self):
        for key in OCCUPANCY_KEYS:
            with self.subTest(key=key):
                self.assertTrue(screen(GENESIS, key, GENESIS.get(key)).admitted)

    def test_out_of_registry_values_fail_before_the_screen(self):
        # 13 §5: "the 13 §1 bounds, max-Δ and cooldown checks run **before** the
        # screen, so an out-of-registry value still fails as an ordinary
        # registry violation" — not as BudgetDerivationRequired.
        with self.assertRaises(DerivationRefused):
            screen(GENESIS, "epoch.slots", 13)  # outside [1, 12]
        with self.assertRaises(DerivationRefused):
            screen(GENESIS, "epoch.slots", 9)  # inside bounds, outside max-Δ 2
        with self.assertRaises(DerivationRefused):
            screen(GENESIS, "dec.window", 86_400)  # 20 % max-Δ off 43,200


class TestInFlightComposition(unittest.TestCase):
    """The 13 §5 in-flight rule and the two laundering cases it closes."""

    def test_worked_case_one_reduction_of_a_pinned_key(self):
        # "lowering `epoch.slots` 5 → 4 and then `mkt.obs_interval` 10 → 9 each
        # pass such a screen (25 × 4,800 = 120,000) while a still-live five-slot
        # cohort needs 31 × 4,800 = 148,800."
        self.assertEqual(books(4) * ceil_div(43_200, 9), 120_000)
        self.assertEqual(books(5) * ceil_div(43_200, 9), 148_800)

        step1 = GENESIS.with_key("epoch.slots", 4)
        # The registry-only screen credits the unmaterialised saving…
        self.assertTrue(screen(step1, "mkt.obs_interval", 9, composed=False).admitted)
        # …and the real five-slot cohort then exceeds the envelope.
        breached = step1.with_key("mkt.obs_interval", 9)
        self.assertIn(
            "item4.decision_critical",
            real_load(breached, GENESIS_IN_FLIGHT).exceeds(FROZEN),
        )
        # The composed screen refuses the same step.
        self.assertFalse(screen(step1, "mkt.obs_interval", 9).admitted)

    def test_worked_case_two_laundering_through_a_safe_direction(self):
        # "`mkt.obs_interval` 10 → 11 is genuinely safe and admitted, and it
        # manufactures exactly enough registry headroom for `dec.window`
        # 43,200 → 51,840 (its 20 % max-Δ) to read 25 × ceil(51,840/11) =
        # 117,825 while the live cohort immediately incurs 31 × 4,713 = 146,103."
        self.assertEqual(ceil_div(51_840, 11), 4_713)
        self.assertEqual(books(4) * 4_713, 117_825)
        self.assertEqual(books(5) * 4_713, 146_103)

        state = GENESIS.with_key("epoch.slots", 4)
        self.assertTrue(screen(state, "mkt.obs_interval", 11).admitted)
        state = state.with_key("mkt.obs_interval", 11)
        self.assertTrue(screen(state, "dec.window", 51_840, composed=False).admitted)
        self.assertFalse(screen(state, "dec.window", 51_840).admitted)

    def test_composition_is_per_key_and_follows_the_audited_classification(self):
        # Pinned keys take the larger of proposed and live; live keys take the
        # proposed value unchanged.
        proposed = Registry(epoch_slots=2, epoch_length=241_920, mkt_obs_interval=20)
        composed, book_count = compose(proposed, GENESIS_IN_FLIGHT)
        self.assertEqual(composed.epoch_slots, 5)  # pinned: live cohort wins
        self.assertEqual(composed.epoch_length, 302_400)  # pinned: longest in force
        self.assertEqual(composed.mkt_obs_interval, 20)  # live: proposed wins
        self.assertEqual(book_count, 31)

    def test_unestablishable_in_flight_maximum_refuses(self):
        # 13 §5: "An in-flight maximum that cannot be established … is a
        # refusal, never a fallback to the registry value, which is the defect
        # itself (G-1)."
        with self.assertRaises(DerivationRefused):
            screen(GENESIS, "dec.window", 34_560, InFlight(longest_length_in_force=0))

    def test_screen_dominates_real_load_for_every_admitted_state(self):
        # Soundness, stated directly: the composed screen's derivation is never
        # below what the chain actually incurs.
        for key in OCCUPANCY_KEYS:
            bound = BOUNDS[key]
            for value in (bound.minimum, bound.maximum, GENESIS.get(key)):
                if key == "epoch.length" and value % 21:
                    continue
                try:
                    verdict = screen(GENESIS, key, value)
                except DerivationRefused:
                    continue
                if not verdict.admitted or verdict.envelopes is None:
                    continue
                actual = real_load(GENESIS.with_key(key, value), GENESIS_IN_FLIGHT)
                with self.subTest(key=key, value=value):
                    self.assertGreaterEqual(
                        verdict.envelopes.decision_critical_obs,
                        actual.decision_critical_obs,
                    )
                    self.assertGreaterEqual(
                        verdict.envelopes.full_window_obs, actual.full_window_obs
                    )


class TestAmendmentSearch(unittest.TestCase):
    """13 §5's claim is about every lawful sequence, so it is searched."""

    def test_registry_only_screen_is_breachable(self):
        # The defect SQ-501 fixed, exhibited rather than described. The search
        # finds a *shorter* route than either worked case: `epoch.slots` 5 → 3
        # alone manufactures enough headroom for `dec.window`'s full 20 % max-Δ.
        breach = search_breach(4, composed=False)
        self.assertIsNotNone(breach)
        self.assertLessEqual(len(breach), 2)
        registry = GENESIS
        for key, value in breach:
            registry = registry.with_key(key, value)
        self.assertTrue(real_load(registry, GENESIS_IN_FLIGHT).exceeds(FROZEN))

    def test_composed_screen_admits_no_breaching_sequence(self):
        # "composing against reality closes the class". Searched to depth 8;
        # the admissible state space at that depth is in the thousands.
        self.assertIsNone(search_breach(8, composed=True))

    def test_search_space_is_not_vacuous(self):
        # A search that admitted nothing would pass the test above for the
        # wrong reason. Confirm the composed screen admits real amendments.
        admitted = [
            (key, value)
            for key in OCCUPANCY_KEYS
            for value in (
                BOUNDS[key].minimum,
                GENESIS.get(key) + (1 if key == "mkt.obs_interval" else 0),
            )
            if value != GENESIS.get(key)
        ]
        passing = 0
        for key, value in admitted:
            try:
                if screen(GENESIS, key, value).admitted:
                    passing += 1
            except DerivationRefused:
                continue
        self.assertGreater(passing, 0)


class TestEnvelopeComparison(unittest.TestCase):
    def test_exceeds_reports_every_breached_item(self):
        over = Envelopes(
            stored_markets=FROZEN.stored_markets + 1,
            stored_market_bytes=FROZEN.stored_market_bytes + 1,
            vaults=FROZEN.vaults + 1,
            vault_bytes=FROZEN.vault_bytes + 1,
            reap_cells=FROZEN.reap_cells + 1,
            decision_critical_obs=FROZEN.decision_critical_obs + 1,
            full_window_obs=FROZEN.full_window_obs + 1,
        )
        self.assertEqual(len(over.exceeds(FROZEN)), 7)
        self.assertEqual(FROZEN.exceeds(FROZEN), ())


if __name__ == "__main__":
    unittest.main()
