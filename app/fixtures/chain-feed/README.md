# `app/fixtures/chain-feed/` — the backend artifact feed the client builds against

One directory per runtime `spec_version`, holding what
[02 §11](../../../docs/architecture/02-integration-contract.md) calls the
*Runtime Wasm + metadata* artifact. `packages/descriptors` generates from it, and
`tools/ci/check-chain-feed.py` gates it on every commit.

| File | What it is |
|---|---|
| `metadata.scale` | Raw SCALE runtime metadata, **v15** (see below) |
| `runtime-info.json` | `bleavit.runtime-info.v1` — spec name/version, contract version, pallet list, metadata hash, and the `:code` ↔ wasm binding |
| `build-info.json` | `bleavit.runtime-build.v2` — the reproducible-build record for the runtime this metadata came from |

## Why there is no `runtime.wasm` here

It is reproducible from source at the recorded `git_commit`, and the release-blocking
drift leg rebuilds it to diff against this metadata anyway. Committing ~1.9 MB per
`spec_version` would buy nothing that `build-info.json`'s `wasm.sha256` does not
already pin.

## Why the metadata is v15 and not whatever `state_getMetadata` returns

`state_getMetadata` is the **legacy** RPC: it returns **v14** regardless of what the
runtime supports, and v14 predates the runtime-APIs section entirely. A v14 blob
therefore cannot describe a single one of
[02 §3](../../../docs/architecture/02-integration-contract.md)'s frozen thirteen
`FutarchyApi` methods — which is the whole reason 02 §11 publishes this artifact.

This runtime advertises **14, 15 and 16**; v15 carries **19 runtime APIs including
`FutarchyApi`**, and v15 is the newest version `tools/release/scale_metadata.py` can
decode. `tools/release/extract-metadata.py` now requests it explicitly and fails closed
below it. (PAPI reads **v16** straight from the wasm; the repo's own decoder does not
implement v16 yet. Recorded in PLAN.md · V-75, not blocking — v15 carries every surface
`surface-manifest.json` freezes.)

## Regenerating

The same scripts a tag release runs, so this feed and a published one cannot diverge:

```sh
tools/deploy/generate-chain-specs.sh                  # RUNTIME_PROFILE=bootstrap
cargo build -p bleavit-node --release --locked
tools/release/build-runtime.sh release-work/runtime
python3 tools/release/extract-metadata.py \
  --node "${CARGO_TARGET_DIR:-target}/release/bleavit-node" \
  --wasm release-work/runtime/runtime.wasm \
  --out-dir release-work/runtime
```

then copy `metadata.scale`, `runtime-info.json` and `build-info.json` into the
`<spec_version>/` directory. `tools/release/extract-metadata.py` needs
`websockets==15.0.1`.

## The feed is produced at HEAD, not from a tag

`git tag` is empty — no release has ever been published — and blocking the client on a
tag inverts the dependency graph, since [12 §1](../../../docs/architecture/12-release-and-operations.md)'s
release train needs frontend milestones that descend from this one. A tag is a
*publication* event; the artifact contract is not. See PLAN.md · Decision log (D1).
