# `app/.papi/` — the descriptor generator's configuration

`polkadot-api.json` is the committed input to `pnpm -C app run descriptors:generate`
([10 §5.1](../../docs/architecture/10-frontend-architecture.md)). Three things about it
are deliberate.

**`entries.*.metadata` points into `app/fixtures/chain-feed/`, not at a node.** 10 §5.1
requires descriptors generated from built runtime artifacts, *never* a live node. The
feed directory is that artifact ([02 §11](../../docs/architecture/02-integration-contract.md)),
and `tools/ci/check-chain-feed.py` gates it against the runtime source on every commit —
so the descriptor set is bound, transitively, to `construct_runtime!` and to
`INTEGRATION_CONTRACT_VERSION`.

**One entry per live-capable `spec_version`.** A primary runtime and its paired
terminal-recovery runtime are separate `spec_version`s and both must have published
descriptors before the primary is eligible (10 §5.1; B16). They appear here as separate
keys, each with its own feed directory.

**`options.noDescriptorsPackage: true`** stops `papi generate` from writing a
`@polkadot-api/descriptors` dependency into `app/package.json` and then shelling out to
`pnpm install`. Neither is wanted: the generated package is a *workspace* package
(`packages/papi-descriptors`), so pnpm links it from `pnpm-workspace.yaml`, and an
install triggered from inside a generator would fight `.npmrc`'s `frozen-lockfile=true`.

## No whitelist for the Bleavit set — and why there is one for Asset Hub

PAPI can prune a descriptor set to a whitelist (`.papi/whitelist.ts`). The Bleavit set
deliberately does **not** use one, for a reason worth stating because the opposite looks
tidier:

`applyWhitelist` filters silently. An entry naming a storage item, call or runtime-API
method that is *absent from the metadata* does not fail — it yields a smaller descriptor
set. So a whitelist derived from `CRITICAL_SURFACE` would be the one thing 10 §5.2 must
not be: a surface check that passes by shrinking. The surface binding therefore lives on
the metadata side, in `tools/ci/check-chain-feed.py` against
`tools/release/surface-manifest.json`, where a missing entry is an error rather than an
omission.

The Asset Hub set is the opposite case and does use a whitelist: the app touches exactly
the D-12 funding surface there, that surface is frozen by
[02](../../docs/architecture/02-integration-contract.md), and a full Asset Hub descriptor
set would be megabytes of types the client never names.
