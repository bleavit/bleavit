//! Shared JSON ledger-sequence replay for the frame-free core (15 §4.4;
//! 03 §11).
//!
//! The fixture is generated only by `tools/reference-model/generate-vectors.py`.
//! Every failed operation is also checked for the 03 §5 atomic/status-quo
//! guarantee; every successful operation and final digest must agree exactly.
//! This file replays only operations implemented by `LedgerState`; 03 §5.4
//! archive-delay/batched sweeps are FRAME storage/custody behavior and are
//! replayed from the same fixture by the pallet's `differential_sweep` module.

use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::PathBuf,
};

use conditional_ledger_core::{
    baseline, position, BaselineState, BranchSupply, Error, Event, LedgerOrigin, LedgerState,
};
use futarchy_primitives::{
    kernel, Branch, FixedU64, GateType, PositionId, PositionKind, ScalarSide, VaultState,
};
use serde::Deserialize;
use serde_json::{Map, Value};

/// The pre-E1 corpus shape (02 §13 contract v16): redemption events carry the
/// payout and nothing else.
const CONTRACT_V16: u64 = 16;
/// The E1 corpus shape (contract v17): the four fee-bearing redemption events
/// carry the **gross** plus a trailing `fee`, the digest carries
/// `redemption_fees_accrued`, and `sweep_redemption_fees` is in the alphabet.
const CONTRACT_V17: u64 = 17;

#[derive(Deserialize)]
struct Fixture {
    ledger_scenarios: Vec<Value>,
    ledger_sequence_scenarios: Vec<Scenario>,
    ledger_fee_scenarios: Vec<FeeScenario>,
    ledger_score_scenarios: Vec<ScoreScenario>,
    ledger_error_scenarios: Vec<ErrorScenario>,
}

#[derive(Deserialize)]
struct Scenario {
    name: String,
    initial_state: InitialState,
    ops: Vec<Step>,
    final_state: Value,
}

/// One 03 §5.3a row of the fee corpus. Each is a standalone program: it carries
/// the rate, the `min_split` waiver threshold and the exempt-account set beside
/// its ops, so the replay never consults 13 (04 §5 standalone-replay rule).
#[derive(Deserialize)]
struct FeeScenario {
    name: String,
    params: FeeParams,
    initial_state: InitialState,
    ops: Vec<FeeStep>,
    fees_accrued: u128,
    fees_charged_total: u128,
    fees_swept_total: u128,
    final_state: Value,
}

#[derive(Deserialize)]
struct FeeParams {
    contract_version: u64,
    redeem_fee_perbill: u64,
    min_split: u64,
    protocol_accounts: Vec<String>,
}

#[derive(Deserialize)]
struct FeeStep {
    #[serde(flatten)]
    step: Step,
    /// Present only on the payout ops: the escrow outflow, the withheld fee and
    /// what the claimant received, measured independently of the event.
    gross: Option<u128>,
    fee: Option<u128>,
    net: Option<u128>,
    fees_accrued_after: u128,
}

#[derive(Deserialize)]
struct InitialState {
    proposal_id: u64,
    baseline_epoch: u32,
    digest: Value,
}

#[derive(Deserialize)]
struct Step {
    op: String,
    args: Value,
    outcome: Value,
}

#[derive(Deserialize)]
struct ScoreScenario {
    name: String,
    score: u64,
    amount: u64,
    long_payout: u64,
    short_payout: u64,
    pair_payout: u64,
}

#[derive(Deserialize)]
struct ErrorScenario {
    name: String,
    op: ErrorOperation,
    outcome: Value,
}

#[derive(Deserialize)]
struct ErrorOperation {
    name: String,
}

fn vector_path() -> PathBuf {
    std::env::var_os("BLEAVIT_LEDGER_VECTOR_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../../reference-model/fixtures/vectors.json")
        })
}

fn fixture() -> Fixture {
    serde_json::from_str(
        &fs::read_to_string(vector_path()).expect("read shared reference-model vectors"),
    )
    .expect("parse shared reference-model vectors")
}

fn holder(name: &str) -> u8 {
    match name {
        "alice" => 1,
        "bob" => 2,
        "carol" => 3,
        other => panic!("unknown vector holder class: {other}"),
    }
}

fn holder_label(who: u8) -> &'static str {
    match who {
        1 => "alice",
        2 => "bob",
        3 => "carol",
        // The index is deliberately not interpolated: CodeQL's cleartext-logging
        // name heuristic taints anything reaching here from the `owner` field
        // (public-fixture u8 test index, alert #12 on PR #89). Valid indices are
        // 1..=3; a violating scenario is pinpointed by the replay's own
        // scenario/op context in the surrounding assertions.
        _ => panic!("replay holder index outside the fixture's 1..=3 range"),
    }
}

fn branch(value: &str) -> Branch {
    match value {
        "Accept" => Branch::Accept,
        "Reject" => Branch::Reject,
        other => panic!("unknown branch: {other}"),
    }
}

fn gate(value: &str) -> GateType {
    match value {
        "Survival" => GateType::Survival,
        "Security" => GateType::Security,
        other => panic!("unknown gate: {other}"),
    }
}

fn scalar_side(value: &str) -> ScalarSide {
    match value {
        "Long" => ScalarSide::Long,
        "Short" => ScalarSide::Short,
        other => panic!("unknown scalar side: {other}"),
    }
}

fn position_kind(value: &str, gate_name: Option<&str>) -> PositionKind {
    match value {
        "BranchUsdc" => PositionKind::BranchUsdc,
        "Long" => PositionKind::Long,
        "Short" => PositionKind::Short,
        "GateYes" => PositionKind::GateYes(gate(gate_name.expect("GateYes needs gate"))),
        "GateNo" => PositionKind::GateNo(gate(gate_name.expect("GateNo needs gate"))),
        other => panic!("unknown position kind: {other}"),
    }
}

fn string<'a>(value: &'a Value, key: &str) -> &'a str {
    value[key]
        .as_str()
        .unwrap_or_else(|| panic!("missing string arg {key}"))
}

fn amount(value: &Value) -> u128 {
    u128::from(
        value["amount"]
            .as_u64()
            .expect("amount must fit the generated u64 corpus"),
    )
}

fn position_arg(value: &Value, pid: u64, epoch: u32) -> PositionId {
    let coordinates = &value["position"];
    match string(coordinates, "family") {
        "proposal" => position(
            pid,
            branch(string(coordinates, "branch")),
            position_kind(
                string(coordinates, "kind"),
                coordinates.get("gate").and_then(Value::as_str),
            ),
        ),
        "baseline" => baseline(epoch, scalar_side(string(coordinates, "side"))),
        other => panic!("unknown position family: {other}"),
    }
}

fn object(entries: &[(&str, Value)]) -> Value {
    Value::Object(
        entries
            .iter()
            .map(|(key, value)| ((*key).to_owned(), value.clone()))
            .collect(),
    )
}

fn number(value: u128) -> Value {
    Value::from(u64::try_from(value).expect("generated balances fit u64"))
}

fn empty() -> Value {
    Value::Object(Map::new())
}

fn last_event(state: &LedgerState<u8>) -> &Event {
    state
        .events
        .last()
        .expect("successful operation emits event")
}

/// The four 02 §6 (contract v17) fee-bearing redemption outcomes report the
/// gross with a trailing `fee`; the two exempt ones never do (rule 3).
fn redemption_outcome(burned: u128, payout: u128, fee: u128, version: u64) -> Value {
    if version >= CONTRACT_V17 {
        object(&[
            ("burned", number(burned)),
            ("fee", number(fee)),
            ("payout", number(payout)),
        ])
    } else {
        assert_eq!(fee, 0, "a v16 replay must never charge a fee");
        object(&[("burned", number(burned)), ("payout", number(payout))])
    }
}

fn apply_step(
    state: &mut LedgerState<u8>,
    pid: u64,
    epoch: u32,
    step: &Step,
    version: u64,
) -> Result<Value, Error> {
    let args = &step.args;
    let who = || holder(string(args, "account"));
    let a = || amount(args);
    match step.op.as_str() {
        "split" => {
            let a = a();
            state.split(LedgerOrigin::Signed, pid, &who(), a)?;
            Ok(object(&[("minted", number(a))]))
        }
        "merge" => {
            let a = a();
            state.merge(LedgerOrigin::Signed, pid, &who(), a)?;
            Ok(object(&[("burned", number(a)), ("payout", number(a))]))
        }
        "split_scalar" => {
            let a = a();
            state.split_scalar(
                LedgerOrigin::Signed,
                pid,
                branch(string(args, "branch")),
                &who(),
                a,
            )?;
            Ok(object(&[("burned", number(a)), ("minted", number(a))]))
        }
        "merge_scalar" => {
            let a = a();
            state.merge_scalar(
                LedgerOrigin::Signed,
                pid,
                branch(string(args, "branch")),
                &who(),
                a,
            )?;
            Ok(object(&[("burned", number(a)), ("minted", number(a))]))
        }
        "split_gate" => {
            let a = a();
            state.split_gate(
                LedgerOrigin::Signed,
                pid,
                branch(string(args, "branch")),
                gate(string(args, "gate")),
                &who(),
                a,
            )?;
            Ok(object(&[("burned", number(a)), ("minted", number(a))]))
        }
        "merge_gate" => {
            let a = a();
            state.merge_gate(
                LedgerOrigin::Signed,
                pid,
                branch(string(args, "branch")),
                gate(string(args, "gate")),
                &who(),
                a,
            )?;
            Ok(object(&[("burned", number(a)), ("minted", number(a))]))
        }
        "transfer" => {
            state.transfer(
                LedgerOrigin::Signed,
                position_arg(args, pid, epoch),
                &holder(string(args, "from")),
                &holder(string(args, "to")),
                a(),
            )?;
            let Event::PositionTransferred(_, moved) = last_event(state) else {
                panic!("transfer emitted wrong event")
            };
            Ok(object(&[("moved", number(*moved))]))
        }
        "resolve" => {
            state.resolve(
                LedgerOrigin::ResolveAuthority,
                pid,
                branch(string(args, "winner")),
            )?;
            Ok(empty())
        }
        "void" => {
            state.void(LedgerOrigin::ResolveAuthority, pid)?;
            Ok(empty())
        }
        "settle_scalar" => {
            let score = args["s"].as_u64().expect("score is u64");
            state.settle_scalar(LedgerOrigin::SettleAuthority, pid, FixedU64(score))?;
            Ok(object(&[("s", Value::from(score))]))
        }
        "settle_gate" => {
            let outcome = args["outcome"].as_bool().expect("gate outcome is bool");
            state.settle_gate(
                LedgerOrigin::SettleAuthority,
                pid,
                gate(string(args, "gate")),
                outcome,
            )?;
            Ok(object(&[("outcome", Value::from(outcome))]))
        }
        "redeem" => {
            let a = a();
            state.redeem(pid, &who(), a)?;
            let Event::Redeemed(_, payout) = last_event(state) else {
                panic!("redeem emitted wrong event")
            };
            Ok(object(&[
                ("burned", number(a)),
                ("payout", number(*payout)),
            ]))
        }
        "redeem_scalar" => {
            let a = a();
            state.redeem_scalar(pid, scalar_side(string(args, "side")), &who(), a)?;
            let Event::ScalarRedeemed(_, _, payout, fee) = last_event(state) else {
                panic!("scalar redemption emitted wrong event")
            };
            Ok(redemption_outcome(a, *payout, *fee, version))
        }
        "redeem_scalar_pair" => {
            let a = a();
            state.redeem_scalar_pair(pid, &who(), a)?;
            let Event::ScalarPairRedeemed(_, payout, fee) = last_event(state) else {
                panic!("scalar pair redemption emitted wrong event")
            };
            Ok(redemption_outcome(a, *payout, *fee, version))
        }
        "redeem_gate" => {
            let a = a();
            state.redeem_gate(pid, gate(string(args, "gate")), &who(), a)?;
            let Event::GateRedeemed(_, _, payout, fee) = last_event(state) else {
                panic!("gate redemption emitted wrong event")
            };
            Ok(redemption_outcome(a, *payout, *fee, version))
        }
        "redeem_void" => {
            let a = a();
            state.redeem_void(
                pid,
                branch(string(args, "branch")),
                position_kind(
                    string(args, "kind"),
                    args.get("gate").and_then(Value::as_str),
                ),
                &who(),
                a,
            )?;
            let Event::VoidRedeemed(_, _, burned, payout) = last_event(state) else {
                panic!("void redemption emitted wrong event")
            };
            Ok(object(&[
                ("burned", number(*burned)),
                ("payout", number(*payout)),
            ]))
        }
        "split_baseline" => {
            let a = a();
            state.split_baseline(LedgerOrigin::Signed, epoch, &who(), a)?;
            Ok(object(&[("minted", number(a))]))
        }
        "merge_baseline" => {
            let a = a();
            state.merge_baseline(LedgerOrigin::Signed, epoch, &who(), a)?;
            Ok(object(&[("burned", number(a)), ("payout", number(a))]))
        }
        "settle_baseline" => {
            let score = args["s"].as_u64().expect("score is u64");
            state.settle_baseline(LedgerOrigin::SettleAuthority, epoch, FixedU64(score))?;
            Ok(object(&[("s", Value::from(score))]))
        }
        "redeem_baseline" => {
            let a = a();
            state.redeem_baseline(epoch, scalar_side(string(args, "side")), &who(), a)?;
            let Event::BaselineRedeemed(_, _, payout, fee) = last_event(state) else {
                panic!("baseline redemption emitted wrong event")
            };
            Ok(redemption_outcome(a, *payout, *fee, version))
        }
        "redeem_baseline_pair" => {
            let a = a();
            state.redeem_baseline_pair(epoch, &who(), a)?;
            let Event::BaselineRedeemed(_, _, payout, fee) = last_event(state) else {
                panic!("baseline pair redemption emitted wrong event")
            };
            Ok(redemption_outcome(a, *payout, *fee, version))
        }
        "sweep_redemption_fees" => {
            assert!(
                version >= CONTRACT_V17,
                "03 §5.4's fee sweep is a contract-v17 call and must not appear \
                 in a v16 program"
            );
            let swept = state.sweep_redemption_fees()?;
            Ok(object(&[("swept", number(swept))]))
        }
        other => panic!("unhandled vector operation: {other}"),
    }
}

const ERROR_CLASSES: [&str; 10] = [
    "UnknownVault",
    "UnknownBaselineVault",
    "WrongVaultState",
    "AmountTooSmall",
    "ArithmeticOverflow",
    "InsufficientPosition",
    "PositionCapExceeded",
    "InvalidScore",
    "GateAlreadySettled",
    "GateNotSettled",
];

fn expected_error(class: &str) -> Error {
    // Completeness is intentional: a new Python class cannot silently fall
    // through to a generic Rust error (15 §4.4 status-quo differential).
    match class {
        "UnknownVault" => Error::UnknownVault,
        "UnknownBaselineVault" => Error::UnknownBaselineVault,
        "WrongVaultState" => Error::WrongVaultState,
        "AmountTooSmall" => Error::AmountTooSmall,
        "ArithmeticOverflow" => Error::ArithmeticOverflow,
        "InsufficientPosition" => Error::InsufficientPosition,
        "PositionCapExceeded" => Error::PositionCapExceeded,
        "InvalidScore" => Error::InvalidScore,
        "GateAlreadySettled" => Error::GateAlreadySettled,
        "GateNotSettled" => Error::GateNotSettled,
        other => panic!("unknown Python ledger error class: {other}"),
    }
}

fn proposal_state(state: VaultState) -> Value {
    match state {
        VaultState::Open => object(&[("kind", Value::from("Open"))]),
        VaultState::Resolved(winner) => object(&[
            ("kind", Value::from("Resolved")),
            ("winner", Value::from(branch_name(winner))),
        ]),
        VaultState::ScalarSettled { winner, s } => object(&[
            ("kind", Value::from("ScalarSettled")),
            ("winner", Value::from(branch_name(winner))),
            ("s", Value::from(s.0)),
        ]),
        VaultState::Voided => object(&[("kind", Value::from("Voided"))]),
        VaultState::BaselineSettled { s } => object(&[
            ("kind", Value::from("BaselineSettled")),
            ("s", Value::from(s.0)),
        ]),
    }
}

fn baseline_state(state: BaselineState) -> Value {
    match state {
        BaselineState::Open => object(&[("kind", Value::from("Open"))]),
        BaselineState::Settled(s) => {
            object(&[("kind", Value::from("Settled")), ("s", Value::from(s.0))])
        }
    }
}

fn branch_name(value: Branch) -> &'static str {
    match value {
        Branch::Accept => "Accept",
        Branch::Reject => "Reject",
    }
}

fn branch_digest(supply: BranchSupply) -> Value {
    object(&[
        ("usdc", number(supply.usdc)),
        ("scalar_sets", number(supply.scalar_sets)),
        (
            "gate_sets",
            object(&[
                ("Survival", number(supply.gate_sets[0])),
                ("Security", number(supply.gate_sets[1])),
            ]),
        ),
    ])
}

fn position_name(id: PositionId) -> String {
    match id {
        PositionId::Proposal { branch, kind, .. } => {
            let prefix = format!("proposal/{}", branch_name(branch));
            match kind {
                PositionKind::BranchUsdc => format!("{prefix}/BranchUsdc"),
                PositionKind::Long => format!("{prefix}/Long"),
                PositionKind::Short => format!("{prefix}/Short"),
                PositionKind::GateYes(g) => {
                    format!("{prefix}/GateYes/{}", gate_name(g))
                }
                PositionKind::GateNo(g) => format!("{prefix}/GateNo/{}", gate_name(g)),
            }
        }
        PositionId::Baseline { side, .. } => {
            format!("baseline/{}", scalar_side_name(side))
        }
    }
}

fn gate_name(value: GateType) -> &'static str {
    match value {
        GateType::Survival => "Survival",
        GateType::Security => "Security",
    }
}

fn scalar_side_name(value: ScalarSide) -> &'static str {
    match value {
        ScalarSide::Long => "Long",
        ScalarSide::Short => "Short",
    }
}

fn event_position_kind_name(kind: PositionKind) -> String {
    match kind {
        PositionKind::BranchUsdc => "BranchUsdc".to_owned(),
        PositionKind::Long => "Long".to_owned(),
        PositionKind::Short => "Short".to_owned(),
        PositionKind::GateYes(gate) => format!("GateYes/{}", gate_name(gate)),
        PositionKind::GateNo(gate) => format!("GateNo/{}", gate_name(gate)),
    }
}

/// Project one core event into the corpus's `{kind, fields}` shape.
///
/// 02 §6 rule 1 splits the gross and the fee across two fields of the same
/// event, and rule 3 keeps `Redeemed`/`VoidRedeemed` free of a fee field
/// entirely. The trailing `fee` exists only from contract v17, so the pre-E1
/// rows project without it and the E1 rows with it — a v16 row that somehow
/// carried a non-zero fee is refused here rather than silently truncated.
fn event_value(event: &Event, version: u64) -> Value {
    let fee_tail = |leading: Vec<Value>, fee: u128| -> Vec<Value> {
        if version >= CONTRACT_V17 {
            let mut fields = leading;
            fields.push(number(fee));
            fields
        } else {
            assert_eq!(fee, 0, "a v16 event cannot carry a fee");
            leading
        }
    };
    let (kind, fields) = match *event {
        Event::Split(pid, amount) => ("Split", vec![Value::from(pid), number(amount)]),
        Event::Merged(pid, amount) => ("Merged", vec![Value::from(pid), number(amount)]),
        Event::ScalarSplit(pid, branch, amount) => (
            "ScalarSplit",
            vec![
                Value::from(pid),
                Value::from(branch_name(branch)),
                number(amount),
            ],
        ),
        Event::ScalarMerged(pid, branch, amount) => (
            "ScalarMerged",
            vec![
                Value::from(pid),
                Value::from(branch_name(branch)),
                number(amount),
            ],
        ),
        Event::GateSplit(pid, branch, gate, amount) => (
            "GateSplit",
            vec![
                Value::from(pid),
                Value::from(branch_name(branch)),
                Value::from(gate_name(gate)),
                number(amount),
            ],
        ),
        Event::GateMerged(pid, branch, gate, amount) => (
            "GateMerged",
            vec![
                Value::from(pid),
                Value::from(branch_name(branch)),
                Value::from(gate_name(gate)),
                number(amount),
            ],
        ),
        Event::PositionTransferred(id, amount) => (
            "PositionTransferred",
            vec![Value::from(position_name(id)), number(amount)],
        ),
        Event::BaselineSplit(epoch, amount) => {
            ("BaselineSplit", vec![Value::from(epoch), number(amount)])
        }
        Event::BaselineMerged(epoch, amount) => {
            ("BaselineMerged", vec![Value::from(epoch), number(amount)])
        }
        Event::VaultResolved(pid, winner) => (
            "VaultResolved",
            vec![Value::from(pid), Value::from(branch_name(winner))],
        ),
        Event::VaultVoided(pid) => ("VaultVoided", vec![Value::from(pid)]),
        Event::ScalarSettlementSet(pid, winner, score) => (
            "ScalarSettlementSet",
            vec![
                Value::from(pid),
                Value::from(branch_name(winner)),
                Value::from(score.0),
            ],
        ),
        Event::GateSettled(pid, winner, gate, outcome) => (
            "GateSettled",
            vec![
                Value::from(pid),
                Value::from(branch_name(winner)),
                Value::from(gate_name(gate)),
                Value::from(outcome),
            ],
        ),
        Event::BaselineSettled(epoch, score) => (
            "BaselineSettled",
            vec![Value::from(epoch), Value::from(score.0)],
        ),
        Event::Redeemed(pid, payout) => ("Redeemed", vec![Value::from(pid), number(payout)]),
        Event::ScalarRedeemed(pid, side, payout, fee) => (
            "ScalarRedeemed",
            fee_tail(
                vec![
                    Value::from(pid),
                    Value::from(scalar_side_name(side)),
                    number(payout),
                ],
                fee,
            ),
        ),
        Event::ScalarPairRedeemed(pid, payout, fee) => (
            "ScalarPairRedeemed",
            fee_tail(vec![Value::from(pid), number(payout)], fee),
        ),
        Event::GateRedeemed(pid, gate, payout, fee) => (
            "GateRedeemed",
            fee_tail(
                vec![
                    Value::from(pid),
                    Value::from(gate_name(gate)),
                    number(payout),
                ],
                fee,
            ),
        ),
        Event::VoidRedeemed(pid, position_kind, amount, payout) => (
            "VoidRedeemed",
            vec![
                Value::from(pid),
                Value::from(event_position_kind_name(position_kind)),
                number(amount),
                number(payout),
            ],
        ),
        Event::BaselineRedeemed(epoch, side, payout, fee) => (
            "BaselineRedeemed",
            fee_tail(
                vec![
                    Value::from(epoch),
                    Value::from(scalar_side_name(side)),
                    number(payout),
                ],
                fee,
            ),
        ),
        Event::RedemptionFeesSwept(amount) => {
            assert!(
                version >= CONTRACT_V17,
                "03 §5.4's sweep event is contract v17"
            );
            ("RedemptionFeesSwept", vec![number(amount)])
        }
        Event::VaultReaped(pid, residue) => {
            ("VaultReaped", vec![Value::from(pid), number(residue)])
        }
        Event::BaselineVaultReaped(epoch, residue) => (
            "BaselineVaultReaped",
            vec![Value::from(epoch), number(residue)],
        ),
    };
    object(&[
        ("kind", Value::from(kind)),
        ("fields", Value::Array(fields)),
    ])
}

fn state_digest(state: &LedgerState<u8>, pid: u64, epoch: u32, version: u64) -> Value {
    let proposal = &state
        .vaults
        .iter()
        .find(|vault| vault.proposal == pid)
        .expect("proposal vault exists")
        .info;
    let baseline = &state
        .baseline_vaults
        .iter()
        .find(|vault| vault.epoch == epoch)
        .expect("baseline vault exists")
        .info;
    let mut balances: BTreeMap<String, BTreeMap<String, u128>> = ["alice", "bob", "carol"]
        .into_iter()
        .map(|name| (name.to_owned(), BTreeMap::new()))
        .collect();
    for record in &state.positions {
        balances
            .get_mut(holder_label(record.owner))
            .expect("known holder")
            .insert(position_name(record.id), record.balance);
    }
    let mut positions = state
        .positions
        .iter()
        .map(|record| {
            (
                (holder_label(record.owner), position_name(record.id)),
                object(&[
                    ("position", Value::from(position_name(record.id))),
                    ("owner", Value::from(holder_label(record.owner))),
                    ("balance", number(record.balance)),
                    ("deposit", number(record.deposit)),
                ]),
            )
        })
        .collect::<Vec<_>>();
    positions.sort_by(|left, right| left.0.cmp(&right.0));
    let mut totals = state
        .position_totals
        .iter()
        .map(|record| {
            (
                position_name(record.id),
                object(&[
                    ("position", Value::from(position_name(record.id))),
                    ("total", number(record.total)),
                ]),
            )
        })
        .collect::<Vec<_>>();
    totals.sort_by(|left, right| left.0.cmp(&right.0));
    let mut digest = object(&[
        (
            "proposal",
            object(&[
                ("proposal_id", Value::from(pid)),
                ("escrowed", number(proposal.escrowed)),
                ("spec", Value::from(proposal.spec)),
                ("state", proposal_state(proposal.state)),
                (
                    "gate_outcomes",
                    object(&[
                        (
                            "Survival",
                            proposal.gate_outcomes[0].map_or(Value::Null, Value::from),
                        ),
                        (
                            "Security",
                            proposal.gate_outcomes[1].map_or(Value::Null, Value::from),
                        ),
                    ]),
                ),
                (
                    "branches",
                    object(&[
                        ("Accept", branch_digest(proposal.branches[0])),
                        ("Reject", branch_digest(proposal.branches[1])),
                    ]),
                ),
            ]),
        ),
        (
            "baseline",
            object(&[
                ("epoch", Value::from(epoch)),
                ("escrowed", number(baseline.escrowed)),
                ("sets", number(baseline.sets)),
                ("state", baseline_state(baseline.state)),
            ]),
        ),
        (
            "balances",
            serde_json::to_value(balances).expect("balances serialize"),
        ),
        (
            "positions",
            Value::Array(positions.into_iter().map(|(_, value)| value).collect()),
        ),
        (
            "position_counts",
            Value::Array(
                state
                    .position_counts
                    .iter()
                    .map(|record| {
                        object(&[
                            ("owner", Value::from(holder_label(record.owner))),
                            ("count", Value::from(record.count)),
                        ])
                    })
                    .collect(),
            ),
        ),
        (
            "position_totals",
            Value::Array(totals.into_iter().map(|(_, value)| value).collect()),
        ),
        ("deposits_held", number(state.deposits_held)),
        (
            "events",
            Value::Array(
                state
                    .events
                    .iter()
                    .map(|event| event_value(event, version))
                    .collect(),
            ),
        ),
        (
            "protocol_accounts",
            Value::Array(
                state
                    .protocol_accounts
                    .iter()
                    .map(|who| Value::from(holder_label(*who)))
                    .collect(),
            ),
        ),
    ]);
    if version >= CONTRACT_V17 {
        // 03 §5.3a(4): `RedemptionFeesAccrued` is real pallet storage, so a
        // differential that compares only the final state must be able to see
        // it. It exists only from E1, hence the version gate.
        if let Some(map) = digest.as_object_mut() {
            map.insert(
                "redemption_fees_accrued".to_owned(),
                number(state.redemption_fees_accrued),
            );
        }
    }
    digest
}

#[test]
fn ledger_sequence_vectors_match_python_reference_model() {
    let fixture = fixture();
    assert_eq!(fixture.ledger_sequence_scenarios.len(), 64);

    for scenario in fixture.ledger_sequence_scenarios {
        let pid = scenario.initial_state.proposal_id;
        let epoch = scenario.initial_state.baseline_epoch;
        let mut state = LedgerState::<u8>::new();
        state.create_vault(pid, 0).expect("create proposal vault");
        state
            .create_baseline_vault(epoch)
            .expect("create baseline vault");
        assert_eq!(
            state_digest(&state, pid, epoch, CONTRACT_V16),
            scenario.initial_state.digest,
            "{} initial-state mismatch",
            scenario.name
        );

        for (index, step) in scenario.ops.iter().enumerate() {
            let before = state.clone();
            let actual = apply_step(&mut state, pid, epoch, step, CONTRACT_V16);
            if let Some(expected) = step.outcome.get("ok") {
                let actual = actual.unwrap_or_else(|error| {
                    panic!(
                        "{} op {index} ({}) expected ok {expected}, got err {error:?}",
                        scenario.name, step.op
                    )
                });
                assert_eq!(
                    actual, *expected,
                    "{} op {index} ({}) result mismatch: Rust={actual}, Python={expected}",
                    scenario.name, step.op
                );
                state.try_state().unwrap_or_else(|error| {
                    panic!(
                        "{} op {index} ({}) violated Rust try-state: {error:?}",
                        scenario.name, step.op
                    )
                });
            } else if let Some(class) = step.outcome.get("err").and_then(Value::as_str) {
                let expected = expected_error(class);
                assert_eq!(
                    actual,
                    Err(expected),
                    "{} op {index} ({}) error mismatch: Rust={actual:?}, Python={class}",
                    scenario.name,
                    step.op
                );
                assert_eq!(
                    state, before,
                    "{} op {index} ({}) mutated state on expected {class}",
                    scenario.name, step.op
                );
            } else {
                panic!(
                    "{} op {index} ({}) has malformed outcome {}",
                    scenario.name, step.op, step.outcome
                );
            }
        }

        let actual = state_digest(&state, pid, epoch, CONTRACT_V16);
        assert_eq!(
            actual, scenario.final_state,
            "{} final-state mismatch: Rust={actual}, Python={}",
            scenario.name, scenario.final_state
        );
    }
}

/// 03 §5.3a / §11 (the E1 half of the differential obligation).
///
/// Every existing family runs at the zero default and would agree with an
/// implementation that ignored the rate completely, so this replay — and only
/// this replay — exercises the fee path at all. It covers every charged call,
/// every exemption, both waiver boundaries, the protocol-account exemption, the
/// degenerate 100 % rate, an out-of-domain (malformed) record and the sweep.
///
/// The comparison is byte-exact on the per-op outcome, the running accrual, the
/// event log and the final digest — with **one** documented correction applied
/// to the corpus, below.
#[test]
fn ledger_fee_vectors_match_python_reference_model() {
    let fixture = fixture();
    assert_eq!(
        fixture.ledger_fee_scenarios.len(),
        11,
        "03 §5.3a fee-corpus cardinality drifted"
    );
    let mut seen_protocol_row = false;

    for scenario in fixture.ledger_fee_scenarios {
        let version = scenario.params.contract_version;
        assert_eq!(
            version, CONTRACT_V17,
            "{}: the fee corpus is the contract-v17 shape",
            scenario.name
        );
        let pid = scenario.initial_state.proposal_id;
        let epoch = scenario.initial_state.baseline_epoch;

        let mut state = LedgerState::<u8>::new();
        state.create_vault(pid, 0).expect("create proposal vault");
        state
            .create_baseline_vault(epoch)
            .expect("create baseline vault");
        // 13 · Reading rules: the row carries the rate and the waiver threshold,
        // so the replay configures the core from the program rather than from a
        // literal. `redeem_fee` is deliberately taken **unclamped** — row
        // fee-10 carries a rate outside the `Perbill` domain and the ledger must
        // read it as zero itself (§5.3a(5)).
        state.redeem_fee =
            u32::try_from(scenario.params.redeem_fee_perbill).expect("the corpus rate fits u32");
        state.min_split = u128::from(scenario.params.min_split);
        for account in &scenario.params.protocol_accounts {
            seen_protocol_row = true;
            state.add_protocol_account(holder(account));
        }

        assert_eq!(
            state_digest(&state, pid, epoch, version),
            corrected(&scenario.initial_state.digest, &scenario.params),
            "{} initial-state mismatch",
            scenario.name
        );

        let mut charged_total: u128 = 0;
        let mut swept_total: u128 = 0;
        for (index, row) in scenario.ops.iter().enumerate() {
            let step = &row.step;
            let before = state.clone();
            let accrued_before = state.redemption_fees_accrued;
            let escrow_before = total_escrow(&state);
            let actual = apply_step(&mut state, pid, epoch, step, version);
            let Some(expected) = step.outcome.get("ok") else {
                let class = step
                    .outcome
                    .get("err")
                    .and_then(Value::as_str)
                    .unwrap_or_else(|| panic!("{} op {index} has no outcome", scenario.name));
                assert_eq!(
                    actual,
                    Err(expected_error(class)),
                    "{} op {index} ({}) error mismatch",
                    scenario.name,
                    step.op
                );
                assert_eq!(
                    state, before,
                    "{} op {index} ({}) mutated state on expected {class}",
                    scenario.name, step.op
                );
                continue;
            };
            let actual = actual.unwrap_or_else(|error| {
                panic!(
                    "{} op {index} ({}) expected ok {expected}, got err {error:?}",
                    scenario.name, step.op
                )
            });
            assert_eq!(
                actual, *expected,
                "{} op {index} ({}) result mismatch: Rust={actual}, Python={expected}",
                scenario.name, step.op
            );

            // 03 §5.3a(4)/§6.5: measure the gross as the **escrow outflow** and
            // the fee as the **accrual delta**, independently of what the event
            // reported, so `net + fee == gross` is a real check and not a
            // restatement of the same number three times.
            let escrow_after = total_escrow(&state);
            let accrued_after = state.redemption_fees_accrued;
            let gross = escrow_before.saturating_sub(escrow_after);
            if step.op == "sweep_redemption_fees" {
                let swept = accrued_before.saturating_sub(accrued_after);
                assert_eq!(
                    accrued_after, 0,
                    "{} op {index}: sweep must zero",
                    scenario.name
                );
                assert_eq!(
                    gross, 0,
                    "{} op {index}: the sweep moves surplus, never escrow",
                    scenario.name
                );
                swept_total += swept;
            } else {
                let fee = accrued_after
                    .checked_sub(accrued_before)
                    .unwrap_or_else(|| {
                        panic!(
                            "{} op {index}: the accrual is monotone between sweeps",
                            scenario.name
                        )
                    });
                charged_total += fee;
                assert_eq!(
                    fee,
                    row.fee.unwrap_or(0),
                    "{} op {index} ({}) fee mismatch",
                    scenario.name,
                    step.op
                );
                if let (Some(row_gross), Some(row_net)) = (row.gross, row.net) {
                    assert_eq!(
                        gross, row_gross,
                        "{} op {index} ({}) gross mismatch",
                        scenario.name, step.op
                    );
                    assert_eq!(
                        row_net + fee,
                        gross,
                        "{} op {index} ({}): net + fee != gross",
                        scenario.name,
                        step.op
                    );
                    // §5.3a(4): the fee is never a second draw on escrow — the
                    // gross is the whole outflow and the fee is carved out of
                    // it, so it can never exceed it.
                    assert!(
                        fee <= gross,
                        "{} op {index} ({}): fee exceeds gross",
                        scenario.name,
                        step.op
                    );
                } else {
                    assert_eq!(
                        fee, 0,
                        "{} op {index} ({}) is not a payout and must charge nothing",
                        scenario.name, step.op
                    );
                }
            }
            assert_eq!(
                state.redemption_fees_accrued, row.fees_accrued_after,
                "{} op {index} ({}) accrual mismatch",
                scenario.name, step.op
            );
            state.try_state().unwrap_or_else(|error| {
                panic!(
                    "{} op {index} ({}) violated Rust try-state: {error:?}",
                    scenario.name, step.op
                )
            });
        }

        assert_eq!(
            charged_total, scenario.fees_charged_total,
            "{} cumulative charged-fee mismatch",
            scenario.name
        );
        assert_eq!(
            swept_total, scenario.fees_swept_total,
            "{} cumulative swept-fee mismatch",
            scenario.name
        );
        // L-7's core-visible half: the counter is exactly what was charged and
        // not yet swept.
        assert_eq!(
            state.redemption_fees_accrued,
            charged_total - swept_total,
            "{} counter is not sweep-exact",
            scenario.name
        );
        assert_eq!(
            state.redemption_fees_accrued, scenario.fees_accrued,
            "{} final accrual mismatch",
            scenario.name
        );

        let actual = state_digest(&state, pid, epoch, version);
        let expected = corrected(&scenario.final_state, &scenario.params);
        assert_eq!(
            actual, expected,
            "{} final-state mismatch: Rust={actual}, Python={expected}",
            scenario.name
        );
    }
    assert!(
        seen_protocol_row,
        "the fee corpus must exercise the 03 §5.3a(1) ProtocolAccounts exemption"
    );
}

/// Apply 03 §3/§4's protocol-account deposit exemption to a corpus digest.
///
/// **This is a recorded disagreement with the corpus generator, not a
/// tolerance.** `tools/reference-model/generate-vectors.py`'s sequence driver
/// stamps `_POSITION_DEPOSIT` onto every `Positions` row, counts every owner in
/// `position_counts`, and derives `deposits_held` from the raw row count — it
/// never consults its own `protocol_accounts` set. That was invisible while the
/// set was empty (all 64 pre-E1 rows and 10 of the 11 fee rows) and becomes
/// wrong on `fee-08-protocol-account-is-exempt`, the one row that populates it:
/// 03 §3 makes `ProtocolAccounts` "exempt from the position cap … and from the
/// storage deposit", and 03 §4 takes the deposit from **non**-protocol accounts
/// only, so a protocol owner has `deposit = 0`, no `PositionCount` row and
/// contributes nothing to `DepositsHeld` (L-6; PT-8's "cap enforced for
/// non-protocol accounts, never for protocol accounts").
///
/// The spec decides it, so the correction is applied to the corpus rather than
/// to the ledger, and it is applied **from the row's own `protocol_accounts`
/// list** — deterministically, to exactly the three fields the exemption
/// governs, and provably a no-op wherever that list is empty (asserted below).
/// Everything else in the digest, including every balance, supply, event and
/// the accrual itself, is still compared byte-exactly.
fn corrected(digest: &Value, params: &FeeParams) -> Value {
    let mut digest = digest.clone();
    if params.protocol_accounts.is_empty() {
        return digest;
    }
    let exempt: BTreeSet<&str> = params
        .protocol_accounts
        .iter()
        .map(String::as_str)
        .collect();
    let map = digest.as_object_mut().expect("digest is an object");
    let mut freed: u128 = 0;
    let mut exempt_rows = 0usize;
    if let Some(Value::Array(rows)) = map.get_mut("positions") {
        for row in rows.iter_mut() {
            let owner = row["owner"].as_str().expect("row owner").to_owned();
            if !exempt.contains(owner.as_str()) {
                continue;
            }
            exempt_rows += 1;
            let entry = row.as_object_mut().expect("position row is an object");
            freed += entry["deposit"].as_u64().expect("row deposit") as u128;
            entry.insert("deposit".to_owned(), number(0));
        }
    }
    if let Some(Value::Array(rows)) = map.get_mut("position_counts") {
        rows.retain(|row| !exempt.contains(row["owner"].as_str().expect("count owner")));
    }
    let held = map["deposits_held"].as_u64().expect("deposits_held") as u128;
    map.insert("deposits_held".to_owned(), number(held - freed));
    // The correction is self-proving: it must actually change something, or the
    // disagreement it exists to record has been fixed upstream and this whole
    // function — not the assertion — is what should be deleted. Silently
    // becoming a no-op is the one failure mode a documented carve-out must not
    // have.
    assert!(
        exempt_rows == 0 || freed > 0,
        "the generator no longer charges a deposit to a ProtocolAccounts owner; \
         delete `corrected()` and compare the digest directly"
    );
    digest
}

fn total_escrow(state: &LedgerState<u8>) -> u128 {
    state
        .vaults
        .iter()
        .map(|vault| vault.info.escrowed)
        .chain(
            state
                .baseline_vaults
                .iter()
                .map(|vault| vault.info.escrowed),
        )
        .sum()
}

fn settled_scalar(score: u64, amount: u128) -> LedgerState<u8> {
    let mut state = LedgerState::new();
    state.create_vault(1, 0).expect("create score vault");
    state
        .split(LedgerOrigin::Signed, 1, &1, amount)
        .expect("split score collateral");
    state
        .split_scalar(LedgerOrigin::Signed, 1, Branch::Accept, &1, amount)
        .expect("split score scalar set");
    state
        .resolve(LedgerOrigin::ResolveAuthority, 1, Branch::Accept)
        .expect("resolve score vault");
    state
        .settle_scalar(LedgerOrigin::SettleAuthority, 1, FixedU64(score))
        .expect("settle score vault");
    state
}

#[test]
fn ledger_score_vectors_cover_endpoints_and_rounding_boundaries() {
    let rows = fixture().ledger_score_scenarios;
    let scores = rows.iter().map(|row| row.score).collect::<BTreeSet<_>>();
    for required in [0, 1_000_000_000, 700_049_999, 700_050_000, 700_050_001] {
        assert!(
            scores.contains(&required),
            "missing required score {required}"
        );
    }

    for row in rows {
        let amount = u128::from(row.amount);

        let mut long = settled_scalar(row.score, amount);
        long.redeem_scalar(1, ScalarSide::Long, &1, amount)
            .unwrap_or_else(|error| panic!("{} LONG failed: {error:?}", row.name));
        let Event::ScalarRedeemed(_, _, long_payout, _) = long.events.last().unwrap() else {
            panic!("{} LONG emitted wrong event", row.name)
        };
        assert_eq!(
            *long_payout,
            u128::from(row.long_payout),
            "{} LONG",
            row.name
        );
        long.try_state().expect("LONG score state remains solvent");

        let mut short = settled_scalar(row.score, amount);
        short
            .redeem_scalar(1, ScalarSide::Short, &1, amount)
            .unwrap_or_else(|error| panic!("{} SHORT failed: {error:?}", row.name));
        let Event::ScalarRedeemed(_, _, short_payout, _) = short.events.last().unwrap() else {
            panic!("{} SHORT emitted wrong event", row.name)
        };
        assert_eq!(
            *short_payout,
            u128::from(row.short_payout),
            "{} SHORT",
            row.name
        );
        short
            .try_state()
            .expect("SHORT score state remains solvent");

        let mut pair = settled_scalar(row.score, amount);
        pair.redeem_scalar_pair(1, &1, amount)
            .unwrap_or_else(|error| panic!("{} pair failed: {error:?}", row.name));
        let Event::ScalarPairRedeemed(_, pair_payout, _) = pair.events.last().unwrap() else {
            panic!("{} pair emitted wrong event", row.name)
        };
        assert_eq!(
            *pair_payout,
            u128::from(row.pair_payout),
            "{} pair",
            row.name
        );
        pair.try_state().expect("pair score state remains solvent");
    }
}

/// The legacy worked-example family `ledger_scenarios` (15 §4.4; G0
/// corpus-family attestation). Each named row is a fixed operation program
/// over the Python aggregate reference vault (`Vault`/`BaselineVault`); the
/// JSON row carries the program's numeric inputs and every expected payout in
/// USDC base units. This test replays each named program against the Rust
/// core and asserts every payout byte-exactly (03 §6.3 rounding-against-the-
/// claimant; D-1 VOID schedule; gate 1:0 settlement; Baseline scalar family).
/// An unknown or renamed scenario fails loudly — no silent zero-case pass.
#[test]
fn ledger_legacy_scenarios_match_python_reference_model() {
    fn u128_field(row: &Value, key: &str) -> u128 {
        u128::from(
            row[key]
                .as_u64()
                .unwrap_or_else(|| panic!("legacy field {key} must be a u64")),
        )
    }

    fn score_1e9(row: &Value, key: &str) -> FixedU64 {
        let text = row[key].as_str().expect("score is a decimal string");
        let (int, frac) = text.split_once('.').unwrap_or((text, ""));
        assert!(frac.len() <= 9, "score {text} exceeds the 1e9 grid");
        let mut raw: u64 = int.parse::<u64>().expect("score integer part") * 1_000_000_000;
        let mut digits = String::from(frac);
        while digits.len() < 9 {
            digits.push('0');
        }
        raw += digits.parse::<u64>().expect("score fraction part");
        FixedU64(raw)
    }

    fn payout_of(state: &LedgerState<u8>) -> u128 {
        match state.events.last().expect("redemption emits an event") {
            // The legacy family runs at the zero default, so every one of these
            // is the gross and the net alike.
            Event::Redeemed(_, payout)
            | Event::ScalarPairRedeemed(_, payout, _)
            | Event::ScalarRedeemed(_, _, payout, _)
            | Event::GateRedeemed(_, _, payout, _)
            | Event::VoidRedeemed(_, _, _, payout)
            | Event::BaselineRedeemed(_, _, payout, _) => *payout,
            other => panic!("last event is not a redemption: {other:?}"),
        }
    }

    let scenarios = fixture().ledger_scenarios;
    assert_eq!(scenarios.len(), 5, "legacy family cardinality drifted");
    let mut replayed = BTreeSet::new();

    for row in &scenarios {
        let name = row["name"].as_str().expect("scenario name");
        let inputs = &row["inputs"];
        assert_eq!(
            row["unit"].as_str(),
            Some("USDC base units (1e-6)"),
            "{name} unit drifted"
        );
        match name {
            "void_branch_and_leg_floors" => {
                // split E; split_scalar ACCEPT leg; VOID; redeem the intact
                // REJECT mirror at 1/2 and the unpaired ACCEPT LONG leg at 1/4
                // (D-1 schedule, both floored against the claimant).
                let branch_amount = u128_field(inputs, "branch_amount");
                let leg_amount = u128_field(inputs, "scalar_leg_amount");
                let mut state = LedgerState::<u8>::new();
                state.create_vault(1, 0).unwrap();
                state
                    .split(LedgerOrigin::Signed, 1, &1, branch_amount)
                    .unwrap();
                state
                    .split_scalar(LedgerOrigin::Signed, 1, Branch::Accept, &1, leg_amount)
                    .unwrap();
                state.void(LedgerOrigin::ResolveAuthority, 1).unwrap();
                state
                    .redeem_void(
                        1,
                        Branch::Reject,
                        PositionKind::BranchUsdc,
                        &1,
                        branch_amount,
                    )
                    .unwrap();
                assert_eq!(
                    payout_of(&state),
                    u128_field(row, "branch_payout"),
                    "{name} branch"
                );
                state
                    .redeem_void(1, Branch::Accept, PositionKind::Long, &1, leg_amount)
                    .unwrap();
                assert_eq!(
                    payout_of(&state),
                    u128_field(row, "leg_payout"),
                    "{name} leg"
                );
                state.try_state().expect("void scenario stays solvent");
            }
            "b5_scalar_fragmentation" => {
                // The B-5 counterexample: LONG e, then SHORT e/2 twice — each
                // unpaired floor rounds against the claimant.
                let escrow = u128_field(inputs, "escrow");
                let mut state = settled_scalar(score_1e9(inputs, "s").0, escrow);
                state
                    .redeem_scalar(1, ScalarSide::Long, &1, escrow)
                    .unwrap();
                let long_payout = payout_of(&state);
                assert_eq!(long_payout, u128_field(row, "long_payout"), "{name} LONG");
                let expected_shorts = row["short_payouts"]
                    .as_array()
                    .expect("short_payouts array")
                    .iter()
                    .map(|value| u128::from(value.as_u64().expect("short payout u64")))
                    .collect::<Vec<_>>();
                assert_eq!(expected_shorts.len(), 2, "{name} short program shape");
                let mut total = long_payout;
                for (index, expected) in expected_shorts.iter().enumerate() {
                    state
                        .redeem_scalar(1, ScalarSide::Short, &1, escrow / 2)
                        .unwrap();
                    let payout = payout_of(&state);
                    assert_eq!(payout, *expected, "{name} SHORT {index}");
                    total += payout;
                }
                assert_eq!(total, u128_field(row, "total_payout"), "{name} total");
                state.try_state().expect("b5 scenario stays solvent");
            }
            "scalar_pair_exact" => {
                // PT-3: a complete pair redeems at exactly `a` per set.
                let amount = u128_field(inputs, "amount");
                let mut state = settled_scalar(score_1e9(inputs, "s").0, amount);
                state.redeem_scalar_pair(1, &1, amount).unwrap();
                assert_eq!(payout_of(&state), u128_field(row, "payout"), "{name}");
                state.try_state().expect("pair scenario stays solvent");
            }
            "gate_settlement_one_zero" => {
                // 03 §7: settle_gate pays 1:0 exactly. The escrow amount is not
                // part of the row's inputs (payouts are escrow-independent); use
                // the kernel minimum split so the program is legal on-chain.
                let amount_each = u128_field(inputs, "amount_each");
                let escrow = kernel::MIN_SPLIT_USDC.max(amount_each);
                let gate_kind = match inputs["gate"].as_str().expect("gate name") {
                    "Survival" => GateType::Survival,
                    "Security" => GateType::Security,
                    other => panic!("unknown gate {other}"),
                };
                let outcome = inputs["outcome"].as_bool().expect("gate outcome");
                let mut state = LedgerState::<u8>::new();
                state.create_vault(1, 0).unwrap();
                state.split(LedgerOrigin::Signed, 1, &1, escrow).unwrap();
                state
                    .split_gate(
                        LedgerOrigin::Signed,
                        1,
                        Branch::Accept,
                        gate_kind,
                        &1,
                        escrow,
                    )
                    .unwrap();
                state
                    .resolve(LedgerOrigin::ResolveAuthority, 1, Branch::Accept)
                    .unwrap();
                state
                    .settle_gate(LedgerOrigin::SettleAuthority, 1, gate_kind, outcome)
                    .unwrap();
                state
                    .settle_scalar(LedgerOrigin::SettleAuthority, 1, FixedU64(500_000_000))
                    .unwrap();
                state.redeem_gate(1, gate_kind, &1, amount_each).unwrap();
                assert_eq!(
                    payout_of(&state),
                    u128_field(row, "yes_payout"),
                    "{name} YES"
                );
                // 03 §7 settles gates 1:0. The Python legacy vault models the
                // losing side as a 0-payout redemption; the Rust core models
                // the same economics by giving the losing side no redemption
                // path at all: `redeem_gate` burns only the outcome side.
                // Witness the 0: drain the remaining winning-side supply, then
                // a further redemption fails while the holder still owns the
                // full losing-side balance — it is worth exactly no_payout = 0.
                assert_eq!(u128_field(row, "no_payout"), 0, "{name} NO expectation");
                state
                    .redeem_gate(1, gate_kind, &1, escrow - amount_each)
                    .unwrap();
                let before = state.clone();
                assert_eq!(
                    state.redeem_gate(1, gate_kind, &1, amount_each),
                    Err(Error::InsufficientPosition),
                    "{name} losing side must confer no payout"
                );
                assert_eq!(state, before, "{name} failed redemption must not mutate");
                let losing_kind = if outcome {
                    PositionKind::GateNo(gate_kind)
                } else {
                    PositionKind::GateYes(gate_kind)
                };
                let losing = position(1, Branch::Accept, losing_kind);
                assert_eq!(
                    state
                        .positions
                        .iter()
                        .find(|record| record.id == losing && record.owner == 1)
                        .map(|record| record.balance),
                    Some(escrow),
                    "{name} losing-side balance must survive worthless"
                );
                state.try_state().expect("gate scenario stays solvent");
            }
            "baseline_scalar_and_pair" => {
                let amount = u128_field(inputs, "amount");
                let epoch = u32::try_from(inputs["epoch"].as_u64().expect("epoch")).unwrap();
                let mut state = LedgerState::<u8>::new();
                state.create_baseline_vault(epoch).unwrap();
                state
                    .split_baseline(LedgerOrigin::Signed, epoch, &1, 2 * amount)
                    .unwrap();
                state
                    .settle_baseline(LedgerOrigin::SettleAuthority, epoch, score_1e9(inputs, "s"))
                    .unwrap();
                state
                    .redeem_baseline(epoch, ScalarSide::Long, &1, amount)
                    .unwrap();
                assert_eq!(
                    payout_of(&state),
                    u128_field(row, "long_payout"),
                    "{name} LONG"
                );
                state.redeem_baseline_pair(epoch, &1, amount).unwrap();
                assert_eq!(
                    payout_of(&state),
                    u128_field(row, "pair_payout"),
                    "{name} pair"
                );
                state.try_state().expect("baseline scenario stays solvent");
            }
            other => panic!("unknown legacy ledger scenario: {other}"),
        }
        assert!(
            replayed.insert(name.to_owned()),
            "duplicate scenario {name}"
        );
    }
    assert_eq!(replayed.len(), 5, "legacy replay executed-count drifted");
}

fn error_witness(operation: &str) -> Error {
    let mut state = LedgerState::<u8>::new();
    match operation {
        "split" => state
            .split(LedgerOrigin::Signed, 404, &1, kernel::MIN_SPLIT_USDC)
            .unwrap_err(),
        "split_baseline" => state
            .split_baseline(LedgerOrigin::Signed, 404, &1, kernel::MIN_SPLIT_USDC)
            .unwrap_err(),
        "split_after_resolve" => {
            state.create_vault(1, 0).unwrap();
            state
                .resolve(LedgerOrigin::ResolveAuthority, 1, Branch::Accept)
                .unwrap();
            let before = state.clone();
            let error = state
                .split(LedgerOrigin::Signed, 1, &1, kernel::MIN_SPLIT_USDC)
                .unwrap_err();
            assert_eq!(state, before);
            error
        }
        "split_below_minimum" => {
            state.create_vault(1, 0).unwrap();
            state
                .split(LedgerOrigin::Signed, 1, &1, kernel::MIN_SPLIT_USDC - 1)
                .unwrap_err()
        }
        "split_overflow" => {
            state.create_vault(1, 0).unwrap();
            state
                .split(
                    LedgerOrigin::Signed,
                    1,
                    &1,
                    u128::MAX - (kernel::MIN_SPLIT_USDC - 1),
                )
                .unwrap();
            let before = state.clone();
            let error = state
                .split(LedgerOrigin::Signed, 1, &1, kernel::MIN_SPLIT_USDC)
                .unwrap_err();
            assert_eq!(state, before);
            error
        }
        "merge_without_positions" => {
            state.create_vault(1, 0).unwrap();
            state
                .merge(LedgerOrigin::Signed, 1, &1, kernel::MIN_SPLIT_USDC)
                .unwrap_err()
        }
        "split_at_position_cap" => {
            for index in 0..32u64 {
                let pid = 1_000 + index;
                state.create_vault(pid, 0).unwrap();
                state
                    .split(LedgerOrigin::Signed, pid, &1, kernel::MIN_SPLIT_USDC)
                    .unwrap();
            }
            state.create_vault(1, 0).unwrap();
            let before = state.clone();
            let error = state
                .split(LedgerOrigin::Signed, 1, &1, kernel::MIN_SPLIT_USDC)
                .unwrap_err();
            assert_eq!(state, before);
            error
        }
        "settle_invalid_score" => {
            state.create_vault(1, 0).unwrap();
            state
                .resolve(LedgerOrigin::ResolveAuthority, 1, Branch::Accept)
                .unwrap();
            state
                .settle_scalar(LedgerOrigin::SettleAuthority, 1, FixedU64(1_000_000_001))
                .unwrap_err()
        }
        "settle_gate_twice" => {
            state.create_vault(1, 0).unwrap();
            state
                .resolve(LedgerOrigin::ResolveAuthority, 1, Branch::Accept)
                .unwrap();
            state
                .settle_gate(LedgerOrigin::SettleAuthority, 1, GateType::Survival, true)
                .unwrap();
            state
                .settle_gate(LedgerOrigin::SettleAuthority, 1, GateType::Survival, false)
                .unwrap_err()
        }
        "redeem_unsettled_gate" => {
            state = settled_scalar(500_000_000, kernel::MIN_SPLIT_USDC);
            state
                .redeem_gate(1, GateType::Survival, &1, kernel::MIN_SPLIT_USDC)
                .unwrap_err()
        }
        other => panic!("unknown generated error witness operation: {other}"),
    }
}

#[test]
fn ledger_error_vectors_equal_the_mapping_table() {
    let scenarios = fixture().ledger_error_scenarios;
    let exercised = scenarios
        .iter()
        .map(|scenario| {
            scenario.outcome["err"]
                .as_str()
                .unwrap_or_else(|| panic!("{} has no error outcome", scenario.name))
        })
        .collect::<BTreeSet<_>>();
    let mapped = ERROR_CLASSES.into_iter().collect::<BTreeSet<_>>();
    assert_eq!(exercised, mapped, "fixture/mapping error-class drift");

    for scenario in scenarios {
        let class = scenario.outcome["err"].as_str().unwrap();
        let actual = error_witness(&scenario.op.name);
        assert_eq!(
            actual,
            expected_error(class),
            "{} ({})",
            scenario.name,
            scenario.op.name
        );
    }
}
