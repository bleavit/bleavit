//! FRAME v2 benchmarks for every question-service dispatchable.

use super::*;
use crate::pallet::{
    Attestations, AttestorBonds, ClientRule, Pallet, QuestionRecord, QuestionTerms, Questions,
    RegisterInput, Terms,
};
use alloc::vec::Vec;
use frame_benchmarking::v2::*;
use frame_support::{traits::EnsureOrigin, BoundedVec};
use frame_system::RawOrigin;
use futarchy_primitives::{bounds, currency, kernel, FixedU64, QuestionPhase};
use pallet_conditional_ledger::Instance1;

const MAX_ATTESTORS_BOUND: u32 = bounds::MAX_SERVICE_ATTESTORS;
const MAX_QUESTIONS_BOUND: u32 = bounds::MAX_CLIENTS;
const START: u32 = 10;
const END: u32 = 30;
const B: Balance = 10_000 * currency::USDC;
const BENCHMARK_FUNDS: Balance = 100_000 * currency::USDC;

fn benchmark_input<T: Config>(count: u32) -> RegisterInput<T::AccountId> {
    let mut attestors = BoundedVec::new();
    for index in 0..count {
        let pushed = attestors.try_push(<T as Config>::BenchmarkHelper::attestor(index));
        assert!(pushed.is_ok());
    }
    RegisterInput {
        sub_id: Some([7; 32]),
        declared_stake: currency::USDC,
        epsilon_1e9: FixedU64(100_000_000),
        tolerance_1e9: FixedU64(10_000_000),
        window_start: START,
        window_end: END,
        b: B,
        rule: ClientRule {
            min_accept_improvement_1e9: FixedU64(0),
        },
        attestors,
    }
}

fn prepare_registered<T: Config>(count: u32) -> (u64, T::AccountId, Vec<T::AccountId>) {
    let client = 0;
    <T as Config>::BenchmarkHelper::prime_params();
    let funder = <T as Config>::BenchmarkHelper::funder(client);
    <T as Config>::BenchmarkHelper::prime_client(client, &funder);
    <T as Config>::BenchmarkHelper::prime_usdc(&funder, BENCHMARK_FUNDS);
    let input = benchmark_input::<T>(count);
    let attestors = input.attestors.to_vec();
    for attestor in &attestors {
        <T as Config>::BenchmarkHelper::prime_usdc(attestor, BENCHMARK_FUNDS);
    }
    let registered =
        Pallet::<T>::register(<T as Config>::BenchmarkHelper::client_origin(client), input);
    assert!(registered.is_ok());
    (kernel::SERVICE_ID_BASE, funder, attestors)
}

fn bond_all<T: Config>(question: u64, attestors: &[T::AccountId]) {
    for attestor in attestors {
        let bonded =
            Pallet::<T>::bond_attestor(RawOrigin::Signed(attestor.clone()).into(), question);
        assert!(bonded.is_ok());
    }
}

fn prepare_open_observed<T: Config>(count: u32) -> (u64, T::AccountId, Vec<T::AccountId>) {
    let (question, funder, attestors) = prepare_registered::<T>(count);
    bond_all::<T>(question, &attestors);
    <T as Config>::BenchmarkHelper::advance_to(START);
    let opened = Pallet::<T>::open(<T as Config>::BenchmarkHelper::client_origin(0), question);
    assert!(opened.is_ok());
    let stored = Questions::<T>::get(question);
    assert!(stored.is_some());
    if let Some(stored) = stored {
        for at in [START, START + (END - START) / 2, END] {
            <T as Config>::BenchmarkHelper::advance_to(at);
            for market in stored.markets {
                let observed = pallet_market::Pallet::<T>::crank_observe(
                    RawOrigin::Signed(funder.clone()).into(),
                    market,
                );
                assert!(observed.is_ok());
            }
        }
    }
    (question, funder, attestors)
}

fn prepare_sealed<T: Config>(count: u32) -> (u64, T::AccountId, Vec<T::AccountId>) {
    let (question, funder, attestors) = prepare_open_observed::<T>(count);
    let sealed = Pallet::<T>::seal(<T as Config>::BenchmarkHelper::client_origin(0), question);
    assert!(sealed.is_ok());
    (question, funder, attestors)
}

#[benchmarks(where T: Config)]
mod benches {
    use super::*;

    #[benchmark]
    fn register(a: Linear<3, MAX_ATTESTORS_BOUND>) {
        <T as Config>::BenchmarkHelper::prime_params();
        let funder = <T as Config>::BenchmarkHelper::funder(0);
        <T as Config>::BenchmarkHelper::prime_client(0, &funder);
        <T as Config>::BenchmarkHelper::prime_usdc(&funder, BENCHMARK_FUNDS);
        <T as Config>::BenchmarkHelper::prime_register_scan(&funder);
        let input = benchmark_input::<T>(a);
        for attestor in &input.attestors {
            <T as Config>::BenchmarkHelper::prime_usdc(attestor, BENCHMARK_FUNDS);
        }

        #[extrinsic_call]
        _(<T as Config>::BenchmarkHelper::client_origin(0), input);

        assert!(Questions::<T>::contains_key(kernel::SERVICE_ID_BASE));
    }

    #[benchmark]
    fn bond_attestor() {
        let (question, _, attestors) = prepare_registered::<T>(3);
        let attestor = attestors[0].clone();

        #[extrinsic_call]
        _(RawOrigin::Signed(attestor.clone()), question);

        assert!(AttestorBonds::<T>::contains_key(question, attestor));
    }

    #[benchmark]
    fn open() {
        let (question, _, attestors) = prepare_registered::<T>(MAX_ATTESTORS_BOUND);
        bond_all::<T>(question, &attestors);
        <T as Config>::BenchmarkHelper::advance_to(START);

        #[extrinsic_call]
        _(<T as Config>::BenchmarkHelper::client_origin(0), question);

        assert_eq!(
            Questions::<T>::get(question).map(|stored| stored.phase),
            Some(QuestionPhase::Open)
        );
    }

    #[benchmark]
    fn seal() {
        let (question, _, _) = prepare_open_observed::<T>(MAX_ATTESTORS_BOUND);

        #[extrinsic_call]
        _(<T as Config>::BenchmarkHelper::client_origin(0), question);

        assert!(crate::pallet::Reports::<T>::contains_key(question));
    }

    #[benchmark]
    fn submit_attestation() {
        let (question, _, attestors) = prepare_sealed::<T>(3);
        let attestor = attestors[0].clone();

        #[extrinsic_call]
        _(
            RawOrigin::Signed(attestor.clone()),
            question,
            FixedU64(500_000_000),
        );

        assert!(Attestations::<T>::contains_key(question, attestor));
    }

    #[benchmark]
    fn settle(a: Linear<3, MAX_ATTESTORS_BOUND>) {
        let (question, funder, attestors) = prepare_sealed::<T>(a);
        // Maximize reachable distinct transfer destinations: one deviator
        // creates a nonzero reward pool and every other named attestor is an
        // honest bond-refund plus reward recipient, followed by INSURANCE.
        let honest = a.saturating_sub(1);
        for (index, attestor) in attestors.iter().enumerate() {
            let value = if index < honest as usize {
                FixedU64(500_000_000)
            } else {
                FixedU64(900_000_000)
            };
            let submitted = Pallet::<T>::submit_attestation(
                RawOrigin::Signed(attestor.clone()).into(),
                question,
                value,
            );
            assert!(submitted.is_ok());
        }
        let terms = Terms::<T>::get(question);
        assert!(terms.is_some());
        if let Some(terms) = terms {
            if let Some(deadline) = terms.settlement_deadline {
                <T as Config>::BenchmarkHelper::advance_to(deadline);
            }
        }
        <T as Config>::BenchmarkHelper::prime_keeper_rebate();

        #[extrinsic_call]
        _(RawOrigin::Signed(funder), question);

        <T as Config>::BenchmarkHelper::assert_keeper_rebate_paid(
            futarchy_primitives::keeper::CrankClass::General,
        );

        assert_eq!(
            Questions::<T>::get(question).map(|stored| stored.phase),
            Some(QuestionPhase::Settled)
        );
    }

    #[benchmark]
    fn void(a: Linear<3, MAX_ATTESTORS_BOUND>) {
        // The pre-seal terminal is the common call's worst case: besides the
        // same service-ledger VOID, pair terminalization and `a` bond returns,
        // it refunds instrument D because no report earned the fee.
        let (question, funder, attestors) = prepare_registered::<T>(a);
        bond_all::<T>(question, &attestors);
        let deadline = END.saturating_add(T::ServiceParams::oracle_window());
        <T as Config>::BenchmarkHelper::advance_to(deadline);
        <T as Config>::BenchmarkHelper::prime_keeper_rebate();

        #[extrinsic_call]
        _(RawOrigin::Signed(funder), question);

        <T as Config>::BenchmarkHelper::assert_keeper_rebate_paid(
            futarchy_primitives::keeper::CrankClass::General,
        );

        assert_eq!(
            Questions::<T>::get(question).map(|stored| stored.phase),
            Some(QuestionPhase::Voided)
        );
    }

    #[benchmark]
    fn set_paused(q: Linear<0, MAX_QUESTIONS_BOUND>) -> Result<(), BenchmarkError> {
        for index in 0..q {
            let question = kernel::SERVICE_ID_BASE + u64::from(index) * 3;
            Questions::<T>::insert(
                question,
                QuestionRecord {
                    client_id: 0,
                    phase: QuestionPhase::Registered,
                    window_start: START,
                    window_end: END,
                    declared_stake: currency::USDC,
                    epsilon_1e9: FixedU64(100_000_000),
                    tolerance_1e9: FixedU64(10_000_000),
                    markets: [question + 1, question + 2],
                },
            );
        }
        <T as Config>::BenchmarkHelper::advance_to(1);
        let origin = <T as pallet_conditional_ledger::Config<Instance1>>::EmergencyPlaybookOrigin::try_successful_origin()
            .map_err(|_| BenchmarkError::Stop("benchmark emergency origin unavailable"))?;

        #[extrinsic_call]
        _(origin, Some(END));

        assert_eq!(
            crate::pallet::PauseAffected::<T>::iter().count(),
            q as usize
        );
        Ok(())
    }

    #[benchmark]
    fn archive(a: Linear<3, MAX_ATTESTORS_BOUND>) {
        let question = kernel::SERVICE_ID_BASE;
        let funder = <T as Config>::BenchmarkHelper::funder(0);
        let input = benchmark_input::<T>(a);
        Questions::<T>::insert(
            question,
            QuestionRecord {
                client_id: 0,
                phase: QuestionPhase::Voided,
                window_start: START,
                window_end: END,
                declared_stake: input.declared_stake,
                epsilon_1e9: input.epsilon_1e9,
                tolerance_1e9: input.tolerance_1e9,
                markets: [question + 1, question + 2],
            },
        );
        Terms::<T>::insert(
            question,
            QuestionTerms::<T> {
                sub_id: [7; 32],
                funder: funder.clone(),
                rule: input.rule,
                b: input.b,
                escrow: 1,
                fee: 1,
                bond_each: 1,
                oracle_window: T::ServiceParams::oracle_window(),
                seal_deadline: END.saturating_add(T::ServiceParams::oracle_window()),
                attestors: input.attestors.clone(),
                winner: None,
                sealed_at: None,
                settlement_deadline: None,
            },
        );
        for attestor in input.attestors {
            AttestorBonds::<T>::insert(question, &attestor, ());
            Attestations::<T>::insert(question, &attestor, FixedU64(500_000_000));
        }
        pallet_market::ExternalBookPairs::<T>::insert(
            question,
            pallet_market::ExternalBookPair {
                client: 0,
                funder: funder.clone(),
                accept: question + 1,
                reject: question + 2,
            },
        );
        <T as Config>::BenchmarkHelper::prime_keeper_rebate();

        #[extrinsic_call]
        _(RawOrigin::Signed(funder), question);

        <T as Config>::BenchmarkHelper::assert_keeper_rebate_paid(
            futarchy_primitives::keeper::CrankClass::General,
        );

        assert!(!Questions::<T>::contains_key(question));
        assert!(!pallet_market::ExternalBookPairs::<T>::contains_key(
            question
        ));
    }

    impl_benchmark_test_suite!(Pallet, crate::mock::new_test_ext(), crate::mock::Test);
}
