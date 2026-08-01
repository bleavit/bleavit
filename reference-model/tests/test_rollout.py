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
import re

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


def _plain_markdown(value: str) -> str:
    """Normalize inline presentation without discarding criterion content."""
    without_links = re.sub(r"\[([^]]+)\]\([^)]+\)", r"\1", value)
    without_delimiters = (
        without_links.replace("**", "").replace("`", "").replace("*", "")
    )
    return re.sub(r"\s+", " ", without_delimiters).strip()


def _phase_table_rows(markdown: str) -> tuple[tuple[int, str, str], ...]:
    """Parse every phase name and complete 09 §7.1 entry-criteria cell."""
    try:
        section = markdown.split("### 7.1 Phase table", 1)[1].split("### 7.2", 1)[0]
    except IndexError as error:
        raise AssertionError("09 §7.1 phase-table headings are missing") from error
    rows = []
    for line in section.splitlines():
        if re.match(r"^\|\s*[0-7]\s", line) is None:
            continue
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if len(cells) != 7:
            raise AssertionError(f"phase row has {len(cells)} columns, expected 7")
        phase_cell = _plain_markdown(cells[0])
        match = re.fullmatch(r"(\d+)\s+(.+)", phase_cell)
        if match is None:
            raise AssertionError(f"malformed phase cell {phase_cell!r}")
        rows.append(
            (int(match.group(1)), match.group(2), _plain_markdown(cells[3]))
        )
    return tuple(rows)


EXPECTED_PHASE_ENTRY_COLUMNS = (
    (0, "Reference & simulation", "E1–E8 code-complete"),
    (1, "Local nets", "Phase 0 exit"),
    (
        2,
        "Public testnet (Paseo) + bounties",
        "Phase 1 exit; bounty program funded; ss58 prefix 7777 registry submission "
        "accepted; testnet WSS bootnode set live (≥ 8 browser-reachable across ≥ 4 "
        "operators, ≥ 2 on :443); integration-contract implementation (E15) deployed",
    ),
    (
        3,
        "Mainnet shadow futarchy",
        "audits A+B passed; genesis ceremony; mainnet WSS bootnode set live "
        "(≥ 8/≥ 4 ops/≥ 2 on :443) + 30-day operator served-state commitment in "
        "force; descriptor pipeline live incl. Asset Hub descriptor set; ≥ 3 "
        "registered oracle reporters with full stakes; HRMP channels to Asset Hub "
        "open; funding flow (deposit + withdraw) passing the published XCM test suite",
    ),
    (
        4,
        "Binding PARAM",
        "Phase 3 exit + values ratification of the arming upgrade; NAV ≥ min-viable "
        "NAV(PARAM) (08) — loud gate: arming refused with a published shortfall "
        "figure, never silently",
    ),
    (
        5,
        "+ TREASURY",
        "Phase 4 exit; V_min consistently met; treasury funding ≥ 25M USDC and NAV "
        "≥ min-viable NAV(TREASURY)",
    ),
    (
        6,
        "+ CODE/META",
        "Phase 5 exit; scope-A re-audit; NAV ≥ min-viable NAV(CODE/META) — "
        "because 02 §7.3's bit 3 arms both classes at once, the binding floor is "
        "the higher of the two, META's 21,256,533 USDC; CODE's ≈ 14M is the floor "
        "for one CODE at floor liquidity and is necessary but not sufficient here "
        "(normative values and the SQ-382 resolution: 08 §4.1–§4.2)",
    ),
    (7, "Mature", "Phase 6 exit; entrenched-track confirmation"),
)


EXPECTED_PHASE_GATE_MODEL = (
    (
        0,
        "Reference & simulation",
        (("p0.code-complete", "E1–E8 code-complete", (), None, None),),
    ),
    (1, "Local nets", (("p1.phase0-exit", "Phase 0 exit", (), None, None),)),
    (
        2,
        "Public testnet (Paseo) + bounties",
        (
            ("p2.phase1-exit", "Phase 1 exit", (), None, None),
            ("p2.bounties", "bounty program funded", (), None, None),
            (
                "p2.ss58",
                "ss58 prefix 7777 registry submission accepted",
                (),
                None,
                None,
            ),
            (
                "p2.bootnodes",
                "testnet WSS bootnode set live (>=8, >=4 operators, >=2 on :443)",
                (),
                None,
                None,
            ),
            (
                "p2.contract",
                "integration-contract implementation (E15) deployed",
                (),
                None,
                None,
            ),
        ),
    ),
    (
        3,
        "Mainnet shadow futarchy",
        (
            ("p3.audits", "audits A+B passed", (), None, None),
            ("p3.genesis", "genesis ceremony", (), None, None),
            (
                "p3.bootnodes",
                "mainnet WSS bootnodes and 30-day served-state commitment live",
                (),
                None,
                None,
            ),
            (
                "p3.descriptors",
                "descriptor pipeline live including the Asset Hub descriptor set",
                (),
                None,
                None,
            ),
            (
                "p3.reporters",
                ">=3 registered oracle reporters with full stakes",
                ("orc.n_min", "orc.reporter_stake"),
                None,
                None,
            ),
            (
                "p3.hrmp",
                "Asset Hub HRMP channels open and deposit+withdraw test suite passing",
                ("phase3.tvl_cap", "phase3.deposit_cap"),
                None,
                None,
            ),
        ),
    ),
    (
        4,
        "Binding PARAM",
        (
            ("p4.phase3-exit", "Phase 3 exit", (), None, None),
            (
                "p4.ratification",
                "values ratification of the arming upgrade",
                (),
                None,
                None,
            ),
            (
                "p4.nav-param",
                "spendable NAV >= min-viable NAV(PARAM)",
                ("08.nav_floor.param",),
                D(4_620_989),
                D(4_620_989),
            ),
        ),
    ),
    (
        5,
        "+ TREASURY",
        (
            ("p5.phase4-exit", "Phase 4 exit", (), None, None),
            (
                "p5.v-min",
                "V_min consistently met",
                ("dec.v_min.param", "dec.v_min.treasury"),
                None,
                None,
            ),
            (
                "p5.funding",
                "treasury funding >= 25,000,000 USDC",
                ("08.initial_usdc_funding_target",),
                D(25_000_000),
                None,
            ),
            (
                "p5.nav-treasury",
                "spendable NAV >= min-viable NAV(TREASURY)",
                ("08.nav_floor.treasury",),
                D(7_393_600),
                D(7_393_600),
            ),
        ),
    ),
    (
        6,
        "+ CODE/META",
        (
            ("p6.phase5-exit", "Phase 5 exit", (), None, None),
            ("p6.audit", "scope-A re-audit", (), None, None),
            (
                "p6.nav-code-meta",
                "spendable NAV clears the shared CODE/META arming floor",
                ("08.nav_floor.code", "08.nav_floor.meta"),
                D(21_256_533),
                D(21_256_533),
            ),
        ),
    ),
    (
        7,
        "Mature",
        (
            ("p7.phase6-exit", "Phase 6 exit", (), None, None),
            (
                "p7.entrenched",
                "entrenched-track confirmation",
                (),
                None,
                None,
            ),
        ),
    ),
)


class PhaseGateDataTests(unittest.TestCase):
    """09 §7.1's Entry criteria are present once and carry their numeric reads."""

    def test_complete_entry_criteria_column_matches_09_section_7_1(self):
        doc09 = (
            REPO_ROOT / "docs/architecture/09-execution-upgrades-and-rollout.md"
        ).read_text(encoding="utf-8")
        self.assertEqual(_phase_table_rows(doc09), EXPECTED_PHASE_ENTRY_COLUMNS)

    def test_every_model_criterion_numeric_requirement_and_read_is_pinned(self):
        actual = tuple(
            (
                gate.phase,
                gate.name,
                tuple(
                    (
                        criterion.key,
                        criterion.text,
                        criterion.reads,
                        criterion.cap_requirement,
                        criterion.nav_floor,
                    )
                    for criterion in gate.criteria
                ),
            )
            for gate in PHASE_GATES
        )
        self.assertEqual(actual, EXPECTED_PHASE_GATE_MODEL)

        keys = [criterion.key for gate in PHASE_GATES for criterion in gate.criteria]
        self.assertEqual(len(keys), len(set(keys)))

    def test_every_cap_sensitive_criterion_names_an_08_or_13_input(self):
        for gate in PHASE_GATES:
            for criterion in gate.criteria:
                if criterion.cap_requirement is not None:
                    with self.subTest(criterion=criterion.key):
                        self.assertTrue(criterion.reads)
                    for read in criterion.reads:
                        with self.subTest(criterion=criterion.key, read=read):
                            self.assertTrue(
                                read.startswith("08.") or read.startswith("phase3.")
                            )

    def test_mutating_one_entry_criterion_is_detected(self):
        doc09 = (
            REPO_ROOT / "docs/architecture/09-execution-upgrades-and-rollout.md"
        ).read_text(encoding="utf-8")
        mutated = doc09.replace(
            "bounty program funded", "bounty program waived", 1
        )
        self.assertNotEqual(mutated, doc09)
        self.assertNotEqual(
            _phase_table_rows(mutated),
            EXPECTED_PHASE_ENTRY_COLUMNS,
        )


class PhaseCapCompositionTests(unittest.TestCase):
    """09's global issuance cap is composed with 08's entry requirements."""

    def test_all_four_links_of_the_cap_wedge_are_derived_from_evidence(self):
        doc08 = (
            REPO_ROOT / "docs/architecture/08-treasury-and-economics.md"
        ).read_text(encoding="utf-8")
        doc09 = (
            REPO_ROOT / "docs/architecture/09-execution-upgrades-and-rollout.md"
        ).read_text(encoding="utf-8")
        plain08, plain09 = _plain_markdown(doc08), _plain_markdown(doc09)
        checks = {
            "nav-local-usdc": (
                "NAV = liquid USDC at par" in plain08
                and "VIT holdings: marked 0" in plain08
                and max_attainable_nav(PHASE3_TVL_CAP_DEFAULT)
                == PHASE3_TVL_CAP_DEFAULT
            ),
            "genesis-not-funded": (
                GENESIS_PROTOCOL_USDC
                == GENESIS_PROTOCOL_ACCOUNTS * USDC_MIN_BALANCE
                and GENESIS_PROTOCOL_USDC < TREASURY_FUNDING_TARGET
            ),
            "protocol-global-cap": (
                "global cap on total local USDC issuance" in plain09
            ),
            "gate-before-raise": (
                "Both keys are raised only by phase gates" in plain09
                and not phase_cap_raise_allowed(
                    phase=3,
                    param_armed=False,
                    current=PHASE3_TVL_CAP_DEFAULT,
                    proposed=NAV_FLOORS["param"],
                )
            ),
        }
        self.assertEqual(
            tuple(checks),
            (
                "nav-local-usdc",
                "genesis-not-funded",
                "protocol-global-cap",
                "gate-before-raise",
            ),
        )
        for key, ok in checks.items():
            with self.subTest(link=key):
                self.assertTrue(ok)

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
        ordinary = "ordinary lifecycle progress; freeze/dead-man blocks"
        expected = {
            "T1": "submission; expedited requires a live trigger and CODE phase",
            "T2": ordinary,
            "T3": ordinary,
            "T4": ordinary,
            "T5": ordinary,
            "T6": ordinary,
            "T7": ordinary,
            "T8": "decide-time emergency re-check",
            "T9": "decide-time emergency re-check",
            "T10": "decide-time emergency re-check",
            "T11": ordinary,
            "T12": ordinary,
            "T13": ordinary,
            "T14": "execution item 10 expedited exemption",
            "T15": ordinary,
            "T16": ordinary,
            "T17": "settlement remains live",
            "T18": ordinary,
            "T19": "settlement remains live",
            "T20": "PB-LEDGER-FREEZE force rejection",
            "T21": "settlement remains live",
            "T22": ordinary,
            "T23": "execution item 10 expedited exemption",
            "T24": ordinary,
            "T25": ordinary,
            "T26": ordinary,
        }
        actual = {
            guarded.transition.tag: guarded.guard for guarded in GUARDED_TRANSITIONS
        }
        self.assertEqual(set(actual), set(expected))
        for tag, semantics in expected.items():
            with self.subTest(transition=tag):
                self.assertEqual(actual[tag], semantics)

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

if __name__ == "__main__":
    unittest.main()
