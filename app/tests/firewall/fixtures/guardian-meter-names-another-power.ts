// expect-error: TS2322 — 11 §11.8.2: power-specific forms, over the power the call really names
// MUST FAIL: a proposal's allowance meter is narrowed to the arm's own power, so a meter read
// for `pause_intake` cannot sit beside an `activate_playbook` call.
//
// The 2026-08-08 blocker. `proposalBlocks` keyed its trigger requirement on `meter.power`
// while `proposeFormBlocks` validated `inputs.args`, and the console rendered
// `POWER_FIELDS[meter.power]` and `POWER_LABEL[meter.power]` over a different action's
// arguments. The reproduction that reached `ready`:
//
//   meter        = { power: 'pause_intake', … }
//   inputs.args  = { power: 'activate_playbook', … }
//   trigger      = { kind: 'no-trigger-power' }
//
// `statesNoTrigger` was true, so the mirror arm was skipped; `proposeFormBlocks` found the
// activation lawful; the panel was titled *"Propose a pause on intake"* and listed
// `until (block)` while the prepared bytes activated a playbook. That also violates
// §11.8.2's *"power-specific forms"* in the same render.
//
// `GuardianProposal` keys the meter on the arm: `AllowanceMeter<'activate_playbook'>` is the
// only meter the activation arm accepts, so the two descriptions cannot disagree.
import { proposalBlocks } from '@bleavit/features-tx';
import type { AllowanceMeter, HoldHorizon, TriggerState } from '@bleavit/features-tx';

declare const pauseMeter: AllowanceMeter<'pause_intake'>;
declare const horizon: HoldHorizon;
declare const reading: TriggerState;

export const blocks = proposalBlocks({
  proposal: {
    power: 'activate_playbook',
    meter: pauseMeter,
    id: 'PB-HALT-INTAKE',
    trigger: reading,
    expiry: 9_000,
    horizon,
  },
  justificationHash: '0xj',
});
