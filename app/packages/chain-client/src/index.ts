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
//
// `derive` IS re-exported, and the distinction from `finalize` is the whole of why. `finalize`
// takes a value and a pin, both supplied by the caller, so it labels anything. `derive` takes a
// `Finalized<A>` — a read that already happened — and attaches *that read's* pin, so a caller
// with nothing to pass in gets nothing. It is the second clause of 10 §2.2 ("computed
// client-side purely from such values") made callable, and it exists so the honest thing is
// expressible: before it, every reader in `src/` wrote its own local stamping helper, and each
// of those helpers relabelled whatever it was handed.
//
// It widens nothing. `meet(a, a, …)` was already this function under another name, and `meet`
// was already exported. What it removes is the incentive that produced V-182 and V-200 — a
// reader hand-writing a `verified-finalized` status object because the unary case had no
// sanctioned spelling, which is the same brand-less mint one layer out.
export type { Finalized, FinalizedBlockRef } from './provenance.js';
export { derive, meet, hasFinalizedStatus, readmitFromLeader } from './provenance.js';

export * from './domain.js';
export * from './boot.js';
export * from './health.js';
export * from './reads.js';
export * from './codecs.js';
export * from './chain-spec.js';
export * from './topology.js';
export * from './asset-hub.js';
export * from './metadata.js';
export * from './event-accounts.js';
export * from './storage-keys.js';
export * from './transport.js';
