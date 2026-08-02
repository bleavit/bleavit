#![allow(dead_code)]

use std::cell::RefCell;

use frame_support::{
    derive_impl,
    instances::Instance1,
    parameter_types,
    traits::{AsEnsureOriginWithArg, Contains, EnsureOrigin, PalletInfoAccess, StorageVersion},
    PalletId,
};
use frame_system::{EnsureSigned, RawOrigin};
use futarchy_primitives::{kernel, Balance};
use parity_scale_codec::Encode;
use sp_runtime::{traits::AccountIdConversion, BuildStorage, Perbill};

use pallet_conditional_ledger as ledger;

pub type AccountId = u64;
pub type AssetId = u32;
type Block = frame_system::mocking::MockBlock<Test>;

pub const ALICE: AccountId = 1;
pub const BOB: AccountId = 2;
pub const CAROL: AccountId = 3;
pub const DAVE: AccountId = 4;
pub const MARKET: AccountId = 100;
pub const RESOLVER: AccountId = 101;
pub const SETTLER: AccountId = 102;
pub const PRIMARY_BOOK: AccountId = 900;
pub const SERVICE_BOOK: AccountId = 910;
pub const PRIMARY_INSURANCE: AccountId = 920;
pub const SERVICE_INSURANCE: AccountId = 921;
pub const PRIMARY_MAIN: AccountId = 930;
pub const SERVICE_MAIN: AccountId = 931;
pub const USDC: AssetId = 1_337;
pub const UNIT: Balance = 1_000_000;

frame_support::construct_runtime!(
    pub enum Test {
        System: frame_system,
        Balances: pallet_balances,
        Assets: pallet_assets,
        PrimaryLedger: pallet_conditional_ledger,
        ServiceLedger: pallet_conditional_ledger::<Instance1>,
    }
);

#[derive_impl(frame_system::config_preludes::TestDefaultConfig)]
impl frame_system::Config for Test {
    type Block = Block;
    type AccountData = pallet_balances::AccountData<Balance>;
}

#[derive_impl(pallet_balances::config_preludes::TestDefaultConfig)]
impl pallet_balances::Config for Test {
    type AccountStore = System;
    type Balance = Balance;
}

#[derive_impl(pallet_assets::config_preludes::TestDefaultConfig)]
impl pallet_assets::Config for Test {
    type Currency = Balances;
    type Balance = Balance;
    type AssetId = AssetId;
    type AssetIdParameter = AssetId;
    type CreateOrigin = AsEnsureOriginWithArg<EnsureSigned<AccountId>>;
    type ForceOrigin = frame_system::EnsureRoot<AccountId>;
}

macro_rules! ensure_account {
    ($name:ident, $account:expr) => {
        pub struct $name;
        impl EnsureOrigin<RuntimeOrigin> for $name {
            type Success = ();

            fn try_origin(origin: RuntimeOrigin) -> Result<Self::Success, RuntimeOrigin> {
                match origin.clone().into() {
                    Ok(RawOrigin::Signed(who)) if who == $account => Ok(()),
                    _ => Err(origin),
                }
            }

            #[cfg(feature = "runtime-benchmarks")]
            fn try_successful_origin() -> Result<RuntimeOrigin, ()> {
                Ok(RawOrigin::Signed($account).into())
            }
        }
    };
}

ensure_account!(EnsureMarket, MARKET);
ensure_account!(EnsureResolver, RESOLVER);
ensure_account!(EnsureSettler, SETTLER);

thread_local! {
    static PRIMARY_PROTOCOL_EXTRAS: RefCell<Vec<AccountId>> = const { RefCell::new(Vec::new()) };
    static SERVICE_PROTOCOL_EXTRAS: RefCell<Vec<AccountId>> = const { RefCell::new(Vec::new()) };
    static PRIMARY_RESIDUE: RefCell<Vec<Balance>> = const { RefCell::new(Vec::new()) };
    static SERVICE_RESIDUE: RefCell<Vec<Balance>> = const { RefCell::new(Vec::new()) };
    static PRIMARY_REVENUE: RefCell<Balance> = const { RefCell::new(0) };
    static SERVICE_REVENUE: RefCell<Balance> = const { RefCell::new(0) };
}

pub struct PrimaryProtocol;
impl Contains<AccountId> for PrimaryProtocol {
    fn contains(who: &AccountId) -> bool {
        matches!(*who, PRIMARY_BOOK | PRIMARY_INSURANCE | PRIMARY_MAIN)
            || *who == primary_account()
            || PRIMARY_PROTOCOL_EXTRAS.with(|extra| extra.borrow().contains(who))
    }
}

pub struct ServiceProtocol;
impl Contains<AccountId> for ServiceProtocol {
    fn contains(who: &AccountId) -> bool {
        matches!(*who, SERVICE_BOOK | SERVICE_INSURANCE | SERVICE_MAIN)
            || *who == service_account()
            || SERVICE_PROTOCOL_EXTRAS.with(|extra| extra.borrow().contains(who))
    }
}

pub struct ReservedProtocolDestinations;
impl Contains<AccountId> for ReservedProtocolDestinations {
    fn contains(who: &AccountId) -> bool {
        PrimaryProtocol::contains(who) || ServiceProtocol::contains(who)
    }
}

pub struct SweepReady;
impl ledger::MarketSweepStatus for SweepReady {
    fn proposal_books_swept(_: futarchy_primitives::ProposalId) -> bool {
        true
    }

    fn baseline_book_swept(_: futarchy_primitives::EpochId) -> bool {
        true
    }
}

pub struct PrimaryResidueReporter;
impl ledger::ResidueReporter for PrimaryResidueReporter {
    fn note_swept_residue(amount: Balance) -> frame_support::dispatch::DispatchResult {
        PRIMARY_RESIDUE.with(|values| values.borrow_mut().push(amount));
        Ok(())
    }
}

pub struct ServiceResidueReporter;
impl ledger::ResidueReporter for ServiceResidueReporter {
    fn note_swept_residue(amount: Balance) -> frame_support::dispatch::DispatchResult {
        SERVICE_RESIDUE.with(|values| values.borrow_mut().push(amount));
        Ok(())
    }
}

pub struct PrimaryRevenueSink;
impl ledger::MainRevenueSink for PrimaryRevenueSink {
    fn credit_main(amount: Balance) -> frame_support::dispatch::DispatchResult {
        PRIMARY_REVENUE.with(|value| {
            let next = value
                .borrow()
                .checked_add(amount)
                .ok_or(sp_runtime::DispatchError::Other("primary revenue overflow"))?;
            *value.borrow_mut() = next;
            Ok(())
        })
    }
}

pub struct ServiceRevenueSink;
impl ledger::MainRevenueSink for ServiceRevenueSink {
    fn credit_main(amount: Balance) -> frame_support::dispatch::DispatchResult {
        SERVICE_REVENUE.with(|value| {
            let next = value
                .borrow()
                .checked_add(amount)
                .ok_or(sp_runtime::DispatchError::Other("service revenue overflow"))?;
            *value.borrow_mut() = next;
            Ok(())
        })
    }
}

parameter_types! {
    pub const PrimaryPalletId: PalletId = PalletId(*b"t/priled");
    pub const ServicePalletId: PalletId = PalletId(*b"t/svcled");
    pub static MinSplit: Balance = kernel::MIN_SPLIT_USDC;
    pub const PositionDeposit: Balance = kernel::POSITION_DEPOSIT_USDC;
    pub const MaxPositions: u32 = ledger::core_ledger::MAX_POSITIONS_PER_ACCOUNT;
    pub const ArchiveDelay: u64 = 5;
    pub static ReapBatch: u32 = kernel::REAP_BATCH;
    pub UsdcAssetId: AssetId = USDC;
    pub PrimaryInsuranceAccount: AccountId = PRIMARY_INSURANCE;
    pub ServiceInsuranceAccount: AccountId = SERVICE_INSURANCE;
    pub PrimaryMainAccount: AccountId = PRIMARY_MAIN;
    pub ServiceMainAccount: AccountId = SERVICE_MAIN;
    pub static RedemptionFee: Perbill = Perbill::zero();
}

impl ledger::Config for Test {
    type Collateral = Assets;
    type UsdcAssetId = UsdcAssetId;
    type MarketAuthority = EnsureMarket;
    type ResolveAuthority = EnsureResolver;
    type SettleAuthority = EnsureSettler;
    type EmergencyPlaybookOrigin = EnsureSettler;
    type MinSplit = MinSplit;
    type PositionDeposit = PositionDeposit;
    type MaxPositionsPerAccount = MaxPositions;
    type ArchiveDelay = ArchiveDelay;
    type ReapBatch = ReapBatch;
    type ProtocolAccounts = PrimaryProtocol;
    type ReservedProtocolDestinations = ReservedProtocolDestinations;
    type RedemptionFee = RedemptionFee;
    type InsuranceAccount = PrimaryInsuranceAccount;
    type MarketSweepStatus = SweepReady;
    type ResidueReporter = PrimaryResidueReporter;
    type TreasuryMainAccount = PrimaryMainAccount;
    type MainRevenueSink = PrimaryRevenueSink;
    type PalletId = PrimaryPalletId;
    type KeeperRebate = ();
    type InflowCapGate = ();
    type WeightInfo = ();
    #[cfg(feature = "runtime-benchmarks")]
    type BenchmarkHelper = ();
}

impl ledger::Config<Instance1> for Test {
    type Collateral = Assets;
    type UsdcAssetId = UsdcAssetId;
    type MarketAuthority = EnsureMarket;
    type ResolveAuthority = EnsureResolver;
    type SettleAuthority = EnsureSettler;
    type EmergencyPlaybookOrigin = EnsureSettler;
    type MinSplit = MinSplit;
    type PositionDeposit = PositionDeposit;
    type MaxPositionsPerAccount = MaxPositions;
    type ArchiveDelay = ArchiveDelay;
    type ReapBatch = ReapBatch;
    type ProtocolAccounts = ServiceProtocol;
    type ReservedProtocolDestinations = ReservedProtocolDestinations;
    type RedemptionFee = RedemptionFee;
    type InsuranceAccount = ServiceInsuranceAccount;
    type MarketSweepStatus = SweepReady;
    type ResidueReporter = ServiceResidueReporter;
    type TreasuryMainAccount = ServiceMainAccount;
    type MainRevenueSink = ServiceRevenueSink;
    type PalletId = ServicePalletId;
    type KeeperRebate = ();
    type InflowCapGate = ();
    type WeightInfo = ();
    #[cfg(feature = "runtime-benchmarks")]
    type BenchmarkHelper = ();
}

pub fn primary_account() -> AccountId {
    PrimaryPalletId::get().into_account_truncating()
}

pub fn service_account() -> AccountId {
    ServicePalletId::get().into_account_truncating()
}

pub trait Domain {
    type Instance: 'static;

    const PID: u64;
    const EPOCH: u32 = 7;
    const USER: AccountId;
    const RECIPIENT: AccountId;

    fn account() -> AccountId;
    fn owned_accounts() -> &'static [AccountId];
    fn event_bytes() -> Vec<Vec<u8>>;
    fn side_effect_bytes() -> Vec<u8>;
    fn set_protocol_extras(accounts: Vec<AccountId>);
    fn is_protocol(who: &AccountId) -> bool;
}

pub struct PrimaryDomain;
impl Domain for PrimaryDomain {
    type Instance = ();

    const PID: u64 = 1;
    const USER: AccountId = ALICE;
    const RECIPIENT: AccountId = BOB;

    fn account() -> AccountId {
        primary_account()
    }

    fn owned_accounts() -> &'static [AccountId] {
        &[PRIMARY_BOOK, PRIMARY_INSURANCE, PRIMARY_MAIN]
    }

    fn event_bytes() -> Vec<Vec<u8>> {
        System::events()
            .into_iter()
            .filter_map(|record| match record.event {
                RuntimeEvent::PrimaryLedger(event) => Some(event.encode()),
                _ => None,
            })
            .collect()
    }

    fn side_effect_bytes() -> Vec<u8> {
        (
            PRIMARY_RESIDUE.with(|value| value.borrow().clone()),
            PRIMARY_REVENUE.with(|value| *value.borrow()),
        )
            .encode()
    }

    fn set_protocol_extras(accounts: Vec<AccountId>) {
        PRIMARY_PROTOCOL_EXTRAS.with(|value| *value.borrow_mut() = accounts);
    }

    fn is_protocol(who: &AccountId) -> bool {
        PrimaryProtocol::contains(who)
    }
}

pub struct ServiceDomain;
impl Domain for ServiceDomain {
    type Instance = Instance1;

    const PID: u64 = kernel::SERVICE_ID_BASE;
    const USER: AccountId = CAROL;
    const RECIPIENT: AccountId = DAVE;

    fn account() -> AccountId {
        service_account()
    }

    fn owned_accounts() -> &'static [AccountId] {
        &[SERVICE_BOOK, SERVICE_INSURANCE, SERVICE_MAIN]
    }

    fn event_bytes() -> Vec<Vec<u8>> {
        System::events()
            .into_iter()
            .filter_map(|record| match record.event {
                RuntimeEvent::ServiceLedger(event) => Some(event.encode()),
                _ => None,
            })
            .collect()
    }

    fn side_effect_bytes() -> Vec<u8> {
        (
            SERVICE_RESIDUE.with(|value| value.borrow().clone()),
            SERVICE_REVENUE.with(|value| *value.borrow()),
        )
            .encode()
    }

    fn set_protocol_extras(accounts: Vec<AccountId>) {
        SERVICE_PROTOCOL_EXTRAS.with(|value| *value.borrow_mut() = accounts);
    }

    fn is_protocol(who: &AccountId) -> bool {
        ServiceProtocol::contains(who)
    }
}

fn pallet_storage<I: 'static>() -> Vec<(Vec<u8>, Vec<u8>)>
where
    Test: ledger::Config<I>,
{
    let name = ledger::Pallet::<Test, I>::name();
    let prefix = sp_io::hashing::twox_128(name.as_bytes());
    let mut cursor = prefix.to_vec();
    let mut entries = Vec::new();
    while let Some(next) = sp_io::storage::next_key(&cursor) {
        if !next.starts_with(&prefix) {
            break;
        }
        let value = match sp_io::storage::get(&next) {
            Some(value) => value.to_vec(),
            None => Vec::new(),
        };
        entries.push((next.clone(), value));
        cursor = next;
    }
    entries
}

/// Byte-exact state owned by one ledger instance, including the domain's
/// distinct claimant and transfer/keeper recipient balances. Those accounts
/// are deliberately disjoint across domains so a wrong-recipient payout cannot
/// hide behind a shared balance outside the pallet storage prefix.
pub fn snapshot<D: Domain>() -> Vec<u8>
where
    Test: ledger::Config<D::Instance>,
{
    let mut accounts = vec![D::account(), D::USER, D::RECIPIENT];
    accounts.extend_from_slice(D::owned_accounts());
    let balances: Vec<_> = accounts
        .into_iter()
        .map(|who| (who, Assets::balance(USDC, who), Balances::free_balance(who)))
        .collect();
    (
        pallet_storage::<D::Instance>(),
        balances,
        D::event_bytes(),
        D::side_effect_bytes(),
    )
        .encode()
}

pub fn reset_dynamic_config() {
    MinSplit::set(kernel::MIN_SPLIT_USDC);
    ReapBatch::set(kernel::REAP_BATCH);
    RedemptionFee::set(Perbill::zero());
    PrimaryDomain::set_protocol_extras(Vec::new());
    ServiceDomain::set_protocol_extras(Vec::new());
    PRIMARY_RESIDUE.with(|value| value.borrow_mut().clear());
    SERVICE_RESIDUE.with(|value| value.borrow_mut().clear());
    PRIMARY_REVENUE.with(|value| *value.borrow_mut() = 0);
    SERVICE_REVENUE.with(|value| *value.borrow_mut() = 0);
}

fn fixture_failure(message: impl core::fmt::Display) -> ! {
    assert!(std::hint::black_box(false), "{message}");
    std::process::abort()
}

fn required_ok<T, E: core::fmt::Debug>(result: Result<T, E>, context: &str) -> T {
    match result {
        Ok(value) => value,
        Err(error) => fixture_failure(format_args!("{context}: {error:?}")),
    }
}

pub fn new_test_ext() -> sp_io::TestExternalities {
    reset_dynamic_config();
    let mut storage = required_ok(
        frame_system::GenesisConfig::<Test>::default().build_storage(),
        "system genesis builds",
    );

    let accounts = [
        ALICE,
        BOB,
        CAROL,
        DAVE,
        MARKET,
        RESOLVER,
        SETTLER,
        PRIMARY_BOOK,
        SERVICE_BOOK,
        PRIMARY_INSURANCE,
        SERVICE_INSURANCE,
        PRIMARY_MAIN,
        SERVICE_MAIN,
        primary_account(),
        service_account(),
    ];
    required_ok(
        pallet_balances::GenesisConfig::<Test> {
            balances: accounts
                .iter()
                .copied()
                .map(|who| (who, 1_000_000_000))
                .collect(),
            ..Default::default()
        }
        .assimilate_storage(&mut storage),
        "balances genesis builds",
    );

    required_ok(
        pallet_assets::GenesisConfig::<Test> {
            assets: vec![(USDC, ALICE, true, 10_000)],
            metadata: Vec::new(),
            accounts: accounts
                .iter()
                .copied()
                .map(|who| {
                    let balance = if who == primary_account() || who == service_account() {
                        10_000
                    } else {
                        1_000_000 * UNIT
                    };
                    (USDC, who, balance)
                })
                .collect(),
            next_asset_id: None,
            reserves: Vec::new(),
        }
        .assimilate_storage(&mut storage),
        "assets genesis builds",
    );

    let mut ext = sp_io::TestExternalities::new(storage);
    ext.execute_with(|| {
        System::set_block_number(1);
        StorageVersion::new(1).put::<ledger::Pallet<Test>>();
        StorageVersion::new(1).put::<ledger::Pallet<Test, Instance1>>();
        assert_ne!(primary_account(), service_account());
    });
    ext
}
