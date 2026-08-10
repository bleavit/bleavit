//! Mock runtime for `pallet-trading-rewards` (15 §4.1).
//!
//! Every governed value the pallet reads is a mutable static here, so a test
//! can move the live row and watch the boundary move with it. That is what
//! separates "the pallet reads `ledger.pos_dep`" from "the pallet happens to
//! agree with one number".

use crate as pallet_trading_rewards;
use frame_support::{derive_impl, parameter_types, traits::AsEnsureOriginWithArg, PalletId};
use frame_system::{EnsureRoot, EnsureSigned};
use futarchy_primitives::{Balance, EpochId, MarketId};
use sp_core::crypto::AccountId32;
use sp_runtime::{traits::IdentityLookup, BuildStorage};

type Block = frame_system::mocking::MockBlock<Test>;

frame_support::construct_runtime!(
    pub enum Test {
        System: frame_system,
        Balances: pallet_balances,
        Assets: pallet_assets,
        TradingRewards: pallet_trading_rewards,
    }
);

#[derive_impl(frame_system::config_preludes::TestDefaultConfig)]
impl frame_system::Config for Test {
    type Block = Block;
    type AccountId = AccountId32;
    type Lookup = IdentityLookup<AccountId32>;
    type AccountData = pallet_balances::AccountData<Balance>;
}

#[derive_impl(pallet_balances::config_preludes::TestDefaultConfig)]
impl pallet_balances::Config for Test {
    type AccountStore = System;
    type Balance = Balance;
    type ExistentialDeposit = VitExistentialDeposit;
}

#[derive_impl(pallet_assets::config_preludes::TestDefaultConfig)]
impl pallet_assets::Config for Test {
    type Currency = Balances;
    type Balance = Balance;
    type AssetId = u32;
    type AssetIdParameter = u32;
    type CreateOrigin = AsEnsureOriginWithArg<EnsureSigned<AccountId32>>;
    type ForceOrigin = EnsureRoot<AccountId32>;
}

parameter_types! {
    pub const VitExistentialDeposit: Balance = 1;
    pub UsdcAssetId: u32 = 1_337;
    pub const RewardsPalletId: PalletId = PalletId(*b"t/trwrds");
    /// `rwd.rate` in parts per billion. `None` is the fail-closed state.
    pub static RewardRate: Option<u32> = Some(2_500_000);
    /// `fee.vit_usdc_rate` as its stored `FixedU64` integer (USDC per VIT).
    /// The genesis registry leaves the row unseeded, so the default here is
    /// `None` and a test that claims must set it deliberately.
    pub static VitUsdcRate: Option<u64> = None;
    /// `ledger.pos_dep`. The production row is frozen at 0.1 USDC; the mock
    /// uses a small figure so a bond fixture stays readable, and the tests
    /// move it to prove the read is live rather than pinned.
    pub static PositionDeposit: Balance = 100;
    pub static CurrentEpoch: EpochId = 7;
}

pub struct MockRewardRate;
impl frame_support::traits::Get<Option<u32>> for MockRewardRate {
    fn get() -> Option<u32> {
        // The runtime-side provider filters a zero rate to `None`, exactly as
        // `LiveClientBond` does for `svc.client_bond`; the mock mirrors it so
        // the fail-closed path under test is the production one.
        RewardRate::get().filter(|rate| *rate > 0)
    }
}

pub struct MockVitUsdcRate;
impl frame_support::traits::Get<Option<u64>> for MockVitUsdcRate {
    fn get() -> Option<u64> {
        VitUsdcRate::get().filter(|rate| *rate > 0)
    }
}

impl pallet_trading_rewards::Config for Test {
    type Collateral = Assets;
    type UsdcAssetId = UsdcAssetId;
    type Rewards = Balances;
    type PalletId = RewardsPalletId;
    type RewardRate = MockRewardRate;
    type VitUsdcRate = MockVitUsdcRate;
    type PositionDeposit = PositionDeposit;
    type CurrentEpoch = CurrentEpoch;
    type WeightInfo = ();

    #[cfg(feature = "runtime-benchmarks")]
    type BenchmarkHelper = MockBenchmarkHelper;
}

#[cfg(feature = "runtime-benchmarks")]
pub struct MockBenchmarkHelper;

#[cfg(feature = "runtime-benchmarks")]
impl pallet_trading_rewards::BenchmarkHelper<AccountId32> for MockBenchmarkHelper {
    fn prime_usdc(who: &AccountId32, amount: Balance) {
        use frame_support::traits::fungibles::Mutate;
        let _ = <Assets as Mutate<AccountId32>>::mint_into(UsdcAssetId::get(), who, amount);
    }

    fn prime_reward_budget(vit: Balance) {
        use frame_support::traits::fungible::Mutate;
        let _ = <Balances as Mutate<AccountId32>>::mint_into(
            &pallet_trading_rewards::Pallet::<Test>::account_id(),
            vit,
        );
    }

    fn prime_vit_rate(rate: u64) {
        VitUsdcRate::set(Some(rate));
    }
}

pub const MARKET_A: MarketId = 11;
pub const MARKET_B: MarketId = 12;

/// The mock USDC asset's `min_balance`.
pub const USDC_MIN_BALANCE: Balance = 10;

pub fn account(seed: u8) -> AccountId32 {
    AccountId32::new([seed; 32])
}

pub fn alice() -> AccountId32 {
    account(1)
}

pub fn bob() -> AccountId32 {
    account(2)
}

/// USDC the pallet sovereign holds on this account's behalf, as the record
/// states it. Read through the record rather than the sovereign's balance,
/// because the sovereign pools every participant's bond.
pub fn held_usdc(who: &AccountId32) -> Balance {
    pallet_trading_rewards::Participants::<Test>::get(who)
        .map(|record| record.bond)
        .unwrap_or_default()
}

/// USDC actually in the pallet sovereign's custody.
pub fn sovereign_usdc() -> Balance {
    usdc_balance(&pallet_trading_rewards::Pallet::<Test>::account_id())
}

pub fn usdc_balance(who: &AccountId32) -> Balance {
    use frame_support::traits::fungibles::Inspect;
    <Assets as Inspect<AccountId32>>::balance(UsdcAssetId::get(), who)
}

pub fn vit_balance(who: &AccountId32) -> Balance {
    use frame_support::traits::fungible::Inspect;
    <Balances as Inspect<AccountId32>>::balance(who)
}

pub fn mint_usdc(who: &AccountId32, amount: Balance) {
    use frame_support::traits::fungibles::Mutate;
    assert!(
        <Assets as Mutate<AccountId32>>::mint_into(UsdcAssetId::get(), who, amount).is_ok(),
        "mock USDC mint must succeed"
    );
}

pub fn fund_reward_budget(vit: Balance) {
    use frame_support::traits::fungible::Mutate;
    assert!(
        <Balances as Mutate<AccountId32>>::mint_into(
            &pallet_trading_rewards::Pallet::<Test>::account_id(),
            vit,
        )
        .is_ok(),
        "mock VIT budget mint must succeed"
    );
}

/// Write a score entry the way TR4's fill observer will, so TR3's withdrawal
/// gate can be exercised before that observer exists.
pub fn record_test_score(who: &AccountId32, market: MarketId, spent: Balance, received: Balance) {
    pallet_trading_rewards::Scores::<Test>::insert(
        who,
        market,
        trading_rewards_core::MarketScore {
            spent,
            received,
            book_acquired: [0, 0],
        },
    );
    pallet_trading_rewards::ScoreCount::<Test>::mutate(who, |count| {
        *count = count.saturating_add(1)
    });
}

/// Write a folded epoch total the way TR5's `settle_market_score` will.
pub fn record_test_epoch_score(who: &AccountId32, spent: Balance, received: Balance) {
    pallet_trading_rewards::Participants::<Test>::mutate(who, |slot| {
        if let Some(record) = slot.as_mut() {
            record.epoch = trading_rewards_core::EpochScore { spent, received };
        }
    });
}

/// Write an accrual the way TR5's `settle_epoch` will, keeping the O(1) mirror
/// in step so `try-state` stays meaningful in these tests.
pub fn record_test_accrual(who: &AccountId32, accrued: Balance) {
    pallet_trading_rewards::Participants::<Test>::mutate(who, |slot| {
        if let Some(record) = slot.as_mut() {
            pallet_trading_rewards::TotalAccrued::<Test>::mutate(|total| {
                *total = total.saturating_sub(record.accrued).saturating_add(accrued);
            });
            record.accrued = accrued;
        }
    });
}

pub fn new_test_ext() -> sp_io::TestExternalities {
    RewardRate::set(Some(2_500_000));
    VitUsdcRate::set(None);
    PositionDeposit::set(100);
    CurrentEpoch::set(7);
    let mut storage = frame_system::GenesisConfig::<Test>::default()
        .build_storage()
        .unwrap_or_default();
    let balances = pallet_balances::GenesisConfig::<Test> {
        balances: vec![(alice(), 1_000_000), (bob(), 1_000_000)],
        dev_accounts: None,
    }
    .assimilate_storage(&mut storage);
    assert!(balances.is_ok(), "mock balances genesis must assimilate");
    let assets = pallet_assets::GenesisConfig::<Test> {
        // USDC is genesis-declared `is_sufficient` on this chain (03 §7 R-4,
        // enforced by `validate-chain-spec.py`), so the sovereign needs no
        // native provider to custody it. `min_balance` sits below the bond
        // floor but above 1, so both the asset floor and `ledger.pos_dep`
        // are reachable gates and the tests can tell them apart.
        assets: vec![(UsdcAssetId::get(), alice(), true, USDC_MIN_BALANCE)],
        metadata: vec![],
        accounts: vec![
            (UsdcAssetId::get(), alice(), 1_000_000),
            (UsdcAssetId::get(), bob(), 1_000_000),
        ],
        next_asset_id: None,
        reserves: vec![],
    }
    .assimilate_storage(&mut storage);
    assert!(assets.is_ok(), "mock assets genesis must assimilate");
    let mut ext = sp_io::TestExternalities::new(storage);
    ext.execute_with(|| System::set_block_number(1));
    ext
}
