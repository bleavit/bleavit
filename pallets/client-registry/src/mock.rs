//! Mock runtime for `pallet-client-registry` (15 §4.1 / I-34).

use crate as pallet_client_registry;
use frame_support::{derive_impl, parameter_types};
use sp_core::crypto::AccountId32;
use sp_runtime::{traits::IdentityLookup, BuildStorage};

type Block = frame_system::mocking::MockBlock<Test>;

frame_support::construct_runtime!(
    pub enum Test {
        System: frame_system,
        Balances: pallet_balances,
        Origins: pallet_origins,
        ClientRegistry: pallet_client_registry,
    }
);

#[derive_impl(frame_system::config_preludes::TestDefaultConfig)]
impl frame_system::Config for Test {
    type Block = Block;
    type AccountId = AccountId32;
    type Lookup = IdentityLookup<AccountId32>;
    type AccountData = pallet_balances::AccountData<futarchy_primitives::Balance>;
}

#[derive_impl(pallet_balances::config_preludes::TestDefaultConfig)]
impl pallet_balances::Config for Test {
    type AccountStore = System;
    type Balance = futarchy_primitives::Balance;
}

impl pallet_origins::Config for Test {
    type WeightInfo = ();
}

parameter_types! {
    pub static ClientBondValue: Option<futarchy_primitives::Balance> = Some(1_000);
}

pub struct TestClientBond;
impl pallet_client_registry::ClientBondProvider for TestClientBond {
    fn client_bond() -> Option<futarchy_primitives::Balance> {
        ClientBondValue::get()
    }
}

impl pallet_client_registry::Config for Test {
    type ValuesOrigin = pallet_origins::EnsureConstitutionalValues;
    type ClientBond = TestClientBond;
    type Currency = Balances;
    type RuntimeHoldReason = RuntimeHoldReason;
    type WeightInfo = ();

    #[cfg(feature = "runtime-benchmarks")]
    type BenchmarkHelper = TestBenchmarkHelper;
}

#[cfg(feature = "runtime-benchmarks")]
pub struct TestBenchmarkHelper;

#[cfg(feature = "runtime-benchmarks")]
impl pallet_client_registry::BenchmarkHelper<RuntimeOrigin, AccountId32> for TestBenchmarkHelper {
    fn values() -> RuntimeOrigin {
        pallet_origins::Origin::ConstitutionalValues.into()
    }

    fn bond_owner() -> AccountId32 {
        account(1)
    }

    fn prime_client_bond(value: futarchy_primitives::Balance) {
        ClientBondValue::set(Some(value));
    }

    fn prime_funds(who: &AccountId32, value: futarchy_primitives::Balance) {
        use frame_support::traits::fungible::Mutate;
        let _ = <Balances as Mutate<AccountId32>>::set_balance(who, value);
    }
}

pub fn account(seed: u8) -> AccountId32 {
    AccountId32::new([seed; 32])
}

pub fn values_origin() -> RuntimeOrigin {
    pallet_origins::Origin::ConstitutionalValues.into()
}

pub fn external_origin(client_id: pallet_client_registry::ClientId) -> RuntimeOrigin {
    pallet_client_registry::Origin::ExternalClient(client_id).into()
}

pub fn location(para_id: u32) -> staging_xcm::latest::Location {
    staging_xcm::latest::Location::new(1, [staging_xcm::latest::Junction::Parachain(para_id)])
}

pub fn new_test_ext() -> sp_io::TestExternalities {
    ClientBondValue::set(Some(1_000));
    let balances = vec![
        (account(1), 1_000_000),
        (account(2), 1_000_000),
        (account(3), 1_000_000),
    ];
    let mut storage = frame_system::GenesisConfig::<Test>::default()
        .build_storage()
        .unwrap_or_default();
    let assimilation = pallet_balances::GenesisConfig::<Test> {
        balances,
        dev_accounts: None,
    }
    .assimilate_storage(&mut storage);
    assert!(
        assimilation.is_ok(),
        "mock balances genesis must assimilate"
    );
    let mut ext = sp_io::TestExternalities::new(storage);
    ext.execute_with(|| System::set_block_number(1));
    ext
}
