//! PT-9 generated two-instance isolation matrix (15 §4.3; I-37).
//!
//! Every operation in the existing ledger property alphabet is executed once
//! against each instance from a state that reaches its successful mutation.
//! The other instance is compared byte-for-byte across its complete storage
//! prefix, sovereign/protocol balances, events, and accounting-sink effects.

mod support;

use frame_support::instances::Instance1;
use frame_support::{assert_noop, assert_ok, traits::PalletInfoAccess};
use futarchy_primitives::{kernel, Branch, FixedU64, GateType, PositionKind, ScalarSide};
use sp_runtime::Perbill;

use pallet_conditional_ledger as ledger;
use support::*;

type Ledger<I> = ledger::Pallet<Test, I>;

const AMOUNT: u128 = 100_000;

#[derive(Clone, Copy, Debug)]
enum Operation {
    Split,
    Merge,
    SplitScalar,
    MergeScalar,
    SplitGate,
    MergeGate,
    SplitBaseline,
    MergeBaseline,
    Transfer,
    Resolve,
    Void,
    SettleScalar,
    SettleGate,
    SettleBaseline,
    Redeem,
    RedeemVoid,
    RedeemScalar,
    RedeemScalarPair,
    RedeemGate,
    RedeemBaseline,
    RedeemBaselinePair,
    SweepRedemptionFees,
    SweepDust,
    SweepDustBaseline,
}

const FULL_OPERATION_ALPHABET: [Operation; 24] = [
    Operation::Split,
    Operation::Merge,
    Operation::SplitScalar,
    Operation::MergeScalar,
    Operation::SplitGate,
    Operation::MergeGate,
    Operation::SplitBaseline,
    Operation::MergeBaseline,
    Operation::Transfer,
    Operation::Resolve,
    Operation::Void,
    Operation::SettleScalar,
    Operation::SettleGate,
    Operation::SettleBaseline,
    Operation::Redeem,
    Operation::RedeemVoid,
    Operation::RedeemScalar,
    Operation::RedeemScalarPair,
    Operation::RedeemGate,
    Operation::RedeemBaseline,
    Operation::RedeemBaselinePair,
    Operation::SweepRedemptionFees,
    Operation::SweepDust,
    Operation::SweepDustBaseline,
];

fn signed(who: AccountId) -> RuntimeOrigin {
    RuntimeOrigin::signed(who)
}

fn create_proposal<D: Domain>()
where
    Test: ledger::Config<D::Instance>,
{
    assert_ok!(Ledger::<D::Instance>::create_vault(
        signed(MARKET),
        D::PID,
        0,
    ));
}

fn create_baseline<D: Domain>()
where
    Test: ledger::Config<D::Instance>,
{
    assert_ok!(Ledger::<D::Instance>::create_baseline_vault(
        signed(MARKET),
        D::EPOCH,
    ));
}

fn split<D: Domain>()
where
    Test: ledger::Config<D::Instance>,
{
    assert_ok!(Ledger::<D::Instance>::split(
        signed(D::USER),
        D::PID,
        AMOUNT,
    ));
}

fn split_baseline<D: Domain>()
where
    Test: ledger::Config<D::Instance>,
{
    assert_ok!(Ledger::<D::Instance>::split_baseline(
        signed(D::USER),
        D::EPOCH,
        AMOUNT,
    ));
}

fn settle_scalar<D: Domain>()
where
    Test: ledger::Config<D::Instance>,
{
    assert_ok!(Ledger::<D::Instance>::resolve(
        signed(RESOLVER),
        D::PID,
        Branch::Accept,
    ));
    assert_ok!(Ledger::<D::Instance>::settle_scalar(
        signed(SETTLER),
        D::PID,
        FixedU64(500_000_000),
    ));
}

fn exercise<D: Domain>(operation: Operation)
where
    Test: ledger::Config<D::Instance>,
{
    match operation {
        Operation::Split => {
            create_proposal::<D>();
            split::<D>();
        }
        Operation::Merge => {
            create_proposal::<D>();
            split::<D>();
            assert_ok!(Ledger::<D::Instance>::merge(
                signed(D::USER),
                D::PID,
                AMOUNT,
            ));
        }
        Operation::SplitScalar => {
            create_proposal::<D>();
            split::<D>();
            assert_ok!(Ledger::<D::Instance>::split_scalar(
                signed(D::USER),
                D::PID,
                Branch::Accept,
                AMOUNT,
            ));
        }
        Operation::MergeScalar => {
            create_proposal::<D>();
            split::<D>();
            assert_ok!(Ledger::<D::Instance>::split_scalar(
                signed(D::USER),
                D::PID,
                Branch::Accept,
                AMOUNT,
            ));
            assert_ok!(Ledger::<D::Instance>::merge_scalar(
                signed(D::USER),
                D::PID,
                Branch::Accept,
                AMOUNT,
            ));
        }
        Operation::SplitGate => {
            create_proposal::<D>();
            split::<D>();
            assert_ok!(Ledger::<D::Instance>::split_gate(
                signed(D::USER),
                D::PID,
                Branch::Accept,
                GateType::Security,
                AMOUNT,
            ));
        }
        Operation::MergeGate => {
            create_proposal::<D>();
            split::<D>();
            assert_ok!(Ledger::<D::Instance>::split_gate(
                signed(D::USER),
                D::PID,
                Branch::Accept,
                GateType::Security,
                AMOUNT,
            ));
            assert_ok!(Ledger::<D::Instance>::merge_gate(
                signed(D::USER),
                D::PID,
                Branch::Accept,
                GateType::Security,
                AMOUNT,
            ));
        }
        Operation::SplitBaseline => {
            create_baseline::<D>();
            split_baseline::<D>();
        }
        Operation::MergeBaseline => {
            create_baseline::<D>();
            split_baseline::<D>();
            assert_ok!(Ledger::<D::Instance>::merge_baseline(
                signed(D::USER),
                D::EPOCH,
                AMOUNT,
            ));
        }
        Operation::Transfer => {
            create_proposal::<D>();
            split::<D>();
            assert_ok!(Ledger::<D::Instance>::transfer(
                signed(D::USER),
                ledger::core_ledger::position(D::PID, Branch::Reject, PositionKind::BranchUsdc,),
                D::RECIPIENT,
                AMOUNT,
            ));
        }
        Operation::Resolve => {
            create_proposal::<D>();
            assert_ok!(Ledger::<D::Instance>::resolve(
                signed(RESOLVER),
                D::PID,
                Branch::Accept,
            ));
        }
        Operation::Void => {
            create_proposal::<D>();
            assert_ok!(Ledger::<D::Instance>::void(signed(RESOLVER), D::PID));
        }
        Operation::SettleScalar => {
            create_proposal::<D>();
            settle_scalar::<D>();
        }
        Operation::SettleGate => {
            create_proposal::<D>();
            assert_ok!(Ledger::<D::Instance>::resolve(
                signed(RESOLVER),
                D::PID,
                Branch::Accept,
            ));
            assert_ok!(Ledger::<D::Instance>::settle_gate(
                signed(SETTLER),
                D::PID,
                GateType::Security,
                true,
            ));
        }
        Operation::SettleBaseline => {
            create_baseline::<D>();
            assert_ok!(Ledger::<D::Instance>::settle_baseline(
                signed(SETTLER),
                D::EPOCH,
                FixedU64(500_000_000),
            ));
        }
        Operation::Redeem => {
            create_proposal::<D>();
            split::<D>();
            settle_scalar::<D>();
            assert_ok!(Ledger::<D::Instance>::redeem(
                signed(D::USER),
                D::PID,
                AMOUNT,
            ));
        }
        Operation::RedeemVoid => {
            create_proposal::<D>();
            split::<D>();
            assert_ok!(Ledger::<D::Instance>::void(signed(RESOLVER), D::PID));
            assert_ok!(Ledger::<D::Instance>::redeem_void(
                signed(D::USER),
                D::PID,
                Branch::Accept,
                PositionKind::BranchUsdc,
                AMOUNT,
            ));
        }
        Operation::RedeemScalar => {
            create_proposal::<D>();
            split::<D>();
            assert_ok!(Ledger::<D::Instance>::split_scalar(
                signed(D::USER),
                D::PID,
                Branch::Accept,
                AMOUNT,
            ));
            settle_scalar::<D>();
            assert_ok!(Ledger::<D::Instance>::redeem_scalar(
                signed(D::USER),
                D::PID,
                ScalarSide::Long,
                AMOUNT,
            ));
        }
        Operation::RedeemScalarPair => {
            create_proposal::<D>();
            split::<D>();
            assert_ok!(Ledger::<D::Instance>::split_scalar(
                signed(D::USER),
                D::PID,
                Branch::Accept,
                AMOUNT,
            ));
            settle_scalar::<D>();
            assert_ok!(Ledger::<D::Instance>::redeem_scalar_pair(
                signed(D::USER),
                D::PID,
                AMOUNT,
            ));
        }
        Operation::RedeemGate => {
            create_proposal::<D>();
            split::<D>();
            assert_ok!(Ledger::<D::Instance>::split_gate(
                signed(D::USER),
                D::PID,
                Branch::Accept,
                GateType::Security,
                AMOUNT,
            ));
            assert_ok!(Ledger::<D::Instance>::resolve(
                signed(RESOLVER),
                D::PID,
                Branch::Accept,
            ));
            assert_ok!(Ledger::<D::Instance>::settle_gate(
                signed(SETTLER),
                D::PID,
                GateType::Security,
                true,
            ));
            assert_ok!(Ledger::<D::Instance>::settle_scalar(
                signed(SETTLER),
                D::PID,
                FixedU64(500_000_000),
            ));
            assert_ok!(Ledger::<D::Instance>::redeem_gate(
                signed(D::USER),
                D::PID,
                GateType::Security,
                AMOUNT,
            ));
        }
        Operation::RedeemBaseline => {
            create_baseline::<D>();
            split_baseline::<D>();
            assert_ok!(Ledger::<D::Instance>::settle_baseline(
                signed(SETTLER),
                D::EPOCH,
                FixedU64(500_000_000),
            ));
            assert_ok!(Ledger::<D::Instance>::redeem_baseline(
                signed(D::USER),
                D::EPOCH,
                ScalarSide::Long,
                AMOUNT,
            ));
        }
        Operation::RedeemBaselinePair => {
            create_baseline::<D>();
            split_baseline::<D>();
            assert_ok!(Ledger::<D::Instance>::settle_baseline(
                signed(SETTLER),
                D::EPOCH,
                FixedU64(500_000_000),
            ));
            assert_ok!(Ledger::<D::Instance>::redeem_baseline_pair(
                signed(D::USER),
                D::EPOCH,
                AMOUNT,
            ));
        }
        Operation::SweepRedemptionFees => {
            RedemptionFee::set(Perbill::from_parts(3_000_000));
            create_proposal::<D>();
            split::<D>();
            assert_ok!(Ledger::<D::Instance>::split_scalar(
                signed(D::USER),
                D::PID,
                Branch::Accept,
                AMOUNT,
            ));
            settle_scalar::<D>();
            assert_ok!(Ledger::<D::Instance>::redeem_scalar(
                signed(D::USER),
                D::PID,
                ScalarSide::Long,
                AMOUNT,
            ));
            assert_ok!(Ledger::<D::Instance>::sweep_redemption_fees(signed(
                D::RECIPIENT
            )));
        }
        Operation::SweepDust => {
            create_proposal::<D>();
            split::<D>();
            assert_ok!(Ledger::<D::Instance>::void(signed(RESOLVER), D::PID));
            System::set_block_number(7);
            assert_ok!(Ledger::<D::Instance>::sweep_dust(
                signed(D::RECIPIENT),
                D::PID
            ));
        }
        Operation::SweepDustBaseline => {
            create_baseline::<D>();
            split_baseline::<D>();
            assert_ok!(Ledger::<D::Instance>::settle_baseline(
                signed(SETTLER),
                D::EPOCH,
                FixedU64(500_000_000),
            ));
            System::set_block_number(7);
            assert_ok!(Ledger::<D::Instance>::sweep_dust_baseline(
                signed(D::RECIPIENT),
                D::EPOCH,
            ));
        }
    }
    assert_ok!(Ledger::<D::Instance>::do_try_state());
}

fn assert_isolated<Active: Domain, Other: Domain>(operation: Operation)
where
    Test: ledger::Config<Active::Instance> + ledger::Config<Other::Instance>,
{
    new_test_ext().execute_with(|| {
        let other_before = snapshot::<Other>();
        exercise::<Active>(operation);
        assert_eq!(
            snapshot::<Other>(),
            other_before,
            "{operation:?} on {} changed the other instance",
            core::any::type_name::<Active>(),
        );
        assert_ok!(Ledger::<Other::Instance>::do_try_state());
    });
}

#[test]
fn full_operation_alphabet_is_isolated_in_both_directions() {
    for operation in FULL_OPERATION_ALPHABET {
        assert_isolated::<PrimaryDomain, ServiceDomain>(operation);
        assert_isolated::<ServiceDomain, PrimaryDomain>(operation);
    }
}

fn cross_destination_is_rejected<Active: Domain, Other: Domain>()
where
    Test: ledger::Config<Active::Instance> + ledger::Config<Other::Instance>,
{
    new_test_ext().execute_with(|| {
        create_proposal::<Active>();
        split::<Active>();
        let active_before = snapshot::<Active>();
        let other_before = snapshot::<Other>();
        let destination = Other::owned_accounts()[0];
        assert_noop!(
            Ledger::<Active::Instance>::transfer(
                signed(Active::USER),
                ledger::core_ledger::position(
                    Active::PID,
                    Branch::Accept,
                    PositionKind::BranchUsdc,
                ),
                destination,
                AMOUNT,
            ),
            ledger::Error::<Test, Active::Instance>::ProtocolDestination
        );
        assert_eq!(snapshot::<Active>(), active_before);
        assert_eq!(snapshot::<Other>(), other_before);
    });
}

#[test]
fn cross_domain_protocol_destinations_fail_atomically_both_ways() {
    cross_destination_is_rejected::<PrimaryDomain, ServiceDomain>();
    cross_destination_is_rejected::<ServiceDomain, PrimaryDomain>();
}

fn wrong_band_is_unknown<Active: Domain, Other: Domain>()
where
    Test: ledger::Config<Active::Instance> + ledger::Config<Other::Instance>,
{
    new_test_ext().execute_with(|| {
        create_proposal::<Active>();
        let active_before = snapshot::<Active>();
        let other_before = snapshot::<Other>();
        assert_noop!(
            Ledger::<Active::Instance>::split(signed(Active::USER), Other::PID, AMOUNT),
            ledger::Error::<Test, Active::Instance>::UnknownVault
        );
        assert_eq!(snapshot::<Active>(), active_before);
        assert_eq!(snapshot::<Other>(), other_before);
    });
}

#[test]
fn wrong_id_band_is_unknown_in_both_directions() {
    wrong_band_is_unknown::<PrimaryDomain, ServiceDomain>();
    wrong_band_is_unknown::<ServiceDomain, PrimaryDomain>();
}

fn deficit_latches_only_active<Active: Domain, Other: Domain>()
where
    Test: ledger::Config<Active::Instance> + ledger::Config<Other::Instance>,
{
    new_test_ext().execute_with(|| {
        create_proposal::<Active>();
        split::<Active>();
        let custody = Assets::balance(USDC, Active::account());
        assert!(custody > 10_000);
        assert_ok!(Assets::transfer(
            signed(Active::account()),
            USDC,
            Active::USER,
            custody - 10_000,
        ));
        let other_before = snapshot::<Other>();
        assert_ok!(Ledger::<Active::Instance>::reconcile(signed(
            Active::RECIPIENT
        )));
        assert!(Ledger::<Active::Instance>::ledger_drifted());
        assert!(!Ledger::<Other::Instance>::ledger_drifted());
        assert_eq!(snapshot::<Other>(), other_before);
    });
}

#[test]
fn deficit_and_reconciliation_latches_are_per_instance() {
    deficit_latches_only_active::<PrimaryDomain, ServiceDomain>();
    deficit_latches_only_active::<ServiceDomain, PrimaryDomain>();
}

#[test]
fn sovereigns_prefixes_and_id_bands_are_distinct() {
    new_test_ext().execute_with(|| {
        assert_ne!(primary_account(), service_account());
        assert_ne!(
            Ledger::<()>::name(),
            Ledger::<Instance1>::name(),
            "construct_runtime aliases must yield different storage prefixes",
        );
        create_proposal::<PrimaryDomain>();
        create_proposal::<ServiceDomain>();
        assert_eq!(ledger::Vaults::<Test, ()>::iter_keys().count(), 1);
        assert_eq!(ledger::Vaults::<Test, Instance1>::iter_keys().count(), 1);
        for pid in ledger::Vaults::<Test, ()>::iter_keys() {
            assert!(pid < kernel::SERVICE_ID_BASE);
        }
        for pid in ledger::Vaults::<Test, Instance1>::iter_keys() {
            assert!(pid >= kernel::SERVICE_ID_BASE);
        }
    });
}
