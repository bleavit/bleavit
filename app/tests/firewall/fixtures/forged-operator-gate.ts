// expect-error: TS2741 — 11 §11.4 rule 1: the operator gate is structural, not a convention
// MUST FAIL: `OperatorGate.window` is a `GatePassed`, whose brand is a module-private
// `unique symbol` only `gate()` can mint. A screen that could assemble an "already gated"
// value by hand would be able to enable any §11.8 submit control without a refresh — which
// is the bypass §11.4 rule 1 exists to make unreachable, and exactly the shape the operator
// consoles were in before F17 (each enabled its own button on a module-local check).
//
// The check is on the *value*, not on the callback: `() => void` is assignable to
// `(w: GatePassed) => void` in TypeScript, so the handler's arity proves nothing. What
// cannot be forged is the proof the control is built from.
import { GateControl } from '@bleavit/features-tx';
import type { OperatorGate } from '@bleavit/features-tx';
import type { FinalizedBlockRef } from '@bleavit/chain-client';

declare const at: FinalizedBlockRef;

const forged: OperatorGate = {
  row: 'O-1',
  state: 'ready',
  window: { at, results: [] },
  blocks: [],
  unreadable: [],
};

export const control = GateControl({
  label: 'Register',
  intent: 'primary',
  gate: forged,
  onSubmit: () => {},
});
