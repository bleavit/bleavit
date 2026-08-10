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
    // unclaimed accrual. Its cap is zero, so a score could never pay — and
    // every row it created would block `claim_rewards` from closing the record
    // and returning its roster slot. A bare `contains_key` predicate scores it.
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

        observe(&alice(), MARKET_A, SCORE_SIDE_LONG, 700, 500, 3, true);

        let score = Scores::<Test>::get(alice(), MARKET_A).expect("the fill was scored");
        assert_eq!(score.spent, 503);
        assert_ok!(TradingRewards::do_try_state());
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
    // it touches the branch slot, so a partially-applied score is exactly what
    // a careless implementation would persist.
    new_test_ext().execute_with(|| {
        enrolled_alice(1_000);
        observe(&alice(), MARKET_A, SCORE_SIDE_LONG, 700, 500, 3, true);
        Scores::<Test>::mutate(alice(), MARKET_A, |slot| {
            if let Some(score) = slot.as_mut() {
                score.spent = Balance::MAX - 1;
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
