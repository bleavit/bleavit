//! Configuration for the standalone client-para runtime.

use frame_support::{
    derive_impl, parameter_types,
    traits::{
        ConstBool, ConstU32, ConstU64, Contains, EnsureOrigin, Equals, Everything, Nothing,
        OriginTrait, TransformOrigin,
    },
    weights::{constants::RocksDbWeight, Weight},
};
use frame_system::{
    limits::{BlockLength, BlockWeights},
    EnsureRoot,
};
use sp_consensus_aura::sr25519::AuthorityId as AuraId;
use sp_runtime::{traits::AccountIdLookup, AccountId32, Perbill};
use staging_xcm::latest::{InteriorLocation, Junction, Location, NetworkId, OriginKind};
use staging_xcm_builder::{
    AccountId32Aliases, EnsureXcmOrigin, FixedWeightBounds, FrameTransactionalProcessor,
    SignedToAccountId32,
};
use staging_xcm_executor::{traits::ConvertOrigin, XcmExecutor};

use crate::{
    AccountId, Aura, Balance, Balances, Block, BlockNumber, ConsensusHook, MessageQueue,
    PalletInfo, ParachainSystem, Runtime, RuntimeCall, RuntimeEvent, RuntimeFreezeReason,
    RuntimeHoldReason, RuntimeOrigin, RuntimeTask, SessionKeys, System, XcmpQueue,
    MILLISECS_PER_BLOCK, VERSION,
};

const NORMAL_DISPATCH_RATIO: Perbill = Perbill::from_percent(75);
const MAXIMUM_BLOCK_WEIGHT: Weight = Weight::from_parts(2_000_000_000_000, 5 * 1024 * 1024);

parameter_types! {
    pub const Version: sp_version::RuntimeVersion = VERSION;
    pub RuntimeBlockLength: BlockLength = BlockLength::builder()
        .max_length(5 * 1024 * 1024)
        .modify_max_length_for_class(frame_support::dispatch::DispatchClass::Normal, |m| {
            *m = NORMAL_DISPATCH_RATIO * *m
        })
        .build();
    pub RuntimeBlockWeights: BlockWeights = BlockWeights::builder()
        .base_block(frame_support::weights::constants::BlockExecutionWeight::get())
        .for_class(frame_support::dispatch::DispatchClass::all(), |w| {
            w.base_extrinsic = frame_support::weights::constants::ExtrinsicBaseWeight::get()
        })
        .for_class(frame_support::dispatch::DispatchClass::Normal, |w| {
            w.max_total = Some(NORMAL_DISPATCH_RATIO * MAXIMUM_BLOCK_WEIGHT)
        })
        .for_class(frame_support::dispatch::DispatchClass::Operational, |w| {
            w.max_total = Some(MAXIMUM_BLOCK_WEIGHT);
            w.reserved = Some(MAXIMUM_BLOCK_WEIGHT - NORMAL_DISPATCH_RATIO * MAXIMUM_BLOCK_WEIGHT);
        })
        .build_or_panic();
    pub const Ss58Prefix: u16 = crate::SS58_PREFIX;
    pub const MinimumPeriod: u64 = crate::MILLISECS_PER_BLOCK / 2;
    pub const ExistentialDeposit: Balance = 1;
    pub const SessionPeriod: u32 = 10;
    pub const SessionOffset: u32 = 0;
    pub const MaxReports: u32 = 128;
    pub const ClientId: futarchy_primitives::ClientId = 1;
    pub const RegistrationFeeBuffer: Balance = 2_000_000_000_000;
    pub const XcmFee: Balance = 1_000_000_000;
    pub const WindowLead: BlockNumber = 20;
    pub BleavitLocation: Location = Location::new(1, [Junction::Parachain(4242)]);
    pub UsdcLocation: Location = Location::new(
        1,
        [Junction::Parachain(1000), Junction::PalletInstance(50), Junction::GeneralIndex(1337)],
    );
    pub RefundLocation: Location = Location::new(1, [Junction::Parachain(4343)]);
    pub UniversalLocation: InteriorLocation = [
        Junction::GlobalConsensus(NetworkId::Polkadot),
        Junction::Parachain(4343),
    ].into();
    pub const UnitWeightCost: Weight = Weight::from_parts(1_000_000_000, 64 * 1024);
    pub const MaxInstructions: u32 = 32;
    pub const MaxAssetsIntoHolding: u32 = 8;
    pub AnyNetwork: Option<NetworkId> = None;
    pub BleavitSovereignAccount: AccountId = AccountId32::new([0x42; 32]);
    pub RelayOrigin: cumulus_primitives_core::AggregateMessageOrigin =
        cumulus_primitives_core::AggregateMessageOrigin::Parent;
    pub MessageQueueServiceWeight: Weight = Perbill::from_percent(35) * RuntimeBlockWeights::get().max_block;
}

#[derive_impl(frame_system::config_preludes::ParaChainDefaultConfig)]
impl frame_system::Config for Runtime {
    type BaseCallFilter = Everything;
    type AccountId = AccountId;
    type Lookup = AccountIdLookup<AccountId, ()>;
    type Nonce = crate::Nonce;
    type Hash = crate::Hash;
    type Block = Block;
    type Version = Version;
    type AccountData = pallet_balances::AccountData<Balance>;
    type DbWeight = RocksDbWeight;
    type BlockWeights = RuntimeBlockWeights;
    type BlockLength = RuntimeBlockLength;
    type SS58Prefix = Ss58Prefix;
    type OnSetCode = cumulus_pallet_parachain_system::ParachainSetCode<Self>;
    type MaxConsumers = ConstU32<16>;
}

impl pallet_timestamp::Config for Runtime {
    type Moment = u64;
    type OnTimestampSet = Aura;
    type MinimumPeriod = MinimumPeriod;
    type WeightInfo = ();
}

#[derive_impl(pallet_balances::config_preludes::TestDefaultConfig)]
impl pallet_balances::Config for Runtime {
    type AccountStore = System;
    type Balance = Balance;
    type ExistentialDeposit = ExistentialDeposit;
    type RuntimeEvent = RuntimeEvent;
}

impl pallet_sudo::Config for Runtime {
    type RuntimeEvent = RuntimeEvent;
    type RuntimeCall = RuntimeCall;
    type WeightInfo = ();
}

impl cumulus_pallet_parachain_system::Config for Runtime {
    type WeightInfo = ();
    type RuntimeEvent = RuntimeEvent;
    type OnSystemEvent = ();
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

parameter_types! {
    pub const ReservedXcmpWeight: Weight = Weight::from_parts(500_000_000_000, 1_310_720);
    pub const ReservedDmpWeight: Weight = Weight::from_parts(500_000_000_000, 1_310_720);
}

impl staging_parachain_info::Config for Runtime {}

/// The only inbound XCM origin accepted by the client runtime.
pub struct BleavitOriginConverter;
impl ConvertOrigin<RuntimeOrigin> for BleavitOriginConverter {
    fn convert_origin(
        origin: impl Into<Location>,
        kind: OriginKind,
    ) -> Result<RuntimeOrigin, Location> {
        let origin = origin.into();
        if kind == OriginKind::Xcm && origin == BleavitLocation::get() {
            Ok(RuntimeOrigin::signed(BleavitSovereignAccount::get()))
        } else {
            Err(origin)
        }
    }
}

pub struct ClientReportCallFilter;
impl Contains<RuntimeCall> for ClientReportCallFilter {
    fn contains(call: &RuntimeCall) -> bool {
        matches!(
            call,
            RuntimeCall::BleavitClient(pallet_bleavit_client::Call::receive_report { .. })
        )
    }
}

pub struct ClientXcmConfig;
impl staging_xcm_executor::Config for ClientXcmConfig {
    type RuntimeCall = RuntimeCall;
    type XcmSender = ();
    type XcmEventEmitter = ();
    type AssetTransactor = ();
    type OriginConverter = BleavitOriginConverter;
    type IsReserve = ();
    type IsTeleporter = ();
    type UniversalLocation = UniversalLocation;
    type Barrier = staging_xcm_builder::AllowUnpaidExecutionFrom<Equals<BleavitLocation>>;
    type Weigher = FixedWeightBounds<UnitWeightCost, RuntimeCall, MaxInstructions>;
    type Trader = ();
    type ResponseHandler = ();
    type AssetTrap = ();
    type SubscriptionService = ();
    type PalletInstancesInfo = crate::AllPalletsWithSystem;
    type MaxAssetsIntoHolding = MaxAssetsIntoHolding;
    type AssetLocker = ();
    type AssetExchanger = ();
    type FeeManager = ();
    type MessageExporter = ();
    type UniversalAliases = Nothing;
    type CallDispatcher = RuntimeCall;
    type SafeCallFilter = ClientReportCallFilter;
    type Aliasers = Nothing;
    type TransactionalProcessor = FrameTransactionalProcessor;
    type HrmpNewChannelOpenRequestHandler = ();
    type HrmpChannelAcceptedHandler = ();
    type HrmpChannelClosingHandler = ();
    type XcmRecorder = ();
}

pub type ClientXcmExecutor = XcmExecutor<ClientXcmConfig>;

/// The raw sender exists only so the local integration drill can submit
/// deliberately malformed programs and prove Bleavit refuses them. The
/// production client path never reaches this pallet.
pub type LocalOriginToLocation = SignedToAccountId32<RuntimeOrigin, AccountId, AnyNetwork>;
pub type ClientSovereignAccountOf = AccountId32Aliases<AnyNetwork, AccountId>;

impl pallet_xcm::Config for Runtime {
    type RuntimeEvent = RuntimeEvent;
    type SendXcmOrigin = EnsureXcmOrigin<RuntimeOrigin, LocalOriginToLocation>;
    type XcmRouter = XcmpQueue;
    type ExecuteXcmOrigin = EnsureXcmOrigin<RuntimeOrigin, LocalOriginToLocation>;
    type XcmExecuteFilter = Nothing;
    type XcmExecutor = ClientXcmExecutor;
    type XcmTeleportFilter = Nothing;
    type XcmReserveTransferFilter = Nothing;
    type Weigher = FixedWeightBounds<UnitWeightCost, RuntimeCall, MaxInstructions>;
    type UniversalLocation = UniversalLocation;
    type RuntimeOrigin = RuntimeOrigin;
    type RuntimeCall = RuntimeCall;
    const VERSION_DISCOVERY_QUEUE_SIZE: u32 = 16;
    type AdvertisedXcmVersion = pallet_xcm::CurrentXcmVersion;
    type TrustedLockers = ();
    type SovereignAccountOf = ClientSovereignAccountOf;
    type Currency = Balances;
    type CurrencyMatcher = ();
    type MaxLockers = ConstU32<0>;
    type MaxRemoteLockConsumers = ConstU32<0>;
    type RemoteLockConsumerIdentifier = ();
    type WeightInfo = pallet_xcm::TestWeightInfo;
    type AdminOrigin = EnsureRoot<AccountId>;
    type AuthorizedAliasConsideration = ();
}

pub struct EnsureBleavitOrigin;
impl EnsureOrigin<RuntimeOrigin> for EnsureBleavitOrigin {
    type Success = AccountId;

    fn try_origin(origin: RuntimeOrigin) -> Result<Self::Success, RuntimeOrigin> {
        match origin.as_system_ref() {
            Some(frame_system::RawOrigin::Signed(who))
                if who == &BleavitSovereignAccount::get() =>
            {
                Ok(who.clone())
            }
            _ => Err(origin),
        }
    }
}

impl pallet_message_queue::Config for Runtime {
    type RuntimeEvent = RuntimeEvent;
    type WeightInfo = ();
    type MessageProcessor = staging_xcm_builder::ProcessXcmMessage<
        cumulus_primitives_core::AggregateMessageOrigin,
        ClientXcmExecutor,
        RuntimeCall,
    >;
    type Size = u32;
    type QueueChangeHandler = ();
    type QueuePausedQuery = ();
    type HeapSize = ConstU32<{ 64 * 1024 }>;
    type MaxStale = ConstU32<8>;
    type ServiceWeight = MessageQueueServiceWeight;
    type IdleMaxServiceWeight = ();
}

pub struct ControllerOriginConverter;
impl ConvertOrigin<RuntimeOrigin> for ControllerOriginConverter {
    fn convert_origin(
        origin: impl Into<Location>,
        _: OriginKind,
    ) -> Result<RuntimeOrigin, Location> {
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

impl cumulus_pallet_xcm::Config for Runtime {
    type RuntimeEvent = RuntimeEvent;
    type XcmExecutor = ClientXcmExecutor;
}

impl cumulus_pallet_aura_ext::Config for Runtime {}

impl pallet_authorship::Config for Runtime {
    type FindAuthor = pallet_session::FindAccountFromAuthorIndex<Self, Aura>;
    type EventHandler = ();
}

impl pallet_session::Config for Runtime {
    type RuntimeEvent = RuntimeEvent;
    type ValidatorId = AccountId;
    type ValidatorIdOf = pallet_collator_selection::IdentityCollator;
    type ShouldEndSession = pallet_session::PeriodicSessions<SessionPeriod, SessionOffset>;
    type NextSessionRotation = pallet_session::PeriodicSessions<SessionPeriod, SessionOffset>;
    type SessionManager = ();
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
    type MaxAuthorities = ConstU32<100>;
    type AllowMultipleBlocksPerSlot = ConstBool<true>;
    type SlotDuration = ConstU64<{ MILLISECS_PER_BLOCK }>;
}

impl pallet_bleavit_client::Config for Runtime {
    type BleavitLocation = BleavitLocation;
    type UsdcLocation = UsdcLocation;
    type RefundLocation = RefundLocation;
    type ClientId = ClientId;
    type RegistrationFeeBuffer = RegistrationFeeBuffer;
    type XcmFee = XcmFee;
    type WindowLead = WindowLead;
    type XcmSender = XcmpQueue;
    type BleavitOrigin = EnsureBleavitOrigin;
    // This standalone reference runtime has no application operator origin;
    // keep the drop-in pallet fail-closed until a client adds governance.
    type SpendingOrigin = EnsureRoot<AccountId>;
    type ReportPruneOrigin = EnsureRoot<AccountId>;
    type OnReport = ();
    type MaxReports = MaxReports;
    type WeightInfo = pallet_bleavit_client::weights::SubstrateWeight<Runtime>;
}

pub fn session_keys(aura: AuraId) -> SessionKeys {
    SessionKeys { aura }
}
