#![cfg_attr(not(feature = "std"), no_std)]
#![deny(unsafe_code)]

//! Frame-free state transitions for the hosted-question client registry (N4).
//!
//! This crate deliberately knows nothing about FRAME storage, origins, XCM, or
//! fungible holds. The pallet shell supplies those effects and uses these pure
//! transitions as its executable model. Spec: architecture 16 §2, §9 and
//! architecture 15 I-34.

use futarchy_primitives::{Balance, BlockNumber};
use parity_scale_codec::{Decode, DecodeWithMemTracking, Encode, MaxEncodedLen};
use scale_info::TypeInfo;

/// Compact handle carried by the `ExternalClient` runtime origin.
pub type ClientId = u32;

/// Whether a hosted question may omit the opaque per-contract attribution id.
///
/// The service stores and echoes a supplied `sub_id`; it never interprets the
/// bytes. This policy controls presence only.
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
pub enum SubIdPolicy {
    Optional,
    Required,
}

/// Canonical client row. `Location` stays generic so the core has no XCM or
/// FRAME dependency; the production shell binds it to `staging_xcm::Location`.
#[derive(
    Clone, Debug, Decode, DecodeWithMemTracking, Encode, Eq, MaxEncodedLen, PartialEq, TypeInfo,
)]
pub struct ClientRecord<Location> {
    pub location: Location,
    /// Remaining native VIT held for this registration.
    pub bond: Balance,
    pub admitted_at: BlockNumber,
    pub questions_live: u32,
    pub questions_total: u64,
    pub sub_id_policy: SubIdPolicy,
}

impl<Location> ClientRecord<Location> {
    pub const fn new(
        location: Location,
        bond: Balance,
        admitted_at: BlockNumber,
        sub_id_policy: SubIdPolicy,
    ) -> Self {
        Self {
            location,
            bond,
            admitted_at,
            questions_live: 0,
            questions_total: 0,
            sub_id_policy,
        }
    }

    /// Admit one new question. A removal tombstone closes admission before any
    /// counter moves; checked arithmetic makes overflow a strict no-op.
    pub fn register_question(&mut self, removed: bool) -> Result<(), Error> {
        if removed {
            return Err(Error::ClientRemoved);
        }
        let questions_live = self
            .questions_live
            .checked_add(1)
            .ok_or(Error::QuestionCounterOverflow)?;
        let questions_total = self
            .questions_total
            .checked_add(1)
            .ok_or(Error::QuestionCounterOverflow)?;
        self.questions_live = questions_live;
        self.questions_total = questions_total;
        Ok(())
    }

    /// Mark one live question terminal. Returns whether a removal tombstone may
    /// now be finalized and its bond released.
    pub fn finish_question(&mut self, removed: bool) -> Result<bool, Error> {
        let questions_live = self
            .questions_live
            .checked_sub(1)
            .ok_or(Error::NoLiveQuestions)?;
        self.questions_live = questions_live;
        Ok(removed && questions_live == 0)
    }
}

/// Per-client TH-67 telemetry. Saturation is deliberate: exhausting a
/// non-consensus observability counter must not make otherwise valid ingress
/// fail and strand a live question.
#[derive(
    Clone,
    Copy,
    Debug,
    Decode,
    DecodeWithMemTracking,
    Default,
    Encode,
    Eq,
    MaxEncodedLen,
    PartialEq,
    TypeInfo,
)]
pub struct IngressMeter {
    pub accepted_total: u64,
    pub last_seen: BlockNumber,
}

impl IngressMeter {
    pub fn note(&mut self, now: BlockNumber) {
        self.accepted_total = self.accepted_total.saturating_add(1);
        self.last_seen = now;
    }
}

/// Pure result of an admission preflight.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Admission<Location> {
    pub client_id: ClientId,
    pub next_client_id: ClientId,
    pub record: ClientRecord<Location>,
}

/// Read-only registry state needed to preflight one admission.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct AdmissionContext {
    pub admitted_at: BlockNumber,
    pub client_count: u32,
    pub max_clients: u32,
    pub next_client_id: ClientId,
    pub location_taken: bool,
}

/// Validate every fallible admission condition before the shell places a hold
/// or writes storage (G-1).
pub fn admit<Location>(
    location: Location,
    sub_id_policy: SubIdPolicy,
    bond: Option<Balance>,
    context: AdmissionContext,
) -> Result<Admission<Location>, Error> {
    let bond = bond
        .filter(|value| *value > 0)
        .ok_or(Error::ClientBondUnset)?;
    if context.location_taken {
        return Err(Error::DuplicateLocation);
    }
    if context.client_count >= context.max_clients {
        return Err(Error::ClientsFull);
    }
    let next = context
        .next_client_id
        .checked_add(1)
        .ok_or(Error::ClientIdExhausted)?;
    Ok(Admission {
        client_id: context.next_client_id,
        next_client_id: next,
        record: ClientRecord::new(location, bond, context.admitted_at, sub_id_policy),
    })
}

#[derive(Clone, Copy, Debug, Decode, Encode, Eq, PartialEq, TypeInfo)]
pub enum Error {
    ClientBondUnset,
    DuplicateLocation,
    ClientsFull,
    ClientIdExhausted,
    NotRegistered,
    ClientRemoved,
    QuestionCounterOverflow,
    NoLiveQuestions,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record() -> ClientRecord<u8> {
        ClientRecord::new(7, 1_000, 10, SubIdPolicy::Optional)
    }

    fn context(
        client_count: u32,
        max_clients: u32,
        next_client_id: ClientId,
        location_taken: bool,
    ) -> AdmissionContext {
        AdmissionContext {
            admitted_at: 10,
            client_count,
            max_clients,
            next_client_id,
            location_taken,
        }
    }

    #[test]
    fn admission_is_fail_closed_and_checked_before_state_exists() {
        assert_eq!(
            admit(7u8, SubIdPolicy::Required, None, context(0, 64, 0, false)),
            Err(Error::ClientBondUnset)
        );
        assert_eq!(
            admit(
                7u8,
                SubIdPolicy::Required,
                Some(1_000),
                context(0, 64, 0, true),
            ),
            Err(Error::DuplicateLocation)
        );
        assert_eq!(
            admit(
                7u8,
                SubIdPolicy::Required,
                Some(1_000),
                context(64, 64, 0, false),
            ),
            Err(Error::ClientsFull)
        );
        assert_eq!(
            admit(
                7u8,
                SubIdPolicy::Required,
                Some(1_000),
                context(0, 64, ClientId::MAX, false),
            ),
            Err(Error::ClientIdExhausted)
        );
    }

    #[test]
    fn admission_builds_the_exact_initial_record() {
        let admission = admit(
            7u8,
            SubIdPolicy::Required,
            Some(1_000),
            context(3, 64, 9, false),
        );
        assert_eq!(
            admission,
            Ok(Admission {
                client_id: 9,
                next_client_id: 10,
                record: ClientRecord {
                    location: 7,
                    bond: 1_000,
                    admitted_at: 10,
                    questions_live: 0,
                    questions_total: 0,
                    sub_id_policy: SubIdPolicy::Required,
                },
            })
        );
    }

    #[test]
    fn removal_refuses_new_questions_but_drains_existing_questions() {
        let mut client = record();
        assert_eq!(client.register_question(false), Ok(()));
        assert_eq!(client.register_question(false), Ok(()));
        assert_eq!(client.register_question(true), Err(Error::ClientRemoved));
        assert_eq!((client.questions_live, client.questions_total), (2, 2));
        assert_eq!(client.finish_question(true), Ok(false));
        assert_eq!(client.finish_question(true), Ok(true));
        assert_eq!(client.finish_question(true), Err(Error::NoLiveQuestions));
    }

    #[test]
    fn question_counter_overflow_is_a_no_op() {
        let mut live_overflow = record();
        live_overflow.questions_live = u32::MAX;
        assert_eq!(
            live_overflow.register_question(false),
            Err(Error::QuestionCounterOverflow)
        );
        assert_eq!(live_overflow.questions_live, u32::MAX);
        assert_eq!(live_overflow.questions_total, 0);

        let mut total_overflow = record();
        total_overflow.questions_total = u64::MAX;
        assert_eq!(
            total_overflow.register_question(false),
            Err(Error::QuestionCounterOverflow)
        );
        assert_eq!(total_overflow.questions_live, 0);
        assert_eq!(total_overflow.questions_total, u64::MAX);
    }

    #[test]
    fn ingress_meter_saturates_instead_of_blocking_ingress() {
        let mut meter = IngressMeter {
            accepted_total: u64::MAX,
            last_seen: 1,
        };
        meter.note(22);
        assert_eq!(meter.accepted_total, u64::MAX);
        assert_eq!(meter.last_seen, 22);
    }
}
