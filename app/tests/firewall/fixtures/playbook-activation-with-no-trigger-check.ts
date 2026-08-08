// expect-error: TS2345 — 11 §11.8.2: a playbook is never proposed on a trigger check that did not run
// MUST FAIL: `ProposeAction.trigger` is **required**, and the four powers that have no
// trigger say so with `{ kind: 'no-trigger-power' }` rather than omitting the prop.
//
// It was optional, and this exact call — an `activate_playbook` meter with `trigger` left
// out — produced an empty block list from `proposalBlocks`, so `operatorGate` returned
// `ready` and the console offered a 5-of-7 guardian signature on an emergency playbook
// activation whose on-chain condition had never been evaluated. §11.8.2 is explicit that
// such an action is *"refused with the reason shown, never proposed on a check that did not
// run"*, and the disposition that used to mask it (`UNREADABLE['O-4']`, `blocking`) was
// retired at contract v29 — so retiring the obligation opened the control and nothing in the
// model closed it.
//
// A runtime `if` is not the fix on its own: it would leave the omission compiling, and every
// other structural control in this client (`RegistrationCheck.uncheckable`, `Combined<T>`'s
// `unestablished` arm, `GatePassed`) exists because "nobody checked" must be a value
// somebody writes down. The declared code is TS2345 because the omission is caught on the
// **argument**, so a screen cannot reach a rendering at all.
import { ProposeAction } from '@bleavit/features-tx';
import type { AllowanceMeter, ProposeInputs } from '@bleavit/features-tx';
import type { GatePassed, TxSession } from '@bleavit/transaction-builder';

declare const meter: AllowanceMeter & { readonly power: 'activate_playbook' };
declare const inputs: ProposeInputs;
declare const session: TxSession;
declare const onPropose: (window: GatePassed) => void;

export const panel = ProposeAction({ meter, inputs, session, onPropose });
