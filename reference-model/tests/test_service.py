"""Executable checks for architecture 16 §4–§6.4 and §11."""

from __future__ import annotations

import unittest
from decimal import Decimal, ROUND_CEILING, localcontext

from bleavit_reference_model.service import (
    ORC_BOND_BPS_MAX,
    ORC_ROUNDS_MAX,
    REG_BOND_MILESTONE,
    SUCCESS_EDGE,
    TERMINAL_STATES,
    VOIDABLE_STATES,
    WORK_PREC,
    AttestorMedian,
    AttestorReport,
    ManipulationBook,
    Question,
    QuestionState,
    ReportDraft,
    ServiceError,
    ServiceModelError,
    SettlementTrust,
    VoidReason,
    assemble_report,
    attestor_median,
    b_min,
    b_min_multiple,
    certified,
    coverage_bps,
    manip_floor,
    minimum_bond_bps,
    outgoing_states,
    quorum,
    settlement_bond,
)

D = Decimal
NAMED_ATTESTORS = (bytes([1]) * 32, bytes([2]) * 32, bytes([3]) * 32)


def attestor_report(attestor_byte: int, value: str) -> AttestorReport:
    return AttestorReport(bytes([attestor_byte]) * 32, D(value))


class LifecycleTests(unittest.TestCase):
    def test_only_two_terminal_states_and_no_nonterminal_is_stranded(self):
        self.assertEqual(
            TERMINAL_STATES,
            frozenset({QuestionState.SETTLED, QuestionState.VOIDED}),
        )
        self.assertEqual(VOIDABLE_STATES, frozenset(SUCCESS_EDGE))
        for state in QuestionState:
            outgoing = outgoing_states(state)
            if state in TERMINAL_STATES:
                self.assertEqual(outgoing, frozenset())
            else:
                self.assertEqual(
                    outgoing,
                    frozenset({SUCCESS_EDGE[state], QuestionState.VOIDED}),
                )

    def test_every_path_from_registered_reaches_exactly_one_terminal(self):
        paths: list[tuple[QuestionState, ...]] = []

        def walk(path: tuple[QuestionState, ...]) -> None:
            state = path[-1]
            if state in TERMINAL_STATES:
                paths.append(path)
                return
            for target in outgoing_states(state):
                self.assertNotIn(target, path)
                walk(path + (target,))

        walk((QuestionState.REGISTERED,))
        self.assertEqual(len(paths), 4)  # VOID at each phase, or SETTLED.
        for path in paths:
            self.assertIn(path[-1], TERMINAL_STATES)
            self.assertEqual(sum(state in TERMINAL_STATES for state in path), 1)

    def test_sealed_void_preserves_the_delivered_report(self):
        trust = SettlementTrust.from_attestors(
            NAMED_ATTESTORS, D(30_000)
        )
        draft = ReportDraft(
            11, 7, bytes([4]) * 32, 500_000_000, 500_000_000, 100,
            10, 110, D(10_000), D(10_000), D(500), 37_500_000, trust,
        )
        hasher = lambda fields: repr(fields).encode("utf-8")
        report = assemble_report(draft, 0, 16, hasher)
        sealed = Question(11).advance().advance(report=report)
        voided = sealed.void(VoidReason.CLIENT_VANISHED)
        self.assertEqual(voided.state, QuestionState.VOIDED)
        self.assertIs(voided.report, report)
        self.assertTrue(voided.report.verifies(hasher))
        with self.assertRaises(ServiceModelError):
            Question(12).advance().advance(report=report)


class ManipulationBoundTests(unittest.TestCase):
    def _books(self, b: str = "10000") -> tuple[ManipulationBook, ...]:
        return (
            ManipulationBook(D(b), D("0.5")),
            ManipulationBook(D(b), D("0.5")),
        )

    def test_b_min_table_is_derived_and_rounded_up(self):
        expected = {
            D("0.02"): (D("36.7448973924"), D("36.75"), D("36.744898")),
            D("0.05"): (D("14.2368323715"), D("14.24"), D("14.236833")),
            D("0.10"): (D("6.7221301765"), D("6.73"), D("6.722131")),
        }
        for epsilon, (prefix, displayed, base_unit_result) in expected.items():
            with self.subTest(epsilon=epsilon):
                multiple = b_min_multiple(epsilon)
                self.assertEqual(str(multiple)[: len(str(prefix))], str(prefix))
                self.assertEqual(
                    multiple.quantize(D("0.01"), rounding=ROUND_CEILING), displayed
                )
                self.assertEqual(b_min(D(1), epsilon), base_unit_result)
                floor = manip_floor(
                    self._books(str(base_unit_result)), epsilon, D(0), D(16)
                )
                self.assertTrue(certified(floor, D(1)))
                lower = base_unit_result - D("0.000001")
                self.assertFalse(
                    certified(manip_floor(self._books(str(lower)), epsilon, 0, 16), D(1))
                )

    def test_cash_cost_at_the_three_published_epsilons(self):
        self.assertEqual(
            manip_floor(self._books(), D("0.02"), 0, 16), D("816.439890")
        )
        self.assertEqual(
            manip_floor(self._books(), D("0.05"), 0, 16), D("2107.210313")
        )
        self.assertEqual(
            manip_floor(self._books(), D("0.10"), 0, 16), D("4462.871026")
        )

    def test_sq_544_cash_cost_is_not_the_superseded_displacement(self):
        epsilon = D("0.0375")
        cash = manip_floor(self._books(), epsilon, 0, 16)
        with localcontext() as ctx:
            ctx.prec = WORK_PREC
            old_share_count = D(2) * D(10_000) * (
                ((D("0.5") + epsilon) * D("0.5"))
                / ((D("0.5") - epsilon) * D("0.5"))
            ).ln()
        self.assertEqual(cash, D("1559.230829"))
        ratio = old_share_count / cash
        self.assertGreater(ratio, D("1.9"))
        self.assertEqual(ratio.quantize(D("0.001")), D("1.928"))
        self.assertFalse(certified(cash, D("50000")))

    def test_hold_leg_applies_the_flow_ceiling_before_epsilon(self):
        displacement = manip_floor(self._books("100"), D("0.10"), 0, 1)
        capped = manip_floor(self._books("100"), D("0.10"), 1000, 1)
        self.assertEqual(capped - displacement, D("20.000000"))

    def test_invalid_claim_inputs_refuse(self):
        with self.assertRaises(ServiceModelError):
            manip_floor(self._books(), D(0), 0, 16)
        with self.assertRaises(ServiceModelError):
            b_min(1, D("0.5"))


class SettlementTests(unittest.TestCase):
    def test_quorum_is_ceil_half_after_the_three_attestor_floor(self):
        with self.assertRaises(ServiceModelError):
            quorum(2)
        self.assertEqual([quorum(n) for n in (3, 4, 5)], [2, 2, 3])

    def test_median_survives_one_deviant_and_marks_it_for_slashing(self):
        result = attestor_median(
            NAMED_ATTESTORS,
            (
                attestor_report(1, "0.4"),
                attestor_report(2, "0.9"),
                attestor_report(3, "0.4"),
            ),
            D("0.01"),
        )
        self.assertEqual(
            result,
            AttestorMedian(
                D("0.4"), 2, D("0.01"), (True, False, True)
            ),
        )
        self.assertEqual(result.slashable_indices, (1,))

    def test_quorum_survives_one_absence_and_even_median_floors_to_the_grid(self):
        """16 §6.3 ruling (1): the even-quorum midpoint floors to the 1e9 grid.

        This fixture is chosen so the raw midpoint lands *off* the grid —
        (0.4 + 0.600000001) / 2 = 0.5000000005 — because that is the only case
        where the ruling is observable. The unfloored value is not a
        representable settlement value at all, so a model returning it would
        certify behaviour the chain cannot express and could classify a
        submission inside or outside tolerance differently from the runtime.
        """
        result = attestor_median(
            NAMED_ATTESTORS,
            (attestor_report(1, "0.4"), attestor_report(2, "0.600000001")),
            D("0.2"),
        )
        self.assertEqual(result.value, D("0.500000000"))
        self.assertEqual(result.slashable_indices, ())

    def test_quorum_or_out_of_range_median_refuses(self):
        with self.assertRaises(ServiceModelError):
            attestor_median(
                NAMED_ATTESTORS, (attestor_report(1, "0.5"),), D("0.01")
            )
        with self.assertRaises(ServiceModelError):
            attestor_median(
                NAMED_ATTESTORS,
                (attestor_report(1, "1.1"), attestor_report(2, "1.2")),
                D("0.01"),
            )

    def test_duplicate_or_unnamed_submissions_cannot_form_quorum(self):
        with self.assertRaises(ServiceModelError):
            attestor_median(
                NAMED_ATTESTORS,
                (attestor_report(1, "0.4"), attestor_report(1, "0.6")),
                D("0.01"),
            )
        with self.assertRaises(ServiceModelError):
            attestor_median(
                NAMED_ATTESTORS,
                (attestor_report(1, "0.4"), attestor_report(9, "0.6")),
                D("0.01"),
            )

    def test_terminal_stack_bond_and_the_four_round_coverage_claim(self):
        # 16 §6.1's formerly-withdrawn "unsatisfiable" claim is false:
        # 10,000 bps / (2^4-1) needs 667 bps, within the 1,000-bps hard max.
        required = minimum_bond_bps(10_000, ORC_ROUNDS_MAX)
        self.assertEqual(required, 667)
        self.assertLessEqual(required, ORC_BOND_BPS_MAX)
        self.assertGreaterEqual(coverage_bps(ORC_ROUNDS_MAX, required), 10_000)
        self.assertLess(coverage_bps(ORC_ROUNDS_MAX, required - 1), 10_000)

        # Default coverage is (2^3-1)*250 = 1,750 bps.  The floor binds at
        # 10,000 USDC escrow; the scaled leg binds at 400,000.
        self.assertEqual(settlement_bond(10_000), REG_BOND_MILESTONE)
        self.assertEqual(settlement_bond(400_000), D("70000.000000"))


class ReportTests(unittest.TestCase):
    @staticmethod
    def _hasher(fields: tuple[object, ...]) -> bytes:
        # The specification fixes the binding set, not a hash algorithm.  This
        # injective test token checks the boundary without inventing one.
        return repr(fields).encode("utf-8")

    def _draft(self) -> ReportDraft:
        trust = SettlementTrust.from_attestors(
            NAMED_ATTESTORS, D(30_000)
        )
        return ReportDraft(
            question_id=9,
            client_id=7,
            sub_id=bytes([4]) * 32,
            twap_accept_1e9=500_000_000,
            twap_reject_1e9=500_000_000,
            observations=4_320,
            window_start=10,
            window_end=43_210,
            b_accept=D(10_000),
            b_reject=D(10_000),
            declared_stake=D(500),
            epsilon_1e9=37_500_000,
            settlement_trust=trust,
        )

    def test_report_assembly_binds_every_published_field(self):
        report = assemble_report(self._draft(), 0, 16, self._hasher)
        self.assertEqual(report.manip_floor, D("1559.230829"))
        self.assertTrue(report.certified)
        self.assertEqual(report.settlement_trust.quorum, 2)
        self.assertTrue(report.verifies(self._hasher))
        self.assertIn(report.sub_id, report.provenance_fields())

    def test_reject_leg_uses_short_price(self):
        draft = self._draft()
        draft = ReportDraft(
            **{
                **draft.__dict__,
                "twap_accept_1e9": 400_000_000,
                "twap_reject_1e9": 600_000_000,
            }
        )
        report = assemble_report(draft, 0, 16, self._hasher)
        expected = manip_floor(
            (
                ManipulationBook(D(10_000), D("0.4")),
                ManipulationBook(D(10_000), D("0.4")),
            ),
            D("0.0375"),
            0,
            16,
        )
        self.assertEqual(report.manip_floor, expected)

    def test_duplicate_attestors_do_not_form_a_named_set(self):
        account = bytes([1]) * 32
        with self.assertRaises(ServiceModelError):
            SettlementTrust.from_attestors((account, account, bytes([2]) * 32), 10)


class ErrorSurfaceTests(unittest.TestCase):
    def test_every_section_11_error_has_a_distinct_value(self):
        expected = (
            "NotRegistered", "ClientRemoved", "ServicePaused", "ServiceRateUnset",
            "CertificationUnavailable", "StakeBelowFloor", "SubsidyBelowMinimum",
            "EpsilonOutOfRange", "WindowTooLong", "WindowTooShort",
            "WindowCollidesWithDecision", "SlotsExhausted", "TvlCapWouldBind",
            "AttestorSetTooSmall", "AttestorBondInsufficient",
            "ClientIsProtocolAccount", "EscrowInsufficient", "NotSealed",
            "AlreadySealed", "AlreadyTerminal", "QuorumNotReached",
            "MedianOutOfRange", "DeadlineNotReached", "UnknownQuestion",
        )
        actual = tuple(error.value for error in ServiceError)
        self.assertEqual(actual, expected)
        self.assertEqual(len(actual), len(set(actual)))


if __name__ == "__main__":
    unittest.main()
