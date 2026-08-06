/**
 * S8's model — recent settlements over `recent_cohorts()` and the `ExecutionRecords` ring.
 *
 * Another reading screen with no extrinsic, and three ways to state something false with
 * entirely genuine chain data.
 *
 * ## 1. A voided cohort has no score, and the field still exists in the bytes
 *
 * > VOIDed cohorts skip this section entirely (`CohortInfo.status = Void`, T20) — "this
 * > section" being **welfare scoring**: a voided cohort computes no `s`, so no proposal
 * > book settles on one. — 05 §7(4)
 *
 * `CohortSummary` nevertheless carries an `s_1e9` field, because SCALE structs have no
 * absent variants. So a screen mapping the struct field-for-field renders a welfare score
 * for a cohort that never computed one — a number with a `verified-finalized` badge that
 * is authentic as bytes and false as a claim. {@link cohortRow} is the only constructor
 * here and its `voided` arm **has no `s` field at all**, so there is nowhere to put it.
 *
 * The per-proposal outcomes are the opposite case and are kept: 05 §7's cohort-VOID
 * disposition requires the cohort's own members to *retain* their recorded
 * `DecisionOutcome`, because the archive is the only durable record of what the market
 * concluded. Dropping those would erase a real decision to avoid rendering a fake score.
 *
 * ## 2. An execution record is not evidence that the execution worked
 *
 * The guard writes an `ExecutionRecord` at 09 §1.2(13) whether the batch dispatched
 * cleanly or rolled back — `result` is `DispatchOutcomeCode`, which carries the failing
 * call index. 11 §11.3 states the reading obligation directly: *"decode the extrinsic's
 * events to distinguish inclusion from call success"*. A settlements screen listing
 * records without their outcome presents every recorded mandate as a completed one.
 *
 * ## 3. A ring is a window, not a history
 *
 * `RecentCohortSummaries` holds 32 and `ExecutionRecords` 256 *(normative values:
 * 02 §9 / 13)*, FIFO-evicted. A full ring rendered with no statement says *"this is
 * everything that ever happened"*, and the older history is real — 09 §1.5 makes it
 * event-derived and chain-served within the committed window. Both bounds arrive as chain
 * reads and {@link ringFull} is what the screen renders its caveat from.
 *
 * ## The reaped Baseline book
 *
 * §11.5: *"When cohort history identifies epoch `e` but that mapping is absent, the UI
 * MUST label the book reaped/archived, MUST NOT render a missing or fail-closed zero quote
 * as a market price … cohort history continues to render from `RecentCohortSummaries`."*
 * Both halves matter and they pull opposite ways, so {@link BASELINE_BOOK_COPY} carries
 * the label and the row keeps rendering.
 *
 * @see docs/architecture/05-welfare-and-decision-engine.md §7
 * @see docs/architecture/09-execution-upgrades-and-rollout.md §1.2, §1.5
 * @see docs/architecture/11-frontend-workflows.md §11.2, §11.5
 * @see docs/architecture/02-integration-contract.md §4, §7.1, §9
 */

import type { Verified } from '@bleavit/shared-types';

/** One proposal's archived decision, as `CohortSummary.proposals` carries it (02 §4). */
export interface CohortProposal {
  readonly id: Verified<string>;
  readonly klass: Verified<string>;
  /** `DecisionOutcome` — `Adopt`, `Reject(reason)` or `Extend`, as decoded. */
  readonly outcome: Verified<string>;
}

/**
 * A settled cohort, or a voided one.
 *
 * The two arms differ by exactly the fields a VOID makes meaningless. Written as a union
 * rather than optional fields for `ProposalView`'s reason: an optional field is somewhere
 * a stale or decoded-anyway value can sit, and the reader has no way to tell it apart from
 * a real one.
 */
export type CohortRow =
  | {
      readonly kind: 'settled';
      readonly epoch: Verified<number>;
      readonly s1e9: Verified<bigint>;
      readonly baselineTwap1e9: Verified<bigint>;
      readonly proposals: readonly CohortProposal[];
      readonly settledAt: Verified<number>;
    }
  | {
      readonly kind: 'voided';
      readonly epoch: Verified<number>;
      /** Retained: 05 §7 keeps each member's recorded outcome through a cohort VOID. */
      readonly proposals: readonly CohortProposal[];
      readonly settledAt: Verified<number>;
    };

/** A decoded `CohortSummary`, before the VOID rule is applied to it. */
export interface CohortRecord {
  readonly epoch: Verified<number>;
  readonly s1e9: Verified<bigint>;
  readonly baselineTwap1e9: Verified<bigint>;
  readonly proposals: readonly CohortProposal[];
  readonly voided: Verified<boolean>;
  readonly settledAt: Verified<number>;
}

/**
 * Project a decoded summary onto the arm its `voided` flag admits.
 *
 * The single constructor, so the rule is applied once rather than remembered at every call
 * site — and so a test can prove that no input produces a voided row carrying a score.
 */
export function cohortRow(record: CohortRecord): CohortRow {
  if (record.voided.value) {
    return {
      kind: 'voided',
      epoch: record.epoch,
      proposals: record.proposals,
      settledAt: record.settledAt,
    };
  }
  return {
    kind: 'settled',
    epoch: record.epoch,
    s1e9: record.s1e9,
    baselineTwap1e9: record.baselineTwap1e9,
    proposals: record.proposals,
    settledAt: record.settledAt,
  };
}

/** What a voided cohort means, said without implying a measurement happened. */
export const VOIDED_COHORT_COPY =
  'This cohort was voided, so no welfare score was computed for it and no proposal book ' +
  'settled on one. The decisions its proposals reached are shown because those are what ' +
  'the markets concluded; the epoch’s Baseline vault settled at the protocol’s fixed ' +
  'neutral value, which is a constant rather than a measurement.';

/** Whether epoch `e`'s Baseline book is still resolvable, or was reaped (§11.5, SQ-304). */
export type BaselineBookState = 'live' | 'reaped';

export const BASELINE_BOOK_COPY: Readonly<Record<BaselineBookState, string>> = Object.freeze({
  live: 'The Baseline book for this epoch is still on chain.',
  reaped:
    'The Baseline book for this epoch has been reaped and archived. There is no price to ' +
    'show and no trade to make on it. Already-held Baseline positions are unaffected — ' +
    'redemption reads the vault, not the book.',
});

/**
 * The book state from the presence of `BaselineMarketOf(epoch)`.
 *
 * A function rather than a field so the absent case cannot be filled in with a zero. A
 * missing mapping is *reaped*, and §11.5 forbids rendering the fail-closed zero quote that
 * accompanies it as a market price.
 */
export function baselineBookState(mappingPresent: boolean): BaselineBookState {
  return mappingPresent ? 'live' : 'reaped';
}

/** One entry of the `ExecutionRecords` ring (`futarchy_primitives::ExecutionRecord`). */
export interface ExecutionRecordRow {
  readonly pid: Verified<string>;
  readonly payloadHash: Verified<string>;
  readonly klass: Verified<string>;
  readonly executedAt: Verified<number>;
  /**
   * `DispatchOutcomeCode` reduced to the question a reader is asking.
   *
   * `succeeded === false` is a mandate that **executed and whose calls rolled back** — the
   * record exists either way, so a screen that showed the record alone would report a
   * failure as a success.
   */
  readonly succeeded: Verified<boolean>;
  /** The failing call index and error, where there was one. Absent on success. */
  readonly failure?: Verified<string>;
}

/** Copy for the two outcomes, so a screen cannot make a rollback sound like a completion. */
export const EXECUTION_OUTCOME_COPY: Readonly<Record<'ok' | 'failed', string>> = Object.freeze({
  ok: 'The mandate dispatched and every call in its batch succeeded.',
  failed:
    'The mandate dispatched and its batch rolled back. The record exists because the guard ' +
    'writes one either way; nothing this proposal asked for took effect.',
});

export interface SettlementsView {
  /** Newest first. Bounded by `Epoch::RecentCohortSummariesBound` (02 §9). */
  readonly cohorts: readonly CohortRow[];
  readonly cohortRingBound: Verified<number>;
  /** Newest first. Bounded by `ExecutionGuard::MaxExecutionRecords` (02 §9). */
  readonly executions: readonly ExecutionRecordRow[];
  readonly executionRingBound: Verified<number>;
}

/** Whether a ring is at its bound, and therefore hiding older entries by eviction. */
export function ringFull(count: number, bound: Verified<number>): boolean {
  return count >= bound.value;
}

/**
 * The caveat a full ring owes its reader.
 *
 * Returned rather than rendered so the *condition* is testable: a screen showing 32 of 32
 * cohorts with no such line is claiming the chain has settled 32 cohorts ever.
 */
export function ringCaveat(view: SettlementsView): string | undefined {
  const cohortsFull = ringFull(view.cohorts.length, view.cohortRingBound);
  const executionsFull = ringFull(view.executions.length, view.executionRingBound);
  if (!cohortsFull && !executionsFull) return undefined;
  const which = cohortsFull && executionsFull ? 'Both rings are' : cohortsFull ? 'The cohort ring is' : 'The execution ring is';
  return (
    `${which} full, so this is the most recent window and not the whole history. Older ` +
    'entries were evicted as newer ones arrived; they are still recoverable from chain ' +
    'events, which this screen does not read.'
  );
}
