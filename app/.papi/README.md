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

## No whitelist — for any chain in this config

PAPI can prune a descriptor set to a whitelist (`.papi/whitelist.ts`). Nothing here uses
one, for a reason worth stating because the opposite looks tidier:

`applyWhitelist` filters silently. An entry naming a storage item, call or runtime-API
method that is *absent from the metadata* does not fail — it yields a smaller descriptor
set. So a whitelist derived from `CRITICAL_SURFACE` would be the one thing 10 §5.2 must
not be: a surface check that passes by shrinking. The surface binding therefore lives on
the metadata side, in `tools/ci/check-chain-feed.py` against
`tools/release/surface-manifest.json`, where a missing entry is an error rather than an
omission.

### The Asset Hub whitelist this file used to promise, and why it was withdrawn (F4)

An earlier version of this document said the Asset Hub set *was* the opposite case and
would use a whitelist: the app touches exactly the D-12 funding surface there, that surface
is frozen by [02](../../docs/architecture/02-integration-contract.md) §7.7, and a full Asset
Hub descriptor set is around 1.5 MB of types the client never names. The size argument is
real. It is not implementable, and finding out why took reading the generator and then
running it.

**PAPI hardcodes the generated package name.** `replacePackageJson` writes
`"name": "@polkadot-api/descriptors"` as a string literal, so two generated descriptor
packages cannot coexist in one pnpm workspace. Every chain therefore shares one package,
one config, and one `.papi/whitelist.ts` — which `readWhitelist` loads from a fixed path
relative to the working directory, not per entry.

**A per-chain whitelist object silently guts every chain it does not name.** The generator
computes `globalWhitelist = whitelist["*"] ?? []`, and `[]` is truthy in JavaScript, so a
chain with no key of its own gets `applyWhitelist(metadata, [])` — every filter over an
empty list, every result empty. Measured on this repository's own metadata, with a
whitelist naming only `assethub_paseo`:

| file | no whitelist | object whitelist naming only Asset Hub |
|---|---|---|
| `bleavit.ts` | 458,662 B | **43,258 B** |
| `descriptors.ts` | 60,457 B | **1,667 B** |

`papi generate` reported nothing wrong. `pnpm run descriptors:check` *would* have caught
the drift — it byte-compares — but as "the Asset Hub whitelist broke descriptor
generation", and the obvious next move, regenerate and commit, ships the gutted set.

The remaining option was a `"*"` passthrough enumerating all 45 Bleavit pallets. That was
rejected as worse than the size it saves: `descriptors:check` regenerates *with the same
whitelist*, so it agrees with itself, and a pallet added without a matching entry would
shrink the set with nothing able to see it. About 1.3 MB of committed generated TypeScript
is the price of not having that failure mode anywhere in the build.

## The Asset Hub entry (02 §7.7, F4)

`assethub_paseo` reads its metadata from
[`fixtures/foreign-chain-feed/`](../fixtures/foreign-chain-feed/README.md), which is pinned
from a published, srtool-built release artifact rather than a node — the same 10 §5.1 rule
the Bleavit entries follow, reached by a different route because a foreign runtime cannot
be booted in `bleavit-node`. That directory's README covers the pin, the v16 metadata, and
the gate.
