/**
 * The guardian console — 11 §11.8.2. F17.
 *
 * These are the system's most privileged actors, and every control here exists because a
 * guardian signature is hard to undo.
 *
 * ## One action, one description
 *
 * The recurring defect on this screen has never been a missing check. It has been **two
 * descriptions of one action travelling separately** and nothing forcing them to agree: an
 * `AllowanceMeter` saying which power, a `TriggerState` saying which condition, and a
 * `PowerArguments` saying which call. Each was validated by a different function, each
 * function saw one of the three, and every disagreement between them reached `ready`.
 *
 * A 2026-08-07 round closed the *omission* — the trigger became required — and left three
 * further shapes open, because a required field still says nothing about whether it describes
 * the same action as its neighbours. So the shape is now inverted: **`GuardianProposal` is the
 * single value**, its arms are keyed on the power, and the meter, the trigger evidence and the
 * call arguments are fields of the arm rather than parameters beside it. `guardianCall`
 * *derives* the encoded `GuardianPower` from it — including `trigger` and `target`, which no
 * caller may write. A disagreement is therefore not detected; it cannot be represented.
 *
 * ## A playbook is admissible only under a *verified* trigger
 *
 * E20: *"trigger condition not active at B′ ⇒ blocked (playbooks are admissible only under
 * verified triggers)"*. So `TriggerState` is a union with an **`unread`** arm, and
 * `mayActivatePlaybook` treats `unread` exactly like `inactive`. Collapsing the two would
 * be the familiar fail-open: *not checked* landing on the same side as *checked and fine*,
 * on the one action whose whole justification is that the condition holds right now.
 *
 * E20 is titled *"Guardian approval"* and every item of its V-facet is an approval-surface
 * item, so the trigger and the allowance meters are required on **both** flows. Until
 * 2026-08-08 the approve flow evaluated neither: the runtime enforces them at the *fifth*
 * approval (`approve_action` → `dispatch` → `check_and_consume`), so the one guardian whose
 * signature the chain refuses was the one shown nothing about the condition.
 *
 * ## A trigger reading names what it was read against
 *
 * `OracleDeadlock` is `Epoch.PendingOracleVoids.contains_key(target)` for the **exact cohort**
 * the activation names; `VoidInFlight` is the same item read for non-emptiness. One failed
 * cohort never authorizes VOID of another. A reading that carried only the variant let the
 * second answer be handed over as the first, so `TriggerSubject` carries the cohort **inside**
 * the `OracleDeadlock` arm: there is no way to answer that question without saying which
 * cohort was asked about, and no way to answer the other question in its name.
 *
 * ## The approval is counted, and "already approved" is a distinct refusal
 *
 * Approving twice is not a no-op to a user — they believe they have moved the count. So
 * `approvalBlocks` reports it as its own reason rather than folding it into "not eligible".
 *
 * ## The consequence of an unratified action is stated, not buried
 *
 * §11.8.2's ratification tracker requires *"the 50%-bond-slash + recall consequence of an
 * unratified action stated"*. A guardian acting under a playbook is exposed to losing half
 * their bond if the retrospective review fails, and that is a fact about **their own
 * money** — so it is fixed copy returned alongside every propose flow, not a footnote on
 * another screen.
 */

import { combine, combine2, type Combined, type Verified } from '@bleavit/shared-types';
import type { ObligationScope, SurfaceId } from '@bleavit/transaction-builder';
import type { EvidenceState } from './evidence.js';

/** The five powers §11.8.2 names. Closed, so a form cannot invent a sixth. */
export type GuardianPower =
  | 'pause_intake'
  | 'delay_once'
  | 'force_rerun'
  | 'activate_playbook'
  | 'suspend_on_gate';

/**
 * What a trigger read was performed **against** — 11 §11.8.2's trigger table, contract v29.
 *
 * Seven of the eight variants are chain-wide facts: a flag bit, a latch, an epoch-keyed
 * breach flag. `OracleDeadlock` is not, and the specification says so in as many words:
 * *"`contains_key(target)` for the **exact cohort** the activation names … a client MUST
 * evaluate this against the `target` in the call, never against the map's non-emptiness"*
 * (05 §4.7; 07 §10 — one failed cohort never authorizes VOID of another).
 *
 * The subject is therefore part of the reading rather than a field beside it, and that is the
 * whole repair. `TriggerState` used to carry the variant alone, so a reader answering *"is any
 * cohort latched?"* — the `VoidInFlight` question, over the same storage item — produced a
 * value indistinguishable from an `OracleDeadlock` answer, and a `PB-ORACLE-VOID` naming
 * cohort 42 passed while cohort 7 was the latched one. That was not fixable by the caller:
 * there was nowhere to record which cohort the read had been keyed to.
 *
 * The cohort is also the **only** source of `ActivatePlaybook.target` (see `guardianCall`), so
 * the number the client evaluated and the number the call carries are one number.
 */
export type TriggerSubject =
  | { readonly trigger: 'OracleDeadlock'; readonly cohort: number }
  | ChainWideSubject<Exclude<PlaybookTrigger, 'OracleDeadlock'>>;

/**
 * The seven chain-wide subjects, one arm each.
 *
 * Distributed deliberately: a single arm typed `{ trigger: Exclude<…> }` is one union member
 * whose field is a seven-way union, and `Extract` cannot then pick `GateBreach` out of it —
 * so `TriggerState<'GateBreach'>` would resolve to `never` and `suspend_on_gate` would take
 * no value at all. Written as a distributive conditional, each trigger is its own arm and the
 * per-power narrowing below is real.
 */
type ChainWideSubject<T extends PlaybookTrigger> = T extends unknown
  ? { readonly trigger: T }
  : never;

/** The subject shape for one named trigger variant. */
type SubjectOf<T extends PlaybookTrigger> = Extract<TriggerSubject, { readonly trigger: T }>;

/**
 * Whether a playbook's on-chain trigger holds.
 *
 * `unread` is a real state, not an absence: the read may have failed, and a client that
 * could not establish the trigger must not act as though it holds.
 *
 * **Every arm names the subject it describes**, and that field is what binds this union to
 * `TRIGGER_READS`. Without it the table was a mirror of §11.8.2 that nothing derived from:
 * a caller could report `active` for a variant no frozen surface answers and the client had
 * no way to disagree. With it, `triggerRefusal` consults the table first, so *"this trigger
 * has no read"* is decided by the mapping rather than asserted by whoever built the value.
 *
 * The type parameter exists so a power that admits exactly one condition can say so in its
 * own signature — `suspend_on_gate` takes a `TriggerState<'GateBreach'>` and nothing else
 * typechecks there, which is 06 §5.2's *"while a hard-gate daily breach flag is active"*
 * written into the shape rather than remembered by a caller.
 */
export type TriggerState<T extends PlaybookTrigger = PlaybookTrigger> =
  | { readonly kind: 'active'; readonly subject: SubjectOf<T>; readonly since: Verified<number> }
  | { readonly kind: 'inactive'; readonly subject: SubjectOf<T> }
  | { readonly kind: 'unread'; readonly subject: SubjectOf<T>; readonly reason: string }
  /**
   * No on-chain condition can set this trigger in this runtime.
   *
   * `DepegMedian` only: 06 §6.2 marks `PB-DEPEG` unavailable in v1 — no authoritative
   * attested price source, median formula or latch lifecycle is specified — so the runtime
   * never reports it active. Distinct from `inactive`, which means the condition is being
   * measured and does not hold, and from `unread`, which means retry: this one will not
   * become true, and an operator waiting for it should be told so.
   *
   * It carries **no reason field**: the sentence is derived from `TRIGGER_READS`, because a
   * caller-supplied one is a claim about the runtime that the caller is also free to get
   * wrong. A variant whose read list is empty is unavailable whatever arm it arrives in.
   */
  | { readonly kind: 'unavailable'; readonly subject: SubjectOf<T> };

/** The variant a reading answers about. One accessor, so no call site re-derives it. */
export function triggerOf(reading: TriggerState): PlaybookTrigger {
  return reading.subject.trigger;
}

/**
 * One call inside a guardian action's enumerated batch.
 *
 * §11.8.2: *"playbooks are preimage-committed enumerated batches — decoded and displayed,
 * never summarized away"*. The `undecodable` arm has **no pallet or call field**, so a screen
 * holding one cannot render a name for it; that is 10 §5.4's "never guessed" made structural
 * rather than promised, and it is the same shape `ReferendumCall` uses.
 */
export type ApprovedCall =
  | {
      readonly kind: 'decoded';
      readonly pallet: Verified<string>;
      readonly call: Verified<string>;
      /** Rendered as text, never as markup — §11.8.1's evidence rule applies here too. */
      readonly args: readonly Verified<string>[];
    }
  | { readonly kind: 'undecodable'; readonly rawHex: string; readonly reason: string };

/**
 * A pending action's power, **decoded** — 02 §7.4's `PendingActions` value, as it is stored.
 *
 * This was `power: Verified<string>` plus a separate `target: Verified<string>`, and that
 * shape is why the approve flow could not evaluate anything: two display strings carry no
 * trigger, no playbook id and no cohort, so a console holding them had nothing to check E20's
 * F-facet against. The runtime stores the whole `guardian_core::GuardianPower` enum in
 * `Guardian.PendingActions` — variant, playbook, trigger, expiry and cohort target — so the
 * information was never missing from the chain; it was being thrown away on the way to the
 * screen.
 *
 * The `kind` discriminant is a plain string rather than a `Verified<string>` for the same
 * reason `ApprovedCall.kind` is: it is not a datum, it selects **which** data exist. Every
 * leaf under it carries its own badge.
 *
 * `undecodable` is INV-FE-12's arm and it carries no power name at all, so no screen can
 * render a guessed one — and `approvalBlocks` refuses the approval outright, because an
 * action whose power this client cannot read is one whose preconditions it cannot evaluate.
 */
export type PendingPower =
  | { readonly kind: 'pause_intake'; readonly until: Verified<number> }
  | { readonly kind: 'delay_once'; readonly pid: Verified<string> }
  | { readonly kind: 'force_rerun'; readonly pid: Verified<string> }
  | {
      readonly kind: 'activate_playbook';
      readonly id: Verified<PlaybookId>;
      readonly trigger: Verified<PlaybookTrigger>;
      readonly expiry: Verified<number>;
      /** `Some` for `PB-ORACLE-VOID` and `None` for every other playbook (06 §6.2). */
      readonly target: Verified<number> | undefined;
    }
  | { readonly kind: 'suspend_on_gate' }
  | { readonly kind: 'undecodable'; readonly rawHex: string; readonly reason: string };

/** The power a decoded pending action names, or `undefined` when it could not be decoded. */
export function pendingPowerName(power: PendingPower): GuardianPower | undefined {
  return power.kind === 'undecodable' ? undefined : power.kind;
}

/**
 * The same power, as the scope `blockingObligationsFor` matches row obligations against.
 *
 * `undefined` for an undecodable power, and that is the whole point of returning it rather
 * than throwing: an obligation scoped to `ActivatePlaybook` must still close the control
 * when nobody can say whether this action *is* an `ActivatePlaybook`. Scoping narrows an
 * obligation on evidence, never on the absence of it.
 *
 * The playbook id rides along because one of `O-3`'s two conditions is narrower than the
 * power — `guardian_core::dispatch` refuses re-activation for `PB-LEDGER-FREEZE` alone.
 */
export function obligationSubjectOf(power: PendingPower): ObligationScope | undefined {
  if (power.kind === 'undecodable') return undefined;
  if (power.kind === 'activate_playbook') {
    return { power: power.kind, playbook: power.id.value };
  }
  return { power: power.kind };
}

export interface PendingAction {
  readonly actionId: Verified<string>;
  /**
   * The decoded power, which is also §11.8.2's *target* column — see `PendingPower`.
   *
   * A power without its target is not actionable: "delay_once" says a delay is proposed and
   * not *what* is being delayed, and a guardian cannot weigh a `force_rerun` without knowing
   * which cohort it re-runs. Both now come from one decoded value rather than from two
   * strings a caller could pair wrongly.
   */
  readonly power: PendingPower;
  readonly justificationHash: Verified<string>;
  readonly approvals: Verified<number>;
  readonly threshold: Verified<number>;
  readonly expiresAt: Verified<number>;
  /**
   * Whether this action has already executed — `guardian_core`'s own `dispatched` flag.
   *
   * **Required, and it was absent until 2026-08-07.** §11.8.2's approve row declares the
   * precondition *"the action is pending and has not expired"*, and only the second half was
   * evaluated. The runtime keeps a dispatched action **in `PendingActions` for the whole review
   * window** (`guardian-core/src/lib.rs:655-656`) so a veto can still reach it, and refuses a
   * second approval with `AlreadyDispatched` (`:480`). So the client was offering the system's
   * most privileged signature on an action the runtime would reject, and listing it under
   * *"Actions awaiting approval"* when it was awaiting nothing.
   *
   * That is 11 §11.5's P-11 rule inverted — a client must not invite an action the runtime
   * refuses, for the same reason it must not refuse one the runtime accepts.
   */
  readonly dispatched: Verified<boolean>;
  /**
   * The exact batch this action would execute. Required — an action with no batch field
   * could be approved without one ever being shown, which is the failure §11.8.2's
   * "never summarized away" names.
   */
  readonly calls: readonly ApprovedCall[];
}

/**
 * What a caller states about the condition an action depends on — E20's V- and F-facets.
 *
 * Two of the five powers are condition-gated (`activate_playbook` on the trigger it names,
 * `suspend_on_gate` on the hard-gate daily breach flag) and three are not. The three say so
 * **explicitly** with `no-condition`, because an optional field is an evaluation that defaults
 * to *nothing was wrong* — the shape of every fail-open defect this client has found.
 *
 * It is the same device `ProposalTrigger` used on the propose side before that side was folded
 * into `GuardianProposal`, and the same device `RegistrationCheck.uncheckable` and
 * `Combined<T>`'s `unestablished` arm use: the absence of an answer is a value somebody has to
 * write down.
 */
export type ConditionEvidence =
  | { readonly kind: 'trigger'; readonly reading: TriggerState }
  | { readonly kind: 'no-condition' };

/**
 * The reads the *rest* of `check_and_consume` needs for the action being approved.
 *
 * One arm per shape of dispatch precondition rather than one per power, because
 * `pause_intake` and `activate_playbook` are both bounded by the same hold window and both
 * rerun powers read the same proposal record. `not-applicable` is the explicit answer for
 * `suspend_on_gate`, whose only dispatch condition is the gate-breach flag `ConditionEvidence`
 * already carries — written down rather than omitted, for the reason every arm here exists.
 */
export type DispatchEvidence =
  | { readonly kind: 'hold'; readonly horizon: HoldHorizon }
  | { readonly kind: 'rerun'; readonly proposal: RerunState }
  | { readonly kind: 'not-applicable' };

/**
 * Whether the playbook an activation names may be activated at all — 02 §7.4, contract v30.
 *
 * Two reads, one arm each, and both were `blocking` unreadable obligations on row `O-3` until
 * contract v30 froze the maps. Both refusals fall on the **dispatching** approval:
 * `approve_action` reads `Guardian.PlaybookRegistered[id]` *after* counting the fifth approval
 * (`PlaybookNotRegistered`), and `dispatch` reads `Guardian.ActivePlaybooks`
 * (`PlaybookAlreadyActive`). A client blind to either walks a 5-of-7 council through four
 * signatures to a guaranteed revert on the fifth.
 *
 * `not-applicable` is the explicit answer for the four powers that are not activations —
 * written down rather than omitted, for the reason every arm in this module exists: an
 * optional field is an evaluation that defaults to *nothing was wrong*.
 *
 * ## The two readings 02 §7.4 forbids, and where each is prevented
 *
 * **Registration is admissibility, never a trigger source** (06 §6.2). It is consumed only by
 * `playbookBlocks`, and `TRIGGER_READS` — the one table `triggerRefusal` consults — names
 * neither surface, so registration has no path to the trigger evaluation at all. A registered
 * playbook whose trigger is inactive still blocks, and an unregistered one whose trigger is
 * live blocks too; neither answer can stand in for the other.
 *
 * **Presence in `ActivePlaybooks` is not uniformly a refusal.** `dispatch` refuses
 * re-activation for `PB-LEDGER-FREEZE` alone — it renews only through a values referendum
 * (06 §6.3) — while every other playbook re-activates in place without consuming a slot
 * (06 §6.2's *"renew by re-activation while triggered"*). So `activeIds` is read for the
 * ledger-freeze activation and for nothing else, and an **unread** set blocks only that same
 * activation: refusing five lawful renewals on a read that decides nothing about them is the
 * mirror-rule defect, and an over-broad fail-closed is still a client refusing what the chain
 * accepts.
 */
export type PlaybookAdmissibility =
  | {
      readonly kind: 'activation';
      readonly registration: RegistrationReading;
      readonly active: ActivePlaybookReading;
    }
  | { readonly kind: 'not-applicable' };

/** `Guardian.PlaybookRegistered[id]` for the playbook this action names (02 §7.4). */
export type RegistrationReading =
  | { readonly kind: 'read'; readonly registered: Verified<boolean> }
  | { readonly kind: 'unread'; readonly reason: string };

/**
 * `Guardian.ActivePlaybooks`, as the ids it holds records for (02 §7.4).
 *
 * The ids alone rather than the `ActivePlaybook { id, expiry, renewals_used }` records,
 * because the only question `dispatch` asks of this item is membership — `active_playbooks
 * .iter().any(|p| p.id == id)`. Carrying the expiry here would invite a screen to compute a
 * countdown the runtime does not consult on this path.
 *
 * One `Verified` over the whole vector, not one per id: it is one storage read, and a status
 * per element would let a caller pair a verified id with a provider one inside a single value.
 */
export type ActivePlaybookReading =
  | { readonly kind: 'read'; readonly ids: Verified<readonly PlaybookId[]> }
  | { readonly kind: 'unread'; readonly reason: string };

/** One power's allowance as the chain publishes it — `Guardian.Allowances` (02 §7.4). */
export interface AllowanceReading {
  readonly used: Verified<number>;
  readonly limit: Verified<number>;
}

/**
 * The three powers the chain meters — 06 §5.2's Allowance column, read as a counter.
 *
 * **Two of the five are not metered and were metered here anyway.** §5.2 gives
 * `activate_playbook` *"per-playbook"* and `suspend_on_gate` *"condition-gated"*; neither is a
 * count against a budget, and `guardian_core::check_and_consume` charges no allowance for
 * either — its `ActivatePlaybook` arm checks the expiry, the pairing, the target and the
 * trigger, and its `SuspendOnGate` arm checks the gate flag alone. The chain's own storage says
 * the same thing in its shape: `AllowanceState` is
 * `{ delay_used_this_epoch, force_rerun_used_this_epoch, pause_window_start, pause_used_in_window }`
 * — four fields for three powers, and no field for the other two.
 *
 * `AllowanceBook` was a total record over all five and `allowanceBlocks` ran unconditionally,
 * so a supplied `used >= limit` refused a lawful activation. That is a client refusing what the
 * runtime accepts, which 15 §4.8's mirror rule forbids in exactly those words — the same defect
 * as offering one it would not, pointing the other way.
 *
 * Narrowing the type is the repair rather than an `if`: the unmetered arms of
 * `GuardianProposal` now have no `meter` field at all, so the old shape does not compile.
 */
export type MeteredPower = 'pause_intake' | 'delay_once' | 'force_rerun';

/** Whether a power is one the chain counts. One predicate, so no call site re-derives it. */
export function isMetered(power: GuardianPower): power is MeteredPower {
  return power === 'pause_intake' || power === 'delay_once' || power === 'force_rerun';
}

/**
 * Every **metered** power's allowance, from the one storage value that carries them all.
 *
 * A record rather than a single meter, so the meter for an action is *looked up by the
 * action's own power* instead of supplied beside it. That is the B3 repair in its general
 * form: the console used to render `POWER_FIELDS[meter.power]` while validating a different
 * power's arguments, and a panel titled *"Propose a pause on intake"* prepared a playbook
 * activation. There is now no second place a power can be named.
 *
 * `Guardian.Allowances` is a single storage value (`AllowanceState`), so requiring all three
 * costs one read — and §11.8.2's propose row asks for *"allowance meters displayed"*, plural.
 */
export type AllowanceBook = Readonly<Record<MeteredPower, AllowanceReading>>;

/** Remaining allowance for a power, and whether a proposal fits under it. */
export interface AllowanceMeter<P extends MeteredPower = MeteredPower> {
  readonly power: P;
  readonly used: Verified<number>;
  readonly limit: Verified<number>;
}

/**
 * The frozen surfaces each metered power's meter is read from — 02 §7.4 and §9, contract v30.
 *
 * A meter is a **pair**, and 02 §9's binding row says so in as many words: the four constants
 * are read *"together with §7.4's `Guardian.Allowances`, which stores the used counters alone.
 * A meter is the pair; neither half is a meter"*. Until contract v30 no constant published a
 * bound at all, so `AllowanceMeter.limit` had no producer and the only way to satisfy
 * §11.8.2's *"allowance remaining for the power"* precondition was to invent it — which is
 * INV-FE-1 twice over, on the one precondition that document names by name.
 *
 * `pause_intake` names **four** surfaces where the other two name two, and the extra pair is
 * the whole reason `allowanceBook` exists rather than a record literal: its allowance is one
 * use per window, so the count is meaningless without the window length and without the epoch
 * to measure it from.
 *
 * The table is data the producer consults — `allowanceBook`'s refusal names these ids — so it
 * is a control rather than a comment, the way `TRIGGER_READS` is.
 */
export const ALLOWANCE_READS: Readonly<Record<MeteredPower, readonly SurfaceId[]>> =
  Object.freeze({
    delay_once: Object.freeze([
      'storage.guardian.allowances',
      'constant.guardian.delay_once_allowance_per_epoch',
    ] as SurfaceId[]),
    force_rerun: Object.freeze([
      'storage.guardian.allowances',
      'constant.guardian.force_rerun_allowance_per_epoch',
    ] as SurfaceId[]),
    pause_intake: Object.freeze([
      'storage.guardian.allowances',
      'constant.guardian.pause_intake_allowance',
      'constant.guardian.pause_intake_allowance_window_epochs',
      'storage.epoch.epoch_of',
    ] as SurfaceId[]),
  });

/**
 * The nine reads a book is built from — `Guardian.Allowances`, `Epoch.EpochOf` and the four
 * 02 §9 constants (contract v30).
 *
 * One union with one `unread` arm rather than a union per read, because the book is a single
 * derived value: any missing input means there is no book, and a caller holding a failed read
 * has to say so rather than reach for a zero. INV-FE-12's rule is that a value no read
 * produced is **absent**, and 10 §2.2 gives it no status — so there is no `Verified<number>`
 * to put in a field and the type must not offer one.
 *
 * **The counter field names are the metadata's, not the core crate's.** `AllowanceState` is
 * published as `{ delay_used_this_epoch, force_rerun_used_this_epoch, pause_window_start,
 * pause_used_in_window }` — the third is `pause_window_start`, although
 * `guardian_core::Guardian` calls its own copy `pause_used_epoch_window_start`. The metadata
 * name is what a client decodes and encodes; do not "correct" it to the Rust one.
 */
export type AllowanceReads =
  | {
      readonly kind: 'read';
      /** `Guardian.Allowances.delay_used_this_epoch`. */
      readonly delayUsedThisEpoch: Verified<number>;
      /** `Guardian.Allowances.force_rerun_used_this_epoch`. */
      readonly forceRerunUsedThisEpoch: Verified<number>;
      /** `Guardian.Allowances.pause_window_start` — **not** `pause_used_epoch_window_start`. */
      readonly pauseWindowStart: Verified<number>;
      /** `Guardian.Allowances.pause_used_in_window`. */
      readonly pauseUsedInWindow: Verified<number>;
      /** `Epoch.EpochOf.index` at B′ — the epoch the chain's own window test compares against. */
      readonly currentEpoch: Verified<number>;
      /** `Guardian::DelayOnceAllowancePerEpoch` (02 §9). */
      readonly delayOnceAllowancePerEpoch: Verified<number>;
      /** `Guardian::ForceRerunAllowancePerEpoch` (02 §9). */
      readonly forceRerunAllowancePerEpoch: Verified<number>;
      /** `Guardian::PauseIntakeAllowance` (02 §9). */
      readonly pauseIntakeAllowance: Verified<number>;
      /** `Guardian::PauseIntakeAllowanceWindowEpochs` (02 §9). */
      readonly pauseIntakeAllowanceWindowEpochs: Verified<number>;
    }
  | { readonly kind: 'unread'; readonly reason: string };

/**
 * A book, or the honest absence of one.
 *
 * `AllowanceBook` is total over the three metered powers and has no per-power absent arm, so a
 * figure this client cannot establish refuses the **whole** book. That is deliberately blunt
 * and it is the safe blunt: every input is read at one pinned block, so the only way one power
 * fails is a caller that mixed blocks — which is precisely the state INV-FE-2's pre-sign
 * refresh exists to collapse, and which says nothing trustworthy about the other two either.
 */
export type AllowanceBookState =
  | { readonly kind: 'book'; readonly book: AllowanceBook }
  | { readonly kind: 'unreadable'; readonly reason: string };

/**
 * Build every metered power's meter from the reads the chain publishes — contract v30.
 *
 * **The `pause_intake` meter is windowed, and the naive subtraction is wrong in the dangerous
 * direction.** `check_and_consume` resets that counter **lazily**, at consume time:
 *
 * ```rust
 * if self.current_epoch.saturating_sub(self.pause_used_epoch_window_start)
 *     >= PAUSE_INTAKE_ALLOWANCE_WINDOW_EPOCHS
 * { self.pause_used_epoch_window_start = self.current_epoch; self.pause_used_in_window = 0; }
 * ensure!(self.pause_used_in_window < PAUSE_INTAKE_ALLOWANCE, Error::AllowanceExhausted);
 * ```
 *
 * So the stored counter is **stale outside the window**, and with `PauseIntakeAllowance = 1` a
 * client that read `pause_used_in_window = 1` and subtracted would show **zero remaining** — an
 * exhausted meter — while the chain would reset the window and accept the call. That is the
 * client refusing what the runtime accepts, on an emergency power, which 15 §4.8's mirror rule
 * forbids in those words. This applies the same window test the pallet applies, against the
 * same `saturating_sub`, before the subtraction happens.
 *
 * **The other two counters need no such test, and the asymmetry is a fact about the pallet
 * rather than an oversight.** `sync_epoch()` zeroes `delay_used_this_epoch` and
 * `force_rerun_used_this_epoch` in `on_initialize` (`pallets/guardian/src/lib.rs`), so at any
 * finalized block those two are already current and pass straight through. Nothing resets the
 * pause pair outside `check_and_consume`, which is why exactly one meter is derived.
 *
 * The derived figure carries the provenance of **all four** of its inputs through `combine`,
 * never the counter's own status: a window computed from a provider's epoch and a verified
 * counter is not a verified figure, and two verified reads at different blocks describe no
 * block at all. Either makes the whole book `unreadable` rather than a number with a badge it
 * did not earn (10 §2.2; app-code rule 2's rule B).
 */
export function allowanceBook(reads: AllowanceReads): AllowanceBookState {
  if (reads.kind === 'unread') {
    const surfaces = [...new Set(Object.values(ALLOWANCE_READS).flat())].sort().join(', ');
    return {
      kind: 'unreadable',
      reason:
        `This client could not establish the guardian allowance meters (${reads.reason}). A ` +
        `meter is a used counter and its published limit together, read from ${surfaces}, and ` +
        'a power whose remaining budget cannot be established is not offered — these are the ' +
        'five most privileged actions in the system, and "we could not check the budget" is ' +
        'not a reason to spend it.',
    };
  }
  // The pallet's own test, in the pallet's own order: saturating subtraction first, then the
  // `>=` comparison. A signed subtraction here would make a window start ahead of the current
  // epoch read as an enormous elapsed count and silently reset a live window.
  const windowed = combine(
    Math.max(0, reads.currentEpoch.value - reads.pauseWindowStart.value) >=
      reads.pauseIntakeAllowanceWindowEpochs.value
      ? 0
      : reads.pauseUsedInWindow.value,
    [
      reads.pauseUsedInWindow.status,
      reads.pauseWindowStart.status,
      reads.currentEpoch.status,
      reads.pauseIntakeAllowanceWindowEpochs.status,
    ],
  );
  if (windowed.kind === 'incomparable') {
    return {
      kind: 'unreadable',
      reason:
        'This client cannot establish whether the pause-intake allowance window has elapsed. ' +
        `${windowed.reason} The stored counter is only meaningful inside its window, so it is ` +
        'not reported on its own.',
    };
  }
  return {
    kind: 'book',
    book: {
      pause_intake: { used: windowed.datum, limit: reads.pauseIntakeAllowance },
      delay_once: {
        used: reads.delayUsedThisEpoch,
        limit: reads.delayOnceAllowancePerEpoch,
      },
      force_rerun: {
        used: reads.forceRerunUsedThisEpoch,
        limit: reads.forceRerunAllowancePerEpoch,
      },
    },
  };
}

/** The meter for one metered power. Derived from the book, never written beside the call. */
export function meterFor<P extends MeteredPower>(
  book: AllowanceBook,
  power: P,
): AllowanceMeter<P> {
  const reading = book[power];
  return { power, used: reading.used, limit: reading.limit };
}

export interface GuardianBlock {
  readonly check: string;
  readonly detail: string;
}

/**
 * Everything blocking `guardian.approve_action`, all of it, in §11.8.2's order.
 *
 * **E20's V-facet is four items and this function used to evaluate one of them.** *"pending
 * action with decoded enumerated call batch, m-of-7 progress, allowance meters,
 * trigger-condition status"* — the batch was rendered and refused when unreadable; the meters
 * and the trigger were not modelled at all, and the F-facet (*"trigger condition not active at
 * B′ ⇒ blocked"*) had no clause anywhere.
 *
 * The consequence was exact and it was not theoretical: `propose_action` validates **nothing**
 * (`guardian-core/src/lib.rs:436-463`), and `check_and_consume` runs inside `dispatch`, which
 * `approve_action` reaches only at the threshold approval. A `PB-HALT-INTAKE` proposed while
 * `GateBreachFlags` was set and approved after it cleared therefore presented the fifth
 * guardian an enabled button whose transaction reverts with `TriggerInactive` — the one
 * guardian whose signature the chain refuses, shown nothing about the condition.
 *
 * The trigger blocks for **every** approver, not only the fifth. E20 states the refusal
 * unconditionally and 06 §5.2 states the admissibility rule the same way (*"only while that
 * playbook's verified on-chain trigger is active"*), so an approval collected under a dead
 * condition is a signature toward an action the chain will not run. Whether §11.8.2's approve
 * row — which lists four preconditions and no trigger — is meant to say otherwise is a real
 * disagreement between two normative texts, raised rather than resolved here.
 */
export function approvalBlocks(context: ApprovalContext): readonly GuardianBlock[] {
  const blocks: GuardianBlock[] = [];
  if (!context.callerIsMember) {
    blocks.push({
      check: 'Membership',
      detail: 'This account is not a guardian, so it cannot approve guardian actions.',
    });
  }
  if (context.action.dispatched.value) {
    // §11.8.2's approve row says "the action is **pending** and has not expired", and only the
    // second half was checked until 2026-08-07. `guardian_core` keeps a dispatched action in
    // `PendingActions` for the review window so a veto can still reach it, and `approve_action`
    // returns `AlreadyDispatched`. Offering the button was inviting a refusal on the one surface
    // where a wasted signature is most expensive.
    blocks.push({
      check: 'Already dispatched',
      detail:
        'This action has already executed. It stays listed while the review window is open so ' +
        'it can still be vetoed, but it cannot be approved again — the chain would reject the ' +
        'attempt.',
    });
  }
  if (context.now.value > context.action.expiresAt.value) {
    blocks.push({
      check: 'Expiry',
      detail:
        'This action has expired. Approving it would not execute it — it would need ' +
        'proposing again.',
    });
  }
  // §11.8.2 requires the exact batch decoded and displayed. Two states make that impossible,
  // and both block rather than degrade — this is the system's most privileged signature, and
  // R-7's rule is to take the reading that cannot execute a payload.
  if (context.action.calls.length === 0) {
    blocks.push({
      check: 'Empty batch',
      detail:
        'This action carries no calls. An empty batch is not a harmless approval — it means ' +
        'the batch could not be read, and approving it would put your signature behind ' +
        'something nobody has seen.',
    });
  }
  const undecodable = context.action.calls.filter((call) => call.kind === 'undecodable').length;
  if (undecodable > 0) {
    blocks.push({
      check: 'Undecodable call',
      detail:
        `${undecodable} of the ${context.action.calls.length} calls in this batch cannot be ` +
        'decoded, and are shown as raw bytes below. Approving a batch you cannot read is ' +
        'refused here: the guardian powers are the ones that cannot be undone.',
    });
  }
  blocks.push(...conditionBlocks(context.action.power, context.condition, context.playbooks));
  blocks.push(...dispatchBlocks(context));
  if (context.callerHasApproved) {
    // Its own reason, not folded into "not eligible": approving twice is not a no-op to a
    // user who believes they have moved the count.
    blocks.push({
      check: 'Already approved',
      detail:
        'You have already approved this action. Approving again does not add to the count, ' +
        'and the threshold has not been reached yet.',
    });
  }
  return blocks;
}

/**
 * The rest of `check_and_consume`, evaluated where the runtime evaluates it.
 *
 * The trigger is E20's named condition and it is not the only one the chain charges at the
 * threshold approval: `check_and_consume` runs inside `dispatch`, so **every** refusal it can
 * raise falls on the fifth guardian. Evaluating one of them and not the rest would fix the
 * reported instance rather than the class — the allowance (`AllowanceExhausted`), the hold
 * window (`DurationTooLong`) and the rerun ledger (`NotRerunnable`, `AlreadyRerun`) all cost
 * the same wasted signature.
 *
 * The evidence is required and keyed on the action's own decoded power, so it cannot be
 * omitted and cannot describe a different action. Supplying the wrong kind blocks, for the
 * same reason a trigger reading for the wrong variant does: a check performed against a
 * different question is not this action's check.
 */
function dispatchBlocks(context: ApprovalContext): readonly GuardianBlock[] {
  const power = context.action.power;
  // An undecodable power has no preconditions this client can name — `conditionBlocks`
  // already refuses the approval outright, and adding a second sentence about a budget for a
  // power nobody could read would be noise on top of a refusal.
  if (power.kind === 'undecodable') return [];
  const name: GuardianPower = power.kind;
  // Only the three metered powers are charged — see `MeteredPower`. Running this on all five
  // let a supplied `used >= limit` refuse an activation the chain would have dispatched.
  const blocks: GuardianBlock[] = isMetered(name)
    ? [...allowanceBlocks(meterFor(context.allowances, name))]
    : [];
  const evidence = context.dispatch;
  const wrongKind = (needed: string): readonly GuardianBlock[] => [
    {
      check: 'Dispatch precondition',
      detail:
        `This action is a ${name} and the chain checks its ${needed} at the threshold ` +
        'approval. The evidence supplied describes something else, so that check has not ' +
        'been performed and the approval is refused rather than collected on it.',
    },
  ];
  switch (power.kind) {
    case 'pause_intake':
      if (evidence.kind !== 'hold') return [...blocks, ...wrongKind('hold window')];
      return [
        ...blocks,
        ...horizonBlocks('The block this pause runs to', power.until.value, evidence.horizon),
      ];
    case 'activate_playbook':
      if (evidence.kind !== 'hold') return [...blocks, ...wrongKind('hold window')];
      return [
        ...blocks,
        ...horizonBlocks('This activation’s expiry block', power.expiry.value, evidence.horizon),
      ];
    case 'delay_once':
    case 'force_rerun':
      if (evidence.kind !== 'rerun') return [...blocks, ...wrongKind('proposal state')];
      return [...blocks, ...rerunBlocks(power.kind, power.pid.value, evidence.proposal)];
    case 'suspend_on_gate':
      // Its only dispatch condition is the gate-breach flag, which `conditionBlocks` owns.
      return evidence.kind === 'not-applicable'
        ? blocks
        : [...blocks, ...wrongKind('gate-breach condition')];
  }
}

/**
 * The condition an action's own power depends on, checked against the evidence supplied.
 *
 * Three refusals, and the middle one is the one a runtime `if` on the trigger variant alone
 * would have missed: evidence for the **wrong** condition. A reading of `LedgerDrift` supplied
 * for an activation naming `GateBreach` is a check that ran against a different question, and
 * a check that ran against a different question is a check that did not run.
 */
function conditionBlocks(
  power: PendingPower,
  evidence: ConditionEvidence,
  playbooks: PlaybookAdmissibility,
): readonly GuardianBlock[] {
  if (power.kind === 'undecodable') {
    return [
      {
        check: 'Undecodable power',
        detail:
          `This action's power could not be decoded (${power.reason}), so which condition it ` +
          'depends on is unknown and none of its preconditions can be evaluated. The raw ' +
          'bytes are shown; the approval is refused rather than offered on checks that ' +
          'cannot run.',
      },
    ];
  }
  return [...playbookBlocks(power, playbooks), ...triggerConditionBlocks(power, evidence)];
}

/**
 * `BadPlaybookTrigger` and `BadPlaybookTarget`, evaluated on the flow that can meet them.
 *
 * The propose flow has checked the pairing since 2026-08-08 and the approve flow checked
 * neither — which is the wrong way round, because **`propose_action` validates nothing on
 * chain** (`guardian-core/src/lib.rs`). Both refusals fall on the *threshold* approver, inside
 * `check_and_consume`, so a mispaired action created by any other tool sits in
 * `Guardian.PendingActions` for three days looking approvable, and the five signatures spent
 * on it buy a revert.
 *
 * The client's own propose flow cannot produce either shape — `guardianCall` derives `trigger`
 * and `target` from the evaluated reading — so these are checks on **somebody else's**
 * bytes, which is exactly what an approval is.
 *
 * The two-sided target rule has three halves and only one of them lives here. `Some` on a
 * non-VOID playbook is refused below; `None` on `PB-ORACLE-VOID` is refused by
 * `subjectMismatch`, because `requiredCondition` gives it the unaskable `UNNAMED_COHORT`; and
 * a target naming the *wrong* cohort is refused there too. Splitting them is deliberate — the
 * remedies differ, and one sentence for three states says nothing useful about any of them.
 */
function playbookBlocks(
  power: Exclude<PendingPower, { kind: 'undecodable' }>,
  playbooks: PlaybookAdmissibility,
): readonly GuardianBlock[] {
  if (power.kind !== 'activate_playbook') {
    // The mirror, and it blocks for the reason the missing evidence does: an activation's
    // admissibility supplied for a `delay_once` means two actions have been confused, and
    // ignoring it approves whichever one the rest of the context happens to describe.
    return playbooks.kind === 'not-applicable'
      ? []
      : [
          {
            check: 'Playbook admissibility',
            detail:
              `Playbook registration and activation records were supplied for ${power.kind}, ` +
              'and only activate_playbook is dispatched through either. Two different actions ' +
              'have been confused, so this is refused rather than ignored.',
          },
        ];
  }
  if (playbooks.kind !== 'activation') {
    return [
      {
        check: 'Playbook admissibility',
        detail:
          'This action activates a playbook, and the chain checks the playbook’s registration ' +
          'and its active record at the threshold approval. No such evidence was supplied, so ' +
          'those checks have not been performed and the approval is refused rather than ' +
          'collected on checks that did not run.',
      },
    ];
  }
  const blocks: GuardianBlock[] = [
    ...registrationBlocks(power.id.value, playbooks.registration),
    ...activeRecordBlocks(power.id.value, playbooks.active),
  ];
  const id = power.id.value;
  const named = power.trigger.value;
  if (!PLAYBOOK_TRIGGERS[id].includes(named)) {
    blocks.push({
      check: 'Trigger',
      detail:
        `${id} is not activated by the ${named} condition, and this action pairs them. Each ` +
        'playbook answers a specific failure and the chain refuses any other pairing at the ' +
        'threshold approval, so the five signatures before yours bought a revert and yours ' +
        'would too. It cannot be repaired by approving — it needs proposing again.',
    });
  }
  if (id !== 'PB-ORACLE-VOID' && power.target !== undefined) {
    blocks.push({
      check: 'Cohort target',
      detail:
        `${id} carries a cohort target (${power.target.value}), and only PB-ORACLE-VOID takes ` +
        'one. The chain refuses any other playbook with a target at the threshold approval, ' +
        'so this action cannot execute whatever its condition says.',
    });
  }
  return blocks;
}

/**
 * `PlaybookNotRegistered`, evaluated where the pallet evaluates it.
 *
 * `approve_action` reads `PlaybookRegistered::<T>::get(id)` **after** counting the approval
 * that reaches the threshold, so the guardian this refuses is the fifth one — and the whole
 * extrinsic reverts inside `with_storage_layer`, so their signature buys nothing at all.
 *
 * All six playbooks are registered at genesis (02 §7.4), which is exactly why an `unread`
 * blocks rather than assuming the common case: *"usually true"* is the shape of every check
 * that has quietly stopped running, and INV-FE-12 makes an unproven capability absent.
 *
 * It says nothing about the trigger. 06 §6.2 makes registration **admissibility**, and an
 * activation of a registered playbook whose condition is dead is still refused — by
 * `triggerConditionBlocks`, from the reading `TRIGGER_READS` binds, which names neither of
 * these two surfaces.
 */
function registrationBlocks(
  id: PlaybookId,
  reading: RegistrationReading,
): readonly GuardianBlock[] {
  if (reading.kind === 'unread') {
    return [
      {
        check: 'Playbook registration',
        detail:
          `Whether ${id} is registered on this chain could not be read (${reading.reason}). ` +
          'The chain checks it after the fifth approval is counted and reverts the whole ' +
          'extrinsic if it is off, so an approval collected now may be a signature toward ' +
          'nothing — it is refused rather than offered on a check that did not run.',
      },
    ];
  }
  return reading.registered.value
    ? []
    : [
        {
          check: 'Playbook registration',
          detail:
            `${id} is not registered on this chain. Registration is a values-governed toggle ` +
            'over the six routines (06 §6.2), and the chain refuses the activation after the ' +
            'fifth approval is counted, reverting the whole extrinsic. Re-registering it is a ' +
            'governance action, not something approving can repair.',
        },
      ];
}

/**
 * `PlaybookAlreadyActive`, which is **one playbook's refusal and not every playbook's**.
 *
 * `dispatch` refuses re-activation only when the id is already in `ActivePlaybooks` *and* is
 * `PB-LEDGER-FREEZE`; every other playbook upserts its record and renews in place, consuming
 * no slot (06 §6.2's *"renew by re-activation while triggered"*). 02 §7.4 states the forbidden
 * reading directly: *"a client that reads mere presence as blocking refuses five lawful
 * renewals"*.
 *
 * The `unread` arm is narrowed the same way, and that is not a softening. A read that decides
 * nothing about an action cannot make that action unsafe by failing — blocking a `PB-RESERVE`
 * renewal because `ActivePlaybooks` was unreadable would refuse what the chain accepts, which
 * is the same defect as refusing it on presence, arrived at through a failure instead of a
 * value.
 */
function activeRecordBlocks(
  id: PlaybookId,
  reading: ActivePlaybookReading,
): readonly GuardianBlock[] {
  if (id !== 'PB-LEDGER-FREEZE') return [];
  if (reading.kind === 'unread') {
    return [
      {
        check: 'Playbook already active',
        detail:
          `Whether a ${id} record is already active could not be read (${reading.reason}). ` +
          'That playbook is the one the chain refuses to re-activate — it renews only through ' +
          'a values referendum (06 §6.3) — so an unreadable record set is not something this ' +
          'client will approve past.',
      },
    ];
  }
  return reading.ids.value.includes(id)
    ? [
        {
          check: 'Playbook already active',
          detail:
            `${id} already has an active record. It is the one playbook the chain refuses to ` +
            're-activate: every other playbook renews by being activated again while its ' +
            'trigger holds, but a ledger freeze is renewed only through a values referendum ' +
            '(06 §6.3). The chain raises this after the fifth approval is counted.',
        },
      ]
    : [];
}

/** The trigger half of `check_and_consume`, against the evidence supplied. */
function triggerConditionBlocks(
  power: Exclude<PendingPower, { kind: 'undecodable' }>,
  evidence: ConditionEvidence,
): readonly GuardianBlock[] {
  const required = requiredCondition(power);
  if (required === undefined) {
    // The mirror, and it blocks for the same reason the missing one does. Evidence supplied for
    // a power that is not condition-gated means two actions have been confused, and ignoring it
    // approves whichever action the rest of the context happens to describe.
    return evidence.kind === 'no-condition'
      ? []
      : [
          {
            check: 'Trigger condition',
            detail:
              `A trigger reading was supplied for ${power.kind}, and only activate_playbook ` +
              'and suspend_on_gate depend on one. Two different actions have been confused, ' +
              'so this is refused rather than ignored.',
          },
        ];
  }
  if (evidence.kind === 'no-condition') {
    return [
      {
        check: 'Trigger condition',
        detail:
          `This approval states that no condition applies, and ${power.kind} is admissible ` +
          `only while the ${required.trigger} condition is verifiably active. The condition ` +
          'was therefore never evaluated, and an approval whose condition was not checked is ' +
          'refused here rather than collected on a check that did not run.',
      },
    ];
  }
  const mismatch = subjectMismatch(required, evidence.reading.subject);
  if (mismatch !== undefined) return [{ check: 'Trigger condition', detail: mismatch }];
  const refusal = triggerRefusal(evidence.reading);
  return refusal === undefined
    ? []
    : [
        {
          check: 'Trigger condition',
          detail:
            `${refusal} The chain enforces this at the threshold approval, so an approval ` +
            'collected now is a signature toward an action it would refuse.',
        },
      ];
}

/** The condition a decoded pending power depends on, or `undefined` when it has none. */
function requiredCondition(power: PendingPower): TriggerSubject | undefined {
  switch (power.kind) {
    case 'activate_playbook': {
      const named = power.trigger.value;
      // 06 §6.2 requires `Some` for the VOID playbook, so an action naming that trigger and no
      // target is one the chain refuses with `BadPlaybookTarget` — reported here as an
      // unaskable question rather than silently read against the whole map.
      return named === 'OracleDeadlock'
        ? { trigger: 'OracleDeadlock', cohort: power.target?.value ?? UNNAMED_COHORT }
        : { trigger: named };
    }
    case 'suspend_on_gate':
      // 06 §5.2: "freeze the execution queue **while a hard-gate daily breach flag is
      // active**", and `check_and_consume` refuses with `TriggerInactive` otherwise
      // (`guardian-core/src/lib.rs:884-886`). §11.8.2's row does not name this precondition;
      // doc 06 and doc 11 disagree, and the fail-closed reading is implemented here.
      return { trigger: 'GateBreach' };
    default:
      return undefined;
  }
}

/**
 * A cohort id no activation can name, used when a VOID action carries no target.
 *
 * Negative because cohort ids are `u32` on chain, so no reading can be keyed to this value and
 * the mismatch below always fires. The alternative — treating a missing target as "any cohort"
 * — is exactly the non-emptiness reading 11 §11.8.2 forbids.
 */
const UNNAMED_COHORT = -1;

/** Why the evidence answers a different question from the one the action asks. */
function subjectMismatch(
  required: TriggerSubject,
  supplied: TriggerSubject,
): string | undefined {
  if (required.trigger !== supplied.trigger) {
    return (
      `This action depends on the ${required.trigger} condition and the reading supplied is ` +
      `for ${supplied.trigger}. A check performed against a different question is not this ` +
      'action’s check, so it is refused rather than counted.'
    );
  }
  if (required.trigger === 'OracleDeadlock' && supplied.trigger === 'OracleDeadlock') {
    if (required.cohort === UNNAMED_COHORT) {
      return (
        'This VOID activation names no cohort, and the deadlock condition is read for one ' +
        'exact cohort. One failed cohort never authorizes VOID of another, so there is no ' +
        'question to ask on its behalf and the approval is refused.'
      );
    }
    if (required.cohort !== supplied.cohort) {
      return (
        `This activation acts on cohort ${required.cohort} and the deadlock reading supplied ` +
        `was taken for cohort ${supplied.cohort}. One failed cohort never authorizes VOID of ` +
        'another (05 §4.7; 07 §10), so this reading says nothing about the action.'
      );
    }
  }
  return undefined;
}

export interface ApprovalContext {
  readonly action: PendingAction;
  /**
   * The resolved justification document — §11.8.2 via §11.8.1's evidence rules.
   *
   * Required, and a **state** rather than an optional string: an optional field would let a
   * console render nothing and read as "no justification was filed", which is a different
   * fact from "this device could not fetch it". `EvidenceState` keeps them apart.
   */
  readonly justification: EvidenceState;
  readonly callerIsMember: boolean;
  readonly callerHasApproved: boolean;
  readonly now: Verified<number>;
  /**
   * E20's V-facet, third item — *"allowance meters"*. Required, and the whole book rather
   * than one meter, so the figure shown beside an action is the one for **that action's**
   * power. `check_and_consume` charges the allowance inside `dispatch`, so the approver who
   * meets an exhausted meter is the fifth one.
   */
  readonly allowances: AllowanceBook;
  /**
   * E20's V-facet, fourth item, and its F-facet — *"trigger-condition status"*.
   *
   * Required. An optional field here is an evaluation that defaults to *nothing was wrong*,
   * on the one action where the default is a wasted 5-of-7 signature.
   */
  readonly condition: ConditionEvidence;
  /**
   * Everything else `check_and_consume` charges at the threshold approval — see
   * `dispatchBlocks`. Required for the same reason `condition` is.
   */
  readonly dispatch: DispatchEvidence;
  /**
   * The two playbook reads contract v30 froze — see `PlaybookAdmissibility`.
   *
   * Required, and keyed on the action's own decoded power like every other evidence field
   * here, because these refusals live **one frame above** `check_and_consume` — in `dispatch`
   * and in the pallet — and both fall on the threshold approver. They were `blocking`
   * unreadable obligations on row `O-3` for one day, which closed the approve control
   * outright; now they are evaluated, and the scoping the obligations carried is
   * `playbookBlocks`' rather than the row's.
   */
  readonly playbooks: PlaybookAdmissibility;
}

/**
 * Whether a playbook may be activated.
 *
 * `unread` is treated exactly as `inactive`. Any other reading puts "we could not check"
 * on the same side as "we checked and it holds", on the one power whose entire
 * justification is that the trigger is live right now.
 *
 * Derived from `triggerRefusal` rather than switching on `kind` a second time: the two
 * agreed by construction while both were hand-written switches, and *"may act"* and *"the
 * sentence for why not"* drifting apart is a control that says one thing and does another.
 * One decides; the other reports what it decided.
 */
export function mayActivatePlaybook(trigger: TriggerState): boolean {
  return triggerRefusal(trigger) === undefined;
}

/**
 * 11 §11.8.2's trigger table, as data: the frozen `CRITICAL_SURFACE` items that establish
 * each `PlaybookTrigger` variant (contract v29, SQ-730).
 *
 * The specification names one row per variant; this is that row's read side, so a client
 * reads rather than invents on the one action that costs a 5-of-7 signature before the chain
 * refuses it. `DepegMedian` maps to the **empty** list, which is not an omission — see
 * `TriggerState.unavailable`.
 *
 * Two entries share `storage.epoch.pending_oracle_voids` under different predicates
 * (`contains_key(target)` for `OracleDeadlock`, non-empty for `VoidInFlight`), and two share
 * `storage.constitution.phase_flags` under different bits (6 for `DeadMan`, 7 for
 * `ReserveHealth`). `GateBreach` needs `storage.epoch.epoch_of` alongside its flag map,
 * because `GateBreachFlags` is epoch-keyed and undecidable alone.
 *
 * **`triggerRefusal` reads this table, and that is what makes it a control rather than a
 * comment.** Until 2026-08-07 nothing in `src/` consulted it — the mapping was mirrored from
 * the specification, exported, and derived from by no code at all, so a caller reporting a
 * variant `active` was simply believed. An empty read list now refuses the activation
 * outright, which is the one case where believing the caller costs a 5-of-7 signature on a
 * condition no frozen surface can report.
 */
export const TRIGGER_READS: Readonly<Record<PlaybookTrigger, readonly SurfaceId[]>> =
  Object.freeze({
    DepegMedian: Object.freeze([]),
    MigrationHalt: Object.freeze(['storage.execution_guard.migration_halt'] as SurfaceId[]),
    OracleDeadlock: Object.freeze(['storage.epoch.pending_oracle_voids'] as SurfaceId[]),
    GateBreach: Object.freeze([
      'storage.welfare.gate_breach_flags',
      'storage.epoch.epoch_of',
    ] as SurfaceId[]),
    DeadMan: Object.freeze(['storage.constitution.phase_flags'] as SurfaceId[]),
    VoidInFlight: Object.freeze(['storage.epoch.pending_oracle_voids'] as SurfaceId[]),
    ReserveHealth: Object.freeze(['storage.constitution.phase_flags'] as SurfaceId[]),
    LedgerDrift: Object.freeze(['storage.ledger.ledger_drifted'] as SurfaceId[]),
  });

/** Fixed copy for the one trigger no runtime condition sets (06 §6.2). */
export const DEPEG_TRIGGER_UNAVAILABLE =
  'The depeg trigger is unavailable in this runtime. It needs an authoritative attested ' +
  'price source, an exact 30-day-median formula and a latch lifecycle, none of which is ' +
  'specified yet — so no on-chain condition sets it and PB-DEPEG cannot be activated. A ' +
  'monitoring observation is explicitly not a substitute (06 §6.2).';

/**
 * The one playbook whose trigger is live and whose call set is empty (06 §6.2; 11 §11.8.2).
 *
 * §11.8.2's `MigrationHalt` row: *"§6.2 gives this playbook an **empty** admissible call set
 * on the pinned SDK line, so an active trigger still admits no dispatchable activation"*.
 *
 * **It blocks, on both flows, and the comment that used to stand here said the opposite.**
 * That comment claimed the runtime accepts the activation and that refusing it would be this
 * client refusing an action the chain would run. The runtime does not accept it. 06 §6.2 is
 * normative and exact: *"A playbook row whose admissible call set is empty has no dispatchable
 * activation: a fifth approval reaching it fails closed, the whole extrinsic reverts, and
 * nothing is recorded."* The runtime implements that — `playbook_calls(Migration, …)` returns
 * `Err("PB-MIGRATION cursor retry has no EmergencyPlaybook-safe runtime call")`
 * (`runtime/bleavit-runtime/src/configs.rs`), reached through
 * `approve_action` → `EffectDispatcher::dispatch` inside a `with_storage_layer`, so the
 * approval that gets there is reverted whole.
 *
 * Admitting the *propose* to preserve the record that a council wanted to act does not
 * survive the same sentence: **nothing is recorded**, so there is no record to preserve, and
 * walking five of seven guardians to a guaranteed revert is what §11.4 rule 1 exists to
 * prevent. The condition is release-fixed on the pinned SDK line and needs no chain read, so
 * it sits beside `DEPEG_TRIGGER_UNAVAILABLE` in `triggerRefusal` — one place, consulted by the
 * propose flow, the approve flow and `mayActivatePlaybook` alike.
 *
 * The trigger itself is still rendered honestly: `storage.execution_guard.migration_halt` is a
 * real read and `MigrationHalt` is a real condition. What the refusal says is that no guardian
 * action follows from it.
 */
export const MIGRATION_NO_ACTION_FOLLOWS =
  'The migration-halt playbook has an empty admissible call set on this runtime line, so ' +
  'activating it dispatches nothing. The chain does not accept the activation either: the ' +
  'fifth approval fails closed, the whole extrinsic reverts and nothing is recorded (06 ' +
  '§6.2). An execution halt is handled by the upgrade path, not by this playbook.';

/**
 * What an operator must be told about a playbook beyond whether its trigger holds.
 *
 * Both sentences are also refusals — `triggerRefusal` returns each one for the playbook's own
 * trigger — so this is the *rendered* form of a block rather than an advisory beside an open
 * control. It stays a separate function because a console shows the sentence next to the
 * playbook it is about, while the block list is one flat set of reasons for the whole action.
 */
export function playbookAdvisory(id: PlaybookId): string | undefined {
  if (id === 'PB-MIGRATION') return MIGRATION_NO_ACTION_FOLLOWS;
  if (id === 'PB-DEPEG') return DEPEG_TRIGGER_UNAVAILABLE;
  return undefined;
}

/**
 * Which triggers each playbook accepts — `guardian_core::trigger_matches`, exactly.
 *
 * The chain refuses a mismatched pair with `BadPlaybookTrigger`, **after** five approvals
 * have been collected. A client holding the enum and not this map builds that call.
 */
export const PLAYBOOK_TRIGGERS: Readonly<Record<PlaybookId, readonly PlaybookTrigger[]>> =
  Object.freeze({
    'PB-DEPEG': Object.freeze(['DepegMedian'] as PlaybookTrigger[]),
    'PB-MIGRATION': Object.freeze(['MigrationHalt'] as PlaybookTrigger[]),
    'PB-ORACLE-VOID': Object.freeze(['OracleDeadlock'] as PlaybookTrigger[]),
    'PB-HALT-INTAKE': Object.freeze(['GateBreach', 'DeadMan', 'VoidInFlight'] as PlaybookTrigger[]),
    'PB-RESERVE': Object.freeze(['ReserveHealth'] as PlaybookTrigger[]),
    'PB-LEDGER-FREEZE': Object.freeze(['LedgerDrift'] as PlaybookTrigger[]),
  });

/**
 * Why a playbook is unavailable, in words a guardian can act on.
 *
 * **`TRIGGER_READS` decides before the arm does**, and that ordering is the point. The table
 * is §11.8.2's own mapping from variant to the frozen item that establishes it, so a variant
 * whose list is empty is one no read can have established — and a caller reporting it
 * `active` is reporting a check that could not have run. Deciding on the arm alone left the
 * client believing whatever it was handed, on the action that costs a 5-of-7 signature.
 */
export function triggerRefusal(trigger: TriggerState): string | undefined {
  const named = triggerOf(trigger);
  const reads = TRIGGER_READS[named];
  if (reads.length === 0) return DEPEG_TRIGGER_UNAVAILABLE;
  // 06 §6.2's empty admissible call set, beside the empty read list and for the same kind of
  // reason: both are fixed by this release rather than read from the chain, and both make the
  // activation one the runtime refuses. `PLAYBOOK_TRIGGERS` binds `MigrationHalt` to
  // `PB-MIGRATION` and to nothing else, and `PB-MIGRATION` to `MigrationHalt` and to nothing
  // else, so refusing the trigger refuses exactly that playbook — a bijection the suite
  // asserts, because if the map ever grew this refusal would be keyed to the wrong thing.
  if (named === 'MigrationHalt') return MIGRATION_NO_ACTION_FOLLOWS;
  switch (trigger.kind) {
    case 'active':
      return undefined;
    case 'inactive':
      return (
        'This playbook’s on-chain trigger is not active. A playbook is admissible only ' +
        'while its condition holds — this is not a delay, it is the condition being absent.'
      );
    case 'unread':
      return (
        `This playbook’s trigger could not be read (${trigger.reason}). It is treated as ` +
        'not active: a condition this client could not establish is not one it will act on.'
      );
    case 'unavailable':
      // The table names a read for this variant, so *unavailable* is not something this
      // release can say about it. Refused rather than believed: the caller has described a
      // runtime this client can see is not the one it is talking to, and acting on the
      // rest of the form would act on the same mistake.
      return (
        `This client reports the ${triggerOf(trigger)} trigger as unavailable, and the ` +
        `specification binds it to ${reads.join(', ')}. A trigger with a read behind it is ` +
        'either active, inactive or unread, so this state cannot be acted on.'
      );
  }
}

/**
 * §11.8.2's required statement about an unratified action.
 *
 * Fixed in-bundle copy, returned for **every** power rather than only for playbooks,
 * because the retrospective review applies to every executed guardian action and the
 * exposure is the guardian's own bond.
 */
export const UNRATIFIED_CONSEQUENCE =
  'Every guardian action you execute is automatically scheduled for a retrospective ' +
  'ratification vote. If that vote does not pass, half your bond is slashed and you are ' +
  'recalled. This is a consequence for you personally, not for the protocol, and it applies ' +
  'whether or not the action turns out to have been correct.';

/**
 * How much of this power's allowance is left — a value derived from **two** reads.
 *
 * Returns a `Combined<number>` rather than a number, so the two ways the figure can be
 * unsound cannot be dropped on the floor:
 *
 * - `used` from a provider and `limit` from the light client makes the difference
 *   *unverified*, and it must not inherit `limit`'s badge (INV-FE-1);
 * - the two read at *different blocks* makes the difference true of neither, which no badge
 *   can express — so `combine` refuses, and `proposalBlocks` turns that refusal into a block.
 *
 * Fail-closed by construction: a guardian power whose remaining allowance this client cannot
 * establish is not offered. These are the five most privileged actions in the system, and
 * "we could not check the budget" is not a reason to spend it.
 */
export function allowanceRemaining(meter: AllowanceMeter): Combined<number> {
  // Never negative: a meter that has somehow overrun reads as zero remaining rather than
  // as a negative that arithmetic elsewhere would treat as headroom.
  return combine2(meter.limit, meter.used, (limit, used) => Math.max(0, limit - used));
}

/* ------------------------------------------------ §11.8.2's ratification tracker */

/**
 * The four frozen guardian events that move an executed action through its review.
 *
 * §11.8.2's fourth element — *"every executed action's auto-scheduled `ratify`-track
 * retrospective review, with the 50%-bond-slash + recall consequence of an unratified
 * action stated"* — was the one element of the console with no model at all. The
 * consequence copy existed (`UNRATIFIED_CONSEQUENCE`); nothing tracked whether a given
 * action's review had been scheduled, had passed, or had failed.
 *
 * These are 02 §6's names and shapes, verified against the pallet's own declarations:
 * `ReviewScheduled { action, referendum }`, `ActionRatified { action }`,
 * `ReviewFailed { action, slashed_each }`, `RecallScheduled { action, referendum }`.
 *
 * **`RecallEnacted` is deliberately not one of them.** It carries the removed seats and is
 * a fact about *membership*, not about this action's ratification state — an action whose
 * recall has enacted is still, and permanently, an action whose review failed. Folding it
 * in would make the tracker say something different about the same review depending on
 * whether an unrelated referendum had concluded.
 */
export type RatificationEventVariant =
  | 'ReviewScheduled'
  | 'ActionRatified'
  | 'ReviewFailed'
  | 'RecallScheduled';

export interface RatificationEvent {
  readonly variant: RatificationEventVariant;
  readonly actionId: string;
  /** Present on `ReviewScheduled` and `RecallScheduled`; absent on the terminal two. */
  readonly referendum?: number | undefined;
  /** Present on `ReviewFailed` — what each approver lost. */
  readonly slashedEach?: bigint | undefined;
}

/**
 * What `Referenda.ReferendumInfoFor` says about the review referendum.
 *
 * The events cannot answer this: between `ReviewScheduled` and whichever terminal event
 * follows, the only source for *where the review has got to* is the referendum itself. The
 * `unread` arm is the same fail-closed device `TriggerState` uses — a review this client
 * could not read is not one it will describe as going well.
 */
export type ReviewReferendum =
  | { readonly kind: 'ongoing'; readonly ayes: Verified<bigint>; readonly nays: Verified<bigint> }
  | { readonly kind: 'concluded' }
  | { readonly kind: 'unread'; readonly reason: string };

/**
 * Where an executed action stands in its retrospective review.
 *
 * The arm that matters is **`unobserved`**, and getting it wrong is the defect a naive
 * implementation ships. §11.8.2 says the review is *auto-scheduled* — every executed action
 * has one — so an action with no `ReviewScheduled` in the ingested window does **not** mean
 * "no review is required". It means this client has not seen it. Rendering that as *"not
 * subject to ratification"* would tell a guardian their exposure has ended when it has not,
 * about their own bond, which is precisely the direction §11.8.2 requires stated.
 */
export type ActionRatification =
  | {
      /** No `ReviewScheduled` in the ingested history. A coverage gap, never a verdict. */
      readonly kind: 'unobserved';
    }
  | {
      readonly kind: 'pending';
      readonly referendum: number;
      readonly review: ReviewReferendum;
    }
  | { readonly kind: 'ratified' }
  | {
      readonly kind: 'failed';
      readonly slashedEach: bigint | undefined;
      /** The recall referendum, once one has been scheduled. */
      readonly recall: number | undefined;
    }
  | {
      /**
       * Two terminal events for one action — chain-impossible, so the stream is mis-keyed.
       *
       * Refused rather than resolved by precedence. Picking one would report a definite
       * outcome derived from an ingest this client has just shown itself unable to trust,
       * and the wrong half of that coin tells a guardian their bond is safe.
       */
      readonly kind: 'contradictory';
      readonly reason: string;
    };

/**
 * Fold the four events for one action, with the referendum read filling the interim.
 *
 * Events are filtered by `actionId` here rather than by the caller, because an action id is
 * the only thing that binds these events together and a caller that filtered loosely would
 * fold another action's `ReviewFailed` into this one's verdict.
 */
export function ratificationFor(
  actionId: string,
  events: readonly RatificationEvent[],
  review: ReviewReferendum,
): ActionRatification {
  const mine = events.filter((event) => event.actionId === actionId);
  const ratified = mine.some((event) => event.variant === 'ActionRatified');
  const failed = mine.find((event) => event.variant === 'ReviewFailed');
  if (ratified && failed !== undefined) {
    return {
      kind: 'contradictory',
      reason:
        `Action ${actionId} carries both ActionRatified and ReviewFailed. A review has one ` +
        'outcome, so these cannot both be about this action — the event stream is keyed ' +
        'wrongly, and no verdict is reported from it.',
    };
  }
  if (ratified) return { kind: 'ratified' };
  if (failed !== undefined) {
    const recall = mine.find((event) => event.variant === 'RecallScheduled');
    return {
      kind: 'failed',
      slashedEach: failed.slashedEach,
      recall: recall?.referendum,
    };
  }
  const scheduled = mine.find((event) => event.variant === 'ReviewScheduled');
  if (scheduled === undefined || scheduled.referendum === undefined) {
    return { kind: 'unobserved' };
  }
  return { kind: 'pending', referendum: scheduled.referendum, review };
}

/** What a guardian is told about this action's review. Fixed copy, one sentence per arm. */
export function ratificationCopy(state: ActionRatification): string {
  switch (state.kind) {
    case 'unobserved':
      return (
        'No ratification referendum for this action appears in the history this client has ' +
        'ingested. Every executed guardian action has one scheduled automatically, so this ' +
        'is a gap in what this device has seen — not a statement that none exists, and not ' +
        'an indication that your exposure has ended.'
      );
    case 'pending':
      return (
        'The retrospective review is live. Until it passes, the consequence of it failing ' +
        'stands: half your bond and your seat.'
      );
    case 'ratified':
      return 'The retrospective review passed. This action is ratified and no recall follows.';
    case 'failed':
      return (
        'The retrospective review did not pass. Half the bond of every approver has been ' +
        'slashed, and a recall referendum follows on the guardian track.'
      );
    case 'contradictory':
      return state.reason;
  }
}

/* -------------------------------------------- §11.8.2's power-specific argument forms */

/**
 * The six playbooks 06 §6.2 registers, by their document ids.
 *
 * Closed, and it must be: `target` and the admissible trigger set are both keyed on the
 * **playbook**, not on the trigger, so a free-form id would let a form build either wrong.
 */
export type PlaybookId =
  | 'PB-DEPEG'
  | 'PB-MIGRATION'
  | 'PB-ORACLE-VOID'
  | 'PB-HALT-INTAKE'
  | 'PB-RESERVE'
  | 'PB-LEDGER-FREEZE';

export type PlaybookTrigger =
  | 'DepegMedian'
  | 'MigrationHalt'
  | 'OracleDeadlock'
  | 'GateBreach'
  | 'DeadMan'
  | 'VoidInFlight'
  | 'ReserveHealth'
  | 'LedgerDrift';

/**
 * The arguments each power carries — one call, five argument sets.
 *
 * §11.8.2 asks for *"power-specific forms for `pause_intake`, `delay_once`, `force_rerun`,
 * `activate_playbook`, `suspend_on_gate`"*, and the console rendered one generic form for
 * all five. That reads as five equivalent buttons when the powers take entirely different
 * arguments — `suspend_on_gate` takes none at all, while `activate_playbook` takes four.
 *
 * **This is one dispatchable, not five** (SQ-621, resolved by reading the runtime rather
 * than the sentence): `guardian.propose_action(power, justification_hash)` takes a
 * `GuardianPower` **enum** whose variants carry the fields below. Five call shapes would be
 * five extrinsics with five indices; the pallet has one. So a "form" here selects a variant
 * and fills that variant's fields, which is what this union makes structural — a caller
 * cannot supply `pid` for `pause_intake`, because that arm has no such field.
 *
 * Field names and types are the runtime's own (`guardian_core::GuardianPower`), not names
 * chosen here: `PauseIntake { until }`, `DelayOnce { pid }`, `ForceRerun { pid }`,
 * `ActivatePlaybook { id, trigger, expiry, target }`, `SuspendOnGate`.
 *
 * **It is an output, not an input.** `trigger` and `target` are *derived* by `guardianCall`
 * from the reading the client actually performed, so the branded `GuardianCall` below is the
 * only value a submitter accepts and no screen can hand-assemble one.
 */
export type PowerArguments =
  | { readonly power: 'pause_intake'; readonly until: number }
  | { readonly power: 'delay_once'; readonly pid: string }
  | { readonly power: 'force_rerun'; readonly pid: string }
  | {
      readonly power: 'activate_playbook';
      readonly id: PlaybookId;
      readonly trigger: PlaybookTrigger;
      readonly expiry: number;
      /**
       * PB-ORACLE-VOID's cohort target, and the rule is **two-sided**.
       *
       * `guardian_core` requires `Some` for `PlaybookId::OracleVoid` and `None` for every
       * other playbook (`BadPlaybookTarget`), and it keys that on the **playbook id**, not
       * on the trigger. It is optional in the type because five of six arms must omit it.
       */
      readonly target?: number | undefined;
    }
  | { readonly power: 'suspend_on_gate' };

declare const DERIVED_CALL: unique symbol;

/**
 * `propose_action`'s first argument, as this client is allowed to produce it.
 *
 * Branded with a module-private `unique symbol` — the `Finalized<T>` and `GatePassed`
 * construction — so `guardianCall` is the only producer. The reason is B2 in its general
 * form: while a screen could write the encoded arguments itself, the `trigger` it named and
 * the `trigger` it evaluated were two independent strings, and nothing compared them. A
 * `PB-LEDGER-FREEZE` activation naming `LedgerDrift` while holding a live `GateBreach`
 * reading produced an empty block list and a `ready` control — five signatures on a freeze
 * whose `LedgerDrifted` latch was never read.
 */
export type GuardianCall = PowerArguments & { readonly [DERIVED_CALL]: true };

/**
 * The block window a hold may run to — 06 §5.2's bound, read rather than assumed.
 *
 * `check_and_consume` refuses `PauseIntake.until` and `ActivatePlaybook.expiry` outside
 * `[now, now + HOLD_MAX_BLOCKS]` with `DurationTooLong`, and `HOLD_MAX_BLOCKS` is
 * `Guardian.PlaybookFreezeWindowBlocks` — a frozen constant (02 §9), so the bound is read at
 * B′ and never compiled in (10 §5.4).
 *
 * Two reads, so the ceiling goes through `combine2`: a `now` from one block and a constant
 * from another describes no window, and a window this client cannot establish is not one it
 * will propose an emergency hold under.
 */
export interface HoldHorizon {
  readonly now: Verified<number>;
  readonly maxBlocks: Verified<number>;
}

/**
 * `futarchy_primitives::ProposalState`, as `Epoch.Proposals` stores it (02 §7.1).
 *
 * Carried raw rather than pre-classified, because the classification is the runtime's and a
 * caller allowed to perform it is a caller allowed to get it wrong: `delay_once` needs
 * exactly `Queued` while `force_rerun` needs `ProposalStatus::rerunnable()`, and the two
 * differ. `guardianStatus` below is the runtime's own projection
 * (`configs.rs::RuntimeGuardianStatus::status`).
 */
export type ProposalStateName =
  | 'Submitted'
  | 'Screening'
  | 'Qualified'
  | 'Trading'
  | 'Extended'
  | 'Queued'
  | 'Suspended'
  | 'Rerun'
  | 'Rejected'
  | 'Executed'
  | 'FailedExecuted'
  | 'Measuring'
  | 'Settled'
  | 'Cancelled'
  | 'Expired';

/** `pallet_guardian::ProposalStatus` — the six-way projection the guardian core sees. */
export type GuardianProposalStatus =
  | 'Trading'
  | 'Extended'
  | 'Queued'
  | 'Executed'
  | 'Rerun'
  | 'Other';

/**
 * The runtime's projection, mirrored — `RuntimeGuardianStatus::status` in `configs.rs`.
 *
 * A restatement, and one a suite binds to its source in both directions: a proposal state
 * added upstream and not mapped here would fall to `Other`, which reads as *not rerunnable*
 * and refuses a lawful action rather than admitting an unlawful one — safe, but silently
 * wrong, and the direction nobody notices until an operator cannot act.
 */
const GUARDIAN_STATUS: Readonly<Record<ProposalStateName, GuardianProposalStatus>> =
  Object.freeze({
    Trading: 'Trading',
    Extended: 'Extended',
    Queued: 'Queued',
    Executed: 'Executed',
    Measuring: 'Executed',
    Settled: 'Executed',
    Rerun: 'Rerun',
    Submitted: 'Other',
    Screening: 'Other',
    Qualified: 'Other',
    Suspended: 'Other',
    Rejected: 'Other',
    FailedExecuted: 'Other',
    Cancelled: 'Other',
    Expired: 'Other',
  });

export function guardianStatus(state: ProposalStateName): GuardianProposalStatus {
  return GUARDIAN_STATUS[state];
}

/** `ProposalStatus::rerunnable` — `Trading | Extended | Queued`, and nothing else. */
export function rerunnable(status: GuardianProposalStatus): boolean {
  return status === 'Trading' || status === 'Extended' || status === 'Queued';
}

/**
 * What `Epoch.Proposals[pid]` says about a proposal a rerun power names.
 *
 * `delay_once` and `force_rerun` reached `ready` on the allowance alone until 2026-08-08,
 * while `check_and_consume` refuses both with `NotRerunnable` (wrong state) or `AlreadyRerun`
 * (`in_rerun`, or the pid already in the guardian's rerun ledger). Every input the runtime
 * uses for the first two is in one frozen storage value, so the client reads it and the model
 * applies the runtime's own predicates.
 *
 * `absent` is its own arm: a pid with no proposal is what the runtime answers
 * `(ProposalStatus::Other, false)` for, and a form that treated it as *nothing known* would
 * offer a delay of something that does not exist.
 */
export type RerunState =
  | {
      readonly kind: 'read';
      readonly state: Verified<ProposalStateName>;
      /** `Proposal.rerun` — this proposal already is a rerun. */
      readonly rerun: Verified<boolean>;
      /** `Proposal.delayed_once` — the once-ever delay has been spent. */
      readonly delayedOnce: Verified<boolean>;
    }
  | { readonly kind: 'absent' }
  | { readonly kind: 'unread'; readonly reason: string };

/**
 * A proposal in flight, as `RuntimeGuardianStatus::status` computes `DispatchContext.in_rerun`.
 *
 * `proposal.rerun || proposal.delayed_once || state ∈ {Suspended, Rerun}` — mirrored exactly,
 * because a client computing a *narrower* condition offers an action the chain refuses with
 * `AlreadyRerun` after five signatures.
 */
function inRerun(reading: Extract<RerunState, { kind: 'read' }>): boolean {
  return (
    reading.rerun.value ||
    reading.delayedOnce.value ||
    reading.state.value === 'Suspended' ||
    reading.state.value === 'Rerun'
  );
}

/**
 * One guardian proposal, complete: the power, its arguments, its allowance and its evidence.
 *
 * **This union is the repair.** `proposalBlocks(meter, trigger)` and
 * `proposeFormBlocks(inputs)` were two functions over three values, each seeing part of one
 * action, and every disagreement between the parts reached `ready`:
 *
 * - a meter for `pause_intake` beside arguments for `activate_playbook` rendered *"Propose a
 *   pause on intake"* over prepared bytes that activate a playbook;
 * - an evaluated `GateBreach` reading beside an argument set naming `LedgerDrift` passed both
 *   functions, because neither held both strings.
 *
 * Now the power is the discriminant, the meter is narrowed to it (`AllowanceMeter<'…'>`), the
 * evidence is a field of the arm, and the encoded call is derived. The three cannot disagree
 * because there is one of each.
 */
export type GuardianProposal =
  | {
      readonly power: 'pause_intake';
      readonly meter: AllowanceMeter<'pause_intake'>;
      readonly until: number;
      readonly horizon: HoldHorizon;
    }
  | {
      readonly power: 'delay_once';
      readonly meter: AllowanceMeter<'delay_once'>;
      readonly pid: string;
      readonly proposal: RerunState;
    }
  | {
      readonly power: 'force_rerun';
      readonly meter: AllowanceMeter<'force_rerun'>;
      readonly pid: string;
      readonly proposal: RerunState;
    }
  | {
      readonly power: 'activate_playbook';
      /**
       * **No meter.** 06 §5.2's Allowance column reads *"per-playbook"* for this power and
       * `check_and_consume` charges nothing — see `MeteredPower`. A meter here was a refusal
       * the chain does not make.
       */
      readonly id: PlaybookId;
      /**
       * The reading this client performed. Its subject **is** the call's `trigger` argument,
       * and — for `OracleDeadlock` — its cohort **is** the call's `target`.
       */
      readonly trigger: TriggerState;
      readonly expiry: number;
      readonly horizon: HoldHorizon;
    }
  | {
      readonly power: 'suspend_on_gate';
      /** No meter either — 06 §5.2 reads *"condition-gated"*, and the condition is below. */
      readonly gate: TriggerState<'GateBreach'>;
    };

/**
 * The encoded `GuardianPower` a proposal describes — derived, never supplied.
 *
 * `trigger` comes from the subject of the reading the client performed and `target` from that
 * subject's cohort, so *the value evaluated and the value dispatched are the same value*. The
 * two-sided `BadPlaybookTarget` rule follows from that rather than being checked: no playbook
 * other than `PB-ORACLE-VOID` admits `OracleDeadlock` (`PLAYBOOK_TRIGGERS`, itself locked to
 * `guardian_core::trigger_matches`), so a target is emitted exactly for the VOID playbook.
 */
export function guardianCall(proposal: GuardianProposal): GuardianCall {
  switch (proposal.power) {
    case 'pause_intake':
      return { power: 'pause_intake', until: proposal.until } as GuardianCall;
    case 'delay_once':
      return { power: 'delay_once', pid: proposal.pid } as GuardianCall;
    case 'force_rerun':
      return { power: 'force_rerun', pid: proposal.pid } as GuardianCall;
    case 'activate_playbook': {
      const subject = proposal.trigger.subject;
      return {
        power: 'activate_playbook',
        id: proposal.id,
        trigger: subject.trigger,
        expiry: proposal.expiry,
        target: subject.trigger === 'OracleDeadlock' ? subject.cohort : undefined,
      } as GuardianCall;
    }
    case 'suspend_on_gate':
      return { power: 'suspend_on_gate' } as GuardianCall;
  }
}

/** The field labels a form renders per power. Closed, so a sixth power cannot be invented. */
export const POWER_FIELDS: Readonly<Record<GuardianPower, readonly string[]>> = Object.freeze({
  pause_intake: Object.freeze(['until (block)']),
  delay_once: Object.freeze(['proposal id']),
  force_rerun: Object.freeze(['proposal id']),
  activate_playbook: Object.freeze(['playbook id', 'trigger', 'expiry (block)', 'cohort target (PB-ORACLE-VOID only)']),
  // Deliberately empty, and rendered as "this power takes no arguments" rather than as an
  // empty form: a form with no fields looks like one that failed to load.
  suspend_on_gate: Object.freeze([]),
});

/** A proposal is `propose_action(power, justification_hash)` — the hash is never optional. */
export interface ProposeInputs {
  readonly proposal: GuardianProposal;
  /**
   * `propose_action`'s second argument. Absent is a refusal, not a default: §11.8.2's
   * pending list renders this hash and resolves the document behind it, so an action
   * proposed without one is one no guardian can review the justification of.
   */
  readonly justificationHash: string | undefined;
}

/**
 * Everything blocking `guardian.propose_action` — **one function over one value**.
 *
 * It was two: `proposalBlocks(meter, trigger)` and `proposeFormBlocks(inputs)`, composed by
 * the screen. Each was individually correct and the pair was the defect, because the trigger
 * the first evaluated and the trigger the second validated were different strings nobody
 * compared. Splitting a check across two functions that see different halves of one action is
 * how *"nothing evaluated it"* survives a review that reads both functions.
 *
 * The blocks below are every refusal `guardian_core::check_and_consume` can raise for a power,
 * plus the justification argument. §11.8.2's propose row names two preconditions (allowance,
 * and the activation trigger) while the runtime enforces more; the extra ones are implemented
 * fail-closed and the gap is raised rather than assumed away.
 */
export function proposalBlocks(inputs: ProposeInputs): readonly GuardianBlock[] {
  const blocks: GuardianBlock[] = [];
  if (inputs.justificationHash === undefined || inputs.justificationHash.length === 0) {
    blocks.push({
      check: 'Justification',
      detail:
        'A guardian action needs a justification hash. The pending-actions list resolves the ' +
        'document behind it, so proposing without one asks six other guardians to approve ' +
        'something with no stated reason.',
    });
  }
  const proposal = inputs.proposal;
  // The allowance is charged **per metered power**, and only three of the five are metered
  // (`MeteredPower`). It used to be charged unconditionally over a five-power book, which
  // refused a lawful activation on a counter the chain does not keep.
  switch (proposal.power) {
    case 'pause_intake':
      blocks.push(...allowanceBlocks(proposal.meter));
      blocks.push(
        ...horizonBlocks('The block this pause runs to', proposal.until, proposal.horizon),
      );
      break;
    case 'delay_once':
    case 'force_rerun':
      blocks.push(...allowanceBlocks(proposal.meter));
      blocks.push(...rerunBlocks(proposal.power, proposal.pid, proposal.proposal));
      break;
    case 'activate_playbook': {
      const named = triggerOf(proposal.trigger);
      const refusal = triggerRefusal(proposal.trigger);
      if (refusal !== undefined) blocks.push({ check: 'Trigger condition', detail: refusal });
      // The pairing the chain checks as `BadPlaybookTrigger`. A client holding the trigger
      // enum and not this map walks a council through five signatures on a refusal — and
      // because `target` is derived from this same reading, the pairing also settles the
      // two-sided `BadPlaybookTarget` rule.
      if (!PLAYBOOK_TRIGGERS[proposal.id].includes(named)) {
        blocks.push({
          check: 'Trigger',
          detail:
            `${proposal.id} is not activated by the ${named} condition. Each playbook answers ` +
            'a specific failure and the chain refuses any other pairing, so this call would ' +
            'be rejected after signing.',
        });
      }
      blocks.push(
        ...horizonBlocks('This activation’s expiry block', proposal.expiry, proposal.horizon),
      );
      break;
    }
    case 'suspend_on_gate': {
      // 06 §5.2 makes this power condition-gated — "while a hard-gate daily breach flag is
      // active" — and `check_and_consume` refuses it with `TriggerInactive` otherwise. 11
      // §11.8.2's row does not name the precondition, so the two documents disagree; the
      // fail-closed reading is implemented and the disagreement is raised.
      const refusal = triggerRefusal(proposal.gate);
      if (refusal !== undefined) {
        blocks.push({
          check: 'Gate-breach condition',
          detail:
            `${refusal} Suspending the execution queue is admissible only while a hard-gate ` +
            'daily breach flag is set, and it auto-releases when the flag clears (06 §5.2).',
        });
      }
      break;
    }
  }
  return blocks;
}

/** The allowance half of every propose row — fail-closed on a figure this client cannot form. */
function allowanceBlocks(meter: AllowanceMeter): readonly GuardianBlock[] {
  const remaining = allowanceRemaining(meter);
  if (remaining.kind === 'incomparable') {
    return [
      {
        check: 'Allowance',
        detail:
          `This client cannot establish how much ${meter.power} allowance remains. ` +
          `${remaining.reason} Until it can, the power is not offered.`,
      },
    ];
  }
  return remaining.datum.value <= 0
    ? [{ check: 'Allowance', detail: `No ${meter.power} allowance remains in this window.` }]
    : [];
}

/** 06 §5.2's *"≤ 14 days per activation"* bound, as the runtime enforces it. */
function horizonBlocks(
  what: string,
  block: number,
  horizon: HoldHorizon,
): readonly GuardianBlock[] {
  const ceiling = combine2(horizon.now, horizon.maxBlocks, (now, max) => now + max);
  if (ceiling.kind === 'incomparable') {
    return [
      {
        check: 'Hold window',
        detail:
          `This client cannot establish how far ahead a guardian hold may run. ` +
          `${ceiling.reason} Until it can, the power is not offered.`,
      },
    ];
  }
  if (block < horizon.now.value) {
    return [
      {
        check: 'Hold window',
        detail:
          `${what} is ${horizon.now.value - block} blocks in the past. The chain refuses a ` +
          'hold that has already ended, so this call would be rejected after signing.',
      },
    ];
  }
  if (block > ceiling.datum.value) {
    return [
      {
        check: 'Hold window',
        detail:
          `${what} is beyond the longest hold this chain allows (${ceiling.datum.value}). ` +
          'A guardian hold is bounded so it cannot become a standing power, and the chain ' +
          'refuses a longer one after signing.',
      },
    ];
  }
  return [];
}

/** `NotRerunnable` and `AlreadyRerun`, evaluated where the runtime evaluates them. */
function rerunBlocks(
  power: 'delay_once' | 'force_rerun',
  pid: string,
  state: RerunState,
): readonly GuardianBlock[] {
  if (state.kind === 'unread') {
    return [
      {
        check: 'Proposal state',
        detail:
          `Proposal ${pid} could not be read (${state.reason}). A rerun power is admissible ` +
          'only against a proposal in the right state, and a state this client could not ' +
          'establish is not one it will act on.',
      },
    ];
  }
  if (state.kind === 'absent') {
    return [
      {
        check: 'Proposal state',
        detail:
          `No proposal with id ${pid} is on chain, so there is nothing for this power to act ` +
          'on and the chain would refuse the action after signing.',
      },
    ];
  }
  const blocks: GuardianBlock[] = [];
  const status = guardianStatus(state.state.value);
  // The two powers take different states, and collapsing them would offer a `delay_once` on a
  // proposal still trading — which the chain refuses with `NotRerunnable` at the fifth
  // signature. `delay_once` is queued-only; `force_rerun` runs pre-execution.
  const admissible = power === 'delay_once' ? status === 'Queued' : rerunnable(status);
  if (!admissible) {
    blocks.push({
      check: 'Proposal state',
      detail:
        `Proposal ${pid} is ${state.state.value}, and ${power} acts only on a proposal that ` +
        `is ${power === 'delay_once' ? 'queued for execution' : 'still pre-execution'}. The ` +
        'chain refuses any other state after signing.',
    });
  }
  if (inRerun(state)) {
    blocks.push({
      check: 'Rerun already spent',
      detail:
        `Proposal ${pid} has already been delayed or re-run. Each proposal gets one such ` +
        'act ever — the rerun outcome is final and undelayable (06 §5.2/§5.3) — so the ' +
        'chain refuses a second one after signing.',
    });
  }
  return blocks;
}
