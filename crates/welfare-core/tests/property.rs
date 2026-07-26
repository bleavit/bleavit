//! Property suite for the 05 §4.6 normalization kernel (15 §4.2–4.3; SQ-502).
//!
//! The kernel's guarantees are structural rather than per-value: the percentile
//! is monotone in its sample, winsorization is idempotent, the normalized output
//! never leaves [0,1], the cold-start rule reduces to the documented endpoints
//! at `n = 0` and `n = 12`, and displacement is oldest-first. Each is stated
//! here as a property over the whole `FixedU64` domain rather than over the
//! handful of points the differential corpus pins.
//!
//! Totality is the implicit property every case checks: nothing in this module
//! is allowed to panic, and a `Result` is the only way a degenerate input may
//! leave the kernel (G-1).

use futarchy_primitives::FixedU64;
use proptest::prelude::*;
use welfare_core::{
    apply_normalization, freeze_normalization_constants, log1p, minmax, normalization_sample,
    normalize_metric, percentile, winsorize, winsorize_value, Error, HISTORY_PRIORS, ONE, P_HIGH,
    P_LOW,
};

/// Raw metric values across the whole grid, weighted toward the magnitudes real
/// series occupy (ratios in [0,1], counts, and heavy-tailed fee sums).
fn raw_value() -> impl Strategy<Value = FixedU64> {
    prop_oneof![
        3 => (0u64..=ONE).prop_map(FixedU64),
        3 => (0u64..1_000 * ONE).prop_map(FixedU64),
        2 => (0u64..1_000_000_000_000_000u64).prop_map(FixedU64),
        1 => any::<u64>().prop_map(FixedU64),
    ]
}

fn sample12() -> impl Strategy<Value = [FixedU64; HISTORY_PRIORS]> {
    prop::array::uniform12(raw_value())
}

fn fraction() -> impl Strategy<Value = FixedU64> {
    (0u64..=ONE).prop_map(FixedU64)
}

proptest! {
    /// Raising one observation can never lower a percentile: the estimator is
    /// monotone non-decreasing in every order statistic.
    #[test]
    fn percentile_is_monotone_in_the_sample(
        sample in sample12(),
        index in 0usize..HISTORY_PRIORS,
        bump in 1u64..1_000_000_000_000u64,
        f in fraction(),
    ) {
        let base = percentile(&sample, f).expect("12-element sample is never empty");
        let mut raised = sample;
        raised[index] = FixedU64(raised[index].0.saturating_add(bump));
        let after = percentile(&raised, f).expect("12-element sample is never empty");
        prop_assert!(after.0 >= base.0, "percentile fell from {base:?} to {after:?}");

        let mut lowered = sample;
        lowered[index] = FixedU64(lowered[index].0.saturating_sub(bump));
        let below = percentile(&lowered, f).expect("12-element sample is never empty");
        prop_assert!(below.0 <= base.0, "percentile rose from {base:?} to {below:?}");
    }

    /// A percentile always lands inside the sample's own range, and a larger
    /// fraction never selects a smaller value.
    #[test]
    fn percentile_is_bracketed_and_monotone_in_the_fraction(
        sample in sample12(),
        f in fraction(),
        g in fraction(),
    ) {
        let (low, high) = if f.0 <= g.0 { (f, g) } else { (g, f) };
        let min = sample.iter().map(|v| v.0).min().expect("non-empty");
        let max = sample.iter().map(|v| v.0).max().expect("non-empty");
        let at_low = percentile(&sample, low).expect("percentile");
        let at_high = percentile(&sample, high).expect("percentile");
        prop_assert!((min..=max).contains(&at_low.0));
        prop_assert!((min..=max).contains(&at_high.0));
        prop_assert!(at_low.0 <= at_high.0);
        // 05 §4.6's endpoints are the extreme order statistics exactly.
        prop_assert_eq!(percentile(&sample, FixedU64(0)).expect("p0").0, min);
        prop_assert_eq!(percentile(&sample, FixedU64(ONE)).expect("p100").0, max);
    }

    /// Winsorization is idempotent, and it is a clip: it never moves a value
    /// that already lies inside the bounds.
    #[test]
    fn winsorization_is_idempotent(
        sample in sample12(),
        a in raw_value(),
        b in raw_value(),
    ) {
        let (lo, hi) = if a.0 <= b.0 { (a, b) } else { (b, a) };
        let once = winsorize(&sample, lo, hi).expect("ordered bounds");
        let twice = winsorize(&once, lo, hi).expect("ordered bounds");
        prop_assert_eq!(&once, &twice);
        for (source, clipped) in sample.iter().zip(&once) {
            prop_assert!((lo.0..=hi.0).contains(&clipped.0));
            if (lo.0..=hi.0).contains(&source.0) {
                prop_assert_eq!(source.0, clipped.0);
            }
        }
        // Inverted bounds are refused rather than silently reordered.
        if lo.0 < hi.0 {
            prop_assert_eq!(winsorize_value(a, hi, lo), Err(Error::ValueOutOfRange));
        }
    }

    /// Whatever the sample and whatever the value, a successful normalization
    /// lands in [0,1] — and a failure is always the fail-closed refusal, never
    /// a fabricated value.
    #[test]
    fn normalized_output_is_always_in_the_unit_interval(
        prior in sample12(),
        finalized in prop::collection::vec(raw_value(), 0..20),
        value in raw_value(),
        log in any::<bool>(),
    ) {
        match normalize_metric(value, &prior, &finalized, log) {
            Ok(normalized) => prop_assert!(normalized.0 <= ONE),
            Err(error) => prop_assert_eq!(error, Error::DegenerateNormalizationRange),
        }
    }

    /// The frozen-constants path production uses at epoch open and the
    /// end-to-end path the differential replays are the same computation.
    #[test]
    fn freezing_then_applying_equals_the_end_to_end_pipeline(
        prior in sample12(),
        finalized in prop::collection::vec(raw_value(), 0..20),
        value in raw_value(),
        log in any::<bool>(),
    ) {
        let sample = normalization_sample(&prior, &finalized);
        let end_to_end = normalize_metric(value, &prior, &finalized, log);
        match freeze_normalization_constants(&sample, log) {
            Ok(constants) => {
                prop_assert_eq!(apply_normalization(&constants, value), end_to_end);
                // The winsorized value is inside the frozen bounds by
                // construction, so the min-max numerator can never exceed its
                // denominator.
                prop_assert!(constants.lo.0 < constants.hi.0);
                prop_assert!(constants.p_low.0 <= constants.p_high.0);
            }
            Err(error) => {
                prop_assert_eq!(error, Error::DegenerateNormalizationRange);
                prop_assert_eq!(end_to_end, Err(Error::DegenerateNormalizationRange));
            }
        }
    }

    /// 05 §4.6 cold start: `n = 0` is the genesis prior verbatim, `n ≥ 12` is
    /// the trailing 12 finalized values with the prior fully displaced, and in
    /// between real values displace pseudo-observations **oldest-first**.
    #[test]
    fn cold_start_displaces_priors_oldest_first(
        prior in sample12(),
        finalized in prop::collection::vec(raw_value(), 0..30),
    ) {
        let sample = normalization_sample(&prior, &finalized);
        let taken = finalized.len().min(HISTORY_PRIORS);
        let carried = HISTORY_PRIORS - taken;
        // The surviving pseudo-observations are the *newest* ones, in order.
        prop_assert_eq!(&sample[..carried], &prior[taken..]);
        // The real tail is the most recent `taken` finalized values, in order.
        prop_assert_eq!(&sample[carried..], &finalized[finalized.len() - taken..]);
        if finalized.is_empty() {
            prop_assert_eq!(sample, prior);
        }
        if finalized.len() >= HISTORY_PRIORS {
            prop_assert_eq!(&sample[..], &finalized[finalized.len() - HISTORY_PRIORS..]);
        }
    }

    /// `log1p` is monotone non-decreasing and never exceeds its argument
    /// (`ln(1 + x) ≤ x`), which is what makes it a compression of a heavy tail
    /// rather than a rescaling of one.
    #[test]
    fn log1p_is_monotone_and_sublinear(a in raw_value(), b in raw_value()) {
        let (low, high) = if a.0 <= b.0 { (a, b) } else { (b, a) };
        let at_low = log1p(low).expect("log1p is total on FixedU64");
        let at_high = log1p(high).expect("log1p is total on FixedU64");
        prop_assert!(at_low.0 <= at_high.0);
        prop_assert!(at_low.0 <= low.0);
        prop_assert_eq!(log1p(FixedU64(0)).expect("log1p(0)"), FixedU64(0));
    }

    /// The min–max map pins both endpoints exactly, is monotone in the value,
    /// and refuses a zero-width range instead of resolving it.
    #[test]
    fn minmax_pins_the_endpoints_and_refuses_a_zero_width_range(
        a in raw_value(),
        b in raw_value(),
        value in raw_value(),
    ) {
        let (lo, hi) = if a.0 <= b.0 { (a, b) } else { (b, a) };
        if lo.0 == hi.0 {
            prop_assert_eq!(minmax(value, lo, hi), Err(Error::DegenerateNormalizationRange));
            return Ok(());
        }
        prop_assert_eq!(minmax(lo, lo, hi).expect("lo"), FixedU64(0));
        prop_assert_eq!(minmax(hi, lo, hi).expect("hi"), FixedU64(ONE));
        let mapped = minmax(value, lo, hi).expect("mapped");
        prop_assert!(mapped.0 <= ONE);
        if value.0 < hi.0 {
            let higher = minmax(FixedU64(value.0.saturating_add(1)), lo, hi).expect("higher");
            prop_assert!(higher.0 >= mapped.0);
        }
    }

    /// The winsorization points are the ones 05 §4.6 names, and they bracket
    /// the interior of the sample rather than degenerating to min/max.
    #[test]
    fn p5_and_p95_interpolate_the_bracketing_order_statistics(sample in sample12()) {
        let mut ordered: Vec<u64> = sample.iter().map(|v| v.0).collect();
        ordered.sort_unstable();
        let p5 = percentile(&sample, P_LOW).expect("p5").0;
        let p95 = percentile(&sample, P_HIGH).expect("p95").0;
        // 05 §4.6: p5 sits between x₁ and x₂, p95 between x₁₁ and x₁₂.
        prop_assert!((ordered[0]..=ordered[1]).contains(&p5));
        prop_assert!((ordered[HISTORY_PRIORS - 2]..=ordered[HISTORY_PRIORS - 1]).contains(&p95));
    }
}
