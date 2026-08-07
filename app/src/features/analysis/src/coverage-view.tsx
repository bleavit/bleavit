/**
 * §6.3's coverage, rendered — holes as visible gaps, sources named, nothing spliced. F23.
 *
 * > Charts render holes as visible gaps with an explainer, tables state "complete within
 * > [ranges]". A hole is never interpolated over, never elided. — 10 §6.3
 *
 * > A range boundary is a rendered fact, so a surface summarising coverage names its **distinct
 * > sources** rather than counting its gaps: a count states how much is missing and nothing
 * > about who supplied what is present. — 10 §6.3
 *
 * F8 built `CoveredHistory<T>` so a query cannot return bare rows. This is the surface that
 * obligation exists for: without one, *"there were no observations in this window"* and *"we
 * never ingested this window"* still arrive as the same empty table, one layer further along.
 *
 * ## Three ways a covered span can be empty, and this file renders none of them itself
 *
 * A hole is *not ingested*. A `downsampled` range is *ingested and still held, one rung
 * coarser*. A `chartDiscard` is *ingested, still covered, and no longer held at any resolution*.
 * A surface that rendered only holes would show the last two as complete data — which is the
 * silent splice INV-FE-15 forbids, arriving through the channel §9.2 opened.
 *
 * All three are `CoveredHistory`'s own fields, and F25 built one reader for them
 * ({@link CoveredHistoryDisclosure}). This file renders that reader rather than a second
 * spelling of it. The first version did write its own, and the duplication was not cosmetic:
 * 10 §9.4 requires fixed copy per error code, `FE-IDX-002` has none yet (SQ-604, SQ-783,
 * SQ-820, SQ-821), and a hand-written sentence about a migration discard is exactly the
 * confident claim with no authority behind it that F25's empty copy slot exists to refuse. It
 * also read `ChartDiscardSpan` as two states rather than three, which announces a corruption
 * that did not happen for every client that has simply charted nothing.
 *
 * What stays here is what the disclosure reader does not answer on the read path: §6.3's
 * *"complete within [ranges]"* summary, the distinct sources, and each range's edge fact. The
 * disclosure is rendered **inside** this component rather than beside it by a caller, because
 * the container is what makes the sibling fields unavoidable at the point the coverage is read.
 *
 * ## The summary names sources, not a gap count
 *
 * {@link distinctSources} is what §6.3's sentence asks for. A count of holes is the number a
 * developer reaches for and it answers the wrong question: it says how much is missing and
 * nothing about who supplied what is present, and §2.3's mandatory labelling is about the
 * second half.
 *
 * @see docs/architecture/10-frontend-architecture.md §6.3, §9.2
 * @see docs/architecture/15-invariants-and-testing.md §2 — INV-FE-15
 */

import { DataTable, type ReactNode } from '@bleavit/ui';
import type { CoverageRange, CoveredHistory } from '@bleavit/local-index';

import { CoveredHistoryDisclosure } from './index-disclosure-view.js';

/**
 * Who supplied the history in these ranges, each named once.
 *
 * A provider range is named by its **id**, because *"from a provider"* is not an origin a user
 * can act on (INV-FE-15's *"origin to the pixel"*). A `self` range has no id and needs none: it
 * is this device's own light client.
 *
 * Order is the order first seen, so the label a user reads is stable across renders of the same
 * coverage rather than depending on a sort nobody chose.
 */
export function distinctSources(ranges: readonly CoverageRange[]): readonly string[] {
  const seen: string[] = [];
  for (const range of ranges) {
    const name =
      range.origin === 'self'
        ? 'this device’s own light client'
        : `${range.origin}: ${range.providerId}`;
    if (!seen.includes(name)) seen.push(name);
  }
  return seen;
}

/** Why a range's two other integrity facts are absent, where the range says so (§6.3). */
function edgeNote(range: CoverageRange): string {
  return range.edge.kind === 'checked'
    ? 'this device read the block hash and runtime version at this range’s edge, and both are ' +
        'checked against the chain'
    : range.edge.why;
}

function span(range: { readonly fromBlock: number; readonly toBlock: number }): string {
  return `#${range.fromBlock}–#${range.toBlock}`;
}

/**
 * The coverage behind one history answer.
 *
 * `caption` names what was asked about, because the same coverage means different things under
 * different questions and a table headed *"Coverage"* invites a reader to take it as global.
 */
export function CoverageView<T>({
  answer,
  caption,
}: {
  readonly answer: CoveredHistory<T>;
  readonly caption: string;
}): ReactNode {
  const { covered } = answer;
  const sources = distinctSources(covered.ranges);
  return (
    <div
      className="coverage"
      data-holes={covered.holes.length}
      data-ranges={covered.ranges.length}
      data-sources={sources.length}
    >
      <p className="coverage__summary">
        {caption}: complete within {covered.ranges.map(span).join(', ') || 'no range at all'},
        asked about {span(covered.span)}.{' '}
        {sources.length === 0
          ? 'Nothing here was ingested from any source.'
          : `Supplied by ${sources.join(', ')}.`}
      </p>

      {/* The three ways this span can hold fewer rows than it looks like it should — never
          ingested, folded one rung coarser, or emptied outright. Holes come first inside it and
          are never elided, and the words are F25's single set rather than a second one. */}
      <CoveredHistoryDisclosure history={answer} />

      <DataTable
        caption="Where each indexed period came from"
        headers={['Blocks', 'Source', 'What was checked at its edge']}
        rows={covered.ranges.map((range) => ({
          key: `range-${range.fromBlock}-${range.toBlock}-${range.origin}`,
          cells: [
            span(range),
            // Never merged across a provenance boundary, so two adjacent ranges from two
            // sources stay two rows here (§6.3's no-splice rule, rendered).
            range.origin === 'self' ? 'this device' : `${range.origin}: ${range.providerId}`,
            edgeNote(range),
          ],
        }))}
      />
    </div>
  );
}
