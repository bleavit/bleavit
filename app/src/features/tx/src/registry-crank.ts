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

import { combine, type Combined, type Verified } from '@bleavit/shared-types';

/**
 * Whether `welfare.record_snapshot(epoch, spec_version)` would do anything.
 *
 * ## The record is keyed by **two** things, and the model carried one
 *
 * `Welfare.Snapshots` is keyed `(epoch, spec_version)` — 02 §13 froze it that way at v16 —
 * and the runtime's call is `record_snapshot(epoch, spec_version)`, which is also 05 §4.6's
 * name. This model took a bare `alreadyTaken: boolean`, so *"a snapshot exists for this
 * epoch"* stood in for *"a snapshot exists for this epoch at this MetricSpec version"*.
 *
 * Those differ whenever a second version is admissible, which is not an edge case: it is
 * exactly what happens across a MetricSpec amendment. A lawful record at the **active**
 * version — the one that advances `SnapshotDeadline` — was refused by this client because
 * some *other* version already had one for the epoch. A client refusing what the chain
 * accepts, on the crank whose overdue state engages the dead-man rule.
 *
 * So the version is carried, both in the state and in the copy: *already taken* has to say
 * *at which version*, or the operator cannot tell a genuine no-op from this defect.
 */
export type SnapshotCrankState =
  | {
      readonly kind: 'ready';
      readonly epoch: Verified<number>;
      readonly specVersion: Verified<number>;
    }
  | {
      /** The staleness precondition does not hold: signing would cost a fee and do nothing. */
      readonly kind: 'no-op';
      readonly epoch: Verified<number>;
      readonly specVersion: Verified<number>;
      readonly reason: 'boundary-not-passed' | 'already-taken';
    };

const NO_OP_COPY: Readonly<Record<'boundary-not-passed' | 'already-taken', string>> =
  Object.freeze({
    'boundary-not-passed':
      'The epoch boundary has not passed yet, so this snapshot cannot be taken. Signing now ' +
      'would pay a fee and change nothing.',
    'already-taken':
      'A snapshot already exists for this epoch at this MetricSpec version. Signing again ' +
      'would pay a fee and change nothing. A different admissible version would still need ' +
      'its own record — this refusal is about the pair, not about the epoch.',
  });

/**
 * Whether a record exists for **this** `(epoch, spec_version)` pair.
 *
 * A required argument rather than a lookup, because the map read belongs to the reader
 * layer. What matters here is that the caller cannot pass an epoch-only answer: the
 * signature demands the version, so the narrower question has nowhere to hide.
 */
export function snapshotCrankState(
  epoch: Verified<number>,
  specVersion: Verified<number>,
  boundaryPassed: boolean,
  takenAtThisVersion: boolean,
): SnapshotCrankState {
  if (!boundaryPassed) return { kind: 'no-op', epoch, specVersion, reason: 'boundary-not-passed' };
  if (takenAtThisVersion) return { kind: 'no-op', epoch, specVersion, reason: 'already-taken' };
  return { kind: 'ready', epoch, specVersion };
}

/** What a user is told before signing a crank that would do nothing. */
export function noOpWarning(state: SnapshotCrankState): string | undefined {
  return state.kind === 'no-op' ? NO_OP_COPY[state.reason] : undefined;
}

/**
 * Snapshot staleness — §11.8.5's *"shown prominently"*.
 *
 * > an overdue snapshot > 4 days engages the dead-man rule ([05](05))
 *
 * The threshold is a **required argument with no default**, the same discipline
 * `packages/protocol` follows for every tunable: baking `4 days` in would be a hardcoded
 * chain constant (app-code rule 7), and a governance amendment would silently leave the
 * client warning at the wrong point — late, in the direction that matters.
 *
 * Why this is not just a number on screen: an overdue snapshot is not a housekeeping item.
 * Past the threshold it **engages the dead-man rule**, which is a system-wide state change,
 * so the display carries the consequence rather than the count alone.
 */
export type SnapshotStaleness =
  | { readonly kind: 'current'; readonly blocksSince: number }
  | { readonly kind: 'overdue'; readonly blocksSince: number; readonly blocksOverBy: number }
  /** The dead-man rule is engaged by this snapshot's age — no longer a crank, an incident. */
  | { readonly kind: 'dead-man-engaged'; readonly blocksSince: number; readonly blocksOverBy: number };

export function snapshotStaleness(
  lastSnapshotAt: Verified<number>,
  now: Verified<number>,
  /** Blocks after which a snapshot is overdue. Read from chain params — never a literal. */
  overdueAfterBlocks: number,
  /** Blocks after which the dead-man rule engages (05). Read, never a literal. */
  deadManAfterBlocks: number,
): Combined<SnapshotStaleness> {
  const provenance = [lastSnapshotAt.status, now.status];
  const since = now.value - lastSnapshotAt.value;
  if (since >= deadManAfterBlocks) {
    return combine(
      { kind: 'dead-man-engaged', blocksSince: since, blocksOverBy: since - deadManAfterBlocks },
      provenance,
    );
  }
  if (since >= overdueAfterBlocks) {
    return combine(
      { kind: 'overdue', blocksSince: since, blocksOverBy: since - overdueAfterBlocks },
      provenance,
    );
  }
  return combine({ kind: 'current', blocksSince: since }, provenance);
}

const STALENESS_COPY: Readonly<Record<SnapshotStaleness['kind'], string>> = Object.freeze({
  current: 'The welfare snapshot is current.',
  overdue:
    'The welfare snapshot is overdue. Cranking it is permissionless — anyone may take it, ' +
    'and nobody is assigned to.',
  'dead-man-engaged':
    'The welfare snapshot is overdue by enough to engage the dead-man rule. This is a ' +
    'system-wide state, not a housekeeping item: the protocol has stopped treating its ' +
    'welfare readings as current, and cranking the snapshot is what clears it.',
});

export function stalenessCopy(staleness: SnapshotStaleness): string {
  return STALENESS_COPY[staleness.kind];
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
