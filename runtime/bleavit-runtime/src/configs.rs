//! Runtime configuration and the B1a fail-closed cross-pallet adapters.

use alloc::{borrow::Cow, vec::Vec};

use frame_support::{
    derive_impl,
    dispatch::{DispatchClass, DispatchResult},
    parameter_types,
    traits::{
        fungibles::{Inspect, Mutate},
        tokens::Preservation,
        ConstBool, ConstU128, ConstU32, ConstU64, ConstU8, Contains, EqualPrivilegeOnly,
        InstanceFilter, Nothing, QueryPreimage, StorageInstance, TransformOrigin,
        UnfilteredDispatchable, VariantCountOf, WithdrawReasons,
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
use futarchy_primitives::{bounds, chain_identity, currency, kernel, EpochId, FixedU64, ParamKey};
use parity_scale_codec::{Decode, Encode};
use sp_consensus_aura::sr25519::AuthorityId as AuraId;
#[cfg(feature = "runtime-benchmarks")]
use sp_runtime::AccountId32;
use sp_runtime::{
    traits::{AccountIdConversion, AccountIdLookup, Dispatchable},
    DispatchError, Perbill,
};

use crate::{
    AccountId, AssetId, Aura, Balance, Balances, Block, BlockNumber, CollatorSelection,
    ConditionalLedger, ConsensusHook, ForeignAssets, FutarchyTreasury, Hash, MessageQueue,
    Migrations, Nonce, PalletInfo, ParachainSystem, PolkadotXcm, Preimage, Referenda, Runtime,
    RuntimeCall, RuntimeEvent, RuntimeFreezeReason, RuntimeHoldReason, RuntimeOrigin, RuntimeTask,
    Scheduler, Session, SessionKeys, System, XcmpQueue, USDC_ASSET_ID, VERSION,
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
        .for_class(DispatchClass::Normal, |w| w.max_total = Some(NORMAL_DISPATCH_RATIO * MAXIMUM_BLOCK_WEIGHT))
        .for_class(DispatchClass::Operational, |w| {
            w.max_total = Some(MAXIMUM_BLOCK_WEIGHT);
            w.reserved = Some(MAXIMUM_BLOCK_WEIGHT - NORMAL_DISPATCH_RATIO * MAXIMUM_BLOCK_WEIGHT);
        })
        .avg_block_initialization(AVERAGE_ON_INITIALIZE_RATIO)
        .build_or_panic();
    pub const Ss58Prefix: u16 = chain_identity::SS58_PREFIX;
}

type SingleBlockMigrations = ();

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
    type BlockWeights = RuntimeBlockWeights;
    type BlockLength = RuntimeBlockLength;
    type SS58Prefix = Ss58Prefix;
    type OnSetCode = cumulus_pallet_parachain_system::ParachainSetCode<Self>;
    type MaxConsumers = ConstU32<16>;
    type SingleBlockMigrations = SingleBlockMigrations;
    type MultiBlockMigrator = Migrations;
}

parameter_types! {
    pub const MinimumPeriod: u64 = kernel::MILLISECS_PER_BLOCK / 2;
    pub const ExistentialDeposit: Balance = currency::VIT_EXISTENTIAL_DEPOSIT;
}

impl pallet_timestamp::Config for Runtime {
    type Moment = u64;
    type OnTimestampSet = Aura;
    type MinimumPeriod = MinimumPeriod;
    type WeightInfo = ();
}

impl pallet_balances::Config for Runtime {
    type RuntimeEvent = RuntimeEvent;
    type Balance = Balance;
    type DustRemoval = ();
    type ExistentialDeposit = ExistentialDeposit;
    type AccountStore = System;
    type WeightInfo = pallet_balances::weights::SubstrateWeight<Runtime>;
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
    pub const UsdcAssetId: AssetId = USDC_ASSET_ID;
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
    type ForceOrigin = frame_system::EnsureNever<AccountId>;
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
    type WeightInfo = pallet_assets::weights::SubstrateWeight<Runtime>;
    type RemoveItemsLimit = ConstU32<1_000>;
    #[cfg(feature = "runtime-benchmarks")]
    type BenchmarkHelper = AssetBenchmarkHelper;
}

#[cfg(feature = "runtime-benchmarks")]
pub struct AssetBenchmarkHelper;
#[cfg(feature = "runtime-benchmarks")]
impl pallet_assets::BenchmarkHelper<AssetId, ()> for AssetBenchmarkHelper {
    fn create_asset_id_parameter(id: u32) -> AssetId {
        id
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

impl pallet_transaction_payment::Config for Runtime {
    type RuntimeEvent = RuntimeEvent;
    type OnChargeTransaction = pallet_transaction_payment::FungibleAdapter<Balances, ()>;
    type WeightToFee = IdentityFee<Balance>;
    type LengthToFee = IdentityFee<Balance>;
    type FeeMultiplierUpdate = ();
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
        if asset_id != USDC_ASSET_ID {
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

impl pallet_asset_tx_payment::Config for Runtime {
    type RuntimeEvent = RuntimeEvent;
    type Fungibles = ForeignAssets;
    type OnChargeAssetTransaction =
        pallet_asset_tx_payment::FungiblesAdapter<LiveFeeConversion, ()>;
    type WeightInfo = ();
    #[cfg(feature = "runtime-benchmarks")]
    type BenchmarkHelper = AssetTxBenchmarkHelper;
}

#[cfg(feature = "runtime-benchmarks")]
pub struct AssetTxBenchmarkHelper;
#[cfg(feature = "runtime-benchmarks")]
impl pallet_asset_tx_payment::BenchmarkHelperTrait<AccountId, AssetId, AssetId>
    for AssetTxBenchmarkHelper
{
    fn create_asset_id_parameter(id: u32) -> (AssetId, AssetId) {
        (id, id)
    }
    fn setup_balances_and_pool(_: AssetId, _: AccountId) {}
}

parameter_types! {
    pub const PreimageBaseDeposit: Balance = currency::VIT_EXISTENTIAL_DEPOSIT;
    pub const PreimageByteDeposit: Balance = 1;
    pub const PreimageHoldReason: RuntimeHoldReason = RuntimeHoldReason::Preimage(pallet_preimage::HoldReason::Preimage);
}

impl pallet_preimage::Config for Runtime {
    type RuntimeEvent = RuntimeEvent;
    type WeightInfo = ();
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

/// A8 owns user scheduling authority. B1a deliberately admits no external
/// scheduler origin; referenda use the scheduler's internal trait API.
pub struct PendingSchedulerOrigin;
impl frame_support::traits::EnsureOrigin<RuntimeOrigin> for PendingSchedulerOrigin {
    type Success = ();
    fn try_origin(origin: RuntimeOrigin) -> Result<(), RuntimeOrigin> {
        Err(origin)
    }
    #[cfg(feature = "runtime-benchmarks")]
    fn try_successful_origin() -> Result<RuntimeOrigin, ()> {
        Err(())
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
    type ScheduleOrigin = PendingSchedulerOrigin;
    type MaxScheduledPerBlock = ConstU32<50>;
    type WeightInfo = ();
    type OriginPrivilegeCmp = EqualPrivilegeOnly;
    type Preimages = Preimage;
    type BlockNumberProvider = System;
}

impl pallet_utility::Config for Runtime {
    type RuntimeEvent = RuntimeEvent;
    type RuntimeCall = RuntimeCall;
    type PalletsOrigin = <RuntimeOrigin as frame_support::traits::OriginTrait>::PalletsOrigin;
    type WeightInfo = pallet_utility::weights::SubstrateWeight<Runtime>;
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
    type WeightInfo = ();
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
    type WeightInfo = ();
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

pub struct MigrationProgressMarkerStorage;
impl StorageInstance for MigrationProgressMarkerStorage {
    fn pallet_prefix() -> &'static str {
        "BleavitRuntimeMigration"
    }
    const STORAGE_PREFIX: &'static str = "ProgressMarker";
}
pub type MigrationProgressMarker = frame_support::storage::types::StorageValue<
    MigrationProgressMarkerStorage,
    ([u8; 32], BlockNumber),
    frame_support::pallet_prelude::OptionQuery,
>;

const MIGRATION_FAILURE_HALT: u8 = 0b001;
const MIGRATION_STALL_HALT: u8 = 0b010;
const APPLIED_DETECTION_HALT: u8 = 0b100;
const UPGRADE_ABORT_TRIGGER: u8 = 0b1000;
const EXECUTION_HALT_SOURCES: u8 =
    MIGRATION_FAILURE_HALT | MIGRATION_STALL_HALT | APPLIED_DETECTION_HALT;

fn sync_execution_migration_halt(sources: u8) {
    pallet_execution_guard::MigrationHalt::<Runtime>::put(sources & EXECUTION_HALT_SOURCES != 0);
}

fn set_migration_halt_source(source: u8) {
    let sources = MigrationHaltSources::mutate(|sources| {
        *sources |= source;
        *sources
    });
    sync_execution_migration_halt(sources);
}

fn clear_migration_halt_sources(mask: u8) {
    let remaining = MigrationHaltSources::mutate(|sources| {
        *sources &= !mask;
        *sources
    });
    sync_execution_migration_halt(remaining);
}

fn active_migration_marker(cursor: &pallet_migrations::ActiveCursorOf<Runtime>) -> [u8; 32] {
    // `started_at` is lifecycle metadata, not cursor progress. Track the MBM
    // index and the migration-owned cursor bytes that `step` actually returns.
    sp_io::hashing::blake2_256(&(cursor.index, &cursor.inner_cursor).encode())
}

fn active_migration_stall_is_live(cursor: &pallet_migrations::ActiveCursorOf<Runtime>) -> bool {
    MigrationProgressMarker::get().is_some_and(|(marker, since)| {
        marker == active_migration_marker(cursor)
            && System::block_number().saturating_sub(since) > kernel::MIGRATION_STALL_BLOCKS
    })
}

fn track_migration_progress() {
    let now = System::block_number();
    match pallet_migrations::Cursor::<Runtime>::get() {
        Some(pallet_migrations::MigrationCursor::Active(cursor)) => {
            let marker = active_migration_marker(&cursor);
            match MigrationProgressMarker::get() {
                Some((previous, since)) if previous == marker => {
                    // A lawful `SteppedMigration::step` may mutate storage yet
                    // return identical cursor bytes. Such work lasting >900
                    // blocks can conservatively false-trigger this bounded,
                    // deterministic tracker. The halt self-clears when
                    // `completed()` fires; the normative semantic definition
                    // of "stalled" remains an open specification question.
                    if now.saturating_sub(since) > kernel::MIGRATION_STALL_BLOCKS {
                        set_migration_halt_source(MIGRATION_STALL_HALT);
                    }
                }
                _ => MigrationProgressMarker::put((marker, now)),
            }
        }
        Some(pallet_migrations::MigrationCursor::Stuck) => {
            // The failure callback normally records this first. Seeing an
            // externally restored stuck cursor is still a machine trigger.
            set_migration_halt_source(MIGRATION_FAILURE_HALT);
            MigrationProgressMarker::kill();
        }
        None => MigrationProgressMarker::kill(),
    }
}

fn migration_validation_hook_weight() -> Weight {
    // `remark_with_event` is the stable2603 benchmarked linear hash-of-bytes
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
        MigrationProgressMarker::kill();
        // MBM completion clears only migration failure/stall sources. An
        // applied-code mismatch remains halted until a later valid applied
        // callback resolves that condition. The additional try-state-before-
        // lift coupling is intentionally still an open specification question.
        clear_migration_halt_sources(MIGRATION_FAILURE_HALT | MIGRATION_STALL_HALT);
    }
}

impl pallet_migrations::Config for Runtime {
    type RuntimeEvent = RuntimeEvent;
    #[cfg(not(feature = "runtime-benchmarks"))]
    type Migrations = ();
    #[cfg(feature = "runtime-benchmarks")]
    type Migrations = pallet_migrations::mock_helpers::MockedMigrations;
    type CursorMaxLen = ConstU32<{ bounds::MIGRATION_CURSOR_MAX_LEN }>;
    type IdentifierMaxLen = ConstU32<{ bounds::MIGRATION_IDENTIFIER_MAX_LEN }>;
    type MigrationStatusHandler = MigrationStatusToGuard;
    type FailedMigrationHandler = MigrationFailureToGuard;
    type MaxServiceWeight = MigrationMaxServiceWeight;
    type WeightInfo = pallet_migrations::weights::SubstrateWeight<Runtime>;
}

impl pallet_sudo::Config for Runtime {
    type RuntimeEvent = RuntimeEvent;
    type RuntimeCall = RuntimeCall;
    type WeightInfo = ();
}

parameter_types! {
    pub const ReservedXcmpWeight: Weight = MAXIMUM_BLOCK_WEIGHT.saturating_div(4);
    pub const ReservedDmpWeight: Weight = MAXIMUM_BLOCK_WEIGHT.saturating_div(4);
    pub const RelayOrigin: cumulus_primitives_core::AggregateMessageOrigin = cumulus_primitives_core::AggregateMessageOrigin::Parent;
}
impl cumulus_pallet_parachain_system::Config for Runtime {
    type WeightInfo = ();
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
}
impl staging_parachain_info::Config for Runtime {}

mod xcm_config {
    use super::*;
    use staging_xcm::latest::prelude::*;
    use staging_xcm_builder::{FixedWeightBounds, FrameTransactionalProcessor};
    use staging_xcm_executor::XcmExecutor;

    parameter_types! {
        pub UniversalLocation: InteriorLocation = Parachain(staging_parachain_info::Pallet::<Runtime>::parachain_id().into()).into();
        pub UnitWeightCost: Weight = Weight::from_parts(1_000_000_000, 64 * 1024);
        pub const MaxInstructions: u32 = 100;
        pub const MaxAssetsIntoHolding: u32 = 64;
    }
    pub struct XcmConfig;
    impl staging_xcm_executor::Config for XcmConfig {
        type RuntimeCall = RuntimeCall;
        type XcmSender = ();
        type XcmEventEmitter = PolkadotXcm;
        type AssetTransactor = ();
        type OriginConverter = ();
        type IsReserve = ();
        type IsTeleporter = ();
        type UniversalLocation = UniversalLocation;
        type Barrier = ();
        type Weigher = FixedWeightBounds<UnitWeightCost, RuntimeCall, MaxInstructions>;
        type Trader = ();
        type ResponseHandler = PolkadotXcm;
        type AssetTrap = PolkadotXcm;
        type SubscriptionService = PolkadotXcm;
        type PalletInstancesInfo = crate::AllPalletsWithSystem;
        type MaxAssetsIntoHolding = MaxAssetsIntoHolding;
        type AssetLocker = ();
        type AssetExchanger = ();
        type FeeManager = ();
        type MessageExporter = ();
        type UniversalAliases = Nothing;
        type CallDispatcher = RuntimeCall;
        type SafeCallFilter = Nothing;
        type Aliasers = Nothing;
        type TransactionalProcessor = FrameTransactionalProcessor;
        type HrmpNewChannelOpenRequestHandler = ();
        type HrmpChannelAcceptedHandler = ();
        type HrmpChannelClosingHandler = ();
        type XcmRecorder = PolkadotXcm;
    }
    pub type Executor = XcmExecutor<XcmConfig>;
}

parameter_types! {
    pub MessageQueueServiceWeight: Weight = Perbill::from_percent(35) * RuntimeBlockWeights::get().max_block;
}
impl pallet_message_queue::Config for Runtime {
    type RuntimeEvent = RuntimeEvent;
    type WeightInfo = ();
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
    type WeightInfo = ();
    type PriceForSiblingDelivery = polkadot_runtime_common::xcm_sender::NoPriceForMessageDelivery<
        cumulus_primitives_core::ParaId,
    >;
}

impl pallet_xcm::Config for Runtime {
    type RuntimeEvent = RuntimeEvent;
    type SendXcmOrigin = staging_xcm_builder::EnsureXcmOrigin<RuntimeOrigin, ()>;
    type XcmRouter = ();
    type ExecuteXcmOrigin = staging_xcm_builder::EnsureXcmOrigin<RuntimeOrigin, ()>;
    type XcmExecuteFilter = Nothing;
    type XcmExecutor = xcm_config::Executor;
    type XcmTeleportFilter = Nothing;
    type XcmReserveTransferFilter = Nothing;
    type Weigher = staging_xcm_builder::FixedWeightBounds<
        xcm_config::UnitWeightCost,
        RuntimeCall,
        xcm_config::MaxInstructions,
    >;
    type UniversalLocation = xcm_config::UniversalLocation;
    type RuntimeOrigin = RuntimeOrigin;
    type RuntimeCall = RuntimeCall;
    const VERSION_DISCOVERY_QUEUE_SIZE: u32 = 100;
    type AdvertisedXcmVersion = pallet_xcm::CurrentXcmVersion;
    type Currency = Balances;
    type CurrencyMatcher = ();
    type TrustedLockers = ();
    type SovereignAccountOf = ();
    type MaxLockers = ConstU32<0>;
    type WeightInfo = pallet_xcm::TestWeightInfo;
    type AdminOrigin = EnsureRoot<AccountId>;
    type MaxRemoteLockConsumers = ConstU32<0>;
    type RemoteLockConsumerIdentifier = ();
    type AuthorizedAliasConsideration = ();
}
impl cumulus_pallet_xcm::Config for Runtime {
    type RuntimeEvent = RuntimeEvent;
    type XcmExecutor = xcm_config::Executor;
}

impl cumulus_pallet_aura_ext::Config for Runtime {}
impl pallet_authorship::Config for Runtime {
    type FindAuthor = pallet_session::FindAccountFromAuthorIndex<Self, Aura>;
    type EventHandler = (CollatorSelection,);
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
    type WeightInfo = ();
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
    type WeightInfo = ();
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
// **Values-track collapse (PR #57 Codex-bot P1).** Stock `pallet-referenda`
// selects the track from the proposal origin (`track_for`), so the five 06 §2.1
// tracks that all produce `ConstitutionalValues` (metric/constitution/
// entrenched/guardian/ratify) collapse onto ONE track. To ensure no values
// action enacts below its required bar, the shared track uses the **strongest
// (entrenched) thresholds** — 80% approval, 20%→10% support (06 §2.1 entrenched
// row). Over-strict but G-1-safe; `OracleResolution` keeps its own track. True
// per-track discrimination (distinct enactment origins + per-call track scope)
// is the values-layer milestone (SQ-103). `CV_*` therefore = entrenched values.
pub(crate) const CV_APPROVAL: pallet_referenda::Curve =
    pallet_referenda::Curve::make_linear(1, 1, percent(80), percent(80));
pub(crate) const CV_SUPPORT: pallet_referenda::Curve =
    pallet_referenda::Curve::make_linear(1, 1, percent(10), percent(20));
pub(crate) const ORACLE_APPROVAL: pallet_referenda::Curve =
    pallet_referenda::Curve::make_linear(1, 1, percent(60), percent(60));
pub(crate) const ORACLE_SUPPORT: pallet_referenda::Curve =
    pallet_referenda::Curve::make_linear(1, 1, percent(3), percent(10));
const TRACKS: [pallet_referenda::Track<u16, Balance, u32>; 2] = [
    pallet_referenda::Track {
        id: 0,
        info: pallet_referenda::TrackInfo {
            // The shared ConstitutionalValues track at entrenched strength (the
            // strongest 06 §2.1 values track): 50,000-VIT deposit, 7 d/28 d/7 d,
            // 4-epoch enactment (approximated at the 21-day default epoch).
            name: sp_runtime::str_array("constitutional_values"),
            max_deciding: 10,
            decision_deposit: 50_000 * currency::VIT,
            prepare_period: 7 * BLOCKS_PER_DAY,
            decision_period: 28 * BLOCKS_PER_DAY,
            confirm_period: 7 * BLOCKS_PER_DAY,
            min_enactment_period: 4 * 21 * BLOCKS_PER_DAY,
            min_approval: CV_APPROVAL,
            min_support: CV_SUPPORT,
        },
    },
    pallet_referenda::Track {
        id: 1,
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
        let candidate: Result<pallet_origins::Origin, _> = origin.clone().try_into();
        match candidate {
            Ok(pallet_origins::Origin::ConstitutionalValues) => Ok(0),
            Ok(pallet_origins::Origin::OracleResolution) => Ok(1),
            _ => Err(()),
        }
    }
}

parameter_types! {
    pub const SubmissionDeposit: Balance = currency::VIT;
    pub const MaxQueued: u32 = 100;
    pub const UndecidingTimeout: u32 = 7 * BLOCKS_PER_DAY;
    pub const AlarmInterval: u32 = 10;
    pub const MaxTurnout: Balance = currency::VIT_TOTAL_SUPPLY;
    pub const VoteLockingPeriod: u32 = 32 * BLOCKS_PER_WEEK;
}
impl pallet_referenda::Config for Runtime {
    type RuntimeCall = RuntimeCall;
    type RuntimeEvent = RuntimeEvent;
    type WeightInfo = ();
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
    type WeightInfo = ();
    type Currency = Balances;
    type Polls = Referenda;
    type MaxTurnout = MaxTurnout;
    type MaxVotes = ConstU32<512>;
    type VoteLockingPeriod = VoteLockingPeriod;
    type BlockNumberProvider = System;
    type VotingHooks = ();
}

impl pallet_origins::Config for Runtime {
    type WeightInfo = ();
}

/// Shared fail-closed A8 epoch seam. Epoch zero is the reserved pre-genesis
/// sentinel; live epochs begin at one when A8 lands.
pub struct PendingEpochClock;
impl frame_support::traits::Get<EpochId> for PendingEpochClock {
    fn get() -> EpochId {
        0
    }
}

pub struct ConstitutionGovernanceOrigin;
impl frame_support::traits::EnsureOrigin<RuntimeOrigin> for ConstitutionGovernanceOrigin {
    type Success = pallet_constitution::ConstitutionOrigin;
    fn try_origin(origin: RuntimeOrigin) -> Result<Self::Success, RuntimeOrigin> {
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
impl pallet_constitution::Config for Runtime {
    type GovernanceOrigin = ConstitutionGovernanceOrigin;
    type CurrentEpoch = PendingEpochClock;
    type WeightInfo = pallet_constitution::weights::SubstrateWeight<Runtime>;
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
fn balance_param(name: &[u8]) -> Balance {
    let key = pallet_constitution::key16(name);
    match live_param(key) {
        Some(pallet_constitution::ParamValue::Balance(value)) => value,
        _ => match default_param(key) {
            Some(pallet_constitution::ParamValue::Balance(value)) => value,
            _ => 0,
        },
    }
}
fn fixed_param(name: &[u8]) -> u64 {
    let key = pallet_constitution::key16(name);
    match live_param(key) {
        Some(pallet_constitution::ParamValue::Fixed(value)) => value.0,
        _ => match default_param(key) {
            Some(pallet_constitution::ParamValue::Fixed(value)) => value.0,
            _ => 0,
        },
    }
}
fn u32_param(name: &[u8]) -> u32 {
    let key = pallet_constitution::key16(name);
    match live_param(key) {
        Some(pallet_constitution::ParamValue::U32(value)) => value,
        _ => match default_param(key) {
            Some(pallet_constitution::ParamValue::U32(value)) => value,
            _ => 0,
        },
    }
}
fn perbill_param(name: &[u8]) -> u32 {
    let key = pallet_constitution::key16(name);
    match live_param(key) {
        Some(pallet_constitution::ParamValue::Perbill(value)) => value,
        _ => match default_param(key) {
            Some(pallet_constitution::ParamValue::Perbill(value)) => value,
            _ => 0,
        },
    }
}
fn percent_param(name: &[u8]) -> u8 {
    let key = pallet_constitution::key16(name);
    match live_param(key) {
        Some(pallet_constitution::ParamValue::Percent(value)) => value,
        _ => match default_param(key) {
            Some(pallet_constitution::ParamValue::Percent(value)) => value,
            _ => 0,
        },
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

parameter_types! {
    pub const LedgerPalletId: PalletId = PalletId(*b"bl/ledgr");
    pub const MarketPalletId: PalletId = PalletId(*b"bl/mrket");
    pub const TreasuryPalletId: PalletId = PalletId(*b"bl/trsry");
    pub const IncidentPalletId: PalletId = PalletId(*b"bl/reg/i");
    pub const MilestonePalletId: PalletId = PalletId(*b"bl/reg/m");
}
pub fn market_account() -> AccountId {
    MarketPalletId::get().into_account_truncating()
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
/// A8 pending authority: no real origin is admitted before the epoch pallet
/// lands. Production (`try_origin`) always rejects — the G-1 fail-closed
/// direction for the `ResolveAuthority`/`MarketAdmin` seams that A8 will own.
///
/// Under `runtime-benchmarks` ONLY, a single sentinel account is accepted so
/// B5's benchmarks for the A8-authority-gated calls can construct a passing
/// origin (`try_successful_origin` returns exactly this account). This is gated
/// out of production, so the fail-closed guarantee is unaffected.
pub struct PendingA8Authority;
#[cfg(feature = "runtime-benchmarks")]
const A8_BENCH_ACCOUNT: [u8; 32] = [241; 32];
impl frame_support::traits::EnsureOrigin<RuntimeOrigin> for PendingA8Authority {
    type Success = ();
    fn try_origin(origin: RuntimeOrigin) -> Result<(), RuntimeOrigin> {
        #[cfg(feature = "runtime-benchmarks")]
        {
            let raw: Result<frame_system::RawOrigin<AccountId>, RuntimeOrigin> =
                origin.clone().into();
            if matches!(raw, Ok(frame_system::RawOrigin::Signed(who)) if who == AccountId32::new(A8_BENCH_ACCOUNT))
            {
                return Ok(());
            }
        }
        Err(origin)
    }
    #[cfg(feature = "runtime-benchmarks")]
    fn try_successful_origin() -> Result<RuntimeOrigin, ()> {
        Ok(RuntimeOrigin::signed(AccountId32::new(A8_BENCH_ACCOUNT)))
    }
}
pub struct ProtocolAccounts;
impl Contains<AccountId> for ProtocolAccounts {
    fn contains(who: &AccountId) -> bool {
        let accounts = [
            LedgerPalletId::get().into_account_truncating(),
            market_account(),
            book_account(),
            pol_account(),
            fee_account(),
            treasury_protocol_account(),
            insurance_account(),
            IncidentPalletId::get().into_account_truncating(),
            MilestonePalletId::get().into_account_truncating(),
            welfare_settlement_account(),
        ];
        accounts.contains(who)
    }
}
parameter_types! { pub InsuranceAccount: AccountId = insurance_account(); }
impl pallet_conditional_ledger::Config for Runtime {
    type Collateral = ForeignAssets;
    type UsdcAssetId = UsdcAssetId;
    type MarketAuthority = EnsureMarketAccount;
    type ResolveAuthority = PendingA8Authority;
    type SettleAuthority = EnsureWelfareAccount;
    type MinSplit = LedgerMinSplit;
    type PositionDeposit = LedgerPositionDeposit;
    type MaxPositionsPerAccount = ConstU32<{ bounds::MAX_ACCOUNT_POSITIONS }>;
    type ArchiveDelay = LedgerArchiveDelay;
    type ReapBatch = ConstU32<{ kernel::REAP_BATCH }>;
    type ProtocolAccounts = ProtocolAccounts;
    type InsuranceAccount = InsuranceAccount;
    type PalletId = LedgerPalletId;
    type KeeperRebate = FutarchyTreasury;
    type WeightInfo = pallet_conditional_ledger::weights::SubstrateWeight<Runtime>;
}
impl pallet_market::Config for Runtime {
    type WeightInfo = pallet_market::weights::SubstrateWeight<Runtime>;
    type Fee = MarketFee;
    type ObsInterval = MarketObsInterval;
    type Kappa1e9 = MarketKappa;
    type MarketAdmin = PendingA8Authority;
    type ArchiveDelay = LedgerArchiveDelay;
    type PalletId = MarketPalletId;
    type KeeperRebate = FutarchyTreasury;
    // Pending A8 decision-window lookup: classify unknown windows as General,
    // preserving the reserved tranche until the real adapter lands.
    type InDecisionWindow = Nothing;
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
/// A8 pending inputs deliberately return empty vectors, causing snapshot cranks
/// to reject instead of persisting a metric derived from absent inputs.
pub struct PendingMetricInputs;
impl pallet_welfare::MetricInputs for PendingMetricInputs {
    fn onchain_components(_: EpochId, _: u16) -> Vec<pallet_welfare::ComponentValue> {
        Vec::new()
    }
    fn incident_multiplier(epoch: EpochId) -> FixedU64 {
        // The IncidentRegistry aggregate IS the C_attested multiplier
        // (registry-core: an empty closed epoch records exactly 1.0). An
        // absent entry means the epoch is not closed yet; the neutral 1.0 is
        // returned because this pending seam is unreachable while
        // `onchain_components` is empty (snapshot cranks reject first) — A8's
        // real MetricInputs must instead gate snapshots on registry close-out
        // rather than fabricate a multiplier (returning 0 here would zero
        // C_attested outright, which is fail-destructive, not fail-safe).
        match pallet_registry::Aggregates::<Runtime>::get(epoch) {
            Some(value) => value,
            None => FixedU64(1_000_000_000),
        }
    }
    fn daily_components(_: EpochId, _: u8, _: u16) -> Vec<pallet_welfare::ComponentValue> {
        Vec::new()
    }
}
pub struct WelfareLedger;
impl pallet_welfare::LedgerSettlement for WelfareLedger {
    fn settle_scalar(pid: u64, score: FixedU64) -> frame_support::dispatch::DispatchResult {
        ConditionalLedger::settle_scalar(
            RuntimeOrigin::signed(welfare_settlement_account()),
            pid,
            score,
        )
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
        ConditionalLedger::settle_baseline(
            RuntimeOrigin::signed(welfare_settlement_account()),
            epoch,
            score,
        )
    }
}
impl pallet_welfare::Config for Runtime {
    type MetricGovernanceOrigin = pallet_origins::EnsureConstitutionalValues;
    type Params = WelfareParams;
    type MetricInputs = PendingMetricInputs;
    type Ledger = WelfareLedger;
    type CurrentEpoch = PendingEpochClock;
    type KeeperRebate = FutarchyTreasury;
    type WeightInfo = pallet_welfare::weights::SubstrateWeight<Runtime>;
    #[cfg(feature = "runtime-benchmarks")]
    type BenchmarkHelper = RuntimeBenchmarkHelper;
}

/// A8 pending reporting seam: welfare supplies known spec metadata, while a
/// zero window and stake keep new reports fail-closed until epoch timing lands.
pub struct PendingReporting;
impl pallet_oracle::ReportingContext for PendingReporting {
    fn report_window_end(_: EpochId) -> u32 {
        0
    }
    fn is_expected_spec_version(component: u16, epoch: EpochId, version: u16) -> bool {
        match pallet_welfare::MetricSpecs::<Runtime>::get(version) {
            Some(specs) => specs
                .iter()
                .any(|spec| spec.id == component && spec.activation_epoch <= epoch),
            None => false,
        }
    }
    fn stake_at_risk(_: u16, _: EpochId) -> Balance {
        0
    }
    fn expected_components(epoch: EpochId) -> Vec<(u16, u16)> {
        pallet_welfare::MetricSpecs::<Runtime>::iter()
            .flat_map(|(version, specs)| {
                specs.into_iter().filter_map(move |spec| {
                    (spec.activation_epoch <= epoch).then_some((spec.id, version))
                })
            })
            .collect()
    }
}
impl pallet_oracle::Config for Runtime {
    type AdjudicationOrigin = pallet_origins::EnsureOracleResolution;
    type Reporting = PendingReporting;
    // B4 pending probe-dispatch seam: `()` sends nothing, so every probe times
    // out fail-static (07 §8, I-24 — absence is never healthy). Swapped for
    // `bleavit_xcm::probe::XcmProbeDispatcher` when the stub XCM config below
    // (`xcm_config`: Barrier/AssetTransactor/Trader/XcmSender = ()) is replaced
    // by the bleavit-xcm components (the B4 runtime-integration follow-up).
    type ProbeDispatch = ();
    type KeeperRebate = FutarchyTreasury;
    type MaxRoundCloseBatch = ConstU32<{ kernel::TICK_BATCH }>;
    type WeightInfo = pallet_oracle::weights::SubstrateWeight<Runtime>;
    #[cfg(feature = "runtime-benchmarks")]
    type BenchmarkHelper = RuntimeBenchmarkHelper;
}

pub struct RegistryParams;
impl pallet_registry::RegistryParams for RegistryParams {
    fn bond_incident() -> Balance {
        balance_param(b"reg.bond_inc")
    }
    fn bond_milestone() -> Balance {
        balance_param(b"reg.bond_mile")
    }
}
pub struct OracleWatchtowers;
impl pallet_registry::WatchtowerRegistry<AccountId> for OracleWatchtowers {
    fn is_registered_watchtower(who: &AccountId) -> bool {
        pallet_oracle::Watchtowers::<Runtime>::contains_key(who)
    }
}
/// The current welfare shell has no external-component write endpoint. The
/// aggregate remains in registry storage and is pulled by `PendingMetricInputs`.
pub struct WelfarePullSink;
impl pallet_registry::WelfareSink for WelfarePullSink {
    fn note_external_component(
        _: registry_core::RegistryKind,
        _: EpochId,
        _: FixedU64,
    ) -> sp_runtime::DispatchResult {
        Ok(())
    }
}
/// A8 pending registry epoch seam: known welfare spec data is readable, but
/// the zero filing window and target authorize no new epoch filing activity.
pub struct PendingRegistryEpoch;
impl pallet_registry::EpochContext for PendingRegistryEpoch {
    fn filing_window_end(_: EpochId) -> u32 {
        0
    }
    fn frozen_spec_version(epoch: EpochId) -> u16 {
        pallet_welfare::MetricSpecs::<Runtime>::iter_keys()
            .filter(
                |version| match pallet_welfare::MetricSpecs::<Runtime>::get(version) {
                    Some(specs) => specs.iter().any(|spec| spec.activation_epoch <= epoch),
                    None => false,
                },
            )
            .max()
            .map_or(0, |version| version)
    }
    fn milestone_target(_: EpochId) -> u32 {
        0
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
            type Epoch = PendingRegistryEpoch;
            type ResolutionAuthority = pallet_origins::EnsureOracleResolution;
            type InsuranceAccount = InsuranceAccount;
            type PalletId = $id;
            type KeeperRebate = FutarchyTreasury;
            // SQ-76: registry archive reuses the live ledger archive key.
            type ArchiveDelay = LedgerArchiveDelay;
            type MaxFilingsPerEpoch = ConstU32<{ kernel::REG_MAX_FILINGS_EPOCH }>;
            type MaxEvidenceLen = ConstU32<32>;
            // Registry exposes only its B5 placeholder `WeightInfo for ()` today.
            type WeightInfo = ();
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
        // 13 §1 marks this as a benchmark-time formula, so genesis Params
        // deliberately omits it. Unlike the other adapters, do not consult
        // `genesis_params()` as a fallback: absent/wrong-kind means zero until
        // B5 installs a calibrated raw row (conservative no-outflow default).
        let key = pallet_constitution::key16(b"keeper.rebate");
        match live_param(key) {
            Some(pallet_constitution::ParamValue::Balance(value)) => value,
            _ => 0,
        }
    }
}

pub struct TreasuryRebatePayout;
impl pallet_futarchy_treasury::RebatePayout<AccountId> for TreasuryRebatePayout {
    fn pay(
        who: &AccountId,
        amount: Balance,
        line: pallet_futarchy_treasury::PayoutLine,
    ) -> frame_support::pallet_prelude::DispatchResult {
        let source = match line {
            pallet_futarchy_treasury::PayoutLine::Keeper => treasury_keeper_account(),
            pallet_futarchy_treasury::PayoutLine::Oracle => treasury_oracle_account(),
        };
        <ForeignAssets as Mutate<AccountId>>::transfer(
            USDC_ASSET_ID,
            &source,
            who,
            amount,
            Preservation::Preserve,
        )
        .map(|_| ())
    }

    fn pot_balance(line: pallet_futarchy_treasury::PayoutLine) -> Balance {
        let source = match line {
            pallet_futarchy_treasury::PayoutLine::Keeper => treasury_keeper_account(),
            pallet_futarchy_treasury::PayoutLine::Oracle => treasury_oracle_account(),
        };
        <ForeignAssets as Inspect<AccountId>>::balance(USDC_ASSET_ID, &source)
    }
}
/// B4 pending renewal-dispatch seam: fail-closed (G-1) — every
/// `execute_coretime_renewal` rolls back until the real
/// `bleavit_xcm::coretime::XcmRenewalDispatcher` is wired with the stub XCM
/// config swap (09 §4: an unwireable transfer must not consume the quote or
/// mark the period funded; the keeper simply retries once wired).
pub struct PendingRenewalDispatch;
impl pallet_futarchy_treasury::RenewalDispatch for PendingRenewalDispatch {
    fn dispatch_renewal(
        _period_index: u32,
        _amount: Balance,
    ) -> frame_support::dispatch::DispatchResult {
        Err(sp_runtime::DispatchError::Other(
            "coretime renewal XCM dispatch not wired yet (B4 runtime integration)",
        ))
    }
}
impl pallet_futarchy_treasury::Config for Runtime {
    type TreasuryOrigin = pallet_origins::EnsureFutarchyTreasury;
    type Params = TreasuryParams;
    // PendingEpochClock is fixed at epoch 0, so the keeper meter conservatively
    // has one total budget and cannot reset until the A8 runtime wiring swaps it.
    type CurrentEpoch = PendingEpochClock;
    type RenewalDispatch = PendingRenewalDispatch;
    type RebatePayout = TreasuryRebatePayout;
    type WeightInfo = pallet_futarchy_treasury::weights::SubstrateWeight<Runtime>;
    #[cfg(feature = "runtime-benchmarks")]
    type BenchmarkHelper = RuntimeBenchmarkHelper;
}

/// A8 pending guardian proposal-status seam: `Other` authorizes no action.
pub struct PendingGuardianStatus;
impl pallet_guardian::GuardianProposalStatus for PendingGuardianStatus {
    fn status(_: u64) -> (pallet_guardian::ProposalStatus, bool) {
        (pallet_guardian::ProposalStatus::Other, false)
    }
}
/// Guard-owned machine triggers that already have a production source. A8's
/// remaining trigger signals stay false until its reserved runtime slot lands.
pub struct RuntimeGuardianTriggers;
impl pallet_guardian::GuardianTriggers for RuntimeGuardianTriggers {
    fn current() -> pallet_guardian::TriggerState {
        pallet_guardian::TriggerState {
            // The relay-abort bit is guardian-visible but deliberately does
            // not freeze the normal re-proposal lane: Abort preserves the old
            // code and must not replace one wedge with another.
            migration_halt: MigrationHaltSources::get() != 0,
            ..pallet_guardian::TriggerState::none()
        }
    }
}
/// A8/referenda integration pending adapter. Empty guardian membership at B1a
/// genesis means no review can become overdue before the real adapter lands.
pub struct PendingGuardianScheduler;
impl pallet_guardian::GuardianReviewScheduler for PendingGuardianScheduler {
    fn schedule_review(_: u32) -> u32 {
        u32::MAX
    }
}
impl pallet_guardian::GuardianRecallScheduler for PendingGuardianScheduler {
    fn schedule_recall(_: u32) -> u32 {
        u32::MAX
    }
}
impl pallet_guardian::Config for Runtime {
    type ValuesOrigin = pallet_origins::EnsureConstitutionalValues;
    type CurrentEpoch = PendingEpochClock;
    type ProposalStatusProvider = PendingGuardianStatus;
    type TriggerProvider = RuntimeGuardianTriggers;
    type ReviewScheduler = PendingGuardianScheduler;
    type RecallScheduler = PendingGuardianScheduler;
    type WeightInfo = pallet_guardian::weights::SubstrateWeight<Runtime>;
    #[cfg(feature = "runtime-benchmarks")]
    type BenchmarkHelper = RuntimeBenchmarkHelper;
}
impl pallet_attestor::Config for Runtime {
    type ValuesOrigin = pallet_origins::EnsureConstitutionalValues;
    // Ratification shares ConstitutionalValues pending the stock-referenda track split SQ.
    type RatifyOrigin = pallet_origins::EnsureConstitutionalValues;
    type WeightInfo = pallet_attestor::weights::SubstrateWeight<Runtime>;
    #[cfg(feature = "runtime-benchmarks")]
    type BenchmarkHelper = RuntimeBenchmarkHelper;
}

// --- B6 execution-guard production wiring ---------------------------------

/// Test/benchmark-only payload commitment store for the reserved A8 seam.
/// Production has no key path at all and therefore returns `None` below.
#[cfg(any(test, feature = "runtime-benchmarks"))]
fn pending_epoch_payload_key(pid: futarchy_primitives::ProposalId) -> Vec<u8> {
    let mut key = b":bleavit:b6:epoch-payload:".to_vec();
    key.extend_from_slice(&pid.to_le_bytes());
    key
}

#[cfg(any(test, feature = "runtime-benchmarks"))]
fn note_pending_epoch_payload(
    pid: futarchy_primitives::ProposalId,
    hash: futarchy_primitives::H256,
) {
    sp_io::storage::set(&pending_epoch_payload_key(pid), &hash.encode());
}

#[cfg(test)]
pub(crate) fn set_test_execution_payload(
    pid: futarchy_primitives::ProposalId,
    hash: futarchy_primitives::H256,
) {
    note_pending_epoch_payload(pid, hash);
}

/// Slot 61 is intentionally still empty. This adapter makes every production
/// enqueue fail its immutable epoch commitment check and makes terminal
/// callbacks no-ops; only cfg-gated tests/benchmarks can seed a commitment.
pub struct PendingEpochHandoff;
impl pallet_execution_guard::EpochHandoff for PendingEpochHandoff {
    fn payload_hash(pid: futarchy_primitives::ProposalId) -> Option<futarchy_primitives::H256> {
        #[cfg(any(test, feature = "runtime-benchmarks"))]
        {
            sp_io::storage::get(&pending_epoch_payload_key(pid))
                .and_then(|bytes| Decode::decode(&mut &bytes[..]).ok())
        }
        #[cfg(not(any(test, feature = "runtime-benchmarks")))]
        {
            let _ = pid;
            None
        }
    }
    fn mark_executed(_: futarchy_primitives::ProposalId) -> DispatchResult {
        Ok(())
    }
    fn mark_failed_executed(_: futarchy_primitives::ProposalId) -> DispatchResult {
        Ok(())
    }
    fn retry_exhausted_to_measurement(_: futarchy_primitives::ProposalId) -> DispatchResult {
        Ok(())
    }
    fn reject_or_stale(
        _: futarchy_primitives::ProposalId,
        _: futarchy_primitives::RejectReason,
    ) -> DispatchResult {
        Ok(())
    }
    fn is_terminal(_: futarchy_primitives::ProposalId) -> bool {
        false
    }
}

/// Only A8 may enqueue (I-9). Until slot 61 is wired, production rejects every
/// origin. A sentinel exists solely in test/benchmark builds.
pub struct PendingExecutionEnqueueAuthority;
#[cfg(any(test, feature = "runtime-benchmarks"))]
const EXECUTION_ENQUEUE_TEST_ACCOUNT: [u8; 32] = [242; 32];
impl frame_support::traits::EnsureOrigin<RuntimeOrigin> for PendingExecutionEnqueueAuthority {
    type Success = ();
    fn try_origin(origin: RuntimeOrigin) -> Result<(), RuntimeOrigin> {
        #[cfg(any(test, feature = "runtime-benchmarks"))]
        {
            let raw: Result<frame_system::RawOrigin<AccountId>, RuntimeOrigin> =
                origin.clone().into();
            if matches!(raw, Ok(frame_system::RawOrigin::Signed(who)) if who == AccountId::new(EXECUTION_ENQUEUE_TEST_ACCOUNT))
            {
                return Ok(());
            }
        }
        Err(origin)
    }
    #[cfg(feature = "runtime-benchmarks")]
    fn try_successful_origin() -> Result<RuntimeOrigin, ()> {
        Ok(RuntimeOrigin::signed(AccountId::new(
            EXECUTION_ENQUEUE_TEST_ACCOUNT,
        )))
    }
}

#[cfg(test)]
pub(crate) fn test_execution_enqueue_origin() -> RuntimeOrigin {
    RuntimeOrigin::signed(AccountId::new(EXECUTION_ENQUEUE_TEST_ACCOUNT))
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
            ) && pallet_attestor::Members::<Runtime>::get()
                .iter()
                .any(|member| member.account == record.attestor && member.active)
        })
    }
    fn has_quorum(
        pid: futarchy_primitives::ProposalId,
        artifact_hash: futarchy_primitives::H256,
    ) -> bool {
        crate::Attestor::has_quorum(pid, artifact_hash)
    }
}

pub struct RuntimeGuardianState;
impl pallet_execution_guard::GuardianState for RuntimeGuardianState {
    fn rerun_held(pid: futarchy_primitives::ProposalId) -> bool {
        // Slot 61 is not wired, so the exact A8 `in_rerun` bit is not yet
        // available. Conservatively retain the hold while the dispatched
        // guardian action remains live; unlike `RerunUsed`, this is not a
        // lifetime veto on an adopted rerun that later re-enters the queue.
        pallet_guardian::PendingActions::<Runtime>::get()
            .iter()
            .any(|action| {
                action.dispatched
                    && matches!(
                        action.power,
                        pallet_guardian::GuardianPower::DelayOnce { pid: held }
                            | pallet_guardian::GuardianPower::ForceRerun { pid: held }
                            if held == pid
                    )
            })
    }
    fn ledger_freeze_active() -> bool {
        crate::Guardian::playbook_active(pallet_guardian::PlaybookId::LedgerFreeze)
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
            RuntimeCall::Constitution(pallet_constitution::Call::amend_registry { .. }) => {
                Self::enabled(class, pallet_constitution::Capability::AmendRegistry)
            }
            RuntimeCall::Constitution(pallet_constitution::Call::set_release_channel {
                ..
            }) => Self::enabled(class, pallet_constitution::Capability::SetReleaseChannel),
            RuntimeCall::System(frame_system::Call::authorize_upgrade { .. }) => {
                Self::enabled(class, pallet_constitution::Capability::AuthorizeUpgrade)
            }
            RuntimeCall::FutarchyTreasury(
                pallet_futarchy_treasury::Call::fund_budget_line { .. }
                | pallet_futarchy_treasury::Call::spend { .. }
                | pallet_futarchy_treasury::Call::open_stream { .. }
                | pallet_futarchy_treasury::Call::cancel_stream { .. }
                | pallet_futarchy_treasury::Call::issue_vit { .. }
                | pallet_futarchy_treasury::Call::recover_foreign { .. },
            ) => Self::enabled(class, pallet_constitution::Capability::TreasurySpend),
            _ => {
                let Ok(analysis) =
                    <RuntimeBatchDispatcher as pallet_execution_guard::BatchDispatcher<
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
            )
            | RuntimeCall::Sudo(
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
    fn fetch(hash: futarchy_primitives::H256) -> Option<Vec<u8>> {
        <Preimage as QueryPreimage>::fetch(&Hash::from(hash), None)
            .ok()
            .map(Cow::into_owned)
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
        target_spec_version: u32,
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
            pallet_constitution::RELEASE_CHANNEL_SPEC_VERSION,
            target_spec_version,
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
        // Tolerant clear (G-1/SQ-134, PR #65 P1): the caller has already
        // verified the installed `:code` hash and version — an applied
        // upgrade cannot be retried, so a writer-(b) `set_release_channel`
        // rewrite that no longer shows this pending upgrade must not wedge
        // `PendingUpgrade`. Writer (b)'s newer value is authoritative; leave
        // it untouched and let the guard record the application.
        if channel.pending_authorized_at() == 0 || channel.spec_version() != target_spec_version {
            return Ok(());
        }
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
    fn on_upgrade_aborted(target_spec_version: u32) -> DispatchResult {
        let channel = pallet_constitution::ReleaseChannel::<Runtime>::get();
        // Tolerant clear (G-1/SQ-131): a writer-(b) `set_release_channel`
        // rewrite during the in-flight upgrade is newer and authoritative —
        // leave it untouched and still let the guard restore its status quo.
        // Only a channel that still shows exactly this pending upgrade is
        // cleared (bump `updated_at`, zero pending, drop URGENT — the same
        // writer-(a) shape as the applied-path clear, SQ-133 offsets).
        if channel.pending_authorized_at() == 0 || channel.spec_version() != target_spec_version {
            return Ok(());
        }
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

fn guard_domain(
    domain: origins_core::CallDomain,
) -> Result<pallet_execution_guard::CallDomain, DispatchError> {
    match domain {
        origins_core::CallDomain::Public => Ok(pallet_execution_guard::CallDomain::Public),
        origins_core::CallDomain::Param => Ok(pallet_execution_guard::CallDomain::Param),
        origins_core::CallDomain::Treasury => Ok(pallet_execution_guard::CallDomain::Treasury),
        origins_core::CallDomain::Code => Ok(pallet_execution_guard::CallDomain::Code),
        origins_core::CallDomain::Meta => Ok(pallet_execution_guard::CallDomain::Meta),
        origins_core::CallDomain::InternalRoot => {
            Ok(pallet_execution_guard::CallDomain::InternalRootApplyUpgrade)
        }
        origins_core::CallDomain::Nobody
        | origins_core::CallDomain::ConstitutionalValues
        | origins_core::CallDomain::OracleResolution
        | origins_core::CallDomain::GuardianHold
        | origins_core::CallDomain::EmergencyPlaybook => {
            Err(DispatchError::Other("guard-inadmissible call domain"))
        }
    }
}

fn collect_guard_domains(
    call: &origins_core::RuntimeCall,
    domains: &mut pallet_execution_guard::ReDerivedDomains,
    nested_calls: &mut u32,
) -> DispatchResult {
    *nested_calls = nested_calls
        .checked_add(1)
        .ok_or(DispatchError::Other("guard nested-call overflow"))?;
    match call {
        origins_core::RuntimeCall::Leaf(domain) => {
            let domain = guard_domain(*domain)?;
            if !domains.contains(&domain) {
                domains
                    .try_push(domain)
                    .map_err(|_| DispatchError::Other("too many guard domains"))?;
            }
        }
        origins_core::RuntimeCall::UtilityBatch(calls)
        | origins_core::RuntimeCall::UtilityBatchAll(calls)
        | origins_core::RuntimeCall::UtilityForceBatch(calls) => {
            for call in calls {
                collect_guard_domains(call, domains, nested_calls)?;
            }
        }
        origins_core::RuntimeCall::UtilityDispatchAs(call)
        | origins_core::RuntimeCall::UtilityAsDerivative(call)
        | origins_core::RuntimeCall::UtilityWithWeight(call)
        | origins_core::RuntimeCall::Proxy(call)
        | origins_core::RuntimeCall::ProxyAnnounced(call)
        | origins_core::RuntimeCall::MultisigAsMulti(call)
        | origins_core::RuntimeCall::MultisigAsMultiThreshold1(call)
        | origins_core::RuntimeCall::Sudo(call) => {
            collect_guard_domains(&call.0, domains, nested_calls)?;
        }
        origins_core::RuntimeCall::Scheduler { call, .. } => {
            collect_guard_domains(&call.0, domains, nested_calls)?;
        }
        origins_core::RuntimeCall::MultisigApproveAsMulti => {}
    }
    Ok(())
}

fn guard_has_non_atomic_wrapper(call: &origins_core::RuntimeCall) -> bool {
    match call {
        origins_core::RuntimeCall::UtilityBatch(_)
        | origins_core::RuntimeCall::UtilityForceBatch(_)
        | origins_core::RuntimeCall::Sudo(_) => true,
        origins_core::RuntimeCall::UtilityBatchAll(calls) => {
            calls.iter().any(guard_has_non_atomic_wrapper)
        }
        origins_core::RuntimeCall::UtilityDispatchAs(call)
        | origins_core::RuntimeCall::UtilityAsDerivative(call)
        | origins_core::RuntimeCall::UtilityWithWeight(call)
        | origins_core::RuntimeCall::Proxy(call)
        | origins_core::RuntimeCall::ProxyAnnounced(call)
        | origins_core::RuntimeCall::MultisigAsMulti(call)
        | origins_core::RuntimeCall::MultisigAsMultiThreshold1(call) => {
            guard_has_non_atomic_wrapper(&call.0)
        }
        origins_core::RuntimeCall::Scheduler { call, .. } => guard_has_non_atomic_wrapper(&call.0),
        origins_core::RuntimeCall::Leaf(_) | origins_core::RuntimeCall::MultisigApproveAsMulti => {
            false
        }
    }
}

fn runtime_call_contains_apply(call: &RuntimeCall) -> bool {
    match call {
        RuntimeCall::System(frame_system::Call::apply_authorized_upgrade { .. }) => true,
        RuntimeCall::Utility(
            pallet_utility::Call::batch { calls }
            | pallet_utility::Call::batch_all { calls }
            | pallet_utility::Call::force_batch { calls },
        ) => calls.iter().any(runtime_call_contains_apply),
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
        )
        | RuntimeCall::Sudo(
            pallet_sudo::Call::sudo { call }
            | pallet_sudo::Call::sudo_unchecked_weight { call, .. },
        ) => runtime_call_contains_apply(call),
        _ => false,
    }
}

/// Exact stable2603 pre-write checks performed by
/// `cumulus_pallet_parachain_system::schedule_code_upgrade`. Frame-system
/// removes `AuthorizedUpgrade` before invoking `OnSetCode`, and a direct
/// dispatch is not transactional, so every typed Cumulus rejection must be
/// refused by the filter before frame-system can consume the authorization.
fn parachain_upgrade_preflight(code: &[u8]) -> DispatchResult {
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

pub struct RuntimeBatchDispatcher;
impl pallet_execution_guard::BatchDispatcher<RuntimeCall> for RuntimeBatchDispatcher {
    fn rederive_call(
        call: &RuntimeCall,
    ) -> Result<pallet_execution_guard::ReDerivedCall, DispatchError> {
        if Self::authorize_upgrade_hash(call).is_some() {
            let mut domains = pallet_execution_guard::ReDerivedDomains::default();
            domains
                .try_push(pallet_execution_guard::CallDomain::InternalRootAuthorizeUpgrade)
                .map_err(|_| DispatchError::Other("authorize domain bound"))?;
            return Ok(pallet_execution_guard::ReDerivedCall {
                domains,
                nested_calls: 1,
            });
        }
        let projected = crate::classifier::project_for_guard(call);
        let mut domains = pallet_execution_guard::ReDerivedDomains::default();
        let mut nested_calls = 0;
        collect_guard_domains(&projected, &mut domains, &mut nested_calls)?;
        if runtime_call_contains_apply(call)
            && !domains.contains(&pallet_execution_guard::CallDomain::InternalRootApplyUpgrade)
        {
            domains
                .try_push(pallet_execution_guard::CallDomain::InternalRootApplyUpgrade)
                .map_err(|_| DispatchError::Other("apply domain bound"))?;
        }
        Ok(pallet_execution_guard::ReDerivedCall {
            domains,
            nested_calls,
        })
    }

    fn safety_filter(class: futarchy_primitives::ProposalClass, call: &RuntimeCall) -> bool {
        let projected = crate::classifier::project_for_guard(call);
        if guard_has_non_atomic_wrapper(&projected) {
            return false;
        }
        origins_core::Origin::from_proposal_class(class).is_some_and(|origin| {
            crate::classifier::RuntimeBaseCallFilter::contains_for(origin, call)
        })
    }

    fn authorize_upgrade_hash(call: &RuntimeCall) -> Option<futarchy_primitives::H256> {
        match call {
            RuntimeCall::System(frame_system::Call::authorize_upgrade { code_hash }) => {
                Some(code_hash.0)
            }
            _ => None,
        }
    }

    fn dispatch_with_class_origin(
        call: RuntimeCall,
        class: futarchy_primitives::ProposalClass,
    ) -> DispatchResult {
        let class_origin =
            origins_core::Origin::from_proposal_class(class).ok_or(DispatchError::BadOrigin)?;
        if !crate::classifier::RuntimeBaseCallFilter::contains_for(class_origin, &call) {
            return Err(DispatchError::Other("guard dispatch-time safety filter"));
        }
        let origin = pallet_origins::Origin::from(class_origin);
        call.dispatch_bypass_filter(RuntimeOrigin::from(origin))
            .map(|_| ())
            .map_err(|error| error.error)
    }

    fn dispatch_authorize_upgrade(code_hash: futarchy_primitives::H256) -> DispatchResult {
        let call = RuntimeCall::System(frame_system::Call::authorize_upgrade {
            code_hash: Hash::from(code_hash),
        });
        call.dispatch_bypass_filter(RuntimeOrigin::root())
            .map(|_| ())
            .map_err(|error| error.error)
    }

    fn dispatch_apply_authorized_upgrade(code: Vec<u8>) -> DispatchResult {
        frame_support::storage::with_storage_layer(|| {
            parachain_upgrade_preflight(&code)?;

            // PB-MIGRATION's rollback is a forward remediation upgrade. The
            // stock frame-system preflight rejects every non-empty MBM cursor,
            // so only an actually stuck cursor, or a still-live active stall
            // backed by the migration failure/stall sources, is retired before
            // scheduling. Unrelated alarms and resumed/healthy active work do
            // not make a cursor disposable.
            let retire_cursor = match pallet_migrations::Cursor::<Runtime>::get() {
                Some(pallet_migrations::MigrationCursor::Stuck) => true,
                Some(pallet_migrations::MigrationCursor::Active(ref cursor)) => {
                    MigrationHaltSources::get() & (MIGRATION_FAILURE_HALT | MIGRATION_STALL_HALT)
                        != 0
                        && active_migration_stall_is_live(cursor)
                }
                None => false,
            };
            if retire_cursor {
                pallet_migrations::Cursor::<Runtime>::kill();
                MigrationProgressMarker::kill();
            } else {
                #[cfg(not(feature = "runtime-benchmarks"))]
                System::can_set_code(&code, true).into_result()?;
            }

            let call = RuntimeCall::System(frame_system::Call::apply_authorized_upgrade { code });
            call.dispatch(RuntimeOrigin::none())
                .map(|_| ())
                .map_err(|error| error.error)
        })
    }

    fn observed_runtime_version(
        code: &[u8],
    ) -> Option<futarchy_primitives::RuntimeVersionConstraint> {
        let decoded = sp_io::misc::runtime_version(code)
            .and_then(|bytes| sp_version::RuntimeVersion::decode(&mut &bytes[..]).ok());
        #[cfg(feature = "runtime-benchmarks")]
        let decoded = decoded.or_else(|| {
            let mut version = VERSION;
            version.spec_version = version.spec_version.saturating_add(1);
            Some(version)
        });
        let version = decoded?;
        let spec_name = futarchy_primitives::BoundedVec::<u8, 32>::try_from(
            version.spec_name.as_bytes().to_vec(),
        )
        .ok()?;
        Some(futarchy_primitives::RuntimeVersionConstraint {
            spec_name,
            spec_version: version.spec_version,
        })
    }

    fn checkpoint() -> (futarchy_primitives::H256, futarchy_primitives::H256) {
        let parent_hash = System::parent_hash().0;
        let root = sp_io::storage::root(VERSION.state_version());
        let state_root = Hash::decode(&mut &root[..]).map_or([0; 32], |hash| hash.0);
        (parent_hash, state_root)
    }
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
    let Some(observed) = <RuntimeBatchDispatcher as pallet_execution_guard::BatchDispatcher<
        RuntimeCall,
    >>::observed_runtime_version(code) else {
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
    version_matches && preflight_passes
}

fn scheduled_upgrade_aborted() -> bool {
    use cumulus_primitives_core::relay_chain::UpgradeGoAhead;

    let Some(pending) = pallet_execution_guard::pallet::PendingUpgrade::<Runtime>::get() else {
        return false;
    };
    if pallet_execution_guard::ScheduledUpgrade::<Runtime>::get() != Some(pending.hash)
        || !matches!(
            cumulus_pallet_parachain_system::UpgradeGoAhead::<Runtime>::get(),
            Some(UpgradeGoAhead::Abort)
        )
        || cumulus_pallet_parachain_system::PendingValidationCode::<Runtime>::exists()
    {
        return false;
    }
    // The scheduled latch surviving proves `on_validation_code_applied` did
    // not complete. The installed-code comparison independently separates an
    // Abort from the GoAhead path that consumed the same Cumulus pending key.
    sp_io::storage::get(sp_core::storage::well_known_keys::CODE)
        .map(|code| sp_io::hashing::blake2_256(&code) != pending.hash)
        .unwrap_or(true)
}

/// Cumulus calls this only after relay `GoAhead` has written the new `:code`.
/// Any missing/mismatched guard state raises PB-MIGRATION instead of claiming
/// that an untracked upgrade applied.
pub struct ExecutionGuardSystemEvent;
impl cumulus_pallet_parachain_system::OnSystemEvent for ExecutionGuardSystemEvent {
    fn on_validation_data(_: &cumulus_primitives_core::PersistedValidationData) {
        frame_system::Pallet::<Runtime>::register_extra_weight_unchecked(
            migration_validation_hook_weight(),
            DispatchClass::Mandatory,
        );
        // Called once by the mandatory parachain inherent before the
        // executive services the MBM cursor for this block. Comparing with
        // the prior marker is O(1) storage and bounded by CursorMaxLen.
        track_migration_progress();
        if scheduled_upgrade_aborted() {
            if crate::ExecutionGuard::validation_code_aborted().is_ok() {
                // Guardian-visible incident trigger, intentionally not an
                // execution-queue halt: the relay preserved status quo and a
                // fresh normal proposal must remain possible.
                set_migration_halt_source(UPGRADE_ABORT_TRIGGER);
            } else {
                // A failed status-quo cleanup is itself a halt-worthy applied
                // boundary mismatch; retain every pending record for review.
                set_migration_halt_source(UPGRADE_ABORT_TRIGGER | APPLIED_DETECTION_HALT);
            }
        }
    }
    fn on_validation_code_applied() {
        let valid =
            sp_io::storage::get(sp_core::storage::well_known_keys::CODE).is_some_and(|code| {
                let hash = sp_io::hashing::blake2_256(&code);
                let observed =
                    <RuntimeBatchDispatcher as pallet_execution_guard::BatchDispatcher<
                        RuntimeCall,
                    >>::observed_runtime_version(&code);
                pallet_execution_guard::pallet::PendingUpgrade::<Runtime>::get().is_some_and(
                    |pending| {
                        let current = pallet_execution_guard::CurrentSpecName::<Runtime>::get();
                        hash == pending.hash
                            && observed.is_some_and(|version| {
                                current.is_some_and(|current| {
                                    version.spec_name == current.spec_name
                                        && version.spec_version == pending.target_spec_version
                                })
                            })
                    },
                )
            });
        if !valid || crate::ExecutionGuard::validation_code_applied().is_err() {
            set_migration_halt_source(APPLIED_DETECTION_HALT);
        } else {
            MigrationFailedStep::kill();
            MigrationProgressMarker::kill();
            // A valid recovery image may intentionally carry zero MBMs, in
            // which case `MigrationStatusHandler::completed()` never fires.
            // Any MBM in the new image that later fails/stalls re-raises its
            // own source through the normal handlers.
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

impl pallet_execution_guard::Config for Runtime {
    type Epoch = PendingEpochHandoff;
    type EnqueueAuthority = PendingExecutionEnqueueAuthority;
    type Attestations = RuntimeAttestations;
    type KeeperRebate = FutarchyTreasury;
    type Guardian = RuntimeGuardianState;
    type Params = ExecutionParams;
    type Capabilities = RuntimeCapabilities;
    type UpgradeSchedule = RuntimeUpgradeSchedule;
    type Preimages = RuntimePreimages;
    type ReleaseChannel = RuntimeReleaseChannel;
    type RatifyOrigin = pallet_origins::EnsureConstitutionalValues;
    type Dispatcher = RuntimeBatchDispatcher;
    type MaxRuntimeCodeBytes = ConstU32<{ pallet_preimage::MAX_SIZE }>;
    type WeightInfo = pallet_execution_guard::weights::SubstrateWeight<Runtime>;
    #[cfg(feature = "runtime-benchmarks")]
    type BenchmarkHelper = RuntimeBenchmarkHelper;
}

#[cfg(feature = "runtime-benchmarks")]
pub struct RuntimeBenchmarkHelper;

#[cfg(feature = "runtime-benchmarks")]
impl pallet_constitution::BenchmarkHelper<RuntimeOrigin> for RuntimeBenchmarkHelper {
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
}
#[cfg(feature = "runtime-benchmarks")]
impl pallet_welfare::BenchmarkHelper<RuntimeOrigin> for RuntimeBenchmarkHelper {
    fn metric_governance_origin() -> RuntimeOrigin {
        pallet_origins::Origin::ConstitutionalValues.into()
    }
}
#[cfg(feature = "runtime-benchmarks")]
impl pallet_oracle::BenchmarkHelper<RuntimeOrigin> for RuntimeBenchmarkHelper {
    fn adjudication_origin() -> RuntimeOrigin {
        pallet_origins::Origin::OracleResolution.into()
    }
}
#[cfg(feature = "runtime-benchmarks")]
impl pallet_registry::BenchmarkHelper<RuntimeOrigin, AccountId> for RuntimeBenchmarkHelper {
    fn resolution_origin() -> RuntimeOrigin {
        pallet_origins::Origin::OracleResolution.into()
    }
    fn funded_account(seed: u8) -> AccountId {
        AccountId32::new([seed; 32])
    }
    fn register_watchtower(_: &AccountId) {}
}
#[cfg(feature = "runtime-benchmarks")]
impl pallet_futarchy_treasury::BenchmarkHelper<RuntimeOrigin, AccountId>
    for RuntimeBenchmarkHelper
{
    fn treasury_origin() -> RuntimeOrigin {
        pallet_origins::Origin::FutarchyTreasury.into()
    }
    fn account(seed: u8) -> AccountId {
        AccountId32::new([seed; 32])
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
    fn prime_for_worst_case() {}
}
#[cfg(feature = "runtime-benchmarks")]
impl pallet_attestor::BenchmarkHelper<RuntimeOrigin> for RuntimeBenchmarkHelper {
    fn signed(who: [u8; 32]) -> RuntimeOrigin {
        RuntimeOrigin::signed(AccountId32::new(who))
    }
    fn values() -> RuntimeOrigin {
        pallet_origins::Origin::ConstitutionalValues.into()
    }
    fn ratify() -> RuntimeOrigin {
        pallet_origins::Origin::ConstitutionalValues.into()
    }
}

#[cfg(feature = "runtime-benchmarks")]
fn benchmark_guard_enqueue(
    pid: futarchy_primitives::ProposalId,
    call: RuntimeCall,
    domain: pallet_execution_guard::CallDomain,
) -> Result<BlockNumber, DispatchError> {
    use frame_support::traits::StorePreimage;

    let batch =
        pallet_execution_guard::pallet::RuntimeBatch::<Runtime>::try_from(alloc::vec![call])
            .map_err(|_| DispatchError::Other("benchmark guard batch bound"))?;
    let bytes = batch.encode();
    let payload_len = u32::try_from(bytes.len())
        .map_err(|_| DispatchError::Other("benchmark guard payload length"))?;
    let hash = <Preimage as StorePreimage>::note(Cow::Owned(bytes))?;
    <Preimage as QueryPreimage>::request(&hash);
    note_pending_epoch_payload(pid, hash.0);

    let now = System::block_number();
    let maturity = now
        .checked_add(
            <ExecutionParams as pallet_execution_guard::Params>::exec_timelock(
                futarchy_primitives::ProposalClass::Param,
            ),
        )
        .ok_or(DispatchError::Arithmetic(
            sp_runtime::ArithmeticError::Overflow,
        ))?;
    let grace_end = maturity
        .checked_add(
            <ExecutionParams as pallet_execution_guard::Params>::exec_grace(
                futarchy_primitives::ProposalClass::Param,
            ),
        )
        .ok_or(DispatchError::Arithmetic(
            sp_runtime::ArithmeticError::Overflow,
        ))?;
    let version_constraint = pallet_execution_guard::CurrentSpecName::<Runtime>::get()
        .ok_or(DispatchError::Other("benchmark guard current version"))?;
    let declared_domains =
        pallet_execution_guard::pallet::StoredDomains::try_from(alloc::vec![domain])
            .map_err(|_| DispatchError::Other("benchmark guard domain bound"))?;
    crate::ExecutionGuard::enqueue(
        RuntimeOrigin::signed(AccountId::new(EXECUTION_ENQUEUE_TEST_ACCOUNT)),
        pallet_execution_guard::pallet::StoredQueuedExecution {
            pid,
            payload_hash: hash.0,
            payload_len,
            class: futarchy_primitives::ProposalClass::Param,
            maturity,
            grace_end,
            version_constraint,
            meters_declared: Default::default(),
            ratify_ref: None,
            ratification_passed: false,
            attestation_id: None,
            pre_upgrade_checkpoint: None,
            cancelled: false,
            declared_domains,
            failed_at: None,
        },
        false,
    )?;
    Ok(maturity)
}

#[cfg(feature = "runtime-benchmarks")]
impl pallet_execution_guard::BenchmarkHelper<RuntimeOrigin> for RuntimeBenchmarkHelper {
    fn ratify_origin() -> RuntimeOrigin {
        pallet_origins::Origin::ConstitutionalValues.into()
    }

    fn prime_ratify(pid: futarchy_primitives::ProposalId, _: u32) {
        note_pending_epoch_payload(pid, sp_io::hashing::blake2_256(&pid.encode()));
    }

    fn prime_execute(pid: futarchy_primitives::ProposalId) {
        let key = pallet_constitution::key16(b"mkt.obs_interval");
        let Some(mut record) = pallet_constitution::Params::<Runtime>::get(key) else {
            return;
        };
        record.cooldown_epochs = 0;
        pallet_constitution::Params::<Runtime>::insert(key, record);
        let call = RuntimeCall::Constitution(pallet_constitution::Call::set_param {
            key,
            value: record.value,
        });
        if let Ok(maturity) =
            benchmark_guard_enqueue(pid, call, pallet_execution_guard::CallDomain::Param)
        {
            System::set_block_number(maturity);
        }
    }

    fn prime_failed(pid: futarchy_primitives::ProposalId) {
        let call = RuntimeCall::System(frame_system::Call::remark {
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

    fn prime_pending_upgrade(code: &[u8]) {
        let hash = sp_io::hashing::blake2_256(code);
        let now = System::block_number();
        let _ = System::authorize_upgrade(RuntimeOrigin::root(), Hash::from(hash));
        pallet_execution_guard::pallet::PendingUpgrade::<Runtime>::put(
            pallet_execution_guard::PendingUpgrade {
                hash,
                authorized_at: now,
                applicable_at: now,
                target_spec_version: VERSION.spec_version.saturating_add(1),
            },
        );
    }

    fn prime_stale(pid: futarchy_primitives::ProposalId) {
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
