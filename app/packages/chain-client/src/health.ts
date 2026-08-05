/**
 * The peer watch — what drives 10 §3.1's `SyncDegraded`.
 *
 * `boot.ts` declares `peers-lost` and `peer-acquired`, and until this module nothing in
 * the app emitted either. So `SyncDegraded` was **unreachable**: the state 10 §3.1 added
 * because *"the most common real-world failure (cannot reach peers on first load)"* was
 * stateless stayed stateless, and no green run said otherwise — the same shape as an
 * error code with no emitting call site.
 *
 * Pure, like `boot.ts` and for the same reason: no chain, no timers, no clock of its own.
 * The conditions this exists for only occur when something is broken, so they have to be
 * testable with nothing running. Time enters as an argument.
 *
 * **The distinction the whole module is built around: absence is not zero.** 10 §3.1
 * (SQ-597) requires that a peer count the client could not obtain is never read as *no
 * peers*, because the peer reading comes from a legacy JSON-RPC method reached through an
 * escape hatch both vendors mark unstable (V-137). Believing a broken reader would send
 * the user to a peer-diagnostics panel for a fault that is not theirs, at the moment the
 * client is otherwise healthy. So `indeterminate` is its own arm, it does not advance the
 * degradation clock, and the fallback for it is the weaker spec-compliant observable —
 * stalled `chainHead` follow progress — reported under a diagnosis that says so.
 */

import type { BootEvent } from './boot.js';

/**
 * What a single peer reading can be. Four arms, because collapsing any pair loses a
 * distinction the panel has to draw:
 *
 * - `peers` — at least one peer. The healthy case.
 * - `no-peers` — zero peers on a chain that expects them. **The only arm that degrades.**
 * - `no-peers-expected` — zero peers on a chain reporting `shouldHavePeers: false`. A
 *   successful read of a non-fault; degrading on it would be wrong.
 * - `indeterminate` — the count could not be read at all. Not a fault of the chain, and
 *   explicitly not zero.
 */
export type PeerReading =
  | { readonly kind: 'peers'; readonly count: number }
  | { readonly kind: 'no-peers' }
  | { readonly kind: 'no-peers-expected' }
  | { readonly kind: 'indeterminate'; readonly reason: string };

/**
 * Map a `system_health` reply to a reading, fail-closed.
 *
 * Every malformed shape lands on `indeterminate`, never on `no-peers` — a reply with
 * `peers` missing, non-numeric, negative or fractional says nothing about connectivity,
 * and the one reading that must never be manufactured is the one that degrades.
 *
 * The reply is `unknown` on purpose: it arrives from an escape hatch typed `any`, so a
 * declared interface here would be a claim about a payload nobody validates.
 */
export function readingFromHealth(reply: unknown): PeerReading {
  if (typeof reply !== 'object' || reply === null) {
    return { kind: 'indeterminate', reason: 'system_health did not return an object' };
  }
  const { peers, shouldHavePeers } = reply as { peers?: unknown; shouldHavePeers?: unknown };
  if (typeof peers !== 'number' || !Number.isInteger(peers) || peers < 0) {
    return { kind: 'indeterminate', reason: 'system_health returned no usable peer count' };
  }
  if (peers > 0) return { kind: 'peers', count: peers };
  // Zero peers. Whether that is a fault depends on a field that may be absent, and an
  // absent one must not be read as `true` — assuming the chain expects peers would turn
  // a legitimate no-peer chain into a permanent degradation.
  if (typeof shouldHavePeers !== 'boolean') {
    return { kind: 'indeterminate', reason: 'system_health reported 0 peers without shouldHavePeers' };
  }
  return shouldHavePeers ? { kind: 'no-peers' } : { kind: 'no-peers-expected' };
}

/** Why the watch believes the client is degraded — what the §3.1 panel labels itself. */
export type PeerDiagnosis = 'no-peers' | 'indeterminate';

export interface PeerWatchInput {
  readonly peers: PeerReading;
  /**
   * When `chainHead` follow last made progress, on the same clock as `nowMs`, or
   * `undefined` if it never has. Only consulted while the peer count is
   * `indeterminate`; it cannot tell *no peers* from *a stalled chain*, which is exactly
   * why it is the fallback and not the primary.
   */
  readonly lastFollowProgressMs: number | undefined;
}

export interface PeerWatch {
  /** Feed one observation; get the boot events it implies (usually none). */
  observe(input: PeerWatchInput, nowMs: number): readonly BootEvent[];
  /** The current diagnosis while degraded, for the §3.1 panel. `undefined` when healthy. */
  diagnosis(): PeerDiagnosis | undefined;
}

/**
 * @param thresholdMs how long the condition must hold before degrading. **Required**:
 * 10 §3.1 gives the relay 60 s and the parachain 30 s, so a default here would silently
 * apply one domain's rule to the other, and both are spec text that can move.
 */
export function createPeerWatch(thresholdMs: number): PeerWatch {
  if (!Number.isFinite(thresholdMs) || thresholdMs < 0) {
    throw new RangeError('peer-watch threshold must be a non-negative finite duration');
  }

  let since: number | undefined; //     when the current degrading condition began
  let cause: PeerDiagnosis | undefined; // what began it
  let lost = false; //                  whether `peers-lost` has been emitted
  let lastNow = -Infinity;

  const clear = (): void => {
    since = undefined;
    cause = undefined;
  };

  return {
    observe(input, nowMs) {
      // A clock that went backwards must not manufacture a long elapsed time. Hold the
      // observation rather than acting on arithmetic that cannot be right.
      if (!Number.isFinite(nowMs) || nowMs < lastNow) return [];
      lastNow = nowMs;

      const { peers, lastFollowProgressMs } = input;

      if (peers.kind === 'peers') {
        clear();
        if (lost) {
          lost = false;
          return [{ type: 'peer-acquired' }];
        }
        return [];
      }

      // A successful read of a chain that is not supposed to have peers is not a fault,
      // and `indeterminate` with no fallback signal is not evidence of one either. Both
      // FREEZE: they neither start the clock nor clear a run already in progress, so a
      // reader that breaks mid-outage cannot resolve the outage by going quiet.
      if (peers.kind === 'no-peers-expected') return [];

      let condition: PeerDiagnosis;
      if (peers.kind === 'no-peers') {
        condition = 'no-peers';
      } else if (lastFollowProgressMs !== undefined && nowMs - lastFollowProgressMs >= thresholdMs) {
        // The peer count is unreadable and follow has not progressed for the window.
        // Degrade, but say the diagnosis is indeterminate — this cannot distinguish
        // "nobody to talk to" from "a chain that stopped".
        condition = 'indeterminate';
      } else {
        return [];
      }

      // A change of cause restarts the clock: the two conditions are different faults and
      // carrying elapsed time across would report one as having held longer than it has.
      if (since === undefined || cause !== condition) {
        since = nowMs;
        cause = condition;
        return [];
      }
      if (nowMs - since < thresholdMs || lost) return [];
      lost = true;
      return [{ type: 'peers-lost' }];
    },

    diagnosis() {
      return lost ? cause : undefined;
    },
  };
}
