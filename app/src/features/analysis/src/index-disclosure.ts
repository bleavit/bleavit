/**
 * What the local index has to tell the user — 10 §6.3, §6.5, §9.2; 15 §2 INV-FE-7/INV-FE-15. F25.
 *
 * ## Why this file exists, stated once
 *
 * `packages/local-index` produces a machine-readable record for every kind of loss it can
 * cause: coverage ranges dropped by sanitization, ranges the chain disagreed with, ranges
 * nothing could check, raw event blobs disposed of under §9.1's bound, chart rows a schema
 * migration emptied, and §9.2's downsampled labels. Every one of those records had a producer
 * and **no reader** — nothing in `app/src` constructed a `LocalIndex`, so `checkIndexAtBoot`
 * had no call site outside its own suite. Five consecutive review rounds of F8 found the same
 * shape one layer down each time: a checker with no call site, an error code with no emitter,
 * a record on a channel no query reads. This module is the reader.
 *
 * ## The rule this file is written under: **it may not invent the words**
 *
 * 10 §9.4 requires *"fixed user copy + expert detail + documented recovery per code; no
 * free-text errors"*, and `FE-IDX-002` — the code a per-range invalidation would emit — is
 * declared in that taxonomy and **defined nowhere** (SQ-604). It has since acquired a second
 * candidate emitter (SQ-783, the migration discard), and two further questions are open about
 * what a tier emptied outright may even be *called* (SQ-820) and where that fact belongs in a
 * query's answer (SQ-821).
 *
 * So a disclosure here is one of exactly two things, and the type says which:
 *
 * - **`stated`** — a sentence this client says in its own voice, discharging a rule some
 *   architecture section states, cited. `10 §6.5` supplies the phrase *"N events pending
 *   decoder"*; `§6.3` supplies *"complete within [ranges]"* and the rule that a range in
 *   neither the invalidated nor the unchecked set is one that genuinely passed.
 * - **`awaiting`** — the slot is *empty on purpose*. The record's own fields are rendered
 *   (spans, counts, table names, the reason the record carries) and the surface says that the
 *   wording is not defined yet, naming the open rows. A confident sentence with no authority
 *   behind it is the same defect these records exist to prevent, one level up.
 *
 * A suite binds both halves mechanically: every `stated` citation must resolve to a real
 * section of a real architecture document, and every `awaiting` slot must name spec-question
 * rows PLAN.md still lists as **open**. The second is a mechanical expiry — the day SQ-604 is
 * ruled, the suite fails and the copy has to be written.
 *
 * ## `unchecked` gets the most care, because it is the state that reads as a pass
 *
 * §6.3's last bullet: *"a range that appears in neither the invalidated nor the unchecked set
 * is one that genuinely passed"*. Since the `unverifiable` edge arm landed, **every provider
 * range verdicts `unchecked` by construction** — the arm carries no hash and no spec version,
 * so two of the three checks cannot run — and a client with no chain connection verdicts
 * *everything* `unchecked`. A surface that rendered `invalidated` and dropped `unchecked`
 * would reproduce, one layer up, the exact defect this package has now produced three times.
 * So `unchecked` is rendered, and its copy is written to be unmistakable: **kept, not
 * agreed**.
 */

import {
  boundarySet,
  type ChartDiscardRecord,
  type CoverageRange,
  type CoverageRef,
  type CoveredHistory,
  type DownsampledRange,
  type DroppedRange,
  type Hole,
  type IndexBootReport,
  type PendingRawEvictionRecord,
  type RangeCheck,
} from '@bleavit/local-index';

/**
 * Every disclosure this client can make about its local index.
 *
 * A closed union rather than free strings, because the two records below are **total** over it
 * and over the report's own fields: a field added to `IndexBootReport` without a disclosure
 * fails to compile, which is the compile-time half of *"a record with a producer and no
 * reader"*.
 */
export type IndexDisclosureId =
  | 'index-not-opened'
  | 'index-unopenable'
  | 'coverage'
  | 'ranges-dropped'
  | 'ranges-invalidated'
  | 'ranges-unchecked'
  | 'events-pending-decoder'
  | 'raw-blobs-evicted'
  | 'chart-rows-discarded'
  | 'history-holes'
  | 'history-downsampled';

/**
 * Which disclosure carries which field of the boot report.
 *
 * **Total over `keyof IndexBootReport`.** That is the point: the boot report grew
 * `pendingRawEvicted` and then `chartDiscard` in two consecutive review rounds, and each time
 * the new field was written to a surface that did not read it. A record typed like this cannot
 * be extended without deciding, at compile time, what the user is told about the new field.
 */
export const REPORT_DISCLOSURES: Readonly<Record<keyof IndexBootReport, IndexDisclosureId>> =
  Object.freeze({
    coverage: 'coverage',
    dropped: 'ranges-dropped',
    invalidated: 'ranges-invalidated',
    unchecked: 'ranges-unchecked',
    pendingDecoder: 'events-pending-decoder',
    pendingRawEvicted: 'raw-blobs-evicted',
    chartDiscard: 'chart-rows-discarded',
  });

/**
 * The same, for the read path — 10 §6.3's *"every history query returns data **plus** the
 * coverage it came from"*.
 *
 * `chartDiscard` deliberately maps to the **same** disclosure as the boot report's, so the
 * migration discard has one renderer and one set of words rather than two that agree today.
 * Where the two paths differ is only *when* the record is shown, and that is SQ-821's subject.
 */
export const HISTORY_DISCLOSURES: Readonly<
  Record<keyof CoveredHistory<unknown>, IndexDisclosureId>
> = Object.freeze({
  covered: 'history-holes',
  downsampled: 'history-downsampled',
  chartDiscard: 'chart-rows-discarded',
});

/** One machine-readable field of a record, rendered as itself. */
export interface DisclosureFact {
  readonly label: string;
  readonly value: string;
}

/**
 * Where a disclosure's words come from.
 *
 * There is no third arm, and there is deliberately no way to write a sentence without either
 * citing the rule it discharges or admitting that the rule has not been written yet.
 */
export type DisclosureCopy =
  | {
      readonly kind: 'stated';
      /** In-bundle copy, in this client's own voice. */
      readonly text: string;
      /** The architecture section whose rule this sentence discharges, e.g. `10 §6.3`. */
      readonly cite: string;
    }
  | {
      readonly kind: 'awaiting';
      /** The 10 §9.4 taxonomy code that owes this text, and does not yet carry it. */
      readonly code: string;
      /** The PLAN.md rows that must be ruled. Asserted **open** by the suite. */
      readonly questions: readonly string[];
      /** What those rows have to decide, in one line. */
      readonly asks: string;
    };

export interface DisclosureItem {
  readonly id: IndexDisclosureId;
  readonly severity: 'info' | 'caution' | 'danger';
  /** Structural, in-bundle: *which* fact this is about, never what to do about it. */
  readonly heading: string;
  /** The record's own fields. Always present, whether or not the copy is. */
  readonly facts: readonly DisclosureFact[];
  readonly copy: DisclosureCopy;
}

/**
 * What happened when this client tried to open its local index.
 *
 * Three arms, because collapsing any two of them loses the distinction F25 exists to make.
 * *Not opened* is not *opened and clean*: an index nothing looked at must never render as one
 * that was looked at, which is §6.3's *cannot say* asymmetry applied to the boot path itself.
 */
export type IndexBootState =
  | { readonly kind: 'checked'; readonly report: IndexBootReport }
  /** No index was opened at all — this release pins no chain to open one for. */
  | { readonly kind: 'not-opened'; readonly reason: string }
  /** The database exists and would not open or upgrade — 10 §3.1's `MemoryOnly`. */
  | { readonly kind: 'unopenable'; readonly reason: string };

const span = (from: number, to: number): string => `${from}..${to}`;

const rangeSpan = (range: Pick<CoverageRange, 'fromBlock' | 'toBlock'>): string =>
  span(range.fromBlock, range.toBlock);

/**
 * A range named with its source, because §6.3 says a boundary is a rendered fact.
 *
 * > A range boundary is a rendered fact, so a surface summarising coverage names its
 * > **distinct sources** rather than counting its gaps.
 *
 * A provider range with no `providerId` renders its origin alone rather than an invented name.
 */
function sourceOf(range: CoverageRange): string {
  return range.providerId === undefined ? range.origin : `${range.origin}:${range.providerId}`;
}

/** The lowest and highest block any range claims, or `undefined` for empty coverage. */
function envelopeOf(ranges: readonly CoverageRange[]): string | undefined {
  let low: number | undefined;
  let high: number | undefined;
  for (const range of ranges) {
    if (low === undefined || range.fromBlock < low) low = range.fromBlock;
    if (high === undefined || range.toBlock > high) high = range.toBlock;
  }
  return low === undefined || high === undefined ? undefined : span(low, high);
}

// ------------------------------------------------------------------ the individual items

/**
 * §6.3's coverage summary — *"tables state 'complete within [ranges]'"*.
 *
 * The sources are named and the gaps are **not** counted, which is §6.3's own correction: a
 * count states how much is missing and nothing about who supplied what is present.
 */
function coverageItem(coverage: CoverageRef): DisclosureItem {
  const envelope = envelopeOf(coverage.ranges);
  const facts: DisclosureFact[] = [
    {
      label: 'Complete within',
      value:
        coverage.ranges.length === 0
          ? 'nothing — this device has ingested no blocks'
          : coverage.ranges.map(rangeSpan).join(', '),
    },
    { label: 'Sources', value: boundarySet(coverage.ranges).join(', ') || 'none' },
  ];
  if (envelope !== undefined) facts.push({ label: 'Oldest to newest block', value: envelope });
  return {
    id: 'coverage',
    severity: 'info',
    heading: 'Local history this device holds',
    facts,
    copy: {
      kind: 'stated',
      cite: '10 §6.3',
      text:
        'This is what this device ingested, listed by block range and by where each range came ' +
        'from. Ranges from different sources are never joined, so a boundary between them is a ' +
        'fact rather than a rounding.',
    },
  };
}

/**
 * Ranges `sanitizeCoverage` refused to rehydrate — a stored record that does not describe a
 * range.
 *
 * This is a **third** failure class beside the two `FE-IDX-002` already has candidate emitters
 * for (SQ-604's per-range chain disagreement, SQ-783's whole-tier migration discard): nothing
 * disagreed and no tier was emptied — a record in IndexedDB stopped being readable. Its
 * recovery differs again, which is what SQ-921 asks. Until that is ruled the record's own
 * technical reason is what a user gets, and it is labelled as such.
 */
function droppedItem(dropped: readonly DroppedRange[]): DisclosureItem {
  return {
    id: 'ranges-dropped',
    severity: 'caution',
    heading: 'Coverage entries this client could not read back',
    facts: dropped.map((drop, index) => ({
      label: `Entry ${index + 1}`,
      value: drop.reason,
    })),
    copy: {
      kind: 'awaiting',
      code: 'FE-IDX-002',
      questions: ['SQ-604', 'SQ-783', 'SQ-921'],
      asks:
        'which code names a stored coverage entry that no longer parses — it is neither a ' +
        'chain disagreement nor a tier emptied by a migration — and what the client tells the ' +
        'user to do about it',
    },
  };
}

/**
 * Ranges the chain **disagreed with** — §6.3's *"corruption of one range invalidates that
 * range, not the index"*.
 *
 * Each range's own reason is rendered because `verifyRange` writes one per check: a genesis
 * binding from another chain, a hash the chain does not have at that height, or a
 * `spec_version` that means the rows were decoded with the wrong metadata. Those three are not
 * interchangeable and a single sentence covering them would be wrong about two.
 */
function invalidatedItem(invalidated: readonly RangeCheck[]): DisclosureItem {
  return {
    id: 'ranges-invalidated',
    severity: 'caution',
    heading: 'Ranges dropped because the chain disagreed with them',
    facts: invalidated.map((check) => ({
      label: rangeSpan(check.range),
      value:
        check.verdict.kind === 'invalid'
          ? check.verdict.reason
          : // `verifyRanges` only ever files an `invalid` verdict here. Rendering the verdict
            // kind rather than asserting keeps a future shape change visible instead of loud:
            // INV-FE-7 makes this path a convenience event, and a disclosure that throws is
            // not that.
            `recorded verdict: ${check.verdict.kind}`,
    })),
    copy: {
      kind: 'awaiting',
      code: 'FE-IDX-002',
      questions: ['SQ-604', 'SQ-783'],
      asks:
        "the fixed user copy and the documented recovery 10 §9.4 requires per code — the code " +
        'is listed in the taxonomy and defined nowhere',
    },
  };
}

/**
 * Ranges nothing could check — **kept**, and never rendered as ranges that passed.
 *
 * The copy is the load-bearing part of this whole file. §6.3 states the asymmetry twice: *"a
 * check that cannot be performed keeps the range"*, and *"a range that appears in neither the
 * invalidated nor the unchecked set is one that genuinely passed"*. So the set is shown, and
 * the sentence says *kept*, not *agreed*.
 *
 * **Both causes land in one list and the list cannot tell them apart** — a provider range
 * whose edge is `unverifiable` can never become checkable, while a chain this client cannot
 * reach becomes checkable the moment it can. Their recoveries differ and `CoverageVerification`
 * carries no discriminator, so this surface deliberately says only what is true of both.
 * SQ-922 asks whether §6.3 obliges the distinction.
 */
function uncheckedItem(unchecked: readonly CoverageRange[]): DisclosureItem {
  return {
    id: 'ranges-unchecked',
    severity: 'caution',
    heading: 'Ranges this client could not check',
    facts: unchecked.map((range) => ({
      label: rangeSpan(range),
      value:
        range.edge.kind === 'unverifiable'
          ? `from ${sourceOf(range)}; states no block hash and no runtime version — ${range.edge.why}`
          : `from ${sourceOf(range)}; nothing could be read from the chain at block ${range.toBlock}`,
    })),
    copy: {
      kind: 'stated',
      cite: '10 §6.3',
      text:
        'These ranges were not compared against the chain, so this client cannot say whether ' +
        'they agree with it. They are kept rather than dropped, because being unable to check ' +
        'something is not evidence against it — and they are listed here rather than left out, ' +
        'because a range left out of both lists would read as one that passed.',
    },
  };
}

/**
 * §6.5's *"N events pending decoder"*, which that section states as a surface obligation.
 *
 * The phrase is the document's, so this is `stated` rather than `awaiting`: what is missing
 * elsewhere is copy for a *loss*, and nothing here is lost — the rows are held raw until the
 * era's metadata is available.
 */
function pendingDecoderItem(pending: number): DisclosureItem {
  return {
    id: 'events-pending-decoder',
    severity: 'info',
    heading: `${pending} events pending decoder`,
    facts: [{ label: 'Events held undecoded', value: String(pending) }],
    copy: {
      kind: 'stated',
      cite: '10 §6.5',
      text:
        'These events were produced by a runtime whose metadata this client does not have, so ' +
        'they are stored exactly as they were read and are not being guessed at. They decode ' +
        'when that metadata becomes available.',
    },
  };
}

/**
 * §6.5's raw blobs, disposed of under §9.1's bound on chain-wide event retention.
 *
 * The record carries its own `reason` and was written to be rendered, so it is — but §9.2 has
 * no *name* for what happened to those blocks. They are not a *hole* (§6.3: nobody ingested
 * them, which is false) and not *downsampled* (§9.2: a coarser rung survives, which it does
 * not). That gap is SQ-820, and SQ-760 is the retention tension underneath it.
 */
function rawEvictedItem(record: PendingRawEvictionRecord): DisclosureItem {
  return {
    id: 'raw-blobs-evicted',
    severity: 'caution',
    heading: 'Undecoded event data this client discarded',
    facts: [
      { label: 'Blocks affected', value: String(record.blocks) },
      { label: 'Block span', value: span(record.oldestBlock, record.newestBlock) },
      { label: 'Bytes released', value: String(record.bytes) },
      { label: 'Recorded reason', value: record.reason },
    ],
    copy: {
      kind: 'awaiting',
      code: 'FE-IDX-002',
      questions: ['SQ-760', 'SQ-820'],
      asks:
        'what these blocks may be called — 10 §9.2 offers only "downsampled", which claims a ' +
        'coarser copy survives, and §6.3 offers only "hole", which claims they were never seen',
    },
  };
}

/**
 * Chart rows a schema migration emptied over blocks `meta.coverage` still claims.
 *
 * The one obligation F25's row names first, because it is the newest and the easiest to lose.
 * Everything the record carries is rendered — which tables, how many rows, the schema versions
 * and the block envelope — and the envelope's three arms stay apart: a coverage row that named
 * no blocks and one that could not be parsed are an ordinary client and a corruption event, and
 * one rendering for both is wrong in one direction whichever it picks.
 */
function chartDiscardItem(record: ChartDiscardRecord): DisclosureItem {
  const envelope =
    record.span.kind === 'named'
      ? span(record.span.fromBlock, record.span.toBlock)
      : record.span.kind === 'none'
        ? 'no blocks were covered when this ran'
        : 'the coverage record could not be read, so the span cannot be named';
  return {
    id: 'chart-rows-discarded',
    severity: 'caution',
    heading: 'Chart rows emptied by a storage upgrade',
    facts: [
      { label: 'Rows removed', value: String(record.rows) },
      { label: 'Tables emptied', value: record.tables.join(', ') },
      { label: 'Blocks still claimed as covered', value: envelope },
      { label: 'Storage schema', value: `${record.fromSchema} → ${record.toSchema}` },
      { label: 'Recorded detail', value: record.detail },
    ],
    copy: {
      kind: 'awaiting',
      code: 'FE-IDX-002',
      questions: ['SQ-604', 'SQ-783', 'SQ-820', 'SQ-821'],
      asks:
        'what a tier emptied outright is called (SQ-820), where that fact belongs in a history ' +
        "query's answer (SQ-821), and whether the migration discard shares a code with a " +
        'per-range invalidation whose recovery is different (SQ-604, SQ-783)',
    },
  };
}

/** §6.3's holes, bounded by the question — *"a hole is never interpolated over, never elided"*. */
function holesItem(holes: readonly Hole[]): DisclosureItem {
  return {
    id: 'history-holes',
    severity: 'caution',
    heading: 'Gaps inside the window you asked about',
    facts: holes.map((hole) => ({ label: rangeSpan(hole), value: 'never ingested by this device' })),
    copy: {
      kind: 'stated',
      cite: '10 §6.3',
      text:
        'This device holds nothing for these blocks. They are shown as gaps and are never drawn ' +
        'across: "there was nothing here" and "this device never saw this" are different ' +
        'answers, and only the second one is being made.',
    },
  };
}

/**
 * §9.2's downsampled labels — blocks still covered, held one rung coarser.
 *
 * `stated`, because §9.2 supplies both the word and its meaning: *"an evicted range becomes a
 * labelled 'downsampled' range, not a hole, and never a silent splice"*. Each range's own
 * `reason` is rendered beside it, since the ladder writes a different one per rung.
 */
function downsampledItem(ranges: readonly DownsampledRange[]): DisclosureItem {
  return {
    id: 'history-downsampled',
    severity: 'info',
    heading: 'Blocks held at a coarser resolution',
    facts: ranges.map((range) => ({
      label: rangeSpan(range),
      value: `${range.resolution} — ${range.reason}`,
    })),
    copy: {
      kind: 'stated',
      cite: '10 §9.2',
      text:
        'These blocks were ingested and are still covered. To stay inside this device’s storage ' +
        'budget the finer detail was folded away and a coarser summary kept, so this is a change ' +
        'of resolution rather than a gap.',
    },
  };
}

// ------------------------------------------------------------------------- the two paths

/**
 * Everything the boot check found, as items a surface renders.
 *
 * An empty list means the check ran and found nothing to say — which is a different statement
 * from *the check did not run*, and that is why `not-opened` and `unopenable` are arms of the
 * state rather than an absent report.
 */
export function bootDisclosure(state: IndexBootState): readonly DisclosureItem[] {
  if (state.kind === 'not-opened') {
    return [
      {
        id: 'index-not-opened',
        severity: 'info',
        heading: 'No local history this session',
        facts: [{ label: 'Reason', value: state.reason }],
        copy: {
          kind: 'stated',
          cite: '10 §3.1',
          text:
            'This client opened no local index, so it has no stored history and has checked ' +
            'none. Nothing on this screen depends on it: every protocol reading comes from the ' +
            'chain, and the transaction path never reads local storage.',
        },
      },
    ];
  }
  if (state.kind === 'unopenable') {
    return [
      {
        id: 'index-unopenable',
        severity: 'caution',
        heading: 'No local history this session',
        facts: [{ label: 'Reason', value: state.reason }],
        copy: {
          kind: 'stated',
          cite: '10 §3.1',
          text:
            'This device’s local history store would not open, so this session runs without ' +
            'one. That is not a failure of the protocol surfaces: reads and signing are ' +
            'unaffected, because the transaction path never reads local storage.',
        },
      },
    ];
  }

  const { report } = state;
  const items: DisclosureItem[] = [coverageItem(report.coverage)];
  if (report.dropped.length > 0) items.push(droppedItem(report.dropped));
  if (report.invalidated.length > 0) items.push(invalidatedItem(report.invalidated));
  if (report.unchecked.length > 0) items.push(uncheckedItem(report.unchecked));
  if (report.pendingDecoder > 0) items.push(pendingDecoderItem(report.pendingDecoder));
  if (report.pendingRawEvicted !== undefined) items.push(rawEvictedItem(report.pendingRawEvicted));
  if (report.chartDiscard !== undefined) items.push(chartDiscardItem(report.chartDiscard));
  return items;
}

/**
 * Everything a history answer has to carry beside its rows — 10 §6.3 on the read path.
 *
 * The three fields are the three ways a covered span can hold fewer rows than it looks like it
 * should: never ingested (`holes`), folded to a coarser rung (`downsampled`), or emptied
 * outright (`chartDiscard`). The last one shares its renderer with the boot report's, so the
 * words and the fields have exactly one implementation.
 */
export function historyDisclosure(history: CoveredHistory<unknown>): readonly DisclosureItem[] {
  const items: DisclosureItem[] = [];
  if (history.covered.holes.length > 0) items.push(holesItem(history.covered.holes));
  if (history.downsampled.length > 0) items.push(downsampledItem(history.downsampled));
  if (history.chartDiscard !== undefined) items.push(chartDiscardItem(history.chartDiscard));
  return items;
}
