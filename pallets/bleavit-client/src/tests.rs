use crate::{mock::*, Error, Question, Reports};
use bleavit_client_abi::{ClientRule, RegisterInput};
use frame_support::{assert_err, assert_ok};
use futarchy_primitives::{FixedU64, ReportView, SettlementTrust};
use parity_scale_codec::Decode;
use staging_xcm::latest::Instruction;

fn question() -> Question {
    let mut attestors = futarchy_primitives::BoundedVec::new();
    assert!(attestors.try_push([1; 32]).is_ok());
    assert!(attestors.try_push([2; 32]).is_ok());
    assert!(attestors.try_push([3; 32]).is_ok());
    Question {
        sub_id: Some([9; 32]),
        declared_stake: 100_000,
        epsilon_1e9: FixedU64(50_000_000),
        tolerance_1e9: FixedU64(20_000_000),
        window: 200,
        attestors,
        rule: ClientRule {
            min_accept_improvement_1e9: FixedU64(10_000_000),
        },
    }
}

fn report(question_id: u64) -> ReportView {
    let mut report = ReportView {
        question_id,
        client_id: ClientId::get(),
        sub_id: [9; 32],
        twap_accept_1e9: FixedU64(600_000_000),
        twap_reject_1e9: FixedU64(400_000_000),
        observations: 12,
        window_start: 20,
        window_end: 220,
        b_accept: 1_000,
        b_reject: 1_000,
        manip_floor: 500,
        declared_stake: 100,
        epsilon_1e9: FixedU64(50_000_000),
        tolerance_1e9: FixedU64(20_000_000),
        certified: true,
        settlement_trust: SettlementTrust {
            attestors: 3,
            quorum: 2,
            bond_total: 3_000,
        },
        provenance_hash: [0; 32],
    };
    report.provenance_hash = sp_io::hashing::blake2_256(
        &question_service_core::report_view_provenance_preimage(&report),
    );
    report
}

#[test]
fn ask_builds_the_exact_positional_program_and_frozen_call() {
    new_test_ext().execute_with(|| {
        assert_ok!(BleavitClient::ask(
            RuntimeOrigin::signed(account(1)),
            question()
        ));
        let (destination, message) = SENT
            .with(|messages| messages.borrow_mut().pop_front())
            .expect("ask must produce one message");
        assert_eq!(destination, BleavitLocation::get());
        assert_eq!(message.0.len(), 6);
        assert!(matches!(message.0[0], Instruction::WithdrawAsset(_)));
        assert!(matches!(message.0[1], Instruction::PayFees { .. }));
        match &message.0[2] {
            Instruction::Transact { call, .. } => {
                let bytes = call.clone().into_encoded();
                assert_eq!(bytes.first(), Some(&66));
                assert_eq!(bytes.get(1), Some(&0));
                let input = RegisterInput::decode(&mut &bytes[2..]).expect("register ABI");
                assert_eq!(input.window_start, 16);
                assert_eq!(input.window_end, 216);
            }
            _ => panic!("the builder must place Transact at position two"),
        }
        assert!(matches!(message.0[3], Instruction::RefundSurplus));
        assert!(matches!(message.0[4], Instruction::DepositAsset { .. }));
        assert!(matches!(message.0[5], Instruction::SetTopic(_)));
    });
}

#[test]
fn receiver_requires_provenance_and_exact_client_id() {
    new_test_ext().execute_with(|| {
        assert_err!(
            BleavitClient::receive_report(RuntimeOrigin::signed(account(1)), report(7)),
            Error::<Test>::BadBleavitOrigin
        );
        assert_ok!(BleavitClient::receive_report(
            RuntimeOrigin::root(),
            report(7)
        ));
        assert_eq!(
            Reports::<Test>::get(7).map(|value| value.question_id),
            Some(7)
        );
        assert_eq!(HANDLER_CALLS.with(|calls| *calls.borrow()), 1);
        assert_err!(
            BleavitClient::receive_report(RuntimeOrigin::root(), report(7)),
            Error::<Test>::ReportAlreadyReceived
        );
    });
}

#[test]
fn handler_failure_rolls_back_report_storage() {
    new_test_ext().execute_with(|| {
        HANDLER_FAILS.with(|fails| *fails.borrow_mut() = true);
        assert_err!(
            BleavitClient::receive_report(RuntimeOrigin::root(), report(8)),
            Error::<Test>::ReportHandlerRejected
        );
        assert!(!Reports::<Test>::contains_key(8));
    });
}

#[test]
fn try_state_checks_the_retained_report_invariant() {
    new_test_ext().execute_with(|| {
        assert_ok!(BleavitClient::receive_report(
            RuntimeOrigin::root(),
            report(9)
        ));
        assert_ok!(BleavitClient::do_try_state());
    });
}
