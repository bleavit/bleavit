//! Integrated mock runtime: both ledger instances, market, client registry and
//! question service. Keeping both instances here makes I-37 falsifiable.

use crate as pallet_question_service;
use frame_support::{
    derive_impl,
    instances::Instance1,
    parameter_types,
    traits::{AsEnsureOriginWithArg, Contains, EnsureOrigin},
    PalletId,
};
use frame_system::{EnsureRoot, EnsureSigned, RawOrigin};
use futarchy_primitives::{
    bounds, currency,
    keeper::{CrankClass, KeeperRebateSink},
    kernel, Balance, FixedU64, MarketId,
};
use sp_runtime::{traits::AccountIdConversion, BuildStorage, Perbill};

pub type AccountId = u64;
pub type AssetId = u32;
type Block = frame_system::mocking::MockBlock<Test>;

pub const ALICE: AccountId = 1;
pub const BOB: AccountId = 2;
pub const CHARLIE: AccountId = 3;
pub const DAVE: AccountId = 4;
pub const MARKET_ADMIN: AccountId = 90;
pub const EMERGENCY: AccountId = 91;
pub const INSURANCE: AccountId = 92;
pub const MAIN: AccountId = 93;
pub const INFLOW_ONLY: AccountId = 94;
pub const USDC: AssetId = 1337;
pub const CLIENT: u32 = 0;
pub const UNIT: Balance = currency::USDC;
const PRIMARY_MARKET_BASE: AccountId = 1 << 48;
const SERVICE_MARKET_BASE: AccountId = 1 << 56;

frame_support::construct_runtime!(
    pub enum Test {
        System: frame_system,
        Balances: pallet_balances,
        Assets: pallet_assets,
        Ledger: pallet_conditional_ledger,
        ServiceLedger: pallet_conditional_ledger::<Instance1>,
        Market: pallet_market,
        ClientRegistry: pallet_client_registry,
        QuestionService: pallet_question_service,
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
    type ForceOrigin = EnsureRoot<AccountId>;
}

macro_rules! ensure_account {
    ($name:ident, $account:expr) => {
        pub struct $name;
        impl EnsureOrigin<RuntimeOrigin> for $name {
            type Success = ();

            fn try_origin(origin: RuntimeOrigin) -> Result<(), RuntimeOrigin> {
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

ensure_account!(EnsureEmergency, EMERGENCY);
ensure_account!(EnsureQuestion, question_account());

pub struct EnsureMarket;
impl EnsureOrigin<RuntimeOrigin> for EnsureMarket {
    type Success = ();

    fn try_origin(origin: RuntimeOrigin) -> Result<(), RuntimeOrigin> {
        match origin.clone().into() {
            Ok(RawOrigin::Signed(who)) if who == MARKET_ADMIN || who == market_account() => Ok(()),
            _ => Err(origin),
        }
    }

    #[cfg(feature = "runtime-benchmarks")]
    fn try_successful_origin() -> Result<RuntimeOrigin, ()> {
        Ok(RawOrigin::Signed(market_account()).into())
    }
}

parameter_types! {
    pub const LedgerPalletId: PalletId = PalletId(*b"t/ledger");
    pub const ServiceLedgerPalletId: PalletId = PalletId(*b"t/svcldg");
    pub const MarketPalletId: PalletId = PalletId(*b"t/market");
    pub const QuestionPalletId: PalletId = PalletId(*b"t/qservc");
    pub UsdcAssetId: AssetId = USDC;
    pub MinSplit: Balance = kernel::MIN_SPLIT_USDC;
    pub PositionDeposit: Balance = kernel::POSITION_DEPOSIT_USDC;
    pub const MaxPositions: u32 = bounds::MAX_ACCOUNT_POSITIONS;
    pub const ArchiveDelay: u64 = 100;
    pub const ReapBatch: u32 = kernel::REAP_BATCH;
    pub InsuranceAccount: AccountId = INSURANCE;
    pub MainAccount: AccountId = MAIN;
    pub RedemptionFee: Perbill = Perbill::zero();
    pub const MarketFee: u128 = 30;
    pub const ObsInterval: u64 = 10;
    pub const Kappa: u64 = 5_000_000;
    pub const MaxExternalMarkets: u32 = bounds::MAX_LIVE_EXTERNAL_MARKETS;
    pub static FeeRate: Option<Perbill> = Some(Perbill::from_parts(10_000_000));
    pub static MaxLive: u32 = 16;
    pub static MaxWindow: u32 = 100;
    pub static EpsilonMin: FixedU64 = FixedU64(10_000_000);
    pub static OracleWindow: u32 = 20;
    pub static TvlAdmissible: bool = true;
    pub static Collision: bool = false;
    pub static MainCredited: Balance = 0;
    pub static KeeperRebates: Vec<(AccountId, CrankClass)> = Vec::new();
}

pub struct QuestionKeeperRebate;
impl KeeperRebateSink<AccountId> for QuestionKeeperRebate {
    fn rebate(who: &AccountId, class: CrankClass) {
        let mut rebates = KeeperRebates::get();
        rebates.push((*who, class));
        KeeperRebates::set(rebates);
    }
}

pub struct PrimaryProtocol;
impl Contains<AccountId> for PrimaryProtocol {
    fn contains(who: &AccountId) -> bool {
        *who == ledger_account()
            || *who == market_account()
            || *who == MAIN
            || *who == INSURANCE
            || (PRIMARY_MARKET_BASE..SERVICE_MARKET_BASE).contains(who)
    }
}

pub struct ServiceProtocol;
impl Contains<AccountId> for ServiceProtocol {
    fn contains(who: &AccountId) -> bool {
        *who == service_ledger_account()
            || *who == question_account()
            || *who >= SERVICE_MARKET_BASE
    }
}

pub struct ReservedProtocol;
impl Contains<AccountId> for ReservedProtocol {
    fn contains(who: &AccountId) -> bool {
        PrimaryProtocol::contains(who) || ServiceProtocol::contains(who)
    }
}

pub struct InflowProtocol;
impl Contains<AccountId> for InflowProtocol {
    fn contains(who: &AccountId) -> bool {
        *who == INFLOW_ONLY
    }
}

pub struct MarketAccounts;
impl pallet_market::MarketAccountProvider<AccountId> for MarketAccounts {
    fn book(id: MarketId) -> AccountId {
        if id >= kernel::SERVICE_ID_BASE {
            SERVICE_MARKET_BASE
                .saturating_add(id.saturating_sub(kernel::SERVICE_ID_BASE).saturating_mul(2))
        } else {
            PRIMARY_MARKET_BASE.saturating_add(id.saturating_mul(2))
        }
    }

    fn fees(id: MarketId) -> AccountId {
        Self::book(id).saturating_add(1)
    }
}

pub struct MainRevenue;
impl pallet_conditional_ledger::MainRevenueSink for MainRevenue {
    fn credit_main(amount: Balance) -> frame_support::dispatch::DispatchResult {
        MainCredited::set(MainCredited::get().saturating_add(amount));
        Ok(())
    }
}

pub struct Residue;
impl pallet_conditional_ledger::ResidueReporter for Residue {
    fn note_swept_residue(_: Balance) -> frame_support::dispatch::DispatchResult {
        Ok(())
    }
}

impl pallet_conditional_ledger::Config for Test {
    type Collateral = Assets;
    type UsdcAssetId = UsdcAssetId;
    type MarketAuthority = EnsureMarket;
    type ResolveAuthority = EnsureQuestion;
    type SettleAuthority = EnsureQuestion;
    type EmergencyPlaybookOrigin = EnsureEmergency;
    type MinSplit = MinSplit;
    type PositionDeposit = PositionDeposit;
    type MaxPositionsPerAccount = MaxPositions;
    type ArchiveDelay = ArchiveDelay;
    type ReapBatch = ReapBatch;
    type ProtocolAccounts = PrimaryProtocol;
    type ReservedProtocolDestinations = ReservedProtocol;
    type RedemptionFee = RedemptionFee;
    type InsuranceAccount = InsuranceAccount;
    type MarketSweepStatus = pallet_market::PrimaryMarketSweepStatus<Test>;
    type ResidueReporter = Residue;
    type TreasuryMainAccount = MainAccount;
    type MainRevenueSink = MainRevenue;
    type PalletId = LedgerPalletId;
    type KeeperRebate = ();
    type InflowCapGate = ();
    type WeightInfo = ();
    #[cfg(feature = "runtime-benchmarks")]
    type BenchmarkHelper = ();
}

impl pallet_conditional_ledger::Config<Instance1> for Test {
    type Collateral = Assets;
    type UsdcAssetId = UsdcAssetId;
    type MarketAuthority = EnsureMarket;
    type ResolveAuthority = EnsureQuestion;
    type SettleAuthority = EnsureQuestion;
    type EmergencyPlaybookOrigin = EnsureEmergency;
    type MinSplit = MinSplit;
    type PositionDeposit = PositionDeposit;
    type MaxPositionsPerAccount = MaxPositions;
    type ArchiveDelay = ArchiveDelay;
    type ReapBatch = ReapBatch;
    type ProtocolAccounts = ServiceProtocol;
    type ReservedProtocolDestinations = ReservedProtocol;
    type RedemptionFee = RedemptionFee;
    type InsuranceAccount = InsuranceAccount;
    type MarketSweepStatus = pallet_market::ExternalMarketSweepStatus<Test>;
    type ResidueReporter = Residue;
    type TreasuryMainAccount = MainAccount;
    type MainRevenueSink = MainRevenue;
    type PalletId = ServiceLedgerPalletId;
    type KeeperRebate = ();
    type InflowCapGate = ();
    type WeightInfo = ();
    #[cfg(feature = "runtime-benchmarks")]
    type BenchmarkHelper = ();
}

pub struct ExternalStatus;
impl pallet_market::ExternalQuestionStatus for ExternalStatus {
    fn trading_open(question: u64) -> bool {
        QuestionService::trading_open(question)
    }
}

impl pallet_market::Config for Test {
    type WeightInfo = ();
    #[cfg(feature = "runtime-benchmarks")]
    type BenchmarkHelper = ();
    type Fee = MarketFee;
    type ObsInterval = ObsInterval;
    type Kappa1e9 = Kappa;
    type MarketAdmin = EnsureMarket;
    type ExternalMarketAdmin = pallet_client_registry::EnsureExternalClient;
    type ServiceLedger = pallet_market::ConditionalLedgerInstance<Instance1>;
    type PrimaryProposalIds = ();
    type ExternalQuestionStatus = ExternalStatus;
    type ReservedProtocolDestinations = ReservedProtocol;
    type MaxLiveExternalMarkets = MaxExternalMarkets;
    type EmergencyPlaybookOrigin = EnsureEmergency;
    type ArchiveDelay = ArchiveDelay;
    type PalletId = MarketPalletId;
    type MarketAccounts = MarketAccounts;
    type KeeperRebate = ();
    type InDecisionWindow = frame_support::traits::Nothing;
    type PolCommitmentSync = ();
    type MainAccount = MainAccount;
    type MainRevenueSink = MainRevenue;
    type BaselineGrade = ();
}

pub struct ClientBond;
impl pallet_client_registry::ClientBondProvider for ClientBond {
    fn client_bond() -> Option<Balance> {
        Some(1_000)
    }
}

impl pallet_client_registry::Config for Test {
    type ValuesOrigin = EnsureRoot<AccountId>;
    type ClientBond = ClientBond;
    type Currency = Balances;
    type RuntimeHoldReason = RuntimeHoldReason;
    type WeightInfo = ();
    #[cfg(feature = "runtime-benchmarks")]
    type BenchmarkHelper = ();
}

#[cfg(feature = "runtime-benchmarks")]
impl pallet_client_registry::BenchmarkHelper<RuntimeOrigin, AccountId> for () {
    fn values() -> RuntimeOrigin {
        RuntimeOrigin::root()
    }

    fn bond_owner() -> AccountId {
        ALICE
    }

    fn prime_client_bond(value: Balance) {
        let _ = value;
    }

    fn prime_funds(who: &AccountId, value: Balance) {
        use frame_support::traits::fungible::Mutate;
        let _ = <Balances as Mutate<AccountId>>::set_balance(who, value);
    }
}

pub struct Params;
impl pallet_question_service::ServiceParamsProvider for Params {
    fn fee_rate() -> Option<Perbill> {
        FeeRate::get()
    }
    fn max_live() -> u32 {
        MaxLive::get()
    }
    fn max_window() -> u32 {
        MaxWindow::get()
    }
    fn epsilon_min() -> FixedU64 {
        EpsilonMin::get()
    }
    fn oracle_window() -> u32 {
        OracleWindow::get()
    }
    fn oracle_rounds() -> u8 {
        3
    }
    fn oracle_bond_bps() -> u32 {
        250
    }
    fn attestor_bond_floor() -> Balance {
        10 * UNIT
    }
    fn flow_cap() -> FixedU64 {
        FixedU64(16_000_000_000)
    }
}

pub struct Funding;
impl pallet_question_service::ClientFunding<AccountId> for Funding {
    fn funding_account(client: u32) -> Option<AccountId> {
        pallet_client_registry::Clients::<Test>::get(client)?.local_signer
    }
}

pub struct MarketOrigin;
impl pallet_question_service::ExternalMarketOrigin<RuntimeOrigin> for MarketOrigin {
    fn for_client(client: u32) -> RuntimeOrigin {
        pallet_client_registry::Origin::ExternalClient(client).into()
    }
}

pub struct Windows;
impl pallet_question_service::DecisionWindowGuard for Windows {
    fn collides(_: u32, _: u32) -> bool {
        Collision::get()
    }
}

pub struct Tvl;
impl pallet_question_service::TvlCapGate<AccountId> for Tvl {
    fn escrow_admissible(_: &AccountId, _: Balance) -> bool {
        TvlAdmissible::get()
    }
}

pub struct Bytes;
impl pallet_question_service::AccountIdBytes<AccountId> for Bytes {
    fn into_bytes(account: &AccountId) -> [u8; 32] {
        let mut bytes = [0_u8; 32];
        bytes[..8].copy_from_slice(&account.to_le_bytes());
        bytes
    }
}

impl pallet_question_service::Config for Test {
    type ClientOrigin = pallet_client_registry::EnsureExternalClient;
    type ServiceParams = Params;
    type ClientFunding = Funding;
    type ExternalMarketOrigin = MarketOrigin;
    type DecisionWindows = Windows;
    type TvlCapGate = Tvl;
    type InflowCapExemptAccounts = InflowProtocol;
    type AccountIdBytes = Bytes;
    type PalletId = QuestionPalletId;
    type KeeperRebate = QuestionKeeperRebate;
    type WeightInfo = ();
    #[cfg(feature = "runtime-benchmarks")]
    type BenchmarkHelper = ();
}

#[cfg(feature = "runtime-benchmarks")]
impl pallet_question_service::BenchmarkHelper<RuntimeOrigin, AccountId> for () {
    fn client_origin(client: u32) -> RuntimeOrigin {
        pallet_client_registry::Origin::ExternalClient(client).into()
    }

    fn funder(_: u32) -> AccountId {
        ALICE
    }

    fn attestor(index: u32) -> AccountId {
        200 + u64::from(index)
    }

    fn prime_params() {
        FeeRate::set(Some(Perbill::from_parts(10_000_000)));
        MaxLive::set(bounds::MAX_CLIENTS);
        MaxWindow::set(100);
        EpsilonMin::set(FixedU64(10_000_000));
    }

    fn prime_client(client: u32, funder: &AccountId) {
        pallet_client_registry::Clients::<Test>::insert(
            client,
            client_registry_core::ClientRecord::new_local(*funder, 1_000, 0),
        );
        pallet_client_registry::ClientIdOfSigner::<Test>::insert(funder, client);
        pallet_client_registry::ClientPolicies::<Test>::insert(
            client,
            pallet_client_registry::SubIdPolicy::Optional,
        );
        pallet_client_registry::BondOwners::<Test>::insert(client, funder);
        pallet_client_registry::ClientCount::<Test>::put(1);
        pallet_client_registry::NextClientId::<Test>::put(client.saturating_add(1));
    }

    fn prime_usdc(who: &AccountId, amount: Balance) {
        use frame_support::traits::fungibles::Mutate;
        let minted = <Assets as Mutate<AccountId>>::mint_into(USDC, who, amount);
        assert!(minted.is_ok());
    }

    fn prime_register_scan(funder: &AccountId) {
        for index in 0..bounds::MAX_EXTERNAL_BOOK_PAIRS.saturating_sub(1) {
            let question = kernel::SERVICE_ID_BASE
                .saturating_add(1_000)
                .saturating_add(u64::from(index).saturating_mul(3));
            pallet_market::ExternalBookPairs::<Test>::insert(
                question,
                pallet_market::ExternalBookPair {
                    client: 0,
                    funder: *funder,
                    accept: question.saturating_add(1),
                    reject: question.saturating_add(2),
                },
            );
        }
    }

    fn advance_to(block: u32) {
        System::set_block_number(u64::from(block));
    }
}

pub fn ledger_account() -> AccountId {
    LedgerPalletId::get().into_account_truncating()
}
pub fn service_ledger_account() -> AccountId {
    ServiceLedgerPalletId::get().into_account_truncating()
}
pub fn market_account() -> AccountId {
    MarketPalletId::get().into_account_truncating()
}
pub fn question_account() -> AccountId {
    QuestionPalletId::get().into_account_truncating()
}

pub fn client_origin() -> RuntimeOrigin {
    pallet_client_registry::Origin::ExternalClient(CLIENT).into()
}

pub fn new_test_ext() -> sp_io::TestExternalities {
    FeeRate::set(Some(Perbill::from_parts(10_000_000)));
    MaxLive::set(16);
    MaxWindow::set(100);
    EpsilonMin::set(FixedU64(10_000_000));
    OracleWindow::set(20);
    TvlAdmissible::set(true);
    Collision::set(false);
    MainCredited::set(0);
    KeeperRebates::set(Vec::new());
    let mut storage = frame_system::GenesisConfig::<Test>::default()
        .build_storage()
        .unwrap_or_default();
    let accounts = [
        ALICE,
        BOB,
        CHARLIE,
        DAVE,
        MARKET_ADMIN,
        EMERGENCY,
        INSURANCE,
        MAIN,
        INFLOW_ONLY,
        ledger_account(),
        service_ledger_account(),
        market_account(),
        question_account(),
    ];
    let balances_genesis = pallet_balances::GenesisConfig::<Test> {
        balances: accounts
            .into_iter()
            .map(|who| (who, 1_000_000_000))
            .collect(),
        ..Default::default()
    }
    .assimilate_storage(&mut storage);
    assert!(balances_genesis.is_ok(), "balances genesis must assimilate");
    let assets_genesis = pallet_assets::GenesisConfig::<Test> {
        assets: vec![(USDC, ALICE, true, 1)],
        metadata: vec![],
        accounts: accounts
            .into_iter()
            .filter(|who| *who != question_account())
            .map(|who| (USDC, who, 20_000 * UNIT))
            .collect(),
        next_asset_id: None,
        reserves: vec![],
    }
    .assimilate_storage(&mut storage);
    assert!(assets_genesis.is_ok(), "assets genesis must assimilate");
    let mut ext = sp_io::TestExternalities::new(storage);
    ext.execute_with(|| {
        System::set_block_number(1);
        assert!(ClientRegistry::admit_local_client(
            RuntimeOrigin::root(),
            ALICE,
            ALICE,
            pallet_client_registry::SubIdPolicy::Optional,
        )
        .is_ok());
    });
    ext
}
