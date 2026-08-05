/**
 * The ratification panel on S2 — 11 §11.7.4. F16.
 *
 * ## The one sentence this file is built around
 *
 * > The guard status is not the referendum lifecycle source. `RatificationStatus::
 * > NoPassedRecord` means only that the guard has no passed-ratification record; it
 * > deliberately does not distinguish never submitted, submitted-but-unbound, submitted and
 * > ongoing, or submitted and rejected.
 *
 * A panel that rendered `NoPassedRecord` as *"not ratified"* would be lying in the most
 * consequential direction available on this screen: the referendum may be ongoing and about
 * to pass, and a proposer reading "not ratified" concludes there is nothing to wait for.
 *
 * So the type makes it impossible. `RatificationView`'s `no-passed-record` arm **requires**
 * a `ReferendumLink` — a caller holding only the guard's record cannot construct the view
 * at all. The rule stops being a thing to remember and becomes a missing argument.
 *
 * ## The deadline is stated as blocks, not as a countdown alone
 *
 * §11.7.4 asks for *"both block numbers and countdowns"*. Blocks are the chain's own unit
 * and are exact; a countdown is a derived estimate that depends on block time. Rendering
 * only the countdown would present an estimate as the deadline, and on a chain whose blocks
 * slow down that estimate is wrong in the direction that runs out of time.
 *
 * ## The cannot-complete warning is arithmetic, not a guess
 *
 * `canStillComplete` compares the referendum's remaining decision + confirm periods against
 * the blocks left before `grace_end`. It returns `false` only when the sum genuinely does
 * not fit — never on a heuristic — because the warning it drives says the proposal *will*
 * reject, and a false positive there tells a proposer to give up on something still live.
 */

import {
  BlockRef,
  Button,
  Count,
  Field,
  Notice,
  Panel,
  Phrase,
  type ReactNode,
} from '@bleavit/ui';
import type { Verified } from '@bleavit/shared-types';

/** What the referendum side says. The guard cannot answer any of this. */
export type ReferendumLink =
  | { readonly kind: 'none-submitted' }
  | {
      readonly kind: 'ongoing';
      readonly index: Verified<string>;
      readonly ayes: Verified<bigint>;
      readonly nays: Verified<bigint>;
      /** Blocks still needed to decide and then confirm, at best. */
      readonly blocksStillNeeded: Verified<number>;
    }
  | { readonly kind: 'rejected'; readonly index: Verified<string> }
  | {
      /** Approved on the referendum side, not yet recorded by the guard. */
      readonly kind: 'approved-not-recorded';
      readonly index: Verified<string>;
    };

/**
 * The panel's state.
 *
 * `no-passed-record` **requires** the referendum link. That is the whole control: a caller
 * with only `RatificationStatus::NoPassedRecord` has nothing to pass, so it cannot render
 * a lifecycle claim the guard never made.
 */
export type RatificationView =
  | { readonly kind: 'passed'; readonly index: Verified<string> }
  | { readonly kind: 'no-passed-record'; readonly referendum: ReferendumLink };

export interface ExecutionWindow {
  readonly maturity: Verified<number>;
  readonly graceEnd: Verified<number>;
  readonly now: Verified<number>;
}

/**
 * Whether ratification can still complete inside the execution window.
 *
 * Pure arithmetic over blocks. `false` means the periods genuinely do not fit — the
 * warning it drives states the proposal *will* reject with `NotRatified`, and a false
 * positive tells a proposer to abandon something still live.
 *
 * A referendum that is already approved, or one nobody has submitted, is **not** decidable
 * this way and returns `undefined`: there is no remaining-period figure to compare, and
 * inventing one would produce a confident answer about a question that was not asked.
 */
export function canStillComplete(
  referendum: ReferendumLink,
  window: ExecutionWindow,
): boolean | undefined {
  if (referendum.kind !== 'ongoing') return undefined;
  const remaining = window.graceEnd.value - window.now.value;
  return referendum.blocksStillNeeded.value <= remaining;
}

const CANNOT_COMPLETE =
  'Ratification can no longer complete inside the execution window — this proposal will ' +
  'reject with NotRatified.';

/** The panel. */
export function RatificationPanel({
  view,
  window,
  onSubmitReferendum,
  onBindIndex,
}: {
  readonly view: RatificationView;
  readonly window: ExecutionWindow;
  readonly onSubmitReferendum: () => void;
  readonly onBindIndex: () => void;
}): ReactNode {
  const stillCompletable =
    view.kind === 'no-passed-record' ? canStillComplete(view.referendum, window) : undefined;

  return (
    <Panel title="Ratification">
      {/* Blocks and countdown both — a countdown alone presents an estimate as the deadline,
          and on a chain whose blocks slow down that estimate is wrong in the direction that
          runs out of time. */}
      <Field label="Execution window">
        <BlockRef datum={window.maturity} name="opens at" />
        <BlockRef datum={window.graceEnd} name="closes at" />
        <Count
          datum={{ value: window.graceEnd.value - window.now.value, status: window.now.status }}
          name="blocks remaining"
        />
      </Field>

      {view.kind === 'passed' ? (
        <Field label="Ratified by referendum">
          <Phrase datum={view.index} />
        </Field>
      ) : (
        <>
          {view.referendum.kind === 'none-submitted' ? (
            <Notice severity="info" heading="No ratification referendum has been submitted yet">
              Anyone may submit one. After submission the proposer binds its exact index — the
              artifact hash was already committed when the proposal was submitted.
              <Button label="Submit the referendum" onClick={onSubmitReferendum} intent="primary" />
              <Button label="Bind an existing index" onClick={onBindIndex} />
            </Notice>
          ) : null}

          {view.referendum.kind === 'ongoing' ? (
            <Field label="Referendum">
              <Phrase datum={view.referendum.index} />
              <Count datum={view.referendum.ayes} name="ayes" />
              <Count datum={view.referendum.nays} name="nays" />
            </Field>
          ) : null}

          {view.referendum.kind === 'rejected' ? (
            <Notice severity="danger" heading="The ratification referendum was rejected">
              This proposal cannot be executed. The guard will record the rejection at the end
              of the execution window.
            </Notice>
          ) : null}

          {view.referendum.kind === 'approved-not-recorded' ? (
            <Notice severity="info" heading="Approved — the guard has not recorded it yet">
              The referendum passed. The guard reads its record at dispatch, so this is a
              matter of timing rather than a failure.
            </Notice>
          ) : null}

          {stillCompletable === false ? (
            <Notice severity="danger" heading="Ratification can no longer complete in time">
              {CANNOT_COMPLETE}
              <BlockRef datum={view.referendum.kind === 'ongoing' ? view.referendum.blocksStillNeeded : window.now} name="blocks it still needs" />
            </Notice>
          ) : null}
        </>
      )}
    </Panel>
  );
}

export { CANNOT_COMPLETE };
