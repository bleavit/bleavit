# `app/fixtures/chain-feed/` — the backend artifact feed the client builds against

One directory per runtime `spec_version`, holding what
[02 §11](../../../docs/architecture/02-integration-contract.md) calls the
*Runtime Wasm + metadata* artifact. `packages/papi-descriptors` generates from it, and
`tools/ci/check-chain-feed.py` gates it on every commit.

| File | What it is |
|---|---|
| `metadata.scale` | Raw SCALE runtime metadata, **v15** (see below) |
| `runtime-info.json` | `bleavit.runtime-info.v1` — spec name/version, contract version, pallet list, metadata hash, and the `:code` ↔ wasm binding |
| `build-info.json` | `bleavit.runtime-build.v2` — the reproducible-build record for the runtime this metadata came from |

## Two directories, because two runtimes are live-capable at once

| Directory | Profile | What it is |
|---|---|---|
| `2/` | `bootstrap` | The primary runtime |
| `3/` | `bootstrap-recovery` | Its **paired terminal-recovery** runtime, at exactly the next `spec_version` |

[10 §5.1](../../../docs/architecture/10-frontend-architecture.md) makes the pair a
gate, not a nicety: *both* must have published descriptors before the primary is
eligible, because a recovery runtime can become current under `OnlyInherents` and
treating its descriptors as operator-only would strand the canonical frontend during
exactly the incident it exists for.

The checker enforces the pairing itself — one primary, one recovery, recovery at
primary + 1, the profiles declaring each other in `tools/release/runtime-profiles.json`,
and matching contract versions. Checking each directory alone cannot see a feed that
ships half a pair, and half a pair looks complete to any consumer that opens one
directory.

The directory name **is** the selector, so it is checked against the `spec_version`
inside — a directory whose name disagrees with its runtime hands out the wrong artifact
while every internal check still passes.

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

# Primary.
tools/release/build-runtime.sh release-work/runtime
python3 tools/release/extract-metadata.py \
  --node "${CARGO_TARGET_DIR:-target}/release/bleavit-node" \
  --wasm release-work/runtime/runtime.wasm \
  --out-dir release-work/runtime

# Paired terminal recovery. `--embed-wasm` boots the plain chain spec with this wasm
# as genesis `:code`, which is how a runtime that is not the chain spec's own gets
# its metadata read out of a real node rather than parsed statically.
RUNTIME_PROFILE=bootstrap-recovery tools/release/build-runtime.sh release-work/runtime/recovery
python3 tools/release/extract-metadata.py \
  --node "${CARGO_TARGET_DIR:-target}/release/bleavit-node" \
  --wasm release-work/runtime/recovery/runtime.wasm \
  --out-dir release-work/runtime/recovery --embed-wasm
```

then copy `metadata.scale`, `runtime-info.json` and `build-info.json` into the
`<spec_version>/` directory, and regenerate descriptors with
`pnpm -C app run descriptors:generate`. `tools/release/extract-metadata.py` needs
`websockets==15.0.1`.

The chainHead transcripts in `../chainhead/` are recorded from the same pair — see that
directory's README.

## The feed is produced at HEAD, not from a tag

`git tag` is empty — no release has ever been published — and blocking the client on a
tag inverts the dependency graph, since [12 §1](../../../docs/architecture/12-release-and-operations.md)'s
release train needs frontend milestones that descend from this one. A tag is a
*publication* event; the artifact contract is not. See PLAN.md · Decision log (D1).
