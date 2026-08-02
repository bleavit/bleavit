use alloc::{string::String, vec, vec::Vec};

use cumulus_primitives_core::ParaId;
use frame_support::build_struct_json_patch;
use serde_json::Value;
use sp_consensus_aura::sr25519::AuthorityId as AuraId;
use sp_genesis_builder::PresetId;
use sp_runtime::AccountId32;

use crate::{
    configs::session_keys, AccountId, BalancesConfig, ParachainInfoConfig, RuntimeGenesisConfig,
    SessionConfig, SudoConfig,
};

pub const ALICE_PUBLIC: [u8; 32] = [
    0xd4, 0x35, 0x93, 0xc7, 0x15, 0xfd, 0xd3, 0x1c, 0x61, 0x14, 0x1a, 0xbd, 0x04, 0xa9, 0x9f, 0xd6,
    0x82, 0x2c, 0x85, 0x58, 0x85, 0x4c, 0xcd, 0xe3, 0x9a, 0x56, 0x84, 0xe7, 0xa5, 0x6d, 0xa2, 0x7d,
];
pub const BOB_PUBLIC: [u8; 32] = [
    0x8e, 0xaf, 0x04, 0x15, 0x16, 0x87, 0x73, 0x63, 0x26, 0xc9, 0xfe, 0xa1, 0x7e, 0x25, 0xfc, 0x52,
    0x87, 0x61, 0x36, 0x93, 0xc9, 0x12, 0x90, 0x9c, 0xb2, 0x26, 0xaa, 0x47, 0x94, 0xf2, 0x6a, 0x48,
];

fn account(bytes: [u8; 32]) -> AccountId {
    AccountId32::new(bytes)
}

fn aura(bytes: [u8; 32]) -> AuraId {
    AuraId::from(sp_core::sr25519::Public::from_raw(bytes))
}

fn genesis() -> Value {
    let alice = account(ALICE_PUBLIC);
    let bob = account(BOB_PUBLIC);
    build_struct_json_patch!(RuntimeGenesisConfig {
        balances: BalancesConfig {
            balances: vec![
                (alice.clone(), 1_000_000_000_000),
                (bob.clone(), 1_000_000_000_000)
            ],
        },
        parachain_info: ParachainInfoConfig {
            parachain_id: ParaId::from(4343)
        },
        sudo: SudoConfig {
            // The harness exercises the reference pallet through an explicit
            // governance wrapper; the pallet itself remains EnsureRoot.
            key: Some(alice.clone())
        },
        session: SessionConfig {
            keys: vec![
                (alice.clone(), alice, session_keys(aura(ALICE_PUBLIC))),
                (bob.clone(), bob, session_keys(aura(BOB_PUBLIC))),
            ],
        },
    })
}

pub fn get_preset(id: &PresetId) -> Option<Vec<u8>> {
    match id.as_ref() {
        sp_genesis_builder::DEV_RUNTIME_PRESET
        | sp_genesis_builder::LOCAL_TESTNET_RUNTIME_PRESET => serde_json::to_string(&genesis())
            .ok()
            .map(String::into_bytes),
        _ => None,
    }
}

pub fn preset_names() -> Vec<PresetId> {
    vec![
        PresetId::from(sp_genesis_builder::DEV_RUNTIME_PRESET),
        PresetId::from(sp_genesis_builder::LOCAL_TESTNET_RUNTIME_PRESET),
    ]
}
