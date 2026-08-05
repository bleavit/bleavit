/**
 * Treasury streams and the NAV view — 11 §11.8.3. F17.
 *
 * ## `INSURANCE` is a sized reserve, and the screen must not let it read as income
 *
 * E1 made this normative: *"A rising `INSURANCE` balance is no longer a signal of protocol
 * income, and never was a complete one."* Revenue routes **100 % to `MAIN`**, and
 * `INSURANCE` has a derived target above which it **overflows to `MAIN` automatically**.
 *
 * The failure that invites is a screen showing `INSURANCE` climbing and a reader concluding
 * the protocol is earning. So `insuranceStanding` returns a **classification against the
 * target**, not a bare number, and the copy says what the balance means in each case. A
 * component handed the raw field could render a trend line; one handed *"at target"* or
 * *"below its target by X"* cannot.
 *
 * ## Claimable is computed client-side, so it is computed carefully
 *
 * §11.8.3's precondition is *"claimable amount (linear vesting, computed client-side from
 * stream fields at B′) > 0 and displayed"*. Integer arithmetic on `bigint` throughout —
 * the same discipline `packages/protocol` follows — because a stream's last unit is
 * somebody's money and a float would round it away.
 *
 * A stream **before its start** and a stream **fully claimed** both yield zero, and they are
 * *different* states: one is "not yet", the other is "nothing left". `claimableNow` returns
 * the amount and the reason, so a screen can say which.
 *
 * ## The screen reads `NavView` and nothing else
 *
 * Cumulative fee income lives on the monitoring-only `TelemetryApi`, outside the 02
 * contract, and the canonical client does not consume it. There is no field for it here,
 * which is the enforceable form of that sentence.
 */

import type { Verified } from '@bleavit/shared-types';

export interface Stream {
  readonly id: Verified<string>;
  readonly recipient: Verified<string>;
  readonly total: Verified<bigint>;
  readonly claimed: Verified<bigint>;
  readonly startBlock: Verified<number>;
  readonly endBlock: Verified<number>;
  readonly cancelled: Verified<boolean>;
}

export type ClaimableReason =
  | 'claimable'
  | 'not-started'
  | 'fully-claimed'
  | 'cancelled'
  /** `end <= start` is not a stream, and vesting it would divide by zero. */
  | 'malformed';

export interface Claimable {
  readonly amount: bigint;
  readonly reason: ClaimableReason;
}

/**
 * Linear vesting to `now`, in integer arithmetic.
 *
 * `floor` throughout and against the claimant, per R-7's rounding rule: a recipient is
 * never credited a unit the schedule has not yet released.
 */
export function claimableNow(stream: Stream, now: Verified<number>): Claimable {
  if (stream.cancelled.value) return { amount: 0n, reason: 'cancelled' };
  if (stream.endBlock.value <= stream.startBlock.value) {
    // Not a schedule. Returning zero with a *reason* beats dividing by zero, and beats
    // returning the whole total, which is what a "treat it as instant" reading would do.
    return { amount: 0n, reason: 'malformed' };
  }
  if (now.value <= stream.startBlock.value) return { amount: 0n, reason: 'not-started' };

  const elapsed = BigInt(Math.min(now.value, stream.endBlock.value) - stream.startBlock.value);
  const span = BigInt(stream.endBlock.value - stream.startBlock.value);
  const vested = (stream.total.value * elapsed) / span; // floors — against the claimant
  const claimable = vested - stream.claimed.value;
  if (claimable <= 0n) {
    // Distinguished from `not-started`: one is "not yet", the other is "nothing left", and
    // a screen showing a bare zero for both tells a recipient the wrong thing to do.
    return { amount: 0n, reason: 'fully-claimed' };
  }
  return { amount: claimable, reason: 'claimable' };
}

export interface ClaimContext {
  readonly stream: Stream;
  readonly callerIsRecipient: boolean;
  readonly now: Verified<number>;
}

export interface TreasuryBlock {
  readonly check: string;
  readonly detail: string;
}

const CLAIM_REASON_COPY: Readonly<Record<Exclude<ClaimableReason, 'claimable'>, string>> =
  Object.freeze({
    cancelled: 'This stream was cancelled, so nothing further vests from it.',
    malformed:
      'This stream’s end block is not after its start block, so no vesting schedule can be ' +
      'derived from it. Nothing is claimable, and this is chain state worth reporting.',
    'not-started': 'This stream has not started vesting yet.',
    'fully-claimed': 'Everything vested so far has already been claimed.',
  });

export function claimBlocks(context: ClaimContext): readonly TreasuryBlock[] {
  const blocks: TreasuryBlock[] = [];
  if (!context.callerIsRecipient) {
    blocks.push({
      check: 'Recipient',
      detail: 'Only the stream’s recipient may claim from it.',
    });
  }
  const claimable = claimableNow(context.stream, context.now);
  if (claimable.reason !== 'claimable') {
    blocks.push({ check: 'Claimable amount', detail: CLAIM_REASON_COPY[claimable.reason] });
  }
  return blocks;
}

/** Where `INSURANCE` stands against its derived target — never a bare balance. */
export type InsuranceStanding =
  | { readonly kind: 'at-target' }
  | { readonly kind: 'below-target'; readonly shortfall: bigint }
  /**
   * Above target between the overflow sweeps. Not a surplus, and not income: the excess
   * moves to `MAIN` automatically, so this is a transient rather than a trend.
   */
  | { readonly kind: 'awaiting-overflow'; readonly excess: bigint };

export function insuranceStanding(
  balance: Verified<bigint>,
  target: Verified<bigint>,
): InsuranceStanding {
  if (balance.value === target.value) return { kind: 'at-target' };
  if (balance.value < target.value) {
    return { kind: 'below-target', shortfall: target.value - balance.value };
  }
  return { kind: 'awaiting-overflow', excess: balance.value - target.value };
}

/** In-bundle copy per standing. The `awaiting-overflow` one is the load-bearing sentence. */
export function insuranceCopy(standing: InsuranceStanding): string {
  switch (standing.kind) {
    case 'at-target':
      return 'INSURANCE holds exactly the liability it backs. This is its normal state.';
    case 'below-target':
      return (
        'INSURANCE is below the liability it backs. It refills from the same sweeps that ' +
        'created the liability; it is not funded from revenue.'
      );
    case 'awaiting-overflow':
      return (
        'INSURANCE is above its target and the excess moves to MAIN automatically. This is ' +
        'not protocol income and not a surplus — protocol revenue routes entirely to MAIN, ' +
        'and this balance is a sized reserve rather than an earnings figure.'
      );
  }
}
