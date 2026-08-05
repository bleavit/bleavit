/**
 * Conviction, and the lock a vote imposes — 11 §11.7.1's Vote row. F16.
 *
 * ## The lock must be *computed* and *disclosed* before a signature exists
 *
 * §11.7.1: *"conviction 1×–6× with the resulting lock duration … displayed **before**
 * signing"*, and §11.7.6 repeats it as a required-UX statement. 11 §11.2 constraint 3 then
 * names `conviction-vote-lock` among the five facts that may not sit behind a disclosure
 * step.
 *
 * A comment cannot carry that. `LockDisclosed` is a branded type whose only producer is
 * `discloseLock`, and `VoteForSigning` requires one — so a vote that reached a signer
 * without its lock having been computed **does not typecheck**. This is the same device
 * `GatePassed` uses on the transaction path, for the same reason: the failure it prevents
 * is silent, and a user who signs a 6× vote without seeing the lock finds out 32 enactment
 * periods later.
 *
 * ## The multipliers are verified, not assumed
 *
 * `Conviction::lock_periods()` in `polkadot-sdk` at the pinned `polkadot-stable2606`:
 * `None → 0`, `1x → 1`, `2x → 2`, `3x → 4`, `4x → 8`, `5x → 16`, `6x → 32`. Read from the
 * SDK source rather than inferred from the doubling pattern, because the pattern *looks*
 * like it starts at 1 and the values are what a user's tokens are locked by. They are wire
 * format — an SDK enum, like a call index — not a tunable, so they are compiled in; the
 * *enactment period* they multiply is chain state and is therefore an argument with no
 * default (app-code rule 7).
 *
 * ## `None` is a real conviction, not the absence of one
 *
 * `Conviction::None` votes with 10 % weight and **no lock at all**. Modelling it as
 * "conviction not chosen" would either hide a legitimate option or, worse, let an unset
 * field mean it — and an unset field that silently means *no lock* is the same shape as a
 * disabled control with no reason.
 */

/** The seven `Conviction` variants, named as the SDK names them. */
export type Conviction =
  | 'None'
  | 'Locked1x'
  | 'Locked2x'
  | 'Locked3x'
  | 'Locked4x'
  | 'Locked5x'
  | 'Locked6x';

/**
 * `lock_periods()` — verified 2026-08-05 against `polkadot-sdk@polkadot-stable2606`,
 * `substrate/frame/conviction-voting/src/conviction.rs`.
 */
const LOCK_PERIODS: Readonly<Record<Conviction, number>> = Object.freeze({
  None: 0,
  Locked1x: 1,
  Locked2x: 2,
  Locked3x: 4,
  Locked4x: 8,
  Locked5x: 16,
  Locked6x: 32,
});

/** Vote weight multiplier: `None` votes at 10 %, the rest at their face multiplier. */
const VOTE_WEIGHT_TENTHS: Readonly<Record<Conviction, number>> = Object.freeze({
  None: 1,
  Locked1x: 10,
  Locked2x: 20,
  Locked3x: 30,
  Locked4x: 40,
  Locked5x: 50,
  Locked6x: 60,
});

export const CONVICTIONS: readonly Conviction[] = Object.freeze(
  Object.keys(LOCK_PERIODS) as Conviction[],
);

export function lockPeriods(conviction: Conviction): number {
  return LOCK_PERIODS[conviction];
}

declare const LOCK_DISCLOSED: unique symbol;

/**
 * Proof that the lock was computed and shown.
 *
 * Branded, and the symbol is not exported — `discloseLock` is the only producer. Without
 * it, an object literal of the right shape would satisfy `VoteForSigning` and the
 * "displayed before signing" rule would be a claim about the code rather than a property
 * of it.
 */
export interface LockDisclosed {
  readonly conviction: Conviction;
  /** Blocks the tokens stay locked after the vote ends. Zero only for `None`. */
  readonly lockBlocks: number;
  /** The block the lock is expected to lift at, given the vote ends now. */
  readonly unlocksAtEarliest: number;
  /** Tenths of the balance this vote weighs — `None` is 1 (10 %). */
  readonly weightTenths: number;
  readonly [LOCK_DISCLOSED]: true;
}

/**
 * Compute the lock a conviction imposes.
 *
 * `enactmentPeriodBlocks` has no default: it is chain state (the track's enactment period),
 * and a default here would be a launch value baked into the client — app-code rule 7. A
 * caller that forgets it gets a type error rather than a wrong lock.
 */
export function discloseLock(
  conviction: Conviction,
  enactmentPeriodBlocks: number,
  votingEndsAtBlock: number,
): LockDisclosed {
  if (!Number.isInteger(enactmentPeriodBlocks) || enactmentPeriodBlocks < 0) {
    throw new RangeError(
      `enactmentPeriodBlocks must be a non-negative integer, got ${enactmentPeriodBlocks}`,
    );
  }
  if (!Number.isInteger(votingEndsAtBlock) || votingEndsAtBlock < 0) {
    throw new RangeError(`votingEndsAtBlock must be a non-negative integer, got ${votingEndsAtBlock}`);
  }
  const lockBlocks = LOCK_PERIODS[conviction] * enactmentPeriodBlocks;
  // The phantom brand is never materialised — writing it as a computed key throws at
  // runtime, which is how `DecodedCall` first failed. One assertion, one mint site.
  return {
    conviction,
    lockBlocks,
    unlocksAtEarliest: votingEndsAtBlock + lockBlocks,
    weightTenths: VOTE_WEIGHT_TENTHS[conviction],
  } as LockDisclosed;
}

/** AYE/NAY/abstain and the split forms — 11 §11.7.1's Vote row. */
export type VoteIntent =
  | { readonly kind: 'standard'; readonly aye: boolean; readonly balance: bigint }
  | { readonly kind: 'split'; readonly aye: bigint; readonly nay: bigint }
  | {
      readonly kind: 'split-abstain';
      readonly aye: bigint;
      readonly nay: bigint;
      readonly abstain: bigint;
    };

/**
 * A vote ready to be prepared for signature.
 *
 * The `lock` field is what makes §11.7.1's rule structural: there is no way to build one
 * without having computed the lock, and `LockDisclosed` cannot be forged from outside this
 * module.
 *
 * **Only a `standard` vote carries a conviction**, which is `pallet-conviction-voting`'s
 * own shape: `Split` and `SplitAbstain` have no conviction field and impose no lock. So a
 * split vote's `lock` is the `None` disclosure — computed, not omitted, because omitting it
 * would make "no lock" indistinguishable from "not yet worked out".
 */
export interface VoteForSigning {
  readonly poll: bigint;
  readonly intent: VoteIntent;
  readonly lock: LockDisclosed;
}

/**
 * Whether a conviction may be attached to this vote shape.
 *
 * Exposed so a form can disable the conviction control **with a reason** rather than
 * silently ignoring it — a split vote that appeared to accept a 6× conviction would tell
 * the user their tokens are locked when they are not, and the reverse of that mistake is
 * the one that matters: it would also tell them their vote weighs 6×, when it does not.
 */
export function acceptsConviction(intent: VoteIntent): boolean {
  return intent.kind === 'standard';
}
