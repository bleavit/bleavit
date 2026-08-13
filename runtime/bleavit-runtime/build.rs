fn main() {
    #[cfg(feature = "substrate-wasm-builder")]
    {
        let builder = substrate_wasm_builder::WasmBuilder::init_with_defaults();
        #[cfg(feature = "metadata-hash")]
        let builder = builder.enable_metadata_hash("VIT", 12);
        builder.build();
    }
}
