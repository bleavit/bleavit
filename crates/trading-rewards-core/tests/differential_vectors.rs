//! Shared JSON replay of the 08 §2.6 score kernel against the independent
//! reference model (15 §4.4; 04 §5).
//!
//! The `trading_reward_scenarios` family is generated only by
//! `tools/reference-model/generate-vectors.py`, out of
//! `reference-model/src/bleavit_reference_model/trading_rewards.py`. Two gates
//! that already exist carry this file end to end: the reference-model CI job
//! runs `generate-vectors.py --check`, so the corpus cannot drift from the
//! model, and the Rust job's `cargo test --workspace` runs the replay below.
//!
//! **Why it is committed rather than run once.** A round-1 review of this crate
//! reproduced the differential and found the model and the kernel disagreeing
//! over `book_acquired` after settlement in 59 % of 30,000 vectors. 08 §2.6
//! rule 3 was amended to state the decrement the kernel had always performed.
//! The original harness had been deleted, so nothing in the tree could have
//! found that a second time, and nothing could have found the next one. The
//! model exists so that a disagreement is evidence about the specification
//! (`.claude/rules/reference-model.md` rule 1); that only works while the
//! comparison is standing.
//!
//! Every assertion is byte-exact. The one classification difference between the
//! two implementations is checked rather than waived: see [`check_outcome`].

use std::{fs, path::PathBuf};

use serde::Deserialize;
use trading_rewards_core::{
    earning_cap, epoch_outcome, fold, on_buy, on_sell, on_settle, BranchDisposition, EpochScore,
    MarketScore, Outcome,
};

#[derive(Deserialize)]
struct Fixture {
    trading_reward_scenarios: Vec<Scenario>,
}

/// One standalone scenario: 04 §5 requires every row to carry the inputs
/// needed to replay it without consulting 13 or any other family.
#[derive(Deserialize)]
struct Scenario {
    name: String,
    inputs: Inputs,
    score: Score,
    epoch: Epoch,
    market_result: String,
    earning_cap: String,
    outcome: RecordedOutcome,
    expired: bool,
}

#[derive(Deserialize)]
struct Inputs {
    operations: Vec<Operation>,
    disposition: String,
    snapshot_bond: String,
    rate_ppb: u32,
    created_at: u64,
    now: u64,
}

/// Every balance in the corpus is a decimal string.
///
/// The family deliberately reaches magnitudes above `u64::MAX` — the split in
/// `on_settle`'s product exists for exactly those — and a JSON number cannot
/// carry one to a `u128` consumer. Strings are also what the LMSR and welfare
/// families already use for exact values.
fn amount(text: &str, context: &str) -> u128 {
    text.parse()
        .unwrap_or_else(|_| panic!("{context}: {text} is not a u128 decimal"))
}

fn signed(text: &str, context: &str) -> i128 {
    text.parse()
        .unwrap_or_else(|_| panic!("{context}: {text} is not an i128 decimal"))
}

fn amounts(texts: &[String; 2], context: &str) -> [u128; 2] {
    [amount(&texts[0], context), amount(&texts[1], context)]
}

/// The operations are a sequence rather than a fixed buy/sell/settle triple, so
/// that a second settlement of one entry — the case rule 3's decrement exists
/// for — is expressible at all.
#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "lowercase")]
enum Operation {
    Buy {
        side: usize,
        quantity: String,
        cost: String,
        fee: String,
    },
    /// The model records the gross proceeds and the withheld fee separately;
    /// the kernel takes the net. The subtraction is what
    /// `pallets/trading-rewards/src/lib.rs` performs at the call site, so
    /// replaying it here is what binds rule 2's `proceeds − fee` to the
    /// composition the runtime actually uses — the kernel alone cannot show it.
    Sell {
        side: usize,
        quantity: String,
        proceeds: String,
        fee: String,
    },
    Settle {
        position: [String; 2],
        settled_value: [String; 2],
    },
}

#[derive(Deserialize)]
struct Score {
    spent: String,
    received: String,
    mirror_principal: String,
    book_acquired: [String; 2],
}

#[derive(Deserialize)]
struct Epoch {
    spent: String,
    received: String,
}

#[derive(Deserialize)]
struct RecordedOutcome {
    kind: String,
    amount: String,
}

fn fixture() -> Fixture {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../reference-model/fixtures/vectors.json");
    serde_json::from_str(&fs::read_to_string(path).expect("read shared reference-model vectors"))
        .expect("parse shared reference-model vectors")
}

fn disposition(name: &str) -> BranchDisposition {
    match name {
        "realized" => BranchDisposition::Realized,
        "annulled" => BranchDisposition::Annulled,
        "void" => BranchDisposition::Void,
        other => panic!("unknown disposition {other}"),
    }
}

/// The kernel collapses a zero-valued payout to `Neutral` where the model keeps
/// the sign of `scored`, and 08 §2.6 fixes no classification for a payout that
/// floors to nothing.
///
/// The difference is admitted **only** at amount zero, and the admission is
/// itself asserted: a `Reward(0)` recorded by the model must arrive as
/// `Neutral`, not merely as "something with amount zero". So a kernel that
/// stopped collapsing, or that collapsed a nonzero payout, fails here.
fn check_outcome(name: &str, recorded: &RecordedOutcome, got: Outcome) {
    let paid = match got {
        Outcome::Reward(v) | Outcome::Debit(v) => v,
        Outcome::Neutral => 0,
    };
    let expected = amount(&recorded.amount, "outcome amount");
    assert_eq!(paid, expected, "{name}: outcome amount");
    let kind = match got {
        Outcome::Reward(_) => "reward",
        Outcome::Debit(_) => "debit",
        Outcome::Neutral => "neutral",
    };
    if kind == recorded.kind {
        return;
    }
    assert_eq!(
        expected, 0,
        "{name}: the kernel said {kind} and the model said {} at a nonzero amount",
        recorded.kind
    );
    assert_eq!(
        kind, "neutral",
        "{name}: a zero payout the model classified as {} must reach the kernel as Neutral",
        recorded.kind
    );
}

#[test]
fn the_corpus_carries_the_trading_reward_family() {
    // A replay over an empty family passes every assertion below and proves
    // nothing, which is exactly how a differential goes quietly dead.
    let scenarios = fixture().trading_reward_scenarios;
    assert!(
        scenarios.len() >= 128,
        "the 08 §2.6 differential family has shrunk to {} rows",
        scenarios.len()
    );
    let named = scenarios
        .iter()
        .filter(|s| !s.name.starts_with("seeded_"))
        .count();
    assert!(named >= 24, "the named corner rows have shrunk to {named}");
}

#[test]
fn the_kernel_reproduces_every_recorded_scenario() {
    for scenario in fixture().trading_reward_scenarios {
        let name = scenario.name.as_str();
        let mut score = MarketScore {
            created_at: scenario.inputs.created_at,
            ..Default::default()
        };
        for operation in &scenario.inputs.operations {
            match operation {
                Operation::Buy {
                    side,
                    quantity,
                    cost,
                    fee,
                } => on_buy(
                    &mut score,
                    *side,
                    amount(quantity, "buy quantity"),
                    amount(cost, "buy cost"),
                    amount(fee, "buy fee"),
                )
                .unwrap_or_else(|error| panic!("{name}: buy {error:?}")),
                Operation::Sell {
                    side,
                    quantity,
                    proceeds,
                    fee,
                } => on_sell(
                    &mut score,
                    *side,
                    amount(quantity, "sale quantity"),
                    amount(proceeds, "sale proceeds") - amount(fee, "sale fee"),
                )
                .unwrap_or_else(|error| panic!("{name}: sell {error:?}")),
                Operation::Settle {
                    position,
                    settled_value,
                } => on_settle(
                    &mut score,
                    amounts(position, "settled position"),
                    amounts(settled_value, "settled value"),
                )
                .unwrap_or_else(|error| panic!("{name}: settle {error:?}")),
            }
        }

        assert_eq!(
            score.spent,
            amount(&scenario.score.spent, "spent"),
            "{name}: spent"
        );
        assert_eq!(
            score.received,
            amount(&scenario.score.received, "received"),
            "{name}: received"
        );
        assert_eq!(
            score.mirror_principal,
            amount(&scenario.score.mirror_principal, "mirror_principal"),
            "{name}: mirror_principal"
        );
        // The field the round-1 review found diverging. It is unread by the
        // pallet today, and recording it anyway is what turned a silent
        // divergence into a specification amendment.
        assert_eq!(
            score.book_acquired,
            amounts(&scenario.score.book_acquired, "book_acquired"),
            "{name}: book_acquired after settlement"
        );
        assert!(
            score.mirror_within_spent(),
            "{name}: the mirror leg exceeded what was spent"
        );

        let mut epoch = EpochScore::default();
        fold(
            &mut epoch,
            &score,
            disposition(&scenario.inputs.disposition),
        )
        .unwrap_or_else(|error| panic!("{name}: fold {error:?}"));
        assert_eq!(
            epoch.spent,
            amount(&scenario.epoch.spent, "epoch spent"),
            "{name}: epoch spent"
        );
        assert_eq!(
            epoch.received,
            amount(&scenario.epoch.received, "epoch received"),
            "{name}: epoch received"
        );
        // Rule 4's signed score. The kernel expresses it through the two
        // unsigned counters, so the signed form is derived here rather than
        // read off a function the kernel does not have.
        let result = i128::try_from(epoch.received).expect("epoch fits i128")
            - i128::try_from(epoch.spent).expect("epoch fits i128");
        assert_eq!(
            result,
            signed(&scenario.market_result, "market result"),
            "{name}: market result"
        );

        let bond = amount(&scenario.inputs.snapshot_bond, "snapshot bond");
        assert_eq!(
            earning_cap(bond, scenario.inputs.rate_ppb),
            amount(&scenario.earning_cap, "earning cap"),
            "{name}: earning cap"
        );
        check_outcome(
            name,
            &scenario.outcome,
            epoch_outcome(&epoch, bond, scenario.inputs.rate_ppb),
        );
        assert_eq!(
            trading_rewards_core::score_entry_expired(
                scenario.inputs.created_at,
                scenario.inputs.now
            ),
            scenario.expired,
            "{name}: entry expiry"
        );
    }
}
