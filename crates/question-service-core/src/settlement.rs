//! Architecture 16 §6.3 client-attestor median and tolerance classification.

use alloc::vec::Vec;

use futarchy_primitives::{kernel, AccountId, FixedU64};
use parity_scale_codec::{Decode, DecodeWithMemTracking, Encode, MaxEncodedLen};
use scale_info::TypeInfo;

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
pub enum AttestorError {
    AttestorSetTooSmall,
    DuplicateAttestor,
    UnknownAttestor,
    DuplicateReport,
    QuorumNotReached,
    ReportCountExceedsSet,
    MedianOutOfRange,
    ToleranceOutOfRange,
}

/// One settlement value bound to the named attestor that submitted it.
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
pub struct AttestorReport {
    pub attestor: AccountId,
    pub value: FixedU64,
}

/// The accepted median and the tolerance used to classify each submitter.
///
/// A value outside tolerance is slashable under 16 §6.3; it does not give one
/// deviant attestor a veto over an otherwise valid median. The inclusive check
/// means only a deviation *beyond* tolerance is classified as deviant.
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
pub struct AttestorMedian {
    value: FixedU64,
    quorum: u32,
    tolerance: FixedU64,
}

impl AttestorMedian {
    pub const fn value(&self) -> FixedU64 {
        self.value
    }

    pub const fn quorum(&self) -> u32 {
        self.quorum
    }

    pub const fn tolerance(&self) -> FixedU64 {
        self.tolerance
    }

    pub fn within_tolerance(&self, reported: FixedU64) -> bool {
        let deviation = self.value.0.abs_diff(reported.0);
        deviation <= self.tolerance.0
    }
}

/// `ceil(n/2)` after enforcing architecture 16's `n >= 3` kernel floor.
pub fn quorum(attestor_count: usize) -> Result<u32, AttestorError> {
    if attestor_count < kernel::SVC_ATTESTORS_MIN as usize {
        return Err(AttestorError::AttestorSetTooSmall);
    }
    let count = u32::try_from(attestor_count).map_err(|_| AttestorError::AttestorSetTooSmall)?;
    Ok(count.div_ceil(2))
}

/// Compute the standard median of every report received from a quorum.
///
/// For an even number of reports, the median is the midpoint of the two centre
/// values, rounded down on the 1e9 grid. The input slice may contain more than
/// the minimum quorum but never more reports than named attestors; identity
/// uniqueness and membership are checked here, so duplicate submissions can
/// never satisfy quorum even if a shell presents a malformed slice.
pub fn attestor_median(
    named_attestors: &[AccountId],
    reports: &[AttestorReport],
    tolerance: FixedU64,
) -> Result<AttestorMedian, AttestorError> {
    let required = quorum(named_attestors.len())?;
    let duplicate_named = named_attestors.iter().enumerate().any(|(index, attestor)| {
        named_attestors
            .iter()
            .skip(index.saturating_add(1))
            .any(|other| other == attestor)
    });
    if duplicate_named {
        return Err(AttestorError::DuplicateAttestor);
    }
    if reports.len() > named_attestors.len() {
        return Err(AttestorError::ReportCountExceedsSet);
    }
    if reports.len() < required as usize {
        return Err(AttestorError::QuorumNotReached);
    }
    if tolerance.0 > kernel::SCORE_SCALE {
        return Err(AttestorError::ToleranceOutOfRange);
    }
    for (index, report) in reports.iter().enumerate() {
        if !named_attestors
            .iter()
            .any(|attestor| attestor == &report.attestor)
        {
            return Err(AttestorError::UnknownAttestor);
        }
        if reports
            .iter()
            .take(index)
            .any(|earlier| earlier.attestor == report.attestor)
        {
            return Err(AttestorError::DuplicateReport);
        }
    }

    let mut ordered: Vec<FixedU64> = reports.iter().map(|report| report.value).collect();
    ordered.sort_unstable_by_key(|value| value.0);
    let middle = ordered.len() / 2;
    let upper = ordered
        .get(middle)
        .copied()
        .ok_or(AttestorError::QuorumNotReached)?;
    let value = if ordered.len() % 2 == 0 {
        let lower = ordered
            .get(middle.saturating_sub(1))
            .copied()
            .ok_or(AttestorError::QuorumNotReached)?;
        FixedU64(lower.0 + (upper.0 - lower.0) / 2)
    } else {
        upper
    };
    if value.0 > kernel::SCORE_SCALE {
        return Err(AttestorError::MedianOutOfRange);
    }

    Ok(AttestorMedian {
        value,
        quorum: required,
        tolerance,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const NAMED: [AccountId; 3] = [[1; 32], [2; 32], [3; 32]];

    const fn report(attestor_byte: u8, value: u64) -> AttestorReport {
        AttestorReport {
            attestor: [attestor_byte; 32],
            value: FixedU64(value),
        }
    }

    #[test]
    fn quorum_is_ceil_half_after_the_three_attestor_floor() {
        assert_eq!(quorum(2), Err(AttestorError::AttestorSetTooSmall));
        assert_eq!(quorum(3), Ok(2));
        assert_eq!(quorum(4), Ok(2));
        assert_eq!(quorum(5), Ok(3));
    }

    #[test]
    fn one_deviant_is_priced_and_does_not_move_the_three_report_median() {
        let result = attestor_median(
            &NAMED,
            &[
                report(1, 400_000_000),
                report(2, 900_000_000),
                report(3, 400_000_000),
            ],
            FixedU64(10_000_000),
        );
        assert_eq!(
            result,
            Ok(AttestorMedian {
                value: FixedU64(400_000_000),
                quorum: 2,
                tolerance: FixedU64(10_000_000),
            })
        );
        if let Ok(median) = result {
            assert!(median.within_tolerance(FixedU64(390_000_000)));
            assert!(median.within_tolerance(FixedU64(410_000_000)));
            assert!(!median.within_tolerance(FixedU64(410_000_001)));
            assert!(!median.within_tolerance(FixedU64(900_000_000)));
        }
    }

    #[test]
    fn one_absence_still_settles_and_even_median_rounds_down() {
        assert_eq!(
            attestor_median(
                &NAMED,
                &[report(1, 400_000_000), report(2, 600_000_001)],
                FixedU64(100_000_001),
            ),
            Ok(AttestorMedian {
                value: FixedU64(500_000_000),
                quorum: 2,
                tolerance: FixedU64(100_000_001),
            })
        );
    }

    #[test]
    fn quorum_and_range_fail_closed() {
        assert_eq!(
            attestor_median(&NAMED, &[report(1, 500_000_000)], FixedU64(0)),
            Err(AttestorError::QuorumNotReached)
        );
        assert_eq!(
            attestor_median(
                &NAMED,
                &[report(1, 1_100_000_000), report(2, 1_200_000_000)],
                FixedU64(0),
            ),
            Err(AttestorError::MedianOutOfRange)
        );
        assert_eq!(
            attestor_median(
                &NAMED,
                &[report(1, 1), report(2, 1), report(3, 1), report(1, 1),],
                FixedU64(0),
            ),
            Err(AttestorError::ReportCountExceedsSet)
        );
    }

    #[test]
    fn duplicate_or_unnamed_submissions_cannot_form_quorum() {
        assert_eq!(
            attestor_median(
                &NAMED,
                &[report(1, 400_000_000), report(1, 600_000_000)],
                FixedU64(0),
            ),
            Err(AttestorError::DuplicateReport)
        );
        assert_eq!(
            attestor_median(
                &NAMED,
                &[
                    report(1, 400_000_000),
                    AttestorReport {
                        attestor: [9; 32],
                        value: FixedU64(600_000_000),
                    },
                ],
                FixedU64(0),
            ),
            Err(AttestorError::UnknownAttestor)
        );
    }
}
