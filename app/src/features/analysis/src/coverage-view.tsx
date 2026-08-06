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
 * ## Three ways a covered span can be empty, and each gets its own line
 *
 * A hole is *not ingested*. A `downsampled` range is *ingested and still held, one rung
 * coarser*. A `chartDiscard` is *ingested, still covered, and no longer held at any resolution*.
 * A surface that rendered only holes would show the last two as complete data — which is the
 * silent splice INV-FE-15 forbids, arriving through the channel §9.2 opened.
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

import { DataTable, Notice, type ReactNode } from '@bleavit/ui';
import type { CoverageRange, CoveredHistory, Hole } from '@bleavit/local-index';

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
  const { covered, downsampled, chartDiscard } = answer;
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

      {/* Holes first and always rendered, never elided and never interpolated over. */}
      {covered.holes.length === 0 ? null : (
        <>
          <Notice severity="caution" heading="Periods this device never indexed">
            These blocks are not missing observations — they were never read. Nothing is drawn
            across them and no value here is an estimate over them.
          </Notice>
          <DataTable
            caption="Gaps"
            headers={['Blocks']}
            rows={covered.holes.map((hole: Hole) => ({
              key: `hole-${hole.fromBlock}-${hole.toBlock}`,
              cells: [span(hole)],
            }))}
          />
        </>
      )}

      {/* §9.2's ladder: still covered, still held, one rung coarser. Not a hole. */}
      {downsampled.length === 0 ? null : (
        <DataTable
          caption="Periods held at a coarser resolution"
          headers={['Blocks', 'Still held at', 'Why']}
          rows={downsampled.map((range) => ({
            key: `down-${range.fromBlock}-${range.toBlock}`,
            cells: [span(range), range.resolution, range.reason],
          }))}
        />
      )}

      {/* A migration or repair emptied these: covered, and nothing survives. The third state,
          which a hole-only rendering shows as complete data. */}
      {chartDiscard === undefined ? null : (
        <Notice severity="caution" heading="Chart detail was dropped by an upgrade">
          {chartDiscard.rows} row(s) were removed from {chartDiscard.tables.join(', ')} when this
          device moved from schema {chartDiscard.fromSchema} to {chartDiscard.toSchema}
          {chartDiscard.fromBlock === undefined || chartDiscard.toBlock === undefined
            ? ', over a span this device can no longer name — so it is reported for every span, ' +
              'because an unnameable loss must not become an invisible one'
            : `, over blocks #${chartDiscard.fromBlock}–#${chartDiscard.toBlock}`}
          . Those blocks are still marked as indexed and hold nothing at any resolution.
        </Notice>
      )}

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
