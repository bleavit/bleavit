/**
 * S2's reads — `Epoch.Proposals` and `proposal_summaries()` / `decision_stats()` into the
 * models `proposals.tsx` renders.
 *
 * ## The second read was declared and never performed (F7b)
 *
 * `decision_stats` was named in `PROPOSAL_READS`, decoded by `ProposalDecoders` and ruled
 * on by `viewFor` — and **nothing called it**. Every consequence of that was silent: the
 * `decided` arm of `ProposalView` was constructible only by hand, `ProposalDetail`'s
 * finalized-statistics panel could not be populated by any read, and `viewFor`'s anomaly
 * branch had no path that could emit it. A green suite said nothing about any of it,
 * because the tests that exercised those paths built their own fixtures.
 *
 * The fetch below closes it, and *which* proposals it asks about is the load-bearing
 * choice — see `STATS_WORTH_ASKING`.
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

import type { Finalized, FinalizedBlockRef, StorageItem } from '@bleavit/chain-client';
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
  /**
   * The measured uplift in **parts per million**, which is a projection the decoder owes.
   *
   * Every fixed-point field of 02 §4's `DecisionStatsView` is on the contract's **1e9**
   * grid, and `Ratio` renders parts per million (`formatPpm` divides by 10,000 to reach a
   * percentage). A decoder that handed a 1e9-grid scalar straight through would therefore
   * put a figure on screen **1,000× too large**, under a `verified-finalized` badge and
   * with every other row correct — so the projection is named in the field and stated
   * here rather than left to the call site.
   */
  readonly upliftPpm: bigint;
}

export interface ProposalDecoders {
  /** The `Epoch.Proposals` prefix, decoded into one record per entry. */
  readonly proposals: (raw: readonly string[]) => Decoded<readonly ProposalRecord[]>;
  /** `decision_stats(pid)`; `undefined` for the runtime's `None`, which is not a failure. */
  readonly decisionStats: (raw: string) => Decoded<StatsRecord | undefined>;
}

/**
 * SCALE encoding for the one runtime-API argument this screen passes.
 *
 * Injected for the reason every decoder here is injected: `packages/chain-client` is the
 * only package permitted to import `polkadot-api` (10 §10.1, app-code rule 13). A
 * hand-rolled `u64` little-endian encoder in this package would be a second codec nothing
 * gates — and a wrong argument does not fail, it asks about **a different proposal** and
 * gets a perfectly valid answer.
 */
export interface ProposalArgs {
  /** `decision_stats(pid)`'s argument, hex-encoded. */
  decisionStats(proposalId: string): string;
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

/**
 * The states for which `decision_stats(pid)` is worth asking about at all.
 *
 * Not the same set as {@link STATS_REQUIRE_SEALED}, and the difference is the whole reason
 * this constant exists rather than the reader reusing the allowlist.
 *
 * Asking only about sealed proposals is the obvious implementation and it makes
 * `viewFor`'s anomaly branch **unreachable from a real read** — a `Some` returned for a
 * `Trading` proposal is precisely the contradiction that branch exists to report, and a
 * client that never asks can never see it. That is the defect shape this repository keeps
 * finding: a refusal with no path that can emit it, indistinguishable under a green run
 * from one that never fires.
 *
 * So the open-trading states are asked about too. The runtime answers `None` for them
 * (02 §3), which costs one bounded call and buys the only detection there is. What is
 * skipped is the pre-market states, where the question is not merely expected to be `None`
 * but is meaningless — no window has opened, so neither a `Some` nor a `None` says
 * anything, and an unknown state from a newer runtime falls here and renders no statistics
 * either way (INV-FE-12, enforced by `viewFor`'s allowlist regardless of what was fetched).
 *
 * The whole set is bounded by `Epoch::MaxLiveProposals` (02 §9), so the call count is too.
 */
const STATS_WORTH_ASKING: ReadonlySet<string> = new Set([
  ...STATS_REQUIRE_SEALED,
  ...OPEN_TRADING_STATES,
]);

/** Chain state the client read but cannot reconcile. Reported, never silently resolved. */
export interface ProposalAnomaly {
  readonly proposalId: string;
  readonly detail: string;
}

export interface ProposalsRead {
  readonly summaries: readonly ProposalSummary[];
  /**
   * One `ProposalView` per summary, in the same order — what `ProposalDetail` renders.
   *
   * This is the field the screen needs and the one the reader could not produce until the
   * `decision_stats` fetch existed: `ProposalView`'s `decided` arm was reachable only from
   * a hand-built fixture, so `ProposalDetail`'s dashboard was a panel no read could fill.
   */
  readonly views: readonly ProposalView[];
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
 * Read S2's proposal list **and its decision statistics** at the reader's pinned block.
 *
 * The list is taken through `crossCheckedCall`, which pairs `proposal_summaries` with its
 * own storage prefix — FE-P2's conservative default (10 §4.2), and the reason the prefix
 * is not a caller-supplied argument. The statistics are a plain call per proposal, for the
 * reason given on `ProposalsReader.call`.
 */
/**
 * What this function needs from a reader: one pin, and the FE-P2 cross-checked call.
 *
 * Structural rather than the `FinalizedReader` class for the reason given on
 * `ShellStateReader`: a class with `#private` fields is nominal, so a suite could only
 * reach this code through a real transport and a recorded transcript. The narrow port
 * keeps the *pairing* — api with its own storage prefix — inside the reader, which is what
 * 10 §11's final bullet requires and what a caller-supplied prefix would defeat.
 */
export interface ProposalsReader {
  readonly at: FinalizedBlockRef;
  crossCheckedCall(source: {
    readonly api: string;
    readonly storagePrefix: string;
    readonly argsHex?: string;
  }): Promise<Finalized<{ readonly result: string; readonly witness: readonly StorageItem[] }>>;
  /**
   * A plain runtime-API result, taking the **full** method name (`FutarchyApi_…`).
   *
   * `decision_stats` is not cross-checked and that is deliberate rather than an omission.
   * FE-P2's conservative rule pairs an *aggregate over storage* with the prefix it
   * aggregates (02 §3), and this view has no such prefix: it is computed from sealed
   * decision windows, so there is nothing to re-derive it from. It is also not a
   * transaction-path input — it is finalized statistics, and 11 §11.2 forbids any action
   * being derived from it at all.
   *
   * The name is passed whole because `FinalizedReader.call` does not prefix while
   * `crossCheckedCall` does; a port that hid the difference would compile against a reader
   * that then calls a method the runtime does not have.
   */
  call(api: string, argsHex?: string): Promise<Finalized<string>>;
}

export async function readProposals(
  reader: ProposalsReader,
  decoders: ProposalDecoders,
  args: ProposalArgs,
): Promise<ProposalsRead> {
  const at = reader.at;
  const finalized = <T,>(value: T): Verified<T> => ({
    value,
    status: {
      kind: 'verified-finalized',
      chain: at.chain,
      blockHash: at.blockHash,
      blockNumber: at.blockNumber,
    },
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
      views: [],
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

  const summaries: ProposalSummary[] = decoded.value.map((record) => ({
    id: finalized(record.id),
    title: finalized(record.title),
    klass: finalized(record.klass),
    state: finalized(record.state),
  }));

  // The second read: `decision_stats(pid)` for every proposal whose state makes the
  // question meaningful (see `STATS_WORTH_ASKING`). Both reads are served by one reader,
  // so both are at one pinned block — which is what lets `viewFor` treat a `Some` on an
  // open market as a genuine contradiction rather than a race.
  const undecodable = [...emptyKeys];
  const anomalies: ProposalAnomaly[] = [];
  const views: ProposalView[] = [];

  for (const summary of summaries) {
    let stats: DecisionStats | undefined;

    if (STATS_WORTH_ASKING.has(summary.state.value)) {
      const label = `${PROPOSAL_READS.decisionStats}(${summary.id.value})`;
      let raw: string | undefined;
      try {
        raw = (await reader.call(
          `FutarchyApi_${PROPOSAL_READS.decisionStats}`,
          args.decisionStats(summary.id.value),
        )).value;
      } catch (error) {
        // A failed call is not a `None`. Collapsing the two would render "no statistics
        // yet" for a decided proposal whose read failed — a confident statement about
        // chain state the client never obtained (INV-FE-12).
        undecodable.push({
          label,
          rawHex: '0x',
          reason: `the runtime call failed: ${error instanceof Error ? error.message : String(error)}`,
        });
      }

      if (raw !== undefined) {
        const stated = decoders.decisionStats(raw);
        if (!stated.ok) undecodable.push({ label, rawHex: raw, reason: stated.reason });
        else if (stated.value !== undefined) {
          stats = {
            outcome: finalized(stated.value.outcome),
            upliftPpm: finalized(stated.value.upliftPpm),
          };
        }
      }
    }

    const decided = viewFor(summary, stats);
    views.push(decided.view);
    if (decided.anomaly !== undefined) anomalies.push(decided.anomaly);
  }

  return { summaries, views, undecodable, anomalies };
}
