#![allow(dead_code)]
//! Mock runtime facade for `registry` shell tests.

#[derive(Default)]
pub struct TestRuntime;

impl crate::weights::WeightInfo for TestRuntime {
    fn try_state() -> u64 {
        0
    }
    fn dispatch() -> u64 {
        0
    }
}
