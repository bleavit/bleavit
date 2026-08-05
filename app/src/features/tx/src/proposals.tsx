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
  Count,
  DataTable,
  Field,
  Identifier,
  Notice,
  Panel,
  Phrase,
  Ratio,
  type ReactNode,
} from '@bleavit/ui';
import type { Verified } from '@bleavit/shared-types';

/** A proposal row, as read. Every leaf is `Verified<T>` — 10 §2.1. */
export interface ProposalSummary {
  readonly id: Verified<string>;
  readonly title: Verified<string>;
  readonly klass: Verified<string>;
  readonly state: Verified<string>;
}

/** What `decision_stats(pid)` returns once the windows are sealed. */
export interface DecisionStats {
  readonly outcome: Verified<string>;
  readonly upliftPpm: Verified<bigint>;
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
      readonly reason: 'trading' | 'extended' | 'not-yet-opened';
    }
  | {
      readonly stage: 'decided';
      readonly summary: ProposalSummary;
      readonly decisionStats: DecisionStats;
    };

const PRE_DECISION_COPY: Readonly<Record<'trading' | 'extended' | 'not-yet-opened', string>> =
  Object.freeze({
    trading:
      'The decision windows are still open, so there are no decision statistics yet. Bleavit ' +
      'will not show a projection: a number that looks like an outcome while trading is open ' +
      'is a trading signal, and this screen does not give those.',
    extended:
      'This decision was extended, so its windows are still open and there are no statistics ' +
      'yet. The same rule applies as during ordinary trading.',
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
        headers={['Id', 'Title', 'Class', 'State']}
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
            <Phrase datum={proposal.title} key={`title-${proposal.id.value}`} />,
            <Phrase datum={proposal.klass} key={`class-${proposal.id.value}`} />,
            <Phrase datum={proposal.state} key={`state-${proposal.id.value}`} />,
          ],
        }))}
      />
    </Panel>
  );
}

export function ProposalDetail({ view }: { readonly view: ProposalView }) {
  return (
    <Panel title="Proposal">
      <Field label="Id">
        <Identifier datum={view.summary.id} />
      </Field>
      <Field label="Title">
        <Phrase datum={view.summary.title} />
      </Field>
      <Field label="Class">
        <Phrase datum={view.summary.klass} />
      </Field>
      <Field label="State">
        <Phrase datum={view.summary.state} />
      </Field>

      {view.stage === 'decided' ? (
        <Panel title="Decision statistics (finalized)">
          <Field label="Outcome">
            <Phrase datum={view.decisionStats.outcome} />
          </Field>
          <Field label="Measured uplift">
            <Ratio datum={view.decisionStats.upliftPpm} />
          </Field>
        </Panel>
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
