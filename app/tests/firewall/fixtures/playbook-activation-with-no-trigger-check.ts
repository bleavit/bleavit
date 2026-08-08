// expect-error: TS2322 — 11 §11.8.2: a playbook is never proposed on a trigger check that did not run
// MUST FAIL: the activation arm of `GuardianProposal` carries its trigger **reading** as a
// required field, so an activation with no evaluated condition is not a value that exists.
//
// The 2026-08-07 blocker: `trigger` was an optional prop, and this exact call — an
// `activate_playbook` form with it left out — produced an empty block list from
// `proposalBlocks`, so `operatorGate` returned `ready` and the console offered a 5-of-7
// guardian signature on an emergency playbook activation whose on-chain condition had never
// been evaluated. §11.8.2 is explicit that such an action is *"refused with the reason shown,
// never proposed on a check that did not run"*.
//
// The 2026-08-08 re-review found that making it required was not enough: a required field
// still says nothing about whether it describes the same action as its neighbours. The
// reading is now a field of the arm the power selects, and the call's own `trigger` argument
// is derived from it (`guardianCall`), so there is no second place a trigger can be named —
// see `playbook-trigger-named-twice.ts`.
//
// A runtime `if` is not the fix on its own: it would leave the omission compiling, and every
// other structural control in this client (`RegistrationCheck.uncheckable`, `Combined<T>`'s
// `unestablished` arm, `GatePassed`) exists because "nobody checked" must be a value
// somebody writes down. The declared code is TS2322 because the omission is now caught on
// `inputs.proposal` — the union has no arm without the reading — rather than on the whole
// argument; the screen still cannot reach a rendering.
import { ProposeAction } from '@bleavit/features-tx';
import type { AllowanceMeter, HoldHorizon } from '@bleavit/features-tx';
import type { GatePassed, TxSession } from '@bleavit/transaction-builder';

declare const meter: AllowanceMeter<'activate_playbook'>;
declare const horizon: HoldHorizon;
declare const session: TxSession;
declare const onPropose: (window: GatePassed) => void;

export const panel = ProposeAction({
  inputs: {
    proposal: { power: 'activate_playbook', meter, id: 'PB-HALT-INTAKE', expiry: 9_000, horizon },
    justificationHash: '0xj',
  },
  session,
  onPropose,
});
