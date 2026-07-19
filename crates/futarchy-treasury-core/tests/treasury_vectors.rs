//! Shared JSON treasury-arithmetic replay (15 §4.4; 08 §3–§5).
//!
//! The `treasury_scenarios` corpus family is generated only by
//! `tools/reference-model/generate-vectors.py`; 08's worked arithmetic is
//! normative for Phase 0. This suite replays every row against the production
//! Rust surfaces — `market_core::maker_loss_floor` (per-book `b·ln 2` POL
//! commitment, I-12), `Treasury::floor` (08 §4.1 per-class NAV floors),
//! `futarchy_treasury_core::bps` (the `trs.cap_proposal` outflow cap) and
//! `epoch_core::attack_cost_hat` (05 §5.6 / 08 §5.2) — with parameter values
//! drawn from the constitution genesis registry, never hardcoded.
//!
//! Rounding discipline per spec: commitments/depths compare byte-exactly on
//! the USDC base-unit grid (both sides round DOWN); `attack_cost_hat` floors
//! its intermediate division, so it may sit up to 3 base units BELOW the
//! reference's single terminal round-down — asserted directionally, never
//! above (the conservative side: Rust never overstates the attack cost).

use std::{collections::BTreeSet, fs, path::PathBuf};

use constitution_core::{genesis_params, key16};
use futarchy_primitives::{kernel, ProposalClass};
use futarchy_treasury_core::{bps, Treasury, TRS_CAP_PROPOSAL_BPS, USDC};
use market_core::maker_loss_floor;
use serde_json::Value;

fn fixture() -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../reference-model/fixtures/vectors.json");
    serde_json::from_str(&fs::read_to_string(path).expect("read shared reference-model vectors"))
        .expect("parse shared reference-model vectors")
}

fn genesis_balance(key: &[u8]) -> u128 {
    let record = genesis_params()
        .into_iter()
        .find(|record| record.key == key16(key))
        .unwrap_or_else(|| panic!("genesis registry misses {}", String::from_utf8_lossy(key)));
    record.value.as_u128()
}

/// Parse a corpus decimal string into USDC base units, floored, plus whether
/// a sub-grid remainder was truncated and the ROUND_HALF_UP whole-USDC value.
struct ParsedUsdc {
    base_units_floor: u128,
    has_remainder: bool,
    display_half_up: u128,
}

fn parse_usdc(value: &Value, context: &str) -> ParsedUsdc {
    let text = value
        .as_str()
        .unwrap_or_else(|| panic!("{context} must be a decimal string"));
    let (int, frac) = text.split_once('.').unwrap_or((text, ""));
    let int: u128 = int
        .parse()
        .unwrap_or_else(|_| panic!("{context} integer part"));
    let mut digits = frac.to_owned();
    let overflow = digits.split_off(digits.len().min(6));
    while digits.len() < 6 {
        digits.push('0');
    }
    let frac_units: u128 = digits
        .parse()
        .unwrap_or_else(|_| panic!("{context} fraction"));
    let has_remainder = overflow.bytes().any(|byte| byte != b'0');
    let display_half_up = if frac.as_bytes().first().copied().unwrap_or(b'0') >= b'5' {
        int + 1
    } else {
        int
    };
    ParsedUsdc {
        base_units_floor: int * USDC + frac_units,
        has_remainder,
        display_half_up,
    }
}

fn class_of(value: &Value) -> ProposalClass {
    match value.as_str().expect("proposal_class string") {
        "Param" => ProposalClass::Param,
        "Treasury" => ProposalClass::Treasury,
        "Code" => ProposalClass::Code,
        "Meta" => ProposalClass::Meta,
        other => panic!("unknown proposal class {other}"),
    }
}

/// 08 §3 book inventory: 2 decision books at `pol.b.<class>`, plus the 4 gate
/// books at `pol.b_gate` for every market-bearing class.
fn books_b(class: ProposalClass) -> u128 {
    let decision_b = match class {
        ProposalClass::Param => genesis_balance(b"pol.b.param"),
        ProposalClass::Treasury => genesis_balance(b"pol.b.trs"),
        ProposalClass::Code => genesis_balance(b"pol.b.code"),
        ProposalClass::Meta => genesis_balance(b"pol.b.meta"),
        ProposalClass::Constitutional => panic!("no POL inventory for Constitutional"),
    };
    let gated = matches!(
        class,
        ProposalClass::Param | ProposalClass::Treasury | ProposalClass::Code | ProposalClass::Meta
    );
    2 * decision_b
        + if gated {
            4 * genesis_balance(b"pol.b_gate")
        } else {
            0
        }
}

fn dec_v_min_floor(class: ProposalClass) -> u128 {
    match class {
        ProposalClass::Param => genesis_balance(b"dec.v_min.param"),
        ProposalClass::Treasury => genesis_balance(b"dec.v_min.trs"),
        ProposalClass::Code => genesis_balance(b"dec.v_min.code"),
        ProposalClass::Meta => genesis_balance(b"dec.v_min.meta"),
        ProposalClass::Constitutional => panic!("no dec.v_min for Constitutional"),
    }
}

fn assert_commitment(row: &Value, name: &str, books: u128) {
    let commitment = maker_loss_floor(books).expect("commitment computes");
    let expected = parse_usdc(&row["commitment"], "commitment");
    // Both sides floor to the base-unit grid and the reference values sit far
    // from grid lines, so agreement is byte-exact — this is the real
    // differential of the fixed-point ln 2 path vs the 100-digit reference.
    assert_eq!(commitment, expected.base_units_floor, "{name} commitment");
    let display = row["commitment_display"].as_u64().expect("display") as u128;
    assert_eq!(expected.display_half_up, display, "{name} display rounding");
}

/// 08 §4.1: the per-class NAV floor table. The reference model computes the
/// exact `commitment/pol.budget_epoch` quotient; `Treasury::floor` carries the
/// displayed table rows, which agree with the exact values within 10 whole
/// USDC (the SQ-33/SQ-39 display-rounding slack in 08 §4.1's rows).
const NAV_FLOOR_DISPLAY_TOLERANCE: u128 = 10 * USDC;

fn assert_nav_floor_row(
    row: &Value,
    name: &str,
    rust_floor: Option<u128>,
    books: u128,
    whole_usdc_commitment: bool,
) {
    let expected = parse_usdc(&row["nav_floor"], "nav_floor");
    let display = row["nav_floor_display"].as_u64().expect("floor display") as u128;
    assert_eq!(
        expected.display_half_up, display,
        "{name} floor display rounding"
    );
    if let Some(rust_floor) = rust_floor {
        assert!(
            rust_floor.abs_diff(expected.base_units_floor) <= NAV_FLOOR_DISPLAY_TOLERANCE,
            "{name}: Treasury::floor {rust_floor} vs reference {} exceeds the \
             08 §4.1 display tolerance",
            expected.base_units_floor
        );
    }
    // Cross-check the 08 §4.1 formula itself through Rust arithmetic:
    // floor = commitment / pol.budget_epoch, evaluated over the Rust-computed
    // commitment. 08 §4.1's displayed rows inconsistently divide exact and
    // whole-USDC commitments (the SQ-33/SQ-39 rounding-convention gap); the
    // Gate-bearing PARAM/TREASURY/META rows use the half-up whole-USDC
    // commitment, mirrored by `whole_usdc_commitment`. In the exact branch,
    // the commitment floor loses < 1 base unit, which the Perbill division
    // magnifies to < 1/0.0075 ≈ 134 base units.
    let budget_perbill = genesis_balance(b"pol.budget_epoch");
    let commitment = maker_loss_floor(books).expect("commitment computes");
    let charged = if whole_usdc_commitment {
        let whole = commitment / USDC;
        (whole + u128::from(commitment % USDC >= USDC / 2)) * USDC
    } else {
        commitment
    };
    let derived = charged * 1_000_000_000 / budget_perbill;
    assert!(
        derived.abs_diff(expected.base_units_floor) <= 200,
        "{name}: derived NAV floor {derived} disagrees with reference {}",
        expected.base_units_floor
    );
}

/// 15 §4.4 / G0 corpus-family attestation: replay every `treasury_scenarios`
/// row. Unknown or renamed rows fail loudly; the executed count is pinned.
#[test]
fn treasury_vectors_match_python_reference_model() {
    let fixture = fixture();
    let scenarios = fixture["treasury_scenarios"]
        .as_array()
        .expect("treasury_scenarios family present");
    assert_eq!(scenarios.len(), 9, "treasury family cardinality drifted");
    let mut replayed = BTreeSet::new();

    for row in scenarios {
        let name = row["name"].as_str().expect("scenario name");
        let inputs = &row["inputs"];
        match name {
            "param_pol" | "treasury_pol" | "code_pol" | "meta_pol" => {
                let class = class_of(&inputs["proposal_class"]);
                let books = books_b(class);
                assert_commitment(row, name, books);
                let rust_floor = Some(Treasury::floor(class));
                let whole_usdc_commitment = matches!(name, "treasury_pol" | "meta_pol");
                assert_nav_floor_row(row, name, rust_floor, books, whole_usdc_commitment);
            }
            "baseline_commitment" => {
                // 08 §4.3: the Baseline book commitment at `pol.b_baseline`.
                assert_commitment(row, name, genesis_balance(b"pol.b_baseline"));
            }
            "code_security_at_nav_floor" => {
                // 08 §5.2 at the CODE NAV floor. The prize proxy for upgrade
                // payloads floors at `trs.cap_proposal · spendable NAV`.
                let nav = parse_usdc(&inputs["spendable_nav"], "spendable_nav");
                assert!(!nav.has_remainder, "spendable_nav must be base-unit exact");
                assert_eq!(
                    u128::from(TRS_CAP_PROPOSAL_BPS),
                    genesis_balance(b"trs.cap_proposal") * 100,
                    "trs.cap_proposal bps/percent drift"
                );
                let prize =
                    bps(nav.base_units_floor, TRS_CAP_PROPOSAL_BPS).expect("prize cap computes");
                let expected_prize = parse_usdc(&row["prize"], "prize");
                assert!(
                    !expected_prize.has_remainder,
                    "prize must be base-unit exact"
                );
                assert_eq!(prize, expected_prize.base_units_floor, "{name} prize");

                // 08 §5.3: dec.v_min(class) scaled as max(floor, 2·P).
                let v_min = dec_v_min_floor(ProposalClass::Code).max(prize * 2);
                let expected_v_min = parse_usdc(&row["dec_v_min"], "dec_v_min");
                assert!(!expected_v_min.has_remainder, "dec_v_min must be exact");
                assert_eq!(v_min, expected_v_min.base_units_floor, "{name} dec_v_min");

                // POL depth of the decision pair: 2·b_code·ln 2, floored.
                let depth =
                    maker_loss_floor(2 * genesis_balance(b"pol.b.code")).expect("depth computes");
                let expected_depth = parse_usdc(&row["pol_depth"], "pol_depth");
                assert_eq!(depth, expected_depth.base_units_floor, "{name} pol_depth");

                // L̂ = depth + contest volume; the reference's fractional part
                // comes entirely from the depth term, so flooring commutes.
                let liquidity = depth + v_min;
                let expected_liquidity = parse_usdc(&row["liquidity"], "liquidity");
                assert_eq!(
                    liquidity, expected_liquidity.base_units_floor,
                    "{name} liquidity"
                );

                // AttackCost̂ = (L̂/2) · T_dec, every step rounded down
                // (05 §5.6). Rust floors the halving before multiplying while
                // the reference performs one terminal round-down, so Rust may
                // sit up to T_dec·(1/2) + 1 < 3 base units below — and never
                // above (never overstates the attack cost).
                let window = u32::try_from(genesis_balance(b"dec.window")).expect("window");
                let attack = epoch_core::attack_cost_hat(liquidity, None, window)
                    .expect("attack cost computes");
                let expected_attack = parse_usdc(&row["attack_cost"], "attack_cost");
                assert!(
                    attack <= expected_attack.base_units_floor,
                    "{name}: attack cost must never exceed the reference round-down"
                );
                assert!(
                    expected_attack.base_units_floor - attack <= 3,
                    "{name}: attack cost drifted below the intermediate-floor budget"
                );

                // 05 §5.4 step 9: 3·P ≤ AttackCost̂ — never divide the cost.
                let three_prize = parse_usdc(&row["three_prize"], "three_prize");
                assert!(!three_prize.has_remainder, "three_prize must be exact");
                assert_eq!(
                    prize * kernel::SECURITY_FACTOR,
                    three_prize.base_units_floor,
                    "{name} 3·prize"
                );
                let security_ok = row["security_ok"].as_bool().expect("security_ok");
                assert_eq!(
                    prize * kernel::SECURITY_FACTOR <= attack,
                    security_ok,
                    "{name} security verdict"
                );
                // `attack_cost_third` is a reference-side diagnostic division;
                // the protocol never divides the cost (05 §5.4 step 9), so it
                // deliberately has no Rust consumer.
            }
            "scaled_defaults" => {
                // 08 §5.4: P_ref(class) = (2·b_floor·ln 2 + dec.v_min)/2.
                let depth =
                    maker_loss_floor(2 * genesis_balance(b"pol.b.code")).expect("depth computes");
                let p_ref = (depth + dec_v_min_floor(ProposalClass::Code)) / 2;
                let expected = parse_usdc(&row["p_ref"], "p_ref");
                assert_eq!(p_ref, expected.base_units_floor, "{name} p_ref");
                // The prize-scaled `pol_b` / `delta` fields have no Rust
                // surface yet: the runtime binds flat `pol.b.*` Params values
                // and flat `dec.delta.*` (the 08 §5.3 Ask-scaling floors equal
                // the current defaults). Deliberately unasserted rather than
                // fabricating a tautological re-derivation; reported as an
                // implementation gap by the authoring session.
                assert!(row.get("pol_b").is_some() && row.get("delta").is_some());
            }
            "l_hat_contest_within_ceiling" | "l_hat_flow_cap_ceiling_binds" => {
                // 08 §5.2 (SQ-231): L̂ = POL depth + min(pair contest capital,
                // sec.flow_cap · (b_acc + b_rej)), through the production
                // `market_core::liquidity_hat` composition.
                let b_accept = parse_usdc(&inputs["b_accept"], "b_accept");
                let b_reject = parse_usdc(&inputs["b_reject"], "b_reject");
                assert!(!b_accept.has_remainder && !b_reject.has_remainder);
                let b_sum = b_accept.base_units_floor + b_reject.base_units_floor;

                // The row's pol_depth is a generator-supplied INPUT (the pair
                // maker-loss depth rounded half-up at 1e-6, not the floored
                // production value); tie it to the production ln 2 path within
                // one base unit so a drifted fixture cannot silently decouple
                // from the seeded depth, then compose from the input as given.
                let depth = parse_usdc(&inputs["pol_depth"], "pol_depth");
                assert!(!depth.has_remainder, "pol_depth must be base-unit exact");
                assert!(
                    maker_loss_floor(b_sum)
                        .expect("pair depth computes")
                        .abs_diff(depth.base_units_floor)
                        <= 1,
                    "{name} pol_depth input decoupled from the pair maker-loss depth"
                );

                let contest = parse_usdc(&inputs["contest_capital"], "contest_capital");
                assert!(!contest.has_remainder);
                let flow_cap_units: u64 = inputs["flow_cap"]
                    .as_str()
                    .expect("flow_cap string")
                    .parse()
                    .expect("flow_cap is a whole multiplier");
                let l_hat = market_core::liquidity_hat(
                    depth.base_units_floor,
                    contest.base_units_floor,
                    flow_cap_units * 1_000_000_000,
                    b_sum,
                )
                .expect("liquidity_hat computes");
                let expected_l_hat = parse_usdc(&row["l_hat"], "l_hat");
                assert!(!expected_l_hat.has_remainder);
                assert_eq!(l_hat, expected_l_hat.base_units_floor, "{name} l_hat");

                let window = u32::try_from(genesis_balance(b"dec.window")).expect("window");
                let attack =
                    epoch_core::attack_cost_hat(l_hat, None, window).expect("attack cost computes");
                let expected_attack = parse_usdc(&row["attack_cost"], "attack_cost");
                assert!(
                    attack <= expected_attack.base_units_floor,
                    "{name}: attack cost must never exceed the reference round-down"
                );
                assert!(
                    expected_attack.base_units_floor - attack <= 3,
                    "{name}: attack cost drifted below the intermediate-floor budget"
                );
            }
            other => panic!("unknown treasury scenario: {other}"),
        }
        assert!(
            replayed.insert(name.to_owned()),
            "duplicate scenario {name}"
        );
    }
    assert_eq!(replayed.len(), 9, "treasury replay executed-count drifted");
}
