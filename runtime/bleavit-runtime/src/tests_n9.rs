//! N9 runtime review surface for I-36 (16 §9; 15 I-24/I-36).
//!
//! One reviewer entry point proves all four structural preconditions:
//! `i36_egress_is_client_paid_best_effort_non_welfare_across_a_full_epoch`.
//! Its four numbered blocks bind the direct router, USDC-only prepayment,
//! authoritative best-effort publication, and isolated alert counter.

use alloc::vec::Vec;

use frame_support::{
    assert_ok,
    traits::{
        fungible::{Inspect as FungibleInspect, InspectHold, MutateHold},
        fungibles::Mutate,
    },
    PalletId,
};
use futarchy_primitives::{currency, FixedU64, ReportView, SettlementTrust};
use sp_runtime::{traits::AccountIdConversion, MultiAddress};
use staging_xcm::latest::{
    Assets, Junction, Location, SendError, SendResult, SendXcm, Xcm, XcmHash,
};
use staging_xcm_executor::traits::ConvertLocation;

use crate::{
    configs::{
        self, xcm_config, ConstitutionTraderRates, RuntimeClientEgressFees, XcmTrafficRecorder,
    },
    tests::{account, development_ext},
    AccountId, Balances, ClientRegistry, ForeignAssets, FutarchyTreasury, QuestionService, Runtime,
    RuntimeHoldReason, RuntimeOrigin, System, Welfare,
};

const CLIENT: futarchy_primitives::ClientId = 37;
const QUESTION: futarchy_primitives::QuestionId = futarchy_primitives::kernel::SERVICE_ID_BASE + 37;
const PARA: u32 = 4_537;
const BOND: u128 = 10 * currency::VIT;
const FLOAT: u128 = 100 * currency::USDC;

trait SameType<Rhs> {}
impl<T> SameType<T> for T {}

fn assert_same_type<Left, Right>()
where
    Left: SameType<Right>,
{
}

fn report() -> ReportView {
    ReportView {
        question_id: QUESTION,
        client_id: CLIENT,
        sub_id: [4; 32],
        twap_accept_1e9: FixedU64(600_000_000),
        twap_reject_1e9: FixedU64(400_000_000),
        observations: 9,
        window_start: 10,
        window_end: 20,
        b_accept: 30,
        b_reject: 30,
        manip_floor: 11,
        declared_stake: 12,
        epsilon_1e9: FixedU64(10_000_000),
        tolerance_1e9: FixedU64(20_000_000),
        certified: true,
        settlement_trust: SettlementTrust {
            attestors: 3,
            quorum: 2,
            bond_total: 99,
        },
        provenance_hash: [5; 32],
    }
}

fn seed_remote_client() -> Option<(Location, AccountId)> {
    let location = Location::new(1, [Junction::Parachain(PARA)]);
    let funder = xcm_config::LocationToAccountId::convert_location(&location)?;
    pallet_client_registry::Clients::<Runtime>::insert(
        CLIENT,
        pallet_client_registry::ClientRecord::new_location(
            location.clone(),
            BOND,
            System::block_number(),
        ),
    );
    pallet_client_registry::ClientIdOf::<Runtime>::insert(&location, CLIENT);
    pallet_client_registry::ClientPolicies::<Runtime>::insert(
        CLIENT,
        pallet_client_registry::SubIdPolicy::Optional,
    );
    pallet_client_registry::BondOwners::<Runtime>::insert(CLIENT, &funder);
    pallet_client_registry::ClientCount::<Runtime>::put(1);
    pallet_client_registry::NextClientId::<Runtime>::put(CLIENT.saturating_add(1));

    assert_ok!(Balances::force_set_balance(
        RuntimeOrigin::root(),
        MultiAddress::Id(funder.clone()),
        BOND.saturating_add(Balances::minimum_balance()),
    ));
    let reason = RuntimeHoldReason::from(pallet_client_registry::HoldReason::ClientBond);
    assert_ok!(<Balances as MutateHold<AccountId>>::hold(
        &reason, &funder, BOND
    ));
    assert_ok!(<ForeignAssets as Mutate<AccountId>>::mint_into(
        bleavit_xcm::identity::usdc_location(),
        &funder,
        FLOAT.saturating_mul(2),
    ));
    assert_ok!(ClientRegistry::top_up_delivery_float(
        pallet_client_registry::Origin::ExternalClient(CLIENT).into(),
        FLOAT,
    ));
    Some((location, funder))
}

struct FailingAfterPrepayRouter;
impl SendXcm for FailingAfterPrepayRouter {
    type Ticket = ();

    fn validate(_: &mut Option<Location>, _: &mut Option<Xcm<()>>) -> SendResult<()> {
        Ok(((), Assets::new()))
    }

    fn deliver(_: ()) -> Result<XcmHash, SendError> {
        Err(SendError::Transport("forced post-prepayment failure"))
    }
}

#[test]
fn i36_egress_is_client_paid_best_effort_non_welfare_across_a_full_epoch() {
    development_ext().execute_with(|| {
        let seeded = seed_remote_client();
        assert!(
            seeded.is_some(),
            "registered client location must map to a sovereign account"
        );
        let Some((location, funder)) = seeded else {
            return;
        };
        let report = report();
        let program = bleavit_xcm::egress::report_push_program(&report);
        let asset = bleavit_xcm::identity::usdc_location();
        let custody = ClientRegistry::delivery_account(CLIENT);
        let treasury = crate::genesis::treasury_account();
        let reason = RuntimeHoldReason::from(pallet_client_registry::HoldReason::ClientBond);
        let frozen_delivery_id = PalletId(*b"bl/cdelv");
        assert!(configs::ClientDeliveryPalletId::get() == frozen_delivery_id);
        assert_eq!(
            custody,
            frozen_delivery_id.into_sub_account_truncating(CLIENT)
        );
        assert_ne!(custody, ClientRegistry::delivery_account(CLIENT + 1));

        // I-36(1): this compile-time equality fails if the production alias is
        // ever changed to HealthTrackingRouter (or any other wrapper).
        assert_same_type::<xcm_config::ClientEgressRouter, xcm_config::TopicRouter>();

        // I-36(2): the exact fixed-program execution envelope is charged in
        // USDC to the client's float. Native bond custody is byte-for-byte
        // unchanged and MAIN receives an inflow rather than funding an outflow.
        let envelope = xcm_config::UnitWeightCost::get().saturating_mul(3);
        let priced_fee = bleavit_xcm::trader::price_weight_up(
            envelope,
            <ConstitutionTraderRates as bleavit_xcm::trader::TraderRates>::usdc_rate(),
        );
        assert!(priced_fee.is_ok(), "fixed report envelope must price");
        let Ok(expected_fee) = priced_fee else { return };
        assert!(expected_fee > 0);
        assert_eq!(program.0.len(), 3);
        let float_before =
            pallet_client_registry::Clients::<Runtime>::get(CLIENT).map(|row| row.delivery_float);
        let bond_before =
            pallet_client_registry::Clients::<Runtime>::get(CLIENT).map(|row| row.bond);
        let held_before = Balances::balance_on_hold(&reason, &funder);
        let treasury_asset_before = ForeignAssets::balance(asset.clone(), &treasury);
        let treasury_main_before = FutarchyTreasury::treasury().main_usdc;
        assert_eq!(
            <RuntimeClientEgressFees as bleavit_xcm::egress::DeliveryFeePayment>::prepay(
                CLIENT,
                &program,
                Assets::new(),
            ),
            Ok(())
        );
        assert_eq!(
            pallet_client_registry::Clients::<Runtime>::get(CLIENT).map(|row| row.delivery_float),
            float_before.map(|value| value.saturating_sub(expected_fee))
        );
        assert_eq!(
            ForeignAssets::balance(asset.clone(), &treasury),
            treasury_asset_before.saturating_add(expected_fee)
        );
        assert_eq!(
            FutarchyTreasury::treasury().main_usdc,
            treasury_main_before.saturating_add(expected_fee)
        );
        assert_eq!(
            pallet_client_registry::Clients::<Runtime>::get(CLIENT).map(|row| row.bond),
            bond_before
        );
        assert_eq!(Balances::balance_on_hold(&reason, &funder), held_before);
        assert_eq!(ClientRegistry::do_try_state(), Ok(()));

        // A refusal after prepayment rolls both custody and treasury mirrors
        // back in the dispatcher's shared storage layer (G-1).
        let rollback_float =
            pallet_client_registry::Clients::<Runtime>::get(CLIENT).map(|row| row.delivery_float);
        let rollback_custody = ForeignAssets::balance(asset.clone(), &custody);
        let rollback_treasury_asset = ForeignAssets::balance(asset.clone(), &treasury);
        let rollback_treasury_main = FutarchyTreasury::treasury().main_usdc;
        assert_eq!(
            bleavit_xcm::egress::ReportEgress::<
                FailingAfterPrepayRouter,
                RuntimeClientEgressFees,
            >::push(CLIENT, location.clone(), &report),
            Err(bleavit_xcm::egress::PushError::Deliver)
        );
        assert_eq!(
            pallet_client_registry::Clients::<Runtime>::get(CLIENT).map(|row| row.delivery_float),
            rollback_float
        );
        assert_eq!(
            ForeignAssets::balance(asset.clone(), &custody),
            rollback_custody
        );
        assert_eq!(
            ForeignAssets::balance(asset.clone(), &treasury),
            rollback_treasury_asset
        );
        assert_eq!(
            FutarchyTreasury::treasury().main_usdc,
            rollback_treasury_main
        );

        // Exhausting the client-selected float refuses only the optional push.
        // The pull row, native bond and every other service transition remain
        // authoritative and available.
        pallet_question_service::Reports::<Runtime>::insert(QUESTION, &report);
        assert!(
            rollback_float.is_some(),
            "seeded client must retain a delivery float"
        );
        let Some(remaining_float) = rollback_float else {
            return;
        };
        assert_ok!(ClientRegistry::withdraw_delivery_float(
            pallet_client_registry::Origin::ExternalClient(CLIENT).into(),
            remaining_float,
        ));
        assert_eq!(
            bleavit_xcm::egress::ReportEgress::<
                FailingAfterPrepayRouter,
                RuntimeClientEgressFees,
            >::push(CLIENT, location.clone(), &report),
            Err(bleavit_xcm::egress::PushError::Fee(
                bleavit_xcm::egress::DeliveryFeeError::PrepaymentRefused
            ))
        );
        assert_eq!(
            QuestionService::hosted_report(QUESTION),
            Some(report.clone())
        );
        assert_eq!(
            pallet_client_registry::Clients::<Runtime>::get(CLIENT).map(|row| row.delivery_float),
            Some(0)
        );
        assert_eq!(
            pallet_client_registry::Clients::<Runtime>::get(CLIENT).map(|row| row.bond),
            bond_before
        );
        assert_ok!(ClientRegistry::top_up_delivery_float(
            pallet_client_registry::Origin::ExternalClient(CLIENT).into(),
            FLOAT,
        ));
        let push_float =
            pallet_client_registry::Clients::<Runtime>::get(CLIENT).map(|row| row.delivery_float);

        // I-36(3): remove every return channel, publish the authoritative pull
        // row first, then make every optional push fail for every measurable
        // day in the live epoch. Neither report nor float is lost.
        cumulus_pallet_parachain_system::RelevantMessagingState::<Runtime>::kill();
        let epoch = pallet_epoch::EpochOf::<Runtime>::get().index;
        let schedule = pallet_epoch::Schedule::<Runtime>::get();
        let days = schedule
            .length
            .checked_div(futarchy_primitives::kernel::BLOCKS_PER_DAY)
            .unwrap_or(0)
            .max(1);
        let before: Vec<_> = (0..days)
            .map(|day| {
                System::set_block_number(schedule.epoch_start_block.saturating_add(
                    day.saturating_mul(futarchy_primitives::kernel::BLOCKS_PER_DAY),
                ));
                <XcmTrafficRecorder as bleavit_xcm::health::LocalXcmHealthSink>::note_sent();
                let counters = Welfare::xcm_traffic(epoch, u8::try_from(day).unwrap_or(u8::MAX));
                let x = configs::xcm_health(counters);
                assert_eq!(counters.accepted, 1);
                assert_eq!(counters.failed, 0);
                assert_eq!(counters.probe_timeouts, 0);
                assert_eq!(x, FixedU64(pallet_welfare::ONE));
                (counters, x)
            })
            .collect();
        for day in 0..days {
            System::set_block_number(
                schedule.epoch_start_block.saturating_add(
                    day.saturating_mul(futarchy_primitives::kernel::BLOCKS_PER_DAY),
                ),
            );
            QuestionService::attempt_report_push(CLIENT, &report);
        }
        assert_eq!(
            QuestionService::hosted_report(QUESTION),
            Some(report.clone())
        );
        assert_eq!(
            pallet_client_registry::Clients::<Runtime>::get(CLIENT).map(|row| row.delivery_float),
            push_float
        );

        // I-36(4), and the decisive I-24 check: failures exist only in the
        // service meter. Every welfare counter and therefore X is identical
        // across the complete epoch despite every push failing.
        let meter = pallet_client_registry::IngressMeters::<Runtime>::get(CLIENT);
        assert_eq!(meter.report_pushes_total, u64::from(days));
        assert_eq!(meter.report_push_failures_total, u64::from(days));
        assert_eq!(meter.report_push_failures_consecutive, days);
        for (day, (counters_before, x_before)) in before.into_iter().enumerate() {
            let day = u8::try_from(day).unwrap_or(u8::MAX);
            let counters_after = Welfare::xcm_traffic(epoch, day);
            assert_eq!(counters_after, counters_before);
            assert_eq!(configs::xcm_health(counters_after), x_before);
        }
        assert_eq!(ClientRegistry::do_try_state(), Ok(()));
    });
}

#[test]
fn local_client_can_manage_float_but_has_no_push_attempt_or_failure() {
    development_ext().execute_with(|| {
        const LOCAL_CLIENT: u32 = 38;
        let signer = account(238);
        pallet_client_registry::Clients::<Runtime>::insert(
            LOCAL_CLIENT,
            pallet_client_registry::ClientRecord::new_local(
                signer.clone(),
                BOND,
                System::block_number(),
            ),
        );
        pallet_client_registry::ClientIdOfSigner::<Runtime>::insert(&signer, LOCAL_CLIENT);
        assert_ok!(<ForeignAssets as Mutate<AccountId>>::mint_into(
            bleavit_xcm::identity::usdc_location(),
            &signer,
            FLOAT,
        ));
        assert_ok!(ClientRegistry::top_up_delivery_float(
            RuntimeOrigin::signed(signer.clone()),
            FLOAT,
        ));
        assert_ok!(ClientRegistry::withdraw_delivery_float(
            RuntimeOrigin::signed(signer),
            FLOAT,
        ));
        let mut local_report = report();
        local_report.client_id = LOCAL_CLIENT;
        QuestionService::attempt_report_push(LOCAL_CLIENT, &local_report);
        let meter = pallet_client_registry::IngressMeters::<Runtime>::get(LOCAL_CLIENT);
        assert_eq!(meter.report_pushes_total, 0);
        assert_eq!(meter.report_push_failures_total, 0);
        assert_eq!(meter.report_push_failures_consecutive, 0);
    });
}

#[test]
fn tombstoned_live_client_keeps_authoritative_report_without_a_false_push_failure() {
    development_ext().execute_with(|| {
        let seeded = seed_remote_client();
        assert!(
            seeded.is_some(),
            "registered sibling must have a sovereign account"
        );
        let Some((_location, _funder)) = seeded else {
            return;
        };
        pallet_client_registry::Clients::<Runtime>::mutate(CLIENT, |maybe_record| {
            if let Some(record) = maybe_record {
                record.questions_live = 1;
                record.questions_total = 1;
            }
        });
        assert_ok!(ClientRegistry::remove_client(
            crate::track_origins::Origin::GuardianTrack.into(),
            CLIENT,
        ));
        assert!(ClientRegistry::is_removed(CLIENT));
        assert_eq!(
            pallet_client_registry::Clients::<Runtime>::get(CLIENT)
                .map(|record| record.delivery_float),
            Some(0)
        );

        let report = report();
        pallet_question_service::Reports::<Runtime>::insert(QUESTION, &report);
        let meter_before = pallet_client_registry::IngressMeters::<Runtime>::get(CLIENT);
        QuestionService::attempt_report_push(CLIENT, &report);

        assert_eq!(QuestionService::hosted_report(QUESTION), Some(report));
        assert_eq!(
            pallet_client_registry::IngressMeters::<Runtime>::get(CLIENT),
            meter_before
        );
        assert_eq!(ClientRegistry::do_try_state(), Ok(()));
    });
}
