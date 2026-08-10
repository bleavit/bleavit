//! Runtime configuration and the B1a fail-closed cross-pallet adapters.

use alloc::{borrow::Cow, boxed::Box, vec, vec::Vec};

#[cfg(feature = "runtime-benchmarks")]
use frame_support::traits::fungible::MutateHold;
#[cfg(feature = "runtime-benchmarks")]
use frame_support::traits::{Currency, Everything};
use frame_support::{
    derive_impl,
    dispatch::{DispatchClass, DispatchResult},
    parameter_types,
    traits::{
        fungibles::{self, Inspect, Mutate},
        tokens::{Fortitude, Preservation},
        Bounded, ConstBool, ConstU128, ConstU32, ConstU64, ConstU8, Contains, EqualPrivilegeOnly,
        Get, InstanceFilter, Nothing, OriginTrait, PostInherents, PostTransactions, QueryPreimage,
        StorageInstance, StorePreimage, TransformOrigin, UnfilteredDispatchable, VariantCountOf,
        VestedTransfer, WithdrawReasons,
    },
    weights::{
        constants::{
            BlockExecutionWeight, ExtrinsicBaseWeight, RocksDbWeight, WEIGHT_REF_TIME_PER_SECOND,
        },
        IdentityFee, Weight,
    },
    PalletId,
};
use frame_system::{
    limits::{BlockLength, BlockWeights},
    EnsureRoot, EnsureSigned,
};
#[cfg(feature = "runtime-benchmarks")]
use futarchy_primitives::keeper::CrankClass;
use futarchy_primitives::{bounds, chain_identity, currency, kernel, EpochId, FixedU64, ParamKey};
use parity_scale_codec::{DecodeAll, Encode};
use sp_consensus_aura::sr25519::AuthorityId as AuraId;
#[cfg(feature = "runtime-benchmarks")]
use sp_runtime::AccountId32;
use sp_runtime::{
    traits::{AccountIdConversion, AccountIdLookup},
    DispatchError, Perbill,
};

use crate::{
    usdc_location, AccountId, AssetId, Aura, Balance, Balances, Block, BlockNumber,
    CollatorSelection, ConditionalLedger, ConsensusHook, Epoch, ExecutionGuard, ForeignAssets,
    FutarchyTreasury, Hash, Market, MessageQueue, Migrations, Nonce, PalletInfo, ParachainSystem,
    PolkadotXcm, Preimage, QuestionService, Referenda, Runtime, RuntimeCall, RuntimeEvent,
    RuntimeFreezeReason, RuntimeHoldReason, RuntimeOrigin, RuntimeTask, Scheduler, Session,
    SessionKeys, System, Vesting, XcmpQueue, VERSION,
};

const NORMAL_DISPATCH_RATIO: Perbill = Perbill::from_percent(75);
const AVERAGE_ON_INITIALIZE_RATIO: Perbill = Perbill::from_percent(5);
const MAXIMUM_BLOCK_WEIGHT: Weight = Weight::from_parts(
    WEIGHT_REF_TIME_PER_SECOND.saturating_mul(2),
    cumulus_primitives_core::relay_chain::MAX_POV_SIZE as u64,
);

parameter_types! {
    pub const Version: sp_version::RuntimeVersion = VERSION;
    pub RuntimeBlockLength: BlockLength = BlockLength::builder()
        .max_length(5 * 1024 * 1024)
        .modify_max_length_for_class(DispatchClass::Normal, |m| *m = NORMAL_DISPATCH_RATIO * *m)
        .build();
    pub RuntimeBlockWeights: BlockWeights = BlockWeights::builder()
        .base_block(BlockExecutionWeight::get())
        .for_class(DispatchClass::all(), |w| w.base_extrinsic = ExtrinsicBaseWeight::get())
        // N7: `CheckWeight` must be able to see both sides of the explicit
        // partition. The resource extension enforces the 75/25 split; keeping
        // Normal at 75 % here would make the external quota unusable after a
        // primary call, while making it `max_block` does not grant borrowing
        // because the extension refuses a primary call above its reservation.
        .for_class(DispatchClass::Normal, |w| w.max_total = Some(MAXIMUM_BLOCK_WEIGHT))
        .for_class(DispatchClass::Operational, |w| {
            w.max_total = Some(MAXIMUM_BLOCK_WEIGHT);
            w.reserved = Some(MAXIMUM_BLOCK_WEIGHT - NORMAL_DISPATCH_RATIO * MAXIMUM_BLOCK_WEIGHT);
        })
        .avg_block_initialization(AVERAGE_ON_INITIALIZE_RATIO)
        .build_or_panic();
    pub const Ss58Prefix: u16 = chain_identity::SS58_PREFIX;
}

// B16: this runtime's first storage migration — retires the inert
// `ExecutionGuard::BlockedMeters` (SQ-146) and the runtime stall-progress marker
// (SQ-132), gated on `pallet-execution-guard` storage version `0 -> 1`. See
// `crate::migrations`. NB: `SingleBlockMigrations` runs inside `on_runtime_upgrade`
// and creates **no** `pallet-migrations` cursor, so it never engages the
// `OnlyInherents` multi-block-migration lockdown (09 §3.2).
#[cfg(all(not(feature = "phase-four"), not(feature = "recovery")))]
type SingleBlockMigrations = (
    crate::migrations::RetireB16State,
    crate::migrations::MigrateConstitutionReserveProbeV2,
    crate::migrations::MigrateOracleReserveProbeV1,
    crate::migrations::MigrateConstitutionSecurityPrizeV3,
    crate::migrations::MigrateConstitutionSecurityFlowCapV4,
    crate::migrations::MigrateWelfareSnapshotContextsV1,
);
#[cfg(all(feature = "phase-four", not(feature = "recovery")))]
type SingleBlockMigrations = (
    crate::migrations::RetireB16State,
    crate::migrations::MigrateConstitutionReserveProbeV2,
    crate::migrations::MigrateOracleReserveProbeV1,
    crate::migrations::MigrateConstitutionSecurityPrizeV3,
    crate::migrations::MigrateConstitutionSecurityFlowCapV4,
    crate::migrations::MigrateWelfareSnapshotContextsV1,
    crate::migrations::PhaseFourTransition,
);
#[cfg(feature = "recovery")]
type SingleBlockMigrations = (
    crate::migrations::RetireB16State,
    crate::migrations::MigrateConstitutionReserveProbeV2,
    crate::migrations::MigrateOracleReserveProbeV1,
    crate::migrations::MigrateConstitutionSecurityPrizeV3,
    crate::migrations::MigrateConstitutionSecurityFlowCapV4,
    crate::migrations::MigrateWelfareSnapshotContextsV1,
    crate::migrations::TerminalRecoveryTransition,
);

#[derive_impl(frame_system::config_preludes::ParaChainDefaultConfig)]
impl frame_system::Config for Runtime {
    type BaseCallFilter = crate::classifier::RuntimeBaseCallFilter;
    type AccountId = AccountId;
    type Lookup = AccountIdLookup<AccountId, ()>;
    type Nonce = Nonce;
    type Hash = Hash;
    type Block = Block;
    type Version = Version;
    type AccountData = pallet_balances::AccountData<Balance>;
    type DbWeight = RocksDbWeight;
    type SystemWeightInfo = crate::weights::frame_system::WeightInfo<Runtime>;
    type BlockWeights = RuntimeBlockWeights;
    type BlockLength = RuntimeBlockLength;
    type SS58Prefix = Ss58Prefix;
    type OnSetCode = cumulus_pallet_parachain_system::ParachainSetCode<Self>;
    type MaxConsumers = ConstU32<16>;
    type SingleBlockMigrations = SingleBlockMigrations;
    type MultiBlockMigrator = RecoveryAwareMigrations;
    // 05 §4.3.2's block-production observation. These two are the only hooks
    // that straddle the inherent/transaction boundary in every execution path,
    // which is what makes "all extrinsics are inherents" decidable without
    // enumerating this runtime's inherent providers.
    type PostInherents = BlockProductionInherentBoundary;
    type PostTransactions = BlockProductionRecorder;
}

parameter_types! {
    pub const MinimumPeriod: u64 = kernel::MILLISECS_PER_BLOCK / 2;
    pub const ExistentialDeposit: Balance = currency::VIT_EXISTENTIAL_DEPOSIT;
}

impl pallet_timestamp::Config for Runtime {
    type Moment = u64;
    type OnTimestampSet = Aura;
    type MinimumPeriod = MinimumPeriod;
    type WeightInfo = crate::weights::pallet_timestamp::WeightInfo<Runtime>;
}

impl pallet_balances::Config for Runtime {
    type RuntimeEvent = RuntimeEvent;
    type Balance = Balance;
    type DustRemoval = ();
    type ExistentialDeposit = ExistentialDeposit;
    type AccountStore = System;
    type WeightInfo = crate::weights::pallet_balances::WeightInfo<Runtime>;
    type MaxLocks = ConstU32<50>;
    type MaxReserves = ConstU32<50>;
    type ReserveIdentifier = [u8; 8];
    type RuntimeHoldReason = RuntimeHoldReason;
    type RuntimeFreezeReason = RuntimeFreezeReason;
    type FreezeIdentifier = RuntimeFreezeReason;
    type MaxFreezes = VariantCountOf<RuntimeFreezeReason>;
    type DoneSlashHandler = ();
}

parameter_types! {
    pub const MinVestedTransfer: Balance = currency::VIT;
    pub UnvestedFundsAllowedWithdrawReasons: WithdrawReasons =
        WithdrawReasons::TRANSACTION_PAYMENT;
}

impl pallet_vesting::Config for Runtime {
    type RuntimeEvent = RuntimeEvent;
    type Currency = Balances;
    type BlockNumberToBalance = sp_runtime::traits::ConvertInto;
    type MinVestedTransfer = MinVestedTransfer;
    type WeightInfo = pallet_vesting::weights::SubstrateWeight<Runtime>;
    // The pallet applies the complement when installing its legacy balance lock.
    // The fungible fee adapter ignores these lock reasons, so in practice unvested
    // VIT cannot pay fees despite TRANSACTION_PAYMENT being the allowed reason.
    type UnvestedFundsAllowedWithdrawReasons = UnvestedFundsAllowedWithdrawReasons;
    // Schedules use para-blocks at the nominal 6 s cadence. Slower production can
    // therefore unlock later, never earlier, which is conservative under R-7.
    type BlockNumberProvider = frame_system::Pallet<Runtime>;
    const MAX_VESTING_SCHEDULES: u32 = 8;
}

parameter_types! {
    /// 08 §2.1: the keyless genesis community pot.
    pub CommunityDistributionPot: AccountId = crate::genesis::community_account();
    /// 08 §2.1: 250 million VIT held in that pot at genesis.
    pub CommunityDistributionAmount: Balance = crate::genesis::COMMUNITY_DISTRIBUTION;
    /// 08 §2.1: two nominal 365-day years at the 6-second block cadence.
    pub CommunityVestingDuration: BlockNumber = 2 * crate::genesis::BLOCKS_PER_YEAR;
    /// 13 §1/§3: the SDK's one-VIT minimum transfer.
    pub CommunityMinVestedTransfer: Balance = currency::VIT;
    /// 13 §4: bounded distribution state.
    pub MaxCommunitySchedules: u32 = bounds::MAX_COMMUNITY_SCHEDULES;
}

pub struct RuntimeCommunityVesting;
impl pallet_futarchy_treasury::CommunityVesting<AccountId, BlockNumber>
    for RuntimeCommunityVesting
{
    fn vested_transfer(
        source: &AccountId,
        beneficiary: &AccountId,
        amount: Balance,
        per_block: Balance,
        starting_block: BlockNumber,
    ) -> DispatchResult {
        <Vesting as VestedTransfer<AccountId>>::vested_transfer(
            source,
            beneficiary,
            amount,
            per_block,
            starting_block,
        )
    }
}

parameter_types! {
    pub UsdcAssetId: AssetId = usdc_location();
    pub const AssetDeposit: Balance = currency::VIT_EXISTENTIAL_DEPOSIT;
    pub const AssetAccountDeposit: Balance = currency::VIT_EXISTENTIAL_DEPOSIT;
    pub const ApprovalDeposit: Balance = currency::VIT_EXISTENTIAL_DEPOSIT;
    pub const AssetsStringLimit: u32 = 64;
    pub const MetadataDepositBase: Balance = currency::VIT_EXISTENTIAL_DEPOSIT;
    pub const MetadataDepositPerByte: Balance = 1;
}

impl pallet_assets::Config<pallet_assets::Instance1> for Runtime {
    type RuntimeEvent = RuntimeEvent;
    type Balance = Balance;
    type AssetId = AssetId;
    type AssetIdParameter = AssetId;
    type Currency = Balances;
    type CreateOrigin = EnsureConstitutionalAssetCreate;
    type ForceOrigin = ForeignAssetsForceOrigin;
    type AssetDeposit = AssetDeposit;
    type AssetAccountDeposit = AssetAccountDeposit;
    type MetadataDepositBase = MetadataDepositBase;
    type MetadataDepositPerByte = MetadataDepositPerByte;
    type ApprovalDeposit = ApprovalDeposit;
    type StringLimit = AssetsStringLimit;
    type Freezer = ();
    type Holder = ();
    type ReserveData = ();
    type Extra = ();
    type CallbackHandle = ();
    type WeightInfo = crate::weights::pallet_assets::WeightInfo<Runtime>;
    type RemoveItemsLimit = ConstU32<1_000>;
    #[cfg(feature = "runtime-benchmarks")]
    type BenchmarkHelper = AssetBenchmarkHelper;
}

#[cfg(feature = "runtime-benchmarks")]
type ForeignAssetsForceOrigin = EnsureRoot<AccountId>;
#[cfg(not(feature = "runtime-benchmarks"))]
type ForeignAssetsForceOrigin = frame_system::EnsureNever<AccountId>;

#[cfg(feature = "runtime-benchmarks")]
pub struct AssetBenchmarkHelper;
#[cfg(feature = "runtime-benchmarks")]
impl pallet_assets::BenchmarkHelper<AssetId, ()> for AssetBenchmarkHelper {
    fn create_asset_id_parameter(id: u32) -> AssetId {
        bleavit_xcm::identity::asset_hub_asset_location(id as u128)
    }
    fn create_reserve_id_parameter(_: u32) {}
}

pub struct EnsureConstitutionalAssetCreate;
impl frame_support::traits::EnsureOriginWithArg<RuntimeOrigin, AssetId>
    for EnsureConstitutionalAssetCreate
{
    type Success = AccountId;
    fn try_origin(origin: RuntimeOrigin, _: &AssetId) -> Result<AccountId, RuntimeOrigin> {
        match <pallet_origins::EnsureConstitutionalValues as frame_support::traits::EnsureOrigin<
            RuntimeOrigin,
        >>::try_origin(origin.clone())
        {
            Ok(()) => Ok(LedgerPalletId::get().into_account_truncating()),
            Err(_) => Err(origin),
        }
    }
    #[cfg(feature = "runtime-benchmarks")]
    fn try_successful_origin(_: &AssetId) -> Result<RuntimeOrigin, ()> {
        Ok(pallet_origins::Origin::ConstitutionalValues.into())
    }
}

parameter_types! {
    /// The identity fee multiplier (SQ-528). `FixedU128::DIV` is the inner
    /// representation of 1.0, so the weight term is priced at par.
    pub FeeMultiplierOne: pallet_transaction_payment::Multiplier =
        pallet_transaction_payment::Multiplier::from_u32(1);
}

impl pallet_transaction_payment::Config for Runtime {
    type RuntimeEvent = RuntimeEvent;
    type OnChargeTransaction = pallet_transaction_payment::FungibleAdapter<Balances, ()>;
    type WeightToFee = IdentityFee<Balance>;
    type LengthToFee = IdentityFee<Balance>;
    // SQ-528. This was `()`, which does NOT mean "leave the multiplier alone".
    // `FeeMultiplierUpdate` requires `Convert<Multiplier, Multiplier>`; the
    // pallet implements that only for `TargetedFeeAdjustment` and
    // `ConstFeeMultiplier`, so `()` fell through to sp-runtime's blanket
    // `impl<A, B: Default> Convert<A, B> for ()` and returned
    // `Multiplier::default()` — which for `FixedU128` is **0**, not 1. The
    // pallet's `on_finalize` runs unconditionally, so genesis's multiplier of 1
    // survived exactly one block and then pinned to zero forever.
    //
    // `compute_fee_raw` multiplies only the weight term
    // (`base_fee + len_fee + multiplier * weight_to_fee(weight)`), so at zero a
    // 185 Gps `settle_cohort` cost precisely what an empty call cost: on a
    // PoV-bound parachain, block space was free. It also silently falsified
    // every fee-derived figure in 08 §6 and §10, including the `keeper.rebate`
    // basis.
    //
    // Fixed at 1.0 rather than adopting a congestion-responsive multiplier
    // (`SlowAdjustingFeeUpdate`): 1.0 is exactly the model 08 §9 documents —
    // fee proportional to weight, with `fee.vit_usdc_rate`'s bounded
    // [0.1x, 10x] envelope as the only governed variation. Congestion pricing
    // would add a second, unbudgeted source of fee movement that no spec
    // section owns and that the keeper-rebate derivation would have to track;
    // it is a policy addition, not a defect fix, and is raised separately as
    // SQ-529. Regression: `the_transaction_fee_multiplier_survives_a_block_boundary`
    // and `a_heavy_call_costs_more_than_a_light_one_after_a_block_boundary`,
    // both of which assert ACROSS a block boundary — the pre-existing
    // single-block smoke test structurally could not see this.
    type FeeMultiplierUpdate = pallet_transaction_payment::ConstFeeMultiplier<FeeMultiplierOne>;
    type OperationalFeeMultiplier = ConstU8<5>;
    type WeightInfo = ();
}

/// Live VIT/USDC conversion. Missing or malformed `fee.vit_usdc` rejects the
/// asset-fee path; native VIT fee payment remains available.
pub struct LiveFeeConversion;

impl frame_support::traits::tokens::ConversionToAssetBalance<Balance, AssetId, Balance>
    for LiveFeeConversion
{
    type Error = ();
    fn to_asset_balance(vit: Balance, asset_id: AssetId) -> Result<Balance, ()> {
        if asset_id != usdc_location() {
            return Err(());
        }
        let rate = pallet_constitution::Params::<Runtime>::get(crate::FEE_VIT_USDC_RATE_KEY)
            .and_then(|record| match record.value {
                pallet_constitution::ParamValue::Fixed(value) if value.0 > 0 => Some(value.0),
                _ => None,
            })
            .ok_or(())?;
        let numerator = sp_core::U256::from(vit)
            .checked_mul(sp_core::U256::from(rate))
            .and_then(|value| value.checked_mul(sp_core::U256::from(currency::USDC)))
            .ok_or(())?;
        let denominator = sp_core::U256::from(1_000_000_000u64)
            .checked_mul(sp_core::U256::from(currency::VIT))
            .ok_or(())?;
        let rounded = numerator
            .checked_add(denominator.checked_sub(sp_core::U256::one()).ok_or(())?)
            .and_then(|value| value.checked_div(denominator))
            .ok_or(())?;
        let charged = if vit > 0 && rounded.is_zero() {
            sp_core::U256::one()
        } else {
            rounded
        };
        Balance::try_from(charged).map_err(|_| ())
    }
}

/// 08 §9 **Fee destination** (E3): USDC transaction fees resolve into `MAIN`.
///
/// The SDK's default `HandleCredit` implementation for `()` **drops** the
/// collected credit, which burns it from `ForeignAssets` issuance. 08 §9 marks
/// that non-conforming, and not as a policy preference: USDC on this chain is a
/// claim against a reserve held on Asset Hub, so destroying the local claim does
/// not destroy the remote reserve — it orphans it, which is exactly the outcome
/// §7.1's anti-burn rationale exists to avoid.
///
/// **VIT fees keep burning**, deliberately, and `pallet_transaction_payment`'s
/// `FungibleAdapter<Balances, ()>` above is left exactly as it is: VIT is
/// natively issued here, so burning strands no reserve, and routing it would
/// credit the treasury an asset 08 §2.2 marks at **0 in NAV**. The asymmetry is
/// the bridged/native distinction and it is the whole of the reason.
///
/// Both halves move together, as everywhere else in E2/E3: `resolve` deposits
/// the real USDC into `MAIN` custody, and the treasury's recognition counter is
/// credited so `nav()` moves with it. The counter is a small dedicated
/// `StorageValue` precisely because this handler runs on every USDC-paying
/// extrinsic — the multi-kilobyte `TreasuryState` aggregate must not enter every
/// block's proof.
///
/// `handle_credit` cannot fail, so the `Err` arm is the fail-closed one: `MAIN`
/// is a 03 §7 R-4 genesis-endowed permanent USDC account, so a refused deposit
/// is unreachable, and if it ever happened the credit is dropped exactly as the
/// pre-E3 handler did — never recognized as NAV that did not arrive.
pub struct UsdcFeesToMain;

impl pallet_asset_tx_payment::HandleCredit<AccountId, ForeignAssets> for UsdcFeesToMain {
    fn handle_credit(credit: fungibles::Credit<AccountId, ForeignAssets>) {
        let amount = credit.peek();
        if amount == 0 {
            return;
        }
        if <ForeignAssets as fungibles::Balanced<AccountId>>::resolve(
            &crate::genesis::treasury_account(),
            credit,
        )
        .is_ok()
        {
            crate::FutarchyTreasury::credit_main(amount);
        }
    }
}

impl pallet_asset_tx_payment::Config for Runtime {
    type RuntimeEvent = RuntimeEvent;
    type Fungibles = ForeignAssets;
    type OnChargeAssetTransaction =
        pallet_asset_tx_payment::FungiblesAdapter<LiveFeeConversion, UsdcFeesToMain>;
    // SQ-523: `()` charged the SDK's reference-runtime measurement, which cannot
    // know that this runtime's `HandleCredit` resolves the credit into `MAIN`
    // and mutates a treasury counter. Measured here against `()`: writes 2 -> 4
    // and estimated proof 3,675 -> 7,404 B, a 2.01x PoV understatement on every
    // USDC-paid extrinsic. (Reads are 5 either way — the same count over
    // different keys, which is coincidence and not reassurance.)
    //
    // The extension's post-dispatch refund does not rescue this. It computes
    // `declared - WeightInfo::charge_asset_tx_payment_asset()` where `declared`
    // *is* that same function (`weight()` -> `Pre::Charge.weight`), so on the
    // charged path the refund is identically zero. It corrects a mis-predicted
    // branch, never a mis-measured one — an understated function is charged and
    // refunded at the same understated value.
    type WeightInfo = crate::weights::pallet_asset_tx_payment::WeightInfo<Runtime>;
    #[cfg(feature = "runtime-benchmarks")]
    type BenchmarkHelper = AssetTxBenchmarkHelper;
}

/// SQ-523: the fixture that makes `pallet_asset_tx_payment`'s extension
/// benchmarks measure **this** runtime's fee path rather than a rejection.
///
/// Three narrowings this runtime applies to the stock fixture's inputs, and
/// **all three fail the same way**: `LiveFeeConversion` returns `Err`,
/// `withdraw_fee` maps that to `InvalidTransaction::Payment`, `test_run`
/// returns `Err`, and the SDK fixture's `.unwrap()` **panics**. None of them
/// mis-measures — each aborts the benchmark outright, which is the safer
/// failure but presents as a tooling error rather than as a missing weight.
/// (An earlier version of this comment claimed the first one measured a cheap
/// `Err` arm and contrasted it with the others; that distinction does not
/// exist, and the abort is the whole reason SQ-523 sat unresolved for a
/// session.)
///
/// 1. `create_asset_id_parameter` returns [`usdc_location`] and ignores the
///    caller's index, because `LiveFeeConversion` above rejects every asset
///    that is not USDC.
/// 2. `setup_balances_and_pool` seeds the governed `fee.vit_usdc` rate, which
///    is not a genesis key, so without it the conversion fails closed.
/// 3. It also funds the caller, since an unfunded payer cannot settle.
///
/// The USDC asset itself is genesis-created and `is_sufficient`, so minting to
/// an otherwise-unknown synthetic caller needs no provider reference; the
/// native endowment is belt-and-braces for the tip and the ED.
#[cfg(feature = "runtime-benchmarks")]
pub struct AssetTxBenchmarkHelper;
#[cfg(feature = "runtime-benchmarks")]
impl pallet_asset_tx_payment::BenchmarkHelperTrait<AccountId, AssetId, AssetId>
    for AssetTxBenchmarkHelper
{
    fn create_asset_id_parameter(_id: u32) -> (AssetId, AssetId) {
        let asset_id = usdc_location();
        (asset_id.clone(), asset_id)
    }

    fn setup_balances_and_pool(asset_id: AssetId, account: AccountId) {
        use frame_support::traits::fungible::Mutate as _;
        use frame_support::traits::fungibles::Mutate as _;

        // 13 §1 `fee.vit_usdc`, absent from genesis: without it the USDC fee
        // path is inert and the extension cannot reach the handler at all.
        //
        // The rate below is a benchmark rate, not a copied parameter — 13's own
        // value is `1.0 x fee.vit_usdc_rate_ref` with the ref `[VERIFY at TGE]`,
        // which is precisely why no genesis seed exists to reuse. The weight is
        // insensitive to it: any lawful non-zero rate takes the same branch and
        // touches the same keys. It matches the runtime test helper's rate so
        // the two fixtures stay comparable.
        pallet_constitution::Params::<Runtime>::insert(
            crate::FEE_VIT_USDC_RATE_KEY,
            pallet_constitution::ParamRecord {
                key: crate::FEE_VIT_USDC_RATE_KEY,
                value: pallet_constitution::ParamValue::Fixed(futarchy_primitives::FixedU64(
                    2_000_000_000,
                )),
                min: pallet_constitution::ParamValue::Fixed(futarchy_primitives::FixedU64(1)),
                max: pallet_constitution::ParamValue::Fixed(futarchy_primitives::FixedU64(
                    u64::MAX,
                )),
                max_delta: None,
                cooldown_epochs: 0,
                last_changed_epoch: 0,
                last_change_block: 0,
                class: pallet_constitution::ParamClass::Treasury,
                kernel_bounded: false,
            },
        );

        let _ = Balances::mint_into(&account, 1_000 * currency::VIT);
        let _ = ForeignAssets::mint_into(asset_id, &account, 1_000_000 * currency::USDC);
    }
}

parameter_types! {
    pub const PreimageBaseDeposit: Balance = currency::VIT_EXISTENTIAL_DEPOSIT;
    pub const PreimageByteDeposit: Balance = 1;
    pub const PreimageHoldReason: RuntimeHoldReason = RuntimeHoldReason::Preimage(pallet_preimage::HoldReason::Preimage);
}

impl pallet_preimage::Config for Runtime {
    type RuntimeEvent = RuntimeEvent;
    type WeightInfo = crate::weights::pallet_preimage::WeightInfo<Runtime>;
    type Currency = Balances;
    type ManagerOrigin = pallet_origins::EnsureConstitutionalValues;
    type Consideration = frame_support::traits::fungible::HoldConsideration<
        AccountId,
        Balances,
        PreimageHoldReason,
        frame_support::traits::LinearStoragePrice<
            PreimageBaseDeposit,
            PreimageByteDeposit,
            Balance,
        >,
    >;
}

/// 06 §3.4 admits scheduling only through referenda's internal Scheduler API;
/// no user or privileged origin may submit arbitrary scheduler calls.
pub struct InternalSchedulerOnly;
impl frame_support::traits::EnsureOrigin<RuntimeOrigin> for InternalSchedulerOnly {
    type Success = ();
    fn try_origin(origin: RuntimeOrigin) -> Result<(), RuntimeOrigin> {
        #[cfg(feature = "runtime-benchmarks")]
        {
            EnsureRoot::<AccountId>::try_origin(origin)
        }
        #[cfg(not(feature = "runtime-benchmarks"))]
        Err(origin)
    }
    #[cfg(feature = "runtime-benchmarks")]
    fn try_successful_origin() -> Result<RuntimeOrigin, ()> {
        // Stock scheduler benchmarks dispatch Root directly. Production keeps
        // this seam closed; Root exists here only in benchmark Wasm.
        Ok(RuntimeOrigin::root())
    }
}

parameter_types! {
    pub MaximumSchedulerWeight: Weight = Perbill::from_percent(80) * RuntimeBlockWeights::get().max_block;
}
impl pallet_scheduler::Config for Runtime {
    type RuntimeEvent = RuntimeEvent;
    type RuntimeOrigin = RuntimeOrigin;
    type PalletsOrigin = <RuntimeOrigin as frame_support::traits::OriginTrait>::PalletsOrigin;
    type RuntimeCall = RuntimeCall;
    type MaximumWeight = MaximumSchedulerWeight;
    type ScheduleOrigin = InternalSchedulerOnly;
    type MaxScheduledPerBlock = ConstU32<50>;
    type WeightInfo = crate::weights::pallet_scheduler::WeightInfo<Runtime>;
    type OriginPrivilegeCmp = EqualPrivilegeOnly;
    type Preimages = Preimage;
    type BlockNumberProvider = System;
}

impl pallet_utility::Config for Runtime {
    type RuntimeEvent = RuntimeEvent;
    type RuntimeCall = RuntimeCall;
    type PalletsOrigin = <RuntimeOrigin as frame_support::traits::OriginTrait>::PalletsOrigin;
    type WeightInfo = crate::weights::pallet_utility::WeightInfo<Runtime>;
}

#[derive(
    parity_scale_codec::Encode,
    parity_scale_codec::Decode,
    parity_scale_codec::MaxEncodedLen,
    scale_info::TypeInfo,
    Clone,
    Copy,
    Debug,
    Eq,
    Ord,
    PartialOrd,
    PartialEq,
    parity_scale_codec::DecodeWithMemTracking,
)]
pub enum ProxyType {
    Any,
}
impl Default for ProxyType {
    fn default() -> Self {
        Self::Any
    }
}
impl InstanceFilter<RuntimeCall> for ProxyType {
    fn filter(&self, _: &RuntimeCall) -> bool {
        true
    }
    fn is_superset(&self, _: &Self) -> bool {
        true
    }
}
parameter_types! {
    pub const ProxyDepositBase: Balance = currency::VIT_EXISTENTIAL_DEPOSIT;
    pub const ProxyDepositFactor: Balance = currency::VIT_EXISTENTIAL_DEPOSIT;
    pub const AnnouncementDepositBase: Balance = currency::VIT_EXISTENTIAL_DEPOSIT;
    pub const AnnouncementDepositFactor: Balance = currency::VIT_EXISTENTIAL_DEPOSIT;
}
impl pallet_proxy::Config for Runtime {
    type RuntimeEvent = RuntimeEvent;
    type RuntimeCall = RuntimeCall;
    type Currency = Balances;
    type ProxyType = ProxyType;
    type ProxyDepositBase = ProxyDepositBase;
    type ProxyDepositFactor = ProxyDepositFactor;
    type MaxProxies = ConstU32<32>;
    type WeightInfo = crate::weights::pallet_proxy::WeightInfo<Runtime>;
    type MaxPending = ConstU32<32>;
    type CallHasher = sp_runtime::traits::BlakeTwo256;
    type AnnouncementDepositBase = AnnouncementDepositBase;
    type AnnouncementDepositFactor = AnnouncementDepositFactor;
    type BlockNumberProvider = System;
}
impl pallet_multisig::Config for Runtime {
    type RuntimeEvent = RuntimeEvent;
    type RuntimeCall = RuntimeCall;
    type Currency = Balances;
    type DepositBase = ConstU128<{ currency::VIT_EXISTENTIAL_DEPOSIT }>;
    type DepositFactor = ConstU128<{ currency::VIT_EXISTENTIAL_DEPOSIT }>;
    type MaxSignatories = ConstU32<100>;
    type WeightInfo = crate::weights::pallet_multisig::WeightInfo<Runtime>;
    type BlockNumberProvider = System;
}

parameter_types! {
    pub MigrationMaxServiceWeight: Weight = Perbill::from_percent(bounds::MIGRATION_SERVICE_WEIGHT_PERCENT) * RuntimeBlockWeights::get().max_block;
}

// Runtime-internal PB-MIGRATION observability. These aliases deliberately do
// not join the 02-frozen pallet storage surface; every value is fixed-size and
// bounded. The cursor itself remains single-sourced in `pallet-migrations`.
pub struct MigrationHaltSourcesStorage;
impl StorageInstance for MigrationHaltSourcesStorage {
    fn pallet_prefix() -> &'static str {
        "BleavitRuntimeMigration"
    }
    const STORAGE_PREFIX: &'static str = "HaltSources";
}
pub type MigrationHaltSources = frame_support::storage::types::StorageValue<
    MigrationHaltSourcesStorage,
    u8,
    frame_support::pallet_prelude::ValueQuery,
>;

pub struct MigrationFailedStepStorage;
impl StorageInstance for MigrationFailedStepStorage {
    fn pallet_prefix() -> &'static str {
        "BleavitRuntimeMigration"
    }
    const STORAGE_PREFIX: &'static str = "FailedStep";
}
pub type MigrationFailedStep = frame_support::storage::types::StorageValue<
    MigrationFailedStepStorage,
    u32,
    frame_support::pallet_prelude::OptionQuery,
>;

pub struct RecoveryLockdownStorage;
impl StorageInstance for RecoveryLockdownStorage {
    fn pallet_prefix() -> &'static str {
        "BleavitRuntimeMigration"
    }
    const STORAGE_PREFIX: &'static str = "RecoveryLockdown";
}
pub type RecoveryLockdown = frame_support::storage::types::StorageValue<
    RecoveryLockdownStorage,
    bool,
    frame_support::pallet_prelude::ValueQuery,
>;

pub struct RecoveryBypassStorage;
impl StorageInstance for RecoveryBypassStorage {
    fn pallet_prefix() -> &'static str {
        "BleavitRuntimeMigration"
    }
    const STORAGE_PREFIX: &'static str = "RecoveryBypass";
}
pub type RecoveryBypass = frame_support::storage::types::StorageValue<
    RecoveryBypassStorage,
    bool,
    frame_support::pallet_prelude::ValueQuery,
>;

pub struct RetiredMigrationCursorStorage;
impl StorageInstance for RetiredMigrationCursorStorage {
    fn pallet_prefix() -> &'static str {
        "BleavitRuntimeMigration"
    }
    const STORAGE_PREFIX: &'static str = "RetiredCursor";
}
pub type RetiredMigrationCursor = frame_support::storage::types::StorageValue<
    RetiredMigrationCursorStorage,
    pallet_migrations::CursorOf<Runtime>,
    frame_support::pallet_prelude::OptionQuery,
>;

pub struct RecoveryScheduledHashStorage;
impl StorageInstance for RecoveryScheduledHashStorage {
    fn pallet_prefix() -> &'static str {
        "BleavitRuntimeMigration"
    }
    const STORAGE_PREFIX: &'static str = "RecoveryScheduledHash";
}
pub type RecoveryScheduledHash = frame_support::storage::types::StorageValue<
    RecoveryScheduledHashStorage,
    futarchy_primitives::H256,
    frame_support::pallet_prelude::OptionQuery,
>;

pub struct RecoveryAbortedStorage;
impl StorageInstance for RecoveryAbortedStorage {
    fn pallet_prefix() -> &'static str {
        "BleavitRuntimeMigration"
    }
    const STORAGE_PREFIX: &'static str = "RecoveryAborted";
}
pub type RecoveryAborted = frame_support::storage::types::StorageValue<
    RecoveryAbortedStorage,
    bool,
    frame_support::pallet_prelude::ValueQuery,
>;

pub struct RecoveryCodeAppliedStorage;
impl StorageInstance for RecoveryCodeAppliedStorage {
    fn pallet_prefix() -> &'static str {
        "BleavitRuntimeMigration"
    }
    const STORAGE_PREFIX: &'static str = "RecoveryCodeApplied";
}
pub type RecoveryCodeApplied = frame_support::storage::types::StorageValue<
    RecoveryCodeAppliedStorage,
    bool,
    frame_support::pallet_prelude::ValueQuery,
>;

#[cfg(feature = "recovery")]
pub struct RecoveryLedgerCursorStorage;
#[cfg(feature = "recovery")]
impl StorageInstance for RecoveryLedgerCursorStorage {
    fn pallet_prefix() -> &'static str {
        "BleavitRuntimeMigration"
    }
    const STORAGE_PREFIX: &'static str = "RecoveryLedgerCursor";
}
#[cfg(feature = "recovery")]
pub type RecoveryLedgerCursor = frame_support::storage::types::StorageValue<
    RecoveryLedgerCursorStorage,
    pallet_conditional_ledger::migration::BackfillCursor,
    frame_support::pallet_prelude::OptionQuery,
>;

#[cfg(feature = "recovery")]
pub struct RecoveryLedgerRepairActiveStorage;
#[cfg(feature = "recovery")]
impl StorageInstance for RecoveryLedgerRepairActiveStorage {
    fn pallet_prefix() -> &'static str {
        "BleavitRuntimeMigration"
    }
    const STORAGE_PREFIX: &'static str = "RecoveryLedgerRepairActive";
}
#[cfg(feature = "recovery")]
pub type RecoveryLedgerRepairActive = frame_support::storage::types::StorageValue<
    RecoveryLedgerRepairActiveStorage,
    bool,
    frame_support::pallet_prelude::ValueQuery,
>;

#[cfg(feature = "recovery")]
pub struct RecoveryLedgerRepairStepsStorage;
#[cfg(feature = "recovery")]
impl StorageInstance for RecoveryLedgerRepairStepsStorage {
    fn pallet_prefix() -> &'static str {
        "BleavitRuntimeMigration"
    }
    const STORAGE_PREFIX: &'static str = "RecoveryLedgerRepairSteps";
}
#[cfg(feature = "recovery")]
pub type RecoveryLedgerRepairSteps = frame_support::storage::types::StorageValue<
    RecoveryLedgerRepairStepsStorage,
    u32,
    frame_support::pallet_prelude::ValueQuery,
>;

#[cfg(feature = "recovery")]
pub struct RecoveryLedgerRepairFailedStorage;
#[cfg(feature = "recovery")]
impl StorageInstance for RecoveryLedgerRepairFailedStorage {
    fn pallet_prefix() -> &'static str {
        "BleavitRuntimeMigration"
    }
    const STORAGE_PREFIX: &'static str = "RecoveryLedgerRepairFailed";
}
#[cfg(feature = "recovery")]
pub type RecoveryLedgerRepairFailed = frame_support::storage::types::StorageValue<
    RecoveryLedgerRepairFailedStorage,
    bool,
    frame_support::pallet_prelude::ValueQuery,
>;

pub struct PhaseTransitionLockStorage;
impl StorageInstance for PhaseTransitionLockStorage {
    fn pallet_prefix() -> &'static str {
        "BleavitRuntimeMigration"
    }
    const STORAGE_PREFIX: &'static str = "PhaseTransitionLock";
}
pub type PhaseTransitionLock = frame_support::storage::types::StorageValue<
    PhaseTransitionLockStorage,
    bool,
    frame_support::pallet_prelude::ValueQuery,
>;

pub struct PhaseTransitionAppliedStorage;
impl StorageInstance for PhaseTransitionAppliedStorage {
    fn pallet_prefix() -> &'static str {
        "BleavitRuntimeMigration"
    }
    const STORAGE_PREFIX: &'static str = "PhaseTransitionApplied";
}
pub type PhaseTransitionApplied = frame_support::storage::types::StorageValue<
    PhaseTransitionAppliedStorage,
    bool,
    frame_support::pallet_prelude::ValueQuery,
>;

#[cfg(feature = "recovery")]
pub(crate) fn recovery_ledger_bookkeeping_weight() -> Weight {
    // Runtime-local recovery state is outside the pallet benchmark's storage
    // inventory. Charge its fixed reads/writes plus a conservative 16 KiB
    // proof envelope in addition to the generated ledger row/terminal weight.
    <Runtime as frame_system::Config>::DbWeight::get()
        .reads_writes(8, 8)
        .saturating_add(Weight::from_parts(0, 16 * 1024))
}

#[cfg(feature = "recovery")]
pub(crate) fn recovery_guard_finalization_weight() -> Weight {
    // This executable benchmark saturates the 32-entry Queue and measures the
    // exact guard recovery-application path, including full load/clear/reinsert,
    // pending-outflow sync, release-channel update and recovery-image unpin.
    // Precharge it on every step because discovering that the ledger cursor is
    // terminal requires the benchmarked storage read itself.
    <crate::weights::pallet_execution_guard::WeightInfo<Runtime> as
        pallet_execution_guard::WeightInfo>::finalize_recovery_application()
}

pub(crate) fn recovery_aware_migration_detector_weight() -> Weight {
    // `step` must first discriminate the runtime-local repair/failure/lock
    // branches before delegating to FRAME's migrator. Charge all three
    // ValueQuery reads on every branch, including the persistent fail-locked
    // branch, plus a fixed proof envelope for their runtime-local keys.
    <Runtime as frame_system::Config>::DbWeight::get()
        .reads(3)
        .saturating_add(Weight::from_parts(0, 8 * 1024))
}

#[cfg(feature = "recovery")]
fn step_ledger_recovery() -> Weight {
    use frame_support::{
        migrations::SteppedMigration,
        storage::with_storage_layer,
        traits::{GetStorageVersion, StorageVersion},
        weights::WeightMeter,
    };

    let mut meter = WeightMeter::with_limit(
        MigrationMaxServiceWeight::get().saturating_sub(recovery_aware_migration_detector_weight()),
    );
    // When the phase cause rode in with this segment, the terminal step also
    // performs the one-shot Phase-4 transition, so its envelope is reserved
    // too. Precharged on every step for the same reason as the guard
    // finalization above — discovering that the cursor is terminal requires
    // the read — but only in the combined lane, so an ordinary MBM recovery
    // keeps its full per-block row budget. The lock read itself is inside
    // `recovery_ledger_bookkeeping_weight`'s fixed runtime-local envelope.
    let overhead = recovery_ledger_bookkeeping_weight()
        .saturating_add(recovery_guard_finalization_weight())
        .saturating_add(if PhaseTransitionLock::get() {
            crate::migrations::phase_four_transition_weight()
        } else {
            Weight::zero()
        });
    let outcome = with_storage_layer(|| {
        meter
            .try_consume(overhead)
            .map_err(|_| DispatchError::Other("ledger recovery bookkeeping exceeds weight"))?;
        frame_support::ensure!(
            RecoveryLedgerRepairActive::get()
                && RecoveryLockdown::get()
                && RecoveryCodeApplied::get()
                && !RecoveryLedgerRepairFailed::get(),
            DispatchError::Other("ledger recovery state is not active")
        );
        let steps = RecoveryLedgerRepairSteps::get();
        frame_support::ensure!(
            steps < pallet_conditional_ledger::migration::MAX_BACKFILL_STEPS,
            DispatchError::Other("ledger recovery exceeded its release bound")
        );
        let cursor = RecoveryLedgerCursor::get();
        let next = <pallet_conditional_ledger::migration::BackfillTotalEscrowedV1<
            Runtime,
        > as SteppedMigration>::transactional_step(cursor, &mut meter)
        .map_err(|_| DispatchError::Other("ledger recovery step failed"))?;
        let next_steps = steps
            .checked_add(1)
            .ok_or(DispatchError::Other("ledger recovery step count overflow"))?;

        if let Some(cursor) = next {
            RecoveryLedgerCursor::put(cursor);
            RecoveryLedgerRepairSteps::put(next_steps);
            return Ok(());
        }

        frame_support::ensure!(
            ConditionalLedger::on_chain_storage_version() == StorageVersion::new(1)
                && pallet_conditional_ledger::TotalEscrowed::<Runtime>::exists(),
            DispatchError::Other("ledger recovery terminal state is incomplete")
        );
        let recovery = pallet_execution_guard::RecoveryImage::<Runtime>::get().ok_or(
            DispatchError::Other("ledger recovery commitment is missing"),
        )?;
        // Both causes clear together. `TerminalRecoveryTransition` defers the
        // phase transition to here whenever the segment was still owed its
        // repair, so that the chain never leaves `OnlyInherents` for Phase 4
        // on an unapplied ledger migration (09 §3.2's cutpoint-total rule).
        // Still one transition, still exactly once: this runs only on the
        // terminal step, and `complete_terminal_recovery_state` below clears
        // `PhaseTransitionLock` with the rest of the recovery state.
        if PhaseTransitionLock::get() {
            let plan = match pallet_execution_guard::PhaseFourBridge::<Runtime>::get() {
                pallet_execution_guard::PhaseFourBridgeState::Scheduled {
                    pid,
                    code_hash,
                    plan,
                } if pid == recovery.pid && code_hash == recovery.primary_hash => plan,
                _ => {
                    return Err(DispatchError::Other(
                        "ledger recovery phase commitment missing",
                    ))
                }
            };
            // SQ-383: the arming gate is deliberately NOT enforced on the
            // terminal recovery lane — see `transition_phase_four`.
            crate::migrations::transition_phase_four(plan, false)?;
        }
        let mut installed = pallet_execution_guard::CurrentSpecName::<Runtime>::get().ok_or(
            DispatchError::Other("ledger recovery current spec is missing"),
        )?;
        installed.spec_version = recovery.target_spec_version;
        crate::ExecutionGuard::recovery_code_applied(recovery.hash, installed)?;
        complete_terminal_recovery_state();
        Ok::<(), DispatchError>(())
    });

    if outcome.is_err() {
        RecoveryLedgerRepairFailed::put(true);
        note_phase_transition_failure();
    }
    meter.consumed()
}

/// Keeps FRAME in `OnlyInherents` after the stuck cursor is transactionally
/// retired for code scheduling and until relay GoAhead installs the recovery
/// image. `RecoveryBypass` is scoped to the internal frame-system call only;
/// it is never externally writable.
pub struct RecoveryAwareMigrations;
impl frame_support::migrations::MultiStepMigrator for RecoveryAwareMigrations {
    fn ongoing() -> bool {
        if RecoveryBypass::get() {
            return false;
        }
        RecoveryLockdown::get()
            || PhaseTransitionLock::get()
            || <Migrations as frame_support::migrations::MultiStepMigrator>::ongoing()
    }

    fn step() -> Weight {
        let detector = recovery_aware_migration_detector_weight();
        #[cfg(feature = "recovery")]
        if RecoveryLedgerRepairActive::get() {
            if RecoveryLedgerRepairFailed::get() {
                return detector;
            }
            return detector.saturating_add(step_ledger_recovery());
        }
        if RecoveryLockdown::get() || PhaseTransitionLock::get() {
            discard_unserviceable_cursor();
            detector
        } else {
            detector.saturating_add(
                <Migrations as frame_support::migrations::MultiStepMigrator>::step(),
            )
        }
    }
}

// The runtime stall-progress marker (`BleavitRuntimeMigration::ProgressMarker`)
// and its blake2 cursor hash were retired by B16 (SQ-132): the stall predicate
// now reads the SDK `cursor.started_at` directly (09 §3.2(d)(i)). The orphaned
// key is cleared by `crate::migrations::RetireB16State`.

/// Drop an SDK migration cursor that was auto-onboarded while this wrapper is
/// refusing to service the migrator.
///
/// `frame_executive` runs `on_runtime_upgrade` before `MultiStepMigrations`,
/// and `pallet_migrations::onboard_new_mbms` writes an `Active` cursor
/// **unconditionally** whenever the runtime registers any MBM — it does not
/// consult this wrapper. So a `PhaseFourTransition` that refuses (rolling its
/// own storage layer back, leaving `PhaseTransitionLock` set from the previous
/// block) came up with a cursor that nothing would ever advance:
///
///  * after `MIGRATION_STALL_BLOCKS` it raised `MIGRATION_STALL_HALT`, and
///  * `recovery_trigger`'s `PhaseTransition` arm requires `Cursor == None`, so
///    the phase cause became **structurally unreachable** and the terminal
///    recovery lane — the documented repair for exactly this refusal — could
///    not fire at all. `RecoveryLockdown` and `PhaseTransitionLock` then stayed
///    set forever and `frame_executive::extrinsic_mode()` returned
///    `OnlyInherents` permanently, with no dispatchable writer for either flag.
///
/// Only a cursor that has produced **no** progress is discarded: `index == 0`
/// with no inner cursor is exactly the shape `onboard_new_mbms` writes and
/// nothing else. A cursor that any step advanced is left alone, so a genuine
/// MBM cause is never silently dropped.
pub(crate) fn discard_unserviceable_cursor() {
    let fresh = matches!(
        pallet_migrations::Cursor::<Runtime>::get(),
        Some(pallet_migrations::MigrationCursor::Active(ref cursor))
            if cursor.index == 0 && cursor.inner_cursor.is_none()
    );
    if fresh {
        pallet_migrations::Cursor::<Runtime>::kill();
    }
}

const MIGRATION_FAILURE_HALT: u8 = 0b001;
pub(crate) const MIGRATION_STALL_HALT: u8 = 0b010;
const APPLIED_DETECTION_HALT: u8 = 0b100;
const UPGRADE_ABORT_TRIGGER: u8 = 0b1000;
const EXECUTION_HALT_SOURCES: u8 =
    MIGRATION_FAILURE_HALT | MIGRATION_STALL_HALT | APPLIED_DETECTION_HALT;

fn sync_execution_migration_halt(sources: u8) {
    pallet_execution_guard::MigrationHalt::<Runtime>::put(sources & EXECUTION_HALT_SOURCES != 0);
}

fn set_migration_halt_source(source: u8) {
    let (previous, sources) = MigrationHaltSources::mutate(|sources| {
        let previous = *sources;
        *sources |= source;
        (previous, *sources)
    });
    sync_execution_migration_halt(sources);
    // 09 §3.2(4): emit the `MigrationHalted` diagnostic on the *first* activation
    // of the halt — the transition from no execution-halt source to one —
    // carrying the SDK cursor's exact bytes and reported failed step. The event
    // is off the frozen 02 §6 ingest set by that section's (a)-(c) rule (an
    // operator/monitoring diagnostic, 12 §6.3), so it carries no contract bump.
    if previous & EXECUTION_HALT_SOURCES == 0 && sources & EXECUTION_HALT_SOURCES != 0 {
        emit_migration_halted();
        // 05 §4.3.2 `Π`, `IntegrityFault::FailStaticLatch` — "a fail-static
        // latch engaged out of a detected inconsistency". All three clauses
        // hold: the runtime holds unconditionally that the code it runs is the
        // code its guard scheduled and that a registered migration completes
        // within its declared budget; engaging the halt freezes the execution
        // queue; and nothing restores the boundary that was violated — the halt
        // lifts only when a *later, different* upgrade applies validly, which
        // is a new fact, not a repair of the lost one.
        //
        // **The activation edge is the increment, not every write.** A second
        // source setting while the halt is already engaged is the same latch
        // being re-described, and §4.3.2 counts an event once. It is also the
        // edge that already gates `emit_migration_halted`, so the counter and
        // the operator diagnostic can never disagree about how many latches
        // engaged.
        //
        // `EXECUTION_HALT_SOURCES` is what makes this correct rather than
        // merely convenient: `UPGRADE_ABORT_TRIGGER` is deliberately **not** a
        // member, so the relay-aborted-upgrade path — where the relay preserved
        // the status quo, nothing was discarded, and a fresh proposal is the
        // defined path forward — falls out of the qualifying class by
        // construction rather than by a hand-maintained exception.
        <RuntimeIntegrityRecorder as futarchy_primitives::integrity::IntegritySink>::
            note_integrity_failure(futarchy_primitives::integrity::IntegrityFault::FailStaticLatch);
    }
}

#[cfg(any(feature = "phase-four", feature = "recovery"))]
pub(crate) fn note_phase_transition_failure() {
    set_migration_halt_source(APPLIED_DETECTION_HALT);
}

#[cfg(feature = "recovery")]
pub(crate) fn complete_terminal_recovery_state() {
    RecoveryScheduledHash::kill();
    RetiredMigrationCursor::kill();
    RecoveryLedgerCursor::kill();
    RecoveryLedgerRepairActive::kill();
    RecoveryLedgerRepairSteps::kill();
    RecoveryLedgerRepairFailed::kill();
    RecoveryLockdown::kill();
    RecoveryAborted::kill();
    RecoveryCodeApplied::kill();
    PhaseTransitionLock::kill();
    PhaseTransitionApplied::kill();
    MigrationFailedStep::kill();
    clear_migration_halt_sources(
        MIGRATION_FAILURE_HALT
            | MIGRATION_STALL_HALT
            | APPLIED_DETECTION_HALT
            | UPGRADE_ABORT_TRIGGER,
    );
}

fn emit_migration_halted() {
    let cursor_bytes = pallet_migrations::Cursor::<Runtime>::get()
        .map(|cursor| cursor.encode())
        .unwrap_or_default();
    // The B16 type-bound regression proves the SDK cursor's MaxEncodedLen fits
    // this derived envelope, so `truncate_from` cannot truncate a real cursor.
    // A source-less halt yields empty bytes.
    let cursor = pallet_execution_guard::pallet::MigrationHaltCursor::truncate_from(cursor_bytes);
    crate::ExecutionGuard::note_migration_halted(cursor, MigrationFailedStep::get());
}

/// Raise the relay-aborted-upgrade trigger, which is deliberately **not** an
/// execution-halt source and therefore never a 05 §4.3.2 `Π` event.
#[cfg(test)]
pub(crate) fn note_upgrade_abort_trigger_for_test() {
    set_migration_halt_source(UPGRADE_ABORT_TRIGGER);
}

/// Engage the fail-static execution halt, which is one.
#[cfg(test)]
pub(crate) fn note_migration_stall_halt_for_test() {
    set_migration_halt_source(MIGRATION_STALL_HALT);
}

fn clear_migration_halt_sources(mask: u8) {
    let remaining = MigrationHaltSources::mutate(|sources| {
        *sources &= !mask;
        *sources
    });
    sync_execution_migration_halt(remaining);
}

pub(crate) fn active_migration_stall_is_live(
    cursor: &pallet_migrations::ActiveCursorOf<Runtime>,
) -> bool {
    // 09 §3.2(d): a migration is stalled iff its own start block is more than
    // MIGRATION_STALL_BLOCKS in the past — read from the SDK's own `started_at`
    // (SQ-132(d)(i)), never a runtime-maintained progress marker. It is a pure
    // function of state `pallet-migrations` already keeps, so a lawful migration
    // that drains a map while returning byte-identical cursors never false-raises.
    System::block_number().saturating_sub(cursor.started_at) > kernel::MIGRATION_STALL_BLOCKS
}

fn track_migration_progress() {
    match pallet_migrations::Cursor::<Runtime>::get() {
        Some(pallet_migrations::MigrationCursor::Active(cursor)) => {
            // Backstop only. Every registered MBM declares
            // `max_steps < MIGRATION_STALL_BLOCKS`, and their sum is likewise
            // bounded (integrity test, 09 §3.2(d)(ii)/(iii)), so the SDK's own
            // budget fires arm 1 (*failed migration step*) strictly before this
            // stall block is reached. This arm can fire only if that build-time
            // enforcement is bypassed.
            if active_migration_stall_is_live(&cursor) {
                set_migration_halt_source(MIGRATION_STALL_HALT);
            }
        }
        Some(pallet_migrations::MigrationCursor::Stuck) => {
            // The failure callback normally records this first. Seeing an
            // externally restored stuck cursor is still a machine trigger.
            set_migration_halt_source(MIGRATION_FAILURE_HALT);
        }
        None => {}
    }
}

pub(crate) fn migration_validation_hook_weight() -> Weight {
    // `remark_with_event` is the stable2606 benchmarked linear hash-of-bytes
    // path. Charge it at CursorMaxLen plus the hook's bounded worst-case
    // storage/proof work; this remains conservative until B5 benchmarking.
    <<Runtime as frame_system::Config>::SystemWeightInfo as frame_system::WeightInfo>::remark_with_event(
        bounds::MIGRATION_CURSOR_MAX_LEN,
    )
    .saturating_add(
        <Runtime as frame_system::Config>::DbWeight::get().reads_writes(8, 5),
    )
    .saturating_add(Weight::from_parts(
        0,
        u64::from(bounds::MIGRATION_CURSOR_MAX_LEN),
    ))
}

pub(crate) fn dead_man_detector_hook_weight() -> Weight {
    // Worst case includes the one-time bounded MetricSpecs scan that seeds the
    // first schedule-derived deadline, plus the fixed relay/cause/flag writes.
    Weight::from_parts(50_000_000, 60_000)
        .saturating_add(<Runtime as frame_system::Config>::DbWeight::get().reads_writes(24, 6))
}

/// The 05 §4.3.2 observation work `pallet_welfare::note_block_production`'s own
/// benchmark does not cover: attributing the block to its `(epoch, day)` window.
///
/// `epoch_and_day_at` reads the live epoch and its schedule, plus the retained
/// timing ring for a block that predates the live epoch's start — charged at
/// that three-read worst case. It runs **once per block**, in the parachain
/// inherent, which reserves no weight for a caller and so charges it itself; the
/// post-transaction hook consumes the published window instead of repeating the
/// attribution (see [`BlockProductionWindow`]).
pub(crate) fn block_production_window_weight() -> Weight {
    <Runtime as frame_system::Config>::DbWeight::get().reads(3)
}

/// PB-MIGRATION signal bridge. A failed step stays stuck (the SDK's
/// fail-closed transaction pause) and makes the guard's machine trigger live.
pub struct MigrationFailureToGuard;
impl frame_support::migrations::FailedMigrationHandler for MigrationFailureToGuard {
    fn failed(failed_step: Option<u32>) -> frame_support::migrations::FailedMigrationHandling {
        match failed_step {
            Some(index) => MigrationFailedStep::put(index),
            None => MigrationFailedStep::kill(),
        }
        set_migration_halt_source(MIGRATION_FAILURE_HALT);
        frame_support::migrations::FailedMigrationHandling::KeepStuck
    }
}

/// A genuinely completed retry is the only SDK status transition that clears
/// the PB-MIGRATION trigger. Starting a migration never clears an earlier halt.
pub struct MigrationStatusToGuard;
impl frame_support::migrations::MigrationStatusHandler for MigrationStatusToGuard {
    fn started() {
        MigrationFailedStep::kill();
        track_migration_progress();
    }

    fn completed() {
        MigrationFailedStep::kill();
        // MBM completion clears only migration failure/stall sources. An
        // applied-code mismatch remains halted until a later valid applied
        // callback resolves that condition. The additional try-state-before-
        // lift coupling is intentionally still an open specification question.
        //
        // **This clear MUST precede `migration_completed` (audit 2026-07-27,
        // AUD-1).** `migration_completed` raises the guard's own fail-static
        // latch — a committed recovery image the completed migration could not
        // release — by writing `MigrationHalt` directly. `MigrationHalt` is
        // otherwise derived from `MigrationHaltSources` by
        // `sync_execution_migration_halt`, so running the clear *after* the
        // callback wrote the halt straight back to `false` in this very call,
        // and nothing re-raises it: the cursor is gone and
        // `PendingAnchorCapture` has already been consumed, so the guard's
        // per-block retry no longer runs. The latch was a no-op on the one path
        // it exists for. Ordering the clear first is the whole repair; it adds
        // no storage read or write, so no benchmarked weight moves.
        clear_migration_halt_sources(MIGRATION_FAILURE_HALT | MIGRATION_STALL_HALT);
        crate::ExecutionGuard::migration_completed();
    }
}

/// One-read projection of the SDK-owned multi-block-migration cursor for the
/// application-time PB-MIGRATION anchor (09 section 3.2(2)).
pub struct RuntimeMigrationStatus;
impl pallet_execution_guard::MigrationStatusProvider for RuntimeMigrationStatus {
    fn cursor_exists() -> bool {
        pallet_migrations::Cursor::<Runtime>::exists()
    }

    fn recovery_state() -> pallet_execution_guard::MigrationRecoveryState {
        pallet_execution_guard::MigrationRecoveryState {
            lockdown: RecoveryLockdown::get(),
            bypass: RecoveryBypass::get(),
            retired_cursor: RetiredMigrationCursor::exists(),
            scheduled_hash: RecoveryScheduledHash::get(),
            aborted: RecoveryAborted::get(),
            recovery_code_applied: RecoveryCodeApplied::get(),
            phase_transition_lock: PhaseTransitionLock::get(),
            phase_transition_applied: PhaseTransitionApplied::get(),
        }
    }
}

impl pallet_migrations::Config for Runtime {
    type RuntimeEvent = RuntimeEvent;
    #[cfg(all(not(feature = "runtime-benchmarks"), not(feature = "recovery")))]
    type Migrations = (pallet_conditional_ledger::migration::BackfillTotalEscrowedV1<Runtime>,);
    #[cfg(all(not(feature = "runtime-benchmarks"), feature = "recovery"))]
    type Migrations = ();
    #[cfg(feature = "runtime-benchmarks")]
    type Migrations = pallet_migrations::mock_helpers::MockedMigrations;
    type CursorMaxLen = ConstU32<{ bounds::MIGRATION_CURSOR_MAX_LEN }>;
    type IdentifierMaxLen = ConstU32<{ bounds::MIGRATION_IDENTIFIER_MAX_LEN }>;
    type MigrationStatusHandler = MigrationStatusToGuard;
    type FailedMigrationHandler = MigrationFailureToGuard;
    type MaxServiceWeight = MigrationMaxServiceWeight;
    type WeightInfo = crate::weights::pallet_migrations::WeightInfo<Runtime>;
}

#[cfg(feature = "bootstrap")]
impl pallet_sudo::Config for Runtime {
    type RuntimeEvent = RuntimeEvent;
    type RuntimeCall = RuntimeCall;
    type WeightInfo = crate::weights::pallet_sudo::WeightInfo<Runtime>;
}

parameter_types! {
    pub const ReservedXcmpWeight: Weight = MAXIMUM_BLOCK_WEIGHT.saturating_div(4);
    pub const ReservedDmpWeight: Weight = MAXIMUM_BLOCK_WEIGHT.saturating_div(4);
    pub const RelayOrigin: cumulus_primitives_core::AggregateMessageOrigin = cumulus_primitives_core::AggregateMessageOrigin::Parent;
}
impl cumulus_pallet_parachain_system::Config for Runtime {
    type WeightInfo = crate::weights::cumulus_pallet_parachain_system::WeightInfo<Runtime>;
    type RuntimeEvent = RuntimeEvent;
    type OnSystemEvent = ExecutionGuardSystemEvent;
    type SelfParaId = staging_parachain_info::Pallet<Runtime>;
    type OutboundXcmpMessageSource = XcmpQueue;
    type DmpQueue = frame_support::traits::EnqueueWithOrigin<MessageQueue, RelayOrigin>;
    type ReservedDmpWeight = ReservedDmpWeight;
    type XcmpMessageHandler = XcmpQueue;
    type ReservedXcmpWeight = ReservedXcmpWeight;
    type CheckAssociatedRelayNumber =
        cumulus_pallet_parachain_system::RelayNumberMonotonicallyIncreases;
    type ConsensusHook = ConsensusHook;
    type RelayParentOffset = ConstU32<0>;
    type SchedulingSignatureVerifier = ();
}
impl staging_parachain_info::Config for Runtime {}

pub(crate) mod xcm_config {
    use super::*;
    use staging_xcm::latest::prelude::*;
    use staging_xcm_builder::{FixedWeightBounds, FrameTransactionalProcessor, WithUniqueTopic};
    use staging_xcm_executor::XcmExecutor;

    parameter_types! {
        pub RelayNetwork: Option<NetworkId> = Some(NetworkId::Polkadot);
        pub UniversalLocation: InteriorLocation = [
            GlobalConsensus(NetworkId::Polkadot),
            Parachain(staging_parachain_info::Pallet::<Runtime>::parachain_id().into()),
        ].into();
        pub UnitWeightCost: Weight = Weight::from_parts(1_000_000_000, 64 * 1024);
        pub const MaxInstructions: u32 = 100;
        pub const MaxAssetsIntoHolding: u32 = 64;
        pub const MaxPrefixes: u32 = 8;
        pub CheckingAccount: AccountId = PolkadotXcm::check_account();
    }
    pub type LocationToAccountId =
        bleavit_xcm::assets::StandardLocationToAccountId<AccountId, RelayNetwork>;
    pub type AssetTransactors = bleavit_xcm::assets::AssetTransactors<
        ForeignAssets,
        LocationToAccountId,
        AccountId,
        CheckingAccount,
    >;
    pub type CappedAssets = bleavit_xcm::caps::CappedInflows<
        AssetTransactors,
        PhaseInflowCaps,
        LocationToAccountId,
        AccountId,
    >;
    pub type TrapRecoveryAssets = bleavit_xcm::caps::TrapRecoveryInflows<
        AssetTransactors,
        PhaseInflowCaps,
        LocationToAccountId,
        AccountId,
    >;
    pub type ResponseHandler =
        bleavit_xcm::probe::ProbeAwareResponseHandler<PolkadotXcm, super::RuntimeOracleProbeSink>;
    pub type Barrier = bleavit_xcm::barrier::BleavitBarrier<
        ResponseHandler,
        UniversalLocation,
        MaxPrefixes,
        PhaseInflowCaps,
        LocationToAccountId,
        AccountId,
    >;
    pub type OriginConverter = bleavit_xcm::client::RegisteredClientOriginConverter<Runtime>;
    pub type SafeCallFilter = bleavit_xcm::client::ExternalClientSafeCallFilter<
        crate::classifier::BleavitSafetyClassifier,
    >;
    pub type RelayRouter = cumulus_primitives_utility::ParentAsUmp<
        ParachainSystem,
        PolkadotXcm,
        polkadot_runtime_common::xcm_sender::NoPriceForMessageDelivery<()>,
    >;
    /// Parent traffic routes by UMP; sibling traffic (including the reserve
    /// probe to Asset Hub) routes by XCMP. The previous Parent-only sender made
    /// every sibling probe fail local validation (SQ-380).
    pub type NetworkRouter = (RelayRouter, XcmpQueue);
    pub type TopicRouter = WithUniqueTopic<NetworkRouter>;
    /// I-36 review point: hosted-report egress is the bare topic router. It is
    /// intentionally not the welfare-observing `Router` alias below.
    pub type ClientEgressRouter = TopicRouter;
    pub type Router = bleavit_xcm::health::HealthTrackingRouter<TopicRouter, XcmTrafficRecorder>;
    pub type BaseWeigher = FixedWeightBounds<UnitWeightCost, RuntimeCall, MaxInstructions>;
    pub type Weigher =
        bleavit_xcm::probe::ProbeAwareWeightBounds<BaseWeigher, super::RuntimeProbeCallbackWeight>;

    /// Maps the Treasury-class execution origin to the protocol custody
    /// location under which protocol-owned local traps are keyed (09 §6.1).
    pub struct TreasuryOriginToLocation;
    impl sp_runtime::traits::TryConvert<RuntimeOrigin, Location> for TreasuryOriginToLocation {
        fn try_convert(origin: RuntimeOrigin) -> Result<Location, RuntimeOrigin> {
            let custom: Result<pallet_origins::Origin, RuntimeOrigin> = origin.clone().into();
            match custom {
                Ok(pallet_origins::Origin::FutarchyTreasury) => Ok(Location::new(
                    0,
                    [Junction::AccountId32 {
                        network: RelayNetwork::get(),
                        id: treasury_protocol_account().into(),
                    }],
                )),
                _ => Err(origin),
            }
        }
    }

    pub type LocalOriginToLocation = (
        TreasuryOriginToLocation,
        staging_xcm_builder::SignedToAccountId32<RuntimeOrigin, AccountId, RelayNetwork>,
    );

    pub struct XcmConfig<Assets = CappedAssets, BarrierType = Barrier>(
        core::marker::PhantomData<(Assets, BarrierType)>,
    );
    impl<
            Assets: staging_xcm_executor::traits::TransactAsset,
            BarrierType: staging_xcm_executor::traits::ShouldExecute,
        > staging_xcm_executor::Config for XcmConfig<Assets, BarrierType>
    {
        type RuntimeCall = RuntimeCall;
        // The Coretime route's local reserve withdrawal targets Parent, so the
        // production sender is the canonical parachain→relay UMP adapter.
        type XcmSender = Router;
        type XcmEventEmitter = PolkadotXcm;
        type AssetTransactor = Assets;
        type OriginConverter = OriginConverter;
        type IsReserve = bleavit_xcm::assets::BleavitReserves;
        type IsTeleporter = ();
        type UniversalLocation = UniversalLocation;
        type Barrier = BarrierType;
        type Weigher = Weigher;
        // SQ-540(e): unrefunded fees are treasury revenue, not litter. Before
        // this they were dropped — the chain priced every inbound message at the
        // governed 09 §6.1 rates, charged it, and threw the payment away. The
        // sink deposits through *this config's own* transactor, so the capped
        // production path and the recovery path each route through the one they
        // already use, and recognizes only the USDC portion as NAV (08 §1.2
        // marks DOT at 0). A failed deposit degrades to the previous discarding
        // behaviour rather than to an unbacked claim.
        type Trader = bleavit_xcm::trader::GovernedWeightTrader<
            ConstitutionTraderRates,
            bleavit_xcm::trader::FeesToTreasury<
                Assets,
                super::TreasuryMainLocation,
                super::TreasuryXcmFeeCredit,
            >,
        >;
        type ResponseHandler = ResponseHandler;
        type AssetTrap = PolkadotXcm;
        type SubscriptionService = PolkadotXcm;
        type PalletInstancesInfo = crate::AllPalletsWithSystem;
        type MaxAssetsIntoHolding = MaxAssetsIntoHolding;
        type AssetLocker = ();
        type AssetExchanger = ();
        type FeeManager = ();
        type MessageExporter = ();
        type UniversalAliases = Nothing;
        type CallDispatcher = crate::resource_partition::ResourcePartitionCallDispatcher;
        type SafeCallFilter = SafeCallFilter;
        type Aliasers = Nothing;
        type TransactionalProcessor = FrameTransactionalProcessor;
        type HrmpNewChannelOpenRequestHandler = ();
        type HrmpChannelAcceptedHandler = ();
        type HrmpChannelClosingHandler = ();
        type XcmRecorder = PolkadotXcm;
    }
    /// Executor used by inbound DMP/XCMP transport: every reserve mint and
    /// beneficiary deposit passes through the live Phase-3 cap adapter.
    pub type Executor = XcmExecutor<XcmConfig<CappedAssets>>;
    /// `pallet-xcm` reconstructs an existing trapped imbalance by calling its
    /// configured executor's `mint_asset`, then immediately balances the clone
    /// so issuance is unchanged. The recovery transactor bypasses only that
    /// prospective global check; its beneficiary deposit remains capped and
    /// records the per-account cumulative meter.
    #[allow(dead_code)]
    pub type TrapRecoveryExecutor = XcmExecutor<XcmConfig<TrapRecoveryAssets>>;
    #[cfg(feature = "runtime-benchmarks")]
    pub type BenchmarkExecutor = XcmExecutor<
        XcmConfig<TrapRecoveryAssets, staging_xcm_builder::AllowUnpaidExecutionFrom<Everything>>,
    >;
}

parameter_types! {
    pub MessageQueueServiceWeight: Weight = Perbill::from_percent(35) * RuntimeBlockWeights::get().max_block;
}
impl pallet_message_queue::Config for Runtime {
    type RuntimeEvent = RuntimeEvent;
    type WeightInfo = crate::weights::pallet_message_queue::WeightInfo<Runtime>;
    #[cfg(feature = "runtime-benchmarks")]
    type MessageProcessor = pallet_message_queue::mock_helpers::NoopMessageProcessor<
        cumulus_primitives_core::AggregateMessageOrigin,
    >;
    #[cfg(not(feature = "runtime-benchmarks"))]
    type MessageProcessor = staging_xcm_builder::ProcessXcmMessage<
        cumulus_primitives_core::AggregateMessageOrigin,
        xcm_config::Executor,
        RuntimeCall,
    >;
    type Size = u32;
    type QueueChangeHandler = parachains_common::message_queue::NarrowOriginToSibling<XcmpQueue>;
    type QueuePausedQuery = parachains_common::message_queue::NarrowOriginToSibling<XcmpQueue>;
    type HeapSize = sp_core::ConstU32<{ 103 * 1024 }>;
    type MaxStale = sp_core::ConstU32<8>;
    type ServiceWeight = MessageQueueServiceWeight;
    type IdleMaxServiceWeight = ();
}

pub struct ControllerOriginConverter;
impl staging_xcm_executor::traits::ConvertOrigin<RuntimeOrigin> for ControllerOriginConverter {
    fn convert_origin(
        origin: impl Into<staging_xcm::latest::Location>,
        _: staging_xcm::latest::OriginKind,
    ) -> Result<RuntimeOrigin, staging_xcm::latest::Location> {
        Err(origin.into())
    }
}
impl cumulus_pallet_xcmp_queue::Config for Runtime {
    type RuntimeEvent = RuntimeEvent;
    type ChannelInfo = ParachainSystem;
    type VersionWrapper = ();
    type XcmpQueue = TransformOrigin<
        MessageQueue,
        cumulus_primitives_core::AggregateMessageOrigin,
        cumulus_primitives_core::ParaId,
        parachains_common::message_queue::ParaIdToSibling,
    >;
    type MaxInboundSuspended = ConstU32<1_000>;
    type MaxActiveOutboundChannels = ConstU32<128>;
    type MaxPageSize = ConstU32<{ 1 << 16 }>;
    type ControllerOrigin = EnsureRoot<AccountId>;
    type ControllerOriginConverter = ControllerOriginConverter;
    type WeightInfo = crate::weights::cumulus_pallet_xcmp_queue::WeightInfo<Runtime>;
    type PriceForSiblingDelivery = polkadot_runtime_common::xcm_sender::NoPriceForMessageDelivery<
        cumulus_primitives_core::ParaId,
    >;
}

impl pallet_xcm::Config for Runtime {
    type RuntimeEvent = RuntimeEvent;
    type SendXcmOrigin = staging_xcm_builder::EnsureXcmOrigin<RuntimeOrigin, ()>;
    #[cfg(feature = "runtime-benchmarks")]
    type XcmRouter = xcm_config::Router;
    #[cfg(not(feature = "runtime-benchmarks"))]
    type XcmRouter = xcm_config::Router;
    type ExecuteXcmOrigin =
        staging_xcm_builder::EnsureXcmOrigin<RuntimeOrigin, xcm_config::LocalOriginToLocation>;
    type XcmExecuteFilter = Nothing;
    #[cfg(feature = "runtime-benchmarks")]
    type XcmExecutor = xcm_config::BenchmarkExecutor;
    #[cfg(not(feature = "runtime-benchmarks"))]
    type XcmExecutor = xcm_config::TrapRecoveryExecutor;
    type XcmTeleportFilter = Nothing;
    type XcmReserveTransferFilter = bleavit_xcm::filter::ReserveTransferFilter;
    type Weigher = xcm_config::Weigher;
    type UniversalLocation = xcm_config::UniversalLocation;
    type RuntimeOrigin = RuntimeOrigin;
    type RuntimeCall = RuntimeCall;
    const VERSION_DISCOVERY_QUEUE_SIZE: u32 = 100;
    type AdvertisedXcmVersion = pallet_xcm::CurrentXcmVersion;
    type Currency = Balances;
    type CurrencyMatcher = ();
    type TrustedLockers = ();
    type SovereignAccountOf = xcm_config::LocationToAccountId;
    type MaxLockers = ConstU32<0>;
    type WeightInfo = crate::weights::pallet_xcm::WeightInfo<Runtime>;
    type AdminOrigin = EnsureRoot<AccountId>;
    type MaxRemoteLockConsumers = ConstU32<0>;
    type RemoteLockConsumerIdentifier = ();
    type AuthorizedAliasConsideration = ();
}

#[cfg(feature = "runtime-benchmarks")]
pub struct XcmBenchmarkDelivery;

#[cfg(feature = "runtime-benchmarks")]
impl staging_xcm_builder::EnsureDelivery for XcmBenchmarkDelivery {
    fn ensure_successful_delivery(
        _origin_ref: &staging_xcm::latest::Location,
        dest: &staging_xcm::latest::Location,
        _fee_reason: staging_xcm_executor::traits::FeeReason,
    ) -> (
        Option<staging_xcm_executor::FeesMode>,
        Option<staging_xcm::latest::Assets>,
    ) {
        // Benchmark the production delivery leg. The sibling route must have
        // real HRMP/XCMP state, and the relay-side host configuration is also
        // primed for the production UMP alternative in this same externality.
        ParachainSystem::open_outbound_hrmp_channel_for_benchmarks_or_tests(
            cumulus_primitives_core::ParaId::from(chain_identity::ASSET_HUB_PARA_ID),
        );
        <xcm_config::Router as staging_xcm::latest::SendXcm>::ensure_successful_delivery(Some(
            staging_xcm::latest::Location::parent(),
        ));
        <xcm_config::Router as staging_xcm::latest::SendXcm>::ensure_successful_delivery(Some(
            dest.clone(),
        ));

        let caller = frame_benchmarking::whitelisted_caller::<AccountId>();
        let _ = <Balances as Currency<AccountId>>::make_free_balance_be(
            &caller,
            Balances::minimum_balance().saturating_mul(1_000),
        );
        (None, None)
    }
}

#[cfg(feature = "runtime-benchmarks")]
impl pallet_xcm::benchmarking::Config for Runtime {
    type DeliveryHelper = XcmBenchmarkDelivery;

    fn reachable_dest() -> Option<staging_xcm::latest::Location> {
        ParachainSystem::open_outbound_hrmp_channel_for_benchmarks_or_tests(
            cumulus_primitives_core::ParaId::from(chain_identity::ASSET_HUB_PARA_ID),
        );
        <xcm_config::Router as staging_xcm::latest::SendXcm>::ensure_successful_delivery(Some(
            staging_xcm::latest::Location::parent(),
        ));
        Some(bleavit_xcm::identity::asset_hub_location())
    }

    fn reserve_transferable_asset_and_dest(
    ) -> Option<(staging_xcm::latest::Asset, staging_xcm::latest::Location)> {
        // `pallet-xcm`'s upstream fixture deposits the benchmark asset into
        // `whitelisted_caller()`.  The production genesis deliberately
        // endows only protocol custody accounts, so seed that disposable
        // benchmark account here rather than weakening the live transactor.
        Some((
            Self::get_asset(),
            bleavit_xcm::identity::asset_hub_location(),
        ))
    }

    fn get_asset() -> staging_xcm::latest::Asset {
        benchmark_prime_xcm_asset_state();
        staging_xcm::latest::Asset {
            id: staging_xcm::latest::AssetId(bleavit_xcm::identity::usdc_location()),
            fun: staging_xcm::latest::Fungibility::Fungible(20 * currency::USDC),
        }
    }

    fn set_up_complex_asset_transfer() -> Option<(
        staging_xcm::latest::Assets,
        u32,
        staging_xcm::latest::Location,
        alloc::boxed::Box<dyn FnOnce()>,
    )> {
        Some((
            Self::get_asset().into(),
            0,
            bleavit_xcm::identity::asset_hub_location(),
            alloc::boxed::Box::new(|| {}),
        ))
    }
}

#[cfg(feature = "runtime-benchmarks")]
fn benchmark_prime_xcm_asset_state() {
    use frame_support::traits::tokens::fungibles::Mutate;
    use staging_xcm_executor::traits::ConvertLocation;

    let caller = frame_benchmarking::whitelisted_caller::<AccountId>();
    let amount = 20 * currency::USDC;
    benchmark_ensure_usdc();

    // The production executor withdraws from and deposits into real
    // `ForeignAssets` accounts. Keep the benchmark account funded and present
    // so those account mutations are part of the measured XCM path.
    let mut accounts = vec![caller];
    if let Some(asset_hub_account) = xcm_config::LocationToAccountId::convert_location(
        &bleavit_xcm::identity::asset_hub_location(),
    ) {
        accounts.push(asset_hub_account);
    }
    for account in accounts {
        let balance = <ForeignAssets as Inspect<AccountId>>::balance(
            bleavit_xcm::identity::usdc_location(),
            &account,
        );
        if balance < amount {
            let _ = <ForeignAssets as Mutate<AccountId>>::mint_into(
                bleavit_xcm::identity::usdc_location(),
                &account,
                amount - balance,
            );
        }
    }

    // `TrapRecoveryInflows` deliberately bypasses only the prospective global
    // mint check; its beneficiary deposit still records the cumulative
    // per-account inflow. Seed an existing entry just below the live cap so
    // the benchmark observes the production meter read/update/write path.
    let cap = balance_param(b"phase3.dep_cap");
    if cap != u128::MAX {
        pallet_inflow_caps::CumulativeDeposits::<Runtime>::insert(
            frame_benchmarking::whitelisted_caller::<AccountId>(),
            cap.saturating_sub(amount),
        );
    }
}

impl cumulus_pallet_xcm::Config for Runtime {
    type RuntimeEvent = RuntimeEvent;
    type XcmExecutor = xcm_config::Executor;
}

impl cumulus_pallet_aura_ext::Config for Runtime {}

pub struct RuntimeCollatorAuthorship;
impl pallet_authorship::EventHandler<AccountId, BlockNumber> for RuntimeCollatorAuthorship {
    fn note_author(author: AccountId) {
        // 08 §2.4: the authored-share accumulator that pays the author.
        FutarchyTreasury::note_collator_block(author.clone());
        // 05 §4.3: the `(epoch, day)` authorship series behind `K` (and, once
        // wired, `U` and `D_eff`). Deliberately the *same* derivation the
        // reserve-probe and XCM-health recorders use, so a block authored
        // across an epoch boundary is attributed to one day by one rule.
        //
        // Kept separate from the treasury accumulator on purpose: that one is a
        // payout ledger that is drained and reset every epoch, while this is a
        // measurement window welfare reads back per day. Deriving one from the
        // other would make a payout retire a measurement.
        let (epoch, day) = xcm_traffic_epoch_and_day();
        pallet_welfare::Pallet::<Runtime>::note_collator_authorship(epoch, day, author);
    }
}

impl pallet_authorship::Config for Runtime {
    type FindAuthor = pallet_session::FindAccountFromAuthorIndex<Self, Aura>;
    type EventHandler = (CollatorSelection, RuntimeCollatorAuthorship);
}
parameter_types! {
    pub const Period: u32 = 6 * (60 * 60 * 1_000 / kernel::MILLISECS_PER_BLOCK as u32);
    pub const Offset: u32 = 0;
    pub const PotId: PalletId = PalletId(*b"PotStake");
}
impl pallet_session::Config for Runtime {
    type RuntimeEvent = RuntimeEvent;
    type ValidatorId = AccountId;
    type ValidatorIdOf = pallet_collator_selection::IdentityCollator;
    type ShouldEndSession = pallet_session::PeriodicSessions<Period, Offset>;
    type NextSessionRotation = pallet_session::PeriodicSessions<Period, Offset>;
    type SessionManager = CollatorSelection;
    type SessionHandler = <SessionKeys as sp_runtime::traits::OpaqueKeys>::KeyTypeIdProviders;
    type Keys = SessionKeys;
    type DisablingStrategy = ();
    type WeightInfo = crate::weights::pallet_session::WeightInfo<Runtime>;
    type Currency = Balances;
    type KeyDeposit = ();
}
impl pallet_aura::Config for Runtime {
    type AuthorityId = AuraId;
    type DisabledValidators = ();
    type MaxAuthorities = ConstU32<100_000>;
    type AllowMultipleBlocksPerSlot = ConstBool<true>;
    type SlotDuration = ConstU64<{ kernel::MILLISECS_PER_BLOCK }>;
}
impl pallet_collator_selection::Config for Runtime {
    type RuntimeEvent = RuntimeEvent;
    type Currency = Balances;
    type UpdateOrigin = EnsureRoot<AccountId>;
    type PotId = PotId;
    type MaxCandidates = ConstU32<100>;
    type MinEligibleCollators = ConstU32<1>;
    type MaxInvulnerables = ConstU32<20>;
    type KickThreshold = Period;
    type ValidatorId = AccountId;
    type ValidatorIdOf = pallet_collator_selection::IdentityCollator;
    type ValidatorRegistration = Session;
    type WeightInfo = crate::weights::pallet_collator_selection::WeightInfo<Runtime>;
}

// Custom protocol pallet configurations and their fail-closed A8/A11 seams
// follow below. Keeping these in the same module makes the assembly graph easy
// to audit against docs/architecture/01 §5.

const BLOCKS_PER_DAY: u32 = (24 * 60 * 60 * 1_000) / kernel::MILLISECS_PER_BLOCK as u32;
const BLOCKS_PER_WEEK: u32 = 7 * BLOCKS_PER_DAY;
const fn percent(x: i32) -> sp_runtime::FixedI64 {
    sp_runtime::FixedI64::from_rational(x as u128, 100)
}
// `make_linear(length, period, floor, ceil)` builds a `LinearDecreasing` curve
// that starts at `ceil` (turnout/approval share 0) and decays to `floor` (at
// share 1); it REQUIRES `ceil >= floor` (its `threshold` computes
// `ceil - x·(ceil - floor)` over raw `Perbill`, which underflows/panics if
// `floor > ceil`). 06 §2.1 support curves are written "high→low", i.e.
// ceil=high, floor=low. Passing them floor-first inverts the bound and bricks
// every track (support requirement wraps; the values layer cannot confirm).
// Approval is flat (floor == ceil), so its order is immaterial.
//
pub(crate) const METRIC_APPROVAL: pallet_referenda::Curve =
    pallet_referenda::Curve::make_linear(1, 1, percent(50), percent(60));
pub(crate) const METRIC_SUPPORT: pallet_referenda::Curve =
    pallet_referenda::Curve::make_reciprocal(1, 14, percent(10), percent(2), percent(10));
pub(crate) const CONSTITUTION_APPROVAL: pallet_referenda::Curve =
    pallet_referenda::Curve::make_linear(1, 1, percent(67), percent(67));
pub(crate) const CONSTITUTION_SUPPORT: pallet_referenda::Curve =
    pallet_referenda::Curve::make_linear(1, 1, percent(5), percent(15));
pub(crate) const ENTRENCHED_APPROVAL: pallet_referenda::Curve =
    pallet_referenda::Curve::make_linear(1, 1, percent(80), percent(80));
pub(crate) const ENTRENCHED_SUPPORT: pallet_referenda::Curve =
    pallet_referenda::Curve::make_linear(1, 1, percent(10), percent(20));
pub(crate) const GUARDIAN_APPROVAL: pallet_referenda::Curve =
    pallet_referenda::Curve::make_linear(1, 1, percent(55), percent(55));
pub(crate) const GUARDIAN_SUPPORT: pallet_referenda::Curve =
    pallet_referenda::Curve::make_linear(1, 1, percent(5), percent(5));
pub(crate) const RATIFY_APPROVAL: pallet_referenda::Curve =
    pallet_referenda::Curve::make_linear(1, 1, percent(50), percent(50));
pub(crate) const RATIFY_SUPPORT: pallet_referenda::Curve =
    pallet_referenda::Curve::make_linear(1, 1, percent(5), percent(5));
pub(crate) const ORACLE_APPROVAL: pallet_referenda::Curve =
    pallet_referenda::Curve::make_linear(1, 1, percent(60), percent(60));
pub(crate) const ORACLE_SUPPORT: pallet_referenda::Curve =
    pallet_referenda::Curve::make_linear(1, 1, percent(3), percent(10));
pub(crate) const TRACKS: [pallet_referenda::Track<u16, Balance, u32>; 6] = [
    pallet_referenda::Track {
        id: 0,
        info: pallet_referenda::TrackInfo {
            name: sp_runtime::str_array("metric"),
            max_deciding: 10,
            decision_deposit: 10_000 * currency::VIT,
            prepare_period: 2 * BLOCKS_PER_DAY,
            decision_period: 14 * BLOCKS_PER_DAY,
            confirm_period: 2 * BLOCKS_PER_DAY,
            min_enactment_period: 14 * BLOCKS_PER_DAY,
            min_approval: METRIC_APPROVAL,
            min_support: METRIC_SUPPORT,
        },
    },
    pallet_referenda::Track {
        id: 1,
        info: pallet_referenda::TrackInfo {
            name: sp_runtime::str_array("constitution"),
            max_deciding: 10,
            decision_deposit: 25_000 * currency::VIT,
            prepare_period: 2 * BLOCKS_PER_DAY,
            decision_period: 21 * BLOCKS_PER_DAY,
            confirm_period: 3 * BLOCKS_PER_DAY,
            min_enactment_period: 28 * BLOCKS_PER_DAY,
            min_approval: CONSTITUTION_APPROVAL,
            min_support: CONSTITUTION_SUPPORT,
        },
    },
    pallet_referenda::Track {
        id: 2,
        info: pallet_referenda::TrackInfo {
            name: sp_runtime::str_array("entrenched"),
            max_deciding: 10,
            decision_deposit: 50_000 * currency::VIT,
            prepare_period: 7 * BLOCKS_PER_DAY,
            decision_period: 28 * BLOCKS_PER_DAY,
            confirm_period: 7 * BLOCKS_PER_DAY,
            // 06 §2.1/§2.4: **four epoch boundaries**, not 84 days. `epoch.length`
            // is governable over 14–42 d, so a block-denominated delay spans a
            // boundary count that depends on the live value — at the 42 d maximum
            // the former `4 × 21 d` spanned only two, halving the priced second
            // opinion exactly when governance had lengthened epochs (SQ-234).
            //
            // Sizing against the **ceiling** makes the guarantee unconditional and
            // needs no new machinery: `pallet-referenda` reads this once, at bake
            // time (`earliest_allowed = now + min_enactment_period`), so a delay
            // derived from the *live* length could still be shaved by a lengthening
            // that lands afterwards. The ceiling cannot move — `epoch.length` is
            // kernel-bounded (13 rule 7), so `amend_registry` refuses its metadata
            // tuple outright. Shorter epochs only add boundaries, never remove
            // them, and every entrenched-track power is a loosening, so the
            // resulting over-delay at shorter lengths errs toward more review.
            min_enactment_period: 4 * kernel::PRODUCTION_MAX_EPOCH_LENGTH_BLOCKS,
            min_approval: ENTRENCHED_APPROVAL,
            min_support: ENTRENCHED_SUPPORT,
        },
    },
    pallet_referenda::Track {
        id: 3,
        info: pallet_referenda::TrackInfo {
            name: sp_runtime::str_array("guardian"),
            max_deciding: 10,
            decision_deposit: 5_000 * currency::VIT,
            prepare_period: BLOCKS_PER_DAY,
            decision_period: 7 * BLOCKS_PER_DAY,
            confirm_period: BLOCKS_PER_DAY,
            min_enactment_period: 2 * BLOCKS_PER_DAY,
            min_approval: GUARDIAN_APPROVAL,
            min_support: GUARDIAN_SUPPORT,
        },
    },
    pallet_referenda::Track {
        id: 4,
        info: pallet_referenda::TrackInfo {
            name: sp_runtime::str_array("ratify"),
            max_deciding: 10,
            decision_deposit: 1_000 * currency::VIT,
            prepare_period: BLOCKS_PER_DAY,
            decision_period: 7 * BLOCKS_PER_DAY,
            confirm_period: BLOCKS_PER_DAY,
            min_enactment_period: 0,
            min_approval: RATIFY_APPROVAL,
            min_support: RATIFY_SUPPORT,
        },
    },
    pallet_referenda::Track {
        id: 5,
        info: pallet_referenda::TrackInfo {
            name: sp_runtime::str_array("oracle"),
            max_deciding: 10,
            decision_deposit: 5_000 * currency::VIT,
            prepare_period: 0,
            decision_period: 7 * BLOCKS_PER_DAY,
            confirm_period: BLOCKS_PER_DAY,
            min_enactment_period: 0,
            min_approval: ORACLE_APPROVAL,
            min_support: ORACLE_SUPPORT,
        },
    },
];

pub struct BleavitTracks;
impl pallet_referenda::TracksInfo<Balance, u32> for BleavitTracks {
    type Id = u16;
    type RuntimeOrigin = <RuntimeOrigin as frame_support::traits::OriginTrait>::PalletsOrigin;
    fn tracks() -> impl Iterator<Item = Cow<'static, pallet_referenda::Track<u16, Balance, u32>>> {
        TRACKS.iter().map(Cow::Borrowed)
    }
    fn track_for(origin: &Self::RuntimeOrigin) -> Result<Self::Id, ()> {
        let scoped: Result<crate::track_origins::Origin, _> = origin.clone().try_into();
        if let Ok(scoped) = scoped {
            return Ok(match scoped {
                crate::track_origins::Origin::Metric => 0,
                crate::track_origins::Origin::Constitution => 1,
                crate::track_origins::Origin::Entrenched => 2,
                crate::track_origins::Origin::GuardianTrack => 3,
                crate::track_origins::Origin::Ratify => 4,
            });
        }
        #[cfg(feature = "runtime-benchmarks")]
        {
            // Upstream `pallet-referenda` benchmarks submit a proposal whose
            // enactment origin is Root. Map that fixture origin onto the
            // strongest values track (entrenched, id 2) in benchmark Wasm only;
            // no production track or origin mapping is added.
            let system: Result<frame_system::RawOrigin<AccountId>, _> = origin.clone().try_into();
            if matches!(system, Ok(frame_system::RawOrigin::Root)) {
                return Ok(2);
            }
        }
        let candidate: Result<pallet_origins::Origin, _> = origin.clone().try_into();
        match candidate {
            // Conservative backwards-compatible mapping for callers which have
            // not selected a scoped origin explicitly.
            Ok(pallet_origins::Origin::ConstitutionalValues) => Ok(2),
            Ok(pallet_origins::Origin::OracleResolution) => Ok(5),
            _ => Err(()),
        }
    }
}

pub trait AllowedValuesTracks {
    fn allows(origin: crate::track_origins::Origin) -> bool;
}

pub struct MetricTrack;
impl AllowedValuesTracks for MetricTrack {
    fn allows(origin: crate::track_origins::Origin) -> bool {
        matches!(origin, crate::track_origins::Origin::Metric)
    }
}

pub struct GuardianTrack;
impl AllowedValuesTracks for GuardianTrack {
    fn allows(origin: crate::track_origins::Origin) -> bool {
        matches!(origin, crate::track_origins::Origin::GuardianTrack)
    }
}

pub struct RatifyTrack;
impl AllowedValuesTracks for RatifyTrack {
    fn allows(origin: crate::track_origins::Origin) -> bool {
        matches!(origin, crate::track_origins::Origin::Ratify)
    }
}

pub struct EnsureValuesScoped<Allowed>(core::marker::PhantomData<Allowed>);
impl<Allowed: AllowedValuesTracks> frame_support::traits::EnsureOrigin<RuntimeOrigin>
    for EnsureValuesScoped<Allowed>
{
    type Success = ();

    fn try_origin(origin: RuntimeOrigin) -> Result<Self::Success, RuntimeOrigin> {
        let legacy: Result<pallet_origins::Origin, RuntimeOrigin> = origin.clone().into();
        if matches!(legacy, Ok(pallet_origins::Origin::ConstitutionalValues)) {
            return Ok(());
        }
        let scoped: Result<crate::track_origins::Origin, RuntimeOrigin> = origin.clone().into();
        match scoped {
            Ok(track) if Allowed::allows(track) => Ok(()),
            _ => Err(origin),
        }
    }

    #[cfg(feature = "runtime-benchmarks")]
    fn try_successful_origin() -> Result<RuntimeOrigin, ()> {
        Ok(pallet_origins::Origin::ConstitutionalValues.into())
    }
}

/// Values authority that accepts only the named scoped referenda track.
///
/// Unlike `EnsureValuesScoped`, this does not retain the legacy unscoped
/// `ConstitutionalValues` compatibility path, which maps to the entrenched
/// track. New surfaces with an explicitly owned track use this stricter form.
pub struct EnsureGuardianTrack;
impl frame_support::traits::EnsureOrigin<RuntimeOrigin> for EnsureGuardianTrack {
    type Success = ();

    fn try_origin(origin: RuntimeOrigin) -> Result<Self::Success, RuntimeOrigin> {
        let scoped: Result<crate::track_origins::Origin, RuntimeOrigin> = origin.clone().into();
        matches!(scoped, Ok(crate::track_origins::Origin::GuardianTrack))
            .then_some(())
            .ok_or(origin)
    }

    #[cfg(feature = "runtime-benchmarks")]
    fn try_successful_origin() -> Result<RuntimeOrigin, ()> {
        Ok(crate::track_origins::Origin::GuardianTrack.into())
    }
}

parameter_types! {
    pub const SubmissionDeposit: Balance = currency::VIT;
    pub const MaxQueued: u32 = 100;
    pub const AlarmInterval: u32 = 10;
    pub const MaxTurnout: Balance = currency::VIT_TOTAL_SUPPLY;
    pub const VoteLockingPeriod: u32 = 32 * BLOCKS_PER_WEEK;
}
#[cfg(not(feature = "runtime-benchmarks"))]
parameter_types! {
    pub const UndecidingTimeout: u32 = 7 * BLOCKS_PER_DAY;
}
#[cfg(feature = "runtime-benchmarks")]
parameter_types! {
    // The upstream `nudge_referendum_no_deposit` fixture advances through the
    // full prepare period before measuring the no-deposit branch. Production's
    // equal 7-day timeout makes that synthetic referendum terminal at the same
    // block, so benchmark Wasm gives the fixture one additional prepare period.
    pub const UndecidingTimeout: u32 = 14 * BLOCKS_PER_DAY;
}
impl pallet_referenda::Config for Runtime {
    type RuntimeCall = RuntimeCall;
    type RuntimeEvent = RuntimeEvent;
    type WeightInfo = crate::weights::pallet_referenda::WeightInfo<Runtime>;
    type Scheduler = Scheduler;
    type Currency = Balances;
    type SubmitOrigin = frame_system::EnsureSigned<AccountId>;
    type CancelOrigin = pallet_origins::EnsureConstitutionalValues;
    type KillOrigin = pallet_origins::EnsureConstitutionalValues;
    type Slash = ();
    type Votes = Balance;
    type Tally = pallet_conviction_voting::TallyOf<Self>;
    type SubmissionDeposit = SubmissionDeposit;
    type MaxQueued = MaxQueued;
    type UndecidingTimeout = UndecidingTimeout;
    type AlarmInterval = AlarmInterval;
    type Tracks = BleavitTracks;
    type Preimages = Preimage;
    type BlockNumberProvider = System;
}
impl pallet_conviction_voting::Config for Runtime {
    type RuntimeEvent = RuntimeEvent;
    type WeightInfo = crate::weights::pallet_conviction_voting::WeightInfo<Runtime>;
    type Currency = Balances;
    type Polls = Referenda;
    type MaxTurnout = MaxTurnout;
    type MaxVotes = ConstU32<512>;
    type VoteLockingPeriod = VoteLockingPeriod;
    type BlockNumberProvider = System;
    type VotingHooks = ();
}

impl pallet_origins::Config for Runtime {
    type WeightInfo = crate::weights::pallet_origins::WeightInfo<Runtime>;
}

impl crate::track_origins::Config for Runtime {}

pub struct ConstitutionGovernanceOrigin;
impl frame_support::traits::EnsureOrigin<RuntimeOrigin> for ConstitutionGovernanceOrigin {
    type Success = pallet_constitution::ConstitutionOrigin;
    fn try_origin(origin: RuntimeOrigin) -> Result<Self::Success, RuntimeOrigin> {
        let scoped: Result<crate::track_origins::Origin, RuntimeOrigin> = origin.clone().into();
        if let Ok(track) = scoped {
            return match track {
                crate::track_origins::Origin::Constitution => Ok(Self::Success::ConstitutionTrack),
                crate::track_origins::Origin::Entrenched => Ok(Self::Success::EntrenchedTrack),
                _ => Err(origin),
            };
        }
        let custom: Result<pallet_origins::Origin, RuntimeOrigin> = origin.clone().into();
        if let Ok(custom) = custom {
            return match custom {
                pallet_origins::Origin::FutarchyParam => Ok(Self::Success::FutarchyParam),
                pallet_origins::Origin::FutarchyTreasury => Ok(Self::Success::FutarchyTreasury),
                pallet_origins::Origin::FutarchyCode => Ok(Self::Success::FutarchyCode),
                pallet_origins::Origin::FutarchyMeta => Ok(Self::Success::FutarchyMeta),
                pallet_origins::Origin::ConstitutionalValues => {
                    Ok(Self::Success::ConstitutionalValues)
                }
                pallet_origins::Origin::OracleResolution => Err(origin),
                pallet_origins::Origin::GuardianHold => Ok(Self::Success::GuardianHold),
                pallet_origins::Origin::EmergencyPlaybook => Ok(Self::Success::EmergencyPlaybook),
            };
        }
        let raw: Result<frame_system::RawOrigin<AccountId>, RuntimeOrigin> = origin.clone().into();
        match raw {
            Ok(frame_system::RawOrigin::Root) => Ok(Self::Success::Root),
            Ok(frame_system::RawOrigin::Signed(_)) => Ok(Self::Success::Signed),
            _ => Err(origin),
        }
    }
    #[cfg(feature = "runtime-benchmarks")]
    fn try_successful_origin() -> Result<RuntimeOrigin, ()> {
        Ok(pallet_origins::Origin::FutarchyParam.into())
    }
}
/// 08 §4.2 minimum-viable-NAV admission for the 02 §7.3 arming bits (SQ-180).
///
/// The hard `ensure_nav_floor` variant is the right one here (SQ-381 resolution):
/// on a below-floor arming attempt 08 §4.2's loud signal *is* the extrinsic
/// failure carrying `NavFloorUnmet` — the `Err` fails the dispatch (surfaced
/// durably as `system::ExtrinsicFailed`, or bootstrap sudo's `Sudid { Err(..) }`
/// on the 09 §5.4 arming path) while leaving `PhaseFlags` unchanged (fail-static).
/// A pallet event cannot also survive the `Err` (FRAME rolls it back), and the
/// unchanged-flags requirement is exactly what mandates the `Err`. The
/// field-carrying `NavFloorUnmet { class, nav, floor }` event stays available on
/// the non-blocking, `Ok`-returning `flag_nav_floor` diagnostic variant (08 §4.4).
pub struct TreasuryPhaseArmingGate;
impl pallet_constitution::PhaseArmingGate for TreasuryPhaseArmingGate {
    fn ensure_armable(
        class: futarchy_primitives::ProposalClass,
    ) -> frame_support::dispatch::DispatchResult {
        FutarchyTreasury::ensure_nav_floor(class)
    }
}

/// 13 §5 item 6 / 08 §4.1's screening obligation (SQ-303, SQ-501).
///
/// Two families, one answer since SQ-501: both are judged **by value**.
/// **Class-floor inputs** re-derive 08 §4.1's per-class floors from the
/// *proposed* parameter set and are refused exactly when one would exceed the
/// frozen literal the treasury enforces. **Occupancy inputs** re-derive 13 §5
/// items 1–4's envelopes the same way, against the kernel constants SQ-501
/// single-homed them as; before that they were refused outright, which made the
/// four 13 §1 rows declaratory.
///
/// This is the seam rather than the core aggregate because the pallet's
/// `set_param` works directly on `Params` storage, so the answer has to be
/// computed from that storage. `constitution_core::class_floors_survive` and
/// `::occupancy_envelopes_survive` are the single homes of the arithmetic both
/// paths use, and `::occupancy_params_for` the single home of the key list and
/// the proposed-value substitution — a drifting second copy would admit a change
/// the core refuses.
/// What is in flight, for the SQ-501 occupancy screen — read from bounded state.
///
/// `epoch.slots` and `epoch.length` are **pinned**: a reduction of either binds
/// only cohorts that form later, so the live maximum can exceed the registry and
/// the screen has to see it. The other three inputs are re-read on every use, so
/// the proposed value is already what is in force everywhere.
///
/// Bounds, stated because I-20 requires them:
///
/// * the cohort-size maximum groups `pallet_epoch::Proposals` by epoch — a
///   `CountedStorageMap` whose compiled bound is `bounds::MAX_LIVE_PROPOSALS`
///   (32). `RuntimeInDecisionWindow::contains` already performs the identical
///   bounded scan on the observation path, so this is an established cost rather
///   than a new class of one. `Proposals` is the right source rather than the
///   <= 4 `Cohorts` rows or the per-epoch `FundedPolSlots` snapshot, because an
///   extended or rerun proposal trades past its epoch boundary while being in
///   neither.
/// * the epoch-length maximum reads `Schedule` (one value: the running length plus
///   the one already staged) and `CohortSchedules`, pruned to exactly the live
///   cohort set and so bounded by `bounds::MAX_NON_TERMINAL_COHORTS` (4).
///
/// `None` — a refusal — when the proposal count exceeds its own compiled bound.
/// That is a broken I-21 invariant, and screening against a parameter set drawn
/// from broken state is exactly the assumption G-1 forbids.
pub(crate) fn in_flight_occupancy() -> Option<pallet_constitution::InFlightOccupancy> {
    use alloc::collections::BTreeMap;

    if pallet_epoch::Proposals::<Runtime>::count() > bounds::MAX_LIVE_PROPOSALS {
        return None;
    }
    let mut per_epoch: BTreeMap<futarchy_primitives::EpochId, u32> = BTreeMap::new();
    for proposal in pallet_epoch::Proposals::<Runtime>::iter_values() {
        let counter = per_epoch.entry(proposal.epoch).or_insert(0);
        *counter = counter.checked_add(1)?;
    }
    let max_cohort_proposals = per_epoch.into_values().max().unwrap_or(0);

    let clock = pallet_epoch::Schedule::<Runtime>::get();
    let max_epoch_length = pallet_epoch::CohortSchedules::<Runtime>::iter_values()
        .map(|schedule| schedule.creation_epoch_length)
        .chain([clock.length, clock.next_length])
        .max()
        .unwrap_or(clock.length);

    Some(pallet_constitution::InFlightOccupancy {
        max_cohort_proposals,
        max_epoch_length,
    })
}

pub struct RuntimeBudgetDerivationGuard;
impl pallet_constitution::BudgetDerivationGuard for RuntimeBudgetDerivationGuard {
    fn permits(
        key: futarchy_primitives::ParamKey,
        current: pallet_constitution::ParamValue,
        next: pallet_constitution::ParamValue,
    ) -> bool {
        // A write that changes nothing is not a change: 13 §5 item 6 attaches
        // the obligation to "a decision changing" one of these keys, and an
        // equal write re-derives to exactly what is already compiled.
        if current.as_u128() == next.as_u128() {
            return true;
        }
        if pallet_constitution::is_occupancy_input(key) {
            // Read the live registry, substituting the proposed value for `key`,
            // and compose it with what is actually in flight.
            // `occupancy_change_permitted` is the single home of the whole
            // verdict, so this path and the core aggregate's cannot drift. A
            // missing row, a non-`u32` value or an in-flight maximum that cannot
            // be established is a refusal, never an assumption (G-1).
            let Some(in_flight) = in_flight_occupancy() else {
                return false;
            };
            return pallet_constitution::occupancy_change_permitted(
                key,
                current,
                next,
                |wanted| {
                    pallet_constitution::Params::<Runtime>::get(wanted).map(|record| record.value)
                },
                in_flight,
            );
        }
        if !pallet_constitution::is_class_floor_input(key) {
            return true;
        }
        // Read the live registry, substituting the proposed value for `key`.
        // Only reached for the six class-floor keys, so ordinary parameter
        // administration pays none of these reads.
        let proposed = |name: &[u8]| -> Option<u128> {
            let wanted = pallet_constitution::key16(name);
            if wanted == key {
                return Some(next.as_u128());
            }
            pallet_constitution::Params::<Runtime>::get(wanted).map(|record| record.value.as_u128())
        };
        let Some(budget) = proposed(b"pol.budget_epoch") else {
            return false;
        };
        let Ok(budget_ppb) = u32::try_from(budget) else {
            return false;
        };
        let Some(b_gate) = proposed(b"pol.b_gate") else {
            return false;
        };
        let mut b_class = [0u128; 4];
        for (slot, name) in b_class
            .iter_mut()
            .zip(pallet_constitution::POL_B_CLASS_KEYS.iter())
        {
            match proposed(name) {
                Some(value) => *slot = value,
                // A missing registry row is a broken invariant, not a licence:
                // refuse rather than screen against a partial parameter set.
                None => return false,
            }
        }
        pallet_constitution::class_floors_survive(budget_ppb, b_gate, b_class)
    }

    /// The bounded reads `in_flight_occupancy` performs, plus the five registry
    /// rows `occupancy_params_for` resolves. Declared rather than benchmarked
    /// because the seam is bound by the runtime and `set_param`'s generated
    /// weight predates it; over-declaring costs block capacity while
    /// under-declaring produces blocks that exceed their proof budget at
    /// execution (15 §4.5), so every term rounds up to its compiled bound.
    fn max_weight() -> frame_support::weights::Weight {
        let reads = u64::from(bounds::MAX_LIVE_PROPOSALS)
            .saturating_add(u64::from(bounds::MAX_NON_TERMINAL_COHORTS))
            .saturating_add(1) // `Schedule`
            .saturating_add(1) // the `Proposals` counter
            .saturating_add(pallet_constitution::OCCUPANCY_PARAM_KEYS.len() as u64);
        <Runtime as frame_system::Config>::DbWeight::get().reads(reads)
    }
}

/// 07 §6.3's coverage rule, re-checked whenever one of its two inputs is
/// amended (SQ-495).
///
/// The rule is evaluated once, at `register_spec`. Nothing re-checked it when
/// `orc.bond_bps` or `orc.rounds` was later lowered inside its own 13 §1
/// bounds, so a component admitted at `(3, 250)` — 1,750 bps of coverage —
/// could keep settling money at `(2, 150)`, which is 450. Both moves are
/// single, lawful amendments: `orc.rounds` carries no max-Δ at all, and
/// `orc.bond_bps` 250 → 150 sits inside its `Factor(2)` band.
pub struct RuntimeCoverageGuard;
impl pallet_constitution::CoverageGuard for RuntimeCoverageGuard {
    fn permits(key: futarchy_primitives::ParamKey, next: pallet_constitution::ParamValue) -> bool {
        // Every other key short-circuits before any welfare storage is touched,
        // so the bounded MetricSpec scan below is paid only on the two keys
        // that can actually move coverage.
        if !pallet_constitution::is_coverage_input(key) {
            return true;
        }
        // The amended key takes its proposed value; the other keeps its live
        // one. `dispatch_set_param` runs this screen *before* committing the
        // update, so the live read is the pre-amendment value — which is what
        // the pairing needs.
        let rounds_key = pallet_constitution::key16(b"orc.rounds");
        let (rounds, bond_bps) = if key == rounds_key {
            (
                u8::try_from(next.as_u128()).unwrap_or(u8::MAX),
                perbill_bps_param_or(
                    b"orc.bond_bps",
                    pallet_oracle::OracleParams::DEFAULT.bond_bps,
                ),
            )
        } else {
            // `orc.bond_bps` is stored as a `Perbill`, i.e. **parts per
            // billion**, while §6.3's rule is stated in basis points — a factor
            // of 100,000. Comparing the raw value against a `Δs_max` in bps
            // would make every proposed rate look ~100,000× more generous than
            // it is and wave through exactly the amendments this screen exists
            // to refuse. Rounded **up**, matching `perbill_bps_param_or`, so
            // the rounding never overstates coverage.
            const PPB_PER_BPS: u128 = 100_000;
            let parts = next.as_u128();
            let bps = parts / PPB_PER_BPS + u128::from(parts % PPB_PER_BPS != 0);
            (
                u8_param_or(b"orc.rounds", pallet_oracle::OracleParams::DEFAULT.rounds),
                u32::try_from(bps).unwrap_or(u32::MAX),
            )
        };
        // The strictest live requirement. Scans **every registered** version,
        // not just the ones live cohorts froze: a version registered now
        // activates later, and its components were admitted against today's
        // ladder. Bounded by MAX_METRIC_SPECS × MAX_COMPONENTS_PER_SPEC.
        //
        // Only `Attested` components carry a bond ladder — classes 1–3 run no
        // §5 game, so their recorded `delta_s_max_bps` is not bound-checked at
        // registration and must not bind an amendment here either.
        let required = pallet_welfare::MetricSpecs::<Runtime>::iter_values()
            .flatten()
            .filter(|spec| matches!(spec.source, pallet_welfare::SourceClass::Attested))
            .map(|spec| spec.delta_s_max_bps)
            .max();
        let Some(required) = required else {
            // Nothing admitted yet, so nothing can be under-collateralized.
            // This is the pre-genesis and early-bootstrap state, and it is the
            // only case where an unreadable ladder is also permitted: with no
            // attested component there is no claim to leave unbacked.
            return true;
        };
        // A malformed ladder refuses, matching attested admission's direction on
        // the same input rather than the registry's bond-pricing fallback: an
        // amendment that leaves coverage unknowable cannot be shown safe.
        let Some(proposed) = pallet_oracle::coverage_bps(rounds, bond_bps) else {
            return false;
        };
        if proposed >= required {
            return true;
        }
        // Coverage is already short of what some admitted component needs, and
        // an absolute test would freeze **both** keys forever in exactly that
        // state — the one the screen exists to get out of. A chain upgrading
        // into this screen can arrive already under-covered, and no single
        // lawful step necessarily restores full coverage: with a 10,000-bps
        // component stranded at `(2, 150)`, raising rounds to 4 reaches 2,250
        // and raising the rate to its `Factor(2)` limit reaches 900, so an
        // absolute check rejects both repairs and the parameters can never be
        // restored (Codex review, PR #174).
        //
        // So a **non-decreasing** amendment is always permitted, which is what
        // 07 §6.3's "raising coverage is always legal" already promises.
        // Comparing coverage rather than the key value handles both inputs
        // uniformly, since coverage is monotone increasing in each. The screen
        // still refuses every amendment that lowers coverage further.
        let current = pallet_oracle::coverage_bps(
            u8_param_or(b"orc.rounds", pallet_oracle::OracleParams::DEFAULT.rounds),
            perbill_bps_param_or(
                b"orc.bond_bps",
                pallet_oracle::OracleParams::DEFAULT.bond_bps,
            ),
        );
        current.is_some_and(|current| proposed >= current)
    }
}

impl pallet_constitution::Config for Runtime {
    type GovernanceOrigin = ConstitutionGovernanceOrigin;
    type CurrentEpoch = pallet_epoch::CurrentEpoch<Runtime>;
    type WeightInfo = crate::weights::pallet_constitution::WeightInfo<Runtime>;
    type PhaseArmingGate = TreasuryPhaseArmingGate;
    type BudgetDerivationGuard = RuntimeBudgetDerivationGuard;
    type CoverageGuard = RuntimeCoverageGuard;
    #[cfg(feature = "runtime-benchmarks")]
    type BenchmarkHelper = RuntimeBenchmarkHelper;
}

fn default_param(key: ParamKey) -> Option<pallet_constitution::ParamValue> {
    pallet_constitution::genesis_params()
        .into_iter()
        .find(|record| record.key == key)
        .map(|record| record.value)
}
fn live_param(key: ParamKey) -> Option<pallet_constitution::ParamValue> {
    pallet_constitution::Params::<Runtime>::get(key).map(|record| record.value)
}
fn live_balance_param(name: &[u8]) -> Option<Balance> {
    match live_param(pallet_constitution::key16(name)) {
        Some(pallet_constitution::ParamValue::Balance(value)) => Some(value),
        _ => None,
    }
}
fn live_u32_param(name: &[u8]) -> Option<u32> {
    match live_param(pallet_constitution::key16(name)) {
        Some(pallet_constitution::ParamValue::U32(value)) => Some(value),
        _ => None,
    }
}
fn live_u8_param(name: &[u8]) -> Option<u8> {
    match live_param(pallet_constitution::key16(name)) {
        Some(pallet_constitution::ParamValue::U8(value)) => Some(value),
        _ => None,
    }
}

#[derive(Clone, Copy)]
struct LiveReserveProbeEnvelope {
    fee: Balance,
    rate: Balance,
    interval: u32,
    timeout: u32,
    amount: Balance,
    fail_threshold: u8,
    recover_threshold: u8,
    runway: Balance,
}

fn live_reserve_probe_envelope() -> Option<LiveReserveProbeEnvelope> {
    let fee = live_balance_param(b"ops.probe_fee")?;
    let rate = live_balance_param(b"ops.probe_rate")?;
    let interval = live_u32_param(b"res.probe_int")?;
    let timeout = live_u32_param(b"res.probe_to")?;
    let amount = live_balance_param(b"res.probe_amount")?;
    let fail_threshold = live_u8_param(b"res.fail_thr")?;
    let recover_threshold = live_u8_param(b"res.recover_thr")?;
    if interval == 0 || timeout == 0 || amount == 0 || fail_threshold == 0 || recover_threshold == 0
    {
        return None;
    }
    let runway = pallet_futarchy_treasury::reserve_probe_runway_debit(
        fee,
        rate,
        fail_threshold,
        recover_threshold,
    )
    .ok()?;
    Some(LiveReserveProbeEnvelope {
        fee,
        rate,
        interval,
        timeout,
        amount,
        fail_threshold,
        recover_threshold,
        runway,
    })
}
pub(crate) fn balance_param(name: &[u8]) -> Balance {
    balance_param_or(name, 0)
}
fn balance_param_or(name: &[u8], default: Balance) -> Balance {
    let key = pallet_constitution::key16(name);
    match live_param(key) {
        Some(pallet_constitution::ParamValue::Balance(value)) => value,
        _ => match default_param(key) {
            Some(pallet_constitution::ParamValue::Balance(value)) => value,
            _ => default,
        },
    }
}
/// Live 09 §6.1 DOT/USDC execution rates from constitution Params.
pub struct ConstitutionTraderRates;
impl bleavit_xcm::trader::TraderRates for ConstitutionTraderRates {
    fn dot_rate() -> bleavit_xcm::trader::WeightRate {
        bleavit_xcm::trader::WeightRate {
            units_per_second: balance_param(b"xcm.dot_per_sec"),
            units_per_megabyte: balance_param(b"xcm.dot_per_mb"),
        }
    }

    fn usdc_rate() -> bleavit_xcm::trader::WeightRate {
        bleavit_xcm::trader::WeightRate {
            units_per_second: balance_param(b"xcm.usdc_per_sec"),
            units_per_megabyte: balance_param(b"xcm.usdc_per_mb"),
        }
    }
}

/// Phase-3 caps are seeded as µUSDC (six decimals), the same base unit used
/// by the local sufficient USDC asset's issuance and account balances.
pub struct ConstitutionInflowCapParams;
impl pallet_inflow_caps::InflowCapParams for ConstitutionInflowCapParams {
    fn tvl_cap_usdc() -> u128 {
        balance_param(b"phase3.tvl_cap")
    }

    fn deposit_cap_usdc() -> u128 {
        balance_param(b"phase3.dep_cap")
    }
}

pub struct ForeignUsdcIssuance;
impl frame_support::traits::Get<u128> for ForeignUsdcIssuance {
    fn get() -> u128 {
        <ForeignAssets as Inspect<AccountId>>::total_issuance(usdc_location())
    }
}

impl pallet_inflow_caps::Config for Runtime {
    type CapParams = ConstitutionInflowCapParams;
    type UsdcIssuance = ForeignUsdcIssuance;
    type ProtocolAccounts = InflowCapProtocolAccounts;
}

/// 09 §5.2 XCM adapter over the shared on-chain meters.
pub struct PhaseInflowCaps;
impl bleavit_xcm::caps::InflowCaps<AccountId> for PhaseInflowCaps {
    fn usdc_mint_admissible(amount: u128) -> Result<(), ()> {
        pallet_inflow_caps::Pallet::<Runtime>::mint_admissible(amount)
    }

    fn note_usdc_inflow(who: &AccountId, amount: u128) -> Result<(), ()> {
        pallet_inflow_caps::Pallet::<Runtime>::note_inflow(who, amount)
    }

    fn usdc_inflow_admissible(who: &AccountId, amount: u128) -> Result<(), ()> {
        pallet_inflow_caps::Pallet::<Runtime>::inflow_admissible(who, amount)
            .then_some(())
            .ok_or(())
    }
}

/// Pure-read 09 §5.2 defense-in-depth gate for signed ledger splits.
pub struct RuntimeLedgerInflowCapGate;
impl pallet_conditional_ledger::InflowCapGate<AccountId> for RuntimeLedgerInflowCapGate {
    fn escrow_admissible(who: &AccountId) -> bool {
        pallet_inflow_caps::Pallet::<Runtime>::escrow_admissible(who)
    }
}
fn fixed_param(name: &[u8]) -> u64 {
    fixed_param_or(name, 0)
}
fn fixed_param_or(name: &[u8], default: u64) -> u64 {
    let key = pallet_constitution::key16(name);
    match live_param(key) {
        Some(pallet_constitution::ParamValue::Fixed(value)) => value.0,
        _ => match default_param(key) {
            Some(pallet_constitution::ParamValue::Fixed(value)) => value.0,
            _ => default,
        },
    }
}
/// Live `sec.flow_cap` (13 §1) clamped to its kernel hard minimum ×7.
///
/// SQ-486 adopted the row at ×16 from the Phase-0 calibration, so it **is** now
/// seeded at genesis and inserted on existing chains by
/// `MigrateConstitutionSecurityFlowCapV4`. The clamp stays, and it is not
/// redundant: it keeps a hypothetically absent or sub-minimum read collapsing to
/// exactly the kernel minimum ×7 rather than to zero. That direction is the
/// deliberate one — a ceiling is not a floor, so `0` would wrongly *erase* the
/// contest-capital term while any large default would *widen* step 9, and ×7 is
/// the smallest admissible ceiling (08 §5.3; SQ-231).
///
/// Unlike `in_cap_prize`'s envelope reads, this consumer intentionally accepts
/// the compile-time default as a fallback: an unreachable ceiling must degrade to
/// the tightest lawful one, whereas an unratified *security envelope* must not be
/// backed at all.
#[allow(dead_code)]
pub(crate) fn sec_flow_cap_1e9() -> u64 {
    fixed_param(b"sec.flow_cap").max(kernel::SEC_FLOW_CAP_FLOOR_1E9)
}

pub(crate) fn u32_param(name: &[u8]) -> u32 {
    u32_param_or(name, 0)
}
fn u32_param_or(name: &[u8], default: u32) -> u32 {
    let key = pallet_constitution::key16(name);
    match live_param(key) {
        Some(pallet_constitution::ParamValue::U32(value)) => value,
        _ => match default_param(key) {
            Some(pallet_constitution::ParamValue::U32(value)) => value,
            _ => default,
        },
    }
}
fn perbill_param(name: &[u8]) -> u32 {
    perbill_param_or(name, 0)
}
fn perbill_param_or(name: &[u8], default: u32) -> u32 {
    let key = pallet_constitution::key16(name);
    match live_param(key) {
        Some(pallet_constitution::ParamValue::Perbill(value)) => value,
        _ => match default_param(key) {
            Some(pallet_constitution::ParamValue::Perbill(value)) => value,
            _ => default,
        },
    }
}
pub(crate) fn percent_param(name: &[u8]) -> u8 {
    percent_param_or(name, 0)
}
fn percent_param_or(name: &[u8], default: u8) -> u8 {
    let key = pallet_constitution::key16(name);
    match live_param(key) {
        Some(pallet_constitution::ParamValue::Percent(value)) => value,
        _ => match default_param(key) {
            Some(pallet_constitution::ParamValue::Percent(value)) => value,
            _ => default,
        },
    }
}
pub(crate) fn u8_param(name: &[u8]) -> u8 {
    u8_param_or(name, 0)
}
fn u8_param_or(name: &[u8], default: u8) -> u8 {
    let key = pallet_constitution::key16(name);
    match live_param(key) {
        Some(pallet_constitution::ParamValue::U8(value)) => value,
        _ => match default_param(key) {
            Some(pallet_constitution::ParamValue::U8(value)) => value,
            _ => default,
        },
    }
}

fn perbill_bps_param_or(name: &[u8], default_bps: u32) -> u32 {
    const PPB_PER_BPS: u32 = 100_000;
    let key = pallet_constitution::key16(name);
    let parts = match live_param(key) {
        Some(pallet_constitution::ParamValue::Perbill(value)) => Some(value),
        _ => match default_param(key) {
            Some(pallet_constitution::ParamValue::Perbill(value)) => Some(value),
            _ => None,
        },
    };
    parts.map_or(default_bps, |value| {
        (value / PPB_PER_BPS).saturating_add(u32::from(value % PPB_PER_BPS != 0))
    })
}

/// Live 07 §§4–8 oracle/reserve parameters. The constitution stores
/// `orc.bond_bps` as parts-per-billion (25_000_000 = 2.5%); the frame-free
/// oracle kernel consumes basis points (250), so convert at this adapter.
pub struct RuntimeOracleParams;
impl pallet_oracle::OracleParamsProvider for RuntimeOracleParams {
    fn get() -> pallet_oracle::OracleParams {
        let defaults = pallet_oracle::OracleParams::DEFAULT;
        pallet_oracle::OracleParams {
            window: u32_param_or(b"orc.window", defaults.window),
            rounds: u8_param_or(b"orc.rounds", defaults.rounds),
            bond_floor: balance_param_or(b"orc.bond_floor", defaults.bond_floor),
            bond_bps: perbill_bps_param_or(b"orc.bond_bps", defaults.bond_bps),
            reporter_stake: balance_param_or(b"orc.rep_stake", defaults.reporter_stake),
            watchtower_stake: balance_param_or(b"wt.stake", defaults.watchtower_stake),
            watchtower_quorum: u8_param_or(b"wt.quorum", defaults.watchtower_quorum),
            probe_interval: u32_param_or(b"res.probe_int", defaults.probe_interval),
            probe_timeout: u32_param_or(b"res.probe_to", defaults.probe_timeout),
            fail_threshold: u8_param_or(b"res.fail_thr", defaults.fail_threshold),
            recover_threshold: u8_param_or(b"res.recover_thr", defaults.recover_threshold),
            probe_amount: balance_param_or(b"res.probe_amount", defaults.probe_amount),
        }
    }
}

/// Live 06 §7 attestor economics and creation-time challenge window.
pub struct RuntimeAttestorParams;
impl pallet_attestor::AttestorParamsProvider for RuntimeAttestorParams {
    fn get() -> pallet_attestor::AttestorParams {
        let defaults = pallet_attestor::AttestorParams::DEFAULT;
        pallet_attestor::AttestorParams {
            bond: balance_param_or(b"att.bond", defaults.bond),
            challenge_window: u32_param_or(b"att.window", defaults.challenge_window),
        }
    }
}

/// N4 intentionally reads only the live constitution row, with no default and
/// no genesis fallback of its own. `svc.client_bond` was `[VERIFY]`-absent
/// through N15 — which kept the service inert, since this is the one row that
/// gated admission — and the user adopted it at 100,000 VIT on 2026-08-04, so
/// genesis now seeds it (13 §1).
///
/// The `Option` is deliberately kept rather than collapsed to the seeded value.
/// It is what makes the row's *presence* the arming act: remove the row on a
/// live chain and admission refuses again with `ClientBondUnset` rather than
/// falling back to a compiled-in number, which is also why a post-genesis
/// activation would need a migration (amendment calls cannot create an absent
/// key). A runtime test asserts that path by removing the row.
pub struct RuntimeClientBond;
impl pallet_client_registry::ClientBondProvider for RuntimeClientBond {
    fn client_bond() -> Option<Balance> {
        live_balance_param(b"svc.client_bond").filter(|bond| *bond > 0)
    }
}

pub struct RuntimeServiceParams;
impl pallet_question_service::ServiceParamsProvider for RuntimeServiceParams {
    fn fee_rate() -> Option<Perbill> {
        match live_param(pallet_constitution::key16(b"svc.fee_bps")) {
            Some(pallet_constitution::ParamValue::Perbill(parts))
                if u64::from(parts) <= kernel::SCORE_SCALE =>
            {
                Some(Perbill::from_parts(parts))
            }
            _ => None,
        }
    }

    fn max_live() -> u32 {
        u32_param_or(b"svc.max_live", 0).min(bounds::MAX_CLIENTS)
    }

    fn max_window() -> BlockNumber {
        u32_param_or(b"svc.max_window", 0)
    }

    fn epsilon_min() -> FixedU64 {
        FixedU64(u64::from(perbill_param_or(
            b"svc.epsilon_min",
            kernel::SCORE_SCALE as u32,
        )))
    }

    fn oracle_window() -> BlockNumber {
        u32_param_or(b"orc.window", pallet_oracle::OracleParams::DEFAULT.window)
    }

    fn oracle_rounds() -> u8 {
        u8_param_or(b"orc.rounds", pallet_oracle::OracleParams::DEFAULT.rounds)
    }

    fn oracle_bond_bps() -> u32 {
        perbill_bps_param_or(
            b"orc.bond_bps",
            pallet_oracle::OracleParams::DEFAULT.bond_bps,
        )
    }

    fn attestor_bond_floor() -> Balance {
        balance_param(b"reg.bond_mile")
    }

    fn flow_cap() -> FixedU64 {
        FixedU64(sec_flow_cap_1e9())
    }

    /// 16 §8.6. Reads the LIVE row only, with no default fallback and no floor:
    /// absence must reach the pallet as `None` so the multiplier stays 1, which
    /// is the flat two-part tariff the chain has today. A default here would
    /// silently arm a surcharge the values layer never adopted, and a floor
    /// would make an unset row indistinguishable from a deliberate `1`.
    fn price_cap() -> Option<FixedU64> {
        let key = pallet_constitution::key16(b"svc.price_cap");
        match live_param(key) {
            Some(pallet_constitution::ParamValue::Fixed(value)) => Some(value),
            _ => None,
        }
    }
}

pub struct RuntimeClientFunding;
impl pallet_client_registry::ClientFunding<AccountId> for RuntimeClientFunding {
    fn funding_account(client: futarchy_primitives::ClientId) -> Option<AccountId> {
        use staging_xcm_executor::traits::ConvertLocation;

        let record = pallet_client_registry::Clients::<Runtime>::get(client)?;
        match (record.location, record.local_signer) {
            (Some(location), None) => xcm_config::LocationToAccountId::convert_location(&location),
            (None, Some(signer)) => Some(signer),
            _ => None,
        }
    }
}

pub struct RuntimeClientEgressFees;
impl bleavit_xcm::egress::DeliveryFeePayment for RuntimeClientEgressFees {
    fn prepay(
        client: futarchy_primitives::ClientId,
        program: &staging_xcm::latest::Xcm<()>,
        router_quote: staging_xcm::latest::Assets,
    ) -> Result<(), bleavit_xcm::egress::DeliveryFeeError> {
        // The stable2606 sibling transport currently quotes no asset. Refuse
        // any future nonempty quote until its asset incidence is specified;
        // silently stacking or converting it would recreate SQ-565.
        if !router_quote.inner().is_empty() {
            return Err(bleavit_xcm::egress::DeliveryFeeError::RouterQuoteUnsupported);
        }
        let instructions = u64::try_from(program.0.len())
            .map_err(|_| bleavit_xcm::egress::DeliveryFeeError::PricingUnavailable)?;
        let envelope = xcm_config::UnitWeightCost::get().saturating_mul(instructions);
        let rate = <ConstitutionTraderRates as bleavit_xcm::trader::TraderRates>::usdc_rate();
        let fee = bleavit_xcm::trader::price_weight_up(envelope, rate)
            .map_err(|_| bleavit_xcm::egress::DeliveryFeeError::PricingUnavailable)?;
        if fee == 0 {
            return Err(bleavit_xcm::egress::DeliveryFeeError::PricingUnavailable);
        }
        pallet_client_registry::Pallet::<Runtime>::prepay_egress(
            client,
            &crate::genesis::treasury_account(),
            fee,
        )
        .map_err(|_| bleavit_xcm::egress::DeliveryFeeError::PrepaymentRefused)?;
        // Postage is a MAIN inflow, never a treasury outflow. This ledger
        // credit shares the dispatcher's rollback layer with router delivery.
        FutarchyTreasury::credit_main(fee);
        Ok(())
    }
}

pub struct RuntimeReportPush;
impl pallet_question_service::ReportPush for RuntimeReportPush {
    fn push(
        client: futarchy_primitives::ClientId,
        report: &futarchy_primitives::ReportView,
    ) -> pallet_question_service::ReportPushOutcome {
        if report.client_id != client {
            return pallet_question_service::ReportPushOutcome::Failed;
        }
        // Removal refunds postage before tombstoning. Live questions still
        // settle, but §2 makes their remaining reports authoritative-pull-only;
        // do not manufacture Fee failures or alert noise from a zeroed float.
        if pallet_client_registry::Pallet::<Runtime>::is_removed(client) {
            return pallet_question_service::ReportPushOutcome::NotApplicable;
        }
        let Some(record) = pallet_client_registry::Clients::<Runtime>::get(client) else {
            return pallet_question_service::ReportPushOutcome::Failed;
        };
        let Some(destination) = record.location else {
            return pallet_question_service::ReportPushOutcome::NotApplicable;
        };
        match bleavit_xcm::egress::ReportEgress::<
            xcm_config::ClientEgressRouter,
            RuntimeClientEgressFees,
        >::push(client, destination, report)
        {
            Ok(_) => pallet_question_service::ReportPushOutcome::Sent,
            Err(_) => pallet_question_service::ReportPushOutcome::Failed,
        }
    }
}

pub struct RuntimeExternalMarketOrigin;
impl pallet_question_service::ExternalMarketOrigin<RuntimeOrigin> for RuntimeExternalMarketOrigin {
    fn for_client(client: futarchy_primitives::ClientId) -> RuntimeOrigin {
        pallet_client_registry::Origin::ExternalClient(client).into()
    }
}

pub struct RuntimeServiceDecisionWindows;
impl pallet_question_service::DecisionWindowGuard for RuntimeServiceDecisionWindows {
    fn collides(start: BlockNumber, end: BlockNumber) -> bool {
        let width = u32_param(b"dec.window");
        pallet_epoch::Proposals::<Runtime>::iter_values().any(|proposal| {
            proposal
                .decide_at
                .checked_sub(width)
                .is_some_and(|decision_start| start < proposal.decide_at && end > decision_start)
        })
    }
}

/// 16 §8.7: how starved Bleavit's own decision books are, right now.
///
/// Reads `1 - min(realized/floor)` over the decision pairs that are **still
/// accruing**, where `realized` is the 04 §7a contest-capital integral divided
/// by the blocks **actually integrated** rather than by the full window width —
/// dividing a partial integral by the full width would report every young
/// window as starved and fire the latch at the start of every epoch.
///
/// The liveness filter is load-bearing and was missing until 2026-08-03.
/// `pallet_epoch::Proposals` retains every nonterminal proposal, and a closed
/// window keeps its final integral forever, so an unfiltered read let a book
/// that was underfunded *once* remain the minimum and surcharge every later
/// admission. That is the same failure §8.7 forbids when it refuses to ratchet
/// starvation into the stored multiplier — a price outliving the condition that
/// set it — arriving through the input instead of through storage, and worse:
/// the stored term at least decays over `svc.max_window`, while a stale input
/// never does.
///
/// Bounded by the same proposal set `collides` already scans (that one filters
/// by time in its own predicate, which is why it never had this defect), so the
/// added cost is two book reads per proposal and nothing unbounded.
pub struct RuntimeServiceContestHealth;
impl pallet_question_service::ContestHealthProbe for RuntimeServiceContestHealth {
    fn starvation_1e9() -> FixedU64 {
        let one = futarchy_primitives::kernel::SCORE_SCALE;
        let now = frame_system::Pallet::<Runtime>::block_number();
        let v_min: [Balance; 5] = [
            balance_param(b"dec.v_min.param"),
            balance_param(b"dec.v_min.trs"),
            balance_param(b"dec.v_min.code"),
            balance_param(b"dec.v_min.meta"),
            0,
        ];
        let mut weakest: Option<u64> = None;
        for proposal in pallet_epoch::Proposals::<Runtime>::iter_values() {
            let Some(markets) = proposal.markets else {
                continue;
            };
            let floor = effective_decision_contest_floor(&proposal, &v_min);
            if floor == 0 {
                // No floor means no decision-grade contest requirement, so this
                // book cannot be starved relative to one.
                continue;
            }
            for market in [markets.accept, markets.reject] {
                let Some(ratio) = contest_ratio_1e9(market, proposal.decide_at, floor, now) else {
                    continue;
                };
                weakest = Some(weakest.map_or(ratio, |current| current.min(ratio)));
            }
        }
        // No measurable book -> no evidence of starvation. Not a fallback: with
        // no live decision book the service is not competing with one. This is
        // the reading for most of an epoch, by construction: decision windows
        // occupy a minority of it, and outside them nothing is contested.
        FixedU64(one.saturating_sub(weakest.unwrap_or(one)))
    }
}

/// `min(1, realized_contest / floor)` on the `SCORE_SCALE` grid for one book,
/// or `None` when the book has no valid, non-empty, **still-open** accrual.
fn contest_ratio_1e9(
    market: futarchy_primitives::MarketId,
    decide_at: BlockNumber,
    floor: Balance,
    now: BlockNumber,
) -> Option<u64> {
    let one = futarchy_primitives::kernel::SCORE_SCALE;
    let window = pallet_market::DecisionWindows::<Runtime>::get(market)
        .into_iter()
        .find(|record| record.end == decide_at)?;
    if !window.contest_valid {
        // An overflowed accumulator never grades, so it may not price either.
        return None;
    }
    // Two independent staleness doors, each closing a case the other misses.
    // `sealed` is the market pallet's own statement that no further accrual is
    // possible (an early close, or the decision-boundary read), and it can be
    // set while the clock still says the window is open. The clock catches the
    // mirror case: a window past its end that nothing has sealed yet because
    // the epoch crank has not run. Either way the integral is frozen, and a
    // frozen integral is history rather than present competition.
    if window.sealed || now >= window.end || now < window.start {
        return None;
    }
    let accrued = window.contest_accrued_until.checked_sub(window.start)?;
    if accrued == 0 {
        return None;
    }
    let realized = window
        .contest_capital_blocks
        .checked_div(u128::from(accrued))?;
    let ratio = realized.checked_mul(u128::from(one))?.checked_div(floor)?;
    Some(u64::try_from(ratio).unwrap_or(one).min(one))
}

pub struct RuntimeServiceTvlCap;
impl pallet_question_service::TvlCapGate<AccountId> for RuntimeServiceTvlCap {
    fn escrow_admissible(funder: &AccountId, amount: Balance) -> bool {
        if !pallet_inflow_caps::Pallet::<Runtime>::escrow_admissible(funder) {
            return false;
        }
        let cap =
            <ConstitutionInflowCapParams as pallet_inflow_caps::InflowCapParams>::tvl_cap_usdc();
        if cap == u128::MAX {
            return true;
        }
        pallet_conditional_ledger::TotalEscrowed::<Runtime>::get()
            .checked_add(pallet_conditional_ledger::TotalEscrowed::<
                Runtime,
                frame_support::instances::Instance1,
            >::get())
            .and_then(|used| used.checked_add(amount))
            .is_some_and(|after| after <= cap)
    }
}

pub struct RuntimeAccountIdBytes;
impl pallet_question_service::AccountIdBytes<AccountId> for RuntimeAccountIdBytes {
    fn into_bytes(account: &AccountId) -> [u8; 32] {
        let mut bytes = [0_u8; 32];
        bytes.copy_from_slice(account.as_ref());
        bytes
    }
}

/// Live 06 §5.4 retrospective-review deadline. The guardian core snapshots
/// this value when it creates a review record.
pub struct GuardianReviewDeadline;
impl Get<EpochId> for GuardianReviewDeadline {
    fn get() -> EpochId {
        u32_param_or(b"grd.review_dl", pallet_guardian::REVIEW_DEADLINE_EPOCHS)
    }
}

pub(crate) fn xcm_traffic_epoch_and_day() -> (EpochId, u8) {
    // The current block is never before the live epoch's start.
    epoch_and_day_at(System::block_number())
        .unwrap_or_else(|| (pallet_epoch::EpochOf::<Runtime>::get().index, 0))
}

/// Attribute `at` to its `(epoch, day)`, or `None` when no retained epoch owns it.
///
/// The live schedule is checked first, then the retained `EpochTimings` ring —
/// a probe opened just before an epoch roll and answered just after it belongs
/// to the epoch it measured, and that epoch's timing is still on chain. Neither
/// clamping such a block to day 0 of the live epoch (which records an outcome
/// against a day the probe never measured) nor discarding it (which throws away
/// a real, timely pass) is acceptable; both were shipped in this session before
/// this form (07 §8; 05 §3.2).
///
/// `None` only once the owning epoch has aged out of the ring, where no
/// attribution is recoverable. The SQ-195 cover check then fails that epoch on
/// its missing day, which is the fail-static outcome.
fn epoch_and_day_at(at: BlockNumber) -> Option<(EpochId, u8)> {
    let day_of = |timing: &pallet_epoch::EpochTiming| {
        (at >= timing.start && at < timing.start.saturating_add(timing.length))
            .then(|| u8::try_from((at - timing.start) / BLOCKS_PER_DAY).unwrap_or(u8::MAX))
            .map(|day| (timing.index, day))
    };

    let info = pallet_epoch::EpochOf::<Runtime>::get();
    let schedule = pallet_epoch::Schedule::<Runtime>::get();
    // The live epoch has no end bound yet: anything at or after its start is its.
    if at >= schedule.epoch_start_block {
        let day =
            u8::try_from((at - schedule.epoch_start_block) / BLOCKS_PER_DAY).unwrap_or(u8::MAX);
        return Some((info.index, day));
    }
    pallet_epoch::EpochTimings::<Runtime>::get()
        .iter()
        .find_map(day_of)
}

/// The `(epoch, day)` window the current block is attributed to (05 §3.2).
///
/// The welfare pallet's `H` sampler reads this once per block. It is the *same*
/// derivation the XCM-health and reserve-probe recorders use, deliberately: one
/// block must not be attributed to two different days by two different
/// recorders, and the whole `(epoch, day)` series family is retired by one
/// shared bounded walk keyed on the epoch this returns.
pub struct RuntimeMeasurementWindow;
impl Get<(EpochId, u8)> for RuntimeMeasurementWindow {
    fn get() -> (EpochId, u8) {
        xcm_traffic_epoch_and_day()
    }
}

/// The single runtime endpoint for 05 §4.3.2's qualifying defensive-path
/// failures (`Π`).
///
/// Every increment in the runtime and in the pallets it wires goes through
/// here, and here derives the `(epoch, day)` window exactly once, so no site can
/// double-count and no two sites can disagree about which window a fault
/// belongs to (§4.3.2: "a single event increments it at most once").
///
/// **Which sites call it, and why the obvious ones do not.** §4.3.2 admits an
/// event iff the runtime detected a violation of an assumption it holds
/// unconditionally, *and* the fallback discarded correctness-relevant state or
/// engaged a fail-static latch, *and* no defined path later restores what was
/// lost. The third clause excludes bounded-maintenance backpressure by name, and
/// the runtime is full of it: a full `XcmTrafficEpochs` index dropping an
/// observation, a keeper crank that bails and is re-run next boundary, an
/// `UPGRADE_ABORT_TRIGGER` whose whole point is that the relay preserved the
/// status quo. None of those increment. The qualifying set is enumerated at each
/// call site, each carrying the clause that admitted it.
pub struct RuntimeIntegrityRecorder;
impl futarchy_primitives::integrity::IntegritySink for RuntimeIntegrityRecorder {
    fn note_integrity_failure(fault: futarchy_primitives::integrity::IntegrityFault) {
        let (epoch, day) = xcm_traffic_epoch_and_day();
        pallet_welfare::Pallet::<Runtime>::note_integrity_failure(epoch, day, fault);
    }
}

/// Fail-soft recorder for the three locally observable v1 XCM-health signals.
pub struct XcmTrafficRecorder;
impl bleavit_xcm::health::LocalXcmHealthSink for XcmTrafficRecorder {
    fn note_sent() {
        Self::record(pallet_welfare::XcmTrafficKind::Accepted);
    }

    fn note_send_failure() {
        Self::record(pallet_welfare::XcmTrafficKind::SendFailed);
    }

    fn note_probe_timeout() {
        Self::record(pallet_welfare::XcmTrafficKind::ProbeTimeout);
    }
}
impl XcmTrafficRecorder {
    fn record(kind: pallet_welfare::XcmTrafficKind) {
        let (epoch, day) = xcm_traffic_epoch_and_day();
        pallet_welfare::Pallet::<Runtime>::note_xcm_traffic(epoch, day, kind);
    }
}

pub struct InherentBoundaryStorage;
impl StorageInstance for InherentBoundaryStorage {
    fn pallet_prefix() -> &'static str {
        "BleavitRuntimeWelfare"
    }
    const STORAGE_PREFIX: &'static str = "InherentBoundary";
}
/// How many extrinsics of the current block were inherents.
///
/// Written once per block by [`BlockProductionInherentBoundary`] and read once
/// per block by [`BlockProductionRecorder`]; never carries meaning across a
/// block boundary.
pub type InherentBoundary = frame_support::storage::types::StorageValue<
    InherentBoundaryStorage,
    u32,
    frame_support::pallet_prelude::ValueQuery,
>;

pub struct BlockProductionWindowStorage;
impl StorageInstance for BlockProductionWindowStorage {
    fn pallet_prefix() -> &'static str {
        "BleavitRuntimeWelfare"
    }
    const STORAGE_PREFIX: &'static str = "BlockProductionWindow";
}
/// The `(epoch, day)` window this block's production is attributed to, stamped
/// with the block that captured it.
///
/// **Why it exists.** 05 §4.3.2 splits one block's observation across two hooks:
/// the relay-slot delta rides the parachain inherent (it must read
/// `LastRelayParent` before the detector advances it) and the emptiness
/// classification cannot be decided until the extrinsic count is final. Between
/// them sit the block's *transactions* — including the permissionless
/// `Epoch::tick`, which advances `EpochOf`/`Schedule`. Attributing each half
/// independently therefore split a boundary block across two epochs: the
/// completed epoch got a relay slot with no authored block (depressing its `U`)
/// and the opening epoch got an authored block with no slot (inflating its `U`
/// against a clamp that hides the inflation). Both feed the `S` pillar and gate
/// settlement, so the error is not cosmetic.
///
/// So the window is resolved **once**, at the inherent, and the post-transaction
/// hook consumes what was captured rather than recomputing it.
///
/// **Why the inherent's window and not the post-tick one.** 05 §4.3.2 fixes the
/// *deltas* — each block contributes `relay_parent(this) − relay_parent(previous)`
/// and `previous` crosses the window boundary — but leaves the partition of
/// blocks into windows to the epoch clock, so either window would charge every
/// relay slot exactly once and lose no outage. The inherent's answer is chosen
/// because it is the instant the slot is *observed*: the delta is measured
/// against a predecessor authored while this epoch was live, the relay-parent
/// read exists nowhere later in the block, and `epoch_and_day_at` already gives
/// the pre-tick epoch every other observation in the same block ("the live epoch
/// has no end bound yet"), so `U` stays attributed exactly like `X` and `R`.
///
/// One property follows and is accepted: a keeper that cranks
/// `record_snapshot(closing)` in the *same* block as the tick reads a denominator
/// that already carries this block's slot and a numerator that does not yet carry
/// its authored count, which cannot be avoided while emptiness is only decidable
/// after the transactions. It understates `U` by one block in `epoch.length`, and
/// understating is the safe direction (G-1).
///
/// **The block stamp makes the missing-capture case total.** The value is
/// consumed with `take`, and the consumer additionally requires the stamp to be
/// this block: an observation that cannot be attributed to the block that
/// captured it is *dropped*, never guessed into a window. That covers the
/// inherent's own early-return paths (a recovery-abort block never captures a
/// window, and so must not record an authored block either — a numerator with
/// no denominator is exactly the direction that overstates liveness) and any
/// execution path that reaches the post-transaction hook without the parachain
/// inherent having run.
pub type BlockProductionWindow = frame_support::storage::types::StorageValue<
    BlockProductionWindowStorage,
    (BlockNumber, EpochId, u8),
    frame_support::pallet_prelude::OptionQuery,
>;

/// Capture the inherent/transaction boundary for 05 §4.3.2's emptiness rule.
///
/// **How an inherent is distinguished.** Not by pallet, not by call name, and
/// not by a hardcoded count of this runtime's inherent providers — all three
/// would silently go wrong the moment the runtime gains or reorders one. The
/// distinction is taken from `frame_executive` itself, which is the only
/// component that knows it: the executive verifies that every inherent precedes
/// every transaction (`InvalidInherentPosition` otherwise) and then calls this
/// hook exactly once per block, in every execution path, at the instant the
/// last inherent has been applied and before the first transaction can be.
/// `extrinsic_index()` at that instant *is* the number of inherents in the
/// block, by construction.
///
/// The rule is total: `extrinsic_index()` is initialized to `Some(0)` by
/// `initialize_block` and the `unwrap_or_default` covers the case it is absent
/// anyway, so a block with no inherents at all records a boundary of zero and
/// is classified by its transactions like any other.
pub struct BlockProductionInherentBoundary;
impl PostInherents for BlockProductionInherentBoundary {
    fn post_inherents() {
        frame_system::Pallet::<Runtime>::register_extra_weight_unchecked(
            <Runtime as frame_system::Config>::DbWeight::get().reads_writes(1, 1),
            DispatchClass::Mandatory,
        );
        InherentBoundary::put(
            frame_system::Pallet::<Runtime>::extrinsic_index().unwrap_or_default(),
        );
    }
}

/// Record this block against 05 §4.3.2's numerator once its extrinsic count is
/// final.
///
/// `frame_executive` calls this immediately after `note_finished_extrinsics()`,
/// which is what publishes `ExtrinsicCount` — so this is the earliest point at
/// which the classification is decidable, and it precedes `on_idle`/`on_finalize`
/// so no later hook can change the answer.
///
/// **An empty block is one whose extrinsics are all inherents** (05 §4.3.2), so
/// the test is `extrinsic_count() <= boundary`. A block carrying calls that
/// failed or were filtered is deliberately **not** empty: it consumed its slot
/// and its weight, and `note_applied_extrinsic` counts it whatever the dispatch
/// returned. The comparison is `<=` rather than `==` so that a boundary left
/// stale-high by any path that skipped the boundary hook reads *empty* — the
/// direction that understates `U` rather than overstating it (G-1).
///
/// **The window is not recomputed here.** It is taken from
/// [`BlockProductionWindow`], captured by the parachain inherent before any
/// transaction could move the epoch clock. Recomputing it attributed this half of
/// the observation to a *different* window than its own relay slot whenever the
/// block carried an `Epoch::tick`, splitting one block across two epochs. A
/// missing or stale capture drops the observation entirely rather than choosing a
/// window for it.
pub struct BlockProductionRecorder;
impl PostTransactions for BlockProductionRecorder {
    fn post_transactions() {
        frame_system::Pallet::<Runtime>::register_extra_weight_unchecked(
            // The boundary, the extrinsic count, and the captured window — which
            // is consumed, hence the write. No `(epoch, day)` attribution runs
            // here any more; the accumulator write itself is benchmarked and
            // charged by the pallet writer.
            <Runtime as frame_system::Config>::DbWeight::get().reads_writes(3, 1),
            DispatchClass::Mandatory,
        );
        // Total and fail-soft: an observation that cannot be attributed to the
        // block that captured it is dropped, never guessed into a window.
        let Some((captured_at, epoch, day)) = BlockProductionWindow::take() else {
            return;
        };
        if captured_at != frame_system::Pallet::<Runtime>::block_number() {
            return;
        }
        let empty = frame_system::Pallet::<Runtime>::extrinsic_count() <= InherentBoundary::get();
        pallet_welfare::Pallet::<Runtime>::note_block_production(
            epoch,
            day,
            pallet_welfare::BlockProductionSignal::Authored { empty },
        );
    }
}

pub struct RuntimeEpochParams;
impl pallet_epoch::EpochParamsProvider for RuntimeEpochParams {
    fn get() -> pallet_epoch::CoreEpochParams {
        let v_min = [
            balance_param(b"dec.v_min.param"),
            balance_param(b"dec.v_min.trs"),
            balance_param(b"dec.v_min.code"),
            balance_param(b"dec.v_min.meta"),
            0,
        ];
        pallet_epoch::CoreEpochParams {
            epoch_length: u32_param(b"epoch.length"),
            epoch_slots: u8_param(b"epoch.slots"),
            horizon_k: u8_param(b"epoch.horizon_k"),
            decision_window: u32_param(b"dec.window"),
            trailing_window: u32_param(b"dec.trailing"),
            delta: [
                FixedU64(fixed_param(b"dec.delta.param")),
                FixedU64(fixed_param(b"dec.delta.trs")),
                FixedU64(fixed_param(b"dec.delta.code")),
                FixedU64(fixed_param(b"dec.delta.meta")),
                FixedU64(pallet_market::core_market::PRICE_ONE_1E9),
            ],
            sigma: [
                FixedU64(fixed_param(b"dec.sigma.param")),
                FixedU64(fixed_param(b"dec.sigma.trs")),
                FixedU64(fixed_param(b"dec.sigma.code")),
                FixedU64(fixed_param(b"dec.sigma.meta")),
                FixedU64(0),
            ],
            delta_max: FixedU64(fixed_param(b"dec.delta_max")),
            coverage_pct: percent_param(b"dec.coverage"),
            v_min,
            gate_v_min: [
                balance_param(b"gate.v_min.param"),
                balance_param(b"gate.v_min.trs"),
                balance_param(b"gate.v_min.code"),
                balance_param(b"gate.v_min.meta"),
                0,
            ],
            gate_p_max: [FixedU64(fixed_param(b"gate.p_max")); 2],
            gate_eps: [FixedU64(fixed_param(b"gate.eps")); 2],
            gate_nb_coverage_pct: percent_param(b"gate.nb_coverage"),
            gate_nb_convergence: FixedU64(fixed_param(b"gate.nb_conv")),
            timelock: [
                u32_param(b"exec.lock.param"),
                u32_param(b"exec.lock.trs"),
                u32_param(b"exec.lock.code"),
                u32_param(b"exec.lock.meta"),
                0,
            ],
            grace: [
                u32_param(b"exec.grace"),
                u32_param(b"exec.grace"),
                u32_param(b"exec.grace"),
                u32_param(b"exec.grace"),
                0,
            ],
            intake_max_per_account: u8_param(b"intake.max_acct"),
            intake_slash_pct: percent_param(b"intake.slash_pct"),
        }
    }
}
/// 03 §3 / §5.3a(5): the live `ledger.redeem_fee`, read from
/// `pallet-constitution::Params` on every use — 13 §1 makes it a PARAM row, so it
/// must not become a compile-time constant. A missing record already reads as 0
/// through `perbill_param`; an out-of-domain stored scalar is screened to 0 here
/// rather than clamped to 100 % by `Perbill::from_parts`, because §5.3a(5) says a
/// **malformed** record reads as zero and zero is the claimant-favouring direction.
pub struct LedgerRedemptionFee;
impl frame_support::traits::Get<Perbill> for LedgerRedemptionFee {
    fn get() -> Perbill {
        // Deliberately NOT `perbill_param`. That helper falls back to
        // `default_param` — the genesis seed, 30 bps — before it falls back to
        // zero, so a missing or wrong-kind record would charge a claimant from
        // state the runtime could not read. 15 §1 I-32(d) forbids exactly that:
        // "A missing, malformed or out-of-bounds rate record reads as **zero**,
        // not as a charge — the one place the ledger's fail-**open** direction
        // is the correct one, because it is the claimant-favouring one."
        //
        // The generic helper is right for `mkt.fee`, whose unreadable-record
        // direction is the opposite (a market that silently stopped charging a
        // maker fee is the unsafe one). This key is the exception, so it reads
        // `live_param` directly and every non-conforming shape resolves to zero.
        match live_param(pallet_constitution::key16(b"ledger.rdm_fee")) {
            Some(pallet_constitution::ParamValue::Perbill(parts))
                if parts <= Perbill::one().deconstruct() =>
            {
                Perbill::from_parts(parts)
            }
            _ => Perbill::zero(),
        }
    }
}

pub struct MarketFee;
impl frame_support::traits::Get<u128> for MarketFee {
    fn get() -> u128 {
        u128::from(perbill_param(b"mkt.fee") / 100_000)
    }
}
pub struct MarketObsInterval;
impl frame_support::traits::Get<u64> for MarketObsInterval {
    fn get() -> u64 {
        u64::from(u32_param(b"mkt.obs_interval"))
    }
}
pub struct MarketKappa;
impl frame_support::traits::Get<u64> for MarketKappa {
    fn get() -> u64 {
        fixed_param(b"mkt.kappa")
    }
}
pub struct LedgerMinSplit;
impl frame_support::traits::Get<Balance> for LedgerMinSplit {
    fn get() -> Balance {
        balance_param(b"ledger.min_split")
    }
}
pub struct LedgerPositionDeposit;
impl frame_support::traits::Get<Balance> for LedgerPositionDeposit {
    fn get() -> Balance {
        balance_param(b"ledger.pos_dep")
    }
}
pub struct LedgerArchiveDelay;
impl frame_support::traits::Get<u32> for LedgerArchiveDelay {
    fn get() -> u32 {
        u32_param(b"ledger.archive")
    }
}

/// Registry records must remain readable through the §11 money deadline even
/// when governance lowers the shared ledger archive delay. The registry has
/// no separate tunable: its contract binding is the live ledger value with
/// the independent 21-day floor mandated by 07 §7 (SQ-76).
pub struct RegistryArchiveDelay;
impl frame_support::traits::Get<u32> for RegistryArchiveDelay {
    fn get() -> u32 {
        LedgerArchiveDelay::get().max(21u32.saturating_mul(kernel::BLOCKS_PER_DAY))
    }
}

parameter_types! {
    pub const LedgerPalletId: PalletId = PalletId(*b"bl/ledgr");
    pub const ServiceLedgerPalletId: PalletId = PalletId(*b"bl/svclg");
    pub const QuestionServicePalletId: PalletId = PalletId(*b"bl/qserv");
    pub const ClientDeliveryPalletId: PalletId = PalletId(*b"bl/cdelv");
    pub const MarketPalletId: PalletId = PalletId(*b"bl/mrket");
    pub const EpochPalletId: PalletId = PalletId(*b"bl/epoch");
    pub const ExecutionGuardPalletId: PalletId = PalletId(*b"bl/exgrd");
    pub const GuardianPalletId: PalletId = PalletId(*b"bl/guard");
    pub const TreasuryPalletId: PalletId = PalletId(*b"bl/trsry");
    pub const IncidentPalletId: PalletId = PalletId(*b"bl/reg/i");
    pub const MilestonePalletId: PalletId = PalletId(*b"bl/reg/m");
    pub const OraclePalletId: PalletId = PalletId(*b"bl/oracl");
}
pub fn market_account() -> AccountId {
    MarketPalletId::get().into_account_truncating()
}
pub(crate) fn epoch_account() -> AccountId {
    EpochPalletId::get().into_account_truncating()
}
pub(crate) fn execution_guard_account() -> AccountId {
    ExecutionGuardPalletId::get().into_account_truncating()
}
pub(crate) fn guardian_account() -> AccountId {
    GuardianPalletId::get().into_account_truncating()
}
parameter_types! {
    pub GuardianAccount: AccountId = guardian_account();
}
pub fn welfare_settlement_account() -> AccountId {
    PalletId(*b"bl/welfr").into_account_truncating()
}
pub fn insurance_account() -> AccountId {
    LedgerPalletId::get().into_sub_account_truncating(*b"INSURANC")
}
pub fn book_account() -> AccountId {
    LedgerPalletId::get().into_sub_account_truncating(*b"BOOK____")
}
pub fn pol_account() -> AccountId {
    LedgerPalletId::get().into_sub_account_truncating(*b"POL_____")
}
pub fn pol_baseline_account() -> AccountId {
    LedgerPalletId::get().into_sub_account_truncating(*b"POL_BASE")
}
pub fn fee_account() -> AccountId {
    LedgerPalletId::get().into_sub_account_truncating(*b"FEES____")
}
pub fn treasury_protocol_account() -> AccountId {
    LedgerPalletId::get().into_sub_account_truncating(*b"TREASRY_")
}
/// 08 §1.1 KEEPER USDC custody pot, derived under the canonical `bl/trsry`
/// pallet id just like the genesis treasury/community/incentive pots.
pub fn treasury_keeper_account() -> AccountId {
    TreasuryPalletId::get().into_sub_account_truncating(*b"KEEPER__")
}
/// 08 §1.1 ORACLE USDC custody pot.
pub fn treasury_oracle_account() -> AccountId {
    TreasuryPalletId::get().into_sub_account_truncating(*b"ORACLE__")
}
/// 08 §1.1 REWARDS USDC custody pot, kept separate from the ORACLE/KEEPER
/// rebate pots so a crank budget cannot consume proposer rewards.
pub fn treasury_rewards_account() -> AccountId {
    TreasuryPalletId::get().into_sub_account_truncating(*b"REWARDS_")
}
/// 08 §1.1 OPS_COLLATOR USDC custody pot, isolated from discretionary ops.
pub fn treasury_collators_account() -> AccountId {
    TreasuryPalletId::get().into_sub_account_truncating(*b"COLLATOR")
}

pub struct EnsureMarketAccount;
impl frame_support::traits::EnsureOrigin<RuntimeOrigin> for EnsureMarketAccount {
    type Success = AccountId;
    fn try_origin(origin: RuntimeOrigin) -> Result<AccountId, RuntimeOrigin> {
        match EnsureSigned::<AccountId>::try_origin(origin.clone()) {
            Ok(who) if who == market_account() => Ok(who),
            _ => Err(origin),
        }
    }
    #[cfg(feature = "runtime-benchmarks")]
    fn try_successful_origin() -> Result<RuntimeOrigin, ()> {
        Ok(RuntimeOrigin::signed(market_account()))
    }
}
pub struct EnsureWelfareAccount;
impl frame_support::traits::EnsureOrigin<RuntimeOrigin> for EnsureWelfareAccount {
    type Success = AccountId;
    fn try_origin(origin: RuntimeOrigin) -> Result<AccountId, RuntimeOrigin> {
        match EnsureSigned::<AccountId>::try_origin(origin.clone()) {
            Ok(who) if who == welfare_settlement_account() => Ok(who),
            _ => Err(origin),
        }
    }
    #[cfg(feature = "runtime-benchmarks")]
    fn try_successful_origin() -> Result<RuntimeOrigin, ()> {
        Ok(RuntimeOrigin::signed(welfare_settlement_account()))
    }
}
pub struct EnsureEpochAccount;
impl frame_support::traits::EnsureOrigin<RuntimeOrigin> for EnsureEpochAccount {
    type Success = AccountId;
    fn try_origin(origin: RuntimeOrigin) -> Result<AccountId, RuntimeOrigin> {
        match EnsureSigned::<AccountId>::try_origin(origin.clone()) {
            Ok(who) if who == epoch_account() => Ok(who),
            _ => Err(origin),
        }
    }
    #[cfg(feature = "runtime-benchmarks")]
    fn try_successful_origin() -> Result<RuntimeOrigin, ()> {
        Ok(RuntimeOrigin::signed(epoch_account()))
    }
}

pub struct EnsureQuestionServiceAccount;
impl frame_support::traits::EnsureOrigin<RuntimeOrigin> for EnsureQuestionServiceAccount {
    type Success = AccountId;

    fn try_origin(origin: RuntimeOrigin) -> Result<AccountId, RuntimeOrigin> {
        match EnsureSigned::<AccountId>::try_origin(origin.clone()) {
            Ok(who) if who == QuestionService::account_id() => Ok(who),
            _ => Err(origin),
        }
    }

    #[cfg(feature = "runtime-benchmarks")]
    fn try_successful_origin() -> Result<RuntimeOrigin, ()> {
        Ok(RuntimeOrigin::signed(QuestionService::account_id()))
    }
}

/// Market-internal verifier for the compact client id manufactured by the
/// question pallet. The market API itself is not dispatchable.
pub struct EnsureQuestionServiceClient;
impl frame_support::traits::EnsureOrigin<RuntimeOrigin> for EnsureQuestionServiceClient {
    type Success = futarchy_primitives::ClientId;

    fn try_origin(origin: RuntimeOrigin) -> Result<Self::Success, RuntimeOrigin> {
        <pallet_client_registry::EnsureExternalClient as frame_support::traits::EnsureOrigin<
            RuntimeOrigin,
        >>::try_origin(origin)
    }

    #[cfg(feature = "runtime-benchmarks")]
    fn try_successful_origin() -> Result<RuntimeOrigin, ()> {
        Ok(pallet_client_registry::Origin::ExternalClient(0).into())
    }
}

/// Client-facing question origin: XCM supplies the exact N4 custom origin;
/// admitted off-chain services authenticate with their exact local signer.
pub struct EnsureQuestionClient;
impl frame_support::traits::EnsureOrigin<RuntimeOrigin> for EnsureQuestionClient {
    type Success = futarchy_primitives::ClientId;

    fn try_origin(origin: RuntimeOrigin) -> Result<Self::Success, RuntimeOrigin> {
        if let Ok(client) =
            <pallet_client_registry::EnsureExternalClient as frame_support::traits::EnsureOrigin<
                RuntimeOrigin,
            >>::try_origin(origin.clone())
        {
            return Ok(client);
        }
        match EnsureSigned::<AccountId>::try_origin(origin.clone()) {
            Ok(signer) => pallet_client_registry::Pallet::<Runtime>::client_id_of_signer(&signer)
                .ok_or(origin),
            Err(_) => Err(origin),
        }
    }

    #[cfg(feature = "runtime-benchmarks")]
    fn try_successful_origin() -> Result<RuntimeOrigin, ()> {
        Ok(pallet_client_registry::Origin::ExternalClient(0).into())
    }
}
pub struct EnsureExecutionGuardAccount;
impl frame_support::traits::EnsureOrigin<RuntimeOrigin> for EnsureExecutionGuardAccount {
    type Success = AccountId;
    fn try_origin(origin: RuntimeOrigin) -> Result<AccountId, RuntimeOrigin> {
        match EnsureSigned::<AccountId>::try_origin(origin.clone()) {
            Ok(who) if who == execution_guard_account() => Ok(who),
            _ => Err(origin),
        }
    }
    #[cfg(feature = "runtime-benchmarks")]
    fn try_successful_origin() -> Result<RuntimeOrigin, ()> {
        Ok(RuntimeOrigin::signed(execution_guard_account()))
    }
}
fn reserved_market_id(who: &AccountId) -> Option<u64> {
    let bytes: &[u8] = who.as_ref();
    if bytes[..MARKET_ACCOUNT_PREFIX.len()] != MARKET_ACCOUNT_PREFIX
        || !matches!(bytes[16], MARKET_BOOK_KIND | MARKET_FEES_KIND)
        || !bytes[25..].iter().all(|byte| *byte == 0)
    {
        return None;
    }
    let mut id = [0_u8; 8];
    id.copy_from_slice(&bytes[17..25]);
    Some(u64::from_le_bytes(id))
}

#[cfg(test)]
pub(crate) fn is_reserved_market_account(who: &AccountId) -> bool {
    reserved_market_id(who).is_some()
}

fn is_primary_protocol_account(who: &AccountId) -> bool {
    if reserved_market_id(who).is_some_and(|id| id < kernel::SERVICE_ID_BASE) {
        return true;
    }
    let accounts = [
        LedgerPalletId::get().into_account_truncating(),
        market_account(),
        book_account(),
        pol_account(),
        pol_baseline_account(),
        fee_account(),
        treasury_protocol_account(),
        insurance_account(),
        IncidentPalletId::get().into_account_truncating(),
        MilestonePalletId::get().into_account_truncating(),
        welfare_settlement_account(),
        epoch_account(),
        execution_guard_account(),
        OraclePalletId::get().into_account_truncating(),
    ];
    accounts.contains(who)
}

fn is_service_protocol_account(who: &AccountId) -> bool {
    reserved_market_id(who).is_some_and(|id| id >= kernel::SERVICE_ID_BASE)
        || *who == ServiceLedgerPalletId::get().into_account_truncating()
        || *who == QuestionServicePalletId::get().into_account_truncating()
}

/// Pure canonical predicate used inside the XCM inflow precheck. It performs
/// no storage reads, so the barrier's fixed execution budget remains honest.
pub struct InflowCapProtocolAccounts;
impl Contains<AccountId> for InflowCapProtocolAccounts {
    fn contains(who: &AccountId) -> bool {
        // This predicate remains independently owned by 09 §5.2. Both
        // protocol domains are internal inflow destinations, but membership
        // here does not grant either ledger's local position exemptions.
        is_primary_protocol_account(who) || is_service_protocol_account(who)
    }
}

pub struct ProtocolAccounts;
impl Contains<AccountId> for ProtocolAccounts {
    fn contains(who: &AccountId) -> bool {
        is_primary_protocol_account(who)
            // The treasury `MAIN` account (E2). 03 §7 R-4 already lists it among
            // the twelve genesis-endowed permanent protocol accounts, and 04 §2
            // / 04 §6.1 make it the recipient of the Sweep's fee remittance —
            // which the ledger's return surface only pays to protocol custody
            // (03 §5.5 `ensure_protocol_return`). Classifying it here therefore
            // states what 03 §7 R-4 already says. Two further consequences are
            // both wanted: a Signed ledger transfer *into* `MAIN` is refused
            // (it must never custody conditional positions), and its fee
            // redemptions are exempt from the 03 §5.3a redemption fee, so
            // protocol revenue does not pay itself a fee.
            //
            // It is deliberately **not** added to `is_canonical_protocol_account`:
            // that predicate also drives `InflowCapProtocolAccounts`, whose
            // members are exempt from the 09 §5.2 per-account Phase-3 deposit
            // meter. E2 has no reason to widen an inflow cap, so it does not.
            || *who == crate::genesis::treasury_account()
            // The refcounted index records ownership of live/retained market
            // accounts. Classification does not depend on this index: every
            // canonical future/present/past address is reserved above.
            || reserved_market_id(who).is_some_and(|id| id < kernel::SERVICE_ID_BASE)
    }
}

/// Per-instance service exemptions. This must never include a primary book,
/// primary ledger sovereign, or client funder (03 §1a / I-37).
pub struct ServiceProtocolAccounts;
impl Contains<AccountId> for ServiceProtocolAccounts {
    fn contains(who: &AccountId) -> bool {
        is_service_protocol_account(who)
            // The treasury `MAIN` account, for the SAME reason the primary
            // wrapper above carries it, and it was missing here — found by
            // adversarial review, 2026-08-03. 16 §7.4 makes external trading
            // and redemption fees accrue to Bleavit `MAIN` as service revenue,
            // `sweep_revenue` pays that leg through the owning instance's
            // ledger return surface, and 03 §5.5 `ensure_protocol_return` only
            // pays protocol custody. Without this the external fee sweep failed
            // `TryStateViolation` and stranded every hosted book's revenue and
            // its fee positions with it — the one instrument-A/B path 16 §8.1
            // calls "no new code" was the path that did not work.
            //
            // Same three consequences the primary carve-out wants, and each is
            // wanted here too: `MAIN` is refused as a Signed transfer
            // destination in this instance as well, its fee redemptions skip
            // the 03 §5.3a redemption fee so service revenue does not pay
            // itself a fee, and it stays out of `is_service_protocol_account`
            // so `InflowCapProtocolAccounts` is not widened.
            || *who == crate::genesis::treasury_account()
    }
}

/// Destination-only union across both instances. It grants no deposit, fee,
/// or inflow-cap exemption (03 §1a).
pub struct ReservedProtocolAccounts;
impl Contains<AccountId> for ReservedProtocolAccounts {
    fn contains(who: &AccountId) -> bool {
        ProtocolAccounts::contains(who) || ServiceProtocolAccounts::contains(who)
    }
}
parameter_types! { pub InsuranceAccount: AccountId = insurance_account(); }

/// Bind the ledger's treasury-free 03 §5.4 residue seam to the exact
/// `SweptResidueUnreclaimed` writer that derives 08 §1.2's INSURANCE target.
/// No unit implementation exists on the trait, so production cannot silently
/// replace this with a no-op.
pub struct RuntimeResidueReporter;

impl pallet_conditional_ledger::ResidueReporter for RuntimeResidueReporter {
    fn note_swept_residue(amount: Balance) -> DispatchResult {
        FutarchyTreasury::note_swept_residue(amount)
    }
}

impl pallet_conditional_ledger::Config<()> for Runtime {
    type Collateral = ForeignAssets;
    type UsdcAssetId = UsdcAssetId;
    // 03 §5.3a. The rate is live (13 §1 PARAM row), and the sink is the 08 §1.1
    // `MAIN` account 03 §5.4 names — the same `treasury_account()` E2/E3 binds as
    // `pallet_market`'s `MainAccount`, so both revenue legs land in one place.
    type RedemptionFee = LedgerRedemptionFee;
    type TreasuryMainAccount = TreasuryMainAccount;
    type MarketAuthority = EnsureMarketAccount;
    type ResolveAuthority = EnsureEpochAccount;
    type SettleAuthority = EnsureWelfareAccount;
    type EmergencyPlaybookOrigin = pallet_origins::EnsureEmergencyPlaybook;
    type MinSplit = LedgerMinSplit;
    type PositionDeposit = LedgerPositionDeposit;
    type MaxPositionsPerAccount = ConstU32<{ bounds::MAX_ACCOUNT_POSITIONS }>;
    type ArchiveDelay = LedgerArchiveDelay;
    type ReapBatch = ConstU32<{ kernel::REAP_BATCH }>;
    type ProtocolAccounts = ProtocolAccounts;
    type ReservedProtocolDestinations = ReservedProtocolAccounts;
    type InsuranceAccount = InsuranceAccount;
    type MarketSweepStatus = pallet_market::PrimaryMarketSweepStatus<Runtime>;
    type ResidueReporter = RuntimeResidueReporter;
    type MainRevenueSink = RuntimeMainRevenueSink;
    type PalletId = LedgerPalletId;
    type KeeperRebate = FutarchyTreasury;
    type InflowCapGate = RuntimeLedgerInflowCapGate;
    type WeightInfo = crate::weights::pallet_conditional_ledger::WeightInfo<Runtime>;
    #[cfg(feature = "runtime-benchmarks")]
    type BenchmarkHelper = RuntimeBenchmarkHelper;
}

impl pallet_conditional_ledger::Config<frame_support::instances::Instance1> for Runtime {
    type Collateral = ForeignAssets;
    type UsdcAssetId = UsdcAssetId;
    type RedemptionFee = LedgerRedemptionFee;
    type TreasuryMainAccount = TreasuryMainAccount;
    type MarketAuthority = EnsureMarketAccount;
    type ResolveAuthority = EnsureQuestionServiceAccount;
    type SettleAuthority = EnsureQuestionServiceAccount;
    type EmergencyPlaybookOrigin = pallet_origins::EnsureEmergencyPlaybook;
    type MinSplit = LedgerMinSplit;
    type PositionDeposit = LedgerPositionDeposit;
    type MaxPositionsPerAccount = ConstU32<{ bounds::MAX_ACCOUNT_POSITIONS }>;
    type ArchiveDelay = LedgerArchiveDelay;
    type ReapBatch = ConstU32<{ kernel::REAP_BATCH }>;
    type ProtocolAccounts = ServiceProtocolAccounts;
    type ReservedProtocolDestinations = ReservedProtocolAccounts;
    type InsuranceAccount = InsuranceAccount;
    type MarketSweepStatus = pallet_market::ExternalMarketSweepStatus<Runtime>;
    type ResidueReporter = RuntimeResidueReporter;
    type MainRevenueSink = RuntimeMainRevenueSink;
    type PalletId = ServiceLedgerPalletId;
    type KeeperRebate = FutarchyTreasury;
    type InflowCapGate = RuntimeLedgerInflowCapGate;
    type WeightInfo = crate::weights::pallet_conditional_ledger::WeightInfo<Runtime>;
    #[cfg(feature = "runtime-benchmarks")]
    type BenchmarkHelper = RuntimeBenchmarkHelper;
}

const MARKET_ACCOUNT_PREFIX: [u8; 16] = *b"bleavit/mkt/v1\0\0";
const MARKET_BOOK_KIND: u8 = b'B';
const MARKET_FEES_KIND: u8 = b'F';

fn reserved_market_account(kind: u8, id: futarchy_primitives::MarketId) -> AccountId {
    let mut bytes = [0_u8; 32];
    bytes[..MARKET_ACCOUNT_PREFIX.len()].copy_from_slice(&MARKET_ACCOUNT_PREFIX);
    bytes[16] = kind;
    bytes[17..25].copy_from_slice(&id.to_le_bytes());
    AccountId::new(bytes)
}

pub(crate) fn market_book_account(id: futarchy_primitives::MarketId) -> AccountId {
    reserved_market_account(MARKET_BOOK_KIND, id)
}

pub(crate) fn market_fee_account(id: futarchy_primitives::MarketId) -> AccountId {
    reserved_market_account(MARKET_FEES_KIND, id)
}

pub struct RuntimeMarketAccounts;
impl pallet_market::MarketAccountProvider<AccountId> for RuntimeMarketAccounts {
    fn book(id: futarchy_primitives::MarketId) -> AccountId {
        market_book_account(id)
    }

    fn fees(id: futarchy_primitives::MarketId) -> AccountId {
        market_fee_account(id)
    }
}

fn epoch_signed_origin() -> RuntimeOrigin {
    RuntimeOrigin::signed(epoch_account())
}

fn market_window_end(id: futarchy_primitives::MarketId) -> Option<BlockNumber> {
    let book = pallet_market::Markets::<Runtime>::get(id)?;
    match book.kind {
        pallet_market::core_market::BookKind::Decision { proposal, .. }
        | pallet_market::core_market::BookKind::Gate { proposal, .. } => {
            pallet_epoch::Proposals::<Runtime>::get(proposal).map(|record| record.decide_at)
        }
        pallet_market::core_market::BookKind::Baseline { .. } => {
            // At most MaxLiveProposals=32 entries. The latest due pair selects
            // the Baseline window; equal closes deduplicate naturally.
            let now = System::block_number();
            pallet_epoch::Proposals::<Runtime>::iter_values()
                .filter(|proposal| {
                    proposal
                        .markets
                        .is_some_and(|markets| markets.baseline == id)
                        && proposal.decide_at <= now
                })
                .map(|proposal| proposal.decide_at)
                .max()
        }
        pallet_market::core_market::BookKind::External { .. } => None,
    }
}

pub(crate) fn class_pol_floor(class: futarchy_primitives::ProposalClass) -> Balance {
    match class {
        futarchy_primitives::ProposalClass::Param => balance_param(b"pol.b.param"),
        futarchy_primitives::ProposalClass::Treasury => balance_param(b"pol.b.trs"),
        futarchy_primitives::ProposalClass::Code => balance_param(b"pol.b.code"),
        futarchy_primitives::ProposalClass::Meta => balance_param(b"pol.b.meta"),
        futarchy_primitives::ProposalClass::Constitutional => 0,
    }
}

pub(crate) fn proposal_class_index(class: futarchy_primitives::ProposalClass) -> usize {
    match class {
        futarchy_primitives::ProposalClass::Param => 0,
        futarchy_primitives::ProposalClass::Treasury => 1,
        futarchy_primitives::ProposalClass::Code => 2,
        futarchy_primitives::ProposalClass::Meta => 3,
        futarchy_primitives::ProposalClass::Constitutional => 4,
    }
}

/// 08 §5.4's P_ref, using the same maker-loss floor as the market books. All
/// arithmetic is checked; an unrepresentable certificate is unavailable and
/// therefore cannot seed or adopt a proposal.
fn proposal_p_ref(class: futarchy_primitives::ProposalClass, b_floor: Balance) -> Option<Balance> {
    let index = proposal_class_index(class);
    if index >= 4 {
        return None;
    }
    let depth = pallet_market::core_market::maker_loss_floor(b_floor.checked_mul(2)?)?;
    depth
        .checked_add(<RuntimeEpochParams as pallet_epoch::EpochParamsProvider>::get().v_min[index])
        .and_then(|value| value.checked_div(2))
}

fn ceil_mul_div(value: Balance, numerator: Balance, denominator: Balance) -> Option<Balance> {
    if denominator == 0 {
        return None;
    }
    value
        .checked_mul(numerator)?
        .checked_add(denominator.saturating_sub(1))
        .and_then(|product| product.checked_div(denominator))
}

/// 08 §5.2's certified capability-envelope value for the three non-TREASURY
/// binding classes, read from the live `sec.prize.*` records (13 §1, SQ-173).
///
/// A zero or absent record is **not** a prize of zero: 13 §1 states that an
/// undefined proxy means the proposal MUST NOT pass sizing, so it renders as
/// `None` and leaves the proposal retryable rather than adopting an
/// under-secured payload. TREASURY derives its prize exactly from the ask and
/// Constitutional runs no markets, so neither has a row here.
fn class_security_envelope(class: futarchy_primitives::ProposalClass) -> Option<Balance> {
    let key: &[u8] = match class {
        futarchy_primitives::ProposalClass::Param => b"sec.prize.param",
        futarchy_primitives::ProposalClass::Code => b"sec.prize.code",
        futarchy_primitives::ProposalClass::Meta => b"sec.prize.meta",
        futarchy_primitives::ProposalClass::Treasury
        | futarchy_primitives::ProposalClass::Constitutional => return None,
    };
    // Deliberately the **live** record, never the compile-time default table:
    // a chain whose envelope row is genuinely missing from storage must fail
    // closed at step 9 rather than silently inherit a default it never ratified
    // (13 reading rule 2; G-1). The genesis seed is what makes the row present
    // on a conforming chain.
    live_balance_param(key).filter(|value| *value > 0)
}

/// Whether a CODE/META payload authorizes a runtime upgrade, which 08 §5.2
/// floors at `trs.cap_proposal · spendable NAV`. An undecodable or unpinned
/// preimage answers **yes**: the floor can only raise the prize, so the
/// claimant-adverse reading is the one that cannot let an upgrade through
/// under-secured (R-7).
fn carries_upgrade_payload(proposal: &futarchy_primitives::Proposal<AccountId>) -> bool {
    use pallet_execution_guard::BatchDispatcher;
    let Some(calls) = proposal_calls(proposal) else {
        return true;
    };
    calls.iter().any(|call| {
        crate::classifier::RuntimeDispatcher::rederive_call(call).is_ok_and(|analysis| {
            analysis.domains.iter().any(|domain| {
                matches!(
                    domain,
                    pallet_execution_guard::CallDomain::InternalRootAuthorizeUpgrade
                        | pallet_execution_guard::CallDomain::InternalRootApplyUpgrade
                )
            })
        })
    })
}

fn scaled_pol_floor(
    class: futarchy_primitives::ProposalClass,
    floor: Balance,
    prize: Balance,
) -> Option<Balance> {
    let p_ref = proposal_p_ref(class, floor)?;
    if prize <= p_ref {
        Some(floor)
    } else {
        ceil_mul_div(floor, prize, p_ref)
    }
}

fn scaled_decision_delta(
    class: futarchy_primitives::ProposalClass,
    floor: u64,
    prize: Balance,
) -> Option<u64> {
    let index = proposal_class_index(class);
    if index >= 4 {
        return None;
    }
    // 08 §5.3 scales from the class's governed `dec.delta` floor.  The
    // kernel minimum only constrains that live value; it is not the slope
    // base for a qualification-time certificate.
    let floor = u128::from(floor);
    let p_ref = proposal_p_ref(class, class_pol_floor(class))?;
    let scaled = if prize <= p_ref {
        floor
    } else {
        ceil_mul_div(floor, prize, p_ref)?
    };
    u64::try_from(scaled.min(100_000_000_u128)).ok()
}

/// Exact Ask-scaled contest floor enforced per decision book (05 §5.2; 08
/// §5.3; 13 `dec.v_min`): `max(dec.v_min(class), 2P)`. Both the grade adapter
/// and `FutarchyApi::decision_stats` call this helper, so the view can never
/// report a floor the grade does not enforce.
///
/// An **unavailable** prize proxy (SQ-173 leaves `in_cap_prize` unbacked for
/// every non-TREASURY class) keeps the base `dec.v_min` floor rather than
/// voiding the grade. The distinction is economic, not cosmetic: a missing
/// prize is a security-sizing *input* gap, not evidence that the book lacked
/// coverage or contest depth. At the sizing step, `decide` resolves that gap
/// through terminal T10 `Reject(SecuritySizing)`, with the intake bond fully
/// refunded. Voiding the grade instead would reach `Reject(NotDecisionGrade)`
/// first and slash 10% of the proposer's intake bond (06 §4; 08 §7) for an
/// input the chain, not the proposer, is missing.
///
/// The `2P` doubling saturates: it can only raise the floor, never wrap it
/// down into a permissive value.
/// Takes `v_min` rather than the whole `CoreEpochParams` so the 16 §8.7
/// starvation probe can call it after four parameter reads instead of the ~30
/// that materializing a full `CoreEpochParams` costs. One definition, so the
/// probe's floor and the grading path's floor cannot diverge.
pub(crate) fn effective_decision_contest_floor(
    proposal: &futarchy_primitives::Proposal<AccountId>,
    v_min: &[Balance; 5],
) -> Balance {
    let base = v_min[proposal_class_index(proposal.class)];
    match <RuntimeConstitutionAccess as pallet_epoch::ConstitutionAccess<AccountId>>::in_cap_prize(
        proposal,
    ) {
        Some(prize) => base.max(prize.saturating_mul(2)),
        None => base,
    }
}

fn contest_floor_for_grade(
    market: futarchy_primitives::MarketId,
    end: BlockNumber,
    role: pallet_epoch::BookRole,
    class: futarchy_primitives::ProposalClass,
    params: &pallet_epoch::CoreEpochParams,
) -> Option<Balance> {
    let book = pallet_market::Markets::<Runtime>::get(market)?;
    match book.kind {
        pallet_market::core_market::BookKind::Decision { proposal, .. } => {
            matches!(role, pallet_epoch::BookRole::Decision)
                .then_some(())
                .and_then(|()| pallet_epoch::Proposals::<Runtime>::get(proposal))
                .filter(|proposal| proposal.class == class && proposal.decide_at == end)
                .map(|proposal| effective_decision_contest_floor(&proposal, &params.v_min))
        }
        pallet_market::core_market::BookKind::Gate { proposal, .. } => {
            matches!(role, pallet_epoch::BookRole::Gate)
                .then(|| params.gate_v_min[proposal_class_index(class)])
                .filter(|_| {
                    pallet_epoch::Proposals::<Runtime>::get(proposal).is_some_and(|proposal| {
                        proposal.class == class && proposal.decide_at == end
                    })
                })
        }
        pallet_market::core_market::BookKind::Baseline { .. } => {
            if !matches!(role, pallet_epoch::BookRole::Baseline) {
                return None;
            }
            pallet_epoch::Proposals::<Runtime>::iter_values()
                .filter(|proposal| {
                    proposal.class == class
                        && proposal.decide_at == end
                        && proposal
                            .markets
                            .is_some_and(|markets| markets.baseline == market)
                })
                .map(|proposal| effective_decision_contest_floor(&proposal, &params.v_min))
                .max()
        }
        pallet_market::core_market::BookKind::External { .. } => None,
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct RuntimeDecisionMarketStats {
    pub coverage_pct: u8,
    pub traded_volume: Balance,
    pub v_min_required: Balance,
}

fn decision_book_window_stats(
    market: futarchy_primitives::MarketId,
    end: BlockNumber,
    window: BlockNumber,
) -> Option<(u8, Balance)> {
    let start = end.checked_sub(window)?;
    let stats = pallet_market::DecisionWindows::<Runtime>::get(market)
        .into_iter()
        .find(|record| record.start == start && record.end == end && record.sealed)?;
    if !stats.contest_valid {
        return None;
    }
    let interval = u32::try_from(MarketObsInterval::get()).ok()?;
    let expected = window.checked_div(interval)?;
    if expected == 0 {
        return None;
    }
    // Actual scheduled-interval coverage uses the same observations/window/
    // interval sources as market-core's division-free grade predicate. The
    // display rounds down and caps surplus observations at 100%.
    let coverage = stats
        .observations
        .saturating_mul(100)
        .checked_div(expected)?
        .min(100);
    let coverage_pct = u8::try_from(coverage).ok()?;
    let traded_volume = stats
        .contest_capital_blocks
        .checked_div(Balance::from(window))?;
    Some((coverage_pct, traded_volume))
}

/// Proposal-level projection of the two per-book grade records. 05 §5.2
/// grades Accept and Reject independently, while 02 §4 exposes one coverage
/// and one volume scalar, so the projection takes the conservative minimum:
/// the displayed statistic clears a per-book threshold iff both books do.
pub(crate) fn decision_market_stats_for_view(
    proposal: &futarchy_primitives::Proposal<AccountId>,
    params: &pallet_epoch::CoreEpochParams,
) -> Option<RuntimeDecisionMarketStats> {
    let markets = proposal.markets?;
    let accept =
        decision_book_window_stats(markets.accept, proposal.decide_at, params.decision_window)?;
    let reject =
        decision_book_window_stats(markets.reject, proposal.decide_at, params.decision_window)?;
    let accept_floor = contest_floor_for_grade(
        markets.accept,
        proposal.decide_at,
        pallet_epoch::BookRole::Decision,
        proposal.class,
        params,
    )?;
    let reject_floor = contest_floor_for_grade(
        markets.reject,
        proposal.decide_at,
        pallet_epoch::BookRole::Decision,
        proposal.class,
        params,
    )?;
    if accept_floor != reject_floor {
        return None;
    }
    Some(RuntimeDecisionMarketStats {
        coverage_pct: accept.0.min(reject.0),
        traded_volume: accept.1.min(reject.1),
        v_min_required: accept_floor,
    })
}

pub struct RuntimeMarketAccess;

/// Runtime-owned Baseline carry predicate. A shared Baseline has no proposal
/// class, so its sealed carry is graded at the fixed TREASURY-tier floor from
/// 05 §5.2 rather than at any consumer proposal's effective floor.
pub struct RuntimeBaselineGrade;

#[cfg_attr(feature = "runtime-benchmarks", allow(unreachable_code))]
impl pallet_market::BaselineGrade for RuntimeBaselineGrade {
    fn is_gradeable(
        market: futarchy_primitives::MarketId,
        end: BlockNumber,
        window: BlockNumber,
    ) -> bool {
        #[cfg(feature = "runtime-benchmarks")]
        {
            let _ = (market, end, window);
            return true;
        }
        let Some(book) = pallet_market::Markets::<Runtime>::get(market) else {
            return false;
        };
        if !matches!(
            book.kind,
            pallet_market::core_market::BookKind::Baseline { .. }
        ) {
            return false;
        }
        let params = <RuntimeEpochParams as pallet_epoch::EpochParamsProvider>::get();
        let contest_floor =
            params.v_min[proposal_class_index(futarchy_primitives::ProposalClass::Treasury)];
        pallet_market::Pallet::<Runtime>::decision_grade_at(
            market,
            end,
            window,
            params.coverage_pct,
            params.delta_max,
            contest_floor,
            balance_param(b"pol.b_baseline"),
            true,
        )
    }
}

#[cfg_attr(feature = "runtime-benchmarks", allow(unreachable_code))]
impl pallet_epoch::MarketAccess<AccountId> for RuntimeMarketAccess {
    fn open_markets(
        proposal: &futarchy_primitives::Proposal<AccountId>,
        rerun: bool,
        seed_plan: Option<pallet_epoch::PolSeedPlan>,
    ) -> Result<futarchy_primitives::MarketSet, DispatchError> {
        let requires_gate_markets = seed_plan.map_or_else(
            || {
                proposal
                    .markets
                    .is_some_and(|markets| markets.gates.is_some())
            },
            |plan| plan.gate_b.is_some(),
        );
        #[cfg(feature = "runtime-benchmarks")]
        {
            // The epoch weights predate B5 calibration, but their fixtures
            // must still execute through the assembled runtime.  The sibling
            // market pallet benchmarks the bounded book writes; this adapter
            // supplies deterministic decision telemetry while preserving the
            // real conditional-ledger vault used by settlement.
            if !pallet_conditional_ledger::Vaults::<Runtime>::contains_key(proposal.id) {
                ConditionalLedger::create_vault(
                    RuntimeOrigin::signed(market_account()),
                    proposal.id,
                    proposal.metric_spec,
                )?;
            }
            let _ = rerun;
            return Ok(benchmark_market_set(
                proposal.id,
                proposal.epoch,
                requires_gate_markets,
            ));
        }

        use futarchy_primitives::{Branch, GateType, MarketSet};
        use pallet_market::core_market::BookKind;

        let params = <RuntimeEpochParams as pallet_epoch::EpochParamsProvider>::get();
        let now = System::block_number();
        let end = if rerun {
            now.checked_add(kernel::DEC_EXTENSION_BLOCKS)
                .ok_or(DispatchError::Arithmetic(
                    sp_runtime::ArithmeticError::Overflow,
                ))?
        } else {
            proposal.decide_at
        };
        let start = end
            .checked_sub(params.decision_window)
            .ok_or(DispatchError::Arithmetic(
                sp_runtime::ArithmeticError::Underflow,
            ))?;
        let trailing_start =
            end.checked_sub(params.trailing_window)
                .ok_or(DispatchError::Arithmetic(
                    sp_runtime::ArithmeticError::Underflow,
                ))?;

        if rerun {
            let markets = proposal
                .markets
                .ok_or(DispatchError::Other("rerun market set missing"))?;
            if markets.gates.is_some() != requires_gate_markets {
                return Err(DispatchError::Other("rerun gate market invariant"));
            }
            let mut ids = Vec::from([markets.accept, markets.reject]);
            if let Some(gates) = markets.gates {
                ids.extend(gates);
            }
            for id in ids {
                pallet_market::Pallet::<Runtime>::reopen_for_rerun(epoch_signed_origin(), id)?;
                pallet_market::Pallet::<Runtime>::register_decision_window(
                    epoch_signed_origin(),
                    id,
                    proposal.id,
                    start,
                    trailing_start,
                    end,
                )?;
            }
            pallet_market::Pallet::<Runtime>::seed_rerun_branch_pair(
                epoch_signed_origin(),
                markets.accept,
                markets.reject,
                pol_account(),
            )?;
            if let Some(gates) = markets.gates {
                for pair in [[gates[0], gates[1]], [gates[2], gates[3]]] {
                    pallet_market::Pallet::<Runtime>::seed_rerun_branch_pair(
                        epoch_signed_origin(),
                        pair[0],
                        pair[1],
                        pol_account(),
                    )?;
                }
            }
            pallet_market::Pallet::<Runtime>::reopen_baseline_for_rerun(
                epoch_signed_origin(),
                markets.baseline,
            )?;
            pallet_market::Pallet::<Runtime>::register_decision_window(
                epoch_signed_origin(),
                markets.baseline,
                proposal.id,
                start,
                trailing_start,
                end,
            )?;
            return Ok(markets);
        }

        let seed_plan = seed_plan.ok_or(DispatchError::Other("funded POL seed plan missing"))?;

        if let Some(vault) = pallet_conditional_ledger::Vaults::<Runtime>::get(proposal.id) {
            if vault.spec != proposal.metric_spec {
                return Err(DispatchError::Other("proposal metric-spec vault mismatch"));
            }
        } else {
            ConditionalLedger::create_vault(
                RuntimeOrigin::signed(market_account()),
                proposal.id,
                proposal.metric_spec,
            )?;
        }

        let create = |kind: BookKind, b: Balance| {
            let id = pallet_market::Pallet::<Runtime>::allocate_market_id(epoch_signed_origin())?;
            pallet_market::Pallet::<Runtime>::create_market(
                epoch_signed_origin(),
                id,
                kind,
                proposal.epoch,
                market_book_account(id),
                market_fee_account(id),
                b,
            )?;
            pallet_market::Pallet::<Runtime>::register_decision_window(
                epoch_signed_origin(),
                id,
                proposal.id,
                start,
                trailing_start,
                end,
            )?;
            Ok::<_, DispatchError>(id)
        };

        let b = seed_plan.decision_b;
        // A8 fail-closed: the simulation-gated P/P_ref slope has no verified
        // on-chain P_ref backing yet. The normative floor is used; effective
        // v_min=2P still prevents under-sized adoption — owner Phase-0/SQ-177.
        let accept = create(
            BookKind::Decision {
                proposal: proposal.id,
                branch: Branch::Accept,
            },
            b,
        )?;
        let reject = create(
            BookKind::Decision {
                proposal: proposal.id,
                branch: Branch::Reject,
            },
            b,
        )?;
        pallet_market::Pallet::<Runtime>::seed_branch_pair(
            epoch_signed_origin(),
            accept,
            reject,
            pol_account(),
        )?;
        let gates = if let Some(gate_b) = seed_plan.gate_b {
            let ids = [
                create(
                    BookKind::Gate {
                        proposal: proposal.id,
                        branch: Branch::Accept,
                        gate: GateType::Survival,
                    },
                    gate_b,
                )?,
                create(
                    BookKind::Gate {
                        proposal: proposal.id,
                        branch: Branch::Reject,
                        gate: GateType::Survival,
                    },
                    gate_b,
                )?,
                create(
                    BookKind::Gate {
                        proposal: proposal.id,
                        branch: Branch::Accept,
                        gate: GateType::Security,
                    },
                    gate_b,
                )?,
                create(
                    BookKind::Gate {
                        proposal: proposal.id,
                        branch: Branch::Reject,
                        gate: GateType::Security,
                    },
                    gate_b,
                )?,
            ];
            for pair in [[ids[0], ids[1]], [ids[2], ids[3]]] {
                pallet_market::Pallet::<Runtime>::seed_branch_pair(
                    epoch_signed_origin(),
                    pair[0],
                    pair[1],
                    pol_account(),
                )?;
            }
            Some(ids)
        } else {
            None
        };
        let baseline = match pallet_market::BaselineMarketOf::<Runtime>::get(proposal.epoch) {
            Some(id) => {
                pallet_market::Pallet::<Runtime>::register_decision_window(
                    epoch_signed_origin(),
                    id,
                    proposal.id,
                    start,
                    trailing_start,
                    end,
                )?;
                id
            }
            None => {
                let id = create(
                    BookKind::Baseline {
                        epoch: proposal.epoch,
                    },
                    balance_param(b"pol.b_baseline"),
                )?;
                pallet_market::Pallet::<Runtime>::seed(
                    epoch_signed_origin(),
                    id,
                    pol_baseline_account(),
                )?;
                // 03 §7 R-4: Seed is the earliest point at which this
                // per-market account exists. Only the Baseline book custodies
                // plain USDC; its permanent floor makes Preserve custody
                // satisfiable when a retained sell fee is below min_balance.
                let asset = usdc_location();
                let source = pol_baseline_account();
                let book = market_book_account(id);
                let minimum_balance =
                    <ForeignAssets as Inspect<AccountId>>::minimum_balance(asset.clone());
                let book_balance =
                    <ForeignAssets as Inspect<AccountId>>::balance(asset.clone(), &book);
                if book_balance < minimum_balance {
                    let shortfall = minimum_balance.saturating_sub(book_balance);
                    let affordable = <ForeignAssets as Inspect<AccountId>>::reducible_balance(
                        asset.clone(),
                        &source,
                        Preservation::Preserve,
                        Fortitude::Polite,
                    );
                    if affordable >= shortfall {
                        // Best-effort by design (G-1): an unexpected transfer
                        // failure leaves only small Baseline sells unavailable,
                        // matching pre-B14 behavior. Propagating it would roll
                        // back the whole epoch tick and wedge every proposal in
                        // the batch, a strictly broader liveness failure.
                        //
                        // **The line debit is not optional and must be atomic
                        // with the transfer (08 §8 step 5; I-33).** This
                        // endowment moves real USDC *out of the POL_BASELINE
                        // custody pot*, and `pallet_market::seed` above debited
                        // only the LMSR `headroom` — nothing covers the R-4
                        // floor. Left unmirrored, `line` stays put while `pot`
                        // shrinks by one `min_balance` per Baseline book, so the
                        // genesis slack absorbs the first book and the **second**
                        // makes the treasury try-state's
                        // `line + streams <= pot` false ("POL_BASELINE line
                        // exceeds real USDC custody pot"). Every existing test
                        // seeds at most one Baseline book, which is exactly why
                        // nothing caught it. Committing the two together keeps
                        // the failure mode the one G-1 already chose: the
                        // endowment is skipped whole, never applied half.
                        let _ = frame_support::storage::with_storage_layer(|| -> DispatchResult {
                            <ForeignAssets as Mutate<AccountId>>::transfer(
                                asset,
                                &source,
                                &book,
                                shortfall,
                                Preservation::Preserve,
                            )?;
                            crate::FutarchyTreasury::debit_pol_custody(
                                pallet_futarchy_treasury::BudgetLine::PolBaseline,
                                shortfall,
                            )
                        });
                    }
                }
                id
            }
        };
        Ok(MarketSet {
            accept,
            reject,
            gates,
            baseline,
        })
    }

    fn extend_markets(
        proposal: &futarchy_primitives::Proposal<AccountId>,
    ) -> Result<(), DispatchError> {
        #[cfg(feature = "runtime-benchmarks")]
        {
            let _ = proposal;
            return Ok(());
        }
        let markets = proposal
            .markets
            .ok_or(DispatchError::Other("extended market set missing"))?;
        let params = <RuntimeEpochParams as pallet_epoch::EpochParamsProvider>::get();
        let start = proposal
            .decide_at
            .checked_sub(params.decision_window)
            .ok_or(DispatchError::Arithmetic(
                sp_runtime::ArithmeticError::Underflow,
            ))?;
        let trailing_start = proposal
            .decide_at
            .checked_sub(params.trailing_window)
            .ok_or(DispatchError::Arithmetic(
                sp_runtime::ArithmeticError::Underflow,
            ))?;
        let mut proposal_books = Vec::from([markets.accept, markets.reject]);
        if let Some(gates) = markets.gates {
            proposal_books.extend(gates);
        }
        for id in proposal_books {
            pallet_market::Pallet::<Runtime>::mark_extended(epoch_signed_origin(), id)?;
            pallet_market::Pallet::<Runtime>::register_decision_window(
                epoch_signed_origin(),
                id,
                proposal.id,
                start,
                trailing_start,
                proposal.decide_at,
            )?;
        }
        pallet_market::Pallet::<Runtime>::register_decision_window(
            epoch_signed_origin(),
            markets.baseline,
            proposal.id,
            start,
            trailing_start,
            proposal.decide_at,
        )
    }

    fn force_rerun_markets(
        proposal: &futarchy_primitives::Proposal<AccountId>,
    ) -> Result<(), DispatchError> {
        #[cfg(feature = "runtime-benchmarks")]
        {
            let _ = proposal;
            return Ok(());
        }
        let markets = proposal
            .markets
            .ok_or(DispatchError::Other("force-rerun market set missing"))?;
        let params = <RuntimeEpochParams as pallet_epoch::EpochParamsProvider>::get();
        let start = proposal
            .decide_at
            .checked_sub(params.decision_window)
            .ok_or(DispatchError::Arithmetic(
                sp_runtime::ArithmeticError::Underflow,
            ))?;
        let trailing_start = proposal
            .decide_at
            .checked_sub(params.trailing_window)
            .ok_or(DispatchError::Arithmetic(
                sp_runtime::ArithmeticError::Underflow,
            ))?;
        let mut books = Vec::from([markets.accept, markets.reject]);
        if let Some(gates) = markets.gates {
            books.extend(gates);
        }
        for id in books {
            pallet_market::Pallet::<Runtime>::reopen_for_rerun(epoch_signed_origin(), id)?;
            pallet_market::Pallet::<Runtime>::register_decision_window(
                epoch_signed_origin(),
                id,
                proposal.id,
                start,
                trailing_start,
                proposal.decide_at,
            )?;
        }
        pallet_market::Pallet::<Runtime>::reopen_baseline_for_rerun(
            epoch_signed_origin(),
            markets.baseline,
        )?;
        pallet_market::Pallet::<Runtime>::register_decision_window(
            epoch_signed_origin(),
            markets.baseline,
            proposal.id,
            start,
            trailing_start,
            proposal.decide_at,
        )
    }

    fn resume_markets(
        proposal: &futarchy_primitives::Proposal<AccountId>,
        previous_decide_at: BlockNumber,
    ) -> Result<(), DispatchError> {
        #[cfg(feature = "runtime-benchmarks")]
        {
            let _ = (proposal, previous_decide_at);
            return Ok(());
        }
        let markets = proposal
            .markets
            .ok_or(DispatchError::Other("resumed market set missing"))?;
        let paused_for =
            proposal
                .decide_at
                .checked_sub(previous_decide_at)
                .ok_or(DispatchError::Arithmetic(
                    sp_runtime::ArithmeticError::Underflow,
                ))?;
        let mut ids = Vec::from([markets.accept, markets.reject, markets.baseline]);
        if let Some(gates) = markets.gates {
            ids.extend(gates);
        }
        for id in ids {
            pallet_market::Pallet::<Runtime>::shift_decision_window(
                epoch_signed_origin(),
                id,
                previous_decide_at,
                paused_for,
            )?;
        }
        Ok(())
    }

    fn close_markets(
        proposal: &futarchy_primitives::Proposal<AccountId>,
    ) -> Result<(), DispatchError> {
        #[cfg(feature = "runtime-benchmarks")]
        {
            let _ = proposal;
            return Ok(());
        }
        let markets = proposal
            .markets
            .ok_or(DispatchError::Other("decided market set missing"))?;
        let mut proposal_books = Vec::from([markets.accept, markets.reject]);
        if let Some(gates) = markets.gates {
            proposal_books.extend(gates);
        }
        for id in proposal_books {
            pallet_market::Pallet::<Runtime>::consume_decision_windows(
                epoch_signed_origin(),
                id,
                proposal.id,
            )?;
            pallet_market::Pallet::<Runtime>::close(epoch_signed_origin(), id)?;
        }
        let baseline_still_live = pallet_epoch::Proposals::<Runtime>::iter_values().any(|other| {
            other.id != proposal.id
                && other
                    .markets
                    .is_some_and(|other_markets| other_markets.baseline == markets.baseline)
                && matches!(
                    other.state,
                    futarchy_primitives::ProposalState::Trading
                        | futarchy_primitives::ProposalState::Extended
                )
        });
        pallet_market::Pallet::<Runtime>::consume_decision_windows(
            epoch_signed_origin(),
            markets.baseline,
            proposal.id,
        )?;
        if !baseline_still_live {
            pallet_market::Pallet::<Runtime>::close(epoch_signed_origin(), markets.baseline)?;
        }
        Ok(())
    }

    fn seal_decision_window(
        proposal: &futarchy_primitives::Proposal<AccountId>,
    ) -> Result<(), DispatchError> {
        #[cfg(feature = "runtime-benchmarks")]
        {
            let _ = proposal;
            return Ok(());
        }
        let markets = proposal
            .markets
            .ok_or(DispatchError::Other("decision market set missing"))?;
        let mut ids = Vec::from([markets.accept, markets.reject, markets.baseline]);
        if let Some(gates) = markets.gates {
            ids.extend(gates);
        }
        for id in ids {
            pallet_market::Pallet::<Runtime>::seal_decision_window(
                epoch_signed_origin(),
                id,
                proposal.decide_at,
            )?;
        }
        Ok(())
    }

    fn decision_windows_live(proposal: &futarchy_primitives::Proposal<AccountId>) -> bool {
        let Some(markets) = proposal.markets else {
            return false;
        };
        let mut ids = Vec::from([markets.accept, markets.reject, markets.baseline]);
        if let Some(gates) = markets.gates {
            ids.extend(gates);
        }
        ids.into_iter().all(|id| {
            pallet_market::DecisionWindowOwners::<Runtime>::get(id)
                .iter()
                .any(|owner| owner.0 == proposal.id && owner.3 == proposal.decide_at)
        })
    }

    fn baseline_market(epoch: EpochId) -> Option<futarchy_primitives::MarketId> {
        #[cfg(feature = "runtime-benchmarks")]
        {
            return pallet_market::BaselineMarketOf::<Runtime>::get(epoch)
                .or_else(|| Some(9_000u64.saturating_add(u64::from(epoch))));
        }
        pallet_market::BaselineMarketOf::<Runtime>::get(epoch)
    }

    fn twap_full(market: futarchy_primitives::MarketId) -> Option<FixedU64> {
        #[cfg(feature = "runtime-benchmarks")]
        {
            return Some(benchmark_quote(market));
        }
        let end = market_window_end(market)?;
        let (full, _) = pallet_market::Pallet::<Runtime>::registered_window_lengths(market, end)?;
        pallet_market::Pallet::<Runtime>::twap_at(market, end, full)
    }

    fn twap_full_at(market: futarchy_primitives::MarketId, end: BlockNumber) -> Option<FixedU64> {
        #[cfg(feature = "runtime-benchmarks")]
        {
            let _ = end;
            return Some(benchmark_quote(market));
        }
        let (full, _) = pallet_market::Pallet::<Runtime>::registered_window_lengths(market, end)?;
        pallet_market::Pallet::<Runtime>::twap_at(market, end, full)
    }

    fn twap_trailing_at(
        market: futarchy_primitives::MarketId,
        end: BlockNumber,
        window: BlockNumber,
    ) -> Option<FixedU64> {
        #[cfg(feature = "runtime-benchmarks")]
        {
            let _ = (end, window);
            return Some(benchmark_quote(market));
        }
        let _ = window;
        let (_, trailing) =
            pallet_market::Pallet::<Runtime>::registered_window_lengths(market, end)?;
        pallet_market::Pallet::<Runtime>::twap_at(market, end, trailing)
    }

    fn spot_at(market: futarchy_primitives::MarketId, end: BlockNumber) -> Option<FixedU64> {
        #[cfg(feature = "runtime-benchmarks")]
        {
            let _ = end;
            return Some(benchmark_quote(market));
        }
        pallet_market::Pallet::<Runtime>::spot_at(market, end)
    }

    fn decision_grade(
        market: futarchy_primitives::MarketId,
        end: BlockNumber,
        role: pallet_epoch::BookRole,
        class: futarchy_primitives::ProposalClass,
        params: &pallet_epoch::CoreEpochParams,
    ) -> bool {
        #[cfg(feature = "runtime-benchmarks")]
        {
            let _ = (market, end, role, class, params);
            return true;
        }
        let Some(book) = pallet_market::Markets::<Runtime>::get(market) else {
            return false;
        };
        let role_matches = matches!(
            (role, book.kind),
            (
                pallet_epoch::BookRole::Decision,
                pallet_market::core_market::BookKind::Decision { .. }
            ) | (
                pallet_epoch::BookRole::Baseline,
                pallet_market::core_market::BookKind::Baseline { .. }
            ) | (
                pallet_epoch::BookRole::Gate,
                pallet_market::core_market::BookKind::Gate { .. }
            )
        );
        if !role_matches {
            return false;
        }
        let Some(contest) = contest_floor_for_grade(market, end, role, class, params) else {
            return false;
        };
        let Some((full_window, _)) =
            pallet_market::Pallet::<Runtime>::registered_window_lengths(market, end)
        else {
            return false;
        };
        let (coverage, convergence, pol_floor, sanity) = match role {
            pallet_epoch::BookRole::Decision => (
                params.coverage_pct,
                params.delta_max,
                class_pol_floor(class),
                true,
            ),
            pallet_epoch::BookRole::Baseline => (
                params.coverage_pct,
                params.delta_max,
                balance_param(b"pol.b_baseline"),
                true,
            ),
            pallet_epoch::BookRole::Gate => {
                let near_boundary =
                    pallet_market::Pallet::<Runtime>::twap_at(market, end, full_window)
                        .is_some_and(|twap| {
                            twap.0 < kernel::DECISION_SANITY_MIN_1E9
                                || twap.0 > kernel::DECISION_SANITY_MAX_1E9
                        });
                (
                    if near_boundary {
                        params.gate_nb_coverage_pct
                    } else {
                        params.coverage_pct
                    },
                    if near_boundary {
                        params.gate_nb_convergence
                    } else {
                        params.delta_max
                    },
                    balance_param(b"pol.b_gate"),
                    false,
                )
            }
        };
        pallet_market::Pallet::<Runtime>::decision_grade_at(
            market,
            end,
            full_window,
            coverage,
            convergence,
            contest,
            pol_floor,
            sanity,
        )
    }

    fn decision_window_sealed(market: futarchy_primitives::MarketId, end: BlockNumber) -> bool {
        pallet_market::DecisionWindows::<Runtime>::get(market)
            .iter()
            .any(|window| window.end == end && window.sealed)
    }

    fn welfare_grade(
        market: futarchy_primitives::MarketId,
        end: BlockNumber,
        class: futarchy_primitives::ProposalClass,
        params: &pallet_epoch::CoreEpochParams,
    ) -> pallet_epoch::WelfareGrade {
        #[cfg(feature = "runtime-benchmarks")]
        {
            let _ = (market, end, class, params);
            pallet_epoch::WelfareGrade::Ok
        }
        #[cfg(not(feature = "runtime-benchmarks"))]
        {
            use pallet_epoch::WelfareGrade;
            // 05 §5.2 tri-state welfare-book grade over the same facts the
            // boolean Decision-role grade folds. The reference partition
            // (reference model `grade_welfare_book`): the remediable-by-time
            // shortfalls — contest capital below the Ask-scaled class floor,
            // coverage below `dec.coverage`, a first stale event — grade
            // Insufficient; every other failure — sanity band, POL floor or
            // POL disturbed (incl. a voided contest accumulator), a second
            // stale event, non-convergence, an unsealed window, or any
            // unavailable read — grades Invalid (G-1, fail-closed).
            let Some(book) = pallet_market::Markets::<Runtime>::get(market) else {
                return WelfareGrade::Invalid;
            };
            if !matches!(
                book.kind,
                pallet_market::core_market::BookKind::Decision { .. }
            ) {
                return WelfareGrade::Invalid;
            }
            let Some(contest_floor) = contest_floor_for_grade(
                market,
                end,
                pallet_epoch::BookRole::Decision,
                class,
                params,
            ) else {
                return WelfareGrade::Invalid;
            };
            let Some(facts) = pallet_market::Pallet::<Runtime>::decision_grade_facts_at(
                market,
                end,
                params.decision_window,
                params.coverage_pct,
                params.delta_max,
                contest_floor,
                class_pol_floor(class),
                true,
            ) else {
                return WelfareGrade::Invalid;
            };
            if !facts.sane
                || !facts.sealed
                || !facts.pol_ok
                || !facts.contest_valid
                || facts.stale_events >= 2
                || !facts.converged
            {
                return WelfareGrade::Invalid;
            }
            if !facts.contest_ok || !facts.coverage_ok || facts.stale_events == 1 {
                return WelfareGrade::Insufficient;
            }
            WelfareGrade::Ok
        }
    }

    fn measured_depth(pid: futarchy_primitives::ProposalId) -> Option<Balance> {
        // B5 benchmarks need a realistic, read-free depth; the production path
        // below returns `None` when a backing read is unavailable so the B2
        // `decision_stats` view can tell "not measurable" from "depth is zero"
        // (a zero would render a fabricated measurement as observed data).
        #[cfg(feature = "runtime-benchmarks")]
        {
            let _ = pid;
            Some(currency::USDC.saturating_mul(1_000_000))
        }
        // 05 §5.6 / 08 §5.2 (SQ-231): `L̂ = Σ pair POL depth +
        // min(min(contest_acc, contest_rej), sec.flow_cap · (b_acc + b_rej))`.
        // The shallower book is binding (§5.4); only b remains pair-summed.
        #[cfg(not(feature = "runtime-benchmarks"))]
        pallet_epoch::Proposals::<Runtime>::get(pid).and_then(|proposal| {
            let markets = proposal.markets?;
            let mut pol_depth = 0_u128;
            let mut pair_contest: Option<Balance> = None;
            let mut b_sum = 0_u128;
            for id in [markets.accept, markets.reject] {
                if !pallet_market::SeededMarkets::<Runtime>::contains_key(id) {
                    return None;
                }
                let book = pallet_market::Markets::<Runtime>::get(id)?;
                let pol = pallet_market::core_market::maker_loss_floor(book.b)?;
                let (window, _) = pallet_market::Pallet::<Runtime>::registered_window_lengths(
                    id,
                    proposal.decide_at,
                )?;
                let contest = pallet_market::Pallet::<Runtime>::average_contest_at(
                    id,
                    proposal.decide_at,
                    window,
                )?;
                pol_depth = pol_depth.checked_add(pol)?;
                pair_contest = Some(match pair_contest {
                    Some(binding) => binding.min(contest),
                    None => contest,
                });
                b_sum = b_sum.checked_add(book.b)?;
            }
            pallet_market::core_market::liquidity_hat(
                pol_depth,
                pair_contest?,
                sec_flow_cap_1e9(),
                b_sum,
            )
        })
    }

    fn published_flow_per_day(_: futarchy_primitives::ProposalId) -> Option<Balance> {
        #[cfg(feature = "runtime-benchmarks")]
        {
            return Some(currency::USDC);
        }
        // A8 fail-closed telemetry deferral: None makes the decision kernel use
        // its specified L/2 fallback (08 §5.2) — owner Phase-3 calibration.
        None
    }

    fn previous_settled_baseline_twap(epoch: EpochId) -> Option<FixedU64> {
        let previous = epoch.checked_sub(1)?;
        // 05 §5.3 / SQ-88: carry from the previous epoch's sealed Baseline
        // decision window. Cohort summaries are finalized only at e+3, which
        // is too late for an earlier decision in the next epoch; the market
        // snapshot is captured at the immutable seal boundary and retained
        // with BaselineMarketOf until reap.
        // A cohort VOID is not a settled measurement (05 §5.3, §7(5)); its
        // archived summary therefore invalidates the sealed snapshot as a
        // carry source. Keep the absent-summary path for the pre-finalization
        // next-epoch decision that SQ-88 explicitly supports.
        if pallet_epoch::RecentCohortSummaries::<Runtime>::get()
            .into_iter()
            .any(|summary| summary.epoch == previous && summary.voided)
        {
            return None;
        }
        pallet_market::Pallet::<Runtime>::sealed_baseline_twap(previous)
    }
}

pub struct RuntimeInDecisionWindow;
impl Contains<futarchy_primitives::MarketId> for RuntimeInDecisionWindow {
    fn contains(market: &futarchy_primitives::MarketId) -> bool {
        let now = System::block_number();
        pallet_epoch::Proposals::<Runtime>::iter_values().any(|proposal| {
            proposal.markets.is_some_and(|markets| {
                let belongs = markets.accept == *market
                    || markets.reject == *market
                    || markets.baseline == *market
                    || markets.gates.is_some_and(|gates| gates.contains(market));
                belongs
                    && proposal
                        .decide_at
                        .checked_sub(u32_param(b"dec.window"))
                        .is_some_and(|start| now >= start && now <= proposal.decide_at)
            })
        })
    }
}

fn live_pol_commitments() -> Result<Vec<Balance>, DispatchError> {
    // One bounded storage-value read. The market lifecycle maintains exact,
    // market-id-sorted amounts transactionally at seed/rerun/terminal/reap;
    // this replaces the former 196-key `Markets` scan on every sync caller.
    Ok(pallet_market::Pallet::<Runtime>::live_pol_commitments())
}

/// Mirror every seeded, still-live book into NAV. Baseline books are included
/// here because 08 §1.2 nets all live-book obligations; their only exemption is
/// from the *new proposal* `pol.budget_epoch` charge (08 §4.3).
pub struct RuntimePolCommitmentSync;

impl pallet_market::PolCommitmentSync for RuntimePolCommitmentSync {
    fn sync_pol_commitments() -> DispatchResult {
        crate::FutarchyTreasury::set_pol_commitments(live_pol_commitments()?)
    }

    fn pol_commitments_synced() -> bool {
        live_pol_commitments()
            .is_ok_and(|expected| crate::FutarchyTreasury::treasury().pol_commitments == expected)
    }

    fn debit_pol_custody(line: pallet_market::PolLine, amount: Balance) -> DispatchResult {
        crate::FutarchyTreasury::debit_pol_custody(budget_line_of(line), amount)
    }

    fn credit_pol_custody(line: pallet_market::PolLine, amount: Balance) -> DispatchResult {
        crate::FutarchyTreasury::credit_pol_custody(budget_line_of(line), amount)
    }
}

/// Recognize the 04 §2 Sweep's fee remittance as treasury credit (08 §1.1).
///
/// The custody half is already done by the time this runs — the ledger paid
/// `MAIN` directly, or the Baseline book's plain USDC was transferred there —
/// but `nav()` reads the treasury's internal `main_usdc` counter, so custody
/// alone would leave NAV exactly where it was. A failure aborts the sweep.
pub struct RuntimeMainRevenueSink;

impl pallet_conditional_ledger::MainRevenueSink for RuntimeMainRevenueSink {
    fn credit_main(amount: Balance) -> DispatchResult {
        crate::FutarchyTreasury::credit_main(amount);
        Ok(())
    }
}

parameter_types! {
    /// 08 §1.1 `MAIN`, the single lawful sink of realized fee value (04 §6.1).
    pub TreasuryMainAccount: AccountId = crate::genesis::treasury_account();
    /// The same account addressed as an XCM beneficiary, for the SQ-540(e) fee
    /// sink. `StandardLocationToAccountId`'s `AccountId32Aliases` leg resolves a
    /// network-agnostic local `AccountId32` junction back to exactly this
    /// account, so the deposit lands in `MAIN` custody and nowhere else.
    pub TreasuryMainLocation: staging_xcm::latest::Location =
        staging_xcm::latest::Location::new(
            0,
            [staging_xcm::latest::Junction::AccountId32 {
                network: None,
                id: crate::genesis::treasury_account().into(),
            }],
        );
}

/// SQ-540(e). Recognize a deposited USDC execution fee as internal `MAIN`
/// credit so it reaches NAV.
///
/// `credit_main` is the existing `PendingMainCredit` seam — a small dedicated
/// counter rather than a write to the treasury aggregate, because this runs on
/// message-processing paths where folding the multi-kilobyte aggregate into the
/// proof would be the wrong trade. `Pallet::load` folds it into `main_usdc`, so
/// `nav()`, `treasury()` and try-state observe the credit exactly once.
pub struct TreasuryXcmFeeCredit;
impl bleavit_xcm::trader::TreasuryFeeCredit for TreasuryXcmFeeCredit {
    fn credit_usdc(amount: Balance) {
        pallet_futarchy_treasury::Pallet::<Runtime>::credit_main(amount);
    }
}

/// Bind the market's treasury-free subsidy-line discriminant to the treasury's
/// own `BudgetLine` (08 §8 step 5(b): `POL` for decision and gate books,
/// `POL_BASELINE` for the Baseline book).
const fn budget_line_of(line: pallet_market::PolLine) -> pallet_futarchy_treasury::BudgetLine {
    match line {
        pallet_market::PolLine::Proposal => pallet_futarchy_treasury::BudgetLine::Pol,
        pallet_market::PolLine::Baseline => pallet_futarchy_treasury::BudgetLine::PolBaseline,
    }
}

impl pallet_market::Config for Runtime {
    type WeightInfo = crate::weights::pallet_market::WeightInfo<Runtime>;
    #[cfg(feature = "runtime-benchmarks")]
    type BenchmarkHelper = RuntimeBenchmarkHelper;
    type Fee = MarketFee;
    type ObsInterval = MarketObsInterval;
    type Kappa1e9 = MarketKappa;
    type MarketAdmin = EnsureEpochAccount;
    type ExternalMarketAdmin = EnsureQuestionServiceClient;
    type ServiceLedger =
        pallet_market::ConditionalLedgerInstance<frame_support::instances::Instance1>;
    type PrimaryProposalIds = RuntimePrimaryProposalIds;
    type ExternalQuestionStatus = RuntimeExternalQuestionStatus;
    type ReservedProtocolDestinations = ReservedProtocolAccounts;
    type MaxLiveExternalMarkets = RuntimeMaxLiveExternalMarkets;
    type EmergencyPlaybookOrigin = pallet_origins::EnsureEmergencyPlaybook;
    type ArchiveDelay = LedgerArchiveDelay;
    type PalletId = MarketPalletId;
    type MarketAccounts = RuntimeMarketAccounts;
    type KeeperRebate = FutarchyTreasury;
    type InDecisionWindow = RuntimeInDecisionWindow;
    type PolCommitmentSync = RuntimePolCommitmentSync;
    type MainAccount = TreasuryMainAccount;
    type MainRevenueSink = RuntimeMainRevenueSink;
    type BaselineGrade = RuntimeBaselineGrade;
}

pub struct RuntimePrimaryProposalIds;
impl pallet_market::PrimaryProposalIdProvider for RuntimePrimaryProposalIds {
    fn next_proposal_id() -> futarchy_primitives::ProposalId {
        pallet_epoch::NextProposalId::<Runtime>::get()
    }
}

pub struct RuntimeExternalQuestionStatus;
impl pallet_market::ExternalQuestionStatus for RuntimeExternalQuestionStatus {
    fn trading_open(question: futarchy_primitives::QuestionId) -> bool {
        QuestionService::trading_open(question)
    }
}

pub struct RuntimeMaxLiveExternalMarkets;
impl Get<u32> for RuntimeMaxLiveExternalMarkets {
    fn get() -> u32 {
        u32_param_or(b"svc.max_live", 0)
            .saturating_mul(2)
            .min(bounds::MAX_LIVE_EXTERNAL_MARKETS)
    }
}

pub struct RuntimeEpochOracle;
impl pallet_epoch::OracleAccess for RuntimeEpochOracle {
    fn any_open_dispute_touching(spec: futarchy_primitives::MetricSpecVersion) -> bool {
        // Rounds is core-bounded to 128 and try-state-covered. Only a live
        // challenged *round* at or above the value-scaled round-one merit
        // floor is a decision-time dispute (07 §12). `challenger` is durable
        // across the escalation ladder; `counter_value` identifies the active
        // challenge for this round. Registry sub-games never enter this
        // storage surface.
        pallet_oracle::Rounds::<Runtime>::iter().any(|(_, round)| {
            round.spec_version == spec
                && round.counter_value.is_some()
                && match pallet_oracle::RoundSchedules::<Runtime>::get((
                    round.component,
                    round.epoch,
                    round.spec_version,
                ))
                .and_then(|schedule| {
                    pallet_oracle::stored_round_bond(schedule.round_one_bond, 1, schedule.round_cap)
                        .ok()
                }) {
                    // Malformed frozen schedule ⇒ the game's own B_1 is
                    // uncomputable; G-1 conservatively holds the decision.
                    None => true,
                    // 07 §12 merit floor = max(live `dis.merit_min`, frozen
                    // B_1) (SQ-158): the independent META lever can raise the
                    // bar above the game's B_1, but the `max` keeps it from ever
                    // dropping below the round-1 bond the challenger posted, so a
                    // lowering can never make censorship cheaper (R-7).
                    Some(frozen_b1) => round.bond >= frozen_b1.max(balance_param(b"dis.merit_min")),
                }
                // 07 §12 (SQ-494): a round whose money leg is already settled
                // holds nothing. §11(1) *retains* a neutralized round for bond
                // disposal only, and I-18 fixes the settled value against every
                // later verdict — so the quantity §12 exists to protect is
                // decided, while the hold keeps costing. It costs more than the
                // word "hold" suggests: `guards.process_hold` reaches
                // `Rejected(ProcessHold)`, which is terminal (05 §5.4 · T10/T20),
                // so a proposal reaching its decide window is killed and must be
                // resubmitted, not deferred until the dispute clears. Leaving it
                // in place let the §11(4) griefer buy that outcome for every
                // proposal consuming the component, on top of the neutral
                // settlement §11(4) actually prices.
                //
                // The test is the spec's own definition of non-money-bearing
                // (§11(1)): "a round whose `(component, epoch, spec_version)`
                // already carries a settled `ComponentValues` entry". Reading
                // the settled value rather than the oracle's internal
                // money-settled latch keeps this predicate off that pallet's
                // storage shapes.
                //
                // Evaluated **last**, after the merit floor: a sub-merit round
                // already fails and never pays this read, so the ordering costs
                // one read only where the answer can still change.
                && pallet_oracle::Pallet::<Runtime>::settled_component(
                    round.component,
                    round.epoch,
                    round.spec_version,
                )
                .is_none()
        })
    }

    fn note_epoch_boundary(
        ended_epoch: futarchy_primitives::EpochId,
        attributable: bool,
    ) -> DispatchResult {
        // 07 §4's "≥ 1 open round" predicate is derived inside the oracle, from
        // its own `RoundActivity` latch: the epoch clock owns *when* the sweep
        // happens and nothing more. Passing the predicate in from here would make
        // a slash depend on a caller-supplied fact, and every derivation available
        // to a caller is wrong in one direction or the other, because a cleanly
        // closed game leaves no trace in `Rounds` to observe.
        pallet_oracle::Pallet::<Runtime>::note_epoch_boundary(ended_epoch, attributable)
    }

    fn note_settle_deadline(measurement_epoch: futarchy_primitives::EpochId) -> DispatchResult {
        // The oracle resolves the expected-component set itself through the
        // `ReportingContext` provider (07 §2(4)); the epoch clock only owns
        // *when* the deadline falls due (§11(1)).
        pallet_oracle::Pallet::<Runtime>::note_settle_deadline(measurement_epoch)
    }

    fn reap_settled_components(current_epoch: futarchy_primitives::EpochId) {
        // 07 §13's reaping, driven from the epoch clock because the cutoff is
        // measured in epochs and the oracle has no hooks. Bounded per call and
        // idempotent, so a keeper may run the boundary crank every block.
        let _ = pallet_oracle::Pallet::<Runtime>::reap_settled_components(current_epoch);
    }
}

pub struct RuntimeEpochGuardian;
impl pallet_epoch::GuardianAccess for RuntimeEpochGuardian {
    fn hold_active(pid: futarchy_primitives::ProposalId) -> bool {
        pallet_epoch::Proposals::<Runtime>::get(pid).is_some_and(|proposal| {
            matches!(
                proposal.state,
                futarchy_primitives::ProposalState::Suspended
                    | futarchy_primitives::ProposalState::Rerun
            )
        })
    }

    fn dead_man_engaged() -> bool {
        crate::Constitution::phase_flags() & pallet_constitution::PhaseFlagsValue::DEAD_MAN_ENGAGED
            != 0
    }

    fn review_window_closed(
        pid: futarchy_primitives::ProposalId,
        epoch: futarchy_primitives::EpochId,
        phase: futarchy_primitives::EpochPhase,
    ) -> bool {
        // The purpose-specific window is the only admissible source. Missing
        // post-B18 state fails closed; falling back to `grd.review_dl` would
        // silently restore the pre-B18 coupling.
        phase == futarchy_primitives::EpochPhase::Seed
            && pallet_epoch::GuardianReviewWindows::<Runtime>::get(pid)
                .is_some_and(|window| epoch >= window)
    }

    fn close_review_window(pid: futarchy_primitives::ProposalId) -> DispatchResult {
        pallet_guardian::Pallet::<Runtime>::close_review_window(pid)
    }
}

pub struct RuntimeEpochAttestation;
#[cfg_attr(feature = "runtime-benchmarks", allow(unreachable_code))]
impl pallet_epoch::AttestationAccess for RuntimeEpochAttestation {
    fn present_and_quorate(
        pid: futarchy_primitives::ProposalId,
        artifact_hash: futarchy_primitives::H256,
    ) -> bool {
        #[cfg(feature = "runtime-benchmarks")]
        {
            let _ = (pid, artifact_hash);
            return true;
        }
        pallet_attestor::Pallet::<Runtime>::has_quorum(pid, artifact_hash)
            && pallet_attestor::Attestations::<Runtime>::get()
                .iter()
                .any(|record| {
                    record.pid == pid
                        && record.artifact_hash == artifact_hash
                        && <RuntimeAttestations as pallet_execution_guard::Attestations>::present_unrevoked_unchallenged(record.id)
                })
    }
}

fn proposal_calls(
    proposal: &futarchy_primitives::Proposal<AccountId>,
) -> Option<pallet_execution_guard::pallet::RuntimeBatch<Runtime>> {
    runtime_batch(proposal.payload_hash, proposal.payload_len)
}

/// Re-derive every call's guard domains and require each to be admissible for the
/// proposal's class — byte-for-byte the precondition the execution guard applies
/// inside `enqueue`.
///
/// 09 §1.1 states queue-time preconditions are "enforced by the decision path
/// **before** `enqueue` succeeds". Screening must therefore be a **superset** of
/// the guard's: otherwise a payload can pass screening, win Adopt, and then make
/// `epoch.decide(pid)` fail inside `with_storage_layer`, reverting the entire
/// decide on every attempt until the T20 stale path force-rejects it — 13 days of
/// market and a decided Adopt lost (SQ-308). Mirroring the check here makes
/// `decide` total.
///
/// `InternalRootApplyUpgrade` is excluded exactly as the guard excludes it: the
/// classifier matches `system.authorize_upgrade` only at top level, so nested in a
/// `utility.batch_all` it projects to the *apply* domain. 09 §2.1's multi-item
/// upgrade payload is expressible as multiple **top-level** calls, so the nested
/// form need not be admitted at all.
fn domains_admissible(
    class: futarchy_primitives::ProposalClass,
    calls: &pallet_execution_guard::pallet::RuntimeBatch<Runtime>,
) -> bool {
    use pallet_execution_guard::{BatchDispatcher, PhaseState};
    let phase_four = crate::configs::RuntimePhaseState::exact_phase_three()
        && crate::classifier::RuntimeDispatcher::phase_four_plan(class, calls).is_some();
    calls.iter().all(|call| {
        crate::classifier::RuntimeDispatcher::rederive_call(call).is_ok_and(|analysis| {
            analysis.domains.iter().all(|domain| {
                (pallet_execution_guard::domain_allowed(class, *domain)
                    || (phase_four
                        && *domain == pallet_execution_guard::CallDomain::Code
                        && crate::classifier::RuntimeDispatcher::recovery_image_descriptor(call)
                            .is_some()))
                    && !matches!(
                        domain,
                        pallet_execution_guard::CallDomain::InternalRootApplyUpgrade
                    )
            })
        })
    })
}

fn runtime_batch(
    payload_hash: futarchy_primitives::H256,
    payload_len: u32,
) -> Option<pallet_execution_guard::pallet::RuntimeBatch<Runtime>> {
    use pallet_execution_guard::Preimages;
    let bytes = RuntimePreimages::fetch(payload_hash, payload_len)?;
    if u32::try_from(bytes.len()).ok()? != payload_len {
        return None;
    }
    pallet_execution_guard::Pallet::<Runtime>::decode_batch(&bytes).ok()
}

/// Re-derive the committed USDC outflow (`Ask`) from the only Treasury leaves
/// whose outflow is statically knowable. Unknown calls, wrappers, recipient
/// claims and quote-priced renewal calls fail closed instead of trusting the
/// proposer's numeric declaration (05 §1.2/§5.6; 08 §5.2).
fn derived_treasury_ask(
    calls: &pallet_execution_guard::pallet::RuntimeBatch<Runtime>,
) -> Option<Balance> {
    let mut ask = 0_u128;
    for call in calls {
        if !visit_runtime_leaves(call, &mut |leaf| {
            let addition = match leaf {
                RuntimeCall::FutarchyTreasury(pallet_futarchy_treasury::Call::spend {
                    amount,
                    ..
                }) => *amount,
                RuntimeCall::FutarchyTreasury(pallet_futarchy_treasury::Call::open_stream {
                    total,
                    ..
                }) => *total,
                RuntimeCall::FutarchyTreasury(
                    pallet_futarchy_treasury::Call::fund_budget_line { .. }
                    | pallet_futarchy_treasury::Call::cancel_stream { .. }
                    | pallet_futarchy_treasury::Call::issue_vit { .. }
                    | pallet_futarchy_treasury::Call::recover_foreign { .. }
                    | pallet_futarchy_treasury::Call::set_coretime_authority { .. }
                    // 05 §1.4 / 08 §1.4: the sweep moves USDC *into* NAV, so its
                    // derived Treasury ask is exactly zero — one of the two
                    // admissible zero-outflow Treasury leaves 05 §1.4 names.
                    | pallet_futarchy_treasury::Call::sweep_insurance { .. },
                ) => 0,
                // 05 §1.4 ask derivation (SQ-244/SQ-316): `claim_assets` moves
                // already-owned assets out of the trap register and creates **no**
                // treasury outflow, so its derived ask is exactly zero. This is
                // one of the two admissible zero-outflow Treasury leaves and MUST
                // NOT be generalized into "unknown leaves ask zero" — every other
                // unknown call still fails closed at the `_` arm below.
                RuntimeCall::PolkadotXcm(pallet_xcm::Call::claim_assets { .. }) => 0,
                // `claim_stream` is Signed-recipient-only and coretime renewal is
                // priced from live quote storage. Neither can be committed as a
                // statically-sized Treasury proposal outflow.
                RuntimeCall::FutarchyTreasury(
                    pallet_futarchy_treasury::Call::claim_stream { .. }
                    | pallet_futarchy_treasury::Call::execute_coretime_renewal { .. }
                    | pallet_futarchy_treasury::Call::note_coretime_quote { .. }
                    | pallet_futarchy_treasury::Call::prune_coretime_quote { .. }
                    | pallet_futarchy_treasury::Call::__Ignore(_, _),
                ) => return false,
                _ => return false,
            };
            let Some(updated) = ask.checked_add(addition) else {
                return false;
            };
            ask = updated;
            true
        }) {
            return None;
        }
    }
    Some(ask)
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum RuntimeAdmissionMeter {
    TreasuryOutflow,
    VitIssuance,
    CodeSpacing,
}

impl RuntimeAdmissionMeter {
    const fn key(self) -> [u8; 8] {
        match self {
            Self::TreasuryOutflow => *b"trs.outf",
            Self::VitIssuance => *b"vit.issu",
            Self::CodeSpacing => *b"code.spc",
        }
    }
}

fn visit_runtime_leaves(call: &RuntimeCall, visit: &mut impl FnMut(&RuntimeCall) -> bool) -> bool {
    match call {
        RuntimeCall::Utility(
            pallet_utility::Call::batch { calls }
            | pallet_utility::Call::batch_all { calls }
            | pallet_utility::Call::force_batch { calls },
        ) => calls.iter().all(|call| visit_runtime_leaves(call, visit)),
        RuntimeCall::Utility(
            pallet_utility::Call::as_derivative { call, .. }
            | pallet_utility::Call::dispatch_as { call, .. }
            | pallet_utility::Call::with_weight { call, .. },
        )
        | RuntimeCall::Proxy(
            pallet_proxy::Call::proxy { call, .. }
            | pallet_proxy::Call::proxy_announced { call, .. },
        )
        | RuntimeCall::Multisig(
            pallet_multisig::Call::as_multi { call, .. }
            | pallet_multisig::Call::as_multi_threshold_1 { call, .. },
        ) => visit_runtime_leaves(call, visit),
        #[cfg(feature = "bootstrap")]
        RuntimeCall::Sudo(
            pallet_sudo::Call::sudo { call }
            | pallet_sudo::Call::sudo_unchecked_weight { call, .. },
        ) => visit_runtime_leaves(call, visit),
        _ => visit(call),
    }
}

pub(crate) fn derived_execution_meters(
    calls: &pallet_execution_guard::pallet::RuntimeBatch<Runtime>,
) -> Option<pallet_execution_guard::pallet::StoredMeters> {
    let mut meters = Vec::new();
    for call in calls {
        if !visit_runtime_leaves(call, &mut |leaf| {
            let meter = match leaf {
                RuntimeCall::FutarchyTreasury(
                    pallet_futarchy_treasury::Call::spend { .. }
                    | pallet_futarchy_treasury::Call::open_stream { .. },
                ) => Some(RuntimeAdmissionMeter::TreasuryOutflow),
                RuntimeCall::FutarchyTreasury(pallet_futarchy_treasury::Call::issue_vit {
                    ..
                }) => Some(RuntimeAdmissionMeter::VitIssuance),
                RuntimeCall::System(frame_system::Call::authorize_upgrade { .. }) => {
                    Some(RuntimeAdmissionMeter::CodeSpacing)
                }
                _ => None,
            };
            if let Some(meter) = meter {
                let key = meter.key();
                if !meters.contains(&key) {
                    meters.push(key);
                }
            }
            true
        }) {
            return None;
        }
    }
    pallet_execution_guard::pallet::StoredMeters::try_from(meters).ok()
}

fn queued_pending_outflows() -> Result<Vec<Balance>, DispatchError> {
    let mut queue = pallet_execution_guard::Queue::<Runtime>::iter().collect::<Vec<_>>();
    queue.sort_by_key(|(pid, _)| *pid);
    let mut pending = Vec::new();
    let meter = RuntimeAdmissionMeter::TreasuryOutflow.key();
    for (pid, queued) in queue {
        if !queued.meters_declared.contains(&meter) {
            continue;
        }
        if !matches!(queued.class, futarchy_primitives::ProposalClass::Treasury) {
            return Err(DispatchError::Other(
                "treasury meter on non-treasury queue item",
            ));
        }
        let proposal = pallet_epoch::Proposals::<Runtime>::get(pid)
            .ok_or(DispatchError::Other("queued treasury proposal absent"))?;
        if proposal.payload_hash != queued.payload_hash
            || proposal.payload_len != queued.payload_len
        {
            return Err(DispatchError::Other(
                "queued treasury payload binding mismatch",
            ));
        }
        let calls = runtime_batch(queued.payload_hash, queued.payload_len)
            .ok_or(DispatchError::Other("queued treasury payload unavailable"))?;
        let amount = derived_treasury_ask(&calls).ok_or(DispatchError::Other(
            "queued treasury outflow cannot be derived",
        ))?;
        if amount != proposal.ask {
            return Err(DispatchError::Other("queued treasury ask mismatch"));
        }
        pending.push(amount);
    }
    Ok(pending)
}

pub struct RuntimePendingOutflowSync;

impl pallet_execution_guard::PendingOutflowSync for RuntimePendingOutflowSync {
    fn sync_pending_outflows() -> DispatchResult {
        // Queue is structurally capped at 32, below the treasury's 64-entry
        // mirror bound. Any rejection here therefore signals invariant drift.
        FutarchyTreasury::set_pending_outflows(queued_pending_outflows()?)
    }

    fn force_fail_static() -> bool {
        FutarchyTreasury::set_pending_outflows(Vec::from([Balance::MAX])).is_ok()
    }

    fn pending_outflows_synced() -> bool {
        queued_pending_outflows()
            .is_ok_and(|expected| FutarchyTreasury::treasury().pending_outflows == expected)
    }
}

/// Read-only decision-time preview of every live treasury/issuance/spacing
/// meter touched by the exact recursively decoded batch.
pub(crate) fn preview_batch_admission(calls: &[RuntimeCall]) -> bool {
    matches!(
        preview_admission_inner(calls, true),
        PreviewVerdict::Admits | PreviewVerdict::NoVerdict
    )
}

/// The 09 §1.2(7) **treasury-outflow and issuance rate meters** alone, for the
/// guard's execute-time step (7) and its `meters_clear` projection (SQ-461).
///
/// Two deliberate narrowings relative to [`preview_batch_admission`]:
///
/// * `code.spacing` is excluded. The guard owns that meter because it alone knows
///   the D-9 expedited-CODE exemption (`Expedited[pid]`); folding it in here would
///   refuse an expedited emergency payload whose spacing window has not elapsed —
///   exactly the lane the exemption exists for.
/// * Only a genuine rate-meter refusal blocks. Every other treasury error
///   (`InsufficientFunds`, `StreamRequired`, `NavFloorUnmet`, `BadOrigin`, …) is a
///   permanent payload defect rather than transient contention, and belongs to
///   step (12) dispatch, whose atomic rollback records the T18 failure and its
///   bounded retry window. Reporting those at step (7) would both misdiagnose them
///   as `MetersBlocked` and hand a permanently doomed payload the *full* grace
///   window to be re-cranked in.
pub(crate) fn preview_meter_admission(calls: &[RuntimeCall]) -> bool {
    // Only a *refusal the preview can stand behind* blocks. `NoVerdict` fails
    // OPEN, which is the safe direction here and not a weakening: the meters are
    // still genuinely enforced by the dispatched calls at step (12). Step (7)
    // exists only to convert transient contention into a refusal that records no
    // failure, so blocking on a verdict we cannot trust would strand an adopted
    // proposal for its whole grace window over a batch that would have succeeded.
    !matches!(
        preview_admission_inner(calls, false),
        PreviewVerdict::Refused(
            pallet_futarchy_treasury::CoreError::MeterExhausted
                | pallet_futarchy_treasury::CoreError::IssuanceCapExceeded
        )
    )
}

/// The outcome of simulating a batch against a cloned treasury.
enum PreviewVerdict {
    /// Every leaf was modelled and every meter admitted.
    Admits,
    /// The first refusal, with every leaf before it faithfully simulated.
    Refused(pallet_futarchy_treasury::CoreError),
    /// **No verdict.** The batch reached a treasury call this preview does not
    /// simulate, so the simulated state is stale for everything after it. NAV —
    /// and therefore every meter base — is a pure function of treasury state
    /// (`nav()` reads `main_usdc`, the budget lines, open-stream remainders and
    /// obligations), so a `FutarchyTreasury` leaf outside the four simulated
    /// arms is exactly the case where a later meter check would be measured
    /// against the wrong base. `[sweep_insurance, spend]` is the worked example:
    /// the sweep raises NAV, and judging the spend without it can refuse a batch
    /// whose ordered atomic dispatch would succeed.
    NoVerdict,
}

fn preview_admission_inner(calls: &[RuntimeCall], include_spacing: bool) -> PreviewVerdict {
    let mut treasury = crate::FutarchyTreasury::treasury();
    let now = System::block_number();
    let mut verdict = PreviewVerdict::Admits;
    let mut authorize_count = 0_u8;
    for call in calls {
        if !visit_runtime_leaves(call, &mut |leaf| {
            if matches!(leaf, RuntimeCall::FutarchyTreasury(inner)
            if !matches!(
                inner,
                pallet_futarchy_treasury::Call::fund_budget_line { .. }
                    | pallet_futarchy_treasury::Call::spend { .. }
                    | pallet_futarchy_treasury::Call::open_stream { .. }
                    | pallet_futarchy_treasury::Call::issue_vit { .. }
            )) {
                verdict = PreviewVerdict::NoVerdict;
                return false;
            }
            let result = match leaf {
                RuntimeCall::FutarchyTreasury(
                    pallet_futarchy_treasury::Call::fund_budget_line { line, amount },
                ) => treasury.fund_budget_line(
                    pallet_futarchy_treasury::Origin::FutarchyTreasury,
                    *line,
                    *amount,
                ),
                RuntimeCall::FutarchyTreasury(pallet_futarchy_treasury::Call::spend {
                    line,
                    dest,
                    amount,
                }) => treasury.spend(
                    pallet_futarchy_treasury::Origin::FutarchyTreasury,
                    now,
                    *line,
                    dest.clone().into(),
                    *amount,
                ),
                RuntimeCall::FutarchyTreasury(pallet_futarchy_treasury::Call::open_stream {
                    line,
                    recipient,
                    total,
                    start,
                    duration,
                }) => treasury
                    .open_stream(
                        pallet_futarchy_treasury::Origin::FutarchyTreasury,
                        now,
                        pallet_futarchy_treasury::StreamInput {
                            line: *line,
                            recipient: recipient.clone().into(),
                            total: *total,
                            start: *start,
                            duration: *duration,
                        },
                    )
                    .map(|_| ()),
                RuntimeCall::FutarchyTreasury(pallet_futarchy_treasury::Call::issue_vit {
                    amount,
                    line,
                }) => treasury.issue_vit(
                    pallet_futarchy_treasury::Origin::FutarchyTreasury,
                    now,
                    *amount,
                    *line,
                ),
                RuntimeCall::System(frame_system::Call::authorize_upgrade { .. })
                    if include_spacing =>
                {
                    authorize_count = authorize_count.saturating_add(1);
                    let spacing_ok = authorize_count == 1
                        && pallet_execution_guard::LastUpgradeAuthorized::<Runtime>::get()
                            .is_none_or(|last| {
                                now >= last.saturating_add(u32_param(b"code.spacing"))
                            });
                    if spacing_ok {
                        Ok(())
                    } else {
                        Err(pallet_futarchy_treasury::CoreError::MeterExhausted)
                    }
                }
                _ => Ok(()),
            };
            if let Err(error) = result {
                verdict = PreviewVerdict::Refused(error);
                return false;
            }
            true
        }) {
            // The visitor stopped us, or the traversal itself refused. If we did
            // not set a verdict, the refusal was the traversal's (over-deep or
            // undecodable nesting) — steps (2), (6) and (11) own that, so it is
            // not a meter verdict either.
            return match verdict {
                PreviewVerdict::Admits => PreviewVerdict::NoVerdict,
                other => other,
            };
        }
    }
    verdict
}

pub struct RuntimeConstitutionAccess;

fn recovery_descriptor_for_calls(
    calls: &[RuntimeCall],
    current_spec_version: u32,
) -> Result<Option<pallet_execution_guard::RecoveryImageDescriptor>, ()> {
    use pallet_execution_guard::BatchDispatcher;
    let mut primary = None;
    let mut recovery = None;
    for call in calls {
        if let Some(hash) = crate::classifier::RuntimeDispatcher::authorize_upgrade_hash(call) {
            if primary.replace(hash).is_some() {
                return Err(());
            }
        }
        if let Some(descriptor) =
            crate::classifier::RuntimeDispatcher::recovery_image_descriptor(call)
        {
            if recovery.replace(descriptor).is_some() {
                return Err(());
            }
        }
    }
    match (primary, recovery) {
        (None, None) => Ok(None),
        (Some(primary), Some(recovery))
            if recovery.hash != primary
                && recovery.len > 0
                && recovery.len <= pallet_preimage::MAX_SIZE
                && current_spec_version
                    .checked_add(2)
                    .is_some_and(|expected| recovery.target_spec_version == expected) =>
        {
            Ok(Some(recovery))
        }
        _ => Err(()),
    }
}

pub(crate) fn required_proposal_bond(
    proposal: &futarchy_primitives::Proposal<AccountId>,
) -> Option<Balance> {
    match proposal.class {
        futarchy_primitives::ProposalClass::Param => Some(balance_param(b"prop.bond.param")),
        futarchy_primitives::ProposalClass::Treasury => proposal
            .ask
            .checked_mul(kernel::TREASURY_BOND_ASK_BPS)
            .and_then(|value| value.checked_div(kernel::BASIS_POINTS_DENOMINATOR))
            .and_then(|surcharge| balance_param(b"prop.bond.trs").checked_add(surcharge)),
        futarchy_primitives::ProposalClass::Code => Some(balance_param(b"prop.bond.code")),
        futarchy_primitives::ProposalClass::Meta => Some(balance_param(b"prop.bond.meta")),
        futarchy_primitives::ProposalClass::Constitutional => None,
    }
}

#[cfg_attr(feature = "runtime-benchmarks", allow(unreachable_code))]
impl pallet_epoch::ConstitutionAccess<AccountId> for RuntimeConstitutionAccess {
    fn required_bond(proposal: &futarchy_primitives::Proposal<AccountId>) -> Option<Balance> {
        required_proposal_bond(proposal)
    }

    fn static_check(
        proposal: &futarchy_primitives::Proposal<AccountId>,
    ) -> pallet_epoch::StaticCheckDisposition {
        use pallet_epoch::StaticCheckDisposition;
        use pallet_execution_guard::{BatchDispatcher, Capabilities, RecoveryImages};
        let Some(bond_floor) = required_proposal_bond(proposal) else {
            return StaticCheckDisposition::Refund(futarchy_primitives::RejectReason::ProcessHold);
        };
        if proposal.bond < bond_floor {
            // The live floor can rise after submission. That drift is not
            // proposer fraud and therefore cannot confiscate the held bond.
            return StaticCheckDisposition::Refund(futarchy_primitives::RejectReason::ProcessHold);
        }
        let Some(calls) = proposal_calls(proposal) else {
            return StaticCheckDisposition::Refund(futarchy_primitives::RejectReason::ProcessHold);
        };
        let recovery = match recovery_descriptor_for_calls(
            &calls,
            proposal
                .version_constraint
                .as_ref()
                .map(|version| version.spec_version)
                .unwrap_or(u32::MAX),
        ) {
            Ok(recovery) => recovery,
            Err(()) => {
                return StaticCheckDisposition::Refund(
                    futarchy_primitives::RejectReason::ProcessHold,
                )
            }
        };
        if let Some(recovery) = recovery {
            let mut primary_hash = None;
            for call in &calls {
                if let Some(hash) =
                    crate::classifier::RuntimeDispatcher::authorize_upgrade_hash(call)
                {
                    if primary_hash.replace(hash).is_some() {
                        return StaticCheckDisposition::Refund(
                            futarchy_primitives::RejectReason::ProcessHold,
                        );
                    }
                }
            }
            let Some(primary_hash) = primary_hash else {
                return StaticCheckDisposition::Refund(
                    futarchy_primitives::RejectReason::ProcessHold,
                );
            };
            let Some(version_constraint) = proposal.version_constraint.clone() else {
                return StaticCheckDisposition::Refund(
                    futarchy_primitives::RejectReason::ProcessHold,
                );
            };
            let qualified =
                pallet_execution_guard::QualifiedRecoveryImages::<Runtime>::get(proposal.id);
            if <Preimage as QueryPreimage>::len(&Hash::from(recovery.hash)) != Some(recovery.len)
                || !RuntimePreimages::is_pinned(recovery.hash)
                || qualified
                    != Some(pallet_execution_guard::QualifiedRecoveryImage {
                        payload_hash: proposal.payload_hash,
                        primary_hash,
                        version_constraint,
                        descriptor: recovery,
                    })
                || <RuntimeAttestations as pallet_execution_guard::Attestations>::artifact_hash(
                    recovery.attestation_id,
                ) != Some(recovery.hash)
                || !<RuntimeAttestations as pallet_execution_guard::Attestations>::present_unrevoked_unchallenged(
                    recovery.attestation_id,
                )
                || !<RuntimeEpochAttestation as pallet_epoch::AttestationAccess>::present_and_quorate(
                    proposal.id,
                    recovery.hash,
                )
            {
                return StaticCheckDisposition::Refund(
                    futarchy_primitives::RejectReason::ProcessHold,
                );
            }
        }
        let footprint = crate::classifier::derive_resource_footprint(&calls);
        let footprint_failure = |error: crate::classifier::FootprintError| {
            if error == crate::classifier::FootprintError::Unclassifiable
                && proposal.resources.is_empty()
            {
                StaticCheckDisposition::Refund(futarchy_primitives::RejectReason::ProcessHold)
            } else {
                StaticCheckDisposition::SlashAll(
                    futarchy_primitives::RejectReason::ConstitutionViolation,
                )
            }
        };
        // 05 §1/T4 requires every proposal payload to derive at least one
        // class domain. Empty batches and call carriers with no classifiable
        // leaf (for example an empty utility batch) are verifiable no-ops,
        // but 06 §4 reserves confiscation for constitution violations and
        // false resource declarations. Cancel and refund them before slot or
        // market allocation instead of fabricating a proposal class.
        let mut has_classifiable_domain = false;
        for call in &calls {
            let Ok(analysis) = crate::classifier::RuntimeDispatcher::rederive_call(call) else {
                return match footprint.as_ref() {
                    Err(error) => footprint_failure(*error),
                    Ok(_) => StaticCheckDisposition::Refund(
                        futarchy_primitives::RejectReason::ProcessHold,
                    ),
                };
            };
            has_classifiable_domain |= !analysis.domains.is_empty();
        }
        if !has_classifiable_domain {
            return footprint_failure(crate::classifier::FootprintError::Unclassifiable);
        }
        let phase_four_payload =
            crate::classifier::RuntimeDispatcher::phase_four_plan(proposal.class, &calls).is_some();
        if !phase_four_payload
            && !calls
                .iter()
                .all(|call| RuntimeCapabilities::call_enabled(proposal.class, call))
        {
            return StaticCheckDisposition::SlashAll(
                futarchy_primitives::RejectReason::ConstitutionViolation,
            );
        }
        // A verified false footprint is a culpable act (05 §2.1 T4) and is slashed
        // regardless of any co-occurring refundable fault. It is evaluated BEFORE the
        // refundable domain/ask arms below so a proposer cannot escape the 100%
        // false-declaration slash by *also* committing a refundable domain violation
        // (e.g. a domain-inadmissible payload that would otherwise refund at
        // `domains_admissible`): the false declaration is slashed first, and the
        // refundable arms are only reached once the declaration is known truthful
        // (SQ-480).
        let footprint = match footprint {
            Ok(footprint) => footprint,
            Err(error) => return footprint_failure(error),
        };
        let declared_matches_footprint = proposal
            .resources
            .iter()
            .all(|resource| footprint.iter().any(|derived| derived == resource))
            && footprint.iter().all(|resource| {
                proposal
                    .resources
                    .iter()
                    .any(|declared| declared == resource)
            });
        if !declared_matches_footprint {
            return StaticCheckDisposition::SlashAll(
                futarchy_primitives::RejectReason::ConstitutionViolation,
            );
        }
        // Mirror the guard's own `enqueue` domain preconditions so `decide` is total
        // (09 §1.1; SQ-308).
        //
        // Disposition is **refund**, not slash. 05 §2.1's T4 taxonomy is explicit
        // that "confiscation requires a verified culpable act" and that "the refund
        // arm is the default and the two slash arms are the enumerated exceptions".
        // This failure is in neither exception: the footprint has been verified to
        // match (checked just above), the capability check passed, and the call
        // re-derived cleanly. The only fault is a classifier projection artifact —
        // `authorize_upgrade` is matched by `is_sub_type` at top level only, so
        // nesting it inside the `utility.batch_all` wrapper that 05 §1.4 explicitly
        // blesses collapses it onto the *apply* domain. Slashing a proposer 100% for
        // using a permitted wrapper would be confiscation without a culpable act.
        if !domains_admissible(proposal.class, &calls) {
            return StaticCheckDisposition::Refund(futarchy_primitives::RejectReason::ProcessHold);
        }
        if matches!(proposal.class, futarchy_primitives::ProposalClass::Treasury)
            && (derived_treasury_ask(&calls) != Some(proposal.ask)
                || Self::in_cap_prize(proposal).is_none())
        {
            return StaticCheckDisposition::Refund(futarchy_primitives::RejectReason::ProcessHold);
        }
        StaticCheckDisposition::Eligible
    }

    fn queue_time_check(proposal: &futarchy_primitives::Proposal<AccountId>) -> bool {
        #[cfg(feature = "runtime-benchmarks")]
        {
            let _ = proposal;
            return true;
        }
        matches!(
            Self::static_check(proposal),
            pallet_epoch::StaticCheckDisposition::Eligible
        ) && proposal.version_constraint
            == pallet_execution_guard::CurrentSpecName::<Runtime>::get()
            && proposal_calls(proposal).is_some_and(|calls| preview_batch_admission(&calls))
    }

    fn in_cap_prize(proposal: &futarchy_primitives::Proposal<AccountId>) -> Option<Balance> {
        #[cfg(feature = "runtime-benchmarks")]
        {
            let _ = proposal;
            return Some(currency::USDC);
        }
        let nav = crate::FutarchyTreasury::nav().spendable_nav;
        let cap_percent = Balance::from(percent_param(b"trs.cap_proposal"));
        match proposal.class {
            futarchy_primitives::ProposalClass::Treasury => {
                // The TREASURY admission ceiling rounds **down**: a larger cap
                // admits a larger ask, so the floor is the conservative side
                // here — the opposite of the CODE/META prize floor below.
                let cap = nav.checked_mul(cap_percent)?.checked_div(100)?;
                let calls = proposal_calls(proposal)?;
                let ask = derived_treasury_ask(&calls)?;
                (ask == proposal.ask && ask <= cap).then_some(ask)
            }
            // 08 §5.2 / 05 §5.6 (SQ-173): PARAM takes the certified
            // capability-envelope value alone; CODE and META take the
            // claimant-adverse `max(ask, envelope)` and, for a runtime-upgrade
            // payload, additionally the `trs.cap_proposal · spendable NAV`
            // floor — an upgrade is assumed able to reach the full
            // per-proposal outflow cap. An absent (unseeded, or amended to
            // zero) envelope stays `None`, which is what blocks Adopt at
            // sizing step 9 rather than fabricating a low prize.
            futarchy_primitives::ProposalClass::Param => class_security_envelope(proposal.class),
            futarchy_primitives::ProposalClass::Code | futarchy_primitives::ProposalClass::Meta => {
                let envelope = class_security_envelope(proposal.class)?;
                let prize = envelope.max(proposal.ask);
                // 08 §5.2: the `trs.cap_proposal · spendable NAV` floor binds
                // **runtime-upgrade payloads** — "an upgrade is assumed able to
                // reach the full per-proposal outflow cap".
                //
                // The differential oracle agrees, though it says so through its
                // caller rather than a flag: `decision.decide` takes no
                // `upgrade_payload` argument and passes `spendable_nav`
                // straight through, so a caller expresses "not an upgrade" by
                // passing `spendable_nav = 0` — which is exactly what the
                // Phase-0 simulation engine does for non-upgrade CODE/META
                // proposals, and what the published calibration the
                // `sec.prize.*` values were adopted from was run under. Reading
                // `decide`'s signature alone suggests an unconditional floor;
                // that reading is wrong, and briefly shipping it here put the
                // runtime at odds with the Phase-0 evidence (SQ-173, corrected
                // 2026-07-25).
                //
                // 05 §5.4 step 9 rounds `InCapPrize` **UP**, so the floor is
                // ceil-rounded: flooring `nav · cap_proposal / 100` would
                // understate it by up to one µUSDC at a boundary NAV.
                if !carries_upgrade_payload(proposal) {
                    return Some(prize);
                }
                let cap = ceil_mul_div(nav, cap_percent, 100)?;
                Some(prize.max(cap))
            }
            // 05 §5.6: Constitutional runs no markets, so step 9 is unreachable.
            futarchy_primitives::ProposalClass::Constitutional => None,
        }
    }

    fn security_terms(
        proposal: &futarchy_primitives::Proposal<AccountId>,
    ) -> Option<pallet_epoch::ProposalSecurityTerms> {
        let prize = Self::in_cap_prize(proposal);
        let delta_floor = <RuntimeEpochParams as pallet_epoch::EpochParamsProvider>::get().delta
            [proposal_class_index(proposal.class)]
        .0;
        Some(pallet_epoch::ProposalSecurityTerms {
            in_cap_prize: prize,
            decision_delta: prize
                .and_then(|value| scaled_decision_delta(proposal.class, delta_floor, value)),
        })
    }

    fn auxiliary_preimage(
        _proposal: &futarchy_primitives::Proposal<AccountId>,
    ) -> Option<futarchy_primitives::H256> {
        // Full runtime images have a dedicated one-image qualification and
        // ownership path in execution-guard. Epoch owns only the ≤64 KiB
        // proposal payload pin; requesting the recovery image here would
        // double-pin it and reintroduce batched PoV/accounting ambiguity.
        None
    }

    fn ledger_frozen() -> bool {
        Self::phase_flags() & pallet_constitution::PhaseFlagsValue::LEDGER_FROZEN != 0
    }

    fn phase_flags() -> u32 {
        crate::Constitution::phase_flags()
    }

    fn note_dead_man_engaged(engaged: bool) -> DispatchResult {
        crate::Constitution::note_dead_man_engaged(engaged)
    }

    fn active_metric_spec_version() -> Option<futarchy_primitives::MetricSpecVersion> {
        let epoch = pallet_epoch::CurrentEpoch::<Runtime>::get();
        pallet_welfare::Pallet::<Runtime>::active_snapshot_spec(epoch)
    }

    fn attestation_artifact(
        proposal: &futarchy_primitives::Proposal<AccountId>,
    ) -> Option<futarchy_primitives::H256> {
        use pallet_execution_guard::BatchDispatcher;
        let calls = proposal_calls(proposal)?;
        let mut artifact = None;
        for call in &calls {
            if let Some(hash) = crate::classifier::RuntimeDispatcher::authorize_upgrade_hash(call) {
                if artifact.replace(hash).is_some() {
                    return None;
                }
            }
        }
        Some(artifact.map_or(proposal.payload_hash, |hash| hash))
    }
}

/// Treasury-free runtime boundary for 08 §4.4. The budget uses the published
/// spendable NAV, which is already zero under reserve impairment and already
/// nets every existing obligation. Per-book predictions reuse market-core's
/// exact ceil-rounded seeding arithmetic, including gate books but excluding
/// the independently-funded Baseline book.
pub struct RuntimePolBudget;

impl pallet_epoch::PolBudget<AccountId> for RuntimePolBudget {
    fn epoch_budget() -> Balance {
        #[cfg(feature = "runtime-benchmarks")]
        {
            Balance::MAX
        }
        #[cfg(not(feature = "runtime-benchmarks"))]
        {
            let nav = crate::FutarchyTreasury::nav().spendable_nav;
            Perbill::from_parts(perbill_param_or(
                b"pol.budget_epoch",
                pallet_constitution::POL_BUDGET_EPOCH_DEFAULT_PPB,
            ))
            .mul_floor(nav)
        }
    }

    fn proposal_seed_plan(
        proposal: &futarchy_primitives::Proposal<AccountId>,
    ) -> Option<pallet_epoch::PolSeedPlan> {
        let floor = match proposal.class {
            futarchy_primitives::ProposalClass::Param => {
                balance_param_or(b"pol.b.param", pallet_constitution::POL_B_DEFAULTS[0])
            }
            futarchy_primitives::ProposalClass::Treasury => {
                balance_param_or(b"pol.b.trs", pallet_constitution::POL_B_DEFAULTS[1])
            }
            futarchy_primitives::ProposalClass::Code => {
                balance_param_or(b"pol.b.code", pallet_constitution::POL_B_DEFAULTS[2])
            }
            futarchy_primitives::ProposalClass::Meta => {
                balance_param_or(b"pol.b.meta", pallet_constitution::POL_B_DEFAULTS[3])
            }
            futarchy_primitives::ProposalClass::Constitutional => return None,
        };
        let b = match pallet_epoch::Pallet::<Runtime>::proposal_security_terms(proposal.id) {
            Some(terms) => terms
                .in_cap_prize
                .and_then(|prize| scaled_pol_floor(proposal.class, floor, prize))
                .unwrap_or(floor),
            // Standalone benchmark/view fixtures may begin at Seed without a
            // qualification transition. Preserve their flat-floor behavior;
            // live qualified proposals always carry the map entry.
            None => floor,
        };
        let decision = pallet_market::core_market::seed_headroom(b)
            .ok()?
            .checked_mul(2)?;
        let gate_required = pallet_epoch::requires_gate_markets(proposal.class);
        if gate_required {
            let gate_b = balance_param_or(b"pol.b_gate", pallet_constitution::POL_GATE_B_DEFAULT);
            let gates = pallet_market::core_market::seed_headroom(gate_b)
                .ok()?
                .checked_mul(4)?;
            decision
                .checked_add(gates)
                .map(|commitment| pallet_epoch::PolSeedPlan {
                    commitment,
                    decision_b: b,
                    gate_b: Some(gate_b),
                })
        } else {
            Some(pallet_epoch::PolSeedPlan {
                commitment: decision,
                decision_b: b,
                gate_b: None,
            })
        }
    }
}

pub struct RuntimeEpochPreimages;
impl pallet_epoch::PreimageAccess for RuntimeEpochPreimages {
    fn len(hash: futarchy_primitives::H256) -> Option<u32> {
        <RuntimePreimages as pallet_execution_guard::Preimages>::len(hash)
    }
    fn request(hash: futarchy_primitives::H256) -> DispatchResult {
        let hash = Hash::from(hash);
        if <Preimage as QueryPreimage>::len(&hash).is_none() {
            return Err(DispatchError::Other("epoch qualification preimage absent"));
        }
        <Preimage as QueryPreimage>::request(&hash);
        Ok(())
    }
    fn unrequest(hash: futarchy_primitives::H256) {
        <Preimage as QueryPreimage>::unrequest(&Hash::from(hash));
    }
}

pub struct RuntimeEpochWelfare;
impl pallet_epoch::WelfareSettlement for RuntimeEpochWelfare {
    fn gate_window_sampled(epoch: EpochId) -> bool {
        pallet_welfare::Pallet::<Runtime>::gate_window_sampled(epoch)
    }

    fn compute_settlement(
        cohort_epoch: EpochId,
        spec: futarchy_primitives::MetricSpecVersion,
        targets: &[pallet_epoch::SettlementTarget],
    ) -> Result<FixedU64, DispatchError> {
        let targets = targets
            .iter()
            .map(|target| match target {
                pallet_epoch::SettlementTarget::Proposal {
                    pid,
                    has_gate_books,
                } => pallet_welfare::SettleTarget::Proposal {
                    pid: *pid,
                    has_gate_books: *has_gate_books,
                },
                pallet_epoch::SettlementTarget::Baseline => pallet_welfare::SettleTarget::Baseline,
            })
            .collect::<alloc::vec::Vec<_>>();
        pallet_welfare::Pallet::<Runtime>::compute_settlement(cohort_epoch, spec, &targets)
    }
    fn settle_baseline_void(cohort_epoch: EpochId) -> frame_support::dispatch::DispatchResult {
        pallet_welfare::Pallet::<Runtime>::settle_baseline_void(cohort_epoch)
    }
    fn prune(current_epoch: EpochId) -> frame_support::dispatch::DispatchResult {
        // 05 §3.3: cutoff e−19 removes exactly ≤ e−20 and retains one
        // capacity slot for the next snapshot. Expressed against the retained
        // **epoch** window, not the record bound — the two stopped being the
        // same number once `MAX_SNAPSHOTS` took 05 §3.3's version
        // multiplicity, and taking the record bound here would have doubled
        // the retained window to 39 epochs.
        let cutoff = current_epoch
            .saturating_sub(pallet_welfare::SNAPSHOT_RETENTION_EPOCHS_BOUND.saturating_sub(1));
        pallet_welfare::Pallet::<Runtime>::prune(cutoff)
    }

    fn roll_maintenance(current_epoch: EpochId) -> frame_support::dispatch::DispatchResult {
        let cutoff = current_epoch.saturating_sub(pallet_welfare::SNAPSHOT_RETENTION_EPOCHS_BOUND);
        pallet_welfare::Pallet::<Runtime>::prune_xcm_traffic(cutoff)?;
        // SQ-201 / 05 §3.3: cohort reap is not the only prune trigger. Tick
        // invokes this seam on every successful roll — including rolls that
        // settle no cohort — so it is the epoch-roll hook the snapshot/gate
        // window needs. The cutoff is the same `current - 19` used by `prune`
        // above, so this retires strictly nothing that reap would have kept.
        let history_cutoff = current_epoch
            .saturating_sub(pallet_welfare::SNAPSHOT_RETENTION_EPOCHS_BOUND.saturating_sub(1));
        pallet_welfare::Pallet::<Runtime>::prune_epoch_roll(history_cutoff)
    }
}

pub struct RuntimeEpochLedger;
impl pallet_epoch::LedgerResolution for RuntimeEpochLedger {
    fn create_vault(
        pid: futarchy_primitives::ProposalId,
        spec: futarchy_primitives::MetricSpecVersion,
    ) -> DispatchResult {
        match pallet_conditional_ledger::Vaults::<Runtime>::get(pid) {
            Some(vault) if vault.spec == spec => Ok(()),
            Some(_) => Err(DispatchError::Other("epoch vault metric-spec mismatch")),
            None => {
                ConditionalLedger::create_vault(RuntimeOrigin::signed(market_account()), pid, spec)
            }
        }
    }

    fn resolve(
        pid: futarchy_primitives::ProposalId,
        branch: futarchy_primitives::Branch,
    ) -> DispatchResult {
        ConditionalLedger::resolve(epoch_signed_origin(), pid, branch)
    }

    fn void(pid: futarchy_primitives::ProposalId) -> DispatchResult {
        frame_support::storage::with_storage_layer(|| {
            ConditionalLedger::void(epoch_signed_origin(), pid)?;
            pallet_market::Pallet::<Runtime>::observe_proposal_terminal(pid)
        })
    }
}

pub struct RuntimeProposalBond;
impl pallet_epoch::ProposalBondCurrency<AccountId> for RuntimeProposalBond {
    fn hold(who: &AccountId, amount: Balance) -> DispatchResult {
        <ForeignAssets as Mutate<AccountId>>::transfer(
            usdc_location(),
            who,
            &epoch_account(),
            amount,
            Preservation::Expendable,
        )
        .map(|_| ())
    }

    fn release(who: &AccountId, amount: Balance) -> DispatchResult {
        <ForeignAssets as Mutate<AccountId>>::transfer(
            usdc_location(),
            &epoch_account(),
            who,
            amount,
            Preservation::Expendable,
        )
        .map(|_| ())
    }

    fn slash_to_insurance(amount: Balance) -> DispatchResult {
        <ForeignAssets as Mutate<AccountId>>::transfer(
            usdc_location(),
            &epoch_account(),
            &insurance_account(),
            amount,
            Preservation::Expendable,
        )?;
        // 08 §1.2 (SQ-518): slash proceeds are one of the three inflow classes
        // that execute treasury code, so the above-target surplus overflows to
        // `MAIN` in this same transaction — "no crank for those". The
        // permissionless `reconcile_insurance` is the backstop for *direct*
        // transfers, which cannot be intercepted, not the intended path here.
        //
        // Best-effort by design: the confiscation is the security-critical act
        // and a cleanup failure must not void it (G-1); whatever is left above
        // target is exactly what the crank clears. The inner storage layer is
        // load-bearing rather than defensive — `overflow_insurance` credits
        // `main_usdc` before moving custody and relies on the *dispatch* to
        // undo the credit if custody refuses. Swallowing the error without a
        // layer would keep that credit, overstating NAV against custody that
        // never moved.
        let _ = frame_support::storage::with_storage_layer(|| {
            FutarchyTreasury::note_insurance_inflow()
        });
        Ok(())
    }

    fn escrow_balance() -> Balance {
        <ForeignAssets as Inspect<AccountId>>::balance(usdc_location(), &epoch_account())
    }
}

pub struct RuntimeCollatorCompensation;
impl pallet_epoch::CollatorCompensation for RuntimeCollatorCompensation {
    fn pay() {
        FutarchyTreasury::pay_collator_compensation();
    }
}

impl pallet_epoch::Config for Runtime {
    type Params = RuntimeEpochParams;
    type Market = RuntimeMarketAccess;
    type Oracle = RuntimeEpochOracle;
    type Guardian = RuntimeEpochGuardian;
    type Attestation = RuntimeEpochAttestation;
    type Constitution = RuntimeConstitutionAccess;
    type PolBudget = RuntimePolBudget;
    type ProposalBond = RuntimeProposalBond;
    type Preimage = RuntimeEpochPreimages;
    type ExecutionGuard = RuntimeEpochExecutionGuard;
    type Welfare = RuntimeEpochWelfare;
    type Ledger = RuntimeEpochLedger;
    type KeeperRebate = FutarchyTreasury;
    type CollatorCompensation = RuntimeCollatorCompensation;
    type GuardianOrigin = pallet_origins::EnsureGuardianHold;
    type ExecutionGuardOrigin = EnsureExecutionGuardAccount;
    type VoidAuthority = pallet_origins::EnsureEmergencyPlaybook;
    type EmergencyPlaybookOrigin = pallet_origins::EnsureEmergencyPlaybook;
    type ConstitutionalValuesOrigin = pallet_origins::EnsureConstitutionalValues;
    type WeightInfo = crate::weights::pallet_epoch::WeightInfo<Runtime>;
    #[cfg(feature = "runtime-benchmarks")]
    type BenchmarkHelper = RuntimeBenchmarkHelper;
}

pub struct WelfareParams;
impl pallet_welfare::WelfareParamsProvider for WelfareParams {
    fn theta_s_lo() -> FixedU64 {
        FixedU64(fixed_param(b"welfare.thS_lo"))
    }
    fn theta_s_hi() -> FixedU64 {
        FixedU64(fixed_param(b"welfare.thS_hi"))
    }
    fn theta_c_lo() -> FixedU64 {
        FixedU64(fixed_param(b"welfare.thC_lo"))
    }
    fn theta_c_hi() -> FixedU64 {
        FixedU64(fixed_param(b"welfare.thC_hi"))
    }
    fn w_p() -> FixedU64 {
        FixedU64(fixed_param(b"welfare.wP"))
    }
    fn w_a() -> FixedU64 {
        FixedU64(fixed_param(b"welfare.wA"))
    }
}
#[allow(dead_code)]
pub(crate) fn xcm_health(counters: pallet_welfare::XcmTrafficCounters) -> FixedU64 {
    let total = u128::from(counters.accepted)
        .saturating_add(u128::from(counters.failed))
        .saturating_add(u128::from(counters.probe_timeouts));
    if total == 0 {
        return FixedU64(pallet_welfare::ONE);
    }

    // The 1e9-grid division floors, so rounding can only reduce reported
    // health. Every checked-arithmetic failure also falls back to zero rather
    // than fabricating an optimistic value.
    let value = u128::from(counters.accepted)
        .checked_mul(u128::from(pallet_welfare::ONE))
        .and_then(|numerator| numerator.checked_div(total))
        .and_then(|scaled| u64::try_from(scaled).ok())
        .map_or(0, |scaled| scaled);
    FixedU64(value)
}

/// The size of an epoch's **measurable day set** (05 §4.7, normative; SQ-181):
/// its whole days, floored at one.
///
/// The single home of the day *domain* every daily component shares. A legal
/// `epoch.length` need not be a day multiple, and a trailing partial day is not
/// a completed cadence slot, so the count floor-divides; the floor at one keeps
/// a sub-day epoch — the shape the compressed `fast-timing` build produces —
/// from having an empty measurable set and therefore passing vacuously.
///
/// Read by two callers that must not disagree: 07 §8's `R` range below, which
/// intersects this with the probe's arming day, and `record_daily_gate`'s day
/// guard through [`RuntimeSnapshotSchedule`]. Before SQ-181 only the former
/// existed and the latter bounded `day` by `MAX_DAILY_GATE_SAMPLES` alone — a
/// *storage* bound on the breach bitmap — so a keeper could name a day the
/// epoch never had and the three daily components each improvised a different
/// answer for it (`X` = 1, `K` = 0, `R` refuses).
///
/// `None` means the epoch's timing is unknown: membership cannot be decided, and
/// both callers refuse rather than assume (G-1).
///
/// The set is read off the epoch's **scheduled** length, not the span it
/// physically occupied. Those differ under a 05 §4.8 pause or a late crank,
/// where the live epoch has no end bound and the day index keeps advancing past
/// `length / BLOCKS_PER_DAY`; authorship recorded on such a day is then held but
/// not samplable. That is the fail-closed reading of §4.7's "the epoch actually
/// contained it" — it can only cost daily coverage, never manufacture a breach
/// out of a day whose components were not all measured, and §4.7 requires one
/// recorded day per measurement epoch rather than a coverage fraction.
fn epoch_measurable_days(epoch: EpochId) -> Option<u32> {
    pallet_epoch::Pallet::<Runtime>::epoch_timing(epoch).map(measurable_days_of)
}

/// [`epoch_measurable_days`] over an already-read timing.
fn measurable_days_of(timing: pallet_epoch::EpochTiming) -> u32 {
    timing
        .length
        .checked_div(kernel::BLOCKS_PER_DAY)
        .unwrap_or(0)
        .max(1)
}

/// The epoch's **measured day range** `[first, last)` for 07 §8's `R`, or
/// `None` when nothing was measured (SQ-195).
///
/// Single-homed deliberately: the daily and epoch rules previously computed
/// this separately and drifted apart twice — a day one accepted the other
/// excluded, which let a keeper manufacture a `C_daily` breach on a day the
/// epoch projection did not even require. Sharing the range makes them agree by
/// construction rather than by inspection.
///
/// `first` skips days that ended before `ReserveProbeArmedAt`, since §8 scores
/// zero pre-arm slots. `last` is the epoch's last **whole** day: a legal
/// `epoch.length` need not be a day multiple, and a trailing partial day is not
/// a completed cadence slot. Floored at one day so a sub-day epoch — the shape
/// the compressed `fast-timing` build produces — still requires a recorded pass
/// instead of passing vacuously.
#[allow(dead_code)]
fn reserve_probe_measured_range(epoch: EpochId) -> Option<(u32, u32)> {
    let timing = pallet_epoch::Pallet::<Runtime>::epoch_timing(epoch)?;
    let day_len = kernel::BLOCKS_PER_DAY;
    // Nothing was measured if the probe armed at or after this epoch ended.
    // This must be decided *before* the sub-day floor below: for an epoch
    // shorter than one day, `armed_at` past its end still floor-divides to day
    // 0, so the floor would manufacture a required day 0 and report an entirely
    // unmeasured epoch as **failed** rather than unmeasured (07 §8; 05 §4.4).
    let epoch_end = timing.start.saturating_add(timing.length);
    if pallet_oracle::Pallet::<Runtime>::reserve_probe_armed_at()
        .is_some_and(|armed_at| armed_at >= epoch_end)
    {
        return None;
    }
    // 05 §4.7's measurable day set, shared with `record_daily_gate`'s day guard
    // rather than recomputed: `R`'s range is that set intersected with the
    // probe's arming day, and the two disagreeing is the failure SQ-181 closes.
    let last = measurable_days_of(timing);
    let first = match pallet_oracle::Pallet::<Runtime>::reserve_probe_armed_at() {
        Some(armed_at) if armed_at > timing.start => armed_at
            .saturating_sub(timing.start)
            .checked_div(day_len)
            .unwrap_or(0),
        // Armed at or before this epoch began — the whole epoch is measured.
        //
        // `None` lands here too: a chain that armed under a runtime predating
        // `ReserveProbeArmedAt` has no recorded latch block. Treating the whole
        // epoch as measured is the conservative direction — it *requires* more
        // coverage, never less — so an upgrade cannot use a missing record to
        // shrink the measured range (07 §8 upgrade compatibility).
        _ => 0,
    };
    (first < last).then_some((first, last))
}

/// Day-level `R` for 05 §4.4's `C_daily` (07 §8; SQ-195).
///
/// A recorded pass scores 1 and an unrecorded day scores 0 — "absence is never
/// healthy", and §8 gives `R` no benefit-of-the-doubt branch unlike `X`.
///
/// **Except before arming.** §8 scores zero pre-arm wall-clock slots, so a day
/// that ended before the probe armed is *unavailable*, not a failure: a late
/// daily crank must not retroactively classify time before the mechanism
/// existed as a reserve outage and set a `C_daily` breach flag from it. The
/// global armed latch alone is not enough to decide this — it says the probe is
/// armed *now*, not that it was armed on the day being scored.
#[allow(dead_code)]
fn reserve_probe_daily_value(epoch: EpochId, day: u8) -> Option<FixedU64> {
    // Outside the measured range the day is **unavailable**, whatever storage
    // happens to hold. That covers three cases a keeper or a retired probe
    // generation could otherwise turn into a false breach: a day that ended
    // before arming, the epoch's trailing partial day, and a day index beyond
    // the epoch entirely. A stale outcome recorded by a previous probe
    // generation cannot resurrect one of those days either, because the range —
    // not the record — decides membership.
    let (first, last) = reserve_probe_measured_range(epoch)?;
    let index = u32::from(day);
    if index < first || index >= last {
        return None;
    }
    // Inside the range: a recorded pass scores 1, and anything else — a
    // recorded failure or no record at all — scores 0. "Absence is never
    // healthy"; §8 gives `R` no benefit-of-the-doubt branch, unlike `X`.
    let recorded = pallet_welfare::Pallet::<Runtime>::reserve_probe_daily(epoch, day);
    Some(FixedU64(if recorded == Some(true) {
        pallet_welfare::ONE
    } else {
        0
    }))
}

/// Epoch-level `R` for 05 §4.4's settlement-time `C_e` (07 §8; SQ-195).
///
/// 07 §8 defines only `R_daily`, so the epoch projection is derived here — and
/// it is a **cover check over actual days**, not a count of passes. Counting is
/// not covering: three passes recorded on days 5–7 would satisfy a count of
/// three while days 0–2 went unprobed, and "absence is never healthy" has no
/// benefit-of-the-doubt branch. Every day in the measured range must carry a
/// recorded pass.
///
/// The measured range starts at the **arming day**, because §8 scores zero
/// pre-arm slots — "time before a complete runnable probe existed is not
/// retroactively classified as an outage". Without that, an epoch in which the
/// probe armed late could never read healthy however completely its post-arm
/// days passed. It ends at the epoch's last whole day; a legal `epoch.length`
/// need not be a day multiple, and the trailing partial day is not a completed
/// cadence slot. The range is floored at one day so a sub-day epoch — which the
/// compressed `fast-timing` build produces — still requires a recorded pass
/// rather than passing vacuously.
///
/// `None` (unavailable, crank fails status-quo-safe) only when the epoch's
/// timing is unknown — never as a stand-in for "nothing recorded".
#[allow(dead_code)]
fn reserve_probe_epoch_value(epoch: EpochId) -> Option<bool> {
    let (first, last) = reserve_probe_measured_range(epoch)?;
    for day in first..last {
        let day = u8::try_from(day).ok()?;
        if pallet_welfare::Pallet::<Runtime>::reserve_probe_daily(epoch, day) != Some(true) {
            return Some(false);
        }
    }
    Some(true)
}

/// One window's authorship observations as the 05 §4.3 projection reads them.
///
/// The two readings are deliberately separate methods rather than one slice,
/// because a truncated window is safe for one and misleading for the other and
/// nothing about a bare `&[(AccountId, u32)]` says so.
#[allow(dead_code)]
pub(crate) struct AuthorshipWindowInput {
    authors: Vec<(AccountId, u32)>,
    /// The window dropped an author for want of room (13 §4 bound).
    truncated: bool,
}

#[allow(dead_code)]
impl AuthorshipWindowInput {
    /// Read the window from pallet storage at the epoch granularity.
    pub(crate) fn epoch(epoch: EpochId) -> Self {
        let window = pallet_welfare::Pallet::<Runtime>::collator_authorship_epoch(epoch);
        Self {
            authors: window.authors.into_inner(),
            truncated: window.truncated,
        }
    }

    /// Read the window from pallet storage at the day granularity.
    pub(crate) fn day(epoch: EpochId, day: u8) -> Self {
        let window = pallet_welfare::Pallet::<Runtime>::collator_authorship(epoch, day);
        Self {
            authors: window.authors.into_inner(),
            truncated: window.truncated,
        }
    }

    /// Distinct authors that produced at least one block in the window.
    ///
    /// Usable on a **truncated** window: a dropped author lowers the count, and
    /// every count consumer (`K`, and `U` when it lands) reads a lower count as
    /// less healthy. The error direction is therefore pessimistic, which is the
    /// one G-1 permits.
    pub(crate) fn distinct_active(&self) -> usize {
        self.authors
            .iter()
            .filter(|(_, blocks)| *blocks > 0)
            .count()
    }

    /// The per-author distribution, or `None` when the window is truncated.
    ///
    /// **Not** usable on a truncated window, and that asymmetry is the point:
    /// `D_eff` (05 §4.5) reads concentration, and a window full of early
    /// low-count authors that then drops a newly rotated author producing most
    /// of the remaining blocks retains a near-uniform distribution while the
    /// real one is concentrated — a *better* reading than the truth, not a worse
    /// one. A concentration consumer must therefore treat the window as
    /// unavailable (and fail its crank status-quo-safe) rather than read it.
    ///
    /// An **empty** window is unavailable for the same reason, and this is where
    /// the count and distribution readings part company most sharply. `K` reads
    /// an empty window as 0 — nobody authored, which is precisely the
    /// collator-set failure it measures. Concentration has no such reading: 05
    /// §4.5's `D_eff = min(1, (1 − HHI)/(1 − 1/n_cap))` over an empty author set
    /// has no defined HHI, and the arithmetic that falls out of one (a zero sum)
    /// would score a *perfect* 1.0 out of no observations at all — absence read
    /// as health, which §4.4 already refuses for `H`.
    pub(crate) fn distribution(&self) -> Option<&[(AccountId, u32)]> {
        (!self.truncated && !self.authors.is_empty()).then_some(self.authors.as_slice())
    }
}

/// Collator-set adequacy `K` for 05 §4.3: `min(1, distinct_active_authors /
/// collator.n_min)` on the 1e9 grid.
///
/// "Active" is *authored at least one block in the window* — a registered
/// collator that produced nothing is not evidence of an adequate set, which is
/// exactly the failure `K` exists to see. The series already holds one entry per
/// author, so the count is over entries carrying a non-zero count.
///
/// A **truncated** window is read anyway: `K` is a count, and the drop can only
/// lower it (see [`AuthorshipWindowInput::distinct_active`]).
///
/// `collator.n_min` is a live 13 §1 key (rule 4 — never the literal 4), and a
/// zero denominator has no defined quotient. Rather than substitute anything,
/// `K` goes **absent** and the crank fails status-quo-safe, the same answer
/// every other unavailable input gets. The registry's own `min` bound is 3, so
/// zero is unreachable through governance; this is the defensive branch for a
/// key read that answers zero for any other reason, and fabricating a value
/// there would raise `C_onchain` out of a denominator the chain does not have.
///
/// The division truncates, which rounds `K` **down** — the maker-adverse
/// direction for a health score (rule 2 / I-5): a partially-covered collator
/// set never rounds up into adequacy.
#[allow(dead_code)]
fn collator_adequacy(authorship: &AuthorshipWindowInput) -> Option<FixedU64> {
    let n_min = u128::from(u8_param(b"collator.n_min"));
    if n_min == 0 {
        return None;
    }
    let distinct = authorship.distinct_active() as u128;
    let scaled = distinct
        .saturating_mul(u128::from(pallet_welfare::ONE))
        .checked_div(n_min)?
        .min(u128::from(pallet_welfare::ONE));
    Some(FixedU64(u64::try_from(scaled).ok()?))
}

/// 05 §4.3.2 block production `U` over one already-accumulated window.
///
/// ```text
/// U = clamp((non_empty_blocks + 0.25 · empty_blocks) / relay_slots, 0, 1)
/// ```
///
/// The quarter weight is exact in integer arithmetic because numerator and
/// denominator are both scaled by four; the quotient then floors, which is the
/// same round-toward-−∞ direction 05 §4.4's determinism discipline applies to
/// every other welfare term and the conservative one for a liveness score.
///
/// A ratio above 1 is legitimate and clamps: two parachain blocks can share a
/// relay parent (elastic scaling), and a chain producing more blocks than relay
/// slots is maximum liveness, not an error.
///
/// **A zero denominator resolves the component absent**, never 1.0. No relay
/// slot was observed for the window, so nothing about its liveness is known —
/// and 05 §4.3.2 exists precisely because the fabricated-1 reading of `U` (the
/// parachain-block denominator) measures nothing. `record_snapshot` treats a
/// registered-but-missing input as an error, so the crank fails
/// status-quo-safe like every other unproduced component (G-1).
#[allow(dead_code)]
fn block_production(counters: pallet_welfare::BlockProductionCounters) -> Option<FixedU64> {
    if counters.relay_slots == 0 {
        return None;
    }
    let one = u128::from(pallet_welfare::ONE);
    let numerator = u128::from(counters.non_empty_blocks)
        .checked_mul(4)?
        .checked_add(u128::from(counters.empty_blocks))?;
    let denominator = u128::from(counters.relay_slots).checked_mul(4)?;
    let scaled = numerator
        .checked_mul(one)?
        .checked_div(denominator)?
        .min(one);
    Some(FixedU64(u64::try_from(scaled).ok()?))
}

/// Primary/system weight headroom `H` for 05 §4.3 and 16 §8.5, or `None` when
/// the primary window sampled no block.
///
/// §4.3 gives `H = 1 − mean(block weight used ÷ limit)`, "mapped so 40% target
/// utilization ⇒ 1". `PrimaryBlockWeightSamples` excludes external work before
/// sampling, but remains in the physical `max_block` coordinate system. The
/// original affine map therefore runs literally, with no transformed target or
/// scale:
///
/// ```text
/// H = clamp( (1 − mean) / (1 − target), 0, 1 ),  target = 0.40
/// ```
///
/// — the raw physical-coordinate headroom rescaled by the headroom a chain
/// running exactly at target has left. Below that target the quotient exceeds 1
/// and clamps: spare capacity is *healthy*, not better than healthy, and
/// letting `H` run above 1 would push `C_onchain` above the [0,1] domain every
/// other component and both §4.1 gates are defined on.
///
/// **A window with no sampled block is absent, never 1.** §4.3's missing-data
/// column gives `H` no "no data ⇒ 1" rule — unlike `X` ("no traffic ⇒ 1") and
/// `Π` ("no events ⇒ 1"), where absence of the *observed thing* is itself the
/// healthy observation. Absence of a block sample is absence of the
/// *measurement*, which is a different fact: a chain that produced no block
/// produced no evidence of headroom, and fabricating 1 there would raise
/// `C_onchain` out of a window nothing measured. Returning `None` makes
/// `record_snapshot` refuse and the crank fail status-quo-safe (G-1).
///
/// The mean is rounded **up** (so utilization is never understated), and the
/// quotient is rounded down (so `H` is never overstated). There is no second
/// scale or converted target: independently rounded constants would break the
/// required zero-external bit identity with the pre-partition formula.
pub(crate) fn weight_headroom(sample: pallet_welfare::BlockWeightSample) -> Option<FixedU64> {
    let blocks = u128::from(sample.blocks);
    if blocks == 0 {
        return None;
    }
    let one = u128::from(pallet_welfare::ONE);
    // Ceiling division: round the mean utilization up.
    let mean = u128::from(sample.utilization_sum)
        .checked_add(blocks.saturating_sub(1))?
        .checked_div(blocks)?
        .min(one);
    let target = u128::from(futarchy_primitives::kernel::WEIGHT_HEADROOM_TARGET_UTILIZATION);
    // `target` is a kernel constant strictly below `ONE`, so the denominator is
    // positive; `checked_div` is the defensive form rather than a live branch.
    let denominator = one.checked_sub(target)?;
    let headroom = one.saturating_sub(mean);
    let scaled = headroom
        .checked_mul(one)?
        .checked_div(denominator)?
        .min(one);
    Some(FixedU64(u64::try_from(scaled).ok()?))
}

/// Runtime integrity `Π` for 05 §4.3: `max(0, 1 − 0.25 · events)`.
///
/// **No events is legitimately 1**, and that asymmetry with `H` above is
/// deliberate, not an oversight. §4.3's missing-data column says so in as many
/// words ("no events ⇒ 1"), and the reason is that the two components observe
/// different kinds of thing. `Π` counts *occurrences of a fault*; a window with
/// none is a window in which the runtime's assumptions held, which is the
/// healthy observation itself and needs no separate measurement to exist.
/// `H` averages a *quantity*; a window with no sample has no average, healthy or
/// otherwise. So absence means "fine" for `Π` and "unavailable" for `H`, and the
/// counter is `ValueQuery` for exactly that reason — an unwritten key is a real
/// zero, not a missing one.
///
/// Saturating at [`futarchy_primitives::kernel::INTEGRITY_FAILURES_TO_ZERO`]
/// events, per 05 §4.3.2's per-window saturating counter.
#[allow(dead_code)]
fn runtime_integrity(events: u32) -> FixedU64 {
    FixedU64(pallet_welfare::ONE.saturating_sub(
        u64::from(events).saturating_mul(futarchy_primitives::kernel::INTEGRITY_FAILURE_PENALTY),
    ))
}

/// The already-resolved per-window inputs [`metric_components`] projects into
/// 05 §4.3 component values.
///
/// A struct rather than a positional list because the two callers differ only
/// in the *granularity* each field was resolved at — epoch-wide for
/// `onchain_components`, one day for `daily_components` — and a positional
/// call site makes that invisible at exactly the place it matters. It also
/// stops the list growing a fourth, fifth and sixth unnamed argument as `Π`,
/// `H` and `E` land.
#[allow(dead_code)]
struct MetricComponentInputs {
    /// Local XCM transport/probe counters for the window (09 §6.4).
    counters: pallet_welfare::XcmTrafficCounters,
    /// Already-resolved `R`, or `None` meaning **unavailable** — a distinct fact
    /// from a recorded breach. Callers resolve it because the two granularities
    /// treat absence differently: an unrecorded *day* is a fail (07 §8), while
    /// an epoch with no measurable range is not measured at all.
    reserve: Option<FixedU64>,
    /// The window's authorship observations (05 §4.3). Absence is simply an
    /// empty window here — no author, no block — which yields `K = 0` rather
    /// than an unavailable component: a chain that authored nothing in the
    /// window is precisely the collator-set failure `K` measures, and it is
    /// observable without any mechanism having to be armed first.
    ///
    /// One boundary case follows from that and is deliberately *not* given an
    /// `R`-style measured-range guard, because it is closed elsewhere: **the
    /// runtime upgrade that introduces the series.** Days before it recorded
    /// nothing and would read `K = 0`. 05 §4.6 requires any spec registering `K`
    /// to activate at `now + 2` at the earliest, so by the first epoch `K` is
    /// ever scored the series has covered it whole — and no registered spec
    /// carries id 6 today.
    ///
    /// A day index past the epoch's real span used to be a second such case, and
    /// is now impossible rather than tolerated: 05 §4.7's measurable day set is
    /// normative and `record_daily_gate` refuses a day outside it (SQ-181), so
    /// the projection is never asked for a window that does not exist.
    authorship: AuthorshipWindowInput,
    /// Block-production terms for the window (05 §4.3.2). Absence is carried in
    /// the counters themselves: a zero relay-slot denominator means the window
    /// was never observed, and `block_production` resolves it **absent** rather
    /// than scoring it.
    block_production: pallet_welfare::BlockProductionCounters,
    /// Block-weight utilization accumulator for the window (05 §4.3 `H`).
    /// A zero block count is *unavailable*, and [`weight_headroom`] says why.
    headroom: pallet_welfare::BlockWeightSample,
    /// Qualifying 05 §4.3.2 defensive-path failures counted in the window
    /// (`Π`). Zero is a legitimate value, not a missing one.
    integrity_events: u32,
}

#[allow(dead_code)]
fn metric_components(
    epoch: EpochId,
    spec_version: u16,
    inputs: MetricComponentInputs,
) -> Vec<pallet_welfare::ComponentValue> {
    let Some(specs) = pallet_welfare::MetricSpecs::<Runtime>::get(spec_version) else {
        return Vec::new();
    };
    let x = xcm_health(inputs.counters);
    let k = collator_adequacy(&inputs.authorship);
    let u = block_production(inputs.block_production);
    let h = weight_headroom(inputs.headroom);
    let pi = runtime_integrity(inputs.integrity_events);
    specs
        .iter()
        .filter(|spec| {
            // Honor the 05 §4.3 **source column**, not the pillar. This path
            // computes the deterministic runtime-state components, and 05 §4.3
            // puts those in two pillars: `C_onchain` and `S` — `U` is an S
            // component, so a `pillar == COnchain` filter made it structurally
            // unemittable however it was registered.
            //
            // `welfare-core`'s `source_matches_pillar` makes the source test
            // exactly equivalent for `C_onchain` (S and `C_onchain` are both
            // on-chain/relay-derived; `C_attested` and `A` are both attested),
            // so nothing that used to be emitted stops being emitted and no
            // attested component can ever reach this path. `P` is deliberately
            // excluded here even though its current class is on-chain: its
            // fees/users/settled-value producers are not implemented, and this
            // primary-only seam must never become a route by which hosted
            // activity inflates P (05 §4.3; 16 §8.5).
            spec.activation_epoch <= epoch
                && !matches!(spec.pillar, pallet_welfare::Pillar::P)
                && matches!(
                    spec.source,
                    pallet_welfare::SourceClass::Onchain
                        | pallet_welfare::SourceClass::RelayDerived
                )
        })
        .filter_map(|spec| {
            let value = match spec.id {
                futarchy_primitives::metric_ids::X => x,
                // 05 §4.3.2 (A14). `None` means the window recorded no relay
                // slots at all, so `U` is **unavailable** — absent, never the
                // fabricated 1.0 the superseded parachain-block reading gave.
                futarchy_primitives::metric_ids::U => match u {
                    Some(value) => value,
                    None => return None,
                },
                futarchy_primitives::metric_ids::R => {
                    // 07 §8 (SQ-195). Before the probe arms, `R` is **not
                    // measured**: the `ReserveProbeArmed` latch exists because
                    // pre-arm wall-clock slots are not outages, and scoring
                    // them 0 would set the C breach flag out of a mechanism
                    // that never ran — fail-destructive, not fail-safe. So an
                    // unarmed chain leaves `R` absent and a spec registering it
                    // fails the crank status-quo-safe, as before.
                    if !pallet_oracle::Pallet::<Runtime>::reserve_probe_armed() {
                        return None;
                    }
                    // Armed. `None` here is **unavailable**, not a breach:
                    // flattening it to 0 would settle gate books as breached out
                    // of an epoch the probe never measured. Absence of a *day*
                    // is still a fail — the caller has already resolved that.
                    match inputs.reserve {
                        Some(value) => value,
                        None => return None,
                    }
                }
                // 05 §4.3 (A14). `None` here means `collator.n_min` read zero,
                // so the quotient is undefined — absent, never substituted. `K`
                // reads the window's author *count*, which a truncated window
                // only understates, so it needs no availability check of its own.
                futarchy_primitives::metric_ids::K => match k {
                    Some(value) => value,
                    None => return None,
                },
                // 05 §4.3 (A14). `None` means the window sampled no block, so
                // there is no mean to map — absent, never the fabricated 1 that
                // would raise `C_onchain` out of an unmeasured window.
                futarchy_primitives::metric_ids::H => match h {
                    Some(value) => value,
                    None => return None,
                },
                // 05 §4.3/§4.3.2 (A14). Always available: the counter is
                // `ValueQuery`, so "no qualifying events" is a recorded zero and
                // `Π` is legitimately 1 — §4.3's own missing-data rule.
                futarchy_primitives::metric_ids::PI => pi,
                // Inputs for every other registered component land with the
                // A8/values wiring. Welfare treats registered-but-missing input
                // as an error, failing the crank status-quo-safe instead of
                // fabricating health.
                //
                // 05 §4.5's `D_eff` lands here, and when it does it MUST read
                // `inputs.authorship.distribution()` — `None` on a truncated
                // window — rather than the counts `K` uses. A dropped author
                // makes the retained distribution look *more* uniform than the
                // real one, so a concentration component reading through the
                // count accessor would score better than the truth.
                _ => return None,
            };
            Some(pallet_welfare::ComponentValue { id: spec.id, value })
        })
        .collect()
}

/// Perform the 05 §4.3.2 block-production reads the production projection
/// performs, so that `record_snapshot`/`record_daily_gate` **measure** them.
///
/// The values these dispatches consume must still be fabricated under
/// `runtime-benchmarks` (not every 05 §4.3 input is wired, and one missing
/// component makes the extrinsic return before the aggregation the benchmark
/// exists to measure — see the arms below). But a *read* only the production arm
/// performs is a read the generated weight never declares, and the live dispatch
/// then executes storage work block construction never admitted. That is exactly
/// the SQ-490 defect class, and it recurred here: the fabricated arm returned a
/// component set without ever touching the block-production series.
///
/// Because the epoch total is maintained on write
/// (`pallet_welfare::BlockProductionEpoch`), the worst case is **one key** and
/// the fixture cannot understate it by seeding too few days — the fold that
/// could read up to 256 keys no longer exists. The pallet's own benchmarks seed
/// the key present (its `MaxEncodedLen` is fixed-width, so a present key *is*
/// the worst case) and assert it, so the fixture cannot silently stop reaching
/// the work either.
///
/// **Still unmeasured, and pre-existing (SQ-503):** `xcm_traffic_epoch` folds up
/// to 256 `Welfare::XcmTraffic` keys and `reserve_probe_epoch_value` reads up to
/// 256 `Welfare::ReserveProbeDaily` keys, both inside `record_snapshot`, and
/// neither appears in its generated weight. They predate A14 and are
/// deliberately not touched here; the traffic fold wants the same on-write total
/// this series and the authorship series now have, and the probe cover check
/// wants a per-epoch summary of its own.
#[cfg(feature = "runtime-benchmarks")]
fn benchmark_measure_block_production_reads(epoch: EpochId, day: Option<u8>) {
    let _ = match day {
        Some(day) => pallet_welfare::Pallet::<Runtime>::block_production(epoch, day),
        None => pallet_welfare::Pallet::<Runtime>::block_production_epoch(epoch),
    };
}

/// A14: the same walk-and-discard for the 05 §4.3 `H` and `Π` reads.
///
/// These need it more than their neighbours, not less. The authorship and
/// block-production series each keep an on-write epoch aggregate, so their
/// epoch-granularity read is one key; `H` and `Π` have none, so
/// `onchain_components` **folds the whole day prefix** of each
/// (`primary_block_weight_epoch`, `integrity_failures_epoch`). Left unwalked, the
/// fabricating arm returns component values having touched neither map, and the
/// generated weight declares nothing for a dispatch that reads up to 2 × 256
/// keys — the largest instance of the SQ-490 shape in this file rather than the
/// smallest. The pallet fixture seeds both prefixes at their 13 §4 bound and
/// asserts the count afterwards, so the discarded read is the worst-case one and
/// a fixture that stops reaching it fails loudly instead of quietly
/// regenerating a smaller number.
#[cfg(feature = "runtime-benchmarks")]
fn benchmark_measure_h_pi_reads(epoch: EpochId, day: Option<u8>) {
    match day {
        Some(day) => {
            let _ = pallet_welfare::Pallet::<Runtime>::primary_block_weight_sample(epoch, day);
            let _ = pallet_welfare::Pallet::<Runtime>::integrity_failures(epoch, day);
        }
        None => {
            let _ = pallet_welfare::Pallet::<Runtime>::primary_block_weight_epoch(epoch);
            let _ = pallet_welfare::Pallet::<Runtime>::integrity_failures_epoch(epoch);
        }
    }
}

/// Runtime metric projection. Local XCM traffic and final oracle components
/// are live. Every other unavailable registered input remains absent so the
/// welfare pallet rejects an incomplete snapshot (G-1).
pub struct RuntimeMetricInputs;
impl pallet_welfare::MetricInputs for RuntimeMetricInputs {
    fn onchain_components(epoch: EpochId, version: u16) -> Vec<pallet_welfare::ComponentValue> {
        let Some(specs) = pallet_welfare::MetricSpecs::<Runtime>::get(version) else {
            return Vec::new();
        };
        #[cfg(feature = "runtime-benchmarks")]
        {
            // The 05 §4.3 authorship read is **performed and discarded**, not
            // skipped (the SQ-489 pattern). Production reads this epoch's
            // authorship aggregate on every `record_snapshot`; a fixture that
            // returns fabricated values without touching it generates a weight
            // declaring no `CollatorAuthorshipEpoch` read at all, so the call is
            // charged for less storage than it touches — far from the first
            // instance of that shape here (SQ-490, SQ-500). The fixture seeds
            // the window at its 13 §4 bound and asserts it, so the discarded
            // read is also the worst-case-sized one.
            let _ = collator_adequacy(&AuthorshipWindowInput::epoch(epoch));
            // The 05 §4.3.2 block-production read is discarded for the same
            // reason and must be measured for the same reason.
            benchmark_measure_block_production_reads(epoch, None);
            // A14: and the 05 §4.3 `H` and `Π` reads, which are prefix folds
            // rather than single keys — see `benchmark_measure_h_pi_reads`.
            benchmark_measure_h_pi_reads(epoch, None);
            specs
                .iter()
                .filter(|spec| spec.activation_epoch <= epoch)
                .map(|spec| pallet_welfare::ComponentValue {
                    id: spec.id,
                    // Strictly interior, not the 1.0 this fabricated for years:
                    // at exactly 1.0 every 05 §4.4 weighted-geometric term is
                    // skipped and both gates saturate, so `record_snapshot`'s
                    // measured weight covered the bookkeeping and none of the
                    // aggregation it exists to perform.
                    value: FixedU64(930_000_000),
                })
                .collect()
        }
        #[cfg(not(feature = "runtime-benchmarks"))]
        {
            let mut components = metric_components(
                epoch,
                version,
                MetricComponentInputs {
                    counters: pallet_welfare::Pallet::<Runtime>::xcm_traffic_epoch(epoch),
                    reserve: reserve_probe_epoch_value(epoch)
                        .map(|ok| FixedU64(if ok { pallet_welfare::ONE } else { 0 })),
                    authorship: AuthorshipWindowInput::epoch(epoch),
                    block_production: pallet_welfare::Pallet::<Runtime>::block_production_epoch(
                        epoch,
                    ),
                    headroom: pallet_welfare::Pallet::<Runtime>::primary_block_weight_epoch(epoch),
                    integrity_events: pallet_welfare::Pallet::<Runtime>::integrity_failures_epoch(
                        epoch,
                    ),
                },
            );
            components.extend(
                specs
                    .iter()
                    .filter(|spec| {
                        spec.activation_epoch <= epoch
                            && matches!(spec.source, pallet_welfare::SourceClass::Attested)
                    })
                    .filter_map(|spec| {
                        pallet_oracle::Pallet::<Runtime>::settled_component(spec.id, epoch, version)
                            .map(|settled| pallet_welfare::ComponentValue {
                                id: spec.id,
                                value: settled.value,
                            })
                    }),
            );
            components
        }
    }
    /// 07 §10's flag bits for `(epoch, version)`, read from the oracle's own
    /// settled values — the only place they exist.
    ///
    /// Scoped to **attested** specs for the same reason `onchain_components` is:
    /// 07 §11(1) consequence (i) makes class-4 components the only reportable
    /// ones, so a flag on anything else would be feeding §10's renormalization
    /// with a value the oracle never owned. An absent settled entry contributes
    /// no flag; `record_snapshot` already refuses a snapshot whose *value* is
    /// missing, so absence here is never silently read as "unflagged and fine".
    fn flagged_components(epoch: EpochId, version: u16) -> Vec<futarchy_primitives::MetricId> {
        #[cfg(feature = "runtime-benchmarks")]
        {
            // Worst case for the settlement recompute is a **non-empty** drop
            // set that still leaves the pillar groups populated: dropping every
            // attested component would empty the A pillar and make the recompute
            // cheaper, not dearer (07 §10 renormalizes the composite instead of
            // evaluating A's terms). So the fixture flags exactly the first
            // attested component and keeps the rest voting.
            let _ = epoch;
            pallet_welfare::MetricSpecs::<Runtime>::get(version)
                .into_iter()
                .flat_map(|specs| {
                    specs
                        .into_iter()
                        .filter(|spec| matches!(spec.source, pallet_welfare::SourceClass::Attested))
                        .map(|spec| spec.id)
                        .take(1)
                })
                .collect()
        }
        #[cfg(not(feature = "runtime-benchmarks"))]
        {
            let Some(specs) = pallet_welfare::MetricSpecs::<Runtime>::get(version) else {
                return Vec::new();
            };
            specs
                .iter()
                .filter(|spec| matches!(spec.source, pallet_welfare::SourceClass::Attested))
                .filter_map(|spec| {
                    pallet_oracle::Pallet::<Runtime>::settled_component(spec.id, epoch, version)
                        .and_then(|settled| settled.flagged.then_some(spec.id))
                })
                .collect()
        }
    }
    fn incident_multiplier(epoch: EpochId, spec_version: u16) -> Option<FixedU64> {
        // The IncidentRegistry aggregate IS the C_attested multiplier
        // (registry-core: an empty *closed* epoch records exactly 1.0), and
        // since SQ-141 it is keyed by `(epoch, frozen version)` because two
        // cohorts measuring one epoch under different specs must not share a
        // number.
        //
        // A miss is answered by asking *why* it missed, and the two reasons are
        // not alike (07 §7 *the reader MUST fail closed*):
        //
        //  - **No registry footprint at all.** Nothing was ever filed against
        //    this epoch, and `close_epoch` deliberately refuses to close such an
        //    epoch (`NothingToClose`) so a griefer cannot manufacture the
        //    favourable "no filings ⇒ 1" record. The absence *is* the evidence,
        //    and 1.0 is the honest reading — the pull-side default 07 §7's
        //    consumption model has always relied on. Refusing here instead would
        //    wedge the chain: the overwhelmingly common epoch has no incident
        //    filings, so no snapshot could ever be recorded.
        //
        //  - **A footprint exists but this version's aggregate is not in it.**
        //    Either the version's `close_epoch` has not run, a filing is still
        //    non-terminal, or the caller named a version no cohort froze. Now
        //    the absence proves nothing about incidents, and answering 1.0 would
        //    hand a cohort full-strength `C_attested` for incidents filed under
        //    the sibling version — silently, with no error, no event and no
        //    try-state signal. That is the G-1 violation the pair key makes
        //    reachable, so the read refuses and `record_snapshot` retries. 07
        //    §11(1)'s d20 money deadline guarantees the record arrives, and the
        //    filing window for epoch `m` closes well before it.
        if let Some(value) = pallet_registry::Aggregates::<Runtime>::get(epoch, spec_version) {
            return Some(value);
        }
        // While the epoch's filing count is live a filing can still arrive under
        // **any** version, so no version's absence is yet evidence of anything.
        if pallet_registry::FilingCount::<Runtime>::contains_key(epoch) {
            return None;
        }
        // Once the window has shut, the evidence is **this version's own**
        // retained filings — deliberately not "the epoch has some record".
        //
        // Scoping it to the epoch would strand a version that legitimately has
        // no filings: an incident filed under the sibling version leaves a
        // footprint on the epoch, and this version — whose cohorts had nothing
        // filed against them — would refuse forever unless a keeper happened to
        // crank a close for a version with nothing to close. That makes a
        // *safety* read depend on off-chain liveness for no gain, since "this
        // version has no filings" is exactly the "no filings ⇒ 1" case
        // `close_epoch` would record anyway.
        //
        // The scan is bounded by `MaxFilingsPerEpoch` (64) and reached only
        // after the filing window closes, on a once-per-epoch-per-version crank.
        let has_records = pallet_registry::Filings::<Runtime>::iter_prefix_values(epoch)
            .any(|filing| filing.spec_version == spec_version);
        (!has_records).then_some(FixedU64(1_000_000_000))
    }
    fn daily_components(
        epoch: EpochId,
        day: u8,
        version: u16,
    ) -> Vec<pallet_welfare::ComponentValue> {
        #[cfg(feature = "runtime-benchmarks")]
        {
            // Walked and discarded, exactly as in `onchain_components` above:
            // `record_daily_gate` reads the day's authorship window and the
            // day's block-production slot in production, so its weight must
            // declare both reads.
            let _ = collator_adequacy(&AuthorshipWindowInput::day(epoch, day));
            benchmark_measure_block_production_reads(epoch, Some(day));
            // A14: and the day's `H` accumulator and `Π` counter (05 §4.3).
            benchmark_measure_h_pi_reads(epoch, Some(day));
            pallet_welfare::MetricSpecs::<Runtime>::get(version)
                .into_iter()
                .flatten()
                .filter(|spec| spec.activation_epoch <= epoch)
                .map(|spec| pallet_welfare::ComponentValue {
                    id: spec.id,
                    value: FixedU64(1_000_000_000),
                })
                .collect()
        }
        #[cfg(not(feature = "runtime-benchmarks"))]
        metric_components(
            epoch,
            version,
            MetricComponentInputs {
                counters: pallet_welfare::Pallet::<Runtime>::xcm_traffic(epoch, day),
                reserve: reserve_probe_daily_value(epoch, day),
                authorship: AuthorshipWindowInput::day(epoch, day),
                block_production: pallet_welfare::Pallet::<Runtime>::block_production(epoch, day),
                headroom: pallet_welfare::Pallet::<Runtime>::primary_block_weight_sample(
                    epoch, day,
                ),
                integrity_events: pallet_welfare::Pallet::<Runtime>::integrity_failures(epoch, day),
            },
        )
    }
}
pub struct WelfareLedger;
impl pallet_welfare::LedgerSettlement for WelfareLedger {
    fn settle_scalar(pid: u64, score: FixedU64) -> frame_support::dispatch::DispatchResult {
        frame_support::storage::with_storage_layer(|| {
            ConditionalLedger::settle_scalar(
                RuntimeOrigin::signed(welfare_settlement_account()),
                pid,
                score,
            )?;
            pallet_market::Pallet::<Runtime>::observe_proposal_terminal(pid)
        })
    }
    fn settle_gate(
        pid: u64,
        gate: pallet_welfare::GateKind,
        breached: bool,
    ) -> frame_support::dispatch::DispatchResult {
        let gate = match gate {
            pallet_welfare::GateKind::Survival => futarchy_primitives::GateType::Survival,
            pallet_welfare::GateKind::Security => futarchy_primitives::GateType::Security,
        };
        ConditionalLedger::settle_gate(
            RuntimeOrigin::signed(welfare_settlement_account()),
            pid,
            gate,
            breached,
        )
    }
    fn settle_baseline(epoch: EpochId, score: FixedU64) -> frame_support::dispatch::DispatchResult {
        frame_support::storage::with_storage_layer(|| {
            ConditionalLedger::settle_baseline(
                RuntimeOrigin::signed(welfare_settlement_account()),
                epoch,
                score,
            )?;
            pallet_market::Pallet::<Runtime>::observe_baseline_terminal(epoch)
        })
    }
    fn baseline_open(epoch: EpochId) -> bool {
        matches!(
            pallet_conditional_ledger::BaselineVaults::<Runtime>::get(epoch)
                .map(|vault| vault.state),
            Some(pallet_conditional_ledger::core_ledger::BaselineState::Open)
        )
    }
}

pub struct RuntimeSnapshotSchedule;
impl pallet_welfare::SnapshotSchedule for RuntimeSnapshotSchedule {
    fn snapshot_due(epoch: EpochId) -> Option<BlockNumber> {
        pallet_epoch::Pallet::<Runtime>::scheduled_epoch_end(epoch)
    }
    fn measurable_days(epoch: EpochId) -> Option<u32> {
        // 05 §4.7 (SQ-181), single-homed with 07 §8's `R` range so a day either
        // is a measurement window for all three daily components or is one for
        // none of them.
        epoch_measurable_days(epoch)
    }
    fn frozen_spec_versions(epoch: EpochId) -> Vec<u16> {
        // Exactly the projection `pallet-registry` consumes, so welfare and
        // the registry cannot disagree about which versions an epoch legally
        // carries.
        <RuntimeRegistryEpoch as pallet_registry::EpochContext>::frozen_spec_versions(epoch)
    }
}

/// Canonical metric provenance is a runtime decision, not a field a
/// governance caller can self-declare. The high id namespace is reserved for
/// hosted-book metrics and is rejected by welfare before a spec is stored.
pub struct RuntimeMetricProvenance;
impl pallet_welfare::MetricProvenanceProvider for RuntimeMetricProvenance {
    fn provenance(
        id: futarchy_primitives::MetricId,
        declared: pallet_welfare::SourceClass,
    ) -> pallet_welfare::MetricProvenance {
        use futarchy_primitives::metric_ids;
        let _ = declared;
        // Hosted-book provenance is runtime-owned in every build, including
        // the benchmark runtime: a fixture cannot make a hosted id primary by
        // declaring another class.
        if id >= metric_ids::HOSTED_BOOK_MIN {
            return pallet_welfare::MetricProvenance::HostedBook;
        }

        // Production ignores the caller's declaration; only the runtime-owned
        // map is authoritative. The benchmark-only fallback is solely for the
        // welfare pallet's synthetic 1..=16 ids, whose artificial source mix
        // overlaps production ids 10..12. It never ships and cannot cross the
        // hosted namespace above.
        #[cfg(feature = "runtime-benchmarks")]
        {
            // The welfare pallet's synthetic 16-component benchmark fixture
            // deliberately exercises more slots than the production v1 map.
            // Even there provenance remains keyed by the runtime-owned id,
            // never by `MetricSpec.source`; these ids are a benchmark-only
            // namespace and cannot cross the hosted boundary above.
            let source = match id {
                // Synthetic 13/14 stand in for the on-chain P group; 15/16
                // stand in for A and therefore retain its attested class.
                1..=9 | 13..=14 => pallet_welfare::SourceClass::Onchain,
                10..=12 | 15..=16 => pallet_welfare::SourceClass::Attested,
                _ => return pallet_welfare::MetricProvenance::Unassigned,
            };
            pallet_welfare::MetricProvenance::Primary(source)
        }

        #[cfg(not(feature = "runtime-benchmarks"))]
        {
            let canonical = match id {
                metric_ids::X
                | metric_ids::R
                | metric_ids::E
                | metric_ids::H
                | metric_ids::PI
                | metric_ids::K
                | metric_ids::U
                | metric_ids::D_EFF
                | metric_ids::P_FEES
                | metric_ids::P_QUALIFIED_USERS
                | metric_ids::P_SETTLED_VALUE => Some(pallet_welfare::SourceClass::Onchain),
                metric_ids::F => Some(pallet_welfare::SourceClass::RelayDerived),
                metric_ids::A_SHIPPED_UPGRADES
                | metric_ids::A_RUNTIME_PERF
                | metric_ids::A_INTEGRATIONS => Some(pallet_welfare::SourceClass::Attested),
                _ => None,
            };
            match canonical {
                Some(source) => pallet_welfare::MetricProvenance::Primary(source),
                None => pallet_welfare::MetricProvenance::Unassigned,
            }
        }
    }
}

impl pallet_welfare::Config for Runtime {
    type MetricGovernanceOrigin = EnsureValuesScoped<MetricTrack>;
    type Params = WelfareParams;
    type MetricInputs = RuntimeMetricInputs;
    type MetricProvenance = RuntimeMetricProvenance;
    type Ledger = WelfareLedger;
    type CurrentEpoch = pallet_epoch::CurrentEpoch<Runtime>;
    type CurrentWindow = RuntimeMeasurementWindow;
    type SnapshotSchedule = RuntimeSnapshotSchedule;
    type KeeperRebate = FutarchyTreasury;
    type OracleAdmission = RuntimeOracleAdmission;
    // The same constant the treasury's `MaxCollatorCompensationEntries` takes:
    // both bound the collators that can author in one active session, and 05
    // §4.3's `K` and 08 §2.4's payout must not disagree about that population.
    type MaxCollatorAuthorshipEntries =
        ConstU32<{ pallet_futarchy_treasury::MAX_COLLATOR_COMPENSATION_ENTRIES_BOUND }>;
    type WeightInfo = crate::weights::pallet_welfare::WeightInfo<Runtime>;
    #[cfg(feature = "runtime-benchmarks")]
    type BenchmarkHelper = RuntimeBenchmarkHelper;
}

fn report_window_end(epoch: EpochId) -> Option<BlockNumber> {
    let timing = pallet_epoch::Pallet::<Runtime>::epoch_timing(epoch)?;
    timing
        .start
        .checked_add(timing.length)?
        .checked_add(kernel::BLOCKS_PER_DAY.checked_mul(2)?)
}

fn cohort_consumes_measurement(
    schedule: &pallet_epoch::CohortSchedule,
    measurement_epoch: EpochId,
) -> bool {
    measurement_epoch > schedule.epoch && measurement_epoch <= schedule.measurement_until
}

fn spec_contains_component(
    version: futarchy_primitives::MetricSpecVersion,
    component: futarchy_primitives::MetricId,
) -> bool {
    pallet_welfare::MetricSpecs::<Runtime>::get(version)
        .is_some_and(|specs| specs.iter().any(|spec| spec.id == component))
}

pub struct RuntimeReporting;
impl pallet_oracle::ReportingContext for RuntimeReporting {
    fn report_window_end(epoch: EpochId) -> u32 {
        report_window_end(epoch).map_or(0, |end| end)
    }
    fn is_expected_spec_version(component: u16, epoch: EpochId, version: u16) -> bool {
        spec_contains_component(version, component)
            && pallet_epoch::CohortSchedules::<Runtime>::iter_values().any(|schedule| {
                cohort_consumes_measurement(&schedule, epoch)
                    && schedule.specs.iter().any(|(_, spec)| *spec == version)
            })
    }
    fn stake_at_risk(component: u16, epoch: EpochId) -> Balance {
        let has_exposure =
            pallet_epoch::CohortSchedules::<Runtime>::iter_values().any(|schedule| {
                cohort_consumes_measurement(&schedule, epoch)
                    && schedule
                        .specs
                        .iter()
                        .any(|(_, version)| spec_contains_component(*version, component))
            });
        if has_exposure {
            // 07 §6.1 (SQ-174): `StakeAtRisk(c, m) = Σ CohortEscrow(k)` over
            // every cohort whose frozen MetricSpec consumes `c` for
            // measurement epoch `m`, and `CohortEscrow(k) = Σ_pid
            // escrowed(pid)` over that cohort's vaults.
            //
            // The read is **live here and frozen by the caller**: §6.1's
            // *Per-game freezing* paragraph binds `B_1` — and therefore the
            // `StakeAtRisk` inside it — once, when round 1 of a
            // `(component, epoch, spec_version)` game is created, storing it
            // with the game. `oracle_core` already does exactly that, so a
            // later escrow movement cannot reprice a live game. The same
            // section's older `CohortEscrow` line instead says the escrow is
            // "read at the block Snapshot(m) finalizes", which is not
            // implementable: Snapshot(m) *consumes* the oracle's settled
            // components for attested specs, so it cannot also be the input
            // that prices the game producing them. That line is superseded
            // (see the amendment in 07 §6.1).
            //
            // Bounded: at most `MAX_NON_TERMINAL_COHORTS_BOUND` cohorts,
            // each with ≤ 5 proposals (13 §4), so ≤ 20 vault reads.
            pallet_epoch::CohortSchedules::<Runtime>::iter_values()
                .filter(|schedule| {
                    cohort_consumes_measurement(schedule, epoch)
                        && schedule
                            .specs
                            .iter()
                            .any(|(_, version)| spec_contains_component(*version, component))
                })
                .fold(0_u128, |total, schedule| {
                    schedule.specs.iter().fold(total, |sum, (pid, _)| {
                        sum.saturating_add(
                            pallet_conditional_ledger::Vaults::<Runtime>::get(pid)
                                .map_or(0, |vault| vault.escrowed),
                        )
                    })
                })
        } else {
            0
        }
    }
    fn expected_components(epoch: EpochId) -> Vec<(u16, u16)> {
        let mut expected = Vec::new();
        for schedule in pallet_epoch::CohortSchedules::<Runtime>::iter_values()
            .filter(|schedule| cohort_consumes_measurement(schedule, epoch))
        {
            for (_, version) in schedule.specs {
                if let Some(specs) = pallet_welfare::MetricSpecs::<Runtime>::get(version) {
                    for spec in specs {
                        // Only class-4 components are reportable (07 §2(3)), so
                        // only they can be *absent* at the §11 money deadline and
                        // need the no-report neutral row. Including on-chain
                        // components would have the deadline crank write flagged
                        // neutral `ComponentValues` entries for X/R/E/H — values
                        // welfare never reads from the oracle (`onchain_components`
                        // filters to `Attested` too) but which are the declared
                        // input to §10's two-consecutive-flag renormalization, and
                        // several of which are gate inputs whose flagged failure
                        // §10 escalates to a cohort VOID. They would also consume
                        // the bounded `ComponentValues` budget for nothing.
                        if matches!(spec.source, pallet_welfare::SourceClass::Attested)
                            && !expected.contains(&(spec.id, version))
                        {
                            expected.push((spec.id, version));
                        }
                    }
                }
            }
        }
        expected
    }
}
impl pallet_oracle::Config for Runtime {
    type AdjudicationOrigin = pallet_origins::EnsureOracleResolution;
    type Reporting = RuntimeReporting;
    type Params = RuntimeOracleParams;
    type Custody = RuntimeOracleCustody;
    // No 07 §9 mechanical-resolution engine: the A7 spec registry that freezes
    // `formula_ref` does not exist, so `recompute_proof` fails closed for every
    // component rather than settling from a stand-in that reads the value out of
    // the caller's payload (2026-08-10 security review; `RecomputeEngine`).
    #[cfg(not(feature = "runtime-benchmarks"))]
    type RecomputeEngine = ();
    // Measurement only. `recompute_proof`'s declared weight must bound the work
    // it does when it *does* resolve a round, so the benchmark runtime carries an
    // evaluator and the generated weight covers the settling path. A
    // `runtime-benchmarks` runtime is never shipped.
    #[cfg(feature = "runtime-benchmarks")]
    type RecomputeEngine = BenchmarkRecomputeEngine;
    type ProbeDispatch = RuntimeProbeDispatch;
    type ProbeTimeoutSink = OracleProbeTimeoutToWelfare;
    type ReserveHealthSink = RuntimeReserveHealthSink;
    type KeeperRebate = FutarchyTreasury;
    type MaxRoundCloseBatch = ConstU32<{ kernel::TICK_BATCH }>;
    type WeightInfo = crate::weights::pallet_oracle::WeightInfo<Runtime>;
    #[cfg(feature = "runtime-benchmarks")]
    type BenchmarkHelper = RuntimeBenchmarkHelper;
}

/// The evaluator the benchmark runtime binds, so `recompute_proof`'s measured
/// weight covers the round it settles rather than the early refusal.
///
/// It is `oracle_core::recompute_value`, which reads the value out of the
/// payload — safe here and only here, because a `runtime-benchmarks` runtime is
/// a measurement artifact. The production `Runtime` binds `()`. When A7 lands a
/// real `formula_ref` engine, this weight is re-measured against it.
#[cfg(feature = "runtime-benchmarks")]
pub struct BenchmarkRecomputeEngine;

#[cfg(feature = "runtime-benchmarks")]
impl pallet_oracle::RecomputeEngine for BenchmarkRecomputeEngine {
    fn evaluate(
        _: futarchy_primitives::MetricId,
        _: futarchy_primitives::MetricSpecVersion,
        proof: &[u8],
    ) -> Result<futarchy_primitives::FixedU64, pallet_oracle::CoreError> {
        pallet_oracle::recompute_value(proof)
    }
}

/// USDC custody for oracle registration stakes and signed round-bond collateral.
/// The dedicated sovereign account is separate from the treasury oracle payout
/// line: its balance is exactly the bounded I-29 liability set (apart from dust
/// only after a terminal transfer has completed).
pub struct RuntimeOracleCustody;
impl pallet_oracle::OracleCustody<AccountId> for RuntimeOracleCustody {
    fn hold(who: &AccountId, amount: Balance) -> DispatchResult {
        <ForeignAssets as Mutate<AccountId>>::transfer(
            usdc_location(),
            who,
            &OraclePalletId::get().into_account_truncating(),
            amount,
            Preservation::Preserve,
        )
        .map(|_| ())
    }

    fn release(who: &AccountId, amount: Balance) -> DispatchResult {
        if amount == 0 {
            return Ok(());
        }
        <ForeignAssets as Mutate<AccountId>>::transfer(
            usdc_location(),
            &OraclePalletId::get().into_account_truncating(),
            who,
            amount,
            Preservation::Expendable,
        )
        .map(|_| ())
    }

    fn pay(who: &AccountId, amount: Balance) -> DispatchResult {
        Self::release(who, amount)
    }

    fn slash_insurance(amount: Balance) -> DispatchResult {
        if amount == 0 {
            return Ok(());
        }
        <ForeignAssets as Mutate<AccountId>>::transfer(
            usdc_location(),
            &OraclePalletId::get().into_account_truncating(),
            &insurance_account(),
            amount,
            Preservation::Expendable,
        )?;
        // 08 §1.2 (SQ-518): the reporter-bond slash is the second USDC inflow
        // that executes treasury code. Same reading, same best-effort contract
        // and same inner storage layer as `slash_to_insurance` above — see the
        // comment there for why the layer is load-bearing.
        let _ = frame_support::storage::with_storage_layer(|| {
            FutarchyTreasury::note_insurance_inflow()
        });
        Ok(())
    }

    fn balance() -> Balance {
        let oracle_account: AccountId = OraclePalletId::get().into_account_truncating();
        ForeignAssets::balance(usdc_location(), &oracle_account)
    }
}

/// Oracle timeout folds share the router recorder's attribution and remain
/// unable to affect the fail-static reserve transition that called the sink.
pub struct OracleProbeTimeoutToWelfare;
impl pallet_oracle::ProbeTimeoutSink for OracleProbeTimeoutToWelfare {
    fn probe_timed_out() {
        <XcmTrafficRecorder as bleavit_xcm::health::LocalXcmHealthSink>::note_probe_timeout();
    }

    /// Day-attribute one scored probe slot for the 07 §8 `R_daily` input
    /// (SQ-195), using the block the **attempt opened** at rather than the
    /// current block: a probe that spans a day boundary belongs to the day it
    /// measured. Attribution otherwise follows the same live schedule the XCM
    /// traffic counters use.
    fn probe_outcome(opened_at: BlockNumber, passed: bool) {
        // An attempt opened before the live epoch began cannot be attributed
        // without that epoch's start block, and recording it against the wrong
        // day is worse than not recording it: the cover check independently
        // fails the real epoch on its missing day (07 §8).
        if let Some((epoch, day)) = epoch_and_day_at(opened_at) {
            pallet_welfare::Pallet::<Runtime>::note_reserve_probe(epoch, day, passed);
        }
    }
}

/// Authenticated Asset Hub response sink for the production XCM executor
/// (07 §8, SQ-380). Only the exact outstanding unflagged oracle id is exposed;
/// `ProbeAwareResponseHandler` additionally authenticates the sibling origin,
/// querier and high-bit partition before calling this sink.
pub struct RuntimeOracleProbeSink;
impl bleavit_xcm::probe::ProbeSink for RuntimeOracleProbeSink {
    fn pending_query_id() -> Option<u64> {
        let health = pallet_oracle::ReserveHealth::<Runtime>::get();
        health.pending_since.map(|_| health.last_query_id)
    }

    fn probe_result(query_id: u64, passed: bool) -> Weight {
        // A sibling-write refusal leaves the pending query and all three health
        // records unchanged inside the oracle's explicit storage layer. The
        // response then degrades through the ordinary timeout path (G-1).
        let _ = crate::Oracle::reserve_probe_result(query_id, passed);
        RuntimeProbeCallbackWeight::get()
    }
}

/// Pre-dispatch accounting for one bounded reserve-probe DOT envelope
/// (07 §8 / 08 §1.1, SQ-114). The XCM dispatcher wraps this debit and local
/// send validation in one storage layer: insufficient funding refuses the
/// send, while a locally rejected message rolls the debit back.
pub struct RuntimeProbeBudget;
impl bleavit_xcm::probe::ProbeBudget for RuntimeProbeBudget {
    fn ready_to_arm(params: &pallet_oracle::OracleParams) -> bool {
        let Some(live) = live_reserve_probe_envelope() else {
            return false;
        };
        // Require the exact live records consumed by the oracle snapshot. A
        // missing/wrongly-typed row must not arm through the provider's benign
        // standalone fallback defaults.
        if live.interval != params.probe_interval
            || live.timeout != params.probe_timeout
            || live.amount != params.probe_amount
            || live.fail_threshold != params.fail_threshold
            || live.recover_threshold != params.recover_threshold
        {
            return false;
        }
        crate::FutarchyTreasury::line_balance(pallet_futarchy_treasury::BudgetLine::OpsReserveProbe)
            >= live.runway
    }

    fn reserve_fee(probe_amount: Balance) -> Result<Balance, DispatchError> {
        // Post-arm attempts remain fail-static, but a malformed live envelope
        // must still refuse the actual debit/send instead of composing the
        // provider's benign fallback values into an unauthorized program.
        let live = live_reserve_probe_envelope()
            .filter(|live| live.amount == probe_amount)
            .ok_or(DispatchError::Other("reserve probe envelope unavailable"))?;
        crate::FutarchyTreasury::charge_reserve_probe_fee(live.fee, live.rate)?;
        Ok(live.fee)
    }
}

pub struct RuntimeBootstrapOpsFundingPolicy;
impl pallet_futarchy_treasury::BootstrapOpsFundingPolicy for RuntimeBootstrapOpsFundingPolicy {
    fn reserve_probe_ceiling() -> Option<Balance> {
        live_reserve_probe_envelope().map(|live| live.runway)
    }
}

pub struct RuntimeParaId;
impl Get<u32> for RuntimeParaId {
    fn get() -> u32 {
        staging_parachain_info::Pallet::<Runtime>::parachain_id().into()
    }
}

pub struct ProbeExecWeightBudget;
impl Get<Weight> for ProbeExecWeightBudget {
    fn get() -> Weight {
        xcm_config::UnitWeightCost::get()
            .saturating_mul(u64::from(xcm_config::MaxInstructions::get()))
    }
}

pub struct ProbeMaxResponseWeight;
impl Get<Weight> for ProbeMaxResponseWeight {
    fn get() -> Weight {
        RuntimeProbeCallbackWeight::get()
    }
}

/// Generated worst-case oracle callback plus both authentication reads: the
/// barrier's `expecting_response` check and the executor's `on_response` route.
pub struct RuntimeProbeCallbackWeight;
impl Get<Weight> for RuntimeProbeCallbackWeight {
    fn get() -> Weight {
        <crate::weights::pallet_oracle::WeightInfo<Runtime> as pallet_oracle::WeightInfo>::reserve_probe_result()
            .saturating_add(<Runtime as frame_system::Config>::DbWeight::get().reads(2))
    }
}

/// 07 §8 / 08 §1.2 (SQ-205): carry a reserve-health transition to both owners of
/// its consequences — the constitution's 02 §7.3 bit-7 mirror and the treasury's
/// fail-static NAV haircut — as one indivisible act.
///
/// Ordering is deliberate but not load-bearing: the oracle invokes this inside
/// an explicit storage layer, so if the treasury write fails the constitution
/// write and the oracle transition unwind with it. 08 §1.2 ties `spendable_nav`
/// to exactly this flag, so a half-applied transition would leave `PhaseFlags`
/// and NAV disagreeing about solvency (R-7).
///
pub struct ReserveHealthToConstitutionAndTreasury;
impl pallet_oracle::ReserveHealthSink for ReserveHealthToConstitutionAndTreasury {
    fn reserve_health_changed(unhealthy: bool) -> frame_support::dispatch::DispatchResult {
        crate::Constitution::note_reserve_health(unhealthy)?;
        crate::FutarchyTreasury::set_reserve_impaired(unhealthy)?;
        Ok(())
    }
}

type RuntimeReserveHealthSink = ReserveHealthToConstitutionAndTreasury;

type RuntimeProbeDispatch = bleavit_xcm::probe::XcmProbeDispatcher<
    xcm_config::TopicRouter,
    RuntimeProbeBudget,
    ProbeExecWeightBudget,
    ProbeMaxResponseWeight,
    RuntimeParaId,
    XcmTrafficRecorder,
>;

/// 07 §2(5)'s admission preconditions, read live at `register_spec`.
///
/// This is the first consumer `orc.n_min` has ever had: before it, both halves
/// of §2(5) — the reporter/watchtower seats and §6.3's bond-coverage rule —
/// were enforced nowhere, so an attested component could be admitted to a
/// MetricSpec with no reporter able to report it and no ladder able to make a
/// lie cost more than it can move (SQ-341).
pub struct RuntimeOracleAdmission;
impl pallet_welfare::OracleAdmission for RuntimeOracleAdmission {
    fn admission() -> pallet_welfare::AttestedAdmission {
        let bond_bps = perbill_bps_param_or(
            b"orc.bond_bps",
            pallet_oracle::OracleParams::DEFAULT.bond_bps,
        );
        let rounds = u8_param_or(b"orc.rounds", pallet_oracle::OracleParams::DEFAULT.rounds);
        // 07 §3 requires "≥ 3 registered reporters **with full stakes**", and the
        // counted-map size is not that: `record_reporter_offense` halves the
        // stake on a second adjudicated-false report and leaves the reporter
        // **registered** (ejection is the third offense). Counting map entries
        // would let a half-staked seat satisfy the admission gate, admitting an
        // attested component against less collateral than §3 demands — the
        // stake is the whole reason a reporter's word is worth anything
        // (Codex review, PR #173).
        let reporter_stake = balance_param_or(
            b"orc.rep_stake",
            pallet_oracle::OracleParams::DEFAULT.reporter_stake,
        );
        pallet_welfare::AttestedAdmission {
            reporters: pallet_oracle::Reporters::<Runtime>::iter_values()
                .filter(|info| info.stake >= reporter_stake)
                .count() as u32,
            watchtowers: pallet_oracle::Watchtowers::<Runtime>::count(),
            reporter_min: u32::from(u8_param_or(
                b"orc.n_min",
                futarchy_primitives::kernel::ORC_REPORTERS_MIN,
            )),
            watchtower_min: u32::from(u8_param_or(
                b"wt.quorum",
                pallet_oracle::OracleParams::DEFAULT.watchtower_quorum,
            )),
            // `None` here refuses every attested component — the opposite
            // direction `RegistryParams::coverage_bps` takes on the same
            // unreadable ladder, and the fail-closed one for admission: 07 §6.3
            // exists precisely to stop a component settling money against a
            // ladder nobody can size.
            coverage_bps: pallet_oracle::coverage_bps(rounds, bond_bps),
        }
    }
}

pub struct RegistryParams;
impl pallet_registry::RegistryParams for RegistryParams {
    fn bond_incident() -> Balance {
        balance_param(b"reg.bond_inc")
    }
    fn bond_milestone() -> Balance {
        balance_param(b"reg.bond_mile")
    }
    fn coverage_bps() -> u32 {
        // 07 §6.3's coverage rule is stated over the **whole ladder**, not round
        // one: `(2^R_max − 1) · orc.bond_bps ≥ Δs_max` — 7 × 2.5% = 17.5% at
        // defaults. A registry filing is a **one-round** game, so it has no
        // escalation to build that stack and must post the terminal-stack
        // equivalent up front. Applying `orc.bond_bps` alone made the bond
        // *proportional* to exposure without being *covering*: an unchallenged
        // false S1 filing zeroes `I`, hence `c_settlement`, moving far more than
        // 2.5% of exposure — and an upheld filing is refunded, so the attacker
        // pays nothing at all (connector P1 on PR #169; SQ-296).
        //
        // Derived from two existing keys, not picked, so no new parameter is
        // needed (R-2 step 1 resolves by reuse). The principled long-run rate is
        // `Δs_max`-derived; that needs the MetricSpec field SQ-341 adds, and this
        // multiple is the conservative interim that cannot under-collateralize.
        //
        // Single-key reads, deliberately **not** `RuntimeOracleParams::get()`:
        // that getter materializes the whole 12-key `OracleParams` aggregate, so
        // routing values through it cost 11 wasted `Constitution::Params` reads on
        // every registry call that loads the core aggregate (SQ-489).
        let bps = perbill_bps_param_or(
            b"orc.bond_bps",
            pallet_oracle::OracleParams::DEFAULT.bond_bps,
        );
        let rounds = u8_param_or(b"orc.rounds", pallet_oracle::OracleParams::DEFAULT.rounds);
        // The derivation itself is single-homed in `oracle_core::coverage_bps`
        // (07 §6.3's owner) — this call site only chooses the failure direction
        // for *bond pricing*. `orc.rounds` is kernel-bounded to 2–4, so `None`
        // means a malformed read; degrade to the tightest lawful ladder (×3)
        // rather than to zero, because a zero multiple would price every filing
        // at the floor (G-1). Attested admission takes the opposite direction
        // on the same `None` and refuses outright.
        pallet_oracle::coverage_bps(rounds, bps).unwrap_or_else(|| {
            pallet_oracle::coverage_bps(pallet_oracle::ORC_ROUND_CAP_MIN, bps).unwrap_or(bps)
        })
    }
}
pub struct OracleWatchtowers;
impl pallet_registry::WatchtowerRegistry<AccountId> for OracleWatchtowers {
    fn is_registered_watchtower(who: &AccountId) -> bool {
        pallet_oracle::Watchtowers::<Runtime>::contains_key(who)
    }
}
/// The current welfare shell has no external-component write endpoint. The
/// aggregate remains in registry storage and is pulled by `RuntimeMetricInputs`.
pub struct WelfarePullSink;
impl pallet_registry::WelfareSink for WelfarePullSink {
    fn note_external_component(
        _: registry_core::RegistryKind,
        _: EpochId,
        _: u16,
        _: FixedU64,
    ) -> sp_runtime::DispatchResult {
        Ok(())
    }
}
pub struct RuntimeRegistryEpoch;
/// `Exposure(Incident, m)` of 07 §7: the cohort escrow a filing against
/// measurement epoch `m` can move.
///
/// `I` is not a `MetricId`. It multiplies `C_attested` and `C_settlement`
/// unconditionally for every cohort that snapshots the epoch (05 §4.4), so the
/// exposure set is *every* consuming cohort — deliberately the same SQ-174
/// escrow fold as `stake_at_risk`, with the `spec_contains_component` filter
/// removed. Pricing an incident filing against one component's consumers would
/// under-collateralize it by construction.
///
/// Single-homed so the `runtime-benchmarks` path can execute the identical walk
/// it is meant to measure. Bounded: at most `MAX_NON_TERMINAL_COHORTS` (4)
/// schedules × five proposal vaults each (13 §4).
/// Whether the frozen MetricSpec `version` registers the A-pillar milestone
/// component — the predicate behind 07 §7's component-scoped
/// `Exposure(Milestone, m)`.
///
/// Gated to match its only caller: the production arm of `cohort_exposure`.
/// Benchmark builds take the fixture arm, so without this the function is dead
/// code there and `-D warnings` fails a gate an ungated `cargo check` passes.
#[cfg(not(feature = "runtime-benchmarks"))]
fn milestone_component_is_frozen_in(version: u16) -> bool {
    pallet_welfare::MetricSpecs::<Runtime>::get(version)
        .into_iter()
        .flatten()
        .any(|spec| spec.id == futarchy_primitives::metric_ids::A_SHIPPED_UPGRADES)
}

fn incident_cohort_escrow(epoch: EpochId) -> Balance {
    pallet_epoch::CohortSchedules::<Runtime>::iter_values()
        .filter(|schedule| cohort_consumes_measurement(schedule, epoch))
        .fold(0_u128, |total, schedule| {
            schedule.specs.iter().fold(total, |sum, (pid, _)| {
                sum.saturating_add(
                    pallet_conditional_ledger::Vaults::<Runtime>::get(pid)
                        .map_or(0, |vault| vault.escrowed),
                )
            })
        })
}

impl pallet_registry::EpochContext for RuntimeRegistryEpoch {
    fn filing_window_end(epoch: EpochId) -> u32 {
        report_window_end(epoch).map_or(0, |end| end)
    }
    fn frozen_spec_versions(epoch: EpochId) -> Vec<u16> {
        // Every version some live cohort froze for this measurement epoch
        // (I-16), not the unique one. The previous reader collapsed a
        // multi-version epoch to `None`, and `file` turned that into
        // `SpecVersionMismatch` — so an activation boundary refused **every**
        // filing for the epoch, including ones naming a version that was
        // unambiguously frozen. That was fail-closed in the wrong place: the
        // ambiguity is in the aggregate, which SQ-141 keys by the pair, not in
        // the filing, which names its version explicitly.
        //
        // A version is still dropped if `MetricSpecs` no longer holds it: a
        // filing must attest under a spec that exists to be recomputed against.
        // The bound is `epoch.horizon_k ≤ 2` (05 §3.3, SQ-496) — the same factor
        // that sizes `MAX_AGGREGATES`.
        let mut versions = pallet_epoch::CohortSchedules::<Runtime>::iter_values()
            .filter(|schedule| cohort_consumes_measurement(schedule, epoch))
            .flat_map(|schedule| schedule.specs.clone().into_iter().map(|(_, v)| v))
            .filter(|version| pallet_welfare::MetricSpecs::<Runtime>::contains_key(version))
            .collect::<Vec<_>>();
        versions.sort_unstable();
        versions.dedup();
        versions
    }
    fn milestone_target(_: EpochId, spec_version: u16) -> u32 {
        // SQ-175: the frozen MetricSpec's own `target`, read at the version the
        // caller names. It is per-spec and per-version by construction (I-16) —
        // a global tunable could retroactively renormalize milestones a live
        // cohort is already measuring, which is why 05 §4.4 puts it in the spec
        // and never in 13.
        //
        // Absent spec, absent milestone component, or a zero target all return
        // 0, which `file` and `close_epoch` turn into `MilestoneTargetUnset`
        // (07 §7 *Milestone normalization*). That is the fail-closed direction:
        // a fabricated aggregate of 0.0 would be a fail-*adverse* measurement
        // masquerading as a real one (SQ-291). `register_spec` already refuses
        // a spec whose milestone component has no positive target (SQ-341), so
        // in practice this reads a value the registration gate has validated.
        let target = pallet_welfare::MetricSpecs::<Runtime>::get(spec_version)
            .into_iter()
            .flatten()
            .find(|spec| spec.id == futarchy_primitives::metric_ids::A_SHIPPED_UPGRADES)
            .map_or(0, |spec| spec.target);
        // Benchmark-only fallback, on the B5 precedent of benchmark seams with
        // zero pallets dropped: `define_benchmarks!` measures the
        // `MilestoneRegistry` instance and every setup routes through `file()`
        // (`file_many` in `pallets/registry/src/benchmarking.rs`), which does not
        // build welfare state. With no registered spec the read above is 0, each
        // setup aborts with `MilestoneTargetUnset` before anything is measured,
        // and weight generation for the whole instance dies silently rather than
        // loudly. Narrower than the pre-SQ-175 version, which overrode the seam
        // unconditionally: a benchmark that *does* register a spec now measures
        // against its real target. `runtime-benchmarks` is never enabled in a
        // release runtime, so the production posture is unchanged.
        #[cfg(feature = "runtime-benchmarks")]
        if target == 0 {
            return registry_core::MILESTONE_TARGET_POINTS;
        }
        target
    }
    fn cohort_exposure(kind: registry_core::RegistryKind, epoch: EpochId) -> Option<Balance> {
        match kind {
            registry_core::RegistryKind::Incident => {
                let has_exposure = pallet_epoch::CohortSchedules::<Runtime>::iter_values()
                    .any(|schedule| cohort_consumes_measurement(&schedule, epoch));
                if has_exposure {
                    Some(incident_cohort_escrow(epoch))
                } else {
                    Some(0)
                }
            }
            registry_core::RegistryKind::Milestone => {
                #[cfg(feature = "runtime-benchmarks")]
                {
                    // Measurement scaffolding only — production below stays
                    // fail-closed. The fold is **walked** and discarded, not
                    // skipped, because both registry instances bind the same
                    // `crate::weights::pallet_registry::WeightInfo`: whichever
                    // instance the generator renders last wins the shared file,
                    // so an instance that measures a cheaper path silently
                    // understates the other. Returning the fixture without
                    // walking measured Milestone at 99 reads against Incident's
                    // 119, and the 99 overwrote the 119 — reintroducing exactly
                    // the undercharge SQ-489 exists to remove. Both arms must
                    // therefore measure the same worst case (SQ-489).
                    let _ = incident_cohort_escrow(epoch);
                    Some(500_000 * currency::USDC)
                }
                #[cfg(not(feature = "runtime-benchmarks"))]
                {
                    // 07 §7: `Exposure(Milestone, m)` is component-scoped — the
                    // cohorts whose **frozen** MetricSpec consumes the milestone
                    // component for `m`, not every cohort consuming `m` (that is
                    // the Incident set, because `I` is a scalar multiplier and
                    // not a `MetricId`). SQ-175 makes this determinable for the
                    // first time: the spec now carries the milestone `target`,
                    // so "consumes the milestone component" is a real predicate
                    // over the frozen version rather than an unbound seam.
                    //
                    // Still `None` — never `Some(0)` — when no live cohort's
                    // frozen spec carries the component: an undeterminable
                    // exposure must refuse the filing (`ExposureUnavailable`,
                    // G-1), whereas a zero would price it at the floor and
                    // under-collateralize it (SQ-296).
                    let mut consuming = false;
                    let escrow = pallet_epoch::CohortSchedules::<Runtime>::iter_values()
                        .filter(|schedule| cohort_consumes_measurement(schedule, epoch))
                        .fold(0_u128, |total, schedule| {
                            schedule.specs.iter().fold(total, |sum, (pid, version)| {
                                if !milestone_component_is_frozen_in(*version) {
                                    return sum;
                                }
                                consuming = true;
                                sum.saturating_add(
                                    pallet_conditional_ledger::Vaults::<Runtime>::get(pid)
                                        .map_or(0, |vault| vault.escrowed),
                                )
                            })
                        });
                    consuming.then_some(escrow)
                }
            }
        }
    }
}
parameter_types! {
    pub const IncidentKind: registry_core::RegistryKind = registry_core::RegistryKind::Incident;
    pub const MilestoneKind: registry_core::RegistryKind = registry_core::RegistryKind::Milestone;
}
macro_rules! registry_config {
    ($instance:ty, $kind:ty, $id:ty) => {
        impl pallet_registry::Config<$instance> for Runtime {
            type Collateral = ForeignAssets;
            type UsdcAssetId = UsdcAssetId;
            type Kind = $kind;
            type Params = RegistryParams;
            type Watchtowers = OracleWatchtowers;
            type Welfare = WelfarePullSink;
            type Epoch = RuntimeRegistryEpoch;
            type ResolutionAuthority = pallet_origins::EnsureOracleResolution;
            type InsuranceAccount = InsuranceAccount;
            type PalletId = $id;
            type KeeperRebate = FutarchyTreasury;
            // SQ-76: registry archive follows the live ledger key but retains
            // the independent 21-day money-deadline floor.
            type ArchiveDelay = RegistryArchiveDelay;
            type MaxFilingsPerEpoch = ConstU32<{ kernel::REG_MAX_FILINGS_EPOCH }>;
            type MaxEvidenceLen = ConstU32<32>;
            type WeightInfo = crate::weights::pallet_registry::WeightInfo<Runtime>;
            #[cfg(feature = "runtime-benchmarks")]
            type BenchmarkHelper = RuntimeBenchmarkHelper;
        }
    };
}
registry_config!((), IncidentKind, IncidentPalletId);
registry_config!(pallet_registry::Instance1, MilestoneKind, MilestonePalletId);

pub struct TreasuryParams;
impl pallet_futarchy_treasury::TreasuryParams for TreasuryParams {
    fn cap_proposal_bps() -> u32 {
        u32::from(percent_param(b"trs.cap_proposal")) * 100
    }
    fn cap_30d_bps() -> u32 {
        u32::from(percent_param(b"trs.cap_30d")) * 100
    }
    fn cap_180d_bps() -> u32 {
        u32::from(percent_param(b"trs.cap_180d")) * 100
    }
    fn stream_threshold_bps() -> u32 {
        perbill_param(b"trs.stream_thr") / 100_000
    }
    fn inflation_cap_bps() -> u32 {
        u32::from(percent_param(b"iss.inflation")) * 100
    }
    fn keeper_budget_epoch() -> Balance {
        balance_param(b"keeper.budget")
    }
    fn keeper_rebate() -> Balance {
        // SQ-117 (ruled 2026-07-21): the row is now genesis-seeded from the
        // 08 §6.2 fee basis (`kernel::KEEPER_REBATE_FEE_BASIS_USDC`), so the
        // rebate pipeline pays a real amount rather than zero. The seed value
        // still carries a 13 §1 `[VERIFY]` tag pending launch benchmarking. The
        // absent/wrong-kind fallback stays a conservative no-outflow zero (G-1)
        // rather than consulting `genesis_params()`, exactly as before.
        let key = pallet_constitution::key16(b"keeper.rebate");
        match live_param(key) {
            Some(pallet_constitution::ParamValue::Balance(value)) => value,
            _ => 0,
        }
    }

    fn collator_comp_epoch() -> Balance {
        balance_param(b"collator.comp")
    }

    fn coretime_dot_rate() -> Balance {
        balance_param(b"ops.ct_dot_rate")
    }

    fn reserve_probe_dot_rate() -> Balance {
        balance_param(b"ops.probe_rate")
    }

    fn coretime_fee_dot() -> Balance {
        balance_param(b"ops.ct_fee_dot")
    }

    fn coretime_quote_ttl() -> u32 {
        u32_param(b"ops.ct_quote_ttl")
    }
}

pub struct TreasuryRebatePayout;
impl pallet_futarchy_treasury::RebatePayout<AccountId> for TreasuryRebatePayout {
    fn pay(
        who: &AccountId,
        amount: Balance,
        line: pallet_futarchy_treasury::PayoutLine,
    ) -> frame_support::pallet_prelude::DispatchResult {
        let source = payout_line_account(line);
        <ForeignAssets as Mutate<AccountId>>::transfer(
            usdc_location(),
            &source,
            who,
            amount,
            Preservation::Preserve,
        )
        .map(|_| ())
    }

    fn pot_balance(line: pallet_futarchy_treasury::PayoutLine) -> Balance {
        let source = payout_line_account(line);
        <ForeignAssets as Inspect<AccountId>>::balance(usdc_location(), &source)
    }
}

/// The real-USDC custody account behind each 08 §1.1 pot-backed line. The two
/// subsidy lines joined the set in milestone E1: book seeding spends their cash
/// directly, so `fund_budget_line` must move it with the credit (I-33).
fn payout_line_account(line: pallet_futarchy_treasury::PayoutLine) -> AccountId {
    match line {
        pallet_futarchy_treasury::PayoutLine::Keeper => treasury_keeper_account(),
        pallet_futarchy_treasury::PayoutLine::Oracle => treasury_oracle_account(),
        pallet_futarchy_treasury::PayoutLine::Rewards => treasury_rewards_account(),
        pallet_futarchy_treasury::PayoutLine::OpsCollators => treasury_collators_account(),
        pallet_futarchy_treasury::PayoutLine::Pol => pol_account(),
        pallet_futarchy_treasury::PayoutLine::PolBaseline => pol_baseline_account(),
    }
}
/// Atomically synchronize pot-backed internal budget credit with real USDC
/// custody (08 §1.4). Unlike fail-soft rebate recording/payout, a failure here
/// must abort the entire `fund_budget_line` call.
pub struct TreasuryPotFunding;
impl pallet_futarchy_treasury::PotFunding<AccountId> for TreasuryPotFunding {
    fn fund(
        line: pallet_futarchy_treasury::PayoutLine,
        amount: Balance,
    ) -> frame_support::dispatch::DispatchResult {
        let destination = payout_line_account(line);
        <ForeignAssets as Mutate<AccountId>>::transfer(
            usdc_location(),
            &crate::genesis::treasury_account(),
            &destination,
            amount,
            // 03 §7 R-4 / 08 §1.4: MAIN is a permanent custody account.
            // Bound funding by `main_balance - min_balance`; failure toward the
            // status quo is G-1-conservative and cannot reap MAIN.
            Preservation::Preserve,
        )
        .map(|_| ())
    }
}
/// 08 §1.2/§1.4 (SQ-207): the custody half of `sweep_insurance` — INSURANCE →
/// `MAIN`, and nowhere else.
///
/// `Preservation::Preserve` is normative, not defensive: INSURANCE is a
/// genesis-endowed permanent custody account under 03 §7 R-4, so at most
/// `balance − min_balance` is sweepable and an over-large request fails whole
/// instead of reaping the account (G-1).
pub struct TreasuryInsuranceSweep;
impl pallet_futarchy_treasury::InsuranceSweep for TreasuryInsuranceSweep {
    fn sweep(amount: Balance) -> frame_support::dispatch::DispatchResult {
        <ForeignAssets as Mutate<AccountId>>::transfer(
            usdc_location(),
            &insurance_account(),
            &crate::genesis::treasury_account(),
            amount,
            Preservation::Preserve,
        )
        .map(|_| ())
    }

    /// 08 §1.2's `T_ins` bounds `balance(INSURANCE, Usdc)` and nothing else:
    /// both terms of the target are USDC, so reading any other asset here would
    /// be a units error. VIT slash proceeds (06 §7) share this account and are
    /// deliberately invisible to the target — 08 §2.2 marks VIT at 0 in NAV, so
    /// overflowing them would move nothing into spendable NAV.
    fn usdc_balance() -> Balance {
        <ForeignAssets as Inspect<AccountId>>::balance(usdc_location(), &insurance_account())
    }

    fn usdc_min_balance() -> Balance {
        <ForeignAssets as Inspect<AccountId>>::minimum_balance(usdc_location())
    }
}

/// 08 §1.4's outflow custody seam — **deliberately not wired** (audit
/// 2026-07-27, AUD-NUM-001).
///
/// `spend`, `claim_stream`, `issue_vit` and `recover_foreign` have complete
/// accounting and no asset leg: the four custody seams this runtime does bind
/// (`PotFunding`, `RenewalDispatch`, `InsuranceSweep`, `CommunityVesting`) are
/// unreachable from any of them, and the pallet declares no fungibles or
/// native-currency handle for them. 08 §1.4 states the reason — for lines
/// without a dedicated pot, "their outflow custody wiring is the A9 fungibles
/// follow-up" — so building it is deferred milestone work, not a hardening fix.
///
/// What a hardening fix owes is the G-1 answer: a call that cannot move the
/// value must refuse, not report success. Reporting `false` here makes all four
/// fail closed with `OutflowCustodyUnwired`, so arming TREASURY before the
/// custody lands stops loudly instead of silently consuming stream entitlements
/// and reporting grants that never moved.
///
/// The `runtime-benchmarks` arm reports them wired for one reason: the
/// benchmarks must keep measuring the full body these calls execute once
/// custody is bound. Declaring that larger weight while they fail closed
/// over-charges, which is the safe direction. `tests_treasury_health.rs`
/// compiles **without** the feature and asserts every one of the four refuses,
/// so the divergence cannot hide a production regression.
pub struct TreasuryOutflowCustody;
impl pallet_futarchy_treasury::OutflowCustody for TreasuryOutflowCustody {
    fn is_wired(_: pallet_futarchy_treasury::OutflowLeg) -> bool {
        cfg!(feature = "runtime-benchmarks")
    }
}

#[cfg(all(not(feature = "runtime-benchmarks"), not(test)))]
pub struct CoretimeTreasuryLocation;
#[cfg(all(not(feature = "runtime-benchmarks"), not(test)))]
impl Get<staging_xcm::latest::Location> for CoretimeTreasuryLocation {
    fn get() -> staging_xcm::latest::Location {
        staging_xcm::latest::Location::new(
            0,
            [staging_xcm::latest::Junction::AccountId32 {
                network: xcm_config::RelayNetwork::get(),
                id: treasury_protocol_account().into(),
            }],
        )
    }
}

#[cfg(all(not(feature = "runtime-benchmarks"), not(test)))]
pub struct CoretimeFeeBudget;
#[cfg(all(not(feature = "runtime-benchmarks"), not(test)))]
impl Get<Balance> for CoretimeFeeBudget {
    fn get() -> Balance {
        <TreasuryParams as pallet_futarchy_treasury::TreasuryParams>::coretime_fee_dot()
    }
}

#[cfg(all(not(feature = "runtime-benchmarks"), not(test)))]
pub struct CoretimeRenewalAccount;
#[cfg(all(not(feature = "runtime-benchmarks"), not(test)))]
impl Get<Option<[u8; 32]>> for CoretimeRenewalAccount {
    fn get() -> Option<[u8; 32]> {
        pallet_futarchy_treasury::CoretimeRenewalAccount::<Runtime>::get()
    }
}

#[cfg(all(not(feature = "runtime-benchmarks"), not(test)))]
parameter_types! {
    // SQ-261: conservative B12-only XCM execution bounds. Replace with
    // measured Coretime route limits in the next treasury weight calibration.
    pub CoretimeRelayWeightLimit: Weight = Weight::from_parts(100_000_000_000, 1_048_576);
    pub CoretimeRemoteWeightLimit: Weight = Weight::from_parts(100_000_000_000, 1_048_576);
    pub CoretimeLocalWeightLimit: Weight = xcm_config::UnitWeightCost::get().saturating_mul(10);
}

#[cfg(all(not(feature = "runtime-benchmarks"), not(test)))]
type ProductionRenewalDispatch = bleavit_xcm::coretime::XcmRenewalDispatcher<
    xcm_config::Executor,
    RuntimeCall,
    CoretimeTreasuryLocation,
    CoretimeFeeBudget,
    CoretimeRenewalAccount,
    CoretimeRelayWeightLimit,
    CoretimeRemoteWeightLimit,
    CoretimeLocalWeightLimit,
>;

#[cfg(test)]
std::thread_local! {
    static TEST_CORETIME_RENEWALS: core::cell::RefCell<Vec<(u32, Balance)>> =
        const { core::cell::RefCell::new(Vec::new()) };
}

#[cfg(test)]
pub struct TestRenewalDispatch;
#[cfg(test)]
impl pallet_futarchy_treasury::RenewalDispatch for TestRenewalDispatch {
    fn dispatch_renewal(
        period_index: u32,
        amount: Balance,
    ) -> frame_support::dispatch::DispatchResult {
        TEST_CORETIME_RENEWALS.with(|calls| calls.borrow_mut().push((period_index, amount)));
        Ok(())
    }
}

#[cfg(test)]
pub(crate) fn take_test_coretime_renewals() -> Vec<(u32, Balance)> {
    TEST_CORETIME_RENEWALS.with(|calls| core::mem::take(&mut *calls.borrow_mut()))
}

#[cfg(feature = "runtime-benchmarks")]
pub struct BenchmarkRenewalDispatch;
// The live XCM executor needs custody and transport that the generated
// benchmark harness does not provide. The B12-only delta remains explicitly
// conservative pending SQ-261 calibration; bleavit-xcm exercises the real
// executor route and rollback behavior.
#[cfg(feature = "runtime-benchmarks")]
impl pallet_futarchy_treasury::RenewalDispatch for BenchmarkRenewalDispatch {
    fn dispatch_renewal(
        _period_index: u32,
        _amount: Balance,
    ) -> frame_support::dispatch::DispatchResult {
        Ok(())
    }
}

#[cfg(feature = "runtime-benchmarks")]
type RuntimeRenewalDispatch = BenchmarkRenewalDispatch;
#[cfg(all(not(feature = "runtime-benchmarks"), not(test)))]
type RuntimeRenewalDispatch = ProductionRenewalDispatch;
#[cfg(all(not(feature = "runtime-benchmarks"), test))]
type RuntimeRenewalDispatch = TestRenewalDispatch;

pub struct RuntimeTreasuryPhase;
impl pallet_futarchy_treasury::TreasuryPhase for RuntimeTreasuryPhase {
    fn treasury_armed() -> bool {
        crate::Constitution::phase_flags() & pallet_constitution::PhaseFlagsValue::TREASURY_ARMED
            != 0
    }
}

/// Live session size used to scale the per-registered-collator stipend. The
/// active session includes registered collators that authored zero blocks.
pub struct RuntimeRegisteredCollatorCount;
impl Get<u32> for RuntimeRegisteredCollatorCount {
    fn get() -> u32 {
        match u32::try_from(Session::validators().len()) {
            Ok(count) => count,
            Err(_) => u32::MAX,
        }
    }
}

/// Boundary-aware epoch projection for the authorship callback. The
/// persisted `EpochOf` can still name the completed epoch when the callback
/// runs before the first clock-cranking extrinsic in a boundary block.
pub struct RuntimeCollatorEpoch;
impl pallet_futarchy_treasury::CollatorEpochProvider for RuntimeCollatorEpoch {
    fn epoch_at(block: futarchy_primitives::BlockNumber) -> futarchy_primitives::EpochId {
        pallet_epoch::Pallet::<Runtime>::epoch_for_block(block)
    }
}

impl pallet_futarchy_treasury::Config for Runtime {
    type TreasuryOrigin = pallet_origins::EnsureFutarchyTreasury;
    type CommunityDistributionOrigin = pallet_origins::EnsureFutarchyParam;
    type CommunityVesting = RuntimeCommunityVesting;
    type CommunityPot = CommunityDistributionPot;
    type CommunityDistributionAmount = CommunityDistributionAmount;
    type CommunityVestingDuration = CommunityVestingDuration;
    type CommunityMinVestedTransfer = CommunityMinVestedTransfer;
    type MaxCommunitySchedules = MaxCommunitySchedules;
    type MaxCollatorCompensationEntries =
        ConstU32<{ pallet_futarchy_treasury::MAX_COLLATOR_COMPENSATION_ENTRIES_BOUND }>;
    type RegisteredCollatorCount = RuntimeRegisteredCollatorCount;
    type CollatorEpoch = RuntimeCollatorEpoch;
    type Params = TreasuryParams;
    type CurrentEpoch = pallet_epoch::CurrentEpoch<Runtime>;
    type TreasuryPhase = RuntimeTreasuryPhase;
    type BootstrapOpsFundingPolicy = RuntimeBootstrapOpsFundingPolicy;
    type RenewalDispatch = RuntimeRenewalDispatch;
    type RebatePayout = TreasuryRebatePayout;
    type PotFunding = TreasuryPotFunding;
    type InsuranceSweep = TreasuryInsuranceSweep;
    type OutflowCustody = TreasuryOutflowCustody;
    type Integrity = RuntimeIntegrityRecorder;
    type WeightInfo = crate::weights::pallet_futarchy_treasury::WeightInfo<Runtime>;
    #[cfg(feature = "runtime-benchmarks")]
    type BenchmarkHelper = RuntimeBenchmarkHelper;
}

pub struct RuntimeGuardianStatus;
impl pallet_guardian::GuardianProposalStatus for RuntimeGuardianStatus {
    fn status(pid: u64) -> (pallet_guardian::ProposalStatus, bool) {
        let Some(proposal) = pallet_epoch::Proposals::<Runtime>::get(pid) else {
            return (pallet_guardian::ProposalStatus::Other, false);
        };
        let status = match proposal.state {
            futarchy_primitives::ProposalState::Trading => pallet_guardian::ProposalStatus::Trading,
            futarchy_primitives::ProposalState::Extended => {
                pallet_guardian::ProposalStatus::Extended
            }
            futarchy_primitives::ProposalState::Queued => pallet_guardian::ProposalStatus::Queued,
            futarchy_primitives::ProposalState::Executed
            | futarchy_primitives::ProposalState::Measuring
            | futarchy_primitives::ProposalState::Settled => {
                pallet_guardian::ProposalStatus::Executed
            }
            futarchy_primitives::ProposalState::Rerun => pallet_guardian::ProposalStatus::Rerun,
            _ => pallet_guardian::ProposalStatus::Other,
        };
        (
            status,
            proposal.rerun
                || proposal.delayed_once
                || matches!(
                    proposal.state,
                    futarchy_primitives::ProposalState::Suspended
                        | futarchy_primitives::ProposalState::Rerun
                ),
        )
    }
}

pub struct RuntimeAttestorProposalStatus;
impl pallet_attestor::AttestorProposalStatus for RuntimeAttestorProposalStatus {
    fn has_executed(pid: futarchy_primitives::ProposalId) -> bool {
        pallet_epoch::Proposals::<Runtime>::get(pid).is_some_and(|proposal| {
            matches!(
                proposal.state,
                futarchy_primitives::ProposalState::Executed
                    | futarchy_primitives::ProposalState::Measuring
                    | futarchy_primitives::ProposalState::Settled
            )
        })
    }

    /// Total by contract, hence `is_none_or` rather than `is_some_and`.
    ///
    /// `pallet-epoch` does not retain terminal proposals: `checked_state`
    /// excludes `Cancelled | Settled | Rejected(_) | Expired`, `persist` is a
    /// full re-sync that re-inserts only the live set, and `settle_cohort`
    /// deletes its members outright. Intersecting "still present" with "in an
    /// accepted terminal state" therefore left only `{Executed, Measuring}`,
    /// so a proposal that never executed — the common case, since most
    /// CODE/META proposals lose the market decision — never opened its reap
    /// window at all, and `reap_attestation` is the only bond-release path for
    /// an account already carried in `Liabilities`. A pruned proposal is
    /// terminal; reading it as non-terminal locked the bond permanently. This
    /// matches the execution guard's twin below, which was already total.
    fn is_terminal(pid: futarchy_primitives::ProposalId) -> bool {
        pallet_epoch::Proposals::<Runtime>::get(pid).is_none_or(|proposal| {
            matches!(
                proposal.state,
                futarchy_primitives::ProposalState::Executed
                    | futarchy_primitives::ProposalState::Measuring
                    | futarchy_primitives::ProposalState::Settled
                    | futarchy_primitives::ProposalState::Cancelled
                    | futarchy_primitives::ProposalState::Expired
                    | futarchy_primitives::ProposalState::Rejected(_)
            )
        })
    }

    fn exists(pid: futarchy_primitives::ProposalId) -> bool {
        pallet_epoch::Proposals::<Runtime>::contains_key(pid)
    }
}
pub struct RuntimeGuardianTriggers;
impl pallet_guardian::GuardianTriggers for RuntimeGuardianTriggers {
    fn current() -> pallet_guardian::TriggerState {
        let phase_flags = crate::Constitution::phase_flags();
        let current_epoch = pallet_epoch::CurrentEpoch::<Runtime>::get();
        let gate_breach = pallet_welfare::GateBreachFlags::<Runtime>::get(current_epoch)
            .is_some_and(|flags| flags.s_breached || flags.c_breached);
        #[allow(unused_assignments, unused_mut)]
        let mut state = pallet_guardian::TriggerState {
            gate_breach,
            dead_man: phase_flags & pallet_constitution::PhaseFlagsValue::DEAD_MAN_ENGAGED != 0,
            reserve_health: phase_flags & pallet_constitution::PhaseFlagsValue::RESERVE_HEALTH_FLAG
                != 0,
            ledger_drift: pallet_conditional_ledger::Pallet::<Runtime>::ledger_drifted(),
            // A relay abort preserves the old code and is not the 09 §3.2
            // halt-at-fault trigger. Only the execution-halt projection of a
            // failed/stalled/applied-invalid migration admits PB-MIGRATION.
            migration_halt: pallet_execution_guard::MigrationHalt::<Runtime>::get(),
            // An activation record is authorization state, never a trigger
            // source (06 §6.2). The target-specific pending VOID latch is read
            // by `oracle_deadlock` below.
            void_in_flight: pallet_epoch::PendingOracleVoids::<Runtime>::count() > 0,
            ..pallet_guardian::TriggerState::none()
        };
        // Benchmark Wasm must exercise every verified-trigger branch, but the
        // live reads above still execute first so the measured DB-op pattern
        // (PhaseFlags + CurrentEpoch + GateBreachFlags + MigrationHaltSources)
        // matches production — a constant-only bench arm would under-account
        // those reads at the next weight regeneration.
        #[cfg(feature = "runtime-benchmarks")]
        {
            let _production_reads = state;
            state = pallet_guardian::TriggerState {
                depeg: true,
                migration_halt: true,
                oracle_deadlock: true,
                gate_breach: true,
                dead_man: true,
                void_in_flight: true,
                reserve_health: true,
                ledger_drift: true,
            };
        }
        state
    }

    fn oracle_deadlock(epoch: EpochId) -> bool {
        #[cfg(feature = "runtime-benchmarks")]
        {
            let _ = epoch;
            true
        }
        #[cfg(not(feature = "runtime-benchmarks"))]
        {
            pallet_epoch::PendingOracleVoids::<Runtime>::contains_key(epoch)
        }
    }
}
pub struct RuntimeGuardianEffects;

impl RuntimeGuardianEffects {
    fn dispatch_emergency(call: RuntimeCall) -> Result<(), DispatchError> {
        frame_support::ensure!(
            crate::classifier::RuntimeBaseCallFilter::contains_for(
                origins_core::Origin::EmergencyPlaybook,
                &call,
            ),
            DispatchError::Other("emergency playbook call is not admissible")
        );
        // N7-DISPATCH-TRIPWIRE: guardian-playbook
        call.dispatch_bypass_filter(pallet_origins::Origin::EmergencyPlaybook.into())
            .map(|_| ())
            .map_err(|error| error.error)
    }

    fn dispatch_emergency_all(calls: Vec<RuntimeCall>) -> Result<(), DispatchError> {
        for call in calls {
            Self::dispatch_emergency(call)?;
        }
        Ok(())
    }

    /// Kernel-enumerated 06 §6.2 activation routine. Keeping construction
    /// separate from dispatch gives the conformance suite one exact surface
    /// to compare with the playbook table.
    pub(crate) fn playbook_calls(
        id: pallet_guardian::PlaybookId,
        expiry: BlockNumber,
        target: Option<EpochId>,
    ) -> Result<Vec<RuntimeCall>, DispatchError> {
        let now = System::block_number();
        let bounded_expiry = now
            .checked_add(kernel::PLAYBOOK_FREEZE_WINDOW_BLOCKS)
            .ok_or(DispatchError::Arithmetic(
                sp_runtime::ArithmeticError::Overflow,
            ))?;
        frame_support::ensure!(
            expiry >= now && expiry <= bounded_expiry,
            DispatchError::Other("playbook expiry exceeds kernel window")
        );

        let calls = match id {
            pallet_guardian::PlaybookId::Depeg => {
                frame_support::ensure!(
                    target.is_none(),
                    DispatchError::Other("unexpected playbook target")
                );
                let epoch_bound = now.checked_add(kernel::MIN_EPOCH_LENGTH_BLOCKS).ok_or(
                    DispatchError::Arithmetic(sp_runtime::ArithmeticError::Overflow),
                )?;
                frame_support::ensure!(
                    expiry <= epoch_bound,
                    DispatchError::Other("depeg expiry exceeds one epoch")
                );
                vec![RuntimeCall::Market(pallet_market::Call::freeze_creation {
                    expiry,
                })]
            }
            pallet_guardian::PlaybookId::Migration => {
                frame_support::ensure!(
                    target.is_none(),
                    DispatchError::Other("unexpected playbook target")
                );
                // stable2603 exposes only Root-only destructive cursor controls.
                // The safe recovery substrate is the automatic active-cursor
                // continuation plus source-scoped execution halt and ratified
                // remediation path above; fabricating Root here would widen
                // EmergencyPlaybook beyond the pre-ratified 06 §6.2 surface.
                return Err(DispatchError::Other(
                    "PB-MIGRATION cursor retry has no EmergencyPlaybook-safe runtime call",
                ));
            }
            pallet_guardian::PlaybookId::OracleVoid => {
                let epoch = target.ok_or(DispatchError::Other(
                    "oracle-void playbook requires target epoch",
                ))?;
                vec![RuntimeCall::Epoch(pallet_epoch::Call::void_cohort {
                    epoch,
                })]
            }
            pallet_guardian::PlaybookId::HaltIntake => {
                frame_support::ensure!(
                    target.is_none(),
                    DispatchError::Other("unexpected playbook target")
                );
                let until = expiry.min(bounded_expiry);
                vec![
                    RuntimeCall::Epoch(pallet_epoch::Call::set_intake_paused {
                        paused: true,
                        expiry: until,
                    }),
                    RuntimeCall::QuestionService(pallet_question_service::Call::set_paused {
                        until: Some(until),
                    }),
                ]
            }
            pallet_guardian::PlaybookId::Reserve => {
                frame_support::ensure!(
                    target.is_none(),
                    DispatchError::Other("unexpected playbook target")
                );
                vec![RuntimeCall::ConditionalLedger(
                    pallet_conditional_ledger::Call::set_split_paused {
                        paused: true,
                        expiry,
                    },
                )]
            }
            pallet_guardian::PlaybookId::LedgerFreeze => {
                frame_support::ensure!(
                    target.is_none(),
                    DispatchError::Other("unexpected playbook target")
                );
                vec![
                    RuntimeCall::ConditionalLedger(pallet_conditional_ledger::Call::set_frozen {
                        frozen: true,
                    }),
                    RuntimeCall::Market(pallet_market::Call::set_frozen { frozen: true }),
                ]
            }
        };
        Ok(calls)
    }
}

impl pallet_guardian::GuardianEffectDispatcher for RuntimeGuardianEffects {
    fn dispatch(
        power: pallet_guardian::GuardianPower,
        justification_hash: futarchy_primitives::H256,
    ) -> Result<(), DispatchError> {
        match power {
            pallet_guardian::GuardianPower::DelayOnce { pid } => {
                Epoch::delay_once(
                    pallet_origins::Origin::GuardianHold.into(),
                    pid,
                    justification_hash,
                )?;
                let deadline = pallet_epoch::CurrentEpoch::<Runtime>::get()
                    .checked_add(GuardianReviewDeadline::get())
                    .ok_or(DispatchError::Arithmetic(
                        sp_runtime::ArithmeticError::Overflow,
                    ))?;
                let window = pallet_epoch::CurrentEpoch::<Runtime>::get()
                    .checked_add(1)
                    .ok_or(DispatchError::Arithmetic(
                        sp_runtime::ArithmeticError::Overflow,
                    ))?;
                Epoch::note_guardian_review_window(pid, deadline, window)
            }
            pallet_guardian::GuardianPower::ForceRerun { pid } => {
                Epoch::force_rerun_from_guardian(pid)
            }
            pallet_guardian::GuardianPower::PauseIntake { until } => {
                Epoch::set_intake_paused_internal(until)
            }
            pallet_guardian::GuardianPower::SuspendOnGate => {
                let epoch = pallet_epoch::CurrentEpoch::<Runtime>::get();
                let breached = pallet_welfare::GateBreachFlags::<Runtime>::get(epoch)
                    .is_some_and(|flags| flags.s_breached || flags.c_breached);
                frame_support::ensure!(
                    breached,
                    DispatchError::Other("hard gate breach is not active")
                );
                ExecutionGuard::set_gate_suspension(epoch);
                Ok(())
            }
            pallet_guardian::GuardianPower::ActivatePlaybook {
                id, expiry, target, ..
            } => {
                if id == pallet_guardian::PlaybookId::OracleVoid {
                    let epoch = target.ok_or(DispatchError::Other(
                        "oracle-void playbook requires target epoch",
                    ))?;
                    frame_support::ensure!(
                        pallet_epoch::PendingOracleVoids::<Runtime>::contains_key(epoch),
                        DispatchError::Other("oracle-void target has no pending deadlock")
                    );
                }
                let calls = Self::playbook_calls(id, expiry, target)?;
                if id == pallet_guardian::PlaybookId::LedgerFreeze {
                    let _ = calls;
                    Self::set_live_conditioned_playbook(id, true)
                } else {
                    Self::dispatch_emergency_all(calls)
                }
            }
        }
    }

    fn revert_playbook(id: pallet_guardian::PlaybookId) -> Result<(), DispatchError> {
        let calls = match id {
            pallet_guardian::PlaybookId::Depeg => {
                Market::clear_creation_freeze();
                Vec::new()
            }
            pallet_guardian::PlaybookId::Migration | pallet_guardian::PlaybookId::OracleVoid => {
                Vec::new()
            }
            pallet_guardian::PlaybookId::HaltIntake => {
                vec![
                    RuntimeCall::Epoch(pallet_epoch::Call::set_intake_paused {
                        paused: false,
                        expiry: 0,
                    }),
                    RuntimeCall::QuestionService(pallet_question_service::Call::set_paused {
                        until: None,
                    }),
                ]
            }
            pallet_guardian::PlaybookId::Reserve => vec![RuntimeCall::ConditionalLedger(
                pallet_conditional_ledger::Call::set_split_paused {
                    paused: false,
                    expiry: 0,
                },
            )],
            pallet_guardian::PlaybookId::LedgerFreeze => {
                return Self::set_live_conditioned_playbook(id, false);
            }
        };
        Self::dispatch_emergency_all(calls)
    }

    fn renew_playbook(id: pallet_guardian::PlaybookId) -> Result<(), DispatchError> {
        frame_support::ensure!(
            id == pallet_guardian::PlaybookId::LedgerFreeze,
            DispatchError::Other("only ledger-freeze is renewable")
        );
        if !<RuntimeGuardianTriggers as pallet_guardian::GuardianTriggers>::current().ledger_drift {
            return Self::set_live_conditioned_playbook(id, false);
        }
        if !Self::playbook_effect_matches(id, true) {
            return Self::set_live_conditioned_playbook(id, true);
        }
        frame_support::storage::with_storage_layer(|| {
            ConditionalLedger::extend_freeze_once()?;
            Market::extend_freeze_once()
        })
    }

    fn set_live_conditioned_playbook(
        id: pallet_guardian::PlaybookId,
        applied: bool,
    ) -> Result<(), DispatchError> {
        frame_support::ensure!(
            id == pallet_guardian::PlaybookId::LedgerFreeze,
            DispatchError::Other("playbook is not live-conditioned")
        );
        frame_support::storage::with_storage_layer(|| {
            let now = System::block_number();
            let ledger_applied = pallet_conditional_ledger::FrozenUntil::<Runtime>::get()
                .is_some_and(|until| now < until);
            let market_applied =
                pallet_market::FrozenUntil::<Runtime>::get().is_some_and(|until| now < until);
            let mut calls = Vec::new();
            if ledger_applied != applied {
                calls.push(RuntimeCall::ConditionalLedger(
                    pallet_conditional_ledger::Call::set_frozen { frozen: applied },
                ));
            }
            if market_applied != applied {
                calls.push(RuntimeCall::Market(pallet_market::Call::set_frozen {
                    frozen: applied,
                }));
            }
            Self::dispatch_emergency_all(calls)?;
            crate::Constitution::note_ledger_frozen(applied)
        })
    }

    fn playbook_effect_matches(id: pallet_guardian::PlaybookId, applied: bool) -> bool {
        if id != pallet_guardian::PlaybookId::LedgerFreeze {
            return false;
        }
        let now = System::block_number();
        let ledger = pallet_conditional_ledger::FrozenUntil::<Runtime>::get()
            .is_some_and(|until| now < until);
        let market = pallet_market::FrozenUntil::<Runtime>::get().is_some_and(|until| now < until);
        let constitution = crate::Constitution::phase_flags()
            & pallet_constitution::PhaseFlagsValue::LEDGER_FROZEN
            != 0;
        ledger == applied && market == applied && constitution == applied
    }
}

pub struct RuntimeGuardianProposalVeto;
impl pallet_guardian::GuardianProposalVeto for RuntimeGuardianProposalVeto {
    fn uphold(pid: futarchy_primitives::ProposalId) -> Result<(), DispatchError> {
        Epoch::veto_upheld_from_review(pid)
    }
}

/// Real retrospective-review and recall submission. The guardian pallet moves
/// pro-rata slices from SeatBond holds into the sovereign before entering this
/// adapter; both stock-referenda deposits are placed immediately.
pub struct RuntimeGuardianScheduler;
impl pallet_guardian::GuardianReviewScheduler for RuntimeGuardianScheduler {
    fn review_deposit() -> Balance {
        SubmissionDeposit::get().saturating_add(1_000 * currency::VIT)
    }

    fn schedule_review(
        action: u32,
        verdict: pallet_guardian::ReviewVerdict,
    ) -> Result<u32, DispatchError> {
        let call = match verdict {
            pallet_guardian::ReviewVerdict::Ratify => {
                RuntimeCall::Guardian(pallet_guardian::Call::ratify_action { action_id: action })
            }
            pallet_guardian::ReviewVerdict::UpholdVeto => {
                RuntimeCall::Guardian(pallet_guardian::Call::uphold_veto { action_id: action })
            }
        };
        let proposal = <Preimage as StorePreimage>::bound(call)?;
        let values_origin: RuntimeOrigin = crate::track_origins::Origin::Ratify.into();
        let proposal_origin = Box::new(values_origin.caller().clone());
        let referendum = pallet_referenda::ReferendumCount::<Runtime>::get();
        Referenda::submit(
            RuntimeOrigin::signed(guardian_account()),
            proposal_origin,
            proposal,
            frame_support::traits::schedule::DispatchTime::After(0),
        )?;
        Referenda::place_decision_deposit(RuntimeOrigin::signed(guardian_account()), referendum)
            .map_err(|error| error.error)?;
        Ok(referendum)
    }

    fn cancel_review(referendum: u32) -> Result<(), DispatchError> {
        match pallet_referenda::ReferendumInfoFor::<Runtime>::get(referendum) {
            Some(pallet_referenda::ReferendumInfo::Ongoing(_)) => Referenda::cancel(
                pallet_origins::Origin::ConstitutionalValues.into(),
                referendum,
            ),
            Some(_) => Ok(()),
            None => Err(DispatchError::Other("guardian review referendum missing")),
        }
    }

    fn refund_review(referendum: u32) -> Result<(), DispatchError> {
        Referenda::refund_decision_deposit(RuntimeOrigin::signed(guardian_account()), referendum)?;
        Referenda::refund_submission_deposit(
            RuntimeOrigin::signed(guardian_account()),
            referendum,
        )?;
        Ok(())
    }
}
impl pallet_guardian::GuardianRecallScheduler for RuntimeGuardianScheduler {
    fn schedule_recall(action: u32, slash_pool: Balance) -> Result<u32, DispatchError> {
        let deposit = SubmissionDeposit::get().saturating_add(5_000 * currency::VIT);
        if slash_pool < deposit {
            return Err(DispatchError::Other("guardian recall slash pool too small"));
        }
        let call = RuntimeCall::Guardian(pallet_guardian::Call::recall { action_id: action });
        let proposal = <Preimage as StorePreimage>::bound(call)?;
        let values_origin: RuntimeOrigin = crate::track_origins::Origin::GuardianTrack.into();
        let proposal_origin = Box::new(values_origin.caller().clone());
        let referendum = pallet_referenda::ReferendumCount::<Runtime>::get();
        Referenda::submit(
            RuntimeOrigin::signed(guardian_account()),
            proposal_origin,
            proposal,
            frame_support::traits::schedule::DispatchTime::After(0),
        )?;
        Referenda::place_decision_deposit(RuntimeOrigin::signed(guardian_account()), referendum)
            .map_err(|error| error.error)?;
        <Balances as frame_support::traits::fungible::Mutate<AccountId>>::transfer(
            &guardian_account(),
            &crate::genesis::treasury_account(),
            slash_pool.saturating_sub(deposit),
            Preservation::Expendable,
        )?;
        Ok(referendum)
    }

    fn refund_recall(referendum: u32) -> Result<(), DispatchError> {
        Referenda::refund_decision_deposit(RuntimeOrigin::signed(guardian_account()), referendum)?;
        Referenda::refund_submission_deposit(
            RuntimeOrigin::signed(guardian_account()),
            referendum,
        )?;
        <Balances as frame_support::traits::fungible::Mutate<AccountId>>::transfer(
            &guardian_account(),
            &crate::genesis::treasury_account(),
            SubmissionDeposit::get().saturating_add(5_000 * currency::VIT),
            Preservation::Expendable,
        )?;
        Ok(())
    }

    fn forward_failed_recall_pool(amount: Balance) -> Result<(), DispatchError> {
        <Balances as frame_support::traits::fungible::Mutate<AccountId>>::transfer(
            &guardian_account(),
            &crate::genesis::treasury_account(),
            amount,
            Preservation::Expendable,
        )?;
        Ok(())
    }
}
impl pallet_guardian::Config for Runtime {
    type ValuesOrigin = EnsureValuesScoped<RatifyTrack>;
    type AdminOrigin = EnsureValuesScoped<GuardianTrack>;
    type Currency = Balances;
    type RuntimeHoldReason = RuntimeHoldReason;
    type SovereignAccount = GuardianAccount;
    type CurrentEpoch = pallet_epoch::CurrentEpoch<Runtime>;
    type ProposalStatusProvider = RuntimeGuardianStatus;
    type TriggerProvider = RuntimeGuardianTriggers;
    type EffectDispatcher = RuntimeGuardianEffects;
    type ProposalVeto = RuntimeGuardianProposalVeto;
    type ReviewScheduler = RuntimeGuardianScheduler;
    type RecallScheduler = RuntimeGuardianScheduler;
    type ReviewDeadlineEpochs = GuardianReviewDeadline;
    type WeightInfo = crate::weights::pallet_guardian::WeightInfo<Runtime>;
    #[cfg(feature = "runtime-benchmarks")]
    type BenchmarkHelper = RuntimeBenchmarkHelper;
}
impl pallet_attestor::Config for Runtime {
    type ValuesOrigin = EnsureValuesScoped<GuardianTrack>;
    type RatifyOrigin = EnsureValuesScoped<RatifyTrack>;
    type Params = RuntimeAttestorParams;
    type Currency = Balances;
    type RuntimeHoldReason = RuntimeHoldReason;
    type InsuranceAccount = InsuranceAccount;
    type ProposalStatus = RuntimeAttestorProposalStatus;
    type WeightInfo = crate::weights::pallet_attestor::WeightInfo<Runtime>;
    #[cfg(feature = "runtime-benchmarks")]
    type BenchmarkHelper = RuntimeBenchmarkHelper;
}
impl pallet_client_registry::Config for Runtime {
    type ValuesOrigin = EnsureGuardianTrack;
    type ClientOrigin = EnsureQuestionClient;
    type ClientFunding = RuntimeClientFunding;
    type ClientBond = RuntimeClientBond;
    type Currency = Balances;
    type RuntimeHoldReason = RuntimeHoldReason;
    type DeliveryAssets = ForeignAssets;
    type DeliveryAssetId = UsdcAssetId;
    type DeliveryFloatPalletId = ClientDeliveryPalletId;
    type WeightInfo = crate::weights::pallet_client_registry::WeightInfo<Runtime>;
    #[cfg(feature = "runtime-benchmarks")]
    type BenchmarkHelper = RuntimeBenchmarkHelper;
}

impl pallet_question_service::Config for Runtime {
    type ServiceParams = RuntimeServiceParams;
    type ExternalMarketOrigin = RuntimeExternalMarketOrigin;
    type DecisionWindows = RuntimeServiceDecisionWindows;
    type ContestHealth = RuntimeServiceContestHealth;
    type TvlCapGate = RuntimeServiceTvlCap;
    type InflowCapExemptAccounts = InflowCapProtocolAccounts;
    type AccountIdBytes = RuntimeAccountIdBytes;
    type ReportPush = RuntimeReportPush;
    type PalletId = QuestionServicePalletId;
    type KeeperRebate = FutarchyTreasury;
    type WeightInfo = crate::weights::pallet_question_service::WeightInfo<Runtime>;
    #[cfg(feature = "runtime-benchmarks")]
    type BenchmarkHelper = RuntimeBenchmarkHelper;
}

// --- A8/A11 execution-guard production wiring ------------------------------

/// Frozen execution-time proposer reward schedule (08 §1.1; 05 §2.1 T17).
/// The per-class caps are live constitution records; TREASURY/CODE use the
/// claimant-adverse floor of `0.05% × Ask`, capped by their class record.
fn proposer_reward_for(proposal: &futarchy_primitives::Proposal<AccountId>) -> Option<Balance> {
    let (key, ask_scaled) = match proposal.class {
        futarchy_primitives::ProposalClass::Param => (b"trs.reward.param".as_slice(), false),
        futarchy_primitives::ProposalClass::Treasury => (b"trs.reward.trs".as_slice(), true),
        futarchy_primitives::ProposalClass::Code => (b"trs.reward.code".as_slice(), true),
        futarchy_primitives::ProposalClass::Meta => (b"trs.reward.meta".as_slice(), false),
        futarchy_primitives::ProposalClass::Constitutional => return None,
    };
    let cap = balance_param(key);
    if !ask_scaled {
        return (cap > 0).then_some(cap);
    }
    proposal
        .ask
        .checked_mul(5)
        .and_then(|value| value.checked_div(10_000))
        .map(|value| value.min(cap))
        .filter(|value| *value > 0)
}

pub struct RuntimeEpochHandoff;
impl pallet_execution_guard::EpochHandoff for RuntimeEpochHandoff {
    fn payload_hash(pid: futarchy_primitives::ProposalId) -> Option<futarchy_primitives::H256> {
        pallet_epoch::Proposals::<Runtime>::get(pid)
            .or_else(|| pallet_epoch::IntakeProposals::<Runtime>::get(pid))
            .map(|proposal| proposal.payload_hash)
    }
    fn requires_ratification(pid: futarchy_primitives::ProposalId) -> Option<bool> {
        pallet_epoch::Proposals::<Runtime>::get(pid)
            .or_else(|| pallet_epoch::IntakeProposals::<Runtime>::get(pid))
            .map(|proposal| {
                matches!(
                    proposal.class,
                    futarchy_primitives::ProposalClass::Code
                        | futarchy_primitives::ProposalClass::Meta
                )
            })
    }
    fn recovery_qualification_context(
        pid: futarchy_primitives::ProposalId,
    ) -> Option<(
        futarchy_primitives::H256,
        futarchy_primitives::RuntimeVersionConstraint,
    )> {
        let proposal = pallet_epoch::IntakeProposals::<Runtime>::get(pid)
            .or_else(|| pallet_epoch::Proposals::<Runtime>::get(pid))?;
        matches!(
            proposal.state,
            futarchy_primitives::ProposalState::Submitted
                | futarchy_primitives::ProposalState::Screening
                | futarchy_primitives::ProposalState::Qualified
                | futarchy_primitives::ProposalState::Trading
                | futarchy_primitives::ProposalState::Extended
        )
        .then_some(proposal.version_constraint)
        .flatten()
        .map(|version| (proposal.payload_hash, version))
    }
    fn mark_executed(pid: futarchy_primitives::ProposalId) -> DispatchResult {
        let proposal = pallet_epoch::Proposals::<Runtime>::get(pid);
        Epoch::mark_executed(RuntimeOrigin::signed(execution_guard_account()), pid)?;
        if let Some(proposal) = proposal {
            if let Some(reward) = proposer_reward_for(&proposal) {
                // Reward custody is deliberately fail-soft. The execution and
                // its measurement transition are already valid; an unfunded
                // REWARDS line must not turn them into an unbacked obligation
                // or make the guard retry a successful payload forever.
                let _ = pallet_futarchy_treasury::Pallet::<Runtime>::do_proposer_reward(
                    &proposal.proposer,
                    reward,
                );
            }
        }
        Ok(())
    }
    fn mark_failed_executed(pid: futarchy_primitives::ProposalId) -> DispatchResult {
        Epoch::mark_failed_executed(RuntimeOrigin::signed(execution_guard_account()), pid)
    }
    fn retry_exhausted_to_measurement(pid: futarchy_primitives::ProposalId) -> DispatchResult {
        Epoch::retry_exhausted_to_measurement(RuntimeOrigin::signed(execution_guard_account()), pid)
    }
    fn reject_or_stale(
        pid: futarchy_primitives::ProposalId,
        reason: futarchy_primitives::RejectReason,
    ) -> DispatchResult {
        Epoch::expire_or_stale_queue(
            RuntimeOrigin::signed(execution_guard_account()),
            pid,
            Some(reason),
        )
    }
    fn is_terminal(pid: futarchy_primitives::ProposalId) -> bool {
        pallet_epoch::Proposals::<Runtime>::get(pid).is_none_or(|proposal| {
            !matches!(
                proposal.state,
                futarchy_primitives::ProposalState::Queued
                    | futarchy_primitives::ProposalState::FailedExecuted
                    | futarchy_primitives::ProposalState::Suspended
            )
        })
    }
}

pub struct RuntimeEpochExecutionGuard;
impl pallet_epoch::ExecutionGuardAccess for RuntimeEpochExecutionGuard {
    fn bind_ratification(
        pid: futarchy_primitives::ProposalId,
        referendum_index: u32,
    ) -> DispatchResult {
        let proposal = pallet_epoch::Proposals::<Runtime>::get(pid)
            .or_else(|| pallet_epoch::IntakeProposals::<Runtime>::get(pid))
            .ok_or(DispatchError::Other(
                "epoch proposal missing for ratification",
            ))?;
        frame_support::ensure!(
            matches!(
                proposal.class,
                futarchy_primitives::ProposalClass::Code | futarchy_primitives::ProposalClass::Meta
            ),
            DispatchError::Other("ratification binding requires CODE or META")
        );

        // A passed record is the only terminal form of this identity.  It is
        // enough to make a repeated proposer call idempotent; the original
        // referendum preimage was already checked when the record was enacted.
        if let Some(record) = pallet_execution_guard::Ratifications::<Runtime>::get(pid) {
            frame_support::ensure!(
                record.payload_hash == proposal.payload_hash
                    && record.referendum_index == referendum_index,
                DispatchError::Other("ratification binding mismatch")
            );
            return pallet_execution_guard::Pallet::<Runtime>::bind_ratification(
                pid,
                referendum_index,
            );
        }

        let info = pallet_referenda::ReferendumInfoFor::<Runtime>::get(referendum_index)
            .ok_or(DispatchError::Other("ratification referendum missing"))?;
        let status = match info {
            pallet_referenda::ReferendumInfo::Ongoing(status) => status,
            _ => {
                return Err(DispatchError::Other(
                    "ratification referendum is not ongoing",
                ))
            }
        };
        frame_support::ensure!(
            status.track == 4,
            DispatchError::Other("ratification referendum is not on the ratify track")
        );
        let expected_origin = RuntimeOrigin::from(crate::track_origins::Origin::Ratify)
            .caller()
            .clone();
        frame_support::ensure!(
            status.origin == expected_origin,
            DispatchError::Other("ratification referendum origin is not scoped")
        );

        let decode_call = |bytes: &[u8]| {
            // Referenda lookup preimages are backed by the generic 4 MiB
            // pallet-preimage bound, while this adapter's fixed weight only
            // covers the protocol's 64 KiB payload ceiling.  Reject oversized
            // bytes before SCALE decoding so a proposer cannot turn G-9 into
            // an undercharged multi-megabyte storage read/allocation.
            frame_support::ensure!(
                bytes.len() <= pallet_execution_guard::MAX_PAYLOAD_BYTES as usize,
                DispatchError::Other("ratification preimage too large")
            );
            RuntimeCall::decode_all(&mut &bytes[..])
                .map_err(|_| DispatchError::Other("ratification preimage is not exact"))
        };
        let call = match &status.proposal {
            Bounded::Inline(bytes) => decode_call(bytes.as_ref())?,
            Bounded::Lookup { hash, len } => {
                frame_support::ensure!(
                    *len <= pallet_execution_guard::MAX_PAYLOAD_BYTES,
                    DispatchError::Other("ratification preimage too large")
                );
                let bytes = <Preimage as QueryPreimage>::fetch(hash, Some(*len))
                    .map_err(|_| DispatchError::Other("ratification preimage unavailable"))?;
                decode_call(bytes.as_ref())?
            }
            Bounded::Legacy { .. } => {
                return Err(DispatchError::Other(
                    "legacy ratification preimage is not admissible",
                ))
            }
        };
        frame_support::ensure!(
            matches!(
                call,
                RuntimeCall::ExecutionGuard(pallet_execution_guard::Call::ratify {
                    pid: call_pid,
                    referendum_index: call_index,
                }) if call_pid == pid && call_index == referendum_index
            ),
            DispatchError::Other("ratification referendum call does not bind proposal")
        );
        pallet_execution_guard::Pallet::<Runtime>::bind_ratification(pid, referendum_index)
    }

    fn enqueue(
        pid: futarchy_primitives::ProposalId,
        payload_hash: futarchy_primitives::H256,
        version_constraint: Option<futarchy_primitives::RuntimeVersionConstraint>,
        maturity: BlockNumber,
        grace: BlockNumber,
        requires_ratification: bool,
    ) -> DispatchResult {
        use pallet_execution_guard::{BatchDispatcher, Preimages};

        let proposal = pallet_epoch::Proposals::<Runtime>::get(pid)
            .ok_or(DispatchError::Other("epoch proposal missing at enqueue"))?;
        frame_support::ensure!(
            proposal.payload_hash == payload_hash,
            DispatchError::Other("epoch payload mismatch")
        );
        // `decide` invokes this seam before persisting its in-memory Queued
        // transition. The old on-chain proposal therefore cannot be used to
        // validate maturity/grace; both values are produced by epoch-core from
        // constitution-backed class parameters and arrive over the
        // sovereign-account-only seam. Immutable payload/class fields are
        // still checked against storage here, and guard enqueue re-derives the
        // committed batch before writing either side (I-9).
        frame_support::ensure!(
            requires_ratification
                == matches!(
                    proposal.class,
                    futarchy_primitives::ProposalClass::Code
                        | futarchy_primitives::ProposalClass::Meta
                ),
            DispatchError::Other("epoch ratification-class mismatch")
        );
        let bytes = RuntimePreimages::fetch(payload_hash, proposal.payload_len)
            .ok_or(DispatchError::Other("epoch payload preimage missing"))?;
        let calls = pallet_execution_guard::Pallet::<Runtime>::decode_batch(&bytes)
            .map_err(|_| DispatchError::Other("epoch payload batch invalid"))?;
        // The same mirror screening applies (SQ-308). Screening should already have
        // rejected such a payload; failing here too keeps the adapter honest if a
        // future path reaches it without screening.
        frame_support::ensure!(
            domains_admissible(proposal.class, &calls),
            DispatchError::Other("epoch payload domain inadmissible for class")
        );
        let mut declared_domains = pallet_execution_guard::pallet::StoredDomains::default();
        let mut artifact = None;
        for call in &calls {
            let analysis = crate::classifier::RuntimeDispatcher::rederive_call(call)?;
            for domain in analysis.domains {
                if !declared_domains.contains(&domain) {
                    declared_domains
                        .try_push(domain)
                        .map_err(|_| DispatchError::Other("epoch payload domain bound"))?;
                }
            }
            if let Some(hash) = crate::classifier::RuntimeDispatcher::authorize_upgrade_hash(call) {
                frame_support::ensure!(
                    artifact.is_none(),
                    DispatchError::Other("multiple upgrade commitments")
                );
                artifact = Some(hash);
            }
        }
        let meters_declared = derived_execution_meters(&calls)
            .ok_or(DispatchError::Other("epoch meter derivation bound"))?;
        let ratify_ref = if requires_ratification {
            pallet_execution_guard::Ratifications::<Runtime>::get(pid)
                .map(|record| record.referendum_index)
        } else {
            None
        };
        let attestation_id = if requires_ratification {
            let committed = artifact.map_or(payload_hash, |hash| hash);
            pallet_attestor::Attestations::<Runtime>::get()
                .iter()
                .find(|record| {
                    record.pid == pid
                        && record.artifact_hash == committed
                        && <RuntimeAttestations as pallet_execution_guard::Attestations>::present_unrevoked_unchallenged(record.id)
                })
                .map(|record| record.id)
        } else {
            None
        };
        let grace_end = maturity
            .checked_add(grace)
            .ok_or(DispatchError::Arithmetic(
                sp_runtime::ArithmeticError::Overflow,
            ))?;
        crate::ExecutionGuard::enqueue(
            RuntimeOrigin::signed(epoch_account()),
            pallet_execution_guard::pallet::StoredQueuedExecution {
                pid,
                payload_hash,
                payload_len: proposal.payload_len,
                class: proposal.class,
                maturity,
                grace_end,
                version_constraint: version_constraint
                    .ok_or(DispatchError::Other("runtime version constraint missing"))?,
                meters_declared,
                ratify_ref,
                ratification_passed: false,
                attestation_id,
                pre_upgrade_checkpoint: None,
                cancelled: false,
                declared_domains,
                failed_at: None,
            },
            false,
        )
    }

    fn queue_reject_reason(
        pid: futarchy_primitives::ProposalId,
    ) -> Option<futarchy_primitives::RejectReason> {
        crate::ExecutionGuard::queue_reject_reason(pid)
    }

    fn retry_exhausted(pid: futarchy_primitives::ProposalId) -> bool {
        crate::ExecutionGuard::retry_exhausted(pid)
    }

    fn dequeue_terminal(pid: futarchy_primitives::ProposalId) -> DispatchResult {
        crate::ExecutionGuard::dequeue_terminal(pid)
    }

    fn dequeue_for_rerun(pid: futarchy_primitives::ProposalId) -> DispatchResult {
        crate::ExecutionGuard::dequeue_for_rerun(pid)
    }
}

pub struct RuntimeAttestations;
impl pallet_execution_guard::Attestations for RuntimeAttestations {
    fn artifact_hash(attestation_id: u32) -> Option<futarchy_primitives::H256> {
        pallet_attestor::Attestations::<Runtime>::get()
            .into_iter()
            .find_map(|record| (record.id == attestation_id).then_some(record.artifact_hash))
    }
    fn present_unrevoked_unchallenged(attestation_id: u32) -> bool {
        let record = pallet_attestor::Attestations::<Runtime>::get()
            .into_iter()
            .find(|record| record.id == attestation_id);
        record.is_some_and(|record| {
            matches!(
                record.challenge,
                None | Some(pallet_attestor::ChallengeStatus::Upheld)
            ) && !pallet_attestor::Pallet::<Runtime>::is_revoked(record.id)
        })
    }
    fn has_quorum(
        pid: futarchy_primitives::ProposalId,
        artifact_hash: futarchy_primitives::H256,
    ) -> bool {
        crate::Attestor::has_quorum(pid, artifact_hash)
    }
    fn has_record_quorum(
        pid: futarchy_primitives::ProposalId,
        artifact_hash: futarchy_primitives::H256,
    ) -> bool {
        crate::Attestor::has_record_quorum(pid, artifact_hash)
    }
}

pub struct RuntimeGuardianState;
impl pallet_execution_guard::GuardianState for RuntimeGuardianState {
    fn rerun_held(pid: futarchy_primitives::ProposalId) -> bool {
        pallet_epoch::Proposals::<Runtime>::get(pid).is_some_and(|proposal| {
            matches!(
                proposal.state,
                futarchy_primitives::ProposalState::Suspended
                    | futarchy_primitives::ProposalState::Rerun
            )
        })
    }
    fn ledger_freeze_active() -> bool {
        pallet_constitution::PhaseFlags::<Runtime>::get()
            & pallet_constitution::PhaseFlagsValue::LEDGER_FROZEN
            != 0
    }
    fn dead_man_freeze_active() -> bool {
        pallet_constitution::PhaseFlags::<Runtime>::get()
            & pallet_constitution::PhaseFlagsValue::DEAD_MAN_ENGAGED
            != 0
    }
    fn gate_suspended() -> bool {
        let epoch = pallet_epoch::CurrentEpoch::<Runtime>::get();
        pallet_execution_guard::GateSuspension::<Runtime>::get() == Some(epoch)
            && pallet_welfare::GateBreachFlags::<Runtime>::get(epoch)
                .is_some_and(|flags| flags.s_breached || flags.c_breached)
    }
}

pub struct ExecutionParams;
impl pallet_execution_guard::Params for ExecutionParams {
    fn exec_timelock(class: futarchy_primitives::ProposalClass) -> BlockNumber {
        match class {
            futarchy_primitives::ProposalClass::Param => u32_param(b"exec.lock.param"),
            futarchy_primitives::ProposalClass::Treasury => u32_param(b"exec.lock.trs"),
            futarchy_primitives::ProposalClass::Code => u32_param(b"exec.lock.code"),
            futarchy_primitives::ProposalClass::Meta => u32_param(b"exec.lock.meta"),
            futarchy_primitives::ProposalClass::Constitutional => 0,
        }
    }
    fn exec_grace(_: futarchy_primitives::ProposalClass) -> BlockNumber {
        u32_param(b"exec.grace")
    }
    fn code_spacing() -> BlockNumber {
        u32_param(b"code.spacing")
    }
}

pub struct RuntimeCapabilities;
impl RuntimeCapabilities {
    fn enabled(
        class: futarchy_primitives::ProposalClass,
        capability: pallet_constitution::Capability,
    ) -> bool {
        // `capability_enabled` is intentionally an exact live-table lookup:
        // an absent `(class, capability)` row is disabled, matching the core.
        crate::Constitution::capability_enabled(class, capability)
    }

    fn leaf_enabled(class: futarchy_primitives::ProposalClass, call: &RuntimeCall) -> bool {
        match call {
            RuntimeCall::Constitution(pallet_constitution::Call::set_param { key, .. }) => {
                Self::enabled(class, pallet_constitution::Capability::SetParam(*key))
            }
            RuntimeCall::Constitution(pallet_constitution::Call::set_capability { .. }) => {
                Self::enabled(class, pallet_constitution::Capability::SetCapability)
            }
            RuntimeCall::Constitution(pallet_constitution::Call::amend_registry {
                key,
                min,
                max,
                max_delta,
                cooldown_epochs,
            }) => {
                // 05 §1.4 T4 / 13 rule 7 (SQ-150): registry amendment is
                // META-only, but the capability row alone is insufficient.
                // Unknown keys, kernel-bounded rows and malformed metadata are
                // verifiable constitution violations and must fail at static
                // screening rather than survive until guarded dispatch.
                Self::enabled(class, pallet_constitution::Capability::AmendRegistry)
                    && pallet_constitution::Params::<Runtime>::get(*key).is_some_and(|record| {
                        record
                            .checked_amend(*min, *max, *max_delta, *cooldown_epochs)
                            .is_ok()
                    })
            }
            RuntimeCall::Constitution(pallet_constitution::Call::set_release_channel {
                ..
            }) => Self::enabled(class, pallet_constitution::Capability::SetReleaseChannel),
            RuntimeCall::System(frame_system::Call::authorize_upgrade { .. }) => {
                Self::enabled(class, pallet_constitution::Capability::AuthorizeUpgrade)
            }
            RuntimeCall::ExecutionGuard(pallet_execution_guard::Call::commit_recovery_image {
                ..
            }) => {
                matches!(
                    class,
                    futarchy_primitives::ProposalClass::Code
                        | futarchy_primitives::ProposalClass::Meta
                ) && Self::enabled(class, pallet_constitution::Capability::AuthorizeUpgrade)
            }
            RuntimeCall::FutarchyTreasury(
                pallet_futarchy_treasury::Call::create_community_schedule { .. },
            ) => matches!(class, futarchy_primitives::ProposalClass::Param),
            RuntimeCall::FutarchyTreasury(
                pallet_futarchy_treasury::Call::fund_budget_line { .. }
                | pallet_futarchy_treasury::Call::spend { .. }
                | pallet_futarchy_treasury::Call::open_stream { .. }
                | pallet_futarchy_treasury::Call::cancel_stream { .. }
                | pallet_futarchy_treasury::Call::issue_vit { .. }
                | pallet_futarchy_treasury::Call::recover_foreign { .. }
                | pallet_futarchy_treasury::Call::set_coretime_authority { .. },
            ) => Self::enabled(class, pallet_constitution::Capability::TreasurySpend),
            // INSURANCE → MAIN is a Treasury-domain call, but it is an inflow
            // that cannot spend any budget line. Keep it behind its own narrow
            // capability so granting ordinary treasury outflows never silently
            // grants custody recovery as well (08 §1.2/§1.4; SQ-384).
            RuntimeCall::FutarchyTreasury(pallet_futarchy_treasury::Call::sweep_insurance {
                ..
            }) => Self::enabled(class, pallet_constitution::Capability::InsuranceSweep),
            // 05 §1.4 class safety (SQ-244/SQ-316): the base call-filter projection
            // of `claim_assets` stays **Public** — a Signed origin reclaiming its own
            // self-keyed trap is 09 §6.1's ordinary path and must not need governance.
            // Belief-execution admission is gated separately and narrowly: the leaf is
            // payload-admissible only for TREASURY carrying the Treasury-spend
            // capability (06 §3.2). Without this explicit arm the call would fall to
            // the generic Public allowance below and let a PARAM/CODE/META payload
            // carry it — precisely the 06 §1 / I-8 class confusion.
            RuntimeCall::PolkadotXcm(pallet_xcm::Call::claim_assets { .. }) => {
                matches!(class, futarchy_primitives::ProposalClass::Treasury)
                    && Self::enabled(class, pallet_constitution::Capability::TreasurySpend)
            }
            _ => {
                let Ok(analysis) =
                    <crate::classifier::RuntimeDispatcher as pallet_execution_guard::BatchDispatcher<
                        RuntimeCall,
                    >>::rederive_call(call)
                else {
                    return false;
                };
                analysis.domains.iter().all(|domain| match domain {
                    pallet_execution_guard::CallDomain::Public
                    | pallet_execution_guard::CallDomain::InternalRootApplyUpgrade => true,
                    // Wrappers are peeled by `call_enabled`, so this arm only
                    // sees genuine leaves. EVERY privileged leaf requires an
                    // exact keyed/variant mapping above — a newly classified
                    // Treasury/Code/Param/Meta call fails closed until its
                    // 06 §3.2 capability row is made explicit here (it must
                    // never inherit a broad capability structurally).
                    pallet_execution_guard::CallDomain::Param
                    | pallet_execution_guard::CallDomain::Treasury
                    | pallet_execution_guard::CallDomain::Code
                    | pallet_execution_guard::CallDomain::InternalRootAuthorizeUpgrade
                    | pallet_execution_guard::CallDomain::Meta => false,
                })
            }
        }
    }
}

impl pallet_execution_guard::Capabilities<RuntimeCall> for RuntimeCapabilities {
    fn call_enabled(class: futarchy_primitives::ProposalClass, call: &RuntimeCall) -> bool {
        match call {
            RuntimeCall::Utility(
                pallet_utility::Call::batch { calls }
                | pallet_utility::Call::batch_all { calls }
                | pallet_utility::Call::force_batch { calls },
            ) => calls.iter().all(|call| Self::call_enabled(class, call)),
            RuntimeCall::Utility(
                pallet_utility::Call::as_derivative { call, .. }
                | pallet_utility::Call::dispatch_as { call, .. }
                | pallet_utility::Call::with_weight { call, .. },
            )
            | RuntimeCall::Proxy(
                pallet_proxy::Call::proxy { call, .. }
                | pallet_proxy::Call::proxy_announced { call, .. },
            )
            | RuntimeCall::Multisig(
                pallet_multisig::Call::as_multi { call, .. }
                | pallet_multisig::Call::as_multi_threshold_1 { call, .. },
            ) => Self::call_enabled(class, call),
            #[cfg(feature = "bootstrap")]
            RuntimeCall::Sudo(
                pallet_sudo::Call::sudo { call }
                | pallet_sudo::Call::sudo_unchecked_weight { call, .. },
            ) => Self::call_enabled(class, call),
            _ => Self::leaf_enabled(class, call),
        }
    }
}

pub struct RuntimePreimages;
impl pallet_execution_guard::Preimages for RuntimePreimages {
    fn len(hash: futarchy_primitives::H256) -> Option<u32> {
        <Preimage as QueryPreimage>::len(&Hash::from(hash))
    }
    fn fetch(hash: futarchy_primitives::H256, expected_len: u32) -> Option<Vec<u8>> {
        if expected_len > futarchy_primitives::kernel::MAX_BYTES {
            return None;
        }
        <Preimage as QueryPreimage>::fetch(&Hash::from(hash), Some(expected_len))
            .ok()
            .map(Cow::into_owned)
    }
    fn pin(hash: futarchy_primitives::H256) -> DispatchResult {
        <Preimage as QueryPreimage>::request(&Hash::from(hash));
        Ok(())
    }
    fn unpin(hash: futarchy_primitives::H256) -> DispatchResult {
        let hash = Hash::from(hash);
        if !<Preimage as QueryPreimage>::is_requested(&hash) {
            return Err(DispatchError::Unavailable);
        }
        <Preimage as QueryPreimage>::unrequest(&hash);
        Ok(())
    }
}

impl pallet_execution_guard::RecoveryImages for RuntimePreimages {
    fn len(hash: futarchy_primitives::H256) -> Option<u32> {
        <Preimage as QueryPreimage>::len(&Hash::from(hash))
    }
    fn fetch(hash: futarchy_primitives::H256, expected_len: u32) -> Option<Vec<u8>> {
        if expected_len > pallet_preimage::MAX_SIZE {
            return None;
        }
        <Preimage as QueryPreimage>::fetch(&Hash::from(hash), Some(expected_len))
            .ok()
            .map(Cow::into_owned)
    }
    fn is_pinned(hash: futarchy_primitives::H256) -> bool {
        <Preimage as QueryPreimage>::is_requested(&Hash::from(hash))
    }
    fn preflight_qualifies(code: &[u8]) -> bool {
        let Ok(code_len) = u32::try_from(code.len()) else {
            return false;
        };
        cumulus_pallet_parachain_system::HostConfiguration::<Runtime>::get()
            .is_some_and(|host| code_len <= host.max_code_size)
    }
    fn pin(hash: futarchy_primitives::H256) -> DispatchResult {
        <Preimage as QueryPreimage>::request(&Hash::from(hash));
        Ok(())
    }
    fn unpin(hash: futarchy_primitives::H256) -> DispatchResult {
        let hash = Hash::from(hash);
        if !<Preimage as QueryPreimage>::is_requested(&hash) {
            return Err(DispatchError::Unavailable);
        }
        <Preimage as QueryPreimage>::unrequest(&hash);
        Ok(())
    }
}

pub struct RuntimePhaseState;

fn sudo_key_storage_exists() -> bool {
    let mut key = [0u8; 32];
    key[..16].copy_from_slice(&sp_io::hashing::twox_128(b"Sudo"));
    key[16..].copy_from_slice(&sp_io::hashing::twox_128(b"Key"));
    sp_io::storage::exists(&key)
}

impl pallet_execution_guard::PhaseState for RuntimePhaseState {
    fn exact_phase_three() -> bool {
        #[cfg(not(feature = "bootstrap"))]
        {
            false
        }
        #[cfg(feature = "bootstrap")]
        {
            let expected = pallet_constitution::PhaseFlagsValue::SHADOW_MODE
                | pallet_constitution::PhaseFlagsValue::SUDO_PRESENT;
            pallet_constitution::PhaseFlags::<Runtime>::get() == expected
                && pallet_sudo::Key::<Runtime>::get().is_some()
        }
    }
    fn exact_phase_four() -> bool {
        pallet_constitution::PhaseFlags::<Runtime>::get()
            == pallet_constitution::PhaseFlagsValue::PARAM_ARMED
            && !sudo_key_storage_exists()
    }
    fn post_sudo_phase() -> bool {
        let flags = pallet_constitution::PhaseFlags::<Runtime>::get();
        flags & pallet_constitution::PhaseFlagsValue::PARAM_ARMED != 0
            && flags
                & (pallet_constitution::PhaseFlagsValue::SHADOW_MODE
                    | pallet_constitution::PhaseFlagsValue::SUDO_PRESENT)
                == 0
            && !sudo_key_storage_exists()
    }

    fn class_execution_enabled(class: futarchy_primitives::ProposalClass) -> bool {
        let flags = pallet_constitution::PhaseFlags::<Runtime>::get();
        match class {
            futarchy_primitives::ProposalClass::Param => {
                flags & pallet_constitution::PhaseFlagsValue::PARAM_ARMED != 0
            }
            futarchy_primitives::ProposalClass::Treasury => {
                flags & pallet_constitution::PhaseFlagsValue::TREASURY_ARMED != 0
            }
            futarchy_primitives::ProposalClass::Code | futarchy_primitives::ProposalClass::Meta => {
                flags & pallet_constitution::PhaseFlagsValue::CODE_META_ARMED != 0
            }
            futarchy_primitives::ProposalClass::Constitutional => false,
        }
    }

    fn phase_four_plan_valid(plan: &pallet_execution_guard::PhaseFourPlan) -> bool {
        let epoch = pallet_epoch::CurrentEpoch::<Runtime>::get();
        let now = System::block_number();
        [
            (
                pallet_constitution::key16(b"phase3.tvl_cap"),
                pallet_constitution::ParamValue::Balance(plan.tvl_cap),
            ),
            (
                pallet_constitution::key16(b"phase3.dep_cap"),
                pallet_constitution::ParamValue::Balance(plan.deposit_cap),
            ),
        ]
        .into_iter()
        .all(|(key, value)| {
            pallet_constitution::Params::<Runtime>::get(key).is_some_and(|record| {
                value.as_u128() > record.value.as_u128()
                    && record.checked_update(value, epoch, now).is_ok()
            })
        })
    }
}

pub struct EnsureCurrentSudoKey;
impl frame_support::traits::EnsureOrigin<RuntimeOrigin> for EnsureCurrentSudoKey {
    type Success = AccountId;

    fn try_origin(origin: RuntimeOrigin) -> Result<Self::Success, RuntimeOrigin> {
        #[cfg(not(feature = "bootstrap"))]
        {
            Err(origin)
        }
        #[cfg(feature = "bootstrap")]
        {
            let raw: Result<frame_system::RawOrigin<AccountId>, RuntimeOrigin> = origin.into();
            raw.and_then(|raw| match raw {
                frame_system::RawOrigin::Signed(who)
                    if pallet_sudo::Key::<Runtime>::get().as_ref() == Some(&who) =>
                {
                    Ok(who)
                }
                other => Err(RuntimeOrigin::from(other)),
            })
        }
    }

    #[cfg(feature = "runtime-benchmarks")]
    fn try_successful_origin() -> Result<RuntimeOrigin, ()> {
        #[cfg(not(feature = "bootstrap"))]
        {
            Err(())
        }
        #[cfg(feature = "bootstrap")]
        {
            pallet_sudo::Key::<Runtime>::get()
                .map(RuntimeOrigin::signed)
                .ok_or(())
        }
    }
}

fn write_release_u32(
    bytes: &mut [u8; pallet_constitution::RELEASE_CHANNEL_LEN],
    range: core::ops::Range<usize>,
    value: u32,
) -> DispatchResult {
    let slot = bytes
        .get_mut(range)
        .ok_or(DispatchError::Other("release channel offset"))?;
    slot.copy_from_slice(&value.to_le_bytes());
    Ok(())
}

pub struct RuntimeReleaseChannel;
impl pallet_execution_guard::ReleaseChannelWriter for RuntimeReleaseChannel {
    fn on_upgrade_authorized(
        _target_spec_version: u32,
        authorized_at: BlockNumber,
    ) -> DispatchResult {
        let channel = pallet_constitution::ReleaseChannel::<Runtime>::get();
        let mut bytes = channel.bytes;
        write_release_u32(
            &mut bytes,
            pallet_constitution::RELEASE_CHANNEL_UPDATED_AT,
            authorized_at,
        )?;
        write_release_u32(
            &mut bytes,
            pallet_constitution::RELEASE_CHANNEL_PENDING_AUTHORIZED_AT,
            authorized_at,
        )?;
        write_release_u32(
            &mut bytes,
            pallet_constitution::RELEASE_CHANNEL_FLAGS,
            channel.flags() | pallet_constitution::RELEASE_CHANNEL_FLAG_URGENT_UPGRADE,
        )?;
        crate::Constitution::note_release_channel(bytes)
    }
    fn on_upgrade_applied(target_spec_version: u32) -> DispatchResult {
        let channel = pallet_constitution::ReleaseChannel::<Runtime>::get();
        let mut bytes = channel.bytes;
        write_release_u32(
            &mut bytes,
            pallet_constitution::RELEASE_CHANNEL_UPDATED_AT,
            System::block_number(),
        )?;
        write_release_u32(
            &mut bytes,
            pallet_constitution::RELEASE_CHANNEL_SPEC_VERSION,
            target_spec_version,
        )?;
        write_release_u32(
            &mut bytes,
            pallet_constitution::RELEASE_CHANNEL_PENDING_AUTHORIZED_AT,
            0,
        )?;
        write_release_u32(
            &mut bytes,
            pallet_constitution::RELEASE_CHANNEL_FLAGS,
            channel.flags() & !pallet_constitution::RELEASE_CHANNEL_FLAG_URGENT_UPGRADE,
        )?;
        crate::Constitution::note_release_channel(bytes)
    }
    fn on_upgrade_aborted(_target_spec_version: u32) -> DispatchResult {
        let channel = pallet_constitution::ReleaseChannel::<Runtime>::get();
        let mut bytes = channel.bytes;
        write_release_u32(
            &mut bytes,
            pallet_constitution::RELEASE_CHANNEL_UPDATED_AT,
            System::block_number(),
        )?;
        write_release_u32(
            &mut bytes,
            pallet_constitution::RELEASE_CHANNEL_PENDING_AUTHORIZED_AT,
            0,
        )?;
        write_release_u32(
            &mut bytes,
            pallet_constitution::RELEASE_CHANNEL_FLAGS,
            channel.flags() & !pallet_constitution::RELEASE_CHANNEL_FLAG_URGENT_UPGRADE,
        )?;
        crate::Constitution::note_release_channel(bytes)
    }

    fn pending_upgrade_indication() -> (BlockNumber, bool) {
        let channel = pallet_constitution::ReleaseChannel::<Runtime>::get();
        (
            channel.pending_authorized_at(),
            channel.flags() & pallet_constitution::RELEASE_CHANNEL_FLAG_URGENT_UPGRADE != 0,
        )
    }
}

pub struct RuntimeUpgradeSchedule;
impl pallet_execution_guard::UpgradeSchedule for RuntimeUpgradeSchedule {
    fn scheduling_performed() -> bool {
        // A guard pending upgrade exists before application. Scheduling is
        // proven only once frame-system consumed AuthorizedUpgrade and
        // Cumulus durably holds the validation function for relay review.
        cumulus_pallet_parachain_system::PendingValidationCode::<Runtime>::exists()
            && System::authorized_upgrade().is_none()
    }
}

/// Exact stable2606 pre-write checks (re-verified at the D-19 line move:
/// cumulus-pallet-parachain-system 0.29.0 is condition-for-condition identical)
/// performed by
/// `cumulus_pallet_parachain_system::schedule_code_upgrade`. Frame-system
/// removes `AuthorizedUpgrade` before invoking `OnSetCode`, and a direct
/// dispatch is not transactional, so every typed Cumulus rejection must be
/// refused by the filter before frame-system can consume the authorization.
pub(crate) fn parachain_upgrade_preflight(code: &[u8]) -> DispatchResult {
    use cumulus_pallet_parachain_system as parachain_system;

    if !parachain_system::ValidationData::<Runtime>::exists() {
        return Err(parachain_system::Error::<Runtime>::ValidationDataNotAvailable.into());
    }
    if parachain_system::UpgradeRestrictionSignal::<Runtime>::get().is_some() {
        return Err(parachain_system::Error::<Runtime>::ProhibitedByPolkadot.into());
    }
    if parachain_system::PendingValidationCode::<Runtime>::exists() {
        return Err(parachain_system::Error::<Runtime>::OverlappingUpgrades.into());
    }
    let host = parachain_system::HostConfiguration::<Runtime>::get()
        .ok_or(parachain_system::Error::<Runtime>::HostConfigurationNotAvailable)?;
    let code_len =
        u32::try_from(code.len()).map_err(|_| parachain_system::Error::<Runtime>::TooBig)?;
    if code_len > host.max_code_size {
        return Err(parachain_system::Error::<Runtime>::TooBig.into());
    }
    Ok(())
}

/// The origin-blind base filter admits the permissionless frame-system apply
/// call only after reproducing every artifact-dependent guard precondition.
/// This prevents a direct call from consuming `AuthorizedUpgrade` with the
/// wrong version or while pallet-migrations is active.
pub(crate) fn direct_system_upgrade_allowed(code: &[u8]) -> bool {
    let Some(pending) = pallet_execution_guard::pallet::PendingUpgrade::<Runtime>::get() else {
        return false;
    };
    if sp_io::hashing::blake2_256(code) != pending.hash {
        return false;
    }
    let Some(observed) =
        <crate::classifier::RuntimeDispatcher as pallet_execution_guard::BatchDispatcher<
            RuntimeCall,
        >>::observed_runtime_version(code)
    else {
        return false;
    };
    let Some(current) = pallet_execution_guard::CurrentSpecName::<Runtime>::get() else {
        return false;
    };
    let version_matches = observed.spec_name == current.spec_name
        && observed.spec_version == pending.target_spec_version;
    #[cfg(not(feature = "runtime-benchmarks"))]
    let preflight_passes = System::can_set_code(code, true).into_result().is_ok()
        && parachain_upgrade_preflight(code).is_ok();
    #[cfg(feature = "runtime-benchmarks")]
    let preflight_passes = true;
    let bridge_matches = match pallet_execution_guard::PhaseFourBridge::<Runtime>::get() {
        pallet_execution_guard::PhaseFourBridgeState::Pending { code_hash, .. } => {
            code_hash == pending.hash
        }
        pallet_execution_guard::PhaseFourBridgeState::Scheduled { .. } => false,
        pallet_execution_guard::PhaseFourBridgeState::Unused
        | pallet_execution_guard::PhaseFourBridgeState::Consumed => true,
    };
    version_matches && preflight_passes && bridge_matches
}

fn scheduled_upgrade_abort_candidate() -> Option<futarchy_primitives::H256> {
    use cumulus_primitives_core::relay_chain::UpgradeGoAhead;

    let pending = pallet_execution_guard::pallet::PendingUpgrade::<Runtime>::get()?;
    if pallet_execution_guard::ScheduledUpgrade::<Runtime>::get() != Some(pending.hash)
        || !matches!(
            cumulus_pallet_parachain_system::UpgradeGoAhead::<Runtime>::get(),
            Some(UpgradeGoAhead::Abort)
        )
        || cumulus_pallet_parachain_system::PendingValidationCode::<Runtime>::exists()
    {
        return None;
    }
    Some(pending.hash)
}

fn installed_code_differs(expected: futarchy_primitives::H256) -> bool {
    sp_io::storage::get(sp_core::storage::well_known_keys::CODE)
        .map(|code| sp_io::hashing::blake2_256(&code) != expected)
        .unwrap_or(true)
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum RecoveryTrigger {
    Cursor(pallet_migrations::CursorOf<Runtime>),
    PhaseTransition,
}

pub(crate) fn recovery_trigger() -> Option<RecoveryTrigger> {
    let sources = MigrationHaltSources::get();
    // The phase-transition cause takes precedence over any cursor cause, and
    // is matched **before** the cursor arms rather than beside them.
    //
    // Both arms used to match the same scrutinee with the phase arm requiring
    // `Cursor == None`, so a cursor — including one auto-onboarded by
    // `pallet_migrations` and never serviced — made the phase cause
    // unreachable and buried the only repair for a refused
    // `PhaseFourTransition`. 09 §3.2 puts both causes in one lane and nowhere
    // declares them exclusive; the exclusivity was an implementation artifact.
    //
    // Precedence rather than a second lane, because the terminal image
    // replaces the runtime wholesale at the next spec version: an MBM
    // belonging to the runtime being replaced has nothing left to repair, and
    // 09 §3.2 says a successful terminal repair clears "the cursor/transition
    // cause".
    if PhaseTransitionLock::get()
        && matches!(
            pallet_execution_guard::PhaseFourBridge::<Runtime>::get(),
            pallet_execution_guard::PhaseFourBridgeState::Scheduled { .. }
        )
        && sources & APPLIED_DETECTION_HALT != 0
    {
        return Some(RecoveryTrigger::PhaseTransition);
    }
    match pallet_migrations::Cursor::<Runtime>::get() {
        Some(cursor @ pallet_migrations::MigrationCursor::Stuck)
            if sources & MIGRATION_FAILURE_HALT != 0 =>
        {
            Some(RecoveryTrigger::Cursor(cursor))
        }
        Some(pallet_migrations::MigrationCursor::Active(cursor)) => {
            (active_migration_stall_is_live(&cursor) && sources & MIGRATION_STALL_HALT != 0)
                .then_some(RecoveryTrigger::Cursor(
                    pallet_migrations::MigrationCursor::Active(cursor),
                ))
        }
        Some(_) => None,
        None => None,
    }
}

pub(crate) fn recovery_hook_weight(bytes: u32) -> Weight {
    // The recovery path performs the same bounded full-Wasm read, version
    // inspection, hash and preimage bookkeeping as the generated recovery
    // qualifier. Reuse that measured worst-case envelope so this mandatory
    // hook moves with the committed benchmark artifact and its >10% regression
    // gate instead of carrying an unmeasured runtime-local constant.
    <crate::weights::pallet_execution_guard::WeightInfo<Runtime> as pallet_execution_guard::WeightInfo>::qualify_recovery_image(bytes)
}

pub(crate) fn recovery_schedule_hook_weight(bytes: u32) -> Weight {
    // `schedule_committed_recovery_image` performs the full bounded
    // qualification/preimage path, then FRAME authorization and Cumulus code
    // scheduling, plus the runtime-local lockdown/cursor/receipt writes. The
    // mandatory inherent must pre-charge all of it (I-20); charging only the
    // qualifier undercounts a 4 MiB application by roughly an order of
    // magnitude. The final term conservatively covers the additional fixed
    // runtime-local reads/writes and the retired cursor proof not present in
    // the generated dispatch weights.
    recovery_hook_weight(bytes)
        .saturating_add(
            <<Runtime as frame_system::Config>::SystemWeightInfo as frame_system::WeightInfo>::authorize_upgrade(),
        )
        .saturating_add(
            <<Runtime as frame_system::Config>::SystemWeightInfo as frame_system::WeightInfo>::apply_authorized_upgrade(),
        )
        .saturating_add(
            <Runtime as frame_system::Config>::DbWeight::get().reads_writes(8, 8),
        )
        .saturating_add(Weight::from_parts(
            0,
            u64::from(bounds::MIGRATION_CURSOR_MAX_LEN),
        ))
}

/// Move the migration cursor out of the way of the recovery image, for either
/// cause.
///
/// **Both causes retire the cursor; neither refuses it.** The phase arm used to
/// `ensure!` that no cursor existed, and since `recovery_trigger` gives the
/// phase cause precedence, that turned a legitimate state into a permanent
/// stall: an MBM that had already progressed when the Phase-4 code was
/// installed is left in place, and this wrapper stops servicing the migrator
/// the moment `PhaseTransitionLock` is set, so the cursor can never clear
/// itself. Scheduling then rolled back on every block, `RecoveryLockdown` and
/// `PhaseTransitionLock` stayed set, and `frame_executive::extrinsic_mode()`
/// returned `OnlyInherents` indefinitely with no dispatchable writer for either
/// flag. Refusing to schedule a repair is never the safe reading of a cause the
/// runtime cannot repair on its own.
///
/// Retiring preserves the pre-recovery state for
/// [`restore_recovery_cursor_after_abort`] if the relay rejects the image. On
/// the success path `TerminalRecoveryTransition` discards it, because the
/// terminal image replaces the runtime that owned the MBM and there is nothing
/// left for it to repair.
///
/// Called inside `schedule_committed_recovery_image`'s storage layer, so it is
/// rolled back with everything else if scheduling fails.
pub(crate) fn retire_cursor_for(trigger: RecoveryTrigger) {
    let cursor = match trigger {
        RecoveryTrigger::Cursor(cursor) => Some(cursor),
        RecoveryTrigger::PhaseTransition => pallet_migrations::Cursor::<Runtime>::get(),
    };
    if let Some(cursor) = cursor {
        // Never overwrite a cursor already retired: one slot restores one
        // cursor, and the older record is the one an abort has to put back.
        if !RetiredMigrationCursor::exists() {
            RetiredMigrationCursor::put(cursor);
        }
        pallet_migrations::Cursor::<Runtime>::kill();
    }
}

fn schedule_committed_recovery_image() -> DispatchResult {
    if RecoveryLockdown::get() || RecoveryAborted::get() || RecoveryScheduledHash::exists() {
        return Ok(());
    }
    frame_support::storage::with_storage_layer(|| {
        let trigger = recovery_trigger().ok_or(DispatchError::Other("recovery trigger missing"))?;
        let (recovery, code) = crate::ExecutionGuard::prepare_recovery_image()?;
        parachain_upgrade_preflight(&code)?;

        // From this write until GoAhead/Abort, the wrapper keeps FRAME in
        // OnlyInherents even though frame-system requires the SDK cursor to be
        // absent while applying the authorization.
        RecoveryLockdown::put(true);
        retire_cursor_for(trigger);
        RecoveryCodeApplied::kill();
        RecoveryBypass::put(true);
        let result = (|| {
            // N7-DISPATCH-TRIPWIRE: recovery-authorize
            RuntimeCall::System(frame_system::Call::authorize_upgrade {
                code_hash: Hash::from(recovery.hash),
            })
            .dispatch_bypass_filter(RuntimeOrigin::root())
            .map_err(|error| error.error)?;
            // N7-DISPATCH-TRIPWIRE: recovery-apply
            RuntimeCall::System(frame_system::Call::apply_authorized_upgrade { code })
                .dispatch_bypass_filter(RuntimeOrigin::none())
                .map_err(|error| error.error)?;
            crate::ExecutionGuard::recovery_scheduled(recovery.hash)?;
            RecoveryScheduledHash::put(recovery.hash);
            Ok(())
        })();
        RecoveryBypass::kill();
        result
    })
}

fn recovery_upgrade_abort_candidate() -> Option<futarchy_primitives::H256> {
    use cumulus_primitives_core::relay_chain::UpgradeGoAhead;
    let hash = RecoveryScheduledHash::get()?;
    (matches!(
        cumulus_pallet_parachain_system::UpgradeGoAhead::<Runtime>::get(),
        Some(UpgradeGoAhead::Abort)
    ) && !cumulus_pallet_parachain_system::PendingValidationCode::<Runtime>::exists())
    .then_some(hash)
}

fn restore_recovery_cursor_after_abort() -> DispatchResult {
    if let Some(cursor) = RetiredMigrationCursor::get() {
        if pallet_migrations::Cursor::<Runtime>::exists() {
            return Err(DispatchError::Other("recovery cursor already present"));
        }
        pallet_migrations::Cursor::<Runtime>::put(cursor);
    } else if !PhaseTransitionLock::get() {
        return Err(DispatchError::Other("recovery cause missing"));
    }
    RecoveryScheduledHash::kill();
    RecoveryCodeApplied::kill();
    RecoveryAborted::put(true);
    // Keep RecoveryLockdown set: no ordinary call may observe the restored
    // half-migrated layout, and a relay-rejected image is never auto-retried.
    Ok(())
}

pub(crate) fn installed_code_identity() -> Option<(
    futarchy_primitives::H256,
    futarchy_primitives::RuntimeVersionConstraint,
)> {
    use pallet_execution_guard::BatchDispatcher;
    let code = sp_io::storage::get(sp_core::storage::well_known_keys::CODE)?;
    let hash = sp_io::hashing::blake2_256(&code);
    let version = crate::classifier::RuntimeDispatcher::observed_runtime_version(&code)?;
    Some((hash, version))
}

/// Cumulus calls this only after relay `GoAhead` has written the new `:code`.
/// Any missing/mismatched guard state raises PB-MIGRATION instead of claiming
/// that an untracked upgrade applied.
pub struct ExecutionGuardSystemEvent;
impl cumulus_pallet_parachain_system::OnSystemEvent for ExecutionGuardSystemEvent {
    fn on_validation_data(data: &cumulus_primitives_core::PersistedValidationData) {
        frame_system::Pallet::<Runtime>::register_extra_weight_unchecked(
            migration_validation_hook_weight()
                .saturating_add(dead_man_detector_hook_weight())
                // 05 §4.3.2's relay-slot observation below: the `(epoch, day)`
                // attribution, the one extra `LastRelayParent` read the
                // detector's own envelope does not include, and the window
                // publication the post-transaction hook consumes. Charged here,
                // ahead of the abort branches that can return early, because
                // over-charging a halting block is the safe direction.
                .saturating_add(block_production_window_weight())
                .saturating_add(
                    <Runtime as frame_system::Config>::DbWeight::get().reads_writes(1, 1),
                ),
            DispatchClass::Mandatory,
        );
        // Called once by the mandatory parachain inherent before the
        // executive services the MBM cursor for this block. Reading the
        // cursor's persisted start block is O(1) storage and bounded by
        // CursorMaxLen.
        track_migration_progress();
        if let Some(expected) = recovery_upgrade_abort_candidate() {
            // The cheap relay/pending-code predicate is true; register the
            // full bounded `:code` read/hash before performing it.
            frame_system::Pallet::<Runtime>::register_extra_weight_unchecked(
                recovery_hook_weight(pallet_preimage::MAX_SIZE),
                DispatchClass::Mandatory,
            );
            if installed_code_differs(expected) {
                if restore_recovery_cursor_after_abort().is_err() {
                    set_migration_halt_source(APPLIED_DETECTION_HALT);
                }
                set_migration_halt_source(UPGRADE_ABORT_TRIGGER);
                return;
            }
        }
        let now = frame_system::Pallet::<Runtime>::block_number();
        let snapshot_overdue = pallet_welfare::Pallet::<Runtime>::snapshot_overdue(now)
            && !snapshot_close_blocked_by_pause();
        // 05 §4.3.2: `U`'s denominator is the sum of per-block relay-parent
        // deltas, and its baseline is the *previous block's* relay parent —
        // which crosses the window boundary, so an outage spanning a day or an
        // epoch is charged to exactly one window and lost by neither. The
        // detector already stores that baseline as `pallet_epoch::LastRelayParent`
        // (05 §4.8), so it is read here rather than duplicated: one observation,
        // one relay-parent read path, and no way for the two consumers to
        // disagree about what the previous block anchored to. It must be read
        // *before* `observe_dead_man`, which is what advances it.
        let previous_relay_parent = pallet_epoch::LastRelayParent::<Runtime>::get();
        // The pallet seam accepts only the plain relay number (I-24); detector
        // failure leaves the already-latched status quo untouched.
        //
        // 05 §4.3.2 `Π`, `IntegrityFault::DiscardedInternalCall` — "an internal
        // cross-pallet call whose failure is discarded rather than propagated".
        // This is the shape exactly: the caller is the mandatory parachain
        // inherent with nowhere to return a `DispatchResult` to, and the callee
        // runs inside its own storage layer, so a refused
        // `note_dead_man_engaged` unwinds the *whole* observation — relay
        // baseline, cause bits and pause instant together — and the block
        // proceeds as though the detector had run.
        //
        // Clause 3 is what admits it. The next block re-observes from the
        // un-advanced baseline, so the *gap* is not lost — but the latch that
        // this block's evidence called for was not engaged, and if the
        // constitution write keeps refusing (the deterministic case, and the
        // only one that matters) it is never engaged at all. There is no reaper,
        // no cursor and no crank that reconstructs a missed dead-man
        // engagement; a per-block retry against a deterministic refusal is not a
        // defined recovery path, it is the same failure repeated. Counting each
        // block is correct rather than inflationary: four consecutive blocks
        // unable to engage the chain's liveness backstop *is* `Π = 0`.
        if pallet_epoch::Pallet::<Runtime>::observe_dead_man(
            data.relay_parent_number,
            snapshot_overdue,
        )
        .is_err()
        {
            <RuntimeIntegrityRecorder as futarchy_primitives::integrity::IntegritySink>::
                note_integrity_failure(
                    futarchy_primitives::integrity::IntegrityFault::DiscardedInternalCall,
                );
        }
        {
            // §4.3.2's nominal-cadence rule covers both cases where no usable
            // predecessor exists: genesis (no baseline recorded yet) and a relay
            // regression (`checked_sub` fails). The regression case is
            // unreachable in production — the parachain-system monotonicity
            // check rejects it before this seam — and one is the conservative
            // answer for it anyway: it is the same "score this opening block as
            // healthy cadence" reading genesis gets, rather than a zero
            // denominator or an arbitrary jump. A delta of *zero* is not that
            // case and is recorded as zero: two parachain blocks may share a
            // relay parent, and `U`'s clamp absorbs the ratio above 1.
            let slots = match previous_relay_parent {
                Some(seen) => data.relay_parent_number.checked_sub(seen).unwrap_or(1),
                None => 1,
            };
            let (epoch, day) = xcm_traffic_epoch_and_day();
            // Publish the window this block's production belongs to, for
            // `BlockProductionRecorder` to consume after the transactions. The
            // attribution happens exactly once, here, because the transactions
            // in between can include the permissionless `Epoch::tick` — and a
            // second, post-tick attribution put the block's authored count in
            // the *next* epoch while its relay slot stayed in this one.
            //
            // Stamped with the block, so a post-transaction hook that runs
            // without this seam having run drops the observation instead of
            // inheriting a previous block's window (see
            // [`BlockProductionWindow`]).
            BlockProductionWindow::put((now, epoch, day));
            pallet_welfare::Pallet::<Runtime>::note_block_production(
                epoch,
                day,
                pallet_welfare::BlockProductionSignal::RelaySlots(slots),
            );
        }
        if let Some(expected) = scheduled_upgrade_abort_candidate() {
            frame_system::Pallet::<Runtime>::register_extra_weight_unchecked(
                recovery_hook_weight(pallet_preimage::MAX_SIZE),
                DispatchClass::Mandatory,
            );
            if installed_code_differs(expected) {
                let phase_transition = PhaseTransitionLock::get();
                if crate::ExecutionGuard::validation_code_aborted().is_ok() {
                    if phase_transition {
                        PhaseTransitionLock::kill();
                        PhaseTransitionApplied::kill();
                    }
                    // Guardian-visible incident trigger, intentionally not an
                    // execution-queue halt: the relay preserved status quo and a
                    // fresh normal proposal must remain possible.
                    set_migration_halt_source(UPGRADE_ABORT_TRIGGER);
                } else {
                    // A failed status-quo cleanup is itself a halt-worthy applied
                    // boundary mismatch; retain every pending record for review.
                    set_migration_halt_source(UPGRADE_ABORT_TRIGGER | APPLIED_DETECTION_HALT);
                }
                return;
            }
        }
        if let Some(recovery) = pallet_execution_guard::RecoveryImage::<Runtime>::get() {
            if recovery_trigger().is_some() {
                frame_system::Pallet::<Runtime>::register_extra_weight_unchecked(
                    recovery_schedule_hook_weight(recovery.len.min(pallet_preimage::MAX_SIZE)),
                    DispatchClass::Mandatory,
                );
                if schedule_committed_recovery_image().is_err() {
                    // The original cursor/anchor/commitment remain byte-identical
                    // because scheduling is one storage transaction.
                    set_migration_halt_source(MIGRATION_FAILURE_HALT);
                }
            }
        }
    }
    fn on_validation_code_applied() {
        // The callback's first proof is the installed `:code` identity. Charge
        // its maximum bounded read/hash before touching the bytes.
        frame_system::Pallet::<Runtime>::register_extra_weight_unchecked(
            recovery_hook_weight(pallet_preimage::MAX_SIZE),
            DispatchClass::Mandatory,
        );
        if let Some(hash) = RecoveryScheduledHash::get() {
            let valid = installed_code_identity().is_some_and(|(installed_hash, version)| {
                installed_hash == hash
                    && pallet_execution_guard::RecoveryImage::<Runtime>::get().is_some_and(
                        |recovery| {
                            recovery.hash == hash
                                && recovery.target_spec_version == version.spec_version
                                && pallet_execution_guard::CurrentSpecName::<Runtime>::get()
                                    .is_some_and(|current| current.spec_name == version.spec_name)
                        },
                    )
            });
            if valid {
                // Cumulus invokes this in the old runtime. The terminal
                // recovery profile performs its bounded repair and atomic
                // guard/channel finalization at the next block's
                // `on_runtime_upgrade`; both locks remain active until then.
                RecoveryCodeApplied::put(true);
            } else {
                set_migration_halt_source(APPLIED_DETECTION_HALT);
            }
            return;
        }
        let installed_identity = installed_code_identity();
        let installed_hash = installed_identity.as_ref().map(|(hash, _)| *hash);
        let valid = installed_identity.as_ref().is_some_and(|(hash, observed)| {
            pallet_execution_guard::pallet::PendingUpgrade::<Runtime>::get().is_some_and(
                |pending| {
                    let current = pallet_execution_guard::CurrentSpecName::<Runtime>::get();
                    *hash == pending.hash
                        && current.is_some_and(|current| {
                            observed.spec_name == current.spec_name
                                && observed.spec_version == pending.target_spec_version
                        })
                },
            )
        });
        let bridge = pallet_execution_guard::PhaseFourBridge::<Runtime>::get();
        if matches!(
            bridge,
            pallet_execution_guard::PhaseFourBridgeState::Pending { code_hash, .. }
                if installed_hash == Some(code_hash)
        ) {
            if !valid
                || frame_support::storage::with_storage_layer(|| {
                    let hash = installed_hash
                        .ok_or(DispatchError::Other("phase-four installed code missing"))?;
                    crate::ExecutionGuard::phase_four_scheduled(hash)?;
                    PhaseTransitionLock::put(true);
                    PhaseTransitionApplied::put(true);
                    Ok::<(), DispatchError>(())
                })
                .is_err()
            {
                set_migration_halt_source(APPLIED_DETECTION_HALT);
            }
            return;
        }
        if matches!(
            bridge,
            pallet_execution_guard::PhaseFourBridgeState::Scheduled { code_hash, .. }
                if installed_hash == Some(code_hash)
        ) || PhaseTransitionLock::get()
        {
            if valid && PhaseTransitionLock::get() {
                // The no-Sudo image's one-shot migration runs only at the next
                // block's `on_runtime_upgrade`, so preserve the OnlyInherents
                // lock and leave guard pending state intact for that atomic
                // transition.
                PhaseTransitionApplied::put(true);
            } else {
                set_migration_halt_source(APPLIED_DETECTION_HALT);
            }
            return;
        }
        if matches!(
            bridge,
            pallet_execution_guard::PhaseFourBridgeState::Pending { .. }
                | pallet_execution_guard::PhaseFourBridgeState::Scheduled { .. }
        ) {
            set_migration_halt_source(APPLIED_DETECTION_HALT);
            return;
        }
        if !valid || crate::ExecutionGuard::validation_code_applied().is_err() {
            set_migration_halt_source(APPLIED_DETECTION_HALT);
        } else {
            MigrationFailedStep::kill();
            // A valid primary image may carry zero MBMs, in which case
            // `MigrationStatusHandler::completed()` never fires.
            clear_migration_halt_sources(
                MIGRATION_FAILURE_HALT
                    | MIGRATION_STALL_HALT
                    | APPLIED_DETECTION_HALT
                    | UPGRADE_ABORT_TRIGGER,
            );
        }
    }
    fn on_relay_state_proof(
        _: &cumulus_pallet_parachain_system::relay_state_snapshot::RelayChainStateProof,
    ) -> Weight {
        Weight::zero()
    }
}

/// A snapshot for the current/future epoch cannot legally be recorded while
/// the dead-man clock blocks that epoch's close. Suppress only that impossible
/// cause; an already-overdue earlier epoch remains an active incident.
fn snapshot_close_blocked_by_pause() -> bool {
    pallet_epoch::DeadMan::<Runtime>::get().paused_at.is_some()
        && pallet_welfare::SnapshotDeadline::<Runtime>::get().is_some_and(|progress| {
            progress.due_epoch >= pallet_epoch::EpochOf::<Runtime>::get().index
        })
}

impl pallet_execution_guard::Config for Runtime {
    type Epoch = RuntimeEpochHandoff;
    type EnqueueAuthority = EnsureEpochAccount;
    type Attestations = RuntimeAttestations;
    type KeeperRebate = FutarchyTreasury;
    type PendingOutflowSync = RuntimePendingOutflowSync;
    type Guardian = RuntimeGuardianState;
    type Params = ExecutionParams;
    type Capabilities = RuntimeCapabilities;
    type UpgradeSchedule = RuntimeUpgradeSchedule;
    type MigrationStatus = RuntimeMigrationStatus;
    type Preimages = RuntimePreimages;
    type RecoveryImages = RuntimePreimages;
    type ReleaseChannel = RuntimeReleaseChannel;
    type RatifyOrigin = EnsureValuesScoped<RatifyTrack>;
    type RecoveryCommitOrigin = frame_support::traits::EitherOfDiverse<
        pallet_origins::EnsureFutarchyCode,
        pallet_origins::EnsureFutarchyMeta,
    >;
    type PhaseFourBridgeOrigin = EnsureCurrentSudoKey;
    type PhaseState = RuntimePhaseState;
    type Dispatcher = crate::classifier::RuntimeDispatcher;
    type MaxRuntimeCodeBytes = ConstU32<{ pallet_preimage::MAX_SIZE }>;
    type WeightInfo = crate::weights::pallet_execution_guard::WeightInfo<Runtime>;
    #[cfg(feature = "runtime-benchmarks")]
    type BenchmarkHelper = RuntimeBenchmarkHelper;
}

#[cfg(feature = "runtime-benchmarks")]
pub struct RuntimeBenchmarkHelper;

#[cfg(feature = "runtime-benchmarks")]
const BENCHMARK_KEEPER_REBATE: Balance = currency::USDC;
#[cfg(feature = "runtime-benchmarks")]
const BENCHMARK_REBATE_LINE_BALANCE: Balance = 100 * currency::USDC;

#[cfg(feature = "runtime-benchmarks")]
pub(crate) fn prime_keeper_rebate_worst_case() {
    let key = pallet_constitution::key16(b"keeper.rebate");
    pallet_constitution::Params::<Runtime>::insert(
        key,
        pallet_constitution::ParamRecord {
            key,
            value: pallet_constitution::ParamValue::Balance(BENCHMARK_KEEPER_REBATE),
            min: pallet_constitution::ParamValue::Balance(1),
            max: pallet_constitution::ParamValue::Balance(Balance::MAX),
            max_delta: None,
            cooldown_epochs: 0,
            last_changed_epoch: 0,
            last_change_block: 0,
            class: pallet_constitution::ParamClass::Param,
            kernel_bounded: false,
        },
    );

    pallet_futarchy_treasury::State::<Runtime>::mutate(|state| {
        for line in [
            pallet_futarchy_treasury::BudgetLine::Keeper,
            pallet_futarchy_treasury::BudgetLine::Oracle,
            pallet_futarchy_treasury::BudgetLine::Rewards,
            pallet_futarchy_treasury::BudgetLine::OpsCollators,
        ] {
            if let Some((_, balance)) = state.lines.iter_mut().find(|(stored, _)| *stored == line) {
                *balance = BENCHMARK_REBATE_LINE_BALANCE;
            } else {
                let _ = state.lines.try_push((line, BENCHMARK_REBATE_LINE_BALANCE));
            }
        }
        state.keeper_meter = pallet_futarchy_treasury::KeeperMeter {
            epoch: pallet_epoch::CurrentEpoch::<Runtime>::get(),
            ..Default::default()
        };
    });

    benchmark_ensure_usdc();
    for pot in [
        treasury_keeper_account(),
        treasury_oracle_account(),
        treasury_rewards_account(),
        treasury_collators_account(),
    ] {
        let balance = <ForeignAssets as Inspect<AccountId>>::balance(usdc_location(), &pot);
        if balance < BENCHMARK_REBATE_LINE_BALANCE {
            let _ = <ForeignAssets as Mutate<AccountId>>::mint_into(
                usdc_location(),
                &pot,
                BENCHMARK_REBATE_LINE_BALANCE - balance,
            );
        }
    }
}

/// Epoch whose authored shares the collator-compensation benchmark pays out.
/// The sink only pays a *completed* epoch, so the fixture also has to place the
/// clock in a strictly later one.
#[cfg(feature = "runtime-benchmarks")]
const BENCHMARK_COLLATOR_COMP_EPOCH: EpochId = 0;

/// Seed the A13 payout at its worst case: the accumulator full to
/// `MaxCollatorCompensationEntries`, every entry a distinct payee, the tracked
/// epoch complete, and custody funded for the whole pool so no transfer fails.
///
/// All of it is treasury-pallet state, which is why this cannot live in
/// `pallets/epoch/src/benchmarking.rs` (I-24 keeps the two pallets apart) and is
/// reached through the `BenchmarkHelper` seam instead.
#[cfg(feature = "runtime-benchmarks")]
fn prime_collator_compensation_worst_case() {
    use frame_support::BoundedVec;

    benchmark_ensure_usdc();

    let entries = pallet_futarchy_treasury::MAX_COLLATOR_COMPENSATION_ENTRIES_BOUND;
    let registered = entries;

    // Place the clock in the epoch after the one being paid. `epoch_for_block`
    // reads `EpochOf`/`Schedule`, so both are set explicitly rather than left to
    // defaults that happen to compute a usable answer.
    let length = <RuntimeEpochParams as pallet_epoch::EpochParamsProvider>::get().epoch_length;
    let paid_epoch = BENCHMARK_COLLATOR_COMP_EPOCH;
    let clock_epoch = paid_epoch.saturating_add(1);
    pallet_epoch::EpochOf::<Runtime>::mutate(|epoch| epoch.index = clock_epoch);
    pallet_epoch::Schedule::<Runtime>::put(pallet_epoch::EpochSchedule {
        epoch_start_block: length,
        length,
        next_length: length,
    });
    System::set_block_number(length);

    // Distinct payees, each with a distinct share so the division runs per entry
    // rather than collapsing to one repeated quotient.
    let shares = (0..entries)
        .map(|index| (benchmark_collator_payee(index), index.saturating_add(1)))
        .collect::<Vec<_>>();
    // `truncate_from` rather than a fallible conversion: the length is exactly
    // the bound by construction, and this file may not use `expect`.
    pallet_futarchy_treasury::CollatorAuthoredBlocks::<Runtime>::put(BoundedVec::truncate_from(
        shares,
    ));
    pallet_futarchy_treasury::CollatorAuthoredEpoch::<Runtime>::put(paid_epoch);
    pallet_futarchy_treasury::CollatorAuthoredRegisteredCount::<Runtime>::put(registered);
    pallet_futarchy_treasury::CollatorAuthoredOverflowed::<Runtime>::put(false);
    // A pending accumulator would be paid *instead* of the authored one, and it
    // is empty here — that fixture would measure nothing.
    pallet_futarchy_treasury::CollatorPendingEpoch::<Runtime>::kill();

    // Fund from the live parameter: the pool is `collator.comp × registered`, and
    // an underfunded `OpsCollators` line makes `debitable_line` fail, which the
    // sink swallows — a silent no-op measurement.
    let pool = <TreasuryParams as pallet_futarchy_treasury::TreasuryParams>::collator_comp_epoch()
        .saturating_mul(Balance::from(registered));
    pallet_futarchy_treasury::State::<Runtime>::mutate(|state| {
        let line = pallet_futarchy_treasury::BudgetLine::OpsCollators;
        if let Some((_, balance)) = state.lines.iter_mut().find(|(stored, _)| *stored == line) {
            *balance = pool;
        } else {
            let _ = state.lines.try_push((line, pool));
        }
    });
    // Custody is funded to twice the pool, not to the pool exactly. Payouts move
    // through `Preservation::Preserve`, so a pot holding precisely the pool fails
    // its *last* transfer — the sum of the truncated per-share quotients leaves
    // under `min_balance` behind. That failure is swallowed by the sink, so the
    // benchmark would have measured a rolled-back no-op.
    let custody = pool.saturating_mul(2);
    let pot = treasury_collators_account();
    let balance = <ForeignAssets as Inspect<AccountId>>::balance(usdc_location(), &pot);
    if balance < custody {
        let _ = <ForeignAssets as Mutate<AccountId>>::mint_into(
            usdc_location(),
            &pot,
            custody.saturating_sub(balance),
        );
    }
}

/// Distinct payee per accumulator slot. `BenchmarkHelper::account` takes a `u8`
/// seed and the bound is 120, but deriving the account here keeps the payee set
/// disjoint from the seeds other fixtures use for callers and proposers.
#[cfg(feature = "runtime-benchmarks")]
fn benchmark_collator_payee(index: u32) -> AccountId {
    let mut raw = [0u8; 32];
    raw[0..4].copy_from_slice(&index.to_le_bytes());
    raw[4..8].copy_from_slice(b"coll");
    AccountId32::new(raw)
}

/// Assert the payout ran to completion: the accumulator retired, the paid-epoch
/// marker advanced, and the line debited by the full pool.
#[cfg(feature = "runtime-benchmarks")]
fn assert_collator_compensation_was_paid() {
    assert_eq!(
        pallet_futarchy_treasury::CollatorCompensationPaidEpoch::<Runtime>::get(),
        Some(BENCHMARK_COLLATOR_COMP_EPOCH),
        "benchmark must pay the seeded completed epoch, not return at a guard"
    );
    assert!(
        pallet_futarchy_treasury::CollatorAuthoredBlocks::<Runtime>::get().is_empty(),
        "a paid accumulator is retired in the same storage layer as the transfers"
    );
    assert!(
        pallet_futarchy_treasury::CollatorAuthoredEpoch::<Runtime>::get().is_none(),
        "a paid accumulator releases its epoch marker"
    );
    let paid = <ForeignAssets as Inspect<AccountId>>::balance(
        usdc_location(),
        &benchmark_collator_payee(
            pallet_futarchy_treasury::MAX_COLLATOR_COMPENSATION_ENTRIES_BOUND - 1,
        ),
    );
    assert!(
        paid > 0,
        "the largest-share payee must have actually received a transfer"
    );
}

#[cfg(feature = "runtime-benchmarks")]
fn assert_keeper_rebate_was_paid(class: CrankClass) {
    let state = pallet_futarchy_treasury::State::<Runtime>::get();
    let line = match class {
        CrankClass::OracleLine => pallet_futarchy_treasury::BudgetLine::Oracle,
        CrankClass::DecisionCritical | CrankClass::General => {
            pallet_futarchy_treasury::BudgetLine::Keeper
        }
    };
    let line_balance = state
        .lines
        .iter()
        .find_map(|(stored, balance)| (*stored == line).then_some(*balance));
    assert_eq!(
        line_balance,
        Some(BENCHMARK_REBATE_LINE_BALANCE - BENCHMARK_KEEPER_REBATE),
        "benchmark crank must debit the funded rebate line"
    );
    match class {
        CrankClass::OracleLine => {}
        CrankClass::DecisionCritical => {
            assert_eq!(state.keeper_meter.spent, BENCHMARK_KEEPER_REBATE);
            assert_eq!(state.keeper_meter.general_spent, 0);
        }
        CrankClass::General => {
            assert_eq!(state.keeper_meter.spent, BENCHMARK_KEEPER_REBATE);
            assert_eq!(state.keeper_meter.general_spent, BENCHMARK_KEEPER_REBATE);
        }
    }
}

#[cfg(feature = "runtime-benchmarks")]
macro_rules! benchmark_keeper_rebate_hooks {
    () => {
        fn prime_keeper_rebate() {
            prime_keeper_rebate_worst_case();
        }

        fn assert_keeper_rebate_paid(class: CrankClass) {
            assert_keeper_rebate_was_paid(class);
        }
    };
}

#[cfg(feature = "runtime-benchmarks")]
fn benchmark_ensure_usdc() {
    if !ForeignAssets::asset_exists(usdc_location()) {
        let _ = ForeignAssets::force_create(
            RuntimeOrigin::root(),
            usdc_location(),
            sp_runtime::MultiAddress::Id(AccountId32::new([0; 32])),
            true,
            currency::USDC_CENT,
        );
    }
}

#[cfg(feature = "runtime-benchmarks")]
fn benchmark_payload_bytes_for(seed: futarchy_primitives::ProposalId) -> Vec<u8> {
    let calls = (0..pallet_execution_guard::MAX_CALLS)
        .map(|index| {
            let mut remark = vec![index as u8; 4_000];
            if index == 0 {
                remark[..core::mem::size_of::<futarchy_primitives::ProposalId>()]
                    .copy_from_slice(&seed.to_le_bytes());
            }
            RuntimeCall::System(frame_system::Call::remark { remark })
        })
        .collect::<Vec<_>>();
    benchmark_pad_payload(calls)
}

#[cfg(feature = "runtime-benchmarks")]
fn benchmark_pad_payload(mut calls: Vec<RuntimeCall>) -> Vec<u8> {
    let target = pallet_execution_guard::MAX_PAYLOAD_BYTES as usize;
    loop {
        let bytes =
            pallet_execution_guard::RuntimeBatch::<Runtime>::truncate_from(calls.clone()).encode();
        if bytes.len() == target {
            return bytes;
        }
        let Some(RuntimeCall::System(frame_system::Call::remark { remark })) = calls.last_mut()
        else {
            return bytes;
        };
        if bytes.len() < target {
            remark.resize(remark.len().saturating_add(target - bytes.len()), 0xff);
        } else {
            remark.truncate(remark.len().saturating_sub(bytes.len() - target));
        }
    }
}

#[cfg(feature = "runtime-benchmarks")]
fn benchmark_ensure_payload_preimage(
    seed: futarchy_primitives::ProposalId,
) -> (futarchy_primitives::H256, u32) {
    let bytes = benchmark_payload_bytes_for(seed);
    let payload_len = u32::try_from(bytes.len()).unwrap_or_default();
    let hash = sp_io::hashing::blake2_256(&bytes);
    if <Preimage as QueryPreimage>::len(&hash.into()).is_none() {
        let _ = <Preimage as StorePreimage>::note(Cow::Owned(bytes));
    }
    (hash, payload_len)
}

#[cfg(feature = "runtime-benchmarks")]
fn benchmark_market_set(
    pid: futarchy_primitives::ProposalId,
    epoch: EpochId,
    gates: bool,
) -> futarchy_primitives::MarketSet {
    let first = pid.saturating_mul(10);
    futarchy_primitives::MarketSet {
        accept: first.saturating_add(1),
        reject: first.saturating_add(2),
        gates: gates.then_some([
            first.saturating_add(3),
            first.saturating_add(4),
            first.saturating_add(5),
            first.saturating_add(6),
        ]),
        baseline: 9_000u64.saturating_add(u64::from(epoch)),
    }
}

/// Create the real (unseeded) market books behind a `benchmark_market_set`.
///
/// B10 latches every ledger terminal into the market pallet
/// (`observe_proposal_terminal` / `observe_baseline_terminal` run inside the
/// production resolve/void/settle seams), and that latch walks
/// `ProposalMarketIds` and requires each book to exist with the owning kind.
/// Benchmark fixtures that only fabricate market *ids* therefore make every
/// terminal-crossing dispatch fail with `TryStateViolation`; back the ids with
/// bounded books through the production `create_market` entry point instead.
#[cfg(feature = "runtime-benchmarks")]
fn benchmark_ensure_market_books(
    pid: futarchy_primitives::ProposalId,
    epoch: EpochId,
    gates: bool,
) -> futarchy_primitives::MarketSet {
    use futarchy_primitives::{Branch, GateType};
    use pallet_market::core_market::BookKind;

    let set = benchmark_market_set(pid, epoch, gates);
    let decision_b = balance_param(b"pol.b.param");
    let gate_b = balance_param(b"pol.b_gate");
    let mut books = Vec::from([
        (
            set.accept,
            BookKind::Decision {
                proposal: pid,
                branch: Branch::Accept,
            },
            decision_b,
        ),
        (
            set.reject,
            BookKind::Decision {
                proposal: pid,
                branch: Branch::Reject,
            },
            decision_b,
        ),
    ]);
    if let Some(gate_ids) = set.gates {
        // 05 §5.1 order: (S,C) × (adopt,reject), as in the production adapter.
        books.extend([
            (
                gate_ids[0],
                BookKind::Gate {
                    proposal: pid,
                    branch: Branch::Accept,
                    gate: GateType::Survival,
                },
                gate_b,
            ),
            (
                gate_ids[1],
                BookKind::Gate {
                    proposal: pid,
                    branch: Branch::Reject,
                    gate: GateType::Survival,
                },
                gate_b,
            ),
            (
                gate_ids[2],
                BookKind::Gate {
                    proposal: pid,
                    branch: Branch::Accept,
                    gate: GateType::Security,
                },
                gate_b,
            ),
            (
                gate_ids[3],
                BookKind::Gate {
                    proposal: pid,
                    branch: Branch::Reject,
                    gate: GateType::Security,
                },
                gate_b,
            ),
        ]);
    }
    for (id, kind, b) in books {
        if !pallet_market::Markets::<Runtime>::contains_key(id) {
            let _ = pallet_market::Pallet::<Runtime>::create_market(
                epoch_signed_origin(),
                id,
                kind,
                epoch,
                market_book_account(id),
                market_fee_account(id),
                b,
            );
        }
    }
    set
}

#[cfg(feature = "runtime-benchmarks")]
fn benchmark_quote(market: futarchy_primitives::MarketId) -> FixedU64 {
    match market % 10 {
        1 => FixedU64(750_000_000),
        2 => FixedU64(250_000_000),
        3 | 5 => FixedU64(10_000_000),
        4 | 6 => FixedU64(50_000_000),
        _ => FixedU64(500_000_000),
    }
}

#[cfg(feature = "runtime-benchmarks")]
fn benchmark_runtime_version() -> futarchy_primitives::RuntimeVersionConstraint {
    let spec_name =
        match futarchy_primitives::BoundedVec::try_from(VERSION.spec_name.as_bytes().to_vec()) {
            Ok(value) => value,
            Err(_) => futarchy_primitives::BoundedVec::new(),
        };
    futarchy_primitives::RuntimeVersionConstraint {
        spec_name,
        spec_version: VERSION.spec_version,
    }
}

#[cfg(feature = "runtime-benchmarks")]
fn benchmark_fill_attestations(
    pid: futarchy_primitives::ProposalId,
    artifact_hash: futarchy_primitives::H256,
) {
    benchmark_fill_upgrade_attestations(pid, artifact_hash, None);
}

#[cfg(feature = "runtime-benchmarks")]
fn benchmark_fill_upgrade_attestations(
    pid: futarchy_primitives::ProposalId,
    primary_hash: futarchy_primitives::H256,
    recovery_hash: Option<futarchy_primitives::H256>,
) {
    let members = (0..pallet_attestor::MAX_ATTESTORS)
        .map(|index| pallet_attestor::AttestorInfo {
            account: [100u8.saturating_add(index as u8); 32],
            bond: pallet_attestor::ATTESTOR_BOND,
            false_count: 0,
            active: true,
        })
        .collect::<Vec<_>>();
    pallet_attestor::Members::<Runtime>::put(frame_support::BoundedVec::truncate_from(members));

    let attestations = (0..pallet_attestor::MAX_ATTESTATIONS)
        .map(|id| {
            let primary = id
                >= pallet_attestor::MAX_ATTESTATIONS
                    .saturating_sub(futarchy_primitives::kernel::ATT_QUORUM);
            let recovery = recovery_hash.is_some()
                && id
                    >= pallet_attestor::MAX_ATTESTATIONS
                        .saturating_sub(futarchy_primitives::kernel::ATT_QUORUM.saturating_mul(2))
                && !primary;
            let target = primary || recovery;
            pallet_attestor::Attestation {
                id,
                pid: if target {
                    pid
                } else {
                    100_000u64.saturating_add(u64::from(id))
                },
                artifact_hash: if primary {
                    primary_hash
                } else if recovery {
                    recovery_hash.unwrap_or_default()
                } else {
                    [id as u8; 32]
                },
                statement_hash: [id as u8; 32],
                attestor: [100u8.saturating_add((id % pallet_attestor::MAX_ATTESTORS) as u8); 32],
                submitted_at: 0,
                challenge_deadline: 0,
                challenge: None,
            }
        })
        .collect::<Vec<_>>();
    pallet_attestor::Attestations::<Runtime>::put(frame_support::BoundedVec::truncate_from(
        attestations,
    ));
    pallet_attestor::NextAttestationId::<Runtime>::put(pallet_attestor::MAX_ATTESTATIONS);
}

#[cfg(feature = "runtime-benchmarks")]
impl pallet_conditional_ledger::BenchmarkHelper for RuntimeBenchmarkHelper {
    benchmark_keeper_rebate_hooks!();
}

#[cfg(feature = "runtime-benchmarks")]
impl pallet_market::BenchmarkHelper<AccountId> for RuntimeBenchmarkHelper {
    benchmark_keeper_rebate_hooks!();

    fn external_funder() -> AccountId {
        AccountId32::new([244; 32])
    }

    fn prime_external_capacity() {
        let key = pallet_constitution::key16(b"svc.max_live");
        pallet_constitution::Params::<Runtime>::mutate(key, |maybe_record| {
            if let Some(record) = maybe_record {
                record.value = pallet_constitution::ParamValue::U32(bounds::MAX_CLIENTS);
            }
        });
    }

    fn prime_pol_custody(line: pallet_market::PolLine, amount: Balance) {
        let line = budget_line_of(line);
        pallet_futarchy_treasury::State::<Runtime>::mutate(|state| {
            match state.lines.iter_mut().find(|(stored, _)| *stored == line) {
                Some(entry) => entry.1 = entry.1.saturating_add(amount),
                None => {
                    let _ = state.lines.try_push((line, amount));
                }
            }
        });
    }
}

#[cfg(feature = "runtime-benchmarks")]
impl pallet_constitution::BenchmarkHelper<RuntimeOrigin> for RuntimeBenchmarkHelper {
    fn prime_coverage_screen() -> Option<(
        futarchy_primitives::ParamKey,
        pallet_constitution::ParamValue,
    )> {
        // Saturate `MetricSpecs` to its 13 §4 bound so the SQ-495 screen walks
        // the whole live set, then amend `orc.bond_bps` to a rate that still
        // covers the seeded `Δs_max`. The scan is real work on the measured
        // path; a `Δs_max` of 1 keeps the call succeeding so the benchmark
        // measures the full walk rather than an early refusal.
        for version in 1..=(pallet_welfare::MAX_METRIC_SPECS as u16) {
            let specs: Vec<_> = (0..pallet_welfare::MAX_COMPONENTS_PER_SPEC as u16)
                .map(|component| pallet_welfare::MetricSpec {
                    id: component,
                    version,
                    pillar: pallet_welfare::Pillar::A,
                    weight: FixedU64(0),
                    epsilon_floor: pallet_welfare::EPSILON_PILLAR,
                    activation_epoch: u32::MAX,
                    source: pallet_welfare::SourceClass::Attested,
                    formula_ref: [1; 32],
                    units: [2; 16],
                    repr: [3; 16],
                    cadence_blocks: 1,
                    sanity_min: FixedU64(0),
                    sanity_max: FixedU64(1_000_000_000),
                    has_normalization_rule: true,
                    has_missing_data_rule: true,
                    has_gaming_vectors: true,
                    has_challenge_procedure: true,
                    prior_bounds: [FixedU64(1_000_000_000); pallet_welfare::HISTORY_PRIORS],
                    target: 100,
                    delta_s_max_bps: 1,
                })
                .collect();
            pallet_welfare::MetricSpecs::<Runtime>::insert(
                version,
                pallet_welfare::BoundedSpecSet::truncate_from(specs),
            );
        }
        Some((
            pallet_constitution::key16(b"orc.bond_bps"),
            pallet_constitution::ParamValue::Perbill(25_000_000),
        ))
    }
    fn origin(authority: pallet_constitution::ConstitutionOrigin) -> RuntimeOrigin {
        match authority {
            pallet_constitution::ConstitutionOrigin::FutarchyParam => {
                pallet_origins::Origin::FutarchyParam.into()
            }
            pallet_constitution::ConstitutionOrigin::FutarchyTreasury => {
                pallet_origins::Origin::FutarchyTreasury.into()
            }
            pallet_constitution::ConstitutionOrigin::FutarchyCode => {
                pallet_origins::Origin::FutarchyCode.into()
            }
            pallet_constitution::ConstitutionOrigin::FutarchyMeta => {
                pallet_origins::Origin::FutarchyMeta.into()
            }
            pallet_constitution::ConstitutionOrigin::ConstitutionTrack => {
                crate::track_origins::Origin::Constitution.into()
            }
            pallet_constitution::ConstitutionOrigin::EntrenchedTrack => {
                crate::track_origins::Origin::Entrenched.into()
            }
            pallet_constitution::ConstitutionOrigin::ConstitutionalValues => {
                pallet_origins::Origin::ConstitutionalValues.into()
            }
            pallet_constitution::ConstitutionOrigin::GuardianHold => {
                pallet_origins::Origin::GuardianHold.into()
            }
            pallet_constitution::ConstitutionOrigin::EmergencyPlaybook => {
                pallet_origins::Origin::EmergencyPlaybook.into()
            }
            pallet_constitution::ConstitutionOrigin::Root => RuntimeOrigin::root(),
            pallet_constitution::ConstitutionOrigin::Signed => {
                RuntimeOrigin::signed(AccountId32::new([240; 32]))
            }
        }
    }

    fn prime_phase_arming() -> DispatchResult {
        benchmark_ensure_usdc();
        let amount =
            FutarchyTreasury::floor(futarchy_primitives::ProposalClass::Meta).saturating_mul(4);
        <ForeignAssets as Mutate<AccountId>>::mint_into(
            usdc_location(),
            &insurance_account(),
            amount,
        )?;
        FutarchyTreasury::sweep_insurance(pallet_origins::Origin::FutarchyTreasury.into(), amount)
    }
}
#[cfg(feature = "runtime-benchmarks")]
impl pallet_welfare::BenchmarkHelper<RuntimeOrigin> for RuntimeBenchmarkHelper {
    benchmark_keeper_rebate_hooks!();

    fn metric_governance_origin() -> RuntimeOrigin {
        pallet_origins::Origin::ConstitutionalValues.into()
    }
    fn prime_finalized_epoch(epoch: EpochId) {
        pallet_epoch::EpochOf::<Runtime>::mutate(|info| info.index = epoch.saturating_add(1));
        // 05 §4.7's day guard resolves the *finalized* epoch's timing from the
        // retained ring (SQ-181), so the fixture fills the ring to its bound and
        // puts the cranked epoch **last** — the position `epoch_timing`'s linear
        // search reaches only after scanning every other entry. A benchmark
        // whose guard read a shorter ring would undercharge the search, and one
        // whose epoch had no timing at all would abort on `DayOutsideEpoch`
        // before measuring anything.
        let length = <RuntimeEpochParams as pallet_epoch::EpochParamsProvider>::get().epoch_length;
        let mut timings = Vec::new();
        for slot in 0..pallet_epoch::RECENT_COHORTS_BOUND.saturating_sub(1) {
            timings.push(pallet_epoch::EpochTiming {
                // Deliberately disjoint from `epoch` so the search cannot end
                // early on a filler entry.
                index: u32::MAX.saturating_sub(slot),
                start: 0,
                length,
            });
        }
        timings.push(pallet_epoch::EpochTiming {
            index: epoch,
            start: epoch.saturating_mul(length),
            length,
        });
        pallet_epoch::EpochTimings::<Runtime>::put(frame_support::BoundedVec::truncate_from(
            timings,
        ));
    }
    fn prime_metric_inputs(_: u16) {}
    fn prime_frozen_cohorts(epoch: EpochId, version: futarchy_primitives::MetricSpecVersion) {
        // `frozen_spec_versions` iterates `CohortSchedules` and, for every
        // schedule consuming `epoch`, reads `MetricSpecs` per bound version.
        // I-21 caps non-terminal cohorts at `MAX_NON_TERMINAL_COHORTS`, so the
        // fixture presents that many, each binding the measured version at its
        // 12-proposal `SpecBindings` bound — the largest scan the admissible
        // set can cost.
        let bound = pallet_epoch::MAX_NON_TERMINAL_COHORTS_BOUND;
        for slot in 0..bound {
            let cohort = epoch.saturating_sub(slot).saturating_sub(1);
            let specs = (0..pallet_epoch::MAX_COHORT_PROPOSALS_BOUND)
                .map(|index| (u64::from(index), version))
                .collect::<Vec<_>>();
            pallet_epoch::CohortSchedules::<Runtime>::insert(
                cohort,
                pallet_epoch::CohortSchedule {
                    epoch: cohort,
                    creation_epoch_length: 1,
                    measurement_until: epoch.saturating_add(1),
                    settlement_epoch: epoch.saturating_add(2),
                    specs: frame_support::BoundedVec::truncate_from(specs),
                },
            );
        }
    }
    fn seat_oracle() {
        // Real oracle storage, so the admission gate's reads are measured rather
        // than assumed: `Reporters`/`Watchtowers` are counted maps, and the
        // counts plus two `Constitution::Params` reads are what `register_spec`
        // pays on every call.
        let params = pallet_oracle::OracleParams::DEFAULT;
        for index in 0..u32::from(futarchy_primitives::kernel::ORC_REPORTERS_MIN) {
            pallet_oracle::Reporters::<Runtime>::insert(
                AccountId32::new([200u8.saturating_add(index as u8); 32]),
                pallet_oracle::ReporterInfo {
                    stake: params.reporter_stake,
                    registered_at: 0,
                    offenses: 0,
                },
            );
        }
        for index in 0..u32::from(params.watchtower_quorum) {
            pallet_oracle::Watchtowers::<Runtime>::insert(
                AccountId32::new([220u8.saturating_add(index as u8); 32]),
                pallet_oracle::WatchtowerInfo {
                    stake: params.watchtower_stake,
                    registered_at: 0,
                    inactive_epochs: 0,
                },
            );
        }
    }
}

#[cfg(feature = "runtime-benchmarks")]
fn benchmark_prime_cohort_exposure(epoch: EpochId, version: u16) {
    let _ = pallet_epoch::CohortSchedules::<Runtime>::clear(u32::MAX, None);
    let _ = pallet_conditional_ledger::Vaults::<Runtime>::clear(u32::MAX, None);

    let cohort_count = bounds::MAX_NON_TERMINAL_COHORTS;
    let proposals_per_cohort =
        u32::from(<RuntimeEpochParams as pallet_epoch::EpochParamsProvider>::get().epoch_slots);
    let escrow_per_vault = currency::USDC.saturating_mul(25_000);

    for cohort_index in 0..cohort_count {
        let specs = (0..proposals_per_cohort)
            .map(|proposal_index| {
                let pid = 9_000_000_u64
                    .saturating_add(u64::from(cohort_index).saturating_mul(100))
                    .saturating_add(u64::from(proposal_index));
                let mut vault = pallet_conditional_ledger::core_ledger::VaultInfo::open(version);
                vault.escrowed = escrow_per_vault;
                pallet_conditional_ledger::Vaults::<Runtime>::insert(pid, vault);
                (pid, version)
            })
            .collect::<Vec<_>>();
        pallet_epoch::CohortSchedules::<Runtime>::insert(
            cohort_index,
            pallet_epoch::CohortSchedule {
                epoch: epoch.saturating_sub(1),
                creation_epoch_length:
                    <RuntimeEpochParams as pallet_epoch::EpochParamsProvider>::get().epoch_length,
                measurement_until: epoch,
                settlement_epoch: epoch.saturating_add(1),
                specs: frame_support::BoundedVec::truncate_from(specs),
            },
        );
    }
}

#[cfg(feature = "runtime-benchmarks")]
impl pallet_oracle::BenchmarkHelper<RuntimeOrigin> for RuntimeBenchmarkHelper {
    benchmark_keeper_rebate_hooks!();

    fn adjudication_origin() -> RuntimeOrigin {
        pallet_origins::Origin::OracleResolution.into()
    }
    fn prime_reserve_probe() {
        ParachainSystem::open_outbound_hrmp_channel_for_benchmarks_or_tests(
            cumulus_primitives_core::ParaId::from(chain_identity::ASSET_HUB_PARA_ID),
        );
        let Some(envelope) = live_reserve_probe_envelope() else {
            return;
        };
        pallet_futarchy_treasury::State::<Runtime>::mutate(|state| {
            state.main_usdc = state.main_usdc.saturating_add(envelope.runway);
        });
        let _ = crate::FutarchyTreasury::fund_budget_line(
            pallet_origins::Origin::FutarchyTreasury.into(),
            pallet_futarchy_treasury::BudgetLine::OpsReserveProbe,
            envelope.runway,
        );
    }
    fn prime_reporting(component: u16, epoch: EpochId, version: u16) {
        pallet_epoch::EpochOf::<Runtime>::mutate(|info| info.index = epoch);
        pallet_epoch::Schedule::<Runtime>::mutate(|schedule| {
            schedule.epoch_start_block = 0;
            schedule.length =
                <RuntimeEpochParams as pallet_epoch::EpochParamsProvider>::get().epoch_length;
            schedule.next_length = schedule.length;
        });
        let spec = pallet_welfare::MetricSpec {
            id: component,
            version,
            pillar: pallet_welfare::Pillar::A,
            weight: FixedU64(1_000_000_000),
            epsilon_floor: FixedU64(1),
            activation_epoch: epoch,
            source: pallet_welfare::SourceClass::Attested,
            formula_ref: [1; 32],
            units: [2; 16],
            repr: [3; 16],
            cadence_blocks: 1,
            sanity_min: FixedU64(0),
            sanity_max: FixedU64(1_000_000_000),
            has_normalization_rule: true,
            has_missing_data_rule: true,
            has_gaming_vectors: true,
            has_challenge_procedure: true,
            prior_bounds: [FixedU64(1_000_000_000); pallet_welfare::HISTORY_PRIORS],
            target: 100,
            delta_s_max_bps: 1_000,
        };
        pallet_welfare::MetricSpecs::<Runtime>::insert(
            version,
            frame_support::BoundedVec::truncate_from(Vec::from([spec])),
        );
        benchmark_prime_cohort_exposure(epoch, version);
    }
    fn prime_custody(seed: u8, amount: Balance) {
        benchmark_ensure_usdc();
        let who = AccountId32::new([seed; 32]);
        let _ = <ForeignAssets as Mutate<AccountId>>::mint_into(usdc_location(), &who, amount);
    }
}
#[cfg(feature = "runtime-benchmarks")]
impl pallet_registry::BenchmarkHelper<RuntimeOrigin, AccountId> for RuntimeBenchmarkHelper {
    benchmark_keeper_rebate_hooks!();

    fn resolution_origin() -> RuntimeOrigin {
        pallet_origins::Origin::OracleResolution.into()
    }
    fn funded_account(seed: u8) -> AccountId {
        let who = AccountId32::new([seed; 32]);
        benchmark_ensure_usdc();
        // The registry's worst case posts ~68 filing bonds from ONE account (64
        // filings in the measured epoch, one per auxiliary live epoch, plus a
        // challenge bond). Since SQ-296 each of those is value-scaled rather than
        // the 5,000 USDC floor, and 1,000,000 USDC stopped covering them: the
        // `Benchmark smoke` job went red on `resolve_challenge` with
        // `Token(FundsUnavailable)` raised from the fixture's own setup. The
        // fixture must fund the worst case it claims to measure, so this is
        // headroom rather than a tuned figure. Minting to a filer account cannot
        // feed back into the measurement: exposure is a fold over cohort vault
        // escrow, never over account balances.
        let _ = <ForeignAssets as Mutate<AccountId>>::mint_into(
            usdc_location(),
            &who,
            currency::USDC.saturating_mul(1_000_000_000),
        );
        who
    }
    fn register_watchtower(who: &AccountId) {
        let _ = pallet_oracle::Pallet::<Runtime>::register_watchtower(RuntimeOrigin::signed(
            who.clone(),
        ));
    }
    fn prime_epoch(epoch: EpochId) {
        <RuntimeBenchmarkHelper as pallet_oracle::BenchmarkHelper<RuntimeOrigin>>::prime_reporting(
            1, epoch, 1,
        );
    }
}
#[cfg(feature = "runtime-benchmarks")]
impl pallet_futarchy_treasury::BenchmarkHelper<RuntimeOrigin, AccountId>
    for RuntimeBenchmarkHelper
{
    benchmark_keeper_rebate_hooks!();

    fn treasury_origin() -> RuntimeOrigin {
        pallet_origins::Origin::FutarchyTreasury.into()
    }
    fn community_origin() -> RuntimeOrigin {
        pallet_origins::Origin::FutarchyParam.into()
    }
    fn account(seed: u8) -> AccountId {
        AccountId32::new([seed; 32])
    }
    fn prime_pot_funding(amount: Balance) -> DispatchResult {
        let main = TreasuryPalletId::get().into_account_truncating();
        <ForeignAssets as Mutate<AccountId>>::mint_into(usdc_location(), &main, amount).map(|_| ())
    }
    fn prime_insurance_custody(amount: Balance) -> DispatchResult {
        <ForeignAssets as Mutate<AccountId>>::mint_into(
            usdc_location(),
            &insurance_account(),
            amount,
        )
        .map(|_| ())
    }
}
#[cfg(feature = "runtime-benchmarks")]
impl pallet_guardian::BenchmarkHelper<RuntimeOrigin> for RuntimeBenchmarkHelper {
    fn signed(who: [u8; 32]) -> RuntimeOrigin {
        RuntimeOrigin::signed(AccountId32::new(who))
    }
    fn values() -> RuntimeOrigin {
        pallet_origins::Origin::ConstitutionalValues.into()
    }
    fn admin() -> RuntimeOrigin {
        crate::track_origins::Origin::GuardianTrack.into()
    }
    fn prime_for_worst_case() {
        if pallet_execution_guard::CurrentSpecName::<Runtime>::get().is_none() {
            pallet_execution_guard::CurrentSpecName::<Runtime>::put(benchmark_runtime_version());
        }
        let call = RuntimeCall::System(frame_system::Call::remark {
            remark: b"guardian-benchmark-queue".to_vec(),
        });
        let _ = benchmark_guard_enqueue(1, call, pallet_execution_guard::CallDomain::Public);
        let epoch = pallet_epoch::CurrentEpoch::<Runtime>::get();
        pallet_welfare::GateBreachFlags::<Runtime>::insert(
            epoch,
            pallet_welfare::CoreGateBreachFlags {
                s_breached: true,
                c_breached: false,
                day_bitmap: [0; 2],
            },
        );
        for seed in 1..=pallet_guardian::GUARDIAN_SEATS as u8 {
            let who = AccountId32::new([seed; 32]);
            let _ = <Balances as frame_support::traits::fungible::Mutate<AccountId>>::mint_into(
                &who,
                SubmissionDeposit::get().saturating_mul(2),
            );
        }
    }

    fn prime_review_approved(action: pallet_guardian::ActionId) {
        let Some(referendum) = pallet_guardian::ReviewReferenda::<Runtime>::get(action) else {
            return;
        };
        pallet_referenda::ReferendumInfoFor::<Runtime>::mutate(referendum, |maybe_info| {
            let Some(pallet_referenda::ReferendumInfo::Ongoing(status)) = maybe_info.as_ref()
            else {
                return;
            };
            let submission_deposit = status.submission_deposit.clone();
            let decision_deposit = status.decision_deposit.clone();
            *maybe_info = Some(pallet_referenda::ReferendumInfo::Approved(
                System::block_number(),
                Some(submission_deposit),
                decision_deposit,
            ));
        });
    }
    fn prime_maintenance_epoch(epoch: EpochId) {
        pallet_epoch::EpochOf::<Runtime>::mutate(|info| info.index = epoch);
    }
    fn close_review(referendum: u32) -> Result<(), DispatchError> {
        Referenda::cancel(
            pallet_origins::Origin::ConstitutionalValues.into(),
            referendum,
        )
    }
}
#[cfg(feature = "runtime-benchmarks")]
impl pallet_attestor::BenchmarkHelper<RuntimeOrigin> for RuntimeBenchmarkHelper {
    fn prime_funds() {
        let reason: RuntimeHoldReason = pallet_attestor::HoldReason::AttestorBond.into();
        let challenge_reason: RuntimeHoldReason = pallet_attestor::HoldReason::ChallengeBond.into();
        let _ = Balances::force_set_balance(
            RuntimeOrigin::root(),
            sp_runtime::MultiAddress::Id(insurance_account()),
            1_000_000 * currency::VIT,
        );
        for seed in 1..=255u8 {
            let who = AccountId32::new([seed; 32]);
            let _ = Balances::force_set_balance(
                RuntimeOrigin::root(),
                sp_runtime::MultiAddress::Id(who.clone()),
                1_000_000 * currency::VIT,
            );
            if seed <= pallet_attestor::MAX_ATTESTORS as u8 {
                let _ = <Balances as MutateHold<AccountId>>::hold(
                    &reason,
                    &who,
                    pallet_attestor::ATTESTOR_BOND,
                );
            }
            if seed == 250 {
                let _ = <Balances as MutateHold<AccountId>>::hold(
                    &challenge_reason,
                    &who,
                    pallet_attestor::CHALLENGE_BOND,
                );
            }
        }
    }
    fn signed(who: [u8; 32]) -> RuntimeOrigin {
        RuntimeOrigin::signed(AccountId32::new(who))
    }
    fn values() -> RuntimeOrigin {
        pallet_origins::Origin::ConstitutionalValues.into()
    }
    fn ratify() -> RuntimeOrigin {
        pallet_origins::Origin::ConstitutionalValues.into()
    }
    fn prime_terminal_proposal(pid: futarchy_primitives::ProposalId) {
        // `is_terminal` resolves against real `pallet-epoch` storage, so an
        // unseeded chain fails `reap_attestation` at its precondition and the
        // benchmark measures nothing (SQ-489/SQ-490). Seed the proposal the
        // reaped attestation names, in a terminal state.
        let proposal = benchmark_epoch_proposal(
            pid,
            futarchy_primitives::H256::from([7u8; 32]),
            0,
            futarchy_primitives::ProposalState::Settled,
        );
        pallet_epoch::Proposals::<Runtime>::insert(pid, proposal);
    }
    fn prime_live_proposal(pid: futarchy_primitives::ProposalId) {
        // `attest` now refuses a `pid` `pallet-epoch` does not carry, so the
        // benchmark must attest against a real proposal or it measures the
        // refusal instead of the work. `Queued` is the live state a CODE
        // artifact is attested in, and is not in `is_terminal`'s accepted set.
        let proposal = benchmark_epoch_proposal(
            pid,
            futarchy_primitives::H256::from([7u8; 32]),
            0,
            futarchy_primitives::ProposalState::Queued,
        );
        pallet_epoch::Proposals::<Runtime>::insert(pid, proposal);
    }
}

#[cfg(feature = "runtime-benchmarks")]
impl pallet_client_registry::BenchmarkHelper<RuntimeOrigin, AccountId> for RuntimeBenchmarkHelper {
    fn values() -> RuntimeOrigin {
        crate::track_origins::Origin::GuardianTrack.into()
    }

    fn client(client: futarchy_primitives::ClientId) -> RuntimeOrigin {
        pallet_client_registry::Origin::ExternalClient(client).into()
    }

    fn bond_owner() -> AccountId {
        AccountId32::new([247; 32])
    }

    fn prime_client_bond(value: Balance) {
        let key = pallet_constitution::key16(b"svc.client_bond");
        pallet_constitution::Params::<Runtime>::insert(
            key,
            pallet_constitution::ParamRecord {
                key,
                value: pallet_constitution::ParamValue::Balance(value),
                min: pallet_constitution::ParamValue::Balance(1),
                max: pallet_constitution::ParamValue::Balance(Balance::MAX),
                max_delta: None,
                cooldown_epochs: 0,
                last_changed_epoch: 0,
                last_change_block: 0,
                class: pallet_constitution::ParamClass::Param,
                kernel_bounded: false,
            },
        );
    }

    fn prime_funds(who: &AccountId, value: Balance) {
        let _ = Balances::force_set_balance(
            RuntimeOrigin::root(),
            sp_runtime::MultiAddress::Id(who.clone()),
            value,
        );
    }

    fn prime_delivery_funds(who: &AccountId, value: Balance) {
        let minted = <ForeignAssets as Mutate<AccountId>>::mint_into(usdc_location(), who, value);
        assert!(minted.is_ok());
    }
}

#[cfg(feature = "runtime-benchmarks")]
impl pallet_question_service::BenchmarkHelper<RuntimeOrigin, AccountId> for RuntimeBenchmarkHelper {
    benchmark_keeper_rebate_hooks!();

    fn client_origin(client: futarchy_primitives::ClientId) -> RuntimeOrigin {
        // Measure the heavier admitted branch. `prime_client` installs this
        // exact signer in `ClientIdOfSigner`, so register/open/seal include the
        // registry lookup that a local hosted client pays; the custom XCM
        // origin is storage-free and therefore already covered by this weight.
        let mut bytes = [246_u8; 32];
        bytes[..4].copy_from_slice(&client.to_le_bytes());
        RuntimeOrigin::signed(AccountId32::new(bytes))
    }

    fn report_egress_origin(client: futarchy_primitives::ClientId) -> RuntimeOrigin {
        pallet_client_registry::Origin::ExternalClient(client).into()
    }

    fn funder(client: futarchy_primitives::ClientId) -> AccountId {
        let mut bytes = [246_u8; 32];
        bytes[..4].copy_from_slice(&client.to_le_bytes());
        AccountId32::new(bytes)
    }

    fn attestor(index: u32) -> AccountId {
        let mut bytes = [245_u8; 32];
        bytes[..4].copy_from_slice(&index.to_le_bytes());
        AccountId32::new(bytes)
    }

    fn prime_params() {
        for record in pallet_constitution::genesis_params() {
            pallet_constitution::Params::<Runtime>::insert(record.key, record);
        }
        let key = pallet_constitution::key16(b"svc.fee_bps");
        pallet_constitution::Params::<Runtime>::insert(
            key,
            pallet_constitution::ParamRecord {
                key,
                value: pallet_constitution::ParamValue::Perbill(10_000_000),
                min: pallet_constitution::ParamValue::Perbill(0),
                max: pallet_constitution::ParamValue::Perbill(100_000_000),
                max_delta: None,
                cooldown_epochs: 0,
                last_changed_epoch: 0,
                last_change_block: 0,
                class: pallet_constitution::ParamClass::Param,
                kernel_bounded: false,
            },
        );
        // `svc.price_cap` ships `[VERIFY]`-unset, and its consumers SHORT-CIRCUIT
        // when it is absent: `starvation_multiplier` returns before it ever
        // calls the 16 §8.7 probe. Benchmarking the unset state would therefore
        // measure the inert path and declare a `register` weight that omits the
        // probe's scan over every live decision pair — an under-declaration that
        // arrives the day the row is adopted, with no code change to notice it.
        // Seed it, so the measured worst case is the armed one. Same reason
        // `svc.fee_bps` is seeded above.
        let key = pallet_constitution::key16(b"svc.price_cap");
        pallet_constitution::Params::<Runtime>::insert(
            key,
            pallet_constitution::ParamRecord {
                key,
                value: pallet_constitution::ParamValue::Fixed(futarchy_primitives::FixedU64(
                    kernel::SCORE_SCALE.saturating_mul(4),
                )),
                min: pallet_constitution::ParamValue::Fixed(futarchy_primitives::FixedU64(
                    kernel::SCORE_SCALE,
                )),
                max: pallet_constitution::ParamValue::Fixed(futarchy_primitives::FixedU64(
                    kernel::SCORE_SCALE.saturating_mul(64),
                )),
                max_delta: None,
                cooldown_epochs: 0,
                last_changed_epoch: 0,
                last_change_block: 0,
                class: pallet_constitution::ParamClass::Param,
                kernel_bounded: false,
            },
        );
    }

    fn prime_client(client: futarchy_primitives::ClientId, funder: &AccountId) {
        pallet_client_registry::Clients::<Runtime>::insert(
            client,
            pallet_client_registry::ClientRecord::new_local(funder.clone(), 1, 0),
        );
        pallet_client_registry::ClientIdOfSigner::<Runtime>::insert(funder, client);
        pallet_client_registry::ClientPolicies::<Runtime>::insert(
            client,
            pallet_client_registry::SubIdPolicy::Optional,
        );
        pallet_client_registry::BondOwners::<Runtime>::insert(client, funder);
        pallet_client_registry::ClientCount::<Runtime>::put(1);
        pallet_client_registry::NextClientId::<Runtime>::put(client.saturating_add(1));
    }

    fn prime_usdc(who: &AccountId, amount: Balance) {
        let minted = <ForeignAssets as Mutate<AccountId>>::mint_into(usdc_location(), who, amount);
        assert!(minted.is_ok());
    }

    fn prime_report_egress(client: futarchy_primitives::ClientId) {
        let para = 4_200u32.saturating_add(client);
        let location =
            staging_xcm::latest::Location::new(1, [staging_xcm::latest::Junction::Parachain(para)]);
        let prior_signer = pallet_client_registry::Clients::<Runtime>::get(client)
            .and_then(|record| record.local_signer);
        pallet_client_registry::Clients::<Runtime>::mutate(client, |maybe_record| {
            if let Some(record) = maybe_record {
                record.location = Some(location.clone());
                record.local_signer = None;
                record.delivery_float = currency::USDC.saturating_mul(1_000_000);
            }
        });
        if let Some(signer) = prior_signer {
            pallet_client_registry::ClientIdOfSigner::<Runtime>::remove(signer);
        }
        pallet_client_registry::ClientIdOf::<Runtime>::insert(&location, client);
        let custody = pallet_client_registry::Pallet::<Runtime>::delivery_account(client);
        let minted = <ForeignAssets as Mutate<AccountId>>::mint_into(
            usdc_location(),
            &custody,
            currency::USDC.saturating_mul(1_000_000),
        );
        assert!(minted.is_ok());
        ParachainSystem::open_outbound_hrmp_channel_for_benchmarks_or_tests(
            cumulus_primitives_core::ParaId::from(para),
        );
    }

    fn prime_register_scan(funder: &AccountId) {
        for pid in 1..=bounds::MAX_LIVE_PROPOSALS {
            let mut proposal = benchmark_epoch_proposal(
                u64::from(pid),
                futarchy_primitives::H256::from([233; 32]),
                0,
                futarchy_primitives::ProposalState::Settled,
            );
            proposal.decide_at = BlockNumber::MAX;
            // DISTINCT decision books per proposal, and a full window vector on
            // each. `benchmark_epoch_proposal` points every proposal at markets
            // 1 and 2, so the 16 §8.7 starvation probe would read two keys the
            // overlay caches and the measured weight would understate the real
            // scan by a factor of `MAX_LIVE_PROPOSALS`. `decide_at` stays
            // `BlockNumber::MAX` so `collides` still cannot refuse the
            // registration under benchmark; the seeded windows carry the same
            // `end` so the probe's `find` hits rather than reading an empty vec.
            //
            // The matching record must also be **live** (`sealed: false`, and
            // `start <= now < end`), because the probe short-circuits on a
            // frozen window. Seeding it sealed would benchmark the branch that
            // does no arithmetic while the real call does all of it — SQ-576's
            // defect exactly, reached through the fixture instead of through an
            // unset parameter. The two are the same mistake: a benchmark whose
            // fixture makes the expensive path unreachable.
            let accept = u64::from(pid).saturating_mul(2).saturating_add(600_000);
            let reject = accept.saturating_add(1);
            if let Some(markets) = proposal.markets.as_mut() {
                markets.accept = accept;
                markets.reject = reject;
            }
            for market in [accept, reject] {
                pallet_market::DecisionWindows::<Runtime>::insert(
                    market,
                    frame_support::BoundedVec::truncate_from(
                        (0..8)
                            .map(|slot: u32| pallet_market::core_market::TwapWindow {
                                start: 0,
                                trailing_start: 0,
                                // The matching record last, so the scan walks
                                // the whole bounded vector before it hits.
                                end: if slot == 7 {
                                    BlockNumber::MAX
                                } else {
                                    slot.saturating_add(1)
                                },
                                observations: u32::MAX,
                                stale_events: u8::MAX,
                                contest_capital_blocks: u128::MAX,
                                contest_accrued_until: BlockNumber::MAX,
                                contest_valid: true,
                                close_spot: Some(futarchy_primitives::FixedU64(u64::MAX)),
                                sealed: false,
                            })
                            .collect::<Vec<_>>(),
                    ),
                );
            }
            pallet_epoch::Proposals::<Runtime>::insert(u64::from(pid), proposal);
        }
        for index in 0..bounds::MAX_EXTERNAL_BOOK_PAIRS.saturating_sub(1) {
            let question = kernel::SERVICE_ID_BASE
                .saturating_add(1_000)
                .saturating_add(u64::from(index).saturating_mul(3));
            pallet_market::ExternalBookPairs::<Runtime>::insert(
                question,
                pallet_market::ExternalBookPair {
                    client: 0,
                    funder: funder.clone(),
                    accept: question.saturating_add(1),
                    reject: question.saturating_add(2),
                },
            );
        }
    }

    fn advance_to(block: BlockNumber) {
        System::set_block_number(block);
    }
}

/// Stale `ComponentValues` entries seeded for the boundary crank's 07 §13
/// reaping sweep. Strictly above `COMPONENT_VALUE_REAP_BATCH` so the batch cap
/// binds, and well below `MAX_COMPONENT_VALUES` so the deadline drives in the
/// same call still have room to write their own neutral entries (SQ-492).
#[cfg(feature = "runtime-benchmarks")]
const STALE_COMPONENT_VALUE_SEEDS: u16 = pallet_oracle::MAX_COMPONENT_VALUES as u16;

#[cfg(feature = "runtime-benchmarks")]
impl pallet_epoch::BenchmarkHelper<RuntimeOrigin, AccountId> for RuntimeBenchmarkHelper {
    benchmark_keeper_rebate_hooks!();

    fn prime_submit_epoch(epoch: EpochId) {
        System::set_block_number(1);
        let now = System::block_number();
        let params = <RuntimeEpochParams as pallet_epoch::EpochParamsProvider>::get();
        pallet_epoch::EpochOf::<Runtime>::put(pallet_epoch::EpochInfo {
            index: epoch,
            phase: futarchy_primitives::EpochPhase::Intake,
            phase_start_block: now,
        });
        pallet_epoch::Schedule::<Runtime>::put(pallet_epoch::EpochSchedule {
            epoch_start_block: now,
            length: params.epoch_length,
            next_length: params.epoch_length,
        });
        pallet_epoch::NextProposalId::<Runtime>::put(1);
        pallet_execution_guard::CurrentSpecName::<Runtime>::put(benchmark_runtime_version());
        benchmark_ensure_usdc();
    }

    fn constitutional_values_origin() -> RuntimeOrigin {
        pallet_origins::Origin::ConstitutionalValues.into()
    }

    fn guardian_origin() -> RuntimeOrigin {
        pallet_origins::Origin::GuardianHold.into()
    }

    fn execution_guard_origin() -> RuntimeOrigin {
        RuntimeOrigin::signed(execution_guard_account())
    }

    fn prime_ratification(pid: futarchy_primitives::ProposalId, referendum_index: u32) {
        let guardian = guardian_account();
        let _ = Balances::force_set_balance(
            RuntimeOrigin::root(),
            sp_runtime::MultiAddress::Id(guardian.clone()),
            20_000 * currency::VIT,
        );
        pallet_referenda::ReferendumCount::<Runtime>::put(referendum_index);
        let call = RuntimeCall::ExecutionGuard(pallet_execution_guard::Call::ratify {
            pid,
            referendum_index,
        });
        let Ok(proposal) = <Preimage as StorePreimage>::bound(call) else {
            return;
        };
        let ratify_origin: RuntimeOrigin = crate::track_origins::Origin::Ratify.into();
        let submit_result = Referenda::submit(
            RuntimeOrigin::signed(guardian.clone()),
            Box::new(ratify_origin.caller().clone()),
            proposal,
            frame_support::traits::schedule::DispatchTime::After(0),
        );
        if submit_result.is_err() {
            return;
        }
        let _ =
            Referenda::place_decision_deposit(RuntimeOrigin::signed(guardian), referendum_index);
    }

    fn void_authority_origin() -> RuntimeOrigin {
        pallet_origins::Origin::EmergencyPlaybook.into()
    }

    fn account(seed: u8) -> AccountId {
        let who = AccountId32::new([seed; 32]);
        benchmark_ensure_usdc();
        let _ = <ForeignAssets as Mutate<AccountId>>::mint_into(
            usdc_location(),
            &who,
            currency::USDC.saturating_mul(1_000_000),
        );
        who
    }

    fn proposal(
        id: futarchy_primitives::ProposalId,
        who: AccountId,
        now: BlockNumber,
        epoch: EpochId,
    ) -> futarchy_primitives::Proposal<AccountId> {
        let (payload_hash, payload_len) = benchmark_ensure_payload_preimage(id);
        futarchy_primitives::Proposal {
            id,
            // `submit` requires `funder == origin` (05 §1.5): the hold lands on
            // the signer, so no benchmark fixture may name a third party here.
            // The record is the same width either way — `funder` is a
            // fixed-size `AccountId32` — so this costs the measurement nothing.
            funder: who.clone(),
            proposer: who,
            class: futarchy_primitives::ProposalClass::Param,
            state: futarchy_primitives::ProposalState::Submitted,
            epoch,
            submitted_at: now,
            payload_hash,
            payload_len,
            ask: 0,
            bond: balance_param(b"prop.bond.param"),
            resources: Default::default(),
            metric_spec: 0,
            decide_at: 0,
            rerun: false,
            extended: false,
            delayed_once: false,
            markets: None,
            maturity: None,
            grace_end: None,
            version_constraint: Some(
                pallet_execution_guard::CurrentSpecName::<Runtime>::get()
                    .map_or_else(benchmark_runtime_version, |version| version),
            ),
            decision: None,
        }
    }

    fn prime_recovery_qualification(proposal: &mut futarchy_primitives::Proposal<AccountId>) {
        use frame_support::traits::StorePreimage;

        if pallet_execution_guard::CurrentSpecName::<Runtime>::get().is_none() {
            pallet_execution_guard::CurrentSpecName::<Runtime>::put(benchmark_runtime_version());
        }
        let primary_hash = sp_io::hashing::blake2_256(&proposal.id.encode());
        let Ok(recovery) = benchmark_recovery_image(proposal.id, primary_hash) else {
            return;
        };
        let calls = alloc::vec![
            RuntimeCall::System(frame_system::Call::authorize_upgrade {
                code_hash: primary_hash.into(),
            }),
            RuntimeCall::ExecutionGuard(pallet_execution_guard::Call::commit_recovery_image {
                hash: recovery.hash,
                len: recovery.len,
                target_spec_version: recovery.target_spec_version,
                attestation_id: recovery.attestation_id,
            }),
        ];
        let Ok(batch) = pallet_execution_guard::pallet::RuntimeBatch::<Runtime>::try_from(calls)
        else {
            return;
        };
        let payload = batch.encode();
        let Ok(payload_len) = u32::try_from(payload.len()) else {
            return;
        };
        let Ok(payload_hash) = <Preimage as StorePreimage>::note(Cow::Owned(payload)) else {
            return;
        };
        let qualification_context = benchmark_epoch_proposal(
            proposal.id,
            payload_hash.0,
            payload_len,
            futarchy_primitives::ProposalState::Submitted,
        );
        pallet_epoch::IntakeProposals::<Runtime>::insert(proposal.id, qualification_context);
        let caller = AccountId32::new([249; 32]);
        if crate::ExecutionGuard::qualify_recovery_image(RuntimeOrigin::signed(caller), proposal.id)
            .is_err()
        {
            return;
        }
        proposal.class = futarchy_primitives::ProposalClass::Code;
        proposal.payload_hash = payload_hash.0;
        proposal.payload_len = payload_len;
        proposal.bond = balance_param(b"prop.bond.code");
        proposal.resources =
            futarchy_primitives::BoundedVec::try_from(alloc::vec![[0x03, 0, 0, 0, 0, 0, 0, 0,]])
                .unwrap_or_default();
        proposal.version_constraint = pallet_execution_guard::CurrentSpecName::<Runtime>::get();
    }

    fn prime_decision(
        pid: futarchy_primitives::ProposalId,
        epoch: EpochId,
        gates: bool,
    ) -> futarchy_primitives::MarketSet {
        if pallet_execution_guard::CurrentSpecName::<Runtime>::get().is_none() {
            pallet_execution_guard::CurrentSpecName::<Runtime>::put(benchmark_runtime_version());
        }
        if !pallet_conditional_ledger::Vaults::<Runtime>::contains_key(pid) {
            let _ =
                ConditionalLedger::create_vault(RuntimeOrigin::signed(market_account()), pid, 0);
        }
        if gates {
            let payload_hash = benchmark_ensure_payload_preimage(pid).0;
            benchmark_fill_attestations(pid, payload_hash);
        }
        benchmark_ensure_market_books(pid, epoch, gates)
    }

    fn prime_guard_enqueue(_: futarchy_primitives::ProposalId) {}

    fn prime_dispute_rounds(spec: futarchy_primitives::MetricSpecVersion) {
        // The worst case is a full scan that returns **false**: `.any()`
        // short-circuits on the first qualifying round, so a map full of
        // holding disputes is the *cheap* case. Every round here therefore
        // clears the merit floor — paying its `RoundSchedules` read — and is
        // then money-settled, paying the SQ-494 `ComponentValues` read and
        // failing. Nothing short-circuits and `decide` still takes its ordinary
        // path rather than the ProcessHold rejection.
        //
        // **All 128 on the proposal's own version.** 02 §7.2 decomposes the
        // bound as 16 components x <= 4 settling epochs x <= 2 concurrent
        // versions, which suggests at most 64 rounds can share one — but that
        // 4-epoch factor holds only once a retained round is eventually reaped,
        // and 07 §11(1)'s retention had no implemented deadline before SQ-492
        // (#175), so successive epochs accumulated money-settled rounds on one
        // long-lived frozen version to the 128-slot cap. A 64/64 split measured
        // half the reachable per-round reads and undercharged a permissionless
        // call (#176 review).
        //
        // With #175 merged the retention deadline exists and the 4-epoch factor
        // is true again, so 128-on-one-version is no longer reachable and this
        // fixture is **conservative rather than exact**. It stays: charging the
        // larger figure cannot under-charge, and re-measuring downward would
        // trade a safety margin for a smaller number.
        let epoch = pallet_epoch::CurrentEpoch::<Runtime>::get();
        for index in 0..pallet_oracle::MAX_ROUNDS as u16 {
            let version = spec;
            let key = (index, epoch, version);
            pallet_oracle::Rounds::<Runtime>::insert(
                key,
                pallet_oracle::RoundState {
                    component: index,
                    epoch,
                    round: 1,
                    spec_version: version,
                    reporter: [61; 32],
                    value: FixedU64(pallet_welfare::ONE / 2),
                    evidence_hash: [62; 32],
                    bond: Balance::MAX,
                    challenge_deadline: u32::MAX,
                    extended: false,
                    challenger: Some([63; 32]),
                    counter_value: Some(FixedU64(pallet_welfare::ONE / 4)),
                    acks: 0,
                    report_hash: [64; 32],
                    stake_at_risk: 1,
                    cumulative_reporter_bond: 1,
                    cumulative_challenger_bond: 1,
                },
            );
            pallet_oracle::RoundSchedules::<Runtime>::insert(
                key,
                pallet_oracle::StoredRoundSchedule {
                    round_one_bond: 1,
                    round_cap: pallet_oracle::ORC_ROUNDS,
                },
            );
            pallet_oracle::ComponentValues::<Runtime>::insert(
                key,
                pallet_oracle::SettledComponent {
                    value: FixedU64(pallet_welfare::ONE / 2),
                    path: pallet_oracle::SettlePath::Neutral,
                    flagged: true,
                },
            );
        }
    }

    fn prime_oracle_state(measurement_epoch: EpochId) {
        // Saturate every collection `Oracle::load` hydrates, so the boundary
        // crank's weight reflects the real bounded aggregate. Without this the
        // benchmark measures one `Oracle::Rounds` read against a 128-entry bound
        // and understates a permissionless call (R-7; Codex P1 on #172).
        for seed in 0..pallet_oracle::MAX_REPORTERS {
            pallet_oracle::Reporters::<Runtime>::insert(
                <RuntimeBenchmarkHelper as pallet_epoch::BenchmarkHelper<
                    RuntimeOrigin,
                    AccountId,
                >>::account(seed as u8),
                pallet_oracle::ReporterInfo {
                    stake: 1,
                    registered_at: 1,
                    offenses: 0,
                },
            );
        }
        for seed in 0..pallet_oracle::MAX_WATCHTOWERS {
            pallet_oracle::Watchtowers::<Runtime>::insert(
                <RuntimeBenchmarkHelper as pallet_epoch::BenchmarkHelper<
                    RuntimeOrigin,
                    AccountId,
                >>::account((128 + seed) as u8),
                pallet_oracle::WatchtowerInfo {
                    stake: 1,
                    registered_at: 1,
                    inactive_epochs: 0,
                },
            );
        }
        // Spread the rounds across the measurement epochs the crank drives, so the
        // per-epoch filter in `force_neutralize_expired` walks a full map.
        for index in 0..pallet_oracle::MAX_ROUNDS {
            let component = (index % 64) as u16;
            let epoch = measurement_epoch.saturating_sub((index / 64) as u32);
            let round = pallet_oracle::RoundState {
                component,
                epoch,
                round: 1,
                spec_version: 1,
                reporter: [1u8; 32],
                value: FixedU64(pallet_welfare::ONE / 2),
                evidence_hash: [2u8; 32],
                bond: 1,
                challenge_deadline: u32::MAX,
                extended: false,
                challenger: None,
                counter_value: None,
                acks: 0,
                report_hash: [3u8; 32],
                stake_at_risk: 1,
                cumulative_reporter_bond: 1,
                cumulative_challenger_bond: 0,
            };
            pallet_oracle::Rounds::<Runtime>::insert((component, epoch, 1u16), round);
            pallet_oracle::RoundSchedules::<Runtime>::insert(
                (component, epoch, 1u16),
                pallet_oracle::StoredRoundSchedule {
                    round_one_bond: 1,
                    round_cap: 3,
                },
            );
        }
        // Stale settled values for the 07 §13 reaping sweep, seeded to the full
        // `MAX_COMPONENT_VALUES` bound because every `Oracle::load` in this
        // crank scans the whole map — the scan is the cost, and a partial
        // fixture understates every hydration in the call, not just the sweep
        // (#175 review). **Two generations per component**, because each
        // component's newest value is its §10 carry checkpoint and is exempt:
        // one generation per component would leave nothing reapable at all and
        // the sweep would measure a no-op while reporting a green weight
        // (SQ-492).
        let components = STALE_COMPONENT_VALUE_SEEDS / 2;
        for component in 0..components {
            for epoch in 0..2u32 {
                pallet_oracle::ComponentValues::<Runtime>::insert(
                    (component, epoch, 1u16),
                    pallet_oracle::SettledComponent {
                        value: FixedU64(pallet_welfare::ONE / 2),
                        path: pallet_oracle::SettlePath::Neutral,
                        flagged: true,
                    },
                );
            }
        }
    }

    fn assert_oracle_components_reaped() {
        // Only the older generation is reapable — the newer one is each
        // component's carry checkpoint — so the batch comes out of epoch 0.
        assert_eq!(
            pallet_oracle::ComponentValues::<Runtime>::iter_keys()
                .filter(|(_, epoch, _)| *epoch == 0)
                .count(),
            (STALE_COMPONENT_VALUE_SEEDS as usize / 2)
                .saturating_sub(pallet_oracle::COMPONENT_VALUE_REAP_BATCH),
            "the boundary crank must retire exactly one ComponentReapBatch"
        );
    }

    fn assert_settlement_renormalized(epoch: EpochId) {
        assert!(
            frame_system::Pallet::<Runtime>::read_events_no_consensus().any(|record| matches!(
                record.event,
                RuntimeEvent::Welfare(pallet_welfare::Event::SettlementRenormalized {
                    epoch: settled,
                    ..
                }) if settled == epoch
            )),
            "settle_cohort must measure the 07 §10 recompute, not skip it"
        );
    }

    fn prime_collator_compensation() {
        prime_collator_compensation_worst_case();
    }

    fn assert_collator_compensation_paid() {
        assert_collator_compensation_was_paid();
    }

    fn prime_settlement(epoch: EpochId) {
        for (pid, proposal) in pallet_epoch::Proposals::<Runtime>::iter() {
            if proposal.epoch == epoch {
                let _ = ConditionalLedger::resolve(
                    epoch_signed_origin(),
                    pid,
                    futarchy_primitives::Branch::Accept,
                );
            }
        }
        let baseline = 9_000u64.saturating_add(u64::from(epoch));
        if !pallet_market::Markets::<Runtime>::contains_key(baseline)
            && !pallet_conditional_ledger::BaselineVaults::<Runtime>::contains_key(epoch)
        {
            // The production entry point creates the baseline vault and the
            // `BaselineMarketOf` index, and the settlement path's terminal latch
            // (`observe_baseline_terminal`, B10) requires the real book.
            let _ = pallet_market::Pallet::<Runtime>::create_market(
                epoch_signed_origin(),
                baseline,
                pallet_market::core_market::BookKind::Baseline { epoch },
                epoch,
                market_book_account(baseline),
                market_fee_account(baseline),
                balance_param(b"pol.b_baseline"),
            );
        }
        // 07 §10's settlement-time recompute reads the *spec set* of the version
        // the cohort settles on, so the fixture must register it. Without it the
        // recompute has no weights to renormalize and silently falls back to the
        // recorded `W` — measuring none of the work `settle_cohort` performs.
        // Registered for every version the saturated history below carries, not
        // only the settling one: `full_specs(v)` activates at `1 + v`, so the
        // three are distinct activations and the AUD-4 uniqueness invariant
        // holds. Version 0 stays the one the cohort settles on.
        for version in 0..PER_EPOCH_SNAPSHOT_VERSIONS {
            if let Ok(specs) = frame_support::BoundedVec::try_from(
                pallet_welfare::benchmarking::full_specs(version),
            ) {
                pallet_welfare::MetricSpecs::<Runtime>::insert(version, specs);
            }
        }
        let attested = pallet_welfare::benchmarking::attested_ids();
        // The two welfare maps this path scans have **different** bounds, and
        // the loop used to drive both from `MAX_SNAPSHOTS_BOUND`: `Snapshots` is
        // keyed `(epoch, spec_version)` and bounded at 60 records, while
        // `GateBreachFlags` is keyed by epoch alone and bounded at 20. Seeding
        // one flag per snapshot therefore overflowed the flag bound the moment
        // the record bound took its version multiplicity, and `settle_cohort`
        // stopped benchmarking at all. Saturate each at its own bound: 20
        // retained epochs, each carrying one flag and one snapshot per
        // concurrent version. That is exactly the state the two bounds admit
        // together, so the scan is charged at its real worst case.
        for offset in 1..=pallet_welfare::SNAPSHOT_RETENTION_EPOCHS_BOUND {
            let measured_epoch = epoch.saturating_add(offset);
            for version in 0..PER_EPOCH_SNAPSHOT_VERSIONS {
                pallet_welfare::Snapshots::<Runtime>::insert(
                    (measured_epoch, version),
                    pallet_welfare::StoredSnapshot {
                        epoch: measured_epoch,
                        spec_version: version,
                        s_pillar: FixedU64(500_000_000),
                        c_onchain: FixedU64(500_000_000),
                        c_attested: FixedU64(500_000_000),
                        p_pillar: FixedU64(500_000_000),
                        a_pillar: FixedU64(500_000_000),
                        gate_s: FixedU64(500_000_000),
                        gate_c: FixedU64(500_000_000),
                        welfare: FixedU64(500_000_000),
                        components: frame_support::BoundedVec::truncate_from(
                            // Interior values: at the former 1.0 every geometric term
                            // is skipped, so the recompute this fixture exists to
                            // measure would cost almost nothing.
                            pallet_welfare::benchmarking::degraded(
                                pallet_welfare::MAX_COMPONENTS_PER_SPEC as u16,
                            ),
                        ),
                    },
                );
                pallet_welfare::SnapshotContexts::<Runtime>::insert(
                    (measured_epoch, version),
                    pallet_welfare::StoredSnapshotContext {
                        epoch: measured_epoch,
                        spec_version: version,
                        // One flagged component, not all of them: 07 §10's recompute
                        // costs a term per *surviving* component, so the dearest
                        // non-empty drop set is the smallest one. Flagging every
                        // attested component would empty the A pillar and let the
                        // composite renormalize instead of evaluating its terms.
                        flagged: frame_support::BoundedVec::truncate_from(
                            attested.iter().copied().take(1).collect::<Vec<_>>(),
                        ),
                        incident_multiplier: FixedU64(pallet_welfare::ONE),
                        params:
                            <WelfareParams as pallet_welfare::WelfareParamsProvider>::welfare_params(
                            ),
                    },
                );
            }
            pallet_welfare::GateBreachFlags::<Runtime>::insert(
                measured_epoch,
                pallet_welfare::CoreGateBreachFlags {
                    s_breached: false,
                    c_breached: false,
                    day_bitmap: [0; 2],
                },
            );
        }
    }
}

/// Snapshot records one retained epoch can carry: one per cohort measuring it
/// (`epoch.horizon_k`) plus one for its own active spec. `MAX_SNAPSHOTS` is
/// this times the retained epoch window, so saturating both welfare maps means
/// `SNAPSHOT_RETENTION_EPOCHS_BOUND` epochs at this multiplicity.
#[cfg(feature = "runtime-benchmarks")]
const PER_EPOCH_SNAPSHOT_VERSIONS: u16 = pallet_welfare::MAX_CONCURRENT_FROZEN_VERSIONS as u16 + 1;

#[cfg(feature = "runtime-benchmarks")]
fn benchmark_epoch_proposal(
    pid: futarchy_primitives::ProposalId,
    payload_hash: futarchy_primitives::H256,
    payload_len: u32,
    state: futarchy_primitives::ProposalState,
) -> futarchy_primitives::Proposal<AccountId> {
    let who = AccountId32::new([u8::try_from(pid).map_or(0, |value| value); 32]);
    futarchy_primitives::Proposal {
        id: pid,
        // Seeded states pair with `ProposalBonds` entries whose custody
        // identity is the submitting account, so the two identities coincide
        // here exactly as they did before the E6 split.
        funder: who.clone(),
        proposer: who,
        class: futarchy_primitives::ProposalClass::Param,
        state,
        epoch: pallet_epoch::CurrentEpoch::<Runtime>::get(),
        submitted_at: System::block_number(),
        payload_hash,
        payload_len,
        ask: 0,
        bond: balance_param(b"prop.bond.param"),
        resources: Default::default(),
        metric_spec: 0,
        decide_at: System::block_number(),
        rerun: false,
        extended: false,
        delayed_once: false,
        markets: Some(futarchy_primitives::MarketSet {
            accept: 1,
            reject: 2,
            gates: Some([3, 4, 5, 6]),
            baseline: 7,
        }),
        maturity: None,
        grace_end: None,
        version_constraint: pallet_execution_guard::CurrentSpecName::<Runtime>::get(),
        decision: None,
    }
}

#[cfg(feature = "runtime-benchmarks")]
fn benchmark_seed_epoch_queue(
    pid: futarchy_primitives::ProposalId,
    payload_hash: futarchy_primitives::H256,
    payload_len: u32,
    class: futarchy_primitives::ProposalClass,
    maturity: BlockNumber,
    grace_end: BlockNumber,
    version_constraint: futarchy_primitives::RuntimeVersionConstraint,
) -> DispatchResult {
    let mut proposal = benchmark_epoch_proposal(
        pid,
        payload_hash,
        payload_len,
        futarchy_primitives::ProposalState::Queued,
    );
    proposal.class = class;
    proposal.maturity = Some(maturity);
    proposal.grace_end = Some(grace_end);
    proposal.version_constraint = Some(version_constraint);
    proposal.decision = Some(futarchy_primitives::DecisionOutcome::Adopt);
    let epoch = proposal.epoch;
    let decide_at = proposal.decide_at;
    pallet_epoch::Proposals::<Runtime>::insert(pid, proposal);
    let schedule = pallet_epoch::Schedule::<Runtime>::get();
    pallet_epoch::ProposalSchedules::<Runtime>::insert(
        pid,
        pallet_epoch::ProposalSchedule {
            epoch,
            epoch_start_block: schedule.epoch_start_block,
            epoch_length: schedule.length,
            decide_at,
            metric_spec: 0,
        },
    );
    pallet_epoch::NextProposalId::<Runtime>::mutate(|next| {
        *next = (*next).max(pid.saturating_add(1));
    });
    if !pallet_conditional_ledger::Vaults::<Runtime>::contains_key(pid) {
        ConditionalLedger::create_vault(RuntimeOrigin::signed(market_account()), pid, 0)?;
    }
    Ok(())
}

#[cfg(feature = "runtime-benchmarks")]
fn benchmark_guard_enqueue(
    pid: futarchy_primitives::ProposalId,
    call: RuntimeCall,
    domain: pallet_execution_guard::CallDomain,
) -> Result<BlockNumber, DispatchError> {
    benchmark_guard_enqueue_for_class(
        pid,
        call,
        domain,
        futarchy_primitives::ProposalClass::Param,
        None,
        false,
    )
}

#[cfg(feature = "runtime-benchmarks")]
fn benchmark_guard_enqueue_for_class(
    pid: futarchy_primitives::ProposalId,
    call: RuntimeCall,
    domain: pallet_execution_guard::CallDomain,
    class: futarchy_primitives::ProposalClass,
    attestation_id: Option<u32>,
    ratified: bool,
) -> Result<BlockNumber, DispatchError> {
    benchmark_guard_enqueue_calls_for_class(
        pid,
        alloc::vec![call],
        alloc::vec![domain],
        class,
        attestation_id,
        ratified,
    )
}

#[cfg(feature = "runtime-benchmarks")]
fn benchmark_guard_enqueue_calls_for_class(
    pid: futarchy_primitives::ProposalId,
    calls: Vec<RuntimeCall>,
    domains: Vec<pallet_execution_guard::CallDomain>,
    class: futarchy_primitives::ProposalClass,
    attestation_id: Option<u32>,
    ratified: bool,
) -> Result<BlockNumber, DispatchError> {
    use frame_support::traits::{QueryPreimage, StorePreimage};
    use pallet_execution_guard::BatchDispatcher;

    if pallet_execution_guard::CurrentSpecName::<Runtime>::get().is_none() {
        pallet_execution_guard::CurrentSpecName::<Runtime>::put(benchmark_runtime_version());
    }

    let primary_hash = calls
        .iter()
        .find_map(crate::classifier::RuntimeDispatcher::authorize_upgrade_hash);
    let recovery = calls
        .iter()
        .find_map(crate::classifier::RuntimeDispatcher::recovery_image_descriptor);
    let batch = pallet_execution_guard::pallet::RuntimeBatch::<Runtime>::try_from(calls)
        .map_err(|_| DispatchError::Other("benchmark guard batch bound"))?;
    let bytes = batch.encode();
    let payload_len = u32::try_from(bytes.len())
        .map_err(|_| DispatchError::Other("benchmark guard payload length"))?;
    let hash = <Preimage as StorePreimage>::note(Cow::Owned(bytes))?;
    <Preimage as QueryPreimage>::request(&hash);

    let now = System::block_number();
    let maturity = now
        .checked_add(<ExecutionParams as pallet_execution_guard::Params>::exec_timelock(class))
        .ok_or(DispatchError::Arithmetic(
            sp_runtime::ArithmeticError::Overflow,
        ))?;
    let grace_end = maturity
        .checked_add(<ExecutionParams as pallet_execution_guard::Params>::exec_grace(class))
        .ok_or(DispatchError::Arithmetic(
            sp_runtime::ArithmeticError::Overflow,
        ))?;
    let version_constraint = pallet_execution_guard::CurrentSpecName::<Runtime>::get()
        .ok_or(DispatchError::Other("benchmark guard current version"))?;
    if let (Some(primary_hash), Some(descriptor)) = (primary_hash, recovery) {
        <Preimage as QueryPreimage>::request(&Hash::from(descriptor.hash));
        pallet_execution_guard::QualifiedRecoveryImages::<Runtime>::insert(
            pid,
            pallet_execution_guard::QualifiedRecoveryImage {
                payload_hash: hash.0,
                primary_hash,
                version_constraint: version_constraint.clone(),
                descriptor,
            },
        );
    }
    let declared_domains = pallet_execution_guard::pallet::StoredDomains::try_from(domains)
        .map_err(|_| DispatchError::Other("benchmark guard domain bound"))?;
    benchmark_seed_epoch_queue(
        pid,
        hash.0,
        payload_len,
        class,
        maturity,
        grace_end,
        version_constraint.clone(),
    )?;
    if ratified
        && matches!(
            class,
            futarchy_primitives::ProposalClass::Code | futarchy_primitives::ProposalClass::Meta
        )
    {
        // CODE/META ratification is a two-step join: bind the pending
        // referendum before queue admission, then record its passed identity.
        crate::ExecutionGuard::bind_ratification(pid, 1)?;
    }
    crate::ExecutionGuard::enqueue(
        RuntimeOrigin::signed(epoch_account()),
        pallet_execution_guard::pallet::StoredQueuedExecution {
            pid,
            payload_hash: hash.0,
            payload_len,
            class,
            maturity,
            grace_end,
            version_constraint,
            meters_declared: Default::default(),
            ratify_ref: None,
            ratification_passed: false,
            attestation_id,
            pre_upgrade_checkpoint: None,
            cancelled: false,
            declared_domains,
            failed_at: None,
        },
        false,
    )?;
    if ratified {
        crate::ExecutionGuard::ratify(pallet_origins::Origin::ConstitutionalValues.into(), pid, 1)?;
    }
    Ok(maturity)
}

#[cfg(feature = "runtime-benchmarks")]
fn benchmark_recovery_image(
    pid: futarchy_primitives::ProposalId,
    primary_hash: futarchy_primitives::H256,
) -> Result<pallet_execution_guard::RecoveryImageDescriptor, DispatchError> {
    benchmark_recovery_image_sized(pid, primary_hash, 512)
}

#[cfg(feature = "runtime-benchmarks")]
fn benchmark_recovery_image_sized(
    pid: futarchy_primitives::ProposalId,
    primary_hash: futarchy_primitives::H256,
    bytes: u32,
) -> Result<pallet_execution_guard::RecoveryImageDescriptor, DispatchError> {
    use frame_support::traits::StorePreimage;

    let current = pallet_execution_guard::CurrentSpecName::<Runtime>::get()
        .unwrap_or_else(benchmark_runtime_version);
    let target_spec_version =
        current
            .spec_version
            .checked_add(2)
            .ok_or(DispatchError::Arithmetic(
                sp_runtime::ArithmeticError::Overflow,
            ))?;
    let code = benchmark_runtime_code_with_spec(bytes, target_spec_version);
    ParachainSystem::initialize_for_set_code_benchmark(code.len() as u32);
    let len =
        u32::try_from(code.len()).map_err(|_| DispatchError::Other("benchmark recovery length"))?;
    let hash = <Preimage as StorePreimage>::note(Cow::Owned(code))?.0;
    let attestation_id = pallet_attestor::MAX_ATTESTATIONS
        .saturating_sub(futarchy_primitives::kernel::ATT_QUORUM.saturating_mul(2));
    benchmark_fill_upgrade_attestations(pid, primary_hash, Some(hash));
    Ok(pallet_execution_guard::RecoveryImageDescriptor {
        hash,
        len,
        target_spec_version,
        attestation_id,
    })
}

#[cfg(feature = "runtime-benchmarks")]
impl pallet_execution_guard::BenchmarkHelper<RuntimeOrigin> for RuntimeBenchmarkHelper {
    benchmark_keeper_rebate_hooks!();

    fn ratify_origin() -> RuntimeOrigin {
        pallet_origins::Origin::ConstitutionalValues.into()
    }
    fn recovery_commit_origin() -> RuntimeOrigin {
        pallet_origins::Origin::FutarchyCode.into()
    }
    fn phase_four_origin() -> RuntimeOrigin {
        #[cfg(feature = "bootstrap")]
        {
            pallet_sudo::Key::<Runtime>::get()
                .map(RuntimeOrigin::signed)
                .unwrap_or_else(|| RuntimeOrigin::signed(AccountId32::new([0; 32])))
        }
        #[cfg(not(feature = "bootstrap"))]
        RuntimeOrigin::signed(AccountId32::new([0; 32]))
    }

    fn prime_ratify(pid: futarchy_primitives::ProposalId, _: u32) {
        let payload_hash = sp_io::hashing::blake2_256(&pid.encode());
        let proposal = benchmark_epoch_proposal(
            pid,
            payload_hash,
            0,
            futarchy_primitives::ProposalState::Submitted,
        );
        pallet_epoch::IntakeProposals::<Runtime>::insert(pid, proposal);
    }

    fn prime_execute(pid: futarchy_primitives::ProposalId, calls: u32) {
        System::set_block_number(System::block_number().max(1));
        pallet_constitution::PhaseFlags::<Runtime>::put(
            pallet_constitution::PhaseFlagsValue::CODE_META_ARMED,
        );
        let artifact = sp_io::hashing::blake2_256(&pid.encode());
        let Ok(recovery) = benchmark_recovery_image(pid, artifact) else {
            return;
        };
        let attestation_id = pallet_attestor::MAX_ATTESTATIONS
            .saturating_sub(futarchy_primitives::kernel::ATT_QUORUM);
        let mut batch = alloc::vec![
            RuntimeCall::System(frame_system::Call::authorize_upgrade {
                code_hash: artifact.into(),
            }),
            RuntimeCall::ExecutionGuard(pallet_execution_guard::Call::commit_recovery_image {
                hash: recovery.hash,
                len: recovery.len,
                target_spec_version: recovery.target_spec_version,
                attestation_id: recovery.attestation_id,
            },),
        ];
        batch.extend((2..calls).map(|index| {
            RuntimeCall::System(frame_system::Call::remark {
                remark: alloc::vec![index as u8; 32],
            })
        }));
        let mut domains = alloc::vec![
            pallet_execution_guard::CallDomain::InternalRootAuthorizeUpgrade,
            pallet_execution_guard::CallDomain::Code,
        ];
        if calls > 2 {
            domains.push(pallet_execution_guard::CallDomain::Public);
        }
        if let Ok(maturity) = benchmark_guard_enqueue_calls_for_class(
            pid,
            batch,
            domains,
            futarchy_primitives::ProposalClass::Code,
            Some(attestation_id),
            true,
        ) {
            System::set_block_number(maturity.saturating_add(1));
            pallet_execution_guard::Queue::<Runtime>::mutate(pid, |queued| {
                if let Some(queued) = queued {
                    queued.maturity = System::block_number();
                }
            });
        }
    }
    fn prime_recovery_commit(
        pid: futarchy_primitives::ProposalId,
    ) -> pallet_execution_guard::RecoveryImageDescriptor {
        benchmark_recovery_image(pid, [0x51; 32]).unwrap_or(
            pallet_execution_guard::RecoveryImageDescriptor {
                hash: [0x52; 32],
                len: 512,
                target_spec_version: VERSION.spec_version.saturating_add(2),
                attestation_id: pallet_attestor::MAX_ATTESTATIONS
                    .saturating_sub(futarchy_primitives::kernel::ATT_QUORUM.saturating_mul(2)),
            },
        )
    }
    fn prime_recovery_qualification(pid: futarchy_primitives::ProposalId, bytes: u32) {
        use frame_support::traits::StorePreimage;

        if pallet_execution_guard::CurrentSpecName::<Runtime>::get().is_none() {
            pallet_execution_guard::CurrentSpecName::<Runtime>::put(benchmark_runtime_version());
        }
        let primary_hash = sp_io::hashing::blake2_256(&pid.encode());
        let Ok(recovery) = benchmark_recovery_image_sized(pid, primary_hash, bytes) else {
            return;
        };
        let mut batch = alloc::vec![
            RuntimeCall::System(frame_system::Call::authorize_upgrade {
                code_hash: primary_hash.into(),
            }),
            RuntimeCall::ExecutionGuard(pallet_execution_guard::Call::commit_recovery_image {
                hash: recovery.hash,
                len: recovery.len,
                target_spec_version: recovery.target_spec_version,
                attestation_id: recovery.attestation_id,
            }),
            RuntimeCall::System(frame_system::Call::remark {
                remark: alloc::vec![],
            }),
        ];
        loop {
            let encoded_len = batch.encode().len();
            if encoded_len == futarchy_primitives::kernel::MAX_BYTES as usize {
                break;
            }
            let RuntimeCall::System(frame_system::Call::remark { remark }) =
                batch.last_mut().expect("qualifier benchmark has padding")
            else {
                return;
            };
            if encoded_len < futarchy_primitives::kernel::MAX_BYTES as usize {
                remark.resize(
                    remark.len().saturating_add(
                        futarchy_primitives::kernel::MAX_BYTES as usize - encoded_len,
                    ),
                    0xff,
                );
            } else {
                remark.truncate(
                    remark.len().saturating_sub(
                        encoded_len - futarchy_primitives::kernel::MAX_BYTES as usize,
                    ),
                );
            }
        }
        let Ok(batch) = pallet_execution_guard::pallet::RuntimeBatch::<Runtime>::try_from(batch)
        else {
            return;
        };
        let payload = batch.encode();
        let Ok(payload_len) = u32::try_from(payload.len()) else {
            return;
        };
        let Ok(payload_hash) = <Preimage as StorePreimage>::note(Cow::Owned(payload)) else {
            return;
        };
        let proposal = benchmark_epoch_proposal(
            pid,
            payload_hash.0,
            payload_len,
            futarchy_primitives::ProposalState::Submitted,
        );
        pallet_epoch::IntakeProposals::<Runtime>::insert(pid, proposal);
    }
    fn prime_phase_four(pid: futarchy_primitives::ProposalId) {
        #[cfg(not(feature = "bootstrap"))]
        {
            let _ = pid;
        }
        #[cfg(feature = "bootstrap")]
        {
            System::set_block_number(System::block_number().max(1));
            let artifact = sp_io::hashing::blake2_256(&pid.encode());
            let Ok(recovery) = benchmark_recovery_image(pid, artifact) else {
                return;
            };
            let tvl_key = pallet_constitution::key16(b"phase3.tvl_cap");
            let deposit_key = pallet_constitution::key16(b"phase3.dep_cap");
            let Some(tvl) = pallet_constitution::Params::<Runtime>::get(tvl_key) else {
                return;
            };
            let Some(deposit) = pallet_constitution::Params::<Runtime>::get(deposit_key) else {
                return;
            };
            let batch = alloc::vec![
                RuntimeCall::System(frame_system::Call::authorize_upgrade {
                    code_hash: artifact.into(),
                }),
                RuntimeCall::ExecutionGuard(pallet_execution_guard::Call::commit_recovery_image {
                    hash: recovery.hash,
                    len: recovery.len,
                    target_spec_version: recovery.target_spec_version,
                    attestation_id: recovery.attestation_id,
                },),
                RuntimeCall::Constitution(pallet_constitution::Call::set_param {
                    key: tvl_key,
                    value: pallet_constitution::ParamValue::Balance(
                        tvl.value.as_u128().saturating_add(1),
                    ),
                }),
                RuntimeCall::Constitution(pallet_constitution::Call::set_param {
                    key: deposit_key,
                    value: pallet_constitution::ParamValue::Balance(
                        deposit.value.as_u128().saturating_add(1),
                    ),
                }),
            ];
            let attestation_id = pallet_attestor::MAX_ATTESTATIONS
                .saturating_sub(futarchy_primitives::kernel::ATT_QUORUM);
            if let Ok(maturity) = benchmark_guard_enqueue_calls_for_class(
                pid,
                batch,
                alloc::vec![
                    pallet_execution_guard::CallDomain::InternalRootAuthorizeUpgrade,
                    pallet_execution_guard::CallDomain::Code,
                    pallet_execution_guard::CallDomain::Meta,
                ],
                futarchy_primitives::ProposalClass::Meta,
                Some(attestation_id),
                true,
            ) {
                // Benchmark dispatch runs after the queue has been admitted;
                // advance strictly past the timelock so a boundary-sensitive
                // runtime hook cannot re-read the just-matured block as early.
                System::set_block_number(maturity.saturating_add(1));
                pallet_execution_guard::Queue::<Runtime>::mutate(pid, |queued| {
                    if let Some(queued) = queued {
                        queued.maturity = System::block_number();
                    }
                });
            }
        }
    }

    fn prime_recovery_application() -> (
        futarchy_primitives::H256,
        futarchy_primitives::RuntimeVersionConstraint,
    ) {
        use frame_support::traits::QueryPreimage;
        use pallet_execution_guard::ReleaseChannelWriter;

        System::set_block_number(System::block_number().max(1));
        if pallet_execution_guard::CurrentSpecName::<Runtime>::get().is_none() {
            pallet_execution_guard::CurrentSpecName::<Runtime>::put(benchmark_runtime_version());
        }
        let current = pallet_execution_guard::CurrentSpecName::<Runtime>::get()
            .unwrap_or_else(benchmark_runtime_version);
        for pid in 10_000..10_000u64.saturating_add(pallet_execution_guard::MAX_QUEUE_BOUND.into())
        {
            let _ = benchmark_guard_enqueue(
                pid,
                RuntimeCall::System(frame_system::Call::remark {
                    remark: alloc::vec![0x52; 32],
                }),
                pallet_execution_guard::CallDomain::Public,
            );
        }
        let primary_hash = [0x51; 32];
        let recovery = benchmark_recovery_image(1, primary_hash).unwrap_or(
            pallet_execution_guard::RecoveryImageDescriptor {
                hash: [0x52; 32],
                len: 512,
                target_spec_version: current.spec_version.saturating_add(2),
                attestation_id: 8,
            },
        );
        <Preimage as QueryPreimage>::request(&Hash::from(recovery.hash));
        pallet_execution_guard::pallet::PendingUpgrade::<Runtime>::put(
            pallet_execution_guard::PendingUpgrade {
                hash: primary_hash,
                authorized_at: System::block_number(),
                applicable_at: System::block_number(),
                target_spec_version: current.spec_version.saturating_add(1),
            },
        );
        pallet_execution_guard::RecoveryImage::<Runtime>::put(
            pallet_execution_guard::RecoveryImageCommitment {
                pid: 1,
                primary_hash,
                hash: recovery.hash,
                len: recovery.len,
                target_spec_version: recovery.target_spec_version,
                attestation_id: recovery.attestation_id,
                committed_at: System::block_number(),
            },
        );
        let _ = RuntimeReleaseChannel::on_upgrade_authorized(
            current.spec_version.saturating_add(1),
            System::block_number(),
        );
        (
            recovery.hash,
            futarchy_primitives::RuntimeVersionConstraint {
                spec_name: current.spec_name,
                spec_version: recovery.target_spec_version,
            },
        )
    }

    fn prime_failed(pid: futarchy_primitives::ProposalId) {
        pallet_constitution::PhaseFlags::<Runtime>::put(
            pallet_constitution::PhaseFlagsValue::PARAM_ARMED,
        );
        let call = RuntimeCall::System(frame_system::Call::remark_with_event {
            remark: b"guard-benchmark-failure".to_vec(),
        });
        if let Ok(maturity) =
            benchmark_guard_enqueue(pid, call, pallet_execution_guard::CallDomain::Public)
        {
            System::set_block_number(maturity);
            let caller = AccountId::new([241; 32]);
            let _ = crate::ExecutionGuard::execute(RuntimeOrigin::signed(caller), pid);
            if let Some(failed_at) = pallet_execution_guard::pallet::Queue::<Runtime>::get(pid)
                .and_then(|queued| queued.failed_at)
            {
                System::set_block_number(
                    failed_at
                        .saturating_add(pallet_execution_guard::RETRY_WINDOW)
                        .saturating_add(1),
                );
            }
        }
    }

    fn prime_pending_upgrade(bytes: u32) -> Vec<u8> {
        pallet_constitution::PhaseFlags::<Runtime>::put(
            pallet_constitution::PhaseFlagsValue::CODE_META_ARMED,
        );
        let target_spec_version = VERSION.spec_version.saturating_add(1);
        let code = benchmark_runtime_code_with_spec(bytes, target_spec_version);
        let hash = sp_io::hashing::blake2_256(&code);
        ParachainSystem::initialize_for_set_code_benchmark(code.len() as u32);
        let now = System::block_number().max(1);
        System::set_block_number(now);
        let _ = RuntimeCall::System(frame_system::Call::authorize_upgrade {
            code_hash: hash.into(),
        })
        // N7-DISPATCH-TRIPWIRE: benchmark-authorize
        .dispatch_bypass_filter(RuntimeOrigin::root());
        pallet_execution_guard::pallet::PendingUpgrade::<Runtime>::put(
            pallet_execution_guard::PendingUpgrade {
                hash,
                authorized_at: now,
                applicable_at: now,
                target_spec_version,
            },
        );
        code
    }

    fn prime_stale(pid: futarchy_primitives::ProposalId) {
        pallet_constitution::PhaseFlags::<Runtime>::put(
            pallet_constitution::PhaseFlagsValue::PARAM_ARMED,
        );
        let key = pallet_constitution::key16(b"mkt.obs_interval");
        let Some(record) = pallet_constitution::Params::<Runtime>::get(key) else {
            return;
        };
        let call = RuntimeCall::Constitution(pallet_constitution::Call::set_param {
            key,
            value: record.value,
        });
        if benchmark_guard_enqueue(pid, call, pallet_execution_guard::CallDomain::Param).is_ok() {
            pallet_execution_guard::CurrentSpecName::<Runtime>::mutate(|current| {
                if let Some(version) = current {
                    version.spec_version = version.spec_version.saturating_add(1);
                }
            });
        }
    }
}

#[cfg(feature = "runtime-benchmarks")]
fn benchmark_push_leb128(mut value: usize, out: &mut Vec<u8>) {
    loop {
        let mut byte = (value & 0x7f) as u8;
        value >>= 7;
        if value != 0 {
            byte |= 0x80;
        }
        out.push(byte);
        if value == 0 {
            break;
        }
    }
}

#[cfg(feature = "runtime-benchmarks")]
fn benchmark_custom_section(name: &[u8], payload: &[u8]) -> Vec<u8> {
    let mut body = Vec::new();
    benchmark_push_leb128(name.len(), &mut body);
    body.extend_from_slice(name);
    body.extend_from_slice(payload);
    let mut section = Vec::new();
    section.push(0);
    benchmark_push_leb128(body.len(), &mut section);
    section.extend(body);
    section
}

#[cfg(feature = "runtime-benchmarks")]
fn benchmark_runtime_code_with_spec(target_code_bytes: u32, spec_version: u32) -> Vec<u8> {
    const WASM_HEADER: [u8; 8] = [0, 97, 115, 109, 1, 0, 0, 0];
    const VERSION_SECTION: &[u8] = b"runtime_version";
    const PADDING_SECTION: &[u8] = b"benchmark_padding";
    let target = target_code_bytes as usize;
    let mut version = VERSION;
    version.spec_version = spec_version;
    let mut code = Vec::from(WASM_HEADER);
    code.extend(benchmark_custom_section(VERSION_SECTION, &version.encode()));
    let mut padding_len = target.saturating_sub(code.len());
    loop {
        let section = benchmark_custom_section(PADDING_SECTION, &vec![0; padding_len]);
        match code.len().saturating_add(section.len()).cmp(&target) {
            core::cmp::Ordering::Equal => {
                code.extend(section);
                return code;
            }
            core::cmp::Ordering::Greater => padding_len = padding_len.saturating_sub(1),
            core::cmp::Ordering::Less => padding_len = padding_len.saturating_add(1),
        }
    }
}

#[cfg(test)]
mod security_term_tests {
    use super::scaled_decision_delta;
    use futarchy_primitives::ProposalClass;

    #[test]
    fn scaled_decision_delta_starts_from_the_governed_class_floor() {
        crate::tests::development_ext().execute_with(|| {
            // The Treasury floor is 0.0375 in the live registry, while the
            // kernel minimum is 0.005.  A prize at or below P_ref must
            // preserve the governed floor rather than silently falling back
            // to the kernel minimum.
            let governed_floor = 37_500_000;
            assert_eq!(
                scaled_decision_delta(ProposalClass::Treasury, governed_floor, 0),
                Some(governed_floor),
            );
        });
    }
}
