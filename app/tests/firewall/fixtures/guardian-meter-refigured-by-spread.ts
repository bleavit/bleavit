// expect-error: TS2322 — 06 §5.2: a meter's figures cannot be swapped after `meterFor` paired them
// MUST FAIL: spreading a genuine meter and replacing `used`/`limit` borrows another budget.
//
// The 2026-08-09 P5, second face. `guardian-meter-paired-by-hand.ts` proved a meter cannot be
// *written* beside a real book. It said nothing about a meter that was produced correctly and
// then edited, which needs no cast at all:
//
//   const spent = meterFor(book, 'delay_once');            // used 2 of 2 — exhausted
//   const forged = { ...spent, used: book.force_rerun.used, limit: book.force_rerun.limit };
//
// Object spread carries symbol-keyed properties, so `[METER_PAIR]` rides along and the result
// still satisfies `AllowanceMeter<'delay_once'>`. Measured before the repair: `proposalBlocks`
// returned `['Allowance']` for the genuine exhausted meter and `[]` for this one. The council
// is walked to five signatures on a `delay_once` the chain refuses with `AllowanceExhausted` at
// the dispatching approval — the one signature that cannot be taken back.
//
// The repair is `ProducedByMeterFor`, a phantom marker carrying a `#private` member. TypeScript
// drops those from a spread type, and a `#` name is nominal per declaration, so a caller cannot
// supply one from a class of its own either.
import { proposalBlocks, meterFor } from '@bleavit/features-tx';
import type { AllowanceBook, RerunState } from '@bleavit/features-tx';

declare const book: AllowanceBook;
declare const proposal: RerunState;

// Genuinely produced, from a genuine book, for the power this proposal really is.
const spent = meterFor(book, 'delay_once');

export const blocks = proposalBlocks({
  proposal: {
    power: 'delay_once',
    // Every figure is a real finalized read. They are `force_rerun`'s.
    meter: { ...spent, used: book.force_rerun.used, limit: book.force_rerun.limit },
    proposal,
  },
  justificationHash: '0xj',
});
