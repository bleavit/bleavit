#![cfg_attr(not(feature = "std"), no_std)]
#![deny(unsafe_code)]

//! Frame-free functional core for the hosted question service (architecture 16).
//!
//! The core owns only deterministic state transitions and arithmetic. It has no
//! FRAME, XCM, storage, clock, currency, or hashing dependency; the N7 pallet
//! supplies those adapters. In particular, report provenance uses this core's
//! deterministic SCALE preimage plus a caller-supplied hash function because
//! architecture 16 fixes the fields that are bound but does not yet select the
//! encoding, domain separator or hash algorithm.

extern crate alloc;

mod errors;
mod lifecycle;
mod math;
mod report;
mod settlement;

pub use errors::ServiceError;
pub use lifecycle::{
    NoReport, Open, Question, QuestionPhase, Registered, SealOutcome, SealRefusal, Sealed, Settled,
    Terminal, VoidReason, Voided,
};
pub use math::{b_min, certified, manip_floor, ManipulationBook};
pub use report::{assemble_report, Report, ReportDraft, SettlementTrust};
pub use settlement::{attestor_median, quorum, AttestorError, AttestorMedian, AttestorReport};

/// Dense hosted-question identifier. The service id band is allocated by N7.
pub type QuestionId = u64;
/// Dense client handle defined by architecture 16 §2.
pub type ClientId = u32;
