//! Full generated-ledger corpus replay against `Instance1` (15 §4.4; I-37).
//!
//! The frame-free core already replays the Python reference model. This suite
//! closes the instance seam: every generated sequence and every representable
//! fee program is executed against both that core and the real ServiceLedger
//! FRAME shell. After every successful step it compares the complete logical
//! ledger state and the exact collateral-account deltas; after every refused
//! step it compares the error class and a byte-exact pre/post snapshot.

mod support;

use std::{collections::BTreeMap, fs, path::PathBuf};

use conditional_ledger_core::{
    baseline, position, BaselineVaultRecord, Error as CoreError, Event as CoreEvent, LedgerOrigin,
    LedgerState, PositionCount as CorePositionCount, PositionRecord, PositionTotal, VaultInfo,
    VaultRecord,
};
use frame_support::{assert_noop, assert_ok, dispatch::DispatchResult, instances::Instance1};
use futarchy_primitives::{
    kernel, Balance, Branch, FixedU64, GateType, PositionId, PositionKind, ProposalId, ScalarSide,
};
use parity_scale_codec::Encode;
use serde::Deserialize;
use serde_json::Value;
use sp_runtime::{DispatchError, Perbill};

use pallet_conditional_ledger as ledger;
use support::*;

type ServiceLedger = ledger::Pallet<Test, Instance1>;

#[derive(Deserialize)]
struct Fixture {
    ledger_sequence_scenarios: Vec<Program>,
    ledger_fee_scenarios: Vec<FeeProgram>,
    ledger_sweep_scenarios: Vec<SweepProgram>,
    ledger_score_scenarios: Vec<ScoreScenario>,
    ledger_scenarios: Vec<Value>,
    ledger_error_scenarios: Vec<ErrorScenario>,
}

#[derive(Deserialize)]
struct Program {
    name: String,
    initial_state: InitialState,
    ops: Vec<Step>,
}

#[derive(Deserialize)]
struct FeeProgram {
    name: String,
    params: FeeParams,
    initial_state: InitialState,
    ops: Vec<FeeStep>,
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
}

#[derive(Deserialize)]
struct InitialState {
    proposal_id: ProposalId,
    baseline_epoch: u32,
}

#[derive(Deserialize)]
struct Step {
    op: String,
    args: Value,
    outcome: Value,
}

#[derive(Deserialize)]
struct SweepProgram {
    name: String,
    family: String,
    id: u64,
    reap_batch: u32,
    expected_entries: usize,
    expected_batches: usize,
    expected_residue: Balance,
    expected_refunds: BTreeMap<String, Balance>,
    setup_ops: Vec<Step>,
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

fn fixture_failure(message: impl core::fmt::Display) -> ! {
    assert!(std::hint::black_box(false), "{message}");
    std::process::abort()
}

fn required_value<T>(value: Option<T>, context: impl core::fmt::Display) -> T {
    match value {
        Some(value) => value,
        None => fixture_failure(context),
    }
}

fn required_success<T, E: core::fmt::Debug>(
    result: Result<T, E>,
    context: impl core::fmt::Display,
) -> T {
    match result {
        Ok(value) => value,
        Err(error) => fixture_failure(format_args!("{context}: {error:?}")),
    }
}

fn required_failure<T: core::fmt::Debug, E>(
    result: Result<T, E>,
    context: impl core::fmt::Display,
) -> E {
    match result {
        Err(error) => error,
        Ok(value) => fixture_failure(format_args!("{context}: returned {value:?}")),
    }
}

fn vector_path() -> PathBuf {
    match std::env::var_os("BLEAVIT_LEDGER_VECTOR_PATH") {
        Some(path) => PathBuf::from(path),
        None => PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../reference-model/fixtures/vectors.json"),
    }
}

fn fixture() -> Fixture {
    let encoded = required_success(
        fs::read_to_string(vector_path()),
        "read shared reference-model vectors",
    );
    required_success(
        serde_json::from_str(&encoded),
        "parse shared reference-model vectors",
    )
}

fn service_pid(corpus_pid: ProposalId) -> ProposalId {
    required_value(
        kernel::SERVICE_ID_BASE.checked_add(corpus_pid.saturating_sub(1)),
        "generated proposal id maps into the service band",
    )
}

fn account(name: &str) -> AccountId {
    match name {
        "alice" => ALICE,
        "bob" => BOB,
        "carol" => CAROL,
        other => fixture_failure(format_args!("unknown generated holder {other}")),
    }
}

fn branch(name: &str) -> Branch {
    match name {
        "Accept" => Branch::Accept,
        "Reject" => Branch::Reject,
        other => fixture_failure(format_args!("unknown generated branch {other}")),
    }
}

fn gate(name: &str) -> GateType {
    match name {
        "Survival" => GateType::Survival,
        "Security" => GateType::Security,
        other => fixture_failure(format_args!("unknown generated gate {other}")),
    }
}

fn scalar_side(name: &str) -> ScalarSide {
    match name {
        "Long" => ScalarSide::Long,
        "Short" => ScalarSide::Short,
        other => fixture_failure(format_args!("unknown generated scalar side {other}")),
    }
}

fn string<'a>(value: &'a Value, key: &str) -> &'a str {
    required_value(
        value[key].as_str(),
        format_args!("missing generated string argument {key}"),
    )
}

fn amount(value: &Value) -> Balance {
    u128::from(required_value(
        value["amount"].as_u64(),
        "generated amount fits u64",
    ))
}

fn position_kind(value: &Value) -> PositionKind {
    match string(value, "kind") {
        "BranchUsdc" => PositionKind::BranchUsdc,
        "Long" => PositionKind::Long,
        "Short" => PositionKind::Short,
        "GateYes" => PositionKind::GateYes(gate(string(value, "gate"))),
        "GateNo" => PositionKind::GateNo(gate(string(value, "gate"))),
        other => fixture_failure(format_args!("unknown generated position kind {other}")),
    }
}

fn position_arg(value: &Value, pid: ProposalId, epoch: u32) -> PositionId {
    let coordinates = &value["position"];
    match string(coordinates, "family") {
        "proposal" => position(
            pid,
            branch(string(coordinates, "branch")),
            position_kind(coordinates),
        ),
        "baseline" => baseline(epoch, scalar_side(string(coordinates, "side"))),
        other => fixture_failure(format_args!("unknown generated position family {other}")),
    }
}

fn signed(who: AccountId) -> RuntimeOrigin {
    RuntimeOrigin::signed(who)
}

fn apply_core(
    state: &mut LedgerState<AccountId>,
    pid: ProposalId,
    epoch: u32,
    step: &Step,
) -> Result<(), CoreError> {
    let args = &step.args;
    let who = || account(string(args, "account"));
    match step.op.as_str() {
        "split" => state.split(LedgerOrigin::Signed, pid, &who(), amount(args)),
        "merge" => state.merge(LedgerOrigin::Signed, pid, &who(), amount(args)),
        "split_scalar" => state.split_scalar(
            LedgerOrigin::Signed,
            pid,
            branch(string(args, "branch")),
            &who(),
            amount(args),
        ),
        "merge_scalar" => state.merge_scalar(
            LedgerOrigin::Signed,
            pid,
            branch(string(args, "branch")),
            &who(),
            amount(args),
        ),
        "split_gate" => state.split_gate(
            LedgerOrigin::Signed,
            pid,
            branch(string(args, "branch")),
            gate(string(args, "gate")),
            &who(),
            amount(args),
        ),
        "merge_gate" => state.merge_gate(
            LedgerOrigin::Signed,
            pid,
            branch(string(args, "branch")),
            gate(string(args, "gate")),
            &who(),
            amount(args),
        ),
        "transfer" => state.transfer(
            LedgerOrigin::Signed,
            position_arg(args, pid, epoch),
            &account(string(args, "from")),
            &account(string(args, "to")),
            amount(args),
        ),
        "resolve" => state.resolve(
            LedgerOrigin::ResolveAuthority,
            pid,
            branch(string(args, "winner")),
        ),
        "void" => state.void(LedgerOrigin::ResolveAuthority, pid),
        "settle_scalar" => state.settle_scalar(
            LedgerOrigin::SettleAuthority,
            pid,
            FixedU64(required_value(args["s"].as_u64(), "generated score is u64")),
        ),
        "settle_gate" => state.settle_gate(
            LedgerOrigin::SettleAuthority,
            pid,
            gate(string(args, "gate")),
            required_value(args["outcome"].as_bool(), "generated gate outcome is bool"),
        ),
        "redeem" => state.redeem(pid, &who(), amount(args)),
        "redeem_scalar" => {
            state.redeem_scalar(pid, scalar_side(string(args, "side")), &who(), amount(args))
        }
        "redeem_scalar_pair" => state.redeem_scalar_pair(pid, &who(), amount(args)),
        "redeem_gate" => state.redeem_gate(pid, gate(string(args, "gate")), &who(), amount(args)),
        "redeem_void" => state.redeem_void(
            pid,
            branch(string(args, "branch")),
            position_kind(args),
            &who(),
            amount(args),
        ),
        "split_baseline" => state.split_baseline(LedgerOrigin::Signed, epoch, &who(), amount(args)),
        "merge_baseline" => state.merge_baseline(LedgerOrigin::Signed, epoch, &who(), amount(args)),
        "settle_baseline" => state.settle_baseline(
            LedgerOrigin::SettleAuthority,
            epoch,
            FixedU64(required_value(args["s"].as_u64(), "generated score is u64")),
        ),
        "redeem_baseline" => state.redeem_baseline(
            epoch,
            scalar_side(string(args, "side")),
            &who(),
            amount(args),
        ),
        "redeem_baseline_pair" => state.redeem_baseline_pair(epoch, &who(), amount(args)),
        "sweep_redemption_fees" => state.sweep_redemption_fees().map(|_| ()),
        other => fixture_failure(format_args!("unhandled generated operation {other}")),
    }
}

fn apply_frame(pid: ProposalId, epoch: u32, step: &Step) -> DispatchResult {
    let args = &step.args;
    let who = || account(string(args, "account"));
    match step.op.as_str() {
        "split" => ServiceLedger::split(signed(who()), pid, amount(args)),
        "merge" => ServiceLedger::merge(signed(who()), pid, amount(args)),
        "split_scalar" => ServiceLedger::split_scalar(
            signed(who()),
            pid,
            branch(string(args, "branch")),
            amount(args),
        ),
        "merge_scalar" => ServiceLedger::merge_scalar(
            signed(who()),
            pid,
            branch(string(args, "branch")),
            amount(args),
        ),
        "split_gate" => ServiceLedger::split_gate(
            signed(who()),
            pid,
            branch(string(args, "branch")),
            gate(string(args, "gate")),
            amount(args),
        ),
        "merge_gate" => ServiceLedger::merge_gate(
            signed(who()),
            pid,
            branch(string(args, "branch")),
            gate(string(args, "gate")),
            amount(args),
        ),
        "transfer" => ServiceLedger::transfer(
            signed(account(string(args, "from"))),
            position_arg(args, pid, epoch),
            account(string(args, "to")),
            amount(args),
        ),
        "resolve" => ServiceLedger::resolve(signed(RESOLVER), pid, branch(string(args, "winner"))),
        "void" => ServiceLedger::void(signed(RESOLVER), pid),
        "settle_scalar" => ServiceLedger::settle_scalar(
            signed(SETTLER),
            pid,
            FixedU64(required_value(args["s"].as_u64(), "generated score is u64")),
        ),
        "settle_gate" => ServiceLedger::settle_gate(
            signed(SETTLER),
            pid,
            gate(string(args, "gate")),
            required_value(args["outcome"].as_bool(), "generated gate outcome is bool"),
        ),
        "redeem" => ServiceLedger::redeem(signed(who()), pid, amount(args)),
        "redeem_scalar" => ServiceLedger::redeem_scalar(
            signed(who()),
            pid,
            scalar_side(string(args, "side")),
            amount(args),
        ),
        "redeem_scalar_pair" => ServiceLedger::redeem_scalar_pair(signed(who()), pid, amount(args)),
        "redeem_gate" => {
            ServiceLedger::redeem_gate(signed(who()), pid, gate(string(args, "gate")), amount(args))
        }
        "redeem_void" => ServiceLedger::redeem_void(
            signed(who()),
            pid,
            branch(string(args, "branch")),
            position_kind(args),
            amount(args),
        ),
        "split_baseline" => ServiceLedger::split_baseline(signed(who()), epoch, amount(args)),
        "merge_baseline" => ServiceLedger::merge_baseline(signed(who()), epoch, amount(args)),
        "settle_baseline" => ServiceLedger::settle_baseline(
            signed(SETTLER),
            epoch,
            FixedU64(required_value(args["s"].as_u64(), "generated score is u64")),
        ),
        "redeem_baseline" => ServiceLedger::redeem_baseline(
            signed(who()),
            epoch,
            scalar_side(string(args, "side")),
            amount(args),
        ),
        "redeem_baseline_pair" => {
            ServiceLedger::redeem_baseline_pair(signed(who()), epoch, amount(args))
        }
        "sweep_redemption_fees" => ServiceLedger::sweep_redemption_fees(signed(DAVE)),
        other => fixture_failure(format_args!("unhandled generated operation {other}")),
    }
}

fn expected_core_error(class: &str) -> CoreError {
    match class {
        "UnknownVault" => CoreError::UnknownVault,
        "UnknownBaselineVault" => CoreError::UnknownBaselineVault,
        "WrongVaultState" => CoreError::WrongVaultState,
        "AmountTooSmall" => CoreError::AmountTooSmall,
        "ArithmeticOverflow" => CoreError::ArithmeticOverflow,
        "InsufficientPosition" => CoreError::InsufficientPosition,
        "PositionCapExceeded" => CoreError::PositionCapExceeded,
        "InvalidScore" => CoreError::InvalidScore,
        "GateAlreadySettled" => CoreError::GateAlreadySettled,
        "GateNotSettled" => CoreError::GateNotSettled,
        other => fixture_failure(format_args!("unknown generated core error class {other}")),
    }
}

fn expected_frame_error(class: &str) -> DispatchError {
    match class {
        "UnknownVault" => ledger::Error::<Test, Instance1>::UnknownVault.into(),
        "UnknownBaselineVault" => ledger::Error::<Test, Instance1>::UnknownBaselineVault.into(),
        "WrongVaultState" => ledger::Error::<Test, Instance1>::WrongVaultState.into(),
        "AmountTooSmall" => ledger::Error::<Test, Instance1>::BelowMinimum.into(),
        "ArithmeticOverflow" => ledger::Error::<Test, Instance1>::ArithmeticOverflow.into(),
        "InsufficientPosition" => ledger::Error::<Test, Instance1>::InsufficientPosition.into(),
        "PositionCapExceeded" => ledger::Error::<Test, Instance1>::TooManyPositions.into(),
        "InvalidScore" => ledger::Error::<Test, Instance1>::InvalidScore.into(),
        "GateAlreadySettled" => ledger::Error::<Test, Instance1>::GateAlreadySettled.into(),
        "GateNotSettled" => ledger::Error::<Test, Instance1>::GateNotSettled.into(),
        other => fixture_failure(format_args!("unknown generated FRAME error class {other}")),
    }
}

fn core_event(event: ledger::Event<Test, Instance1>) -> Option<CoreEvent> {
    Some(match event {
        ledger::Event::Split { pid, amount } => CoreEvent::Split(pid, amount),
        ledger::Event::Merged { pid, amount } => CoreEvent::Merged(pid, amount),
        ledger::Event::ScalarSplit {
            pid,
            branch,
            amount,
        } => CoreEvent::ScalarSplit(pid, branch, amount),
        ledger::Event::ScalarMerged {
            pid,
            branch,
            amount,
        } => CoreEvent::ScalarMerged(pid, branch, amount),
        ledger::Event::GateSplit {
            pid,
            branch,
            gate,
            amount,
        } => CoreEvent::GateSplit(pid, branch, gate, amount),
        ledger::Event::GateMerged {
            pid,
            branch,
            gate,
            amount,
        } => CoreEvent::GateMerged(pid, branch, gate, amount),
        ledger::Event::PositionTransferred { position, amount } => {
            CoreEvent::PositionTransferred(position, amount)
        }
        ledger::Event::BaselineSplit { epoch, amount } => CoreEvent::BaselineSplit(epoch, amount),
        ledger::Event::BaselineMerged { epoch, amount } => CoreEvent::BaselineMerged(epoch, amount),
        ledger::Event::VaultResolved { pid, branch } => CoreEvent::VaultResolved(pid, branch),
        ledger::Event::VaultVoided { pid } => CoreEvent::VaultVoided(pid),
        ledger::Event::ScalarSettlementSet { pid, branch, s } => {
            CoreEvent::ScalarSettlementSet(pid, branch, s)
        }
        ledger::Event::GateSettled {
            pid,
            branch,
            gate,
            outcome,
        } => CoreEvent::GateSettled(pid, branch, gate, outcome),
        ledger::Event::BaselineSettled { epoch, s } => CoreEvent::BaselineSettled(epoch, s),
        ledger::Event::Redeemed { pid, amount } => CoreEvent::Redeemed(pid, amount),
        ledger::Event::ScalarRedeemed {
            pid,
            side,
            payout,
            fee,
        } => CoreEvent::ScalarRedeemed(pid, side, payout, fee),
        ledger::Event::ScalarPairRedeemed { pid, amount, fee } => {
            CoreEvent::ScalarPairRedeemed(pid, amount, fee)
        }
        ledger::Event::GateRedeemed {
            pid,
            gate,
            amount,
            fee,
        } => CoreEvent::GateRedeemed(pid, gate, amount, fee),
        ledger::Event::VoidRedeemed {
            pid,
            kind,
            amount,
            payout,
        } => CoreEvent::VoidRedeemed(pid, kind, amount, payout),
        ledger::Event::BaselineRedeemed {
            epoch,
            side,
            payout,
            fee,
        } => CoreEvent::BaselineRedeemed(epoch, side, payout, fee),
        ledger::Event::RedemptionFeesSwept { amount } => CoreEvent::RedemptionFeesSwept(amount),
        ledger::Event::VaultReaped { pid, residue } => CoreEvent::VaultReaped(pid, residue),
        ledger::Event::BaselineVaultReaped { epoch, residue } => {
            CoreEvent::BaselineVaultReaped(epoch, residue)
        }
        ledger::Event::SplitPauseSet { .. }
        | ledger::Event::SplitPauseCleared
        | ledger::Event::FreezeSet { .. }
        | ledger::Event::FreezeCleared
        | ledger::Event::FreezeExtended { .. }
        | ledger::Event::LedgerDriftDetected { .. }
        | ledger::Event::LedgerDriftCleared { .. } => return None,
    })
}

fn normalize(state: &mut LedgerState<AccountId>) {
    state.vaults.sort_by_key(|record| record.proposal);
    state.baseline_vaults.sort_by_key(|record| record.epoch);
    state.positions.retain(|record| record.balance != 0);
    state.positions.sort_by_key(|record| {
        let mut key = record.id.encode();
        key.extend(record.owner.encode());
        key
    });
    state.position_counts.retain(|record| record.count != 0);
    state
        .position_counts
        .sort_by_key(|record| record.owner.encode());
    state.position_totals.retain(|record| record.total != 0);
    state
        .position_totals
        .sort_by_key(|record| record.id.encode());
    state.protocol_accounts.sort_by_key(Encode::encode);
}

fn frame_state(protocol_accounts: &[AccountId]) -> LedgerState<AccountId> {
    let mut state = LedgerState::new();
    state.vaults = ledger::Vaults::<Test, Instance1>::iter()
        .map(|(proposal, info)| VaultRecord { proposal, info })
        .collect();
    state.baseline_vaults = ledger::BaselineVaults::<Test, Instance1>::iter()
        .map(|(epoch, info)| BaselineVaultRecord { epoch, info })
        .collect();
    state.positions = ledger::Positions::<Test, Instance1>::iter()
        .map(|(id, owner, balance)| PositionRecord {
            id,
            deposit: if ServiceDomain::is_protocol(&owner) {
                0
            } else {
                PositionDeposit::get()
            },
            owner,
            balance,
        })
        .collect();
    state.position_counts = ledger::PositionCount::<Test, Instance1>::iter()
        .map(|(owner, count)| CorePositionCount { owner, count })
        .collect();
    state.position_totals = ledger::PositionTotals::<Test, Instance1>::iter()
        .map(|(id, total)| PositionTotal { id, total })
        .collect();
    state.deposits_held = ledger::DepositsHeld::<Test, Instance1>::get();
    state.redeem_fee = RedemptionFee::get().deconstruct();
    state.min_split = MinSplit::get();
    state.redemption_fees_accrued = ledger::RedemptionFeesAccrued::<Test, Instance1>::get();
    state.protocol_accounts = protocol_accounts.to_vec();
    state.events = System::events()
        .into_iter()
        .filter_map(|record| match record.event {
            RuntimeEvent::ServiceLedger(event) => core_event(event),
            _ => None,
        })
        .collect();
    normalize(&mut state);
    state
}

fn assert_states_equal(
    name: &str,
    index: usize,
    op: &str,
    core: &LedgerState<AccountId>,
    protocol_accounts: &[AccountId],
) {
    let mut expected = core.clone();
    normalize(&mut expected);
    let actual = frame_state(protocol_accounts);
    assert_eq!(
        actual, expected,
        "{name} op {index} ({op}) FRAME/core logical-state mismatch"
    );
    assert_eq!(
        core.try_state(),
        Ok(()),
        "{name} op {index} ({op}) core try-state"
    );
    assert_ok!(ServiceLedger::do_try_state());
}

fn collateral_balances() -> BTreeMap<AccountId, Balance> {
    [ALICE, BOB, CAROL, service_account(), SERVICE_MAIN]
        .into_iter()
        .map(|who| (who, Assets::balance(USDC, who)))
        .collect()
}

fn debit(balances: &mut BTreeMap<AccountId, Balance>, who: AccountId, amount: Balance) {
    let value = required_value(balances.get_mut(&who), "tracked collateral account");
    *value = required_value(
        value.checked_sub(amount),
        "generated program remains funded",
    );
}

fn credit(balances: &mut BTreeMap<AccountId, Balance>, who: AccountId, amount: Balance) {
    let value = required_value(balances.get_mut(&who), "tracked collateral account");
    *value = required_value(
        value.checked_add(amount),
        "generated collateral balance does not overflow",
    );
}

fn apply_collateral_effect(
    step: &Step,
    event: &CoreEvent,
    before: &LedgerState<AccountId>,
    after: &LedgerState<AccountId>,
    balances: &mut BTreeMap<AccountId, Balance>,
) {
    let who = || account(string(&step.args, "account"));
    let sovereign = service_account();
    let deposits = |state: &LedgerState<AccountId>| {
        let mut totals = BTreeMap::<AccountId, Balance>::new();
        for record in &state.positions {
            let value = totals.entry(record.owner).or_default();
            *value = required_value(
                value.checked_add(record.deposit),
                "generated deposit total does not overflow",
            );
        }
        totals
    };
    let before_deposits = deposits(before);
    let after_deposits = deposits(after);
    for owner in [ALICE, BOB, CAROL] {
        let old = before_deposits.get(&owner).copied().unwrap_or(0);
        let new = after_deposits.get(&owner).copied().unwrap_or(0);
        if new > old {
            debit(balances, owner, new - old);
            credit(balances, sovereign, new - old);
        } else if old > new {
            credit(balances, owner, old - new);
            debit(balances, sovereign, old - new);
        }
    }
    match step.op.as_str() {
        "split" | "split_baseline" => {
            debit(balances, who(), amount(&step.args));
            credit(balances, sovereign, amount(&step.args));
        }
        "merge" | "merge_baseline" => {
            credit(balances, who(), amount(&step.args));
            debit(balances, sovereign, amount(&step.args));
        }
        "redeem" => {
            let payout = match event {
                CoreEvent::Redeemed(_, payout) => payout,
                other => fixture_failure(format_args!("redeem emitted {other:?}")),
            };
            credit(balances, who(), *payout);
            debit(balances, sovereign, *payout);
        }
        "redeem_scalar" => {
            let (gross, fee) = match event {
                CoreEvent::ScalarRedeemed(_, _, gross, fee) => (gross, fee),
                other => fixture_failure(format_args!("scalar redemption emitted {other:?}")),
            };
            credit(balances, who(), gross - fee);
            debit(balances, sovereign, gross - fee);
        }
        "redeem_scalar_pair" => {
            let (gross, fee) = match event {
                CoreEvent::ScalarPairRedeemed(_, gross, fee) => (gross, fee),
                other => fixture_failure(format_args!("scalar-pair redemption emitted {other:?}")),
            };
            credit(balances, who(), gross - fee);
            debit(balances, sovereign, gross - fee);
        }
        "redeem_gate" => {
            let (gross, fee) = match event {
                CoreEvent::GateRedeemed(_, _, gross, fee) => (gross, fee),
                other => fixture_failure(format_args!("gate redemption emitted {other:?}")),
            };
            credit(balances, who(), gross - fee);
            debit(balances, sovereign, gross - fee);
        }
        "redeem_void" => {
            let payout = match event {
                CoreEvent::VoidRedeemed(_, _, _, payout) => payout,
                other => fixture_failure(format_args!("VOID redemption emitted {other:?}")),
            };
            credit(balances, who(), *payout);
            debit(balances, sovereign, *payout);
        }
        "redeem_baseline" | "redeem_baseline_pair" => {
            let (gross, fee) = match event {
                CoreEvent::BaselineRedeemed(_, _, gross, fee) => (gross, fee),
                other => fixture_failure(format_args!("Baseline redemption emitted {other:?}")),
            };
            credit(balances, who(), gross - fee);
            debit(balances, sovereign, gross - fee);
        }
        "sweep_redemption_fees" => {
            let amount = match event {
                CoreEvent::RedemptionFeesSwept(amount) => amount,
                other => fixture_failure(format_args!("fee sweep emitted {other:?}")),
            };
            debit(balances, sovereign, *amount);
            credit(balances, SERVICE_MAIN, *amount);
        }
        _ => {}
    }
}

fn payout(event: &CoreEvent) -> Option<Balance> {
    match event {
        CoreEvent::Redeemed(_, payout)
        | CoreEvent::ScalarPairRedeemed(_, payout, _)
        | CoreEvent::ScalarRedeemed(_, _, payout, _)
        | CoreEvent::GateRedeemed(_, _, payout, _)
        | CoreEvent::VoidRedeemed(_, _, _, payout)
        | CoreEvent::BaselineRedeemed(_, _, payout, _) => Some(*payout),
        _ => None,
    }
}

fn failure_snapshot() -> Vec<u8> {
    (
        snapshot::<ServiceDomain>(),
        [ALICE, BOB].map(|who| (who, Assets::balance(USDC, who), Balances::free_balance(who))),
        System::events().encode(),
    )
        .encode()
}

fn run_program(
    name: &str,
    initial: &InitialState,
    steps: &[Step],
    rate: u32,
    min_split: Balance,
    protocol_accounts: Vec<AccountId>,
) {
    new_test_ext().execute_with(|| {
        RedemptionFee::set(Perbill::from_parts(rate));
        MinSplit::set(min_split);
        ServiceDomain::set_protocol_extras(protocol_accounts.clone());

        let pid = service_pid(initial.proposal_id);
        let epoch = initial.baseline_epoch;
        let mut core = LedgerState::<AccountId>::new();
        required_success(core.create_vault(pid, 0), "create core proposal vault");
        required_success(
            core.create_baseline_vault(epoch),
            "create core Baseline vault",
        );
        core.redeem_fee = rate;
        core.min_split = min_split;
        for who in &protocol_accounts {
            core.add_protocol_account(*who);
        }
        assert_ok!(ServiceLedger::create_vault(signed(MARKET), pid, 0));
        assert_ok!(ServiceLedger::create_baseline_vault(signed(MARKET), epoch));

        let mut expected_balances = collateral_balances();
        assert_states_equal(name, 0, "initial", &core, &protocol_accounts);
        for (index, step) in steps.iter().enumerate() {
            let core_before = core.clone();
            let frame_before = failure_snapshot();
            let core_result = apply_core(&mut core, pid, epoch, step);
            let frame_result = apply_frame(pid, epoch, step);
            if step.outcome.get("ok").is_some() {
                assert_eq!(
                    core_result,
                    Ok(()),
                    "{name} op {index} ({}) core refused",
                    step.op
                );
                assert_eq!(
                    frame_result,
                    Ok(()),
                    "{name} op {index} ({}) FRAME refused",
                    step.op
                );
                let event = required_value(
                    core.events.last(),
                    format_args!("{name} op {index} ({}) emitted no core event", step.op),
                );
                if let Some(expected) = step.args.get("_expected_payout").and_then(Value::as_u64) {
                    assert_eq!(
                        payout(event),
                        Some(u128::from(expected)),
                        "{name} op {index} ({}) corpus payout mismatch",
                        step.op
                    );
                }
                apply_collateral_effect(step, event, &core_before, &core, &mut expected_balances);
                assert_eq!(
                    collateral_balances(),
                    expected_balances,
                    "{name} op {index} ({}) collateral recipient/custody mismatch",
                    step.op
                );
                assert_states_equal(name, index, &step.op, &core, &protocol_accounts);
            } else {
                let class = required_value(
                    step.outcome["err"].as_str(),
                    format_args!("{name} op {index} has malformed outcome"),
                );
                assert_eq!(
                    core_result,
                    Err(expected_core_error(class)),
                    "{name} op {index} ({}) core error mismatch",
                    step.op
                );
                assert_eq!(
                    frame_result,
                    Err(expected_frame_error(class)),
                    "{name} op {index} ({}) FRAME error mismatch",
                    step.op
                );
                assert_eq!(
                    core, core_before,
                    "{name} op {index} ({}) mutated core on refusal",
                    step.op
                );
                assert_eq!(
                    failure_snapshot(),
                    frame_before,
                    "{name} op {index} ({}) mutated FRAME state on refusal",
                    step.op
                );
                assert_eq!(collateral_balances(), expected_balances);
            }
        }
    });
}

#[test]
fn all_64_sequence_programs_replay_against_service_instance() {
    let programs = fixture().ledger_sequence_scenarios;
    assert_eq!(
        programs.len(),
        64,
        "ledger sequence corpus cardinality drift"
    );
    for program in programs {
        run_program(
            &program.name,
            &program.initial_state,
            &program.ops,
            0,
            kernel::MIN_SPLIT_USDC,
            Vec::new(),
        );
    }
}

#[test]
fn all_representable_fee_programs_replay_against_service_instance() {
    let programs = fixture().ledger_fee_scenarios;
    assert_eq!(programs.len(), 11, "ledger fee corpus cardinality drift");
    let mut malformed_rate_rows = 0;
    for program in programs {
        assert_eq!(program.params.contract_version, 17, "{}", program.name);
        let rate = required_success(
            u32::try_from(program.params.redeem_fee_perbill),
            "generated fee rate fits u32",
        );
        if rate > conditional_ledger_core::PERBILL_ONE {
            // The core's defensive malformed-state row cannot cross a FRAME
            // `Get<Perbill>` boundary: `Perbill::from_parts` clamps before the
            // pallet sees it. Keep the row explicit and prove both facts; the
            // other ten rows are replayed end-to-end against Instance1.
            malformed_rate_rows += 1;
            assert_eq!(program.name, "fee-10-out-of-domain-rate-reads-as-zero");
            assert_eq!(conditional_ledger_core::effective_redeem_fee(rate), 0);
            assert_eq!(
                Perbill::from_parts(rate).deconstruct(),
                conditional_ledger_core::PERBILL_ONE
            );
            continue;
        }
        let protocol_accounts = program
            .params
            .protocol_accounts
            .iter()
            .map(|name| account(name))
            .collect();
        let steps = program
            .ops
            .iter()
            .map(|row| Step {
                op: row.step.op.clone(),
                args: row.step.args.clone(),
                outcome: row.step.outcome.clone(),
            })
            .collect::<Vec<_>>();
        run_program(
            &program.name,
            &program.initial_state,
            &steps,
            rate,
            u128::from(program.params.min_split),
            protocol_accounts,
        );
    }
    assert_eq!(malformed_rate_rows, 1);
}

fn ok_step(op: &str, args: Value) -> Step {
    Step {
        op: op.to_owned(),
        args,
        outcome: serde_json::json!({ "ok": {} }),
    }
}

fn settled_scalar_steps(amount: Balance, score: u64) -> Vec<Step> {
    vec![
        ok_step(
            "split",
            serde_json::json!({ "account": "alice", "amount": amount }),
        ),
        ok_step(
            "split_scalar",
            serde_json::json!({
                "account": "alice",
                "amount": amount,
                "branch": "Accept"
            }),
        ),
        ok_step("resolve", serde_json::json!({ "winner": "Accept" })),
        ok_step("settle_scalar", serde_json::json!({ "s": score })),
    ]
}

#[test]
fn all_score_endpoint_and_rounding_rows_replay_against_service_instance() {
    let rows = fixture().ledger_score_scenarios;
    assert_eq!(rows.len(), 10, "ledger score corpus cardinality drift");
    let initial = InitialState {
        proposal_id: 1,
        baseline_epoch: 7,
    };
    for row in rows {
        let amount = Balance::from(row.amount);
        for (label, op, side, expected) in [
            ("long", "redeem_scalar", Some("Long"), row.long_payout),
            ("short", "redeem_scalar", Some("Short"), row.short_payout),
            ("pair", "redeem_scalar_pair", None, row.pair_payout),
        ] {
            let mut steps = settled_scalar_steps(amount, row.score);
            let mut args = serde_json::json!({
                "account": "alice",
                "amount": amount,
                "_expected_payout": expected
            });
            if let Some(side) = side {
                args["side"] = Value::from(side);
            }
            steps.push(ok_step(op, args));
            run_program(
                &format!("{}-{label}", row.name),
                &initial,
                &steps,
                0,
                kernel::MIN_SPLIT_USDC,
                Vec::new(),
            );
        }
    }
}

fn legacy_u128(row: &Value, key: &str) -> Balance {
    Balance::from(required_value(
        row[key].as_u64(),
        format_args!("legacy field {key} must be u64"),
    ))
}

fn legacy_score(row: &Value, key: &str) -> u64 {
    let text = required_value(
        row[key].as_str(),
        format_args!("legacy score field {key} must be a string"),
    );
    let (integer, fraction) = match text.split_once('.') {
        Some(parts) => parts,
        None => (text, ""),
    };
    assert!(fraction.len() <= 9, "legacy score exceeds the 1e9 grid");
    let mut digits = fraction.to_owned();
    while digits.len() < 9 {
        digits.push('0');
    }
    let integer = required_success(integer.parse::<u64>(), "legacy score integer");
    let fraction = required_success(digits.parse::<u64>(), "legacy score fractional digits");
    let scaled = required_value(
        integer.checked_mul(1_000_000_000),
        "legacy score integer fits u64",
    );
    required_value(scaled.checked_add(fraction), "legacy score fits u64")
}

#[test]
fn all_five_worked_ledger_rows_replay_against_service_instance() {
    let rows = fixture().ledger_scenarios;
    assert_eq!(rows.len(), 5, "worked-ledger corpus cardinality drift");
    let initial = InitialState {
        proposal_id: 1,
        baseline_epoch: 7,
    };
    for row in rows {
        let name = required_value(row["name"].as_str(), "worked row has a name");
        let inputs = &row["inputs"];
        let steps = match name {
            "void_branch_and_leg_floors" => {
                let branch_amount = legacy_u128(inputs, "branch_amount");
                let leg_amount = legacy_u128(inputs, "scalar_leg_amount");
                vec![
                    ok_step(
                        "split",
                        serde_json::json!({ "account": "alice", "amount": branch_amount }),
                    ),
                    ok_step(
                        "split_scalar",
                        serde_json::json!({
                            "account": "alice",
                            "amount": leg_amount,
                            "branch": "Accept"
                        }),
                    ),
                    ok_step("void", serde_json::json!({})),
                    ok_step(
                        "redeem_void",
                        serde_json::json!({
                            "account": "alice",
                            "amount": branch_amount,
                            "branch": "Reject",
                            "kind": "BranchUsdc",
                            "_expected_payout": legacy_u128(&row, "branch_payout")
                        }),
                    ),
                    ok_step(
                        "redeem_void",
                        serde_json::json!({
                            "account": "alice",
                            "amount": leg_amount,
                            "branch": "Accept",
                            "kind": "Long",
                            "_expected_payout": legacy_u128(&row, "leg_payout")
                        }),
                    ),
                ]
            }
            "b5_scalar_fragmentation" => {
                let escrow = legacy_u128(inputs, "escrow");
                let mut steps = settled_scalar_steps(escrow, legacy_score(inputs, "s"));
                steps.push(ok_step(
                    "redeem_scalar",
                    serde_json::json!({
                        "account": "alice",
                        "amount": escrow,
                        "side": "Long",
                        "_expected_payout": legacy_u128(&row, "long_payout")
                    }),
                ));
                for expected in required_value(
                    row["short_payouts"].as_array(),
                    "short payouts are an array",
                ) {
                    steps.push(ok_step(
                        "redeem_scalar",
                        serde_json::json!({
                            "account": "alice",
                            "amount": escrow / 2,
                            "side": "Short",
                            "_expected_payout": expected
                        }),
                    ));
                }
                steps
            }
            "scalar_pair_exact" => {
                let amount = legacy_u128(inputs, "amount");
                let mut steps = settled_scalar_steps(amount, legacy_score(inputs, "s"));
                steps.push(ok_step(
                    "redeem_scalar_pair",
                    serde_json::json!({
                        "account": "alice",
                        "amount": amount,
                        "_expected_payout": legacy_u128(&row, "payout")
                    }),
                ));
                steps
            }
            "gate_settlement_one_zero" => {
                let amount = legacy_u128(inputs, "amount_each");
                let escrow = kernel::MIN_SPLIT_USDC.max(amount);
                let gate = required_value(inputs["gate"].as_str(), "worked gate name");
                let outcome = required_value(inputs["outcome"].as_bool(), "worked gate outcome");
                assert_eq!(legacy_u128(&row, "no_payout"), 0);
                vec![
                    ok_step(
                        "split",
                        serde_json::json!({ "account": "alice", "amount": escrow }),
                    ),
                    ok_step(
                        "split_gate",
                        serde_json::json!({
                            "account": "alice",
                            "amount": escrow,
                            "branch": "Accept",
                            "gate": gate
                        }),
                    ),
                    ok_step("resolve", serde_json::json!({ "winner": "Accept" })),
                    ok_step(
                        "settle_gate",
                        serde_json::json!({ "gate": gate, "outcome": outcome }),
                    ),
                    ok_step("settle_scalar", serde_json::json!({ "s": 500_000_000 })),
                    ok_step(
                        "redeem_gate",
                        serde_json::json!({
                            "account": "alice",
                            "amount": amount,
                            "gate": gate,
                            "_expected_payout": legacy_u128(&row, "yes_payout")
                        }),
                    ),
                ]
            }
            "baseline_scalar_and_pair" => {
                let amount = legacy_u128(inputs, "amount");
                assert_eq!(inputs["epoch"].as_u64(), Some(7));
                vec![
                    ok_step(
                        "split_baseline",
                        serde_json::json!({ "account": "alice", "amount": 2 * amount }),
                    ),
                    ok_step(
                        "settle_baseline",
                        serde_json::json!({ "s": legacy_score(inputs, "s") }),
                    ),
                    ok_step(
                        "redeem_baseline",
                        serde_json::json!({
                            "account": "alice",
                            "amount": amount,
                            "side": "Long",
                            "_expected_payout": legacy_u128(&row, "long_payout")
                        }),
                    ),
                    ok_step(
                        "redeem_baseline_pair",
                        serde_json::json!({
                            "account": "alice",
                            "amount": amount,
                            "_expected_payout": legacy_u128(&row, "pair_payout")
                        }),
                    ),
                ]
            }
            other => fixture_failure(format_args!("unknown worked ledger row {other}")),
        };
        run_program(
            name,
            &initial,
            &steps,
            0,
            kernel::MIN_SPLIT_USDC,
            Vec::new(),
        );
    }
}

fn refused(call: impl FnOnce() -> DispatchResult) -> DispatchError {
    let before = failure_snapshot();
    let error = required_failure(call(), "generated error witness must be refused");
    assert_eq!(
        failure_snapshot(),
        before,
        "generated refusal must be status-quo atomic"
    );
    error
}

fn frame_error_witness(operation: &str) -> DispatchError {
    let pid = kernel::SERVICE_ID_BASE;
    match operation {
        "split" => {
            refused(|| ServiceLedger::split(signed(ALICE), pid + 404, kernel::MIN_SPLIT_USDC))
        }
        "split_baseline" => {
            refused(|| ServiceLedger::split_baseline(signed(ALICE), 404, kernel::MIN_SPLIT_USDC))
        }
        "split_after_resolve" => {
            assert_ok!(ServiceLedger::create_vault(signed(MARKET), pid, 0));
            assert_ok!(ServiceLedger::resolve(
                signed(RESOLVER),
                pid,
                Branch::Accept
            ));
            refused(|| ServiceLedger::split(signed(ALICE), pid, kernel::MIN_SPLIT_USDC))
        }
        "split_below_minimum" => {
            assert_ok!(ServiceLedger::create_vault(signed(MARKET), pid, 0));
            refused(|| ServiceLedger::split(signed(ALICE), pid, kernel::MIN_SPLIT_USDC - 1))
        }
        "split_overflow" => {
            let mut info = VaultInfo::open(0);
            info.escrowed = Balance::MAX - (kernel::MIN_SPLIT_USDC - 1);
            ledger::Vaults::<Test, Instance1>::insert(pid, info);
            refused(|| ServiceLedger::split(signed(ALICE), pid, kernel::MIN_SPLIT_USDC))
        }
        "merge_without_positions" => {
            assert_ok!(ServiceLedger::create_vault(signed(MARKET), pid, 0));
            refused(|| ServiceLedger::merge(signed(ALICE), pid, kernel::MIN_SPLIT_USDC))
        }
        "split_at_position_cap" => {
            for offset in 0..32 {
                let seeded = pid + offset;
                assert_ok!(ServiceLedger::create_vault(signed(MARKET), seeded, 0));
                assert_ok!(ServiceLedger::split(
                    signed(ALICE),
                    seeded,
                    kernel::MIN_SPLIT_USDC
                ));
            }
            let target = pid + 100;
            assert_ok!(ServiceLedger::create_vault(signed(MARKET), target, 0));
            refused(|| ServiceLedger::split(signed(ALICE), target, kernel::MIN_SPLIT_USDC))
        }
        "settle_invalid_score" => {
            assert_ok!(ServiceLedger::create_vault(signed(MARKET), pid, 0));
            assert_ok!(ServiceLedger::resolve(
                signed(RESOLVER),
                pid,
                Branch::Accept
            ));
            refused(|| ServiceLedger::settle_scalar(signed(SETTLER), pid, FixedU64(1_000_000_001)))
        }
        "settle_gate_twice" => {
            assert_ok!(ServiceLedger::create_vault(signed(MARKET), pid, 0));
            assert_ok!(ServiceLedger::resolve(
                signed(RESOLVER),
                pid,
                Branch::Accept
            ));
            assert_ok!(ServiceLedger::settle_gate(
                signed(SETTLER),
                pid,
                GateType::Survival,
                true
            ));
            refused(|| ServiceLedger::settle_gate(signed(SETTLER), pid, GateType::Survival, false))
        }
        "redeem_unsettled_gate" => {
            assert_ok!(ServiceLedger::create_vault(signed(MARKET), pid, 0));
            assert_ok!(ServiceLedger::split(
                signed(ALICE),
                pid,
                kernel::MIN_SPLIT_USDC
            ));
            assert_ok!(ServiceLedger::split_gate(
                signed(ALICE),
                pid,
                Branch::Accept,
                GateType::Survival,
                kernel::MIN_SPLIT_USDC
            ));
            assert_ok!(ServiceLedger::resolve(
                signed(RESOLVER),
                pid,
                Branch::Accept
            ));
            assert_ok!(ServiceLedger::settle_scalar(
                signed(SETTLER),
                pid,
                FixedU64(500_000_000)
            ));
            refused(|| {
                ServiceLedger::redeem_gate(
                    signed(ALICE),
                    pid,
                    GateType::Survival,
                    kernel::MIN_SPLIT_USDC,
                )
            })
        }
        other => fixture_failure(format_args!("unknown generated error witness {other}")),
    }
}

#[test]
fn all_ten_error_class_witnesses_replay_against_service_instance() {
    let rows = fixture().ledger_error_scenarios;
    assert_eq!(rows.len(), 10, "ledger error corpus cardinality drift");
    for row in rows {
        new_test_ext().execute_with(|| {
            let class = required_value(
                row.outcome["err"].as_str(),
                format_args!("{} has no error class", row.name),
            );
            assert_eq!(
                frame_error_witness(&row.op.name),
                expected_frame_error(class),
                "{} ({})",
                row.name,
                row.op.name
            );
        });
    }
}

fn belongs_to_family(id: PositionId, family: &str, target: u64) -> bool {
    match (family, id) {
        ("proposal", PositionId::Proposal { proposal, .. }) => proposal == target,
        ("baseline", PositionId::Baseline { epoch, .. }) => u64::from(epoch) == target,
        _ => false,
    }
}

fn family_position_entries(family: &str, target: u64) -> usize {
    ledger::Positions::<Test, Instance1>::iter()
        .filter(|(id, _, _)| belongs_to_family(*id, family, target))
        .count()
}

fn family_position_totals(family: &str, target: u64) -> usize {
    ledger::PositionTotals::<Test, Instance1>::iter()
        .filter(|(id, _)| belongs_to_family(*id, family, target))
        .count()
}

#[test]
fn both_batched_sweep_programs_replay_against_service_instance() {
    let rows = fixture().ledger_sweep_scenarios;
    assert_eq!(rows.len(), 2, "ledger sweep corpus cardinality drift");
    for row in rows {
        new_test_ext().execute_with(|| {
            let pid = service_pid(row.id);
            let epoch = required_success(u32::try_from(row.id), "generated sweep epoch fits u32");
            let target = if row.family == "proposal" {
                pid
            } else {
                u64::from(epoch)
            };
            match row.family.as_str() {
                "proposal" => {
                    assert_ok!(ServiceLedger::create_vault(signed(MARKET), pid, 0));
                }
                "baseline" => {
                    assert_ok!(ServiceLedger::create_baseline_vault(signed(MARKET), epoch));
                }
                other => fixture_failure(format_args!("unknown generated sweep family {other}")),
            }
            for step in &row.setup_ops {
                assert_eq!(
                    apply_frame(pid, epoch, step),
                    Ok(()),
                    "{} setup operation {}",
                    row.name,
                    step.op
                );
            }
            assert_eq!(
                family_position_entries(&row.family, target),
                row.expected_entries,
                "{} initial entries",
                row.name
            );
            assert_eq!(
                ledger::DepositsHeld::<Test, Instance1>::get(),
                required_success(
                    Balance::try_from(row.expected_entries),
                    "entry count fits Balance",
                ) * PositionDeposit::get(),
                "{} initial deposits",
                row.name
            );

            match row.family.as_str() {
                "proposal" => {
                    assert_noop!(
                        ServiceLedger::sweep_dust(signed(DAVE), pid),
                        ledger::Error::<Test, Instance1>::ReapNotDue
                    );
                }
                "baseline" => {
                    assert_noop!(
                        ServiceLedger::sweep_dust_baseline(signed(DAVE), epoch),
                        ledger::Error::<Test, Instance1>::ReapNotDue
                    );
                }
                other => fixture_failure(format_args!(
                    "{} has unknown sweep family {other}",
                    row.name
                )),
            }

            let terminal_at = match row.family.as_str() {
                "proposal" => required_value(
                    ledger::VaultTerminalAt::<Test, Instance1>::get(pid),
                    "proposal terminal block recorded",
                ),
                "baseline" => required_value(
                    ledger::BaselineTerminalAt::<Test, Instance1>::get(epoch),
                    "Baseline terminal block recorded",
                ),
                other => fixture_failure(format_args!(
                    "{} has unknown sweep family {other}",
                    row.name
                )),
            };
            ReapBatch::set(row.reap_batch);
            System::set_block_number(terminal_at + ArchiveDelay::get());

            let insurance_before = Assets::balance(USDC, SERVICE_INSURANCE);
            let owners = [
                ("alice", ALICE, Assets::balance(USDC, ALICE)),
                ("bob", BOB, Assets::balance(USDC, BOB)),
                ("carol", CAROL, Assets::balance(USDC, CAROL)),
            ];
            for batch in 0..row.expected_batches {
                let before = family_position_entries(&row.family, target);
                match row.family.as_str() {
                    "proposal" => {
                        assert_ok!(ServiceLedger::sweep_dust(signed(DAVE), pid));
                    }
                    "baseline" => {
                        assert_ok!(ServiceLedger::sweep_dust_baseline(signed(DAVE), epoch));
                    }
                    other => fixture_failure(format_args!(
                        "{} has unknown sweep family {other}",
                        row.name
                    )),
                }
                let after = family_position_entries(&row.family, target);
                assert_eq!(
                    before - after,
                    before.min(row.reap_batch as usize),
                    "{} batch {batch} did not honor ReapBatch",
                    row.name
                );
                assert_ok!(ServiceLedger::do_try_state());
            }

            assert_eq!(
                family_position_entries(&row.family, target),
                0,
                "{}",
                row.name
            );
            assert_eq!(
                family_position_totals(&row.family, target),
                0,
                "{}",
                row.name
            );
            assert_eq!(
                ledger::DepositsHeld::<Test, Instance1>::get(),
                0,
                "{}",
                row.name
            );
            for (name, owner, before) in owners {
                let expected = required_value(
                    row.expected_refunds.get(name).copied(),
                    format_args!("{} omits refund for {name}", row.name),
                );
                assert_eq!(
                    Assets::balance(USDC, owner) - before,
                    expected,
                    "{} refund for {name}",
                    row.name
                );
                assert_eq!(
                    ledger::PositionCount::<Test, Instance1>::get(owner),
                    0,
                    "{} count for {name}",
                    row.name
                );
            }
            assert_eq!(
                Assets::balance(USDC, SERVICE_INSURANCE) - insurance_before,
                row.expected_residue,
                "{} residue",
                row.name
            );

            let event = required_value(
                System::events()
                    .into_iter()
                    .rev()
                    .find_map(|record| match record.event {
                        RuntimeEvent::ServiceLedger(event) => Some(event),
                        _ => None,
                    }),
                "final sweep emits ServiceLedger event",
            );
            match (row.family.as_str(), event) {
                (
                    "proposal",
                    ledger::Event::VaultReaped {
                        pid: found,
                        residue,
                    },
                ) => {
                    assert_eq!(found, pid, "{}", row.name);
                    assert_eq!(residue, row.expected_residue, "{}", row.name);
                    assert!(!ledger::Vaults::<Test, Instance1>::contains_key(pid));
                    assert!(!ledger::VaultTerminalAt::<Test, Instance1>::contains_key(
                        pid
                    ));
                }
                (
                    "baseline",
                    ledger::Event::BaselineVaultReaped {
                        epoch: found,
                        residue,
                    },
                ) => {
                    assert_eq!(found, epoch, "{}", row.name);
                    assert_eq!(residue, row.expected_residue, "{}", row.name);
                    assert!(!ledger::BaselineVaults::<Test, Instance1>::contains_key(
                        epoch
                    ));
                    assert!(!ledger::BaselineTerminalAt::<Test, Instance1>::contains_key(epoch));
                }
                (_, other) => fixture_failure(format_args!(
                    "{} emitted unexpected final event {other:?}",
                    row.name
                )),
            }
            assert_ok!(ServiceLedger::do_try_state());
        });
    }
}
