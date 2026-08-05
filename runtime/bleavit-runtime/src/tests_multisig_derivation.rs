//! The multisig-account derivation fixture — 02 §7.6, 11 §11.3 (F6).
//!
//! ## What this exists to catch
//!
//! `Multisig.as_multi(threshold, other_signatories, …, call)` executes the inner
//! call as an account **nobody chooses**: it is derived from the signatory set
//! and the threshold. The client must know that account before anything is
//! signed, because it is the account every 11 §11.5 precondition row reads —
//! the balances, positions, bonds and locks that decide whether the inner call
//! succeeds belong to it and not to the signer.
//!
//! An earlier draft of `app/packages/transaction-builder` took that account as a
//! **caller-supplied field**, and a wrong value there is silent in the dangerous
//! direction: the client checks some other account's healthy balance, reports
//! every precondition green, and the runtime rejects. The user signed something
//! the client had told them would work.
//!
//! So the client derives it, and this fixture is what proves the derivation is
//! the runtime's own. The pattern is [`crate`]'s established one — see
//! `crates/market-core/src/quote_agreement.rs`: Rust writes what this runtime
//! actually answers, the Rust suite checks the file still describes it, and the
//! TypeScript suite checks the client still agrees with the file. Neither side
//! needs the other's toolchain, and whichever moved is the side that goes red.
//!
//! ## Why the pre-image is in the fixture and not just the answer
//!
//! The derivation is a SCALE encoding fed to a hash. Publishing only the account
//! makes every disagreement look identical — a wrong hash function, a missing
//! compact length prefix and a byte-order slip all present as "the accounts
//! differ". The pre-image splits that in two: a client whose pre-image matches
//! and whose account does not has a hashing problem, and one whose pre-image
//! differs has an encoding problem, which is the failure that actually happens.
//!
//! ## The cases
//!
//! Signatory sets are strictly ascending, because that is what
//! `ensure_sorted_and_insert` produces and what `as_multi` requires. The
//! 64-signatory case is not padding: SCALE's compact integer changes width at
//! 64, so a client that hardcoded a one-byte length prefix passes every small
//! case and derives a wrong account for a large committee — silently, since the
//! result is still a well-formed address.
//!
//! Regenerate with `BLEAVIT_WRITE_MULTISIG_FIXTURE=1 cargo test -p bleavit-runtime
//! multisig_derivation`.

use parity_scale_codec::Encode;
use sp_core::crypto::AccountId32;

use crate::Runtime;

/// Where the fixture lives, relative to this crate.
const FIXTURE: &str = "fixtures/multisig-derivation.json";

/// Schema id. Rows are append-only within a major.
const SCHEMA: &str = "bleavit.multisig-derivation.v1";

/// The domain prefix `pallet_multisig` hashes under. A `&[u8; 16]`, so SCALE
/// writes it as sixteen raw bytes with no length prefix — the one element of
/// the pre-image that is *not* length-delimited.
const PREFIX: &[u8; 16] = b"modlpy/utilisuba";

/// A deterministic account whose bytes are a function of `seed` alone.
///
/// Byte 0 carries the seed so the set is strictly ascending in `AccountId32`'s
/// own `Ord` (a lexicographic compare over `[u8; 32]`), and the remaining bytes
/// vary so a client that compared only the first byte would still be wrong.
fn account(seed: u8) -> AccountId32 {
    let mut bytes = [0u8; 32];
    bytes[0] = seed;
    for (index, byte) in bytes.iter_mut().enumerate().skip(1) {
        *byte = seed.wrapping_mul(index as u8).wrapping_add(index as u8);
    }
    AccountId32::new(bytes)
}

fn hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(2 + bytes.len() * 2);
    out.push_str("0x");
    for byte in bytes {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

/// `(name, threshold, signatory seeds)` — seeds ascending, as the pallet requires.
fn cases() -> Vec<(&'static str, u16, Vec<u8>)> {
    vec![
        ("one_of_two", 1, vec![1, 2]),
        ("two_of_two", 2, vec![1, 2]),
        ("two_of_three", 2, vec![1, 2, 3]),
        ("three_of_three", 3, vec![1, 2, 3]),
        // Same set, different threshold: the account MUST differ, or a client
        // could sign for a 2-of-3 while reading a 3-of-3's state.
        ("two_of_five", 2, vec![10, 20, 30, 40, 50]),
        ("four_of_five", 4, vec![10, 20, 30, 40, 50]),
        // Adjacent-byte neighbours, so a derivation that truncated or reordered
        // the 32-byte keys would collide rather than merely differ.
        ("neighbours", 2, vec![200, 201]),
        // The SCALE compact boundary: 63 elements encode their length in one
        // byte, 64 in two.
        (
            "sixty_three_signatories",
            32,
            (1..=63u8).collect::<Vec<u8>>(),
        ),
        (
            "sixty_four_signatories",
            33,
            (1..=64u8).collect::<Vec<u8>>(),
        ),
    ]
}

fn render() -> String {
    let mut rows = Vec::new();
    for (name, threshold, seeds) in cases() {
        let who: Vec<AccountId32> = seeds.iter().copied().map(account).collect();
        // Exactly the tuple `multi_account_id` hashes.
        let preimage = (PREFIX, &who, threshold).encode();
        let derived = pallet_multisig::Pallet::<Runtime>::multi_account_id(&who, threshold);

        let signatories: Vec<String> = who
            .iter()
            .map(|a| format!("\"{}\"", hex(a.as_ref())))
            .collect();
        rows.push(format!(
            "  {{\n   \"name\": \"{name}\",\n   \"threshold\": {threshold},\n   \
             \"signatories\": [\n    {}\n   ],\n   \"preimage\": \"{}\",\n   \
             \"account\": \"{}\"\n  }}",
            signatories.join(",\n    "),
            hex(&preimage),
            hex(derived.as_ref()),
        ));
    }

    format!(
        "{{\n \"schema\": \"{SCHEMA}\",\n \"prefix\": \"{}\",\n \"hash\": \"blake2b-256\",\n \
         \"cases\": [\n{}\n ]\n}}\n",
        hex(PREFIX),
        rows.join(",\n"),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;
    use std::path::PathBuf;

    fn fixture_path() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(FIXTURE)
    }

    #[test]
    fn multisig_derivation_fixture_describes_this_runtime() {
        let rendered = render();
        let path = fixture_path();

        if std::env::var("BLEAVIT_WRITE_MULTISIG_FIXTURE").is_ok() {
            std::fs::create_dir_all(path.parent().expect("fixture has a parent"))
                .expect("create fixture dir");
            std::fs::write(&path, &rendered).expect("write fixture");
            return;
        }

        let committed = std::fs::read_to_string(&path).unwrap_or_else(|error| {
            panic!(
                "{} is unreadable ({error}). Regenerate with \
                 BLEAVIT_WRITE_MULTISIG_FIXTURE=1 cargo test -p bleavit-runtime \
                 multisig_derivation",
                path.display()
            )
        });

        assert_eq!(
            committed, rendered,
            "the committed multisig-derivation fixture no longer describes this \
             runtime. If the change is intended, regenerate it AND re-run \
             `pnpm -C app run test:tx` — the client binds to the same file, and a \
             derivation the client does not follow means every precondition row \
             is read against the wrong account (11 §11.3, §11.5)."
        );
    }

    #[test]
    fn the_fixture_distinguishes_what_it_must() {
        // Anti-vacuity. A fixture whose cases all derived the same account, or
        // whose threshold made no difference, would pin nothing.
        let mut accounts = BTreeSet::new();
        for (name, threshold, seeds) in cases() {
            let who: Vec<AccountId32> = seeds.iter().copied().map(account).collect();
            let derived = pallet_multisig::Pallet::<Runtime>::multi_account_id(&who, threshold);
            assert!(
                accounts.insert(derived),
                "case {name} derives an account another case already derived"
            );
        }

        // The published pre-image really is the one the account comes from.
        // Without this the two fields could disagree and only the *client* would
        // notice: a wrong `PREFIX` here yields a fixture whose pre-image a client
        // reproduces exactly and whose account it then derives wrongly, which
        // reads on the TypeScript side as a hashing bug in the client.
        for (name, threshold, seeds) in cases() {
            let who: Vec<AccountId32> = seeds.iter().copied().map(account).collect();
            let preimage = (PREFIX, &who, threshold).encode();
            let derived = pallet_multisig::Pallet::<Runtime>::multi_account_id(&who, threshold);
            let hashed: [u8; 32] = sp_io::hashing::blake2_256(&preimage);
            let account_bytes: &[u8; 32] = derived.as_ref();
            assert_eq!(
                &hashed, account_bytes,
                "case {name}: the published pre-image does not hash to the published account"
            );
        }

        // The signatory ORDER is part of the pre-image, not just the set. The
        // pallet requires a sorted vector, so a client that reproduced the set
        // but not the order would derive a different account for the same
        // multisig — and would read every precondition against it.
        let sorted = vec![account(1), account(2), account(3)];
        let swapped = vec![account(2), account(1), account(3)];
        assert_ne!(
            pallet_multisig::Pallet::<Runtime>::multi_account_id(&sorted, 2),
            pallet_multisig::Pallet::<Runtime>::multi_account_id(&swapped, 2),
        );

        // And the seeds really are ascending in AccountId32's own Ord, so the
        // fixture's inputs are the ones `ensure_sorted_and_insert` would accept.
        for (name, _, seeds) in cases() {
            let who: Vec<AccountId32> = seeds.iter().copied().map(account).collect();
            assert!(
                who.windows(2).all(|pair| pair[0] < pair[1]),
                "case {name} is not strictly ascending"
            );
        }
    }
}
