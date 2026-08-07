/**
 * S2 — proposal list and detail, plain reading (11 §11.2).
 *
 * Two rules in that section are not layout advice, and both are enforced by the shape of
 * the props rather than by remembering them.
 *
 * ## 1. Finalized decision statistics are not a trading preview
 *
 * > `decision_stats(pid)` is available only after the registered decision windows are
 * > sealed … S2 MAY render it only as finalized decision statistics; while a proposal
 * > remains in Trade/Extended and the view returns `None`, S2 and S3 MUST render no
 * > projected uplift, projected PASS/REJECT, or other in-Trade preview derived from it.
 *
 * The tempting shape is `decisionStats?: Verified<DecisionStats>` plus a comment. Then a
 * caller with a `Trading` proposal and a stale value from a previous render has somewhere
 * to put it, and a reader has a plausible-looking uplift figure on a market that is still
 * open — which is the strongest possible nudge, arriving with a `verified-finalized` badge
 * that is *technically correct*.
 *
 * So `ProposalView` is a discriminated union and the `pre-decision` arm **has no field for
 * it**. Not optional, absent. A caller cannot supply statistics for a proposal that has
 * none, because the type offers nowhere to put them.
 *
 * ## 2. Epoch shrink is a count of slots, never an amount
 *
 * > render `requested` and `funded` as proposal-slot counts plus the dropped proposal IDs
 * > — never as USDC amounts. A shrink is a visible capacity event, not an absent/zeroed
 * > slot.
 *
 * Rendered through `Count`, which appends no symbol and takes no `decimals`. `Amount` is
 * the only component that can render a currency, and it requires both — so rendering a
 * slot count as money needs someone to invent a decimals value, which is a decision rather
 * than a slip.
 */

import {
  Amount,
  Count,
  DataTable,
  Datum,
  Field,
  Identifier,
  Notice,
  Panel,
  Phrase,
  formatBaseUnits,
  type ReactNode,
} from '@bleavit/ui';
import type { Verified } from '@bleavit/shared-types';

import { FIXED_DECIMALS } from './welfare-dashboard.js';

/**
 * A proposal row, as read. Every leaf is `Verified<T>` — 10 §2.1.
 *
 * **There is no title, and that is a fact about the chain rather than a gap here (SQ-860).**
 * An earlier version of this interface carried `title: Verified<string>`, and writing S2's
 * composition root is what proved it unbuildable: neither `Proposal<AccountId>` (02 §7.1) nor
 * `ProposalSummaryView` (02 §4) declares any free-text field — a proposal's content is a
 * **`payload_hash`** over a preimage that decodes to calls, and 11 §11.2's S2 read list names
 * no source for a human label either. So a decoder could only have invented one, under a
 * `verified-finalized` badge, in the field a user reads first.
 *
 * The commitment is therefore what identifies the proposal here, rendered as the hash it is.
 * A future release that wants a human label has to say where it comes from and what status it
 * carries; it cannot arrive by a decoder quietly filling a field that already exists.
 */
export interface ProposalSummary {
  readonly id: Verified<string>;
  /** `payload_hash` — the commitment the queue, the guard and `execute` all re-check. */
  readonly payloadHash: Verified<string>;
  readonly klass: Verified<string>;
  readonly state: Verified<string>;
}

/**
 * The four gate-book window TWAPs, when the class carries gate markets.
 *
 * `DecisionStatsView.gate_twaps_1e9` is an `Option<[FixedU64; 4]>` and 02 §4 labels the array
 * `(S,C) × (adopt, reject)`. A union rather than four optional fields: a class with no gate
 * markets has **no** gate TWAPs, and an arm with nothing to render is how that stays
 * unrenderable rather than becoming four zeroes on screen — which would read as four
 * perfectly clean gate books (05 §5.4 step 4 vetoes on `p̂ᵍ_adopt > p_max(g)`, so *low is
 * healthy* and an invented zero is the flattering direction).
 *
 * The four are named rather than kept as a tuple, because their order is wire format: a
 * screen indexing `[2]` for *Survival, reject* labels the Security book with the Survival
 * book's price, and both are plausible numbers.
 */
export type GateTwaps =
  | { readonly present: false }
  | {
      readonly present: true;
      readonly survivalAdopt1e9: Verified<bigint>;
      readonly survivalReject1e9: Verified<bigint>;
      readonly securityAdopt1e9: Verified<bigint>;
      readonly securityReject1e9: Verified<bigint>;
    };

/**
 * What `decision_stats(pid)` returns once the windows are sealed — 02 §4's `DecisionStatsView`.
 *
 * **Every field below is one the runtime publishes, and that is the repair this type carries.**
 * The previous version had two fields, `outcome: Verified<string>` and
 * `upliftPpm: Verified<bigint>`, and **neither is a member of `DecisionStatsView`**. There is
 * no `outcome` in the view at all: the decision's outcome is the proposal's own `state`
 * (05 §2.1's lifecycle, already on this screen), so a second string beside it was a
 * client-authored verdict that could disagree with the chain and be believed — the badge
 * would have been `verified-finalized` either way.
 *
 * ## `pid` is not here, because it is a check rather than a figure
 *
 * The view echoes the `ProposalId` it was asked about. Rendering it beside the id already on
 * screen is noise; **comparing** them is the only check that closes the hole
 * `ProposalArgs` names in as many words — a wrong SCALE argument does not fail, it asks about
 * a different proposal and gets a valid answer. `proposal-reads.ts` performs that comparison
 * and refuses the whole block on a mismatch, so this type has no field for it.
 *
 * ## The 1e9 grid is kept, never projected
 *
 * Every `FixedU64` here is on the contract's 1e9 grid and stays there, named `…1e9` for the
 * reason `WelfarePillars` states: *"Rendering one through a parts-per-million formatter is a
 * factor of a thousand."* The superseded `upliftPpm` did exactly that division, discarding
 * the chain's last three digits before anything could read them.
 */
export interface DecisionStats {
  /** Decision-window TWAP of the ACCEPT book (05 §5.4 step 6, `a_f`). */
  readonly twapAccept1e9: Verified<bigint>;
  /** Decision-window TWAP of the REJECT book (`r_f`). */
  readonly twapReject1e9: Verified<bigint>;
  /** The epoch Baseline book's decision-window TWAP, **as `decide()` used it** (05 §5.3). */
  readonly twapBaseline1e9: Verified<bigint>;
  /** `r_eff = max(r_f, base − σ(class))` — the reject-leg floor ACCEPT had to beat. */
  readonly rEff1e9: Verified<bigint>;
  /** Trailing-window TWAPs (05 §5.4 step 7). Carried apart — see {@link DecisionStats.uplift1e9}. */
  readonly trailingAccept1e9: Verified<bigint>;
  readonly trailingReject1e9: Verified<bigint>;
  /**
   * The full-window uplift, `twap_accept − r_eff` — derived from this one read.
   *
   * 05 §5.4 step 6 is `a_f >= r_eff + delta`, so this is the left-hand side minus the floor,
   * and 04 §12's worked example calls the same quantity *uplift*. It is **signed**: a
   * rejected proposal's is negative, and `formatBaseUnits` renders that.
   *
   * **It is not compared against δ, and there is no trailing counterpart.** δ is
   * `dec.delta(class)` plus the rerun increment, which lives in `params()` — a read this
   * screen does not make — and the outcome is the chain's own `state` regardless. The
   * trailing uplift looks equally derivable and is not: step 7's floor is
   * `max(r_t, base_trailing − σ)`, and `base_trailing` has **no field in `DecisionStatsView`**.
   * A client computing `trailing_accept − trailing_reject` would be right only while the
   * Baseline floor does not bind — which is exactly the state TH-7's Baseline suppression
   * creates — and 04 §12's own example computes it that way, so the trap is written down.
   */
  readonly uplift1e9: Verified<bigint>;
  /** Percent of scheduled observation intervals covered in the window (05 §5.2). */
  readonly coveragePct: Verified<number>;
  /** Contest capital measured over the window, and the per-book floor it is graded against. */
  readonly tradedVolume: Verified<bigint>;
  readonly vMinRequired: Verified<bigint>;
  /** `|spot_close − TWAP| ≤ Δ_max` on both welfare books (05 §5.4 step 8). */
  readonly converged: Verified<boolean>;
  readonly gates: GateTwaps;
  /** D-4 (05 §5.4 step 9): the measured-depth attack estimate and the in-cap prize. */
  readonly attackCostHat: Verified<bigint>;
  readonly inCapPrize: Verified<bigint>;
}

/**
 * A proposal's detail view.
 *
 * The `pre-decision` arm carries no statistics field of any kind. That is the control.
 */
export type ProposalView =
  | {
      readonly stage: 'pre-decision';
      readonly summary: ProposalSummary;
      /** Why there are no statistics yet, in the client's own words. */
      readonly reason: 'trading' | 'extended' | 'reopening' | 'not-yet-opened';
    }
  | {
      readonly stage: 'decided';
      readonly summary: ProposalSummary;
      readonly decisionStats: DecisionStats;
    };

const PRE_DECISION_COPY: Readonly<
  Record<'trading' | 'extended' | 'reopening' | 'not-yet-opened', string>
> = Object.freeze({
    trading:
      'The decision windows are still open, so there are no decision statistics yet. Bleavit ' +
      'will not show a projection: a number that looks like an outcome while trading is open ' +
      'is a trading signal, and this screen does not give those.',
    extended:
      'This decision was extended, so its windows are still open and there are no statistics ' +
      'yet. The same rule applies as during ordinary trading.',
    reopening:
      'This decision was reset and its markets reopen for a further window, under a hurdle ' +
      'raised by one percentage point. Any earlier statistics describe a window that no ' +
      'longer decides anything, so none are shown.',
    'not-yet-opened':
      'The markets for this proposal have not opened yet, so there is nothing measured to show.',
  });

export function ProposalList({
  proposals,
  onOpen,
}: {
  readonly proposals: readonly ProposalSummary[];
  readonly onOpen: (id: string) => void;
}) {
  return (
    <Panel title="Proposals">
      <DataTable
        caption="Proposals in this epoch"
        headers={['Id', 'Payload hash', 'Class', 'State']}
        rows={proposals.map((proposal) => ({
          key: proposal.id.value,
          cells: [
            <button
              type="button"
              className="link"
              onClick={() => onOpen(proposal.id.value)}
              key={`open-${proposal.id.value}`}
            >
              <Identifier datum={proposal.id} />
            </button>,
            <Identifier datum={proposal.payloadHash} key={`payload-${proposal.id.value}`} />,
            <Phrase datum={proposal.klass} key={`class-${proposal.id.value}`} />,
            <Phrase datum={proposal.state} key={`state-${proposal.id.value}`} />,
          ],
        }))}
      />
    </Panel>
  );
}

/** A boolean under a badge, per `core-screens.tsx`'s helper of the same name. */
function Flag({
  datum,
  yes,
  no,
  name,
}: {
  readonly datum: Verified<boolean>;
  readonly yes: string;
  readonly no: string;
  readonly name?: string;
}) {
  return (
    <Datum
      datum={datum}
      {...(name === undefined ? {} : { name })}
      render={(value) => (value ? yes : no)}
    />
  );
}

/** A 1e9-grid `FixedU64`, rendered on its own grid — never projected (see {@link DecisionStats}). */
function Fixed({ datum, name }: { readonly datum: Verified<bigint>; readonly name?: string }) {
  return (
    <Datum
      datum={datum}
      {...(name === undefined ? {} : { name })}
      render={(value) => formatBaseUnits(value, FIXED_DECIMALS)}
    />
  );
}

/**
 * The sentence that keeps this dashboard a set of statistics rather than a verdict.
 *
 * 11 §11.2 permits S2 to render `decision_stats(pid)` *"only as finalized decision
 * statistics"*. The outcome is beside it already, as the proposal's `state`, and this panel
 * deliberately re-derives nothing: no PASS/REJECT, no hurdle comparison, no step-9 verdict.
 * Where a client's arithmetic disagreed with the chain's own recorded outcome, the client
 * would be asserting something about governance it cannot establish.
 */
export const DECISION_STATS_NOTE =
  'These are the measured statistics the decision was taken on, at the block this client ' +
  'read. The outcome itself is the proposal’s state above — this panel does not re-run the ' +
  'decision rule, because a second answer that disagreed with the chain’s would still ' +
  'carry a verified badge.';

/** Why no trailing uplift is shown, in the client's own words (05 §5.4 step 7). */
export const NO_TRAILING_UPLIFT_NOTE =
  'The trailing figures are shown apart and not subtracted. The trailing test’s floor is ' +
  'max(trailing reject, trailing Baseline − σ), and the trailing Baseline TWAP is not one ' +
  'of the statistics this view publishes — so a trailing uplift computed here would be ' +
  'right only while the Baseline floor does not bind, which is exactly the state a ' +
  'Baseline-suppression attack creates.';

/**
 * S2's finalized decision dashboard — 02 §4's `DecisionStatsView`, whole.
 *
 * Rendered only from the `decided` arm of {@link ProposalView}, which is what makes 11 §11.2's
 * in-Trade prohibition unreachable rather than remembered: the pre-decision arm has no field
 * this component could read.
 */
export function DecisionDashboard({
  stats,
  decimals,
  symbol,
}: {
  readonly stats: DecisionStats;
  /** USDC's unit (D-17) — supplied, never defaulted (app-code rule 7). */
  readonly decimals: number;
  readonly symbol: string;
}) {
  return (
    <Panel title="Decision statistics (finalized)">
      <Notice severity="info" heading="What this panel is">
        {DECISION_STATS_NOTE}
      </Notice>

      <Field label="Decision-window TWAPs">
        <Fixed datum={stats.twapAccept1e9} name="accept" />
        <Fixed datum={stats.twapReject1e9} name="reject" />
        <Fixed datum={stats.twapBaseline1e9} name="baseline" />
      </Field>
      <Field label="Reject-leg floor (r_eff)">
        <Fixed datum={stats.rEff1e9} />
      </Field>
      <Field label="Uplift over the floor">
        <Fixed datum={stats.uplift1e9} />
      </Field>

      <Field label="Trailing-window TWAPs">
        <Fixed datum={stats.trailingAccept1e9} name="accept" />
        <Fixed datum={stats.trailingReject1e9} name="reject" />
        {NO_TRAILING_UPLIFT_NOTE}
      </Field>

      <Field label="Observation coverage">
        <Count datum={stats.coveragePct} name="percent of scheduled intervals" />
      </Field>
      <Field label="Convergence">
        <Flag datum={stats.converged} yes="spot and TWAP agree" no="not converged" />
      </Field>
      <Field label="Contest capital">
        <Amount datum={stats.tradedVolume} decimals={decimals} symbol={symbol} name="measured" />
        <Amount datum={stats.vMinRequired} decimals={decimals} symbol={symbol} name="required" />
      </Field>
      <Field label="Economic security sizing">
        <Amount
          datum={stats.attackCostHat}
          decimals={decimals}
          symbol={symbol}
          name="attack-cost estimate"
        />
        <Amount datum={stats.inCapPrize} decimals={decimals} symbol={symbol} name="in-cap prize" />
      </Field>

      {stats.gates.present ? (
        <Field label="Gate-book window TWAPs">
          <Fixed datum={stats.gates.survivalAdopt1e9} name="survival, adopt" />
          <Fixed datum={stats.gates.survivalReject1e9} name="survival, reject" />
          <Fixed datum={stats.gates.securityAdopt1e9} name="security, adopt" />
          <Fixed datum={stats.gates.securityReject1e9} name="security, reject" />
        </Field>
      ) : (
        <Notice severity="info" heading="No gate books">
          This proposal’s class carries no gate markets, so this view publishes no gate TWAPs.
          Nothing is shown rather than zero: a gate veto fires on a <em>high</em> adopt price, so
          an invented zero would read as four perfectly clean books.
        </Notice>
      )}
    </Panel>
  );
}

export function ProposalDetail({
  view,
  decimals,
  symbol,
}: {
  readonly view: ProposalView;
  readonly decimals: number;
  readonly symbol: string;
}) {
  return (
    <Panel title="Proposal">
      <Field label="Id">
        <Identifier datum={view.summary.id} />
      </Field>
      <Field label="Payload hash">
        <Identifier datum={view.summary.payloadHash} />
      </Field>
      <Field label="Class">
        <Phrase datum={view.summary.klass} />
      </Field>
      <Field label="State">
        <Phrase datum={view.summary.state} />
      </Field>

      {view.stage === 'decided' ? (
        <DecisionDashboard stats={view.decisionStats} decimals={decimals} symbol={symbol} />
      ) : (
        <Notice severity="info" heading="No decision statistics yet">
          {PRE_DECISION_COPY[view.reason]}
        </Notice>
      )}
    </Panel>
  );
}

/**
 * The 11 §11.2 epoch-shrink event, rendered as capacity.
 *
 * `requested` and `funded` are `Verified<number>` and go through `Count`. `Amount` needs
 * `decimals` and a `symbol`, neither of which exists for a slot, so the money reading is
 * not reachable by a slip.
 */
export interface SlotsShrunk {
  readonly epoch: Verified<number>;
  readonly requested: Verified<number>;
  readonly funded: Verified<number>;
  readonly dropped: readonly Verified<string>[];
}

export function EpochShrinkNotice({ shrunk }: { readonly shrunk: SlotsShrunk }) {
  return (
    <Notice severity="caution" heading="Fewer proposal slots were funded than requested">
      <Field label="Slots requested">
        <Count datum={shrunk.requested} />
      </Field>
      <Field label="Slots funded">
        <Count datum={shrunk.funded} />
      </Field>
      <Field label="Proposals dropped">
        {shrunk.dropped.map((id) => (
          <Identifier datum={id} key={id.value} />
        ))}
      </Field>
      These are slot counts, not amounts of money. The dropped proposals were not funded this
      epoch.
    </Notice>
  );
}

export type { ReactNode };
