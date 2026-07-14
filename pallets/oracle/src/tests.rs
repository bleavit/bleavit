use super::*;

#[test]
fn shell_reexports_core_and_weights() {
    assert_eq!(<() as weights::WeightInfo>::try_state(), 0);
}
