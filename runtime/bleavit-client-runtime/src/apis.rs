use alloc::vec::Vec;

use frame_support::genesis_builder_helper::{build_state, get_preset};
use sp_api::impl_runtime_apis;
use sp_consensus_aura::sr25519::AuthorityId as AuraId;
use sp_core::{crypto::KeyTypeId, OpaqueMetadata};
use sp_runtime::{
    traits::Block as BlockT,
    transaction_validity::{TransactionSource, TransactionValidity},
    ApplyExtrinsicResult,
};
use sp_session::OpaqueGeneratedSessionKeys;

use crate::{
    AccountId, Block, ConsensusHook, Executive, InherentDataExt, Nonce, ParachainSystem, Runtime,
    RuntimeGenesisConfig, SessionKeys, System, VERSION,
};

impl Runtime {
    fn slot_duration_impl() -> sp_consensus_aura::SlotDuration {
        sp_consensus_aura::SlotDuration::from_millis(crate::MILLISECS_PER_BLOCK)
    }

    fn can_build_upon_impl(
        included_hash: <Block as BlockT>::Hash,
        slot: cumulus_primitives_aura::Slot,
    ) -> bool {
        ConsensusHook::can_build_upon(included_hash, slot)
    }
}

impl_runtime_apis! {
    impl sp_api::Core<Block> for Runtime {
        fn version() -> sp_version::RuntimeVersion { VERSION }
        fn execute_block(block: <Block as BlockT>::LazyBlock) { Executive::execute_block(block) }
        fn initialize_block(header: &<Block as BlockT>::Header) -> sp_runtime::ExtrinsicInclusionMode {
            Executive::initialize_block(header)
        }
    }

    impl sp_api::Metadata<Block> for Runtime {
        fn metadata() -> OpaqueMetadata { OpaqueMetadata::new(Runtime::metadata().into()) }
        fn metadata_at_version(version: u32) -> Option<OpaqueMetadata> { Runtime::metadata_at_version(version) }
        fn metadata_versions() -> Vec<u32> { Runtime::metadata_versions() }
    }

    impl frame_support::view_functions::runtime_api::RuntimeViewFunction<Block> for Runtime {
        fn execute_view_function(
            id: frame_support::view_functions::ViewFunctionId,
            input: Vec<u8>,
        ) -> Result<Vec<u8>, frame_support::view_functions::ViewFunctionDispatchError> {
            Runtime::execute_view_function(id, input)
        }
    }

    impl sp_block_builder::BlockBuilder<Block> for Runtime {
        fn apply_extrinsic(extrinsic: <Block as BlockT>::Extrinsic) -> ApplyExtrinsicResult {
            Executive::apply_extrinsic(extrinsic)
        }
        fn finalize_block() -> <Block as BlockT>::Header { Executive::finalize_block() }
        fn inherent_extrinsics(data: sp_inherents::InherentData) -> Vec<<Block as BlockT>::Extrinsic> {
            data.create_extrinsics()
        }
        fn check_inherents(
            block: <Block as BlockT>::LazyBlock,
            data: sp_inherents::InherentData,
        ) -> sp_inherents::CheckInherentsResult {
            data.check_extrinsics(&block)
        }
    }

    impl sp_transaction_pool::runtime_api::TaggedTransactionQueue<Block> for Runtime {
        fn validate_transaction(
            source: TransactionSource,
            tx: <Block as BlockT>::Extrinsic,
            block_hash: <Block as BlockT>::Hash,
        ) -> TransactionValidity { Executive::validate_transaction(source, tx, block_hash) }
    }

    impl sp_offchain::OffchainWorkerApi<Block> for Runtime {
        fn offchain_worker(header: &<Block as BlockT>::Header) { Executive::offchain_worker(header) }
    }

    impl sp_session::SessionKeys<Block> for Runtime {
        fn generate_session_keys(owner: Vec<u8>, seed: Option<Vec<u8>>) -> OpaqueGeneratedSessionKeys {
            SessionKeys::generate(&owner, seed).into()
        }
        fn decode_session_keys(encoded: Vec<u8>) -> Option<Vec<(Vec<u8>, KeyTypeId)>> {
            SessionKeys::decode_into_raw_public_keys(&encoded)
        }
    }

    impl sp_consensus_aura::AuraApi<Block, AuraId> for Runtime {
        fn slot_duration() -> sp_consensus_aura::SlotDuration { Runtime::slot_duration_impl() }
        fn authorities() -> Vec<AuraId> { pallet_aura::Authorities::<Runtime>::get().into_inner() }
    }

    impl cumulus_primitives_aura::AuraUnincludedSegmentApi<Block> for Runtime {
        fn can_build_upon(
            included_hash: <Block as BlockT>::Hash,
            slot: cumulus_primitives_aura::Slot,
        ) -> bool { Runtime::can_build_upon_impl(included_hash, slot) }
    }

    impl cumulus_primitives_core::RelayParentOffsetApi<Block> for Runtime {
        fn relay_parent_offset() -> u32 { 0 }
        fn max_claim_queue_offset() -> u8 { ParachainSystem::max_claim_queue_offset() }
    }

    impl cumulus_primitives_core::GetParachainInfo<Block> for Runtime {
        fn parachain_id() -> cumulus_primitives_core::ParaId {
            staging_parachain_info::Pallet::<Runtime>::parachain_id()
        }
    }

    impl cumulus_primitives_core::KeyToIncludeInRelayProof<Block> for Runtime {
        fn keys_to_prove() -> cumulus_primitives_core::RelayProofRequest { Default::default() }
    }

    impl cumulus_primitives_core::CollectCollationInfo<Block> for Runtime {
        fn collect_collation_info(header: &<Block as BlockT>::Header) -> cumulus_primitives_core::CollationInfo {
            ParachainSystem::collect_collation_info(header)
        }
    }

    impl frame_system_rpc_runtime_api::AccountNonceApi<Block, AccountId, Nonce> for Runtime {
        fn account_nonce(account: AccountId) -> Nonce { System::account_nonce(account) }
    }

    impl sp_genesis_builder::GenesisBuilder<Block> for Runtime {
        fn build_state(config: Vec<u8>) -> sp_genesis_builder::Result {
            build_state::<RuntimeGenesisConfig>(config)
        }
        fn get_preset(id: &Option<sp_genesis_builder::PresetId>) -> Option<Vec<u8>> {
            get_preset::<RuntimeGenesisConfig>(id, crate::genesis::get_preset)
        }
        fn preset_names() -> Vec<sp_genesis_builder::PresetId> { crate::genesis::preset_names() }
    }
}
