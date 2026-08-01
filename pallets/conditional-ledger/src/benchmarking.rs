//! Benchmarks for `pallet-conditional-ledger` (Track-A DoD: a `#[instance_benchmarks]`
//! case per extrinsic and the `sweep_dust` cranks). PoV-calibrated weights are
//! generated in B5 (15 §4.5); this is the harness the generator consumes.

use crate::core_ledger::{baseline, position};
use crate::*;
use frame_benchmarking::v2::*;
use frame_support::{
    migrations::SteppedMigration,
    traits::{fungibles::Mutate, EnsureOrigin, Get, GetStorageVersion, StorageVersion},
    weights::{Weight, WeightMeter},
};
use frame_system::RawOrigin;
use futarchy_primitives::{
    kernel, Balance, Branch, FixedU64, GateType, PositionKind, ProposalId, ScalarSide,
};
use sp_runtime::traits::{AccountIdConversion, Saturating};

const UNIT: Balance = 1_000_000;
const SEED_AMT: Balance = 1_000 * UNIT;

fn fund<T: Config<I>, I: 'static>(who: &T::AccountId, amount: Balance) {
    let _ = <T::Collateral as Mutate<T::AccountId>>::mint_into(T::UsdcAssetId::get(), who, amount);
}

fn fund_sovereign_reserve<T: Config<I>, I: 'static>() {
    // Custody payouts use `Preservation::Preserve`: the protocol sovereign must
    // remain an asset account after paying the measured claimant. Production
    // custody naturally carries unrelated vault escrow; this isolated fixture
    // supplies the same keep-alive reserve without changing ledger accounting.
    let sovereign = T::PalletId::get().into_account_truncating();
    fund::<T, I>(&sovereign, SEED_AMT);
}

fn market_origin<T: Config<I>, I: 'static>() -> T::RuntimeOrigin {
    T::MarketAuthority::try_successful_origin().expect("mock provides a MarketAuthority origin")
}
fn resolve_origin<T: Config<I>, I: 'static>() -> T::RuntimeOrigin {
    T::ResolveAuthority::try_successful_origin().expect("mock provides a ResolveAuthority origin")
}
fn settle_origin<T: Config<I>, I: 'static>() -> T::RuntimeOrigin {
    T::SettleAuthority::try_successful_origin().expect("mock provides a SettleAuthority origin")
}
fn emergency_origin<T: Config<I>, I: 'static>() -> Result<T::RuntimeOrigin, BenchmarkError> {
    T::EmergencyPlaybookOrigin::try_successful_origin()
        .map_err(|_| BenchmarkError::Stop("EmergencyPlaybook origin unavailable"))
}

/// A funded, `Open` proposal vault with the caller already holding branch-USDC.
fn seeded_vault<T: Config<I>, I: 'static>(pid: ProposalId, caller: &T::AccountId) {
    Pallet::<T, I>::create_vault(market_origin::<T, I>(), pid, 0).expect("create vault");
    fund::<T, I>(caller, SEED_AMT.saturating_mul(4));
    Pallet::<T, I>::split(RawOrigin::Signed(caller.clone()).into(), pid, SEED_AMT).expect("split");
    fund_sovereign_reserve::<T, I>();
}

fn seeded_baseline<T: Config<I>, I: 'static>(
    epoch: futarchy_primitives::EpochId,
    caller: &T::AccountId,
) {
    Pallet::<T, I>::create_baseline_vault(market_origin::<T, I>(), epoch).expect("create baseline");
    fund::<T, I>(caller, SEED_AMT.saturating_mul(4));
    Pallet::<T, I>::split_baseline(RawOrigin::Signed(caller.clone()).into(), epoch, SEED_AMT)
        .expect("split baseline");
    fund_sovereign_reserve::<T, I>();
}

fn seeded_vault_reap_batch<T: Config<I>, I: 'static>(pid: ProposalId) {
    Pallet::<T, I>::create_vault(market_origin::<T, I>(), pid, 0).expect("create vault");
    // Each split creates two entries; move one entire branch to a distinct
    // peer so the measured 100-row sweep performs owner-specific accounting
    // for 100 owners, the valid worst distribution (15 §4.5).
    for index in 0..(T::ReapBatch::get() / 2) {
        let who: T::AccountId = account("dust", index, 0);
        let peer: T::AccountId = account("dust-peer", index, 0);
        fund::<T, I>(&who, SEED_AMT.saturating_mul(2));
        fund::<T, I>(&peer, SEED_AMT);
        Pallet::<T, I>::split(RawOrigin::Signed(who.clone()).into(), pid, SEED_AMT).expect("split");
        Pallet::<T, I>::transfer(
            RawOrigin::Signed(who.clone()).into(),
            position(pid, Branch::Reject, PositionKind::BranchUsdc),
            peer.clone(),
            SEED_AMT,
        )
        .expect("move one branch to a distinct sweep owner");
        assert_eq!(PositionCount::<T, I>::get(who), 1);
        assert_eq!(PositionCount::<T, I>::get(peer), 1);
    }
    assert_eq!(
        Positions::<T, I>::iter().count(),
        T::ReapBatch::get() as usize
    );
    fund_sovereign_reserve::<T, I>();
}

fn seeded_baseline_reap_batch<T: Config<I>, I: 'static>(epoch: futarchy_primitives::EpochId) {
    Pallet::<T, I>::create_baseline_vault(market_origin::<T, I>(), epoch).expect("create baseline");
    for index in 0..(T::ReapBatch::get() / 2) {
        let who: T::AccountId = account("base-dust", index, 0);
        let peer: T::AccountId = account("base-dust-peer", index, 0);
        fund::<T, I>(&who, SEED_AMT.saturating_mul(2));
        fund::<T, I>(&peer, SEED_AMT);
        Pallet::<T, I>::split_baseline(RawOrigin::Signed(who.clone()).into(), epoch, SEED_AMT)
            .expect("split baseline");
        Pallet::<T, I>::transfer(
            RawOrigin::Signed(who.clone()).into(),
            baseline(epoch, ScalarSide::Short),
            peer.clone(),
            SEED_AMT,
        )
        .expect("move one side to a distinct sweep owner");
        assert_eq!(PositionCount::<T, I>::get(who), 1);
        assert_eq!(PositionCount::<T, I>::get(peer), 1);
    }
    assert_eq!(
        Positions::<T, I>::iter().count(),
        T::ReapBatch::get() as usize
    );
    fund_sovereign_reserve::<T, I>();
}

#[instance_benchmarks]
mod benchmarks {
    use super::*;

    #[benchmark]
    fn split() {
        let caller: T::AccountId = whitelisted_caller();
        Pallet::<T, I>::create_vault(market_origin::<T, I>(), 1, 0).unwrap();
        fund::<T, I>(&caller, SEED_AMT.saturating_mul(2));
        #[extrinsic_call]
        _(RawOrigin::Signed(caller.clone()), 1, SEED_AMT);
        assert!(Vaults::<T, I>::get(1).unwrap().escrowed == SEED_AMT);
    }

    #[benchmark]
    fn merge() {
        let caller: T::AccountId = whitelisted_caller();
        seeded_vault::<T, I>(1, &caller);
        #[extrinsic_call]
        _(RawOrigin::Signed(caller.clone()), 1, SEED_AMT);
    }

    #[benchmark]
    fn split_scalar() {
        let caller: T::AccountId = whitelisted_caller();
        seeded_vault::<T, I>(1, &caller);
        #[extrinsic_call]
        _(
            RawOrigin::Signed(caller.clone()),
            1,
            Branch::Accept,
            SEED_AMT,
        );
    }

    #[benchmark]
    fn merge_scalar() {
        let caller: T::AccountId = whitelisted_caller();
        seeded_vault::<T, I>(1, &caller);
        Pallet::<T, I>::split_scalar(
            RawOrigin::Signed(caller.clone()).into(),
            1,
            Branch::Accept,
            SEED_AMT,
        )
        .unwrap();
        #[extrinsic_call]
        _(
            RawOrigin::Signed(caller.clone()),
            1,
            Branch::Accept,
            SEED_AMT,
        );
    }

    #[benchmark]
    fn split_gate() {
        let caller: T::AccountId = whitelisted_caller();
        seeded_vault::<T, I>(1, &caller);
        #[extrinsic_call]
        _(
            RawOrigin::Signed(caller.clone()),
            1,
            Branch::Accept,
            GateType::Survival,
            SEED_AMT,
        );
    }

    #[benchmark]
    fn merge_gate() {
        let caller: T::AccountId = whitelisted_caller();
        seeded_vault::<T, I>(1, &caller);
        Pallet::<T, I>::split_gate(
            RawOrigin::Signed(caller.clone()).into(),
            1,
            Branch::Accept,
            GateType::Survival,
            SEED_AMT,
        )
        .unwrap();
        #[extrinsic_call]
        _(
            RawOrigin::Signed(caller.clone()),
            1,
            Branch::Accept,
            GateType::Survival,
            SEED_AMT,
        );
    }

    #[benchmark]
    fn transfer() {
        let caller: T::AccountId = whitelisted_caller();
        let dest: T::AccountId = account("dest", 0, 0);
        fund::<T, I>(&dest, SEED_AMT);
        seeded_vault::<T, I>(1, &caller);
        let id = crate::core_ledger::position(
            1,
            Branch::Accept,
            futarchy_primitives::PositionKind::BranchUsdc,
        );
        #[extrinsic_call]
        _(
            RawOrigin::Signed(caller.clone()),
            id,
            dest.clone(),
            SEED_AMT,
        );
    }

    #[benchmark]
    fn split_baseline() {
        let caller: T::AccountId = whitelisted_caller();
        Pallet::<T, I>::create_baseline_vault(market_origin::<T, I>(), 7).unwrap();
        fund::<T, I>(&caller, SEED_AMT.saturating_mul(2));
        #[extrinsic_call]
        _(RawOrigin::Signed(caller.clone()), 7, SEED_AMT);
    }

    #[benchmark]
    fn merge_baseline() {
        let caller: T::AccountId = whitelisted_caller();
        seeded_baseline::<T, I>(7, &caller);
        #[extrinsic_call]
        _(RawOrigin::Signed(caller.clone()), 7, SEED_AMT);
    }

    #[benchmark]
    fn resolve() {
        let caller: T::AccountId = whitelisted_caller();
        seeded_vault::<T, I>(1, &caller);
        let origin = resolve_origin::<T, I>();
        #[block]
        {
            Pallet::<T, I>::resolve(origin, 1, Branch::Accept).unwrap();
        }
        assert!(Vaults::<T, I>::get(1).is_some());
    }

    #[benchmark]
    fn void() {
        let caller: T::AccountId = whitelisted_caller();
        seeded_vault::<T, I>(1, &caller);
        let origin = resolve_origin::<T, I>();
        #[block]
        {
            Pallet::<T, I>::void(origin, 1).unwrap();
        }
        assert!(VaultTerminalAt::<T, I>::get(1).is_some());
    }

    #[benchmark]
    fn settle_scalar() {
        let caller: T::AccountId = whitelisted_caller();
        seeded_vault::<T, I>(1, &caller);
        Pallet::<T, I>::resolve(resolve_origin::<T, I>(), 1, Branch::Accept).unwrap();
        let origin = settle_origin::<T, I>();
        #[block]
        {
            Pallet::<T, I>::settle_scalar(origin, 1, FixedU64(500_000_000)).unwrap();
        }
    }

    #[benchmark]
    fn settle_gate() {
        let caller: T::AccountId = whitelisted_caller();
        seeded_vault::<T, I>(1, &caller);
        Pallet::<T, I>::resolve(resolve_origin::<T, I>(), 1, Branch::Accept).unwrap();
        let origin = settle_origin::<T, I>();
        #[block]
        {
            Pallet::<T, I>::settle_gate(origin, 1, GateType::Survival, true).unwrap();
        }
    }

    #[benchmark]
    fn settle_baseline() {
        let caller: T::AccountId = whitelisted_caller();
        seeded_baseline::<T, I>(7, &caller);
        let origin = settle_origin::<T, I>();
        #[block]
        {
            Pallet::<T, I>::settle_baseline(origin, 7, FixedU64(500_000_000)).unwrap();
        }
    }

    #[benchmark]
    fn redeem() {
        let caller: T::AccountId = whitelisted_caller();
        seeded_vault::<T, I>(1, &caller);
        Pallet::<T, I>::resolve(resolve_origin::<T, I>(), 1, Branch::Accept).unwrap();
        Pallet::<T, I>::settle_scalar(settle_origin::<T, I>(), 1, FixedU64(500_000_000)).unwrap();
        #[extrinsic_call]
        _(RawOrigin::Signed(caller.clone()), 1, SEED_AMT);
    }

    #[benchmark]
    fn redeem_scalar() {
        let caller: T::AccountId = whitelisted_caller();
        seeded_vault::<T, I>(1, &caller);
        Pallet::<T, I>::split_scalar(
            RawOrigin::Signed(caller.clone()).into(),
            1,
            Branch::Accept,
            SEED_AMT,
        )
        .unwrap();
        Pallet::<T, I>::resolve(resolve_origin::<T, I>(), 1, Branch::Accept).unwrap();
        Pallet::<T, I>::settle_scalar(settle_origin::<T, I>(), 1, FixedU64(500_000_000)).unwrap();
        #[extrinsic_call]
        _(
            RawOrigin::Signed(caller.clone()),
            1,
            ScalarSide::Long,
            SEED_AMT,
        );
    }

    #[benchmark]
    fn redeem_scalar_pair() {
        let caller: T::AccountId = whitelisted_caller();
        seeded_vault::<T, I>(1, &caller);
        Pallet::<T, I>::split_scalar(
            RawOrigin::Signed(caller.clone()).into(),
            1,
            Branch::Accept,
            SEED_AMT,
        )
        .unwrap();
        Pallet::<T, I>::resolve(resolve_origin::<T, I>(), 1, Branch::Accept).unwrap();
        Pallet::<T, I>::settle_scalar(settle_origin::<T, I>(), 1, FixedU64(500_000_000)).unwrap();
        #[extrinsic_call]
        _(RawOrigin::Signed(caller.clone()), 1, SEED_AMT);
    }

    #[benchmark]
    fn redeem_gate() {
        let caller: T::AccountId = whitelisted_caller();
        seeded_vault::<T, I>(1, &caller);
        Pallet::<T, I>::split_gate(
            RawOrigin::Signed(caller.clone()).into(),
            1,
            Branch::Accept,
            GateType::Survival,
            SEED_AMT,
        )
        .unwrap();
        Pallet::<T, I>::resolve(resolve_origin::<T, I>(), 1, Branch::Accept).unwrap();
        Pallet::<T, I>::settle_scalar(settle_origin::<T, I>(), 1, FixedU64(500_000_000)).unwrap();
        Pallet::<T, I>::settle_gate(settle_origin::<T, I>(), 1, GateType::Survival, true).unwrap();
        #[extrinsic_call]
        _(
            RawOrigin::Signed(caller.clone()),
            1,
            GateType::Survival,
            SEED_AMT,
        );
    }

    #[benchmark]
    fn redeem_void() {
        let caller: T::AccountId = whitelisted_caller();
        seeded_vault::<T, I>(1, &caller);
        Pallet::<T, I>::void(resolve_origin::<T, I>(), 1).unwrap();
        #[extrinsic_call]
        _(
            RawOrigin::Signed(caller.clone()),
            1,
            Branch::Accept,
            futarchy_primitives::PositionKind::BranchUsdc,
            SEED_AMT,
        );
    }

    #[benchmark]
    fn redeem_baseline() {
        let caller: T::AccountId = whitelisted_caller();
        seeded_baseline::<T, I>(7, &caller);
        Pallet::<T, I>::settle_baseline(settle_origin::<T, I>(), 7, FixedU64(500_000_000)).unwrap();
        #[extrinsic_call]
        _(
            RawOrigin::Signed(caller.clone()),
            7,
            ScalarSide::Long,
            SEED_AMT,
        );
    }

    #[benchmark]
    fn redeem_baseline_pair() {
        let caller: T::AccountId = whitelisted_caller();
        seeded_baseline::<T, I>(7, &caller);
        Pallet::<T, I>::settle_baseline(settle_origin::<T, I>(), 7, FixedU64(500_000_000)).unwrap();
        #[extrinsic_call]
        _(RawOrigin::Signed(caller.clone()), 7, SEED_AMT);
    }

    #[benchmark]
    fn sweep_dust() {
        let caller: T::AccountId = whitelisted_caller();
        seeded_vault_reap_batch::<T, I>(1);
        Pallet::<T, I>::void(resolve_origin::<T, I>(), 1).unwrap();
        // Force reap-eligibility by back-dating the terminal block.
        VaultTerminalAt::<T, I>::insert(
            1,
            frame_system::pallet_prelude::BlockNumberFor::<T>::from(0u32),
        );
        frame_system::Pallet::<T>::set_block_number(T::ArchiveDelay::get() + 10u32.into());
        T::BenchmarkHelper::prime_keeper_rebate();
        #[extrinsic_call]
        _(RawOrigin::Signed(caller.clone()), 1);
        T::BenchmarkHelper::assert_keeper_rebate_paid(
            futarchy_primitives::keeper::CrankClass::General,
        );
    }

    #[benchmark]
    fn sweep_dust_baseline() {
        let caller: T::AccountId = whitelisted_caller();
        seeded_baseline_reap_batch::<T, I>(7);
        Pallet::<T, I>::settle_baseline(settle_origin::<T, I>(), 7, FixedU64(500_000_000)).unwrap();
        BaselineTerminalAt::<T, I>::insert(
            7,
            frame_system::pallet_prelude::BlockNumberFor::<T>::from(0u32),
        );
        frame_system::Pallet::<T>::set_block_number(T::ArchiveDelay::get() + 10u32.into());
        T::BenchmarkHelper::prime_keeper_rebate();
        #[extrinsic_call]
        _(RawOrigin::Signed(caller.clone()), 7);
        T::BenchmarkHelper::assert_keeper_rebate_paid(
            futarchy_primitives::keeper::CrankClass::General,
        );
    }

    /// 03 §5.4 / §5.3a(4): the worst case is a **non-empty** counter — the
    /// empty-counter path is a successful no-op that moves no custody, so it is
    /// strictly cheaper and is not what the weight must cover.
    #[benchmark]
    fn sweep_redemption_fees() {
        let caller: T::AccountId = whitelisted_caller();
        // Fund the sovereign so the transfer has real custody behind the
        // counter, exactly as a charged redemption would have left it.
        fund_sovereign_reserve::<T, I>();
        RedemptionFeesAccrued::<T, I>::put(UNIT);
        T::BenchmarkHelper::prime_keeper_rebate();
        #[extrinsic_call]
        _(RawOrigin::Signed(caller.clone()));
        assert_eq!(RedemptionFeesAccrued::<T, I>::get(), 0);
        T::BenchmarkHelper::assert_keeper_rebate_paid(
            futarchy_primitives::keeper::CrankClass::General,
        );
    }

    #[benchmark]
    fn set_split_paused() -> Result<(), BenchmarkError> {
        let expiry = frame_system::Pallet::<T>::block_number()
            .saturating_add(kernel::PLAYBOOK_FREEZE_WINDOW_BLOCKS.into());
        let origin = emergency_origin::<T, I>()?;
        #[extrinsic_call]
        _(origin as T::RuntimeOrigin, true, expiry);
        assert_eq!(SplitPausedUntil::<T, I>::get(), Some(expiry));
        Ok(())
    }

    #[benchmark]
    fn set_frozen() -> Result<(), BenchmarkError> {
        let origin = emergency_origin::<T, I>()?;
        #[extrinsic_call]
        _(origin as T::RuntimeOrigin, true);
        assert!(FrozenUntil::<T, I>::get().is_some());
        Ok(())
    }

    #[benchmark]
    fn reconcile() {
        let caller: T::AccountId = whitelisted_caller();
        let (custody, _) = Pallet::<T, I>::maintained_collateral_totals()
            .expect("benchmark custody balance is readable");
        TotalEscrowed::<T, I>::put(custody.saturating_add(1));
        LastReconciliation::<T, I>::put(ReconciliationSample {
            liability: 0,
            custody: 0,
            at: frame_system::Pallet::<T>::block_number(),
        });
        T::BenchmarkHelper::prime_keeper_rebate();
        #[extrinsic_call]
        _(RawOrigin::Signed(caller.clone()));
        assert!(LedgerDrifted::<T, I>::get());
        let sample = LastReconciliation::<T, I>::get().expect("reconciliation sample stored");
        assert!(sample.liability > sample.custody);
        T::BenchmarkHelper::assert_keeper_rebate_paid(
            futarchy_primitives::keeper::CrankClass::General,
        );
    }

    #[benchmark]
    fn migration_step_row() {
        StorageVersion::new(0).put::<Pallet<T, I>>();
        TotalEscrowed::<T, I>::kill();
        let mut vault = conditional_ledger_core::VaultInfo::open(0);
        vault.escrowed = SEED_AMT;
        Vaults::<T, I>::insert(1, vault);
        let mut meter = WeightMeter::with_limit(Weight::MAX);

        #[block]
        {
            let next =
                migration::BackfillTotalEscrowedV1::<T, I>::transactional_step(None, &mut meter)
                    .expect("valid benchmark row");
            assert!(matches!(
                next,
                Some(migration::BackfillCursor::Proposals {
                    total: SEED_AMT,
                    ..
                })
            ));
        }
    }

    #[benchmark]
    fn migration_step_terminal() {
        StorageVersion::new(0).put::<Pallet<T, I>>();
        TotalEscrowed::<T, I>::kill();
        let cursor = migration::BackfillCursor::Baselines {
            last: None,
            total: SEED_AMT,
        };
        let mut meter = WeightMeter::with_limit(Weight::MAX);

        #[block]
        {
            let next = migration::BackfillTotalEscrowedV1::<T, I>::transactional_step(
                Some(cursor),
                &mut meter,
            )
            .expect("valid terminal benchmark step");
            assert!(next.is_none());
        }

        assert_eq!(TotalEscrowed::<T, I>::get(), SEED_AMT);
        assert_eq!(
            Pallet::<T, I>::on_chain_storage_version(),
            StorageVersion::new(1)
        );
    }

    impl_benchmark_test_suite!(Pallet, crate::mock::new_test_ext(), crate::mock::Test);
}
