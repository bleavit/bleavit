from __future__ import annotations

from decimal import Decimal, localcontext
from fractions import Fraction
import json
from pathlib import Path
import tempfile
import unittest

from bleavit_simulation.inference import (
    COMMITTED_ARTIFACT,
    FALSE_PASS_GATE,
    ONE_SIDED_ALPHA,
    InferenceError,
    check_attack_status,
    check_confidence,
    read_false_pass_evidence,
    required_n,
    upper_bound,
)


class ClopperPearsonReferenceTests(unittest.TestCase):
    def test_zero_events_matches_the_closed_form(self) -> None:
        """The exact k=0 identity catches the wrong binomial-tail direction."""
        alpha = Decimal("0.05")
        with localcontext() as context:
            context.prec = 80
            for n in (1, 10, 168, 299):
                expected = Decimal(1) - alpha ** (Decimal(1) / Decimal(n))
                self.assertLessEqual(
                    abs(upper_bound(0, n, alpha) - expected), Decimal("1e-23")
                )

    def test_complementary_extreme_counts_are_symmetric(self) -> None:
        """Binomial success/failure reflection must survive the inversion."""
        alpha = Decimal("0.05")
        for n in (3, 10, 31):
            upper_at_n_minus_one = upper_bound(n - 1, n, alpha)
            reflected_zero_bound = Decimal(1) - upper_bound(
                0, n, Decimal(1) - alpha
            )
            self.assertLessEqual(
                abs(upper_at_n_minus_one - reflected_zero_bound),
                Decimal("1e-23"),
            )

    def test_textbook_beta_quantile_value_is_reproduced(self) -> None:
        """Beta(6, 95)'s 95th percentile is 0.1023 to four places."""
        self.assertLess(
            abs(upper_bound(5, 100, Decimal("0.05")) - Decimal("0.1023")),
            Decimal("0.0001"),
        )

    def test_all_events_has_unit_upper_bound(self) -> None:
        self.assertEqual(upper_bound(12, 12, ONE_SIDED_ALPHA), Decimal(1))


class ClopperPearsonPropertyTests(unittest.TestCase):
    def test_fixed_event_count_tightens_with_more_trials(self) -> None:
        bounds = [upper_bound(2, n, ONE_SIDED_ALPHA) for n in (20, 40, 80, 160)]
        self.assertTrue(all(left > right for left, right in zip(bounds, bounds[1:])))

    def test_fixed_denominator_loosens_with_more_events(self) -> None:
        bounds = [upper_bound(k, 80, ONE_SIDED_ALPHA) for k in range(6)]
        self.assertTrue(all(left < right for left, right in zip(bounds, bounds[1:])))

    def test_invalid_counts_and_inexact_inputs_refuse(self) -> None:
        for args in ((-1, 10), (11, 10), (0, 0), (True, 10)):
            with self.subTest(args=args), self.assertRaises(InferenceError):
                upper_bound(*args)
        with self.assertRaises(InferenceError):
            upper_bound(0, 10, 0.05)


class RequiredDenominatorTests(unittest.TestCase):
    def test_zero_event_plan_first_clears_at_299(self) -> None:
        required = required_n(ONE_SIDED_ALPHA, FALSE_PASS_GATE, Fraction(0))
        self.assertEqual(required, 299)
        self.assertGreaterEqual(
            upper_bound(0, required - 1, ONE_SIDED_ALPHA), Decimal("0.01")
        )
        self.assertLess(
            upper_bound(0, required, ONE_SIDED_ALPHA), Decimal("0.01")
        )

    def test_committed_rates_produce_adverse_rounded_sampling_targets(self) -> None:
        rows = read_false_pass_evidence()
        targets = {
            row.proposal_class: required_n(
                ONE_SIDED_ALPHA, FALSE_PASS_GATE, row.point_rate
            )
            for row in rows
        }
        self.assertEqual(
            targets,
            {"param": 299, "treasury": 473, "code": 473, "meta": 1_568},
        )
        meta = next(row for row in rows if row.proposal_class == "meta")
        previous_n = targets["meta"] - 1
        scaled_count = meta.point_rate * previous_n
        previous_k = -(-scaled_count.numerator // scaled_count.denominator)
        self.assertGreaterEqual(
            upper_bound(previous_k, previous_n, ONE_SIDED_ALPHA), Decimal("0.01")
        )

    def test_rate_at_or_above_gate_cannot_be_sampled_into_a_pass(self) -> None:
        for rate in (FALSE_PASS_GATE, Fraction(2, 100)):
            with self.subTest(rate=rate), self.assertRaises(InferenceError):
                required_n(ONE_SIDED_ALPHA, FALSE_PASS_GATE, rate)


class ArtifactReaderTests(unittest.TestCase):
    def test_reader_uses_artifact_counts_instead_of_module_constants(self) -> None:
        payload = json.loads(COMMITTED_ARTIFACT.read_text(encoding="utf-8"))
        payload["metrics"]["param"]["decidable_harm"] = 200
        payload["metrics"]["param"]["decidable_harm_false_pass_count"] = 2
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "calibration.json"
            path.write_text(json.dumps(payload), encoding="utf-8")
            param = read_false_pass_evidence(path)[0]
        self.assertEqual((param.false_passes, param.decidable_harm), (2, 200))
        self.assertEqual(param.point_rate, Fraction(1, 100))

    def test_impossible_artifact_counts_refuse(self) -> None:
        payload = json.loads(COMMITTED_ARTIFACT.read_text(encoding="utf-8"))
        payload["metrics"]["code"]["decidable_harm_false_pass_count"] = 743
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "calibration.json"
            path.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaisesRegex(InferenceError, "exceed"):
                read_false_pass_evidence(path)


class CommittedArtifactConfidenceTests(unittest.TestCase):
    def test_point_rates_reproduce_but_two_upper_bounds_do_not_clear(self) -> None:
        """SQ-550: 15 §4.9 publishes four point rates below 1 %.

        Exact one-sided 95 % bounds say PARAM and META remain statistically
        compatible with a rate at or above the gate; this is a sampling gap,
        not a retroactive change to the normative Phase-0 criterion.
        """
        findings = check_confidence()
        self.assertEqual(
            {
                row.proposal_class: (
                    row.false_passes,
                    row.decidable_harm,
                    format(row.upper, ".6f"),
                    row.ok,
                )
                for row in findings
            },
            {
                "param": (0, 168, "0.017674", False),
                "treasury": (1, 688, "0.006876", True),
                "code": (1, 742, "0.006377", True),
                "meta": (4, 711, "0.012828", False),
            },
        )
        self.assertEqual(
            {
                row.proposal_class: format(
                    Decimal(row.false_passes) / Decimal(row.decidable_harm),
                    ".6f",
                )
                for row in findings
            },
            {
                "param": "0.000000",
                "treasury": "0.001453",
                "code": "0.001348",
                "meta": "0.005626",
            },
        )
        self.assertTrue(all(row.point_rate < FALSE_PASS_GATE for row in findings))

    def test_structured_findings_name_each_independent_class(self) -> None:
        findings = check_confidence()
        self.assertEqual(len({row.key for row in findings}), 4)
        self.assertEqual(
            [row.proposal_class for row in findings],
            ["param", "treasury", "code", "meta"],
        )


class AttackStatusTests(unittest.TestCase):
    def test_empty_profitable_brackets_are_not_no_causal_observations(self) -> None:
        """SQ-550: the per-class status says no causal wrong-PASS was observed.

        The artifact instead records 62 causal wrong-PASS candidates and
        dispositions every one as unprofitable; the status confuses an empty
        profitable-bracket set with an empty measurement set.
        """
        findings = check_attack_status()
        self.assertEqual(
            {
                row.proposal_class: (
                    row.causal_wrong_passes,
                    row.unprofitable_wrong_passes,
                    row.profitable_brackets,
                    row.noncausal_dispositions,
                )
                for row in findings
            },
            {
                "param": (3, 3, 0, 0),
                "treasury": (7, 7, 0, 0),
                "code": (25, 25, 0, 0),
                "meta": (27, 27, 0, 0),
            },
        )
        self.assertEqual(sum(row.causal_wrong_passes for row in findings), 62)
        self.assertTrue(
            all(
                row.published_status == "no_causal_wrong_pass_observed"
                and row.expected_status == "all_candidates_unprofitable"
                and not row.ok
                for row in findings
            )
        )


if __name__ == "__main__":
    unittest.main()
