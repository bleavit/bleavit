//! Architecture 16 §11's distinct service integration errors.

use parity_scale_codec::{Decode, DecodeWithMemTracking, Encode, MaxEncodedLen};
use scale_info::TypeInfo;

/// The service shell's documented refusal surface, in specification order.
///
/// N7 maps storage, origin, clock and custody checks onto these variants.  The
/// frame-free core owns the type now so that shell code cannot collapse two
/// client-visible refusals into one generic diagnostic later.
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
pub enum ServiceError {
    NotRegistered,
    ClientRemoved,
    ServicePaused,
    ServiceRateUnset,
    CertificationUnavailable,
    StakeBelowFloor,
    SubsidyBelowMinimum,
    EpsilonOutOfRange,
    WindowTooLong,
    WindowTooShort,
    WindowCollidesWithDecision,
    SlotsExhausted,
    TvlCapWouldBind,
    AttestorSetTooSmall,
    AttestorBondInsufficient,
    ClientIsProtocolAccount,
    EscrowInsufficient,
    NotSealed,
    AlreadySealed,
    AlreadyTerminal,
    QuorumNotReached,
    MedianOutOfRange,
    DeadlineNotReached,
    UnknownQuestion,
    DeadlinePassed,
    CreationFrozen,
    DuplicateAttestor,
    UnknownAttestor,
    AlreadyBonded,
    InvalidSubId,
    ArithmeticOverflow,
    ArchiveNotReady,
    TryStateViolation,
}
