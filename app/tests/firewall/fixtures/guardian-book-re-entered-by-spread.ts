// expect-error: TS2345 — 06 §5.2: `allowanceBook` builds a book whole, and nothing edits one
// MUST FAIL: spreading a genuine book and replacing one power's row feeds `meterFor` a lie.
//
// The 2026-08-09 P5, third face, and the one that shows why both levels need the marker rather
// than only the meter. Mark the meter alone and this route stays open: the book is edited, and
// `meterFor` — the real producer, doing exactly its job — then mints a perfectly genuine meter
// from a row that no read produced.
//
//   const forged = { ...book, delay_once: book.force_rerun };
//   meterFor(forged, 'delay_once')   // a real meter over a borrowed budget
//
// Measured before the repair: `proposalBlocks` returned `[]` where the genuine book gave
// `['Allowance']`. That is the same false permission as the sibling fixture, arriving one level
// down, which is the reason `AllowanceBook` carries `ProducedByAllowanceBook` as well.
//
// It also closes the windowed correction. `allowanceBook` applies the pallet's own window test
// to `pause_intake` before subtracting, so a book assembled around that step reports an
// exhausted emergency power as available, or the reverse.
import { proposalBlocks, meterFor } from '@bleavit/features-tx';
import type { AllowanceBook, RerunState } from '@bleavit/features-tx';

declare const book: AllowanceBook;
declare const proposal: RerunState;

// A real book with one row re-pointed. `delay_once` now reads `force_rerun`'s counter.
const forged = { ...book, delay_once: book.force_rerun };

export const blocks = proposalBlocks({
  proposal: { power: 'delay_once', meter: meterFor(forged, 'delay_once'), proposal },
  justificationHash: '0xj',
});
