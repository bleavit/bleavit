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
 * second half. **Which sources those are is `boundarySet`'s answer**, not a second walk written
 * here — see that function's own note.
 *
 * ## The edge column states a capability, and that is not a shortfall in the wording
 *
 * §6.3's `checked` arm means *all three checks **can** run*, and the verdict of a comparison
 * lives in `CoverageVerification` — which `CoveredHistory` does not carry. So this surface can
 * honestly say what an edge **records** and cannot say what the chain answered; saying the
 * second would be inferring the `ok` verdict §6.3 forbids inferring. See {@link edgeNote} and
 * {@link EDGE_IS_NOT_A_VERDICT}, and **SQ-980** for whether a history query must state it.
 *
 * @see docs/architecture/10-frontend-architecture.md §6.3, §9.2
 * @see docs/architecture/15-invariants-and-testing.md §2 — INV-FE-15
 */

import { DataTable, type ReactNode } from '@bleavit/ui';
import { boundarySet, type CoverageRange, type CoveredHistory } from '@bleavit/local-index';

import { CoveredHistoryDisclosure } from './index-disclosure-view.js';

/**
 * A boundary token in words — the **only** place in this client where one becomes a sentence.
 *
 * A provider range is named by its **id**, because *"from a provider"* is not an origin a user
 * can act on (INV-FE-15's *"origin to the pixel"*). A `self` range has no id and needs none: it
 * is this device's own light client.
 */
function humanSource(token: string): string {
  if (token === 'self') return 'this device’s own light client';
  const separator = token.indexOf(':');
  return separator < 0 ? token : `${token.slice(0, separator)}: ${token.slice(separator + 1)}`;
}

/**
 * Who supplied the history in these ranges, each named once — §6.3's boundary set, rendered.
 *
 * **Which sources there are is `boundarySet`'s answer, not this module's.** This function used
 * to walk the ranges itself and build first-seen names, so one §6.3 sentence had two
 * implementations — `packages/local-index`'s `boundarySet` (which delegates in turn to
 * `shared-types`, so the badge and the index agree) and this one — differing in order, in
 * spelling and, first, on whatever case nobody tested. `coverage.ts` warns against exactly that
 * immediately above its own delegation. So the set comes from there and only the **words** are
 * decided here.
 *
 * Order is therefore `boundarySet`'s sort over the tokens rather than first-seen. Both are
 * stable across renders of the same coverage, which is the property that mattered; what changed
 * is that there is now one rule instead of two.
 */
export function distinctSources(ranges: readonly CoverageRange[]): readonly string[] {
  return boundarySet(ranges).map(humanSource);
}

/**
 * What a range's edge **records** — which is what it makes checkable, never what happened to it.
 *
 * §6.3 defines the `checked` arm as *"all three facts, all three checks **can** run"*: the arm
 * says the two comparable facts were written down at `toBlock`, not that anything compared them.
 * The verdict of an actual comparison lives in `CoverageVerification` (`ok` / `invalid` /
 * `unchecked`), and **`CoveredHistory` does not carry one**.
 *
 * This branch read *"…and both are checked against the chain"* until 2026-08-07, which is an
 * `ok` verdict inferred from an edge — the inference §6.3 forbids in as many words: *"An
 * unverifiable edge yields unchecked, never ok"*, where `ok` *"states that a range was compared
 * against the chain and agreed"*. It was worse than an over-claim in isolation, because nothing
 * in this client pins a genesis yet, so every range in fact verdicts `unchecked` — and the same
 * range read as *"Ranges this client could not check"* on F25's boot surface and as *checked
 * against the chain* here. Whether a history query must instead carry its verdict, which would
 * let this column say *was* rather than *can be*, is **SQ-980**; until that is ruled the honest
 * column is the capability one, and {@link EDGE_IS_NOT_A_VERDICT} says so beside it.
 */
function edgeNote(range: CoverageRange): string {
  return range.edge.kind === 'checked'
    ? 'a genesis binding, the block hash and the runtime version at this range’s edge, so this ' +
        'range can be compared against the chain'
    : // §6.3: the `unverifiable` arm keeps the genesis binding — the check that still runs — and
      // "names the reason the other two facts are absent, and a surface may render it".
      `a genesis binding only — ${range.edge.why}`;
}

/**
 * Stated beside the table, because *can be compared* and *was compared* are one word apart.
 *
 * A reader given a column of edge facts and no disclaimer will read it as a result — which is
 * the reading §6.3 refuses (*"an `ok` verdict must never be inferred"*). The sentence is here
 * rather than in the column header because a header is a label and this is a limit.
 */
export const EDGE_IS_NOT_A_VERDICT =
  'The last column says what each range’s edge records, which is what could be compared. It is ' +
  'not a result: a history answer carries no verdict, so nothing here says that a range agrees ' +
  'with the chain.';

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
        headers={['Blocks', 'Source', 'What its edge records']}
        rows={covered.ranges.map((range) => ({
          key: `range-${range.fromBlock}-${range.toBlock}-${range.origin}`,
          cells: [
            span(range),
            // Never merged across a provenance boundary, so two adjacent ranges from two
            // sources stay two rows here (§6.3's no-splice rule, rendered). The label goes
            // through the summary's own two functions rather than being spelled a third time:
            // `boundarySet` over a single range yields exactly one token, so this is that token
            // humanised, and one source cannot end up with two names on one screen.
            distinctSources([range]).join(''),
            edgeNote(range),
          ],
        }))}
      />

      <p className="coverage__edge-caveat">{EDGE_IS_NOT_A_VERDICT}</p>
    </div>
  );
}
