//! 15 §4.1 suite for `pallet-futarchy-treasury`: per-extrinsic × error-path ×
//! origin-misuse × limit coverage, NAV/reserve-haircut fail-static, the rule-4
//! Params-injection proof, a `try_state` assertion, and a seeded shell-vs-core
//! differential (Python M3 ≡ Rust core ≡ this pallet at default parameters).

use crate::mock::*;
use crate::{
    CollatorAuthoredBlocks, CollatorAuthoredEpoch, CollatorAuthoredOverflowed,
    CollatorAuthoredRegisteredCount, CollatorCompensationPaidEpoch, CollatorDroppedEpoch,
    CollatorPendingBlocks, CollatorPendingEpoch, CollatorPendingOverflowed, Error, Event,
    PayoutLine, MAX_COLLATOR_COMPENSATION_ENTRIES_BOUND,
};
use frame_support::{
    assert_err, assert_noop, assert_ok,
    traits::{ConstU32, Hooks, StorageVersion},
};
use futarchy_primitives::integrity::IntegrityFault;
use futarchy_primitives::keeper::CrankClass;
use futarchy_treasury_core::{
    AssetKind, BudgetLine, Stream, Treasury as CoreTreasury, DAYS_365_BLOCKS, DAY_BLOCKS,
    MAX_STREAMS, TRS_CAP_PROPOSAL_BPS, TRS_STREAM_THRESHOLD_BPS, USDC, VIT,
};

const MAIN0: u128 = 25_000_000 * USDC;

fn to() -> RuntimeOrigin {
    RuntimeOrigin::signed(treasury_acc())
}

fn note_quote(period_index: u32, price: u128) -> frame_support::dispatch::DispatchResult {
    Treasury::note_coretime_quote(
        RuntimeOrigin::signed(coretime_quote_authority()),
        period_index,
        price,
    )
}

/// Genesis-funded `MAIN` (25M USDC) with three lines pre-funded via the
/// extrinsic (the realistic post-XCM funding path, 08 §2.5).
fn funded_ext() -> sp_io::TestExternalities {
    let mut ext = new_test_ext_with(crate::GenesisConfig::<Test> {
        main_usdc: MAIN0,
        coretime_quote_authority: Some(coretime_quote_authority()),
        coretime_renewal_account: Some([44; 32]),
        ..Default::default()
    });
    ext.execute_with(|| {
        assert_ok!(Treasury::fund_budget_line(
            to(),
            BudgetLine::OpsCollators,
            5_000_000 * USDC
        ));
        assert_ok!(Treasury::fund_budget_line(
            to(),
            BudgetLine::Rewards,
            2_000_000 * USDC
        ));
        assert_ok!(Treasury::fund_budget_line(
            to(),
            BudgetLine::OpsCoretime,
            1_000_000 * USDC
        ));
        // The setup funding is part of genesis-like fixture construction; keep
        // custody balances, but clear the seam call log so each test observes
        // only the funding it performs itself.
        reset_pot_funding();
    });
    ext
}

fn probe_funded_ext() -> sp_io::TestExternalities {
    let mut ext = funded_ext();
    ext.execute_with(|| {
        assert_ok!(Treasury::fund_budget_line(
            to(),
            BudgetLine::OpsReserveProbe,
            1_000 * USDC,
        ));
    });
    ext
}

#[test]
fn reserve_probe_internal_charge_persists_exact_line_delta_and_event() {
    probe_funded_ext().execute_with(|| {
        let before = Treasury::line_balance(BudgetLine::OpsReserveProbe);
        System::reset_events();

        assert_eq!(
            Treasury::charge_reserve_probe_fee(101, 10_000_000_000),
            Ok(101)
        );
        assert_eq!(
            Treasury::line_balance(BudgetLine::OpsReserveProbe),
            before - 101
        );
        assert!(System::events().iter().any(|record| {
            matches!(
                &record.event,
                RuntimeEvent::Treasury(Event::ReserveProbeFeeCharged {
                    line: BudgetLine::OpsReserveProbe,
                    amount: 101,
                })
            )
        }));
    });
}

#[test]
fn reserve_probe_internal_charge_errors_are_storage_and_event_atomic() {
    probe_funded_ext().execute_with(|| {
        for (fee, rate) in [(0, 1), (1, 0), (u128::MAX, 2)] {
            System::reset_events();
            let before = crate::State::<Test>::get();
            assert!(Treasury::charge_reserve_probe_fee(fee, rate).is_err());
            assert_eq!(crate::State::<Test>::get(), before);
            assert!(System::events().is_empty());
        }
    });
}

#[test]
fn ops_multisig_is_runway_capped_and_treasury_refill_closes_it_irreversibly() {
    new_test_ext_with(crate::GenesisConfig::<Test> {
        main_usdc: 1_000 * USDC,
        coretime_quote_authority: Some(coretime_quote_authority()),
        coretime_renewal_account: Some([44; 32]),
        ..Default::default()
    })
    .execute_with(|| {
        let ops = RuntimeOrigin::signed(coretime_quote_authority());
        let ceiling = futarchy_treasury_core::reserve_probe_runway_debit(
            ReserveProbeFeeDot::get(),
            ReserveProbeDotRate::get(),
            ReserveProbeFailThreshold::get(),
            ReserveProbeRecoverThreshold::get(),
        )
        .expect("valid mock runway");
        assert_ok!(Treasury::fund_budget_line(
            ops.clone(),
            BudgetLine::OpsReserveProbe,
            ceiling - 1,
        ));
        assert_eq!(
            Treasury::line_balance(BudgetLine::OpsReserveProbe),
            ceiling - 1
        );

        for line in [
            BudgetLine::OpsCoretime,
            BudgetLine::OpsMonitoring,
            BudgetLine::Keeper,
        ] {
            assert_noop!(
                Treasury::fund_budget_line(ops.clone(), line, 1),
                Error::<Test>::BootstrapOpsLineOnly
            );
        }
        assert_noop!(
            Treasury::fund_budget_line(
                RuntimeOrigin::signed(acc(77)),
                BudgetLine::OpsMonitoring,
                USDC,
            ),
            Error::<Test>::NotQuoteAuthority
        );

        // Above-ceiling attempts are exact no-ops; a partial final top-up to
        // the ceiling remains live even after TREASURY arms.
        TreasuryArmedValue::set(true);
        let before = crate::State::<Test>::get();
        assert_noop!(
            Treasury::fund_budget_line(ops.clone(), BudgetLine::OpsReserveProbe, 2),
            Error::<Test>::BootstrapOpsFundingLimit
        );
        assert_eq!(crate::State::<Test>::get(), before);
        assert!(!crate::BootstrapOpsFundingClosed::<Test>::get());
        assert_ok!(Treasury::fund_budget_line(
            ops.clone(),
            BudgetLine::OpsReserveProbe,
            1,
        ));
        assert_eq!(Treasury::line_balance(BudgetLine::OpsReserveProbe), ceiling);
        assert!(!crate::BootstrapOpsFundingClosed::<Test>::get());

        // Zero and other-line binding-governance calls do not perform the
        // reserve-probe handover.
        assert_ok!(Treasury::fund_budget_line(
            to(),
            BudgetLine::OpsReserveProbe,
            0,
        ));
        assert_ok!(Treasury::fund_budget_line(
            to(),
            BudgetLine::OpsMonitoring,
            1,
        ));
        assert!(!crate::BootstrapOpsFundingClosed::<Test>::get());

        // A failed positive reserve funding also leaves the latch open.
        let state = crate::State::<Test>::get();
        assert!(Treasury::fund_budget_line(to(), BudgetLine::OpsReserveProbe, u128::MAX,).is_err());
        assert_eq!(crate::State::<Test>::get(), state);
        assert!(!crate::BootstrapOpsFundingClosed::<Test>::get());

        // The first successful positive binding-governance reserve refill is
        // the irreversible closure point.
        assert_ok!(Treasury::fund_budget_line(
            to(),
            BudgetLine::OpsReserveProbe,
            1,
        ));
        assert!(crate::BootstrapOpsFundingClosed::<Test>::get());
        TreasuryArmedValue::set(false);
        assert_noop!(
            Treasury::fund_budget_line(ops, BudgetLine::OpsReserveProbe, 1),
            Error::<Test>::BootstrapOpsFundingClosed
        );
    });
}

#[test]
fn ops_multisig_zero_and_checked_add_overflow_are_exact_noops() {
    new_test_ext_with(crate::GenesisConfig::<Test> {
        main_usdc: 1_000 * USDC,
        coretime_quote_authority: Some(coretime_quote_authority()),
        coretime_renewal_account: Some([44; 32]),
        ..Default::default()
    })
    .execute_with(|| {
        let ops = RuntimeOrigin::signed(coretime_quote_authority());
        let before_zero = crate::State::<Test>::get();
        assert_noop!(
            Treasury::fund_budget_line(ops.clone(), BudgetLine::OpsReserveProbe, 0),
            Error::<Test>::BootstrapOpsFundingLimit
        );
        assert_eq!(crate::State::<Test>::get(), before_zero);
        assert!(!crate::BootstrapOpsFundingClosed::<Test>::get());

        // Corrupt only the line balance to reach the arithmetic boundary that
        // an ordinary funded state can never approach under the small runway.
        crate::State::<Test>::mutate(|state| {
            state
                .lines
                .try_push((BudgetLine::OpsReserveProbe, u128::MAX))
                .expect("fixture has budget-line capacity");
        });
        let before_overflow = crate::State::<Test>::get();
        assert_noop!(
            Treasury::fund_budget_line(ops, BudgetLine::OpsReserveProbe, 1),
            Error::<Test>::BootstrapOpsFundingLimit
        );
        assert_eq!(crate::State::<Test>::get(), before_overflow);
        assert!(!crate::BootstrapOpsFundingClosed::<Test>::get());
    });
}

// ---- genesis (08 §2.1) ------------------------------------------------------

#[test]
fn storage_v2_initializes_bootstrap_closure_and_community_allocation() {
    for treasury_armed in [false, true] {
        new_test_ext().execute_with(|| {
            StorageVersion::new(0).put::<Treasury>();
            TreasuryArmedValue::set(treasury_armed);
            crate::BootstrapOpsFundingClosed::<Test>::put(!treasury_armed);

            let _ = <Treasury as Hooks<u64>>::on_runtime_upgrade();

            assert_eq!(StorageVersion::get::<Treasury>(), StorageVersion::new(4));
            assert_eq!(
                crate::BootstrapOpsFundingClosed::<Test>::get(),
                treasury_armed,
            );
            assert_eq!(
                crate::CommunityDistributionRemaining::<Test>::get(),
                CommunityDistributionAmount::get()
            );
            if treasury_armed {
                TreasuryArmedValue::set(false);
                assert!(crate::BootstrapOpsFundingClosed::<Test>::get());
            }
        });
    }
}

#[cfg(feature = "try-runtime")]
#[test]
fn storage_v2_try_runtime_checks_phase_derived_bootstrap_closure_and_allocation() {
    for treasury_armed in [false, true] {
        new_test_ext().execute_with(|| {
            StorageVersion::new(0).put::<Treasury>();
            TreasuryArmedValue::set(treasury_armed);
            crate::BootstrapOpsFundingClosed::<Test>::put(!treasury_armed);
            let state = <Treasury as Hooks<u64>>::pre_upgrade().expect("pre-upgrade state");
            let _ = <Treasury as Hooks<u64>>::on_runtime_upgrade();
            <Treasury as Hooks<u64>>::post_upgrade(state).expect("post-upgrade checks");
            assert_eq!(
                crate::BootstrapOpsFundingClosed::<Test>::get(),
                treasury_armed,
            );
        });
    }
}

#[cfg(feature = "try-runtime")]
#[test]
fn storage_v2_try_runtime_current_version_is_an_idempotent_latch_noop() {
    new_test_ext().execute_with(|| {
        TreasuryArmedValue::set(false);
        crate::BootstrapOpsFundingClosed::<Test>::put(true);

        for _ in 0..2 {
            let state = <Treasury as Hooks<u64>>::pre_upgrade().expect("pre-upgrade state");
            let _ = <Treasury as Hooks<u64>>::on_runtime_upgrade();
            <Treasury as Hooks<u64>>::post_upgrade(state).expect("post-upgrade checks");
            assert_eq!(StorageVersion::get::<Treasury>(), StorageVersion::new(4));
            assert!(crate::BootstrapOpsFundingClosed::<Test>::get());
        }
    });
}

#[cfg(feature = "try-runtime")]
#[test]
fn storage_v3_try_runtime_preserves_existing_v2_state() {
    new_test_ext().execute_with(|| {
        StorageVersion::new(2).put::<Treasury>();
        TreasuryArmedValue::set(false);
        crate::BootstrapOpsFundingClosed::<Test>::put(true);
        crate::CommunityDistributionRemaining::<Test>::put(123 * VIT);

        let state = <Treasury as Hooks<u64>>::pre_upgrade().expect("pre-upgrade state");
        let _ = <Treasury as Hooks<u64>>::on_runtime_upgrade();
        <Treasury as Hooks<u64>>::post_upgrade(state).expect("post-upgrade checks");

        assert!(crate::BootstrapOpsFundingClosed::<Test>::get());
        assert_eq!(
            crate::CommunityDistributionRemaining::<Test>::get(),
            123 * VIT
        );
    });
}

#[cfg(feature = "try-runtime")]
#[test]
fn storage_v3_try_runtime_preserves_existing_v1_bootstrap_latch() {
    new_test_ext().execute_with(|| {
        StorageVersion::new(1).put::<Treasury>();
        TreasuryArmedValue::set(true);
        crate::BootstrapOpsFundingClosed::<Test>::put(false);

        let state = <Treasury as Hooks<u64>>::pre_upgrade().expect("pre-upgrade state");
        let _ = <Treasury as Hooks<u64>>::on_runtime_upgrade();
        <Treasury as Hooks<u64>>::post_upgrade(state).expect("post-upgrade checks");

        assert!(!crate::BootstrapOpsFundingClosed::<Test>::get());
        assert_eq!(
            crate::CommunityDistributionRemaining::<Test>::get(),
            CommunityDistributionAmount::get()
        );
        assert_eq!(StorageVersion::get::<Treasury>(), StorageVersion::new(4));
    });
}

#[test]
fn default_genesis_is_empty_and_solvent() {
    new_test_ext().execute_with(|| {
        let t = crate::Pallet::<Test>::treasury();
        assert_eq!(t.main_usdc, 0);
        assert_eq!(t.vit_supply, futarchy_treasury_core::DEFAULT_VIT_SUPPLY);
        assert!(t.lines.is_empty());
        assert_eq!(t.next_stream_id, 0);
        assert_ok!(crate::Pallet::<Test>::do_try_state());
    });
}

#[test]
fn community_distribution_is_phase_armed_bounded_and_floor_rounded() {
    new_test_ext().execute_with(|| {
        assert_eq!(
            crate::CommunityDistributionRemaining::<Test>::get(),
            CommunityDistributionAmount::get()
        );
        assert_noop!(
            Treasury::create_community_schedule(to(), acc(1), 10 * VIT),
            Error::<Test>::CommunityDistributionNotArmed
        );

        frame_system::Pallet::<Test>::set_block_number(42);
        Treasury::note_phase_four_arming();
        let amount = 10 * VIT;
        assert_ok!(Treasury::create_community_schedule(to(), acc(1), amount));
        assert_eq!(
            community_vesting_calls(),
            vec![(
                CommunityPot::get(),
                acc(1),
                amount,
                amount / CommunityVestingDuration::get() as u128,
                42,
            )]
        );
        assert_eq!(
            crate::CommunityDistributionRemaining::<Test>::get(),
            CommunityDistributionAmount::get() - amount
        );
        assert_eq!(crate::CommunityScheduleCount::<Test>::get(), 1);
        assert!(System::events().iter().any(|record| matches!(
            &record.event,
            RuntimeEvent::Treasury(Event::CommunityScheduleCreated {
                beneficiary,
                amount: event_amount,
                start: 42,
                ..
            }) if *beneficiary == acc(1) && *event_amount == amount
        )));
    });
}

#[test]
fn community_distribution_rejects_invalid_origin_amount_and_bound_without_mutation() {
    // limit-coverage: Community distribution schedules
    new_test_ext().execute_with(|| {
        Treasury::note_phase_four_arming();
        let before = crate::CommunityDistributionRemaining::<Test>::get();
        assert_noop!(
            Treasury::create_community_schedule(RuntimeOrigin::root(), acc(1), VIT),
            sp_runtime::DispatchError::BadOrigin
        );
        assert_noop!(
            Treasury::create_community_schedule(to(), acc(1), VIT - 1),
            Error::<Test>::CommunityDistributionAmountTooSmall
        );
        assert_noop!(
            Treasury::create_community_schedule(to(), CommunityPot::get(), VIT),
            Error::<Test>::CommunityBeneficiaryIsPot
        );
        assert_noop!(
            Treasury::create_community_schedule(to(), acc(2), before + 1),
            Error::<Test>::CommunityDistributionExhausted
        );
        assert_eq!(crate::CommunityDistributionRemaining::<Test>::get(), before);

        assert_ok!(Treasury::create_community_schedule(to(), acc(1), VIT));
        assert_ok!(Treasury::create_community_schedule(to(), acc(2), VIT));
        assert_noop!(
            Treasury::create_community_schedule(to(), acc(3), VIT),
            Error::<Test>::TooManyCommunitySchedules
        );
    });
}

#[test]
fn community_distribution_adapter_failure_is_atomic_and_arming_is_idempotent() {
    new_test_ext().execute_with(|| {
        frame_system::Pallet::<Test>::set_block_number(9);
        Treasury::note_phase_four_arming();
        frame_system::Pallet::<Test>::set_block_number(10);
        Treasury::note_phase_four_arming();
        assert_eq!(crate::CommunityDistributionArmedAt::<Test>::get(), Some(9));
        let before = crate::CommunityDistributionRemaining::<Test>::get();
        set_community_vesting_failure(true);
        assert!(Treasury::create_community_schedule(to(), acc(1), VIT).is_err());
        assert_eq!(crate::CommunityDistributionRemaining::<Test>::get(), before);
        assert_eq!(crate::CommunityScheduleCount::<Test>::get(), 0);
        assert!(community_vesting_calls().is_empty());
    });
}

// ---- trading-reward funding and its folded budget return (TR6, 08 §2.6) ---

/// The `FutarchyParam` origin the two bounded genesis-pot leaves share
/// (06 §3.2). Named separately from `to()` for readability at call sites —
/// in this mock both resolve through `TestTreasuryOrigin`, exactly as
/// `TreasuryOrigin` and `CommunityDistributionOrigin` already do, since the
/// mock has no way to distinguish origin *classes* that a real runtime binds
/// to the same predicate.
fn param_origin() -> RuntimeOrigin {
    RuntimeOrigin::signed(treasury_acc())
}

#[test]
fn genesis_initializes_the_incentive_allocation() {
    new_test_ext().execute_with(|| {
        assert_eq!(
            crate::IncentiveRemaining::<Test>::get(),
            IncentiveAllocationAmount::get()
        );
        assert_eq!(crate::TradingRewardBudgetCount::<Test>::get(), 0);
        assert_ok!(crate::Pallet::<Test>::do_try_state());
    });
}

#[test]
fn storage_v4_initializes_the_incentive_allocation() {
    new_test_ext().execute_with(|| {
        StorageVersion::new(0).put::<Treasury>();
        // Model a chain genesis-created before this storage item existed:
        // no code path but the v4 migration leg can have written it.
        crate::IncentiveRemaining::<Test>::kill();

        let _ = <Treasury as Hooks<u64>>::on_runtime_upgrade();

        assert_eq!(StorageVersion::get::<Treasury>(), StorageVersion::new(4));
        assert_eq!(
            crate::IncentiveRemaining::<Test>::get(),
            IncentiveAllocationAmount::get()
        );
    });
}

#[cfg(feature = "try-runtime")]
#[test]
fn storage_v4_try_runtime_checks_incentive_allocation_initialization() {
    new_test_ext().execute_with(|| {
        StorageVersion::new(0).put::<Treasury>();
        crate::IncentiveRemaining::<Test>::kill();
        let state = <Treasury as Hooks<u64>>::pre_upgrade().expect("pre-upgrade state");
        let _ = <Treasury as Hooks<u64>>::on_runtime_upgrade();
        <Treasury as Hooks<u64>>::post_upgrade(state).expect("post-upgrade checks");
        assert_eq!(
            crate::IncentiveRemaining::<Test>::get(),
            IncentiveAllocationAmount::get()
        );
    });
}

#[cfg(feature = "try-runtime")]
#[test]
fn storage_v4_try_runtime_preserves_existing_v3_state_while_initializing_incentive() {
    new_test_ext().execute_with(|| {
        StorageVersion::new(3).put::<Treasury>();
        TreasuryArmedValue::set(false);
        crate::BootstrapOpsFundingClosed::<Test>::put(true);
        crate::CommunityDistributionRemaining::<Test>::put(123 * VIT);

        let state = <Treasury as Hooks<u64>>::pre_upgrade().expect("pre-upgrade state");
        let _ = <Treasury as Hooks<u64>>::on_runtime_upgrade();
        <Treasury as Hooks<u64>>::post_upgrade(state).expect("post-upgrade checks");

        assert!(crate::BootstrapOpsFundingClosed::<Test>::get());
        assert_eq!(
            crate::CommunityDistributionRemaining::<Test>::get(),
            123 * VIT
        );
        assert_eq!(
            crate::IncentiveRemaining::<Test>::get(),
            IncentiveAllocationAmount::get()
        );
        assert_eq!(StorageVersion::get::<Treasury>(), StorageVersion::new(4));
    });
}

#[cfg(feature = "try-runtime")]
#[test]
fn storage_v4_try_runtime_current_version_is_an_idempotent_latch_noop() {
    new_test_ext().execute_with(|| {
        crate::IncentiveRemaining::<Test>::put(55 * VIT);
        for _ in 0..2 {
            let state = <Treasury as Hooks<u64>>::pre_upgrade().expect("pre-upgrade state");
            let _ = <Treasury as Hooks<u64>>::on_runtime_upgrade();
            <Treasury as Hooks<u64>>::post_upgrade(state).expect("post-upgrade checks");
            assert_eq!(StorageVersion::get::<Treasury>(), StorageVersion::new(4));
            assert_eq!(crate::IncentiveRemaining::<Test>::get(), 55 * VIT);
        }
    });
}

#[test]
fn funding_moves_vit_from_the_incentive_pot_to_the_rewards_sovereign() {
    new_test_ext().execute_with(|| {
        assert_ok!(Treasury::fund_trading_rewards(param_origin(), 1_000 * VIT));
        assert_eq!(
            trading_reward_funding_calls(),
            vec![(IncentivePot::get(), 1_000 * VIT)]
        );
        assert_eq!(
            crate::IncentiveRemaining::<Test>::get(),
            IncentiveAllocationAmount::get() - 1_000 * VIT
        );
        assert_eq!(crate::TradingRewardBudgetCount::<Test>::get(), 1);
        assert!(System::events().iter().any(|record| matches!(
            &record.event,
            RuntimeEvent::Treasury(Event::TradingRewardsFunded { amount, remaining })
                if *amount == 1_000 * VIT
                    && *remaining == IncentiveAllocationAmount::get() - 1_000 * VIT
        )));
    });
}

#[test]
fn funding_refuses_a_signed_origin() {
    new_test_ext().execute_with(|| {
        assert_noop!(
            Treasury::fund_trading_rewards(RuntimeOrigin::signed(nobody()), 1),
            sp_runtime::DispatchError::BadOrigin
        );
        assert!(trading_reward_funding_calls().is_empty());
    });
}

#[test]
fn funding_rejects_invalid_origin_amount_and_bound_without_mutation() {
    // limit-coverage: Trading-reward budget authorizations
    //
    // 13 §4 / 08 §2.6's *Bounds* paragraph: the lifetime authorization count
    // reuses `MaxCommunitySchedules` as its value, through the `Config` item
    // rather than a re-derived constant, but keeps its own counter — so
    // consuming one does not reduce the other's headroom. The 4,097th call
    // refuses `TooManyTradingRewardAuthorizations` before any VIT moves.
    new_test_ext().execute_with(|| {
        assert_noop!(
            Treasury::fund_trading_rewards(RuntimeOrigin::root(), VIT),
            sp_runtime::DispatchError::BadOrigin
        );
        let remaining = crate::IncentiveRemaining::<Test>::get();
        assert_noop!(
            Treasury::fund_trading_rewards(param_origin(), remaining + 1),
            Error::<Test>::IncentiveAllocationExhausted
        );
        assert_eq!(crate::IncentiveRemaining::<Test>::get(), remaining);
        assert!(trading_reward_funding_calls().is_empty());

        assert_ok!(Treasury::fund_trading_rewards(param_origin(), VIT));
        assert_ok!(Treasury::fund_trading_rewards(param_origin(), VIT));
        assert_noop!(
            Treasury::fund_trading_rewards(param_origin(), VIT),
            Error::<Test>::TooManyTradingRewardAuthorizations
        );
        assert_eq!(crate::TradingRewardBudgetCount::<Test>::get(), 2);
    });
}

/// 08 §2.6 consequence 2 of the fold: with the return folded in,
/// `fund_trading_rewards(0)` is the only pure retire-and-wind-down action
/// governance has. Refusing it — as the standalone-sweep shape's `AmountZero`
/// guard did — would leave no way to return the budget without authorizing at
/// least one more planck.
#[test]
fn a_zero_amount_authorization_is_the_wind_down_and_returns_everything() {
    new_test_ext().execute_with(|| {
        assert_ok!(Treasury::fund_trading_rewards(param_origin(), 1_000 * VIT));
        let count_before = crate::TradingRewardBudgetCount::<Test>::get();

        assert_ok!(Treasury::fund_trading_rewards(param_origin(), 0));

        assert_eq!(
            trading_reward_sweep_calls(),
            vec![(IncentivePot::get(), 1_000 * VIT)]
        );
        assert_eq!(trading_reward_sovereign_balance(), 0);
        assert_eq!(
            crate::IncentiveRemaining::<Test>::get(),
            IncentiveAllocationAmount::get()
        );
        // A return authorizes nothing, so it consumes no authorization slot.
        assert_eq!(crate::TradingRewardBudgetCount::<Test>::get(), count_before);
        // …and it emits the return event alone, never a funding event.
        assert!(System::events().iter().any(|record| matches!(
            &record.event,
            RuntimeEvent::Treasury(Event::TradingRewardBudgetReturned { amount, .. })
                if *amount == 1_000 * VIT
        )));
        assert_eq!(
            System::events()
                .iter()
                .filter(|record| matches!(
                    &record.event,
                    RuntimeEvent::Treasury(Event::TradingRewardsFunded { .. })
                ))
                .count(),
            1,
            "only the first, funding call may emit TradingRewardsFunded"
        );
    });
}

/// 08 §2.6 consequence 3, and the one direction of it that is a safety
/// property rather than an accounting one: the authorization bound counts
/// authorizations, so the wind-down stays reachable **after** the bound is
/// full. Counting a zero-amount return as an authorization would refuse the
/// only call that can bring the final remainder home, stranding it in the
/// sovereign forever (G-1).
#[test]
fn the_wind_down_still_returns_the_budget_once_the_authorization_bound_is_full() {
    new_test_ext().execute_with(|| {
        for _ in 0..MaxCommunitySchedules::get() {
            assert_ok!(Treasury::fund_trading_rewards(param_origin(), 1_000 * VIT));
        }
        assert_noop!(
            Treasury::fund_trading_rewards(param_origin(), VIT),
            Error::<Test>::TooManyTradingRewardAuthorizations
        );
        // The refusal above is a complete no-op: it must not have returned the
        // outstanding budget on its way to failing.
        assert_eq!(trading_reward_sovereign_balance(), 1_000 * VIT);

        assert_ok!(Treasury::fund_trading_rewards(param_origin(), 0));
        assert_eq!(trading_reward_sovereign_balance(), 0);
        assert_eq!(
            crate::IncentiveRemaining::<Test>::get(),
            IncentiveAllocationAmount::get()
        );
    });
}

#[test]
fn funding_adapter_failure_is_atomic() {
    new_test_ext().execute_with(|| {
        let remaining = crate::IncentiveRemaining::<Test>::get();
        set_trading_reward_funding_failure(true);
        assert!(Treasury::fund_trading_rewards(param_origin(), VIT).is_err());
        assert_eq!(crate::IncentiveRemaining::<Test>::get(), remaining);
        assert_eq!(crate::TradingRewardBudgetCount::<Test>::get(), 0);
        assert!(trading_reward_funding_calls().is_empty());
    });
}

// ---- the folded budget return: two obligations in one call ----------------
//
// 08 §2.6 states both. **The amount:** "the sovereign's VIT balance less the
// accruals no participant has claimed yet". `TotalAccrued` in the reward
// pallet falls only when a participant calls `claim_rewards`, entirely at
// their own discretion and possibly long after the epoch that promised it. A
// return that took the whole balance would take the VIT backing that
// unclaimed accrual too, and `claim_rewards` would have nothing to pay from —
// permanently, if the claim never comes. **The authority and the timing:**
// "the return … MUST NOT be permissionless", because a public crank emptying
// the headroom mid-settlement closes every remaining participant's epoch at a
// zero reward with their score discarded, and re-funding cannot reopen it.
// Both failures are invisible from the reward pallet's own settlement path,
// which is exactly why each presents as a program that silently stops paying.

#[test]
fn funding_with_nothing_outstanding_returns_nothing_and_emits_no_return_event() {
    new_test_ext().execute_with(|| {
        assert_ok!(Treasury::fund_trading_rewards(param_origin(), 1_000 * VIT));
        assert!(trading_reward_sweep_calls().is_empty());
        assert!(!System::events().iter().any(|record| matches!(
            &record.event,
            RuntimeEvent::Treasury(Event::TradingRewardBudgetReturned { .. })
        )));
    });
}

/// Consequence 1 of the fold, and the one a sibling call's shape lands
/// backwards: the return runs **before** the authorization. Funding after
/// returning leaves the sovereign holding exactly the new budget; returning
/// after funding would hand back the amount this very call just authorized
/// and leave the sovereign empty.
#[test]
fn a_new_authorization_retires_the_previous_one_before_it_funds() {
    new_test_ext().execute_with(|| {
        assert_ok!(Treasury::fund_trading_rewards(param_origin(), 1_000 * VIT));

        assert_ok!(Treasury::fund_trading_rewards(param_origin(), 400 * VIT));

        assert_eq!(
            trading_reward_sweep_calls(),
            vec![(IncentivePot::get(), 1_000 * VIT)]
        );
        assert_eq!(
            trading_reward_funding_calls(),
            vec![
                (IncentivePot::get(), 1_000 * VIT),
                (IncentivePot::get(), 400 * VIT)
            ]
        );
        // The order is what this figure proves. Return-then-fund leaves 400;
        // fund-then-return leaves 0; no return at all leaves 1,400.
        assert_eq!(trading_reward_sovereign_balance(), 400 * VIT);
        assert_eq!(
            crate::IncentiveRemaining::<Test>::get(),
            IncentiveAllocationAmount::get() - 400 * VIT
        );
        assert_eq!(crate::TradingRewardBudgetCount::<Test>::get(), 2);
    });
}

/// The returned remainder is reauthorizable in the **same** call: an amount
/// larger than the un-returned allocation still passes, because the check
/// reads the replenished figure. Checking before the return would refuse a
/// budget the pot demonstrably has.
#[test]
fn the_returned_remainder_is_spendable_by_the_authorization_that_returned_it() {
    new_test_ext().execute_with(|| {
        let whole = IncentiveAllocationAmount::get();
        assert_ok!(Treasury::fund_trading_rewards(param_origin(), whole));
        assert_eq!(crate::IncentiveRemaining::<Test>::get(), 0);

        assert_ok!(Treasury::fund_trading_rewards(param_origin(), whole));

        assert_eq!(trading_reward_sovereign_balance(), whole);
        assert_eq!(crate::IncentiveRemaining::<Test>::get(), 0);
    });
}

/// The obligation's own test, named to match its description: retires an
/// epoch with an unclaimed accrual outstanding and asserts the returned
/// amount excludes it. Mutating the subtraction
/// (`balance.saturating_sub(reserved)` → `balance`) makes this go red: the
/// returned amount would be 1,000 VIT instead of 600, and the sovereign would
/// be emptied instead of left holding the 400 VIT the accrual needs.
#[test]
fn the_return_excludes_vit_backing_an_unclaimed_accrual() {
    new_test_ext().execute_with(|| {
        assert_ok!(Treasury::fund_trading_rewards(param_origin(), 1_000 * VIT));
        set_trading_reward_accrual_reserve(400 * VIT);
        let remaining_before = crate::IncentiveRemaining::<Test>::get();

        assert_ok!(Treasury::fund_trading_rewards(param_origin(), 0));

        assert_eq!(
            trading_reward_sweep_calls(),
            vec![(IncentivePot::get(), 600 * VIT)]
        );
        assert_eq!(trading_reward_sovereign_balance(), 400 * VIT);
        assert_eq!(
            crate::IncentiveRemaining::<Test>::get(),
            remaining_before + 600 * VIT
        );
        assert!(System::events().iter().any(|record| matches!(
            &record.event,
            RuntimeEvent::Treasury(Event::TradingRewardBudgetReturned { amount, remaining })
                if *amount == 600 * VIT && *remaining == remaining_before + 600 * VIT
        )));
    });
}

#[test]
fn a_return_with_the_whole_balance_reserved_for_accruals_moves_nothing() {
    new_test_ext().execute_with(|| {
        assert_ok!(Treasury::fund_trading_rewards(param_origin(), 1_000 * VIT));
        set_trading_reward_accrual_reserve(1_000 * VIT);
        let remaining_before = crate::IncentiveRemaining::<Test>::get();

        assert_ok!(Treasury::fund_trading_rewards(param_origin(), 0));

        assert!(trading_reward_sweep_calls().is_empty());
        assert_eq!(trading_reward_sovereign_balance(), 1_000 * VIT);
        assert_eq!(crate::IncentiveRemaining::<Test>::get(), remaining_before);
    });
}

#[test]
fn a_reserve_above_the_balance_saturates_to_a_zero_return() {
    // A reserve figure momentarily above the sovereign's balance must
    // saturate to zero rather than underflow (G-1) — reachable in principle
    // from a mid-epoch adapter read racing a debit, never from ordinary
    // fund/return bookkeeping alone.
    new_test_ext().execute_with(|| {
        assert_ok!(Treasury::fund_trading_rewards(param_origin(), 100 * VIT));
        set_trading_reward_accrual_reserve(500 * VIT);
        assert_ok!(Treasury::fund_trading_rewards(param_origin(), 0));
        assert!(trading_reward_sweep_calls().is_empty());
        assert_eq!(trading_reward_sovereign_balance(), 100 * VIT);
    });
}

#[test]
fn return_adapter_failure_is_atomic() {
    new_test_ext().execute_with(|| {
        assert_ok!(Treasury::fund_trading_rewards(param_origin(), 1_000 * VIT));
        let remaining_before = crate::IncentiveRemaining::<Test>::get();
        let count_before = crate::TradingRewardBudgetCount::<Test>::get();
        set_trading_reward_sweep_failure(true);

        assert!(Treasury::fund_trading_rewards(param_origin(), 100 * VIT).is_err());

        assert_eq!(crate::IncentiveRemaining::<Test>::get(), remaining_before);
        assert_eq!(crate::TradingRewardBudgetCount::<Test>::get(), count_before);
        assert_eq!(trading_reward_sovereign_balance(), 1_000 * VIT);
        // A failed return must not have funded the new authorization either.
        assert_eq!(trading_reward_funding_calls().len(), 1);
    });
}

#[test]
fn the_return_credit_never_lets_remaining_exceed_the_genesis_allocation() {
    // Model a direct donation to the reward sovereign that was never
    // authorized through `fund_trading_rewards`: a returnable balance exists
    // with nothing backing it in `IncentiveRemaining`'s ledger. The credit
    // must clamp at the genesis allocation rather than manufacture spendable
    // budget no governance decision ever authorized.
    new_test_ext().execute_with(|| {
        donate_to_trading_reward_sovereign(10 * VIT);
        assert_eq!(
            crate::IncentiveRemaining::<Test>::get(),
            IncentiveAllocationAmount::get()
        );

        assert_ok!(Treasury::fund_trading_rewards(param_origin(), 0));

        assert_eq!(
            trading_reward_sweep_calls(),
            vec![(IncentivePot::get(), 10 * VIT)]
        );
        assert_eq!(
            crate::IncentiveRemaining::<Test>::get(),
            IncentiveAllocationAmount::get()
        );
    });
}

#[test]
fn try_state_catches_incentive_remaining_above_the_genesis_allocation() {
    new_test_ext().execute_with(|| {
        crate::IncentiveRemaining::<Test>::put(IncentiveAllocationAmount::get() + 1);
        assert_eq!(
            crate::Pallet::<Test>::do_try_state(),
            Err(sp_runtime::TryRuntimeError::Other(
                "treasury: remaining incentive allocation exceeds genesis allocation"
            ))
        );
    });
}

#[test]
fn try_state_catches_trading_reward_budget_count_above_its_bound() {
    new_test_ext().execute_with(|| {
        crate::TradingRewardBudgetCount::<Test>::put(MaxCommunitySchedules::get() + 1);
        assert_eq!(
            crate::Pallet::<Test>::do_try_state(),
            Err(sp_runtime::TryRuntimeError::Other(
                "treasury: trading-reward budget authorization count exceeds its bound"
            ))
        );
    });
}

// ---- origins (08 §1.1, rule 6) -----------------------------------------------

#[test]
fn outflow_calls_admit_only_the_treasury_origin() {
    funded_ext().execute_with(|| {
        for bad in [RuntimeOrigin::signed(nobody()), RuntimeOrigin::root()] {
            assert_noop!(
                Treasury::spend(bad.clone(), BudgetLine::OpsCollators, acc(1), 1),
                sp_runtime::DispatchError::BadOrigin
            );
            assert_noop!(
                Treasury::open_stream(bad.clone(), BudgetLine::Rewards, acc(1), 1, 0, 1),
                sp_runtime::DispatchError::BadOrigin
            );
            assert_noop!(
                Treasury::cancel_stream(bad.clone(), 0),
                sp_runtime::DispatchError::BadOrigin
            );
            assert_noop!(
                Treasury::issue_vit(bad.clone(), 1, BudgetLine::Rewards),
                sp_runtime::DispatchError::BadOrigin
            );
            assert_noop!(
                Treasury::recover_foreign(bad, AssetKind::Foreign([1u8; 32]), acc(1), 1),
                sp_runtime::DispatchError::BadOrigin
            );
        }
        assert_noop!(
            Treasury::fund_budget_line(RuntimeOrigin::signed(nobody()), BudgetLine::Keeper, 1),
            Error::<Test>::NotQuoteAuthority
        );
        assert_noop!(
            Treasury::fund_budget_line(RuntimeOrigin::root(), BudgetLine::Keeper, 1),
            sp_runtime::DispatchError::BadOrigin
        );
    });
}

#[test]
fn claim_and_renewal_are_signed_permissionless_not_treasury_gated() {
    funded_ext().execute_with(|| {
        // Both are Signed calls: an unknown period / stream errors on state, not
        // on origin — proving they are permissionless, not FutarchyTreasury-only.
        assert_noop!(
            Treasury::execute_coretime_renewal(RuntimeOrigin::signed(nobody()), 7),
            Error::<Test>::RenewalWindowClosed
        );
        assert_noop!(
            Treasury::claim_stream(RuntimeOrigin::signed(nobody()), 0),
            Error::<Test>::StreamNotFound
        );
        // Root is not a signed origin.
        assert_noop!(
            Treasury::claim_stream(RuntimeOrigin::root(), 0),
            sp_runtime::DispatchError::BadOrigin
        );
    });
}

// ---- fund_budget_line / spend (08 §1.1/§1.3) --------------------------------

#[test]
fn fund_budget_line_moves_main_into_the_line() {
    funded_ext().execute_with(|| {
        let before = Treasury::line_balance(BudgetLine::Keeper);
        assert_ok!(Treasury::fund_budget_line(
            to(),
            BudgetLine::Keeper,
            100_000 * USDC
        ));
        assert_eq!(
            Treasury::line_balance(BudgetLine::Keeper),
            before + 100_000 * USDC
        );
        System::assert_last_event(RuntimeEvent::Treasury(Event::BudgetLineFunded {
            line: BudgetLine::Keeper,
            amount: 100_000 * USDC,
        }));
        // NAV is invariant under funding (main − x, line + x).
        assert_eq!(Treasury::nav().nav, MAIN0);
    });
}

#[test]
fn pot_backed_budget_lines_sync_exact_funding_to_custody() {
    funded_ext().execute_with(|| {
        let keeper_before = Treasury::line_balance(BudgetLine::Keeper);
        let oracle_before = Treasury::line_balance(BudgetLine::Oracle);
        let rewards_before = Treasury::line_balance(BudgetLine::Rewards);

        assert_ok!(Treasury::fund_budget_line(
            to(),
            BudgetLine::Keeper,
            50 * USDC
        ));
        assert_ok!(Treasury::fund_budget_line(
            to(),
            BudgetLine::Oracle,
            30 * USDC
        ));
        assert_ok!(Treasury::fund_budget_line(
            to(),
            BudgetLine::Rewards,
            40 * USDC
        ));

        assert_eq!(
            pot_funding_calls(),
            vec![
                (PayoutLine::Keeper, 50 * USDC),
                (PayoutLine::Oracle, 30 * USDC),
                (PayoutLine::Rewards, 40 * USDC),
            ]
        );
        assert_eq!(
            Treasury::line_balance(BudgetLine::Keeper),
            keeper_before + 50 * USDC
        );
        assert_eq!(
            Treasury::line_balance(BudgetLine::Oracle),
            oracle_before + 30 * USDC
        );
        assert_eq!(
            Treasury::line_balance(BudgetLine::Rewards),
            rewards_before + 40 * USDC
        );
        assert_eq!(KeeperRebatePotBalance::get(), 50 * USDC);
        assert_eq!(OracleRebatePotBalance::get(), 30 * USDC);
        assert_eq!(RewardsPayoutPotBalance::get(), 2_000_000 * USDC + 40 * USDC);
        assert_ok!(crate::Pallet::<Test>::do_try_state());
    });
}

#[test]
fn pot_funding_failure_rolls_back_internal_credit_and_event() {
    funded_ext().execute_with(|| {
        let main_before = crate::Pallet::<Test>::treasury().main_usdc;
        let line_before = Treasury::line_balance(BudgetLine::Keeper);
        set_pot_funding_failure(true);
        System::reset_events();

        assert_eq!(
            Treasury::fund_budget_line(to(), BudgetLine::Keeper, 50 * USDC),
            Err(sp_runtime::DispatchError::Other("pot funding failed"))
        );

        assert_eq!(crate::Pallet::<Test>::treasury().main_usdc, main_before);
        assert_eq!(Treasury::line_balance(BudgetLine::Keeper), line_before);
        assert!(System::events().is_empty());
        assert_eq!(pot_funding_calls(), vec![(PayoutLine::Keeper, 50 * USDC)]);
    });
}

#[test]
fn non_pot_budget_lines_credit_without_custody_calls() {
    funded_ext().execute_with(|| {
        // `Pol`/`PolBaseline` left this set in milestone E1 — a book seed spends
        // their real USDC, so they are custody-synced now (08 §8 step 5; I-33).
        let cases = [
            (BudgetLine::OpsBootnodes, 11 * USDC),
            (BudgetLine::OpsCoretime, 12 * USDC),
        ];
        let before = cases
            .iter()
            .map(|(line, _)| (*line, Treasury::line_balance(*line)))
            .collect::<Vec<_>>();

        for (line, amount) in cases {
            assert_ok!(Treasury::fund_budget_line(to(), line, amount));
        }

        assert!(pot_funding_calls().is_empty());
        for ((line, amount), (_, old_balance)) in cases.into_iter().zip(before) {
            assert_eq!(Treasury::line_balance(line), old_balance + amount);
        }
    });
}

#[test]
fn the_two_subsidy_lines_are_custody_synced_and_move_with_their_seed_and_return() {
    // I-33: `fund_budget_line` moves the cash with the credit, a seed debits the
    // line by exactly what leaves custody, and the 04 §2 Sweep credits back
    // exactly what returned. `MAIN` is untouched by the return: the USDC comes
    // from the ledger sovereign, so debiting `MAIN` would spend it twice.
    funded_ext().execute_with(|| {
        for (line, payout, amount) in [
            (BudgetLine::Pol, PayoutLine::Pol, 11 * USDC),
            (BudgetLine::PolBaseline, PayoutLine::PolBaseline, 7 * USDC),
        ] {
            assert_ok!(Treasury::fund_budget_line(to(), line, amount));
            assert!(pot_funding_calls().contains(&(payout, amount)));
            assert_eq!(Treasury::line_balance(line), amount);

            let main_before = crate::Pallet::<Test>::treasury().main_usdc;
            assert_ok!(crate::Pallet::<Test>::debit_pol_custody(line, 4 * USDC));
            assert_eq!(Treasury::line_balance(line), amount - 4 * USDC);
            // A seed the treasury cannot account for is refused, not recorded
            // wrong (G-1).
            assert_noop!(
                crate::Pallet::<Test>::debit_pol_custody(line, amount),
                Error::<Test>::InsufficientFunds,
            );
            // The return may exceed the seed: recycled book revenue is income.
            assert_ok!(crate::Pallet::<Test>::credit_pol_custody(line, 5 * USDC));
            assert_eq!(Treasury::line_balance(line), amount + USDC);
            assert_eq!(crate::Pallet::<Test>::treasury().main_usdc, main_before);
        }
        // Only the two subsidy lines have a custody account a seed can spend.
        assert_noop!(
            crate::Pallet::<Test>::debit_pol_custody(BudgetLine::Keeper, USDC),
            Error::<Test>::UnknownBudgetLine,
        );
        assert_noop!(
            crate::Pallet::<Test>::credit_pol_custody(BudgetLine::Keeper, USDC),
            Error::<Test>::UnknownBudgetLine,
        );
    });
}

#[test]
fn zero_funding_keeps_core_bookkeeping_without_custody_movement() {
    funded_ext().execute_with(|| {
        let main_before = crate::Pallet::<Test>::treasury().main_usdc;
        System::reset_events();

        assert_ok!(Treasury::fund_budget_line(to(), BudgetLine::Keeper, 0));

        assert_eq!(crate::Pallet::<Test>::treasury().main_usdc, main_before);
        assert_eq!(Treasury::line_balance(BudgetLine::Keeper), 0);
        assert!(crate::Pallet::<Test>::treasury()
            .lines
            .contains(&(BudgetLine::Keeper, 0)));
        assert!(pot_funding_calls().is_empty());
        assert_eq!(KeeperRebatePotBalance::get(), 0);
        System::assert_last_event(RuntimeEvent::Treasury(Event::BudgetLineFunded {
            line: BudgetLine::Keeper,
            amount: 0,
        }));
    });
}

#[test]
fn spend_enforces_stream_threshold_cap_and_line_balance() {
    // limit-coverage: trs.stream_thr
    funded_ext().execute_with(|| {
        // > 1% NAV (250k) must stream, not spend.
        assert_noop!(
            Treasury::spend(to(), BudgetLine::OpsCollators, acc(1), 300_000 * USDC),
            Error::<Test>::StreamRequired
        );
        // Unknown line.
        assert_noop!(
            Treasury::spend(to(), BudgetLine::Oracle, acc(1), 1),
            Error::<Test>::UnknownBudgetLine
        );
        // A valid in-cap grant pays out and debits the line.
        let before = Treasury::line_balance(BudgetLine::OpsCollators);
        assert_ok!(Treasury::spend(
            to(),
            BudgetLine::OpsCollators,
            acc(1),
            100_000 * USDC
        ));
        assert_eq!(
            Treasury::line_balance(BudgetLine::OpsCollators),
            before - 100_000 * USDC
        );
        System::assert_last_event(RuntimeEvent::Treasury(Event::Spent {
            line: BudgetLine::OpsCollators,
            dest: acc(1),
            amount: 100_000 * USDC,
        }));
    });
}

// ---- unwired outflow custody fails closed (08 §1.4; AUD-NUM-001) ------------

/// The four value-bearing calls whose real-asset leg is 08 §1.4's "A9 fungibles
/// follow-up" must refuse while that leg is unwired, rather than reporting a
/// movement that never happened (G-1). This is the answer the production
/// runtime gives; the mock reports wired by default so the rest of this suite
/// can still exercise the accounting.
#[test]
fn value_bearing_calls_refuse_while_outflow_custody_is_unwired() {
    funded_ext().execute_with(|| {
        // Open the stream while custody is wired, so the refusal below is the
        // claim's and not the opening's.
        assert_ok!(Treasury::open_stream(
            to(),
            BudgetLine::Rewards,
            acc(2),
            1_000_000 * USDC,
            0,
            100,
        ));
        System::set_block_number(60);
        let before = crate::State::<Test>::get();

        set_outflow_custody_wired(false);
        assert_noop!(
            Treasury::spend(to(), BudgetLine::OpsCollators, acc(1), 100_000 * USDC),
            Error::<Test>::OutflowCustodyUnwired
        );
        assert_noop!(
            Treasury::claim_stream(RuntimeOrigin::signed(acc(2)), 0),
            Error::<Test>::OutflowCustodyUnwired
        );
        assert_noop!(
            Treasury::issue_vit(to(), 1_000_000 * VIT, BudgetLine::Rewards),
            Error::<Test>::OutflowCustodyUnwired
        );
        assert_noop!(
            Treasury::recover_foreign(to(), AssetKind::Foreign([1u8; 32]), acc(1), 1_000 * USDC),
            Error::<Test>::OutflowCustodyUnwired
        );
        // `assert_noop!` already proves storage is untouched per call; assert the
        // aggregate too, because the danger this closes is state that moves
        // while value does not.
        assert_eq!(crate::State::<Test>::get(), before);

        // The refusal is the custody seam's alone: re-wire it and the same
        // claim succeeds, so the guard has not disabled the mechanism.
        set_outflow_custody_wired(true);
        assert_ok!(Treasury::claim_stream(RuntimeOrigin::signed(acc(2)), 0));
        set_outflow_custody_wired(true);
    });
}

/// The sharp case. `claim_stream` advances the vesting cursor to the vested
/// total and returns the claimable amount for payment; with no payment leg the
/// pallet discarded it, so a legitimate entitlement was consumed and could
/// never be re-claimed. Refusing leaves the cursor where it was, so the claim
/// survives until custody is wired.
#[test]
fn an_unwired_claim_does_not_consume_the_recipients_entitlement() {
    funded_ext().execute_with(|| {
        assert_ok!(Treasury::open_stream(
            to(),
            BudgetLine::Rewards,
            acc(2),
            1_000_000 * USDC,
            0,
            100,
        ));
        System::set_block_number(60);

        set_outflow_custody_wired(false);
        assert_noop!(
            Treasury::claim_stream(RuntimeOrigin::signed(acc(2)), 0),
            Error::<Test>::OutflowCustodyUnwired
        );
        let stream = crate::State::<Test>::get()
            .streams
            .into_iter()
            .find(|s| s.id == 0)
            .expect("the stream is still open");
        assert_eq!(stream.claimed, 0, "the refused claim consumed nothing");

        set_outflow_custody_wired(true);
        assert_ok!(Treasury::claim_stream(RuntimeOrigin::signed(acc(2)), 0));
        let stream = crate::State::<Test>::get()
            .streams
            .into_iter()
            .find(|s| s.id == 0)
            .expect("the stream is still recorded");
        assert_eq!(
            stream.claimed,
            600_000 * USDC,
            "the same claim is still available once custody exists",
        );
    });
}

// ---- reserve haircut fail-static (08 §1.2) ----------------------------------

#[test]
fn reserve_haircut_zeroes_spendable_nav_and_blocks_new_commitments() {
    funded_ext().execute_with(|| {
        // The haircut event is stamped with the live epoch from Config::CurrentEpoch.
        set_epoch(5);
        assert_ok!(crate::Pallet::<Test>::set_reserve_impaired(true));
        System::assert_last_event(RuntimeEvent::Treasury(Event::NavHaircutFlagged {
            epoch: 5,
            flag: true,
        }));
        let nav = Treasury::nav();
        assert!(nav.reserve_impaired);
        assert_eq!(nav.spendable_nav, 0);

        // No new spends / streams / issuance-independent outflows.
        assert_noop!(
            Treasury::spend(to(), BudgetLine::OpsCollators, acc(1), 1),
            Error::<Test>::ReserveImpaired
        );
        assert_noop!(
            Treasury::open_stream(
                to(),
                BudgetLine::OpsCollators,
                acc(1),
                300_000 * USDC,
                0,
                100
            ),
            Error::<Test>::ReserveImpaired
        );
        // Every arming floor fails static (loud event ⇒ `assert_err`).
        assert_err!(
            crate::Pallet::<Test>::ensure_nav_floor(futarchy_primitives::ProposalClass::Param),
            Error::<Test>::NavFloorUnmet
        );

        // The full Coretime liveness sequence stays alive (D-9 freeze-exempt).
        assert_ok!(note_quote(1, 100_000 * USDC));
        assert_ok!(Treasury::prune_coretime_quote(
            RuntimeOrigin::signed(coretime_quote_authority()),
            1,
        ));
        assert_ok!(note_quote(1, 100_000 * USDC));
        assert_ok!(Treasury::execute_coretime_renewal(
            RuntimeOrigin::signed(acc(8)),
            1
        ));
    });
}

// ---- streams (08 §1.3) ------------------------------------------------------

#[test]
fn streams_are_mandatory_claimable_and_cancellable() {
    funded_ext().execute_with(|| {
        // Below threshold ⇒ a stream is not allowed (use spend).
        assert_noop!(
            Treasury::open_stream(
                to(),
                BudgetLine::OpsCollators,
                acc(2),
                10_000 * USDC,
                0,
                100
            ),
            Error::<Test>::StreamRequired
        );
        // A valid mandatory stream.
        assert_ok!(Treasury::open_stream(
            to(),
            BudgetLine::OpsCollators,
            acc(2),
            300_000 * USDC,
            10,
            100
        ));
        // id 0, half vested at block 60 (start 10, duration 100).
        System::set_block_number(60);
        assert_noop!(
            Treasury::claim_stream(RuntimeOrigin::signed(acc(9)), 0),
            Error::<Test>::NotRecipient
        );
        assert_ok!(Treasury::claim_stream(RuntimeOrigin::signed(acc(2)), 0));
        System::assert_last_event(RuntimeEvent::Treasury(Event::StreamClaimed {
            id: 0,
            recipient: acc(2),
            amount: 150_000 * USDC,
        }));
        // Cancel reverts the undisbursed remainder to MAIN.
        assert_ok!(Treasury::cancel_stream(to(), 0));
        assert_noop!(
            Treasury::claim_stream(RuntimeOrigin::signed(acc(2)), 0),
            Error::<Test>::AlreadyCancelled
        );
    });
}

// ---- issuance meter (08 §2.3) -----------------------------------------------

#[test]
fn issuance_is_line_scoped_and_capped_at_two_percent() {
    // limit-coverage: iss.inflation
    funded_ext().execute_with(|| {
        assert_noop!(
            Treasury::issue_vit(to(), 1, BudgetLine::Pol),
            Error::<Test>::IssuanceLineNotAllowed
        );
        let cap = 20_000_000 * VIT; // 2% of 1e9 VIT
        assert_ok!(Treasury::issue_vit(to(), cap, BudgetLine::Rewards));
        assert_eq!(Treasury::vit_line_balance(BudgetLine::Rewards), cap);
        assert_noop!(
            Treasury::issue_vit(to(), 1, BudgetLine::Rewards),
            Error::<Test>::IssuanceCapExceeded
        );
        // Rolling window: at the 365-day seam the day-0 mint is STILL counted,
        // so a fresh full mint is refused (fixed-window doubling closed).
        System::set_block_number(u64::from(DAYS_365_BLOCKS));
        assert_noop!(
            Treasury::issue_vit(to(), 1, BudgetLine::OpsArweave),
            Error::<Test>::IssuanceCapExceeded
        );
        // One day later the day-0 mint has rolled off; capacity returns.
        System::set_block_number(u64::from(DAYS_365_BLOCKS) + u64::from(DAY_BLOCKS));
        assert_ok!(Treasury::issue_vit(to(), 1, BudgetLine::OpsArweave));
        assert_ok!(crate::Pallet::<Test>::do_try_state());
    });
}

// ---- coretime renewal (09 §4) -----------------------------------------------

#[test]
fn absent_keeper_rebate_param_is_a_structural_noop() {
    funded_ext().execute_with(|| {
        assert_ok!(Treasury::fund_budget_line(
            to(),
            BudgetLine::Keeper,
            100 * USDC
        ));
        System::reset_events();
        let before = Treasury::treasury();

        // The mock holds `keeper.rebate` at 0 to exercise the fail-soft
        // no-payout path; SQ-117 seeds a positive value in the runtime, but a
        // zero rebate must still be a safe no-op (no outflow, no payout event).
        assert_eq!(KeeperRebate::get(), 0);
        crate::Pallet::<Test>::do_keeper_rebate(&acc(7), CrankClass::DecisionCritical);

        assert_eq!(Treasury::treasury(), before);
        assert!(rebate_payouts().is_empty());
        assert!(System::events().is_empty());
    });
}

#[test]
fn keeper_and_oracle_rebates_pay_from_the_selected_lines() {
    funded_ext().execute_with(|| {
        assert_ok!(Treasury::fund_budget_line(
            to(),
            BudgetLine::Keeper,
            100 * USDC
        ));
        assert_ok!(Treasury::fund_budget_line(
            to(),
            BudgetLine::Oracle,
            100 * USDC
        ));
        KeeperBudgetEpoch::set(100 * USDC);
        KeeperRebate::set(10 * USDC);
        reset_rebate_payout();
        set_rebate_pot_balance(PayoutLine::Keeper, 100 * USDC);
        set_rebate_pot_balance(PayoutLine::Oracle, 100 * USDC);

        crate::Pallet::<Test>::do_keeper_rebate(&acc(7), CrankClass::General);
        let metered = Treasury::treasury().keeper_meter;
        assert_eq!(metered.spent, 10 * USDC);
        assert_eq!(metered.general_spent, 10 * USDC);

        crate::Pallet::<Test>::do_keeper_rebate(&acc(8), CrankClass::OracleLine);
        assert_eq!(Treasury::treasury().keeper_meter, metered);
        assert_eq!(
            rebate_payouts(),
            vec![
                (acc(7), 10 * USDC, PayoutLine::Keeper),
                (acc(8), 10 * USDC, PayoutLine::Oracle),
            ]
        );
        assert_ok!(crate::Pallet::<Test>::do_try_state());
    });
}

#[test]
fn proposer_reward_pays_from_the_rewards_line_and_is_fail_soft() {
    funded_ext().execute_with(|| {
        assert_ok!(Treasury::fund_budget_line(
            to(),
            BudgetLine::Rewards,
            100 * USDC
        ));
        reset_rebate_payout();
        set_rebate_pot_balance(PayoutLine::Rewards, 100 * USDC);
        let before_line = Treasury::treasury().line_balance(BudgetLine::Rewards);

        assert!(crate::Pallet::<Test>::do_proposer_reward(
            &acc(11),
            25 * USDC
        ));
        assert_eq!(
            Treasury::treasury().line_balance(BudgetLine::Rewards),
            before_line - 25 * USDC
        );
        assert_eq!(
            rebate_payouts(),
            vec![(acc(11), 25 * USDC, PayoutLine::Rewards)]
        );

        set_rebate_pot_balance(PayoutLine::Rewards, 0);
        let before = Treasury::treasury();
        assert!(!crate::Pallet::<Test>::do_proposer_reward(
            &acc(11),
            25 * USDC
        ));
        assert_eq!(Treasury::treasury(), before);
    });
}

#[test]
fn note_collator_block_registers_mandatory_block_weight() {
    funded_ext().execute_with(|| {
        // `pallet_authorship` drives this callback from `on_initialize` with
        // no reserved weight, so the callback must register its own
        // benchmarked worst-case weight into the Mandatory class.
        let before = frame_system::Pallet::<Test>::block_weight()
            .get(frame_support::dispatch::DispatchClass::Mandatory)
            .to_owned();
        Treasury::note_collator_block(acc(7));
        let after = frame_system::Pallet::<Test>::block_weight()
            .get(frame_support::dispatch::DispatchClass::Mandatory)
            .to_owned();
        assert_eq!(
            after,
            before.saturating_add(
                <<Test as crate::Config>::WeightInfo as crate::WeightInfo>::note_collator_block()
            )
        );
    });
}

#[test]
fn collator_compensation_pays_authored_shares_once_and_rounds_down() {
    funded_ext().execute_with(|| {
        reset_rebate_payout();
        Treasury::note_collator_block(acc(7));
        Treasury::note_collator_block(acc(7));
        Treasury::note_collator_block(acc(8));
        let before = Treasury::line_balance(BudgetLine::OpsCollators);

        // Housekeeping pays the completed epoch; keep the current epoch open
        // so authorship after the boundary is not discarded.
        set_epoch(1);
        Treasury::pay_collator_compensation();

        assert_eq!(
            rebate_payouts(),
            vec![
                (acc(7), 2_666_666_666, PayoutLine::OpsCollators),
                (acc(8), 1_333_333_333, PayoutLine::OpsCollators),
            ]
        );
        assert_eq!(
            Treasury::line_balance(BudgetLine::OpsCollators),
            before - 3_999_999_999
        );
        assert!(CollatorAuthoredBlocks::<Test>::get().is_empty());
        assert!(CollatorAuthoredEpoch::<Test>::get().is_none());

        // A block after the payout boundary belongs to the next pending
        // accumulator and must not be dropped just because the prior epoch
        // was already paid.
        Treasury::note_collator_block(acc(9));
        Treasury::pay_collator_compensation();
        assert_eq!(rebate_payouts().len(), 2);
        assert_eq!(CollatorAuthoredBlocks::<Test>::get().len(), 1);

        set_epoch(2);
        Treasury::pay_collator_compensation();
        assert_eq!(rebate_payouts().len(), 3);
        assert!(CollatorAuthoredBlocks::<Test>::get().is_empty());
        assert_ok!(Treasury::do_try_state());
    });
}

#[test]
fn collator_compensation_defers_when_custody_is_underfunded() {
    funded_ext().execute_with(|| {
        reset_rebate_payout();
        set_rebate_pot_balance(PayoutLine::OpsCollators, 0);
        Treasury::note_collator_block(acc(7));
        let before = Treasury::treasury();

        set_epoch(1);
        Treasury::pay_collator_compensation();

        assert_eq!(Treasury::treasury(), before);
        assert_eq!(CollatorAuthoredBlocks::<Test>::get().len(), 1);
        assert_eq!(CollatorAuthoredEpoch::<Test>::get(), Some(0));
        assert_eq!(
            rebate_payouts(),
            vec![(acc(7), 4_000_000_000, PayoutLine::OpsCollators)]
        );
    });
}

#[test]
fn collator_compensation_keeps_dropped_epoch_taint_scoped_until_discard() {
    funded_ext().execute_with(|| {
        reset_rebate_payout();
        set_rebate_pot_balance(PayoutLine::OpsCollators, 0);

        // Epoch 0 is moved into the bounded pending slot by the first block
        // observed in epoch 1. Its payout then remains deferred because the
        // custody pot is empty.
        set_epoch(0);
        Treasury::note_collator_block(acc(7));
        set_epoch(1);
        Treasury::note_collator_block(acc(8));
        Treasury::pay_collator_compensation();
        assert_eq!(CollatorPendingEpoch::<Test>::get(), Some(0));
        assert_eq!(rebate_payouts().len(), 1);
        // The mock records attempted transfers before checking custody; clear
        // that failed attempt so the assertions below count successful payout
        // calls only. This leaves the collator pot unchanged.
        reset_rebate_payout();

        // The first block in epoch 2 would require a third accumulator while
        // epoch 0 is still pending. It is dropped into an epoch-precise
        // marker; the complete epoch-1 accumulator remains payable.
        set_epoch(2);
        Treasury::note_collator_block(acc(9));
        assert_eq!(CollatorDroppedEpoch::<Test>::get(), Some(2));
        assert!(!CollatorAuthoredOverflowed::<Test>::get());
        assert!(!CollatorPendingOverflowed::<Test>::get());
        assert_eq!(CollatorAuthoredEpoch::<Test>::get(), Some(1));

        // Restored custody lets Housekeeping settle epoch 0 exactly once.
        // Neither the dropped-epoch marker nor the current epoch's taint is
        // cleared as a side effect of paying the pending slot.
        set_rebate_pot_balance(PayoutLine::OpsCollators, 4_000 * USDC);
        Treasury::pay_collator_compensation();
        assert_eq!(
            rebate_payouts(),
            vec![(acc(7), 4_000 * USDC, PayoutLine::OpsCollators)]
        );
        assert!(CollatorPendingEpoch::<Test>::get().is_none());
        assert_eq!(CollatorDroppedEpoch::<Test>::get(), Some(2));
        assert!(!CollatorAuthoredOverflowed::<Test>::get());
        assert_eq!(CollatorAuthoredEpoch::<Test>::get(), Some(1));

        // The first retained epoch-2 block can now open a fresh current
        // accumulator. The epoch-1 accumulator moves aside and epoch 2 is
        // marked tainted because its earlier block was dropped.
        Treasury::note_collator_block(acc(10));
        assert_eq!(CollatorPendingEpoch::<Test>::get(), Some(1));
        assert_eq!(CollatorAuthoredEpoch::<Test>::get(), Some(2));
        assert!(CollatorAuthoredOverflowed::<Test>::get());
        assert!(!CollatorPendingOverflowed::<Test>::get());
        assert!(CollatorDroppedEpoch::<Test>::get().is_none());

        // Epoch 1 pays normally; its cleanup must not clear epoch 2's taint.
        set_rebate_pot_balance(PayoutLine::OpsCollators, 4_000 * USDC);
        Treasury::pay_collator_compensation();
        assert_eq!(
            rebate_payouts(),
            vec![
                (acc(7), 4_000 * USDC, PayoutLine::OpsCollators),
                (acc(8), 4_000 * USDC, PayoutLine::OpsCollators),
            ]
        );
        assert!(CollatorAuthoredOverflowed::<Test>::get());
        assert_eq!(CollatorAuthoredEpoch::<Test>::get(), Some(2));

        // At epoch 3 the tainted epoch-2 accumulator is discarded, not paid,
        // and the latch records that epoch exactly once. Both slots are live
        // again for later epochs.
        set_epoch(3);
        Treasury::pay_collator_compensation();
        assert_eq!(
            rebate_payouts(),
            vec![
                (acc(7), 4_000 * USDC, PayoutLine::OpsCollators),
                (acc(8), 4_000 * USDC, PayoutLine::OpsCollators),
            ]
        );
        assert!(CollatorAuthoredEpoch::<Test>::get().is_none());
        assert!(CollatorAuthoredBlocks::<Test>::get().is_empty());
        assert!(CollatorPendingEpoch::<Test>::get().is_none());
        assert!(CollatorPendingBlocks::<Test>::get().is_empty());
        assert!(!CollatorAuthoredOverflowed::<Test>::get());
        assert!(!CollatorPendingOverflowed::<Test>::get());
        assert_eq!(CollatorCompensationPaidEpoch::<Test>::get(), Some(2));
        // Restore the mock's untouched custody backing for the line before
        // exercising the pallet-wide solvency check.
        set_rebate_pot_balance(
            PayoutLine::OpsCollators,
            Treasury::line_balance(BudgetLine::OpsCollators),
        );
        assert_ok!(Treasury::do_try_state());
    });
}

#[test]
fn collator_boundary_block_starts_a_separate_epoch_accumulator() {
    funded_ext().execute_with(|| {
        reset_rebate_payout();
        set_epoch(0);
        System::set_block_number(1);
        CollatorBoundaryBlockValue::set(10);
        Treasury::note_collator_block(acc(7));

        // The authorship callback observes the boundary before the clock
        // crank. The completed epoch is moved aside instead of being mixed
        // with the first block of the new epoch.
        System::set_block_number(10);
        Treasury::note_collator_block(acc(8));
        assert_eq!(CollatorPendingEpoch::<Test>::get(), Some(0));
        assert_eq!(CollatorAuthoredEpoch::<Test>::get(), Some(1));
        assert_eq!(
            CollatorAuthoredBlocks::<Test>::get().as_slice(),
            &[(acc(8), 1)]
        );

        set_epoch(1);
        Treasury::pay_collator_compensation();
        assert_eq!(rebate_payouts().len(), 1);
        assert_eq!(CollatorAuthoredEpoch::<Test>::get(), Some(1));

        CollatorBoundaryBlockValue::set(u32::MAX);
        set_epoch(2);
        Treasury::pay_collator_compensation();
        assert_eq!(rebate_payouts().len(), 2);
        assert!(CollatorPendingEpoch::<Test>::get().is_none());
        assert!(CollatorAuthoredEpoch::<Test>::get().is_none());
        assert_ok!(Treasury::do_try_state());
    });
}

#[test]
fn collator_compensation_uses_the_earning_epoch_registered_count_on_retry() {
    funded_ext().execute_with(|| {
        reset_rebate_payout();
        set_registered_collator_count(5);
        Treasury::note_collator_block(acc(7));
        set_registered_collator_count(12);

        set_epoch(1);
        Treasury::pay_collator_compensation();

        assert_eq!(
            rebate_payouts(),
            vec![(acc(7), 10_000 * USDC, PayoutLine::OpsCollators)]
        );
        assert!(CollatorAuthoredRegisteredCount::<Test>::get().is_none());
    });
}

#[test]
fn collator_compensation_fails_closed_on_accumulator_overflow() {
    funded_ext().execute_with(|| {
        for seed in 0..=MAX_COLLATOR_COMPENSATION_ENTRIES_BOUND {
            Treasury::note_collator_block(acc(seed as u8));
        }
        assert_eq!(
            CollatorAuthoredBlocks::<Test>::get().len(),
            MAX_COLLATOR_COMPENSATION_ENTRIES_BOUND as usize
        );
        assert!(CollatorAuthoredOverflowed::<Test>::get());

        set_epoch(1);
        Treasury::pay_collator_compensation();
        assert!(rebate_payouts().is_empty());
        assert!(CollatorAuthoredBlocks::<Test>::get().is_empty());
        assert!(CollatorAuthoredEpoch::<Test>::get().is_none());
        assert!(!CollatorAuthoredOverflowed::<Test>::get());
        assert_eq!(CollatorCompensationPaidEpoch::<Test>::get(), Some(0));

        // Discarding the tainted epoch does not wedge a later accumulator.
        Treasury::note_collator_block(acc(250));
        set_epoch(2);
        Treasury::pay_collator_compensation();
        assert_eq!(
            rebate_payouts(),
            vec![(acc(250), 4_000_000_000, PayoutLine::OpsCollators)]
        );
        assert!(CollatorAuthoredEpoch::<Test>::get().is_none());
        assert_ok!(Treasury::do_try_state());
    });
}

#[test]
fn payout_failure_drops_line_meter_and_events() {
    funded_ext().execute_with(|| {
        assert_ok!(Treasury::fund_budget_line(
            to(),
            BudgetLine::Keeper,
            100 * USDC
        ));
        KeeperBudgetEpoch::set(100 * USDC);
        KeeperRebate::set(80 * USDC);
        System::reset_events();
        reset_rebate_payout();
        set_rebate_pot_balance(PayoutLine::Keeper, 100 * USDC);
        set_rebate_payout_failure(true);
        let before = Treasury::treasury();

        crate::Pallet::<Test>::do_keeper_rebate(&acc(7), CrankClass::DecisionCritical);

        assert_eq!(Treasury::treasury(), before);
        assert_eq!(
            rebate_payouts(),
            vec![(acc(7), 80 * USDC, PayoutLine::Keeper)]
        );
        assert!(System::events().is_empty());
    });
}

#[test]
fn threshold_events_map_and_zero_pay_exhaustion_flag_persists_once() {
    // limit-coverage: keeper.budget
    funded_ext().execute_with(|| {
        assert_ok!(Treasury::fund_budget_line(
            to(),
            BudgetLine::Keeper,
            200 * USDC
        ));
        KeeperBudgetEpoch::set(100 * USDC);
        KeeperRebate::set(20 * USDC);
        System::reset_events();
        reset_rebate_payout();
        set_rebate_pot_balance(PayoutLine::Keeper, 200 * USDC);

        for _ in 0..4 {
            crate::Pallet::<Test>::do_keeper_rebate(&acc(7), CrankClass::DecisionCritical);
        }
        System::assert_last_event(RuntimeEvent::Treasury(Event::KeeperBudgetLow {
            remaining: 20 * USDC,
        }));
        crate::Pallet::<Test>::do_keeper_rebate(&acc(7), CrankClass::DecisionCritical);
        System::assert_last_event(RuntimeEvent::Treasury(Event::KeeperBudgetExhausted {
            epoch: 0,
            spent: 100 * USDC,
        }));
        let event_count = System::events().len();
        crate::Pallet::<Test>::do_keeper_rebate(&acc(7), CrankClass::DecisionCritical);
        assert_eq!(System::events().len(), event_count);
        assert_eq!(rebate_payouts().len(), 5);
    });
}

#[test]
fn shrunken_budget_alarms_low_then_exhausted_and_latches_rebates() {
    funded_ext().execute_with(|| {
        assert_ok!(Treasury::fund_budget_line(
            to(),
            BudgetLine::Keeper,
            100 * USDC
        ));
        KeeperBudgetEpoch::set(100 * USDC);
        KeeperRebate::set(20 * USDC);
        reset_rebate_payout();
        set_rebate_pot_balance(PayoutLine::Keeper, 100 * USDC);

        crate::Pallet::<Test>::do_keeper_rebate(&acc(7), CrankClass::DecisionCritical);
        System::reset_events();

        // A governance shrink makes already-spent capacity effectively
        // exhausted. The mandatory 80% alarm is emitted first.
        KeeperBudgetEpoch::set(10 * USDC);
        KeeperRebate::set(USDC);
        crate::Pallet::<Test>::do_keeper_rebate(&acc(7), CrankClass::DecisionCritical);
        assert_eq!(
            System::events()
                .into_iter()
                .map(|record| record.event)
                .collect::<Vec<_>>(),
            vec![
                RuntimeEvent::Treasury(Event::KeeperBudgetLow { remaining: 0 }),
                RuntimeEvent::Treasury(Event::KeeperBudgetExhausted {
                    epoch: 0,
                    spent: 20 * USDC,
                }),
            ]
        );

        // Restoring budget headroom and retaining the smaller rebate parameter
        // cannot reopen the meter after its per-epoch exhaustion latch fired.
        KeeperBudgetEpoch::set(100 * USDC);
        crate::Pallet::<Test>::do_keeper_rebate(&acc(7), CrankClass::DecisionCritical);
        assert_eq!(rebate_payouts().len(), 1);
        assert_eq!(Treasury::treasury().keeper_meter.spent, 20 * USDC);
        assert_ok!(crate::Pallet::<Test>::do_try_state());
    });
}

#[test]
fn successful_coretime_renewal_self_rebates_the_keeper_once() {
    funded_ext().execute_with(|| {
        assert_ok!(Treasury::fund_budget_line(
            to(),
            BudgetLine::Keeper,
            100 * USDC
        ));
        KeeperBudgetEpoch::set(100 * USDC);
        KeeperRebate::set(10 * USDC);
        reset_rebate_payout();
        set_rebate_pot_balance(PayoutLine::Keeper, 100 * USDC);
        assert_ok!(note_quote(77, 100_000 * USDC));

        assert_ok!(Treasury::execute_coretime_renewal(
            RuntimeOrigin::signed(acc(7)),
            77
        ));

        assert_eq!(
            rebate_payouts(),
            vec![(acc(7), 10 * USDC, PayoutLine::Keeper)]
        );
        assert_eq!(Treasury::treasury().keeper_meter.general_spent, 10 * USDC);
        assert_ok!(crate::Pallet::<Test>::do_try_state());
    });
}

mod renewal_dispatch_seam {
    use super::*;
    use crate as pallet_futarchy_treasury;
    use frame_support::{derive_impl, parameter_types};
    use sp_core::crypto::AccountId32;
    use sp_runtime::{traits::IdentityLookup, BuildStorage, DispatchError};
    use std::cell::{Cell, RefCell};

    type Block = frame_system::mocking::MockBlock<DispatchTest>;

    frame_support::construct_runtime!(
        pub enum DispatchTest {
            System: frame_system,
            Treasury: pallet_futarchy_treasury,
        }
    );

    #[derive_impl(frame_system::config_preludes::TestDefaultConfig)]
    impl frame_system::Config for DispatchTest {
        type Block = Block;
        type AccountId = AccountId32;
        type Lookup = IdentityLookup<AccountId32>;
    }

    pub struct DispatchParams;

    impl pallet_futarchy_treasury::TreasuryParams for DispatchParams {
        fn cap_proposal_bps() -> u32 {
            TRS_CAP_PROPOSAL_BPS
        }

        fn cap_30d_bps() -> u32 {
            futarchy_treasury_core::TRS_CAP_30D_BPS
        }

        fn cap_180d_bps() -> u32 {
            futarchy_treasury_core::TRS_CAP_180D_BPS
        }

        fn stream_threshold_bps() -> u32 {
            TRS_STREAM_THRESHOLD_BPS
        }

        fn inflation_cap_bps() -> u32 {
            futarchy_treasury_core::ISS_INFLATION_CAP_BPS
        }

        fn keeper_budget_epoch() -> u128 {
            futarchy_treasury_core::KEEPER_BUDGET_EPOCH
        }

        fn keeper_rebate() -> u128 {
            0
        }

        fn collator_comp_epoch() -> u128 {
            2_000 * USDC
        }

        fn coretime_dot_rate() -> u128 {
            10_000_000_000
        }

        fn reserve_probe_dot_rate() -> u128 {
            10_000_000_000
        }

        fn coretime_fee_dot() -> u128 {
            100
        }

        fn coretime_quote_ttl() -> u32 {
            100
        }
    }

    std::thread_local! {
        static DISPATCHED: RefCell<Vec<(u32, u128)>> = const { RefCell::new(Vec::new()) };
        static FAIL_DISPATCH: Cell<bool> = const { Cell::new(false) };
    }

    pub struct RecordingRenewalDispatch;

    impl pallet_futarchy_treasury::RenewalDispatch for RecordingRenewalDispatch {
        fn dispatch_renewal(
            period_index: u32,
            amount: u128,
        ) -> frame_support::dispatch::DispatchResult {
            DISPATCHED.with(|calls| calls.borrow_mut().push((period_index, amount)));
            if FAIL_DISPATCH.with(Cell::get) {
                Err(DispatchError::Other("renewal dispatch failed"))
            } else {
                Ok(())
            }
        }
    }

    parameter_types! {
        pub const CurrentEpoch: u32 = 0;
        pub DispatchCommunityPot: AccountId32 = AccountId32::new([77u8; 32]);
        pub const DispatchCommunityAmount: u128 = 250_000_000 * VIT;
        pub const DispatchCommunityDuration: u64 = 100;
        pub const DispatchCommunityMin: u128 = VIT;
        pub const DispatchMaxCommunitySchedules: u32 = 4_096;
        pub const DispatchMaxCollatorCompensationEntries: u32 = 120;
        pub DispatchIncentivePot: AccountId32 = AccountId32::new([78u8; 32]);
        pub const DispatchIncentiveAllocationAmount: u128 = 100_000_000 * VIT;
    }

    impl pallet_futarchy_treasury::Config for DispatchTest {
        type TreasuryOrigin = frame_system::EnsureRoot<AccountId32>;
        type CommunityDistributionOrigin = frame_system::EnsureRoot<AccountId32>;
        type CommunityVesting = ();
        type CommunityPot = DispatchCommunityPot;
        type CommunityDistributionAmount = DispatchCommunityAmount;
        type CommunityVestingDuration = DispatchCommunityDuration;
        type CommunityMinVestedTransfer = DispatchCommunityMin;
        type MaxCommunitySchedules = DispatchMaxCommunitySchedules;
        // This harness exercises the coretime-renewal dispatch path only, so
        // the trading-reward funding seam keeps the production fail-closed
        // unit default, exactly as `CommunityVesting`/`InsuranceSweep`/
        // `PotFunding` do above.
        type TradingRewardOrigin = frame_system::EnsureRoot<AccountId32>;
        type TradingRewardFunding = ();
        type IncentivePot = DispatchIncentivePot;
        type IncentiveAllocationAmount = DispatchIncentiveAllocationAmount;
        type MaxCollatorCompensationEntries = DispatchMaxCollatorCompensationEntries;
        type RegisteredCollatorCount = ConstU32<1>;
        type CollatorEpoch = TestCollatorEpoch;
        type Params = DispatchParams;
        type CurrentEpoch = CurrentEpoch;
        type TreasuryPhase = ();
        type BootstrapOpsFundingPolicy = ();
        type RenewalDispatch = RecordingRenewalDispatch;
        type RebatePayout = ();
        type PotFunding = ();
        type InsuranceSweep = ();
        // This harness exercises the coretime-renewal dispatch path only; the
        // unit seam keeps the production fail-closed answer (AUD-NUM-001).
        type OutflowCustody = ();
        type Integrity = ();
        type WeightInfo = ();
        #[cfg(feature = "runtime-benchmarks")]
        type BenchmarkHelper = DispatchBenchmarkHelper;
    }

    #[cfg(feature = "runtime-benchmarks")]
    pub struct DispatchBenchmarkHelper;

    #[cfg(feature = "runtime-benchmarks")]
    impl pallet_futarchy_treasury::BenchmarkHelper<RuntimeOrigin, AccountId32>
        for DispatchBenchmarkHelper
    {
        fn treasury_origin() -> RuntimeOrigin {
            RuntimeOrigin::root()
        }

        fn community_origin() -> RuntimeOrigin {
            RuntimeOrigin::root()
        }

        fn account(seed: u8) -> AccountId32 {
            AccountId32::new([seed; 32])
        }
    }

    fn new_ext() -> sp_io::TestExternalities {
        let storage = RuntimeGenesisConfig {
            system: Default::default(),
            treasury: pallet_futarchy_treasury::GenesisConfig {
                main_usdc: MAIN0,
                coretime_quote_authority: Some(AccountId32::new([42; 32])),
                coretime_renewal_account: Some([44; 32]),
                ..Default::default()
            },
        }
        .build_storage()
        .expect("renewal-dispatch test genesis must build");
        let mut ext = sp_io::TestExternalities::new(storage);
        ext.execute_with(|| {
            System::set_block_number(1);
            assert_ok!(Treasury::fund_budget_line(
                RuntimeOrigin::root(),
                BudgetLine::OpsCoretime,
                1_000_000 * USDC,
            ));
            DISPATCHED.with(|calls| calls.borrow_mut().clear());
            FAIL_DISPATCH.with(|fail| fail.set(false));
        });
        ext
    }

    #[test]
    fn renewal_dispatch_receives_the_committed_period_and_quote() {
        new_ext().execute_with(|| {
            let price = 100_000 * USDC;
            assert_ok!(Treasury::note_coretime_quote(
                RuntimeOrigin::signed(AccountId32::new([42; 32])),
                42,
                price,
            ));

            assert_ok!(Treasury::execute_coretime_renewal(
                RuntimeOrigin::signed(AccountId32::new([7; 32])),
                42,
            ));

            DISPATCHED.with(|calls| assert_eq!(&*calls.borrow(), &[(42, price)]));
            let state = Treasury::treasury();
            assert!(state.funded_coretime_periods.contains(&42));
            assert!(!state
                .coretime_quotes
                .iter()
                .any(|quote| quote.period_index == 42));
        });
    }

    #[test]
    fn renewal_dispatch_error_rolls_back_accounting_for_retry() {
        new_ext().execute_with(|| {
            let price = 100_000 * USDC;
            assert_ok!(Treasury::note_coretime_quote(
                RuntimeOrigin::signed(AccountId32::new([42; 32])),
                42,
                price,
            ));
            let line_before = Treasury::line_balance(BudgetLine::OpsCoretime);
            System::reset_events();
            FAIL_DISPATCH.with(|fail| fail.set(true));

            assert_err!(
                Treasury::execute_coretime_renewal(
                    RuntimeOrigin::signed(AccountId32::new([7; 32])),
                    42,
                ),
                DispatchError::Other("renewal dispatch failed")
            );

            DISPATCHED.with(|calls| assert_eq!(&*calls.borrow(), &[(42, price)]));
            let state = Treasury::treasury();
            assert_eq!(Treasury::line_balance(BudgetLine::OpsCoretime), line_before);
            assert!(state.coretime_quotes.iter().any(|quote| {
                quote.period_index == 42 && quote.price == price && quote.noted_at == 1
            }));
            assert!(!state.funded_coretime_periods.contains(&42));
            assert!(!System::events().iter().any(|record| {
                matches!(
                    record.event,
                    RuntimeEvent::Treasury(Event::CoretimeRenewalCalled { .. })
                )
            }));
        });
    }
}

#[test]
fn coretime_renewal_is_permissionless_quote_priced_and_idempotent() {
    funded_ext().execute_with(|| {
        // No quote ⇒ window closed.
        assert_noop!(
            Treasury::execute_coretime_renewal(RuntimeOrigin::signed(acc(7)), 42),
            Error::<Test>::RenewalWindowClosed
        );
        // The XCM dispatcher receives the authority-noted DOT quote, while the
        // USDC budget line pays ceil((quote + fee) * rate / 1 DOT).
        let price = 100_000 * USDC;
        assert_ok!(note_quote(42, price));
        let before = Treasury::line_balance(BudgetLine::OpsCoretime);
        assert_ok!(Treasury::execute_coretime_renewal(
            RuntimeOrigin::signed(acc(7)),
            42
        ));
        assert_eq!(
            Treasury::line_balance(BudgetLine::OpsCoretime),
            before - price - CoretimeFeeDot::get()
        );
        System::assert_last_event(RuntimeEvent::Treasury(Event::CoretimeRenewalCalled {
            line: BudgetLine::OpsCoretime,
            amount: price + CoretimeFeeDot::get(),
        }));
        // Idempotent per period, even against a re-noted quote.
        assert_noop!(note_quote(42, 1), Error::<Test>::PeriodAlreadyFunded);
        assert_noop!(
            Treasury::execute_coretime_renewal(RuntimeOrigin::signed(acc(8)), 42),
            Error::<Test>::PeriodAlreadyFunded
        );
        // Bounded by the pre-authorized line balance.
        assert_ok!(note_quote(43, 5_000_000 * USDC));
        assert_noop!(
            Treasury::execute_coretime_renewal(RuntimeOrigin::signed(acc(8)), 43),
            Error::<Test>::InsufficientFunds
        );
    });
}

#[test]
fn coretime_quote_authority_can_note_supersede_and_rotate() {
    funded_ext().execute_with(|| {
        assert_noop!(
            Treasury::note_coretime_quote(RuntimeOrigin::signed(acc(7)), 50, 10),
            Error::<Test>::NotQuoteAuthority
        );
        assert_noop!(note_quote(50, 0), Error::<Test>::ZeroQuote);
        assert_ok!(note_quote(50, 10));
        System::set_block_number(9);
        assert_ok!(note_quote(50, 20));
        let quotes = Treasury::treasury().coretime_quotes;
        assert_eq!(quotes.len(), 1);
        assert_eq!(quotes[0].period_index, 50);
        assert_eq!(quotes[0].price, 20);
        assert_eq!(quotes[0].noted_at, 9);

        assert_noop!(
            Treasury::set_coretime_authority(RuntimeOrigin::root(), acc(8), [8; 32]),
            sp_runtime::DispatchError::BadOrigin
        );
        assert_ok!(Treasury::set_coretime_authority(to(), acc(8), [8; 32]));
        assert_eq!(crate::CoretimeQuoteAuthority::<Test>::get(), Some(acc(8)));
        assert_eq!(crate::CoretimeRenewalAccount::<Test>::get(), Some([8; 32]));
        assert_noop!(note_quote(51, 10), Error::<Test>::NotQuoteAuthority);
        assert_ok!(Treasury::note_coretime_quote(
            RuntimeOrigin::signed(acc(8)),
            51,
            10,
        ));
        crate::CoretimeQuoteAuthority::<Test>::kill();
        let before = Treasury::treasury();
        assert_noop!(
            Treasury::note_coretime_quote(RuntimeOrigin::signed(acc(8)), 52, 10),
            Error::<Test>::NotQuoteAuthority
        );
        assert_eq!(Treasury::treasury(), before);
    });
}

#[test]
fn coretime_prune_enforces_strict_ttl_but_authority_may_prune_early() {
    funded_ext().execute_with(|| {
        assert_ok!(Treasury::fund_budget_line(
            to(),
            BudgetLine::Keeper,
            100 * USDC
        ));
        KeeperBudgetEpoch::set(100 * USDC);
        KeeperRebate::set(10 * USDC);
        reset_rebate_payout();
        set_rebate_pot_balance(PayoutLine::Keeper, 100 * USDC);

        assert_ok!(note_quote(50, 10));
        System::set_block_number(101); // age == ttl is still fresh.
        assert_noop!(
            Treasury::prune_coretime_quote(RuntimeOrigin::signed(acc(7)), 50),
            Error::<Test>::QuoteNotExpired
        );
        System::set_block_number(102); // permissionless only when age > ttl.
        assert_ok!(Treasury::prune_coretime_quote(
            RuntimeOrigin::signed(acc(7)),
            50
        ));
        assert_eq!(
            rebate_payouts(),
            vec![(acc(7), 10 * USDC, PayoutLine::Keeper)]
        );
        assert_eq!(Treasury::treasury().keeper_meter.general_spent, 10 * USDC);
        assert_noop!(
            Treasury::execute_coretime_renewal(RuntimeOrigin::signed(acc(7)), 50),
            Error::<Test>::RenewalWindowClosed
        );

        System::set_block_number(103);
        assert_ok!(note_quote(51, 10));
        assert_ok!(Treasury::prune_coretime_quote(
            RuntimeOrigin::signed(coretime_quote_authority()),
            51,
        ));
        assert_eq!(
            rebate_payouts(),
            vec![(acc(7), 10 * USDC, PayoutLine::Keeper)],
            "the quote authority's anytime prune is not keeper-cranked"
        );
        assert_eq!(Treasury::treasury().keeper_meter.general_spent, 10 * USDC);

        assert_ok!(note_quote(52, 10));
        CoretimeQuoteTtl::set(0);
        assert_noop!(
            Treasury::prune_coretime_quote(RuntimeOrigin::signed(acc(7)), 52),
            Error::<Test>::QuoteTtlUnset
        );
        assert_ok!(Treasury::prune_coretime_quote(
            RuntimeOrigin::signed(coretime_quote_authority()),
            52,
        ));
        assert_eq!(
            rebate_payouts(),
            vec![(acc(7), 10 * USDC, PayoutLine::Keeper)]
        );
    });
}

#[test]
fn coretime_execute_uses_live_params_ceil_and_freshness_without_migration() {
    funded_ext().execute_with(|| {
        let line_before = Treasury::line_balance(BudgetLine::OpsCoretime);
        assert_ok!(note_quote(60, 1));
        let quote_before = Treasury::treasury().coretime_quotes[0];

        // Change both live Params after the quote was stored. No storage
        // migration rewrites the quote; execution consumes the new values.
        CoretimeDotRate::set(5_000_000);
        CoretimeFeeDot::set(100);
        assert_eq!(Treasury::treasury().coretime_quotes[0], quote_before);
        System::set_block_number(101); // age == ttl remains executable.
        assert_ok!(Treasury::execute_coretime_renewal(
            RuntimeOrigin::signed(acc(7)),
            60,
        ));
        // ceil(101 * 5_000_000 / 10_000_000_000) == 1 USDC planck.
        assert_eq!(
            Treasury::line_balance(BudgetLine::OpsCoretime),
            line_before - 1
        );

        System::set_block_number(102);
        assert_ok!(note_quote(61, 1));
        // Move past the new quote's TTL and prove the rejection is fail-static.
        System::set_block_number(203);
        let before = Treasury::treasury();
        assert_noop!(
            Treasury::execute_coretime_renewal(RuntimeOrigin::signed(acc(7)), 61),
            Error::<Test>::QuoteExpired
        );
        assert_eq!(Treasury::treasury(), before);
    });
}

#[test]
fn coretime_execute_without_destination_is_typed_and_fail_static() {
    funded_ext().execute_with(|| {
        assert_ok!(note_quote(61, 1_000));
        let before = Treasury::treasury();
        crate::CoretimeRenewalAccount::<Test>::kill();

        assert_noop!(
            Treasury::execute_coretime_renewal(RuntimeOrigin::signed(acc(7)), 61),
            Error::<Test>::RenewalAccountUnset
        );
        assert_eq!(Treasury::treasury(), before);
    });
}

#[test]
fn coretime_execute_fails_static_on_unset_params_and_future_timestamp() {
    funded_ext().execute_with(|| {
        assert_ok!(note_quote(70, 10));
        let before = Treasury::treasury();
        CoretimeDotRate::set(0);
        assert_noop!(
            Treasury::execute_coretime_renewal(RuntimeOrigin::signed(acc(7)), 70),
            Error::<Test>::RateUnset
        );
        assert_eq!(Treasury::treasury(), before);

        CoretimeDotRate::set(10_000_000_000);
        CoretimeFeeDot::set(0);
        assert_noop!(
            Treasury::execute_coretime_renewal(RuntimeOrigin::signed(acc(7)), 70),
            Error::<Test>::FeeBudgetUnset
        );
        assert_eq!(Treasury::treasury(), before);

        CoretimeFeeDot::set(100);
        CoretimeQuoteTtl::set(0);
        assert_noop!(
            Treasury::execute_coretime_renewal(RuntimeOrigin::signed(acc(7)), 70),
            Error::<Test>::QuoteTtlUnset
        );
        assert_eq!(Treasury::treasury(), before);

        CoretimeQuoteTtl::set(100);
        let mut future = before.clone();
        future.coretime_quotes[0].noted_at = 2;
        crate::Pallet::<Test>::seed(&future);
        System::set_block_number(1);
        assert_noop!(
            Treasury::execute_coretime_renewal(RuntimeOrigin::signed(acc(7)), 70),
            Error::<Test>::QuoteTimestampInFuture
        );
        assert_eq!(Treasury::treasury(), future);
    });
}

#[test]
fn coretime_obligation_pair_enforces_open_quote_and_funded_history_bounds() {
    funded_ext().execute_with(|| {
        // First prove the funded-period history remains a rolling bound.
        for period in 0..=futarchy_treasury_core::MAX_FUNDED_CORETIME_PERIODS as u32 {
            assert_ok!(note_quote(period, 1));
            assert_ok!(Treasury::execute_coretime_renewal(
                RuntimeOrigin::signed(acc(7)),
                period,
            ));
        }
        let funded = crate::Pallet::<Test>::treasury().funded_coretime_periods;
        assert_eq!(
            funded.len(),
            futarchy_treasury_core::MAX_FUNDED_CORETIME_PERIODS
        );
        assert!(!funded.contains(&0));
        assert!(funded.contains(&(futarchy_treasury_core::MAX_FUNDED_CORETIME_PERIODS as u32)));

        let first_open = 100_u32;
        for offset in 0..futarchy_treasury_core::MAX_FUNDED_CORETIME_PERIODS as u32 {
            assert_ok!(note_quote(first_open.saturating_add(offset), 1));
        }
        // limit-coverage: Treasury coretime obligations
        assert_noop!(
            Treasury::note_coretime_quote(
                RuntimeOrigin::signed(coretime_quote_authority()),
                first_open
                    .saturating_add(futarchy_treasury_core::MAX_FUNDED_CORETIME_PERIODS as u32),
                1,
            ),
            Error::<Test>::TooManyObligations
        );
    });
}

// ---- fund_budget_line atomicity (G-1) ---------------------------------------

#[test]
fn fund_budget_line_is_atomic_on_credit_overflow() {
    funded_ext().execute_with(|| {
        // A line balance near u128::MAX makes the credit overflow; MAIN must not
        // be debited when the credit fails (Codex review).
        let mut t = crate::Pallet::<Test>::treasury();
        t.lines.push((BudgetLine::Oracle, u128::MAX));
        crate::Pallet::<Test>::seed(&t);
        let main_before = crate::Pallet::<Test>::treasury().main_usdc;
        assert_noop!(
            Treasury::fund_budget_line(to(), BudgetLine::Oracle, 1),
            Error::<Test>::Overflow
        );
        assert_eq!(crate::Pallet::<Test>::treasury().main_usdc, main_before);
    });
}

// ---- recover_foreign (08 §1.3) ----------------------------------------------

#[test]
fn recover_foreign_refuses_protocol_assets() {
    funded_ext().execute_with(|| {
        assert_noop!(
            Treasury::recover_foreign(to(), AssetKind::Usdc, acc(1), 1),
            Error::<Test>::UnknownForeignAsset
        );
        assert_noop!(
            Treasury::recover_foreign(to(), AssetKind::Vit, acc(1), 1),
            Error::<Test>::UnknownForeignAsset
        );
        assert_ok!(Treasury::recover_foreign(
            to(),
            AssetKind::Foreign([9u8; 32]),
            acc(3),
            777
        ));
        System::assert_last_event(RuntimeEvent::Treasury(Event::ForeignRecovered {
            asset: AssetKind::Foreign([9u8; 32]),
            dest: acc(3),
            amount: 777,
        }));
    });
}

// ---- minimum-viable-NAV arming gate (08 §4.1/§4.2, loud) --------------------

#[test]
fn nav_floor_gate_is_loud() {
    use futarchy_primitives::ProposalClass;
    // Fund below the CODE floor (~13.9M) but above the gated PARAM floor (~4.62M).
    let mut ext = new_test_ext_with(crate::GenesisConfig::<Test> {
        main_usdc: 5_000_000 * USDC,
        ..Default::default()
    });
    ext.execute_with(|| {
        // Hard gate: above the PARAM floor ⇒ Ok (no event); below the CODE floor
        // ⇒ Err with NO event (a doomed event would roll back with the caller's
        // failed dispatch — Codex review).
        assert_ok!(crate::Pallet::<Test>::ensure_nav_floor(
            ProposalClass::Param
        ));
        assert_err!(
            crate::Pallet::<Test>::ensure_nav_floor(ProposalClass::Code),
            Error::<Test>::NavFloorUnmet
        );
        // Non-blocking diagnostic variant: below the floor ⇒ deposits the DURABLE
        // NavFloorUnmet (08 §4.2/§4.4 "reject as deferred") and returns true. This
        // is an Ok path, so the field-carrying event survives — unlike the hard
        // ensure_nav_floor Err above, which is the blocking arming path's loud
        // signal (SQ-381). flag_nav_floor has no production caller yet.
        assert!(crate::Pallet::<Test>::flag_nav_floor(ProposalClass::Code));
        System::assert_last_event(RuntimeEvent::Treasury(Event::NavFloorUnmet {
            class: ProposalClass::Code,
            nav: 5_000_000 * USDC,
            floor: CoreTreasury::floor(ProposalClass::Code),
        }));
        // Above the floor ⇒ returns false, no event.
        assert!(!crate::Pallet::<Test>::flag_nav_floor(ProposalClass::Param));
    });
}

// ---- rolling meters (08 §1.3, I-7) ------------------------------------------

#[test]
fn rolling_30d_meter_binds_spending() {
    // limit-coverage: trs.cap_30d, trs.cap_180d
    // NAV 25M ⇒ trailing-30d ceiling = 10% = 2.5M. Pre-load the meter to just
    // under it so a within-threshold, within-per-proposal-cap spend still trips.
    funded_ext().execute_with(|| {
        let mut t = crate::Pallet::<Test>::treasury();
        t.meter_30d.buckets[0] = 2_400_000 * USDC;
        crate::Pallet::<Test>::seed(&t);
        assert_noop!(
            Treasury::spend(to(), BudgetLine::OpsCollators, acc(1), 200_000 * USDC),
            Error::<Test>::MeterExhausted
        );
        // Within the remaining 100k headroom it is admitted (meter unchanged by
        // the rejected spend above — G-1).
        assert_ok!(Treasury::spend(
            to(),
            BudgetLine::OpsCollators,
            acc(1),
            50_000 * USDC
        ));
    });

    funded_ext().execute_with(|| {
        let mut t = crate::Pallet::<Test>::treasury();
        let nav = t.nav().nav;
        t.meter_180d.buckets[0] =
            nav * u128::from(futarchy_treasury_core::TRS_CAP_180D_BPS) / 10_000;
        crate::Pallet::<Test>::seed(&t);
        assert_noop!(
            Treasury::spend(to(), BudgetLine::OpsCollators, acc(1), USDC),
            Error::<Test>::MeterExhausted
        );
    });
}

// ---- rule 4: caps are read from Params, not hardcoded -----------------------

#[test]
fn caps_track_params_not_a_hardcode() {
    // limit-coverage: trs.cap_proposal
    funded_ext().execute_with(|| {
        // A 300k grant is a valid stream at defaults (> 1% NAV threshold, ≤ 5%
        // NAV cap). Tighten the per-proposal cap to 0.2% via Params ⇒ the same
        // 300k stream is refused, proving the cap is read, not hardcoded.
        CapProposalBps::set(20);
        assert_noop!(
            Treasury::open_stream(
                to(),
                BudgetLine::OpsCollators,
                acc(1),
                300_000 * USDC,
                0,
                100
            ),
            Error::<Test>::ProposalCapExceeded
        );
        CapProposalBps::set(TRS_CAP_PROPOSAL_BPS);
        assert_ok!(Treasury::open_stream(
            to(),
            BudgetLine::OpsCollators,
            acc(1),
            300_000 * USDC,
            0,
            100
        ));

        // Raise the stream threshold to 50% NAV ⇒ 300k now falls below it, so it
        // must be a spend, not a stream (the threshold is read from Params too).
        StreamThresholdBps::set(5_000);
        assert_noop!(
            Treasury::open_stream(
                to(),
                BudgetLine::OpsCollators,
                acc(1),
                300_000 * USDC,
                0,
                100
            ),
            Error::<Test>::StreamRequired
        );
        StreamThresholdBps::set(TRS_STREAM_THRESHOLD_BPS);

        // The issuance cap likewise tracks Params.
        InflationCapBps::set(0);
        assert_noop!(
            Treasury::issue_vit(to(), 1, BudgetLine::Rewards),
            Error::<Test>::IssuanceCapExceeded
        );
    });
}

// ---- storage bounds (13 §4) -------------------------------------------------

#[test]
fn stream_bound_is_enforced() {
    // limit-coverage: Treasury Streams
    funded_ext().execute_with(|| {
        // Seed the stream table to its 13 §4 bound.
        let mut t = crate::Pallet::<Test>::treasury();
        for i in 0..(MAX_STREAMS as u64) {
            t.streams.push(Stream {
                id: i,
                recipient: [1u8; 32],
                line: BudgetLine::Rewards,
                total: USDC,
                claimed: 0,
                start: 0,
                duration: 100,
                cancelled: false,
            });
        }
        t.next_stream_id = MAX_STREAMS as u64;
        crate::Pallet::<Test>::seed(&t);
        // Every seeded stream is live (non-terminal), so none can be reaped and
        // one more open is refused (concurrent bound reached).
        assert_noop!(
            Treasury::open_stream(
                to(),
                BudgetLine::OpsCollators,
                acc(2),
                300_000 * USDC,
                0,
                100
            ),
            Error::<Test>::TooManyStreams
        );
    });
}

#[test]
fn open_stream_reaps_a_terminal_stream_at_the_bound() {
    // The 13 §4 bound is on CONCURRENT open streams (08 §1.3): at the bound, a
    // terminal (cancelled or fully-claimed) stream is reaped to make room, so
    // the lifetime count is unbounded.
    funded_ext().execute_with(|| {
        let mut t = crate::Pallet::<Test>::treasury();
        for i in 0..(MAX_STREAMS as u64) {
            t.streams.push(Stream {
                id: i,
                recipient: [1u8; 32],
                // A line with no dedicated custody pot: the 08 §6.3 drift
                // alarm now measures `line + outstanding stream
                // obligations` against the pot, so hand-injected streams on
                // a pot-backed line would be seeding an inconsistent
                // fixture rather than testing the stream-table bound.
                line: BudgetLine::OpsCoretime,
                total: USDC,
                // Make exactly one stream terminal (fully claimed).
                claimed: if i == 3 { USDC } else { 0 },
                start: 0,
                duration: 100,
                cancelled: false,
            });
        }
        t.next_stream_id = MAX_STREAMS as u64;
        crate::Pallet::<Test>::seed(&t);
        // Reaps the fully-claimed stream (id 3) and opens the new one; the table
        // stays at the bound and try_state still holds.
        assert_ok!(Treasury::open_stream(
            to(),
            BudgetLine::OpsCoretime,
            acc(2),
            300_000 * USDC,
            0,
            100
        ));
        let after = crate::Pallet::<Test>::treasury();
        assert_eq!(after.streams.len(), MAX_STREAMS);
        assert!(!after.streams.iter().any(|s| s.id == 3));
        assert_ok!(crate::Pallet::<Test>::do_try_state());
    });
}

// ---- NAV obligations (08 §1.2) — B1a-wired sync entry points -----------------

#[test]
fn nav_nets_pol_and_pending_obligations() {
    funded_ext().execute_with(|| {
        assert_eq!(crate::Pallet::<Test>::nav().nav, MAIN0);
        // The POL/market and execution-guard sets NAV nets against (08 §1.2).
        assert_ok!(crate::Pallet::<Test>::set_pol_commitments(vec![
            1_000_000 * USDC,
            500_000 * USDC
        ]));
        assert_ok!(crate::Pallet::<Test>::set_pending_outflows(vec![
            250_000 * USDC
        ]));
        assert_eq!(crate::Pallet::<Test>::nav().nav, MAIN0 - 1_750_000 * USDC);
        // Bounded (13 §4): a POL set over MaxLiveMarkets is refused, no-op.
        assert_noop!(
            crate::Pallet::<Test>::set_pol_commitments(vec![
                1;
                futarchy_treasury_core::MAX_POL_COMMITMENTS
                    + 1
            ]),
            Error::<Test>::TooManyObligations
        );
        assert_noop!(
            crate::Pallet::<Test>::set_pending_outflows(vec![
                1;
                futarchy_treasury_core::MAX_PENDING_OUTFLOWS
                    + 1
            ]),
            Error::<Test>::TooManyObligations
        );
        assert_eq!(crate::Pallet::<Test>::nav().nav, MAIN0 - 1_750_000 * USDC);
    });
}

#[test]
fn pol_commitment_capacity_tracks_live_not_archive_retained_markets() {
    funded_ext().execute_with(|| {
        assert_eq!(
            futarchy_treasury_core::MAX_POL_COMMITMENTS,
            futarchy_primitives::bounds::MAX_LIVE_MARKETS as usize,
        );
        assert_eq!(futarchy_primitives::bounds::MAX_STORED_MARKETS, 2_240);

        let exact = vec![1; futarchy_treasury_core::MAX_POL_COMMITMENTS];
        assert_ok!(crate::Pallet::<Test>::set_pol_commitments(exact));
        assert_eq!(
            crate::Pallet::<Test>::treasury().pol_commitments.len(),
            futarchy_treasury_core::MAX_POL_COMMITMENTS,
        );
        assert_ok!(crate::Pallet::<Test>::do_try_state());

        let before = crate::State::<Test>::get();
        assert_noop!(
            crate::Pallet::<Test>::set_pol_commitments(vec![
                1;
                futarchy_treasury_core::MAX_POL_COMMITMENTS
                    + 1
            ]),
            Error::<Test>::TooManyObligations
        );
        assert_eq!(crate::State::<Test>::get(), before);
        assert_ok!(crate::Pallet::<Test>::do_try_state());
    });
}

#[test]
fn nav_moves_by_a_stream_exactly_once() {
    // 08 §1.2: opening a stream reduces NAV by the committed remainder EXACTLY
    // once (the open-time line debit; the escrow asset nets the obligation).
    // The differential shares `nav()` on both sides, so this guards the formula
    // directly against the historical 2× double-count.
    funded_ext().execute_with(|| {
        assert_eq!(crate::Pallet::<Test>::nav().nav, MAIN0);
        assert_ok!(Treasury::open_stream(
            to(),
            BudgetLine::OpsCollators,
            acc(2),
            300_000 * USDC,
            0,
            100
        ));
        // Open ⇒ NAV −remainder (once, not twice).
        assert_eq!(crate::Pallet::<Test>::nav().nav, MAIN0 - 300_000 * USDC);
        // Claim of the vested half ⇒ NAV neutral (paying what was already owed).
        System::set_block_number(50);
        assert_ok!(Treasury::claim_stream(RuntimeOrigin::signed(acc(2)), 0));
        assert_eq!(crate::Pallet::<Test>::nav().nav, MAIN0 - 300_000 * USDC);
        // Cancel ⇒ the undisbursed 150k reverts to MAIN, NAV +remainder.
        assert_ok!(Treasury::cancel_stream(to(), 0));
        assert_eq!(crate::Pallet::<Test>::nav().nav, MAIN0 - 150_000 * USDC);
    });
}

// ---- extra error paths (15 §4.1) --------------------------------------------

#[test]
fn error_paths_bad_duration_and_stream_not_claimable() {
    funded_ext().execute_with(|| {
        // Zero-duration stream is rejected.
        assert_noop!(
            Treasury::open_stream(to(), BudgetLine::OpsCollators, acc(2), 300_000 * USDC, 0, 0),
            Error::<Test>::BadDuration
        );
        // A stream claimed before any vesting (now ≤ start) has nothing claimable.
        assert_ok!(Treasury::open_stream(
            to(),
            BudgetLine::OpsCollators,
            acc(2),
            300_000 * USDC,
            100,
            100
        ));
        System::set_block_number(50); // before start (100)
        assert_noop!(
            Treasury::claim_stream(RuntimeOrigin::signed(acc(2)), 0),
            Error::<Test>::StreamNotClaimable
        );
        // Cancelled stream cannot be cancelled again.
        assert_ok!(Treasury::cancel_stream(to(), 0));
        assert_noop!(
            Treasury::cancel_stream(to(), 0),
            Error::<Test>::AlreadyCancelled
        );
        // A missing stream errors on lookup, not state.
        assert_noop!(
            Treasury::cancel_stream(to(), 999),
            Error::<Test>::StreamNotFound
        );
    });
}

// ---- try_state (15 §1) ------------------------------------------------------

#[test]
fn try_state_reconciles_rebate_lines_against_real_custody_pots() {
    funded_ext().execute_with(|| {
        assert_ok!(Treasury::fund_budget_line(
            to(),
            BudgetLine::Keeper,
            50 * USDC
        ));
        assert_ok!(Treasury::fund_budget_line(
            to(),
            BudgetLine::Oracle,
            30 * USDC
        ));
        // The funding seam keeps the internal lines and the real custody pots
        // synchronized atomically (08 §1.4).
        assert_eq!(KeeperRebatePotBalance::get(), 50 * USDC);
        assert_eq!(OracleRebatePotBalance::get(), 30 * USDC);
        assert_ok!(crate::Pallet::<Test>::do_try_state());

        // Direct transfers, recovery, or genesis mistakes can still create
        // drift; the standing alarm remains the backstop for those sources.
        set_rebate_pot_balance(PayoutLine::Keeper, 49 * USDC);
        assert!(matches!(
            crate::Pallet::<Test>::do_try_state(),
            Err(sp_runtime::TryRuntimeError::Other(
                "treasury: KEEPER line exceeds real USDC custody pot"
            ))
        ));

        set_rebate_pot_balance(PayoutLine::Keeper, 50 * USDC);
        set_rebate_pot_balance(PayoutLine::Oracle, 29 * USDC);
        assert!(matches!(
            crate::Pallet::<Test>::do_try_state(),
            Err(sp_runtime::TryRuntimeError::Other(
                "treasury: ORACLE line exceeds real USDC custody pot"
            ))
        ));

        set_rebate_pot_balance(PayoutLine::Oracle, 30 * USDC);
        assert_ok!(crate::Pallet::<Test>::do_try_state());
    });
}

#[test]
fn try_state_requires_v2_and_allows_armed_open_handover() {
    new_test_ext().execute_with(|| {
        TreasuryArmedValue::set(true);
        crate::BootstrapOpsFundingClosed::<Test>::put(false);
        assert_ok!(Treasury::do_try_state());

        StorageVersion::new(0).put::<Treasury>();
        assert!(Treasury::do_try_state().is_err());
        StorageVersion::new(4).put::<Treasury>();
        assert_ok!(Treasury::do_try_state());
    });
}

#[test]
fn try_state_holds_after_ops_and_catches_a_broken_stream() {
    funded_ext().execute_with(|| {
        assert_ok!(Treasury::open_stream(
            to(),
            BudgetLine::OpsCollators,
            acc(2),
            300_000 * USDC,
            0,
            100
        ));
        assert_ok!(crate::Pallet::<Test>::do_try_state());

        // Corrupt the keeper meter's tranche relation and confirm its standing
        // invariant is enforced independently of the mutable live budget.
        let mut t = crate::Pallet::<Test>::treasury();
        t.keeper_meter.spent = 1;
        t.keeper_meter.general_spent = 2;
        crate::Pallet::<Test>::seed(&t);
        assert!(crate::Pallet::<Test>::do_try_state().is_err());
        t.keeper_meter.general_spent = 1;
        crate::Pallet::<Test>::seed(&t);
        assert_ok!(crate::Pallet::<Test>::do_try_state());

        // Corrupt a stream (claimed > total) and confirm try_state rejects it.
        let mut t = crate::Pallet::<Test>::treasury();
        t.streams.push(Stream {
            id: 999,
            recipient: [1u8; 32],
            line: BudgetLine::Rewards,
            total: 1,
            claimed: 2,
            start: 0,
            duration: 1,
            cancelled: false,
        });
        crate::Pallet::<Test>::seed(&t);
        assert!(crate::Pallet::<Test>::do_try_state().is_err());
    });
}

// ---- shell ≡ core differential ---------------------------------------------

/// Deterministic xorshift so the sequence is reproducible with no wall-clock /
/// RNG dependency (rule 2).
fn next_rand(state: &mut u32) -> u32 {
    let mut x = *state;
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    *state = x;
    x
}

/// Every op the pallet exposes, applied in lock-step to the FRAME shell (via
/// extrinsics) and a standalone core `Treasury` seeded to the identical initial
/// state, asserting equal acceptance and — after clearing the core's transient
/// event log — byte-identical final aggregates. This is the Python-M3 ≡ Rust
/// differential's Rust half at default parameters.
#[test]
fn shell_matches_core_over_a_randomized_op_stream() {
    use origins_core::Origin as CoreOrigin;
    funded_ext().execute_with(|| {
        // Mirror the shell's post-genesis+funding state into a standalone core.
        let mut core = crate::Pallet::<Test>::treasury();
        let mut rng: u32 = 0x9e37_79b9;
        let lines = [
            BudgetLine::OpsCollators,
            BudgetLine::Rewards,
            BudgetLine::OpsCoretime,
            BudgetLine::Keeper,
        ];

        for step in 0..600u32 {
            System::set_block_number((step as u64) * 7 + 1);
            let now = (step * 7 + 1) as futarchy_primitives::BlockNumber;
            let r = next_rand(&mut rng);
            let line = lines[(r % 4) as usize];
            let amount = ((r >> 4) % 400_000) as u128 * USDC;
            let id = ((r >> 8) as u64) % (core.next_stream_id + 2);

            let shell_res: frame_support::pallet_prelude::DispatchResult = match r % 8 {
                0 => Treasury::fund_budget_line(to(), line, amount / 4),
                1 => Treasury::spend(to(), line, acc((r % 5) as u8), amount),
                2 => Treasury::open_stream(to(), line, acc((r % 5) as u8), amount, now.into(), 100),
                3 => Treasury::claim_stream(RuntimeOrigin::signed(acc((r % 5) as u8)), id),
                4 => Treasury::cancel_stream(to(), id),
                5 => Treasury::issue_vit(to(), amount * 1_000, BudgetLine::Rewards),
                6 => {
                    Treasury::execute_coretime_renewal(RuntimeOrigin::signed(acc(6)), (r >> 3) % 4)
                }
                _ => Treasury::recover_foreign(to(), AssetKind::Foreign([2u8; 32]), acc(1), amount),
            };

            let core_res = match r % 8 {
                0 => core.fund_budget_line(CoreOrigin::FutarchyTreasury, line, amount / 4),
                1 => core.spend(
                    CoreOrigin::FutarchyTreasury,
                    now,
                    line,
                    acc((r % 5) as u8).into(),
                    amount,
                ),
                2 => core
                    .open_stream(
                        CoreOrigin::FutarchyTreasury,
                        now,
                        futarchy_treasury_core::StreamInput {
                            line,
                            recipient: acc((r % 5) as u8).into(),
                            total: amount,
                            start: now,
                            duration: 100,
                        },
                    )
                    .map(|_| ()),
                3 => core
                    .claim_stream(acc((r % 5) as u8).into(), now, id)
                    .map(|_| ()),
                4 => core
                    .cancel_stream(CoreOrigin::FutarchyTreasury, id)
                    .map(|_| ()),
                5 => core.issue_vit(
                    CoreOrigin::FutarchyTreasury,
                    now,
                    amount * 1_000,
                    BudgetLine::Rewards,
                ),
                6 => core
                    .execute_coretime_renewal(
                        acc(6).into(),
                        (r >> 3) % 4,
                        u64::from(now),
                        u64::from(CoretimeQuoteTtl::get()),
                        CoretimeDotRate::get(),
                        CoretimeFeeDot::get(),
                    )
                    .map(|_| ()),
                _ => core.recover_foreign(
                    CoreOrigin::FutarchyTreasury,
                    AssetKind::Foreign([2u8; 32]),
                    acc(1).into(),
                    amount,
                ),
            };

            assert_eq!(
                shell_res.is_ok(),
                core_res.is_ok(),
                "acceptance diverged at step {step} (op {})",
                r % 8
            );

            // Occasionally note a fresh coretime quote on both sides so op 6 can
            // sometimes succeed rather than always closing the window.
            if r % 8 == 6 && core_res.is_err() {
                let period = (r >> 3) % 4;
                let _ = note_quote(period, 50_000 * USDC);
                let _ = core.note_coretime_renewal_quote(period, 50_000 * USDC, u64::from(now));
            }

            // Clear the core's transient event log (the shell never persists it)
            // and assert full aggregate equality.
            core.events.clear();
            assert_eq!(
                crate::Pallet::<Test>::treasury(),
                core,
                "state diverged at step {step} (op {})",
                r % 8
            );
        }
        assert_ok!(crate::Pallet::<Test>::do_try_state());
    });
}

// --------------------------------- sweep_insurance (08 §1.2/§1.4, SQ-207) --
//
// The single admissible outflow of the INSURANCE account. INSURANCE is outside
// NAV, so a sweep raises NAV by exactly the swept amount; custody preserves,
// and the origin is a passed TREASURY decision and nothing else.

// --------------------- E2: MAIN revenue recognition and the bounded reserve --

#[test]
fn credited_main_revenue_raises_nav_immediately_and_survives_a_mutation() {
    // 08 §1.2 "NAV effect of the E1 inflows": market-fee, redemption-fee and
    // transaction-fee value all arrive as liquid USDC in `MAIN` and enter
    // `NavView.total` at par. Custody is the caller's job; this is the
    // recognition half, and it must be visible to `nav()` on the very next read
    // — a deferred counter that only folded on the next governance act would
    // understate NAV for as long as the treasury happened to be idle.
    funded_ext().execute_with(|| {
        let nav_before = Treasury::nav().nav;
        let main_before = Treasury::treasury().main_usdc;

        Treasury::credit_main(1_234 * USDC);

        assert_eq!(Treasury::nav().nav, nav_before + 1_234 * USDC);
        assert_eq!(
            Treasury::treasury().main_usdc,
            main_before + 1_234 * USDC,
            "the aggregate read folds the deferred credit",
        );
        assert_ok!(Treasury::do_try_state());

        // Any later mutation persists the fold exactly once: the counter is
        // discharged, and a second read must not double-count it.
        assert_ok!(Treasury::fund_budget_line(to(), BudgetLine::Rewards, 0));
        assert_eq!(crate::PendingMainCredit::<Test>::get(), 0);
        assert_eq!(Treasury::treasury().main_usdc, main_before + 1_234 * USDC);
        assert_eq!(Treasury::nav().nav, nav_before + 1_234 * USDC);
        assert_ok!(Treasury::do_try_state());
    });
}

#[test]
fn credited_main_revenue_is_spendable_like_any_other_treasury_credit() {
    // The whole point of routing to `MAIN` rather than INSURANCE (08 §1.1's
    // first dispositive reason): the value must be ordinary treasury credit, not
    // a balance whose only exit is a proposal slot.
    funded_ext().execute_with(|| {
        let line_before = Treasury::line_balance(BudgetLine::Rewards);
        Treasury::credit_main(10_000 * USDC);
        assert_ok!(Treasury::fund_budget_line(
            to(),
            BudgetLine::Rewards,
            10_000 * USDC
        ));
        assert_eq!(
            Treasury::line_balance(BudgetLine::Rewards),
            line_before + 10_000 * USDC
        );
        assert_ok!(Treasury::do_try_state());
    });
}

#[test]
fn insurance_target_is_the_swept_residue_plus_the_r4_floor() {
    // 08 §1.2: `T_ins = swept_residue_unreclaimed + min_balance`. Derived from
    // the liability the account backs, never chosen.
    funded_ext().execute_with(|| {
        assert_eq!(Treasury::insurance_target(), INSURANCE_MIN_BALANCE);
        set_insurance_usdc(INSURANCE_MIN_BALANCE);
        assert_ok!(Treasury::note_swept_residue(5_000 * USDC));
        assert_eq!(
            Treasury::insurance_target(),
            5_000 * USDC + INSURANCE_MIN_BALANCE
        );
        assert_ok!(Treasury::do_try_state());
    });
}

#[test]
fn swept_residue_raises_the_target_by_its_own_amount_and_never_overflows() {
    // 08 §1.2: "Swept residue raises `T_ins` by its own amount as it arrives, so
    // it never overflows. This is what makes the rule O(1) and self-balancing."
    // The residue arrives in INSURANCE *and* is reported in the same
    // transaction (03 §7 R-5), so model both.
    funded_ext().execute_with(|| {
        let main_before = Treasury::treasury().main_usdc;
        set_insurance_usdc(INSURANCE_MIN_BALANCE + 5_000 * USDC);
        assert_ok!(Treasury::note_swept_residue(5_000 * USDC));

        assert!(insurance_sweeps().is_empty(), "nothing overflowed");
        assert_eq!(Treasury::treasury().main_usdc, main_before);
        assert_eq!(insurance_usdc(), INSURANCE_MIN_BALANCE + 5_000 * USDC);
        assert_ok!(Treasury::do_try_state());
    });
}

#[test]
fn an_inflow_through_treasury_code_overflows_in_its_own_transaction() {
    // 08 §1.2: above `T_ins`, surplus overflows to `MAIN` **automatically, in
    // the same transaction as the inflow**, for every inflow that executes
    // treasury code. Here the account is already above target when the residue
    // report runs, so the report's own transaction must carry the surplus out.
    funded_ext().execute_with(|| {
        let main_before = Treasury::treasury().main_usdc;
        let nav_before = Treasury::nav().nav;
        // 3,000 arrived by direct transfer earlier; 5,000 of residue arrives now.
        set_insurance_usdc(INSURANCE_MIN_BALANCE + 3_000 * USDC + 5_000 * USDC);

        assert_ok!(Treasury::note_swept_residue(5_000 * USDC));

        assert_eq!(insurance_sweeps(), vec![3_000 * USDC]);
        assert_eq!(Treasury::treasury().main_usdc, main_before + 3_000 * USDC);
        assert_eq!(Treasury::nav().nav, nav_before + 3_000 * USDC);
        System::assert_has_event(RuntimeEvent::Treasury(Event::InsuranceOverflowed {
            amount: 3_000 * USDC,
        }));
        // The reserve retains exactly its liability plus the R-4 floor.
        assert_eq!(insurance_usdc(), Treasury::insurance_target());
        assert_ok!(Treasury::do_try_state());
    });
}

#[test]
fn the_reconciliation_crank_is_permissionless_idempotent_and_a_noop_at_target() {
    // 08 §1.2: INSURANCE has a deterministic address and `ForeignAssets.transfer`
    // is a public call, so balance arrives with no treasury code running and no
    // interception point. The crank is what makes the bounded-reserve claim true
    // for those arrivals — and it must be free to run at any time.
    funded_ext().execute_with(|| {
        let main_before = Treasury::treasury().main_usdc;
        let nav_before = Treasury::nav().nav;

        // At target: a successful no-op, no custody move, no event.
        assert_ok!(Treasury::reconcile_insurance(RuntimeOrigin::signed(
            nobody()
        )));
        assert!(insurance_sweeps().is_empty());
        assert_eq!(Treasury::treasury().main_usdc, main_before);
        assert!(!System::events().iter().any(|record| matches!(
            record.event,
            RuntimeEvent::Treasury(Event::InsuranceOverflowed { .. })
        )));

        // A direct push lands above target; any signed account may crank it out.
        set_insurance_usdc(INSURANCE_MIN_BALANCE + 42_000 * USDC);
        assert_ok!(Treasury::reconcile_insurance(RuntimeOrigin::signed(acc(7))));
        assert_eq!(insurance_sweeps(), vec![42_000 * USDC]);
        assert_eq!(Treasury::treasury().main_usdc, main_before + 42_000 * USDC);
        assert_eq!(Treasury::nav().nav, nav_before + 42_000 * USDC);

        // Idempotent: a repeat run at target moves nothing a second time.
        assert_ok!(Treasury::reconcile_insurance(RuntimeOrigin::signed(acc(7))));
        assert_eq!(insurance_sweeps(), vec![42_000 * USDC]);
        assert_eq!(Treasury::treasury().main_usdc, main_before + 42_000 * USDC);
        assert_eq!(insurance_usdc(), INSURANCE_MIN_BALANCE);
        assert_ok!(Treasury::do_try_state());
    });
}

#[test]
fn the_reconciliation_crank_is_rebated_only_when_it_moves_surplus() {
    // 08 §6.3 (SQ-523): the closed decision-critical list puts every *other*
    // sanctioned permissionless keeper crank on the <= 20 % general tranche,
    // and this is one — it was the only such crank left unpaid. The `> 0`
    // condition is the orphan-Baseline precedent from the same section: a
    // crank requests a rebate only when it changes state, so repeated cranking
    // at target cannot drain the meter.
    funded_ext().execute_with(|| {
        assert_ok!(Treasury::fund_budget_line(
            to(),
            BudgetLine::Keeper,
            100 * USDC
        ));
        KeeperBudgetEpoch::set(100 * USDC);
        KeeperRebate::set(10 * USDC);
        reset_rebate_payout();
        set_rebate_pot_balance(PayoutLine::Keeper, 100 * USDC);

        // At or below target the crank is a no-op, so it earns nothing.
        assert_ok!(Treasury::reconcile_insurance(RuntimeOrigin::signed(acc(7))));
        assert!(rebate_payouts().is_empty());
        assert_eq!(Treasury::treasury().keeper_meter.general_spent, 0);

        // A direct push above target is real work, and is paid for once.
        set_insurance_usdc(INSURANCE_MIN_BALANCE + 42_000 * USDC);
        assert_ok!(Treasury::reconcile_insurance(RuntimeOrigin::signed(acc(7))));
        assert_eq!(
            rebate_payouts(),
            vec![(acc(7), 10 * USDC, PayoutLine::Keeper)]
        );
        assert_eq!(Treasury::treasury().keeper_meter.general_spent, 10 * USDC);

        // The idempotent repeat moves nothing, so it is not paid a second time.
        assert_ok!(Treasury::reconcile_insurance(RuntimeOrigin::signed(acc(7))));
        assert_eq!(
            rebate_payouts(),
            vec![(acc(7), 10 * USDC, PayoutLine::Keeper)]
        );
        assert_eq!(Treasury::treasury().keeper_meter.general_spent, 10 * USDC);
        assert_ok!(Treasury::do_try_state());
    });
}

#[test]
fn the_reconciliation_crank_never_draws_insurance_below_its_liability() {
    // `T_ins` is a floor on the liability, so an account holding exactly its
    // residue plus the floor has no surplus at all — releasing reserve against a
    // live liability stays a decided act under `sweep_insurance` (08 §1.2).
    funded_ext().execute_with(|| {
        set_insurance_usdc(INSURANCE_MIN_BALANCE + 9_000 * USDC);
        assert_ok!(Treasury::note_swept_residue(9_000 * USDC));
        assert!(insurance_sweeps().is_empty());

        assert_ok!(Treasury::reconcile_insurance(RuntimeOrigin::signed(acc(3))));
        assert!(insurance_sweeps().is_empty());
        assert_eq!(insurance_usdc(), INSURANCE_MIN_BALANCE + 9_000 * USDC);
        assert_ok!(Treasury::do_try_state());
    });
}

#[test]
fn the_reconciliation_crank_rejects_unsigned_and_root_origins() {
    funded_ext().execute_with(|| {
        set_insurance_usdc(INSURANCE_MIN_BALANCE + 1_000 * USDC);
        for bad in [RuntimeOrigin::none(), RuntimeOrigin::root()] {
            assert_noop!(
                Treasury::reconcile_insurance(bad),
                sp_runtime::DispatchError::BadOrigin
            );
        }
        assert!(insurance_sweeps().is_empty());
        assert_ok!(Treasury::do_try_state());
    });
}

#[test]
fn a_refused_overflow_custody_move_rolls_the_credit_back() {
    // G-1, and the same shape `sweep_insurance` already has: NAV must never
    // record USDC the treasury did not actually receive.
    funded_ext().execute_with(|| {
        let main_before = Treasury::treasury().main_usdc;
        let nav_before = Treasury::nav().nav;
        set_insurance_usdc(INSURANCE_MIN_BALANCE + 1_000 * USDC);
        set_insurance_sweep_failure(true);

        assert_noop!(
            Treasury::reconcile_insurance(RuntimeOrigin::signed(acc(4))),
            sp_runtime::DispatchError::Other("insurance sweep would reap the account")
        );
        assert_eq!(Treasury::treasury().main_usdc, main_before);
        assert_eq!(Treasury::nav().nav, nav_before);
        assert_eq!(crate::PendingMainCredit::<Test>::get(), 0);
        assert_ok!(Treasury::do_try_state());
    });
}

#[test]
fn sweep_insurance_does_not_decrement_the_residue_counter() {
    // 08 §1.2 is explicit: `sweep_insurance` "identifies no claim and discharges
    // no liability, so it MUST NOT decrement". Only the 03 §5.4 archived-claims
    // payout may, and that procedure is not specified in v1 — the counter is
    // monotone and `T_ins` a deliberate over-estimate in the safe direction.
    funded_ext().execute_with(|| {
        set_insurance_usdc(INSURANCE_MIN_BALANCE + 8_000 * USDC);
        assert_ok!(Treasury::note_swept_residue(8_000 * USDC));
        let target = Treasury::insurance_target();

        assert_ok!(Treasury::sweep_insurance(to(), 8_000 * USDC));
        assert_eq!(
            Treasury::insurance_target(),
            target,
            "the reserve target still reflects the liability it backs",
        );
        assert_ok!(Treasury::do_try_state());
    });
}

#[test]
fn sweep_insurance_credits_main_raises_nav_and_emits() {
    funded_ext().execute_with(|| {
        let nav_before = Treasury::nav().nav;
        let main_before = Treasury::treasury().main_usdc;

        assert_ok!(Treasury::sweep_insurance(to(), 750_000 * USDC));

        // 08 §1.2: "raising it by exactly that amount".
        assert_eq!(Treasury::treasury().main_usdc, main_before + 750_000 * USDC);
        assert_eq!(Treasury::nav().nav, nav_before + 750_000 * USDC);
        // Custody moved once, for the same amount.
        assert_eq!(insurance_sweeps(), vec![750_000 * USDC]);
        System::assert_last_event(RuntimeEvent::Treasury(Event::InsuranceSwept {
            amount: 750_000 * USDC,
        }));
        assert_ok!(Treasury::do_try_state());
    });
}

#[test]
fn sweep_insurance_rejects_every_origin_but_futarchy_treasury() {
    funded_ext().execute_with(|| {
        let main_before = Treasury::treasury().main_usdc;
        for bad in [
            RuntimeOrigin::signed(nobody()),
            RuntimeOrigin::none(),
            RuntimeOrigin::root(),
        ] {
            assert_noop!(
                Treasury::sweep_insurance(bad, 1_000 * USDC),
                sp_runtime::DispatchError::BadOrigin
            );
        }
        // No guardian/playbook/admin path exists, and nothing moved.
        assert_eq!(Treasury::treasury().main_usdc, main_before);
        assert!(insurance_sweeps().is_empty());
        assert_ok!(Treasury::do_try_state());
    });
}

#[test]
fn sweep_insurance_that_would_reap_the_account_fails_whole() {
    funded_ext().execute_with(|| {
        let main_before = Treasury::treasury().main_usdc;
        let nav_before = Treasury::nav().nav;

        // 03 §7 R-4 / 08 §1.4: `Preservation::Preserve` refuses a request above
        // `balance - min_balance` rather than reaping INSURANCE (G-1).
        set_insurance_sweep_failure(true);
        assert_noop!(
            Treasury::sweep_insurance(to(), 10_000_000 * USDC),
            sp_runtime::DispatchError::Other("insurance sweep would reap the account")
        );

        // The accounting credit rolled back with the custody refusal — NAV must
        // never record USDC the treasury did not actually receive.
        assert_eq!(Treasury::treasury().main_usdc, main_before);
        assert_eq!(Treasury::nav().nav, nav_before);
        assert_ok!(Treasury::do_try_state());
    });
}

#[test]
fn sweep_insurance_of_zero_is_a_bookkeeping_noop_without_custody() {
    funded_ext().execute_with(|| {
        let main_before = Treasury::treasury().main_usdc;
        assert_ok!(Treasury::sweep_insurance(to(), 0));
        assert_eq!(Treasury::treasury().main_usdc, main_before);
        // No custody adapter call for a zero move.
        assert!(insurance_sweeps().is_empty());
        System::assert_last_event(RuntimeEvent::Treasury(Event::InsuranceSwept { amount: 0 }));
        assert_ok!(Treasury::do_try_state());
    });
}

#[test]
fn swept_funds_land_in_main_and_stay_under_every_existing_control() {
    funded_ext().execute_with(|| {
        // 08 §1.2: once in MAIN the funds are ordinary treasury credit. The
        // reserve-health flag still zeroes spendable NAV over them.
        assert_ok!(Treasury::sweep_insurance(to(), 1_000_000 * USDC));
        assert!(Treasury::nav().spendable_nav > 0);
        assert_ok!(crate::Pallet::<Test>::set_reserve_impaired(true));
        assert_eq!(Treasury::nav().spendable_nav, 0);
        assert_ok!(Treasury::do_try_state());
    });
}

// ------------------------------------------ A14: which losses reach `Π` (05 §4.3.2)
//
// 05 §4.3.2 admits a defensive-path failure into `Π` iff the runtime detected a
// violation of an assumption it holds unconditionally, **and** the fallback
// discarded correctness-relevant state or engaged a fail-static latch, **and**
// no defined path later restores what was lost. The third clause is the whole
// ruling: bounded-maintenance backpressure has a defined recovery and must not
// increment, because four qualifying events zero `Π` and can arm the guardian's
// `suspend_on_gate`.
//
// 08 §2.4's collator accounting is where this pallet meets the test. A dropped
// boundary block and an overflowed accumulator both void a whole epoch's payout
// with no crank able to rebuild it — the ruling's "loss of an accounting
// accumulator" case. Everything else here is retried or already counted.

#[test]
fn a_dropped_boundary_block_counts_as_one_lost_accounting_event() {
    funded_ext().execute_with(|| {
        reset_rebate_payout();
        set_rebate_pot_balance(PayoutLine::OpsCollators, 0);
        // Epoch 0 completes and cannot pay (custody empty), so it occupies the
        // pending slot; epoch 1 opens the current accumulator.
        Treasury::note_collator_block(acc(7));
        set_epoch(1);
        Treasury::note_collator_block(acc(8));
        Treasury::pay_collator_compensation();
        assert_eq!(CollatorPendingEpoch::<Test>::get(), Some(0));
        assert!(integrity_faults().is_empty(), "nothing lost yet");

        // Epoch 2's first block would need a third accumulator. It is dropped
        // outright: no crank rebuilds an authored share whose input was the
        // block stream itself.
        set_epoch(2);
        Treasury::note_collator_block(acc(9));
        assert_eq!(CollatorDroppedEpoch::<Test>::get(), Some(2));
        assert_eq!(integrity_faults(), vec![IntegrityFault::LostAccounting]);

        // A *repeat* drop of the same epoch is the same loss re-observed, and
        // §4.3.2 counts an event at most once.
        Treasury::note_collator_block(acc(10));
        Treasury::note_collator_block(acc(11));
        assert_eq!(integrity_faults().len(), 1, "one lost epoch, one event");

        // Consuming the marker into the `Overflowed` latch is the downstream
        // consequence of the same loss, not a second detection.
        set_rebate_pot_balance(PayoutLine::OpsCollators, 4_000 * USDC);
        Treasury::pay_collator_compensation();
        Treasury::note_collator_block(acc(12));
        assert!(CollatorAuthoredOverflowed::<Test>::get());
        assert!(CollatorDroppedEpoch::<Test>::get().is_none());
        assert_eq!(integrity_faults().len(), 1, "the latch is not a new event");
    });
}

#[test]
fn a_second_distinct_dropped_epoch_is_its_own_event() {
    funded_ext().execute_with(|| {
        reset_rebate_payout();
        set_rebate_pot_balance(PayoutLine::OpsCollators, 0);
        Treasury::note_collator_block(acc(7));
        set_epoch(1);
        Treasury::note_collator_block(acc(8));
        Treasury::pay_collator_compensation();
        set_epoch(2);
        Treasury::note_collator_block(acc(9));
        assert_eq!(integrity_faults().len(), 1);

        // Epoch 3 losing a boundary block is a *different* epoch's accounting
        // going missing, and it additionally taints an accumulator that was
        // payable until now — two independent reasons it is a new event.
        set_epoch(3);
        Treasury::note_collator_block(acc(10));
        assert!(CollatorAuthoredOverflowed::<Test>::get());
        assert_eq!(
            integrity_faults(),
            vec![
                IntegrityFault::LostAccounting,
                IntegrityFault::LostAccounting
            ]
        );
    });
}

#[test]
fn accumulator_overflow_counts_once_however_many_authors_overflow() {
    funded_ext().execute_with(|| {
        // The bound is the active session's collator ceiling (13 §4), so a
        // 121st distinct author is a population the runtime holds impossible —
        // not a queue under load — and the latch voids *every* collator's share
        // for the epoch.
        for seed in 0..MAX_COLLATOR_COMPENSATION_ENTRIES_BOUND {
            Treasury::note_collator_block(acc(seed as u8));
        }
        assert!(
            integrity_faults().is_empty(),
            "a full accumulator is not a loss"
        );

        Treasury::note_collator_block(acc(200));
        assert!(CollatorAuthoredOverflowed::<Test>::get());
        assert_eq!(integrity_faults(), vec![IntegrityFault::LostAccounting]);

        // Further overflowing authors are the same lost epoch.
        Treasury::note_collator_block(acc(201));
        Treasury::note_collator_block(acc(202));
        assert_eq!(integrity_faults().len(), 1);
    });
}

#[test]
fn ordinary_collator_accounting_never_touches_pi() {
    funded_ext().execute_with(|| {
        reset_rebate_payout();
        // A healthy epoch: author, roll, pay. Nothing here is a fault.
        Treasury::note_collator_block(acc(7));
        Treasury::note_collator_block(acc(7));
        Treasury::note_collator_block(acc(8));
        set_epoch(1);
        Treasury::pay_collator_compensation();
        assert_eq!(rebate_payouts().len(), 2);
        assert!(integrity_faults().is_empty());
    });
}

#[test]
fn a_deferred_payout_is_backpressure_and_does_not_increment_pi() {
    funded_ext().execute_with(|| {
        reset_rebate_payout();
        set_rebate_pot_balance(PayoutLine::OpsCollators, 0);
        Treasury::note_collator_block(acc(7));

        // Underfunded custody: the storage layer unwinds and `let _ = result;`
        // discards the error. **Not** a §4.3.2 event — the accumulator survives
        // intact and the next Housekeeping boundary re-attempts it, which is a
        // defined recovery path (clause 3 fails).
        set_epoch(1);
        Treasury::pay_collator_compensation();
        assert!(rebate_payouts().is_empty() || CollatorAuthoredBlocks::<Test>::get().len() == 1);
        assert_eq!(CollatorAuthoredBlocks::<Test>::get().len(), 1);
        assert!(integrity_faults().is_empty());

        // And the retry does pay, which is what makes it backpressure.
        reset_rebate_payout();
        set_rebate_pot_balance(PayoutLine::OpsCollators, 4_000 * USDC);
        Treasury::pay_collator_compensation();
        assert_eq!(rebate_payouts().len(), 1);
        assert!(integrity_faults().is_empty());
    });
}

#[test]
fn tearing_down_a_tainted_epoch_does_not_count_it_twice() {
    funded_ext().execute_with(|| {
        for seed in 0..=MAX_COLLATOR_COMPENSATION_ENTRIES_BOUND {
            Treasury::note_collator_block(acc(seed as u8));
        }
        assert_eq!(integrity_faults().len(), 1);

        // Housekeeping discards the tainted accumulator without paying. The
        // epoch's loss was counted where the latch was set; counting the
        // teardown too would count one lost epoch twice.
        set_epoch(1);
        Treasury::pay_collator_compensation();
        assert!(rebate_payouts().is_empty());
        assert!(!CollatorAuthoredOverflowed::<Test>::get());
        assert_eq!(integrity_faults().len(), 1);
    });
}

#[test]
fn nothing_to_pay_is_not_a_fault() {
    funded_ext().execute_with(|| {
        // Every early bail in `pay_collator_compensation` returns with state
        // intact, so clause 2 of §4.3.2 (state discarded or a latch engaged)
        // never holds.
        Treasury::pay_collator_compensation();
        Treasury::note_collator_block(acc(7));
        // Epoch not yet complete: the accumulator stays open by design.
        Treasury::pay_collator_compensation();
        assert_eq!(CollatorAuthoredBlocks::<Test>::get().len(), 1);
        // A missing registered-count snapshot stalls the payout without
        // discarding the accumulator, so it is a liveness stall, not a loss.
        CollatorAuthoredRegisteredCount::<Test>::kill();
        set_epoch(1);
        Treasury::pay_collator_compensation();
        assert_eq!(CollatorAuthoredBlocks::<Test>::get().len(), 1);
        assert!(integrity_faults().is_empty());
    });
}

/// MAX-10 regression. `fund_budget_line` keeps a pot-backed line and its
/// custody pot in step by moving the real USDC MAIN → pot. `open_stream` then
/// debited the line with **no** custody leg, and `cancel_stream` credited the
/// remainder to `main_usdc` — recording MAIN money that physically sits in the
/// pot. Re-funding moves *fresh* MAIN USDC in, so the residual never shrinks
/// and no ordinary extrinsic recovers it: `recover_foreign` rejects USDC,
/// `sweep_insurance` is INSURANCE→MAIN only, and the USDC admin is itself a
/// keyless pallet account. 08 §1.4 states the correct behaviour outright —
/// "`open_stream` funds the stream from `line` and reverts its remainder
/// **there** on cancellation".
///
/// Fails at baseline: the line ended at 0 and `main_usdc` ended one stream
/// higher, with the real USDC still in the REWARDS pot.
#[test]
fn max10_a_cancelled_stream_reverts_to_its_own_line_not_to_main() {
    funded_ext().execute_with(|| {
        let before = crate::Pallet::<Test>::treasury();
        let line_before = before.line_balance(BudgetLine::Rewards);
        let main_before = before.main_usdc;
        let pot_before = RewardsPayoutPotBalance::get();
        assert!(line_before > 0 && pot_before >= line_before);

        let total = 300_000 * USDC;
        assert_ok!(Treasury::open_stream(
            to(),
            BudgetLine::Rewards,
            acc(2),
            total,
            0,
            100
        ));
        let opened = crate::Pallet::<Test>::treasury();
        assert_eq!(
            opened.line_balance(BudgetLine::Rewards),
            line_before - total
        );
        // No custody leg either way: the asset never moved.
        assert_eq!(RewardsPayoutPotBalance::get(), pot_before);
        // The debited line no longer covers the obligation on its own, but the
        // obligation is still visible to the drift alarm.
        assert_eq!(opened.outstanding_stream_total(BudgetLine::Rewards), total);
        assert_ok!(crate::Pallet::<Test>::do_try_state());

        let id = opened.streams.last().expect("stream opened").id;
        assert_ok!(Treasury::cancel_stream(to(), id));

        let after = crate::Pallet::<Test>::treasury();
        assert_eq!(
            after.line_balance(BudgetLine::Rewards),
            line_before,
            "the remainder returns to the line that funded the stream (08 §1.4)"
        );
        assert_eq!(
            after.main_usdc, main_before,
            "MAIN accounting must not grow against USDC that sits in the pot"
        );
        assert_eq!(RewardsPayoutPotBalance::get(), pot_before);
        assert_eq!(after.outstanding_stream_total(BudgetLine::Rewards), 0);
        assert_ok!(crate::Pallet::<Test>::do_try_state());
    });
}

/// The strengthened 08 §6.3 alarm must actually detect the drift it now covers
/// (15 §1): a line drained by an open stream used to read as needing nothing.
#[test]
fn try_state_sees_an_outstanding_stream_as_a_claim_on_the_pot() {
    funded_ext().execute_with(|| {
        let mut t = crate::Pallet::<Test>::treasury();
        // Custody the pot cannot cover once the stream's claim is counted.
        let pot = RewardsPayoutPotBalance::get();
        t.streams.push(Stream {
            id: t.next_stream_id,
            recipient: [1u8; 32],
            line: BudgetLine::Rewards,
            total: pot.saturating_add(USDC),
            claimed: 0,
            start: 0,
            duration: 100,
            cancelled: false,
        });
        t.next_stream_id += 1;
        crate::Pallet::<Test>::seed(&t);

        assert!(crate::Pallet::<Test>::do_try_state().is_err());
    });
}

#[test]
fn a_rebate_payout_does_not_double_count_deferred_main_credit() {
    // SQ-530. `load()` folds `PendingMainCredit` into `main_usdc`, and
    // `persist()` is the ONLY place that kills the counter afterwards. Four
    // fail-soft paths write `State::<T>::put(state)` directly instead —
    // `pay_collator_compensation`, the zero-pay rebate branch,
    // `do_keeper_rebate` and `do_proposer_reward`. Each therefore persists the
    // folded value while leaving the counter live, so the NEXT `load()` adds it
    // a second time.
    //
    // The direction is the unsafe one: NAV is over-stated, and every
    // NAV-derived control — `trs.cap_proposal`·NAV (hence the §5.2 security
    // sizing gate), `pol.budget_epoch`·NAV, and the 08 §4.1 arming floors — is
    // then computed on capital the treasury does not hold. It compounds,
    // because `credit_main` runs in the fee handler of every USDC-paying
    // extrinsic and `do_keeper_rebate` runs inside most cranks.
    //
    // `do_try_state` cannot catch it: no invariant ties `main_usdc` to real
    // MAIN custody. The existing `credit_main` coverage pairs it only with
    // `fund_budget_line`, which goes through `persist()` and is therefore
    // correct — which is exactly why this went unseen.
    funded_ext().execute_with(|| {
        assert_ok!(Treasury::fund_budget_line(
            to(),
            BudgetLine::Keeper,
            100 * USDC
        ));
        KeeperRebate::set(USDC);

        let main_before = Treasury::treasury().main_usdc;
        Treasury::credit_main(1_000 * USDC);
        assert_eq!(
            Treasury::treasury().main_usdc,
            main_before + 1_000 * USDC,
            "the fold is correct on the first read",
        );

        crate::Pallet::<Test>::do_keeper_rebate(&acc(7), CrankClass::DecisionCritical);

        assert_eq!(
            crate::PendingMainCredit::<Test>::get(),
            0,
            "a path that persisted the folded credit must discharge the counter",
        );
        assert_eq!(
            Treasury::treasury().main_usdc,
            main_before + 1_000 * USDC,
            "the deferred credit must be recognised exactly once (SQ-530)",
        );
        assert_ok!(Treasury::do_try_state());
    });
}

// ---- `treasury_streams`' projection (02 §3 contract v29; 11 §11.8.3) --------
//
// SQ-601. The projection and the payment must be one answer to "what will I
// receive?": `streams_for` fills `StreamView.claimable_now` from
// `futarchy_treasury_core::stream_claimable_at`, and `claim_stream` pays from
// the same function. These tests bind the two, and pin the three states that
// all report zero for different reasons.

/// The amount `claim_stream` would pay `who` for `stream` at the mock's current
/// block, read through the same function both the projection and the dispatch
/// use.
fn claimable_now(id: u64) -> u128 {
    let stream = Treasury::treasury()
        .streams
        .into_iter()
        .find(|stream| stream.id == id)
        .expect("the stream exists");
    futarchy_treasury_core::stream_claimable_at(&stream, System::block_number() as u32)
        .expect("the mock fixture never overflows")
}

/// The `claimed` cursor of one stream, straight out of storage.
fn claimed(id: u64) -> u128 {
    crate::State::<Test>::get()
        .streams
        .into_iter()
        .find(|stream| stream.id == id)
        .expect("the stream exists")
        .claimed
}

/// The amount the last `StreamClaimed` event reports for `id` — what the
/// recipient is actually paid, as opposed to what the projection promised.
fn last_claimed_event_amount(id: u64) -> u128 {
    System::events()
        .iter()
        .rev()
        .find_map(|record| match &record.event {
            RuntimeEvent::Treasury(Event::StreamClaimed {
                id: claimed_id,
                amount,
                ..
            }) if *claimed_id == id => Some(*amount),
            _ => None,
        })
        .expect("a successful claim emits its amount")
}

/// 02 §3 / 11 §11.8.3: the projection is **per caller**. It returns exactly the
/// streams whose recipient is `who`, ordered by id, and no other recipient's.
///
/// The stored vector is deliberately reversed before the read: `Treasury.streams`
/// is a push-ordered `Vec`, so a projection that simply filtered would appear
/// ordered by accident. Reversing separates "ordered by id" from "in storage
/// order", which is what 02 §3's stable projection has to mean.
#[test]
fn v29_streams_for_returns_only_the_callers_rows_ordered_by_id() {
    funded_ext().execute_with(|| {
        for recipient in [2u8, 3, 2, 3] {
            assert_ok!(Treasury::open_stream(
                to(),
                BudgetLine::OpsCollators,
                acc(recipient),
                300_000 * USDC,
                0,
                100,
            ));
        }
        let mut state = Treasury::treasury();
        assert_eq!(
            state.streams.iter().map(|s| s.id).collect::<Vec<_>>(),
            vec![0, 1, 2, 3],
        );
        state.streams.reverse();
        crate::Pallet::<Test>::seed(&state);

        let mine = Treasury::streams_for(&acc(2));
        assert_eq!(
            mine.iter().map(|(stream, _)| stream.id).collect::<Vec<_>>(),
            vec![0, 2],
            "the projection is ordered by id, not by storage position",
        );
        assert!(
            mine.iter().all(|(stream, _)| stream.recipient == [2u8; 32]),
            "every returned row belongs to the caller",
        );

        let theirs = Treasury::streams_for(&acc(3));
        assert_eq!(
            theirs
                .iter()
                .map(|(stream, _)| stream.id)
                .collect::<Vec<_>>(),
            vec![1, 3],
        );
        // The two projections partition the register: no id is shared, and
        // together they account for every stream.
        assert!(mine
            .iter()
            .all(|(stream, _)| !theirs.iter().any(|(other, _)| other.id == stream.id)));
        assert_eq!(
            mine.len() + theirs.len(),
            Treasury::treasury().streams.len()
        );

        // A caller with no streams gets nothing, not somebody else's rows.
        assert!(Treasury::streams_for(&acc(9)).is_empty());
    });
}

/// The paired `claimable_now` is the amount `claim_stream` then actually pays,
/// and paying it advances `claimed` by exactly that much
/// (`claimed_after == claimed_before + claimable_before`).
///
/// Asserted twice, at two points on the vesting curve, because a projection that
/// happened to agree once could still be a second implementation of the rule.
#[test]
fn v29_streams_for_claimable_now_is_what_claim_stream_pays() {
    funded_ext().execute_with(|| {
        assert_ok!(Treasury::open_stream(
            to(),
            BudgetLine::OpsCollators,
            acc(2),
            300_000 * USDC,
            10,
            100,
        ));

        for block in [60u64, 77] {
            System::set_block_number(block);
            let projected = Treasury::streams_for(&acc(2));
            assert_eq!(projected.len(), 1);
            let (row, promised) = projected[0];
            assert_eq!(row.id, 0);
            assert!(promised > 0, "the fixture must have something to claim");
            // The projection is the shared function's answer, not a second one.
            assert_eq!(promised, claimable_now(0));

            let claimed_before = claimed(0);
            assert_ok!(Treasury::claim_stream(RuntimeOrigin::signed(acc(2)), 0));

            assert_eq!(
                last_claimed_event_amount(0),
                promised,
                "the payment must be the promised amount, to the base unit",
            );
            assert_eq!(
                claimed(0),
                claimed_before + promised,
                "claimed_after == claimed_before + claimable_before",
            );
            // Immediately after a claim there is nothing left at this block, so
            // the projection cannot promise the same money twice.
            assert_eq!(Treasury::streams_for(&acc(2))[0].1, 0);
        }
        assert_ok!(Treasury::do_try_state());
    });
}

/// Zero is reported for three different states — cancelled, not yet started,
/// fully claimed — and the *stream fields* still tell them apart. A client shows
/// three different things; the amount is nothing in all three.
#[test]
fn v29_streams_for_reports_zero_for_cancelled_unstarted_and_fully_claimed() {
    funded_ext().execute_with(|| {
        // id 0: cancelled while genuinely half vested, so the zero is the
        // cancellation and not the arithmetic.
        assert_ok!(Treasury::open_stream(
            to(),
            BudgetLine::OpsCollators,
            acc(2),
            300_000 * USDC,
            0,
            100,
        ));
        // id 1: starts in the future.
        assert_ok!(Treasury::open_stream(
            to(),
            BudgetLine::OpsCollators,
            acc(2),
            300_000 * USDC,
            1_000,
            100,
        ));
        // id 2: fully vested and fully claimed.
        assert_ok!(Treasury::open_stream(
            to(),
            BudgetLine::OpsCollators,
            acc(2),
            300_000 * USDC,
            0,
            10,
        ));

        System::set_block_number(50);
        assert!(
            claimable_now(0) > 0,
            "id 0 must be claimable before it is cancelled",
        );
        assert_ok!(Treasury::cancel_stream(to(), 0));
        assert_ok!(Treasury::claim_stream(RuntimeOrigin::signed(acc(2)), 2));

        let rows = Treasury::streams_for(&acc(2));
        assert_eq!(
            rows.iter().map(|(stream, _)| stream.id).collect::<Vec<_>>(),
            vec![0, 1, 2],
        );
        assert!(
            rows.iter().all(|(_, claimable)| *claimable == 0),
            "all three states report nothing to claim",
        );

        let now = System::block_number() as u32;
        let (cancelled, _) = rows[0];
        assert!(cancelled.cancelled);
        assert!(
            cancelled.start <= now && cancelled.claimed < cancelled.total,
            "a cancelled stream is distinguishable by its flag alone",
        );
        let (unstarted, _) = rows[1];
        assert!(!unstarted.cancelled);
        assert!(unstarted.start > now);
        assert_eq!(unstarted.claimed, 0);
        let (spent, _) = rows[2];
        assert!(!spent.cancelled);
        assert!(spent.start <= now);
        assert_eq!(spent.claimed, spent.total);

        // And the dispatch refuses all three, each for its own reason.
        assert_noop!(
            Treasury::claim_stream(RuntimeOrigin::signed(acc(2)), 0),
            Error::<Test>::AlreadyCancelled
        );
        for id in [1u64, 2] {
            assert_noop!(
                Treasury::claim_stream(RuntimeOrigin::signed(acc(2)), id),
                Error::<Test>::StreamNotClaimable
            );
        }
    });
}

/// `stream_claimable_at` and `claim_stream` cannot disagree — walked across the
/// vesting boundaries, not sampled in the middle.
///
/// The boundaries are where a projection drifts from a payment: the block before
/// `start`, `start` itself (nothing has vested yet), the first vesting block, the
/// last block inside the window, the exact end block, and past it. At every one
/// of them the promise and the payment must be the same number, and a promise of
/// zero must be a refusal rather than a zero-value payment.
#[test]
fn v29_stream_claimable_at_and_claim_stream_cannot_disagree_at_the_boundaries() {
    funded_ext().execute_with(|| {
        const START: u64 = 10;
        const DURATION: u64 = 100;
        const TOTAL: u128 = 300_000 * USDC;
        assert_ok!(Treasury::open_stream(
            to(),
            BudgetLine::OpsCollators,
            acc(2),
            TOTAL,
            START,
            DURATION,
        ));

        for block in [
            START - 1,
            START,
            START + 1,
            START + DURATION - 1,
            START + DURATION,
            START + DURATION + 1,
        ] {
            System::set_block_number(block);
            let promised = claimable_now(0);
            assert_eq!(
                Treasury::streams_for(&acc(2))[0].1,
                promised,
                "the published figure is the shared function's answer at {block}",
            );
            let claimed_before = claimed(0);

            if promised == 0 {
                assert_noop!(
                    Treasury::claim_stream(RuntimeOrigin::signed(acc(2)), 0),
                    Error::<Test>::StreamNotClaimable
                );
                assert_eq!(claimed(0), claimed_before);
            } else {
                assert_ok!(Treasury::claim_stream(RuntimeOrigin::signed(acc(2)), 0));
                assert_eq!(last_claimed_event_amount(0), promised);
                assert_eq!(
                    claimed(0),
                    claimed_before + promised,
                    "the cursor advances by exactly the promised amount at {block}",
                );
            }
            // Vesting floors against the claimant, so the cursor never runs past
            // the total (08 §1.4).
            assert!(claimed(0) <= TOTAL);
        }

        // The whole stream is disbursed once the window has elapsed, and not one
        // base unit more.
        assert_eq!(claimed(0), TOTAL);
        assert_eq!(claimable_now(0), 0);
        assert_ok!(Treasury::do_try_state());
    });
}
