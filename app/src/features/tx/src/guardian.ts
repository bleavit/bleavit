/**
 * The guardian console — 11 §11.8.2. F17.
 *
 * These are the system's most privileged actors, and every control here exists because a
 * guardian signature is hard to undo.
 *
 * ## A playbook is admissible only under a *verified* trigger
 *
 * E20: *"trigger condition not active at B′ ⇒ blocked (playbooks are admissible only under
 * verified triggers)"*. So `TriggerState` is a union with an **`unread`** arm, and
 * `mayActivatePlaybook` treats `unread` exactly like `inactive`. Collapsing the two would
 * be the familiar fail-open: *not checked* landing on the same side as *checked and fine*,
 * on the one action whose whole justification is that the condition holds right now.
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

import { combine2, type Combined, type Verified } from '@bleavit/shared-types';
import type { EvidenceState } from './evidence.js';

/** The five powers §11.8.2 names. Closed, so a form cannot invent a sixth. */
export type GuardianPower =
  | 'pause_intake'
  | 'delay_once'
  | 'force_rerun'
  | 'activate_playbook'
  | 'suspend_on_gate';

/**
 * Whether a playbook's on-chain trigger holds.
 *
 * `unread` is a real state, not an absence: the read may have failed, and a client that
 * could not establish the trigger must not act as though it holds.
 */
export type TriggerState =
  | { readonly kind: 'active'; readonly since: Verified<number> }
  | { readonly kind: 'inactive' }
  | { readonly kind: 'unread'; readonly reason: string };

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

export interface PendingAction {
  readonly actionId: Verified<string>;
  readonly power: Verified<string>;
  /**
   * What the power acts on — §11.8.2's pending list names `target` alongside the power.
   *
   * A power without its target is not actionable: "delay_once" says a delay is proposed and
   * not *what* is being delayed, and a guardian cannot weigh a `force_rerun` without knowing
   * which cohort it re-runs.
   */
  readonly target: Verified<string>;
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
}

export interface GuardianBlock {
  readonly check: string;
  readonly detail: string;
}

/** Everything blocking `guardian.approve_action`, all of it, in §11.8.2's order. */
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
 * Whether a playbook may be activated.
 *
 * `unread` is treated exactly as `inactive`. Any other reading puts "we could not check"
 * on the same side as "we checked and it holds", on the one power whose entire
 * justification is that the trigger is live right now.
 */
export function mayActivatePlaybook(trigger: TriggerState): boolean {
  return trigger.kind === 'active';
}

/** Why a playbook is unavailable, in words a guardian can act on. */
export function triggerRefusal(trigger: TriggerState): string | undefined {
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

/** Remaining allowance for a power, and whether a proposal fits under it. */
export interface AllowanceMeter {
  readonly power: GuardianPower;
  readonly used: Verified<number>;
  readonly limit: Verified<number>;
}

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
 */
export type PlaybookTrigger =
  | 'DepegMedian'
  | 'MigrationHalt'
  | 'OracleDeadlock'
  | 'GateBreach'
  | 'DeadMan'
  | 'VoidInFlight'
  | 'ReserveHealth'
  | 'LedgerDrift';

export type PowerArguments =
  | { readonly power: 'pause_intake'; readonly until: number }
  | { readonly power: 'delay_once'; readonly pid: string }
  | { readonly power: 'force_rerun'; readonly pid: string }
  | {
      readonly power: 'activate_playbook';
      readonly id: string;
      readonly trigger: PlaybookTrigger;
      readonly expiry: number;
      /**
       * PB-ORACLE-VOID's cohort target. **Every other playbook rejects `Some`**, which is
       * the runtime's rule and not a convention — so it is optional here and a form that
       * offers it for another playbook builds a call the chain refuses.
       */
      readonly target?: number | undefined;
    }
  | { readonly power: 'suspend_on_gate' };

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
  readonly args: PowerArguments;
  /**
   * `propose_action`'s second argument. Absent is a refusal, not a default: §11.8.2's
   * pending list renders this hash and resolves the document behind it, so an action
   * proposed without one is one no guardian can review the justification of.
   */
  readonly justificationHash: string | undefined;
}

/** Blocks that come from the form itself rather than from chain state. */
export function proposeFormBlocks(inputs: ProposeInputs): readonly GuardianBlock[] {
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
  if (
    inputs.args.power === 'activate_playbook' &&
    inputs.args.target !== undefined &&
    inputs.args.trigger !== 'VoidInFlight'
  ) {
    blocks.push({
      check: 'Cohort target',
      detail:
        'Only the VOID playbook takes a cohort target. Every other playbook rejects one on ' +
        'chain, so this call would be refused after signing.',
    });
  }
  return blocks;
}

export function proposalBlocks(
  meter: AllowanceMeter,
  trigger: TriggerState | undefined,
): readonly GuardianBlock[] {
  const blocks: GuardianBlock[] = [];
  const remaining = allowanceRemaining(meter);
  if (remaining.kind === 'incomparable') {
    blocks.push({
      check: 'Allowance',
      detail:
        `This client cannot establish how much ${meter.power} allowance remains. ` +
        `${remaining.reason} Until it can, the power is not offered.`,
    });
  } else if (remaining.datum.value <= 0) {
    blocks.push({
      check: 'Allowance',
      detail: `No ${meter.power} allowance remains in this window.`,
    });
  }
  // Only `activate_playbook` has a trigger; passing one for another power is a caller
  // error rather than a silent no-op, so it is checked when supplied.
  if (trigger !== undefined && !mayActivatePlaybook(trigger)) {
    blocks.push({ check: 'Trigger condition', detail: triggerRefusal(trigger) ?? '' });
  }
  return blocks;
}
