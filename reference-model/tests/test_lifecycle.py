"""Pins 05 §2–§3/§5.4–§5.5, 09 §1.2 and 11 §11.5 against themselves.

05 §3.3 does not merely state its constants, it states what goes wrong when they
are wrong: `k = 3` wedges `qualify` permanently, a `current − 20` prune cutoff
"permanently jams" `record_snapshot`, and `MAX_SNAPSHOTS = 20 × k` leaves "more
lawful records than slots at every activation boundary". Each of those is a claim
about a bounded queue over time, so this suite runs the queue.

The state machine's closure properties (termination, I-15, the §2.2 edge-set
identity) are computed from :data:`TRANSITIONS` rather than asserted, and the
§2.2 check reads the document itself.

One assertion here records a divergence rather than an agreement — see
:meth:`TestPhaseSchedule.test_the_two_documents_disagree_off_the_default`.

The execute-checklist tests parse both live documents and prove their claimed
item-for-item bijection is false: 13 backend items and 14 frontend rows yield
nine one-to-one pairs and five row-level mismatches. They also prove
`BadPreimage` cannot construct the terminal state 09 publishes. The reason-table
tests execute the complete 16-case steps-6–8 partition and pin the one §5.5 cell
whose reason differs from normative §5.4.
"""

import unittest
from fractions import Fraction
from pathlib import Path

from bleavit_reference_model.decision import Outcome, RejectReason
from bleavit_reference_model.lifecycle import (
    BY_TAG,
    DEC_WINDOW_DEFAULT,
    DEC_WINDOW_MAX,
    DIAGRAM_OMITS,
    EPOCH_LENGTH_DEFAULT,
    EPOCH_LENGTH_MAX,
    EPOCH_LENGTH_MIN,
    HORIZON_K_DEFAULT,
    MAX_NON_TERMINAL_COHORTS,
    PRE_EXECUTED_STATES,
    PRUNE_CUTOFF_OFFSET,
    RETAINED_EPOCHS,
    ABSORBING_STATES,
    STATES,
    T16_CAUSES,
    TRANSITIONS,
    VAULT_NONE,
    VAULT_OPEN,
    VAULT_VOIDED,
    Config,
    ScheduleError,
    SnapshotWindow,
    analyze_reason_table,
    admissible_versions,
    backend_execute_checks,
    check_execute_reject_reasons,
    checklist_t16_causes,
    cohort_lifetime_epochs,
    dec_window_constraint_satisfied,
    decide_window_absolute,
    decide_window_by_fraction,
    decide_window_readings_agree,
    diagram_edges,
    enabled,
    execute_checklist_diff,
    find_cycle,
    fire,
    frontend_execute_checks,
    frozen_reject_reasons,
    grace_end_disposition,
    is_terminal,
    lawful_epoch_lengths,
    max_horizon_k,
    max_snapshots,
    phase_offset_blocks,
    phase_schedule,
    prune_cutoff,
    reason_table_rows,
    reachable_configs,
    reaches,
    simulate_cohorts,
    simulate_snapshot_window,
    table_edges,
    t16_cause_diff,
    terminal_configs,
    unconstructable_reject_disposition,
    worst_case_records,
)

REPO_ROOT = Path(__file__).resolve().parents[2]


class TestPhaseSchedule(unittest.TestCase):
    """05 §3.1 / 13 §3.1 — offsets as fractions of `epoch.length`."""

    def test_every_published_boundary_and_day_label(self):
        schedule = phase_schedule(EPOCH_LENGTH_DEFAULT)
        expected = {
            "Intake": (0, 0),
            "Qualify": (43_200, 3),
            "Seed": (57_600, 4),
            "Trade": (72_000, 5),
            "DecideWindow": (216_000, 15),
            "Decide": (259_200, 18),
            "Housekeeping": (288_000, 20),
        }
        for name, (blocks, day) in expected.items():
            with self.subTest(phase=name):
                self.assertEqual(schedule.boundaries[name], blocks)
                self.assertEqual(schedule.days(name), day)

    def test_trade_phase_is_thirteen_days(self):
        # 05 §3.1: "The Trade phase labels are corrected to **d5–d18** (offsets
        # 72,000–259,200 = 13 days) — the superseded 'd4–d18' label contradicted
        # its own offsets (B-low)."
        schedule = phase_schedule()
        self.assertEqual(schedule.trade_span(), 187_200)
        self.assertEqual(schedule.trade_span() / 14_400, 13.0)
        self.assertEqual(
            Fraction(schedule.trade_span(), EPOCH_LENGTH_DEFAULT), Fraction(13, 21)
        )

    def test_boundaries_are_exact_at_every_lawful_length(self):
        # 05 §3.1: `epoch.length` "MUST be a multiple of 21 blocks so all phase
        # boundaries are exact". Checked over the whole admissible range, not
        # only at the default.
        lengths = lawful_epoch_lengths()
        self.assertEqual(len(lengths), 19_201)
        for length in (lengths[0], EPOCH_LENGTH_DEFAULT, lengths[-1]):
            with self.subTest(length=length):
                schedule = phase_schedule(length)
                self.assertEqual(len(schedule.boundaries), 7)
                ordered = list(schedule.boundaries.values())
                self.assertEqual(ordered, sorted(ordered))

    def test_a_length_that_is_not_a_multiple_of_21_refuses(self):
        with self.assertRaises(ScheduleError):
            phase_schedule(EPOCH_LENGTH_DEFAULT + 1)
        with self.assertRaises(ScheduleError):
            phase_offset_blocks(5, 0)

    def test_dec_window_constraint(self):
        # 05 §3.1: "constraint (checked at parameter change):
        # `dec.window ≤ 13/21 · epoch.length`".
        self.assertTrue(dec_window_constraint_satisfied())
        self.assertTrue(
            dec_window_constraint_satisfied(EPOCH_LENGTH_MIN, DEC_WINDOW_MAX)
        )
        # 13/21 of the 14-day floor is 124,800 blocks, so even `dec.window` at
        # its registry maximum stays inside the Trade phase everywhere.
        self.assertGreater(Fraction(13, 21) * EPOCH_LENGTH_MIN, DEC_WINDOW_MAX)
        self.assertFalse(dec_window_constraint_satisfied(EPOCH_LENGTH_MIN, 200_000))

    def test_the_two_documents_disagree_off_the_default(self):
        """05 §3.1 and 13 §3.1 render the decision window differently.

        05 §3.1 anchors it absolutely — `[18/21·L − dec.window, 18/21·L)` — and
        says so twice ("`dec.window` and `dec.trailing` remain absolute
        block-count parameters anchored to Trade close"; SQ-501: accrual
        boundaries are "computed from the then-live `dec.window`/`dec.trailing`
        and stored per book"). 13 §3.1's table renders the same row as the fixed
        fraction `[15/21, 18/21)`, carried in the kernel as
        `phase_offsets::DECIDE_WINDOW_NUM = 15` and published to clients through
        the 02 §9 `Epoch::PhaseOffsets` list.

        The two coincide at the genesis registry and nowhere else. This test
        records the divergence so it cannot widen unnoticed; the resolution is a
        spec question, not a change this model may make.
        """
        self.assertTrue(decide_window_readings_agree())
        self.assertEqual(decide_window_absolute(), (216_000, 259_200))
        self.assertEqual(decide_window_by_fraction(), (216_000, 259_200))

        # Off the default `epoch.length`, the fraction widens the window.
        self.assertEqual(decide_window_absolute(EPOCH_LENGTH_MAX), (475_200, 518_400))
        self.assertEqual(decide_window_by_fraction(EPOCH_LENGTH_MAX), (432_000, 518_400))
        self.assertFalse(decide_window_readings_agree(EPOCH_LENGTH_MAX))

        # Off the default `dec.window`, at the default length, likewise.
        self.assertEqual(
            decide_window_absolute(EPOCH_LENGTH_DEFAULT, DEC_WINDOW_MAX),
            (172_800, 259_200),
        )
        self.assertFalse(
            decide_window_readings_agree(EPOCH_LENGTH_DEFAULT, DEC_WINDOW_MAX)
        )

        # Exactly one of the 19,201 lawful epoch lengths makes them agree.
        agreeing = [
            length for length in lawful_epoch_lengths()
            if decide_window_readings_agree(length)
        ]
        self.assertEqual(agreeing, [EPOCH_LENGTH_DEFAULT])


class TestTransitionTable(unittest.TestCase):
    """05 §2.1 — the table as data, and what it closes."""

    def test_every_row_is_present_and_unique(self):
        tags = [t.tag for t in TRANSITIONS]
        self.assertEqual(tags, [f"T{n}" for n in range(1, 27)])
        self.assertEqual(len(set(tags)), 26)

    def test_every_endpoint_is_a_declared_state(self):
        for transition in TRANSITIONS:
            with self.subTest(tag=transition.tag):
                for source in transition.sources:
                    self.assertIn(source, STATES)
                self.assertIn(transition.target, STATES)

    def test_multi_source_rows_match_the_document(self):
        self.assertEqual(BY_TAG["T9"].sources, ("Trading", "Extended"))
        self.assertEqual(BY_TAG["T10"].sources, ("Trading", "Extended"))
        self.assertEqual(BY_TAG["T21"].sources, ("Rejected", "Expired"))
        self.assertEqual(BY_TAG["T25"].sources, ("Trading", "Extended", "Queued"))
        self.assertEqual(set(BY_TAG["T20"].sources), PRE_EXECUTED_STATES)

    def test_t20_scope_includes_the_decided_pre_executed_states(self):
        # §2.1 (SQ-319): "`Queued`, `Suspended`, `Rerun` and `FailedExecuted`
        # are simultaneously *pre-Executed* and *decided*".
        for state in ("Queued", "Suspended", "Rerun", "FailedExecuted"):
            with self.subTest(state=state):
                self.assertIn(state, BY_TAG["T20"].sources)
        # …and excludes Executed, Measuring, Settled and the terminals.
        for state in ("Executed", "Measuring", "Settled", "Cancelled"):
            with self.subTest(state=state):
                self.assertNotIn(state, BY_TAG["T20"].sources)


class TestOneShotBudgets(unittest.TestCase):
    """§2.1's flags, and the finiteness they buy."""

    def test_t6_rolls_over_exactly_once_then_t26_cancels(self):
        # §2.1 (SQ-91): "a second deferral of the same proposal cancels it with
        # a full refund (T26) … evaluated **in place of** T6, never after it".
        screening = Config("Screening")
        self.assertIn("T6", [t.tag for t in enabled(screening)])
        self.assertNotIn("T26", [t.tag for t in enabled(screening)])
        deferred = Config("Screening", frozenset({"deferred_once"}))
        self.assertNotIn("T6", [t.tag for t in enabled(deferred)])
        self.assertIn("T26", [t.tag for t in enabled(deferred)])

    def test_t8_extends_at_most_once(self):
        trading = Config("Trading", vault=VAULT_OPEN)
        self.assertIn("T8", [t.tag for t in enabled(trading)])
        already = Config("Trading", frozenset({"extended"}), VAULT_OPEN)
        self.assertNotIn("T8", [t.tag for t in enabled(already)])

    def test_one_guardian_rerun_of_either_kind_ever(self):
        # §2.1 *Rerun finality*: "a proposal that took the T11→T12→T13
        # delay-then-rerun path cannot then take T25, and vice versa".
        after_t11 = Config(
            "Queued", frozenset({"delayed_once", "guardian_rerun"}), VAULT_OPEN
        )
        self.assertNotIn("T25", [t.tag for t in enabled(after_t11)])
        self.assertNotIn("T11", [t.tag for t in enabled(after_t11)])
        after_t25 = Config(
            "Extended", frozenset({"extended", "rerun", "guardian_rerun"}), VAULT_OPEN
        )
        self.assertNotIn("T25", [t.tag for t in enabled(after_t25)])

    def test_rerun_finality_is_structural(self):
        # "`delayed_once` is already true so T11 cannot fire again, and
        # `extended` is already true so no further extension is reachable …
        # A rerun that fails grade or hurdle rejects; it never re-extends."
        reopened = Config(
            "Extended", frozenset({"extended", "rerun", "guardian_rerun"}), VAULT_OPEN
        )
        tags = {t.tag for t in enabled(reopened)}
        self.assertEqual(tags, {"T9", "T10", "T20"})


class TestClosureProperties(unittest.TestCase):
    """Properties computed from the table, not asserted about it."""

    def test_the_machine_terminates(self):
        # The one-shot budgets are what make T6's rollover, T25's self-edge and
        # the T11→T12→T13 loop finite. A cycle in (state, flags) space would be
        # a proposal that never terminates.
        self.assertIsNone(find_cycle())

    def test_reachable_configuration_space_is_small_and_bounded(self):
        configs = reachable_configs()
        self.assertEqual(len(configs), 107)
        self.assertLessEqual(len({c.state for c in configs}), len(STATES))

    def test_the_terminal_set_is_exactly_the_documents_list(self):
        # §2.1 *Terminal states*: "`Settled`, `Cancelled`, `Expired`-without-vault
        # (impossible …), and `Rejected` where no vault exists (pre-Seed
        # rejections via T20) or the vault is `Voided`. `Rejected` and `Expired`
        # with a healthy vault are **transient**" — T21 fires in the same block,
        # which is what closes the superseded table's B-12 gap.
        # Deduplicated over the one-shot flags, which do not affect terminality.
        self.assertEqual(
            sorted({(c.state, c.vault) for c in terminal_configs()}),
            [
                ("Cancelled", VAULT_NONE),
                ("Rejected", VAULT_NONE),
                ("Rejected", VAULT_VOIDED),
                ("Settled", VAULT_OPEN),
            ],
        )
        self.assertEqual(ABSORBING_STATES, frozenset({"Settled", "Cancelled"}))

    def test_a_pre_seed_force_rejection_is_terminal(self):
        # The case the unconditional-T21 model got wrong (Codex review, PR #200):
        # T20 on a proposal that never reached T7 leaves `Rejected` with no
        # vault, and §2.1 makes that terminal — T21 "fires iff markets were
        # deployed and the vault is open".
        for state in ("Submitted", "Screening", "Qualified"):
            with self.subTest(state=state):
                rejected = fire(Config(state), BY_TAG["T20"])
                self.assertEqual((rejected.state, rejected.vault), ("Rejected", VAULT_NONE))
                self.assertTrue(is_terminal(rejected))
                self.assertFalse(reaches(rejected, "Measuring"))
                self.assertFalse(reaches(rejected, "Settled"))

    def test_a_post_seed_force_rejection_voids_its_vault_and_is_terminal(self):
        # T20: "if a vault exists it transitions to `Voided` (03, D-1) — **no
        # measurement**". So T20 is terminal on both sides of Seed, by two
        # different routes.
        for state in ("Trading", "Extended", "Queued", "Suspended", "FailedExecuted"):
            with self.subTest(state=state):
                rejected = fire(Config(state, vault=VAULT_OPEN), BY_TAG["T20"])
                self.assertEqual(
                    (rejected.state, rejected.vault), ("Rejected", VAULT_VOIDED)
                )
                self.assertTrue(is_terminal(rejected))
                self.assertFalse(reaches(rejected, "Measuring"))

    def test_expired_without_a_vault_is_unreachable(self):
        # §2.1 lists it as "impossible — Expired implies Queued implies markets;
        # listed for completeness". Computed here rather than taken on trust.
        self.assertFalse(
            any(
                c.state == "Expired" and c.vault != VAULT_OPEN
                for c in reachable_configs()
            )
        )

    def test_i15_no_rejection_timeout_veto_or_expiry_path_enqueues_execution(self):
        # §2.1: "**no rejection, timeout, veto, or expiry path enqueues
        # execution** (I-15, checked by state-machine model checking)". Checked
        # from every vault state, since T21's gate changes what is reachable.
        for state in ("Rejected", "Expired", "Cancelled"):
            for vault in (VAULT_NONE, VAULT_OPEN, VAULT_VOIDED):
                with self.subTest(state=state, vault=vault):
                    start = Config(state, vault=vault)
                    self.assertFalse(reaches(start, "Executed"))
                    self.assertFalse(reaches(start, "Queued"))

    def test_every_rejected_or_expired_proposal_with_a_vault_reaches_measurement(self):
        # T21 "fires iff markets were deployed and the vault is open" — the
        # REJECT branch trades through measurement and settles, "the most common
        # lifecycle path". The gate is real: without an open vault it does not.
        for state in ("Rejected", "Expired"):
            with self.subTest(state=state):
                healthy = Config(state, vault=VAULT_OPEN)
                self.assertTrue(reaches(healthy, "Measuring"))
                self.assertTrue(reaches(healthy, "Settled"))
                for dead in (VAULT_NONE, VAULT_VOIDED):
                    self.assertFalse(reaches(Config(state, vault=dead), "Measuring"))

    def test_every_reachable_configuration_can_still_terminate(self):
        for config in reachable_configs():
            with self.subTest(config=config):
                self.assertTrue(
                    any(is_terminal(r) for r in reachable_configs(config))
                )

    def test_failed_execution_retries_or_measures_but_never_expires(self):
        # T23 retries within the 72 h window, T22 measures when it is exhausted.
        failed = Config("FailedExecuted", vault=VAULT_OPEN)
        self.assertEqual({t.tag for t in enabled(failed)}, {"T20", "T22", "T23"})
        self.assertFalse(reaches(failed, "Expired"))


class TestGraceEndPrecedence(unittest.TestCase):
    """§2.1 *Grace-end precedence: T16 before T15* (SQ-164)."""

    def test_generic_expiry_when_no_specific_cause_applies(self):
        self.assertEqual(grace_end_disposition(), ("T15", "Expired"))

    def test_every_t16_cause_pre_empts_expiry(self):
        # "a known terminal cause must not collapse into generic expiry: the two
        # dispositions carry the same refund but a different `DecisionRecord`,
        # and the archive is the only place the reason survives."
        for cause in T16_CAUSES:
            with self.subTest(cause=cause):
                tag, disposition = grace_end_disposition((cause,))
                self.assertEqual(tag, "T16")
                self.assertEqual(disposition, f"Rejected({cause})")

    def test_precedence_is_deterministic_when_several_causes_coincide(self):
        # "Absent this ordering the reason-code truth table (§5.5) would be
        # non-deterministic at exactly the moment it matters most."
        self.assertEqual(
            grace_end_disposition(T16_CAUSES), grace_end_disposition((T16_CAUSES[0],))
        )


class TestLifecycleDiagram(unittest.TestCase):
    """§2.2's own claim, checked against §2.1 by parsing the document."""

    def test_every_edge_appears_in_both(self):
        # §2.2's heading: "re-verified against §2.1 — every edge below appears
        # above and vice versa".
        drawn = diagram_edges(REPO_ROOT)
        tabled = table_edges()
        self.assertEqual(drawn - tabled, set(), "drawn but not in the §2.1 table")
        self.assertEqual(tabled - drawn, set(), "in the §2.1 table but not drawn")
        self.assertEqual(len(drawn), 30)

    def test_the_only_omission_is_the_declared_one(self):
        # §2.2's parenthetical: "T20 force-reject edges … are omitted from the
        # drawing for legibility; they are normative per §2.1."
        self.assertEqual(DIAGRAM_OMITS, frozenset({"T20"}))
        self.assertNotIn("T20", {tag for tag, _, _ in diagram_edges(REPO_ROOT)})


class TestCohortHorizon(unittest.TestCase):
    """05 §3.3 — "`epoch.horizon_k`'s ceiling is derived, not chosen" (SQ-496)."""

    def test_lifetime_and_ceiling(self):
        # "it is non-terminal for `k + 2` epochs; one cohort forms per epoch, so
        # steady state holds exactly `k + 2` live cohorts against I-21's cap of
        # 4. The admissible horizon is therefore
        # `k ≤ MAX_NON_TERMINAL_COHORTS − 2 = 2`."
        self.assertEqual(cohort_lifetime_epochs(HORIZON_K_DEFAULT), 4)
        self.assertEqual(max_horizon_k(), 2)
        self.assertEqual(max_horizon_k(), MAX_NON_TERMINAL_COHORTS - 2)

    def test_k_at_or_below_the_ceiling_never_fails_admission(self):
        for k in (1, 2):
            run = simulate_cohorts(k, epochs=200)
            with self.subTest(k=k):
                self.assertIsNone(run.first_failure)
                self.assertEqual(run.admission_rate, 1)
                self.assertEqual(run.live_counts[-1], k + 2)
                self.assertLessEqual(max(run.live_counts), MAX_NON_TERMINAL_COHORTS)

    def test_k_equals_2_saturates_the_cap_exactly(self):
        run = simulate_cohorts(2, epochs=50)
        self.assertEqual(run.live_counts[-1], MAX_NON_TERMINAL_COHORTS)
        self.assertEqual(run.admission_rate, 1)

    def test_k_equals_3_loses_one_epoch_in_five_forever(self):
        """The corrected form of §3.3's claim (2026-07-31; Codex review, PR #200).

        §3.3 read "within a few epochs **every** `qualify` fails
        `TooManyCohorts` permanently, with no proposal able to enter measurement
        again". Executed, that is false and the earlier version of this test
        asserted the wrong thing: it took a permanently saturated *live count*
        as proof of permanent *admission failure*, which the count cannot show.
        One cohort retires each epoch once the window fills, so `k = 3` admits in
        four epochs out of five.

        What is true — and is what the kernel ceiling rests on — is that the
        steady-state demand `k + 2 = 5` exceeds the cap of 4, so exactly one
        epoch in every `k + 2` fails, forever. The loss is unrecoverable because
        a cohort is per-epoch: a skipped epoch's proposals cannot join a later
        cohort, they take T6 once and then T26. §3.3 now states this.
        """
        run = simulate_cohorts(3, epochs=200)
        self.assertEqual(run.first_failure, 4)
        self.assertEqual(run.failure_period(), 5)  # = k + 2
        self.assertEqual(run.admission_rate, Fraction(4, 5))
        # Recurring forever, not a transient at the fill boundary…
        self.assertGreater(len(run.failure_epochs), 30)
        # …and the live count alone cannot distinguish the two, which is exactly
        # why admission is now recorded per epoch.
        self.assertTrue(
            all(count == MAX_NON_TERMINAL_COHORTS for count in run.live_counts[4:])
        )

    def test_the_shortfall_is_reachable_through_a_lawful_amendment(self):
        # "That the wedge was reachable through a lawful amendment inside the
        # key's own published bounds is what makes the ceiling normative here."
        # 13 §1 caps `epoch.horizon_k` at 2 precisely to close this.
        self.assertGreater(cohort_lifetime_epochs(3), MAX_NON_TERMINAL_COHORTS)
        self.assertLessEqual(cohort_lifetime_epochs(2), MAX_NON_TERMINAL_COHORTS)


class TestSnapshotRetention(unittest.TestCase):
    """05 §3.3 — the prune cutoff and the record bound, both simulated."""

    def test_prune_cutoff_retains_nineteen_and_leaves_one_slot(self):
        # SQ-200: "pruning removes every snapshot with index ≤ current − 20,
        # i.e. it uses the cutoff `current − 19`. This retains 19 snapshots and
        # leaves exactly **one** free slot for the epoch's own record."
        self.assertEqual(PRUNE_CUTOFF_OFFSET, 19)
        self.assertEqual(prune_cutoff(100), 81)
        _, window = simulate_snapshot_window(
            100, capacity=RETAINED_EPOCHS, versions_per_epoch=1
        )
        self.assertEqual(len(window.records), RETAINED_EPOCHS)

    def test_the_correct_cutoff_never_jams(self):
        jam, _ = simulate_snapshot_window(
            500, capacity=RETAINED_EPOCHS, cutoff_offset=19, versions_per_epoch=1
        )
        self.assertIsNone(jam)

    def test_the_superseded_cutoff_permanently_jams(self):
        # "A cutoff of `current − 20` retains a full window and **permanently
        # jams** `record_snapshot` (which requires strict spare capacity),
        # deadlocking settlement and ultimately tripping the dead-man switch."
        jam, window = simulate_snapshot_window(
            500, capacity=RETAINED_EPOCHS, cutoff_offset=20, versions_per_epoch=1
        )
        self.assertEqual(jam, 20)
        self.assertEqual(window.total(), RETAINED_EPOCHS)

    def test_the_record_bound_is_twenty_times_k_plus_one(self):
        # "`MAX_SNAPSHOTS = 20 × (2 + 1) = 60` … **The multiplier is `k + 1`,
        # not `k`.**"
        self.assertEqual(max_snapshots(HORIZON_K_DEFAULT), 60)
        self.assertEqual(worst_case_records(HORIZON_K_DEFAULT), 60)
        self.assertEqual(max_snapshots(HORIZON_K_DEFAULT), 20 * (HORIZON_K_DEFAULT + 1))

    def test_the_admissible_set_is_frozen_versions_union_the_active_one(self):
        # "the active version need not be a member of the frozen set: the
        # cohorts measuring epoch `e` were created at `e − 1` and `e − 2`, so
        # they carry the versions active *then*, and a version activating at `e`
        # itself is a lawful third."
        self.assertEqual(admissible_versions(7, (5, 6)), frozenset({5, 6, 7}))
        self.assertEqual(len(admissible_versions(7, (5, 6))), HORIZON_K_DEFAULT + 1)
        # An already-frozen active version collapses the union, which is the
        # ordinary case and needs fewer slots, never more.
        self.assertEqual(len(admissible_versions(6, (5, 6))), 2)

    def test_the_correct_record_bound_absorbs_the_worst_lawful_case(self):
        jam, window = simulate_snapshot_window(
            300, capacity=60, cutoff_offset=19, versions_per_epoch=3
        )
        self.assertIsNone(jam)
        self.assertEqual(window.total(), 60)  # saturating, and exactly so

    def test_the_superseded_record_bound_jams_at_an_activation_boundary(self):
        # "conflating the two left more lawful records than slots at every
        # activation boundary" — and the consequence "was not a capacity
        # nuisance but a permanent wedge".
        jam, window = simulate_snapshot_window(
            300, capacity=20 * HORIZON_K_DEFAULT, cutoff_offset=19, versions_per_epoch=3
        )
        self.assertIsNotNone(jam)
        self.assertEqual(jam, 13)
        self.assertEqual(window.total(), 40)

    def test_retirement_is_owned_by_the_epoch_roll(self):
        # SQ-201: "an epoch in which no proposal ever reaches `Measuring` forms
        # no cohort, so there is nothing to reap and cohort-keyed cleanup can
        # never reach that epoch's welfare state … Retirement is therefore owned
        # by the epoch roll." Simulated as a run with no cohort ever settling:
        # the roll-driven prune must still keep the window bounded.
        window = SnapshotWindow(capacity=RETAINED_EPOCHS)
        for epoch in range(200):
            window.retire(epoch)
            self.assertTrue(window.record(epoch, 0), f"jammed at epoch {epoch}")
        self.assertEqual(len(window.records), RETAINED_EPOCHS)

    def test_a_reap_only_prune_would_wedge_a_cohortless_chain(self):
        # The defect SQ-201 names, exhibited: with no roll-driven retirement,
        # "after `MAX_SNAPSHOTS` consecutive cohortless epochs the retained
        # window is full, `record_snapshot` has no spare capacity, snapshot
        # recording stops and the §4.8 snapshot-overdue trigger fires".
        window = SnapshotWindow(capacity=RETAINED_EPOCHS)
        jammed_at = None
        for epoch in range(200):
            if not window.record(epoch, 0):  # no retire() — reap never fires
                jammed_at = epoch
                break
        self.assertEqual(jammed_at, RETAINED_EPOCHS)


class TestExecuteChecklistContract(unittest.TestCase):
    """09 §1.2 ↔ 11 §11.5, parsed from the documents and diffed by row."""

    def test_the_documents_publish_thirteen_backend_and_fourteen_frontend_rows(self):
        backend = backend_execute_checks(REPO_ROOT)
        frontend = frontend_execute_checks(REPO_ROOT)
        self.assertEqual([check.index for check in backend], list(range(1, 14)))
        self.assertEqual([check.index for check in frontend], list(range(1, 15)))
        self.assertEqual((backend[0].name, backend[-1].name), ("Queue state", "Record"))
        self.assertEqual(
            (frontend[0].name, frontend[-1].name),
            ("Queued, not cancelled", "Descriptor lead time (CODE/META)"),
        )

    def test_sq_552_the_claimed_item_for_item_bijection_is_false(self):
        """SQ-552. Both documents claim lockstep; the parsed rows are not bijective.

        Nine rows map one-to-one. Backend rows 1 and 10 each split into two FE
        rows, backend dispatch/record rows 12/13 have no FE precondition, and FE
        row 14 is an `apply_authorized_upgrade` check owned by 09 §2.2 rather
        than an `execution_guard.execute` check.
        """
        diff = execute_checklist_diff(REPO_ROOT)
        self.assertFalse(diff.bijective)
        self.assertEqual(
            diff.one_to_one,
            ((2, 3), (3, 4), (4, 5), (5, 6), (6, 7), (7, 8), (8, 9), (9, 10), (11, 13)),
        )
        mismatches = {finding.key: finding for finding in diff.mismatches}
        self.assertEqual(
            set(mismatches),
            {
                "backend:1:split",
                "backend:10:split",
                "backend:12:unmatched",
                "backend:13:unmatched",
                "frontend:14:unmatched",
            },
        )
        self.assertEqual(mismatches["backend:1:split"].frontend_rows, (1, 2))
        # The audit hypothesis grouped FE row 10 into backend item 10. The live
        # documents do not: backend item 9 maps one-to-one to FE row 10, while
        # item 10 maps only to FE rows 11 and 12.
        self.assertIn((9, 10), diff.one_to_one)
        self.assertEqual(mismatches["backend:10:split"].frontend_rows, (11, 12))
        self.assertIn("apply_authorized_upgrade", mismatches["frontend:14:unmatched"].why)

    def test_every_named_reason_is_frozen_except_bad_preimage(self):
        findings = check_execute_reject_reasons(REPO_ROOT)
        self.assertEqual(
            [(finding.document, finding.row, finding.reason) for finding in findings],
            [
                ("09 §1.2", 3, "StaleQueue"),
                ("09 §1.2", 4, "NotRatified"),
                ("09 §1.2", 5, "AttestationMissing"),
                ("09 §1.2", 11, "BadPreimage"),
                ("11 §11.5", 5, "NotRatified"),
            ],
        )
        invalid = [finding for finding in findings if not finding.ok]
        self.assertEqual([(finding.row, finding.reason) for finding in invalid], [(11, "BadPreimage")])
        self.assertNotIn("BadPreimage", frozen_reject_reasons())

    def test_sq_552_bad_preimage_stays_queued_then_expires_by_t15(self):
        """SQ-552. 09 §1.2(11)'s `Rejected(BadPreimage)` is unconstructable.

        `BadPreimage` is not a frozen `RejectReason`, so a failed dispatch leaves
        the proposal `Queued`. It is not a T16 cause either; absent another
        specific cause, 05 §2.1 therefore sends it through T15 `Expired` at
        grace end rather than recording the terminal state 09 publishes.
        """
        disposition = unconstructable_reject_disposition("BadPreimage")
        self.assertEqual(
            (
                disposition.state_after_dispatch,
                disposition.grace_transition,
                disposition.grace_disposition,
            ),
            ("Queued", "T15", "Expired"),
        )

    def test_t16_reason_sets_are_compared_in_both_directions(self):
        checklist = checklist_t16_causes(REPO_ROOT)
        self.assertEqual(
            checklist,
            frozenset({"StaleQueue", "NotRatified", "AttestationMissing", "BadPreimage"}),
        )
        self.assertEqual(frozenset(T16_CAUSES), checklist - {"BadPreimage"})
        finding = t16_cause_diff(REPO_ROOT)
        self.assertFalse(finding.ok)
        self.assertEqual(finding.checklist_only, frozenset({"BadPreimage"}))
        self.assertEqual(finding.transition_only, frozenset())


class TestReasonCodeTruthTable(unittest.TestCase):
    """05 §5.5's table structure and its steps-6–8 diff against §5.4."""

    def test_the_published_table_parses_as_twenty_one_rows_by_eleven_steps(self):
        rows = reason_table_rows(REPO_ROOT)
        self.assertEqual(len(rows), 21)
        self.assertTrue(all(len(row.steps) == 11 for row in rows))
        valid_fail = next(row for row in rows if row.scenario == "Valid fail")
        self.assertEqual(valid_fail.steps[5:8], ("✘", "–", "–"))
        self.assertEqual(valid_fail.outcome, "Reject(HurdleNotMet)")

    def test_the_hurdle_partition_is_total_deterministic_and_non_overlapping(self):
        analysis = analyze_reason_table(REPO_ROOT)
        self.assertEqual(analysis.case_count, 16)
        self.assertTrue(analysis.total)
        self.assertTrue(analysis.deterministic)
        self.assertTrue(analysis.non_overlapping)
        self.assertEqual(analysis.uncovered, ())
        self.assertEqual(analysis.overlaps, ())
        self.assertEqual(analysis.nondeterministic, ())

    def test_sq_552_valid_fail_has_the_wrong_reason_when_not_converged(self):
        """SQ-552. 05 §5.5 loses the convergence predicate in `Valid fail`.

        The row publishes `HurdleNotMet` whenever both windows fail, but
        normative §5.4 chooses `ConvergenceFailed` when `converged` is false.
        The two mismatching inputs differ only in the irrelevant `extended`
        flag, so this is one wrong table cell, not two rules.
        """
        mismatches = analyze_reason_table(REPO_ROOT).mismatches
        self.assertEqual(len(mismatches), 2)
        self.assertEqual({mismatch.row for mismatch in mismatches}, {"Valid fail"})
        self.assertEqual(
            {
                (
                    mismatch.case.full_pass,
                    mismatch.case.tail_pass,
                    mismatch.case.converged,
                    mismatch.case.extended,
                )
                for mismatch in mismatches
            },
            {(False, False, False, False), (False, False, False, True)},
        )
        self.assertEqual(
            {mismatch.table.reason for mismatch in mismatches},
            {RejectReason.HURDLE_NOT_MET},
        )
        self.assertEqual(
            {mismatch.normative.reason for mismatch in mismatches},
            {RejectReason.CONVERGENCE_FAILED},
        )
        self.assertEqual(
            {mismatch.table.outcome for mismatch in mismatches},
            {Outcome.REJECT},
        )


if __name__ == "__main__":
    unittest.main()
