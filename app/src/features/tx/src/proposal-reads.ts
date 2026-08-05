/**
 * S2's reads — `Epoch.Proposals` and `proposal_summaries()` / `decision_stats()` into the
 * models `proposals.tsx` renders.
 *
 * ## `decision_stats` is gated on the proposal's own state, not only on its presence
 *
 * 11 §11.2: *"S2 MAY render it only as finalized decision statistics; while a proposal
 * remains in Trade/Extended and the view returns `None`, S2 and S3 MUST render no projected
 * uplift, projected PASS/REJECT, or other in-Trade preview derived from it."*
 *
 * The obvious implementation is *"render the statistics if the runtime API returned some"*,
 * and it is one chain-state anomaly away from doing exactly what that sentence forbids. Both
 * reads happen at the same pinned block, so they cannot be stale relative to each other — a
 * `Some` alongside a `Trading` state is a genuine contradiction rather than a race, and the
 * two available readings are *"the windows are sealed and the state field is wrong"* and
 * *"the state is right and the statistics are premature"*. Only one of those is safe to act
 * on: this returns the **pre-decision** arm, because the cost of being wrong in that
 * direction is a user who has to wait, and the cost of being wrong in the other is a
 * projected outcome rendered on an open market, which is a trading signal the client is
 * forbidden to give.
 *
 * The refusal is reported through `anomalies` rather than swallowed, because corrupt chain
 * state is something a user and an operator should both hear about.
 *
 * ## The FE-P2 cross-check is not optional here
 *
 * 10 §4.2 keeps the conservative mode as the **default**: a `FutarchyApi` result on the
 * transaction path is re-derived from direct storage. S2 is a reading screen, but it is the
 * screen a trade starts from, and `crossCheckedCall` is the reader method that pairs the
 * call with its own domain's storage prefix — so the pairing cannot be got wrong at a call
 * site.
 */

import type { FinalizedReader } from '@bleavit/chain-client';
import type { Verified } from '@bleavit/shared-types';
import type { DecisionStats, ProposalSummary, ProposalView } from './proposals.js';

/** Same shape the shell's reads use: a decode failure is data, not an exception. */
export type Decoded<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string };

export interface ProposalRecord {
  readonly id: string;
  readonly title: string;
  readonly klass: string;
  readonly state: string;
}

export interface StatsRecord {
  readonly outcome: string;
  readonly upliftPpm: bigint;
}

export interface ProposalDecoders {
  /** The `Epoch.Proposals` prefix, decoded into one record per entry. */
  readonly proposals: (raw: readonly string[]) => Decoded<readonly ProposalRecord[]>;
  /** `decision_stats(pid)`; `undefined` for the runtime's `None`, which is not a failure. */
  readonly decisionStats: (raw: string) => Decoded<StatsRecord | undefined>;
}

/** The frozen 02 §7/§3 surfaces this screen reads. */
export const PROPOSAL_READS = Object.freeze({
  proposals: 'Epoch.Proposals',
  summaries: 'proposal_summaries',
  decisionStats: 'decision_stats',
} as const);

/**
 * The 05 §2 states in which decision statistics are still forbidden.
 *
 * Written as the states that **block** rather than the states that permit, so a lifecycle
 * state added later defaults to *allowed* — which is the wrong default and is why this is
 * paired with `STATS_REQUIRE_SEALED` below rather than standing alone.
 */
const OPEN_TRADING_STATES: ReadonlySet<string> = new Set(['Trading', 'Extended']);

/**
 * The states in which statistics may render at all.
 *
 * An allowlist, and it is the load-bearing half: a state this client has never heard of —
 * from a runtime upgrade, or from a decode that produced something plausible — must render
 * **no** statistics, per INV-FE-12's fail-closed rule. A denylist alone would admit it.
 */
const STATS_REQUIRE_SEALED: ReadonlySet<string> = new Set([
  'Queued',
  'Executed',
  'Rejected',
  'Settled',
  'Measured',
  'Delayed',
  'MandateExpired',
]);

/** Chain state the client read but cannot reconcile. Reported, never silently resolved. */
export interface ProposalAnomaly {
  readonly proposalId: string;
  readonly detail: string;
}

export interface ProposalsRead {
  readonly summaries: readonly ProposalSummary[];
  readonly undecodable: readonly { readonly label: string; readonly rawHex: string; readonly reason: string }[];
  readonly anomalies: readonly ProposalAnomaly[];
}

/**
 * Decide which arm of `ProposalView` a proposal is in.
 *
 * Exported because it is the whole rule, and a test that could only reach it through a
 * reader would be testing the reader.
 */
export function viewFor(
  summary: ProposalSummary,
  stats: DecisionStats | undefined,
): { readonly view: ProposalView; readonly anomaly: ProposalAnomaly | undefined } {
  const state = summary.state.value;
  const sealed = STATS_REQUIRE_SEALED.has(state);

  if (stats === undefined) {
    const reason = OPEN_TRADING_STATES.has(state)
      ? state === 'Extended'
        ? ('extended' as const)
        : ('trading' as const)
      : ('not-yet-opened' as const);
    return { view: { stage: 'pre-decision', summary, reason }, anomaly: undefined };
  }

  if (!sealed) {
    // Both reads came from one pinned block, so this is not a race. Refusing is the only
    // direction that cannot put a projected outcome on an open market.
    return {
      view: { stage: 'pre-decision', summary, reason: OPEN_TRADING_STATES.has(state) ? 'trading' : 'not-yet-opened' },
      anomaly: {
        proposalId: summary.id.value,
        detail:
          `decision statistics were returned for a proposal in state "${state}", whose windows ` +
          'are not sealed. Both values were read at the same finalized block, so this is not a ' +
          'timing artefact. The statistics are not being rendered: an outcome shown on an open ' +
          'market is a trading signal (11 §11.2).',
      },
    };
  }

  return { view: { stage: 'decided', summary, decisionStats: stats }, anomaly: undefined };
}

/**
 * Read S2's proposal list at the reader's pinned block.
 *
 * The API result is taken through `crossCheckedCall`, which pairs `proposal_summaries` with
 * its own storage prefix — FE-P2's conservative default (10 §4.2), and the reason the
 * prefix is not a caller-supplied argument.
 */
export async function readProposals(
  reader: FinalizedReader,
  decoders: ProposalDecoders,
): Promise<ProposalsRead> {
  const at = reader.at;
  const finalized = <T,>(value: T): Verified<T> => ({
    value,
    status: { kind: 'verified-finalized', blockHash: at.blockHash, blockNumber: at.blockNumber },
  });

  const raw = await reader.crossCheckedCall({
    api: PROPOSAL_READS.summaries,
    storagePrefix: PROPOSAL_READS.proposals,
  });
  // A `StorageItem` may carry no value: the key exists in the prefix and holds nothing.
  // Dropping those silently would shorten the list and pass — the whole prefix would decode
  // fine, with fewer proposals in it than the chain has, and no screen could tell. So they
  // are separated out and reported. `undecodable` is the right home rather than `anomalies`
  // because the client did read something and could not interpret it, which is exactly what
  // that channel says.
  const missing = raw.value.witness.filter((item) => item.value === undefined);
  const witnessValues = raw.value.witness
    .map((item) => item.value)
    .filter((value): value is string => value !== undefined);
  const decoded = decoders.proposals(witnessValues);
  const emptyKeys = missing.map((item) => ({
    label: `${PROPOSAL_READS.proposals}[${item.key}]`,
    rawHex: '0x',
    reason: 'the key is present in the prefix but carries no value',
  }));
  if (!decoded.ok) {
    return {
      summaries: [],
      undecodable: [
        ...emptyKeys,
        {
          label: PROPOSAL_READS.proposals,
          rawHex: witnessValues.join(''),
          reason: decoded.reason,
        },
      ],
      anomalies: [],
    };
  }

  return {
    summaries: decoded.value.map((record) => ({
      id: finalized(record.id),
      title: finalized(record.title),
      klass: finalized(record.klass),
      state: finalized(record.state),
    })),
    undecodable: emptyKeys,
    anomalies: [],
  };
}
