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
fn registration_accepts_exact_escrow_plus_fee_and_not_one_unit_less() -> TestResult {
    new_test_ext().execute_with(|| -> TestResult {
        let registration = input(10)?;
        let headroom =
            pallet_market::core_market::seed_headroom(registration.b).map_err(|_| "headroom")?;
        let escrow = headroom.checked_mul(2).ok_or("escrow overflow")?;
        let fee_rate = FeeRate::get().ok_or("fee rate")?;
        let fee = fee_rate
            .mul_ceil(registration.declared_stake)
            .max(kernel::SVC_FEE_FLOOR_USDC);
        let required = escrow.checked_add(fee).ok_or("required overflow")?;
        let one_less = required.checked_sub(1).ok_or("required is zero")?;
        let current = usdc(ALICE);
        let burn = current
            .checked_sub(one_less)
            .ok_or("test account too small")?;

        Assets::burn_from(
            USDC,
            &ALICE,
            burn,
            Preservation::Preserve,
            Precision::Exact,
            Fortitude::Polite,
        )
        .map_err(|_| "burn to one less than required")?;
        assert_noop!(
            QuestionService::register(client_origin(), registration.clone()),
            Error::<Test>::EscrowInsufficient
        );
        assert_eq!(usdc(ALICE), one_less);

        Assets::mint_into(USDC, &ALICE, 1).map_err(|_| "restore exact funding")?;
        assert_ok!(QuestionService::register(client_origin(), registration));
        assert_eq!(usdc(ALICE), 0);
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
fn unset_price_cap_leaves_the_tariff_flat() -> TestResult {
    new_test_ext().execute_with(|| -> TestResult {
        // 16 §8.6 / 13 §1: an unset ceiling means M = 1, NOT a refusal. This is
        // the property that lets N14 ship inert, and it is the opposite of
        // `svc.client_bond`, whose absence does refuse.
        assert_eq!(MockPriceCap::get(), None);
        assert_eq!(
            QuestionService::scarcity_multiplier().0,
            kernel::SCORE_SCALE
        );

        let (_question, terms) = register_and_bond()?;
        // Registration succeeded and paid the flat floor, unscaled.
        assert_eq!(terms.fee, kernel::SVC_FEE_FLOOR_USDC);
        // Nothing was raised, so nothing has to decay.
        assert!(ScarcityMultiplier::<Test>::get().is_none());
        assert_eq!(
            QuestionService::scarcity_multiplier().0,
            kernel::SCORE_SCALE
        );
        Ok(())
    })
}

#[test]
fn scarcity_rises_on_admission_and_decays_linearly_to_one() -> TestResult {
    new_test_ext().execute_with(|| -> TestResult {
        let one = kernel::SCORE_SCALE;
        // Ceiling of 3x over MaxLive = 16 slots: step = (3 - 1)/16 = 0.125.
        MockPriceCap::set(Some(FixedU64(3 * one)));
        let step = (3 * one - one) / 16;

        let start = System::block_number();
        QuestionService::raise_scarcity_for_test();
        assert_eq!(QuestionService::scarcity_multiplier().0, one + step);

        // Half the window elapsed -> half the excess remains (linear decay).
        System::set_block_number(start + u64::from(MaxWindow::get()) / 2);
        assert_eq!(QuestionService::scarcity_multiplier().0, one + step / 2);

        // A full window returns exactly to 1, not merely near it.
        System::set_block_number(start + u64::from(MaxWindow::get()));
        assert_eq!(QuestionService::scarcity_multiplier().0, one);

        // And past the window it stays at 1 rather than going below.
        System::set_block_number(start + u64::from(MaxWindow::get()) * 3);
        assert_eq!(QuestionService::scarcity_multiplier().0, one);
        Ok(())
    })
}

#[test]
fn taking_every_slot_at_once_lands_on_a_divisible_ceiling_exactly() -> TestResult {
    new_test_ext().execute_with(|| -> TestResult {
        let one = kernel::SCORE_SCALE;
        let cap = 3 * one;
        MockPriceCap::set(Some(FixedU64(cap)));

        // The additive step is (cap - 1)/max_live, so max_live admissions in
        // the same block land AT the ceiling -- for a span that divides evenly,
        // which 2e9/16 does. The indivisible case is the separate test above;
        // this one would pass on a broken implementation that ignored the
        // remainder, which is exactly why both exist.
        for _ in 0..MaxLive::get() {
            QuestionService::raise_scarcity_for_test();
        }
        let reached = QuestionService::scarcity_multiplier().0;
        assert_eq!(reached, cap);

        // Further admissions cannot exceed the ceiling.
        QuestionService::raise_scarcity_for_test();
        assert_eq!(QuestionService::scarcity_multiplier().0, cap);
        Ok(())
    })
}

#[test]
fn an_arriving_client_pays_the_price_it_found_not_the_one_it_created() -> TestResult {
    new_test_ext().execute_with(|| -> TestResult {
        MockPriceCap::set(Some(FixedU64(3 * kernel::SCORE_SCALE)));
        // The first client arrives at M = 1 and must pay the flat floor: the
        // raise happens after its own fee is fixed. Charging it the price its
        // own arrival created would make the first registration the most
        // expensive, which is backwards.
        let (_question, terms) = register_and_bond()?;
        assert_eq!(terms.fee, kernel::SVC_FEE_FLOOR_USDC);
        // ...but it did move the price for whoever comes next.
        assert!(QuestionService::scarcity_multiplier().0 > kernel::SCORE_SCALE);
        Ok(())
    })
}

#[test]
fn lowering_the_ceiling_binds_a_price_that_was_already_stored_above_it() -> TestResult {
    new_test_ext().execute_with(|| -> TestResult {
        // Adversarial review finding (2026-08-03, HIGH): `svc.price_cap` is
        // amendable at ×2, and the stored contention term was only clamped when
        // WRITTEN. Lower the ceiling and the old price kept being served, so
        // `M > svc.price_cap` -- which 16 §8.6 says can never happen. It also
        // produced a price DROP on rising demand: the first arrival after the
        // amendment paid the stale 4x, the raise then clamped, and the second
        // arrival paid 2x. Both are fixed by clamping on every read.
        let one = kernel::SCORE_SCALE;
        MockPriceCap::set(Some(FixedU64(4 * one)));
        for _ in 0..MaxLive::get() {
            QuestionService::raise_scarcity_for_test();
        }
        assert_eq!(QuestionService::contention_multiplier().0, 4 * one);

        // Governance halves the ceiling. No admission has happened since.
        MockPriceCap::set(Some(FixedU64(2 * one)));
        assert_eq!(
            QuestionService::contention_multiplier().0,
            2 * one,
            "a stored price above the live ceiling must be clamped on READ"
        );
        assert_eq!(QuestionService::scarcity_multiplier().0, 2 * one);

        // And the sequence is monotone in demand: the next raise cannot make
        // the following client pay LESS than this one.
        QuestionService::raise_scarcity_for_test();
        assert_eq!(QuestionService::scarcity_multiplier().0, 2 * one);
        Ok(())
    })
}

#[test]
fn shortening_the_decay_window_does_not_expire_outstanding_prices_at_once() -> TestResult {
    new_test_ext().execute_with(|| -> TestResult {
        // Adversarial review finding: decay read the LIVE `svc.max_window`, so
        // lowering that row below the elapsed time dropped every outstanding
        // price straight to 1 -- an abrupt fall where 16 §8.6 promises a
        // gradual one. A governance amendment is not a decay. Each stored price
        // now decays on the window in force when it was set.
        let one = kernel::SCORE_SCALE;
        MockPriceCap::set(Some(FixedU64(3 * one)));
        let full = MaxWindow::get();
        let start = System::block_number();
        QuestionService::raise_scarcity_for_test();
        let raised = QuestionService::contention_multiplier().0;
        assert!(raised > one);

        // Two thirds of the ORIGINAL window elapse.
        System::set_block_number(start + u64::from(full) * 2 / 3);
        let midway = QuestionService::contention_multiplier().0;
        assert!(midway > one && midway < raised);

        // Governance halves the window -- now shorter than the elapsed time.
        MaxWindow::set(full / 2);
        assert_eq!(
            QuestionService::contention_multiplier().0,
            midway,
            "an amendment to svc.max_window must not expire a live price"
        );
        Ok(())
    })
}

#[test]
fn the_additive_step_stops_short_of_an_indivisible_ceiling_and_never_over() -> TestResult {
    new_test_ext().execute_with(|| -> TestResult {
        // Adversarial review finding: the docs claimed full occupancy lands
        // EXACTLY on the ceiling. With integer division that holds only when
        // `max_live` divides `cap - 1`. Pin the true property -- short by less
        // than max_live, never over -- so the weaker claim cannot drift back.
        let one = kernel::SCORE_SCALE;
        let max_live = u64::from(MaxLive::get());
        let cap = 3 * one + 7; // span 2e9+7, indivisible by 16
        MockPriceCap::set(Some(FixedU64(cap)));
        for _ in 0..max_live {
            QuestionService::raise_scarcity_for_test();
        }
        let reached = QuestionService::contention_multiplier().0;
        assert!(reached <= cap, "must never exceed the ceiling");
        assert!(
            cap - reached < max_live,
            "shortfall {} must stay under one grid unit per slot",
            cap - reached
        );
        Ok(())
    })
}

#[test]
fn a_ceiling_at_the_floor_is_off_rather_than_a_broken_mechanism() -> TestResult {
    new_test_ext().execute_with(|| -> TestResult {
        // A ceiling within `max_live` grid units of 1 truncates the step to
        // zero, and the proportional starvation lift rounds to nothing. That is
        // the correct reading of a ceiling that close to the 13 §1 minimum of
        // 1, which means OFF -- pinned so it reads as intent, not as a bug
        // someone later "fixes" by rounding a charge up into existence.
        let one = kernel::SCORE_SCALE;
        MockPriceCap::set(Some(FixedU64(one + 1)));
        for _ in 0..MaxLive::get() {
            QuestionService::raise_scarcity_for_test();
        }
        assert_eq!(QuestionService::contention_multiplier().0, one);
        MockStarvation::set(FixedU64(one / 2));
        // The starvation lift rounds UP, so it reaches the one-unit ceiling
        // rather than vanishing -- and is still clamped by it.
        assert_eq!(QuestionService::scarcity_multiplier().0, one + 1);
        Ok(())
    })
}

#[test]
fn starvation_is_inert_while_the_ceiling_is_unset() -> TestResult {
    new_test_ext().execute_with(|| -> TestResult {
        // 16 §8.7: one adopted row arms both halves of M. A starved chain with
        // no ceiling must price exactly as today, or N15 would arm itself.
        assert_eq!(MockPriceCap::get(), None);
        MockStarvation::set(FixedU64(kernel::SCORE_SCALE));
        assert_eq!(
            QuestionService::starvation_multiplier().0,
            kernel::SCORE_SCALE
        );
        let (_question, terms) = register_and_bond()?;
        assert_eq!(terms.fee, kernel::SVC_FEE_FLOOR_USDC);
        Ok(())
    })
}

#[test]
fn starvation_raises_the_price_in_proportion_and_stops_at_the_ceiling() -> TestResult {
    new_test_ext().execute_with(|| -> TestResult {
        let one = kernel::SCORE_SCALE;
        let cap = 3 * one;
        MockPriceCap::set(Some(FixedU64(cap)));

        // Healthy books leave M alone.
        MockStarvation::set(FixedU64(0));
        assert_eq!(QuestionService::scarcity_multiplier().0, one);

        // Half-starved: M = 1 + 0.5 * (3 - 1) = 2.
        MockStarvation::set(FixedU64(one / 2));
        assert_eq!(QuestionService::scarcity_multiplier().0, 2 * one);

        // Fully starved lands exactly on the ceiling.
        MockStarvation::set(FixedU64(one));
        assert_eq!(QuestionService::scarcity_multiplier().0, cap);

        // A probe that over-reports is clamped, not trusted.
        MockStarvation::set(FixedU64(one * 9));
        assert_eq!(QuestionService::scarcity_multiplier().0, cap);
        Ok(())
    })
}

#[test]
fn the_starvation_response_has_no_cliff_to_race() -> TestResult {
    new_test_ext().execute_with(|| -> TestResult {
        // The gaming finding N15 exists to answer: a binary latch makes
        // operators race to register before the threshold trips. A continuous
        // response has no threshold, so walking starvation in even steps must
        // move the price in even steps -- never in one jump.
        let one = kernel::SCORE_SCALE;
        let cap = 5 * one;
        MockPriceCap::set(Some(FixedU64(cap)));

        let steps = 32_u64;
        let mut previous = one;
        let mut largest_jump = 0_u64;
        for step in 0..=steps {
            MockStarvation::set(FixedU64(one * step / steps));
            let current = QuestionService::scarcity_multiplier().0;
            assert!(current >= previous, "response must be monotone");
            largest_jump = largest_jump.max(current - previous);
            previous = current;
        }
        assert_eq!(previous, cap);
        // Any single step is at most one thirty-second of the span, plus the
        // rounding residue. A cliff would show up here as a jump near the span.
        let span = cap - one;
        assert!(
            largest_jump <= span / steps + 1,
            "largest single-step move {largest_jump} looks like a cliff in a span of {span}"
        );
        Ok(())
    })
}

#[test]
fn a_transient_starvation_leaves_no_residue_in_the_stored_price() -> TestResult {
    new_test_ext().execute_with(|| -> TestResult {
        // The reason `raise_scarcity` reads the CONTENTION term and not the
        // combined one. If an admission during starvation ratcheted the
        // starvation level into stored state, it would decay out slowly over
        // `svc.max_window` -- a price outliving the condition that set it, and
        // hysteresis nobody asked for.
        let one = kernel::SCORE_SCALE;
        let cap = 3 * one;
        MockPriceCap::set(Some(FixedU64(cap)));
        let step = (cap - one) / u64::from(MaxLive::get());

        MockStarvation::set(FixedU64(one));
        assert_eq!(QuestionService::scarcity_multiplier().0, cap);
        // Admit while fully starved: contention rises by exactly one step, not
        // to the ceiling the starvation reading happened to be showing.
        QuestionService::raise_scarcity_for_test();
        assert_eq!(QuestionService::contention_multiplier().0, one + step);

        // Books recover -> the price drops back to the contention term at once.
        MockStarvation::set(FixedU64(0));
        assert_eq!(QuestionService::scarcity_multiplier().0, one + step);
        Ok(())
    })
}

#[test]
fn the_two_halves_combine_by_max_and_never_exceed_the_ceiling() -> TestResult {
    new_test_ext().execute_with(|| -> TestResult {
        let one = kernel::SCORE_SCALE;
        let cap = 3 * one;
        MockPriceCap::set(Some(FixedU64(cap)));

        // Drive contention to the ceiling, then add full starvation on top.
        for _ in 0..MaxLive::get() {
            QuestionService::raise_scarcity_for_test();
        }
        assert_eq!(QuestionService::contention_multiplier().0, cap);
        MockStarvation::set(FixedU64(one));
        // `max`, not a product: a product would reach cap^2 = 9x here and would
        // need its own registry row to bound.
        assert_eq!(QuestionService::scarcity_multiplier().0, cap);

        // And the larger half wins in both directions.
        MockStarvation::set(FixedU64(0));
        assert_eq!(QuestionService::scarcity_multiplier().0, cap);
        ScarcityMultiplier::<Test>::kill();
        MockStarvation::set(FixedU64(one / 4));
        assert_eq!(QuestionService::contention_multiplier().0, one);
        assert_eq!(
            QuestionService::scarcity_multiplier().0,
            one + (cap - one) / 4
        );
        Ok(())
    })
}

#[test]
fn a_starved_chain_charges_every_client_and_grandfathers_none() -> TestResult {
    new_test_ext().execute_with(|| -> TestResult {
        // The second gaming finding: a latch that locks out entrants while live
        // questions keep running makes an incumbent's slot exclusive exactly
        // when Bleavit is damaged, so suppressing Bleavit's contest capital
        // becomes profitable for a slot-holder. Under a price response there is
        // no exclusivity to win -- registration stays OPEN, and the incumbent's
        // own next question costs the same raised price as anyone else's.
        let one = kernel::SCORE_SCALE;
        MockPriceCap::set(Some(FixedU64(3 * one)));
        MockStarvation::set(FixedU64(one));

        let (_first, terms) = register_and_bond()?;
        assert_eq!(terms.fee, kernel::SVC_FEE_FLOOR_USDC * 3);

        // The door is still open: a second client is admitted, at the same
        // raised price rather than being refused.
        QuestionService::register(client_origin(), input(11)?).map_err(|_| "second register")?;
        let second = Terms::<Test>::get(kernel::SERVICE_ID_BASE + 3).ok_or("second terms")?;
        assert_eq!(second.fee, kernel::SVC_FEE_FLOOR_USDC * 3);
        Ok(())
    })
}

#[test]
fn the_scarcity_premium_lands_in_main_with_the_rest_of_the_fee() -> TestResult {
    new_test_ext().execute_with(|| -> TestResult {
        let one = kernel::SCORE_SCALE;
        let cap = 3 * one;
        MockPriceCap::set(Some(FixedU64(cap)));
        // Push the price all the way to the ceiling before anyone registers, so
        // the fee under test is unambiguously floor + premium and not the floor
        // alone. 3x is chosen to make the premium the larger of the two terms.
        for _ in 0..MaxLive::get() {
            QuestionService::raise_scarcity_for_test();
        }
        assert_eq!(QuestionService::scarcity_multiplier().0, cap);

        let (question, terms) = register_and_bond()?;
        // The charge really is scaled -- otherwise the assertion below would
        // pass trivially on an unscaled fee.
        assert_eq!(terms.fee, kernel::SVC_FEE_FLOOR_USDC * 3);
        let premium = terms.fee - kernel::SVC_FEE_FLOOR_USDC;
        assert!(premium > kernel::SVC_FEE_FLOOR_USDC);

        open_and_observe(question)?;
        let main_before = usdc(MAIN);
        seal(question)?;

        // 16 §8.6: the WHOLE scaled fee goes to MAIN. An earlier revision of
        // that section routed `premium` to POL instead; this pins the routing
        // that replaced it, so a future edit reinstating the POL leg has to
        // fail here rather than pass silently by crediting less to MAIN.
        assert_eq!(usdc(MAIN) - main_before, terms.fee);
        assert_eq!(MainCredited::get(), terms.fee);
        QuestionService::do_try_state().map_err(|_| "try-state")?;
        Ok(())
    })
}

#[test]
fn external_depth_accounting_tracks_register_and_terminal() -> TestResult {
    new_test_ext().execute_with(|| -> TestResult {
        // 16 §8.4 / SQ-575. The condition was normative from N1 and had no
        // implementation at all; this is the external side of it, so the
        // accounting is asserted rather than assumed.
        assert_eq!(LiveExternalDepth::<Test>::get(), 0);
        let (question, terms) = register_and_bond()?;
        assert_eq!(LiveExternalDepth::<Test>::get(), terms.escrow);
        assert!(terms.escrow > 0, "a live question must post depth");
        QuestionService::do_try_state().map_err(|_| "try-state after register")?;

        open_and_observe(question)?;
        seal(question)?;
        // Still live between seal and terminal: the report is delivered but the
        // depth is not released until the question actually terminates.
        assert_eq!(LiveExternalDepth::<Test>::get(), terms.escrow);
        QuestionService::do_try_state().map_err(|_| "try-state after seal")?;
        Ok(())
    })
}

#[test]
fn try_state_catches_external_depth_drift_in_both_directions() -> TestResult {
    new_test_ext().execute_with(|| -> TestResult {
        let (_question, terms) = register_and_bond()?;
        QuestionService::do_try_state().map_err(|_| "initial try-state")?;

        // Low reads as headroom the arming bound does not have; high denies
        // honest clients. Both must fail, so the fold is pinned in both
        // directions rather than only against under-counting.
        LiveExternalDepth::<Test>::put(terms.escrow.saturating_sub(1));
        assert!(QuestionService::do_try_state().is_err());

        LiveExternalDepth::<Test>::put(terms.escrow.saturating_add(1));
        assert!(QuestionService::do_try_state().is_err());

        LiveExternalDepth::<Test>::put(terms.escrow);
        QuestionService::do_try_state().map_err(|_| "restored try-state")?;
        Ok(())
    })
}

#[test]
fn failed_best_effort_push_cannot_roll_back_or_void_the_authoritative_report() -> TestResult {
    new_test_ext().execute_with(|| -> TestResult {
        set_report_push_outcome(ReportPushOutcome::Failed);
        let (question, _) = register_and_bond()?;
        open_and_observe(question)?;

        assert_ok!(QuestionService::seal(client_origin(), question));
        assert_eq!(report_push_count(), 1);
        let report = Reports::<Test>::get(question).ok_or("authoritative report")?;
        assert_eq!(QuestionService::hosted_report(question), Some(report));
        assert_eq!(
            Questions::<Test>::get(question).map(|stored| stored.phase),
            Some(QuestionPhase::Sealed)
        );
        let meter = pallet_client_registry::IngressMeters::<Test>::get(CLIENT);
        assert_eq!(meter.report_pushes_total, 1);
        assert_eq!(meter.report_push_failures_total, 1);
        assert_eq!(meter.report_push_failures_consecutive, 1);

        // A retry is not implicit: the lifecycle refusal remains authoritative
        // and the failed optional leg cannot manufacture another attempt.
        assert_noop!(
            QuestionService::seal(client_origin(), question),
            Error::<Test>::AlreadySealed
        );
        assert_eq!(report_push_count(), 1);
        assert!(Reports::<Test>::contains_key(question));
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
