// expect-error: TS2353 — 06 §5.2: only three of the five guardian powers are metered
// MUST FAIL: the `activate_playbook` arm of `GuardianProposal` has no `meter` field, because
// the chain keeps no counter for it.
//
// The 2026-08-08 major. 06 §5.2's Allowance column gives `activate_playbook` *"per-playbook"*
// and `suspend_on_gate` *"condition-gated"*; neither is a count against a budget, and
// `guardian_core::check_and_consume` charges no allowance for either — its `ActivatePlaybook`
// arm checks expiry, pairing, target and trigger, and its `SuspendOnGate` arm checks the gate
// flag alone. The chain's own storage says the same thing in its shape: `AllowanceState` is
// `{ delay_used_this_epoch, force_rerun_used_this_epoch, pause_window_start,
//    pause_used_in_window }` — four fields for three powers.
//
// `AllowanceBook` was a total record over all five powers and `allowanceBlocks` ran
// unconditionally, so a supplied `used >= limit` refused a lawful playbook activation. That is
// a client refusing what the runtime **accepts**, which 15 §4.8's dispatch-mirror rule forbids
// in those words — the same defect as offering one the runtime would refuse, pointing the
// other way, and the one that is harder to notice because nothing reverts.
//
// A runtime `if` would have left the wrong shape compiling, and the wrong shape is what a
// caller writes. `MeteredPower` narrows the book, the meter and the arms together, so the
// figure has nowhere to be supplied.
import { proposalBlocks } from '@bleavit/features-tx';
import type { AllowanceMeter, HoldHorizon, TriggerState } from '@bleavit/features-tx';

// Not `AllowanceMeter<'activate_playbook'>`: that type no longer exists, and a fixture that
// failed on the *declaration* would prove the narrowing and not this rule. A real meter for a
// real power is offered to an arm that has no field for one.
declare const meter: AllowanceMeter<'pause_intake'>;
declare const horizon: HoldHorizon;
declare const reading: TriggerState;

export const blocks = proposalBlocks({
  proposal: {
    power: 'activate_playbook',
    meter,
    id: 'PB-HALT-INTAKE',
    trigger: reading,
    expiry: 9_000,
    horizon,
  },
  justificationHash: '0xj',
});
