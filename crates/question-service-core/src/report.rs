//! Architecture 16 §5 report assembly and provenance preimage.

use alloc::vec::Vec;

use futarchy_fixed::FixedError;
use futarchy_primitives::{kernel, AccountId, Balance, BlockNumber, BoundedVec, FixedU64, H256};
use parity_scale_codec::{Decode, DecodeWithMemTracking, Encode, MaxEncodedLen};
use scale_info::TypeInfo;

use crate::{
    certified, manip_floor, quorum, AttestorError, ClientId, ManipulationBook, QuestionId,
};

/// The client-selected settlement trust published as part of every report.
///
/// The attestor capacity remains a const generic because architecture 13 has
/// not assigned its N7 storage bound yet. A caller must select a finite bound;
/// this core does not invent one.
#[derive(
    Clone, Debug, Decode, DecodeWithMemTracking, Encode, Eq, MaxEncodedLen, PartialEq, TypeInfo,
)]
#[scale_info(skip_type_params(MAX_ATTESTORS))]
pub struct SettlementTrust<const MAX_ATTESTORS: u32> {
    attestors: BoundedVec<AccountId, MAX_ATTESTORS>,
    quorum: u32,
    bond_total: Balance,
}

impl<const MAX_ATTESTORS: u32> SettlementTrust<MAX_ATTESTORS> {
    pub fn new(
        attestors: BoundedVec<AccountId, MAX_ATTESTORS>,
        bond_total: Balance,
    ) -> Result<Self, AttestorError> {
        let duplicate = attestors.iter().enumerate().any(|(index, attestor)| {
            attestors
                .iter()
                .skip(index.saturating_add(1))
                .any(|other| other == attestor)
        });
        if duplicate {
            return Err(AttestorError::DuplicateAttestor);
        }
        let quorum = quorum(attestors.len())?;
        Ok(Self {
            attestors,
            quorum,
            bond_total,
        })
    }

    pub fn attestors(&self) -> &[AccountId] {
        self.attestors.as_slice()
    }

    pub fn attestor_count(&self) -> usize {
        self.attestors.len()
    }

    pub const fn quorum(&self) -> u32 {
        self.quorum
    }

    pub const fn bond_total(&self) -> Balance {
        self.bond_total
    }
}

/// Sealing-time inputs whose published derivatives are filled by
/// [`assemble_report`].
#[derive(
    Clone, Debug, Decode, DecodeWithMemTracking, Encode, Eq, MaxEncodedLen, PartialEq, TypeInfo,
)]
#[scale_info(skip_type_params(MAX_ATTESTORS))]
pub struct ReportDraft<const MAX_ATTESTORS: u32> {
    pub question_id: QuestionId,
    pub client_id: ClientId,
    pub sub_id: H256,
    pub twap_accept_1e9: FixedU64,
    pub twap_reject_1e9: FixedU64,
    pub observations: u32,
    pub window_start: BlockNumber,
    pub window_end: BlockNumber,
    pub b_accept: Balance,
    pub b_reject: Balance,
    pub declared_stake: Balance,
    pub epsilon_1e9: FixedU64,
    /// Frozen at registration; see [`Report::tolerance_1e9`].
    pub tolerance_1e9: FixedU64,
    pub settlement_trust: SettlementTrust<MAX_ATTESTORS>,
}

/// Domain separator for [`Report::provenance_preimage`] (16 §6.3;
/// [02](../../../docs/architecture/02-integration-contract.md) §4a). Frozen —
/// a client verifying a report by storage proof recomputes exactly
/// `blake2_256(PROVENANCE_DOMAIN || SCALE(fields))`.
pub const PROVENANCE_DOMAIN: &[u8] = b"bleavit/hosted-report/v1";

/// The report sold at `Sealed` (architecture 16 §5), in its normative field
/// order. `provenance_hash` binds the SCALE encoding of every preceding field.
#[derive(
    Clone, Debug, Decode, DecodeWithMemTracking, Encode, Eq, MaxEncodedLen, PartialEq, TypeInfo,
)]
#[scale_info(skip_type_params(MAX_ATTESTORS))]
pub struct Report<const MAX_ATTESTORS: u32> {
    pub question_id: QuestionId,
    pub client_id: ClientId,
    pub sub_id: H256,
    pub twap_accept_1e9: FixedU64,
    pub twap_reject_1e9: FixedU64,
    pub observations: u32,
    pub window_start: BlockNumber,
    pub window_end: BlockNumber,
    pub b_accept: Balance,
    pub b_reject: Balance,
    pub manip_floor: Balance,
    pub declared_stake: Balance,
    pub epsilon_1e9: FixedU64,
    /// The 16 §6.3 deviation tolerance, **frozen at registration** and bound
    /// into `provenance_hash`. It is in the report because it is a promise to
    /// the client: settlement takes tolerance as an argument, so without it
    /// here a widened value could excuse otherwise-slashable submissions and no
    /// client verifying the pushed or pulled report could detect the change.
    pub tolerance_1e9: FixedU64,
    pub certified: bool,
    pub settlement_trust: SettlementTrust<MAX_ATTESTORS>,
    pub provenance_hash: H256,
}

impl<const MAX_ATTESTORS: u32> Report<MAX_ATTESTORS> {
    /// Deterministic, **domain-separated** SCALE preimage in 16 §5's field
    /// order. The separator is part of the preimage rather than the caller's
    /// business, so the encoding is canonical whatever hasher is supplied.
    ///
    /// 16 §6.3 and [02](../../../docs/architecture/02-integration-contract.md)
    /// §4a freeze the full construction as
    /// `blake2_256(PROVENANCE_DOMAIN || SCALE(fields))`. This crate is
    /// frame-free and dependency-light by rule (01 §5.2), so it cannot itself
    /// depend on a hasher — **the `blake2_256` obligation is therefore enforced
    /// at the pallet boundary (N7), not here**, and that is a stated seam
    /// rather than an oversight. What this function guarantees is that no
    /// caller can produce a preimage that collides with another domain's.
    ///
    /// The hash itself is absent from the preimage, so the construction is
    /// non-recursive.
    pub fn provenance_preimage(&self) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend_from_slice(PROVENANCE_DOMAIN);
        self.question_id.encode_to(&mut out);
        self.client_id.encode_to(&mut out);
        self.sub_id.encode_to(&mut out);
        self.twap_accept_1e9.encode_to(&mut out);
        self.twap_reject_1e9.encode_to(&mut out);
        self.observations.encode_to(&mut out);
        self.window_start.encode_to(&mut out);
        self.window_end.encode_to(&mut out);
        self.b_accept.encode_to(&mut out);
        self.b_reject.encode_to(&mut out);
        self.manip_floor.encode_to(&mut out);
        self.declared_stake.encode_to(&mut out);
        self.epsilon_1e9.encode_to(&mut out);
        self.tolerance_1e9.encode_to(&mut out);
        self.certified.encode_to(&mut out);
        self.settlement_trust.encode_to(&mut out);
        out
    }

    pub fn verify_provenance(&self, hash: impl FnOnce(&[u8]) -> H256) -> bool {
        hash(&self.provenance_preimage()) == self.provenance_hash
    }
}

/// Assemble the sealed report and compute the certificate from chain inputs.
///
/// `contest_capital` is 04 §7a's binding window measure. `flow_cap` is the
/// live `sec.flow_cap` snapshot. The caller injects the runtime's canonical
/// hash function; no frame or host hashing dependency enters this core.
pub fn assemble_report<const MAX_ATTESTORS: u32>(
    draft: ReportDraft<MAX_ATTESTORS>,
    contest_capital: Balance,
    flow_cap: FixedU64,
    hash: impl FnOnce(&[u8]) -> H256,
) -> Result<Report<MAX_ATTESTORS>, FixedError> {
    let reject_short = kernel::SCORE_SCALE
        .checked_sub(draft.twap_reject_1e9.0)
        .map(FixedU64)
        .ok_or(FixedError::Domain)?;
    let books = [
        ManipulationBook {
            b: draft.b_accept,
            bought_outcome_twap_1e9: draft.twap_accept_1e9,
        },
        ManipulationBook {
            b: draft.b_reject,
            bought_outcome_twap_1e9: reject_short,
        },
    ];
    let manipulation_floor = manip_floor(&books, draft.epsilon_1e9, contest_capital, flow_cap)?;
    let is_certified = certified(manipulation_floor, draft.declared_stake)?;
    let mut report = Report {
        question_id: draft.question_id,
        client_id: draft.client_id,
        sub_id: draft.sub_id,
        twap_accept_1e9: draft.twap_accept_1e9,
        twap_reject_1e9: draft.twap_reject_1e9,
        observations: draft.observations,
        window_start: draft.window_start,
        window_end: draft.window_end,
        b_accept: draft.b_accept,
        b_reject: draft.b_reject,
        manip_floor: manipulation_floor,
        declared_stake: draft.declared_stake,
        epsilon_1e9: draft.epsilon_1e9,
        tolerance_1e9: draft.tolerance_1e9,
        certified: is_certified,
        settlement_trust: draft.settlement_trust,
        provenance_hash: [0; 32],
    };
    report.provenance_hash = hash(&report.provenance_preimage());
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use futarchy_primitives::currency;

    const MAX: u32 = 4;

    fn test_hash(bytes: &[u8]) -> H256 {
        let mut out = [0u8; 32];
        for (index, byte) in bytes.iter().enumerate() {
            let slot = index % out.len();
            out[slot] = out[slot]
                .wrapping_add(*byte)
                .rotate_left((index % 8) as u32);
        }
        out
    }

    fn trust() -> Result<SettlementTrust<MAX>, AttestorError> {
        let mut attestors = BoundedVec::new();
        for account in [[1; 32], [2; 32], [3; 32]] {
            attestors
                .try_push(account)
                .map_err(|_| AttestorError::AttestorSetTooSmall)?;
        }
        SettlementTrust::new(attestors, 30_000 * currency::USDC)
    }

    fn draft() -> Result<ReportDraft<MAX>, AttestorError> {
        Ok(ReportDraft {
            question_id: 9,
            client_id: 7,
            sub_id: [4; 32],
            twap_accept_1e9: FixedU64(500_000_000),
            twap_reject_1e9: FixedU64(500_000_000),
            observations: 4_320,
            window_start: 10,
            window_end: 43_210,
            b_accept: 10_000 * currency::USDC,
            b_reject: 10_000 * currency::USDC,
            declared_stake: 500 * currency::USDC,
            epsilon_1e9: FixedU64(37_500_000),
            tolerance_1e9: FixedU64(5_000_000),
            settlement_trust: trust()?,
        })
    }

    #[test]
    fn assembly_fills_cash_floor_certificate_and_provenance() -> Result<(), FixedError> {
        let draft = draft().map_err(|_| FixedError::Domain)?;
        let report = assemble_report(draft, 0, FixedU64(16_000_000_000), test_hash)?;
        assert_eq!(report.manip_floor, 1_559_230_829);
        assert!(report.certified);
        assert_eq!(report.settlement_trust.quorum(), 2);
        assert!(report.verify_provenance(test_hash));
        Ok(())
    }

    #[test]
    fn provenance_preimage_binds_sub_id_and_every_derived_field() -> Result<(), FixedError> {
        let draft = draft().map_err(|_| FixedError::Domain)?;
        let report = assemble_report(draft, 0, FixedU64(16_000_000_000), test_hash)?;
        let baseline = report.provenance_preimage();

        let mut changed = report.clone();
        changed.sub_id[0] ^= 1;
        assert_ne!(changed.provenance_preimage(), baseline);
        changed = report.clone();
        changed.manip_floor = changed.manip_floor.saturating_add(1);
        assert_ne!(changed.provenance_preimage(), baseline);
        changed = report.clone();
        changed.certified = !changed.certified;
        assert_ne!(changed.provenance_preimage(), baseline);
        changed = report.clone();
        changed.settlement_trust.bond_total =
            changed.settlement_trust.bond_total().saturating_add(1);
        assert_ne!(changed.provenance_preimage(), baseline);
        Ok(())
    }

    #[test]
    fn settlement_trust_requires_distinct_named_attestors() {
        let mut attestors = BoundedVec::new();
        for account in [[1; 32], [1; 32], [2; 32]] {
            assert!(attestors.try_push(account).is_ok());
        }
        assert_eq!(
            SettlementTrust::<MAX>::new(attestors, 0),
            Err(AttestorError::DuplicateAttestor)
        );
    }

    #[test]
    fn reject_leg_uses_the_short_price() -> Result<(), FixedError> {
        let mut draft = draft().map_err(|_| FixedError::Domain)?;
        draft.twap_accept_1e9 = FixedU64(400_000_000);
        draft.twap_reject_1e9 = FixedU64(600_000_000);
        let expected = manip_floor(
            &[
                ManipulationBook {
                    b: draft.b_accept,
                    bought_outcome_twap_1e9: FixedU64(400_000_000),
                },
                ManipulationBook {
                    b: draft.b_reject,
                    bought_outcome_twap_1e9: FixedU64(400_000_000),
                },
            ],
            draft.epsilon_1e9,
            0,
            FixedU64(16_000_000_000),
        )?;
        let report = assemble_report(draft, 0, FixedU64(16_000_000_000), test_hash)?;
        assert_eq!(report.manip_floor, expected);
        Ok(())
    }
}
