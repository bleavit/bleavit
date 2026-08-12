//! Release-evidence runtime API.
//!
//! This is deliberately outside the frozen frontend integration contract in
//! architecture 02. Architecture 12's release extractor calls it only on a
//! booted candidate Wasm to prove which RFC-78 digest `CheckMetadataHash` will
//! actually place in its implicit signed payload.

sp_api::decl_runtime_apis! {
    /// Release-only proof surface owned by architecture 12 §1.
    #[api_version(1)]
    pub trait ReleaseMetadataApi {
        /// Digest embedded in the running Wasm's `CheckMetadataHash` extension.
        /// `None` is the fail-closed result for a non-release build.
        fn embedded_rfc78_metadata_hash() -> Option<[u8; 32]>;
    }
}
