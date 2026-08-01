"""Pins 09 §3.1/§5.2/§7 rollout arithmetic and emergency reachability.

The suite treats the phase table as data, composes every NAV-bearing entry
criterion with the issuance cap live before its transition, sweeps the ordinary
05 §3.1 calendar behind the expedited lane, and asks D-9's reachability claim
in the positive direction. False document claims are recorded as false
findings; they are never made green by asserting the published number.
"""

import unittest
from decimal import Decimal, localcontext
from fractions import Fraction
from pathlib import Path

from bleavit_reference_model import lifecycle
from bleavit_reference_model.rollout import (
    BALANCE_MAX_BASE_UNITS,
    BALANCE_MAX_USDC,
    BLOCKS_PER_DAY,
    DESCRIPTOR_LEAD_TIME,
    EXEC_TIMELOCK_CODE_DEFAULT,
    EXEC_TIMELOCK_CODE_FLOOR,
    FREEZE_RENEWED_ENVELOPE,
    FREEZE_WINDOW,
    GENESIS_PROTOCOL_ACCOUNTS,
    GENESIS_PROTOCOL_USDC,
    GUARDED_TRANSITIONS,
    GUARDIAN_TRACK,
    NAV_FLOORS,
    PHASE3_TVL_CAP_DEFAULT,
    PHASE_FOUR_TRANSITION_ORDER,
    PHASE_GATES,
    TREASURY_FUNDING_TARGET,
    USDC_MIN_BALANCE,
    Env,
    RolloutError,
    cap_argument,
    expedited_repair_latency,
    freeze_repair_finding,
    guarded_enabled,
    guarded_reachable_configs,
    guarded_reaches,
    latency_sweep,
    max_attainable_nav,
    min_tvl_cap_for,
    nav_floor_criteria,
    onset_grid,
    phase_cap_raise_allowed,
    phase_gate_satisfiable,
    production_expedited_writer,
    published_sum,
    renewal_fits_first_window,
    renewal_slack,
    rollout_findings,
    sweep_min_tvl_cap_for,
    track_latency,
    transition_phase_four,
)

D = Decimal
REPO_ROOT = Path(__file__).resolve().parents[2]


class PhaseGateDataTests(unittest.TestCase):
    """09 §7.1's Entry criteria are present once and carry their numeric reads."""

    def test_all_eight_phase_rows_are_data(self):
        self.assertEqual(tuple(gate.phase for gate in PHASE_GATES), tuple(range(8)))
        self.assertEqual(len({gate.phase for gate in PHASE_GATES}), len(PHASE_GATES))

    def test_every_entry_criterion_has_a_stable_unique_key(self):
        keys = [criterion.key for gate in PHASE_GATES for criterion in gate.criteria]
        self.assertEqual(len(keys), 25)
        self.assertEqual(len(keys), len(set(keys)))

    def test_the_phase_table_carries_every_nav_floor_read(self):
        reads = {
            phase: criterion.reads for phase, criterion in nav_floor_criteria()
        }
        self.assertEqual(
            reads,
            {
                4: ("08.nav_floor.param",),
                5: ("08.nav_floor.treasury",),
                6: ("08.nav_floor.code", "08.nav_floor.meta"),
            },
        )

    def test_nav_floor_requirements_are_the_frozen_08_literals(self):
        requirements = {
            phase: criterion.nav_floor for phase, criterion in nav_floor_criteria()
        }
        self.assertEqual(requirements[4], NAV_FLOORS["param"])
        self.assertEqual(requirements[5], NAV_FLOORS["treasury"])
        self.assertEqual(requirements[6], NAV_FLOORS["meta"])
        self.assertGreater(requirements[6], NAV_FLOORS["code"])

    def test_phase_three_reporter_and_inflow_criteria_name_their_registry_reads(self):
        phase3 = next(gate for gate in PHASE_GATES if gate.phase == 3)
        reads = {criterion.key: criterion.reads for criterion in phase3.criteria}
        self.assertEqual(reads["p3.reporters"], ("orc.n_min", "orc.reporter_stake"))
        self.assertEqual(
            reads["p3.hrmp"], ("phase3.tvl_cap", "phase3.deposit_cap")
        )

    def test_every_cap_sensitive_criterion_names_an_08_or_13_input(self):
        for gate in PHASE_GATES:
            for criterion in gate.criteria:
                if criterion.cap_requirement is not None:
                    with self.subTest(criterion=criterion.key):
                        self.assertTrue(criterion.reads)
                        self.assertTrue(
                            all(
                                read.startswith("08.")
                                or read.startswith("phase3.")
                                for read in criterion.reads
                            )
                        )


class PhaseCapCompositionTests(unittest.TestCase):
    """09's global issuance cap is composed with 08's entry requirements."""

    def test_all_four_links_of_the_cap_wedge_are_explicit(self):
        links = cap_argument()
        self.assertEqual(
            tuple(link.key for link in links),
            (
                "nav-local-usdc",
                "genesis-not-funded",
                "protocol-global-cap",
                "gate-before-raise",
            ),
        )
        self.assertTrue(all(link.ok for link in links))

    def test_genesis_seeds_twelve_cents_not_the_treasury_target(self):
        self.assertEqual(USDC_MIN_BALANCE, D("0.01"))
        self.assertEqual(GENESIS_PROTOCOL_ACCOUNTS * USDC_MIN_BALANCE, D("0.12"))
        self.assertEqual(GENESIS_PROTOCOL_USDC, D("0.12"))
        self.assertLess(GENESIS_PROTOCOL_USDC, TREASURY_FUNDING_TARGET)

    def test_the_nav_bound_gives_the_arming_claimant_every_benefit(self):
        # Obligations and non-NAV genesis dust can only make actual NAV lower.
        self.assertEqual(max_attainable_nav(PHASE3_TVL_CAP_DEFAULT), D(2_000_000))
        with self.assertRaises(RolloutError):
            max_attainable_nav(D("-0.000001"))

    def test_sq_544_the_seeded_cap_cannot_clear_phase_four(self):
        """SQ-544. 09 §7.1 requires 4,620,989; §5.2 permits only 2,000,000.

        Even the claimant-favouring upper bound on NAV is 2,620,989 USDC short.
        The unsafe error direction is a cap set too low: it permanently wedges
        PARAM arming and therefore sudo removal. Raising it too far expands the
        Phase-3 bootstrap-authority exposure, so both `[VERIFY]` directions
        require evidence.
        """
        check = phase_gate_satisfiable(4, PHASE3_TVL_CAP_DEFAULT)
        self.assertEqual(check.required, D(4_620_989))
        self.assertEqual(check.shortfall, D(2_620_989))
        self.assertFalse(check.ok)
        finding = next(f for f in rollout_findings() if f.key == "phase4.nav-cap")
        self.assertFalse(finding.ok)

    def test_the_balance_sweep_finds_the_first_phase_four_cap(self):
        with localcontext() as ctx:
            ctx.prec = 60
            self.assertEqual(
                BALANCE_MAX_USDC * D(1_000_000), D(BALANCE_MAX_BASE_UNITS)
            )
        minimum = sweep_min_tvl_cap_for(4)
        self.assertEqual(minimum, D(4_620_989))
        self.assertTrue(phase_gate_satisfiable(4, minimum).ok)
        self.assertFalse(
            phase_gate_satisfiable(4, minimum - D("0.000001")).ok
        )

    def test_phase_five_is_bound_by_the_funding_target_not_its_nav_floor(self):
        self.assertEqual(NAV_FLOORS["treasury"], D(7_393_600))
        self.assertEqual(min_tvl_cap_for(5), D(25_000_000))
        self.assertEqual(sweep_min_tvl_cap_for(5), D(25_000_000))
        self.assertGreater(min_tvl_cap_for(5), NAV_FLOORS["treasury"])

    def test_shared_code_meta_arming_is_bound_by_the_meta_floor(self):
        self.assertEqual(min_tvl_cap_for(6), D(21_256_533))
        self.assertEqual(sweep_min_tvl_cap_for(6), D(21_256_533))
        self.assertGreater(min_tvl_cap_for(6), NAV_FLOORS["code"])

    def test_each_nav_floor_clears_exactly_at_its_derived_cap_bound(self):
        for phase, criterion in nav_floor_criteria():
            with self.subTest(phase=phase):
                floor = criterion.nav_floor
                self.assertIsNotNone(floor)
                self.assertGreaterEqual(min_tvl_cap_for(phase), floor)
                self.assertTrue(
                    phase_gate_satisfiable(phase, min_tvl_cap_for(phase)).ok
                )

    def test_an_atomic_later_raise_cannot_rescue_the_phase_four_gate(self):
        result = transition_phase_four(PHASE3_TVL_CAP_DEFAULT, BALANCE_MAX_USDC)
        self.assertEqual(
            PHASE_FOUR_TRANSITION_ORDER,
            (
                "08 §4.2 PARAM NAV-floor gate",
                "arm PARAM / remove sudo",
                "apply both committed cap raises",
            ),
        )
        self.assertFalse(result.armed)
        self.assertEqual(result.cap_after, PHASE3_TVL_CAP_DEFAULT)
        self.assertEqual(result.shortfall, D(2_620_989))

    def test_a_cap_raise_is_refused_before_param_arming(self):
        self.assertFalse(
            phase_cap_raise_allowed(
                phase=3,
                param_armed=False,
                current=PHASE3_TVL_CAP_DEFAULT,
                proposed=NAV_FLOORS["param"],
            )
        )
        self.assertTrue(
            phase_cap_raise_allowed(
                phase=4,
                param_armed=True,
                current=PHASE3_TVL_CAP_DEFAULT,
                proposed=NAV_FLOORS["param"],
            )
        )
        # Tightening is status-quo safe and remains available.
        self.assertTrue(
            phase_cap_raise_allowed(
                phase=3,
                param_armed=False,
                current=PHASE3_TVL_CAP_DEFAULT,
                proposed=D(1_999_999),
            )
        )


class ExpeditedLatencyTests(unittest.TestCase):
    """05's ordinary phase schedule remains load-bearing for 09's lane."""

    def test_the_published_sentence_sums_to_ten_or_seven_days(self):
        priced = published_sum()
        self.assertEqual(
            tuple(
                blocks // BLOCKS_PER_DAY
                for blocks in (
                    priced.gate,
                    priced.ratification,
                    priced.timelock,
                    priced.lead_time,
                )
            ),
            (3, 3, 1, 3),
        )
        self.assertEqual(priced.sequential, 10 * BLOCKS_PER_DAY)
        self.assertEqual(priced.concurrent, 7 * BLOCKS_PER_DAY)

    def test_onset_before_intake_close_uses_the_current_epoch(self):
        length = lifecycle.EPOCH_LENGTH_DEFAULT
        close = lifecycle.phase_schedule(length).boundaries["Qualify"]
        self.assertEqual(close, 3 * BLOCKS_PER_DAY)
        self.assertEqual(
            expedited_repair_latency(
                length, close - 1, EXEC_TIMELOCK_CODE_DEFAULT
            ),
            25 * BLOCKS_PER_DAY + 1,
        )

    def test_onset_at_the_exclusive_intake_close_rolls_a_full_epoch(self):
        length = lifecycle.EPOCH_LENGTH_DEFAULT
        close = lifecycle.phase_schedule(length).boundaries["Qualify"]
        before = expedited_repair_latency(
            length, close - 1, EXEC_TIMELOCK_CODE_DEFAULT
        )
        at = expedited_repair_latency(length, close, EXEC_TIMELOCK_CODE_DEFAULT)
        self.assertEqual(before, 25 * BLOCKS_PER_DAY + 1)
        self.assertEqual(at, 46 * BLOCKS_PER_DAY)
        self.assertEqual(at - before, 21 * BLOCKS_PER_DAY - 1)

    def test_default_epoch_floor_timelock_is_nineteen_to_forty_days(self):
        sweep = latency_sweep((lifecycle.EPOCH_LENGTH_DEFAULT,))
        floor = next(row for row in sweep.by_timelock if row[0] == EXEC_TIMELOCK_CODE_FLOOR)
        self.assertEqual(floor[1].blocks, 19 * BLOCKS_PER_DAY + 1)
        self.assertEqual(floor[2].blocks, 40 * BLOCKS_PER_DAY)

    def test_default_epoch_default_timelock_is_twenty_five_to_forty_six_days(self):
        sweep = latency_sweep((lifecycle.EPOCH_LENGTH_DEFAULT,))
        default = next(
            row for row in sweep.by_timelock if row[0] == EXEC_TIMELOCK_CODE_DEFAULT
        )
        self.assertEqual(default[1].blocks, 25 * BLOCKS_PER_DAY + 1)
        self.assertEqual(default[2].blocks, 46 * BLOCKS_PER_DAY)

    def test_sq_545_full_lawful_sweep_falsifies_nine_to_ten_days(self):
        """SQ-545. 09 §3.1 omits the entire 05 §3.1 epoch pipeline.

        The global best is 14 days plus one block and the global worst is 82
        days. Understating repair time is the unsafe direction: operators may
        rely on a 14/28-day freeze envelope that expires before the fix can
        decide or apply. The 24 h number is also the kernel floor, not the live
        7-day CODE default.
        """
        sweep = latency_sweep()
        self.assertEqual(sweep.best.blocks, 14 * BLOCKS_PER_DAY + 1)
        self.assertEqual(sweep.best.epoch_length, lifecycle.EPOCH_LENGTH_MIN)
        self.assertEqual(sweep.best.timelock, EXEC_TIMELOCK_CODE_FLOOR)
        self.assertEqual(sweep.worst.blocks, 82 * BLOCKS_PER_DAY)
        self.assertEqual(sweep.worst.epoch_length, lifecycle.EPOCH_LENGTH_MAX)
        self.assertEqual(sweep.worst.timelock, EXEC_TIMELOCK_CODE_DEFAULT)
        self.assertFalse(sweep.any_published_9_to_10_days)
        finding = next(
            f for f in rollout_findings() if f.key == "expedited.published-latency"
        )
        self.assertFalse(finding.ok)

    def test_even_the_global_best_misses_the_first_freeze_window(self):
        sweep = latency_sweep()
        self.assertEqual(FREEZE_WINDOW, 14 * BLOCKS_PER_DAY)
        self.assertGreater(sweep.best.blocks, FREEZE_WINDOW)
        self.assertGreater(sweep.worst.blocks, FREEZE_RENEWED_ENVELOPE)

    def test_the_onset_grid_carries_both_sides_of_intake_close(self):
        length = lifecycle.EPOCH_LENGTH_DEFAULT
        close = lifecycle.phase_schedule(length).boundaries["Qualify"]
        grid = onset_grid(length)
        self.assertIn(close - 1, grid)
        self.assertIn(close, grid)
        self.assertIn(close + 1, grid)
        self.assertEqual(grid, tuple(sorted(set(grid))))

    def test_bad_timing_inputs_refuse(self):
        length = lifecycle.EPOCH_LENGTH_DEFAULT
        for onset in (-1, length):
            with self.subTest(onset=onset):
                with self.assertRaises(RolloutError):
                    expedited_repair_latency(
                        length, onset, EXEC_TIMELOCK_CODE_DEFAULT
                    )
        with self.assertRaises(RolloutError):
            expedited_repair_latency(length, 0, -1)
        with self.assertRaises(lifecycle.ScheduleError):
            expedited_repair_latency(length + 1, 0, EXEC_TIMELOCK_CODE_DEFAULT)

    def test_day_views_are_exact_fractions(self):
        sweep = latency_sweep((lifecycle.EPOCH_LENGTH_MIN,))
        self.assertEqual(
            sweep.best.days,
            Fraction(14 * BLOCKS_PER_DAY + 1, BLOCKS_PER_DAY),
        )
        self.assertGreater(sweep.best.days, Fraction(14))


class FreezeRenewalTests(unittest.TestCase):
    """06 §6.3's first-expiry sufficiency argument counts every track stage."""

    def test_guardian_track_latency_is_four_to_eleven_days(self):
        latency = track_latency(GUARDIAN_TRACK)
        self.assertEqual(latency.best, 4 * BLOCKS_PER_DAY)
        self.assertEqual(latency.worst, 11 * BLOCKS_PER_DAY)

    def test_guaranteed_submission_slack_is_three_days(self):
        self.assertEqual(renewal_slack(), 3 * BLOCKS_PER_DAY)
        self.assertEqual(
            FREEZE_WINDOW - track_latency(GUARDIAN_TRACK).worst,
            3 * BLOCKS_PER_DAY,
        )

    def test_the_three_day_boundary_fits_and_the_next_block_does_not(self):
        boundary = 3 * BLOCKS_PER_DAY
        self.assertTrue(renewal_fits_first_window(boundary))
        self.assertFalse(renewal_fits_first_window(boundary + 1))

    def test_the_published_seven_day_decision_is_not_the_operational_latency(self):
        self.assertLess(GUARDIAN_TRACK.decision, FREEZE_WINDOW)
        self.assertGreater(track_latency(GUARDIAN_TRACK).worst, GUARDIAN_TRACK.decision)
        self.assertEqual(
            track_latency(GUARDIAN_TRACK).worst - GUARDIAN_TRACK.decision,
            4 * BLOCKS_PER_DAY,
        )


class GuardedReachabilityTests(unittest.TestCase):
    """D-9 is asked positively: can a repair reach Executed under the trigger?"""

    @staticmethod
    def freeze_env(**overrides):
        values = {
            "ledger_frozen": True,
            "dead_man": False,
            "migration_halt": False,
            "expedited": True,
            "phase": 6,
        }
        values.update(overrides)
        return Env(**values)

    def test_every_lifecycle_transition_has_an_environment_predicate(self):
        self.assertEqual(len(GUARDED_TRANSITIONS), len(lifecycle.TRANSITIONS))
        self.assertEqual(
            {guarded.transition.tag for guarded in GUARDED_TRANSITIONS},
            {transition.tag for transition in lifecycle.TRANSITIONS},
        )
        self.assertTrue(all(guarded.guard for guarded in GUARDED_TRANSITIONS))

    def test_sq_545_no_lawful_freeze_trace_satisfies_d9s_positive_claim(self):
        """SQ-545. 06 §6.3 says the freeze buys time to ship its repair.

        The positive claim `exists trace: None -> Executed` is false: submission
        reaches T20 Rejected(ProcessHold), not Queued. This is a second unsafe
        understatement of emergency exposure, independent of the timing sum.
        """
        finding = freeze_repair_finding(self.freeze_env())
        self.assertEqual(finding.key, "expedited.freeze-reaches-executed")
        self.assertFalse(finding.ok)
        states = {
            config.state for config in guarded_reachable_configs(self.freeze_env())
        }
        self.assertEqual(states, {"None", "Submitted", "Rejected"})

    def test_the_source_less_migration_halt_arm_has_a_specification_trace(self):
        env = self.freeze_env(ledger_frozen=False, migration_halt=True)
        self.assertTrue(guarded_reaches(env, "Queued"))
        self.assertTrue(guarded_reaches(env, "Executed"))

    def test_an_expedited_submission_without_either_trigger_is_inadmissible(self):
        env = self.freeze_env(ledger_frozen=False, migration_halt=False)
        self.assertEqual(
            guarded_reachable_configs(env), {lifecycle.Config("None")}
        )

    def test_code_is_not_binding_in_phase_four(self):
        env = self.freeze_env(ledger_frozen=False, migration_halt=True, phase=4)
        self.assertFalse(guarded_reaches(env, "Submitted"))

    def test_the_execute_time_exemption_exists_but_is_too_late(self):
        # Starting from an artificially pre-staged queue reaches Executed: the
        # §1.2(10) exemption is represented. Starting lawfully at None cannot
        # reach the queue, which isolates the contradiction to the earlier path.
        env = self.freeze_env()
        queued = lifecycle.Config(
            "Queued", vault=lifecycle.VAULT_OPEN
        )
        enabled = {transition.tag for transition in guarded_enabled(queued, env)}
        self.assertEqual(enabled, {"T14", "T20"})
        self.assertTrue(guarded_reaches(env, "Executed", queued))
        self.assertFalse(guarded_reaches(env, "Queued"))

    def test_frozen_market_progress_loses_to_t20(self):
        qualified = lifecycle.Config("Qualified")
        self.assertEqual(
            tuple(t.tag for t in guarded_enabled(qualified, self.freeze_env())),
            ("T20",),
        )

    def test_dead_man_blocks_the_expedited_lane(self):
        env = self.freeze_env(dead_man=True)
        self.assertFalse(guarded_reaches(env, "Submitted"))
        self.assertFalse(guarded_reaches(env, "Executed"))


class ProductionWriterTests(unittest.TestCase):
    """The specification lane also needs a production writer for its marker."""

    def test_the_only_production_enqueue_call_passes_literal_false(self):
        check = production_expedited_writer(REPO_ROOT)
        self.assertEqual(check.call_count, 1)
        self.assertEqual(check.last_arguments, ("false",))
        self.assertFalse(check.can_mark_expedited)


if __name__ == "__main__":
    unittest.main()
