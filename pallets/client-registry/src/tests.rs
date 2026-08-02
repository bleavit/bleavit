//! N4 pallet tests: authority closure, exact-location identity, bounded roster,
//! native hold custody, drain-on-removal, ingress metering, and try-state.

use crate::mock::*;
use crate::{
    BondOwners, ClientCount, ClientIdOf, ClientIdOfSigner, ClientPolicies, Clients,
    EnsureExternalClient, Error, HoldReason, IngressMeters, NextClientId, Origin, RemovedClients,
    SubIdPolicy, MAX_CLIENTS,
};
use frame_support::assert_noop;
use frame_support::traits::{
    fungible::{InspectHold, MutateHold},
    fungibles::{Inspect, Mutate},
    tokens::{Fortitude, Precision, Preservation},
    EnsureOrigin,
};
use parity_scale_codec::{Encode, MaxEncodedLen};
use sp_runtime::{DispatchError, TryRuntimeError};
use staging_xcm::latest::{Junction, Location};

fn admit(location: Location) -> Result<(), DispatchError> {
    ClientRegistry::admit_client(values_origin(), location, account(1), SubIdPolicy::Optional)
}

fn client_bond_hold(who: &sp_core::crypto::AccountId32) -> futarchy_primitives::Balance {
    <Balances as InspectHold<_>>::balance_on_hold(&HoldReason::ClientBond.into(), who)
}

#[test]
fn i34_has_one_constructor_and_exact_location_lookup_only() {
    new_test_ext().execute_with(|| {
        fn exhaustive_constructor(origin: Origin) -> crate::ClientId {
            match origin {
                Origin::ExternalClient(client_id) => client_id,
            }
        }

        assert!(Origin::max_encoded_len() <= 5);
        assert_eq!(Origin::ExternalClient(19).encode(), vec![0, 19, 0, 0, 0]);
        assert_eq!(exhaustive_constructor(Origin::ExternalClient(19)), 19);
        assert_eq!(
            EnsureExternalClient::try_origin(external_origin(19)).ok(),
            Some(19)
        );

        assert!(EnsureExternalClient::try_origin(RuntimeOrigin::signed(account(2))).is_err());
        assert!(EnsureExternalClient::try_origin(RuntimeOrigin::root()).is_err());
        assert!(EnsureExternalClient::try_origin(RuntimeOrigin::none()).is_err());
        for governance in pallet_origins::Origin::ALL {
            assert!(EnsureExternalClient::try_origin(RuntimeOrigin::from(governance)).is_err());
        }

        let registered = location(2_000);
        assert!(admit(registered.clone()).is_ok());
        assert_eq!(
            ClientRegistry::origin_for(&registered),
            Some(Origin::ExternalClient(0))
        );
        assert_eq!(ClientRegistry::client_id_of(&registered), Some(0));

        let descended = Location::new(1, [Junction::Parachain(2_000), Junction::PalletInstance(7)]);
        assert_eq!(ClientRegistry::origin_for(&descended), None);
        assert_eq!(ClientRegistry::origin_for(&location(2_001)), None);

        let custom_runtime: RuntimeOrigin = Origin::ExternalClient(0).into();
        let as_raw: Result<frame_system::RawOrigin<_>, RuntimeOrigin> = custom_runtime.into();
        assert!(as_raw.is_err());
        let custom_runtime: RuntimeOrigin = Origin::ExternalClient(0).into();
        let as_governance: Result<pallet_origins::Origin, RuntimeOrigin> = custom_runtime.into();
        assert!(as_governance.is_err());
    });
}

#[test]
fn both_calls_accept_only_constitutional_values() {
    new_test_ext().execute_with(|| {
        let owner = account(1);
        let candidate = location(2_000);
        assert_noop!(
            ClientRegistry::admit_client(
                RuntimeOrigin::signed(account(2)),
                candidate.clone(),
                owner.clone(),
                SubIdPolicy::Optional,
            ),
            DispatchError::BadOrigin
        );
        assert_noop!(
            ClientRegistry::admit_client(
                RuntimeOrigin::root(),
                candidate.clone(),
                owner.clone(),
                SubIdPolicy::Optional,
            ),
            DispatchError::BadOrigin
        );
        assert_noop!(
            ClientRegistry::admit_client(
                RuntimeOrigin::none(),
                candidate.clone(),
                owner.clone(),
                SubIdPolicy::Optional,
            ),
            DispatchError::BadOrigin
        );
        assert_noop!(
            ClientRegistry::admit_client(
                external_origin(0),
                candidate.clone(),
                owner.clone(),
                SubIdPolicy::Optional,
            ),
            DispatchError::BadOrigin
        );
        for governance in pallet_origins::Origin::ALL {
            if governance == pallet_origins::Origin::ConstitutionalValues {
                continue;
            }
            assert_noop!(
                ClientRegistry::admit_client(
                    RuntimeOrigin::from(governance),
                    candidate.clone(),
                    owner.clone(),
                    SubIdPolicy::Optional,
                ),
                DispatchError::BadOrigin
            );
        }
        assert!(admit(candidate).is_ok());

        assert_noop!(
            ClientRegistry::remove_client(RuntimeOrigin::signed(account(2)), 0),
            DispatchError::BadOrigin
        );
        assert_noop!(
            ClientRegistry::remove_client(RuntimeOrigin::root(), 0),
            DispatchError::BadOrigin
        );
        assert_noop!(
            ClientRegistry::remove_client(RuntimeOrigin::none(), 0),
            DispatchError::BadOrigin
        );
        assert_noop!(
            ClientRegistry::remove_client(external_origin(0), 0),
            DispatchError::BadOrigin
        );
        for governance in pallet_origins::Origin::ALL {
            if governance == pallet_origins::Origin::ConstitutionalValues {
                continue;
            }
            assert_noop!(
                ClientRegistry::remove_client(RuntimeOrigin::from(governance), 0),
                DispatchError::BadOrigin
            );
        }
        assert!(ClientRegistry::remove_client(values_origin(), 0).is_ok());
    });
}

#[test]
fn admission_fails_closed_when_bond_is_unset_and_places_an_exact_native_hold_when_set() {
    new_test_ext().execute_with(|| {
        ClientBondValue::set(None);
        assert_noop!(admit(location(2_000)), Error::<Test>::ClientBondUnset);
        assert_eq!(ClientCount::<Test>::get(), 0);
        assert_eq!(client_bond_hold(&account(1)), 0);

        ClientBondValue::set(Some(1_000));
        assert!(ClientRegistry::admit_client(
            values_origin(),
            location(2_000),
            account(1),
            SubIdPolicy::Required,
        )
        .is_ok());
        let record = Clients::<Test>::get(0);
        assert!(record.is_some());
        if let Some(record) = record {
            assert_eq!(record.location, Some(location(2_000)));
            assert_eq!(record.local_signer, None);
            assert_eq!(record.bond, 1_000);
            assert_eq!(record.admitted_at, 1);
            assert_eq!(record.questions_live, 0);
            assert_eq!(record.questions_total, 0);
            assert_eq!(record.delivery_float, 0);
        }
        assert_eq!(ClientPolicies::<Test>::get(0), Some(SubIdPolicy::Required));
        assert_eq!(ClientIdOf::<Test>::get(location(2_000)), Some(0));
        assert_eq!(BondOwners::<Test>::get(0), Some(account(1)));
        assert_eq!(ClientCount::<Test>::get(), 1);
        assert_eq!(NextClientId::<Test>::get(), 1);
        assert_eq!(client_bond_hold(&account(1)), 1_000);
        assert_eq!(ClientRegistry::do_try_state(), Ok(()));
    });
}

#[test]
fn local_admission_uses_the_frozen_identity_shape_and_exact_signer_index() {
    new_test_ext().execute_with(|| {
        let signer = account(2);
        assert!(ClientRegistry::admit_local_client(
            values_origin(),
            signer.clone(),
            account(1),
            SubIdPolicy::Required,
        )
        .is_ok());

        let record = Clients::<Test>::get(0);
        assert!(record.is_some());
        if let Some(record) = record {
            assert_eq!(record.location, None);
            assert_eq!(record.local_signer, Some(signer.clone()));
            assert_eq!(record.bond, 1_000);
            assert_eq!(record.admitted_at, 1);
            assert_eq!(record.questions_live, 0);
            assert_eq!(record.questions_total, 0);
            assert_eq!(record.delivery_float, 0);
        }
        assert_eq!(ClientIdOfSigner::<Test>::get(&signer), Some(0));
        assert_eq!(ClientPolicies::<Test>::get(0), Some(SubIdPolicy::Required));
        assert_eq!(ClientRegistry::client_id_of_signer(&signer), Some(0));
        assert_eq!(ClientRegistry::do_try_state(), Ok(()));

        assert_noop!(
            ClientRegistry::admit_local_client(
                values_origin(),
                signer,
                account(1),
                SubIdPolicy::Optional,
            ),
            Error::<Test>::DuplicateLocation
        );
    });
}

#[test]
fn duplicate_location_and_underfunded_hold_are_status_quo_failures() {
    new_test_ext().execute_with(|| {
        assert!(admit(location(2_000)).is_ok());
        assert_noop!(admit(location(2_000)), Error::<Test>::DuplicateLocation);
        assert_eq!(ClientCount::<Test>::get(), 1);
        assert_eq!(NextClientId::<Test>::get(), 1);
        assert_eq!(client_bond_hold(&account(1)), 1_000);

        assert_noop!(
            ClientRegistry::admit_client(
                values_origin(),
                location(2_001),
                account(99),
                SubIdPolicy::Optional,
            ),
            Error::<Test>::BondInsufficient
        );
        assert_eq!(ClientIdOf::<Test>::get(location(2_001)), None);
        assert_eq!(Clients::<Test>::get(1), None);
        assert_eq!(ClientCount::<Test>::get(), 1);
        assert_eq!(NextClientId::<Test>::get(), 1);
    });
}

#[test]
fn max_clients_bound_refuses_the_next_admission_without_mutation() {
    new_test_ext().execute_with(|| {
        // limit-coverage: MaxClients
        for offset in 0..MAX_CLIENTS {
            assert!(admit(location(2_000 + offset)).is_ok());
        }
        let held = client_bond_hold(&account(1));
        assert_eq!(ClientCount::<Test>::get(), MAX_CLIENTS);
        assert_noop!(
            admit(location(2_000 + MAX_CLIENTS)),
            Error::<Test>::ClientsFull
        );
        assert_eq!(ClientCount::<Test>::get(), MAX_CLIENTS);
        assert_eq!(NextClientId::<Test>::get(), MAX_CLIENTS);
        assert_eq!(client_bond_hold(&account(1)), held);
        assert_eq!(ClientRegistry::do_try_state(), Ok(()));
    });
}

#[test]
fn immediate_removal_releases_bond_and_never_reuses_the_id() {
    new_test_ext().execute_with(|| {
        assert!(admit(location(2_000)).is_ok());
        assert!(ClientRegistry::note_ingress(0).is_ok());
        assert!(ClientRegistry::remove_client(values_origin(), 0).is_ok());
        assert_eq!(Clients::<Test>::get(0), None);
        assert_eq!(ClientIdOf::<Test>::get(location(2_000)), None);
        assert_eq!(BondOwners::<Test>::get(0), None);
        assert!(!RemovedClients::<Test>::contains_key(0));
        assert!(!IngressMeters::<Test>::contains_key(0));
        assert_eq!(ClientCount::<Test>::get(), 0);
        assert_eq!(NextClientId::<Test>::get(), 1);
        assert_eq!(client_bond_hold(&account(1)), 0);

        assert!(admit(location(2_001)).is_ok());
        assert!(Clients::<Test>::contains_key(1));
        assert_eq!(NextClientId::<Test>::get(), 2);
    });

    new_test_ext().execute_with(|| {
        assert!(admit(location(2_000)).is_ok());
        let released = <Balances as MutateHold<_>>::release(
            &HoldReason::ClientBond.into(),
            &account(1),
            1_000,
            Precision::Exact,
        );
        assert_eq!(released, Ok(1_000));
        let event_count = System::events().len();

        assert_noop!(
            ClientRegistry::remove_client(values_origin(), 0),
            Error::<Test>::BondAccounting
        );
        assert!(Clients::<Test>::contains_key(0));
        assert_eq!(ClientIdOf::<Test>::get(location(2_000)), Some(0));
        assert!(!RemovedClients::<Test>::contains_key(0));
        assert_eq!(ClientCount::<Test>::get(), 1);
        assert_eq!(System::events().len(), event_count);
    });
}

#[test]
fn removal_tombstone_refuses_new_questions_but_live_questions_drain_to_release() {
    new_test_ext().execute_with(|| {
        assert!(admit(location(2_000)).is_ok());
        assert!(ClientRegistry::note_question_registered(0).is_ok());
        assert!(ClientRegistry::note_question_registered(0).is_ok());
        assert!(ClientRegistry::remove_client(values_origin(), 0).is_ok());
        assert!(ClientRegistry::is_removed(0));
        assert_eq!(
            ClientRegistry::active_client(0),
            Err(Error::<Test>::ClientRemoved.into())
        );
        assert_eq!(
            ClientRegistry::origin_for(&location(2_000)),
            Some(Origin::ExternalClient(0))
        );
        assert_eq!(client_bond_hold(&account(1)), 1_000);
        assert_noop!(
            ClientRegistry::note_question_registered(0),
            Error::<Test>::ClientRemoved
        );
        let record = Clients::<Test>::get(0);
        assert_eq!(
            record.map(|row| (row.questions_live, row.questions_total)),
            Some((2, 2))
        );

        assert!(ClientRegistry::note_ingress(0).is_ok());
        assert_eq!(IngressMeters::<Test>::get(0).accepted_total, 1);
        assert!(ClientRegistry::note_question_terminal(0).is_ok());
        assert!(Clients::<Test>::contains_key(0));
        assert_eq!(client_bond_hold(&account(1)), 1_000);
        assert!(ClientRegistry::note_question_terminal(0).is_ok());
        assert!(!Clients::<Test>::contains_key(0));
        assert_eq!(ClientRegistry::origin_for(&location(2_000)), None);
        assert_eq!(client_bond_hold(&account(1)), 0);
        assert_noop!(
            ClientRegistry::note_question_terminal(0),
            Error::<Test>::NotRegistered
        );
    });
}

#[test]
fn failed_terminal_release_rolls_back_the_counter_and_tombstone_state() {
    new_test_ext().execute_with(|| {
        assert!(admit(location(2_000)).is_ok());
        assert!(ClientRegistry::note_question_registered(0).is_ok());
        assert!(ClientRegistry::remove_client(values_origin(), 0).is_ok());
        let released = <Balances as MutateHold<_>>::release(
            &HoldReason::ClientBond.into(),
            &account(1),
            1_000,
            Precision::Exact,
        );
        assert_eq!(released, Ok(1_000));

        assert_noop!(
            ClientRegistry::note_question_terminal(0),
            Error::<Test>::BondAccounting
        );
        let record = Clients::<Test>::get(0);
        assert_eq!(record.map(|row| row.questions_live), Some(1));
        assert!(RemovedClients::<Test>::contains_key(0));
        assert_eq!(ClientIdOf::<Test>::get(location(2_000)), Some(0));
        assert_eq!(ClientCount::<Test>::get(), 1);
    });
}

#[test]
fn egress_is_prepaid_from_usdc_float_and_never_touches_the_vit_bond() {
    new_test_ext().execute_with(|| {
        assert!(admit(location(2_000)).is_ok());
        let beneficiary = account(3);
        let asset = DeliveryAssetId::get();
        let custody = ClientRegistry::delivery_account(0);
        let before = <Assets as Inspect<_>>::balance(asset, &beneficiary);
        assert!(ClientRegistry::top_up_delivery_float(external_origin(0), 1_000).is_ok());
        assert_eq!(<Assets as Inspect<_>>::balance(asset, &custody), 1_000);
        assert_eq!(
            Clients::<Test>::get(0).map(|row| row.delivery_float),
            Some(1_000)
        );
        assert_eq!(client_bond_hold(&account(1)), 1_000);
        assert_eq!(Clients::<Test>::get(0).map(|row| row.bond), Some(1_000));

        assert!(ClientRegistry::prepay_egress(0, &beneficiary, 400).is_ok());
        assert_eq!(
            <Assets as Inspect<_>>::balance(asset, &beneficiary),
            before + 400
        );
        assert_eq!(<Assets as Inspect<_>>::balance(asset, &custody), 600);
        assert_eq!(
            Clients::<Test>::get(0).map(|row| row.delivery_float),
            Some(600)
        );
        assert_eq!(client_bond_hold(&account(1)), 1_000);
        assert_eq!(Clients::<Test>::get(0).map(|row| row.bond), Some(1_000));
        assert_eq!(ClientRegistry::do_try_state(), Ok(()));

        assert_noop!(
            ClientRegistry::prepay_egress(0, &beneficiary, 600),
            Error::<Test>::DeliveryFloatWouldDrain
        );
        assert_noop!(
            ClientRegistry::prepay_egress(0, &beneficiary, 601),
            Error::<Test>::DeliveryFloatInsufficient
        );
        assert_noop!(
            ClientRegistry::prepay_egress(0, &beneficiary, 501),
            Error::<Test>::DeliveryFloatBelowMinimum
        );
        assert_eq!(
            <Assets as Inspect<_>>::balance(asset, &beneficiary),
            before + 400
        );
        assert_eq!(
            Clients::<Test>::get(0).map(|row| row.delivery_float),
            Some(600)
        );
        assert_eq!(Clients::<Test>::get(0).map(|row| row.bond), Some(1_000));
    });
}

#[test]
fn float_top_up_withdraw_and_removal_refund_are_exact_and_client_scoped() {
    new_test_ext().execute_with(|| {
        assert!(admit(location(2_000)).is_ok());
        assert!(admit(location(2_001)).is_ok());
        assert_eq!(client_bond_hold(&account(1)), 2_000);
        let asset = DeliveryAssetId::get();
        let funder_before = <Assets as Inspect<_>>::balance(asset, &account(2));

        assert!(ClientRegistry::top_up_delivery_float(external_origin(0), 800).is_ok());
        assert!(ClientRegistry::top_up_delivery_float(external_origin(1), 700).is_ok());
        assert!(ClientRegistry::withdraw_delivery_float(external_origin(0), 300).is_ok());
        assert_eq!(
            Clients::<Test>::get(0).map(|row| row.delivery_float),
            Some(500)
        );
        assert_eq!(
            Clients::<Test>::get(1).map(|row| row.delivery_float),
            Some(700)
        );
        assert_eq!(
            <Assets as Inspect<_>>::balance(asset, &ClientRegistry::delivery_account(0)),
            500
        );
        assert!(ClientRegistry::remove_client(values_origin(), 0).is_ok());
        assert_eq!(
            <Assets as Inspect<_>>::balance(asset, &account(2)),
            funder_before - 700
        );
        assert_eq!(client_bond_hold(&account(1)), 1_000);
        assert_eq!(Clients::<Test>::get(1).map(|row| row.bond), Some(1_000));
        assert_eq!(
            Clients::<Test>::get(1).map(|row| row.delivery_float),
            Some(700)
        );
        assert_eq!(ClientRegistry::do_try_state(), Ok(()));
    });
}

#[test]
fn float_refusals_and_transfer_failures_are_status_quo() {
    new_test_ext().execute_with(|| {
        assert!(admit(location(2_000)).is_ok());
        assert_noop!(
            ClientRegistry::top_up_delivery_float(external_origin(0), 0),
            Error::<Test>::DeliveryFloatAmountZero
        );
        assert_noop!(
            ClientRegistry::withdraw_delivery_float(external_origin(0), 0),
            Error::<Test>::DeliveryFloatAmountZero
        );
        assert_noop!(
            ClientRegistry::withdraw_delivery_float(external_origin(0), 1),
            Error::<Test>::DeliveryFloatInsufficient
        );
        assert_eq!(
            Clients::<Test>::get(0).map(|row| row.delivery_float),
            Some(0)
        );

        let asset = DeliveryAssetId::get();
        let funder_before = <Assets as Inspect<_>>::balance(asset, &account(2));
        let custody_before =
            <Assets as Inspect<_>>::balance(asset, &ClientRegistry::delivery_account(0));
        Clients::<Test>::mutate(0, |maybe_record| {
            if let Some(record) = maybe_record {
                record.delivery_float = futarchy_primitives::Balance::MAX;
            }
        });
        assert_noop!(
            ClientRegistry::top_up_delivery_float(external_origin(0), 1),
            Error::<Test>::DeliveryFloatOverflow
        );
        assert_eq!(
            Clients::<Test>::get(0).map(|row| row.delivery_float),
            Some(futarchy_primitives::Balance::MAX)
        );
        assert_eq!(
            <Assets as Inspect<_>>::balance(asset, &account(2)),
            funder_before
        );
        assert_eq!(
            <Assets as Inspect<_>>::balance(asset, &ClientRegistry::delivery_account(0)),
            custody_before
        );
        Clients::<Test>::mutate(0, |maybe_record| {
            if let Some(record) = maybe_record {
                record.delivery_float = 0;
            }
        });

        let burned = <Assets as Mutate<_>>::burn_from(
            asset,
            &account(2),
            999_450,
            Preservation::Preserve,
            Precision::Exact,
            Fortitude::Polite,
        );
        assert_eq!(burned, Ok(999_450));
        assert_noop!(
            ClientRegistry::top_up_delivery_float(external_origin(0), 500),
            Error::<Test>::DeliveryFundingWouldDust
        );
        assert_eq!(<Assets as Inspect<_>>::balance(asset, &account(2)), 550);
        assert_eq!(
            <Assets as Inspect<_>>::balance(asset, &ClientRegistry::delivery_account(0)),
            0
        );
        assert_eq!(
            <Assets as Mutate<_>>::mint_into(asset, &account(2), 999_450),
            Ok(999_450)
        );
        assert_noop!(
            ClientRegistry::top_up_delivery_float(external_origin(0), 99),
            Error::<Test>::DeliveryFloatBelowMinimum
        );
        assert!(ClientRegistry::top_up_delivery_float(external_origin(0), 500).is_ok());
        assert_noop!(
            ClientRegistry::withdraw_delivery_float(external_origin(0), 401),
            Error::<Test>::DeliveryFloatBelowMinimum
        );
        assert_noop!(
            ClientRegistry::prepay_egress(0, &account(3), 401),
            Error::<Test>::DeliveryFloatBelowMinimum
        );
        // A voluntary withdrawal may close the escrow cleanly; a later top-up
        // can recreate it at or above the asset minimum.
        assert!(ClientRegistry::withdraw_delivery_float(external_origin(0), 500).is_ok());
        assert_eq!(
            Clients::<Test>::get(0).map(|row| row.delivery_float),
            Some(0)
        );
        assert!(ClientRegistry::top_up_delivery_float(external_origin(0), 500).is_ok());
        let burned = <Assets as Mutate<_>>::burn_from(
            asset,
            &ClientRegistry::delivery_account(0),
            500,
            Preservation::Expendable,
            Precision::Exact,
            Fortitude::Polite,
        );
        assert_eq!(burned, Ok(500));
        assert_noop!(
            ClientRegistry::remove_client(values_origin(), 0),
            Error::<Test>::DeliveryFloatAccounting
        );
        assert!(Clients::<Test>::contains_key(0));
        assert!(!RemovedClients::<Test>::contains_key(0));
        assert_eq!(client_bond_hold(&account(1)), 1_000);
    });
}

#[test]
fn ingress_meter_is_per_client_and_saturates_without_rejecting_ingress() {
    new_test_ext().execute_with(|| {
        assert!(admit(location(2_000)).is_ok());
        assert!(admit(location(2_001)).is_ok());
        System::set_block_number(9);
        assert!(ClientRegistry::note_ingress(0).is_ok());
        assert!(ClientRegistry::note_ingress(0).is_ok());
        assert!(ClientRegistry::note_ingress(1).is_ok());
        assert_eq!(IngressMeters::<Test>::get(0).accepted_total, 2);
        assert_eq!(IngressMeters::<Test>::get(0).last_seen, 9);
        assert_eq!(IngressMeters::<Test>::get(1).accepted_total, 1);

        IngressMeters::<Test>::insert(
            0,
            crate::IngressMeter {
                accepted_total: u64::MAX,
                last_seen: 9,
                ..Default::default()
            },
        );
        assert!(ClientRegistry::note_ingress(0).is_ok());
        assert_eq!(IngressMeters::<Test>::get(0).accepted_total, u64::MAX);
    });
}

#[test]
fn try_state_detects_representative_cross_map_and_custody_corruption() {
    new_test_ext().execute_with(|| {
        assert!(admit(location(2_000)).is_ok());
        ClientCount::<Test>::put(0);
        assert_eq!(
            ClientRegistry::do_try_state(),
            Err(TryRuntimeError::Other(
                "client-registry: ClientCount mismatch"
            ))
        );
    });

    new_test_ext().execute_with(|| {
        assert!(admit(location(2_000)).is_ok());
        ClientIdOf::<Test>::remove(location(2_000));
        assert_eq!(
            ClientRegistry::do_try_state(),
            Err(TryRuntimeError::Other(
                "client-registry: reverse identity index mismatch"
            ))
        );
    });

    new_test_ext().execute_with(|| {
        assert!(admit(location(2_000)).is_ok());
        let released = <Balances as MutateHold<_>>::release(
            &HoldReason::ClientBond.into(),
            &account(1),
            1_000,
            Precision::Exact,
        );
        assert_eq!(released, Ok(1_000));
        assert_eq!(
            ClientRegistry::do_try_state(),
            Err(TryRuntimeError::Other(
                "client-registry: native hold mismatch"
            ))
        );
    });

    new_test_ext().execute_with(|| {
        assert!(admit(location(2_000)).is_ok());
        Clients::<Test>::mutate(0, |maybe_record| {
            if let Some(record) = maybe_record {
                record.delivery_float = 1;
            }
        });
        assert_eq!(
            ClientRegistry::do_try_state(),
            Err(TryRuntimeError::Other(
                "client-registry: nonzero delivery float below asset minimum"
            ))
        );
    });

    new_test_ext().execute_with(|| {
        assert!(admit(location(2_000)).is_ok());
        let asset = DeliveryAssetId::get();
        assert_eq!(
            <Assets as Mutate<_>>::mint_into(asset, &ClientRegistry::delivery_account(0), 100,),
            Ok(100)
        );
        // A third-party donation is surplus, not an unbacked client claim,
        // and therefore cannot make try-state an externally triggerable halt.
        assert_eq!(ClientRegistry::do_try_state(), Ok(()));
    });

    new_test_ext().execute_with(|| {
        assert!(admit(location(2_000)).is_ok());
        IngressMeters::<Test>::insert(
            0,
            crate::IngressMeter {
                report_pushes_total: 1,
                report_push_failures_total: 2,
                report_push_failures_consecutive: 1,
                ..Default::default()
            },
        );
        assert_eq!(
            ClientRegistry::do_try_state(),
            Err(TryRuntimeError::Other(
                "client-registry: push failures exceed push attempts"
            ))
        );
    });
}
