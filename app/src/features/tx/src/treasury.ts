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
 * ## Claimable is **read**, not computed (contract v29)
 *
 * §11.8.3 used to say *"claimable amount (linear vesting, computed client-side from stream
 * fields at B′)"* over *"stream storage per 02"* — and 02 froze no `pallet-futarchy-treasury`
 * storage at all, while §7.6's closing rule required every treasury consumer to bind `nav()`,
 * which publishes only the `stream_remainders` aggregate. So the console's central read was
 * unbuildable and this tier shipped closed under SQ-601.
 *
 * `FutarchyApi.treasury_streams(caller)` answers it, and it needed **no exception** to §7.6:
 * that rule forbids binding *raw storage*, and a published runtime-API projection is not raw
 * storage — `nav()` is itself one. The row therefore keeps 11 §11.4 rule 2's exact-chain-read
 * property, which an exception would have given up.
 *
 * The vesting arithmetic is gone rather than kept as a cross-check. It floors **against the
 * claimant** (08 §1.4), and a client rounding the other way would show a payout the chain
 * will not make; the chain computes the figure from the same function `claim_stream` pays
 * from, so a second implementation here would be a second answer about somebody's money.
 *
 * What survives is the *classification*. Zero has three causes — cancelled, not started,
 * fully claimed — and a screen showing a bare zero for all three tells a recipient the wrong
 * thing to do. `claimableNow` still returns an amount **and a reason**; it now derives the
 * reason from the published fields instead of deriving the amount.
 *
 * The figure is monotone to inclusion: vesting never decreases and `claimed` moves only on a
 * claim, so a displayed amount can only understate what a later claim pays. Cancellation is
 * the one discontinuity, and it is a B′ re-read.
 *
 * ## The screen reads `NavView` and nothing else
 *
 * Cumulative fee income lives on the monitoring-only `TelemetryApi`, outside the 02
 * contract, and the canonical client does not consume it. There is no field for it here,
 * which is the enforceable form of that sentence.
 */

import { combine, combine2, type Combined, type Verified } from '@bleavit/shared-types';

/**
 * 02 §4's `StreamView`, as the client holds it (contract v29).
 *
 * `duration` rather than an end block, and `claimableNow` rather than a derived amount:
 * both are the published fields. A projection that renamed or recomputed either would be
 * the client re-deriving what the chain answered.
 */
export interface Stream {
  readonly id: Verified<string>;
  readonly total: Verified<bigint>;
  readonly claimed: Verified<bigint>;
  readonly startBlock: Verified<number>;
  readonly duration: Verified<number>;
  readonly cancelled: Verified<boolean>;
  /** The chain's own answer: exactly what `claim_stream` would pay at the block it was read. */
  readonly claimableNow: Verified<bigint>;
}

export type ClaimableReason =
  | 'claimable'
  | 'not-started'
  | 'fully-claimed'
  | 'cancelled'
  /**
   * A zero-length schedule. Retained after contract v29 moved the arithmetic on chain,
   * because the *reason* is still a client classification and this one is real chain state
   * worth reporting rather than a division the client no longer performs.
   */
  | 'malformed';

export interface Claimable {
  readonly amount: bigint;
  readonly reason: ClaimableReason;
}

/**
 * Which of the four states this stream is in, and the amount the chain says is claimable.
 *
 * ## The amount is the chain's; only the classification is ours
 *
 * `StreamView.claimable_now` is what `claim_stream` would pay, computed by the runtime from
 * the same function the call pays from (02 §4). This function does **no** vesting arithmetic:
 * it reports that amount and says which of the four reasons applies, so a screen can tell
 * *not yet* from *nothing left* from *cancelled*.
 *
 * ## It still carries combined provenance, and for the same reason
 *
 * The classification reads `claimableNow`, `cancelled`, `startBlock`, `duration` and `now`.
 * Returning a bare value left every call site to pick a status, and both picked one input's
 * — rendering a figure with a **verified** badge when another input came from a provider, and
 * asserting something true of no single block when they were read at different ones. That is
 * INV-FE-1 reached by combination, which `check-render-provenance`'s rule B exists to catch.
 */
export function claimableNow(stream: Stream, now: Verified<number>): Combined<Claimable> {
  const provenance = [
    stream.claimableNow.status,
    stream.claimed.status,
    stream.startBlock.status,
    stream.duration.status,
    stream.cancelled.status,
    now.status,
  ];
  const claimable = (value: Claimable) => combine(value, provenance);

  if (stream.cancelled.value) return claimable({ amount: 0n, reason: 'cancelled' });
  if (stream.duration.value <= 0) {
    // Not a schedule. The chain's own `vested_amount` divides by `duration`, so a zero here
    // is state worth surfacing rather than a number to render.
    return claimable({ amount: 0n, reason: 'malformed' });
  }
  if (now.value <= stream.startBlock.value) return claimable({ amount: 0n, reason: 'not-started' });
  if (stream.claimableNow.value <= 0n) {
    // Distinguished from `not-started`: one is "not yet", the other is "nothing left", and
    // a screen showing a bare zero for both tells a recipient the wrong thing to do.
    return claimable({ amount: 0n, reason: 'fully-claimed' });
  }
  return claimable({ amount: stream.claimableNow.value, reason: 'claimable' });
}

/**
 * 02 §4's required disclosure for a claimable figure.
 *
 * It is a **lower** bound at inclusion rather than an estimate either way, and saying so is
 * the difference between a recipient who retries and one who reports a discrepancy.
 */
export const CLAIMABLE_IS_A_LOWER_BOUND =
  'This is what the chain would pay at the block shown. Vesting only moves forward, so a ' +
  'claim included later pays at least this much — never less, unless the stream is cancelled ' +
  'in between, which is re-checked before you sign.';

export interface ClaimContext {
  readonly stream: Stream;
  /**
   * `NavView.streamClaimsWired` — whether this runtime can pay a claim at all.
   *
   * Required rather than optional, and checked **before** the stream's own state: an
   * unwired runtime refuses every claim with `OutflowCustodyUnwired` (08 §1.4's A9
   * follow-up), so a control opened on `claimableNow` alone is refused after the
   * signature every single time. An optional field would default to *"assume it works"*,
   * which is the fail-open direction on a control this section exists to make safe.
   */
  readonly streamClaimsWired: Verified<boolean>;
  /**
   * Whether this stream came from **this caller's** `treasury_streams(who)` answer.
   *
   * The projection is per caller, so presence in it *is* the exists-and-is-yours check
   * (11 §11.8.3). It stays an explicit field rather than an assumption because a screen can
   * hold a stream from a stale reader or from another account's panel, and "I read it from
   * the right call" is precisely the claim that must not be implicit.
   */
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
      'This stream’s vesting duration is not positive, so no vesting schedule can be ' +
      'derived from it. Nothing is claimable, and this is chain state worth reporting.',
    'not-started': 'This stream has not started vesting yet.',
    'fully-claimed': 'Everything vested so far has already been claimed.',
  });

/**
 * The refusal an unwired runtime earns, in words that name the runtime.
 *
 * Deliberately not phrased as a problem with the stream: the entitlement is real, it is
 * vesting, and nothing about it is wrong. What is missing is the treasury's payout leg.
 */
export const STREAM_CLAIMS_NOT_WIRED =
  'This runtime cannot pay a stream claim yet: the treasury’s real-asset payout leg is ' +
  'not wired, so every claim is refused on chain rather than moving funds. Your ' +
  'entitlement is unaffected and keeps vesting — the amount shown is what will be ' +
  'claimable once the payout leg lands.';

export function claimBlocks(context: ClaimContext): readonly TreasuryBlock[] {
  const blocks: TreasuryBlock[] = [];
  // First, because it is the refusal that applies to every stream at once. Reporting a
  // per-stream reason on a runtime that can pay none of them tells a recipient to fix
  // something about their stream, which is the wrong instruction.
  if (!context.streamClaimsWired.value) {
    blocks.push({ check: 'Payout leg', detail: STREAM_CLAIMS_NOT_WIRED });
  }
  if (!context.callerIsRecipient) {
    blocks.push({
      check: 'Recipient',
      detail: 'Only the stream’s recipient may claim from it.',
    });
  }
  const claimable = claimableNow(context.stream, context.now);
  if (claimable.kind === 'incomparable') {
    // Fail-closed on money: a claim offered against a figure this client cannot establish
    // would show the recipient a number true of no block, about their own funds.
    blocks.push({
      check: 'Claimable amount',
      detail:
        `This client cannot establish what is claimable. ${claimable.reason} Until it can, ` +
        'the claim is not offered.',
    });
  } else if (claimable.datum.value.reason !== 'claimable') {
    blocks.push({
      check: 'Claimable amount',
      detail: CLAIM_REASON_COPY[claimable.datum.value.reason],
    });
  }
  return blocks;
}

/**
 * `T_ins`, or the statement that it could not be obtained.
 *
 * ## The target is published as `NavView.insurance_target` (contract v29, SQ-602)
 *
 * `insuranceStanding` once took `target: Verified<bigint>` while nothing produced one: 08
 * §1.2 defines `T_ins` as `swept_residue_unreclaimed + min_balance`, an O(1) counter inside
 * the treasury pallet, and 02 §4's `NavView` published `insurance` with no target beside it.
 * The only way to satisfy that signature was to construct the figure, and a classification
 * against a self-supplied target is a classification against nothing — the INV-FE-1 defect.
 *
 * v29 appends the field, so the `read` arm is now reachable from an ordinary `nav()` read.
 * The `unestablished` arm **stays**, and not as a vestige: a `nav()` that did not answer must
 * not fall back to an equality test against a fabricated zero, which renders as *this reserve
 * is exactly sized* at the moment it holds nothing. It is the shape `TriggerState` and
 * `ChallengeWindow` use for the same reason.
 *
 * One reading the field does not license: the gap between `insurance` and the target is not
 * a measured shortfall. 08 §1.2's archived-claims decrement is unspecified in v1, so `T_ins`
 * is a deliberate over-estimate and the account is expected to sit below it — which is why
 * `below-target`'s copy says where it refills from rather than calling it a deficit.
 */
export type InsuranceTarget =
  | { readonly kind: 'read'; readonly value: Verified<bigint> }
  | { readonly kind: 'unestablished'; readonly reason: string };

/** The fixed reason, so every screen states the same gap in the same words. */
export const INSURANCE_TARGET_UNREADABLE =
  'The treasury view did not answer, so this client can show what the INSURANCE account ' +
  'holds but not the liability it is sized against. The target is published as part of ' +
  '`nav()` (02 §4), and without that read the comparison is withheld rather than guessed.';

/** Where `INSURANCE` stands against its derived target — never a bare balance. */
export type InsuranceStanding =
  | { readonly kind: 'at-target' }
  | { readonly kind: 'below-target'; readonly shortfall: bigint }
  /**
   * Above target between the overflow sweeps. Not a surplus, and not income: the excess
   * moves to `MAIN` automatically, so this is a transient rather than a trend.
   */
  | { readonly kind: 'awaiting-overflow'; readonly excess: bigint }
  /** No target was obtainable, so there is no standing — see `InsuranceTarget`. */
  | { readonly kind: 'unestablished'; readonly reason: string };

/**
 * Classify the balance against the target.
 *
 * `Combined` because the established case is derived from **two** reads: an `INSURANCE`
 * balance verified at one block and a target verified at another describe no single state,
 * and the classification would be a claim about neither. The unestablished case still
 * carries the balance's own provenance — the screen is entitled to say at which block it
 * observed the account, and only the comparison is withheld.
 */
export function insuranceStanding(
  balance: Verified<bigint>,
  target: InsuranceTarget,
): Combined<InsuranceStanding> {
  if (target.kind === 'unestablished') {
    return combine({ kind: 'unestablished', reason: target.reason }, [balance.status]);
  }
  return combine2(balance, target.value, (held, sized): InsuranceStanding => {
    if (held === sized) return { kind: 'at-target' };
    if (held < sized) return { kind: 'below-target', shortfall: sized - held };
    return { kind: 'awaiting-overflow', excess: held - sized };
  });
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
    case 'unestablished':
      return (
        `${standing.reason} A rising balance here is still not protocol income — revenue ` +
        'routes entirely to MAIN — so nothing about this account may be read as earnings ' +
        'whether or not the target is known.'
      );
  }
}
