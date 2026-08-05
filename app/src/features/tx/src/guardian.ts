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
  readonly justificationHash: Verified<string>;
  readonly approvals: Verified<number>;
  readonly threshold: Verified<number>;
  readonly expiresAt: Verified<number>;
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
