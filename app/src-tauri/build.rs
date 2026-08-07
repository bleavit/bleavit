//! Build script for the desktop shell.
//!
//! Two jobs. The second is Tauri's own; the first is F22's, and it is why this file has more
//! than one line.
//!
//! # The signed manifest is compiled in, from outside the embedded tree
//!
//! The shell must compare what it embeds against what the release signed. `release.json` is
//! **not** part of `dist/` — 12 §1.2 uploads it as a tagged sibling transaction, and the
//! deploy driver refuses a tree that contains it, because a document recording the manifest
//! TXID of a tree it is inside is a fixed point in a hash. So it cannot be read out of the
//! embedded assets, and it is compiled in separately here.
//!
//! It is copied into `OUT_DIR` rather than `include_bytes!`-ed from `../release-out/` so the
//! failure is legible: an absent document stops the build with a sentence naming the command
//! that produces it, instead of a path error in a macro. That coupling is deliberate — **the
//! desktop shell cannot be built without the attested release tree**, which is exactly the
//! property the milestone is about.

use std::path::{Path, PathBuf};

fn main() {
    let manifest_dir = PathBuf::from(
        std::env::var("CARGO_MANIFEST_DIR").expect("cargo always sets CARGO_MANIFEST_DIR"),
    );
    let release_json = manifest_dir.join("../release-out/release.json");
    let out_dir = PathBuf::from(
        std::env::var("OUT_DIR").expect("cargo always sets OUT_DIR for a build script"),
    );

    println!("cargo:rerun-if-changed=../release-out/release.json");
    println!("cargo:rerun-if-changed=tauri.conf.json");

    let bytes = std::fs::read(&release_json).unwrap_or_else(|error| {
        panic!(
            "cannot read {} ({error}).\n\
             The desktop shell embeds the attested release tree and compares it against the \
             signed release document, so neither exists until the release pipeline has run:\n\
             \n    pnpm -C app run release:build\n",
            release_json.display()
        )
    });

    // Refuse an empty or obviously non-JSON document here rather than at startup. A build that
    // compiled in nothing would produce a shell whose one distinguishing control fails on
    // every launch, which reads to a user as a corrupt download.
    if bytes.iter().all(u8::is_ascii_whitespace) {
        panic!(
            "{} is empty; there is nothing for the shell to attest against",
            release_json.display()
        );
    }

    write_manifest(&out_dir.join("release-manifest.json"), &bytes);
    tauri_build::build();
}

fn write_manifest(destination: &Path, bytes: &[u8]) {
    std::fs::write(destination, bytes)
        .unwrap_or_else(|error| panic!("cannot write {} ({error})", destination.display()));
}
