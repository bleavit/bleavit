/**
 * The welfare snapshot crank and the incident/milestone registry — 11 §11.8.5–§11.8.6. F17.
 *
 * ## A crank that would be a no-op is not offered as if it would do something
 *
 * §11.8.5 and row P-15: a crank whose staleness precondition does not hold is *"no-op —
 * nothing to crank"*, and §11.5 adds **"never sign a guaranteed no-op without an explicit
 * expert override"**. So `snapshotCrankState` returns a union whose `no-op` arm is
 * distinct from `ready`, and the copy says the transaction would cost a fee and change
 * nothing — which is the part a user cannot see from a button that looks the same either
 * way.
 *
 * ## Registry sub-games hold *settlement*, never *decisions*
 *
 * §11.8.6's closing sentence, and the copy is required to state it. It matters because the
 * natural reading of "a challenge is open" is that governance is paused — and it is not.
 * A proposal's decision proceeds; only the settlement it feeds waits. Getting that
 * backwards would have someone believe an incident filing can stall a decision, which is
 * exactly the leverage the design withholds.
 *
 * ## The challenge window includes the watchtower extension, and its absence is not zero
 *
 * §11.8.6 requires the extension state *displayed*. `challengeWindow` therefore carries the
 * extension explicitly, and an **unread** extension makes the remaining time
 * indeterminate rather than defaulting to the base window — a countdown that quietly
 * ignores an extension tells a challenger they are out of time when they are not.
 */

import type { Verified } from '@bleavit/shared-types';

/** Whether `welfare.snapshot(epoch)` would do anything. */
export type SnapshotCrankState =
  | { readonly kind: 'ready'; readonly epoch: Verified<number> }
  | {
      /** The staleness precondition does not hold: signing would cost a fee and do nothing. */
      readonly kind: 'no-op';
      readonly epoch: Verified<number>;
      readonly reason: 'boundary-not-passed' | 'already-taken';
    };

const NO_OP_COPY: Readonly<Record<'boundary-not-passed' | 'already-taken', string>> =
  Object.freeze({
    'boundary-not-passed':
      'The epoch boundary has not passed yet, so this snapshot cannot be taken. Signing now ' +
      'would pay a fee and change nothing.',
    'already-taken':
      'This epoch’s snapshot has already been taken. Signing again would pay a fee and ' +
      'change nothing.',
  });

export function snapshotCrankState(
  epoch: Verified<number>,
  boundaryPassed: boolean,
  alreadyTaken: boolean,
): SnapshotCrankState {
  if (!boundaryPassed) return { kind: 'no-op', epoch, reason: 'boundary-not-passed' };
  if (alreadyTaken) return { kind: 'no-op', epoch, reason: 'already-taken' };
  return { kind: 'ready', epoch };
}

/** What a user is told before signing a crank that would do nothing. */
export function noOpWarning(state: SnapshotCrankState): string | undefined {
  return state.kind === 'no-op' ? NO_OP_COPY[state.reason] : undefined;
}

/**
 * §11.8.6's required statement. Fixed copy, because the natural reading is the wrong one.
 */
export const REGISTRY_HOLDS_SETTLEMENT =
  'A registry challenge holds the settlement that depends on this filing. It does not pause ' +
  'a governance decision, extend a market, or delay an execution — those proceed on their ' +
  'own clocks. Filing or challenging here cannot stall a decision.';

/** The challenge window, with the watchtower extension stated rather than folded in. */
export type ChallengeWindow =
  | { readonly kind: 'open'; readonly closesAt: Verified<number>; readonly extended: boolean }
  | { readonly kind: 'closed'; readonly closedAt: Verified<number> }
  | {
      /**
       * The extension state could not be read, so the deadline is unknown.
       *
       * Deliberately not "assume the base window": a countdown that ignores an extension
       * tells a challenger they are out of time when they are not, which loses them the
       * window the extension exists to grant.
       */
      readonly kind: 'indeterminate';
      readonly reason: string;
    };

export function mayChallenge(window: ChallengeWindow): boolean {
  return window.kind === 'open';
}

export function challengeWindowCopy(window: ChallengeWindow): string {
  switch (window.kind) {
    case 'open':
      return window.extended
        ? 'The challenge window is open and has been extended by watchtower quorum.'
        : 'The challenge window is open.';
    case 'closed':
      return 'The challenge window has closed. This filing can no longer be challenged.';
    case 'indeterminate':
      return (
        `The watchtower extension state could not be read (${window.reason}), so this ` +
        'client cannot say when the window closes. It is not assuming the base window — a ' +
        'countdown that ignored an extension would tell you that you are out of time when ' +
        'you are not.'
      );
  }
}
