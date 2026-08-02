#![cfg_attr(not(feature = "std"), no_std)]
#![deny(unsafe_code)]
#![recursion_limit = "256"]

//! Minimal parachain runtime used by the N10 integration harness.
//!
//! This is intentionally a separate runtime crate. It is a client example
//! and never participates in Bleavit's production `construct_runtime!`.

extern crate alloc;

use alloc::borrow::Cow;
#[cfg(not(feature = "std"))]
use alloc::vec::Vec;
use frame_support::construct_runtime;
use sp_runtime::{
    generic,
    traits::{BlakeTwo256, IdentifyAccount, Verify},
    MultiAddress, MultiSignature,
};
use sp_version::RuntimeVersion;

#[cfg(feature = "std")]
include!(concat!(env!("OUT_DIR"), "/wasm_binary.rs"));

pub type Signature = MultiSignature;
pub type AccountId = <<Signature as Verify>::Signer as IdentifyAccount>::AccountId;
pub type Balance = u128;
pub type Nonce = u32;
pub type Hash = sp_core::H256;
pub type BlockNumber = u32;
pub type Address = MultiAddress<AccountId, ()>;
pub type Header = generic::Header<BlockNumber, BlakeTwo256>;

pub const MILLISECS_PER_BLOCK: u64 = 6_000;
pub const SS58_PREFIX: u16 = 7778;
pub const RUNTIME_SPEC_NAME: &[u8] = b"bleavit-client";
pub const RUNTIME_IMPL_NAME: &[u8] = b"bleavit-client-runtime";
pub const RUNTIME_SPEC_VERSION: u32 = 1;
pub const TRANSACTION_VERSION: u32 = 1;

#[sp_version::runtime_version]
pub const VERSION: RuntimeVersion = RuntimeVersion {
    spec_name: Cow::Borrowed("bleavit-client"),
    impl_name: Cow::Borrowed("bleavit-client-runtime"),
    authoring_version: 1,
    spec_version: 1,
    impl_version: 0,
    apis: apis::RUNTIME_API_VERSIONS,
    transaction_version: 1,
    system_version: 1,
};

#[cfg(feature = "std")]
pub fn native_version() -> sp_version::NativeVersion {
    sp_version::NativeVersion {
        runtime_version: VERSION,
        can_author_with: Default::default(),
    }
}

pub type TxExtension = (
    frame_system::CheckNonZeroSender<Runtime>,
    frame_system::CheckSpecVersion<Runtime>,
    frame_system::CheckTxVersion<Runtime>,
    frame_system::CheckGenesis<Runtime>,
    frame_system::CheckEra<Runtime>,
    frame_system::CheckNonce<Runtime>,
    frame_system::CheckWeight<Runtime>,
);

pub type UncheckedExtrinsic =
    generic::UncheckedExtrinsic<Address, RuntimeCall, Signature, TxExtension>;
pub type Block = generic::Block<Header, UncheckedExtrinsic>;

pub mod opaque {
    use super::{BlockNumber, Header};
    use sp_runtime::{generic, traits::BlakeTwo256, OpaqueExtrinsic};

    pub type UncheckedExtrinsic = OpaqueExtrinsic;
    pub type Block = generic::Block<Header, UncheckedExtrinsic>;
    pub type BlockId = generic::BlockId<Block>;
    pub type Hash = <BlakeTwo256 as sp_runtime::traits::Hash>::Output;
    pub type Number = BlockNumber;
}

sp_runtime::impl_opaque_keys! {
    pub struct SessionKeys {
        pub aura: Aura,
    }
}

construct_runtime!(
    pub enum Runtime {
        System: frame_system = 0,
        Timestamp: pallet_timestamp = 1,
        ParachainSystem: cumulus_pallet_parachain_system = 2,
        ParachainInfo: staging_parachain_info = 3,

        Balances: pallet_balances = 10,
        XcmpQueue: cumulus_pallet_xcmp_queue = 30,
        MessageQueue: pallet_message_queue = 31,
        CumulusXcm: cumulus_pallet_xcm = 32,
        // Harness-only raw sender used by the negative ingress drill. A real
        // client never needs this pallet: it calls BleavitClient instead.
        PolkadotXcm: pallet_xcm = 33,

        Authorship: pallet_authorship = 40,
        Session: pallet_session = 42,
        Aura: pallet_aura = 43,
        AuraExt: cumulus_pallet_aura_ext = 44,

        // Slot 66 is deliberate: the receiver call is the frozen client ABI.
        BleavitClient: pallet_bleavit_client = 66,
    }
);

pub type Executive = frame_executive::Executive<
    Runtime,
    Block,
    frame_system::ChainContext<Runtime>,
    Runtime,
    AllPalletsWithSystem,
>;

pub(crate) const UNINCLUDED_SEGMENT_CAPACITY: u32 = 3;
pub(crate) const BLOCK_PROCESSING_VELOCITY: u32 = 1;
pub(crate) const RELAY_CHAIN_SLOT_DURATION_MILLIS: u32 = 6_000;

pub(crate) type ConsensusHook = cumulus_pallet_aura_ext::FixedVelocityConsensusHook<
    Runtime,
    RELAY_CHAIN_SLOT_DURATION_MILLIS,
    BLOCK_PROCESSING_VELOCITY,
    UNINCLUDED_SEGMENT_CAPACITY,
>;

cumulus_pallet_parachain_system::register_validate_block! {
    Runtime = Runtime,
    BlockExecutor = cumulus_pallet_aura_ext::BlockExecutor::<Runtime, Executive>,
}

mod apis;
pub mod configs;
pub mod genesis;
