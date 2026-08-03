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

import contextlib
import unittest
from fractions import Fraction
from pathlib import Path
import tempfile

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
    WelfareHurdleCase,
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
    ordered_welfare_decision,
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

_ARCHITECTURE = {
    "doc_05": "05-welfare-and-decision-engine.md",
    "doc_09": "09-execution-upgrades-and-rollout.md",
    "doc_11": "11-frontend-workflows.md",
}

# Anchors for the SQ-552 witnesses. Kept as module constants so a document edit that
# moves them fails one obvious place rather than three tests with three stack traces.
_FE_ROW_13 = (
    "| 13. Batch bounds | decoded batch \u2264 16 calls, \u2264 64 KiB, declared weight "
    "\u2264 25% block limit *(normative values: [13](13-parameters.md))*; SafetyFilter "
    "closure over nested wrappers incl. `proxy_announced`, `as_multi_threshold_1` "
    "(static check on the preimage) |"
)
_FE_ROW_14 = (
    "| 14. **Descriptor lead time (CODE/META)** | `now \u2265 authorized_at + "
    "DescriptorLeadTime` (43,200 blocks = 72 h *(normative value: "
    "[13](13-parameters.md))*) per D-14/[09](09-execution-upgrades-and-rollout.md) |"
)
_VALID_FAIL_UNCONVERGED = (
    "| Valid fail \u2014 hurdle missed, series not converged | \u2714 | \u2714 | "
    "\u2714 | \u2714 | \u2714 | \u2718 | \u2718 | \u2718 | \u2013 | \u2013 | "
    "\u2013 | Reject(ConvergenceFailed) |"
)
_VALID_FAIL_UNCONVERGED_WRONG = _VALID_FAIL_UNCONVERGED.replace(
    "Reject(ConvergenceFailed)", "Reject(HurdleNotMet)"
)


@contextlib.contextmanager
def _mutated_repo(**edits: tuple[str, str]):
    """A temp repo whose architecture documents carry one exact edit each.

    Every SQ-552 witness below works the same way: put the repaired defect back and
    require the checker to catch it. That direction matters more than it looks. These
    tests were originally written the other way round \u2014 assert the defect on the live
    documents, and apply a *hypothetical* repair in a temp copy \u2014 which meant that
    ruling SQ-552 and repairing the spec turned all of them red at once, including the
    positive controls, whose anchor strings had ceased to exist.

    A missing anchor is therefore an error here, not a silent no-op: a witness that
    mutates nothing passes without testing anything, which is the exact failure these
    witnesses exist to rule out one level down.
    """
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        architecture = root / "docs/architecture"
        architecture.mkdir(parents=True)
        for key, name in _ARCHITECTURE.items():
            source = (REPO_ROOT / "docs/architecture" / name).read_text(encoding="utf-8")
            if key in edits:
                old, new = edits[key]
                if old not in source:
                    raise AssertionError(
                        f"witness anchor absent from {name}: {old[:60]!r}\u2026 \u2014 the "
                        "mutation would be a no-op and the test would pass vacuously"
                    )
                source = source.replace(old, new, 1)
            (architecture / name).write_text(source, encoding="utf-8")
        yield root


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
        for epoch, count in enumerate(run.live_counts[4:], start=4):
            with self.subTest(epoch=epoch):
                self.assertEqual(count, MAX_NON_TERMINAL_COHORTS)

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

    def test_the_documents_publish_thirteen_backend_and_thirteen_frontend_rows(self):
        backend = backend_execute_checks(REPO_ROOT)
        frontend = frontend_execute_checks(REPO_ROOT)
        self.assertEqual([check.index for check in backend], list(range(1, 14)))
        self.assertEqual([check.index for check in frontend], list(range(1, 14)))
        self.assertEqual((backend[0].name, backend[-1].name), ("Queue state", "Record"))
        self.assertEqual(
            (frontend[0].name, frontend[-1].name),
            ("Queued, not cancelled", "Batch bounds"),
        )

    def test_the_residual_non_bijection_is_exactly_the_structural_one(self):
        """SQ-552 resolved. What is left is splits and effects, not a stray row.

        The documents claimed lockstep and were not bijective. After the ruling the
        residual difference is entirely accounted for: backend items 1 and 10 each
        split into two frontend rows, and items 12–13 are the *effects* of passing
        (dispatch, record), which have nothing to pre-check. The one row that was a
        real defect — FE 14, an `apply_authorized_upgrade` check owned by 09 §2.2,
        gating `execute` on a clock `execute` itself starts — is gone.
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
            },
        )
        self.assertEqual(mismatches["backend:1:split"].frontend_rows, (1, 2))
        self.assertEqual(mismatches["backend:10:split"].frontend_rows, (11, 12))

    def test_reinstating_frontend_row_14_is_caught(self):
        """Witness. The deleted row must still be detectable if it comes back.

        A checker is only worth its green run if it can go red. `_FRONTEND_CHECK_ATOMS`
        deliberately retains its entry for index 14 so this witness parses rather than
        raising `ScheduleError` — the classification is kept alive precisely so the
        defect stays reproducible.
        """
        with _mutated_repo(doc_11=(_FE_ROW_13, f"{_FE_ROW_13}\n{_FE_ROW_14}")) as root:
            diff = execute_checklist_diff(root)
        mismatches = {finding.key: finding for finding in diff.mismatches}
        self.assertIn("frontend:14:unmatched", mismatches)
        self.assertIn(
            "apply_authorized_upgrade", mismatches["frontend:14:unmatched"].why
        )

    def test_every_named_terminal_reason_is_a_frozen_02_reason(self):
        """SQ-552 resolved. No checklist row names a reason 02 §4 cannot construct."""
        findings = check_execute_reject_reasons(REPO_ROOT)
        self.assertTrue(findings)
        for finding in findings:
            with self.subTest(document=finding.document, row=finding.row):
                self.assertTrue(finding.ok)
                self.assertIn(finding.reason, frozen_reject_reasons())

    def test_superseded_wording_is_quoted_without_being_claimed(self):
        """The repair's own sentence contains the string it repudiates.

        09 §1.2(11) explains that `Rejected(BadPreimage)` named nothing constructable,
        and to explain that it has to *write* `Rejected(BadPreimage)`. A parser that
        greps for the shape of a claim cannot tell a quotation from an assertion, so
        repairing the document created a fresh finding out of the repair.

        The convention is the strike-through: dead wording reads as dead to a human
        and is excluded mechanically. Both halves are asserted here — the string is
        present in the document, and absent from the parsed claims — because either
        one alone is satisfied by the wrong outcome.
        """
        doc09 = (REPO_ROOT / "docs/architecture/09-execution-upgrades-and-rollout.md")
        text = doc09.read_text(encoding="utf-8")
        self.assertIn("~~`Rejected(BadPreimage)`~~", text)
        item11 = next(
            check for check in backend_execute_checks(REPO_ROOT) if check.index == 11
        )
        self.assertNotIn("BadPreimage", item11.reject_reasons)
        self.assertEqual(checklist_t16_causes(REPO_ROOT), frozenset(T16_CAUSES))

    def test_unstriking_the_superseded_wording_is_caught(self):
        """Witness. Without the marker the repudiated claim reads as live again."""
        with _mutated_repo(
            doc_09=("~~`Rejected(BadPreimage)`~~", "`Rejected(BadPreimage)`")
        ) as root:
            invalid = [
                finding for finding in check_execute_reject_reasons(root)
                if not finding.ok
            ]
            t16 = t16_cause_diff(root)
        self.assertEqual(len(invalid), 1)
        self.assertEqual((invalid[0].document, invalid[0].row), ("09 §1.2", 11))
        self.assertEqual(invalid[0].reason, "BadPreimage")
        self.assertFalse(t16.ok)
        self.assertEqual(t16.checklist_only, frozenset({"BadPreimage"}))

    def test_bad_preimage_disposition_is_queued_then_expired_at_t15(self):
        """SQ-552. The ruling's substance, independent of how the doc words it.

        `BadPreimage` is a `pallet_execution_guard::Error`, not a frozen `RejectReason`:
        the dispatch errors, the storage layer rolls back, and the proposal stays
        `Queued` until T15 records `Expired` at grace end. Asserted on the reason
        string rather than on a live finding, so the claim survives the document being
        repaired — which is the point, since the repair is what removed the finding.
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

    def test_t16_reason_sets_agree_in_both_directions(self):
        """SQ-552 resolved. The derived T16 set and 05 §2.1's now match exactly."""
        finding = t16_cause_diff(REPO_ROOT)
        self.assertTrue(finding.ok)
        self.assertEqual(finding.checklist_only, frozenset())
        self.assertEqual(finding.transition_only, frozenset())


class TestReasonCodeTruthTable(unittest.TestCase):
    """05 §5.5's table structure and its steps-6–8 diff against §5.4."""

    def test_the_published_table_parses_as_twenty_five_rows_by_eleven_steps(self):
        rows = reason_table_rows(REPO_ROOT)
        self.assertEqual(len(rows), 25)
        for row in rows:
            with self.subTest(scenario=row.scenario):
                self.assertEqual(len(row.steps), 11)
        derived = ordered_welfare_decision(
            WelfareHurdleCase(False, False, False, False)
        )
        self.assertEqual(derived.outcome, Outcome.REJECT)
        self.assertEqual(derived.reason, RejectReason.CONVERGENCE_FAILED)

    def test_the_hurdle_partition_is_total_deterministic_and_non_overlapping(self):
        analysis = analyze_reason_table(REPO_ROOT)
        self.assertEqual(analysis.case_count, 16)
        self.assertTrue(analysis.total)
        self.assertTrue(analysis.deterministic)
        self.assertTrue(analysis.non_overlapping)
        self.assertEqual(analysis.uncovered, ())
        self.assertEqual(analysis.overlaps, ())
        self.assertEqual(analysis.nondeterministic, ())

    def test_the_split_valid_fail_rows_agree_with_normative_5_4(self):
        """SQ-552 resolved. §5.5's reasons now match §5.4 on all 16 cases.

        The superseded one-line `Valid fail` row published `HurdleNotMet` whenever both
        windows failed, but §5.4 dispatches on the *triple* and returns
        `ConvergenceFailed` when the series has not converged. Two rows replaced it, and
        the partition is checked as a whole rather than at that cell — a repair that
        fixed the reason and opened a coverage hole would pass a cell-level assertion.
        """
        analysis = analyze_reason_table(REPO_ROOT)
        self.assertEqual(analysis.mismatches, ())
        scenarios = {row.scenario for row in reason_table_rows(REPO_ROOT)}
        self.assertIn("Valid fail — hurdle missed, series converged", scenarios)
        self.assertIn("Valid fail — hurdle missed, series not converged", scenarios)
        self.assertNotIn("Valid fail", scenarios)

    def test_a_wrong_reason_in_a_split_row_is_caught(self):
        """Witness. Re-introduce SQ-552's defect in the live row shape.

        Deliberately mutates the *current* row rather than restoring the old one-line
        row: what needs proving is that this parser, as it stands, still detects a
        non-converged failure published as `HurdleNotMet`. A witness that replays a
        shape the module no longer parses would prove nothing about the module.
        """
        with _mutated_repo(
            doc_05=(_VALID_FAIL_UNCONVERGED, _VALID_FAIL_UNCONVERGED_WRONG)
        ) as root:
            analysis = analyze_reason_table(root)
        self.assertEqual(len(analysis.mismatches), 2)
        self.assertEqual(
            {mismatch.row for mismatch in analysis.mismatches},
            {"Valid fail — hurdle missed, series not converged"},
        )
        self.assertEqual(
            {
                (case.full_pass, case.tail_pass, case.converged, case.extended)
                for case in (mismatch.case for mismatch in analysis.mismatches)
            },
            {(False, False, False, False), (False, False, False, True)},
        )
        self.assertEqual(
            {mismatch.normative.reason for mismatch in analysis.mismatches},
            {RejectReason.CONVERGENCE_FAILED},
        )


if __name__ == "__main__":
    unittest.main()
