"""05 §4.6 normalization kernel — the reference model's half of SQ-502.

§4.6 fixes four steps (trailing-12 winsorization at the type-7 p5/p95, `log1p`
for the heavy-tailed series, the min–max map, and the cold-start sample rule)
and the SQ-502 amendment fixes the three choices that decide whether two
conforming implementations agree bit-for-bit: the `log1p` grid, what the
transform is applied to, and what a zero-width range does. Every assertion here
is derived from that text, not from the Rust core — the corpus replay in
`crates/welfare-core/tests/normalization_vectors.rs` is where the two meet.
"""

from __future__ import annotations

import json
import unittest
from decimal import Decimal
from pathlib import Path

from bleavit_reference_model.welfare import (
    apply_normalization,
    floor_fixed,
    is_log1p_series,
    log1p,
    minmax_normalize,
    normalization_constants,
    normalization_sample,
    normalize_metric,
    percentile,
    winsorize,
)

PRIORS = [Decimal(i) for i in range(12)]


class NormalizationTest(unittest.TestCase):
    def test_type7_percentile_interpolates_rather_than_degenerating(self):
        # 05 §4.6: rank 1 + f·(n−1) on the ascending sample. On the 12-element
        # window p5 lands between x₁ and x₂, p95 between x₁₁ and x₁₂ — the
        # nearest-rank estimator would have returned the sample min and max.
        self.assertEqual(percentile(PRIORS, Decimal("0.05")), Decimal("0.55"))
        self.assertEqual(percentile(PRIORS, Decimal("0.95")), Decimal("10.45"))
        self.assertNotEqual(percentile(PRIORS, Decimal("0.05")), min(PRIORS))
        self.assertNotEqual(percentile(PRIORS, Decimal("0.95")), max(PRIORS))
        # The endpoints are the extreme order statistics exactly.
        self.assertEqual(percentile(PRIORS, Decimal(0)), Decimal(0))
        self.assertEqual(percentile(PRIORS, Decimal(1)), Decimal(11))

    def test_percentile_is_order_insensitive_and_total(self):
        self.assertEqual(
            percentile(list(reversed(PRIORS)), Decimal("0.05")),
            percentile(PRIORS, Decimal("0.05")),
        )
        with self.assertRaises(ValueError):
            percentile([], Decimal("0.05"))
        with self.assertRaises(ValueError):
            percentile(PRIORS, Decimal("1.5"))

    def test_cold_start_displaces_priors_oldest_first(self):
        # n = 0: the genesis prior verbatim (05 §4.6, "s is deterministically
        # computable from epoch 1").
        self.assertEqual(normalization_sample(PRIORS, []), PRIORS)
        # n = 1: the oldest pseudo-observation goes first.
        self.assertEqual(
            normalization_sample(PRIORS, [Decimal(99)]),
            PRIORS[1:] + [Decimal(99)],
        )
        # n = 12: fully real, the prior gone, no discontinuity in mechanism.
        real = [Decimal(20 + i) for i in range(12)]
        self.assertEqual(normalization_sample(PRIORS, real), real)
        # Past the window the oldest *real* values fall out too.
        self.assertEqual(
            normalization_sample(PRIORS, real + [Decimal(50)]),
            real[1:] + [Decimal(50)],
        )
        with self.assertRaises(ValueError):
            normalization_sample(PRIORS[:11], [])

    def test_log1p_is_evaluated_on_the_64x64_grid(self):
        # 05 §4.6 rule 1: `ln(1 + x)` with the value entering 64.64 through the
        # §4.4 conversion and the result floored back onto the 1e9 grid.
        self.assertEqual(log1p(Decimal(0)), Decimal(0))
        self.assertEqual(log1p(Decimal(1)), Decimal("0.693147180"))
        self.assertEqual(log1p(Decimal("0.55")), Decimal("0.438254930"))
        # Monotone and sublinear (`ln(1 + x) ≤ x`), which is what compresses a
        # heavy tail rather than rescaling it.
        previous = Decimal(-1)
        for raw in ["0", "0.000000001", "0.5", "1", "10", "1000", "1000000"]:
            value = log1p(Decimal(raw))
            self.assertGreaterEqual(value, previous)
            self.assertLessEqual(value, floor_fixed(Decimal(raw)))
            previous = value

    def test_a_zero_width_range_fails_closed(self):
        # 05 §4.6 rule 3: refuse, never resolve to the adopt-favourable 1.0.
        with self.assertRaises(ValueError):
            minmax_normalize(Decimal(1), Decimal(1), Decimal(1))
        with self.assertRaises(ValueError):
            normalization_constants([Decimal(7)] * 12)
        with self.assertRaises(ValueError):
            normalize_metric(Decimal(7), [Decimal(7)] * 12, [])
        # And the same refusal reached *through* the transform: three 1e-9 units
        # of raw spread that `log1p` compresses onto one grid point at this
        # magnitude. The identical sample normalizes fine under the linear map,
        # so it is the transform collapsing the range, not a constant series.
        narrow = (
            [Decimal("5.000000000")] * 2
            + [Decimal("5.000000002")] * 8
            + [Decimal("5.000000003")] * 2
        )
        self.assertIsNotNone(normalization_constants(narrow, False))
        with self.assertRaises(ValueError):
            normalization_constants(narrow, True)

    def test_winsorization_is_idempotent_and_a_clip(self):
        once = winsorize(PRIORS, Decimal(2), Decimal(9))
        self.assertEqual(once, winsorize(once, Decimal(2), Decimal(9)))
        self.assertTrue(all(Decimal(2) <= v <= Decimal(9) for v in once))
        with self.assertRaises(ValueError):
            winsorize(PRIORS, Decimal(9), Decimal(2))

    def test_normalization_is_bounded_and_pins_both_tails(self):
        constants = normalization_constants(PRIORS)
        self.assertEqual(constants["p_low"], Decimal("0.55"))
        self.assertEqual(constants["p_high"], Decimal("10.45"))
        self.assertEqual(
            apply_normalization(constants, Decimal(0)), Decimal(0)
        )
        self.assertEqual(
            apply_normalization(constants, Decimal(9999)), Decimal(1)
        )
        self.assertEqual(
            normalize_metric(Decimal("6"), PRIORS, []), Decimal("0.550505050")
        )

    def test_log1p_compresses_a_heavy_tail(self):
        heavy = [Decimal(v) for v in (1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 100, 1000)]
        linear = normalize_metric(Decimal(10), heavy, [])
        logged = normalize_metric(Decimal(10), heavy, [], log1p=True)
        self.assertGreater(logged, linear)
        self.assertLessEqual(logged, Decimal(1))

    def test_only_the_fees_component_is_declared_heavy_tailed(self):
        # 05 §4.3's table declares the transform per component; in the v1 set
        # only `P` fees carries `N(log1p(·))` (MetricId 20).
        self.assertTrue(is_log1p_series(20))
        for metric_id in (1, 2, 3, 4, 5, 6, 10, 11, 12, 21, 22, 30, 31, 32):
            self.assertFalse(is_log1p_series(metric_id))

    def test_corpus_rows_replay_from_the_model(self):
        corpus = json.loads(
            (
                Path(__file__).resolve().parents[1] / "fixtures" / "vectors.json"
            ).read_text()
        )
        rows = corpus["welfare_normalization_scenarios"]
        self.assertEqual(len(rows), 11)
        refusals = 0
        for row in rows:
            with self.subTest(row=row["name"]):
                inputs = row["inputs"]
                prior = [Decimal(v) for v in inputs["prior_bounds"]]
                finalized = [Decimal(v) for v in inputs["finalized"]]
                value = Decimal(inputs["value"])
                log = is_log1p_series(inputs["metric_id"])
                self.assertEqual(log, inputs["log1p"])
                sample = normalization_sample(prior, finalized)
                self.assertEqual(
                    [format(v, "f") for v in sample], row["sample"]
                )
                if "error" in row:
                    self.assertEqual(row["error"], "DegenerateNormalizationRange")
                    with self.assertRaises(ValueError):
                        normalization_constants(sample, log)
                    refusals += 1
                    continue
                constants = normalization_constants(sample, log)
                for key in ("p_low", "p_high", "lo", "hi"):
                    self.assertEqual(
                        format(constants[key], "f"), row["constants"][key]
                    )
                self.assertEqual(
                    format(apply_normalization(constants, value), "f"),
                    row["normalized"],
                )
                self.assertLessEqual(Decimal(row["normalized"]), Decimal(1))
        self.assertEqual(refusals, 2)


if __name__ == "__main__":
    unittest.main()
