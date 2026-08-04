/**
 * Call wrappers — multisig and proxy (11 §11.3), under the same precondition system.
 *
 * 11 §11.3 says "Multisig via `Multisig.as_multi` with approval state read from
 * `Multisig.Multisigs`; proxies supported as call wrappers under the same precondition
 * system." The second half is the load-bearing one, and it is not satisfied by running
 * the same rows: a wrapper **splits the identity in two**, and the rows have to be
 * pointed at the right half.
 *
 * ## The identity split, which is the whole reason this module exists
 *
 * An unwrapped extrinsic has one account: the signer is the origin, pays the fee, and
 * owns the nonce. A wrapper breaks that apart.
 *
 *  - `Proxy.proxy(real, …, call)` executes `call` with **`real`** as the origin. The
 *    signer's balance, positions and permissions are irrelevant to whether the inner call
 *    succeeds; `real`'s decide it.
 *  - `Multisig.as_multi(threshold, others, …, call)` executes `call` with the **derived
 *    multisig account** as the origin, on the approval that reaches the threshold.
 *
 * In both cases the **signer still pays the fee and still owns the nonce**. So a
 * precondition table that asks one account for both questions asks the wrong one for at
 * least one of them — and it fails in the dangerous direction: the client checks the
 * signer's healthy balance, reports every row green, and the runtime rejects the inner
 * call because the *proxied* account is the one that is short. The user signed something
 * the client had told them would work.
 *
 * `actingAccount()` and `feePayer()` are therefore separate functions rather than one
 * `who`, and callers must choose per row. 11 §11.5's tables are written against the
 * account the call acts as; only the fee-headroom rows follow the signer.
 *
 * ## Approval state is read, never assumed
 *
 * `Multisig.as_multi` takes `maybe_timepoint: Option<Timepoint>` and the runtime is
 * strict about it: `None` is required for the first approval and rejected
 * (`UnexpectedTimepoint`) for any later one, while a later approval carrying the wrong
 * height/index is rejected (`WrongTimepoint`). The correct value is not derivable from
 * anything the client already holds — it is the `when` recorded in
 * `Multisig.Multisigs((multisig, callHash))`, which is exactly the read 11 §11.3 mandates
 * and which doc 02 did not freeze until contract v24 (SQ-580).
 *
 * `deriveApproval` is a pure function over that read for the same reason the compatibility
 * classifier is: the states that matter — a second approval, an already-approved signer,
 * the threshold-reaching call — are states a healthy local chain will not produce on
 * demand, and a path that can only be tested against a live multisig is a path that ships
 * untested.
 */

import type { Finalized } from '@bleavit/chain-client';

/** An SS58-decoded account, as the rest of the package carries it. */
export type AccountId = string;

/** `Multisig.Multisigs`' timepoint — the block and extrinsic index of the first approval. */
export interface Timepoint {
  readonly height: number;
  readonly index: number;
}

/** The decoded `Multisig.Multisigs` value, or its absence. 02 §7.6 freezes this shape. */
export interface MultisigEntry {
  readonly when: Timepoint;
  readonly deposit: bigint;
  readonly depositor: AccountId;
  readonly approvals: readonly AccountId[];
}

export type CallWrapper =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'proxy';
      /** The account the inner call acts as. */
      readonly real: AccountId;
      /**
       * The proxy type the delegation was created with, when the client knows it.
       * `undefined` means *unknown*, never *any*: see `proxyTypeCovers`.
       */
      readonly proxyType: string | undefined;
    }
  | {
      readonly kind: 'multisig';
      /** The derived multisig account — the origin the inner call executes with. */
      readonly multisig: AccountId;
      readonly threshold: number;
      readonly otherSignatories: readonly AccountId[];
    };

export const NO_WRAPPER: CallWrapper = Object.freeze({ kind: 'none' });

/**
 * The account the inner call executes as — what 11 §11.5's rows are about.
 *
 * Not the signer for a wrapped call. Every balance, position, bond, lock and
 * permission row must read this account.
 */
export function actingAccount(wrapper: CallWrapper, signer: AccountId): AccountId {
  switch (wrapper.kind) {
    case 'none':
      return signer;
    case 'proxy':
      return wrapper.real;
    case 'multisig':
      return wrapper.multisig;
  }
}

/**
 * The account that pays the fee and owns the nonce — always the signer.
 *
 * Stated as a function rather than "just use the signer" so that the two questions have
 * two call sites: the failure this module exists to prevent is one identity answering
 * both, and that mistake is invisible when only one of them is ever written down.
 */
export function feePayer(wrapper: CallWrapper, signer: AccountId): AccountId {
  void wrapper;
  return signer;
}

/** True when the wrapper makes the call act as an account other than the signer. */
export function splitsIdentity(wrapper: CallWrapper, signer: AccountId): boolean {
  return actingAccount(wrapper, signer) !== feePayer(wrapper, signer);
}

export type ApprovalStep =
  | {
      /** No entry: this signer opens the multisig. `maybe_timepoint` MUST be `None`. */
      readonly kind: 'first';
      readonly maybeTimepoint: undefined;
      readonly approvalsSoFar: 0;
      readonly approvalsNeeded: number;
      /**
       * True at `threshold === 1`, where `as_multi` is a plain dispatch and the inner
       * call executes on this very approval. Carried on `first` as well as `subsequent`
       * because a confirm screen that assumed "the opening approval never executes"
       * would tell a 1-of-N signer they were merely recording an intent while the call
       * actually dispatched — the confirm surface would be describing a different
       * transaction from the one being signed (11 §11.3 anti-substitution).
       */
      readonly executes: boolean;
    }
  | {
      /** An entry exists: `maybe_timepoint` MUST carry the recorded `when`. */
      readonly kind: 'subsequent';
      readonly maybeTimepoint: Timepoint;
      readonly approvalsSoFar: number;
      readonly approvalsNeeded: number;
      /** This approval reaches the threshold, so the inner call dispatches now. */
      readonly executes: boolean;
    }
  | {
      /**
       * This signer has already approved. Submitting again is refused by the runtime
       * (`AlreadyApproved`), so the client refuses first with a reason rather than
       * letting the user pay for a rejection.
       */
      readonly kind: 'already-approved';
      readonly maybeTimepoint: Timepoint;
      readonly approvalsSoFar: number;
      readonly approvalsNeeded: number;
    };

/**
 * Derive the next approval step from the frozen `Multisig.Multisigs` read.
 *
 * The read is `Finalized<…>` because it decides what gets signed: an approval carrying a
 * timepoint from a *best* block that later reorgs is rejected by the runtime, and the fee
 * is spent either way. INV-FE-1 already says this; the type says it too, so a provider
 * read is untypeable here rather than merely discouraged.
 *
 * `entry` is `null` for an absent key — the ordinary first-approval case, not an error.
 */
export function deriveApproval(
  entry: Finalized<MultisigEntry | null>,
  signer: AccountId,
  threshold: number,
): ApprovalStep {
  if (!Number.isInteger(threshold) || threshold < 1) {
    throw new RangeError(`multisig threshold must be a positive integer, got ${threshold}`);
  }
  const value = entry.value;
  if (value === null) {
    return {
      kind: 'first',
      maybeTimepoint: undefined,
      approvalsSoFar: 0,
      approvalsNeeded: threshold,
      executes: threshold === 1,
    };
  }
  const approvalsSoFar = value.approvals.length;
  if (value.approvals.includes(signer)) {
    return {
      kind: 'already-approved',
      maybeTimepoint: value.when,
      approvalsSoFar,
      approvalsNeeded: threshold,
    };
  }
  return {
    kind: 'subsequent',
    maybeTimepoint: value.when,
    approvalsSoFar,
    approvalsNeeded: threshold,
    // This signer's approval is the one that reaches the threshold.
    executes: approvalsSoFar + 1 >= threshold,
  };
}

/**
 * Whether a known proxy type covers a call — fail-closed on `undefined` (INV-FE-12).
 *
 * An unknown proxy type is an **unproven capability**, and INV-FE-12 makes an unproven
 * capability *absent*: the dependent surface is disabled with a named reason rather than
 * permitted on the guess that it will probably work. The tempting inversion — "we do not
 * know it is restricted, so allow it" — turns a `NotProxy` runtime rejection into
 * something the user pays for after being told it would succeed.
 *
 * `Any` covers everything by definition. Every other type is matched exactly, because a
 * client that reasoned about which calls a `Governance` proxy may make would be
 * reimplementing the runtime's `InstanceFilter` from the outside, and that copy would be
 * wrong the moment the filter changed — silently, since nothing compares them.
 */
export function proxyTypeCovers(proxyType: string | undefined, callName: string): boolean {
  void callName;
  if (proxyType === undefined) return false;
  return proxyType === 'Any';
}

/** Why a wrapped submission is refused, in the client's own words. */
export function wrapperRefusalReason(step: ApprovalStep): string | undefined {
  if (step.kind !== 'already-approved') return undefined;
  return (
    `this account has already approved (${step.approvalsSoFar} of ${step.approvalsNeeded} approvals ` +
    'recorded). A repeat approval is rejected on chain, so it is refused here rather than paid for.'
  );
}
