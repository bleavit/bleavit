// expect-error: TS2322 — 11 §11.8.2: power-specific forms, over the power the call really names
// MUST FAIL: a proposal's allowance meter is narrowed to the arm's own power, so a meter read
// for `delay_once` cannot sit beside a `pause_intake` call.
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
// `GuardianProposal` keys the meter on the arm: `AllowanceMeter<'pause_intake'>` is the only
// meter the pause arm accepts, so the two descriptions cannot disagree.
//
// **The pair used here changed on 2026-08-08 and the rule did not.** It was a `pause_intake`
// meter beside an `activate_playbook` call; that arm now carries no meter at all, because 06
// §5.2 meters three of the five powers and the chain charges nothing for the other two — so
// the mismatch is proven between two *metered* powers, and the unmetered case has its own
// fixture (`guardian-meter-on-an-unmetered-power.ts`).
import { proposalBlocks } from '@bleavit/features-tx';
import type { AllowanceMeter, HoldHorizon } from '@bleavit/features-tx';

declare const delayMeter: AllowanceMeter<'delay_once'>;
declare const horizon: HoldHorizon;

export const blocks = proposalBlocks({
  proposal: {
    power: 'pause_intake',
    meter: delayMeter,
    until: 9_000,
    horizon,
  },
  justificationHash: '0xj',
});
