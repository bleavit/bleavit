use super::*;
use crate::mock::*;
use frame_support::{
    assert_noop, assert_ok,
    traits::{
        fungibles::Mutate,
        tokens::{Fortitude, Precision, Preservation},
        ConstU32, Contains,
    },
    BoundedVec,
};
use futarchy_primitives::{
    bounds, kernel, Branch, QuestionPhase, ReportView, ScalarSide,
    SettlementTrust as SettlementTrustView, VaultState, VoidReason,
};
use pallet_conditional_ledger::Instance1;
use pallet_market::{core_market::TwapCumulative, MarketAccountProvider};
use parity_scale_codec::{Decode, Encode};

type TestResult = Result<(), &'static str>;

fn input(start: u32) -> Result<RegisterInput<AccountId>, &'static str> {
    let stake = UNIT;
    let epsilon = FixedU64(100_000_000);
    let b = question_service_core::b_min(stake, epsilon).map_err(|_| "b_min")?;
    let attestors = vec![BOB, CHARLIE, DAVE]
        .try_into()
        .map_err(|_| "attestor bound")?;
    Ok(RegisterInput {
        sub_id: Some([7; 32]),
        declared_stake: stake,
        epsilon_1e9: epsilon,
        tolerance_1e9: FixedU64(10_000_000),
        window_start: start,
        window_end: start + 20,
        b,
        rule: ClientRule {
            min_accept_improvement_1e9: FixedU64(0),
        },
        attestors,
    })
}

fn register_and_bond() -> Result<(u64, QuestionTerms<Test>), &'static str> {
    QuestionService::register(client_origin(), input(10)?).map_err(|_| "register")?;
    let question = kernel::SERVICE_ID_BASE;
    let terms = Terms::<Test>::get(question).ok_or("terms")?;
    for attestor in [BOB, CHARLIE, DAVE] {
        QuestionService::bond_attestor(RuntimeOrigin::signed(attestor), question)
            .map_err(|_| "bond")?;
    }
    Ok((question, terms))
}

fn open_and_observe(question: u64) -> TestResult {
    System::set_block_number(10);
    QuestionService::open(client_origin(), question).map_err(|_| "open")?;
    let stored = Questions::<Test>::get(question).ok_or("question")?;
    for block in [10, 20, 30] {
        System::set_block_number(block);
        for market in stored.markets {
            Market::crank_observe(RuntimeOrigin::signed(ALICE), market).map_err(|_| "observe")?;
        }
    }
    Ok(())
}

fn seal(question: u64) -> TestResult {
    QuestionService::seal(client_origin(), question).map_err(|_| "seal")
}

fn usdc(who: AccountId) -> Balance {
    Assets::balance(USDC, who)
}

#[test]
fn provenance_known_vector_matches_the_independent_model() {
    let report = ReportView {
        question_id: 9,
        client_id: 7,
        sub_id: [4; 32],
        twap_accept_1e9: FixedU64(500_000_000),
        twap_reject_1e9: FixedU64(500_000_000),
        observations: 4_320,
        window_start: 10,
        window_end: 43_210,
        b_accept: 10_000 * UNIT,
        b_reject: 10_000 * UNIT,
        manip_floor: 1_559_230_829,
        declared_stake: 500 * UNIT,
        epsilon_1e9: FixedU64(37_500_000),
        tolerance_1e9: FixedU64(10_000_000),
        certified: true,
        settlement_trust: SettlementTrustView {
            attestors: 3,
            quorum: 2,
            bond_total: 30_000 * UNIT,
        },
        provenance_hash: [0; 32],
    };
    assert_eq!(
        sp_io::hashing::blake2_256(&question_service_core::report_view_provenance_preimage(
            &report
        ),),
        [
            0x2d, 0x2e, 0x97, 0x8e, 0x8f, 0x5d, 0xf7, 0x70, 0x92, 0x75, 0x4f, 0xb7, 0x63, 0x30,
            0xb2, 0x36, 0xa1, 0xb9, 0x26, 0x3c, 0x57, 0x4d, 0x6f, 0x86, 0x3e, 0x0d, 0xb9, 0x23,
            0x49, 0xd0, 0x65, 0x6f,
        ]
    );
}

#[test]
fn fee_unset_is_the_atomic_arming_gate() -> TestResult {
    new_test_ext().execute_with(|| -> TestResult {
        FeeRate::set(None);
        let before = usdc(ALICE);
        assert_noop!(
            QuestionService::register(client_origin(), input(10)?),
            Error::<Test>::ServiceRateUnset
        );
        assert_eq!(Questions::<Test>::count(), 0);
        assert_eq!(usdc(ALICE), before);
        assert_eq!(pallet_market::ExternalBookPairs::<Test>::count(), 0);
        Ok(())
    })
}

#[test]
fn attestor_funding_failure_has_its_own_refusal() -> TestResult {
    new_test_ext().execute_with(|| -> TestResult {
        assert_ok!(QuestionService::register(client_origin(), input(10)?));
        let question = kernel::SERVICE_ID_BASE;
        let balance = usdc(BOB);
        Assets::burn_from(
            USDC,
            &BOB,
            balance,
            Preservation::Expendable,
            Precision::Exact,
            Fortitude::Force,
        )
        .map_err(|_| "burn attestor funds")?;
        assert_noop!(
            QuestionService::bond_attestor(RuntimeOrigin::signed(BOB), question),
            Error::<Test>::AttestorBondInsufficient
        );
        assert!(!AttestorBonds::<Test>::contains_key(question, BOB));
        Ok(())
    })
}

#[test]
fn registry_counter_failures_remain_distinct_and_atomic() -> TestResult {
    new_test_ext().execute_with(|| -> TestResult {
        pallet_client_registry::Clients::<Test>::mutate(CLIENT, |record| {
            if let Some(record) = record {
                record.questions_live = u32::MAX;
            }
        });
        let before = usdc(ALICE);
        assert_noop!(
            QuestionService::register(client_origin(), input(10)?),
            pallet_client_registry::Error::<Test>::QuestionCounterOverflow
        );
        assert_eq!(usdc(ALICE), before);
        assert_eq!(Questions::<Test>::count(), 0);
        assert_eq!(pallet_market::ExternalBookPairs::<Test>::count(), 0);
        Ok(())
    })
}

#[test]
fn terminal_registry_drift_fails_closed_and_rolls_back() -> TestResult {
    new_test_ext().execute_with(|| -> TestResult {
        let (question, _) = register_and_bond()?;
        pallet_client_registry::Clients::<Test>::mutate(CLIENT, |record| {
            if let Some(record) = record {
                record.questions_live = 0;
            }
        });
        System::set_block_number(50);
        assert_noop!(
            QuestionService::void(RuntimeOrigin::signed(ALICE), question),
            Error::<Test>::TryStateViolation
        );
        assert_eq!(
            Questions::<Test>::get(question).map(|question| question.phase),
            Some(QuestionPhase::Registered)
        );
        assert_eq!(AttestorBonds::<Test>::iter_prefix(question).count(), 3);
        Ok(())
    })
}

#[test]
fn registration_routes_only_to_the_service_instance_and_books_stay_closed() -> TestResult {
    new_test_ext().execute_with(|| -> TestResult {
        assert_ok!(QuestionService::register(client_origin(), input(10)?));
        let question = kernel::SERVICE_ID_BASE;
        let stored = Questions::<Test>::get(question).ok_or("registered question")?;
        assert_eq!(stored.phase, QuestionPhase::Registered);
        assert!(pallet_conditional_ledger::Vaults::<Test, Instance1>::contains_key(question));
        assert!(!pallet_conditional_ledger::Vaults::<Test>::contains_key(
            question
        ));
        for market in stored.markets {
            let book = pallet_market::Markets::<Test>::get(market).ok_or("external book")?;
            assert_noop!(
                Market::buy(
                    RuntimeOrigin::signed(BOB),
                    market,
                    ScalarSide::Long,
                    UNIT,
                    Balance::MAX,
                ),
                pallet_market::Error::<Test>::NotTrading
            );
            assert!(ServiceProtocol::contains(&book.account));
            assert!(!PrimaryProtocol::contains(&book.account));
        }
        Ok(())
    })
}

#[test]
fn governed_registration_limits_refuse_before_custody() -> TestResult {
    new_test_ext().execute_with(|| -> TestResult {
        // limit-coverage: svc.max_window
        let mut too_long = input(10)?;
        too_long.window_end = 111;
        assert_noop!(
            QuestionService::register(client_origin(), too_long),
            Error::<Test>::WindowTooLong
        );

        // limit-coverage: svc.epsilon_min
        let mut epsilon = input(10)?;
        epsilon.epsilon_1e9 = FixedU64(EpsilonMin::get().0 - 1);
        assert_noop!(
            QuestionService::register(client_origin(), epsilon),
            Error::<Test>::EpsilonOutOfRange
        );

        // limit-coverage: svc.max_live
        MaxLive::set(1);
        assert_ok!(QuestionService::register(client_origin(), input(10)?));
        assert_noop!(
            QuestionService::register(client_origin(), input(40)?),
            Error::<Test>::SlotsExhausted
        );
        Ok(())
    })
}

#[test]
fn attestor_bound_refuses_the_seventeenth_name_before_dispatch() {
    new_test_ext().execute_with(|| {
        // limit-coverage: MaxServiceAttestors
        type Attestors = BoundedVec<AccountId, ConstU32<{ bounds::MAX_SERVICE_ATTESTORS }>>;
        let names = vec![BOB; bounds::MAX_SERVICE_ATTESTORS.saturating_add(1) as usize];
        let encoded = names.encode();

        assert!(Attestors::decode(&mut &encoded[..]).is_err());
        assert_eq!(Questions::<Test>::count(), 0);
        assert_eq!(LiveQuestionCount::<Test>::get(), 0);
        assert_eq!(Assets::balance(USDC, question_account()), 0);
    });
}

#[test]
fn depeg_creation_freeze_is_not_misreported_as_missing_escrow() -> TestResult {
    new_test_ext().execute_with(|| -> TestResult {
        let funder_before = usdc(ALICE);
        pallet_market::CreationFrozenUntil::<Test>::put(100);
        assert_noop!(
            QuestionService::register(client_origin(), input(10)?),
            Error::<Test>::CreationFrozen
        );
        assert_eq!(Questions::<Test>::count(), 0);
        assert_eq!(pallet_market::ExternalBookPairs::<Test>::count(), 0);
        assert_eq!(usdc(ALICE), funder_before);
        assert_eq!(usdc(question_account()), 0);
        Ok(())
    })
}

#[test]
fn client_and_instance_predicates_have_the_required_directions() -> TestResult {
    new_test_ext().execute_with(|| -> TestResult {
        assert!(!PrimaryProtocol::contains(&ALICE));
        assert!(!ServiceProtocol::contains(&ALICE));
        assert!(!ReservedProtocol::contains(&ALICE));
        assert!(!InflowProtocol::contains(&ALICE));

        let primary = MarketAccounts::book(1);
        let service = MarketAccounts::book(kernel::SERVICE_ID_BASE + 1);
        assert!(PrimaryProtocol::contains(&primary));
        assert!(!ServiceProtocol::contains(&primary));
        assert!(ServiceProtocol::contains(&service));
        assert!(!PrimaryProtocol::contains(&service));
        assert!(ReservedProtocol::contains(&primary));
        assert!(ReservedProtocol::contains(&service));
        assert!(InflowProtocol::contains(&INFLOW_ONLY));
        assert!(!ReservedProtocol::contains(&INFLOW_ONLY));

        assert_ok!(ClientRegistry::admit_local_client(
            RuntimeOrigin::root(),
            INFLOW_ONLY,
            INFLOW_ONLY,
            pallet_client_registry::SubIdPolicy::Optional,
        ));
        let origin: RuntimeOrigin = pallet_client_registry::Origin::ExternalClient(1).into();
        assert_noop!(
            QuestionService::register(origin, input(10)?),
            Error::<Test>::ClientIsProtocolAccount
        );
        Ok(())
    })
}

#[test]
fn i37_freeze_latches_are_instance_local() -> TestResult {
    new_test_ext().execute_with(|| -> TestResult {
        assert_ok!(ServiceLedger::set_frozen(
            RuntimeOrigin::signed(EMERGENCY),
            true
        ));
        assert!(pallet_conditional_ledger::FrozenUntil::<Test, Instance1>::exists());
        assert!(!pallet_conditional_ledger::FrozenUntil::<Test>::exists());

        pallet_conditional_ledger::FrozenUntil::<Test, Instance1>::kill();
        assert_ok!(Ledger::set_frozen(RuntimeOrigin::signed(EMERGENCY), true));
        assert!(pallet_conditional_ledger::FrozenUntil::<Test>::exists());
        assert!(!pallet_conditional_ledger::FrozenUntil::<Test, Instance1>::exists());
        Ok(())
    })
}

#[test]
fn i37_market_funds_gate_selects_only_the_book_ledger_instance() -> TestResult {
    new_test_ext().execute_with(|| -> TestResult {
        let (question, _) = register_and_bond()?;
        System::set_block_number(10);
        assert_ok!(QuestionService::open(client_origin(), question));
        let market = Questions::<Test>::get(question).ok_or("question")?.markets[0];

        pallet_conditional_ledger::LedgerDrifted::<Test, Instance1>::put(true);
        assert_noop!(
            Market::buy(
                RuntimeOrigin::signed(BOB),
                market,
                ScalarSide::Long,
                UNIT,
                Balance::MAX,
            ),
            pallet_market::Error::<Test>::Frozen
        );

        pallet_conditional_ledger::LedgerDrifted::<Test, Instance1>::put(false);
        pallet_conditional_ledger::LedgerDrifted::<Test>::put(true);
        assert_ok!(Market::buy(
            RuntimeOrigin::signed(BOB),
            market,
            ScalarSide::Long,
            UNIT,
            Balance::MAX,
        ));
        assert!(pallet_conditional_ledger::LedgerDrifted::<Test>::get());
        assert!(!pallet_conditional_ledger::LedgerDrifted::<Test, Instance1>::get());
        Ok(())
    })
}

#[test]
fn service_escrow_fault_voids_only_the_service_domain() -> TestResult {
    new_test_ext().execute_with(|| -> TestResult {
        let (question, _) = register_and_bond()?;
        OracleWindow::set(40);
        open_and_observe(question)?;
        seal(question)?;
        let deadline = Terms::<Test>::get(question)
            .and_then(|terms| terms.settlement_deadline)
            .ok_or("deadline")?;
        let (custody, liability) =
            ServiceLedger::maintained_collateral_totals().map_err(|_| "service totals")?;
        let deficit_move = custody.saturating_sub(liability).saturating_add(1);
        Assets::burn_from(
            USDC,
            &service_ledger_account(),
            deficit_move,
            Preservation::Expendable,
            Precision::Exact,
            Fortitude::Force,
        )
        .map_err(|_| "burn service custody")?;
        assert_ok!(ServiceLedger::reconcile(RuntimeOrigin::signed(ALICE)));
        assert!(pallet_conditional_ledger::LedgerDrifted::<Test, Instance1>::get());
        assert!(!pallet_conditional_ledger::LedgerDrifted::<Test>::get());
        assert!(!pallet_conditional_ledger::FrozenUntil::<Test>::exists());

        System::set_block_number(u64::from(deadline));
        assert_ok!(QuestionService::void(
            RuntimeOrigin::signed(ALICE),
            question
        ));
        assert_eq!(
            Questions::<Test>::get(question).map(|stored| stored.phase),
            Some(QuestionPhase::Voided)
        );
        assert!(System::events().iter().any(|record| {
            matches!(
                record.event,
                RuntimeEvent::QuestionService(Event::QuestionVoided {
                    question_id,
                    reason: VoidReason::EscrowInsufficient,
                }) if question_id == question
            )
        }));
        assert!(!pallet_conditional_ledger::LedgerDrifted::<Test>::get());
        assert!(!pallet_conditional_ledger::FrozenUntil::<Test>::exists());
        Ok(())
    })
}

#[test]
fn seal_publishes_real_hash_and_earns_the_fee_exactly_once() -> TestResult {
    new_test_ext().execute_with(|| -> TestResult {
        let (question, terms) = register_and_bond()?;
        open_and_observe(question)?;
        let main_before = usdc(MAIN);
        seal(question)?;

        let report = Reports::<Test>::get(question).ok_or("report")?;
        assert_eq!(
            QuestionService::hosted_report(question),
            Some(report.clone())
        );
        assert!(report.manip_floor > 0);
        assert!(report.certified);
        assert_eq!(report.observations, 2);
        assert!(question_service_core::verify_report_view_provenance(
            &report,
            sp_io::hashing::blake2_256,
        ));
        assert_eq!(usdc(MAIN) - main_before, terms.fee);
        assert_eq!(MainCredited::get(), terms.fee);
        assert_eq!(
            Questions::<Test>::get(question).map(|stored| stored.phase),
            Some(QuestionPhase::Sealed)
        );
        let vault = pallet_conditional_ledger::Vaults::<Test, Instance1>::get(question)
            .ok_or("service vault")?;
        assert!(matches!(vault.state, VaultState::Resolved(Branch::Accept)));

        let main_after = usdc(MAIN);
        assert_noop!(
            QuestionService::seal(client_origin(), question),
            Error::<Test>::AlreadySealed
        );
        assert_eq!(usdc(MAIN), main_after);
        QuestionService::do_try_state().map_err(|_| "try-state")?;
        Ok(())
    })
}

#[test]
fn try_state_binds_question_pair_and_client_live_counter() -> TestResult {
    new_test_ext().execute_with(|| -> TestResult {
        let (question, terms) = register_and_bond()?;
        QuestionService::do_try_state().map_err(|_| "initial try-state")?;

        let pair = pallet_market::ExternalBookPairs::<Test>::get(question).ok_or("pair")?;
        let mut corrupt_pair = pair.clone();
        corrupt_pair.reject = corrupt_pair.accept;
        pallet_market::ExternalBookPairs::<Test>::insert(question, corrupt_pair);
        assert!(QuestionService::do_try_state().is_err());
        pallet_market::ExternalBookPairs::<Test>::insert(question, pair);

        let orphan = question.saturating_add(99);
        Terms::<Test>::insert(orphan, terms.clone());
        assert!(QuestionService::do_try_state().is_err());
        Terms::<Test>::remove(orphan);

        AttestorBonds::<Test>::insert(question, 99, ());
        assert!(QuestionService::do_try_state().is_err());
        AttestorBonds::<Test>::remove(question, 99);

        Attestations::<Test>::insert(question, 99, FixedU64(500_000_000));
        assert!(QuestionService::do_try_state().is_err());
        Attestations::<Test>::remove(question, 99);

        Attestations::<Test>::insert(question, BOB, FixedU64(500_000_000));
        assert!(QuestionService::do_try_state().is_err());
        Attestations::<Test>::remove(question, BOB);

        PauseAffected::<Test>::insert(orphan, ());
        assert!(QuestionService::do_try_state().is_err());
        PauseAffected::<Test>::remove(orphan);

        Terms::<Test>::mutate(question, |stored| {
            if let Some(stored) = stored {
                stored.b = stored.b.saturating_add(1);
            }
        });
        assert!(QuestionService::do_try_state().is_err());
        Terms::<Test>::insert(question, terms.clone());

        open_and_observe(question)?;
        AttestorBonds::<Test>::remove(question, BOB);
        assert!(QuestionService::do_try_state().is_err());
        AttestorBonds::<Test>::insert(question, BOB, ());
        seal(question)?;
        let report = Reports::<Test>::get(question).ok_or("report")?;

        let mut forged_report = report.clone();
        forged_report.client_id = forged_report.client_id.saturating_add(1);
        forged_report.provenance_hash = sp_io::hashing::blake2_256(
            &question_service_core::report_view_provenance_preimage(&forged_report),
        );
        Reports::<Test>::insert(question, forged_report);
        assert!(QuestionService::do_try_state().is_err());
        Reports::<Test>::insert(question, report.clone());

        let mut forged_trust = report.clone();
        forged_trust.settlement_trust.quorum =
            forged_trust.settlement_trust.quorum.saturating_add(1);
        forged_trust.provenance_hash = sp_io::hashing::blake2_256(
            &question_service_core::report_view_provenance_preimage(&forged_trust),
        );
        Reports::<Test>::insert(question, forged_trust);
        assert!(QuestionService::do_try_state().is_err());
        Reports::<Test>::insert(question, report.clone());

        let sealed_terms = Terms::<Test>::get(question).ok_or("sealed terms")?;
        let sealed_vault = pallet_conditional_ledger::Vaults::<Test, Instance1>::get(question)
            .ok_or("sealed vault")?;
        let wrong_winner = if sealed_terms.winner == Some(Branch::Accept) {
            Branch::Reject
        } else {
            Branch::Accept
        };
        Terms::<Test>::mutate(question, |stored| {
            if let Some(stored) = stored {
                stored.winner = Some(wrong_winner);
            }
        });
        pallet_conditional_ledger::Vaults::<Test, Instance1>::mutate(question, |vault| {
            if let Some(vault) = vault {
                vault.state = VaultState::Resolved(wrong_winner);
            }
        });
        assert!(QuestionService::do_try_state().is_err());
        Terms::<Test>::insert(question, sealed_terms);
        pallet_conditional_ledger::Vaults::<Test, Instance1>::insert(question, sealed_vault);

        Attestations::<Test>::insert(question, BOB, FixedU64(kernel::SCORE_SCALE + 1));
        assert!(QuestionService::do_try_state().is_err());
        Attestations::<Test>::remove(question, BOB);

        Reports::<Test>::insert(orphan, report);
        assert!(QuestionService::do_try_state().is_err());
        Reports::<Test>::remove(orphan);
        QuestionService::do_try_state().map_err(|_| "restored try-state")?;

        System::set_block_number(50);
        assert_ok!(QuestionService::void(
            RuntimeOrigin::signed(ALICE),
            question
        ));
        AttestorBonds::<Test>::insert(question, BOB, ());
        assert!(QuestionService::do_try_state().is_err());
        AttestorBonds::<Test>::remove(question, BOB);

        pallet_client_registry::Clients::<Test>::mutate(CLIENT, |record| {
            if let Some(record) = record {
                record.questions_live = 1;
            }
        });
        assert!(QuestionService::do_try_state().is_err());
        Ok(())
    })
}

#[test]
fn valid_median_settles_and_splits_deviant_bond_forty_sixty() -> TestResult {
    new_test_ext().execute_with(|| -> TestResult {
        let (question, terms) = register_and_bond()?;
        open_and_observe(question)?;
        seal(question)?;
        let bob_before = usdc(BOB);
        let charlie_before = usdc(CHARLIE);
        let dave_before = usdc(DAVE);
        let insurance_before = usdc(INSURANCE);

        for (attestor, value) in [
            (BOB, FixedU64(500_000_000)),
            (CHARLIE, FixedU64(500_000_000)),
            (DAVE, FixedU64(900_000_000)),
        ] {
            assert_ok!(QuestionService::submit_attestation(
                RuntimeOrigin::signed(attestor),
                question,
                value,
            ));
        }
        let deadline = Terms::<Test>::get(question)
            .and_then(|stored| stored.settlement_deadline)
            .ok_or("deadline")?;
        System::set_block_number(u64::from(deadline));
        assert_ok!(QuestionService::settle(
            RuntimeOrigin::signed(ALICE),
            question
        ));

        let reward_pool = terms.bond_each * 40 / 100;
        let reward_each = reward_pool / 2;
        assert_eq!(usdc(BOB) - bob_before, terms.bond_each + reward_each);
        assert_eq!(
            usdc(CHARLIE) - charlie_before,
            terms.bond_each + reward_each
        );
        assert_eq!(usdc(DAVE), dave_before);
        assert_eq!(
            usdc(INSURANCE) - insurance_before,
            terms.bond_each - 2 * reward_each
        );
        assert_eq!(usdc(question_account()), 0);
        assert_eq!(
            Questions::<Test>::get(question).map(|stored| stored.phase),
            Some(QuestionPhase::Settled)
        );
        let vault = pallet_conditional_ledger::Vaults::<Test, Instance1>::get(question)
            .ok_or("service vault")?;
        assert!(matches!(
            vault.state,
            VaultState::ScalarSettled {
                winner: Branch::Accept,
                s: FixedU64(500_000_000)
            }
        ));
        assert!(!pallet_conditional_ledger::Vaults::<Test>::contains_key(
            question
        ));
        assert_eq!(LiveQuestionCount::<Test>::get(), 0);
        assert_eq!(
            KeeperRebates::get(),
            vec![(ALICE, futarchy_primitives::keeper::CrankClass::General)]
        );
        assert_eq!(
            pallet_client_registry::Clients::<Test>::get(CLIENT)
                .map(|record| record.questions_live),
            Some(0)
        );
        QuestionService::do_try_state().map_err(|_| "try-state")?;
        Ok(())
    })
}

#[test]
fn preseal_deadline_void_refunds_fee_and_every_attestor_bond() -> TestResult {
    new_test_ext().execute_with(|| -> TestResult {
        let client_before = usdc(ALICE);
        let bob_before = usdc(BOB);
        let charlie_before = usdc(CHARLIE);
        let dave_before = usdc(DAVE);
        let (question, terms) = register_and_bond()?;
        System::set_block_number(50);
        assert_ok!(QuestionService::void(RuntimeOrigin::signed(DAVE), question));

        assert_eq!(usdc(ALICE), client_before - terms.escrow);
        assert_eq!(usdc(BOB), bob_before);
        assert_eq!(usdc(CHARLIE), charlie_before);
        assert_eq!(usdc(DAVE), dave_before);
        assert_eq!(usdc(question_account()), 0);
        assert_eq!(MainCredited::get(), 0);
        assert_eq!(
            KeeperRebates::get(),
            vec![(DAVE, futarchy_primitives::keeper::CrankClass::General)]
        );
        assert!(!Reports::<Test>::contains_key(question));
        assert_eq!(
            Questions::<Test>::get(question).map(|stored| stored.phase),
            Some(QuestionPhase::Voided)
        );
        let vault = pallet_conditional_ledger::Vaults::<Test, Instance1>::get(question)
            .ok_or("service vault")?;
        assert!(matches!(vault.state, VaultState::Voided));
        assert!(System::events().iter().any(|record| {
            matches!(
                record.event,
                RuntimeEvent::QuestionService(Event::QuestionVoided {
                    question_id,
                    reason: VoidReason::DeadlineMissed,
                }) if question_id == question
            )
        }));
        QuestionService::do_try_state().map_err(|_| "try-state")?;
        Ok(())
    })
}

#[test]
fn archive_rebates_only_after_successful_cleanup() -> TestResult {
    new_test_ext().execute_with(|| -> TestResult {
        let (question, _) = register_and_bond()?;
        System::set_block_number(50);
        assert_ok!(QuestionService::void(RuntimeOrigin::signed(DAVE), question));
        KeeperRebates::set(Vec::new());

        assert_noop!(
            QuestionService::archive(RuntimeOrigin::signed(ALICE), question),
            Error::<Test>::ArchiveNotReady
        );
        assert!(KeeperRebates::get().is_empty());

        let markets = Questions::<Test>::get(question)
            .ok_or("terminal question")?
            .markets;
        System::set_block_number(150);
        for market in markets {
            assert_ok!(Market::sweep_revenue(RuntimeOrigin::signed(DAVE), market));
        }
        assert_ok!(ServiceLedger::sweep_dust(
            RuntimeOrigin::signed(DAVE),
            question
        ));
        for market in markets {
            assert_ok!(Market::reap(RuntimeOrigin::signed(DAVE), market));
        }
        assert!(!pallet_conditional_ledger::Vaults::<Test, Instance1>::contains_key(question));
        assert!(pallet_market::ExternalBookPairs::<Test>::contains_key(
            question
        ));
        assert_ok!(QuestionService::archive(
            RuntimeOrigin::signed(ALICE),
            question
        ));
        assert_eq!(
            KeeperRebates::get(),
            vec![(ALICE, futarchy_primitives::keeper::CrankClass::General)]
        );
        assert!(!Questions::<Test>::contains_key(question));
        assert!(!pallet_market::ExternalBookPairs::<Test>::contains_key(
            question
        ));
        Ok(())
    })
}

#[test]
fn permissionless_void_cannot_front_run_the_frozen_seal_window() -> TestResult {
    new_test_ext().execute_with(|| -> TestResult {
        let (question, _) = register_and_bond()?;
        open_and_observe(question)?;
        assert_eq!(System::block_number(), 30);
        assert_noop!(
            QuestionService::void(RuntimeOrigin::signed(DAVE), question),
            Error::<Test>::DeadlineNotReached
        );
        assert_ok!(QuestionService::seal(client_origin(), question));
        assert!(Reports::<Test>::contains_key(question));
        assert_eq!(
            Terms::<Test>::get(question).and_then(|terms| terms.settlement_deadline),
            Some(50)
        );
        QuestionService::do_try_state().map_err(|_| "frozen deadline try-state")?;
        Ok(())
    })
}

#[test]
fn expired_seal_window_takes_only_the_preseal_void_edge() -> TestResult {
    new_test_ext().execute_with(|| -> TestResult {
        let (question, _) = register_and_bond()?;
        OracleWindow::set(40);
        open_and_observe(question)?;
        System::set_block_number(50);
        assert_noop!(
            QuestionService::seal(client_origin(), question),
            Error::<Test>::DeadlinePassed
        );
        assert!(!Reports::<Test>::contains_key(question));
        assert_ok!(QuestionService::void(RuntimeOrigin::signed(DAVE), question));
        assert_eq!(
            Questions::<Test>::get(question).map(|stored| stored.phase),
            Some(QuestionPhase::Voided)
        );
        Ok(())
    })
}

#[test]
fn guardian_pause_marks_live_questions_and_voids_at_their_deadline() -> TestResult {
    new_test_ext().execute_with(|| -> TestResult {
        let (question, _) = register_and_bond()?;
        System::set_block_number(10);
        assert_ok!(QuestionService::open(client_origin(), question));
        System::set_block_number(11);
        assert_ok!(QuestionService::set_paused(
            RuntimeOrigin::signed(EMERGENCY),
            Some(40),
        ));
        assert!(QuestionService::trading_open(question));
        assert_noop!(
            QuestionService::register(client_origin(), input(50)?),
            Error::<Test>::ServicePaused
        );
        System::set_block_number(30);
        assert_noop!(
            QuestionService::seal(client_origin(), question),
            Error::<Test>::ServicePaused
        );
        assert_noop!(
            QuestionService::void(RuntimeOrigin::signed(ALICE), question),
            Error::<Test>::DeadlineNotReached
        );
        System::set_block_number(50);
        assert_ok!(QuestionService::void(
            RuntimeOrigin::signed(ALICE),
            question
        ));
        assert!(System::events().iter().any(|record| {
            matches!(
                record.event,
                RuntimeEvent::QuestionService(Event::QuestionVoided {
                    question_id,
                    reason: VoidReason::ServicePaused,
                }) if question_id == question
            )
        }));
        Ok(())
    })
}

#[test]
fn registry_removal_does_not_void_a_live_question() -> TestResult {
    new_test_ext().execute_with(|| -> TestResult {
        let (question, _) = register_and_bond()?;
        assert_ok!(ClientRegistry::remove_client(RuntimeOrigin::root(), CLIENT));
        assert!(pallet_client_registry::RemovedClients::<Test>::contains_key(CLIENT));
        open_and_observe(question)?;
        seal(question)?;
        assert!(Reports::<Test>::contains_key(question));

        let deadline = Terms::<Test>::get(question)
            .and_then(|stored| stored.settlement_deadline)
            .ok_or("deadline")?;
        System::set_block_number(u64::from(deadline));
        assert_ok!(QuestionService::void(
            RuntimeOrigin::signed(ALICE),
            question
        ));
        assert_eq!(
            Questions::<Test>::get(question).map(|stored| stored.phase),
            Some(QuestionPhase::Voided)
        );
        assert!(Reports::<Test>::contains_key(question));
        assert!(!pallet_client_registry::Clients::<Test>::contains_key(
            CLIENT
        ));
        Ok(())
    })
}

#[test]
fn seal_refuses_instead_of_publishing_a_placeholder_manipulation_floor() -> TestResult {
    new_test_ext().execute_with(|| -> TestResult {
        let (question, terms) = register_and_bond()?;
        System::set_block_number(10);
        assert_ok!(QuestionService::open(client_origin(), question));
        let stored = Questions::<Test>::get(question).ok_or("question")?;
        let checkpoints: BoundedVec<_, ConstU32<{ bounds::MAX_TWAP_WINDOWS_PER_MARKET }>> =
            vec![(10, TwapCumulative::ZERO), (30, TwapCumulative::ZERO)]
                .try_into()
                .map_err(|_| "checkpoint bound")?;
        for market in stored.markets {
            pallet_market::TwapCheckpoints::<Test>::insert(market, checkpoints.clone());
        }
        System::set_block_number(30);
        let main_before = usdc(MAIN);
        assert_noop!(
            QuestionService::seal(client_origin(), question),
            Error::<Test>::CertificationUnavailable
        );
        assert!(!Reports::<Test>::contains_key(question));
        assert_eq!(usdc(MAIN), main_before);
        assert_eq!(usdc(question_account()), terms.fee + 3 * terms.bond_each);
        assert_eq!(
            Questions::<Test>::get(question).map(|current| current.phase),
            Some(QuestionPhase::Open)
        );
        System::set_block_number(50);
        assert_ok!(QuestionService::void(
            RuntimeOrigin::signed(ALICE),
            question
        ));
        Ok(())
    })
}

#[test]
fn service_origins_are_narrow_and_permissionless_cranks_remain_signed() -> TestResult {
    new_test_ext().execute_with(|| -> TestResult {
        assert_noop!(
            QuestionService::register(RuntimeOrigin::signed(ALICE), input(10)?),
            Error::<Test>::NotRegistered
        );
        assert_noop!(
            QuestionService::register(RuntimeOrigin::root(), input(10)?),
            Error::<Test>::NotRegistered
        );
        assert_noop!(
            QuestionService::register(RuntimeOrigin::none(), input(10)?),
            Error::<Test>::NotRegistered
        );
        assert_ok!(QuestionService::register(client_origin(), input(10)?));
        let question = kernel::SERVICE_ID_BASE;
        assert_noop!(
            QuestionService::open(RuntimeOrigin::signed(ALICE), question),
            Error::<Test>::NotRegistered
        );
        assert_noop!(
            QuestionService::settle(RuntimeOrigin::root(), question),
            sp_runtime::DispatchError::BadOrigin
        );
        assert_noop!(
            QuestionService::void(RuntimeOrigin::none(), question),
            sp_runtime::DispatchError::BadOrigin
        );
        assert_noop!(
            QuestionService::set_paused(RuntimeOrigin::signed(ALICE), Some(40)),
            sp_runtime::DispatchError::BadOrigin
        );
        Ok(())
    })
}
