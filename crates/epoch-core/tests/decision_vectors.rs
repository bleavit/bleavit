//! Shared JSON decision-engine replay (15 §4.4; 05 §4.4/§5.4).
//!
//! The `decision_scenarios` corpus family is generated only by
//! `tools/reference-model/generate-vectors.py` from the independent Python
//! `decide()` (the ordered 11-step rule of 05 §5.4). 05 §4.4 requires the
//! decision rule to be bit-identical across conforming implementations, so
//! every replayed outcome and reason code must agree exactly.
//!
//! The harness maps each row's inputs onto `EpochState::decide_with` exactly
//! the way the production pipeline does (pallet-epoch's decision-input
//! snapshot + the runtime adapters):
//! - `reject_full_effective` feeds both `reject_full` and `baseline_full`
//!   (σ then cancels in `effective_reject_1e9`, making the effective reject
//!   leg the row's value verbatim);
//! - per-gate validity maps onto the per-gate `survival_grade_ok` /
//!   `security_grade_ok` flags, exactly as `pallet-epoch` builds them
//!   (05 §5.4 steps 3-4: validity-then-veto, Survival before Security);
//! - the welfare tri-state grade maps onto `DecisionInputs::welfare_grade`
//!   verbatim (05 §5.4 step 5: only Insufficient may extend);
//! - step-9 inputs use the production `market_core::liquidity_hat`
//!   composition (SQ-231) and the 08 §5.2 per-class prize table;
//! - tunables come from the constitution genesis registry, never hardcoded
//!   (the row's `delta` is a scenario input and overrides the class δ).

use std::{collections::BTreeSet, fs, path::PathBuf};

use conditional_ledger_core::LedgerState;
use constitution_core::{genesis_params, key16};
use epoch_core::{
    DecisionGuards, DecisionInputs, EpochParams, EpochState, Origin, Proposal, WelfareGrade,
};
use futarchy_primitives::{
    BoundedVec, DecisionOutcome, FixedU64, MarketSet, ProposalClass, ProposalState, RejectReason,
};
use serde_json::Value;

fn fixture() -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../reference-model/fixtures/vectors.json");
    serde_json::from_str(&fs::read_to_string(path).expect("read shared reference-model vectors"))
        .expect("parse shared reference-model vectors")
}

fn genesis_u128(key: &[u8]) -> u128 {
    genesis_params()
        .into_iter()
        .find(|record| record.key == key16(key))
        .unwrap_or_else(|| panic!("genesis registry misses {}", String::from_utf8_lossy(key)))
        .value
        .as_u128()
}

/// Parse a corpus decimal string onto the 1e9 fixed grid, exactly.
fn exact_1e9(value: &Value, context: &str) -> u64 {
    let text = value
        .as_str()
        .unwrap_or_else(|| panic!("{context} must be a decimal string"));
    let (int, frac) = text.split_once('.').unwrap_or((text, ""));
    assert!(
        frac.len() <= 9,
        "{context} value {text} exceeds the 1e9 grid"
    );
    let mut digits = frac.to_owned();
    while digits.len() < 9 {
        digits.push('0');
    }
    int.parse::<u64>()
        .unwrap_or_else(|_| panic!("{context} integer part"))
        * 1_000_000_000
        + digits
            .parse::<u64>()
            .unwrap_or_else(|_| panic!("{context} fraction part"))
}

/// Parse a corpus USDC decimal string into base units, exactly (6 decimals).
fn exact_usdc(value: &Value, context: &str) -> u128 {
    let text = value
        .as_str()
        .unwrap_or_else(|| panic!("{context} must be a decimal string"));
    let (int, frac) = text.split_once('.').unwrap_or((text, ""));
    assert!(
        frac.len() <= 6,
        "{context} value {text} is not base-unit exact"
    );
    let mut digits = frac.to_owned();
    while digits.len() < 6 {
        digits.push('0');
    }
    int.parse::<u128>()
        .unwrap_or_else(|_| panic!("{context} integer part"))
        * 1_000_000
        + digits
            .parse::<u128>()
            .unwrap_or_else(|_| panic!("{context} fraction part"))
}

fn class_of(inputs: &Value) -> ProposalClass {
    match inputs.get("proposal_class").and_then(Value::as_str) {
        None => ProposalClass::Param,
        Some("Param") => ProposalClass::Param,
        Some("Treasury") => ProposalClass::Treasury,
        Some("Code") => ProposalClass::Code,
        Some("Meta") => ProposalClass::Meta,
        Some(other) => panic!("unknown proposal class {other}"),
    }
}

fn bool_input(inputs: &Value, key: &str, default: bool) -> bool {
    inputs
        .get(key)
        .map(|value| {
            value
                .as_bool()
                .unwrap_or_else(|| panic!("{key} must be a bool"))
        })
        .unwrap_or(default)
}

/// Per-gate map lookup (`Survival`/`Security` keys) with a scalar default.
fn gate_map_1e9(inputs: &Value, key: &str, gate: &str) -> u64 {
    inputs
        .get(key)
        .and_then(|map| map.get(gate))
        .map(|value| exact_1e9(value, key))
        .unwrap_or(0)
}

fn gate_valid(inputs: &Value, gate: &str, fallback: bool) -> bool {
    inputs
        .get("gate_valid")
        .and_then(|map| map.get(gate))
        .map(|value| value.as_bool().expect("gate_valid entries are bools"))
        .unwrap_or(fallback)
}

fn expected_outcome(row: &Value) -> DecisionOutcome {
    match row["outcome"].as_str().expect("outcome string") {
        "Adopt" => DecisionOutcome::Adopt,
        "Extend" => DecisionOutcome::Extend,
        "Reject" => DecisionOutcome::Reject(
            match row["reason"].as_str().expect("Reject carries a reason") {
                "NotDecisionGrade" => RejectReason::NotDecisionGrade,
                "GateVetoSurvival" => RejectReason::GateVetoSurvival,
                "GateVetoSecurity" => RejectReason::GateVetoSecurity,
                "HurdleNotMet" => RejectReason::HurdleNotMet,
                "ConvergenceFailed" => RejectReason::ConvergenceFailed,
                "SecondExtensionFailed" => RejectReason::SecondExtensionFailed,
                "ProcessHold" => RejectReason::ProcessHold,
                "ConstitutionViolation" => RejectReason::ConstitutionViolation,
                "ResourceConflict" => RejectReason::ResourceConflict,
                "RateLimited" => RejectReason::RateLimited,
                "SecuritySizing" => RejectReason::SecuritySizing,
                "AttestationMissing" => RejectReason::AttestationMissing,
                other => panic!("unknown reject reason {other}"),
            },
        ),
        other => panic!("unknown outcome {other}"),
    }
}

/// The complete input-key inventory of the current corpus rows; an unmapped
/// key means the corpus grew semantics this harness does not replay — fail
/// loudly instead of silently ignoring it.
const KNOWN_INPUT_KEYS: &[&str] = &[
    "accept_full",
    "accept_trailing",
    "ask",
    "attestation_ok",
    "b_accept",
    "b_reject",
    "contest_accept",
    "contest_reject",
    "converged",
    "delta",
    "envelope_value",
    "extended",
    "flow_cap",
    "gate_book_valid",
    "gate_valid",
    "measured_liquidity",
    "p_adopt",
    "p_reject",
    "pol_depth",
    "preimage_ok",
    "process_hold",
    "proposal_class",
    "queue_time_ok",
    "reject_full_effective",
    "resource_locks_held",
    "spendable_nav",
    "welfare_grade",
];

fn replay(row: &Value) -> (DecisionOutcome, u128) {
    let inputs = &row["inputs"];
    for key in inputs.as_object().expect("inputs object").keys() {
        assert!(
            KNOWN_INPUT_KEYS.contains(&key.as_str()),
            "unmapped decision input key {key} — extend the replay harness"
        );
    }
    let class = class_of(inputs);
    let extended = bool_input(inputs, "extended", false);
    let requires_gates = epoch_core::requires_gate_markets(class);

    let accept_full = exact_1e9(&inputs["accept_full"], "accept_full");
    let reject = exact_1e9(&inputs["reject_full_effective"], "reject_full_effective");
    let accept_trailing = inputs
        .get("accept_trailing")
        .map(|value| exact_1e9(value, "accept_trailing"))
        .unwrap_or(accept_full);

    let mut params = EpochParams::DEFAULT;
    // Row-scoped δ (a scenario input, uniform across classes here); the live
    // gate caps and windows come from the 13 §1 genesis registry so the two
    // implementations share one parameter source.
    let delta = FixedU64(exact_1e9(&inputs["delta"], "delta"));
    params.delta = [delta, delta, delta, delta, params.delta[4]];
    let p_max = FixedU64(u64::try_from(genesis_u128(b"gate.p_max")).unwrap());
    let eps = FixedU64(u64::try_from(genesis_u128(b"gate.eps")).unwrap());
    params.gate_p_max = [p_max, p_max];
    params.gate_eps = [eps, eps];
    params.decision_window = u32::try_from(genesis_u128(b"dec.window")).unwrap();
    params.delta_max = FixedU64(u64::try_from(genesis_u128(b"dec.delta_max")).unwrap());

    // Step-8 convergence is an input bool in the model; realize it through
    // the production spot-vs-TWAP predicate.
    let converged = bool_input(inputs, "converged", true);
    let accept_spot = if converged {
        accept_full
    } else {
        accept_full + params.delta_max.0 + 1
    };

    // Step-9 inputs: L̂ either pre-composed (`measured_liquidity`) or through
    // the production SQ-231 composition; prize per the 08 §5.2 class table
    // (including the CODE/META outflow-cap floor term when NAV is supplied).
    let measured_depth = if let Some(depth) = inputs.get("pol_depth") {
        let b_sum = exact_usdc(&inputs["b_accept"], "b_accept")
            + exact_usdc(&inputs["b_reject"], "b_reject");
        let flow_cap: u64 = inputs["flow_cap"]
            .as_str()
            .expect("flow_cap string")
            .parse()
            .expect("flow_cap is a whole multiplier");
        let pair_contest = exact_usdc(&inputs["contest_accept"], "contest_accept")
            .min(exact_usdc(&inputs["contest_reject"], "contest_reject"));
        market_core::liquidity_hat(
            exact_usdc(depth, "pol_depth"),
            pair_contest,
            flow_cap * 1_000_000_000,
            b_sum,
        )
        .expect("liquidity_hat composes")
    } else {
        inputs
            .get("measured_liquidity")
            .map(|value| exact_usdc(value, "measured_liquidity"))
            .unwrap_or(0)
    };
    let ask = inputs
        .get("ask")
        .map(|value| exact_usdc(value, "ask"))
        .unwrap_or(0);
    let envelope = inputs
        .get("envelope_value")
        .map(|value| exact_usdc(value, "envelope_value"))
        .unwrap_or(0);
    let spendable_nav = inputs
        .get("spendable_nav")
        .map(|value| exact_usdc(value, "spendable_nav"))
        .unwrap_or(0);
    if class == ProposalClass::Treasury && inputs.get("spendable_nav").is_some() {
        assert!(
            ask.saturating_mul(100) <= spendable_nav,
            "Treasury gate-vector fixture must remain at or below 1% NAV"
        );
    }
    let nav_cap = spendable_nav
        .checked_mul(genesis_u128(b"trs.cap_proposal"))
        .expect("NAV cap multiplication fits")
        / 100;
    let prize = match class {
        ProposalClass::Treasury => ask,
        ProposalClass::Param => envelope,
        ProposalClass::Code | ProposalClass::Meta => ask.max(envelope).max(nav_cap),
        ProposalClass::Constitutional => unreachable!("no Constitutional rows"),
    };

    // Welfare tri-state grade, verbatim (05 §5.4 step 5).
    let welfare_grade = match inputs
        .get("welfare_grade")
        .map(|value| value.as_str().expect("welfare_grade string"))
        .unwrap_or("Ok")
    {
        "Ok" => WelfareGrade::Ok,
        "Insufficient" => WelfareGrade::Insufficient,
        "Invalid" => WelfareGrade::Invalid,
        other => panic!("unknown welfare grade {other}"),
    };

    let gate_fallback = bool_input(inputs, "gate_book_valid", true);
    let survival_grade_ok = gate_valid(inputs, "Survival", gate_fallback);
    let security_grade_ok = gate_valid(inputs, "Security", gate_fallback);
    let gate_twaps = requires_gates.then(|| {
        [
            FixedU64(gate_map_1e9(inputs, "p_adopt", "Survival")),
            FixedU64(gate_map_1e9(inputs, "p_reject", "Survival")),
            FixedU64(gate_map_1e9(inputs, "p_adopt", "Security")),
            FixedU64(gate_map_1e9(inputs, "p_reject", "Security")),
        ]
    });

    let decision_inputs = DecisionInputs {
        accept_full: FixedU64(accept_full),
        reject_full: FixedU64(reject),
        // The row's reject leg is already the σ-effective value: feeding it
        // as the Baseline too makes `max(r, base − σ)` collapse to r exactly.
        baseline_full: FixedU64(reject),
        accept_trailing: FixedU64(accept_trailing),
        reject_trailing: FixedU64(reject),
        baseline_trailing: FixedU64(reject),
        accept_spot: FixedU64(accept_spot),
        reject_spot: FixedU64(reject),
        welfare_grade,
        baseline_grade_ok: true,
        previous_settled_baseline_twap: None,
        survival_grade_ok,
        security_grade_ok,
        gate_twaps,
        measured_depth,
        published_flow_per_day: None,
        in_cap_prize: Some(prize),
        attestation_quorate: bool_input(inputs, "attestation_ok", true),
        constitution_queue_ok: bool_input(inputs, "queue_time_ok", true),
    };
    let guards = DecisionGuards {
        preimage_ok: bool_input(inputs, "preimage_ok", true),
        resource_locks_held: bool_input(inputs, "resource_locks_held", true),
        process_hold: bool_input(inputs, "process_hold", false),
    };

    let mut state = EpochState::<[u8; 32]>::new();
    let mut ledger = LedgerState::<[u8; 32]>::new();
    ledger.create_vault(1, 1).expect("create replay vault");
    state.proposals.push(Proposal {
        id: 1,
        proposer: [1; 32],
        class,
        state: if extended {
            ProposalState::Extended
        } else {
            ProposalState::Trading
        },
        epoch: 0,
        submitted_at: 0,
        payload_hash: [7; 32],
        payload_len: 0,
        ask,
        bond: 10,
        resources: BoundedVec::try_from(vec![[1u8; 8]]).expect("one resource fits"),
        metric_spec: 1,
        decide_at: 0,
        rerun: false,
        extended,
        delayed_once: false,
        markets: Some(MarketSet {
            accept: 1,
            reject: 2,
            gates: requires_gates.then_some([4, 5, 6, 7]),
            baseline: 3,
        }),
        maturity: None,
        grace_end: None,
        version_constraint: None,
        decision: None,
    });

    let outcome = state
        .decide_with(
            Origin::Keeper,
            &mut ledger,
            1,
            0,
            decision_inputs,
            guards,
            &params,
        )
        .expect("decide_with executes");
    (outcome, measured_depth)
}

/// 15 §4.4 / G0 corpus-family attestation: replay every `decision_scenarios`
/// row through `EpochState::decide_with` and require the exact outcome and
/// reason code (05 §4.4 bit-identical decisions). Unknown scenarios, unknown
/// input keys, and count drift all fail loudly.
#[test]
fn decision_vectors_match_python_reference_model() {
    let fixture = fixture();
    let scenarios = fixture["decision_scenarios"]
        .as_array()
        .expect("decision_scenarios family present");
    assert_eq!(scenarios.len(), 21, "decision family cardinality drifted");
    let mut replayed = BTreeSet::new();

    for row in scenarios {
        let name = row["name"].as_str().expect("scenario name");
        let expected = expected_outcome(row);
        let (actual, measured_depth) = replay(row);
        assert_eq!(actual, expected, "{name} outcome mismatch");
        if let Some(expected_l_hat) = row.get("l_hat") {
            assert_eq!(
                measured_depth,
                exact_usdc(expected_l_hat, "l_hat"),
                "{name} L-hat mismatch"
            );
        }
        assert!(
            replayed.insert(name.to_owned()),
            "duplicate scenario {name}"
        );
    }
    assert_eq!(replayed.len(), 21, "decision replay executed-count drifted");
}
