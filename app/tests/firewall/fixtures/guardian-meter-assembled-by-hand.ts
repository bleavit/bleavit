// expect-error: TS2322 — 06 §5.2: a guardian meter is produced from the reads, never written
// MUST FAIL: only `allowanceBook` may build a book and only `meterFor` may take a meter from it.
//
// The sweep's third finding, 2026-08-09. `AllowanceMeter`'s `power` field is narrowed by the
// arm it sits in, so a meter cannot claim the wrong power — but `used` and `limit` were bare
// `Verified<number>`, so a hand-built meter could carry **another counter's figures under the
// right name**. `meterFor` exists precisely to prevent that and nothing forced its use.
//
// The direction is the permitting one: `allowanceBlocks` raises nothing while
// `limit - used > 0`, and a limit borrowed from a larger budget offers a guardian power whose
// dispatch the chain refuses with `AllowanceExhausted` — at the threshold approval, so the
// signature is spent. This branch has already had one `Verified<T>` with no producer decide a
// guardian control (`EpochClosure.open`); this is the same shape, and it gets the same repair.
//
// Both levels are branded, and one without the other would be theatre: brand the meter alone
// and a hand-assembled *book* still feeds `meterFor` fabricated figures under a real pairing;
// brand the book alone and a caller can still pair `delay_once` with `pause_intake`'s numbers.
import { approvalBlocks } from '@bleavit/features-tx';
import type {
  ApprovedCall,
  ConditionEvidence,
  DispatchEvidence,
  PendingPower,
  PlaybookAdmissibility,
} from '@bleavit/features-tx';
import type { EvidenceState } from '@bleavit/features-tx';
import type { Verified } from '@bleavit/shared-types';

declare const power: PendingPower;
declare const justification: EvidenceState;
declare const condition: ConditionEvidence;
declare const dispatch: DispatchEvidence;
declare const playbooks: PlaybookAdmissibility;
declare const calls: readonly ApprovedCall[];
declare const hash: Verified<string>;
declare const count: Verified<number>;
declare const flag: Verified<boolean>;
/** Real reads — of `pause_intake`'s counter and of `pause_intake`'s published bound. */
declare const pauseUsed: Verified<number>;
declare const pauseLimit: Verified<number>;

export const blocks = approvalBlocks({
  action: {
    actionId: hash,
    power,
    justificationHash: hash,
    approvals: count,
    threshold: count,
    expiresAt: count,
    dispatched: flag,
    calls,
  },
  justification,
  callerIsMember: true,
  callerHasApproved: false,
  now: count,
  // Three meters written out longhand, each naming a power the chain really meters — and each
  // carrying the pause window's figures. Every field is a genuine finalized read.
  allowances: {
    pause_intake: { used: pauseUsed, limit: pauseLimit },
    delay_once: { used: pauseUsed, limit: pauseLimit },
    force_rerun: { used: pauseUsed, limit: pauseLimit },
  },
  condition,
  dispatch,
  playbooks,
});
