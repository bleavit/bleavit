//! The 05 §4.6 normalization kernel (B-15, D-15) — raw metric ⇒ [0,1].
//!
//! §4.6 fixes the machine in four steps: winsorize each raw series at the
//! 5th/95th percentile of the trailing **12 finalized epoch values**, apply
//! `log1p` for the heavy-tailed series, min–max map onto [0,1], and freeze the
//! resulting constants at epoch open, before any epoch-`e` market opens. The
//! percentile family is normative — inclusive linear interpolation (the
//! "type-7" estimator, rank `1 + f·(n−1)` on the ascending sample, linearly
//! interpolated between the bracketing order statistics), never nearest-rank,
//! which on a 12-element sample would degenerate to `min`/`max`.
//!
//! Cold start (epochs 1–12) is the same machine on a different sample: genesis
//! ships `MetricSpec::prior_bounds` (12 pseudo-observations per component) and
//! the sample is the **most recent 12 elements of `prior_bounds ++ finalized`**,
//! so real values displace pseudo-observations oldest-first. At epoch 13 the
//! sample is fully real and the rule reduces to steady state with no
//! discontinuity in mechanism.
//!
//! **Arithmetic discipline.** §4.6 defers to §4.4: every value lives on the
//! `FixedU64` 1e9 grid, every interpolation product rounds **down**, and the
//! transcendental leg goes through `futarchy-fixed`'s 64.64 primitives — this
//! module writes no logarithm of its own, it composes `log1p(x) = ln(1 + x)`
//! out of the crate the rest of the system already uses. Two conforming
//! implementations MUST agree bit-for-bit (15 §4.4), so the `log1p` output is
//! floored back onto the 1e9 grid *before* the min–max division rather than
//! carried at 64.64 into it: that makes the division exact integer arithmetic
//! on both sides instead of amplifying the logarithm's ≤ 2 ulp residual by
//! `1/(hi − lo)`.
//!
//! Every function here is total. Degenerate inputs — an empty sample, a
//! zero-width min–max range, an out-of-range percentile fraction, an overflow —
//! return a typed error (G-1). A zero-width range in particular MUST NOT
//! resolve to a fabricated `1.0`: a series with no observed spread carries no
//! information, and normalizing it to the top of the scale would hand a pillar
//! a perfect component out of absent data.

use alloc::vec::Vec;

use futarchy_fixed::FixedU64x64;
use futarchy_primitives::{metric_ids, FixedU64, MetricId};
use parity_scale_codec::{Decode, DecodeWithMemTracking, Encode, MaxEncodedLen};
use scale_info::TypeInfo;

use crate::{Error, MetricSpec, HISTORY_PRIORS, ONE};

/// The 5th-percentile winsorization point of 05 §4.6, on the 1e9 grid.
///
/// A structural constant of §4.6's normalization rule (the section names the
/// 5th/95th percentile directly), not a [13](../../../docs/architecture/13-parameters.md)
/// tunable: no registry key expresses it, and moving it would change the
/// *definition* of a normalized metric rather than a value the constitution
/// governs.
pub const P_LOW: FixedU64 = FixedU64(50_000_000);
/// The 95th-percentile winsorization point of 05 §4.6, on the 1e9 grid.
pub const P_HIGH: FixedU64 = FixedU64(950_000_000);

/// The 05 §4.6 normalization constants for one component at one epoch.
///
/// "Computed from `Snapshot(e−1)` history and **frozen at epoch open before any
/// epoch-`e` market opens**" — so this is a record to store, not a computation
/// to repeat per read. It is `MaxEncodedLen` for exactly that reason.
///
/// `p_low`/`p_high` are the winsorization bounds on the **raw** scale (that is
/// where clipping happens); `lo`/`hi` are the min–max endpoints on the
/// **mapped** scale, which equals the raw scale unless `log1p` is set.
#[derive(
    Clone,
    Copy,
    Debug,
    Decode,
    DecodeWithMemTracking,
    Encode,
    Eq,
    MaxEncodedLen,
    PartialEq,
    TypeInfo,
)]
pub struct NormalizationConstants {
    /// p5 of the trailing-12 sample, raw scale — the winsorization floor.
    pub p_low: FixedU64,
    /// p95 of the trailing-12 sample, raw scale — the winsorization ceiling.
    pub p_high: FixedU64,
    /// Min–max lower endpoint (`log1p(p_low)` when `log1p`, else `p_low`).
    pub lo: FixedU64,
    /// Min–max upper endpoint (`log1p(p_high)` when `log1p`, else `p_high`).
    pub hi: FixedU64,
    /// Whether this series is one of §4.3's heavy-tailed `N(log1p(·))` series.
    pub log1p: bool,
}

/// Does 05 §4.3's metric table declare this component `N(log1p(·))`?
///
/// The table spells the transform out per component, and in the v1 set exactly
/// one component carries it: `P` fees, `N(log1p(fees_USDC))`. Every other
/// component is either already a ratio in [0,1] or a bounded count, and none of
/// them is written with a `log1p`. This is a *reading of the metric table*, not
/// a tunable: adding a heavy-tailed component is a MetricSpec-registration
/// change that must amend §4.3 first.
pub const fn uses_log1p(id: MetricId) -> bool {
    id == metric_ids::P_FEES
}

/// The 05 §4.6 winsorization sample: the most recent [`HISTORY_PRIORS`]
/// elements of `prior_bounds ++ finalized`.
///
/// Real values displace pseudo-observations **oldest-first**, so with `m`
/// finalized epochs available the sample is `prior_bounds[m..] ++ finalized`
/// while `m < 12`, and the trailing 12 finalized values once `m ≥ 12`. Total by
/// construction — the output is always exactly 12 elements, which is what makes
/// §4.6's "never vacuous" claim hold (p5 interpolates between x₁ and x₂, p95
/// between x₁₁ and x₁₂).
pub fn normalization_sample(
    prior_bounds: &[FixedU64; HISTORY_PRIORS],
    finalized: &[FixedU64],
) -> [FixedU64; HISTORY_PRIORS] {
    let mut sample = [FixedU64(0); HISTORY_PRIORS];
    let taken = core::cmp::min(finalized.len(), HISTORY_PRIORS);
    // Written through iterators rather than slice indexing so no length
    // relation has to hold for this to be panic-free: the prior contributes
    // `12 − taken` elements, the finalized tail contributes `taken`, and `zip`
    // stops at whichever runs out first.
    let window = prior_bounds
        .iter()
        .skip(taken)
        .chain(finalized.iter().skip(finalized.len().saturating_sub(taken)));
    for (slot, value) in sample.iter_mut().zip(window) {
        *slot = *value;
    }
    sample
}

/// The inclusive-linear ("type-7") percentile of 05 §4.6, on the 1e9 grid.
///
/// Rank `1 + f·(n−1)` over the ascending sample, linearly interpolated between
/// the bracketing order statistics, with the interpolation product rounded
/// **down** per §4.4's discipline. The rank arithmetic is exact: `f` lives on
/// the 1e9 grid and `n − 1` is an integer, so `f·(n−1)` never leaves the grid.
///
/// Fails closed on an empty sample or a fraction outside [0,1] — a percentile
/// of nothing has no value, and inventing one would seed every downstream bound.
pub fn percentile(sample: &[FixedU64], fraction: FixedU64) -> Result<FixedU64, Error> {
    if sample.is_empty() {
        return Err(Error::EmptyNormalizationSample);
    }
    if fraction.0 > ONE {
        return Err(Error::ValueOutOfRange);
    }
    let mut ordered: Vec<u64> = sample.iter().map(|value| value.0).collect();
    ordered.sort_unstable();
    let last = ordered.len().saturating_sub(1);
    if last == 0 {
        return ordered
            .first()
            .copied()
            .map(FixedU64)
            .ok_or(Error::EmptyNormalizationSample);
    }
    // `rank = f · (n − 1)` on the 1e9 grid: at most 1e9 · (n − 1), and the
    // 12-element sample keeps this far inside `u64`. Checked anyway — a caller
    // may hand this a longer history than §4.6's window.
    let rank = fraction
        .0
        .checked_mul(u64::try_from(last).map_err(|_| Error::ArithmeticOverflow)?)
        .ok_or(Error::ArithmeticOverflow)?;
    let lower = usize::try_from(rank / ONE).map_err(|_| Error::ArithmeticOverflow)?;
    let part = rank % ONE;
    // `lower == last` exactly when `f == 1`; the interpolation weight is then
    // zero, so clamping `upper` costs nothing and keeps the index in bounds.
    let upper = core::cmp::min(lower.saturating_add(1), last);
    let low = *ordered.get(lower).ok_or(Error::ArithmeticOverflow)?;
    let high = *ordered.get(upper).ok_or(Error::ArithmeticOverflow)?;
    // Ascending sample ⇒ `high ≥ low`; the interpolation product rounds DOWN.
    let span = u128::from(high.saturating_sub(low));
    let step = span
        .checked_mul(u128::from(part))
        .ok_or(Error::ArithmeticOverflow)?
        / u128::from(ONE);
    let step = u64::try_from(step).map_err(|_| Error::ArithmeticOverflow)?;
    low.checked_add(step)
        .map(FixedU64)
        .ok_or(Error::ArithmeticOverflow)
}

/// Clip one value into `[lo, hi]` — the winsorization step of 05 §4.6.
///
/// Idempotent by construction: the output already lies in `[lo, hi]`, so a
/// second application is the identity.
pub fn winsorize_value(value: FixedU64, lo: FixedU64, hi: FixedU64) -> Result<FixedU64, Error> {
    if lo.0 > hi.0 {
        return Err(Error::ValueOutOfRange);
    }
    Ok(FixedU64(value.0.clamp(lo.0, hi.0)))
}

/// Clip a whole sample into `[lo, hi]` (05 §4.6 winsorization).
pub fn winsorize(sample: &[FixedU64], lo: FixedU64, hi: FixedU64) -> Result<Vec<FixedU64>, Error> {
    sample
        .iter()
        .map(|value| winsorize_value(*value, lo, hi))
        .collect()
}

/// `log1p(x) = ln(1 + x)` for 05 §4.6's heavy-tailed series, on the 1e9 grid.
///
/// No new logarithm: `1 + x` is formed on `futarchy-fixed`'s 64.64
/// representation (the same `Q64(x) = floor(x · 2⁶⁴ / 10⁹)` conversion the
/// §4.4 composites use) and the crate's `ln` — itself `log2` scaled by `ln 2`,
/// bounded at ≤ 2 ulp by 04 §4 — supplies the transcendental. The result is
/// floored back onto the 1e9 grid immediately, per §4.4's rounding discipline.
///
/// `1 + x ≥ 1` always, so the logarithm's domain restriction is unreachable
/// here; the error path exists for overflow only and never fires for a
/// `FixedU64` argument.
pub fn log1p(value: FixedU64) -> Result<FixedU64, Error> {
    let one_plus = FixedU64x64::ONE
        .checked_add(to_q64(value))
        .map_err(|_| Error::ArithmeticOverflow)?;
    let ln = one_plus.ln().map_err(|_| Error::ArithmeticOverflow)?;
    from_q64_down(ln)
}

/// Min–max map onto [0,1] with the quotient rounded **down** (05 §4.6/§4.4).
///
/// Fails closed on `hi ≤ lo`. §4.6 asks for a *map onto [0,1]*, and a
/// zero-width range has no such map: the customary conventions (0, ½, 1) are
/// all fabrications, and the adopt-favourable one — 1 — would hand the pillar a
/// perfect component computed from a series that never moved. G-1 says the
/// degenerate case resolves to refusal, not to a value.
pub fn minmax(value: FixedU64, lo: FixedU64, hi: FixedU64) -> Result<FixedU64, Error> {
    if hi.0 <= lo.0 {
        return Err(Error::DegenerateNormalizationRange);
    }
    let clipped = value.0.clamp(lo.0, hi.0);
    let numerator = u128::from(clipped - lo.0)
        .checked_mul(u128::from(ONE))
        .ok_or(Error::ArithmeticOverflow)?;
    let mapped = numerator / u128::from(hi.0 - lo.0);
    let mapped = u64::try_from(mapped).map_err(|_| Error::ArithmeticOverflow)?;
    Ok(FixedU64(core::cmp::min(mapped, ONE)))
}

/// Freeze the epoch's normalization constants from an assembled 12-element
/// sample (05 §4.6, "frozen at epoch open before any epoch-`e` market opens").
///
/// The min–max endpoints are the **transformed** winsorization bounds: `log1p`
/// is monotone, so applying it to the series and to its p5/p95 is the same
/// mapping — but only the transformed pair can serve as the division's
/// endpoints. The zero-width check therefore happens *after* the transform,
/// where two distinct raw bounds may still collapse onto one grid point.
pub fn freeze_constants(
    sample: &[FixedU64; HISTORY_PRIORS],
    log1p_series: bool,
) -> Result<NormalizationConstants, Error> {
    let p_low = percentile(sample, P_LOW)?;
    let p_high = percentile(sample, P_HIGH)?;
    let (lo, hi) = if log1p_series {
        (log1p(p_low)?, log1p(p_high)?)
    } else {
        (p_low, p_high)
    };
    if hi.0 <= lo.0 {
        return Err(Error::DegenerateNormalizationRange);
    }
    Ok(NormalizationConstants {
        p_low,
        p_high,
        lo,
        hi,
        log1p: log1p_series,
    })
}

/// Normalize one raw metric value against frozen constants (05 §4.6).
///
/// Winsorize, then `log1p` if the series is heavy-tailed, then min–max. The
/// output is always in [0,1] — the winsorization guarantees the numerator never
/// exceeds the denominator, and `minmax` clamps besides.
pub fn apply(constants: &NormalizationConstants, raw: FixedU64) -> Result<FixedU64, Error> {
    let clipped = winsorize_value(raw, constants.p_low, constants.p_high)?;
    let mapped = if constants.log1p {
        log1p(clipped)?
    } else {
        clipped
    };
    minmax(mapped, constants.lo, constants.hi)
}

/// The whole 05 §4.6 pipeline for one component: assemble the trailing-12
/// sample, freeze the constants, normalize the value.
///
/// Equivalent to [`normalization_sample`] → [`freeze_constants`] → [`apply`];
/// production freezes the constants once at epoch open and calls [`apply`] per
/// value, so this is the differential-oracle entry point rather than the hot
/// path.
pub fn normalize_metric(
    raw: FixedU64,
    prior_bounds: &[FixedU64; HISTORY_PRIORS],
    finalized: &[FixedU64],
    log1p_series: bool,
) -> Result<FixedU64, Error> {
    let sample = normalization_sample(prior_bounds, finalized);
    let constants = freeze_constants(&sample, log1p_series)?;
    apply(&constants, raw)
}

impl MetricSpec {
    /// Freeze this component's 05 §4.6 normalization constants from its genesis
    /// `prior_bounds` and the finalized epoch values available so far.
    ///
    /// This is the read that makes `prior_bounds` load-bearing rather than
    /// merely stored: the field is immutable post-genesis and correcting a bad
    /// prior is a new MetricSpec version via the `metric` track (§4.6), so the
    /// pseudo-observations a spec version was registered with are exactly the
    /// ones its cohorts normalize against (I-16).
    pub fn freeze_normalization(
        &self,
        finalized: &[FixedU64],
    ) -> Result<NormalizationConstants, Error> {
        let sample = normalization_sample(&self.prior_bounds, finalized);
        freeze_constants(&sample, uses_log1p(self.id))
    }

    /// Normalize one raw value for this component (05 §4.6, end to end).
    pub fn normalize(&self, raw: FixedU64, finalized: &[FixedU64]) -> Result<FixedU64, Error> {
        apply(&self.freeze_normalization(finalized)?, raw)
    }
}

/// `FixedU64` (1e9) → 64.64, truncating — the conversion §4.4's composites use.
///
/// `v · 2⁶⁴` is at most `2¹²⁸ − 2⁶⁴` for a `u64` argument, so the shift cannot
/// overflow `u128` and the division is exact-floor.
fn to_q64(value: FixedU64) -> FixedU64x64 {
    FixedU64x64::from_raw((u128::from(value.0) << 64) / u128::from(ONE))
}

/// 64.64 → `FixedU64` (1e9), rounding **down** (§4.4 rule 3).
fn from_q64_down(value: FixedU64x64) -> Result<FixedU64, Error> {
    let scaled = value
        .raw()
        .checked_mul(u128::from(ONE))
        .ok_or(Error::ArithmeticOverflow)?;
    u64::try_from(scaled >> 64)
        .map(FixedU64)
        .map_err(|_| Error::ArithmeticOverflow)
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloc::vec;

    fn priors(values: [u64; HISTORY_PRIORS]) -> [FixedU64; HISTORY_PRIORS] {
        values.map(FixedU64)
    }

    /// A minimal registered component carrying `prior_bounds` — the only field
    /// this module reads off a `MetricSpec` besides its id.
    fn spec(id: MetricId, prior_bounds: [FixedU64; HISTORY_PRIORS]) -> MetricSpec {
        MetricSpec {
            id,
            version: 1,
            pillar: crate::Pillar::P,
            weight: FixedU64(ONE),
            epsilon_floor: crate::EPSILON_PILLAR,
            activation_epoch: 1,
            source: crate::SourceClass::Onchain,
            formula_ref: [0; 32],
            units: [0; 16],
            repr: [0; 16],
            cadence_blocks: 1,
            sanity_min: FixedU64(0),
            sanity_max: FixedU64(ONE),
            has_normalization_rule: true,
            has_missing_data_rule: true,
            has_gaming_vectors: true,
            has_challenge_procedure: true,
            prior_bounds,
            target: 100,
            delta_s_max_bps: 1_000,
        }
    }

    fn ramp() -> [FixedU64; HISTORY_PRIORS] {
        priors([
            0,
            ONE,
            2 * ONE,
            3 * ONE,
            4 * ONE,
            5 * ONE,
            6 * ONE,
            7 * ONE,
            8 * ONE,
            9 * ONE,
            10 * ONE,
            11 * ONE,
        ])
    }

    /// 05 §4.6: p5 interpolates between x₁ and x₂, p95 between x₁₁ and x₁₂ —
    /// never the nearest-rank degeneration to min/max.
    #[test]
    fn type7_percentile_interpolates_rather_than_degenerating() {
        let sample = ramp();
        let p5 = percentile(&sample, P_LOW).expect("p5");
        let p95 = percentile(&sample, P_HIGH).expect("p95");
        assert_eq!(p5, FixedU64(550_000_000));
        assert_eq!(p95, FixedU64(10_450_000_000));
        // Nearest-rank would have produced the sample min and max.
        assert_ne!(p5, sample[0]);
        assert_ne!(p95, sample[HISTORY_PRIORS - 1]);
    }

    #[test]
    fn percentile_endpoints_are_the_order_statistics() {
        let sample = ramp();
        assert_eq!(percentile(&sample, FixedU64(0)).expect("p0"), FixedU64(0));
        assert_eq!(
            percentile(&sample, FixedU64(ONE)).expect("p100"),
            FixedU64(11 * ONE)
        );
    }

    #[test]
    fn percentile_is_order_insensitive_and_total() {
        let mut shuffled = ramp();
        shuffled.reverse();
        assert_eq!(
            percentile(&shuffled, P_LOW).expect("p5"),
            percentile(&ramp(), P_LOW).expect("p5"),
        );
        assert_eq!(percentile(&[], P_LOW), Err(Error::EmptyNormalizationSample));
        assert_eq!(
            percentile(&ramp(), FixedU64(ONE + 1)),
            Err(Error::ValueOutOfRange)
        );
    }

    /// 05 §4.6 cold start: `n = 0` is the pure prior, `n = 12` is fully real,
    /// and displacement is oldest-first in between.
    #[test]
    fn cold_start_displaces_priors_oldest_first() {
        let prior = ramp();
        assert_eq!(normalization_sample(&prior, &[]), prior);

        let one_real = normalization_sample(&prior, &[FixedU64(99 * ONE)]);
        assert_eq!(one_real[..HISTORY_PRIORS - 1], prior[1..]);
        assert_eq!(one_real[HISTORY_PRIORS - 1], FixedU64(99 * ONE));

        let real: Vec<FixedU64> = (0..HISTORY_PRIORS)
            .map(|i| FixedU64((100 + i as u64) * ONE))
            .collect();
        assert_eq!(normalization_sample(&prior, &real)[..], real[..]);

        // Past the window the oldest *real* values fall out too.
        let mut long = real.clone();
        long.push(FixedU64(200 * ONE));
        assert_eq!(normalization_sample(&prior, &long)[..], long[1..]);
    }

    #[test]
    fn winsorization_is_idempotent() {
        let sample = ramp();
        let lo = FixedU64(2 * ONE);
        let hi = FixedU64(9 * ONE);
        let once = winsorize(&sample, lo, hi).expect("winsorize");
        let twice = winsorize(&once, lo, hi).expect("winsorize twice");
        assert_eq!(once, twice);
        assert!(once.iter().all(|v| v.0 >= lo.0 && v.0 <= hi.0));
        assert_eq!(
            winsorize_value(FixedU64(0), hi, lo),
            Err(Error::ValueOutOfRange)
        );
    }

    #[test]
    fn minmax_fails_closed_on_a_zero_width_range() {
        assert_eq!(
            minmax(FixedU64(ONE), FixedU64(ONE), FixedU64(ONE)),
            Err(Error::DegenerateNormalizationRange)
        );
        // And never resolves the degenerate case to the adopt-favourable 1.0.
        assert_eq!(
            freeze_constants(&priors([7 * ONE; HISTORY_PRIORS]), false),
            Err(Error::DegenerateNormalizationRange)
        );
    }

    #[test]
    fn minmax_maps_the_endpoints_and_rounds_down() {
        let lo = FixedU64(ONE);
        let hi = FixedU64(4 * ONE);
        assert_eq!(minmax(lo, lo, hi).expect("lo"), FixedU64(0));
        assert_eq!(minmax(hi, lo, hi).expect("hi"), FixedU64(ONE));
        // 1/3 truncates rather than rounding to nearest.
        assert_eq!(
            minmax(FixedU64(2 * ONE), lo, hi).expect("third"),
            FixedU64(333_333_333)
        );
    }

    #[test]
    fn log1p_is_ln_of_one_plus_x_on_the_grid() {
        assert_eq!(log1p(FixedU64(0)).expect("log1p(0)"), FixedU64(0));
        // ln 2 = 0.693147180559945…, floored at 1e-9.
        assert_eq!(
            log1p(FixedU64(ONE)).expect("log1p(1)"),
            FixedU64(693_147_180)
        );
        // Monotone non-decreasing across the grid.
        let mut previous = 0u64;
        for x in [
            0u64,
            1,
            ONE / 2,
            ONE,
            10 * ONE,
            1_000 * ONE,
            1_000_000 * ONE,
        ] {
            let y = log1p(FixedU64(x)).expect("log1p").0;
            assert!(y >= previous, "log1p must not decrease at {x}");
            previous = y;
        }
    }

    #[test]
    fn normalized_output_is_always_in_the_unit_interval() {
        let prior = ramp();
        for raw in [0u64, ONE, 5 * ONE, 11 * ONE, u64::MAX] {
            let value = normalize_metric(FixedU64(raw), &prior, &[], false).expect("normalize");
            assert!(value.0 <= ONE, "normalized {raw} left [0,1]");
        }
        // Winsorization pins both tails exactly.
        assert_eq!(
            normalize_metric(FixedU64(0), &prior, &[], false).expect("floor"),
            FixedU64(0)
        );
        assert_eq!(
            normalize_metric(FixedU64(u64::MAX), &prior, &[], false).expect("ceiling"),
            FixedU64(ONE)
        );
    }

    /// 05 §4.3 declares exactly one `N(log1p(·))` component in v1.
    #[test]
    fn only_the_fees_component_is_declared_heavy_tailed() {
        assert!(uses_log1p(metric_ids::P_FEES));
        for id in [
            metric_ids::X,
            metric_ids::R,
            metric_ids::E,
            metric_ids::H,
            metric_ids::PI,
            metric_ids::K,
            metric_ids::U,
            metric_ids::F,
            metric_ids::D_EFF,
            metric_ids::P_QUALIFIED_USERS,
            metric_ids::P_SETTLED_VALUE,
            metric_ids::A_SHIPPED_UPGRADES,
            metric_ids::A_RUNTIME_PERF,
            metric_ids::A_INTEGRATIONS,
        ] {
            assert!(!uses_log1p(id), "metric {id} is not a log1p series");
        }
    }

    /// The `MetricSpec` wiring: `prior_bounds` is read, and the heavy-tail
    /// transform is selected from the component's own id.
    #[test]
    fn metric_spec_normalizes_against_its_own_prior_bounds() {
        let linear = spec(metric_ids::P_SETTLED_VALUE, ramp());
        let constants = linear.freeze_normalization(&[]).expect("freeze");
        assert!(!constants.log1p);
        assert_eq!(constants.p_low, FixedU64(550_000_000));
        assert_eq!(constants.p_high, FixedU64(10_450_000_000));
        assert_eq!(
            linear.normalize(FixedU64(6 * ONE), &[]).expect("normalize"),
            apply(&constants, FixedU64(6 * ONE)).expect("apply"),
        );

        let fees = spec(metric_ids::P_FEES, ramp());
        let logged = fees.freeze_normalization(&[]).expect("freeze fees");
        assert!(logged.log1p);
        assert_eq!(logged.lo, log1p(FixedU64(550_000_000)).expect("log1p p5"));
        assert_eq!(
            logged.hi,
            log1p(FixedU64(10_450_000_000)).expect("log1p p95")
        );

        // A different `prior_bounds` moves the constants: the field is read,
        // not merely round-tripped.
        let mut shifted_bounds = ramp();
        shifted_bounds[HISTORY_PRIORS - 1] = FixedU64(99 * ONE);
        let shifted = spec(metric_ids::P_SETTLED_VALUE, shifted_bounds);
        assert_ne!(
            shifted.freeze_normalization(&[]).expect("shifted").p_high,
            constants.p_high
        );
    }

    #[test]
    fn log1p_compresses_a_heavy_tail_relative_to_the_linear_map() {
        // A heavy-tailed sample: one order of magnitude between the bulk and
        // the top. The mid value must sit *higher* under log1p than under the
        // linear map — that compression is the point of §4.6's transform.
        let sample = priors([
            ONE,
            2 * ONE,
            3 * ONE,
            4 * ONE,
            5 * ONE,
            6 * ONE,
            7 * ONE,
            8 * ONE,
            9 * ONE,
            10 * ONE,
            100 * ONE,
            1_000 * ONE,
        ]);
        let linear = normalize_metric(FixedU64(10 * ONE), &sample, &[], false).expect("linear");
        let logged = normalize_metric(FixedU64(10 * ONE), &sample, &[], true).expect("log1p");
        assert!(logged.0 > linear.0, "log1p must compress the tail");
        assert!(logged.0 <= ONE && linear.0 <= ONE);
    }

    #[test]
    fn vacuous_sample_still_interpolates_at_both_ends() {
        // §4.6's "never vacuous" claim, stated as a test: both bounds move when
        // the two lowest / two highest order statistics move, which nearest-rank
        // would not do.
        let mut sample = ramp();
        sample[1] = FixedU64(ONE / 2);
        let p5 = percentile(&sample, P_LOW).expect("p5");
        assert_ne!(p5, percentile(&ramp(), P_LOW).expect("baseline p5"));
        let mut top = ramp();
        top[10] = FixedU64(20 * ONE);
        let p95 = percentile(&top, P_HIGH).expect("p95");
        assert_ne!(p95, percentile(&ramp(), P_HIGH).expect("baseline p95"));
    }

    #[test]
    fn constants_survive_a_scale_round_trip() {
        let constants = freeze_constants(&ramp(), true).expect("freeze");
        let encoded = constants.encode();
        let decoded = NormalizationConstants::decode(&mut &encoded[..]).expect("decode constants");
        assert_eq!(decoded, constants);
    }

    #[test]
    fn steady_state_reduces_to_the_cold_start_rule_at_epoch_13() {
        // Epoch 13: twelve finalized values, priors fully displaced. The
        // constants must equal the ones a prior-free steady state would give.
        let prior = ramp();
        let real: Vec<FixedU64> = (0..HISTORY_PRIORS)
            .map(|i| FixedU64((20 + i as u64) * ONE))
            .collect();
        let cold = freeze_constants(&normalization_sample(&prior, &real), false).expect("cold");
        let mut steady = [FixedU64(0); HISTORY_PRIORS];
        steady.copy_from_slice(&real);
        let hot = freeze_constants(&steady, false).expect("steady");
        assert_eq!(cold, hot);
    }

    #[test]
    fn zero_valued_priors_still_produce_a_usable_range() {
        // The canonical "unset" prior array is all zeros, which has no spread —
        // it must fail closed rather than normalize everything to 1.0.
        assert_eq!(
            freeze_constants(&priors([0; HISTORY_PRIORS]), false),
            Err(Error::DegenerateNormalizationRange)
        );
        let mut mixed = priors([0; HISTORY_PRIORS]);
        mixed[HISTORY_PRIORS - 1] = FixedU64(ONE);
        mixed[HISTORY_PRIORS - 2] = FixedU64(ONE);
        assert!(freeze_constants(&mixed, false).is_ok());
        assert_eq!(
            vec![FixedU64(0); 1],
            winsorize(&[FixedU64(0)], FixedU64(0), FixedU64(ONE)).expect("winsorize")
        );
    }
}
