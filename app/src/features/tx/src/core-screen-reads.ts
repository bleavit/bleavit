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

/** S7's frozen surfaces — 11 §11.2's S7 row, 02 §3/§7.3/§7.4. */
export const WELFARE_READS = Object.freeze({
  current: 'welfare_current',
  snapshots: 'Welfare.Snapshots',
  metricSpecs: 'Welfare.MetricSpecs',
  gateBreachFlags: 'Welfare.GateBreachFlags',
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
  constitutionParamsPrefix(): string;
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
  readonly paramRecord: (raw: string) => Decoded<ParamRecord>;
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

/** 02 §4's `ParamView`, decoded. Every scalar is the raw stored inner value. */
export interface ParamRecord {
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

/** Stamp a value with the reader's own pin. Every leaf of every model below goes through it. */
function stamp<T>(at: FinalizedBlockRef, value: T): Verified<T> {
  return {
    value,
    status: {
      kind: 'verified-finalized',
      chain: at.chain,
      blockHash: at.blockHash,
      blockNumber: at.blockNumber,
    },
  };
}

/**
 * Re-check that every leaf of a finished model belongs to the reader's pin.
 *
 * Redundant by construction while every leaf comes from `stamp` — and kept, and
 * **exported**, for the reason `readShellState`'s analogue is: no input to the readers
 * below can produce a mixed model, so a test driving the public API could only assert that
 * two hashes it wrote itself differ, which proves nothing about this function. A defensive
 * check whose test cannot reach it is the vacuous control this repository keeps finding.
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
  readonly phase: Verified<string> | undefined;
  /** Absent when `Epoch.IntakeQueue` could not be read or decoded. */
  readonly intakeQueueLen: Verified<number> | undefined;
  /** `Preimage.PreimageFor((hash, len))` holds the bytes. */
  readonly preimageNoted: Verified<boolean>;
  /** `Preimage.StatusFor(hash)` is requested — pinned against reaping. */
  readonly preimageRequested: Verified<boolean>;
  /** The length the chain actually holds, which need not be the declared one. */
  readonly notedLen: Verified<number> | undefined;
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
  const statusDecoded = decoders.epochStatus(status.value.result);
  if (!statusDecoded.ok) {
    undecodable.push({
      label: SUBMIT_READS.epochStatus,
      rawHex: status.value.result,
      reason: statusDecoded.reason,
    });
  }

  const queueRaw = firstValue((await reader.storage(keys.intakeQueue())).value);
  // An absent `IntakeQueue` is a legitimate empty queue: the value-query default of a
  // `BoundedVec` storage item is the empty vector, so this is the one absent read here
  // that is genuinely a zero rather than a failure.
  const queueDecoded =
    queueRaw === undefined
      ? ({ ok: true, value: [] as readonly string[] } as const)
      : decoders.intakeQueue(queueRaw);
  if (!queueDecoded.ok) {
    undecodable.push({
      label: SUBMIT_READS.intakeQueue,
      rawHex: queueRaw ?? '0x',
      reason: queueDecoded.reason,
    });
  }

  const bytesRaw = firstValue(
    (await reader.storage(keys.preimageFor(params.payloadHash, params.declaredLen))).value,
  );
  const bytesDecoded = bytesRaw === undefined ? undefined : decoders.preimageBytes(bytesRaw);
  if (bytesDecoded !== undefined && !bytesDecoded.ok) {
    undecodable.push({
      label: `${SUBMIT_READS.preimageFor}(${params.payloadHash}, ${params.declaredLen})`,
      rawHex: bytesRaw ?? '0x',
      reason: bytesDecoded.reason,
    });
  }

  const statusRaw = firstValue((await reader.storage(keys.preimageStatus(params.payloadHash))).value);
  const pinDecoded = statusRaw === undefined ? undefined : decoders.preimageStatus(statusRaw);
  if (pinDecoded !== undefined && !pinDecoded.ok) {
    undecodable.push({
      label: `${SUBMIT_READS.preimageStatus}(${params.payloadHash})`,
      rawHex: statusRaw ?? '0x',
      reason: pinDecoded.reason,
    });
  }

  const read: SubmitRead = {
    ...(statusDecoded.ok ? { phase: stamp(at, statusDecoded.value.phase) } : { phase: undefined }),
    ...(queueDecoded.ok
      ? { intakeQueueLen: stamp(at, queueDecoded.value.length) }
      : { intakeQueueLen: undefined }),
    // An absent or undecodable preimage is *not noted*, which is the fail-closed reading:
    // the submission is blocked and the user is told to note it, which costs a wasted
    // action at worst. The opposite default walks them into the 10 % preimage-missing slash.
    preimageNoted: stamp(at, bytesDecoded !== undefined && bytesDecoded.ok),
    preimageRequested: stamp(at, pinDecoded !== undefined && pinDecoded.ok && pinDecoded.value.requested),
    ...(bytesDecoded !== undefined && bytesDecoded.ok
      ? { notedLen: stamp(at, bytesDecoded.value.len) }
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
    readonly pid: Verified<string>;
    readonly klass: Verified<string>;
    readonly payloadHash: Verified<string>;
    readonly maturity: Verified<number>;
    readonly graceEnd: Verified<number>;
    readonly cancelled: Verified<boolean>;
    readonly ratification: Verified<string>;
    readonly metersClear: Verified<boolean>;
  }[];
  readonly undecodable: readonly UndecodableRead[];
}

/**
 * Read S6's queue at the reader's pinned block, cross-checked against its own storage.
 *
 * The queue is the one read here that is unambiguously on the transaction path — every
 * `execute` a user signs starts from a row of it — so `crossCheckedCall` is not optional.
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
  const decoded = decoders.executionQueue(raw.value.result);
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
  const missing = raw.value.witness
    .filter((item) => item.value === undefined)
    .map((item) => ({
      label: `${QUEUE_READS.queue}[${item.key}]`,
      rawHex: '0x',
      reason: 'the key is present in the prefix but carries no value',
    }));

  const entries = decoded.value.map((entry) => ({
    pid: stamp(at, entry.pid),
    klass: stamp(at, entry.klass),
    payloadHash: stamp(at, entry.payloadHash),
    maturity: stamp(at, entry.maturity),
    graceEnd: stamp(at, entry.graceEnd),
    cancelled: stamp(at, entry.cancelled),
    ratification: stamp(at, entry.ratification),
    metersClear: stamp(at, entry.metersClear),
  }));

  assertOnePin(entries.flatMap((entry) => Object.values(entry)), at.blockHash);
  return { entries, undecodable: missing };
}

// ------------------------------------------------------------------- S7's reads

export interface WelfareRead {
  readonly pillars: WelfarePillars | undefined;
  /** The chain's own `active_spec_available`, and the version it qualifies. */
  readonly activeSpecAvailable: Verified<boolean> | undefined;
  readonly specVersion: Verified<number> | undefined;
  readonly sBreached: Verified<boolean> | undefined;
  readonly cBreached: Verified<boolean> | undefined;
  readonly reserveFlag: Verified<boolean> | undefined;
  /**
   * Whether this epoch's `Welfare.GateBreachFlags` entry exists at all.
   *
   * The sampling fact, and it comes from **presence** rather than from the bitmap:
   * 05 §4.7 writes the entry on the first successful recording whether or not that day
   * breached, so a set of clear flags and no entry at all are different facts carried by
   * identical bytes.
   */
  readonly gateEpochSampled: Verified<boolean> | undefined;
  readonly snapshots: readonly SnapshotRow[];
  readonly params: readonly ParamRow[];
  readonly undecodable: readonly UndecodableRead[];
}

export async function readWelfare(
  reader: CoreReader,
  keys: CoreKeys,
  decoders: CoreDecoders,
): Promise<WelfareRead> {
  const at = reader.at;
  const undecodable: UndecodableRead[] = [];

  const currentRaw = await reader.crossCheckedCall({
    api: WELFARE_READS.current,
    storagePrefix: WELFARE_READS.snapshots,
  });
  const current = decoders.welfareCurrent(currentRaw.value.result);
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
    const snapshot = decoders.welfareSnapshot(item.value);
    if (!snapshot.ok) {
      undecodable.push({
        label: `${WELFARE_READS.snapshots}[${item.key}]`,
        rawHex: item.value,
        reason: snapshot.reason,
      });
      continue;
    }
    snapshots.push({
      epoch: stamp(at, snapshot.value.epoch),
      specVersion: stamp(at, snapshot.value.specVersion),
      w1e9: stamp(at, snapshot.value.w1e9),
    });
  }

  // The sampling read is keyed by the epoch the welfare view names, so it is only
  // performed once that epoch is known. Guessing an epoch to read would answer a question
  // about a different one.
  let gateEpochSampled: Verified<boolean> | undefined;
  if (current.ok) {
    const flagsRaw = firstValue((await reader.storage(keys.gateBreachFlags(current.value.epoch))).value);
    if (flagsRaw === undefined) {
      gateEpochSampled = stamp(at, false);
    } else {
      const flags = decoders.gateBreachFlags(flagsRaw);
      if (!flags.ok) {
        undecodable.push({
          label: `${WELFARE_READS.gateBreachFlags}(${current.value.epoch})`,
          rawHex: flagsRaw,
          reason: flags.reason,
        });
      } else {
        gateEpochSampled = stamp(at, true);
      }
    }
  }

  const params: ParamRow[] = [];
  for (const item of (await reader.storage(keys.constitutionParamsPrefix(), 'descendantsValues')).value) {
    if (item.value === undefined) {
      undecodable.push({
        label: `${WELFARE_READS.params}[${item.key}]`,
        rawHex: '0x',
        reason: 'the key is present in the prefix but carries no value',
      });
      continue;
    }
    const record = decoders.paramRecord(item.value);
    if (!record.ok) {
      undecodable.push({
        label: `${WELFARE_READS.params}[${item.key}]`,
        rawHex: item.value,
        reason: record.reason,
      });
      continue;
    }
    params.push({
      key: stamp(at, record.value.key),
      value: stamp(at, record.value.value),
      min: stamp(at, record.value.min),
      max: stamp(at, record.value.max),
      minNext: stamp(at, record.value.minNext),
      maxNext: stamp(at, record.value.maxNext),
      cooldownBlocks: stamp(at, record.value.cooldownBlocks),
      lastChange: stamp(at, record.value.lastChange),
      klass: stamp(at, record.value.klass),
    });
  }

  const pillars: WelfarePillars | undefined = current.ok
    ? {
        epoch: stamp(at, current.value.epoch),
        sPillar1e9: stamp(at, current.value.sPillar1e9),
        cOnchain1e9: stamp(at, current.value.cOnchain1e9),
        cAttested1e9: stamp(at, current.value.cAttested1e9),
        pPillar1e9: stamp(at, current.value.pPillar1e9),
        aPillar1e9: stamp(at, current.value.aPillar1e9),
        gateS1e9: stamp(at, current.value.gateS1e9),
        gateC1e9: stamp(at, current.value.gateC1e9),
        wCurrent1e9: stamp(at, current.value.wCurrent1e9),
      }
    : undefined;

  const read: WelfareRead = {
    pillars,
    activeSpecAvailable: current.ok ? stamp(at, current.value.activeSpecAvailable) : undefined,
    // The version is carried only when the chain says it means something. Handing it up
    // unconditionally would put the `0` of an unavailable spec one field away from a
    // screen that renders it.
    specVersion:
      current.ok && current.value.activeSpecAvailable
        ? stamp(at, current.value.specVersion)
        : undefined,
    sBreached: current.ok ? stamp(at, current.value.sBreached) : undefined,
    cBreached: current.ok ? stamp(at, current.value.cBreached) : undefined,
    reserveFlag: current.ok ? stamp(at, current.value.reserveFlag) : undefined,
    gateEpochSampled,
    snapshots,
    params,
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
      ...params.flatMap((param) => Object.values(param)),
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
  const cohortsDecoded = decoders.recentCohorts(cohortsRaw.value.result);
  const cohorts: CohortRecord[] = [];
  if (!cohortsDecoded.ok) {
    undecodable.push({
      label: SETTLEMENT_READS.recentCohorts,
      rawHex: cohortsRaw.value.result,
      reason: cohortsDecoded.reason,
    });
  } else {
    for (const record of cohortsDecoded.value) {
      const proposals: CohortProposal[] = record.proposals.map((proposal) => ({
        id: stamp(at, proposal.id),
        klass: stamp(at, proposal.klass),
        outcome: stamp(at, proposal.outcome),
      }));
      cohorts.push({
        epoch: stamp(at, record.epoch),
        s1e9: stamp(at, record.s1e9),
        baselineTwap1e9: stamp(at, record.baselineTwap1e9),
        proposals,
        voided: stamp(at, record.voided),
        settledAt: stamp(at, record.settledAt),
      });
    }
  }

  const recordsRaw = firstValue((await reader.storage(keys.executionRecords())).value);
  const executions: ExecutionRecordRow[] = [];
  if (recordsRaw !== undefined) {
    const decoded = decoders.executionRecords(recordsRaw);
    if (!decoded.ok) {
      undecodable.push({
        label: SETTLEMENT_READS.executionRecords,
        rawHex: recordsRaw,
        reason: decoded.reason,
      });
    } else {
      for (const record of decoded.value) {
        executions.push({
          pid: stamp(at, record.pid),
          payloadHash: stamp(at, record.payloadHash),
          klass: stamp(at, record.klass),
          executedAt: stamp(at, record.executedAt),
          succeeded: stamp(at, record.succeeded),
          ...(record.failure === undefined ? {} : { failure: stamp(at, record.failure) }),
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
): Promise<Verified<boolean>> {
  const raw = firstValue((await reader.storage(keys.baselineMarketOf(epoch))).value);
  return stamp(reader.at, raw !== undefined);
}
