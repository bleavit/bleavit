/**
 * §8.4's depth limit, rendered — `SpotCheckReport.reach` as four disclosures. F23.
 *
 * > This limit is disclosed in the provider UI — 10 §8.4
 *
 * F9 gave the re-derivation pass a `reach` field precisely because `compared: 0` is produced
 * by situations that are **opposite** to each other, and nothing rendered it. This module is
 * the disclosure that sentence mandates.
 *
 * ## Four arms, five readings, and the fifth is why this is keyed on a reading
 *
 * `SpotCheckReach` has four arms and a screen must not collapse them: `window-floor` is a
 * permanent blind spot, `above-window-only` is a device that has not caught up, `ceiling` is a
 * check that stopped early, and `whole-document` is the only arm that may be read as *fully
 * re-derived*.
 *
 * But `whole-document` **does not by itself mean anything was compared.** `spotCheckSnapshot`
 * sets it as the loop's initial value and only rewrites it to `above-window-only` when
 * `outOfReach > 0`; `checkCoverage` admits a document whose `coverage` array is empty; so an
 * admitted document covering no blocks ends the pass at `whole-document` with
 * `compared: 0, outOfReach: 0`. The arm's own description says *"every covered block was asked
 * about **and at least one was compared**"*, which is false there — and a screen keying on the
 * arm alone would tell a user their file was fully re-derived when nothing was.
 *
 * So the copy is keyed on {@link ReachReading} rather than on the arm. The reading is a total
 * function of the arm **and the counts**, the fifth reading exists so the empty document has
 * somewhere true to go, and there is no path from a `SpotCheckReport` to a sentence that skips
 * it. `mintSnapshotRows` closes the same hole one layer down with `compared > 0` in its
 * `sampled` predicate; {@link wouldBadgeSampled} is bound to that expression by the suite, so
 * this surface cannot claim a badge the mint refused.
 *
 * ## Every arm renders the counts, so `compared: 0` is never shown bare
 *
 * The counts are the basis of whatever the arm says. A disclosure that stated *"the depth this
 * device cannot reach is not covered"* without saying how much **was** covered would be the
 * blind spot disclosed in words and hidden in practice.
 *
 * @see docs/architecture/10-frontend-architecture.md §8.4
 * @see docs/architecture/15-invariants-and-testing.md §2 — INV-FE-15
 */

import { Disclosure, Notice, type ReactNode } from '@bleavit/ui';
import { SAMPLING_GUARANTEE, type SpotCheckReport } from '@bleavit/providers';

/**
 * What a pass may honestly be read as.
 *
 * Five members over four arms — see the module note. Each is a different sentence to a user,
 * and two of them (`fully-re-derived` and `nothing-to-re-derive`) come from the same arm.
 */
export type ReachReading =
  /** Every covered block inside reach was compared, and at least one existed. */
  | 'fully-re-derived'
  /** The document covers no blocks, so the mandated set was empty. Not a verification. */
  | 'nothing-to-re-derive'
  /** The walk left the bottom of this device's window. Permanent: no sync brings it back. */
  | 'blind-spot-permanent'
  /** The document sits ahead of this device's head. Transient: it catches up. */
  | 'blind-spot-transient'
  /** The work ceiling stopped the walk. A disclosure, not a refusal (SQ-811). */
  | 'unfinished';

export interface ReachCopy {
  readonly heading: string;
  /** What this pass established. Never overstated: four of the five establish nothing. */
  readonly checked: string;
  /** What it did not, and whether that can change. The half a screen is tempted to drop. */
  readonly notChecked: string;
  /**
   * Whether the gap can close on this device.
   *
   * Rendered as an attribute as well as prose, so the suite can assert the two disclosures
   * that look alike are told apart: telling somebody a history can never be checked when the
   * truth is that their device is behind is the substitution `above-window-only` exists for.
   */
  readonly gap: 'none' | 'permanent' | 'transient' | 'retryable';
}

/**
 * The fixed copy, one entry per reading.
 *
 * In-bundle text (INV-FE-13). It is deliberately unflattering in four of the five entries,
 * for `SAMPLING_GUARANTEE`'s reason: a disclosure that reads as reassurance is one that has
 * stopped disclosing.
 */
export const REACH_COPY: Readonly<Record<ReachReading, ReachCopy>> = Object.freeze({
  'fully-re-derived': {
    heading: 'Every block this file covers was re-derived from the chain',
    checked:
      'This device read each covered block from the chain itself and compared it against what ' +
      'the file says happened there, movement for movement and in order.',
    notChecked:
      'This says nothing about blocks the file does not cover. It is also a comparison this ' +
      'device performed, not a proof the publisher supplied.',
    gap: 'none',
  },
  'nothing-to-re-derive': {
    heading: 'This file covers no blocks, so there was nothing to re-derive',
    checked:
      'The file passed its own consistency checks and its content hash matched. No block was ' +
      'compared against the chain, because the file claims to have observed none.',
    notChecked:
      'A file covering nothing is not a file this device has checked against the chain. ' +
      'Nothing here is evidence about a publisher.',
    gap: 'none',
  },
  'blind-spot-permanent': {
    heading: 'The older half of this file is below what this device can read',
    checked:
      'This device compared every covered block that is still inside the window its light ' +
      'client can read, and stopped where that window ends.',
    notChecked:
      'Everything older than that window cannot be re-derived here — not now and not later, ' +
      'because a light client does not keep that history and syncing further does not bring ' +
      'it back. That is the depth this file exists to supply, and it is the depth nothing ' +
      'on this device can confirm.',
    gap: 'permanent',
  },
  'blind-spot-transient': {
    heading: 'This file is ahead of where this device has synced to',
    checked:
      'Nothing was compared. Every block the file covers sits above this device’s own ' +
      'finalized head, so there was nothing on this device to compare them against.',
    notChecked:
      'This is not the same as history being out of reach for good: it is this device being ' +
      'behind. Once it has caught up, importing or re-checking the same file compares blocks.',
    gap: 'transient',
  },
  unfinished: {
    heading: 'The re-derivation stopped before it finished',
    checked:
      'This device compared the blocks it got to before reaching the limit on how much work ' +
      'one import may do. Whatever agreed, agreed.',
    notChecked:
      'The check did not run to the end, so it is not evidence about the rest of the file. ' +
      'The rows are not marked as compared against the chain, however many blocks matched.',
    gap: 'retryable',
  },
});

/**
 * How this pass may be read — a total function of the arm **and** the counts.
 *
 * The `switch` is exhaustive with a `never` default, so a fifth arm added to `SpotCheckReach`
 * fails to compile here rather than falling through to whichever reading happens to be last.
 * That direction matters: the default that reads as *checked* is the one that cannot be walked
 * back once it is on screen.
 */
export function reachReading(report: SpotCheckReport): ReachReading {
  switch (report.reach) {
    case 'whole-document':
      // The count, not the arm. See the module note: an admitted document with empty coverage
      // ends here having compared nothing, and this arm's own description claims otherwise.
      return report.compared > 0 ? 'fully-re-derived' : 'nothing-to-re-derive';
    case 'window-floor':
      return 'blind-spot-permanent';
    case 'above-window-only':
      return 'blind-spot-transient';
    case 'ceiling':
      return 'unfinished';
    default: {
      const unhandled: never = report.reach;
      return unhandled;
    }
  }
}

/**
 * Whether the mint would badge these rows `sampled` — restated here so it can be **rendered**.
 *
 * It is the same expression `mintSnapshotRows` applies, and the suite binds the two by parsing
 * that module rather than by copying its words. A surface free to say *"compared against the
 * chain"* where the mint declined to write it is the same defect the mint's own brand closed,
 * moved to the layer the user actually reads.
 */
export function wouldBadgeSampled(report: SpotCheckReport): boolean {
  return report.reach !== 'ceiling' && report.compared > 0;
}

/**
 * §8.4's depth limit, on screen, with the counts that are its basis.
 *
 * The guarantee is rendered on **every** arm, not only the two that hit a window. §8.4 makes
 * that sentence normative UI copy about the mechanism rather than about one outcome, and a
 * client that showed it only when a blind spot was hit would be showing it exactly where the
 * user already suspects one.
 */
export function ReachDisclosure({ report }: { readonly report: SpotCheckReport }): ReactNode {
  const reading = reachReading(report);
  const copy = REACH_COPY[reading];
  return (
    <div className="reach" data-reach={report.reach} data-reading={reading} data-gap={copy.gap}>
      <Notice severity={copy.gap === 'none' ? 'info' : 'caution'} heading={copy.heading}>
        {copy.checked} {copy.notChecked}
      </Notice>
      {/* The basis, always. A disclosure whose numbers are behind a step is a claim shown
          without them, and `compared: 0` is the number four of the five readings turn on. */}
      <p className="reach__counts">
        Blocks compared against the chain: {report.compared}. Blocks this device asked about and
        could not reach: {report.outOfReach}.{' '}
        {wouldBadgeSampled(report)
          ? 'The imported rows are marked as having been compared against the chain.'
          : 'The imported rows are NOT marked as having been compared against the chain.'}
      </p>
      <Disclosure summary="What spot-checking can and cannot catch">
        <p className="reach__guarantee">{SAMPLING_GUARANTEE}</p>
      </Disclosure>
    </div>
  );
}
