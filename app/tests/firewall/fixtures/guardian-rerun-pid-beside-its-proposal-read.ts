// expect-error: TS2353 — 06 §5.2: the proposal a rerun power acts on IS the pid it read
// MUST FAIL: a rerun proposal cannot name a pid beside the `Epoch.Proposals` read for one.
//
// Found by the neighbour sweep the 2026-08-09 P2 round asked for, and it is the same defect as
// `guardian-activation-id-beside-its-registration-read.ts` one field over. `RerunState` named
// no pid, so a reading of `Epoch.Proposals[p9]` — `Queued`, never delayed, never re-run, which
// is the **permitting** shape — admitted a `delay_once` of `p7`. `check_and_consume` reads the
// record the *call* names, so `NotRerunnable` / `AlreadyRerun` still lands, on the fifth
// signature, after the whole extrinsic reverts.
//
// The pid now lives in the reading (`rerunPid`) and `guardianCall` emits it from there, so the
// value evaluated and the value dispatched are one value. The approve flow compares instead,
// because there the pid is decoded from somebody else's bytes.
import { proposalBlocks } from '@bleavit/features-tx';
import type { AllowanceMeter, RerunState } from '@bleavit/features-tx';

declare const meter: AllowanceMeter<'delay_once'>;
/** A real read of a real record — `Epoch.Proposals[p9]`, say. */
declare const proposal: RerunState;

export const blocks = proposalBlocks({
  proposal: {
    power: 'delay_once',
    meter,
    // The reading below already names the proposal it was taken for. This is a second one.
    pid: 'p7',
    proposal,
  },
  justificationHash: '0xj',
});
