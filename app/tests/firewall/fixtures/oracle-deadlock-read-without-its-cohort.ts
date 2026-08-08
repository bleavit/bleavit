// expect-error: TS2322 — 11 §11.8.2: OracleDeadlock is target-keyed, never the map's non-emptiness
// MUST FAIL: an `OracleDeadlock` reading has nowhere to exist without the cohort it was read
// for, because that arm of `TriggerSubject` carries a required `cohort` field.
//
// The 2026-08-08 blocker. `TriggerState`'s arms were `{ kind, trigger, since }` — no cohort —
// so a caller had nowhere to record which target the read had been performed against.
// `guardian.ts` maps `OracleDeadlock` and `VoidInFlight` to the *same* frozen item
// (`storage.epoch.pending_oracle_voids`) and `rows.ts` declares one clause for both
// predicates, so a reader answering *"is any cohort latched?"* — the `VoidInFlight` question —
// produced a value indistinguishable from an `OracleDeadlock` answer. A `PB-ORACLE-VOID`
// naming cohort 42 then passed while cohort 7 was the latched one.
//
// 11 §11.8.2: *"`contains_key(target)` for the **exact cohort** the activation names. It is
// target-keyed by design: one failed cohort never authorizes VOID of another (05 §4.7;
// 07 §10), so a client MUST evaluate this against the `target` in the call, never against the
// map's non-emptiness."*
//
// This was not fixable by the caller, which is why the repair is the type.
import type { TriggerState } from '@bleavit/features-tx';

export const reading: TriggerState = {
  kind: 'active',
  // The `VoidInFlight` answer, wearing the `OracleDeadlock` name.
  subject: { trigger: 'OracleDeadlock' },
  since: { value: 1, status: { kind: 'derived-local', inputs: [] } },
};
