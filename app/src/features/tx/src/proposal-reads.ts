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

import { derive, type Finalized, type FinalizedBlockRef, type StorageItem } from '@bleavit/chain-client';
import type { DecisionStats, ProposalSummary, ProposalView } from './proposals.js';

/** Same shape the shell's reads use: a decode failure is data, not an exception. */
export type Decoded<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string };

export interface ProposalRecord {
  readonly id: string;
  /** `payload_hash` — the commitment. There is no title on this chain; see `ProposalSummary`. */
  readonly payloadHash: string;
  readonly klass: string;
  readonly state: string;
}

/**
 * One `DecisionStatsView` as decoded — 02 §4, field for field.
 *
 * **Raw, on the grids the runtime publishes.** Every `FixedU64` here stays on the contract's
 * 1e9 grid and is named `…1e9`, and the balances stay in USDC base units. The superseded
 * version of this interface had two fields, `outcome` and `upliftPpm`, and neither survived
 * contact with the view: `DecisionStatsView` declares **no** outcome, and `upliftPpm` asked a
 * decoder to divide a 1e9 scalar by a thousand before anything could read the digits it
 * discarded — the projection `WelfarePillars` warns about, in the losing direction.
 */
export interface StatsRecord {
  /** The `ProposalId` the view echoes. Compared, never rendered — see {@link statsSubjectAnomaly}. */
  readonly pid: string;
  readonly twapAccept1e9: bigint;
  readonly twapReject1e9: bigint;
  readonly twapBaseline1e9: bigint;
  readonly rEff1e9: bigint;
  readonly trailingAccept1e9: bigint;
  readonly trailingReject1e9: bigint;
  readonly coveragePct: number;
  readonly tradedVolume: bigint;
  readonly vMinRequired: bigint;
  readonly converged: boolean;
  /**
   * `gate_twaps_1e9` — `undefined` for the runtime's `None`, else exactly four.
   *
   * A fixed-length tuple rather than `readonly bigint[]`, because 02 §4 freezes the array at
   * `[FixedU64; 4]` and its order — `(S,C) × (adopt, reject)` — is wire format. A decoder
   * that returned three would otherwise leave one gate book rendered as `undefined`.
   */
  readonly gateTwaps1e9: readonly [bigint, bigint, bigint, bigint] | undefined;
  readonly attackCostHat: bigint;
  readonly inCapPrize: bigint;
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
 * The one state in which the decision has been reset and its windows reopen (05 §2.1 T13/T25).
 *
 * Neither sealed nor open, and neither of the other two sentences is true of it: the markets
 * are not currently trading, and *"have not opened yet"* is false for a proposal whose books
 * are about to reopen under a raised hurdle.
 */
const REOPENING_STATE = 'Rerun';

/**
 * The states in which statistics may render at all.
 *
 * An allowlist, and it is the load-bearing half: a state this client has never heard of —
 * from a runtime upgrade, or from a decode that produced something plausible — must render
 * **no** statistics, per INV-FE-12's fail-closed rule. A denylist alone would admit it.
 *
 * **Three of the seven names this list carried were not `ProposalState` variants at all**, and
 * the composition root is what exposed it: once a decoder produced the variant name straight
 * out of metadata, `Measured`, `Delayed` and `MandateExpired` matched nothing the runtime can
 * emit, while `FailedExecuted`, `Cancelled`, `Expired` and `Suspended` — all four real, all
 * four post-decision — were missing. The direction was safe (an unmatched state renders no
 * statistics) and the effect was not: a decided proposal in any of those four was told *"there
 * are no decision statistics yet"*, which is a confident false statement about the chain.
 *
 * The nine below are 02 §2's frozen enum minus the four pre-decision states, the two
 * open-trading ones and {@link REOPENING_STATE}, and `app/tests/screens` derives that
 * subtraction from the document rather than trusting this list.
 */
const STATS_REQUIRE_SEALED: ReadonlySet<string> = new Set([
  'Queued',
  'Suspended',
  'Rejected',
  'Executed',
  'FailedExecuted',
  'Measuring',
  'Settled',
  'Cancelled',
  'Expired',
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

/**
 * The one check that can catch a wrong `decision_stats` argument.
 *
 * `ProposalArgs` states the hazard in as many words: *"a wrong argument does not fail, it
 * asks about **a different proposal** and gets a perfectly valid answer."* Nothing checked
 * it, because the decoder discarded the `pid` the view echoes — so an off-by-one in the SCALE
 * encoding would have put one proposal's decision statistics under another's heading, every
 * figure genuine, every badge true, and no path that could report it.
 *
 * Comparing the echo closes that, and it is the *only* thing that can: the argument is opaque
 * hex by the time it leaves this module, and the runtime answers whatever it decodes to.
 *
 * Exported because it is a rule rather than a step, per {@link viewFor}.
 */
export function statsSubjectAnomaly(
  summary: ProposalSummary,
  statsPid: string,
): ProposalAnomaly | undefined {
  if (statsPid === summary.id.value) return undefined;
  return {
    proposalId: summary.id.value,
    detail:
      `${PROPOSAL_READS.decisionStats}() answered about proposal ${statsPid} while this ` +
      `client asked about ${summary.id.value}. The statistics are not being rendered: they ` +
      'are a true reading of a different proposal, which under this proposal’s heading is a ' +
      'false statement made entirely out of genuine chain bytes.',
  };
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
/** Which sentence a proposal with no statistics gets. One name per state, per `viewFor`. */
function reasonFor(state: string): 'trading' | 'extended' | 'reopening' | 'not-yet-opened' {
  if (state === 'Extended') return 'extended';
  if (OPEN_TRADING_STATES.has(state)) return 'trading';
  if (state === REOPENING_STATE) return 'reopening';
  return 'not-yet-opened';
}

export function viewFor(
  summary: ProposalSummary,
  stats: DecisionStats | undefined,
): { readonly view: ProposalView; readonly anomaly: ProposalAnomaly | undefined } {
  const state = summary.state.value;
  const sealed = STATS_REQUIRE_SEALED.has(state);

  if (stats === undefined) {
    return { view: { stage: 'pre-decision', summary, reason: reasonFor(state) }, anomaly: undefined };
  }

  if (!sealed) {
    // Both reads came from one pinned block, so this is not a race. Refusing is the only
    // direction that cannot put a projected outcome on an open market.
    return {
      view: { stage: 'pre-decision', summary, reason: reasonFor(state) },
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
 * One `DecisionStatsView` as the dashboard renders it, every leaf descending from `read`.
 *
 * `derive` throughout, never a status written beside the values (10 §2.1/§2.2, V-182/V-200):
 * the pin can only be the one the `decision_stats` call came back with, and a later edit that
 * reads a figure from somewhere else cannot inherit it by sitting next to the others.
 *
 * `uplift1e9` is the one derived figure, and it is derived from **this same read** — 10 §2.2's
 * *"computed client-side purely from such values"*. It is `twap_accept − r_eff`, the left side
 * of 05 §5.4 step 6 minus its floor. Nothing is derived for the trailing window, because
 * step 7's floor needs a trailing Baseline TWAP the view does not publish.
 *
 * Exported for the reason {@link viewFor} is: it is the projection rule, and a test that could
 * only reach it through a reader would be testing the reader.
 */
export function projectStats(read: Finalized<unknown>, record: StatsRecord): DecisionStats {
  const gates = record.gateTwaps1e9;
  return {
    twapAccept1e9: derive(read, () => record.twapAccept1e9),
    twapReject1e9: derive(read, () => record.twapReject1e9),
    twapBaseline1e9: derive(read, () => record.twapBaseline1e9),
    rEff1e9: derive(read, () => record.rEff1e9),
    trailingAccept1e9: derive(read, () => record.trailingAccept1e9),
    trailingReject1e9: derive(read, () => record.trailingReject1e9),
    uplift1e9: derive(read, () => record.twapAccept1e9 - record.rEff1e9),
    coveragePct: derive(read, () => record.coveragePct),
    tradedVolume: derive(read, () => record.tradedVolume),
    vMinRequired: derive(read, () => record.vMinRequired),
    converged: derive(read, () => record.converged),
    attackCostHat: derive(read, () => record.attackCostHat),
    inCapPrize: derive(read, () => record.inCapPrize),
    gates:
      gates === undefined
        ? { present: false }
        : {
            present: true,
            // Positional, and the order is 02 §4's own `(S,C) × (adopt, reject)`. Written out
            // here rather than passed as a tuple so the four names exist in exactly one place.
            survivalAdopt1e9: derive(read, () => gates[0]),
            survivalReject1e9: derive(read, () => gates[1]),
            securityAdopt1e9: derive(read, () => gates[2]),
            securityReject1e9: derive(read, () => gates[3]),
          },
  };
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

  // Every summary leaf descends from `raw` through `derive`, which carries that call's own pin
  // (10 §2.2's "computed client-side purely from such values"). The local stamping helper this
  // replaced took any value and returned a `verified-finalized` badge, so it was the call site
  // rather than the type that decided whether the badge was true (V-200).
  const summaries: ProposalSummary[] = decoded.value.map((record) => ({
    id: derive(raw, () => record.id),
    payloadHash: derive(raw, () => record.payloadHash),
    klass: derive(raw, () => record.klass),
    state: derive(raw, () => record.state),
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
      // The answer is kept whole rather than unwrapped, because each statistic is derived from
      // **this** call's pin and not from the summary read's. The two are the same block for any
      // reader that honours its own `at`, and that is exactly why taking the nearer pin would
      // never look wrong: a reader that answered the second call at another block would badge
      // the statistics with a block they were not read at, and nothing on screen would say so.
      let statsRead: Finalized<string> | undefined;
      try {
        statsRead = await reader.call(
          `FutarchyApi_${PROPOSAL_READS.decisionStats}`,
          args.decisionStats(summary.id.value),
        );
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

      if (statsRead !== undefined) {
        const answer = statsRead;
        const stated = decoders.decisionStats(answer.value);
        if (!stated.ok) undecodable.push({ label, rawHex: answer.value, reason: stated.reason });
        else if (stated.value !== undefined) {
          const record = stated.value;
          // The echoed subject, before anything is projected. A mismatch means this client
          // asked about a different proposal, so there is nothing here to render under this
          // heading and the block is dropped rather than shown (see `statsSubjectAnomaly`).
          const mismatch = statsSubjectAnomaly(summary, record.pid);
          if (mismatch !== undefined) anomalies.push(mismatch);
          else stats = projectStats(answer, record);
        }
      }
    }

    const decided = viewFor(summary, stats);
    views.push(decided.view);
    if (decided.anomaly !== undefined) anomalies.push(decided.anomaly);
  }

  return { summaries, views, undecodable, anomalies };
}
