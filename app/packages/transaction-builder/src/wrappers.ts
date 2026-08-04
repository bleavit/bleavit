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
 *
 * ## The proxy delegation is read too, and for a sharper reason (contract v27, SQ-590)
 *
 * The multisig read decides *which dispatch to build*. The proxy read decides *whether the
 * transaction is lawful at all* — and its absence is invisible, because the rows are
 * evaluated against `real` and every one of them passes. `pallet_proxy::proxy` then returns
 * `NotProxy` after the signature. `Proxy.Proxies` was frozen nowhere until v27, which is
 * why this took the longer route: it was mandated in §11.3's prose, named by nothing, and
 * therefore outside every gate that checks declared surfaces against the runtime.
 */

import type { SurfaceId } from '@bleavit/descriptors';
import type { Finalized } from '@bleavit/chain-client';

import {
  otherSignatories,
  type MultisigAccount,
  type MultisigDerivation,
} from './multisig.js';

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

/**
 * The **key** a `Multisig.Multisigs` entry was read at — 02 §7.6 freezes it as
 * `(AccountId, [u8; 32])`.
 *
 * Carried with the value because a multisig entry is meaningless without it. The storage is
 * keyed by *(multisig account, call hash)*: one multisig can have any number of concurrent
 * pending calls, each with its own approvals and its own timepoint. An entry read for call
 * hash H1 describes nothing at all about H2.
 *
 * The dangerous half is the **absence**. A `null` read at H1 says only that H1 has no
 * pending approvals; treated as the value for H2 it reads as "nobody has approved this
 * yet", so the client sends `maybe_timepoint: None` for a call that already has a recorded
 * timepoint — which `as_multi` rejects, after the user has paid. And an entry that *is*
 * present at the wrong key is worse: the client shows real approvals from a different
 * pending call, so the confirm screen describes a transaction that is not the one being
 * signed (11 §11.3 anti-substitution).
 */
export interface MultisigKey {
  readonly multisig: AccountId;
  /** The 32-byte blake2-256 hash of the encoded inner call, as `0x`-prefixed hex. */
  readonly callHash: string;
}

/**
 * A `Multisig.Multisigs` read, inseparable from the key it was performed at.
 *
 * One object rather than two arguments so a caller cannot pass a value and forget the key —
 * the shape is the check.
 */
export interface MultisigRead {
  readonly key: MultisigKey;
  /** `null` for an absent key: the ordinary first-approval case, not an error. */
  readonly entry: MultisigEntry | null;
}

/**
 * Which dispatch actually carries this approval.
 *
 * `as_multi` is **not** valid at threshold 1: `pallet_multisig` rejects it with
 * `MinimumThreshold` at every entry point (`ensure!(threshold >= 2, …)`, three sites in
 * pallet-multisig 46.0.0). The 1-of-N dispatch is `as_multi_threshold_1`, which takes no
 * threshold, no timepoint and no weight bound, creates no storage entry, and executes the
 * inner call immediately. 11 §11.5's check 13 already names it in the SafetyFilter closure.
 *
 * Naming the dispatch here rather than leaving it to the encoder means the confirm screen
 * and the encoder cannot disagree about which call is being built.
 */
export type MultisigDispatch = 'as_multi' | 'as_multi_threshold_1';

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
      /**
       * The origin the inner call executes with — **branded**, so it can only have come
       * from `deriveMultisigAccount`. A plain `AccountId` here let a caller name any
       * account at all, and a wrong one is silent in the dangerous direction: every
       * precondition row below reads it, so the client would report a healthy balance
       * for an address this transaction never acts as. See `multisig.ts`.
       */
      readonly multisig: MultisigAccount;
      readonly threshold: number;
      /** Ascending and signer-excluded, as `as_multi` requires. From `otherSignatories`. */
      readonly otherSignatories: readonly AccountId[];
    };

export const NO_WRAPPER: CallWrapper = Object.freeze({ kind: 'none' });

/**
 * Build a multisig wrapper from a derivation and the account that will sign.
 *
 * The only constructor: `otherSignatories` refuses a signer outside the derived set, so a
 * wrapper whose signatory list and whose derived account describe different multisigs
 * cannot be assembled.
 */
export function multisigWrapper(derivation: MultisigDerivation, signer: AccountId): CallWrapper {
  return {
    kind: 'multisig',
    multisig: derivation.account,
    threshold: derivation.threshold,
    otherSignatories: otherSignatories(derivation, signer),
  };
}

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
       * True at `threshold === 1`, where the inner call executes on this very approval.
       * Carried on `first` as well as `subsequent` because a confirm screen that assumed
       * "the opening approval never executes" would tell a 1-of-N signer they were merely
       * recording an intent while the call actually dispatched — the confirm surface would
       * be describing a different transaction from the one being signed (11 §11.3
       * anti-substitution).
       */
      readonly executes: boolean;
      /** `as_multi_threshold_1` at threshold 1; `as_multi` otherwise. */
      readonly dispatch: MultisigDispatch;
    }
  | {
      /** An entry exists: `maybe_timepoint` MUST carry the recorded `when`. */
      readonly kind: 'subsequent';
      readonly maybeTimepoint: Timepoint;
      readonly approvalsSoFar: number;
      readonly approvalsNeeded: number;
      /** This approval reaches the threshold, so the inner call dispatches now. */
      readonly executes: boolean;
      /** Always `as_multi`: a stored entry can only exist at threshold ≥ 2. */
      readonly dispatch: 'as_multi';
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
  read: Finalized<MultisigRead>,
  expected: MultisigKey,
  signer: AccountId,
  threshold: number,
): ApprovalStep {
  if (!Number.isInteger(threshold) || threshold < 1) {
    throw new RangeError(`multisig threshold must be a positive integer, got ${threshold}`);
  }
  // The read must be the one for *this* call. 02 §7.6 keys `Multisig.Multisigs` by
  // `(AccountId, [u8; 32])`, so an entry — or an absence — belongs to exactly one pending
  // call, and applying it to another produces a confidently wrong answer in both
  // directions: a stale `null` sends `maybe_timepoint: None` for a call that has a
  // recorded timepoint, and a stale entry shows another call's approvals on this call's
  // confirm screen. Neither is detectable downstream, because both are well-formed.
  const { key, entry: value } = read.value;
  if (key.multisig !== expected.multisig || key.callHash !== expected.callHash) {
    throw new RangeError(
      `this Multisig.Multisigs read is for (${key.multisig}, ${key.callHash}) and the call ` +
        `being built is (${expected.multisig}, ${expected.callHash}); refusing to treat one ` +
        "pending call's approval state as another's",
    );
  }
  if (threshold === 1) {
    // `as_multi` refuses threshold < 2 (`MinimumThreshold`; pallet-multisig 46.0.0 checks
    // it at three separate entry points). The 1-of-N path is `as_multi_threshold_1`, which
    // stores nothing and dispatches immediately — so there is no entry to consult even if
    // one were somehow present at this key, and reporting "approvals so far" for it would
    // describe a queue that does not exist.
    return {
      kind: 'first',
      maybeTimepoint: undefined,
      approvalsSoFar: 0,
      approvalsNeeded: 1,
      executes: true,
      dispatch: 'as_multi_threshold_1',
    };
  }
  if (value === null) {
    return {
      kind: 'first',
      maybeTimepoint: undefined,
      approvalsSoFar: 0,
      approvalsNeeded: threshold,
      executes: false,
      dispatch: 'as_multi',
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
    dispatch: 'as_multi',
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

/** One row of `Proxy.Proxies(real).0` — `ProxyDefinition<AccountId, ProxyType, BlockNumber>`. */
export interface ProxyDelegation {
  readonly delegate: AccountId;
  readonly proxyType: string;
  /** Announcement delay in blocks. Non-zero means `proxy` alone is refused. */
  readonly delay: number;
}

/**
 * The frozen surface this check reads — 02 §7.6, contract v27 (SQ-590).
 *
 * Typed as a `SurfaceId` rather than a bare string so it is bound to the generated
 * `CRITICAL_SURFACE`: if the manifest ever stops freezing this item, the citation stops
 * compiling instead of decaying into a comment. That is the same binding every clause in
 * `rows.ts` carries, and it is the half of 11 §11.4 rule 2 a prose mandate cannot supply —
 * 10 §5.2's classifier probes exactly this set, so an unfrozen read is one the
 * compatibility lattice cannot fail on.
 */
export const PROXY_DELEGATION_SURFACE: SurfaceId = 'storage.proxy.proxies';

/** `Proxy.Proxies(real)` as read — the key it was taken at, and the delegations under it. */
export interface ProxyRead {
  /** The account the map was keyed on. Checked against the wrapper's `real`. */
  readonly real: AccountId;
  /** `Proxy.Proxies(real).0` — the deposit half is not a precondition input. */
  readonly delegations: readonly ProxyDelegation[];
}

/**
 * What the client knows about `real`'s delegations.
 *
 * Discriminated rather than an optional array, for the reason every fix in this review
 * round turned on: an empty list and an unperformed read are the same value, and the
 * empty-list reading is *"nobody may act for this account"* while the unperformed reading
 * is *"we have no idea"*. Collapsing them makes a missing check look like a passed one.
 *
 * **The `read` branch carries `Finalized<ProxyRead>`, and that is not decoration.** 11
 * §11.4 rule 4 forbids provider or local-index data from satisfying any precondition, and
 * `evaluate` enforces it by accepting nothing else. Until contract v27 this branch took a
 * bare array, because 02 froze no surface to read — so the one wrapper check that decides
 * whether a signature is even lawful was the one place a cached or provider-served answer
 * would have been believed. It is keyed as well as branded: `real` travels *with* the
 * delegations, so a read taken for a different account cannot be presented as this one's.
 */
export type DelegationEvidence =
  | { readonly kind: 'read'; readonly read: Finalized<ProxyRead> }
  | { readonly kind: 'unreadable'; readonly reason: string };

export type ProxyAdmission =
  | { readonly ok: true; readonly delegation: ProxyDelegation }
  | { readonly ok: false; readonly reason: string };

/**
 * Whether `signer` may actually dispatch `callName` as `real` — 11 §11.3, §11.4 rule 2.
 *
 * **This check did not exist.** A wrapper could name `real = R` with `proxyType: 'Any'` and
 * every precondition row would be evaluated against R — correctly, since that is the
 * account the call would act as — while nothing established that the signer holds a
 * delegation for R at all. With no delegation, all rows pass, the user signs, and
 * `pallet_proxy::proxy` returns `NotProxy`. The client had told them it would work.
 *
 * `proxyTypeCovers` does not close this: it answers whether a *claimed* proxy type covers
 * the call, taking the claim itself on trust. The claim is the part that has to come from
 * the chain.
 *
 * Four refusals that are easy to leave out, each of which the runtime enforces:
 *
 *  - The read must be **keyed on the `real` this wrapper names**, and that is checked
 *    before anything is drawn from it. `Proxy.Proxies` is a map, so a read carried over
 *    from another account is not merely stale — its *emptiness* is about somebody else,
 *    and an empty list is exactly what the permissive mistake looks like from the inside.
 *  - The delegation must name **this signer** as delegate. A delegation to somebody else is
 *    not weaker evidence, it is evidence about a different account.
 *  - The stored `proxyType` governs, not the wrapper's. A caller-supplied `'Any'` is a
 *    claim; `Proxy.Proxies` is the record. Checking the claim against itself is the
 *    self-agreement defect in its purest form.
 *  - A **non-zero `delay`** means the delegation is announce-only: `proxy` is refused and
 *    the call must go through `announce` and then `proxy_announced`. Ignoring the delay
 *    admits a wrapper the runtime rejects with `Unannounced`.
 */
export function proxyAdmits(
  evidence: DelegationEvidence,
  real: AccountId,
  signer: AccountId,
  callName: string,
): ProxyAdmission {
  if (evidence.kind === 'unreadable') {
    // INV-FE-12: an unproven capability is *absent*, with a named reason.
    return { ok: false, reason: evidence.reason };
  }
  const { real: readAt, delegations } = evidence.read.value;
  if (readAt !== real) {
    // Refused rather than reported as "no delegation": the two are indistinguishable to a
    // caller and only one of them is about this transaction.
    return {
      ok: false,
      reason:
        `this delegation read was taken for ${readAt}, not ${real}. Refusing to decide one ` +
        "account's proxy rights from another account's record.",
    };
  }
  const forSigner = delegations.filter((d) => d.delegate === signer);
  if (forSigner.length === 0) {
    return {
      ok: false,
      reason:
        'this account holds no proxy delegation for that address, so the chain would reject ' +
        'the call with NotProxy. Nothing is signed.',
    };
  }
  const usable = forSigner.find((d) => d.delay === 0 && proxyTypeCovers(d.proxyType, callName));
  if (usable === undefined) {
    const delayed = forSigner.find((d) => d.delay > 0 && proxyTypeCovers(d.proxyType, callName));
    if (delayed !== undefined) {
      return {
        ok: false,
        reason:
          `this delegation carries an announcement delay of ${delayed.delay} blocks, so a direct ` +
          'proxy call is rejected. It has to be announced first and dispatched after the delay.',
      };
    }
    return {
      ok: false,
      reason:
        `the delegation you hold is of type ${forSigner.map((d) => d.proxyType).join(', ')}, ` +
        'which this release cannot prove covers this call. An unproven capability is treated ' +
        'as absent (INV-FE-12).',
    };
  }
  return { ok: true, delegation: usable };
}

/** Why a wrapped submission is refused, in the client's own words. */
export function wrapperRefusalReason(step: ApprovalStep): string | undefined {
  if (step.kind !== 'already-approved') return undefined;
  return (
    `this account has already approved (${step.approvalsSoFar} of ${step.approvalsNeeded} approvals ` +
    'recorded). A repeat approval is rejected on chain, so it is refused here rather than paid for.'
  );
}
