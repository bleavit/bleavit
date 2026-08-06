/**
 * The reads behind S5, S6, S7 and S8 — 11 §11.2's *Primary reads* column, exactly.
 *
 * One module for four screens because they share one shape: a single chain, a single
 * reader, a single pin, and a model whose every leaf is stamped from it. `funding-reads.ts`
 * is the exception in this package and says why — it spans two chains, so it has no
 * `assertOnePin` analogue. These four have one, and it is not decoration: a settlements
 * table whose cohort ring came from one block and whose execution ring came from the next
 * is not a stale view, it is a view that never existed, and nothing on screen tells the
 * two apart.
 *
 * ## What is injected, and why it is not a convenience
 *
 * Storage keys are SCALE-encoded and `packages/chain-client` is the only package permitted
 * to import `polkadot-api` (10 §10.1, app-code rule 13). So this module **names** the
 * frozen surfaces and receives the encoders and decoders, exactly as `readShellState` and
 * `readDepositInputs` do. Keys are per-surface functions rather than one
 * `key(pallet, item, …args)`, because a generic entry point invites the wrong arguments
 * for the wrong map and nothing catches it — the key encodes to *something*, the read
 * returns nothing, and an empty map is indistinguishable from a real empty one.
 *
 * ## The FE-P2 pairing is the reader's, never the call site's
 *
 * S5 and S6 both sit on the transaction path, so their runtime-API results go through
 * `crossCheckedCall`, which derives the storage prefix from the API name (10 §4.2, §11).
 * S7 and S8 are reading screens with no extrinsic; they still cross-check, because the
 * cost is one read and the failure it catches — a client misreading an aggregate's
 * semantics — is not a transaction-path property.
 *
 * ## A decode failure is data
 *
 * INV-FE-12: undecodable data renders as raw SCALE with a warning, never as a substituted
 * value. Every reader here returns its failures beside its model rather than throwing, and
 * a value that could not be read is **absent** from the model rather than zero.
 *
 * @see docs/architecture/11-frontend-workflows.md §11.2, §11.4, §11.5
 * @see docs/architecture/02-integration-contract.md §3, §4, §7, §9
 */

import { derive } from '@bleavit/chain-client';
import type { Finalized, FinalizedBlockRef, StorageItem } from '@bleavit/chain-client';
import type { Verified } from '@bleavit/shared-types';
import type { Decoded } from './proposal-reads.js';
import type { CohortProposal, CohortRecord, ExecutionRecordRow } from './settlements.js';
import type { ParamRow, SnapshotRow, WelfarePillars } from './welfare-dashboard.js';

/** A value the client read but could not interpret. Rendered, never substituted. */
export interface UndecodableRead {
  readonly label: string;
  readonly rawHex: string;
  readonly reason: string;
}

/**
 * What these four screens need from a reader: one pin, storage, calls, and the FE-P2 pair.
 *
 * Structural rather than the `FinalizedReader` class, for `ProposalsReader`'s reason: a
 * class with `#private` fields is nominal, so a suite could reach this code only through a
 * real transport and a recorded transcript. `FinalizedReader` satisfies this shape, which
 * is what keeps the two from drifting.
 */
export interface CoreReader {
  readonly at: FinalizedBlockRef;
  storage(
    key: string,
    type?: 'value' | 'descendantsValues',
  ): Promise<Finalized<readonly StorageItem[]>>;
  /** Takes the **full** runtime-API name (`FutarchyApi_…`), as `FinalizedReader.call` does. */
  call(api: string, argsHex?: string): Promise<Finalized<string>>;
  crossCheckedCall(source: {
    readonly api: string;
    readonly storagePrefix: string;
    readonly argsHex?: string;
  }): Promise<Finalized<{ readonly result: string; readonly witness: readonly StorageItem[] }>>;
}

// --------------------------------------------------------------- frozen surfaces

/** S5's frozen surfaces — 11 §11.2's S5 row, 02 §3/§7.1/§7.6. */
export const SUBMIT_READS = Object.freeze({
  epochStatus: 'epoch_status',
  epochOf: 'Epoch.EpochOf',
  intakeQueue: 'Epoch.IntakeQueue',
  preimageFor: 'Preimage.PreimageFor',
  preimageStatus: 'Preimage.StatusFor',
} as const);

/** S6's frozen surfaces — 11 §11.2's S6 row, 02 §3/§7.8. */
export const QUEUE_READS = Object.freeze({
  executionQueue: 'execution_queue',
  queue: 'ExecutionGuard.Queue',
} as const);

/**
 * S7's frozen surfaces — 11 §11.2's S7 row, 02 §3/§7.3/§7.4.
 *
 * `paramsApi` is the read and `params` is the prefix it is cross-checked against. Reading
 * the storage item **alone** was the defect: the constitution rows S7 shows include
 * `min_next`, `max_next` and `cooldown_blocks`, which the stored `ParamRecord` does not
 * carry — the runtime derives them from `admissible_next_interval()` and the live
 * `epoch.length`. 11 §11.2's own Primary-reads column names `params()`, and §11.4 rule 2
 * forbids the client computation the raw item would have forced.
 */
export const WELFARE_READS = Object.freeze({
  current: 'welfare_current',
  snapshots: 'Welfare.Snapshots',
  metricSpecs: 'Welfare.MetricSpecs',
  gateBreachFlags: 'Welfare.GateBreachFlags',
  paramsApi: 'params',
  params: 'Constitution.Params',
} as const);

/** S8's frozen surfaces — 11 §11.2's S8 row, 02 §3/§7.1/§7.4. */
export const SETTLEMENT_READS = Object.freeze({
  recentCohorts: 'recent_cohorts',
  recentCohortSummaries: 'Epoch.RecentCohortSummaries',
  executionRecords: 'ExecutionGuard.ExecutionRecords',
  baselineMarketOf: 'Market.BaselineMarketOf',
} as const);

// --------------------------------------------------------------- injected ports

/**
 * Storage-key construction, one function per surface.
 *
 * **Only the surfaces a reader below reads directly.** The prefixes paired with a
 * runtime-API result — `ExecutionGuard.Queue`, `Welfare.Snapshots`,
 * `Epoch.RecentCohortSummaries` — are named to `crossCheckedCall` and resolved by the
 * reader, so a key function for them would be one nobody calls: an injected port with no
 * caller can disagree with the prefix the cross-check actually used, and no test can see it
 * because nothing exercises it.
 */
export interface CoreKeys {
  intakeQueue(): string;
  /** `Preimage.PreimageFor((hash, len))` — a double map, so both keys are needed. */
  preimageFor(hash: string, len: number): string;
  preimageStatus(hash: string): string;
  gateBreachFlags(epoch: number): string;
  executionRecords(): string;
  baselineMarketOf(epoch: number): string;
  /**
   * SCALE-encoded arguments for `params(keys)` — a `BoundedVec<ParamKey, 64>`.
   *
   * An encoder rather than a storage key, and it lives here for the same reason the keys
   * do: only `packages/chain-client` may import `polkadot-api` (10 §10.1). The bound is
   * the chain's (02 §3), so an over-long key list is the encoder's refusal, not this
   * module's guess.
   */
  paramsArgs(keys: readonly string[]): string;
}

/** The value decoders, one per surface — never one per shape (see `FundingDecoders`). */
export interface CoreDecoders {
  readonly epochStatus: (
    raw: string,
  ) => Decoded<{ readonly epoch: number; readonly phase: string; readonly phaseFlags: number }>;
  readonly intakeQueue: (raw: string) => Decoded<readonly string[]>;
  /** `Preimage.PreimageFor` holds the bytes; absence is the map's answer, not a failure. */
  readonly preimageBytes: (raw: string) => Decoded<{ readonly len: number }>;
  /** `Preimage.StatusFor` — `requested` is what `preimage.request_preimage` sets. */
  readonly preimageStatus: (raw: string) => Decoded<{ readonly requested: boolean }>;
  readonly executionQueue: (raw: string) => Decoded<readonly QueuedExecution[]>;
  /**
   * One `ExecutionGuard.Queue` **stored** entry (02 §7.4), which is not the view.
   *
   * Its own decoder because it answers one question the runtime-API projection cannot:
   * `failed_at`. `QueuedExecutionView` publishes `maturity`, `grace_end`, `cancelled`,
   * `ratification` and `meters_clear` and omits the one field that moves the execution
   * deadline (SQ-791).
   */
  readonly queueEntry: (raw: string) => Decoded<StoredQueueEntry>;
  readonly welfareCurrent: (raw: string) => Decoded<WelfareCurrentRecord>;
  readonly welfareSnapshot: (raw: string) => Decoded<{
    readonly epoch: number;
    readonly specVersion: number;
    readonly w1e9: bigint;
  }>;
  readonly gateBreachFlags: (raw: string) => Decoded<{
    readonly sBreached: boolean;
    readonly cBreached: boolean;
  }>;
  /** The whole `params(keys)` answer — a `BoundedVec<ParamView, 64>` (02 §3/§4). */
  readonly paramViews: (raw: string) => Decoded<readonly ParamViewRecord[]>;
  readonly recentCohorts: (raw: string) => Decoded<readonly CohortSummaryRecord[]>;
  readonly executionRecords: (raw: string) => Decoded<readonly ExecutionRecordRecord[]>;
}

/** One `execution_queue()` entry, as 02 §4's `QueuedExecutionView` publishes it. */
export interface QueuedExecution {
  readonly pid: string;
  readonly klass: string;
  readonly payloadHash: string;
  readonly maturity: number;
  readonly graceEnd: number;
  readonly cancelled: boolean;
  readonly ratification: string;
  readonly metersClear: boolean;
}

/** 02 §4's `WelfareView`, decoded. `specVersion` is meaningful only under the flag. */
export interface WelfareCurrentRecord {
  readonly epoch: number;
  readonly specVersion: number;
  readonly sPillar1e9: bigint;
  readonly cOnchain1e9: bigint;
  readonly cAttested1e9: bigint;
  readonly pPillar1e9: bigint;
  readonly aPillar1e9: bigint;
  readonly gateS1e9: bigint;
  readonly gateC1e9: bigint;
  readonly wCurrent1e9: bigint;
  readonly sBreached: boolean;
  readonly cBreached: boolean;
  readonly reserveFlag: boolean;
  readonly activeSpecAvailable: boolean;
}

/**
 * 02 §4's `ParamView`, decoded. Every scalar is the raw stored inner value.
 *
 * Named for the **view** rather than for `constitution_core::ParamRecord`, because the two
 * are different structures and the difference is the whole of this reader's S7 defect: the
 * stored record carries `max_delta` and `cooldown_epochs`, while `min_next`, `max_next` and
 * `cooldown_blocks` exist only in the projection the runtime computes.
 */
export interface ParamViewRecord {
  readonly key: string;
  readonly value: bigint;
  readonly min: bigint;
  readonly max: bigint;
  readonly minNext: bigint;
  readonly maxNext: bigint;
  readonly cooldownBlocks: number;
  readonly lastChange: number;
  readonly klass: string;
}

/**
 * `pallet_execution_guard::StoredQueuedExecution`'s fields this client reads (02 §7.4).
 *
 * Only two: the `pid` that pairs a stored row with its `execution_queue()` entry, and the
 * `failed_at` stamp that decides which deadline `execute` enforces. Everything else on the
 * stored entry is already published by the view, and decoding a field twice is two chances
 * to disagree with the chain about one value.
 */
export interface StoredQueueEntry {
  readonly pid: string;
  /** `Option<BlockNumber>` — `undefined` is the chain's `None`, never an unread field. */
  readonly failedAt: number | undefined;
}

/** 02 §4's `CohortSummary`, decoded. */
export interface CohortSummaryRecord {
  readonly epoch: number;
  readonly s1e9: bigint;
  readonly baselineTwap1e9: bigint;
  readonly proposals: readonly {
    readonly id: string;
    readonly klass: string;
    readonly outcome: string;
  }[];
  readonly voided: boolean;
  readonly settledAt: number;
}

/** `futarchy_primitives::ExecutionRecord`, decoded. */
export interface ExecutionRecordRecord {
  readonly pid: string;
  readonly payloadHash: string;
  readonly klass: string;
  readonly executedAt: number;
  readonly succeeded: boolean;
  /** Present only on a rollback: the failing call index and its error. */
  readonly failure?: string;
}

// --------------------------------------------------------------- shared helpers

function firstValue(items: readonly StorageItem[]): string | undefined {
  return items[0]?.value;
}

/**
 * Split a finalized decode into its two arms, each still carrying the read's own pin.
 *
 * This and {@link elements} replace a local `stamp(at, value)` helper that wrapped **any**
 * value in a hand-written `verified-finalized` status object. The brand is a non-exported
 * `unique symbol` in `packages/chain-client`, so what that helper produced was a plain
 * `Verified<T>`, and every model leaf it fed asserted finality for a value whose provenance
 * nothing had checked. It is the V-186 defect, and it matters more here than in the render
 * layer that one was found in: these leaves feed the S5 and S6 **precondition** gates, and
 * 11 §11.4 rule 4 says provider data never satisfies a precondition.
 *
 * `derive` is 10 §2.2's *"computed client-side purely from such values"* clause, and it is
 * the whole repair — a leaf can be finalized only because a read was actually made, and the
 * pin is that read's rather than one supplied alongside it. The projection ignores its
 * argument only because TypeScript cannot narrow a union through a wrapper: `decoded.value`
 * **is** `read.value.value`, so the value is genuinely the read's.
 */
function splitDecoded<T>(
  read: Finalized<Decoded<T>>,
):
  | { readonly ok: true; readonly read: Finalized<T> }
  | { readonly ok: false; readonly reason: string } {
  const decoded = read.value;
  if (!decoded.ok) return { ok: false, reason: decoded.reason };
  return { ok: true, read: derive(read, () => decoded.value) };
}

/**
 * Each element of a finalized list, under the list's own pin — see {@link splitDecoded}.
 *
 * Every element **is** part of `read.value`, so the derived leaf descends from the read
 * rather than being stamped beside it.
 */
function elements<T>(read: Finalized<readonly T[]>): readonly Finalized<T>[] {
  return read.value.map((element) => derive(read, () => element));
}

/**
 * Re-check that every leaf of a finished model belongs to the reader's pin.
 *
 * Redundant by construction while every leaf descends from a read this reader made — and
 * kept, and **exported**, for the reason `readShellState`'s analogue is: no input to the
 * readers below can produce a mixed model, so a test driving the public API could only
 * assert that two hashes it wrote itself differ, which proves nothing about this function.
 * A defensive check whose test cannot reach it is the vacuous control this repository keeps
 * finding.
 *
 * It takes leaves rather than a model shape so it can serve four differently-shaped
 * screens without knowing any of them.
 */
export function assertOnePin(leaves: readonly Verified<unknown>[], blockHash: string): void {
  for (const leaf of leaves) {
    const at = 'blockHash' in leaf.status ? leaf.status.blockHash : undefined;
    if (at !== blockHash) {
      throw new Error(
        `this model mixes blocks: a leaf carries ${String(at)} while the reader is pinned ` +
          `at ${blockHash}. A screen assembled from two blocks shows a state that never ` +
          'existed, and nothing on it distinguishes that from one that did.',
      );
    }
  }
}

// ------------------------------------------------------------------- S5's reads

export interface SubmitRead {
  /** Absent when the epoch status could not be read or decoded. */
  readonly phase: Finalized<string> | undefined;
  /** Absent when `Epoch.IntakeQueue` could not be read or decoded. */
  readonly intakeQueueLen: Finalized<number> | undefined;
  /** `Preimage.PreimageFor((hash, len))` holds the bytes. */
  readonly preimageNoted: Finalized<boolean>;
  /** `Preimage.StatusFor(hash)` is requested — pinned against reaping. */
  readonly preimageRequested: Finalized<boolean>;
  /** The length the chain actually holds, which need not be the declared one. */
  readonly notedLen: Finalized<number> | undefined;
  readonly undecodable: readonly UndecodableRead[];
}

/**
 * Read S5's chain-side inputs at the reader's pinned block.
 *
 * The absent cases are deliberately **absent** rather than zero. An `intakeQueueLen` of 0
 * is *"the queue is empty, submit away"*; a failed read of the same item must not say that,
 * which is why `submitBlocks`' caller receives `undefined` and treats it as unread.
 */
export async function readSubmitInputs(
  reader: CoreReader,
  keys: CoreKeys,
  decoders: CoreDecoders,
  params: { readonly payloadHash: string; readonly declaredLen: number },
): Promise<SubmitRead> {
  const at = reader.at;
  const undecodable: UndecodableRead[] = [];

  // FE-P2: the epoch status paired with its own storage item, by the reader.
  const status = await reader.crossCheckedCall({
    api: SUBMIT_READS.epochStatus,
    storagePrefix: SUBMIT_READS.epochOf,
  });
  const statusDecoded = splitDecoded(derive(status, (raw) => decoders.epochStatus(raw.result)));
  if (!statusDecoded.ok) {
    undecodable.push({
      label: SUBMIT_READS.epochStatus,
      rawHex: status.value.result,
      reason: statusDecoded.reason,
    });
  }

  const queueRead = await reader.storage(keys.intakeQueue());
  // An absent `IntakeQueue` is a legitimate empty queue: the value-query default of a
  // `BoundedVec` storage item is the empty vector, so this is the one absent read here
  // that is genuinely a zero rather than a failure.
  const queueDecoded = splitDecoded(
    derive(queueRead, (items): Decoded<readonly string[]> => {
      const raw = firstValue(items);
      return raw === undefined ? { ok: true, value: [] } : decoders.intakeQueue(raw);
    }),
  );
  if (!queueDecoded.ok) {
    undecodable.push({
      label: SUBMIT_READS.intakeQueue,
      rawHex: firstValue(queueRead.value) ?? '0x',
      reason: queueDecoded.reason,
    });
  }

  const bytesRead = await reader.storage(keys.preimageFor(params.payloadHash, params.declaredLen));
  const bytesRaw = firstValue(bytesRead.value);
  const bytesDecoded =
    bytesRaw === undefined
      ? undefined
      : splitDecoded(derive(bytesRead, () => decoders.preimageBytes(bytesRaw)));
  if (bytesDecoded !== undefined && !bytesDecoded.ok) {
    undecodable.push({
      label: `${SUBMIT_READS.preimageFor}(${params.payloadHash}, ${params.declaredLen})`,
      rawHex: bytesRaw ?? '0x',
      reason: bytesDecoded.reason,
    });
  }

  const pinRead = await reader.storage(keys.preimageStatus(params.payloadHash));
  const statusRaw = firstValue(pinRead.value);
  const pinDecoded =
    statusRaw === undefined
      ? undefined
      : splitDecoded(derive(pinRead, () => decoders.preimageStatus(statusRaw)));
  if (pinDecoded !== undefined && !pinDecoded.ok) {
    undecodable.push({
      label: `${SUBMIT_READS.preimageStatus}(${params.payloadHash})`,
      rawHex: statusRaw ?? '0x',
      reason: pinDecoded.reason,
    });
  }

  const noted = bytesDecoded !== undefined && bytesDecoded.ok;
  const requested = pinDecoded !== undefined && pinDecoded.ok && pinDecoded.read.value.requested;
  const read: SubmitRead = {
    ...(statusDecoded.ok
      ? { phase: derive(statusDecoded.read, (value) => value.phase) }
      : { phase: undefined }),
    ...(queueDecoded.ok
      ? { intakeQueueLen: derive(queueDecoded.read, (ids) => ids.length) }
      : { intakeQueueLen: undefined }),
    // An absent or undecodable preimage is *not noted*, which is the fail-closed reading:
    // the submission is blocked and the user is told to note it, which costs a wasted
    // action at worst. The opposite default walks them into the 10 % preimage-missing slash.
    preimageNoted: derive(bytesRead, () => noted),
    preimageRequested: derive(pinRead, () => requested),
    ...(bytesDecoded !== undefined && bytesDecoded.ok
      ? { notedLen: derive(bytesDecoded.read, (bytes) => bytes.len) }
      : { notedLen: undefined }),
    undecodable,
  };

  assertOnePin(
    [
      ...(read.phase === undefined ? [] : [read.phase]),
      ...(read.intakeQueueLen === undefined ? [] : [read.intakeQueueLen]),
      read.preimageNoted,
      read.preimageRequested,
      ...(read.notedLen === undefined ? [] : [read.notedLen]),
    ],
    at.blockHash,
  );
  return read;
}

// ------------------------------------------------------------------- S6's reads

export interface QueueRead {
  readonly entries: readonly {
    readonly pid: Finalized<string>;
    readonly klass: Finalized<string>;
    readonly payloadHash: Finalized<string>;
    readonly maturity: Finalized<number>;
    readonly graceEnd: Finalized<number>;
    readonly cancelled: Finalized<boolean>;
    readonly ratification: Finalized<string>;
    readonly metersClear: Finalized<boolean>;
    /**
     * `ExecutionGuard.Queue(pid).failed_at`, from the cross-check witness — `undefined` is
     * the chain's own `None`.
     *
     * It comes from the **storage** leg rather than from `execution_queue()`, because 02
     * §4's `QueuedExecutionView` does not publish it (SQ-791) while the frozen stored entry
     * does (02 §7.4). It is not optional: the deadline `execution_guard.execute` enforces is
     * `failed_at + RETRY_WINDOW` once a mandate has failed once, so a queue row without this
     * field cannot answer §11.5's window row at all.
     */
    readonly failedAt: Finalized<number | undefined>;
  }[];
  readonly undecodable: readonly UndecodableRead[];
}

/**
 * Read S6's queue at the reader's pinned block, cross-checked against its own storage.
 *
 * The queue is the one read here that is unambiguously on the transaction path — every
 * `execute` a user signs starts from a row of it — so `crossCheckedCall` is not optional.
 * The witness it returns is read twice over: once for keys carrying no value, and once for
 * `failed_at`, which the runtime-API projection omits.
 */
export async function readExecutionQueue(
  reader: CoreReader,
  decoders: CoreDecoders,
): Promise<QueueRead> {
  const at = reader.at;
  const raw = await reader.crossCheckedCall({
    api: QUEUE_READS.executionQueue,
    storagePrefix: QUEUE_READS.queue,
  });
  const decoded = splitDecoded(derive(raw, (value) => decoders.executionQueue(value.result)));
  if (!decoded.ok) {
    return {
      entries: [],
      undecodable: [
        { label: QUEUE_READS.executionQueue, rawHex: raw.value.result, reason: decoded.reason },
      ],
    };
  }

  // A queue entry whose storage key carries no value is reported rather than dropped, for
  // `readProposals`' reason: dropping it shortens the list, everything left decodes
  // perfectly, and the screen shows fewer mandates than the chain has with nothing saying so.
  const undecodable: UndecodableRead[] = raw.value.witness
    .filter((item) => item.value === undefined)
    .map((item) => ({
      label: `${QUEUE_READS.queue}[${item.key}]`,
      rawHex: '0x',
      reason: 'the key is present in the prefix but carries no value',
    }));

  // The stored entries, decoded from the same witness the cross-check already fetched.
  // Keyed by `pid` rather than by position: the API's order and the map's prefix order are
  // different orderings of the same set, and pairing them by index would attach one
  // mandate's failure stamp to another's window.
  const storedByPid = new Map<string, StoredQueueEntry>();
  for (const item of raw.value.witness) {
    if (item.value === undefined) continue;
    const stored = decoders.queueEntry(item.value);
    if (!stored.ok) {
      undecodable.push({
        label: `${QUEUE_READS.queue}[${item.key}]`,
        rawHex: item.value,
        reason: stored.reason,
      });
      continue;
    }
    storedByPid.set(stored.value.pid, stored.value);
  }

  const entries = elements(decoded.read).map((entryRead) => {
    const stored = storedByPid.get(entryRead.value.pid);
    return {
      pid: derive(entryRead, (entry) => entry.pid),
      klass: derive(entryRead, (entry) => entry.klass),
      payloadHash: derive(entryRead, (entry) => entry.payloadHash),
      maturity: derive(entryRead, (entry) => entry.maturity),
      graceEnd: derive(entryRead, (entry) => entry.graceEnd),
      cancelled: derive(entryRead, (entry) => entry.cancelled),
      ratification: derive(entryRead, (entry) => entry.ratification),
      metersClear: derive(entryRead, (entry) => entry.metersClear),
      failedAt: derive(raw, () => stored?.failedAt),
    };
  });

  // A queue row the API returned and the storage prefix did not is reported: the pair is
  // the FE-P2 cross-check, and a missing half means the client is reading a `failed_at` of
  // `None` for a mandate whose stamp it simply could not see.
  for (const entry of entries) {
    if (!storedByPid.has(entry.pid.value)) {
      undecodable.push({
        label: `${QUEUE_READS.queue}(${entry.pid.value})`,
        rawHex: '0x',
        reason:
          'execution_queue() returned this mandate and the storage prefix did not carry it, ' +
          'so its failed_at could not be read and its execution deadline is not established',
      });
    }
  }

  assertOnePin(entries.flatMap((entry) => Object.values(entry)), at.blockHash);
  return { entries, undecodable };
}

// ------------------------------------------------------------------- S7's reads

export interface WelfareRead {
  readonly pillars: WelfarePillars | undefined;
  /** The chain's own `active_spec_available`, and the version it qualifies. */
  readonly activeSpecAvailable: Finalized<boolean> | undefined;
  readonly specVersion: Finalized<number> | undefined;
  readonly sBreached: Finalized<boolean> | undefined;
  readonly cBreached: Finalized<boolean> | undefined;
  readonly reserveFlag: Finalized<boolean> | undefined;
  /**
   * Whether this epoch's `Welfare.GateBreachFlags` entry exists at all.
   *
   * The sampling fact, and it comes from **presence** rather than from the bitmap:
   * 05 §4.7 writes the entry on the first successful recording whether or not that day
   * breached, so a set of clear flags and no entry at all are different facts carried by
   * identical bytes.
   */
  readonly gateEpochSampled: Finalized<boolean> | undefined;
  readonly snapshots: readonly SnapshotRow[];
  readonly params: readonly ParamRow[];
  readonly undecodable: readonly UndecodableRead[];
}

export async function readWelfare(
  reader: CoreReader,
  keys: CoreKeys,
  decoders: CoreDecoders,
  params: { readonly paramKeys: readonly string[] },
): Promise<WelfareRead> {
  const at = reader.at;
  const undecodable: UndecodableRead[] = [];

  const currentRaw = await reader.crossCheckedCall({
    api: WELFARE_READS.current,
    storagePrefix: WELFARE_READS.snapshots,
  });
  const current = splitDecoded(derive(currentRaw, (raw) => decoders.welfareCurrent(raw.result)));
  if (!current.ok) {
    undecodable.push({
      label: WELFARE_READS.current,
      rawHex: currentRaw.value.result,
      reason: current.reason,
    });
  }

  const snapshots: SnapshotRow[] = [];
  for (const item of currentRaw.value.witness) {
    if (item.value === undefined) {
      undecodable.push({
        label: `${WELFARE_READS.snapshots}[${item.key}]`,
        rawHex: '0x',
        reason: 'the key is present in the prefix but carries no value',
      });
      continue;
    }
    const raw = item.value;
    const snapshot = splitDecoded(derive(currentRaw, () => decoders.welfareSnapshot(raw)));
    if (!snapshot.ok) {
      undecodable.push({
        label: `${WELFARE_READS.snapshots}[${item.key}]`,
        rawHex: raw,
        reason: snapshot.reason,
      });
      continue;
    }
    snapshots.push({
      epoch: derive(snapshot.read, (value) => value.epoch),
      specVersion: derive(snapshot.read, (value) => value.specVersion),
      w1e9: derive(snapshot.read, (value) => value.w1e9),
    });
  }

  // The sampling read is keyed by the epoch the welfare view names, so it is only
  // performed once that epoch is known. Guessing an epoch to read would answer a question
  // about a different one.
  let gateEpochSampled: Finalized<boolean> | undefined;
  if (current.ok) {
    const epoch = current.read.value.epoch;
    const flagsRead = await reader.storage(keys.gateBreachFlags(epoch));
    const flagsRaw = firstValue(flagsRead.value);
    if (flagsRaw === undefined) {
      gateEpochSampled = derive(flagsRead, () => false);
    } else {
      const flags = splitDecoded(derive(flagsRead, () => decoders.gateBreachFlags(flagsRaw)));
      if (!flags.ok) {
        undecodable.push({
          label: `${WELFARE_READS.gateBreachFlags}(${epoch})`,
          rawHex: flagsRaw,
          reason: flags.reason,
        });
      } else {
        gateEpochSampled = derive(flags.read, () => true);
      }
    }
  }

  // The constitution rows come from `params()`, cross-checked against `Constitution.Params`,
  // and **not** from the raw storage item alone. 11 §11.2's S7 row names the runtime API,
  // and 11 §11.4 rule 2 requires an exact chain read where a client computation would
  // otherwise stand in: `min_next`, `max_next` and `cooldown_blocks` are not in the stored
  // `ParamRecord` at all — the runtime computes them from `admissible_next_interval()` and
  // the live `epoch.length` (`runtime/bleavit-runtime/src/views.rs`). A client decoding them
  // out of raw storage would have to reimplement that arithmetic, which is a second copy of
  // a rule the chain owns and the one thing rule 2 forbids.
  const params_: ParamRow[] = [];
  const paramsRaw = await reader.crossCheckedCall({
    api: WELFARE_READS.paramsApi,
    storagePrefix: WELFARE_READS.params,
    argsHex: keys.paramsArgs(params.paramKeys),
  });
  const views = splitDecoded(derive(paramsRaw, (raw) => decoders.paramViews(raw.result)));
  if (!views.ok) {
    undecodable.push({
      label: WELFARE_READS.paramsApi,
      rawHex: paramsRaw.value.result,
      reason: views.reason,
    });
  } else {
    for (const viewRead of elements(views.read)) {
      params_.push({
        key: derive(viewRead, (view) => view.key),
        value: derive(viewRead, (view) => view.value),
        min: derive(viewRead, (view) => view.min),
        max: derive(viewRead, (view) => view.max),
        minNext: derive(viewRead, (view) => view.minNext),
        maxNext: derive(viewRead, (view) => view.maxNext),
        cooldownBlocks: derive(viewRead, (view) => view.cooldownBlocks),
        lastChange: derive(viewRead, (view) => view.lastChange),
        klass: derive(viewRead, (view) => view.klass),
      });
    }
    // `params()` skips a key it does not hold and a record whose bounds do not project
    // (13 reading rule 7), so a short answer is chain state rather than a failure — and it
    // is reported, because a screen showing eight of ten requested rows with nothing said
    // is a screen claiming the other two do not exist.
    // Taken from the decoded views rather than by unwrapping the finished rows: a `.value`
    // read inside a closure is how a chain value crosses the render edge unbadged, and
    // `check-render-provenance` refuses it whether or not this particular use is a render.
    const answered = new Set(views.read.value.map((view) => view.key));
    for (const key of params.paramKeys) {
      if (!answered.has(key)) {
        undecodable.push({
          label: `${WELFARE_READS.paramsApi}(${key})`,
          rawHex: '0x',
          reason:
            'params() did not answer for this key: either the constitution holds no such ' +
            'record, or the record is malformed and the runtime skipped it rather than ' +
            'presenting it as unbounded',
        });
      }
    }
  }

  const pillars: WelfarePillars | undefined = current.ok
    ? {
        epoch: derive(current.read, (value) => value.epoch),
        sPillar1e9: derive(current.read, (value) => value.sPillar1e9),
        cOnchain1e9: derive(current.read, (value) => value.cOnchain1e9),
        cAttested1e9: derive(current.read, (value) => value.cAttested1e9),
        pPillar1e9: derive(current.read, (value) => value.pPillar1e9),
        aPillar1e9: derive(current.read, (value) => value.aPillar1e9),
        gateS1e9: derive(current.read, (value) => value.gateS1e9),
        gateC1e9: derive(current.read, (value) => value.gateC1e9),
        wCurrent1e9: derive(current.read, (value) => value.wCurrent1e9),
      }
    : undefined;

  const read: WelfareRead = {
    pillars,
    activeSpecAvailable: current.ok
      ? derive(current.read, (value) => value.activeSpecAvailable)
      : undefined,
    // The version is carried only when the chain says it means something. Handing it up
    // unconditionally would put the `0` of an unavailable spec one field away from a
    // screen that renders it.
    specVersion:
      current.ok && current.read.value.activeSpecAvailable
        ? derive(current.read, (value) => value.specVersion)
        : undefined,
    sBreached: current.ok ? derive(current.read, (value) => value.sBreached) : undefined,
    cBreached: current.ok ? derive(current.read, (value) => value.cBreached) : undefined,
    reserveFlag: current.ok ? derive(current.read, (value) => value.reserveFlag) : undefined,
    gateEpochSampled,
    snapshots,
    params: params_,
    undecodable,
  };

  assertOnePin(
    [
      ...(pillars === undefined ? [] : Object.values(pillars)),
      ...([
        read.activeSpecAvailable,
        read.specVersion,
        read.sBreached,
        read.cBreached,
        read.reserveFlag,
        read.gateEpochSampled,
      ] as readonly (Verified<unknown> | undefined)[]).filter(
        (leaf): leaf is Verified<unknown> => leaf !== undefined,
      ),
      ...snapshots.flatMap((snapshot) => Object.values(snapshot)),
      ...params_.flatMap((param) => Object.values(param)),
    ],
    at.blockHash,
  );
  return read;
}

// ------------------------------------------------------------------- S8's reads

export interface SettlementRead {
  readonly cohorts: readonly CohortRecord[];
  readonly executions: readonly ExecutionRecordRow[];
  readonly undecodable: readonly UndecodableRead[];
}

/**
 * Read S8's two rings at the reader's pinned block.
 *
 * Returns `CohortRecord`s rather than `CohortRow`s: the VOID projection belongs to
 * `cohortRow`, which is the single constructor that applies it, and a reader that also
 * projected would be a second place the rule could be got wrong.
 */
export async function readSettlements(
  reader: CoreReader,
  keys: CoreKeys,
  decoders: CoreDecoders,
): Promise<SettlementRead> {
  const at = reader.at;
  const undecodable: UndecodableRead[] = [];

  const cohortsRaw = await reader.crossCheckedCall({
    api: SETTLEMENT_READS.recentCohorts,
    storagePrefix: SETTLEMENT_READS.recentCohortSummaries,
  });
  const cohortsDecoded = splitDecoded(
    derive(cohortsRaw, (raw) => decoders.recentCohorts(raw.result)),
  );
  const cohorts: CohortRecord[] = [];
  if (!cohortsDecoded.ok) {
    undecodable.push({
      label: SETTLEMENT_READS.recentCohorts,
      rawHex: cohortsRaw.value.result,
      reason: cohortsDecoded.reason,
    });
  } else {
    for (const recordRead of elements(cohortsDecoded.read)) {
      const proposals: CohortProposal[] = elements(
        derive(recordRead, (record) => record.proposals),
      ).map((proposalRead) => ({
        id: derive(proposalRead, (proposal) => proposal.id),
        klass: derive(proposalRead, (proposal) => proposal.klass),
        outcome: derive(proposalRead, (proposal) => proposal.outcome),
      }));
      cohorts.push({
        epoch: derive(recordRead, (record) => record.epoch),
        s1e9: derive(recordRead, (record) => record.s1e9),
        baselineTwap1e9: derive(recordRead, (record) => record.baselineTwap1e9),
        proposals,
        voided: derive(recordRead, (record) => record.voided),
        settledAt: derive(recordRead, (record) => record.settledAt),
      });
    }
  }

  const recordsRead = await reader.storage(keys.executionRecords());
  const recordsRaw = firstValue(recordsRead.value);
  const executions: ExecutionRecordRow[] = [];
  if (recordsRaw !== undefined) {
    const decoded = splitDecoded(derive(recordsRead, () => decoders.executionRecords(recordsRaw)));
    if (!decoded.ok) {
      undecodable.push({
        label: SETTLEMENT_READS.executionRecords,
        rawHex: recordsRaw,
        reason: decoded.reason,
      });
    } else {
      for (const recordRead of elements(decoded.read)) {
        const failure = recordRead.value.failure;
        executions.push({
          pid: derive(recordRead, (record) => record.pid),
          payloadHash: derive(recordRead, (record) => record.payloadHash),
          klass: derive(recordRead, (record) => record.klass),
          executedAt: derive(recordRead, (record) => record.executedAt),
          succeeded: derive(recordRead, (record) => record.succeeded),
          ...(failure === undefined ? {} : { failure: derive(recordRead, () => failure) }),
        });
      }
    }
  }

  assertOnePin(
    [
      ...cohorts.flatMap((cohort) => [
        cohort.epoch,
        cohort.s1e9,
        cohort.baselineTwap1e9,
        cohort.voided,
        cohort.settledAt,
        ...cohort.proposals.flatMap((proposal) => Object.values(proposal)),
      ]),
      ...executions.flatMap((execution) => Object.values(execution)),
    ],
    at.blockHash,
  );
  return { cohorts, executions, undecodable };
}

/**
 * Whether epoch `e`'s Baseline book mapping is still present (§11.5's reaped-book rule).
 *
 * Its own reader because it is keyed per epoch and a settlements table asks it once per
 * row — and because the answer is *presence*, which is exactly the thing a batched decode
 * would flatten into a zero.
 */
export async function readBaselineBookPresent(
  reader: CoreReader,
  keys: CoreKeys,
  epoch: number,
): Promise<Finalized<boolean>> {
  const read = await reader.storage(keys.baselineMarketOf(epoch));
  return derive(read, (items) => firstValue(items) !== undefined);
}
