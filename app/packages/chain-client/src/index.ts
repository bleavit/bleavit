// The package barrel. Everything here is reachable by any package permitted to import
// `@bleavit/chain-client` — which includes `transaction-builder` and `signing`, the
// transaction path itself. So what this file re-exports is a capability grant, and one
// name is deliberately withheld.
//
// `finalize` is NOT re-exported (V-118). It mints the `Finalized<T>` brand from a value
// and a block pin, both of which a caller simply supplies, so a barrel export handed the
// transaction path the ability to label anything — a provider read, an invented literal —
// as light-client-verified state. That is INV-FE-1 defeated by a plain function call:
// no assertion for `check:casts` to find, and no forbidden import for dependency-cruiser
// to find, because reaching `@bleavit/chain-client` is exactly what those packages are
// allowed to do. Measured under this repo's own toolchain before the change: a file in
// `packages/transaction-builder/src/` calling `finalize({…}, {blockHash, blockNumber})`
// compiled clean, while the same value written as an object literal was rejected.
//
// This is the third instance of one defect class, and the two already fixed are the reason
// to state it plainly here: `isFinalized` was a type predicate that asserted the brand it
// could not check (V-81), and `selfRange` minted `origin: 'self'` from three plain numbers
// until `no-range-minting-outside-ingest` barred it. Both were caught; the primary mint
// site was not, though it is the more consequential of the three — `Finalized<T>` is the
// type the transaction path accepts, where `origin: 'self'` only decides a render.
//
// Callers outside this package obtain `Finalized<T>` by making a read. Suites obtain one
// through `@bleavit/chain-client/testing`, which production code is barred from importing.
export type { Finalized, FinalizedBlockRef } from './provenance.js';
export { meet, hasFinalizedStatus, readmitFromLeader } from './provenance.js';

export * from './domain.js';
export * from './boot.js';
export * from './health.js';
export * from './reads.js';
export * from './codecs.js';
export * from './chain-spec.js';
export * from './topology.js';
export * from './asset-hub.js';
export * from './storage-keys.js';
export * from './transport.js';
