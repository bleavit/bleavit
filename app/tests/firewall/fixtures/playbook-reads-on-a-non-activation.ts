// expect-error: TS2353 — 02 §7.4: neither playbook map is read by a non-activation dispatch
// MUST FAIL: only the `activate_playbook` arm of `GuardianProposal` has fields for
// `Guardian.PlaybookRegistered` and `Guardian.ActivePlaybooks`.
//
// Contract v30 froze both maps and the propose flow now evaluates them, because
// `PlaybookNotRegistered` and `PlaybookAlreadyActive` fall on the *dispatching* approval —
// the same cost `proposalBlocks` already refuses to pay for `PB-MIGRATION`.
//
// Attaching them to the row instead of to the power is a defect with a name and a date. On
// 2026-08-08 both reads were `blocking` unreadable obligations on `O-3`, which is one row for
// all five guardian powers, so `operatorGate` closed the approve control for `pause_intake`,
// `delay_once`, `force_rerun` and `suspend_on_gate` — powers whose dispatch reads neither
// condition. That is a client refusing what the runtime **accepts**, the direction 09 §1.2's
// mirror rule exists to forbid, and it took a scope object and a runtime filter to undo.
//
// The propose side does not need either, because here the power is the discriminant of a union
// this client builds rather than a value decoded from somebody else's bytes. So the reads are
// fields of the one arm that reaches them, and the wrong shape does not compile — TS2353,
// because on the other four arms they are excess properties with nowhere to belong.
import { proposalBlocks } from '@bleavit/features-tx';
import type { AllowanceMeter, HoldHorizon, RegistrationReading } from '@bleavit/features-tx';

declare const meter: AllowanceMeter<'pause_intake'>;
declare const horizon: HoldHorizon;
// A real reading of a real surface, offered to a power whose dispatch never performs it.
declare const registration: RegistrationReading;

export const blocks = proposalBlocks({
  proposal: {
    power: 'pause_intake',
    meter,
    until: 5_000,
    horizon,
    registration,
  },
  justificationHash: '0xj',
});
