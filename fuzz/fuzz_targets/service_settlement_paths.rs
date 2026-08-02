#![no_main]

use arbitrary::{Arbitrary, Unstructured};
use bleavit_fuzz::{assert_service_settlement_case, ServiceSettlementCase};
use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    let mut input = Unstructured::new(data);
    if let Ok(case) = ServiceSettlementCase::arbitrary(&mut input) {
        assert_service_settlement_case(&case);
    }
});
