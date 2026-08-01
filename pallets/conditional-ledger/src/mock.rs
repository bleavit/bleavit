//! Mock runtime for `pallet-conditional-ledger` tests.
//!
//! `System` + `Balances` (the deposit `Currency` `pallet-assets` needs) +
//! `Assets` (the USDC `ForeignAssets` stand-in — `T::Collateral`) + the ledger.
//! The three internal authorities are modelled as distinct signed accounts so the
//! origin-misuse suites can assert each call rejects the wrong authority.

use crate as pallet_conditional_ledger;
use conditional_ledger_core::MAX_POSITIONS_PER_ACCOUNT;
use frame_support::{
    derive_impl, parameter_types,
    traits::{AsEnsureOriginWithArg, Contains, EnsureOrigin, StorageVersion},
    PalletId,
};
use frame_system::{EnsureSigned, RawOrigin};
use futarchy_primitives::{
    keeper::{CrankClass, KeeperRebateSink},
    kernel, Balance,
};
use sp_runtime::{traits::AccountIdConversion, BuildStorage, Perbill};

pub type AccountId = u64;
pub type AssetId = u32;
type Block = frame_system::mocking::MockBlock<Test>;

// Named accounts.
pub const MARKET: AccountId = 100;
pub const RESOLVER: AccountId = 101;
pub const SETTLER: AccountId = 102;
pub const ALICE: AccountId = 1;
pub const BOB: AccountId = 2;
pub const CHARLIE: AccountId = 3;
/// Protocol accounts (POL/book/fee/INSURANCE) — cap-, deposit- and (03 §5.3a)
/// redemption-fee-exempt.
pub const BOOK: AccountId = 900;
pub const POL: AccountId = 901;
pub const INSURANCE: AccountId = 902;
/// The treasury `MAIN` sub-account — the 03 §5.4 redemption-fee sink (08 §1.1).
pub const TREASURY_MAIN: AccountId = 903;

/// The USDC asset id inside the mock `Assets` instance.
pub const USDC: AssetId = 1337;

frame_support::construct_runtime!(
    pub enum Test {
        System: frame_system,
        Balances: pallet_balances,
        Assets: pallet_assets,
        ConditionalLedger: pallet_conditional_ledger,
    }
);

/// Short test-only alias retained for the existing pallet call fixtures.
pub type Ledger = ConditionalLedger;

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

// ---- internal authorities: distinct signed accounts --------------------------

macro_rules! ensure_account {
    ($name:ident, $acct:expr) => {
        pub struct $name;
        impl EnsureOrigin<RuntimeOrigin> for $name {
            type Success = ();
            fn try_origin(o: RuntimeOrigin) -> Result<Self::Success, RuntimeOrigin> {
                match o.clone().into() {
                    Ok(RawOrigin::Signed(who)) if who == $acct => Ok(()),
                    _ => Err(o),
                }
            }
            #[cfg(feature = "runtime-benchmarks")]
            fn try_successful_origin() -> Result<RuntimeOrigin, ()> {
                Ok(RawOrigin::Signed($acct).into())
            }
        }
    };
}
ensure_account!(EnsureMarket, MARKET);
ensure_account!(EnsureResolver, RESOLVER);
ensure_account!(EnsureSettler, SETTLER);

pub struct Protocol;
impl Contains<AccountId> for Protocol {
    fn contains(who: &AccountId) -> bool {
        matches!(*who, BOOK | POL | INSURANCE) || *who == ledger_account()
    }
}

parameter_types! {
    pub const LedgerPalletId: PalletId = PalletId(*b"bl/ledgr");
    // `static` so tests can raise the live `ledger.min_split` above the kernel
    // floor (13 §1 lets META raise it to 1 USDC) to exercise the R-2 live-floor
    // paths; defaults to the kernel floor, fresh per test thread.
    pub static MinSplit: Balance = kernel::MIN_SPLIT_USDC;
    pub PositionDeposit: Balance = kernel::POSITION_DEPOSIT_USDC;
    pub const MaxPositionsPerAccount: u32 = MAX_POSITIONS_PER_ACCOUNT;
    pub const ArchiveDelay: u64 = 100; // blocks (short, for tests)
    pub static ReapBatch: u32 = kernel::REAP_BATCH;
    pub UsdcAssetId: AssetId = USDC;
    pub InsuranceAccount: AccountId = INSURANCE;
    pub TreasuryMainAccount: AccountId = TREASURY_MAIN;
    // `static` so a test can drive the live 13 §1 `ledger.redeem_fee` rate.
    // Defaults to **0** — the pre-E1 regression 03 §11 makes normative — so
    // every existing suite keeps its exact behaviour unless it opts in.
    pub static RedemptionFee: Perbill = Perbill::zero();
    /// Disabled by default, so the mock behaves like the `()` sink unless a
    /// keeper-rebate regression explicitly enables recording.
    pub static RecordKeeperRebates: bool = false;
    pub static KeeperRebates: Vec<(AccountId, CrankClass)> = Vec::new();
    /// Pure-read model of the production Phase-3 inflow-cap inputs. Defaults are
    /// permissive; tests can independently put either the global issuance or an
    /// account's cumulative deposit meter above its live cap.
    pub static MockLocalUsdcIssuance: Balance = 0;
    pub static MockTvlCap: Balance = u128::MAX;
    pub static MockCumulativeDeposits: Vec<(AccountId, Balance)> = Vec::new();
    pub static MockDepCap: Balance = u128::MAX;
    /// Explicit market-ordering fixture. Standalone ledger tests have no
    /// market pallet, so both vault classes are sweepable unless a regression
    /// opts into the blocking state.
    pub static ProposalMarketsSwept: bool = true;
    pub static BaselineMarketSwept: bool = true;
    /// Treasury seam fixtures. They are explicit types rather than `()` so the
    /// production-required residue and revenue paths cannot disappear behind
    /// an accounting-free default.
    pub static ReportedResidue: Vec<Balance> = Vec::new();
    pub static ResidueReporterRefuses: bool = false;
    pub static MainCreditedTotal: Balance = 0;
    pub static MainRevenueRefuses: bool = false;
}

pub struct TestKeeperRebate;

impl KeeperRebateSink<AccountId> for TestKeeperRebate {
    fn rebate(who: &AccountId, class: CrankClass) {
        if RecordKeeperRebates::get() {
            let mut rebates = KeeperRebates::get();
            rebates.push((*who, class));
            KeeperRebates::set(rebates);
        }
    }
}

pub struct TestInflowCapGate;

impl pallet_conditional_ledger::InflowCapGate<AccountId> for TestInflowCapGate {
    fn escrow_admissible(who: &AccountId) -> bool {
        if MockLocalUsdcIssuance::get() > MockTvlCap::get() {
            return false;
        }
        let cumulative = MockCumulativeDeposits::get()
            .into_iter()
            .find_map(|(account, amount)| (account == *who).then_some(amount))
            .unwrap_or(0);
        cumulative <= MockDepCap::get()
    }
}

pub struct TestMarketSweepStatus;

impl pallet_conditional_ledger::MarketSweepStatus for TestMarketSweepStatus {
    fn proposal_books_swept(_: futarchy_primitives::ProposalId) -> bool {
        ProposalMarketsSwept::get()
    }

    fn baseline_book_swept(_: futarchy_primitives::EpochId) -> bool {
        BaselineMarketSwept::get()
    }
}

pub struct TestResidueReporter;

impl pallet_conditional_ledger::ResidueReporter for TestResidueReporter {
    fn note_swept_residue(amount: Balance) -> frame_support::dispatch::DispatchResult {
        if ResidueReporterRefuses::get() {
            return Err(sp_runtime::DispatchError::Other(
                "residue recognition refused",
            ));
        }
        let mut reported = ReportedResidue::get();
        reported.push(amount);
        ReportedResidue::set(reported);
        Ok(())
    }
}

pub struct TestMainRevenueSink;

impl pallet_conditional_ledger::MainRevenueSink for TestMainRevenueSink {
    fn credit_main(amount: Balance) -> frame_support::dispatch::DispatchResult {
        if MainRevenueRefuses::get() {
            return Err(sp_runtime::DispatchError::Other(
                "MAIN revenue recognition refused",
            ));
        }
        let credited = MainCreditedTotal::get()
            .checked_add(amount)
            .ok_or(sp_runtime::DispatchError::Other("MAIN credit overflow"))?;
        MainCreditedTotal::set(credited);
        Ok(())
    }
}

impl pallet_conditional_ledger::Config<()> for Test {
    type Collateral = Assets;
    type UsdcAssetId = UsdcAssetId;
    type MarketAuthority = EnsureMarket;
    type ResolveAuthority = EnsureResolver;
    type SettleAuthority = EnsureSettler;
    type EmergencyPlaybookOrigin = EnsureSettler;
    type MinSplit = MinSplit;
    type PositionDeposit = PositionDeposit;
    type MaxPositionsPerAccount = MaxPositionsPerAccount;
    type ArchiveDelay = ArchiveDelay;
    type ReapBatch = ReapBatch;
    type ProtocolAccounts = Protocol;
    type RedemptionFee = RedemptionFee;
    type InsuranceAccount = InsuranceAccount;
    type MarketSweepStatus = TestMarketSweepStatus;
    type ResidueReporter = TestResidueReporter;
    type TreasuryMainAccount = TreasuryMainAccount;
    type MainRevenueSink = TestMainRevenueSink;
    type PalletId = LedgerPalletId;
    type KeeperRebate = TestKeeperRebate;
    type InflowCapGate = TestInflowCapGate;
    type WeightInfo = ();
    #[cfg(feature = "runtime-benchmarks")]
    type BenchmarkHelper = ();
}

/// The ledger's sovereign account (custodies escrow + deposits).
pub fn ledger_account() -> AccountId {
    LedgerPalletId::get().into_account_truncating()
}

/// One USDC = 1e6 base units (6 decimals; `MIN_SPLIT` = 10⁴ = 0.01 USDC).
pub const UNIT: Balance = 1_000_000;

pub fn new_test_ext() -> sp_io::TestExternalities {
    let mut t = frame_system::GenesisConfig::<Test>::default()
        .build_storage()
        .unwrap();

    // Endow the deposit `Currency` so `pallet-assets` account creation never fails.
    pallet_balances::GenesisConfig::<Test> {
        balances: vec![
            (ALICE, 1_000_000_000),
            (BOB, 1_000_000_000),
            (CHARLIE, 1_000_000_000),
            (MARKET, 1_000_000_000),
            (BOOK, 1_000_000_000),
            (POL, 1_000_000_000),
            (INSURANCE, 1_000_000_000),
            (TREASURY_MAIN, 1_000_000_000),
            (ledger_account(), 1_000_000_000),
        ],
        ..Default::default()
    }
    .assimilate_storage(&mut t)
    .unwrap();

    pallet_assets::GenesisConfig::<Test> {
        // id, owner, is_sufficient, min_balance = 10⁴ (13 §3.5 USDC ED).
        assets: vec![(USDC, ALICE, true, 10_000)],
        metadata: vec![],
        accounts: vec![
            (USDC, ALICE, 100_000 * UNIT),
            (USDC, BOB, 100_000 * UNIT),
            (USDC, CHARLIE, 100_000 * UNIT),
            (USDC, MARKET, 100_000 * UNIT),
            (USDC, BOOK, 100_000 * UNIT),
            (USDC, POL, 100_000 * UNIT),
            (USDC, INSURANCE, 100_000 * UNIT),
            (USDC, TREASURY_MAIN, 100_000 * UNIT),
            (USDC, ledger_account(), 10_000), // one-ED genesis endowment (03 §1)
        ],
        next_asset_id: None,
        reserves: vec![],
    }
    .assimilate_storage(&mut t)
    .unwrap();

    let mut ext = sp_io::TestExternalities::new(t);
    ext.execute_with(|| {
        System::set_block_number(1);
        StorageVersion::new(1).put::<pallet_conditional_ledger::Pallet<Test>>();
        ReapBatch::set(kernel::REAP_BATCH);
        RedemptionFee::set(Perbill::zero());
        RecordKeeperRebates::set(false);
        KeeperRebates::set(Vec::new());
        MockLocalUsdcIssuance::set(0);
        MockTvlCap::set(u128::MAX);
        MockCumulativeDeposits::set(Vec::new());
        MockDepCap::set(u128::MAX);
        ProposalMarketsSwept::set(true);
        BaselineMarketSwept::set(true);
        ReportedResidue::set(Vec::new());
        ResidueReporterRefuses::set(false);
        MainCreditedTotal::set(0);
        MainRevenueRefuses::set(false);
    });
    ext
}
