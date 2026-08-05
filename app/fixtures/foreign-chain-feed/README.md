# `app/fixtures/foreign-chain-feed/` — chains this release reads but does not build

One directory per foreign chain, one subdirectory per `spec_version`, holding the runtime
metadata and the pin record. Today that is exactly one chain: **Asset Hub**, because
[11 §11.9.1](../../../docs/architecture/11-frontend-workflows.md) opens a second
light-client connection to it, reads the user's USDC there, and constructs an AH-side
reserve transfer. [02 §7.7](../../../docs/architecture/02-integration-contract.md) freezes
those three surfaces.

| File | What it is |
|---|---|
| `metadata.scale` | Raw SCALE runtime metadata, **v16** (see below) |
| `runtime-info.json` | `bleavit.foreign-runtime-info.v1` — the artifact pin, the chain identity, and the metadata hash |

`pnpm -C app run foreign:check` gates it on every commit; `pnpm -C app run descriptors:generate`
consumes it.

## Why this is a separate feed and not another `chain-feed/` directory

`chain-feed/` holds runtimes this repository **builds**, and its whole gate — 
`tools/ci/check-chain-feed.py` — is written against that: it compares the metadata with the
runtime *source*, the `construct_runtime!` pallet set, and `INTEGRATION_CONTRACT_VERSION`.
None of those exist for a chain somebody else builds. 02 §13 **rule 8** makes the same
split normative on the contract side: `INTEGRATION_CONTRACT_VERSION` deliberately does not
move when §7.7 changes, because that constant is stamped into Bleavit's runtime and no
Bleavit upgrade can move Asset Hub's layout. Two feeds, two gates, two verdicts.

## Which Asset Hub is a per-release property

The rollout phases the connection: HRMP to Asset Hub opens **Phase 2 on Paseo** and
**Phase 3 on Polkadot** ([08](../../../docs/architecture/08-treasury-and-economics.md) §2.5;
[09](../../../docs/architecture/09-execution-upgrades-and-rollout.md) §6.3). A release pins
the Asset Hub of the relay it targets, exactly as it pins the relay. This release targets
Paseo, so the pin is `asset-hub-paseo`.

An unpinned relay is a state the rollout **has**, not a mistake: with no matching pin,
`classifyForeign` returns `unreachable` and the deposit leg is blocked with a named reason
while every other surface of the app is unaffected.

## Why the metadata is v16 here and v15 in `chain-feed/`

`tools/release/extract-metadata.py` gets v15 by booting the runtime in `bleavit-node` and
calling `Metadata_metadata_at_version`. That path does not exist for a foreign runtime —
`bleavit-node` boots a Bleavit chain spec, and Asset Hub has neither the genesis config nor
the pallets it expects. PAPI reads metadata **straight out of the wasm** (PLAN.md · V-76)
and returns **v16**, which `tools/release/scale_metadata.py` does not implement.

That is why the gate for this feed is **TypeScript**, not Python: it decodes with PAPI's own
decoder. That is the better home regardless of the version accident — what must be proven
present is what the *client* will be able to name, and the client names what that decoder
produces.

## What is verified, and the one thing that cannot be

**The runtime artifact is verified twice.** The wasm is a published, srtool-built release
artifact; `tools/release/pin-foreign-runtime.py` refuses unless its SHA-256 equals the
srtool digest's own `runtimes.compressed.sha256`, so a wasm swapped after the digest was
published cannot be pinned. The digest's `core_version` is copied into the record, so a
reader can check the pin against the upstream release without trusting this repository.

**The genesis hash cannot come from an artifact.** Genesis is chain identity — a property
of the chain spec's genesis storage, not of the runtime — so no amount of runtime
provenance produces it. It is read from the live chain, which is what rule R-2 prescribes
for a `[VERIFY]` and does **not** collide with 10 §5.1's "never a live node" rule: that
rule governs *descriptor generation*, and the descriptors come from the wasm. Only the
identity fact is asked of the network, `genesis_sources` records who was asked, and the
gate refuses a pin with fewer than two distinct sources — one operator agreeing with
itself is not a cross-check, and this is the field whose error makes every balance the
client renders belong to somebody else.

## Regenerating

```sh
# 1. Fetch the published artifact and its srtool digest for the target release.
curl -sSLO https://github.com/paseo-network/runtimes/releases/download/<tag>/asset-hub-paseo_runtime.compressed.wasm
curl -sSLO https://github.com/paseo-network/runtimes/releases/download/<tag>/asset-hub-paseo-srtool-digest.json

# 2. Extract metadata from the wasm — no node, no network.
pnpm -C app exec papi add assethub_paseo --wasm <path>/asset-hub-paseo_runtime.compressed.wasm --skip-codegen
#    (writes app/.papi/metadata/assethub_paseo.scale; move it aside, the feed is its home)

# 3. Read the genesis hash from at least two INDEPENDENT operators and confirm they agree.
#    chain_getBlockHash(0) — and check state_getRuntimeVersion matches the srtool core_version.

# 4. Write the pin record.
python3 tools/release/pin-foreign-runtime.py \
  --label "Asset Hub" --chain-key assethub_paseo --relay paseo \
  --wasm <path>/asset-hub-paseo_runtime.compressed.wasm \
  --srtool-digest <path>/asset-hub-paseo-srtool-digest.json \
  --metadata <path>/assethub_paseo.scale \
  --genesis 0x… --genesis-source <url-a> --genesis-source <url-b> \
  --source-url https://github.com/paseo-network/runtimes/releases/tag/<tag> \
  --out-dir app/fixtures/foreign-chain-feed/asset-hub-paseo

# 5. Point .papi/polkadot-api.json at the new spec_version, update FOREIGN_CHAIN_PINS, then:
pnpm -C app run descriptors:generate && pnpm -C app run foreign:check
```

Never hand-edit `metadata.scale` or `runtime-info.json`, and never edit `FOREIGN_CHAIN_PINS`
to match a red gate — the pin is the claim and the feed is the evidence, in that order.
