//! The storage-key fixture — 02 §7, 10 §5.1 (F18).
//!
//! ## What this exists to catch
//!
//! Every read this client makes is a storage key it built itself, and a wrong
//! storage key **does not fail**. It returns no value, and an absent value is
//! indistinguishable from an account that holds nothing. A mis-hashed
//! `ForeignAssets.Account` key and a genuinely empty balance produce the same
//! screen: *0 USDC*. So the whole class of key-construction defects is silent,
//! and silent in the direction that tells the user something false about their
//! own money.
//!
//! `app/packages/chain-client/src/storage-keys.ts` therefore shipped with the
//! **prefix half only** (V-156). The prefix is `twox128(pallet) ++ twox128(item)`
//! and `app/fixtures/chainhead/` certifies it completely — the recorder reads
//! whole maps with `descendantsValues`, so all 65 recorded keys are exactly 32
//! bytes. That same fact is why the corpus certifies *nothing whatever* about
//! hasher application: it never issued a key that used one.
//!
//! That left two ways to build the args half, and both were worse than not
//! having one — test it against the corpus, which exercises no hasher, or test
//! it against `@polkadot-api/substrate-bindings`, which is the library the
//! builder is made of. This file is the third way: the runtime states what its
//! own keys are, and the client is checked against that.
//!
//! ## Why `hashed_key_for`, and not a re-implementation
//!
//! Every full key here comes from the storage type itself. Nothing in this file
//! hashes a pallet name or applies a hasher by hand, because a fixture that
//! re-implemented the derivation would agree with its own mistakes and pin them
//! into the client. `Positions::<Runtime>::hashed_key_for(..)` is the key the
//! node will serve, by construction.
//!
//! ## Why the pre-images are published too
//!
//! The established reason — see `tests_multisig_derivation.rs` and
//! `crates/market-core/src/quote_agreement.rs`: publishing only the answer makes
//! every disagreement look identical. A wrong hasher, a key encoded at the wrong
//! width and a key hashed as a tuple when it should have been hashed
//! per-element all present as *"the keys differ"*. With the pre-images, a client
//! whose pre-images match and whose key does not has a **hashing** problem, and
//! one whose pre-images differ has an **encoding** problem — which is the
//! failure that actually happens.
//!
//! ## The cases, and what each is the only one to catch
//!
//! - `constitution_phase_flags` — a plain value. No hasher at all: the 32-byte
//!   prefix *is* the key. It is the control that keeps the prefix half honest.
//! - `epoch_proposals` — one `Blake2_128Concat` over a fixed-width primitive.
//! - `scheduler_agenda` — one `Twox64Concat`. The other hasher on the read
//!   surface, and the one a client that only ever tested balances never meets.
//! - `welfare_snapshots` — a **single** map whose key is a tuple. ONE hash over
//!   the encoded pair.
//! - `ledger_positions` — a **double** map. TWO hashes, each with its own
//!   concat suffix. Against `welfare_snapshots` this is the pair that matters:
//!   the two shapes are indistinguishable in doc 02's type column (`(A, B) → V`
//!   both ways), they produce different keys, and a client that picked the
//!   wrong one reads a key that is well-formed and belongs to nobody.
//! - `service_ledger_positions` — the same item in another instance. Same
//!   hashers, same key, different prefix; a client that resolved instances by
//!   item name alone would serve one domain's balances under the other's label,
//!   which 11 §11.2a rule 2 makes a wrong number rather than a missing one.
//! - `oracle_rounds` — an N-map with THREE keys.
//! - `foreign_assets_account` — key 1 is an XCM `Location`, **not** the `u32`
//!   Asset Hub uses for the same logical asset (02 §7.7). Variable-length SCALE
//!   in key position, and the exact place the deposit flow reads.
//! - `system_account` — the SDK map every balance read on either chain goes
//!   through.
//!
//! ## What the `hashers` section is for
//!
//! Two of the four surfaces the F18 funding reads touch live on **Asset Hub**,
//! whose storage types this runtime cannot name. Their keys therefore cannot
//! come from `hashed_key_for` here, and publishing raw `(input, output)` pairs
//! is what lets the client build them from a hasher it has been shown to
//! compute correctly.
//!
//! The inputs are chosen for the concat property specifically: `Blake2_128Concat`
//! is a 16-byte digest **followed by the input**, and a client that emitted the
//! digest alone produces a key that is a *prefix* of the right one — which
//! `descendantsValues` answers, returning the whole map instead of one entry.
//! That is not a missing balance; it is somebody else's.
//!
//! Regenerate with `BLEAVIT_WRITE_STORAGE_KEY_FIXTURE=1 cargo test -p bleavit-runtime
//! storage_key`.

use parity_scale_codec::Encode;
use sp_core::crypto::AccountId32;

use futarchy_primitives::{Branch, PositionId, PositionKind, ScalarSide};

use crate::Runtime;

/// Where the fixture lives, relative to this crate.
const FIXTURE: &str = "fixtures/storage-keys.json";

/// Schema id. Rows are append-only within a major.
const SCHEMA: &str = "bleavit.storage-keys.v1";

fn hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(2 + bytes.len() * 2);
    out.push_str("0x");
    for byte in bytes {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

/// A deterministic account. Byte 0 carries the seed and the rest vary, so a
/// client that compared only a prefix would still be wrong.
fn account(seed: u8) -> AccountId32 {
    let mut bytes = [0u8; 32];
    bytes[0] = seed;
    for (index, byte) in bytes.iter_mut().enumerate().skip(1) {
        *byte = seed.wrapping_mul(index as u8).wrapping_add(index as u8);
    }
    AccountId32::new(bytes)
}

/// One published entry: the metadata names, the per-key hashers, the SCALE
/// pre-image of each key, and the full key the node serves.
struct Entry {
    name: &'static str,
    /// The pallet name **as `construct_runtime!` publishes it in metadata** —
    /// which is not always the pallet crate's name. The ledger's two instances
    /// are `ConditionalLedger` and `ServiceLedger`, and the twox128 that opens
    /// every key is taken over exactly this string.
    pallet: &'static str,
    item: &'static str,
    /// Per key position, in key order. Empty for a plain value.
    hashers: Vec<&'static str>,
    /// SCALE pre-images, in key order. One per hasher.
    preimages: Vec<Vec<u8>>,
    /// A human-readable statement of the key, so a reader can see what was hashed.
    key_description: String,
    /// The full key, from the storage type itself.
    key: Vec<u8>,
}

const BLAKE2_128_CONCAT: &str = "Blake2_128Concat";
const TWOX_64_CONCAT: &str = "Twox64Concat";

fn entries() -> Vec<Entry> {
    let holder = account(7);
    let position = PositionId::Proposal {
        proposal: 4_242,
        branch: Branch::Accept,
        kind: PositionKind::Long,
    };
    // The other variant, whose SCALE encoding is a different length — a client
    // that treated a position id as fixed-width passes the first and not this.
    let baseline_position = PositionId::Baseline {
        epoch: 9,
        side: ScalarSide::Short,
    };
    let usdc = crate::usdc_location();

    vec![
        Entry {
            name: "constitution_phase_flags",
            pallet: "Constitution",
            item: "PhaseFlags",
            hashers: vec![],
            preimages: vec![],
            key_description: "plain value; the 32-byte prefix is the whole key".into(),
            key: pallet_constitution::PhaseFlags::<Runtime>::hashed_key().to_vec(),
        },
        Entry {
            name: "epoch_proposals",
            pallet: "Epoch",
            item: "Proposals",
            hashers: vec![BLAKE2_128_CONCAT],
            preimages: vec![4_242u64.encode()],
            key_description: "ProposalId = 4242 (u64)".into(),
            key: pallet_epoch::Proposals::<Runtime>::hashed_key_for(4_242u64),
        },
        Entry {
            name: "scheduler_agenda",
            pallet: "Scheduler",
            item: "Agenda",
            hashers: vec![TWOX_64_CONCAT],
            preimages: vec![1_000_000u32.encode()],
            key_description: "BlockNumber = 1000000 (u32)".into(),
            key: pallet_scheduler::Agenda::<Runtime>::hashed_key_for(1_000_000u32),
        },
        Entry {
            name: "welfare_snapshots",
            pallet: "Welfare",
            item: "Snapshots",
            hashers: vec![BLAKE2_128_CONCAT],
            // ONE pre-image: the encoded tuple. Contrast `ledger_positions`.
            preimages: vec![(9u32, 3u16).encode()],
            key_description: "single map keyed by the TUPLE (EpochId = 9, MetricSpecVersion = 3): \
                              one hash over the encoded pair"
                .into(),
            key: pallet_welfare::Snapshots::<Runtime>::hashed_key_for((9u32, 3u16)),
        },
        Entry {
            name: "ledger_positions",
            pallet: "ConditionalLedger",
            item: "Positions",
            hashers: vec![BLAKE2_128_CONCAT, BLAKE2_128_CONCAT],
            // TWO pre-images, hashed separately. Contrast `welfare_snapshots`.
            preimages: vec![position.encode(), holder.encode()],
            key_description: "double map (PositionId::Proposal{4242, Accept, Long}, account 7): \
                              two hashes, one per key"
                .into(),
            key: pallet_conditional_ledger::Positions::<Runtime>::hashed_key_for(
                position,
                holder.clone(),
            ),
        },
        Entry {
            name: "ledger_positions_baseline_variant",
            pallet: "ConditionalLedger",
            item: "Positions",
            hashers: vec![BLAKE2_128_CONCAT, BLAKE2_128_CONCAT],
            preimages: vec![baseline_position.encode(), holder.encode()],
            key_description: "the other PositionId variant — Baseline{9, Short} — whose SCALE \
                              encoding is a different length from Proposal{..}"
                .into(),
            key: pallet_conditional_ledger::Positions::<Runtime>::hashed_key_for(
                baseline_position,
                holder.clone(),
            ),
        },
        Entry {
            name: "service_ledger_positions",
            pallet: "ServiceLedger",
            item: "Positions",
            hashers: vec![BLAKE2_128_CONCAT, BLAKE2_128_CONCAT],
            preimages: vec![position.encode(), holder.encode()],
            key_description: "the SAME item and the SAME key in the other instance: identical \
                              suffix, different prefix"
                .into(),
            key: pallet_conditional_ledger::Positions::<
                Runtime,
                pallet_conditional_ledger::Instance1,
            >::hashed_key_for(position, holder.clone()),
        },
        Entry {
            name: "oracle_rounds",
            pallet: "Oracle",
            item: "Rounds",
            hashers: vec![BLAKE2_128_CONCAT, BLAKE2_128_CONCAT, BLAKE2_128_CONCAT],
            preimages: vec![5u16.encode(), 9u32.encode(), 3u16.encode()],
            key_description: "N-map (MetricId = 5, EpochId = 9, MetricSpecVersion = 3): three \
                              hashes, one per key"
                .into(),
            key: pallet_oracle::Rounds::<Runtime>::hashed_key_for((5u16, 9u32, 3u16)),
        },
        Entry {
            name: "foreign_assets_account",
            pallet: "ForeignAssets",
            item: "Account",
            hashers: vec![BLAKE2_128_CONCAT, BLAKE2_128_CONCAT],
            preimages: vec![usdc.encode(), holder.encode()],
            key_description: "double map (AssetId = the USDC XCM Location, account 7). Key 1 is a \
                              variable-length Location, NOT the u32 Asset Hub uses for the same \
                              asset (02 §7.7)"
                .into(),
            key: pallet_assets::Account::<Runtime, pallet_assets::Instance1>::hashed_key_for(
                usdc,
                holder.clone(),
            ),
        },
        Entry {
            name: "system_account",
            pallet: "System",
            item: "Account",
            hashers: vec![BLAKE2_128_CONCAT],
            preimages: vec![holder.encode()],
            key_description: "map AccountId → AccountInfo — every native balance read".into(),
            key: frame_system::Account::<Runtime>::hashed_key_for(holder),
        },
    ]
}

/// Raw hasher pre-image/output pairs, for keys this runtime cannot build.
///
/// Inputs vary in length across the SCALE compact boundary and include the empty
/// slice, so a client that mishandled either still fails here.
fn hasher_inputs() -> Vec<(&'static str, Vec<u8>)> {
    vec![
        ("empty", Vec::new()),
        ("one_byte", vec![0x00]),
        ("u32_le", 1_337u32.encode()),
        ("u64_le", 4_242u64.encode()),
        ("account", account(7).encode()),
        // Longer than one blake2 block, so a client that truncated its input
        // rather than its digest fails here and passes everything above.
        ("long", (0..=200u8).collect::<Vec<u8>>()),
    ]
}

fn render() -> String {
    let mut entry_rows = Vec::new();
    for entry in entries() {
        let hashers: Vec<String> = entry.hashers.iter().map(|h| format!("\"{h}\"")).collect();
        let preimages: Vec<String> = entry
            .preimages
            .iter()
            .map(|p| format!("\"{}\"", hex(p)))
            .collect();
        entry_rows.push(format!(
            "  {{\n   \"name\": \"{}\",\n   \"pallet\": \"{}\",\n   \"item\": \"{}\",\n   \
             \"hashers\": [{}],\n   \"preimages\": [{}],\n   \"keyDescription\": \"{}\",\n   \
             \"key\": \"{}\"\n  }}",
            entry.name,
            entry.pallet,
            entry.item,
            hashers.join(", "),
            preimages.join(", "),
            entry.key_description,
            hex(&entry.key),
        ));
    }

    let mut hasher_rows = Vec::new();
    for (name, input) in hasher_inputs() {
        hasher_rows.push(format!(
            "  {{\n   \"name\": \"{name}\",\n   \"input\": \"{}\",\n   \
             \"Blake2_128Concat\": \"{}\",\n   \"Twox64Concat\": \"{}\"\n  }}",
            hex(&input),
            hex(&sp_io::hashing::blake2_128(&input)
                .iter()
                .copied()
                .chain(input.iter().copied())
                .collect::<Vec<u8>>()),
            hex(&sp_io::hashing::twox_64(&input)
                .iter()
                .copied()
                .chain(input.iter().copied())
                .collect::<Vec<u8>>()),
        ));
    }

    format!(
        "{{\n \"schema\": \"{SCHEMA}\",\n \"prefixHash\": \"twox128\",\n \
         \"entries\": [\n{}\n ],\n \"hashers\": [\n{}\n ]\n}}\n",
        entry_rows.join(",\n"),
        hasher_rows.join(",\n"),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use sp_io::hashing::twox_128;
    use std::collections::BTreeSet;
    use std::path::PathBuf;

    fn fixture_path() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(FIXTURE)
    }

    #[test]
    fn storage_key_fixture_describes_this_runtime() {
        let rendered = render();
        let path = fixture_path();

        if std::env::var("BLEAVIT_WRITE_STORAGE_KEY_FIXTURE").is_ok() {
            std::fs::create_dir_all(path.parent().expect("fixture has a parent"))
                .expect("create fixture dir");
            std::fs::write(&path, &rendered).expect("write fixture");
            return;
        }

        let committed = std::fs::read_to_string(&path).unwrap_or_else(|error| {
            panic!(
                "{} is unreadable ({error}). Regenerate with \
                 BLEAVIT_WRITE_STORAGE_KEY_FIXTURE=1 cargo test -p bleavit-runtime storage_key",
                path.display()
            )
        });

        assert_eq!(
            committed, rendered,
            "the committed storage-key fixture no longer describes this runtime. If the \
             change is intended, regenerate it AND re-run `pnpm -C app run test:chain-client` \
             — the client binds to the same file, and a key it builds wrongly returns no \
             value rather than an error (02 §7)."
        );
    }

    #[test]
    fn every_published_key_starts_with_its_own_prefix() {
        // The one relation between the two halves of a key. It is also what lets
        // the TypeScript side check `storagePrefix` against a producer that is
        // not the chainhead corpus — the corpus records only prefixes, so on its
        // own it cannot tell a correct prefix from one that happens to match the
        // recording it was derived from.
        for entry in entries() {
            let mut expected = twox_128(entry.pallet.as_bytes()).to_vec();
            expected.extend_from_slice(&twox_128(entry.item.as_bytes()));
            assert_eq!(
                &entry.key[..32],
                &expected[..],
                "entry {} does not begin with twox128({}) ++ twox128({})",
                entry.name,
                entry.pallet,
                entry.item
            );
        }
    }

    #[test]
    fn the_fixture_distinguishes_what_it_must() {
        // Anti-vacuity for the entries: every case must produce a distinct key,
        // or it pins nothing.
        let mut keys = BTreeSet::new();
        for entry in entries() {
            assert!(
                keys.insert(entry.key.clone()),
                "entry {} produces a key another entry already produces",
                entry.name
            );
        }

        // The property `service_ledger_positions` exists to state: same suffix,
        // different prefix. If the two instances ever shared a prefix the client
        // would serve one domain's balances under the other's label.
        let by_name = |name: &str| {
            entries()
                .into_iter()
                .find(|e| e.name == name)
                .unwrap_or_else(|| panic!("{name} is missing"))
        };
        let primary = by_name("ledger_positions");
        let service = by_name("service_ledger_positions");
        assert_eq!(
            primary.preimages, service.preimages,
            "the two instances must be keyed identically for this comparison to mean anything"
        );
        assert_ne!(
            &primary.key[..32],
            &service.key[..32],
            "instances share a prefix"
        );
        assert_eq!(
            &primary.key[32..],
            &service.key[32..],
            "the same key under the same hashers must produce the same suffix"
        );

        // The tuple-key/double-map distinction, stated as an assertion rather
        // than left to the prose above: both are "(A, B) → V" in doc 02's type
        // column, and they hash differently.
        let snapshots = by_name("welfare_snapshots");
        assert_eq!(
            snapshots.hashers.len(),
            1,
            "Welfare.Snapshots is a single map over a tuple key — one hasher"
        );
        assert_eq!(
            primary.hashers.len(),
            2,
            "ConditionalLedger.Positions is a double map — one hasher per key"
        );

        // Every published pre-image really is the input the key was built from,
        // checked here rather than trusted: a wrong pre-image yields a fixture a
        // client reproduces exactly and then hashes into a different key, which
        // reads on the TypeScript side as a bug in the client.
        for entry in entries() {
            let mut rebuilt = twox_128(entry.pallet.as_bytes()).to_vec();
            rebuilt.extend_from_slice(&twox_128(entry.item.as_bytes()));
            for (hasher, preimage) in entry.hashers.iter().zip(entry.preimages.iter()) {
                match *hasher {
                    BLAKE2_128_CONCAT => {
                        rebuilt.extend_from_slice(&sp_io::hashing::blake2_128(preimage));
                    }
                    TWOX_64_CONCAT => {
                        rebuilt.extend_from_slice(&sp_io::hashing::twox_64(preimage));
                    }
                    other => panic!("entry {} names an unknown hasher {other}", entry.name),
                }
                rebuilt.extend_from_slice(preimage);
            }
            assert_eq!(
                rebuilt, entry.key,
                "entry {}: the published hashers and pre-images do not rebuild the published key",
                entry.name
            );
        }

        // Anti-vacuity for the hasher section: the two hashers must disagree on
        // every input, and neither may return its input unchanged.
        for (name, input) in hasher_inputs() {
            let blake = sp_io::hashing::blake2_128(&input);
            let twox = sp_io::hashing::twox_64(&input);
            assert_ne!(
                &blake[..8],
                &twox[..],
                "input {name} hashes identically under both hashers"
            );
            assert_ne!(
                blake.to_vec(),
                input,
                "input {name} survives blake2_128 unchanged"
            );
        }
    }

    #[test]
    fn both_hashers_and_every_key_arity_are_covered() {
        // A coverage assertion, because the value of this fixture is exactly the
        // shapes it contains. Without it a future edit can delete the only
        // Twox64Concat case, or the only three-key case, and every other test
        // here still passes.
        let all = entries();
        let hashers: BTreeSet<&str> = all.iter().flat_map(|e| e.hashers.iter().copied()).collect();
        assert!(
            hashers.contains(BLAKE2_128_CONCAT) && hashers.contains(TWOX_64_CONCAT),
            "both read-surface hashers must appear; found {hashers:?}"
        );

        let arities: BTreeSet<usize> = all.iter().map(|e| e.hashers.len()).collect();
        for arity in [0usize, 1, 2, 3] {
            assert!(
                arities.contains(&arity),
                "no entry with {arity} key(s); the fixture must keep the plain-value, \
                 single, double and N-map shapes"
            );
        }

        // And the variable-length key, which is the deposit flow's own read.
        let foreign = all
            .iter()
            .find(|e| e.name == "foreign_assets_account")
            .expect("the ForeignAssets entry is the F18 deposit read");
        assert!(
            foreign.preimages[0].len() > 4,
            "the USDC Location must encode to more than a u32's width, or this entry no \
             longer demonstrates that the two chains key the same asset differently"
        );
        // And it is the *pinned* encoding, not merely some Location. 02 §8 freezes
        // these ten bytes and the release surface manifest carries them, so this
        // ties the fixture's key to the asset identity the contract publishes
        // rather than to whatever `usdc_location()` happens to return today.
        assert_eq!(
            foreign.preimages[0].as_slice(),
            crate::USDC_LOCATION_ENCODED.as_slice(),
            "the ForeignAssets key 1 pre-image is not the 02 §8 pinned USDC encoding"
        );
    }
}
