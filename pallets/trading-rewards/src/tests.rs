//! Mock-runtime tests for `pallet-trading-rewards` (15 §4.1).
//!
//! Every governed row the pallet reads is a mutable static in the mock, so the
//! tests move the row and watch the boundary move. A test that only checks the
//! pallet agrees with one hard-coded number cannot tell a live read from a
//! pinned constant.

use crate::mock::*;
use crate::{
    Error, Event, ParticipantCount, Participants, ScoreCount, Scores, TotalAccrued,
    MAX_PARTICIPANTS,
};
use frame_support::traits::fungibles::Mutate as MutateAsset;
use frame_support::{assert_noop, assert_ok};
use sp_runtime::DispatchError;

fn events() -> Vec<Event<Test>> {
    System::events()
        .into_iter()
        .filter_map(|record| match record.event {
            RuntimeEvent::TradingRewards(inner) => Some(inner),
            _ => None,
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Enrolment
// ---------------------------------------------------------------------------

#[test]
fn enroll_holds_the_bond_and_opens_a_record() {
    new_test_ext().execute_with(|| {
        let before = usdc_balance(&alice());
        assert_ok!(TradingRewards::enroll(
            RuntimeOrigin::signed(alice()),
            1_000
        ));
        let record = Participants::<Test>::get(alice()).expect("record opened");
        assert_eq!(record.bond, 1_000);
        assert_eq!(held_usdc(&alice()), 1_000);
        assert_eq!(record.snapshot_bond, 1_000, "the cap opens at the bond");
        assert_eq!(record.snapshot_epoch, CurrentEpoch::get());
        assert_eq!(record.epoch, Default::default());
        assert_eq!(record.accrued, 0);
        assert!(!record.suspended);
        assert_eq!(ParticipantCount::<Test>::get(), 1);
        // The USDC left the participant and reached the sovereign; the hold is
        // real custody, not a bookkeeping entry.
        assert_eq!(usdc_balance(&alice()), before - 1_000);
        assert_eq!(sovereign_usdc(), 1_000);
        assert!(TradingRewards::is_enrolled(&alice()));
        assert_ok!(TradingRewards::do_try_state());
    });
}

#[test]
fn enroll_refuses_a_bond_below_the_position_deposit() {
    new_test_ext().execute_with(|| {
        // The mock's `ledger.pos_dep` is 100; the production row is frozen at
        // 0.1 USDC. Both are read live, and the next test proves it.
        assert_noop!(
            TradingRewards::enroll(RuntimeOrigin::signed(alice()), 1),
            Error::<Test>::BondBelowMinimum
        );
        assert!(Participants::<Test>::get(alice()).is_none());
        assert_eq!(sovereign_usdc(), 0, "nothing was held");
    });
}

#[test]
fn the_minimum_bond_tracks_the_live_position_deposit() {
    // Falsifies an implementation that pinned the minimum to a constant: the
    // same bond is admitted at one live value and refused at another, with
    // nothing else changed.
    new_test_ext().execute_with(|| {
        PositionDeposit::set(500);
        assert_noop!(
            TradingRewards::enroll(RuntimeOrigin::signed(alice()), 499),
            Error::<Test>::BondBelowMinimum
        );
        assert_ok!(TradingRewards::enroll(RuntimeOrigin::signed(alice()), 500));

        PositionDeposit::set(5_000);
        assert_noop!(
            TradingRewards::enroll(RuntimeOrigin::signed(bob()), 500),
            Error::<Test>::BondBelowMinimum
        );
        assert_ok!(TradingRewards::enroll(RuntimeOrigin::signed(bob()), 5_000));
    });
}

#[test]
fn an_unreadable_position_deposit_fails_enrolment_closed() {
    new_test_ext().execute_with(|| {
        PositionDeposit::set(0);
        assert_noop!(
            TradingRewards::enroll(RuntimeOrigin::signed(alice()), 1_000_000),
            Error::<Test>::MinimumBondUnset
        );
        assert_eq!(sovereign_usdc(), 0, "an unpriced entry takes no hold");
    });
}

#[test]
fn enroll_refuses_with_the_rate_unset_before_any_hold() {
    // 08 §2.6 failure behaviour: an unset `rwd.rate` fails `enroll` closed with
    // a typed error, *before any hold*.
    new_test_ext().execute_with(|| {
        RewardRate::set(None);
        let before = usdc_balance(&alice());
        assert_noop!(
            TradingRewards::enroll(RuntimeOrigin::signed(alice()), 1_000),
            Error::<Test>::RateUnset
        );
        assert_eq!(usdc_balance(&alice()), before, "no hold was taken");
        assert_eq!(sovereign_usdc(), 0);
        assert!(Participants::<Test>::get(alice()).is_none());
        assert_eq!(ParticipantCount::<Test>::get(), 0);
    });
}

#[test]
fn enroll_refuses_a_zero_rate_before_any_hold() {
    // 13 §1 admits `rwd.rate = 0` as "off, the safe direction". A switched-off
    // program must not take custody of a bond it can never pay against.
    new_test_ext().execute_with(|| {
        RewardRate::set(Some(0));
        assert_noop!(
            TradingRewards::enroll(RuntimeOrigin::signed(alice()), 1_000),
            Error::<Test>::RateUnset
        );
        assert_eq!(sovereign_usdc(), 0);
    });
}

#[test]
fn enroll_refuses_a_second_record_for_the_same_account() {
    new_test_ext().execute_with(|| {
        assert_ok!(TradingRewards::enroll(
            RuntimeOrigin::signed(alice()),
            1_000
        ));
        let held = sovereign_usdc();
        assert_noop!(
            TradingRewards::enroll(RuntimeOrigin::signed(alice()), 5_000),
            Error::<Test>::AlreadyEnrolled
        );
        assert_eq!(sovereign_usdc(), held, "the second bond was not taken");
        assert_eq!(held_usdc(&alice()), 1_000);
        assert_eq!(ParticipantCount::<Test>::get(), 1);
    });
}

#[test]
fn enroll_refuses_at_the_participant_bound_without_taking_a_hold() {
    // limit-coverage: MaxParticipants
    // The boundary is asserted exactly: the last slot is admitted and the next
    // is refused, so an off-by-one in either direction fails this test.
    new_test_ext().execute_with(|| {
        ParticipantCount::<Test>::put(MAX_PARTICIPANTS - 1);
        assert_ok!(TradingRewards::enroll(
            RuntimeOrigin::signed(alice()),
            1_000
        ));
        assert_eq!(ParticipantCount::<Test>::get(), MAX_PARTICIPANTS);

        let funds = usdc_balance(&bob());
        let held = sovereign_usdc();
        assert_noop!(
            TradingRewards::enroll(RuntimeOrigin::signed(bob()), 1_000),
            Error::<Test>::TooManyParticipants
        );
        assert_eq!(usdc_balance(&bob()), funds, "no hold was taken");
        assert_eq!(sovereign_usdc(), held);
        assert!(Participants::<Test>::get(bob()).is_none());
        assert_eq!(ParticipantCount::<Test>::get(), MAX_PARTICIPANTS);
    });
}

#[test]
fn enroll_refuses_a_bond_the_funder_cannot_pay_and_moves_nothing() {
    new_test_ext().execute_with(|| {
        let funds = usdc_balance(&alice());
        assert_noop!(
            TradingRewards::enroll(RuntimeOrigin::signed(alice()), funds + 1),
            Error::<Test>::BondCustody
        );
        assert_eq!(usdc_balance(&alice()), funds);
        assert_eq!(sovereign_usdc(), 0);
        assert!(Participants::<Test>::get(alice()).is_none());
        assert_eq!(ParticipantCount::<Test>::get(), 0);
    });
}

#[test]
fn the_minimum_bond_never_falls_below_the_usdc_asset_minimum() {
    // A bond under the asset's own `min_balance` cannot create the sovereign's
    // USDC account at all, so the live floor is the larger of the two rows.
    new_test_ext().execute_with(|| {
        PositionDeposit::set(USDC_MIN_BALANCE - 1);
        assert_noop!(
            TradingRewards::enroll(RuntimeOrigin::signed(alice()), USDC_MIN_BALANCE - 1),
            Error::<Test>::BondBelowMinimum
        );
        assert_ok!(TradingRewards::enroll(
            RuntimeOrigin::signed(alice()),
            USDC_MIN_BALANCE
        ));
    });
}

#[test]
fn enroll_refuses_a_bond_that_would_dust_the_funder() {
    // Between "pays the whole balance" and "keeps a live account" lies a band
    // the asset layer would reap. Refusing is the status-quo default; a
    // silently reaped funder is not the participant's intent.
    new_test_ext().execute_with(|| {
        let funds = usdc_balance(&alice());
        let bond = funds - (USDC_MIN_BALANCE - 1);
        assert_noop!(
            TradingRewards::enroll(RuntimeOrigin::signed(alice()), bond),
            Error::<Test>::BondFundingWouldDust
        );
        assert_eq!(usdc_balance(&alice()), funds);
        assert_eq!(sovereign_usdc(), 0);
        // One unit less leaves exactly the asset minimum behind, and passes.
        assert_ok!(TradingRewards::enroll(
            RuntimeOrigin::signed(alice()),
            bond - 1
        ));
        assert_eq!(usdc_balance(&alice()), USDC_MIN_BALANCE);
    });
}

#[test]
fn a_top_up_that_would_overflow_the_bond_is_refused_before_custody_moves() {
    // Rule 1: checked arithmetic with a typed error, never a wrap. The bound
    // is unreachable through the dispatch surface, so it is seeded directly.
    new_test_ext().execute_with(|| {
        assert_ok!(TradingRewards::enroll(
            RuntimeOrigin::signed(alice()),
            1_000
        ));
        Participants::<Test>::mutate(alice(), |slot| {
            slot.as_mut().expect("record").bond = u128::MAX;
        });
        let funds = usdc_balance(&alice());
        assert_noop!(
            TradingRewards::top_up_bond(RuntimeOrigin::signed(alice()), 1),
            Error::<Test>::AccountingOverflow
        );
        assert_eq!(usdc_balance(&alice()), funds, "no custody moved");
    });
}

#[test]
fn enroll_admits_a_funder_who_spends_their_whole_usdc_balance() {
    // `Preservation::Preserve` on a full-balance move would refuse a lawful
    // bond; the funder-side preservation must fall back to `Expendable`
    // exactly when nothing is left behind.
    new_test_ext().execute_with(|| {
        let funds = usdc_balance(&alice());
        assert_ok!(TradingRewards::enroll(
            RuntimeOrigin::signed(alice()),
            funds
        ));
        assert_eq!(usdc_balance(&alice()), 0);
        assert_eq!(sovereign_usdc(), funds);
        assert_ok!(TradingRewards::do_try_state());
    });
}

// ---------------------------------------------------------------------------
// Top-up
// ---------------------------------------------------------------------------

#[test]
fn a_top_up_does_not_move_the_current_epochs_cap() {
    // Design §4.3: a top-up after the outcome is known must not enlarge the
    // winning account's earning cap for the epoch already in flight.
    new_test_ext().execute_with(|| {
        assert_ok!(TradingRewards::enroll(
            RuntimeOrigin::signed(alice()),
            1_000
        ));
        let before = Participants::<Test>::get(alice())
            .expect("record")
            .snapshot_bond;
        assert_eq!(
            before, 1_000,
            "the cap opens at the bond, so `before` is a real figure and not zero"
        );
        assert_ok!(TradingRewards::top_up_bond(
            RuntimeOrigin::signed(alice()),
            9_000
        ));
        let after = Participants::<Test>::get(alice()).expect("record");
        assert_eq!(after.bond, 10_000, "the hold grows immediately");
        assert_eq!(after.snapshot_bond, before, "the cap does not");
        assert_eq!(
            after.snapshot_epoch,
            CurrentEpoch::get(),
            "and neither does the epoch it was taken for"
        );
        assert_eq!(sovereign_usdc(), 10_000, "custody follows the hold");
        assert_ok!(TradingRewards::do_try_state());
    });
}

#[test]
fn a_top_up_in_a_later_epoch_still_leaves_the_snapshot_alone() {
    // The deferral is not "until the clock moves"; it is unconditional. Only
    // settlement re-snapshots, and settlement is TR5's call.
    new_test_ext().execute_with(|| {
        assert_ok!(TradingRewards::enroll(
            RuntimeOrigin::signed(alice()),
            1_000
        ));
        CurrentEpoch::set(CurrentEpoch::get() + 3);
        assert_ok!(TradingRewards::top_up_bond(
            RuntimeOrigin::signed(alice()),
            9_000
        ));
        let record = Participants::<Test>::get(alice()).expect("record");
        assert_eq!(record.snapshot_bond, 1_000);
        assert_eq!(record.snapshot_epoch, 7);
    });
}

#[test]
fn top_up_refuses_zero_an_unenrolled_account_and_an_unpayable_amount() {
    new_test_ext().execute_with(|| {
        assert_noop!(
            TradingRewards::top_up_bond(RuntimeOrigin::signed(alice()), 1_000),
            Error::<Test>::NotEnrolled
        );
        assert_ok!(TradingRewards::enroll(
            RuntimeOrigin::signed(alice()),
            1_000
        ));
        assert_noop!(
            TradingRewards::top_up_bond(RuntimeOrigin::signed(alice()), 0),
            Error::<Test>::AmountZero
        );
        let funds = usdc_balance(&alice());
        assert_noop!(
            TradingRewards::top_up_bond(RuntimeOrigin::signed(alice()), funds + 1),
            Error::<Test>::BondCustody
        );
        assert_eq!(usdc_balance(&alice()), funds);
        assert_eq!(held_usdc(&alice()), 1_000);
    });
}

#[test]
fn a_top_up_that_restores_the_minimum_clears_the_suspension() {
    // 08 §2.6: a debit that takes the whole bond "suspends the participant
    // until they top up". A top-up that still leaves the account under the
    // minimum has not restored anything, so the suspension stands.
    new_test_ext().execute_with(|| {
        assert_ok!(TradingRewards::enroll(
            RuntimeOrigin::signed(alice()),
            1_000
        ));
        Participants::<Test>::mutate(alice(), |slot| {
            let record = slot.as_mut().expect("record");
            record.bond = 0;
            record.snapshot_bond = 0;
            record.suspended = true;
        });

        assert_ok!(TradingRewards::top_up_bond(
            RuntimeOrigin::signed(alice()),
            50
        ));
        assert!(
            Participants::<Test>::get(alice())
                .expect("record")
                .suspended,
            "50 is under the live minimum of 100"
        );

        assert_ok!(TradingRewards::top_up_bond(
            RuntimeOrigin::signed(alice()),
            50
        ));
        let record = Participants::<Test>::get(alice()).expect("record");
        assert_eq!(record.bond, 100);
        assert!(!record.suspended, "the minimum is restored");
        assert_eq!(record.snapshot_bond, 0, "the cap still does not move");
    });
}

// ---------------------------------------------------------------------------
// Withdrawal
// ---------------------------------------------------------------------------

#[test]
fn withdraw_refuses_while_an_epoch_is_unsettled() {
    new_test_ext().execute_with(|| {
        assert_ok!(TradingRewards::enroll(
            RuntimeOrigin::signed(alice()),
            1_000
        ));
        record_test_score(&alice(), MARKET_A, 0, 500);
        assert_noop!(
            TradingRewards::withdraw_bond(RuntimeOrigin::signed(alice())),
            Error::<Test>::EpochUnsettled
        );
        assert_eq!(held_usdc(&alice()), 1_000, "nothing is released");
        assert_eq!(sovereign_usdc(), 1_000);
    });
}

#[test]
fn withdraw_refuses_after_a_fold_until_the_epoch_settles() {
    // 08 §2.6, first review finding: folding deletes the last score entry while
    // the debit settles at epoch close, so a fold-based gate would let a
    // participant who folded a losing epoch release the whole bond ahead of the
    // debit. The gate is epoch settlement, never folding.
    new_test_ext().execute_with(|| {
        assert_ok!(TradingRewards::enroll(
            RuntimeOrigin::signed(alice()),
            1_000
        ));
        record_test_score(&alice(), MARKET_A, 1_000, 0);
        // Fold: the score entry is gone and the loss lives in the epoch total.
        Scores::<Test>::remove(alice(), MARKET_A);
        ScoreCount::<Test>::insert(alice(), 0);
        record_test_epoch_score(&alice(), 1_000, 0);

        assert_eq!(ScoreCount::<Test>::get(alice()), 0, "the fold completed");
        assert_noop!(
            TradingRewards::withdraw_bond(RuntimeOrigin::signed(alice())),
            Error::<Test>::EpochUnsettled
        );
        assert_eq!(sovereign_usdc(), 1_000, "the debit's backing is still held");
    });
}

#[test]
fn a_winning_folded_epoch_is_gated_too() {
    // The gate is about settlement, not about the sign of the score. A gate
    // that only blocked losses would let a winner release the bond the reward
    // is sized against.
    new_test_ext().execute_with(|| {
        assert_ok!(TradingRewards::enroll(
            RuntimeOrigin::signed(alice()),
            1_000
        ));
        record_test_epoch_score(&alice(), 0, 5_000);
        assert_noop!(
            TradingRewards::withdraw_bond(RuntimeOrigin::signed(alice())),
            Error::<Test>::EpochUnsettled
        );
    });
}

#[test]
fn withdraw_releases_the_whole_bond_and_closes_the_record() {
    new_test_ext().execute_with(|| {
        let funds = usdc_balance(&alice());
        assert_ok!(TradingRewards::enroll(
            RuntimeOrigin::signed(alice()),
            1_000
        ));
        assert_ok!(TradingRewards::withdraw_bond(
            RuntimeOrigin::signed(alice())
        ));
        assert_eq!(usdc_balance(&alice()), funds, "the whole bond came back");
        assert_eq!(sovereign_usdc(), 0);
        assert!(Participants::<Test>::get(alice()).is_none());
        assert_eq!(ParticipantCount::<Test>::get(), 0);
        assert!(!TradingRewards::is_enrolled(&alice()));
        assert!(events()
            .iter()
            .any(|event| matches!(event, Event::BondWithdrawn { amount, .. } if *amount == 1_000)));
        assert_ok!(TradingRewards::do_try_state());
    });
}

#[test]
fn one_withdrawal_leaves_every_other_bond_in_custody() {
    // The sovereign pools bonds. A release that took the pooled balance rather
    // than the account's own would pass a single-participant test.
    new_test_ext().execute_with(|| {
        assert_ok!(TradingRewards::enroll(
            RuntimeOrigin::signed(alice()),
            1_000
        ));
        assert_ok!(TradingRewards::enroll(RuntimeOrigin::signed(bob()), 7_000));
        assert_eq!(sovereign_usdc(), 8_000);

        assert_ok!(TradingRewards::withdraw_bond(
            RuntimeOrigin::signed(alice())
        ));
        assert_eq!(sovereign_usdc(), 7_000, "only Alice's bond left custody");
        assert_eq!(held_usdc(&bob()), 7_000);
        assert_eq!(ParticipantCount::<Test>::get(), 1);
        assert_ok!(TradingRewards::do_try_state());
    });
}

#[test]
fn withdraw_refuses_while_a_reward_is_unclaimed() {
    // Closing the record would destroy the claim. Refusing is the status-quo
    // default, and the remedy is one call the participant already has.
    new_test_ext().execute_with(|| {
        assert_ok!(TradingRewards::enroll(
            RuntimeOrigin::signed(alice()),
            1_000
        ));
        record_test_accrual(&alice(), 25);
        assert_noop!(
            TradingRewards::withdraw_bond(RuntimeOrigin::signed(alice())),
            Error::<Test>::RewardsUnclaimed
        );
        assert_eq!(sovereign_usdc(), 1_000);

        VitUsdcRate::set(Some(30_000_000));
        fund_reward_budget(1_000_000_000_000);
        assert_ok!(TradingRewards::claim_rewards(
            RuntimeOrigin::signed(alice())
        ));
        assert_ok!(TradingRewards::withdraw_bond(
            RuntimeOrigin::signed(alice())
        ));
        assert!(Participants::<Test>::get(alice()).is_none());
    });
}

#[test]
fn withdraw_refuses_an_account_that_never_enrolled() {
    new_test_ext().execute_with(|| {
        assert_noop!(
            TradingRewards::withdraw_bond(RuntimeOrigin::signed(alice())),
            Error::<Test>::NotEnrolled
        );
    });
}

#[test]
fn a_suspended_account_with_no_bond_can_still_close_its_record() {
    new_test_ext().execute_with(|| {
        assert_ok!(TradingRewards::enroll(
            RuntimeOrigin::signed(alice()),
            1_000
        ));
        Participants::<Test>::mutate(alice(), |slot| {
            let record = slot.as_mut().expect("record");
            record.bond = 0;
            record.snapshot_bond = 0;
            record.suspended = true;
        });
        // The forfeited USDC stays in custody; it is INSURANCE's at settlement,
        // which is TR5's move, not this account's.
        assert_ok!(TradingRewards::withdraw_bond(
            RuntimeOrigin::signed(alice())
        ));
        assert!(Participants::<Test>::get(alice()).is_none());
        assert_eq!(ParticipantCount::<Test>::get(), 0);
        assert_eq!(sovereign_usdc(), 1_000, "a zero bond releases nothing");
    });
}

// ---------------------------------------------------------------------------
// Claims
// ---------------------------------------------------------------------------

#[test]
fn claim_converts_at_the_live_rate_flooring_against_the_claimant() {
    // 08 §2.6: both legs are USDC and only the payout converts, once, at the
    // live `fee.vit_usdc_rate`, rounding against the claimant.
    //
    // At 0.03 USDC/VIT one base unit of USDC is 1e21 / 3e13 =
    // 33,333,333.33 planck. The floor is 33,333,333; a ceiling would give
    // 33,333,334 and a round-to-nearest the same, so this pins the direction.
    new_test_ext().execute_with(|| {
        VitUsdcRate::set(Some(30_000_000));
        fund_reward_budget(1_000_000_000_000);
        assert_ok!(TradingRewards::enroll(
            RuntimeOrigin::signed(alice()),
            1_000
        ));
        record_test_accrual(&alice(), 1);

        let before = vit_balance(&alice());
        assert_ok!(TradingRewards::claim_rewards(
            RuntimeOrigin::signed(alice())
        ));
        assert_eq!(vit_balance(&alice()) - before, 33_333_333);
        let record = Participants::<Test>::get(alice()).expect("record");
        assert_eq!(record.accrued, 0, "the accrual is spent, not re-payable");
        assert_eq!(TotalAccrued::<Test>::get(), 0);
        assert_ok!(TradingRewards::do_try_state());
    });
}

#[test]
fn claim_scales_with_the_accrual_and_with_the_rate() {
    // Two independent movements, so a conversion that ignored either input
    // cannot pass: three base units at the same rate pay exactly 1e8 planck,
    // and halving the rate doubles the payout.
    new_test_ext().execute_with(|| {
        VitUsdcRate::set(Some(30_000_000));
        fund_reward_budget(1_000_000_000_000);
        assert_ok!(TradingRewards::enroll(
            RuntimeOrigin::signed(alice()),
            1_000
        ));
        record_test_accrual(&alice(), 3);
        let before = vit_balance(&alice());
        assert_ok!(TradingRewards::claim_rewards(
            RuntimeOrigin::signed(alice())
        ));
        assert_eq!(vit_balance(&alice()) - before, 100_000_000);

        VitUsdcRate::set(Some(15_000_000));
        record_test_accrual(&alice(), 3);
        let before = vit_balance(&alice());
        assert_ok!(TradingRewards::claim_rewards(
            RuntimeOrigin::signed(alice())
        ));
        assert_eq!(vit_balance(&alice()) - before, 200_000_000);
    });
}

#[test]
fn claim_refuses_with_the_vit_rate_unset_and_moves_nothing() {
    // `fee.vit_usdc` is unseeded at genesis, so this is an ordinary state.
    new_test_ext().execute_with(|| {
        fund_reward_budget(1_000_000_000_000);
        assert_ok!(TradingRewards::enroll(
            RuntimeOrigin::signed(alice()),
            1_000
        ));
        record_test_accrual(&alice(), 25);
        let before = vit_balance(&alice());
        assert_noop!(
            TradingRewards::claim_rewards(RuntimeOrigin::signed(alice())),
            Error::<Test>::VitRateUnset
        );
        assert_eq!(vit_balance(&alice()), before);
        assert_eq!(
            Participants::<Test>::get(alice()).expect("record").accrued,
            25,
            "the claim survives the refusal"
        );
    });
}

#[test]
fn claim_refuses_when_the_budget_cannot_cover_the_payout() {
    // 08 §2.6: accrued reward is paid from the authorized budget alone and the
    // program never draws on MAIN. A short budget is a refusal, never a partial
    // payment that would zero the claim.
    new_test_ext().execute_with(|| {
        VitUsdcRate::set(Some(30_000_000));
        assert_ok!(TradingRewards::enroll(
            RuntimeOrigin::signed(alice()),
            1_000
        ));
        record_test_accrual(&alice(), 3);
        // The payout is 1e8 planck; fund one planck less than that.
        fund_reward_budget(100_000_000 - 1);
        let before = vit_balance(&alice());
        assert_noop!(
            TradingRewards::claim_rewards(RuntimeOrigin::signed(alice())),
            Error::<Test>::RewardCustody
        );
        assert_eq!(vit_balance(&alice()), before);
        assert_eq!(
            Participants::<Test>::get(alice()).expect("record").accrued,
            3
        );
        assert_eq!(TotalAccrued::<Test>::get(), 3);
    });
}

#[test]
fn claim_refuses_with_nothing_accrued() {
    new_test_ext().execute_with(|| {
        VitUsdcRate::set(Some(30_000_000));
        assert_ok!(TradingRewards::enroll(
            RuntimeOrigin::signed(alice()),
            1_000
        ));
        assert_noop!(
            TradingRewards::claim_rewards(RuntimeOrigin::signed(alice())),
            Error::<Test>::NothingToClaim
        );
    });
}

#[test]
fn claim_refuses_an_account_that_never_enrolled() {
    new_test_ext().execute_with(|| {
        VitUsdcRate::set(Some(30_000_000));
        assert_noop!(
            TradingRewards::claim_rewards(RuntimeOrigin::signed(alice())),
            Error::<Test>::NotEnrolled
        );
    });
}

#[test]
fn a_payout_that_floors_to_zero_vit_is_refused_rather_than_burning_the_claim() {
    new_test_ext().execute_with(|| {
        // A rate this large is far outside the governed envelope; it is the
        // only way to reach the floor-to-zero branch, and the branch must
        // still keep the claim rather than spend it for nothing.
        VitUsdcRate::set(Some(u64::MAX));
        fund_reward_budget(1_000_000_000_000);
        assert_ok!(TradingRewards::enroll(
            RuntimeOrigin::signed(alice()),
            1_000
        ));
        record_test_accrual(&alice(), 1);
        assert_noop!(
            TradingRewards::claim_rewards(RuntimeOrigin::signed(alice())),
            Error::<Test>::NothingToClaim
        );
        assert_eq!(
            Participants::<Test>::get(alice()).expect("record").accrued,
            1
        );
    });
}

// ---------------------------------------------------------------------------
// Origins (rule 6; 15 §4.1 origin misuse)
// ---------------------------------------------------------------------------

#[test]
fn every_call_refuses_an_unsigned_and_a_root_origin() {
    new_test_ext().execute_with(|| {
        for (name, none, root) in [
            (
                "enroll",
                TradingRewards::enroll(RuntimeOrigin::none(), 1_000),
                TradingRewards::enroll(RuntimeOrigin::root(), 1_000),
            ),
            (
                "top_up_bond",
                TradingRewards::top_up_bond(RuntimeOrigin::none(), 1_000),
                TradingRewards::top_up_bond(RuntimeOrigin::root(), 1_000),
            ),
            (
                "withdraw_bond",
                TradingRewards::withdraw_bond(RuntimeOrigin::none()),
                TradingRewards::withdraw_bond(RuntimeOrigin::root()),
            ),
            (
                "claim_rewards",
                TradingRewards::claim_rewards(RuntimeOrigin::none()),
                TradingRewards::claim_rewards(RuntimeOrigin::root()),
            ),
        ] {
            assert_eq!(none, Err(DispatchError::BadOrigin), "{name} took none");
            assert_eq!(root, Err(DispatchError::BadOrigin), "{name} took root");
        }
        assert_eq!(ParticipantCount::<Test>::get(), 0);
        assert_eq!(sovereign_usdc(), 0);
    });
}

// ---------------------------------------------------------------------------
// try-state (rule 8; design §8)
// ---------------------------------------------------------------------------

#[test]
fn try_state_catches_a_snapshot_cap_above_the_held_bond() {
    new_test_ext().execute_with(|| {
        assert_ok!(TradingRewards::enroll(
            RuntimeOrigin::signed(alice()),
            1_000
        ));
        assert_ok!(TradingRewards::do_try_state());
        Participants::<Test>::mutate(alice(), |slot| {
            slot.as_mut().expect("record").snapshot_bond = 1_001;
        });
        assert!(TradingRewards::do_try_state().is_err());
    });
}

#[test]
fn try_state_catches_an_accrual_mirror_that_drifted() {
    new_test_ext().execute_with(|| {
        assert_ok!(TradingRewards::enroll(
            RuntimeOrigin::signed(alice()),
            1_000
        ));
        Participants::<Test>::mutate(alice(), |slot| {
            slot.as_mut().expect("record").accrued = 5;
        });
        assert!(
            TradingRewards::do_try_state().is_err(),
            "an accrual without its mirror is exactly TR5's failure mode"
        );
        TotalAccrued::<Test>::put(5);
        assert_ok!(TradingRewards::do_try_state());
    });
}

#[test]
fn try_state_catches_a_bond_total_the_sovereign_cannot_back() {
    new_test_ext().execute_with(|| {
        assert_ok!(TradingRewards::enroll(
            RuntimeOrigin::signed(alice()),
            1_000
        ));
        assert_ok!(TradingRewards::do_try_state());
        assert!(<Assets as MutateAsset<_>>::burn_from(
            UsdcAssetId::get(),
            &TradingRewards::account_id(),
            1,
            frame_support::traits::tokens::Preservation::Expendable,
            frame_support::traits::tokens::Precision::Exact,
            frame_support::traits::tokens::Fortitude::Force,
        )
        .is_ok());
        assert!(TradingRewards::do_try_state().is_err());
    });
}

#[test]
fn try_state_tolerates_a_donation_to_the_sovereign() {
    // The sovereign is publicly addressable. Surplus must not make try-state,
    // and therefore an upgrade, externally haltable.
    new_test_ext().execute_with(|| {
        assert_ok!(TradingRewards::enroll(
            RuntimeOrigin::signed(alice()),
            1_000
        ));
        mint_usdc(&TradingRewards::account_id(), 77);
        assert_ok!(TradingRewards::do_try_state());
    });
}

#[test]
fn try_state_catches_a_live_bond_under_the_minimum() {
    new_test_ext().execute_with(|| {
        assert_ok!(TradingRewards::enroll(
            RuntimeOrigin::signed(alice()),
            1_000
        ));
        Participants::<Test>::mutate(alice(), |slot| {
            let record = slot.as_mut().expect("record");
            record.bond = 99;
            record.snapshot_bond = 99;
        });
        assert!(TradingRewards::do_try_state().is_err());
    });
}

#[test]
fn try_state_catches_score_bookkeeping_that_disagrees() {
    new_test_ext().execute_with(|| {
        assert_ok!(TradingRewards::enroll(
            RuntimeOrigin::signed(alice()),
            1_000
        ));
        record_test_score(&alice(), MARKET_A, 10, 20);
        assert_ok!(TradingRewards::do_try_state());

        // A counter that over-reports its prefix.
        ScoreCount::<Test>::insert(alice(), 2);
        assert!(TradingRewards::do_try_state().is_err());
        ScoreCount::<Test>::insert(alice(), 1);

        // A score row for an account with no record at all.
        record_test_score(&bob(), MARKET_B, 1, 2);
        assert!(TradingRewards::do_try_state().is_err());
    });
}

#[test]
fn try_state_catches_a_participant_counter_that_drifted() {
    new_test_ext().execute_with(|| {
        assert_ok!(TradingRewards::enroll(
            RuntimeOrigin::signed(alice()),
            1_000
        ));
        ParticipantCount::<Test>::put(2);
        assert!(TradingRewards::do_try_state().is_err());
    });
}
