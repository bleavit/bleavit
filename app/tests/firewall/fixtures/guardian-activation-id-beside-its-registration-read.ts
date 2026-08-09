// expect-error: TS2353 — 02 §7.4: the playbook an activation names IS the key it read
// MUST FAIL: a proposal cannot name a playbook beside the registration read keyed to one.
//
// The 2026-08-09 P2, second face. `RegistrationReading` carried a boolean and nothing else, so
// a successful read of `Guardian.PlaybookRegistered[PB-RESERVE]` was indistinguishable from a
// read of the key the action actually names. `approve_action` queries the map under the
// action's **own** id, so with `PB-HALT-INTAKE` disabled and `PB-RESERVE` still registered,
// `registrationBlocks` saw `true`, the control opened, and the threshold approval reverted with
// `PlaybookNotRegistered` — the fifth signature spent on a whole-extrinsic revert.
//
// On this flow there is nothing to compare, and that is the repair: the client chooses the
// playbook and then reads its key, so the id lives in the reading (`activationPlaybook`) and
// the arm has no field of its own — exactly as `trigger` and `target` are derived from the
// trigger reading rather than written beside it. The approve flow, where the id is decoded
// from somebody else's bytes, genuinely holds two values and compares them.
import { proposalBlocks } from '@bleavit/features-tx';
import type { HoldHorizon, RegistrationReading, TriggerState } from '@bleavit/features-tx';
import type { ActivePlaybookReading } from '@bleavit/features-tx';

declare const trigger: TriggerState;
declare const horizon: HoldHorizon;
/** A real read of a real key — `Guardian.PlaybookRegistered[PB-RESERVE]`, say. */
declare const registration: RegistrationReading;
declare const active: ActivePlaybookReading;

export const blocks = proposalBlocks({
  proposal: {
    power: 'activate_playbook',
    // The registration read below already names a playbook. This is a second one, and the two
    // are exactly as related as whoever wrote them remembered to make them.
    id: 'PB-HALT-INTAKE',
    trigger,
    expiry: 9_000,
    horizon,
    registration,
    active,
  },
  justificationHash: '0xj',
});
