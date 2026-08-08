// expect-error: TS2353 — 11 §11.8.2 rule 1: the client evaluates the variant the proposer selected
// MUST FAIL: an activation cannot name a trigger **beside** the reading it performed, because
// the encoded `trigger` argument is derived from that reading and there is no field to write.
//
// The 2026-08-08 blocker. `proposalBlocks(meter, trigger)` saw only the `TriggerState` and
// `proposeFormBlocks(inputs)` saw only `inputs.args`, so nothing asserted
// `trigger.trigger === inputs.args.trigger`. The reproduction that reached `ready`:
//
//   inputs.args = { power:'activate_playbook', id:'PB-LEDGER-FREEZE', trigger:'LedgerDrift', … }
//   trigger     = { kind:'active', trigger:'GateBreach', since: … }
//
// `triggerRefusal` returned `undefined` (the `GateBreach` reading was live),
// `PLAYBOOK_TRIGGERS['PB-LEDGER-FREEZE'].includes('LedgerDrift')` was true, the block list was
// empty — and five guardians signed a ledger freeze whose `LedgerDrifted` latch was never read.
//
// 11 §11.8.2 rule 1: *"The trigger is a call argument, not a property of the playbook
// registration — `ActivatePlaybook { id, trigger, … }` carries it, so the client evaluates the
// variant the proposer selected"*. There is now exactly one variant: `guardianCall` reads it
// off the reading's own subject. Writing a second one does not typecheck — TS2353, because
// the field this repair removed is now an excess property with no arm to belong to.
import { proposalBlocks } from '@bleavit/features-tx';
import type { AllowanceMeter, HoldHorizon, TriggerState } from '@bleavit/features-tx';

declare const meter: AllowanceMeter<'activate_playbook'>;
declare const horizon: HoldHorizon;
declare const reading: TriggerState;

export const blocks = proposalBlocks({
  proposal: {
    power: 'activate_playbook',
    meter,
    id: 'PB-LEDGER-FREEZE',
    trigger: reading,
    // The second name for one thing. It is the field this repair removed.
    namedTrigger: 'LedgerDrift',
    expiry: 9_000,
    horizon,
  },
  justificationHash: '0xj',
});
