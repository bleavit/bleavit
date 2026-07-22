//! Runtime-level coverage for the treasury health cluster (SQ-205, SQ-207,
//! SQ-180): the oracle → constitution + treasury reserve-health seam, the
//! INSURANCE sweep, and the 08 §4.2 minimum-viable-NAV arming gate.
//!
//! Kept out of `tests.rs` deliberately — that file is large and concurrently
//! edited; `tests_s5.rs` / `tests_telemetry.rs` set the precedent.

use crate::configs::insurance_account;
use crate::tests::development_ext;
use crate::*;
use frame_support::traits::fungibles::{Inspect, Mutate};
use frame_support::{assert_noop, assert_ok};
use futarchy_primitives::ProposalClass;
use pallet_oracle::ProbeDispatch as _;

// ---------------------------------------------------------------- SQ-205 ---
//
// 07 §8 owns the reserve-health flag `R`; 08 §1.2 makes `spendable_nav` zero
// exactly while it is set. The seam between them must move both the
// constitution's 02 §7.3 bit-7 mirror and the treasury haircut, or neither.

/// The runtime sink composes the two sibling writes into one act.
#[test]
fn reserve_health_sink_moves_the_constitution_mirror_and_the_treasury_haircut() {
    development_ext().execute_with(|| {
        use pallet_oracle::ReserveHealthSink;

        assert!(!FutarchyTreasury::treasury().reserve_impaired);
        assert_eq!(
            Constitution::phase_flags() & pallet_constitution::PhaseFlagsValue::RESERVE_HEALTH_FLAG,
            0
        );

        assert_ok!(configs::ReserveHealthToConstitutionAndTreasury::reserve_health_changed(true));

        // Both consequences landed together.
        assert!(FutarchyTreasury::treasury().reserve_impaired);
        assert_eq!(
            Constitution::phase_flags() & pallet_constitution::PhaseFlagsValue::RESERVE_HEALTH_FLAG,
            pallet_constitution::PhaseFlagsValue::RESERVE_HEALTH_FLAG
        );
        // 08 §1.2(2): fail-static — spendable NAV is zero for new commitments.
        assert_eq!(FutarchyTreasury::nav().spendable_nav, 0);

        // And the clearing edge reverses both.
        assert_ok!(configs::ReserveHealthToConstitutionAndTreasury::reserve_health_changed(false));
        assert!(!FutarchyTreasury::treasury().reserve_impaired);
        assert_eq!(
            Constitution::phase_flags() & pallet_constitution::PhaseFlagsValue::RESERVE_HEALTH_FLAG,
            0
        );
    });
}

/// 02 §4 requires `nav().haircut_flag` to follow `welfare_current().reserve_flag`
/// (the authoritative oracle value). With the sink applied they agree; this pins
/// the agreement the SQ-205 row reported as violated.
#[test]
fn nav_haircut_flag_follows_the_authoritative_oracle_reserve_flag() {
    development_ext().execute_with(|| {
        use pallet_oracle::ReserveHealthSink;

        assert_eq!(
            FutarchyTreasury::nav().reserve_impaired,
            pallet_oracle::Pallet::<Runtime>::reserve_unhealthy()
        );

        // Drive the oracle's own storage to unhealthy, then apply the seam as
        // the oracle would inside its transition.
        pallet_oracle::ReserveHealth::<Runtime>::mutate(|health| health.unhealthy = true);
        assert_ok!(configs::ReserveHealthToConstitutionAndTreasury::reserve_health_changed(true));

        assert!(pallet_oracle::Pallet::<Runtime>::reserve_unhealthy());
        assert!(FutarchyTreasury::nav().reserve_impaired);
        assert_eq!(
            FutarchyTreasury::nav().reserve_impaired,
            pallet_oracle::Pallet::<Runtime>::reserve_unhealthy()
        );
    });
}

/// **The reason the sink is not bound in production.** `crank_reserve_probe`
/// advances the fail-static state machine even though the production
/// `ProbeDispatch` is `()` and nothing is ever sent, while recovery needs
/// probe *passes* that only `reserve_probe_result` can deliver — and that has
/// no production caller (`XcmConfig::ResponseHandler = PolkadotXcm`, not
/// `ProbeAwareResponseHandler`). So `unhealthy` is a one-way latch, and binding
/// the seam live would make any keeper able to zero `spendable_nav` forever.
///
/// This test pins the trapdoor so the day the probe feed lands (SQ-380) it
/// fails loudly and this comment gets revisited.
#[test]
fn reserve_health_is_a_one_way_latch_while_the_probe_feed_is_unwired() {
    development_ext().execute_with(|| {
        // No production route exists to deliver a probe *pass*…
        assert!(
            !<Runtime as pallet_oracle::Config>::ProbeDispatch::live(),
            "production ProbeDispatch went live — re-evaluate binding the \
             ReserveHealthSink (SQ-205/SQ-380)"
        );

        // …yet the state machine still latches fails and reaches `unhealthy`.
        pallet_oracle::ReserveHealth::<Runtime>::mutate(|health| health.unhealthy = true);
        assert!(pallet_oracle::Pallet::<Runtime>::reserve_unhealthy());

        // With the seam unbound in production, the treasury is untouched — the
        // SQ-205 defect, deliberately preserved rather than replaced by a worse
        // permanent halt. `RuntimeReserveHealthSink` is `()` outside `cfg(test)`.
        assert!(!FutarchyTreasury::treasury().reserve_impaired);
    });
}

// ---------------------------------------------------------------- SQ-207 ---

#[test]
fn sweep_insurance_moves_real_usdc_from_insurance_to_main_and_raises_nav() {
    development_ext().execute_with(|| {
        let amount: Balance = 5_000 * futarchy_primitives::currency::USDC;
        let main = crate::genesis::treasury_account();

        assert_ok!(<ForeignAssets as Mutate<AccountId>>::mint_into(
            bleavit_xcm::identity::usdc_location(),
            &insurance_account(),
            amount * 4,
        ));
        let insurance_before = <ForeignAssets as Inspect<AccountId>>::balance(
            bleavit_xcm::identity::usdc_location(),
            &insurance_account(),
        );
        let main_before = <ForeignAssets as Inspect<AccountId>>::balance(
            bleavit_xcm::identity::usdc_location(),
            &main,
        );
        let nav_before = FutarchyTreasury::nav().nav;

        assert_ok!(FutarchyTreasury::sweep_insurance(
            pallet_origins::Origin::FutarchyTreasury.into(),
            amount
        ));

        // Real custody moved INSURANCE → MAIN, and only there.
        assert_eq!(
            <ForeignAssets as Inspect<AccountId>>::balance(
                bleavit_xcm::identity::usdc_location(),
                &insurance_account()
            ),
            insurance_before - amount
        );
        assert_eq!(
            <ForeignAssets as Inspect<AccountId>>::balance(
                bleavit_xcm::identity::usdc_location(),
                &main
            ),
            main_before + amount
        );
        // 08 §1.2: INSURANCE is outside NAV, so NAV rises by exactly `amount`.
        assert_eq!(FutarchyTreasury::nav().nav, nav_before + amount);
    });
}

#[test]
fn sweep_insurance_is_refused_to_every_non_treasury_origin() {
    development_ext().execute_with(|| {
        let amount: Balance = 1_000 * futarchy_primitives::currency::USDC;
        // The complete 06 §3.2 matrix row: only the `FutarchyTreasury` column
        // carries a tick, so every other column — and Root/Signed/none — must be
        // refused. 08 §1.2: "No guardian power, no playbook and no admin origin
        // can reach it."
        for bad in [
            RuntimeOrigin::signed(crate::genesis::treasury_account()),
            RuntimeOrigin::root(),
            RuntimeOrigin::none(),
            pallet_origins::Origin::FutarchyParam.into(),
            pallet_origins::Origin::FutarchyCode.into(),
            pallet_origins::Origin::FutarchyMeta.into(),
            pallet_origins::Origin::ConstitutionalValues.into(),
            pallet_origins::Origin::OracleResolution.into(),
            pallet_origins::Origin::GuardianHold.into(),
            pallet_origins::Origin::EmergencyPlaybook.into(),
        ] {
            assert_noop!(
                FutarchyTreasury::sweep_insurance(bad, amount),
                sp_runtime::DispatchError::BadOrigin
            );
        }
    });
}

#[test]
fn sweep_insurance_preserves_the_insurance_account_rather_than_reaping_it() {
    development_ext().execute_with(|| {
        // 03 §7 R-4 / 08 §1.4: at most `balance - min_balance` is sweepable and
        // an over-large request fails whole (G-1) instead of reaping INSURANCE.
        assert_ok!(<ForeignAssets as Mutate<AccountId>>::mint_into(
            bleavit_xcm::identity::usdc_location(),
            &insurance_account(),
            2_000 * futarchy_primitives::currency::USDC,
        ));
        // The account is genesis-endowed, so read the live balance rather than
        // assuming the mint is all of it.
        let held = <ForeignAssets as Inspect<AccountId>>::balance(
            bleavit_xcm::identity::usdc_location(),
            &insurance_account(),
        );
        let nav_before = FutarchyTreasury::nav().nav;

        // Sweeping the *whole* balance would reap the account, so Preserve must
        // refuse it outright rather than partially satisfying the request.
        assert!(FutarchyTreasury::sweep_insurance(
            pallet_origins::Origin::FutarchyTreasury.into(),
            held,
        )
        .is_err());

        // Nothing moved and NAV never recorded USDC the treasury did not get.
        assert_eq!(
            <ForeignAssets as Inspect<AccountId>>::balance(
                bleavit_xcm::identity::usdc_location(),
                &insurance_account()
            ),
            held
        );
        assert_eq!(FutarchyTreasury::nav().nav, nav_before);
    });
}

// ---------------------------------------------------------------- SQ-180 ---
//
// 08 §4.2: arming a proposal class REQUIRES published spendable NAV ≥ the class
// floor of 08 §4.1, and under the 08 §1.2 haircut spendable NAV is 0 so every
// class fails (fail-static).

#[test]
fn arming_a_class_below_its_nav_floor_is_refused_and_leaves_flags_unchanged() {
    development_ext().execute_with(|| {
        let flags_before = Constitution::phase_flags();
        // The development genesis is far below the 08 §4.1 PARAM floor.
        assert!(
            FutarchyTreasury::nav().spendable_nav < FutarchyTreasury::floor(ProposalClass::Param)
        );

        assert_noop!(
            Constitution::set_phase_flag(
                RuntimeOrigin::root(),
                pallet_constitution::PhaseFlagsValue::PARAM_ARMED,
                true
            ),
            pallet_constitution::Error::<Runtime>::NavFloorUnmet
        );
        assert_eq!(Constitution::phase_flags(), flags_before);
    });
}

#[test]
fn arming_is_fail_static_under_the_reserve_health_haircut() {
    development_ext().execute_with(|| {
        use pallet_oracle::ReserveHealthSink;

        // Fund MAIN well past every 08 §4.1 floor so only the haircut can bite —
        // through the real INSURANCE sweep rather than a test-only backdoor.
        let far_above = FutarchyTreasury::floor(ProposalClass::Meta) * 4;
        assert_ok!(<ForeignAssets as Mutate<AccountId>>::mint_into(
            bleavit_xcm::identity::usdc_location(),
            &insurance_account(),
            far_above,
        ));
        assert_ok!(FutarchyTreasury::sweep_insurance(
            pallet_origins::Origin::FutarchyTreasury.into(),
            far_above
        ));
        assert!(
            FutarchyTreasury::nav().spendable_nav >= FutarchyTreasury::floor(ProposalClass::Meta)
        );

        // Armable now…
        assert_ok!(Constitution::set_phase_flag(
            RuntimeOrigin::root(),
            pallet_constitution::PhaseFlagsValue::PARAM_ARMED,
            true
        ));

        // …and refused once the 08 §1.2 flag zeroes spendable NAV.
        assert_ok!(configs::ReserveHealthToConstitutionAndTreasury::reserve_health_changed(true));
        assert_eq!(FutarchyTreasury::nav().spendable_nav, 0);
        let flags_before = Constitution::phase_flags();
        assert_noop!(
            Constitution::set_phase_flag(
                RuntimeOrigin::root(),
                pallet_constitution::PhaseFlagsValue::TREASURY_ARMED,
                true
            ),
            pallet_constitution::Error::<Runtime>::NavFloorUnmet
        );
        assert_eq!(Constitution::phase_flags(), flags_before);

        // Disarming stays available so the chain is never stranded armed.
        assert_ok!(Constitution::set_phase_flag(
            RuntimeOrigin::root(),
            pallet_constitution::PhaseFlagsValue::PARAM_ARMED,
            false
        ));
    });
}

// --- SQ-381: the loud signal is the durable extrinsic failure, not an event ---
//
// 08 §4.2 (as amended, Option A / SQ-381): a below-floor arming attempt is
// refused with the module error `NavFloorUnmet`, leaving the arming bits
// unchanged (fail-static). FRAME cannot both return that `Err` and deposit a
// pallet event — the `Err` rolls any in-dispatch event back — and the
// unchanged-flags requirement is what mandates the `Err`. So on the *blocking*
// path the loud signal is the extrinsic failure itself, surfaced durably by the
// runtime. This drives the real production arming caller — bootstrap sudo
// (09 §5.4) — and pins all three properties at once: the durable, operator/FE-
// observable `Sudid { Err(NavFloorUnmet) }`; the untouched flags; and the
// absence of any pallet `NavFloorUnmet` event on this blocking path. It would
// fail against any regression that swallowed the error (returned `Ok`) or that
// switched to the Option-B "emit an event and return `Ok` without arming" shape.

#[test]
fn arming_below_floor_surfaces_the_module_error_durably_via_sudo_with_no_pallet_event() {
    development_ext().execute_with(|| {
        // frame_system records events from block 1 onwards.
        System::set_block_number(1);

        // The dev preset installs Alice as the bootstrap sudo key (09 §5.4).
        let sudo_key = AccountId::new(crate::genesis::ALICE_PUBLIC);
        assert_eq!(pallet_sudo::Key::<Runtime>::get(), Some(sudo_key.clone()));

        // Dev genesis NAV is far below the 08 §4.1 PARAM floor, so arming refuses.
        assert!(
            FutarchyTreasury::nav().spendable_nav < FutarchyTreasury::floor(ProposalClass::Param)
        );
        let flags_before = Constitution::phase_flags();

        let arm = RuntimeCall::Constitution(pallet_constitution::Call::set_phase_flag {
            flag: pallet_constitution::PhaseFlagsValue::PARAM_ARMED,
            enabled: true,
        });
        // The OUTER sudo extrinsic SUCCEEDS: sudo dispatches the inner call with
        // Root, captures its `Err` in the `Sudid` event, and returns `Ok`, so the
        // event is committed (not rolled back with the failed inner dispatch).
        assert_ok!(Sudo::sudo(RuntimeOrigin::signed(sudo_key), Box::new(arm)));

        // The module error is durably observable: `Sudid` carries exactly it.
        // (`ModuleError`'s PartialEq ignores the codec-skipped `message`, so this
        // holds across the event's SCALE round-trip through storage.)
        let expected: sp_runtime::DispatchResult =
            Err(pallet_constitution::Error::<Runtime>::NavFloorUnmet.into());
        assert!(
            System::events().iter().any(|record| matches!(
                &record.event,
                RuntimeEvent::Sudo(pallet_sudo::Event::Sudid { sudo_result })
                    if sudo_result == &expected
            )),
            "a below-floor arming must surface NavFloorUnmet durably as Sudid {{ Err(..) }}"
        );

        // Fail-static: the arming bits are exactly as they were.
        assert_eq!(Constitution::phase_flags(), flags_before);

        // The loud signal is the extrinsic failure, NOT a pallet event: nothing on
        // this blocking path deposits the field-carrying treasury `NavFloorUnmet`
        // event (that event is the non-blocking `flag_nav_floor` variant's job).
        assert!(
            !System::events().iter().any(|record| matches!(
                record.event,
                RuntimeEvent::FutarchyTreasury(
                    pallet_futarchy_treasury::Event::NavFloorUnmet { .. }
                )
            )),
            "the blocking arming path must not deposit a pallet NavFloorUnmet event"
        );
    });
}

// ------------------- SQ-207: the real screening path (spec-review fix) ------
//
// The first cut of this file only ever constructed `Origin::FutarchyTreasury`
// directly, so it never exercised T4 screening — and three exhaustive-match
// sites had no `sweep_insurance` arm. Each failed *closed*, and the capability
// one failed closed into `SlashAll(ConstitutionViolation)`: a lawful sweep would
// have confiscated 100 % of the proposer's intake bond. These tests walk the
// path a real TREASURY decision takes, so an omitted arm can never pass again.

/// 05 §1.4 family `0x0B`: the leaf must classify, or T4 cancels the payload.
#[test]
fn sweep_insurance_derives_its_canonical_resource_key() {
    development_ext().execute_with(|| {
        let call = RuntimeCall::FutarchyTreasury(pallet_futarchy_treasury::Call::sweep_insurance {
            amount: 1_000 * futarchy_primitives::currency::USDC,
        });
        let footprint = crate::classifier::derive_resource_footprint(&[call]);
        assert!(
            footprint.is_ok(),
            "sweep_insurance must be classifiable (05 §1.4 `0x0B`), not Unclassifiable"
        );
        let Ok(footprint) = footprint else { return };
        assert_eq!(footprint.len(), 1);
        // Singleton family: the amount must not enter the discriminator, so two
        // different sweeps contend on the same INSURANCE lock.
        let other =
            RuntimeCall::FutarchyTreasury(pallet_futarchy_treasury::Call::sweep_insurance {
                amount: 7 * futarchy_primitives::currency::USDC,
            });
        let Ok(other_footprint) = crate::classifier::derive_resource_footprint(&[other]) else {
            panic!("second sweep must classify");
        };
        assert_eq!(footprint[0], other_footprint[0]);
        assert_eq!(footprint[0][0], 0x0B, "family tag must be 05 §1.4 `0x0B`");
    });
}

/// The capability gap that would have slashed the whole bond.
#[test]
fn a_treasury_sweep_proposal_passes_static_screening() {
    development_ext().execute_with(|| {
        let call = RuntimeCall::FutarchyTreasury(pallet_futarchy_treasury::Call::sweep_insurance {
            amount: 1_000 * futarchy_primitives::currency::USDC,
        });
        let Ok(footprint) =
            crate::classifier::derive_resource_footprint(std::slice::from_ref(&call))
        else {
            panic!("sweep must classify");
        };
        let Some((payload_hash, payload_len)) = crate::tests::note_runtime_batch(vec![call]) else {
            panic!("payload must note");
        };

        let mut proposal = crate::tests::empty_param_proposal(
            9_301,
            crate::tests::account(77),
            payload_hash,
            payload_len,
        );
        proposal.class = ProposalClass::Treasury;
        proposal.bond = crate::configs::balance_param(b"prop.bond.trs");
        let Ok(resources) = futarchy_primitives::BoundedVec::try_from(footprint.to_vec()) else {
            panic!("footprint must fit the 05 §1.4 lock bound");
        };
        proposal.resources = resources;

        let disposition =
            <crate::configs::RuntimeConstitutionAccess as pallet_epoch::ConstitutionAccess<
                AccountId,
            >>::static_check(&proposal);
        assert_eq!(
            disposition,
            pallet_epoch::StaticCheckDisposition::Eligible,
            "a lawful INSURANCE sweep must screen clean — an omitted capability \
             arm previously made this SlashAll(ConstitutionViolation)"
        );
    });
}

/// 05 §1.4 / 08 §1.4: the sweep is an inflow, so its derived ask is zero — and a
/// `None` ask (the pre-fix behaviour) blocks Adopt at sizing.
#[test]
fn sweep_insurance_derives_a_zero_treasury_ask_so_sizing_can_complete() {
    development_ext().execute_with(|| {
        let call = RuntimeCall::FutarchyTreasury(pallet_futarchy_treasury::Call::sweep_insurance {
            amount: 4_000 * futarchy_primitives::currency::USDC,
        });
        let Ok(footprint) =
            crate::classifier::derive_resource_footprint(std::slice::from_ref(&call))
        else {
            panic!("sweep must classify");
        };
        let Some((payload_hash, payload_len)) = crate::tests::note_runtime_batch(vec![call]) else {
            panic!("payload must note");
        };
        let mut proposal = crate::tests::empty_param_proposal(
            9_302,
            crate::tests::account(78),
            payload_hash,
            payload_len,
        );
        proposal.class = ProposalClass::Treasury;
        proposal.bond = crate::configs::balance_param(b"prop.bond.trs");
        let Ok(resources) = futarchy_primitives::BoundedVec::try_from(footprint.to_vec()) else {
            panic!("footprint must fit the 05 §1.4 lock bound");
        };
        proposal.resources = resources;

        let prize =
            <crate::configs::RuntimeConstitutionAccess as pallet_epoch::ConstitutionAccess<
                AccountId,
            >>::in_cap_prize(&proposal);
        assert!(
            prize.is_some(),
            "a derivable zero-outflow sweep must yield a prize, not None"
        );
    });
}
