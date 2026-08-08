// expect-error: TS2739 — 11 §11.12 E20: an approval is blocked while its trigger is not active at B′
// MUST FAIL: `ApprovalContext` requires the allowance book and the trigger-condition status,
// so an approval surface cannot be built without either.
//
// The 2026-08-08 blocker, and the half of E20 the 2026-08-07 repair did not touch. E20's
// V-facet is *"pending action with decoded enumerated call batch, m-of-7 progress, allowance
// meters, trigger-condition status"* and its F-facet is *"trigger condition not active at B′ ⇒
// blocked (playbooks are admissible only under verified triggers)"*. `ApprovalContext` carried
// neither the meters nor the trigger, and `approvalBlocks` had no clause for either.
//
// The runtime enforces both at the **fifth** approval: `propose_action` validates nothing
// (`crates/guardian-core/src/lib.rs:436-463`), and `check_and_consume` — the allowance charge
// and `TriggerInactive` alike — runs inside `dispatch`, which `approve_action` reaches only at
// the threshold. So a `PB-HALT-INTAKE` proposed while `GateBreachFlags` was set and approved
// after it cleared presented the fifth guardian an enabled button whose transaction reverts:
// the one guardian whose signature the chain refuses, shown nothing about the condition.
//
// A third field, `dispatch`, carries the rest of `check_and_consume` — the hold window and
// the rerun ledger — because the trigger is not the only refusal that falls on the fifth
// guardian, and evaluating one of them would fix the reported instance rather than the class.
//
// All three are required rather than optional for the reason every other control here is
// structural: an optional field is an evaluation that defaults to *nothing was wrong*. The
// declared code is TS2739 — the compiler names **every** missing property, so this fixture
// fails while any one of them is absent rather than only while all three are.
import { ApproveAction } from '@bleavit/features-tx';
import type { EvidenceState, PendingAction } from '@bleavit/features-tx';
import type { Verified } from '@bleavit/shared-types';
import type { GatePassed, TxSession } from '@bleavit/transaction-builder';

declare const action: PendingAction;
declare const justification: EvidenceState;
declare const now: Verified<number>;
declare const session: TxSession;
declare const onApprove: (window: GatePassed) => void;

export const panel = ApproveAction({
  context: { action, justification, callerIsMember: true, callerHasApproved: false, now },
  session,
  onApprove,
});
