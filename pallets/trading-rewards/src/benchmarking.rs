//! `frame-benchmarking` v2 harness for the trading-reward dispatchables
//! (15 §4.5). Every call is benchmarked; TR4's per-fill observer enters the
//! *trade's* weight and is benchmarked there, per 08 §2.6's accepted costs.

use super::*;
use crate::pallet::{ParticipantCount, Participants, ScoreCount, Scores, TotalAccrued};
use frame_benchmarking::v2::*;
use frame_system::RawOrigin;

/// One whole USDC — comfortably above the frozen 0.1 USDC `ledger.pos_dep`.
const BENCHMARK_BOND: Balance = futarchy_primitives::currency::USDC;
/// Any primary-domain market id; the pallet never resolves it.
const BENCHMARK_MARKET: futarchy_primitives::MarketId = 1;
/// The 13 §1 placeholder reference, 0.05 USDC/VIT, as its `FixedU64` integer.
const BENCHMARK_VIT_RATE: u64 = 50_000_000;

fn participant<T: Config>() -> T::AccountId {
    let who: T::AccountId = whitelisted_caller();
    T::BenchmarkHelper::prime_usdc(&who, BENCHMARK_BOND.saturating_mul(4));
    who
}

#[benchmarks(where T: Config)]
mod benches {
    use super::*;

    #[benchmark]
    fn enroll() {
        let who = participant::<T>();

        #[extrinsic_call]
        _(RawOrigin::Signed(who.clone()), BENCHMARK_BOND);

        assert!(Participants::<T>::contains_key(&who));
    }

    #[benchmark]
    fn top_up_bond() {
        let who = participant::<T>();
        assert!(Pallet::<T>::enroll(RawOrigin::Signed(who.clone()).into(), BENCHMARK_BOND).is_ok());

        #[extrinsic_call]
        _(RawOrigin::Signed(who.clone()), BENCHMARK_BOND);

        assert_eq!(
            Participants::<T>::get(&who).map(|record| record.bond),
            Some(BENCHMARK_BOND.saturating_mul(2))
        );
    }

    #[benchmark]
    fn withdraw_bond() {
        let who = participant::<T>();
        assert!(Pallet::<T>::enroll(RawOrigin::Signed(who.clone()).into(), BENCHMARK_BOND).is_ok());

        #[extrinsic_call]
        _(RawOrigin::Signed(who.clone()));

        assert!(!Participants::<T>::contains_key(&who));
        assert_eq!(ParticipantCount::<T>::get(), 0);
    }

    /// The **record-closing** arm, because it is the heavier of the two and
    /// `&&` hides it.
    ///
    /// The close test is `record.bond == 0 && record.epoch == default &&
    /// ScoreCount == 0 && Scores prefix empty`. A fixture that leaves a live
    /// bond short-circuits on the first conjunct, so the counter read, the
    /// prefix probe, the roster read and the three closing writes are never
    /// measured — and `claim_rewards` carries no fitted component, so the drift
    /// gate compares the cheap figure at any fidelity and agrees with it.
    ///
    /// The state below is not exotic. It is exactly what `withdraw_bond`'s
    /// retained-record design exists to create: the bond comes back while an
    /// unclaimed accrual keeps the record alive, and the claim the participant
    /// already wants to make is what returns the roster slot.
    #[benchmark]
    fn claim_rewards() {
        let who = participant::<T>();
        assert!(Pallet::<T>::enroll(RawOrigin::Signed(who.clone()).into(), BENCHMARK_BOND).is_ok());
        T::BenchmarkHelper::prime_vit_rate(BENCHMARK_VIT_RATE);
        T::BenchmarkHelper::prime_reward_budget(
            futarchy_primitives::currency::VIT.saturating_mul(1_000),
        );
        Participants::<T>::mutate(&who, |slot| {
            if let Some(record) = slot.as_mut() {
                record.accrued = BENCHMARK_BOND;
            }
        });
        TotalAccrued::<T>::put(BENCHMARK_BOND);
        // Through the production call, so the retained record is the one the
        // chain really produces rather than one this fixture asserts into being.
        assert!(Pallet::<T>::withdraw_bond(RawOrigin::Signed(who.clone()).into()).is_ok());
        assert_eq!(
            Participants::<T>::get(&who).map(|record| record.bond),
            Some(0),
            "the accrual must retain the record at a zero bond, or the claim below \
             measures the short-circuiting arm again"
        );

        #[extrinsic_call]
        _(RawOrigin::Signed(who.clone()));

        // The discriminating assertion: only the closing arm removes the
        // record. Asserting `accrued == 0` instead passes on both arms, which
        // is how the cheap fixture stayed invisible.
        assert!(
            !Participants::<T>::contains_key(&who),
            "the fixture must measure the arm that closes the record"
        );
        assert!(!ScoreCount::<T>::contains_key(&who));
        assert_eq!(ParticipantCount::<T>::get(), 0);
    }

    /// The **realized** arm wherever a runtime can build one, because it is the
    /// heavier of the two: it reads the settlement source's whole answer (the
    /// book, its vault and the account's two scalar legs) and then runs 08
    /// §2.6's rules 3 and 4, where the timeout arm reads only enough to learn
    /// that nothing is terminal and drops the entry at zero.
    ///
    /// A mock whose `SettledMarkets` reports nothing cannot build that state,
    /// so it keeps the timeout arm — and says so, through
    /// [`BenchmarkHelper::prime_settled_market`]'s return value rather than by
    /// leaving both cases behind one assertion that cannot tell them apart.
    #[benchmark]
    fn settle_market_score() {
        let who = participant::<T>();
        assert!(Pallet::<T>::enroll(RawOrigin::Signed(who.clone()).into(), BENCHMARK_BOND).is_ok());
        let settled = T::BenchmarkHelper::prime_settled_market(&who, BENCHMARK_MARKET);
        Scores::<T>::insert(
            &who,
            BENCHMARK_MARKET,
            trading_rewards_core::MarketScore {
                spent: BENCHMARK_BOND,
                mirror_principal: BENCHMARK_BOND,
                // Non-zero on both legs, so rule 3's `min(position,
                // book_acquired)` and its multiplication are real work rather
                // than a clamp to zero the optimizer could skip.
                book_acquired: [BENCHMARK_BOND, BENCHMARK_BOND],
                ..Default::default()
            },
        );
        ScoreCount::<T>::insert(&who, 1);
        if !settled {
            frame_system::Pallet::<T>::set_block_number(
                futarchy_primitives::bounds::SCORE_ENTRY_LIFETIME_BLOCKS.into(),
            );
        }
        let cranker: T::AccountId = account("cranker", 0, 0);

        #[extrinsic_call]
        _(RawOrigin::Signed(cranker), who.clone(), BENCHMARK_MARKET);

        assert!(Scores::<T>::get(&who, BENCHMARK_MARKET).is_none());
        if settled {
            // The discriminating assertion: only the realized arm folds the
            // score into the epoch accumulator. Without it a runtime whose
            // priming silently stopped working would regenerate the cheaper
            // timeout weight and nothing would say so.
            assert_eq!(
                Participants::<T>::get(&who).map(|record| record.epoch.spent),
                Some(BENCHMARK_BOND),
            );
        }
    }

    /// The **debit** arm: it is the one that moves USDC custody, so it is the
    /// heavier of the two outcomes.
    #[benchmark]
    fn settle_epoch() {
        let who = participant::<T>();
        assert!(Pallet::<T>::enroll(RawOrigin::Signed(who.clone()).into(), BENCHMARK_BOND).is_ok());
        Participants::<T>::mutate(&who, |slot| {
            if let Some(record) = slot.as_mut() {
                record.epoch = trading_rewards_core::EpochScore {
                    spent: BENCHMARK_BOND,
                    received: 0,
                };
            }
        });
        T::BenchmarkHelper::advance_epoch();
        let cranker: T::AccountId = account("cranker", 0, 0);

        #[extrinsic_call]
        _(RawOrigin::Signed(cranker), who.clone());

        let record = Participants::<T>::get(&who).expect("the record survives a debit");
        assert!(record.bond < BENCHMARK_BOND);
        assert_eq!(record.epoch, Default::default());
    }

    impl_benchmark_test_suite!(Pallet, crate::mock::new_test_ext(), crate::mock::Test);
}
