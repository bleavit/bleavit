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

import type { Verified } from '@bleavit/shared-types';

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

export interface PendingAction {
  readonly actionId: Verified<string>;
  readonly power: Verified<string>;
  readonly justificationHash: Verified<string>;
  readonly approvals: Verified<number>;
  readonly threshold: Verified<number>;
  readonly expiresAt: Verified<number>;
}

export interface ApprovalContext {
  readonly action: PendingAction;
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

export function allowanceRemaining(meter: AllowanceMeter): number {
  // Never negative: a meter that has somehow overrun reads as zero remaining rather than
  // as a negative that arithmetic elsewhere would treat as headroom.
  return Math.max(0, meter.limit.value - meter.used.value);
}

export function proposalBlocks(
  meter: AllowanceMeter,
  trigger: TriggerState | undefined,
): readonly GuardianBlock[] {
  const blocks: GuardianBlock[] = [];
  if (allowanceRemaining(meter) <= 0) {
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
