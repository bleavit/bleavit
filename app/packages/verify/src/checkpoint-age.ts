/**
 * The long-range bound on a release's warp-sync checkpoint — 10 §2.4 (FE-P8).
 *
 * The relay light client warp-syncs from a checkpoint compiled into the release, and that
 * checkpoint is the root of everything the client later calls `verified-finalized`. Its
 * trustworthiness expires: validators in the authority set at the checkpoint's era who
 * later withdraw their stake can sign an alternative finalized chain from that point at no
 * cost, and a client starting from a stale checkpoint cannot tell the two apart.
 *
 * ## Three things here are easy to get backwards
 *
 * 1. **This is refusal, not degradation.** Past the bound, `verified-finalized` is not
 *    *weaker*, it is *false*. So the verdict is `expired` and it is deliberately not
 *    `restricted` or `read-only-incompatible` — those describe a runtime whose surface is
 *    partly unknown, i.e. the same chain further along. This describes a client that cannot
 *    establish which chain it is on.
 * 2. **The age is measured against the device clock.** That clock is untrusted, and it is
 *    the right input anyway: it is *independent of the attacker's chain*. Asking the sync
 *    how old its own checkpoint is asks the possibly-forged chain to certify itself.
 * 3. **A clock behind the checkpoint refuses.** Treating it as an age of zero would let the
 *    cheapest possible attack on this control — set the clock back — disable it silently.
 *    A device clock in the past is a fact about the device, and it means the age cannot be
 *    established rather than that it is small.
 */

/** The relay constants this bound derives from, carried in the signed release document. */
export interface LongRangeBound {
  /** `BondingDuration` in eras — 28 on both Polkadot and Paseo (verified 2026-08-05). */
  readonly bondingDurationEras: number;
  /** `SlashDeferDuration` in eras — 27 on both. */
  readonly slashDeferDurationEras: number;
  /** Era length in milliseconds. 6 sessions × 4 h = 24 h on both. */
  readonly eraMillis: number;
}

export type CheckpointAgeVerdict =
  | { readonly kind: 'fresh'; readonly ageMillis: number }
  /** Past `SlashDeferDuration`: the deterrent has lapsed, the stake has not. */
  | { readonly kind: 'warn'; readonly ageMillis: number; readonly message: string }
  /** Past `BondingDuration`: no value may be presented as `verified-finalized`. */
  | { readonly kind: 'expired'; readonly ageMillis: number; readonly message: string }
  /** The age could not be established. Same consequence as `expired`, different reason. */
  | { readonly kind: 'indeterminate'; readonly message: string };

const DAY_MILLIS = 24 * 60 * 60 * 1000;

function days(millis: number): string {
  return `${Math.floor(millis / DAY_MILLIS)} days`;
}

/**
 * Classify a release's checkpoint age.
 *
 * `checkpointMillis` and `nowMillis` are both arguments: the first comes from the signed
 * release document, the second from the caller's clock. Passing the clock in rather than
 * reading it here is what makes every branch reachable in a test without touching time —
 * and a control whose dangerous branches cannot be tested is the shape this repository
 * keeps finding.
 */
export function classifyCheckpointAge(
  checkpointMillis: number,
  nowMillis: number,
  bound: LongRangeBound,
): CheckpointAgeVerdict {
  for (const [name, value] of [
    ['checkpointMillis', checkpointMillis],
    ['nowMillis', nowMillis],
    ['bondingDurationEras', bound.bondingDurationEras],
    ['slashDeferDurationEras', bound.slashDeferDurationEras],
    ['eraMillis', bound.eraMillis],
  ] as const) {
    if (!Number.isFinite(value)) {
      return {
        kind: 'indeterminate',
        message: `${name} is not a finite number, so the checkpoint's age cannot be established.`,
      };
    }
  }
  if (bound.eraMillis <= 0 || bound.bondingDurationEras <= 0) {
    return {
      kind: 'indeterminate',
      message: 'the release document carries a non-positive era length or bonding duration.',
    };
  }
  // The bound must be the outer one. A document claiming a slash-defer longer than the
  // bonding duration describes a chain where the deterrent outlives the stake, which is
  // not a chain this reasoning applies to.
  if (bound.slashDeferDurationEras > bound.bondingDurationEras) {
    return {
      kind: 'indeterminate',
      message:
        'the release document claims a slash-defer duration longer than the bonding duration, ' +
        'which does not describe a chain this bound reasons about.',
    };
  }

  const ageMillis = nowMillis - checkpointMillis;
  if (ageMillis < 0) {
    return {
      kind: 'indeterminate',
      message:
        'this device’s clock is set earlier than the release’s checkpoint. The checkpoint’s ' +
        'age cannot be established, and a clock set to the past is exactly how this check ' +
        'would be disabled — so it refuses rather than reading the age as zero. Correct the ' +
        'device clock.',
    };
  }

  const expireAt = bound.bondingDurationEras * bound.eraMillis;
  const warnAt = bound.slashDeferDurationEras * bound.eraMillis;

  if (ageMillis >= expireAt) {
    return {
      kind: 'expired',
      ageMillis,
      message:
        `This release’s sync checkpoint is ${days(ageMillis)} old, past the relay’s ` +
        `${bound.bondingDurationEras}-era bonding duration. The validators it trusts may have ` +
        'withdrawn their stake, so nothing read through it can be presented as verified. ' +
        'Obtain a newer release.',
    };
  }
  if (ageMillis >= warnAt) {
    return {
      kind: 'warn',
      ageMillis,
      message:
        `This release’s sync checkpoint is ${days(ageMillis)} old, past the relay’s ` +
        `${bound.slashDeferDurationEras}-era slash-deferral window. Reads are still verified, ` +
        'but the penalty that deters a long-range attack from this checkpoint may no longer ' +
        'apply. Obtain a newer release.',
    };
  }
  return { kind: 'fresh', ageMillis };
}

/**
 * Whether the client may present values as `verified-finalized` at all.
 *
 * `indeterminate` sits with `expired`, not with `fresh`: an age that could not be
 * established is not evidence of freshness, and putting "unknown" on the passing side is
 * the fail-open reading that `chainIdentityVerified` was renamed to avoid.
 */
export function mayClaimVerified(verdict: CheckpointAgeVerdict): boolean {
  return verdict.kind === 'fresh' || verdict.kind === 'warn';
}
