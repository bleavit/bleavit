#![cfg_attr(not(feature = "std"), no_std)]
#![deny(unsafe_code)]

//! Fixed wire ABI shared by Bleavit's N9 report sender and N10's drop-in
//! client receiver. It intentionally encodes one call and no caller-selected
//! destination, selector, or payload.

extern crate alloc;

use alloc::vec::Vec;
use futarchy_primitives::ReportView;
use parity_scale_codec::Encode;

/// Required runtime pallet slot for the N10 drop-in receiver. Reusing
/// Bleavit's own QuestionService slot (66) grounds the value in the existing
/// service domain rather than inventing a second index.
pub const CLIENT_RECEIVER_PALLET_INDEX: u8 = 66;
/// The receiver pallet's append-only `receive_report(report)` call.
pub const RECEIVE_REPORT_CALL_INDEX: u8 = 0;

/// Encode the only remote runtime call N9 can author.
pub fn receive_report_call(report: &ReportView) -> Vec<u8> {
    let mut encoded = Vec::with_capacity(2usize.saturating_add(report.encoded_size()));
    encoded.push(CLIENT_RECEIVER_PALLET_INDEX);
    encoded.push(RECEIVE_REPORT_CALL_INDEX);
    encoded.extend(report.encode());
    encoded
}

#[cfg(test)]
mod tests {
    use super::*;
    use futarchy_primitives::{FixedU64, SettlementTrust};

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

    #[test]
    fn report_call_has_exact_fixed_prefix_and_payload() {
        let report = report();
        let encoded = receive_report_call(&report);
        assert_eq!(encoded.get(..2), Some([66, 0].as_slice()));
        assert_eq!(encoded.get(2..), Some(report.encode().as_slice()));
    }
}
