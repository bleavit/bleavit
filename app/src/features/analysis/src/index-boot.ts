/**
 * The local index's **production call site** — 10 §3.1 `StorageOpen`, §6.3's per-range checks. F25.
 *
 * `checkIndexAtBoot` has existed since F8 and had no caller outside its own suite, so every
 * disclosure the package writes had a producer and no reader. This is the caller. It lives in
 * `src/features/analysis` because that is the only compilation unit 10 §10.2 lets reach
 * `local-index` at all, and the firewall is what INV-FE-7 rests on: nothing on the transaction
 * path can see this module, whatever it does.
 *
 * ## The chain identity is an argument with no default, and today there is none
 *
 * §7 names the database `futarchy@<paraGenesisHash-prefix8>` — one database per chain identity —
 * and `LocalIndex`'s constructor takes that hash as a required, validated argument for a reason
 * F8 states plainly: a client that connected to one chain yesterday and another today would
 * otherwise read yesterday's positions, prices and history as today's, with nothing downstream
 * able to notice, because the rows are well-formed and both chains number their proposals from
 * one.
 *
 * This release pins no parachain genesis hash — `chainIdentity.genesisHashes.para` in
 * `app/tools/release/sources/release-sources.json` is `null`, a declared readiness blocker
 * (12 §1.1, and the same pre-genesis state `check:artifact-budget` gates on). So there is
 * nothing to open an index *for*, and the honest outcome is `not-opened` rather than a database
 * under an invented name. The suite binds that claim to the file, so the day a genesis is
 * pinned the assertion fails and this wiring has to be finished rather than quietly staying
 * unreached.
 *
 * ## `not-opened` is not `checked-and-clean`, and that is the whole point of the arm
 *
 * The defect this milestone exists to remove is a record nothing reads. Its exact analogue one
 * level up is an index nothing opened rendering as an index that was opened and was fine —
 * §6.3's *cannot say* asymmetry applied to the boot path itself. So the state has three arms
 * and the surface renders all three.
 */

import {
  LocalIndex,
  checkIndexAtBoot,
  type CoverageRange,
  type RangeEdgeFacts,
} from '@bleavit/local-index';

import type { IndexBootState } from './index-disclosure.js';
// `IndexChainIdentity` was declared here until F14 and now lives in a leaf module, because
// `index-quota.ts` needs it too and importing it from here closed a three-module cycle that
// `tsc` accepts and `depcruise` does not — see `index-identity.ts`.
import type { IndexChainIdentity } from './index-identity.js';

export type { IndexChainIdentity };

/** How the chain answered about a range's edge block, or `undefined` for *cannot say*. */
export type RangeObserver = (range: CoverageRange) => RangeEdgeFacts | undefined;

/**
 * The observer for a client with no chain connection: **every range is *cannot say***.
 *
 * Not a placeholder and not a stub. §6.3 states that an unreachable chain, a block outside the
 * pinned window and a client still syncing all produce the same answer, that such a range is
 * **kept**, and that only a disagreement invalidates. A client that has not started a light
 * client is the first of those, exactly, so `undefined` is the true answer rather than a
 * convenient one — and the surface renders every such range in the `unchecked` list, which is
 * where a reader must find them.
 *
 * Nothing in this client calls `startLightClient`: no chain spec is bundled and no topology is
 * started (F18's artifact-blocked remainder). The suite asserts that too, so this observer
 * cannot outlive the condition that makes it true.
 */
export const cannotObserve: RangeObserver = () => undefined;

/** The opened database, when there is one. Returned so a later consumer need not reopen it. */
export interface IndexBootOutcome {
  readonly state: IndexBootState;
  readonly db: LocalIndex | undefined;
}

/**
 * Open the local index for this release's chain and run 10 §6.3's per-range checks over it.
 *
 * **Every failure becomes a rendered state rather than a throw.** INV-FE-7 makes browser-local
 * storage a non-authoritative cache whose loss, corruption or eviction is *"a performance and
 * convenience event only"*, and 10 §3.1 makes an IndexedDB open or upgrade failure explicitly
 * non-terminal (`FE-BOOT-001` → `MemoryOnly`). A boot path that threw here would convert the
 * one event the invariant says the client must survive into a client that does not start.
 */
export async function bootLocalIndex(
  chain: IndexChainIdentity,
  observe: RangeObserver,
): Promise<IndexBootOutcome> {
  if (chain.kind === 'unpinned') {
    return { state: { kind: 'not-opened', reason: chain.reason }, db: undefined };
  }
  try {
    const db = new LocalIndex(chain.paraGenesisHash);
    const report = await checkIndexAtBoot(db, observe);
    return { state: { kind: 'checked', report }, db };
  } catch (error) {
    // The handle is dropped rather than returned half-open: a database that failed to open or
    // upgrade is one this session runs without, and handing back a reference to it invites a
    // later caller to use it as though the check had succeeded.
    return {
      state: {
        kind: 'unopenable',
        reason: error instanceof Error ? error.message : String(error),
      },
      db: undefined,
    };
  }
}
