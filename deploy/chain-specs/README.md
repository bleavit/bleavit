# Bleavit chain-spec pipeline

Chain specs are generated from the runtime's committed genesis presets with the
pinned `staging-chain-spec-builder`:

```sh
cargo install staging-chain-spec-builder --version 19.0.0 --locked
cargo build -p bleavit-runtime --release --features substrate-wasm-builder
```

The pinned wasm builder names the resulting release artifact
`target/release/wbuild/bleavit-runtime/bleavit_runtime.compact.compressed.wasm`.
That basename was verified against `substrate-wasm-builder` 32.0.0's compact,
compressed output naming and the runtime crate name (`bleavit_runtime`).

For the reproducible dev and local outputs, run:

```sh
tools/deploy/generate-chain-specs.sh
```

The script invokes these pinned builder commands (after building the runtime):

```sh
target/tools/bin/chain-spec-builder --chain-spec-path deploy/chain-specs/out/bleavit-dev.json create \
  --chain-name "Bleavit Development" --chain-id bleavit_dev -t development \
  --relay-chain paseo-local --para-id 4242 \
  --runtime target/release/wbuild/bleavit-runtime/bleavit_runtime.compact.compressed.wasm \
  --properties tokenSymbol=VIT,tokenDecimals=12,ss58Format=7777 \
  named-preset development

target/tools/bin/chain-spec-builder --chain-spec-path deploy/chain-specs/out/bleavit-local.json create \
  --chain-name "Bleavit Local" --chain-id bleavit_local -t local \
  --relay-chain paseo-local --para-id 4242 \
  --runtime target/release/wbuild/bleavit-runtime/bleavit_runtime.compact.compressed.wasm \
  --properties tokenSymbol=VIT,tokenDecimals=12,ss58Format=7777 \
  named-preset local_testnet
```

They use chain IDs `bleavit_dev` and `bleavit_local`, relay `paseo-local`, test
para ID 4242, and the required 02 §8 properties:

```json
{"ss58Format":7777,"tokenDecimals":12,"tokenSymbol":"VIT"}
```

Generated files land in the gitignored `deploy/chain-specs/out/` directory and
are checked by `tools/deploy/validate-chain-spec.py`.

## Paseo and production procedure

For Paseo, use relay `paseo`; for production, use relay `polkadot`. In both
cases the para ID is the value assigned during onboarding, never fixture 4242.
Build an audited runtime genesis patch from
`deploy/genesis/allocations.template.json`, replacing every `TODO` with the
approved real account — both the allocation accounts and the two 09 §4 Coretime
ops seats (`futarchyTreasury.coretimeQuoteAuthority` and
`.coretimeRenewalAccount`, outputs of the Phase-2/3 ops ceremony; the validator
rejects a paseo/polkadot spec that leaves either unseated) — and pass it through
the builder's `patch` subcommand. Inject `bootNodes` from the matching
`bootnodes.paseo.json`/`bootnodes.polkadot.json` operator manifest, then validate
the finished artifact with `--profile paseo` or `--profile polkadot`.

02 §10 is a hard release gate: every Paseo and production spec MUST contain at
least 8 browser-reachable `/wss` multiaddrs across at least 4 independent
operators, including at least 2 endpoints on TCP port 443. The validator
enforces all three thresholds against the operator manifest. A spec update that
would fall below any threshold MUST NOT be released.

Artifact publication is milestone B8. The Zombienet and Chopsticks environment
definitions (milestone B7) live in `zombienet/` and `chopsticks/`, with their
pinned tooling in `tools/env/` (`generate-relay-specs.sh` reuses this pipeline
for the Bleavit drill spec). The ss58-registry submission artifact, which must
land before Phase 2, is in `deploy/ss58/`.

## Booting the canonical client against a dev spec (F18; ruled 2026-08-07)

The frontend's `startChainSession` takes its chain pin by **injection**, so a
drill harness may boot the client against `bleavit-dev.json`. Produce the pin
with:

```sh
node app/tools/dev-chain-pin.ts \
  --relay zombienet/specs/out/paseo-local-raw.json   --relay-genesis 0x… \
  --para  zombienet/specs/out/bleavit-drill-raw.json --para-genesis  0x… \
  --out   <a scratch path>
```

**The specs must be the raw ones, and this section named plain ones until F27.**
smoldot accepts raw chain specifications only, while the pinned Zombienet
schedules a parachain only from a plain one, so
[`tools/env/generate-relay-specs.sh`](../../tools/env/generate-relay-specs.sh)
emits both forms from a single generation. The plain files this directory
produces (`bleavit-dev.json`, `bleavit-local.json`) are therefore not usable
here — the tool refuses them, by the same check the client makes at boot.

Drill 14 (`zombienet/drills/14-client-boot.zndsl`) runs exactly this command
against a spawned network, so the documented invocation and the executed one are
the same one.

Two rules govern it, and both are structural rather than remembered.

**A dev pin may exist. It may never live in
`app/tools/release/sources/release-sources.json`.** That file's `paraId`,
`chainSpecHashes` and `genesisHashes` stay `null` until a production chain
exists; a release pinned to `bleavit_dev` on `paseo-local` would pass the
chain-spec hash check, pass the 10 §3.1 genesis check, and report `verified`
about a chain that is not Bleavit. The tool refuses to write into the release
sources, `app/dist/` or `app/release-out/`, and nothing dev-generated enters
`dist/chain-specs/`.

**The genesis hash is read from the chain, never computed from the file.** It is
the hash of the genesis header, whose state root is the trie root of the genesis
storage, so no function of the spec bytes produces it. Read it from the started
node (`chainSpec_v1_genesisHash`) and pass it in; the tool refuses to guess one.
