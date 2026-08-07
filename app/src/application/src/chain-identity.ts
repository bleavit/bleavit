/**
 * Which chain this release is for — 10 §3.1's `IdentityCheck` pin, 12 §1.1's declared sources. F25.
 *
 * ## Why the client cannot simply read this
 *
 * 10 §5.4 forbids a compiled-in chain value that *parameterises* the client, and permits exactly
 * the pins that *verify* it: `release-sources.json`'s `chainIdentity` block is that set, and its
 * own note says so — *"they are used to verify the chain, not to parameterise it. A null is a
 * readiness blocker, never a default"*. `release:build` reads it and refuses to produce a
 * production release while any of it is null.
 *
 * **Every hash in that block is null today.** The bootnode program has no seated operators, no
 * production chain spec exists, and no genesis hash exists to pin, so the release emits no
 * chain-spec bytes at all — which `app/tools/check-artifact-budget.ts` gates on from the other
 * side, requiring the emitted tree to be empty while the blocker stands.
 *
 * ## What that costs the local index, said here rather than discovered downstream
 *
 * 10 §7 names the index database `futarchy@<paraGenesisHash-prefix8>` — one per chain identity —
 * and `LocalIndex` takes that hash as a required argument with no default, because a client that
 * shared one database across two chains would read the other chain's positions, prices and
 * history as this one's, with nothing downstream able to notice. With no pin there is nothing to
 * open an index for, and the honest answer is a named absence rather than a database under an
 * invented name.
 *
 * The reason string is what the user is shown, so it states the fact rather than the mechanism.
 * `app/tests/analysis` binds this claim to `release-sources.json` itself: the moment a parachain
 * genesis is pinned, that assertion fails and this function has to start returning it.
 */

import type { IndexChainIdentity } from '@bleavit/features-analysis';

/**
 * The parachain identity this release pins, or the reason it pins none.
 *
 * Deliberately a function rather than a constant: it is a statement about *this build*, in the
 * same sense `implementedScreens()` is, and both are read at boot rather than frozen into a
 * module-level value that a future release would inherit without noticing.
 */
export function releaseParaChain(): IndexChainIdentity {
  return {
    kind: 'unpinned',
    reason:
      'this release pins no Bleavit parachain, because none has been launched yet. A local ' +
      'history store belongs to exactly one chain, so there is none to open.',
  };
}
