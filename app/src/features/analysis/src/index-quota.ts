/**
 * The §9.2 quota manager's **production call site** — 10 §9.2, §9.3, §9.4; INV-FE-7. F14.
 *
 * `packages/local-index/src/quota.ts` implements every clause of §9.2: the caps, the four
 * shares, the degradation ladder, the label written inside the deleting transaction, the
 * refusals. It had **no caller outside its own suite** — the same finding F25 made one module
 * over about `checkIndexAtBoot`, and with a worse consequence: a boot check nobody runs leaves
 * the user uninformed, while a retention pass nobody runs leaves the index unbounded. §9.4's
 * *IndexedDB growth* row budgets *"§9.2 caps (300 MB / 75 MB) with auto-tuned retention"* and
 * names its enforcement *"quota manager + tests"*, so until this file existed that row was
 * enforced by a module the client never reached, on a device where nothing held the cap at all.
 *
 * It lives in `src/features/analysis` because that is the only compilation unit 10 §10.2 lets
 * reach `local-index`, which is what INV-FE-7 rests on: nothing on the transaction path can see
 * this module, whatever it deletes.
 *
 * ## The three inputs §9.2 does not let this module invent
 *
 * **1. The platform.** §9.2 sizes two device classes and publishes no rule for telling them
 * apart, so the classification is made here, explicitly, and it **fails closed to mobile**.
 * `platformBudget` takes its platform as a required argument for exactly this reason — *"a
 * client that does not know whether it is on a phone would otherwise silently take the desktop
 * cap, which is the unsafe direction (four times the storage on the device most likely to have
 * none)"*. The one non-sniffing signal a browser offers is `navigator.userAgentData.mobile`;
 * where it is absent this client takes the 75 MB cap and **says so on screen**, because §9.2's
 * ladder *"degrades depth, never correctness"* and a shallower history is the survivable error.
 * Whether §9.2 should state the classification, and whether its *"user-adjustable locally"*
 * clause reaches the cap as well as the shares, is SQ-994.
 *
 * **2. The row sizes.** The package refuses a default because §9.1 publishes *"~120 B effective
 * per row (Dexie overhead included)"* as a **modelling assumption** and labels it as one, so a
 * module compiling it in would publish an assumption as a measurement. A client still has to
 * name one, and this is where it is named — once, bound to §9.1's own published figure by
 * `tools/ci/check-frontend-budgets.py`, so it cannot drift from the section the depth tables
 * are derived from.
 *
 * **3. The metadata pins.** §9.3 pins the current and next-authorized runtimes non-evictable,
 * and both are chain facts. This release completes no chain read, so it names neither and says
 * so — see `cachedSpecVersions`, which is what the `unnameable` arm pins instead.
 *
 * ## Why it runs at boot, and where it will have to run next
 *
 * §9.2 computes retention *"from the measured ingest rate"*, and the pass measures the database
 * in front of it. Today the client's only live moment with an open index is the boot path, so
 * that is where it is called. **When a light client and `runIngest` land (F18), the ingest run
 * needs the same call** — a session that ingests for hours between boots would otherwise hold a
 * cap it checked once.
 *
 * That is stated here rather than left to be discovered, and it is bound mechanically rather
 * than by this paragraph: a test asserts that **no module in `app/src` calls `runIngest` at
 * all**, so the day one does, the assertion fails and this note has to be read before the wiring
 * can go green. It is deliberately the weaker claim — a suite cannot tell a retention pass
 * *beside* an ingest run from one merely near it — but it is the one that cannot be satisfied by
 * accident.
 */

import {
  applyQuota,
  cachedSpecVersions,
  platformBudget,
  withIngestLock,
  type LocalIndex,
  type LockManagerLike,
  type Platform,
  type QuotaReport,
  type RowSizes,
  type SettledProposal,
  type StorageBudget,
} from '@bleavit/local-index';

import type { IndexChainIdentity } from './index-identity.js';

/**
 * 10 §9.1's per-row model, in one place, for all four tables it charges.
 *
 * §9 publishes exactly **one** per-row figure and applies it to every row it models: §9.1's
 * observation stream at *"~120 B effective per row"*, §9.2's daily candles at *"`books × 120
 * B/day`"*, and §9.2's own event arithmetic at *"a hundred attributed rows a day costs ~12
 * KB/day"*. The two tables §9 does not model this way are the two the package **measures**
 * instead — `metadataCache` carries each blob's `bytes`, and §6.5's raw blobs are weighed by
 * `pendingRawBytes` — so nothing here models a byte count that could be read.
 *
 * `proposalsArchive` is the one row §9 gives no figure for at all (SQ-995): a summary is a
 * string this client writes, and compaction replaces many event rows with one of these, so the
 * model has to be at most an event's or compaction would *raise* the measured share it is run
 * to lower. It is charged at the same published figure until §9 states one.
 */
export const MODELLED_ROW_BYTES = 120;

/** §9.1's model as the quota manager takes it. One figure, four tables — see above. */
export const MODELLED_ROW_SIZES: RowSizes = Object.freeze({
  priceSample: MODELLED_ROW_BYTES,
  candle: MODELLED_ROW_BYTES,
  event: MODELLED_ROW_BYTES,
  archiveRow: MODELLED_ROW_BYTES,
});

/**
 * The device class §9.2 sizes for, and **why** this client believes it.
 *
 * A reason rather than a bare platform, for the reason every other absence in this client
 * carries one: a 75 MB cap on a laptop is a visible, permanent halving of history depth, and a
 * user who cannot see that it was a fallback rather than a measurement has no way to ask for it
 * to be lifted.
 */
export interface StorageProfile {
  readonly platform: Platform;
  readonly why: string;
}

/** The one hint a browser publishes about its own form factor, read as itself. */
export interface DeviceHints {
  /** `navigator.userAgentData.mobile`, or `undefined` where the browser publishes none. */
  readonly mobile: boolean | undefined;
}

/**
 * Read the form-factor hint off a `navigator`-shaped object, without a cast and without
 * inventing an answer.
 *
 * `userAgentData` is not in the DOM lib this workspace pins, and the alternative — parsing the
 * user-agent string — is not taken: token sniffing can only *confirm* mobile, which the
 * fail-closed default already covers, so it would buy nothing while adding a table of browser
 * strings nothing can keep current.
 */
export function deviceHints(source: unknown): DeviceHints {
  if (typeof source !== 'object' || source === null) return { mobile: undefined };
  if (!('userAgentData' in source)) return { mobile: undefined };
  const data: unknown = source.userAgentData;
  if (typeof data !== 'object' || data === null || !('mobile' in data)) return { mobile: undefined };
  const mobile: unknown = data.mobile;
  return { mobile: typeof mobile === 'boolean' ? mobile : undefined };
}

/**
 * Classify this device into one of §9.2's two, failing closed to the smaller cap.
 *
 * A pure function of the hints so the fallback is testable on the shape a phone-less test
 * environment produces, which is also the shape Firefox and Safari produce.
 */
export function storagePlatform(hints: DeviceHints): StorageProfile {
  if (hints.mobile === true) {
    return {
      platform: 'mobile',
      why: 'this browser reports a mobile device, so 10 §9.2’s 75 MB mobile cap applies.',
    };
  }
  if (hints.mobile === false) {
    return {
      platform: 'desktop',
      why: 'this browser reports a non-mobile device, so 10 §9.2’s 300 MB desktop cap applies.',
    };
  }
  return {
    platform: 'mobile',
    why:
      'this browser publishes no form-factor hint, so this client cannot tell a laptop from a ' +
      'phone and applies the smaller of 10 §9.2’s two caps — 75 MB. Storing less than a device ' +
      'could hold costs history depth; storing four times what a phone can hold costs the ' +
      'browser’s own eviction, which takes whichever rows it likes.',
  };
}

/**
 * §9.3's non-evictable set — the current and next-authorized runtimes — or the reason this
 * client cannot name it.
 *
 * A union rather than an array with an empty case, because empty is the one value that must not
 * be reachable by accident: it means *every blob may be evicted*, and it is exactly what a
 * client that has read nothing would otherwise supply.
 */
export type MetadataPins =
  | { readonly kind: 'named'; readonly specVersions: readonly number[] }
  | { readonly kind: 'unnameable'; readonly reason: string };

export interface StorageBudgetOptions {
  /**
   * The chain whose index this is — the lock's scope, and the reason it is not the database
   * handle alone.
   *
   * `ingestLockName` scopes the `fut-ingest` lock per chain, exactly as the database name is
   * scoped, so one lock cannot serialise two unrelated chains. The identity therefore has to
   * reach this function, and it is the same value `bootLocalIndex` opened the database with.
   */
  readonly chain: IndexChainIdentity;
  /**
   * `navigator.locks`, or `undefined` where the environment has no Web Locks.
   *
   * Injected rather than read here, the shape `withIngestLock` already takes: a suite has to be
   * able to drive the busy branch, which is the branch a happy-path test never enters.
   */
  readonly locks: LockManagerLike | undefined;
  readonly profile: StorageProfile;
  readonly pins: MetadataPins;
  /** Unix seconds. Injected so a pass is deterministic and a bucket's closure is decidable. */
  readonly now: number;
  /**
   * §9.2's compaction input — *"`events` for settled+reaped proposals"*.
   *
   * Injected and never derived, as the package requires: settlement and reaping are chain facts
   * and this unit may not decide them. Absent is the ordinary state of a client with no chain
   * connection, and it costs depth rather than truth — the events stay.
   */
  readonly settled?: readonly SettledProposal[];
}

/**
 * What the retention pass did, or why it did not.
 *
 * Four arms, and collapsing any two of them makes the surface say something false. `not-run` is
 * F25's asymmetry applied one module over — a pass that never ran must never render as one that
 * ran and found nothing to do, because the second reads as *your storage is inside its budget*
 * and nobody checked. `deferred` is not that either: another tab **is** applying the budget, so
 * *"nothing was measured"* would be wrong in the opposite direction. And `interrupted` is the
 * arm the first version of this file did not have: `applyQuota` can throw **after** committed
 * folds — its final `measureUsage`/`measureDepth`/`budgetHolds` all run once the ladder has
 * already deleted rows — so a caught throw may not say *nothing was removed*. It cannot say how
 * much was, either, which is what its copy states.
 */
export type RetentionOutcome =
  | {
      readonly kind: 'applied';
      readonly profile: StorageProfile;
      /** §9.2's budget for this platform, as published — never the one handed to the pass. */
      readonly budget: StorageBudget;
      readonly report: QuotaReport;
      /**
       * Why §9.3's metadata rung was made inert on this pass, when it was.
       *
       * Set only when the pinned set could not be resolved. See `enforceStorageBudget`.
       */
      readonly metadataRungSkipped?: string;
    }
  /** Another tab of this app holds `fut-ingest`; it is applying the budget and this tab is not. */
  | { readonly kind: 'deferred'; readonly reason: string }
  /** Nothing was attempted. */
  | { readonly kind: 'not-run'; readonly reason: string }
  /** A pass began and did not finish, so what it had already freed cannot be stated. */
  | { readonly kind: 'interrupted'; readonly reason: string };

/**
 * Hold 10 §9.2's cap on this device's local index.
 *
 * ## One writer, because the pass deletes rows and rewrites one `meta` row wholesale
 *
 * 10 §4.4 gives ingestion to the leader through `fut-ingest`, and `withIngestLock` has existed
 * since F8 with **no production caller**. That was survivable while nothing wrote to the index;
 * it stops being survivable the moment a *destructive* pass runs in every tab at boot. The race
 * is not hypothetical and it is the one §9.2 obligation 1 exists to forbid: `applyQuota` reads
 * the `downsampled` accumulator once and each fold writes the whole set back, so two passes
 * running together each persist their own accumulator — the later one erasing a label whose rows
 * the earlier one has already deleted. That is the silent splice, produced by a user having the
 * app open twice.
 *
 * A tab that cannot take the lock returns `deferred` rather than queueing, which is §4.4's own
 * reasoning: a follower that waited would become the writer the moment the leader closed, using
 * whatever state it last read.
 *
 * **No Web Locks means no pass, and that is consistent rather than merely cautious.** The
 * package refuses to *ingest* unlocked, so on such an environment nothing writes to the index —
 * and an index nothing writes to has nothing to retain. Running the ladder unlocked would be the
 * one code path nobody tests doing the one thing this lock exists to prevent.
 *
 * ## Every failure becomes a reported outcome rather than a throw
 *
 * INV-FE-7 makes browser-local storage a non-authoritative cache whose loss or corruption is
 * *"a performance and convenience event only"*, so a boot path that threw here would convert the
 * one event the invariant says the client must survive into a client that does not start.
 *
 * **The pinned set is resolved in its own `try`, and that is not tidiness.** `applyQuota` was
 * rewritten one level down precisely because a metadata-cache condition used to abandon the
 * chart ladder and §9.1's raw-blob bound — *"the one tier §9.1 forbids retaining grew without
 * limit under a pass that reported nothing at all"*. Resolving the pins inside the same `try` as
 * the pass reintroduces that defect one level up, and in the fail-**open** direction on the very
 * cap this row enforces. So a pin failure makes §9.3's rung inert for this pass — nothing is
 * evicted on an unknown pinned set — and every other rung still runs, with the reason carried on
 * the outcome.
 */
export async function enforceStorageBudget(
  db: LocalIndex | undefined,
  options: StorageBudgetOptions,
): Promise<RetentionOutcome> {
  if (db === undefined || options.chain.kind === 'unpinned') {
    return {
      kind: 'not-run',
      reason:
        'no local index was opened this session, so there is nothing stored for a storage ' +
        'budget to apply to.',
    };
  }
  if (options.locks === undefined) {
    return {
      kind: 'not-run',
      reason:
        'this browser offers no Web Locks, so this client cannot guarantee that only one tab ' +
        'writes to local history. It does not ingest under that condition either, so there is ' +
        'nothing accumulating for a budget to hold back.',
    };
  }
  const budget = platformBudget(options.profile.platform);

  // Resolved before the lock is taken and outside the pass's own `try` — see the note above.
  let pinnedSpecVersions: readonly number[] = [];
  let metadataRungSkipped: string | undefined;
  try {
    pinnedSpecVersions =
      options.pins.kind === 'named' ? options.pins.specVersions : await cachedSpecVersions(db);
  } catch (error) {
    metadataRungSkipped = reasonOf(error);
  }
  // An unresolvable pinned set makes §9.3's rung inert rather than either evicting on a guess or
  // ending the pass. The **published** budget still travels on the outcome; only the copy handed
  // to `applyQuota` is widened, so nothing the surface renders describes a bound that was not
  // §9.2's.
  const passBudget: StorageBudget =
    metadataRungSkipped === undefined
      ? budget
      : { ...budget, metadataBlobs: Number.MAX_SAFE_INTEGER, metadataBytes: Number.MAX_SAFE_INTEGER };

  const outcome = await runLocked(options, async () => {
    try {
      const report = await applyQuota(db, {
        budget: passBudget,
        sizes: MODELLED_ROW_SIZES,
        now: options.now,
        pinnedSpecVersions,
        ...(options.settled === undefined ? {} : { settled: options.settled }),
      });
      const applied: RetentionOutcome = {
        kind: 'applied',
        profile: options.profile,
        budget,
        report,
        ...(metadataRungSkipped === undefined ? {} : { metadataRungSkipped }),
      };
      return applied;
    } catch (error) {
      // Not `not-run`: the ladder may already have committed folds before this threw, and a
      // sentence saying nothing was removed would be false exactly when rows are gone.
      return { kind: 'interrupted', reason: reasonOf(error) } as const;
    }
  });
  return outcome;
}

/** A caught failure as the outcome states it — the message, never `[object Object]`. */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Run the pass under `fut-ingest`, turning both of the lock's own outcomes into arms of this
 * module's.
 *
 * `withIngestLock` throws only when the API is absent, which `enforceStorageBudget` has already
 * refused above; the `catch` is kept because a lock request can also be rejected by the
 * environment, and INV-FE-7 does not admit a boot that throws.
 */
async function runLocked(
  options: StorageBudgetOptions,
  pass: () => Promise<RetentionOutcome>,
): Promise<RetentionOutcome> {
  if (options.chain.kind !== 'pinned') {
    return { kind: 'not-run', reason: 'no chain is pinned, so there is no lock to scope' };
  }
  try {
    const held = await withIngestLock(options.locks, options.chain.paraGenesisHash, pass);
    if (held.kind === 'busy') {
      return {
        kind: 'deferred',
        reason:
          'another tab of this app is applying the storage budget. Only one may write to local ' +
          'history at a time, so this tab left it to that one rather than writing beside it.',
      };
    }
    return held.value;
  } catch (error) {
    return { kind: 'not-run', reason: reasonOf(error) };
  }
}
