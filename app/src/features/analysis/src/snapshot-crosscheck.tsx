/**
 * The two-snapshot cross-check §8.4 says the import UI *supports and recommends*. F23.
 *
 * > The only available cross-check is diffing two independent snapshot producers
 * > (`FE-PROV-004` on mismatch), **which the import UI supports and recommends**. — 10 §8.4
 *
 * That clause is the one instruction §8.4's normative copy gives a user about the blind spot it
 * has just disclosed, and `SAMPLING_GUARANTEE` repeats it. Until this module there was nothing
 * for the sentence to point at: `diffSnapshots` existed and no surface offered it.
 *
 * ## The three verdicts are three different things to say, and one of them is a trap
 *
 * `no-overlap` is its own discriminant precisely because two producers who have never covered a
 * common block have cross-checked **nothing**, and the obvious `if (kind === 'agree')` would
 * turn that into a check that passed. This screen renders it at `caution` with no agreement
 * language anywhere — the recommendation is to find a second producer whose coverage actually
 * overlaps, which is the only thing that would make the comparison mean anything.
 *
 * ## Agreement is not verification, and the copy says so
 *
 * Two producers agreeing proves they agree. §8.4 offers the diff as *"the only available
 * cross-check"* for depth and `FE-PROV-004`'s own recovery states that *"agreement between
 * sources is not proof"*. So the `agree` arm names what was compared — the jointly observed
 * blocks — and states the limit rather than congratulating the user.
 *
 * ## A disagreement flags the pair and never a member
 *
 * `diffSnapshots` builds the `FE-PROV-004` refusal, whose fixed recovery leaves the disputed
 * range as a labelled hole. This screen renders that refusal and offers **no control that picks
 * a side**: a *"use this one"* button is the majority resolution §8.4 declines to have, and the
 * absence of the control is the whole of the enforcement available to a screen.
 *
 * @see docs/architecture/10-frontend-architecture.md §8.4, §6.3
 */

import { DataTable, Notice, Panel, Refusal, type ReactNode } from '@bleavit/ui';
import type { DiffVerdict, SnapshotRange } from '@bleavit/providers';

/** What the `agree` arm is allowed to claim, and what it is not. */
export const AGREEMENT_IS_NOT_PROOF =
  'Two independent producers describing the same history the same way is the strongest ' +
  'cross-check available for blocks this device cannot read for itself. It is not proof: both ' +
  'could be wrong in the same way, and nothing outside this device can settle a range this ' +
  'device cannot reach. What does settle it is the chain itself, for the blocks your own light ' +
  'client can read.';

/** Why an empty overlap is not agreement. */
export const NO_OVERLAP_MEANS =
  'These two files cover no block in common, so nothing was compared. This is not agreement ' +
  'and it is not disagreement — it is the comparison not having happened. A second file is only ' +
  'a cross-check where its coverage overlaps the first one’s.';

function spanOf(overlap: readonly SnapshotRange[]): string {
  return overlap.map((range) => `#${range.fromBlock}–#${range.toBlock}`).join(', ');
}

/**
 * Render one comparison.
 *
 * Exhaustive with a `never` default: a fourth verdict must be given its own sentence rather
 * than inheriting the last arm's, and on this surface the last arm is a refusal.
 */
export function CrossCheckView({ verdict }: { readonly verdict: DiffVerdict }): ReactNode {
  switch (verdict.kind) {
    case 'no-overlap':
      return (
        <Panel title="These two snapshots were not compared" tone="advanced">
          <Notice severity="caution" heading="Nothing overlapped">
            {NO_OVERLAP_MEANS}
          </Notice>
        </Panel>
      );
    case 'agree':
      return (
        <Panel title="Two snapshots describe this history the same way" tone="advanced">
          <Notice severity="info" heading={`Compared over ${spanOf(verdict.overlap)}`}>
            {AGREEMENT_IS_NOT_PROOF}
          </Notice>
        </Panel>
      );
    case 'disagree':
      return (
        <Panel title="Two snapshots of the same period disagree" tone="advanced">
          <Refusal
            code={verdict.refusal.code}
            message={verdict.refusal.message}
            recovery={verdict.refusal.recovery}
            detail={verdict.refusal.detail}
          />
          {/* No control picks a winner. Two producers cannot outvote the absence of a proof,
              so the disputed range stays a labelled hole (§6.3) and this screen offers no way
              to resolve it. */}
          <DataTable
            caption={`Movements that differ over ${spanOf(verdict.overlap)}`}
            headers={['Position', 'First file', 'Second file']}
            rows={verdict.disagreements.map((row) => ({
              key: `at-${row.at}`,
              cells: [
                String(row.at),
                row.left ?? 'nothing at this position',
                row.right ?? 'nothing at this position',
              ],
            }))}
          />
        </Panel>
      );
    default: {
      const unhandled: never = verdict;
      return unhandled;
    }
  }
}
