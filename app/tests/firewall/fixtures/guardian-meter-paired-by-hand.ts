// expect-error: TS2322 — 06 §5.2: `meterFor` is the only thing that pairs a power with its row
// MUST FAIL: a meter cannot be assembled from a REAL book by naming the wrong entry.
//
// The declared code moved TS2741 → TS2322 on 2026-08-09 and the fixture is unchanged. It now
// misses two required members rather than one — `[METER_PAIR]` and `ProducedByMeterFor`'s
// private field — so TypeScript reports the assignment failure and elaborates, instead of
// naming the single missing property. The refusal is strictly stronger, not relaxed:
// `guardian-meter-refigured-by-spread.ts` is the fixture the second member exists for.
//
// The sibling of `guardian-meter-assembled-by-hand.ts`, and it exists because that one alone
// does not prove what it looks like it proves. That fixture is refused by the **book**'s brand
// — it writes three rows out longhand — so branding the meter could be deleted and it would go
// on failing exactly as before. This one hands over a genuine `AllowanceBook`, produced by
// `allowanceBook` from the nine reads, and pairs `delay_once` with `pause_intake`'s row.
//
// That is the mistake `meterFor` exists to prevent and the one a reader is most likely to make
// by hand: the power name is right, every figure is a real finalized read, and the budget
// belongs to another counter. `allowanceBlocks` raises nothing while `limit - used > 0`, so
// the guardian is offered a power the chain refuses at the threshold approval.
//
// The same lesson as `registry-filing-open-epoch-assembled-by-hand.ts`: a required field
// refuses an EMPTY literal, and only a brand refuses one filled in with whatever the caller
// had lying around.
import { proposalBlocks } from '@bleavit/features-tx';
import type { AllowanceBook, HoldHorizon } from '@bleavit/features-tx';

declare const book: AllowanceBook;
declare const horizon: HoldHorizon;

export const blocks = proposalBlocks({
  proposal: {
    power: 'pause_intake',
    // Real reads, from a real book, under the name of the power this proposal really is.
    // They are `delay_once`'s figures.
    meter: { power: 'pause_intake', used: book.delay_once.used, limit: book.delay_once.limit },
    until: 5_000,
    horizon,
  },
  justificationHash: '0xj',
});
