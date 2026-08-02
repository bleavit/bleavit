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

/// Canonical client row. `Location` and `AccountId` stay generic so the core
/// has no XCM or FRAME dependency. Exactly one identity field is populated.
#[derive(
    Clone, Debug, Decode, DecodeWithMemTracking, Encode, Eq, MaxEncodedLen, PartialEq, TypeInfo,
)]
pub struct ClientRecord<Location, AccountId> {
    pub location: Option<Location>,
    pub local_signer: Option<AccountId>,
    /// Remaining native VIT held for this registration.
    pub bond: Balance,
    pub admitted_at: BlockNumber,
    pub questions_live: u32,
    pub questions_total: u32,
    /// USDC held in the registry's per-client delivery escrow. This trailing
    /// contract-v22 append preserves every v21 field offset.
    pub delivery_float: Balance,
}

impl<Location, AccountId> ClientRecord<Location, AccountId> {
    pub const fn new_location(location: Location, bond: Balance, admitted_at: BlockNumber) -> Self {
        Self {
            location: Some(location),
            local_signer: None,
            bond,
            admitted_at,
            questions_live: 0,
            questions_total: 0,
            delivery_float: 0,
        }
    }

    pub const fn new_local(
        local_signer: AccountId,
        bond: Balance,
        admitted_at: BlockNumber,
    ) -> Self {
        Self {
            location: None,
            local_signer: Some(local_signer),
            bond,
            admitted_at,
            questions_live: 0,
            questions_total: 0,
            delivery_float: 0,
        }
    }

    pub const fn identity_is_valid(&self) -> bool {
        matches!(
            (&self.location, &self.local_signer),
            (Some(_), None) | (None, Some(_))
        )
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
    /// Isolated N9 diagnostics; none of these fields feed XCM health.
    pub report_pushes_total: u64,
    pub report_push_failures_total: u64,
    pub report_push_failures_consecutive: u32,
}

impl IngressMeter {
    pub fn note(&mut self, now: BlockNumber) {
        self.accepted_total = self.accepted_total.saturating_add(1);
        self.last_seen = now;
    }

    pub fn note_report_push(&mut self, succeeded: bool) {
        self.report_pushes_total = self.report_pushes_total.saturating_add(1);
        if succeeded {
            self.report_push_failures_consecutive = 0;
        } else {
            self.report_push_failures_total = self.report_push_failures_total.saturating_add(1);
            self.report_push_failures_consecutive =
                self.report_push_failures_consecutive.saturating_add(1);
        }
    }
}

/// Pure result of an admission preflight.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Admission<Location, AccountId> {
    pub client_id: ClientId,
    pub next_client_id: ClientId,
    pub record: ClientRecord<Location, AccountId>,
    pub sub_id_policy: SubIdPolicy,
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
fn admission_ids(
    bond: Option<Balance>,
    context: AdmissionContext,
) -> Result<(ClientId, ClientId, Balance), Error> {
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
    Ok((context.next_client_id, next, bond))
}

pub fn admit_location<Location, AccountId>(
    location: Location,
    sub_id_policy: SubIdPolicy,
    bond: Option<Balance>,
    context: AdmissionContext,
) -> Result<Admission<Location, AccountId>, Error> {
    let (client_id, next_client_id, bond) = admission_ids(bond, context)?;
    Ok(Admission {
        client_id,
        next_client_id,
        record: ClientRecord::new_location(location, bond, context.admitted_at),
        sub_id_policy,
    })
}

pub fn admit_local<Location, AccountId>(
    local_signer: AccountId,
    sub_id_policy: SubIdPolicy,
    bond: Option<Balance>,
    context: AdmissionContext,
) -> Result<Admission<Location, AccountId>, Error> {
    let (client_id, next_client_id, bond) = admission_ids(bond, context)?;
    Ok(Admission {
        client_id,
        next_client_id,
        record: ClientRecord::new_local(local_signer, bond, context.admitted_at),
        sub_id_policy,
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

    fn record() -> ClientRecord<u8, u16> {
        ClientRecord::new_location(7, 1_000, 10)
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
            admit_location::<_, u16>(7u8, SubIdPolicy::Required, None, context(0, 64, 0, false)),
            Err(Error::ClientBondUnset)
        );
        assert_eq!(
            admit_location::<_, u16>(
                7u8,
                SubIdPolicy::Required,
                Some(1_000),
                context(0, 64, 0, true),
            ),
            Err(Error::DuplicateLocation)
        );
        assert_eq!(
            admit_location::<_, u16>(
                7u8,
                SubIdPolicy::Required,
                Some(1_000),
                context(64, 64, 0, false),
            ),
            Err(Error::ClientsFull)
        );
        assert_eq!(
            admit_location::<_, u16>(
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
        let admission = admit_location::<_, u16>(
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
                    location: Some(7),
                    local_signer: None,
                    bond: 1_000,
                    admitted_at: 10,
                    questions_live: 0,
                    questions_total: 0,
                    delivery_float: 0,
                },
                sub_id_policy: SubIdPolicy::Required,
            })
        );
        let local = admit_local::<u8, _>(
            22u16,
            SubIdPolicy::Optional,
            Some(1_000),
            context(3, 64, 10, false),
        );
        assert!(
            local.is_ok_and(|admission| admission.record.identity_is_valid()
                && admission.record.location.is_none()
                && admission.record.local_signer == Some(22))
        );
    }

    #[test]
    fn contract_v22_float_is_a_trailing_append_to_the_v21_encoding() {
        #[derive(Encode)]
        struct V21Record<Location, AccountId> {
            location: Option<Location>,
            local_signer: Option<AccountId>,
            bond: Balance,
            admitted_at: BlockNumber,
            questions_live: u32,
            questions_total: u32,
        }

        let current: ClientRecord<u8, u16> = ClientRecord::new_location(7u8, 1_000, 10);
        let legacy = V21Record::<u8, u16> {
            location: Some(7),
            local_signer: None,
            bond: 1_000,
            admitted_at: 10,
            questions_live: 0,
            questions_total: 0,
        }
        .encode();
        let encoded = current.encode();
        assert_eq!(encoded.get(..legacy.len()), Some(legacy.as_slice()));
        assert_eq!(encoded.get(legacy.len()..), Some(0u128.encode().as_slice()));
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
        total_overflow.questions_total = u32::MAX;
        assert_eq!(
            total_overflow.register_question(false),
            Err(Error::QuestionCounterOverflow)
        );
        assert_eq!(total_overflow.questions_live, 0);
        assert_eq!(total_overflow.questions_total, u32::MAX);
    }

    #[test]
    fn ingress_meter_saturates_instead_of_blocking_ingress() {
        let mut meter = IngressMeter {
            accepted_total: u64::MAX,
            last_seen: 1,
            ..Default::default()
        };
        meter.note(22);
        assert_eq!(meter.accepted_total, u64::MAX);
        assert_eq!(meter.last_seen, 22);
    }

    #[test]
    fn report_push_meter_saturates_and_success_resets_only_the_streak() {
        let mut meter = IngressMeter {
            report_pushes_total: u64::MAX,
            report_push_failures_total: u64::MAX,
            report_push_failures_consecutive: u32::MAX,
            ..Default::default()
        };
        meter.note_report_push(false);
        assert_eq!(meter.report_pushes_total, u64::MAX);
        assert_eq!(meter.report_push_failures_total, u64::MAX);
        assert_eq!(meter.report_push_failures_consecutive, u32::MAX);
        meter.note_report_push(true);
        assert_eq!(meter.report_pushes_total, u64::MAX);
        assert_eq!(meter.report_push_failures_total, u64::MAX);
        assert_eq!(meter.report_push_failures_consecutive, 0);
    }
}
