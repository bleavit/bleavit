//! Mock-runtime tests for `pallet-trading-rewards` (15 §4.1).
//!
//! Every governed row the pallet reads is a mutable static in the mock, so the
//! tests move the row and watch the boundary move. A test that only checks the
//! pallet agrees with one hard-coded number cannot tell a live read from a
//! pinned constant.

use crate::mock::*;
use crate::{
    Error, Event, ParticipantCount, Participants, ScoreCount, Scores, TotalAccrued,
    MAX_PARTICIPANTS, MAX_SCORED_MARKETS_PER_ACCOUNT,
};
use frame_support::traits::fungibles::Mutate as MutateAsset;
use frame_support::{assert_noop, assert_ok};
use futarchy_primitives::Balance;
use market_core::{TradeObserver, SCORE_SIDE_LONG, SCORE_SIDE_SHORT};
use sp_runtime::DispatchError;
use trading_rewards_core::BranchDisposition;

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
        assert!(TradingRewards::scores_fills(&alice()));
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
        assert!(!TradingRewards::scores_fills(&alice()));
        assert!(events().iter().any(|event| matches!(
            event,
            Event::BondWithdrawn {
                amount,
                record_retained: false,
                ..
            } if *amount == 1_000
        )));
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
fn withdraw_releases_the_bond_and_retains_the_record_while_a_reward_is_unclaimed() {
    // Closing the record would destroy the claim, so the record survives at a
    // zero bond — but the USDC still comes back, because 08 §2.6 conditions
    // withdrawal on settlement alone.
    new_test_ext().execute_with(|| {
        let funds = usdc_balance(&alice());
        assert_ok!(TradingRewards::enroll(
            RuntimeOrigin::signed(alice()),
            1_000
        ));
        record_test_accrual(&alice(), 25);

        assert_ok!(TradingRewards::withdraw_bond(
            RuntimeOrigin::signed(alice())
        ));
        assert_eq!(usdc_balance(&alice()), funds, "the whole bond came back");
        assert_eq!(sovereign_usdc(), 0);

        let record = Participants::<Test>::get(alice()).expect("record retained");
        assert_eq!(record.bond, 0);
        assert_eq!(record.snapshot_bond, 0, "the cap follows the bond down");
        assert_eq!(record.accrued, 25, "the claim survives");
        assert_eq!(TotalAccrued::<Test>::get(), 25);
        assert!(events().iter().any(|event| matches!(
            event,
            Event::BondWithdrawn {
                record_retained: true,
                ..
            }
        )));
        assert_ok!(TradingRewards::do_try_state());
    });
}

#[test]
fn an_empty_budget_cannot_hold_the_bond_hostage() {
    // The exact trap: 08 §2.6 returns unspent budget to the pot at epoch close,
    // so an accrual outstanding past that boundary meets an empty budget. If
    // withdrawal refused on an unclaimed accrual the participant could neither
    // claim nor withdraw, and the only remedy would be a FutarchyParam call
    // they cannot make. 08 §2.6 separately forbids a bond locked forever.
    new_test_ext().execute_with(|| {
        let funds = usdc_balance(&alice());
        VitUsdcRate::set(Some(30_000_000));
        assert_ok!(TradingRewards::enroll(
            RuntimeOrigin::signed(alice()),
            1_000
        ));
        record_test_accrual(&alice(), 3);

        // The budget has swept back to the pot: the claim cannot be paid.
        assert_noop!(
            TradingRewards::claim_rewards(RuntimeOrigin::signed(alice())),
            Error::<Test>::RewardCustody
        );
        // The bond is nonetheless returned in full.
        assert_ok!(TradingRewards::withdraw_bond(
            RuntimeOrigin::signed(alice())
        ));
        assert_eq!(usdc_balance(&alice()), funds);
        assert_eq!(
            Participants::<Test>::get(alice())
                .expect("record retained")
                .accrued,
            3,
            "and the unpayable claim is still owed"
        );

        // When the next budget is authorized the claim pays and the slot frees.
        fund_reward_budget(1_000_000_000_000);
        assert_ok!(TradingRewards::claim_rewards(
            RuntimeOrigin::signed(alice())
        ));
        assert!(Participants::<Test>::get(alice()).is_none());
        assert_eq!(ParticipantCount::<Test>::get(), 0);
    });
}

#[test]
fn claiming_a_retained_record_closes_it_and_frees_the_roster_slot() {
    // A retained record holds exactly one slot, and the call the claimant
    // already wants to make is what returns it. Nothing depends on them
    // remembering a second call, so a retained record cannot starve the roster.
    new_test_ext().execute_with(|| {
        VitUsdcRate::set(Some(30_000_000));
        fund_reward_budget(1_000_000_000_000);
        assert_ok!(TradingRewards::enroll(
            RuntimeOrigin::signed(alice()),
            1_000
        ));
        record_test_accrual(&alice(), 3);
        assert_ok!(TradingRewards::withdraw_bond(
            RuntimeOrigin::signed(alice())
        ));
        assert_eq!(
            ParticipantCount::<Test>::get(),
            1,
            "the retained record keeps the one slot it had, never a second"
        );

        assert_ok!(TradingRewards::claim_rewards(
            RuntimeOrigin::signed(alice())
        ));
        assert!(Participants::<Test>::get(alice()).is_none());
        assert_eq!(ParticipantCount::<Test>::get(), 0, "the slot came back");
        assert!(events().iter().any(|event| matches!(
            event,
            Event::RewardsClaimed {
                record_closed: true,
                ..
            }
        )));
        assert_ok!(TradingRewards::do_try_state());

        // And the freed slot is genuinely reusable.
        assert_ok!(TradingRewards::enroll(RuntimeOrigin::signed(bob()), 1_000));
        assert_eq!(ParticipantCount::<Test>::get(), 1);
    });
}

#[test]
fn a_claim_by_a_bonded_participant_leaves_the_record_open() {
    // The close is conditional on nothing being left, not on claiming.
    new_test_ext().execute_with(|| {
        VitUsdcRate::set(Some(30_000_000));
        fund_reward_budget(1_000_000_000_000);
        assert_ok!(TradingRewards::enroll(
            RuntimeOrigin::signed(alice()),
            1_000
        ));
        record_test_accrual(&alice(), 3);
        assert_ok!(TradingRewards::claim_rewards(
            RuntimeOrigin::signed(alice())
        ));
        let record = Participants::<Test>::get(alice()).expect("record still open");
        assert_eq!(record.bond, 1_000);
        assert_eq!(record.accrued, 0);
        assert_eq!(ParticipantCount::<Test>::get(), 1);
        assert!(events().iter().any(|event| matches!(
            event,
            Event::RewardsClaimed {
                record_closed: false,
                ..
            }
        )));
    });
}

#[test]
fn a_retained_record_can_be_topped_up_back_into_the_program() {
    new_test_ext().execute_with(|| {
        assert_ok!(TradingRewards::enroll(
            RuntimeOrigin::signed(alice()),
            1_000
        ));
        record_test_accrual(&alice(), 3);
        assert_ok!(TradingRewards::withdraw_bond(
            RuntimeOrigin::signed(alice())
        ));
        assert_ok!(TradingRewards::top_up_bond(
            RuntimeOrigin::signed(alice()),
            2_000
        ));
        let record = Participants::<Test>::get(alice()).expect("record");
        assert_eq!(record.bond, 2_000);
        assert_eq!(
            record.snapshot_bond, 0,
            "and the cap still waits for a settlement, as every top-up does"
        );
        assert_eq!(sovereign_usdc(), 2_000);
        assert_ok!(TradingRewards::do_try_state());
    });
}

#[test]
fn a_retained_record_cannot_be_re_enrolled_into_a_second_slot() {
    // Double-counting against MaxParticipants is the failure mode retention
    // could introduce. `enroll` still sees the record.
    new_test_ext().execute_with(|| {
        assert_ok!(TradingRewards::enroll(
            RuntimeOrigin::signed(alice()),
            1_000
        ));
        record_test_accrual(&alice(), 3);
        assert_ok!(TradingRewards::withdraw_bond(
            RuntimeOrigin::signed(alice())
        ));
        assert_noop!(
            TradingRewards::enroll(RuntimeOrigin::signed(alice()), 1_000),
            Error::<Test>::AlreadyEnrolled
        );
        assert_eq!(ParticipantCount::<Test>::get(), 1);
    });
}

#[test]
fn a_retained_record_is_still_gated_on_settlement() {
    // Retention must not become a way past the settlement gate on the way back
    // out: a score row on a zero-bond record still refuses, and a claim cannot
    // close a record whose score is outstanding.
    new_test_ext().execute_with(|| {
        assert_ok!(TradingRewards::enroll(
            RuntimeOrigin::signed(alice()),
            1_000
        ));
        record_test_accrual(&alice(), 3);
        assert_ok!(TradingRewards::withdraw_bond(
            RuntimeOrigin::signed(alice())
        ));
        record_test_score(&alice(), MARKET_A, 0, 500);
        assert_noop!(
            TradingRewards::withdraw_bond(RuntimeOrigin::signed(alice())),
            Error::<Test>::EpochUnsettled
        );

        VitUsdcRate::set(Some(30_000_000));
        fund_reward_budget(1_000_000_000_000);
        assert_ok!(TradingRewards::claim_rewards(
            RuntimeOrigin::signed(alice())
        ));
        assert!(
            Participants::<Test>::get(alice()).is_some(),
            "the score row keeps the record open"
        );
        assert_eq!(ParticipantCount::<Test>::get(), 1);
        // **Amended by TR4.** This fixture injects a score row *after* the
        // withdrawal, which no production path can do: `withdraw_bond` refuses
        // unless the prefix is empty, and the fill observer refuses to open a
        // row for an account with no bond. TR4 made that implication a
        // `try-state` invariant, because it is what keeps the observer's
        // bond gate loss-symmetric — so the state this test builds on purpose
        // is now a *detected* one. The two refusals above are the point of the
        // test and are unchanged; what changed is that the trailing check now
        // states which of the two claims about this state is true.
        assert!(
            TradingRewards::do_try_state().is_err(),
            "a score row under a zero bond is unreachable, and try-state says so"
        );
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
            (
                "settle_market_score",
                TradingRewards::settle_market_score(RuntimeOrigin::none(), alice(), MARKET_A),
                TradingRewards::settle_market_score(RuntimeOrigin::root(), alice(), MARKET_A),
            ),
            (
                "settle_epoch",
                TradingRewards::settle_epoch(RuntimeOrigin::none(), alice()),
                TradingRewards::settle_epoch(RuntimeOrigin::root(), alice()),
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

// ---------------------------------------------------------------------------
// The fill observer (08 §2.6)
// ---------------------------------------------------------------------------

/// One fill, reported exactly as `pallet-market` reports it.
#[allow(clippy::too_many_arguments)]
fn observe(
    who: &sp_core::crypto::AccountId32,
    market: futarchy_primitives::MarketId,
    side: usize,
    qty: Balance,
    cost: Balance,
    fee: Balance,
    is_buy: bool,
) {
    <TradingRewards as TradeObserver<_>>::observe_fill(who, market, side, qty, cost, fee, is_buy);
}

fn enrolled_alice(bond: Balance) {
    assert_ok!(TradingRewards::enroll(RuntimeOrigin::signed(alice()), bond));
}

#[test]
fn a_fill_by_an_enrolled_account_records_the_cost_and_the_fee() {
    new_test_ext().execute_with(|| {
        enrolled_alice(1_000);
        // Distinct qty, cost and fee, so a score built from the wrong argument
        // cannot land on the right number by coincidence.
        observe(&alice(), MARKET_A, SCORE_SIDE_LONG, 700, 500, 3, true);

        let score = Scores::<Test>::get(alice(), MARKET_A).expect("the fill was scored");
        // 08 §2.6: "a buy adds `cost + fee` to `spent`". An implementation that
        // passed `cost` alone would record 500 here.
        assert_eq!(score.spent, 503);
        assert_eq!(score.received, 0);
        assert_eq!(score.book_acquired, [700, 0]);
        assert_eq!(ScoreCount::<Test>::get(alice()), 1);
        assert_ok!(TradingRewards::do_try_state());
    });
}

#[test]
fn a_short_fill_credits_the_short_branch() {
    new_test_ext().execute_with(|| {
        enrolled_alice(1_000);
        observe(&alice(), MARKET_A, SCORE_SIDE_SHORT, 700, 500, 3, true);
        let score = Scores::<Test>::get(alice(), MARKET_A).expect("the fill was scored");
        assert_eq!(
            score.book_acquired,
            [0, 700],
            "a SHORT buy must not credit the LONG branch",
        );
        assert_ok!(TradingRewards::do_try_state());
    });
}

#[test]
fn a_fill_by_a_non_enrolled_account_records_nothing() {
    new_test_ext().execute_with(|| {
        observe(&bob(), MARKET_A, SCORE_SIDE_LONG, 700, 500, 3, true);
        assert!(Scores::<Test>::get(bob(), MARKET_A).is_none());
        assert_eq!(ScoreCount::<Test>::get(bob()), 0);
        assert!(Participants::<Test>::get(bob()).is_none());
        assert_ok!(TradingRewards::do_try_state());
    });
}

#[test]
fn a_fill_by_a_bond_free_retained_record_records_nothing() {
    // `withdraw_bond` keeps the record alive at `bond = 0` to carry an
    // unclaimed accrual. Skipping its fills is safe because an unscored buy
    // raises no `book_acquired`, so the `book_acquired` rule credits zero at
    // settlement for exactly the units whose `spent` was skipped — not
    // because the cap is zero (a score can fold into a later epoch whose cap
    // is real). Every row it created would also block `claim_rewards` from
    // closing the record and returning its roster slot. A bare
    // `contains_key` predicate scores it.
    new_test_ext().execute_with(|| {
        enrolled_alice(1_000);
        record_test_accrual(&alice(), 250);
        assert_ok!(TradingRewards::withdraw_bond(
            RuntimeOrigin::signed(alice())
        ));
        let record = Participants::<Test>::get(alice()).expect("the record was retained");
        assert_eq!(record.bond, 0);
        assert_eq!(record.accrued, 250);

        observe(&alice(), MARKET_A, SCORE_SIDE_LONG, 700, 500, 3, true);

        assert!(Scores::<Test>::get(alice(), MARKET_A).is_none());
        assert_eq!(ScoreCount::<Test>::get(alice()), 0);
        assert_ok!(TradingRewards::do_try_state());
    });
}

#[test]
fn a_topped_up_account_is_scored_even_while_its_snapshot_is_still_zero() {
    // The complement of the test above, and the reason the predicate is the
    // bond rather than the snapshot. A participant debited to zero and then
    // topped up carries `bond > 0` with `snapshot_bond` still 0 until
    // settlement re-snapshots. 08 §2.6 defers the **cap** to the next epoch,
    // not the accounting: a snapshot predicate would drop these fills, and
    // with them the losses the bond exists to cover.
    new_test_ext().execute_with(|| {
        enrolled_alice(1_000);
        // What a full debit leaves behind (TR5 writes this shape).
        Participants::<Test>::mutate(alice(), |slot| {
            if let Some(record) = slot.as_mut() {
                record.bond = 0;
                record.snapshot_bond = 0;
                record.suspended = true;
            }
        });
        assert_ok!(<Assets as MutateAsset<_>>::transfer(
            UsdcAssetId::get(),
            &TradingRewards::account_id(),
            &alice(),
            1_000,
            frame_support::traits::tokens::Preservation::Expendable,
        ));

        assert_ok!(TradingRewards::top_up_bond(
            RuntimeOrigin::signed(alice()),
            1_000
        ));
        let record = Participants::<Test>::get(alice()).expect("record survives the debit");
        assert_eq!(record.bond, 1_000);
        assert_eq!(
            record.snapshot_bond, 0,
            "the top-up must not move the snapshot; the test is vacuous if it does",
        );
        assert!(
            !record.suspended,
            "a top-up to the minimum clears the flag; the fill below is admitted \
             by the conjunction's other half, not in spite of it",
        );

        observe(&alice(), MARKET_A, SCORE_SIDE_LONG, 700, 500, 3, true);

        let score = Scores::<Test>::get(alice(), MARKET_A).expect("the fill was scored");
        assert_eq!(score.spent, 503);
        assert_ok!(TradingRewards::do_try_state());
    });
}

// ---------------------------------------------------------------------------
// Obligation 6 (SQ-1050): the admission condition is a conjunction
// ---------------------------------------------------------------------------

#[test]
fn a_suspended_account_holding_a_live_bond_records_nothing() {
    // The flag half of the conjunction, and the half a balance gate misses.
    // `top_up_bond` clears `suspended` only once the bond is back at the live
    // minimum, so a **sub-minimum** top-up leaves a suspended participant with
    // a nonzero bond. 08 §2.6 (SQ-1050): "Suspension suspends scoring, and the
    // accumulator MUST test the suspension flag rather than infer it from a
    // nonzero bond."
    new_test_ext().execute_with(|| {
        enrolled_alice(1_000);
        // What a debit that took the whole bond leaves behind.
        Participants::<Test>::mutate(alice(), |slot| {
            if let Some(record) = slot.as_mut() {
                record.bond = 0;
                record.snapshot_bond = 0;
                record.suspended = true;
            }
        });
        assert_ok!(<Assets as MutateAsset<_>>::transfer(
            UsdcAssetId::get(),
            &TradingRewards::account_id(),
            &alice(),
            1_000,
            frame_support::traits::tokens::Preservation::Expendable,
        ));
        // A top-up strictly below the live minimum of 100: the bond is now
        // nonzero and the flag is still set.
        assert_ok!(TradingRewards::top_up_bond(
            RuntimeOrigin::signed(alice()),
            99
        ));
        let record = Participants::<Test>::get(alice()).expect("record");
        assert_eq!(record.bond, 99, "the bond gate alone would admit this fill");
        assert!(record.suspended, "and the flag alone would refuse it");
        assert!(!TradingRewards::scores_fills(&alice()));

        observe(&alice(), MARKET_A, SCORE_SIDE_LONG, 700, 500, 3, true);

        assert!(
            Scores::<Test>::get(alice(), MARKET_A).is_none(),
            "a suspended participant is out of the program until the minimum is back"
        );
        assert_eq!(ScoreCount::<Test>::get(alice()), 0);
        // And the complement, in the same test, so a gate hardcoded to refuse
        // cannot pass: restoring the minimum clears the flag and scoring
        // resumes with nothing else changed.
        assert_ok!(TradingRewards::top_up_bond(
            RuntimeOrigin::signed(alice()),
            1
        ));
        let record = Participants::<Test>::get(alice()).expect("record");
        assert_eq!(record.bond, 100);
        assert!(!record.suspended);
        observe(&alice(), MARKET_A, SCORE_SIDE_LONG, 700, 500, 3, true);
        let score = Scores::<Test>::get(alice(), MARKET_A).expect("the fill was scored");
        assert_eq!(score.spent, 503);
        assert_ok!(TradingRewards::do_try_state());
    });
}

#[test]
fn try_state_catches_a_score_row_under_a_suspension() {
    // The suspension half of the same narrowing. A suspended account holding a
    // live row would have its sales skipped while the buy leg stays recorded,
    // which is the full-notional direction R-7 forbids; two gates make it
    // unreachable and this makes that a property of the state at rest.
    new_test_ext().execute_with(|| {
        enrolled_alice(1_000);
        record_test_score(&alice(), MARKET_A, 10, 0);
        assert_ok!(TradingRewards::do_try_state());
        Participants::<Test>::mutate(alice(), |slot| {
            if let Some(record) = slot.as_mut() {
                record.suspended = true;
            }
        });
        assert!(TradingRewards::do_try_state().is_err());
    });
}

// ---------------------------------------------------------------------------
// Obligations 1 and 7: the two new `MarketScore` fields
// ---------------------------------------------------------------------------

#[test]
fn a_buy_records_the_mirror_principal_without_the_fee() {
    // 08 §2.6 rule 1 (SQ-1051). The wrapper splits `cost + fee` across both
    // branches and takes one fee leg from each, so the buyer keeps exactly
    // `cost` of mirror-branch branch-USDC. The three figures are distinct, so
    // an implementation that recorded `cost + fee`, the quantity, or nothing
    // lands on three different wrong numbers.
    new_test_ext().execute_with(|| {
        enrolled_alice(1_000);
        observe(&alice(), MARKET_A, SCORE_SIDE_LONG, 700, 500, 3, true);
        let score = Scores::<Test>::get(alice(), MARKET_A).expect("the fill was scored");
        assert_eq!(score.spent, 503);
        assert_eq!(score.mirror_principal, 500);
        assert_eq!(score.spent - score.mirror_principal, 3, "exactly the fee");
        // A second buy accumulates both legs, so the gap stays the fee total.
        observe(&alice(), MARKET_A, SCORE_SIDE_SHORT, 200, 100, 1, true);
        let score = Scores::<Test>::get(alice(), MARKET_A).expect("entry");
        assert_eq!(score.spent, 604);
        assert_eq!(score.mirror_principal, 600);
        // A sale moves neither leg of the identity.
        observe(&alice(), MARKET_A, SCORE_SIDE_LONG, 700, 400, 2, false);
        let score = Scores::<Test>::get(alice(), MARKET_A).expect("entry");
        assert_eq!(score.mirror_principal, 600, "a sale adds no mirror leg");
        assert_eq!(score.spent, 604, "and spends nothing further");
        assert_ok!(TradingRewards::do_try_state());
    });
}

#[test]
fn a_new_score_entry_is_stamped_with_its_creation_block_and_never_restamped() {
    // 08 §2.6's escape is "measured from the score entry's creation", so a
    // later fill must not push the deadline out — otherwise an account could
    // keep a never-settling market's entry alive forever by trading into it,
    // which is the state the escape exists to end.
    new_test_ext().execute_with(|| {
        enrolled_alice(1_000);
        run_to_block(4_242);
        observe(&alice(), MARKET_A, SCORE_SIDE_LONG, 700, 500, 3, true);
        let score = Scores::<Test>::get(alice(), MARKET_A).expect("entry");
        assert_eq!(score.created_at, 4_242);

        run_to_block(9_999);
        observe(&alice(), MARKET_A, SCORE_SIDE_LONG, 100, 60, 1, true);
        let score = Scores::<Test>::get(alice(), MARKET_A).expect("entry");
        assert_eq!(
            score.created_at, 4_242,
            "the stamp is the creation, not the last fill"
        );
        assert_eq!(score.spent, 564, "and the fill was still accumulated");

        // A different market opened later carries its own stamp.
        observe(&alice(), MARKET_B, SCORE_SIDE_LONG, 100, 60, 1, true);
        let other = Scores::<Test>::get(alice(), MARKET_B).expect("entry");
        assert_eq!(other.created_at, 9_999);
        assert_ok!(TradingRewards::do_try_state());
    });
}

#[test]
fn try_state_catches_a_mirror_principal_above_what_was_spent() {
    // The invariant rule 1 establishes and the annulled arm rests on. The edit
    // that breaks it — adding to one counter and not the other — surfaces as an
    // annulled market paying a reward, which rule 4 makes unreachable.
    new_test_ext().execute_with(|| {
        enrolled_alice(1_000);
        observe(&alice(), MARKET_A, SCORE_SIDE_LONG, 700, 500, 3, true);
        assert_ok!(TradingRewards::do_try_state());
        Scores::<Test>::mutate(alice(), MARKET_A, |slot| {
            if let Some(score) = slot.as_mut() {
                score.mirror_principal = score.spent + 1;
            }
        });
        assert!(TradingRewards::do_try_state().is_err());
    });
}

#[test]
fn a_sale_credits_the_book_acquired_part_net_of_the_fee() {
    new_test_ext().execute_with(|| {
        enrolled_alice(1_000);
        observe(&alice(), MARKET_A, SCORE_SIDE_LONG, 600, 300, 2, true);

        // Sell 1,000 units when only 600 came from the book, for gross
        // proceeds of 1,500 with 30 withheld — so the seller received 1,470.
        observe(&alice(), MARKET_A, SCORE_SIDE_LONG, 1_000, 1_500, 30, false);

        let score = Scores::<Test>::get(alice(), MARKET_A).expect("scored");
        // 1_470 * 600 / 1_000 = 882. Three wrong implementations land on three
        // different numbers: crediting the gross proceeds gives 900, crediting
        // units rather than value gives 600, and crediting the whole sale
        // rather than the book-acquired part gives 1_470.
        assert_eq!(score.received, 882);
        assert_eq!(score.spent, 302, "the buy leg is unchanged by the sale");
        assert_eq!(score.book_acquired, [0, 0]);
        assert_eq!(
            ScoreCount::<Test>::get(alice()),
            1,
            "two fills in one market share one entry",
        );
        assert_ok!(TradingRewards::do_try_state());
    });
}

#[test]
fn selling_off_book_inventory_scores_nothing_and_takes_no_entry() {
    // 08 §2.6: the ledger's `split*` family and its signed `transfer` let an
    // enrolled account hold units the book never sold it. Those carry no
    // credit, which is what stops a manufactured score with no forecast in it.
    //
    // No entry is taken either. A row that folds to nothing would still take a
    // slot against the 13 §4 per-account bound and still block `withdraw_bond`
    // and the close in `claim_rewards`, so an account trading only off-book
    // inventory could lock its own bond behind markets it has no stake in.
    new_test_ext().execute_with(|| {
        enrolled_alice(1_000);
        observe(&alice(), MARKET_A, SCORE_SIDE_LONG, 1_000, 990, 9, false);
        assert!(Scores::<Test>::get(alice(), MARKET_A).is_none());
        assert_eq!(ScoreCount::<Test>::get(alice()), 0);
        assert_ok!(TradingRewards::do_try_state());
    });
}

#[test]
fn a_partly_off_book_sale_still_keeps_its_entry() {
    // The complement: the skip above must key on "the score did not move", not
    // on "this was a sale". A sale that credits anything at all is recorded.
    //
    // The quantities are chosen so the net and the gross readings disagree.
    // An earlier version bought 10 units against a 1,000-unit sale, where
    // floor(981 x 10 / 1000) and floor(990 x 10 / 1000) are both 9 — so it
    // passed against a gross-crediting implementation, and it also happened to
    // make `spent` and `received` equal. Here 100 book-acquired units give 98
    // for the net reading and 99 for the gross one.
    new_test_ext().execute_with(|| {
        enrolled_alice(1_000);
        observe(&alice(), MARKET_A, SCORE_SIDE_LONG, 100, 50, 3, true);
        observe(&alice(), MARKET_A, SCORE_SIDE_LONG, 1_000, 990, 9, false);
        let score = Scores::<Test>::get(alice(), MARKET_A).expect("the entry survives");
        assert_eq!(score.spent, 53);
        // 100 of the 1,000 units sold were book-acquired, and the seller
        // received 990 - 9 = 981: floor(981 * 100 / 1000) = 98. Crediting the
        // gross proceeds gives 99, crediting units gives 100, and crediting the
        // whole sale gives 981.
        assert_eq!(score.received, 98);
        assert_ne!(score.received, score.spent);
        assert_eq!(score.book_acquired, [0, 0]);
        assert_eq!(ScoreCount::<Test>::get(alice()), 1);
        assert_ok!(TradingRewards::do_try_state());
    });
}

#[test]
fn a_fill_past_the_score_bound_records_no_score_and_never_refuses() {
    // limit-coverage: MaxScoredMarketsPerAccount
    //
    // 08 §2.6: a fill in a market beyond the per-account bound "records no
    // score and never rejects the trade". The boundary is asserted in both
    // directions, so an off-by-one either way fails here.
    new_test_ext().execute_with(|| {
        enrolled_alice(1_000);
        for market in 0..MAX_SCORED_MARKETS_PER_ACCOUNT - 1 {
            record_test_score(&alice(), u64::from(market), 1, 0);
        }
        assert_eq!(
            ScoreCount::<Test>::get(alice()),
            MAX_SCORED_MARKETS_PER_ACCOUNT - 1
        );

        // The last free slot is admitted.
        let last = u64::from(MAX_SCORED_MARKETS_PER_ACCOUNT);
        observe(&alice(), last, SCORE_SIDE_LONG, 700, 500, 3, true);
        assert!(Scores::<Test>::get(alice(), last).is_some());
        assert_eq!(
            ScoreCount::<Test>::get(alice()),
            MAX_SCORED_MARKETS_PER_ACCOUNT
        );

        // The next new market is not, and the fill is still not refused: the
        // observer cannot report a failure, and nothing else moved.
        let beyond = last + 1;
        observe(&alice(), beyond, SCORE_SIDE_LONG, 700, 500, 3, true);
        assert!(Scores::<Test>::get(alice(), beyond).is_none());
        assert_eq!(
            ScoreCount::<Test>::get(alice()),
            MAX_SCORED_MARKETS_PER_ACCOUNT
        );

        // The bound blocks a new entry, never an existing one: a trader at the
        // bound must still be scored in the markets they already hold.
        observe(&alice(), last, SCORE_SIDE_LONG, 100, 40, 1, true);
        let score = Scores::<Test>::get(alice(), last).expect("the existing entry survives");
        assert_eq!(score.spent, 503 + 41);
        assert_eq!(
            ScoreCount::<Test>::get(alice()),
            MAX_SCORED_MARKETS_PER_ACCOUNT
        );
        assert_ok!(TradingRewards::do_try_state());
    });
}

#[test]
fn try_state_catches_score_entries_over_the_per_account_bound() {
    new_test_ext().execute_with(|| {
        enrolled_alice(1_000);
        for market in 0..MAX_SCORED_MARKETS_PER_ACCOUNT {
            record_test_score(&alice(), u64::from(market), 1, 0);
        }
        // Exactly at the bound is a lawful state.
        assert_ok!(TradingRewards::do_try_state());
        record_test_score(&alice(), u64::from(MAX_SCORED_MARKETS_PER_ACCOUNT), 1, 0);
        assert!(TradingRewards::do_try_state().is_err());
    });
}

#[test]
fn try_state_catches_a_score_row_under_a_zero_bond() {
    // The precondition `scores_fills` rests on. A live row under a zero bond
    // is the one state where skipping the fill is not symmetric — the buy leg
    // is recorded and the matching sale would lose its credit — and it is
    // unreachable only because two separate gates say so, one of which TR5 has
    // not written yet.
    new_test_ext().execute_with(|| {
        enrolled_alice(1_000);
        record_test_score(&alice(), MARKET_A, 10, 0);
        assert_ok!(TradingRewards::do_try_state());
        Participants::<Test>::mutate(alice(), |slot| {
            if let Some(record) = slot.as_mut() {
                record.bond = 0;
                record.snapshot_bond = 0;
            }
        });
        assert!(TradingRewards::do_try_state().is_err());
    });
}

#[test]
fn an_overflowing_fill_leaves_the_entry_byte_identical() {
    // 08 §2.6: "an arithmetic edge is a no-op". `on_buy` bumps `spent` before
    // it touches the branch slot, so the case that matters is **partial
    // application**: `spent`'s `checked_add` succeeds and the branch slot's
    // `checked_add` then overflows. Seeding `spent = Balance::MAX - 1`
    // instead (fix round 1, Important 1) fails at the *first* `checked_add`,
    // before `on_buy` ever touches `score` — the local copy never diverges
    // from `before`, so the later `score == before` skip absorbs the write
    // on its own and the `outcome.is_err()` guard this test is named for is
    // never exercised. Seeding the branch slot instead forces the
    // divergence: `spent` is written, `book_acquired` is not, and only the
    // guard being tested stops that half-written score from reaching
    // storage.
    new_test_ext().execute_with(|| {
        enrolled_alice(1_000);
        observe(&alice(), MARKET_A, SCORE_SIDE_LONG, 700, 500, 3, true);
        Scores::<Test>::mutate(alice(), MARKET_A, |slot| {
            if let Some(score) = slot.as_mut() {
                score.book_acquired[SCORE_SIDE_LONG] = Balance::MAX;
            }
        });
        let before = Scores::<Test>::get(alice(), MARKET_A).expect("scored");

        observe(&alice(), MARKET_A, SCORE_SIDE_LONG, 700, 500, 3, true);

        assert_eq!(
            Scores::<Test>::get(alice(), MARKET_A),
            Some(before),
            "an overflowing fill writes nothing at all",
        );
        assert_eq!(ScoreCount::<Test>::get(alice()), 1);
    });
}

#[test]
fn an_overflowing_first_fill_creates_no_entry_and_no_counter() {
    new_test_ext().execute_with(|| {
        enrolled_alice(1_000);
        observe(
            &alice(),
            MARKET_A,
            SCORE_SIDE_LONG,
            1,
            Balance::MAX,
            1,
            true,
        );
        assert!(Scores::<Test>::get(alice(), MARKET_A).is_none());
        assert_eq!(ScoreCount::<Test>::get(alice()), 0);
        assert_ok!(TradingRewards::do_try_state());
    });
}

#[test]
fn a_fill_on_an_unknown_branch_index_records_nothing() {
    // `side` is a `usize` on the wire between two crates. An out-of-range one
    // must be a no-op, never an index panic and never a silent side-0 credit.
    new_test_ext().execute_with(|| {
        enrolled_alice(1_000);
        observe(&alice(), MARKET_A, 2, 700, 500, 3, true);
        assert!(Scores::<Test>::get(alice(), MARKET_A).is_none());
        assert_eq!(ScoreCount::<Test>::get(alice()), 0);
        assert_ok!(TradingRewards::do_try_state());
    });
}

#[test]
fn fills_in_two_markets_take_two_entries() {
    new_test_ext().execute_with(|| {
        enrolled_alice(1_000);
        observe(&alice(), MARKET_A, SCORE_SIDE_LONG, 700, 500, 3, true);
        observe(&alice(), MARKET_B, SCORE_SIDE_LONG, 100, 40, 1, true);
        assert_eq!(ScoreCount::<Test>::get(alice()), 2);
        assert_eq!(
            Scores::<Test>::get(alice(), MARKET_A)
                .expect("scored")
                .spent,
            503
        );
        assert_eq!(
            Scores::<Test>::get(alice(), MARKET_B)
                .expect("scored")
                .spent,
            41
        );
        assert_ok!(TradingRewards::do_try_state());
    });
}

// ---------------------------------------------------------------------------
// Folding one settled market (08 §2.6; TR5)
// ---------------------------------------------------------------------------

/// `fee.vit_usdc_rate`'s stored `FixedU64` integer at the 13 §1 placeholder.
const VIT_RATE: u64 = 50_000_000;

type Account = sp_core::crypto::AccountId32;

/// One buy through the observer, exactly as `pallet-market` reports it.
fn buy(
    who: &Account,
    market: futarchy_primitives::MarketId,
    qty: Balance,
    cost: Balance,
    fee: Balance,
) {
    observe(who, market, SCORE_SIDE_LONG, qty, cost, fee, true);
}

/// Par: one scalar unit redeeming for one whole USDC base unit. `settled_value`
/// is a fraction on this grid, never a plain integer — see
/// [`trading_rewards_core::SETTLED_VALUE_SCALE`], and note that no unit can
/// redeem above it.
const PAR: Balance = trading_rewards_core::SETTLED_VALUE_SCALE;

/// A buy, then the book reaching a realized terminal state worth `unit_value`
/// per unit on the branch that was traded, `unit_value` being on the [`PAR`]
/// grid.
fn buy_and_settle(
    who: &Account,
    market: futarchy_primitives::MarketId,
    qty: Balance,
    cost: Balance,
    fee: Balance,
    unit_value: Balance,
) {
    buy(who, market, qty, cost, fee);
    settle_book(who, market, BranchDisposition::Realized, [unit_value, 0]);
}

fn record(who: &Account) -> crate::ParticipantRecord {
    Participants::<Test>::get(who).expect("record")
}

#[test]
fn folding_moves_a_settled_market_into_the_epoch_and_frees_the_entry() {
    new_test_ext().execute_with(|| {
        enrolled_alice(1_000);
        // 1,000 units for 500 with no fee; the branch realizes at par.
        buy_and_settle(&alice(), MARKET_A, 1_000, 500, 0, PAR);

        // Permissionless and named-target: BOB cranks ALICE's fold.
        assert_ok!(TradingRewards::settle_market_score(
            RuntimeOrigin::signed(bob()),
            alice(),
            MARKET_A
        ));

        assert!(
            Scores::<Test>::get(alice(), MARKET_A).is_none(),
            "entry freed"
        );
        assert_eq!(ScoreCount::<Test>::get(alice()), 0);
        let record = record(&alice());
        assert_eq!(record.epoch.received, 1_000);
        assert_eq!(record.epoch.spent, 500);
        assert!(events().iter().any(|event| matches!(
            event,
            Event::MarketScoreFolded {
                spent: 500,
                received: 1_000,
                ..
            }
        )));
        assert_ok!(TradingRewards::do_try_state());
    });
}

#[test]
fn folding_refuses_before_the_book_settles() {
    new_test_ext().execute_with(|| {
        enrolled_alice(1_000);
        buy(&alice(), MARKET_A, 1_000, 500, 0);
        assert_noop!(
            TradingRewards::settle_market_score(RuntimeOrigin::signed(bob()), alice(), MARKET_A),
            Error::<Test>::MarketNotSettled
        );
        assert!(
            Scores::<Test>::get(alice(), MARKET_A).is_some(),
            "the entry survives"
        );
        assert_eq!(record(&alice()).epoch, Default::default());
    });
}

#[test]
fn folding_refuses_an_unknown_entry_and_an_unenrolled_account() {
    new_test_ext().execute_with(|| {
        assert_noop!(
            TradingRewards::settle_market_score(RuntimeOrigin::signed(bob()), alice(), MARKET_A),
            Error::<Test>::NotEnrolled
        );
        enrolled_alice(1_000);
        assert_noop!(
            TradingRewards::settle_market_score(RuntimeOrigin::signed(bob()), alice(), MARKET_A),
            Error::<Test>::NoScoreEntry
        );
    });
}

#[test]
fn a_market_that_never_settles_releases_the_bond_on_the_absolute_timeout() {
    // limit-coverage: ScoreEntryLifetime
    // Design §6, review finding 4: the `ledger.archive` escape was circular,
    // because the archive sweep needs a terminal vault and a market that never
    // settles never becomes one.
    new_test_ext().execute_with(|| {
        enrolled_alice(1_000);
        buy(&alice(), MARKET_A, 1_000, 500, 3);
        let created = Scores::<Test>::get(alice(), MARKET_A)
            .expect("entry")
            .created_at;
        // Read straight from the 13 §4 constant rather than through the mock's
        // helper, so the boundary this test pins is the bound itself and a
        // drifting helper cannot quietly move it.
        let lifetime = u64::from(futarchy_primitives::bounds::SCORE_ENTRY_LIFETIME_BLOCKS);
        assert_eq!(lifetime, score_entry_timeout());

        // One block short of the lifetime it is still refused, so the boundary
        // is exact rather than "eventually".
        run_to_block(created + lifetime - 1);
        assert_noop!(
            TradingRewards::settle_market_score(RuntimeOrigin::signed(bob()), alice(), MARKET_A),
            Error::<Test>::MarketNotSettled
        );

        run_to_block(created + lifetime);
        assert_ok!(TradingRewards::settle_market_score(
            RuntimeOrigin::signed(bob()),
            alice(),
            MARKET_A
        ));
        assert!(Scores::<Test>::get(alice(), MARKET_A).is_none());
        assert_eq!(ScoreCount::<Test>::get(alice()), 0);
        let record = record(&alice());
        assert_eq!(record.epoch, Default::default(), "the entry drops at zero");
        assert!(events().iter().any(|event| matches!(
            event,
            Event::MarketScoreDropped {
                timed_out: true,
                ..
            }
        )));
        // And the bond comes back, which is what the escape exists for.
        assert_ok!(TradingRewards::withdraw_bond(
            RuntimeOrigin::signed(alice())
        ));
        assert_eq!(usdc_balance(&alice()), 1_000_000);
    });
}

#[test]
fn a_settled_market_is_folded_even_past_the_timeout() {
    // The escape is for markets that never settle. 08 §2.6 sizes it above the
    // longest lawful settlement horizon precisely so no settling market reaches
    // it, and a settled book must still be scored if one somehow does —
    // otherwise the timeout becomes an exit from a live debit.
    new_test_ext().execute_with(|| {
        enrolled_alice(1_000);
        buy_and_settle(&alice(), MARKET_A, 1_000, 900, 0, 0);
        run_to_block(score_entry_timeout() + 10);
        assert_ok!(TradingRewards::settle_market_score(
            RuntimeOrigin::signed(bob()),
            alice(),
            MARKET_A
        ));
        let record = record(&alice());
        assert_eq!(record.epoch.spent, 900, "the loss was folded, not dropped");
        assert_eq!(record.epoch.received, 0);
    });
}

#[test]
fn folding_an_annulled_branch_scores_exactly_the_fees() {
    // SQ-1051, through the pallet. `−(cost + fee)` is also a debit and it is
    // the defect, so the assertion is on the exact value.
    new_test_ext().execute_with(|| {
        enrolled_alice(1_000);
        buy(&alice(), MARKET_A, 1_000, 900, 3);
        // A sale in the branch that is later annulled credits nothing real, so
        // a large credit here must not change the answer.
        observe(&alice(), MARKET_A, SCORE_SIDE_LONG, 1_000, 5_000, 0, false);
        let score = Scores::<Test>::get(alice(), MARKET_A).expect("entry");
        assert_eq!(
            score.received, 5_000,
            "the credit exists, and is discarded below"
        );
        settle_book(&alice(), MARKET_A, BranchDisposition::Annulled, [0, 0]);

        assert_ok!(TradingRewards::settle_market_score(
            RuntimeOrigin::signed(bob()),
            alice(),
            MARKET_A
        ));
        let record = record(&alice());
        assert_eq!(record.epoch.spent, 903);
        assert_eq!(record.epoch.received, 900, "the mirror leg, not the sale");
        assert_eq!(
            record.epoch.spent - record.epoch.received,
            3,
            "exactly the fees, which is 04 §6.2's G-3 restated"
        );
        // What the retired one-arm rule would have charged, for contrast.
        assert_ne!(record.epoch.spent - record.epoch.received, 903);
        assert_ok!(TradingRewards::do_try_state());
    });
}

#[test]
fn folding_a_voided_proposal_drops_the_entry_at_zero() {
    new_test_ext().execute_with(|| {
        enrolled_alice(1_000);
        buy_and_settle(&alice(), MARKET_A, 1_000, 900, 3, PAR);
        settle_book(&alice(), MARKET_A, BranchDisposition::Void, [PAR, 0]);

        assert_ok!(TradingRewards::settle_market_score(
            RuntimeOrigin::signed(bob()),
            alice(),
            MARKET_A
        ));
        assert!(Scores::<Test>::get(alice(), MARKET_A).is_none());
        let record = record(&alice());
        assert_eq!(record.epoch, Default::default(), "VOID folds to nothing");
        assert!(events().iter().any(|event| matches!(
            event,
            Event::MarketScoreDropped {
                timed_out: false,
                ..
            }
        )));
    });
}

#[test]
fn settlement_credits_the_book_acquired_quantity_through_the_pallet() {
    // 08 §2.6 rule 3, through the pallet. The book sold 300 units and the
    // branch settles at half par, so the credit is 150 — which separates a
    // per-unit fraction from an integer 1, and separates crediting *value* from
    // crediting *units*.
    new_test_ext().execute_with(|| {
        enrolled_alice(1_000);
        buy(&alice(), MARKET_A, 300, 150, 0);
        settle_book(
            &alice(),
            MARKET_A,
            BranchDisposition::Realized,
            [PAR / 2, 0],
        );
        assert_ok!(TradingRewards::settle_market_score(
            RuntimeOrigin::signed(bob()),
            alice(),
            MARKET_A
        ));
        assert_eq!(record(&alice()).epoch.received, 150);
    });
}

/// **The C1 regression at the pallet's own layer** (08 §2.6 rule 3, amended
/// 2026-08-11; 15 §4.1 point 3).
///
/// The retired rule clamped the credit by the account's ledger position read at
/// fold time, and `redeem_scalar` burns that position. So the ordinary user
/// path — redeem, then let the keeper crank — folded a lawful zero into
/// `received` against a real `spent`, and rule 4's realized arm debited a
/// correct forecaster.
///
/// The mock cannot burn a ledger position, because it holds no ledger. What it
/// *can* do is state the claim the runtime seam has to satisfy: the credit is a
/// function of the score entry and the branch's value, and of nothing else the
/// caller or the clock can move. Two accounts with the same book and the same
/// settlement are credited the same, and the settlement facts carry no field a
/// redemption could change. `runtime/bleavit-runtime/src/tests_trading_rewards.
/// rs` carries the version with a real redemption in it.
///
/// Mutation killed: restoring any position-shaped clamp in `on_settle` (whose
/// only reachable value here would be zero, since no ledger backs the mock) and
/// any credit that reads state outside the entry.
#[test]
fn the_credit_depends_on_the_book_entry_and_the_branch_value_alone() {
    new_test_ext().execute_with(|| {
        enrolled_alice(1_000);
        mint_usdc(&bob(), 1_000_000);
        assert_ok!(TradingRewards::enroll(RuntimeOrigin::signed(bob()), 1_000));

        for who in [alice(), bob()] {
            buy(&who, MARKET_A, 1_000, 900, 3);
            settle_book(&who, MARKET_A, BranchDisposition::Realized, [PAR / 4, 0]);
        }
        // Cranked in opposite orders by opposite callers, which is the degree of
        // freedom a permissionless crank really has.
        assert_ok!(TradingRewards::settle_market_score(
            RuntimeOrigin::signed(bob()),
            alice(),
            MARKET_A
        ));
        assert_ok!(TradingRewards::settle_market_score(
            RuntimeOrigin::signed(alice()),
            bob(),
            MARKET_A
        ));
        assert_eq!(record(&alice()).epoch, record(&bob()).epoch);
        assert_eq!(
            record(&alice()).epoch.received,
            250,
            "1_000 book-acquired units at a quarter of par",
        );
    });
}

// ---------------------------------------------------------------------------
// Closing one participant's epoch (08 §2.6; TR5)
// ---------------------------------------------------------------------------

#[test]
fn a_losing_epoch_debits_the_snapshot_bond_and_cannot_be_escaped_by_folding() {
    // Design §4.3, review finding 2.
    new_test_ext().execute_with(|| {
        enrolled_alice(1_000);
        buy_and_settle(&alice(), MARKET_A, 1_000, 1_000, 0, 0);
        assert_ok!(TradingRewards::settle_market_score(
            RuntimeOrigin::signed(bob()),
            alice(),
            MARKET_A
        ));
        assert_noop!(
            TradingRewards::withdraw_bond(RuntimeOrigin::signed(alice())),
            Error::<Test>::EpochUnsettled
        );

        let insurance_before = insurance_balance();
        run_to_epoch_close();
        assert_ok!(TradingRewards::settle_epoch(
            RuntimeOrigin::signed(bob()),
            alice()
        ));

        let record = record(&alice());
        assert_eq!(
            record.bond,
            1_000 - 3,
            "0.25 % of 1_000, ceiled against the claimant"
        );
        assert_eq!(
            insurance_balance() - insurance_before,
            3,
            "forfeit goes to INSURANCE"
        );
        assert_eq!(sovereign_usdc(), 997, "the forfeit really left custody");
        assert_eq!(record.snapshot_bond, 997, "the cap follows the bond down");
        assert_eq!(record.snapshot_epoch, CurrentEpoch::get());
        assert_eq!(record.epoch, Default::default());
        assert!(!record.suspended, "a partial debit does not suspend");
        assert_ok!(TradingRewards::do_try_state());
        // And the bond is releasable now, which the fold alone did not buy.
        assert_ok!(TradingRewards::withdraw_bond(
            RuntimeOrigin::signed(alice())
        ));
    });
}

#[test]
fn a_winning_epoch_accrues_the_reward_in_usdc_and_re_snapshots() {
    new_test_ext().execute_with(|| {
        VitUsdcRate::set(Some(VIT_RATE));
        enrolled_alice(1_000);
        authorize_budget_usdc(10_000);
        // Spend 1,000 on 100,000 units at 0.01 and redeem them at par: back
        // 100,000, net +99,000, capped at 40,000.
        buy_and_settle(&alice(), MARKET_A, 100_000, 1_000, 0, PAR);
        assert_ok!(TradingRewards::settle_market_score(
            RuntimeOrigin::signed(bob()),
            alice(),
            MARKET_A
        ));
        run_to_epoch_close();
        assert_ok!(TradingRewards::settle_epoch(
            RuntimeOrigin::signed(bob()),
            alice()
        ));

        // cap = 1_000 × 1e9 / (2_500_000 × 10) = 40_000, so the reward is
        // floor(40_000 × 0.25 %) = 100. Uncapped it would have been 247, so the
        // cap is visibly binding rather than incidental. `rwd.rate` is read
        // live rather than pinned, so a later change to the mock default moves
        // this assertion with it instead of silently disagreeing.
        let rate_ppb = u128::from(RewardRate::get().expect("mock reward rate is set"));
        assert_eq!((40_000u128 * rate_ppb) / 1_000_000_000, 100);
        let record = record(&alice());
        assert_eq!(record.accrued, 100);
        assert_eq!(TotalAccrued::<Test>::get(), 100);
        assert_eq!(record.bond, 1_000, "a reward takes nothing from the bond");
        assert_eq!(record.snapshot_bond, 1_000);
        assert_eq!(record.epoch, Default::default());
        assert_ok!(TradingRewards::do_try_state());
        // The accrual is a real claim: it pays out in VIT at the live rate.
        assert_ok!(TradingRewards::claim_rewards(
            RuntimeOrigin::signed(alice())
        ));
        assert_eq!(TotalAccrued::<Test>::get(), 0);
    });
}

#[test]
fn settle_epoch_refuses_an_epoch_that_has_not_closed() {
    new_test_ext().execute_with(|| {
        enrolled_alice(1_000);
        assert_noop!(
            TradingRewards::settle_epoch(RuntimeOrigin::signed(bob()), alice()),
            Error::<Test>::EpochNotClosed
        );
        run_to_epoch_close();
        assert_ok!(TradingRewards::settle_epoch(
            RuntimeOrigin::signed(bob()),
            alice()
        ));
    });
}

#[test]
fn settle_epoch_is_idempotent_per_participant_per_epoch() {
    // 08 §2.6 obligation 1: a second call for a settled epoch is a no-op, not a
    // second payout.
    new_test_ext().execute_with(|| {
        VitUsdcRate::set(Some(VIT_RATE));
        enrolled_alice(1_000);
        authorize_budget_usdc(10_000);
        buy_and_settle(&alice(), MARKET_A, 100_000, 1_000, 0, PAR);
        assert_ok!(TradingRewards::settle_market_score(
            RuntimeOrigin::signed(bob()),
            alice(),
            MARKET_A
        ));
        run_to_epoch_close();
        assert_ok!(TradingRewards::settle_epoch(
            RuntimeOrigin::signed(bob()),
            alice()
        ));
        let after_first = record(&alice());
        assert_eq!(after_first.accrued, 100);

        assert_noop!(
            TradingRewards::settle_epoch(RuntimeOrigin::signed(bob()), alice()),
            Error::<Test>::EpochNotClosed
        );
        assert_eq!(record(&alice()), after_first, "the record is unchanged");
        assert_eq!(TotalAccrued::<Test>::get(), 100);
    });
}

#[test]
fn settle_epoch_refuses_while_an_unfolded_score_entry_remains() {
    // 08 §2.6 obligation 3, and it is load-bearing rather than tidy: settling
    // on part of a score pays a reward on the market that won while the market
    // that lost is still unfolded.
    new_test_ext().execute_with(|| {
        VitUsdcRate::set(Some(VIT_RATE));
        enrolled_alice(1_000);
        authorize_budget_usdc(10_000);
        buy_and_settle(&alice(), MARKET_A, 100_000, 1_000, 0, PAR);
        // A second market, still open, carrying the loss.
        buy(&alice(), MARKET_B, 1_000, 1_000, 0);
        assert_ok!(TradingRewards::settle_market_score(
            RuntimeOrigin::signed(bob()),
            alice(),
            MARKET_A
        ));
        run_to_epoch_close();

        assert_noop!(
            TradingRewards::settle_epoch(RuntimeOrigin::signed(bob()), alice()),
            Error::<Test>::UnfoldedScore
        );
        assert_eq!(
            record(&alice()).accrued,
            0,
            "nothing was paid on the partial score"
        );

        // Fold the loser too, and the epoch settles on the whole score.
        settle_book(&alice(), MARKET_B, BranchDisposition::Realized, [0, 0]);
        assert_ok!(TradingRewards::settle_market_score(
            RuntimeOrigin::signed(bob()),
            alice(),
            MARKET_B
        ));
        assert_ok!(TradingRewards::settle_epoch(
            RuntimeOrigin::signed(bob()),
            alice()
        ));
        // Net over both markets is 100_000 − 2_000 = +98_000, still capped.
        assert_eq!(record(&alice()).accrued, 100);
    });
}

#[test]
fn settle_epoch_reads_the_score_map_itself_and_not_only_the_counter() {
    // The counter is an O(1) mirror and the prefix probe is the real guard, so
    // a counter that had drifted low must not be able to let a live score row
    // settle unfolded. The two are redundant in every lawful state, which is
    // exactly why the redundancy needs a test of its own: without this, the
    // probe can be deleted and every other test still passes.
    new_test_ext().execute_with(|| {
        enrolled_alice(1_000);
        Scores::<Test>::insert(
            alice(),
            MARKET_A,
            trading_rewards_core::MarketScore {
                spent: 500,
                mirror_principal: 500,
                ..Default::default()
            },
        );
        assert_eq!(
            ScoreCount::<Test>::get(alice()),
            0,
            "the mirror is drifted low"
        );
        run_to_epoch_close();
        assert_noop!(
            TradingRewards::settle_epoch(RuntimeOrigin::signed(bob()), alice()),
            Error::<Test>::UnfoldedScore
        );
    });
}

#[test]
fn settle_epoch_re_snapshots_a_bond_even_when_the_epoch_had_nothing_to_settle() {
    // TR3's §6.2: nothing except `settle_epoch` re-snapshots, so without this
    // an account that tops up in a quiet epoch keeps the smaller cap forever
    // and "a top-up takes effect from the next epoch" is not what the code does.
    new_test_ext().execute_with(|| {
        enrolled_alice(1_000);
        assert_ok!(TradingRewards::top_up_bond(
            RuntimeOrigin::signed(alice()),
            500
        ));
        let before = record(&alice());
        assert_eq!(before.bond, 1_500);
        assert_eq!(before.snapshot_bond, 1_000, "the top-up left the cap alone");
        assert_eq!(
            before.epoch,
            Default::default(),
            "and there is nothing to settle"
        );

        run_to_epoch_close();
        assert_ok!(TradingRewards::settle_epoch(
            RuntimeOrigin::signed(bob()),
            alice()
        ));

        let after = record(&alice());
        assert_eq!(
            after.snapshot_bond, 1_500,
            "the next epoch's cap sees the top-up"
        );
        assert_eq!(after.snapshot_epoch, CurrentEpoch::get());
        assert_eq!(after.bond, 1_500);
        assert_ok!(TradingRewards::do_try_state());
    });
}

#[test]
fn settle_epoch_refuses_an_account_that_never_enrolled() {
    new_test_ext().execute_with(|| {
        run_to_epoch_close();
        assert_noop!(
            TradingRewards::settle_epoch(RuntimeOrigin::signed(bob()), alice()),
            Error::<Test>::NotEnrolled
        );
    });
}

#[test]
fn a_debit_at_or_above_the_whole_bond_takes_it_all_and_suspends() {
    // 08 §2.6: "A debit never drives the bond below zero. It takes the whole
    // bond and suspends the participant until they top up."
    new_test_ext().execute_with(|| {
        enrolled_alice(1_000);
        record_test_epoch_score(&alice(), 1_000_000, 0);
        // A bond smaller than the debit the snapshot admits. Only reachable by
        // construction, which is exactly why the arm needs its own test.
        Participants::<Test>::mutate(alice(), |slot| {
            if let Some(record) = slot.as_mut() {
                record.bond = 2;
            }
        });
        let insurance_before = insurance_balance();
        run_to_epoch_close();
        assert_ok!(TradingRewards::settle_epoch(
            RuntimeOrigin::signed(bob()),
            alice()
        ));

        let record = record(&alice());
        assert_eq!(record.bond, 0, "the whole bond, and never below zero");
        assert_eq!(record.snapshot_bond, 0);
        assert!(record.suspended);
        assert_eq!(
            insurance_balance() - insurance_before,
            2,
            "only what was actually held"
        );
        assert!(!TradingRewards::scores_fills(&alice()));
    });
}

#[test]
fn a_settled_epoch_with_no_debit_never_sets_the_suspension_flag() {
    // The complement, so an unconditional `suspended = true` cannot pass. A
    // record `withdraw_bond` retained at zero bond must not become suspended by
    // a later settlement that took nothing.
    new_test_ext().execute_with(|| {
        enrolled_alice(1_000);
        record_test_accrual(&alice(), 250);
        assert_ok!(TradingRewards::withdraw_bond(
            RuntimeOrigin::signed(alice())
        ));
        assert_eq!(record(&alice()).bond, 0);
        run_to_epoch_close();
        assert_ok!(TradingRewards::settle_epoch(
            RuntimeOrigin::signed(bob()),
            alice()
        ));
        assert!(!record(&alice()).suspended);
    });
}

// ---------------------------------------------------------------------------
// The authorized budget and its scaling (08 §2.6; obligation 2)
// ---------------------------------------------------------------------------

/// Settle an offsetting pair over one epoch and return `(reward, forfeit)`.
/// The winner settles first, which is the order in which a budget-scaled debit
/// would let the pair net positive.
///
/// **The winner settles themselves and the loser is cranked by a third party,
/// and that split is 08 §2.6's fourth obligation rather than a stylistic
/// choice.** A caller other than the participant is refused when the live
/// headroom would clamp the reward, and the callers of this helper deliberately
/// run it at a starved budget; the debit leg reads no headroom at all, so it
/// stays permissionless and is cranked here by the other account, which is what
/// keeps the wash-pair scenario adversarial.
fn settle_offsetting_pair(net: Balance, bond: Balance) -> (Balance, Balance) {
    enrolled_alice(bond);
    assert_ok!(TradingRewards::enroll(RuntimeOrigin::signed(bob()), bond));
    record_test_epoch_score(&alice(), 0, net);
    record_test_epoch_score(&bob(), net, 0);
    let insurance_before = insurance_balance();
    run_to_epoch_close();
    assert_ok!(TradingRewards::settle_epoch(
        RuntimeOrigin::signed(alice()),
        alice()
    ));
    assert_ok!(TradingRewards::settle_epoch(
        RuntimeOrigin::signed(alice()),
        bob()
    ));
    (
        record(&alice()).accrued,
        insurance_balance() - insurance_before,
    )
}

#[test]
fn an_over_subscribed_epoch_scales_the_reward_and_the_pair_stays_non_positive() {
    // Design §4.5. The reward is clamped to the authorized budget; the debit is
    // not, so budget pressure can only make the pair more negative.
    new_test_ext().execute_with(|| {
        VitUsdcRate::set(Some(VIT_RATE));
        let budget = authorize_budget_usdc(10);
        assert_eq!(budget, 10, "the mock rate converts exactly");
        let (reward, debit) = settle_offsetting_pair(100_000, 10_000);

        // Unscaled both legs are 250: cap = 10_000 × 1e9 / (2_500_000 × 10) =
        // 400_000, which does not bind at net 100_000, so 100_000 × 0.25 %.
        assert_eq!(debit, 250, "the debit is the unscaled leg");
        assert_eq!(reward, 10, "and the reward is clamped to the whole budget");
        assert!(
            reward < debit,
            "the pair stays strictly non-positive under scaling"
        );
        assert_eq!(TotalAccrued::<Test>::get(), 10);
        assert_ok!(TradingRewards::do_try_state());
    });
}

#[test]
fn a_funded_epoch_pays_the_pair_in_full_and_still_never_nets_positive() {
    // The unscaled control, in the same shape, so the test above cannot pass
    // through the budget path being dead.
    new_test_ext().execute_with(|| {
        VitUsdcRate::set(Some(VIT_RATE));
        authorize_budget_usdc(1_000);
        let (reward, debit) = settle_offsetting_pair(100_000, 10_000);
        assert_eq!(reward, 250);
        assert_eq!(debit, 250);
        assert!(debit >= reward);
    });
}

#[test]
fn a_debit_is_never_reduced_by_budget_pressure() {
    // Why the debit leg is not scaled. Settlement is pull-based and its timing
    // is caller-chosen, so a debit that shrank as the budget was consumed could
    // be escaped by waiting: the winning account settles while the budget is
    // full, other participants exhaust it, and the losing account settles into
    // a headroom of zero. That is a wash pair netting positive, which is the
    // invariant the whole design rests on.
    new_test_ext().execute_with(|| {
        VitUsdcRate::set(Some(VIT_RATE));
        authorize_budget_usdc(300);
        enrolled_alice(10_000);
        assert_ok!(TradingRewards::enroll(RuntimeOrigin::signed(bob()), 10_000));
        record_test_epoch_score(&alice(), 0, 100_000);
        record_test_epoch_score(&bob(), 100_000, 0);
        run_to_epoch_close();

        // The winner settles first and takes 250 of the 300.
        assert_ok!(TradingRewards::settle_epoch(
            RuntimeOrigin::signed(bob()),
            alice()
        ));
        assert_eq!(record(&alice()).accrued, 250);
        // A third participant exhausts what is left, so the loser meets a
        // headroom of 50 rather than 250.
        let carol = account(3);
        mint_usdc(&carol, 10_000);
        assert_ok!(TradingRewards::enroll(
            RuntimeOrigin::signed(carol.clone()),
            10_000
        ));
        Participants::<Test>::mutate(&carol, |slot| {
            if let Some(record) = slot.as_mut() {
                record.snapshot_epoch = CurrentEpoch::get() - 1;
            }
        });
        record_test_epoch_score(&carol, 0, 100_000);
        // Carol's own call: her demand of 250 meets a headroom of 50, and a
        // third party settling her into that clamp is what §2.6's fourth
        // obligation refuses. She may accept it, and does.
        assert_ok!(TradingRewards::settle_epoch(
            RuntimeOrigin::signed(carol.clone()),
            carol.clone()
        ));
        assert_eq!(
            record(&carol).accrued,
            50,
            "the budget really is exhausted by now"
        );

        let insurance_before = insurance_balance();
        assert_ok!(TradingRewards::settle_epoch(
            RuntimeOrigin::signed(alice()),
            bob()
        ));
        assert_eq!(
            insurance_balance() - insurance_before,
            250,
            "the loser pays the full debit whatever the budget is doing",
        );
    });
}

#[test]
fn an_unreadable_vit_rate_scales_the_reward_to_zero_and_still_settles() {
    // `fee.vit_usdc_rate` is unseeded at genesis, so the budget cannot be
    // valued. Fail closed on the reward and settle anyway: refusing would make
    // the bond hostage to a VIT-side row, which is the defect TR3's review
    // already removed once from `withdraw_bond`.
    new_test_ext().execute_with(|| {
        enrolled_alice(1_000);
        fund_reward_budget(1_000_000_000_000);
        assert!(VitUsdcRate::get().is_none());
        record_test_epoch_score(&alice(), 0, 100_000);
        run_to_epoch_close();
        // Alice's own call: an unvaluable budget is a headroom of zero, so the
        // clamp bites and §2.6's fourth obligation reserves this settlement to
        // her. `a_third_party_may_not_settle_an_epoch_into_a_clamped_reward`
        // pins the refusal that reserves it.
        assert_ok!(TradingRewards::settle_epoch(
            RuntimeOrigin::signed(alice()),
            alice()
        ));
        assert_eq!(
            record(&alice()).accrued,
            0,
            "no budget can be valued, so none is promised"
        );
        assert_eq!(
            record(&alice()).epoch,
            Default::default(),
            "and the epoch still closed"
        );
        assert_ok!(TradingRewards::withdraw_bond(
            RuntimeOrigin::signed(alice())
        ));
    });
}

#[test]
fn accruals_never_exceed_the_authorized_budget_across_many_participants() {
    // The post-condition 08 §2.6 states where the scale factor is applied, and
    // the property design §8 asks for. Ten participants each demand more than
    // the whole budget; the total promised must still fit inside it.
    new_test_ext().execute_with(|| {
        VitUsdcRate::set(Some(VIT_RATE));
        let budget = authorize_budget_usdc(120);
        for seed in 10u8..20 {
            let who = account(seed);
            mint_usdc(&who, 10_000);
            assert_ok!(TradingRewards::enroll(
                RuntimeOrigin::signed(who.clone()),
                10_000
            ));
            record_test_epoch_score(&who, 0, 100_000);
        }
        run_to_epoch_close();
        for seed in 10u8..20 {
            // Each settles themselves: every one of these demands 250 against a
            // budget of 120, so every one of them is clamped and §2.6's fourth
            // obligation refuses a third party for all ten.
            assert_ok!(TradingRewards::settle_epoch(
                RuntimeOrigin::signed(account(seed)),
                account(seed)
            ));
        }
        // Each unscaled demand is 250, so ten of them would have promised 2,500
        // against a budget of 120.
        assert_eq!(
            TotalAccrued::<Test>::get(),
            budget,
            "the budget is spent exactly, and never over"
        );
        assert_eq!(
            record(&account(10)).accrued,
            120,
            "the first taker gets the headroom"
        );
        assert_eq!(record(&account(11)).accrued, 0, "and the rest get nothing");
        assert_ok!(TradingRewards::do_try_state());
    });
}

// ---------------------------------------------------------------------------
// 08 §2.6's fourth `settle_epoch` obligation: a third party may not settle an
// epoch into a clamped reward
// ---------------------------------------------------------------------------

/// One enrolled account carrying a `+100_000` epoch net, which demands 250 at
/// the mock's `rwd.rate` and sits well inside the earning cap, plus an
/// authorized budget of `budget_usdc`. Returns the demand.
///
/// The demand is derived from the live rate rather than pinned, so a change to
/// the mock default moves the fixture instead of silently disagreeing with it.
fn epoch_awaiting_settlement(budget_usdc: Balance) -> Balance {
    VitUsdcRate::set(Some(VIT_RATE));
    let granted = authorize_budget_usdc(budget_usdc);
    assert_eq!(granted, budget_usdc, "the mock rate converts exactly");
    enrolled_alice(10_000);
    record_test_epoch_score(&alice(), 0, 100_000);
    run_to_epoch_close();
    let rate_ppb = u128::from(RewardRate::get().expect("mock reward rate is set"));
    let demand = (100_000u128 * rate_ppb) / 1_000_000_000;
    assert_eq!(demand, 250);
    demand
}

/// **The I5 ruling.** `settle_epoch` clamps the reward to the headroom *as read
/// at call time* and then resets the epoch unconditionally, so a third party
/// could finalize a victim into a starved moment for a transaction fee, and
/// re-funding could not reopen it. 08 §2.6 therefore refuses that caller.
///
/// The refusal is status-quo (G-1), and the second half of this test is what
/// makes that worth having: the epoch is still open, so the budget can be
/// topped up and the participant is paid in full afterwards. Under the defect
/// the same sequence pays 100 and discards the rest for good.
///
/// Mutations killed: deleting the `caller == who ||` guard (BOB's call
/// succeeds, ALICE accrues 100, and the top-up below finds nothing left to
/// pay); clamping-and-continuing instead of refusing (the same); and writing
/// anything before the refusal — `assert_noop!` compares the whole storage
/// root, so a partial write fails here rather than at some later assertion.
#[test]
fn a_third_party_may_not_settle_an_epoch_into_a_clamped_reward() {
    new_test_ext().execute_with(|| {
        let demand = epoch_awaiting_settlement(100);
        assert!(
            demand > 100,
            "the headroom must really clamp, or this proves nothing"
        );

        assert_noop!(
            TradingRewards::settle_epoch(RuntimeOrigin::signed(bob()), alice()),
            Error::<Test>::ThirdPartyWouldClampReward
        );
        let after = record(&alice());
        assert_eq!(after.accrued, 0, "nothing was promised");
        assert_eq!(
            after.epoch,
            trading_rewards_core::EpochScore {
                spent: 0,
                received: 100_000,
            },
            "the epoch stays open, with its score intact",
        );
        assert!(
            after.snapshot_epoch < CurrentEpoch::get(),
            "and it was not re-snapshotted onto the current epoch",
        );
        assert_eq!(after.bond, 10_000, "the bond stays held");
        assert_eq!(TotalAccrued::<Test>::get(), 0);

        // What the refusal preserved: the budget is topped up, and the same
        // third party may now crank the same epoch for the full entitlement.
        authorize_budget_usdc(1_000);
        assert_ok!(TradingRewards::settle_epoch(
            RuntimeOrigin::signed(bob()),
            alice()
        ));
        assert_eq!(
            record(&alice()).accrued,
            demand,
            "re-funding reopened exactly what finalizing would have destroyed",
        );
        assert_ok!(TradingRewards::do_try_state());
    });
}

/// The complement, and the reason the rule is a clamp test rather than an
/// owner-only origin check: a third party may still crank every epoch the
/// headroom does not touch, which is most of them and is what the keeper does
/// (01 §4.2). A debit is unaffected in the same way and at any headroom —
/// `a_debit_is_never_reduced_by_budget_pressure` settles one through a third
/// party at a headroom of zero.
///
/// The headroom here is **exactly** the demand, because that is the boundary:
/// §2.6 refuses a clamp "below the participant's full entitlement", and an
/// exact fit clamps nothing.
///
/// Mutations killed: `caller == who` alone, which would strand every epoch
/// nobody self-cranks; and `demand < headroom`, an off-by-one that refuses the
/// exact fit asserted here.
#[test]
fn a_third_party_may_settle_an_epoch_the_headroom_does_not_clamp() {
    new_test_ext().execute_with(|| {
        let demand = epoch_awaiting_settlement(250);
        assert_eq!(demand, 250, "the headroom is exactly the entitlement");

        assert_ok!(TradingRewards::settle_epoch(
            RuntimeOrigin::signed(bob()),
            alice()
        ));
        assert_eq!(
            record(&alice()).accrued,
            demand,
            "paid in full by a stranger"
        );
        assert_eq!(TotalAccrued::<Test>::get(), demand);
        assert_ok!(TradingRewards::do_try_state());
    });
}

/// The participant may always settle themselves, at a clamping headroom and at
/// an ample one alike. Both legs run, because the rule is *"the participant may
/// always"* and a test of the ample leg alone passes against an owner-only
/// refusal that strands a starved epoch.
///
/// Mutation killed: applying the refusal to the participant too — which locks
/// the bond behind a budget the participant cannot move, the one direction
/// §2.6's *bond MUST NOT be locked forever* rule forbids.
#[test]
fn the_participant_may_always_settle_their_own_epoch_at_any_headroom() {
    for (budget, expected) in [(100u128, 100u128), (1_000, 250)] {
        new_test_ext().execute_with(|| {
            let demand = epoch_awaiting_settlement(budget);
            assert_ok!(TradingRewards::settle_epoch(
                RuntimeOrigin::signed(alice()),
                alice()
            ));
            let after = record(&alice());
            assert_eq!(after.accrued, expected, "budget {budget}");
            assert_eq!(after.accrued, core::cmp::min(demand, budget));
            assert_eq!(
                after.epoch,
                Default::default(),
                "the epoch really closed at budget {budget}",
            );
            assert_eq!(after.snapshot_epoch, CurrentEpoch::get());
            assert_ok!(TradingRewards::do_try_state());
        });
    }
}
