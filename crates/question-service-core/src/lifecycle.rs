//! Architecture 16 §4's two-terminal hosted-question state machine.

use futarchy_primitives::{FixedU64, QuestionPhase, VoidReason};
use parity_scale_codec::{Decode, DecodeWithMemTracking, Encode, MaxEncodedLen};
use scale_info::TypeInfo;

use crate::{
    attestor_median, AttestorError, AttestorMedian, AttestorReport, QuestionId, Report,
    ServiceError,
};

#[derive(
    Clone,
    Copy,
    Debug,
    Decode,
    DecodeWithMemTracking,
    Encode,
    Eq,
    MaxEncodedLen,
    PartialEq,
    TypeInfo,
)]
pub struct Registered;

#[derive(
    Clone,
    Copy,
    Debug,
    Decode,
    DecodeWithMemTracking,
    Encode,
    Eq,
    MaxEncodedLen,
    PartialEq,
    TypeInfo,
)]
pub struct Open;

#[derive(
    Clone, Debug, Decode, DecodeWithMemTracking, Encode, Eq, MaxEncodedLen, PartialEq, TypeInfo,
)]
#[scale_info(skip_type_params(MAX_ATTESTORS))]
pub struct Sealed<const MAX_ATTESTORS: u32> {
    report: Report<MAX_ATTESTORS>,
}

#[derive(
    Clone, Debug, Decode, DecodeWithMemTracking, Encode, Eq, MaxEncodedLen, PartialEq, TypeInfo,
)]
#[scale_info(skip_type_params(MAX_ATTESTORS))]
pub struct Settled<const MAX_ATTESTORS: u32> {
    report: Report<MAX_ATTESTORS>,
    median: AttestorMedian,
}

/// Type-level witness that a pre-Seal VOID cannot carry a delivered report.
#[derive(
    Clone,
    Copy,
    Debug,
    Decode,
    DecodeWithMemTracking,
    Encode,
    Eq,
    MaxEncodedLen,
    PartialEq,
    TypeInfo,
)]
pub struct NoReport;

#[derive(
    Clone, Debug, Decode, DecodeWithMemTracking, Encode, Eq, MaxEncodedLen, PartialEq, TypeInfo,
)]
pub struct Voided<R> {
    delivered_report: R,
    reason: VoidReason,
}

/// A question is parameterized by its phase. Only the three non-terminal
/// phase types have transition methods, so a non-terminal state with no
/// outgoing edge cannot be represented by this API.
#[derive(
    Clone, Debug, Decode, DecodeWithMemTracking, Encode, Eq, MaxEncodedLen, PartialEq, TypeInfo,
)]
pub struct Question<S> {
    question_id: QuestionId,
    state: S,
}

/// A seal refusal returns every consumed value, so the still-open question can
/// take its mandatory VOID edge without reconstructing state.
#[derive(
    Clone, Debug, Decode, DecodeWithMemTracking, Encode, Eq, MaxEncodedLen, PartialEq, TypeInfo,
)]
#[scale_info(skip_type_params(MAX_ATTESTORS))]
pub struct SealRefusal<const MAX_ATTESTORS: u32> {
    question: Question<Open>,
    report: Report<MAX_ATTESTORS>,
    error: ServiceError,
}

/// Sealing either publishes the correctly bound report or refuses without a
/// state transition. A refusal carries the still-open question so its caller
/// can take the universal VOID edge.
#[derive(
    Clone, Debug, Decode, DecodeWithMemTracking, Encode, Eq, MaxEncodedLen, PartialEq, TypeInfo,
)]
#[scale_info(skip_type_params(MAX_ATTESTORS))]
pub enum SealOutcome<const MAX_ATTESTORS: u32> {
    Sealed(Question<Sealed<MAX_ATTESTORS>>),
    Refused(SealRefusal<MAX_ATTESTORS>),
}

impl<const MAX_ATTESTORS: u32> SealRefusal<MAX_ATTESTORS> {
    pub const fn question(&self) -> &Question<Open> {
        &self.question
    }

    pub const fn report(&self) -> &Report<MAX_ATTESTORS> {
        &self.report
    }

    pub const fn error(&self) -> ServiceError {
        self.error
    }

    pub fn into_parts(self) -> (Question<Open>, Report<MAX_ATTESTORS>, ServiceError) {
        (self.question, self.report, self.error)
    }
}

/// The sealed settlement operation has exactly the two terminal results from
/// architecture 16 §4. An attestor failure is converted to VOID, never returned
/// as a stranded `Sealed` value.
#[derive(
    Clone, Debug, Decode, DecodeWithMemTracking, Encode, Eq, MaxEncodedLen, PartialEq, TypeInfo,
)]
#[scale_info(skip_type_params(MAX_ATTESTORS))]
pub enum Terminal<const MAX_ATTESTORS: u32> {
    Settled(Question<Settled<MAX_ATTESTORS>>),
    Voided(Question<Voided<Report<MAX_ATTESTORS>>>),
}

impl<S> Question<S> {
    pub const fn question_id(&self) -> QuestionId {
        self.question_id
    }
}

impl Question<Registered> {
    pub const fn register(question_id: QuestionId) -> Self {
        Self {
            question_id,
            state: Registered,
        }
    }

    pub const fn phase(&self) -> QuestionPhase {
        QuestionPhase::Registered
    }

    pub fn open(self) -> Question<Open> {
        Question {
            question_id: self.question_id,
            state: Open,
        }
    }

    pub fn void(self, reason: VoidReason) -> Question<Voided<NoReport>> {
        Question {
            question_id: self.question_id,
            state: Voided {
                delivered_report: NoReport,
                reason,
            },
        }
    }
}

impl Question<Open> {
    pub const fn phase(&self) -> QuestionPhase {
        QuestionPhase::Open
    }

    pub fn seal<const MAX_ATTESTORS: u32>(
        self,
        report: Report<MAX_ATTESTORS>,
    ) -> SealOutcome<MAX_ATTESTORS> {
        if report.question_id != self.question_id {
            return SealOutcome::Refused(SealRefusal {
                question: self,
                report,
                error: ServiceError::UnknownQuestion,
            });
        }
        SealOutcome::Sealed(Question {
            question_id: self.question_id,
            state: Sealed { report },
        })
    }

    pub fn void(self, reason: VoidReason) -> Question<Voided<NoReport>> {
        Question {
            question_id: self.question_id,
            state: Voided {
                delivered_report: NoReport,
                reason,
            },
        }
    }
}

impl<const MAX_ATTESTORS: u32> Question<Sealed<MAX_ATTESTORS>> {
    pub const fn phase(&self) -> QuestionPhase {
        QuestionPhase::Sealed
    }

    pub const fn report(&self) -> &Report<MAX_ATTESTORS> {
        &self.state.report
    }

    fn settle(self, median: AttestorMedian) -> Question<Settled<MAX_ATTESTORS>> {
        Question {
            question_id: self.question_id,
            state: Settled {
                report: self.state.report,
                median,
            },
        }
    }

    pub fn void(self, reason: VoidReason) -> Question<Voided<Report<MAX_ATTESTORS>>> {
        Question {
            question_id: self.question_id,
            state: Voided {
                delivered_report: self.state.report,
                reason,
            },
        }
    }

    /// Resolve the attestor path directly into exactly one terminal state.
    pub fn settle_from_attestors(
        self,
        reports: &[AttestorReport],
        tolerance: FixedU64,
    ) -> Terminal<MAX_ATTESTORS> {
        let named = self.state.report.settlement_trust.attestors();
        match attestor_median(named, reports, tolerance) {
            Ok(median) => Terminal::Settled(self.settle(median)),
            Err(AttestorError::QuorumNotReached) => {
                Terminal::Voided(self.void(VoidReason::NoQuorum))
            }
            Err(AttestorError::MedianOutOfRange | AttestorError::ToleranceOutOfRange) => {
                Terminal::Voided(self.void(VoidReason::MedianOutOfRange))
            }
            Err(
                AttestorError::AttestorSetTooSmall
                | AttestorError::DuplicateAttestor
                | AttestorError::UnknownAttestor
                | AttestorError::DuplicateReport
                | AttestorError::ReportCountExceedsSet,
            ) => Terminal::Voided(self.void(VoidReason::AttestorSetCollapsed)),
        }
    }
}

impl<const MAX_ATTESTORS: u32> Question<Settled<MAX_ATTESTORS>> {
    pub const fn phase(&self) -> QuestionPhase {
        QuestionPhase::Settled
    }

    pub const fn report(&self) -> &Report<MAX_ATTESTORS> {
        &self.state.report
    }

    pub const fn median(&self) -> AttestorMedian {
        self.state.median
    }
}

impl<R> Question<Voided<R>> {
    pub const fn phase(&self) -> QuestionPhase {
        QuestionPhase::Voided
    }

    pub const fn reason(&self) -> VoidReason {
        self.state.reason
    }

    pub const fn delivered_report(&self) -> &R {
        &self.state.delivered_report
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{assemble_report, ReportDraft, SettlementTrust};
    use futarchy_fixed::FixedError;
    use futarchy_primitives::{currency, BoundedVec, H256};

    const MAX: u32 = 3;

    fn hash(_: &[u8]) -> H256 {
        [9; 32]
    }

    fn report(question_id: QuestionId) -> Result<Report<MAX>, FixedError> {
        let mut attestors = BoundedVec::new();
        for account in [[1; 32], [2; 32], [3; 32]] {
            if attestors.try_push(account).is_err() {
                return Err(FixedError::Domain);
            }
        }
        let trust = SettlementTrust::new(attestors, 30_000 * currency::USDC)
            .map_err(|_| FixedError::Domain)?;
        assemble_report(
            ReportDraft {
                question_id,
                client_id: 2,
                sub_id: [3; 32],
                twap_accept_1e9: FixedU64(500_000_000),
                twap_reject_1e9: FixedU64(500_000_000),
                observations: 100,
                window_start: 10,
                window_end: 110,
                b_accept: 10_000 * currency::USDC,
                b_reject: 10_000 * currency::USDC,
                declared_stake: 100 * currency::USDC,
                epsilon_1e9: FixedU64(50_000_000),
                tolerance_1e9: FixedU64(5_000_000),
                settlement_trust: trust,
            },
            0,
            FixedU64(16_000_000_000),
            hash,
        )
    }

    fn sealed(question_id: QuestionId) -> Result<Question<Sealed<MAX>>, FixedError> {
        match Question::<Registered>::register(question_id)
            .open()
            .seal(report(question_id)?)
        {
            SealOutcome::Sealed(question) => Ok(question),
            SealOutcome::Refused(_) => Err(FixedError::Domain),
        }
    }

    #[test]
    fn only_the_documented_success_chain_is_available() -> Result<(), FixedError> {
        let registered = Question::<Registered>::register(1);
        assert_eq!(registered.phase(), QuestionPhase::Registered);
        let open = registered.open();
        assert_eq!(open.phase(), QuestionPhase::Open);
        let sealed = match open.seal(report(1)?) {
            SealOutcome::Sealed(question) => question,
            SealOutcome::Refused(_) => return Err(FixedError::Domain),
        };
        assert_eq!(sealed.phase(), QuestionPhase::Sealed);
        let median = attestor_median(
            &[[1; 32], [2; 32], [3; 32]],
            &[
                AttestorReport {
                    attestor: [1; 32],
                    value: FixedU64(400_000_000),
                },
                AttestorReport {
                    attestor: [2; 32],
                    value: FixedU64(400_000_000),
                },
                AttestorReport {
                    attestor: [3; 32],
                    value: FixedU64(900_000_000),
                },
            ],
            FixedU64(10_000_000),
        )
        .map_err(|_| FixedError::Domain)?;
        let settled = sealed.settle(median);
        assert_eq!(settled.phase(), QuestionPhase::Settled);
        assert_eq!(settled.median().value(), FixedU64(400_000_000));
        Ok(())
    }

    #[test]
    fn every_non_success_phase_can_void() -> Result<(), FixedError> {
        let registered = Question::<Registered>::register(1).void(VoidReason::ServicePaused);
        assert_eq!(registered.phase(), QuestionPhase::Voided);

        let open = Question::<Registered>::register(2)
            .open()
            .void(VoidReason::ClientUnreachable);
        assert_eq!(open.phase(), QuestionPhase::Voided);

        let sealed = sealed(3)?.void(VoidReason::ClientUnreachable);
        assert_eq!(sealed.phase(), QuestionPhase::Voided);
        assert_eq!(sealed.delivered_report().question_id, 3);
        Ok(())
    }

    #[test]
    fn settlement_failure_is_terminal_void_not_stranded_sealed() -> Result<(), FixedError> {
        let terminal = sealed(4)?.settle_from_attestors(
            &[AttestorReport {
                attestor: [1; 32],
                value: FixedU64(500_000_000),
            }],
            FixedU64(10_000_000),
        );
        assert!(matches!(
            terminal,
            Terminal::Voided(ref q) if q.reason() == VoidReason::NoQuorum
        ));
        Ok(())
    }

    #[test]
    fn sealed_void_preserves_the_delivered_report() -> Result<(), FixedError> {
        let delivered = report(5)?;
        let expected_hash = delivered.provenance_hash;
        let voided = match Question::<Registered>::register(5).open().seal(delivered) {
            SealOutcome::Sealed(question) => question.void(VoidReason::DeadlineMissed),
            SealOutcome::Refused(_) => return Err(FixedError::Domain),
        };
        assert_eq!(voided.delivered_report().provenance_hash, expected_hash);
        Ok(())
    }

    #[test]
    fn cross_question_report_is_refused_without_sealing() -> Result<(), FixedError> {
        let refusal = match Question::<Registered>::register(6).open().seal(report(7)?) {
            SealOutcome::Sealed(_) => return Err(FixedError::Domain),
            SealOutcome::Refused(refusal) => refusal,
        };
        assert_eq!(refusal.error(), ServiceError::UnknownQuestion);
        assert_eq!(refusal.question().phase(), QuestionPhase::Open);
        assert_eq!(refusal.question().question_id(), 6);
        assert_eq!(refusal.report().question_id, 7);
        Ok(())
    }
}
