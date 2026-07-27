//! Shared JSON replay of the 05 §4.6 normalization kernel (15 §4.4; SQ-502).
//!
//! `welfare_normalization_scenarios` is generated only by
//! `tools/reference-model/generate-vectors.py`. 15 §4.4 makes the welfare
//! pipeline the "two conforming implementations" case, and §4.6 is its first
//! stage: the trailing-12 sample, the type-7 percentiles, the `log1p` transform
//! and the min–max map must reproduce the reference model's 1e9 grid
//! bit-exactly. Every assertion below is therefore byte-exact — no tolerances —
//! and the fail-closed rows assert the *refusal*, which is as much a normative
//! output as a value is.

use std::{fs, path::PathBuf};

use futarchy_primitives::{FixedU64, MetricId};
use serde_json::Value;
use welfare_core::{
    apply_normalization, freeze_normalization_constants, normalization_sample, uses_log1p, Error,
    MetricSpec, Pillar, SourceClass, EPSILON_PILLAR, HISTORY_PRIORS, ONE,
};

fn fixture() -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../reference-model/fixtures/vectors.json");
    serde_json::from_str(&fs::read_to_string(path).expect("read shared reference-model vectors"))
        .expect("parse shared reference-model vectors")
}

/// Parse a corpus decimal string onto the 1e9 grid, exactly.
fn exact_1e9(value: &Value, context: &str) -> u64 {
    let text = value
        .as_str()
        .unwrap_or_else(|| panic!("{context} must be a decimal string"));
    let (int, frac) = text.split_once('.').unwrap_or((text, ""));
    assert!(
        frac.len() <= 9,
        "{context} value {text} is not exactly representable at 1e9"
    );
    let whole: u64 = int
        .parse()
        .unwrap_or_else(|_| panic!("{context} integer part"));
    let mut digits = frac.to_owned();
    while digits.len() < 9 {
        digits.push('0');
    }
    whole
        .checked_mul(ONE)
        .and_then(|scaled| {
            scaled.checked_add(
                digits
                    .parse::<u64>()
                    .unwrap_or_else(|_| panic!("{context} fraction part")),
            )
        })
        .unwrap_or_else(|| panic!("{context} value {text} overflows FixedU64"))
}

fn grid_list(value: &Value, context: &str) -> Vec<FixedU64> {
    value
        .as_array()
        .unwrap_or_else(|| panic!("{context} must be an array"))
        .iter()
        .map(|item| FixedU64(exact_1e9(item, context)))
        .collect()
}

/// The registered component a row replays through. Only `id` and
/// `prior_bounds` matter to §4.6; every other field is a well-formed filler so
/// the record is a real `MetricSpec` rather than a bag of two values.
fn spec(id: MetricId, prior_bounds: [FixedU64; HISTORY_PRIORS]) -> MetricSpec {
    MetricSpec {
        id,
        version: 1,
        pillar: Pillar::P,
        weight: FixedU64(ONE),
        epsilon_floor: EPSILON_PILLAR,
        activation_epoch: 1,
        source: SourceClass::Onchain,
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

#[test]
fn normalization_vectors_match_python_reference_model_grid_exactly() {
    let fixture = fixture();
    let scenarios = fixture["welfare_normalization_scenarios"]
        .as_array()
        .expect("welfare_normalization_scenarios family present");
    assert_eq!(
        scenarios.len(),
        11,
        "welfare normalization family cardinality drifted"
    );

    let mut normalized_by_name = std::collections::BTreeMap::new();
    let mut refusals = 0usize;

    for row in scenarios {
        let name = row["name"].as_str().expect("scenario name");
        let inputs = &row["inputs"];
        let metric_id = MetricId::try_from(
            inputs["metric_id"]
                .as_u64()
                .unwrap_or_else(|| panic!("{name} metric_id")),
        )
        .unwrap_or_else(|_| panic!("{name} metric_id out of range"));

        // 05 §4.3's metric table decides the heavy-tail transform per component,
        // and both implementations must read the same table.
        assert_eq!(
            uses_log1p(metric_id),
            inputs["log1p"]
                .as_bool()
                .unwrap_or_else(|| panic!("{name} log1p flag")),
            "{name}: log1p classification disagrees with 05 §4.3"
        );

        let prior: [FixedU64; HISTORY_PRIORS] =
            grid_list(&inputs["prior_bounds"], &format!("{name} prior_bounds"))
                .try_into()
                .unwrap_or_else(|_| panic!("{name}: PriorBounds must carry exactly 12 values"));
        let finalized = grid_list(&inputs["finalized"], &format!("{name} finalized"));
        let value = FixedU64(exact_1e9(&inputs["value"], &format!("{name} value")));

        // 05 §4.6 cold start: trailing 12 of `PriorBounds ++ finalized`, real
        // values displacing pseudo-observations oldest-first.
        let sample = normalization_sample(&prior, &finalized);
        let expected_sample = grid_list(&row["sample"], &format!("{name} sample"));
        assert_eq!(
            sample.to_vec(),
            expected_sample,
            "{name}: assembled winsorization sample"
        );

        let component = spec(metric_id, prior);
        let frozen = component.freeze_normalization(&finalized);

        if let Some(error) = row.get("error") {
            // 05 §4.6 rule 3 — the refusal is the normative outcome. Assert the
            // exact error, and that no value came out of either entry point.
            assert_eq!(
                error.as_str(),
                Some("DegenerateNormalizationRange"),
                "{name}: unmapped corpus error"
            );
            assert_eq!(
                frozen,
                Err(Error::DegenerateNormalizationRange),
                "{name}: a zero-width range must fail closed"
            );
            assert_eq!(
                component.normalize(value, &finalized),
                Err(Error::DegenerateNormalizationRange),
                "{name}: normalization must refuse, never resolve to 1.0"
            );
            refusals += 1;
            continue;
        }

        let frozen = frozen.unwrap_or_else(|error| panic!("{name}: freeze failed with {error:?}"));
        let constants = &row["constants"];
        assert_eq!(
            frozen.p_low,
            FixedU64(exact_1e9(&constants["p_low"], &format!("{name} p_low"))),
            "{name}: p5 (type-7, inclusive linear)"
        );
        assert_eq!(
            frozen.p_high,
            FixedU64(exact_1e9(&constants["p_high"], &format!("{name} p_high"))),
            "{name}: p95 (type-7, inclusive linear)"
        );
        assert_eq!(
            frozen.lo,
            FixedU64(exact_1e9(&constants["lo"], &format!("{name} lo"))),
            "{name}: min-max lower endpoint"
        );
        assert_eq!(
            frozen.hi,
            FixedU64(exact_1e9(&constants["hi"], &format!("{name} hi"))),
            "{name}: min-max upper endpoint"
        );

        // 05 §4.6 forbids nearest-rank: on a 12-element sample it would return
        // the sample min and max, and every non-degenerate row here proves the
        // interpolation ran instead.
        let mut ordered: Vec<u64> = sample.iter().map(|item| item.0).collect();
        ordered.sort_unstable();
        assert!(
            frozen.p_low.0 > ordered[0] || ordered[0] == ordered[1],
            "{name}: p5 degenerated to the sample minimum (nearest-rank)"
        );
        assert!(
            frozen.p_high.0 < ordered[HISTORY_PRIORS - 1]
                || ordered[HISTORY_PRIORS - 1] == ordered[HISTORY_PRIORS - 2],
            "{name}: p95 degenerated to the sample maximum (nearest-rank)"
        );

        let expected = FixedU64(exact_1e9(&row["normalized"], &format!("{name} normalized")));
        // Both entry points: the frozen-constants path production uses at epoch
        // open, and the end-to-end path the differential replays.
        assert_eq!(
            apply_normalization(&frozen, value).expect("apply"),
            expected,
            "{name}: normalized value from frozen constants"
        );
        assert_eq!(
            component
                .normalize(value, &finalized)
                .unwrap_or_else(|error| panic!("{name}: normalize failed with {error:?}")),
            expected,
            "{name}: normalized value through MetricSpec::prior_bounds"
        );
        assert!(expected.0 <= ONE, "{name}: normalized value left [0,1]");

        // Freezing is idempotent over the same history — "frozen at epoch open"
        // is a storage decision, not a different computation.
        assert_eq!(
            freeze_normalization_constants(&sample, uses_log1p(metric_id)).expect("refreeze"),
            frozen,
            "{name}: freezing is not deterministic"
        );
        normalized_by_name.insert(name.to_owned(), expected.0);
    }

    assert_eq!(refusals, 2, "the fail-closed rows must both be exercised");

    // The controlled A/B: identical sample and value, differing only in §4.3's
    // heavy-tail transform. `log1p` must lift a value sitting in the bulk of a
    // three-order-of-magnitude series — that compression is the point.
    let logged = normalized_by_name["heavy_tail_fees_log1p"];
    let linear = normalized_by_name["heavy_tail_fees_linear_control"];
    assert!(
        logged > linear,
        "log1p must compress the heavy tail ({logged} vs {linear})"
    );

    // Epoch 13 vs the steady state: once twelve real values are available the
    // priors are fully displaced, so the constants are the ones a prior-free
    // steady state computes. Asserted through the sample identity above and
    // here through the window sliding one epoch further with priors absent.
    assert!(normalized_by_name.contains_key("window_slides_past_the_priors"));
}
