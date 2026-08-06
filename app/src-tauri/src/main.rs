//! The Bleavit desktop shell — F22 (10 §10.1; 12 §1).
//!
//! # What this program is
//!
//! A window around the **same** asset tree the web release publishes. Not a port, not a
//! desktop build: `app/vite.config.ts` sets `base: './'`, so the published tree already uses
//! relative asset URLs and needs no rebuild to run from a file-backed protocol. That is what
//! makes the claim below worth making — a desktop-specific bundle could be attested against
//! nothing, because there would be no published tree to compare it with.
//!
//! # What it asserts, and when
//!
//! Before it creates a window, it hashes every asset compiled into this binary and compares
//! the result against the per-file map of the signed `release.json` it was built with. Any
//! file missing, changed, or present-and-unsigned stops the program. There is no flag that
//! downgrades that to a warning, and no repair path — INV-FE-8 closes with *"detected
//! divergence is surfaced to the user; it is never silently repaired"*, and a shell has the
//! stronger option available: refuse to start.
//!
//! # Direct download only
//!
//! This shell is distributed as a downloadable artifact and through no application store.
//! The reason is narrow and worth stating precisely: a store re-signs the artifact with a key
//! the project does not hold, and re-signing is the single fact that would make INV-FE-8 ("no
//! single operator may **silently** alter the application") and INV-FE-10 (reproducible,
//! independently verifiable builds) false as written for this channel. Nothing here checks
//! that property — a binary cannot know how it was distributed — so it is a **scoping
//! decision** recorded in PLAN.md's Decision log rather than a control. The `platform`
//! package makes it structural on the client side by having no store member in its
//! `DistributionChannel` union.
//!
//! # No remote origin
//!
//! `tauri.conf.json` declares no `devUrl`, no updater endpoint and no CSP. The last of those
//! is the surprising one and it is the reason the assertion works: with a CSP configured,
//! Tauri parses every embedded HTML file at build time, injects a nonce token and
//! re-serialises it — so `index.html` inside the binary would no longer be the file the
//! release signed. The release already carries its own meta-CSP, which 12 §5.1 chose because
//! gateways own real headers. `tools/desktop/check-embedded-tree.ts` gates all of it.

#![forbid(unsafe_code)]

use std::collections::BTreeMap;

use bleavit_embedded_tree::{attest, AttestationError, SelfCheckReport};
use tauri::utils::assets::AssetKey;
use tauri::{Context, Wry};

/// The signed release document, compiled in by `build.rs` from `release-out/release.json`.
///
/// It is not one of the embedded assets: 12 §1.2 publishes it as a sibling transaction, and
/// the deploy driver refuses a tree containing it.
const RELEASE_MANIFEST: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/release-manifest.json"));

/// Exit code for a build that is not the release it claims to be.
///
/// `70` is `EX_SOFTWARE` from `sysexits.h` — an internal inconsistency in the program itself,
/// which is exactly what a binary carrying files its own release never signed is. A distinct
/// code lets a packaging or smoke-test script tell this apart from a window that failed to
/// open.
const EXIT_UNATTESTED: i32 = 70;

/// 10 §9's code for this condition, assigned by 14 TH-38: *"self-check vs signed
/// `release.json` (`FE-REL-002`)"*.
///
/// 10 §9 requires *"fixed user copy + expert detail + documented recovery per code; no
/// free-text errors"*, so the three parts are separate constants rather than one sentence
/// assembled at the throw site. This shell is the family's first consumer; when a rendered
/// surface exists, the copy moves to it unchanged rather than being written a second time.
const FE_REL_002_CODE: &str = "FE-REL-002";
const FE_REL_002_COPY: &str =
    "This copy of Bleavit is not the release it says it is, so it will not start.";
const FE_REL_002_RECOVERY: &str =
    "Recovery: obtain the release from its permanent content address and verify it with \
     `verify-release` (12 §1.3). Do not re-download from wherever these bytes came from — \
     asking that channel again is asking the source of the wrong bytes for better ones, \
     which is why this is reported and never repaired (INV-FE-8).";

fn main() {
    let context = tauri::generate_context!();

    match attest_embedded_tree(&context) {
        Ok(report) => {
            println!(
                "release verified: {}/{} embedded file(s) match the signed release manifest",
                report.verified_count, report.pinned_count
            );
        }
        Err(error) => {
            // Fixed copy, then expert detail, then recovery — 10 §9's three parts, in that
            // order, under the code 14 TH-38 assigns.
            eprintln!("{FE_REL_002_CODE}: {FE_REL_002_COPY}\n\n{error}\n\n{FE_REL_002_RECOVERY}");
            std::process::exit(EXIT_UNATTESTED);
        }
    }

    if let Err(error) = tauri::Builder::default().run(context) {
        eprintln!("Bleavit could not open a window: {error}");
        std::process::exit(1);
    }
}

/// Read every embedded asset, then hand the result to the crate that decides.
///
/// Bytes come from `Assets::get`, **never** from `Assets::iter`. That is not interchangeable:
/// `tauri` enables its `compression` feature by default, so `iter()` yields each asset's
/// stored *brotli* bytes while `get()` decompresses. Hashing what `iter()` yields would
/// compare a compressed blob against a plaintext digest and report every file as changed —
/// fail-closed, and permanently broken. `iter()` is used for its **keys** only.
///
/// The `None` arm is carried through as `None` rather than decided here. `Context<Wry>` cannot
/// be constructed in a unit test, so anything decided in this function is decided in code no
/// suite executes — and the obvious decision (substitute empty bytes) is wrong in a way no
/// green run would show, because the SHA-256 of nothing is a real digest. `hash_assets` owns
/// it, refuses it, and is tested.
fn attest_embedded_tree(context: &Context<Wry>) -> Result<SelfCheckReport, AttestationError> {
    let mut tree: BTreeMap<String, Option<Vec<u8>>> = BTreeMap::new();
    for (key, _stored) in context.assets.iter() {
        let asset_key = AssetKey::from(key.as_ref());
        let bytes = context
            .assets
            .get(&asset_key)
            .map(|asset| asset.into_owned());
        tree.insert(key.into_owned(), bytes);
    }
    let borrowed: Vec<(&str, Option<&[u8]>)> = tree
        .iter()
        .map(|(key, bytes)| (key.as_str(), bytes.as_deref()))
        .collect();
    attest(RELEASE_MANIFEST, borrowed)
}
