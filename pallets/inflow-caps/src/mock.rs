//! Mock runtime for `pallet-inflow-caps` (`15 §4.1`).

use crate as pallet_inflow_caps;
use frame_support::{derive_impl, parameter_types};
use sp_runtime::BuildStorage;

type Block = frame_system::mocking::MockBlock<Test>;

frame_support::construct_runtime!(
    pub enum Test {
        System: frame_system,
        InflowCaps: pallet_inflow_caps,
    }
);

#[derive_impl(frame_system::config_preludes::TestDefaultConfig)]
impl frame_system::Config for Test {
    type Block = Block;
}

parameter_types! {
    pub static TvlCap: u128 = 1_000;
    pub static DepositCap: u128 = 100;
    pub static UsdcIssuance: u128 = 0;
}

pub struct TestCapParams;
impl pallet_inflow_caps::InflowCapParams for TestCapParams {
    fn tvl_cap_usdc() -> u128 {
        TvlCap::get()
    }

    fn deposit_cap_usdc() -> u128 {
        DepositCap::get()
    }
}

impl pallet_inflow_caps::Config for Test {
    type CapParams = TestCapParams;
    type UsdcIssuance = UsdcIssuance;
}

pub fn new_test_ext() -> sp_io::TestExternalities {
    let storage = RuntimeGenesisConfig::default()
        .build_storage()
        .unwrap_or_default();
    let mut ext = sp_io::TestExternalities::new(storage);
    ext.execute_with(|| {
        System::set_block_number(1);
        TvlCap::set(1_000);
        DepositCap::set(100);
        UsdcIssuance::set(0);
    });
    ext
}
