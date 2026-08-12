//! Best-effort hosted-report egress (16 §9; I-36).
//!
//! This module deliberately has no `LocalXcmHealthSink` type parameter. The
//! runtime binds it to bare `TopicRouter` alongside every externally-triggered
//! route. Only fixed runtime-authored maintenance may use
//! `HealthTrackingRouter`.

use core::marker::PhantomData;

use alloc::vec;
use futarchy_primitives::{ClientId, ReportView};
use sp_runtime::DispatchError;
use staging_xcm::latest::{
    validate_send, Assets, Instruction, Location, OriginKind, SendXcm, WeightLimit, Xcm, XcmHash,
};

/// Exact local delivery-fee seam. Implementations must charge only the client
/// named here and run inside the same storage layer as router delivery.
pub trait DeliveryFeePayment {
    fn prepay(
        client: ClientId,
        program: &Xcm<()>,
        router_quote: Assets,
    ) -> Result<(), DeliveryFeeError>;
}

impl DeliveryFeePayment for () {
    fn prepay(_: ClientId, _: &Xcm<()>, _: Assets) -> Result<(), DeliveryFeeError> {
        Err(DeliveryFeeError::PricingUnavailable)
    }
}

/// Typed local postage refusals. They are never dispatch errors, but remain
/// distinct so the fixed integration path cannot silently collapse why it
/// failed before the aggregate non-welfare counter observes the outcome.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DeliveryFeeError {
    RouterQuoteUnsupported,
    PricingUnavailable,
    PrepaymentRefused,
}

/// Internal outcome classes. They never become service dispatch errors: the
/// report is already authoritative in storage when this path runs.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PushError {
    Validate,
    Fee(DeliveryFeeError),
    Deliver,
}

impl From<DispatchError> for PushError {
    fn from(_: DispatchError) -> Self {
        // `with_storage_layer` requires this conversion for its generic
        // transaction contract. This closure emits its own three outcome
        // classes; a framework-level storage refusal is local fee/accounting
        // failure and must remain outside welfare.
        Self::Fee(DeliveryFeeError::PrepaymentRefused)
    }
}

/// Fixed v5 push shape. N10's receiver admits Bleavit-origin unpaid execution
/// for exactly this ABI call; no external caller chooses any byte below.
pub fn report_push_program(report: &ReportView) -> Xcm<()> {
    Xcm(vec![
        Instruction::UnpaidExecution {
            weight_limit: WeightLimit::Unlimited,
            check_origin: None,
        },
        Instruction::Transact {
            origin_kind: OriginKind::Xcm,
            fallback_max_weight: None,
            call: bleavit_client_abi::receive_report_call(report).into(),
        },
        // Supplying the topic makes both the message identity and the bytes
        // charged for delivery deterministic before router validation.
        Instruction::SetTopic(report.provenance_hash),
    ])
}

/// Dedicated direct-router dispatcher. Validation, exact prepayment and
/// delivery share one storage layer, so a local refusal restores the float.
/// There is intentionally no health sink and no response/query state.
pub struct ReportEgress<Router, Fees>(PhantomData<(Router, Fees)>);

impl<Router, Fees> ReportEgress<Router, Fees>
where
    Router: SendXcm,
    Fees: DeliveryFeePayment,
{
    pub fn push(
        client: ClientId,
        destination: Location,
        report: &ReportView,
    ) -> Result<XcmHash, PushError> {
        let program = report_push_program(report);
        frame_support::storage::with_storage_layer(|| {
            let (ticket, quote) = validate_send::<Router>(destination, program.clone())
                .map_err(|_| PushError::Validate)?;
            Fees::prepay(client, &program, quote).map_err(PushError::Fee)?;
            Router::deliver(ticket).map_err(|_| PushError::Deliver)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::sync::atomic::{AtomicU32, Ordering};
    use futarchy_primitives::{FixedU64, SettlementTrust};
    use staging_xcm::latest::{SendError, SendResult};

    static VALIDATES: AtomicU32 = AtomicU32::new(0);
    static DELIVERS: AtomicU32 = AtomicU32::new(0);
    static PREPAYS: AtomicU32 = AtomicU32::new(0);
    static WELFARE_FAILURES: AtomicU32 = AtomicU32::new(0);

    fn report() -> ReportView {
        ReportView {
            question_id: 7,
            client_id: 3,
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

    struct FailingDirectRouter;
    impl SendXcm for FailingDirectRouter {
        type Ticket = ();

        fn validate(_: &mut Option<Location>, _: &mut Option<Xcm<()>>) -> SendResult<()> {
            VALIDATES.fetch_add(1, Ordering::SeqCst);
            Ok(((), Assets::new()))
        }

        fn deliver(_: ()) -> Result<XcmHash, SendError> {
            DELIVERS.fetch_add(1, Ordering::SeqCst);
            Err(SendError::Transport("closed return channel"))
        }
    }

    struct Paid;
    impl DeliveryFeePayment for Paid {
        fn prepay(_: ClientId, _: &Xcm<()>, _: Assets) -> Result<(), DeliveryFeeError> {
            PREPAYS.fetch_add(1, Ordering::SeqCst);
            Ok(())
        }
    }

    struct PoisonHealthSink;
    impl crate::health::LocalXcmHealthSink for PoisonHealthSink {
        fn note_sent() {}
        fn note_send_failure() {
            WELFARE_FAILURES.fetch_add(1, Ordering::SeqCst);
        }
        fn note_probe_timeout() {}
    }

    #[test]
    fn fixed_program_is_only_unpaid_transact_and_provenance_topic() {
        let report = report();
        let program = report_push_program(&report);
        assert_eq!(program.0.len(), 3);
        assert!(matches!(
            program.0.first(),
            Some(Instruction::UnpaidExecution { .. })
        ));
        let encoded_call = match program.0.get(1) {
            Some(Instruction::Transact {
                origin_kind: OriginKind::Xcm,
                fallback_max_weight: None,
                call,
            }) => Some(call.clone().into_encoded()),
            _ => None,
        };
        assert_eq!(
            encoded_call,
            Some(bleavit_client_abi::receive_report_call(&report))
        );
        assert!(matches!(
            program.0.last(),
            Some(Instruction::SetTopic(topic)) if topic == &report.provenance_hash
        ));
    }

    #[test]
    fn direct_egress_failure_cannot_reach_health_sink() {
        VALIDATES.store(0, Ordering::SeqCst);
        DELIVERS.store(0, Ordering::SeqCst);
        PREPAYS.store(0, Ordering::SeqCst);
        WELFARE_FAILURES.store(0, Ordering::SeqCst);
        let mut ext = sp_io::TestExternalities::default();
        ext.execute_with(|| {
            assert_eq!(
                ReportEgress::<FailingDirectRouter, Paid>::push(
                    3,
                    Location::new(1, [staging_xcm::latest::Junction::Parachain(2_000)]),
                    &report(),
                ),
                Err(PushError::Deliver)
            );
        });
        assert_eq!(VALIDATES.load(Ordering::SeqCst), 1);
        assert_eq!(PREPAYS.load(Ordering::SeqCst), 1);
        assert_eq!(DELIVERS.load(Ordering::SeqCst), 1);
        // PoisonHealthSink is deliberately in scope as the control surface;
        // ReportEgress has no type slot or call capable of reaching it.
        let _ = core::any::TypeId::of::<PoisonHealthSink>();
        assert_eq!(WELFARE_FAILURES.load(Ordering::SeqCst), 0);
    }
}
