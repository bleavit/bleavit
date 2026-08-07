/**
 * The chain-wide trade tape — 10 §9.1's *"bounded windowed read, never a retained table"* (F8).
 *
 * §9.1's closing sentence decides two things and the branch implemented neither. The first is the
 * scan-time aggregation (`tradeCandles`, covered in `candles.test.ts` and `loop-store.test.ts`);
 * the second is this — the only way a surface may ever answer *"what has the chain traded"*, and
 * it is a refusal wearing the shape of a feature.
 *
 * What has to be proven here is not that the read works. It is that the bound is **derived** from
 * numbers the specification publishes rather than chosen, and that an over-wide question is
 * refused rather than answered with a smaller one.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  TRADED_FILLS_PER_BLOCK_CEILING,
  TradeTapeError,
  platformBudget,
  readTradeTape,
  tradeTapeBound,
  tradeTapeHours,
} from '@bleavit/local-index';
import type { FinalizedBlockScan, RowSizes } from '@bleavit/local-index';
import { nth } from './nth.ts';

/** §9.1 publishes ~120 B per row as a **modelling assumption** and labels it as one. */
const SIZES: RowSizes = { priceSample: 120, candle: 120, event: 120, archiveRow: 120 };

const traded = (
  number: number,
  fills: readonly { bookId: string; price1e9: bigint }[],
): FinalizedBlockScan => ({
  number,
  hash: `0x${number.toString(16).padStart(64, '0')}`,
  specVersion: 3,
  blockTimestampMs: number * 6_000,
  events: fills.map((fill, index) => ({
    phase: { kind: 'apply-extrinsic' as const, index },
    pallet: 'Market',
    name: 'Traded',
    accounts: [],
    trade: { ...fill, eventIndex: index },
  })),
});

test('the bound RE-DERIVES §9.2’s own published cells, so it is checked and not asserted', async () => {
  // §9.2: *"At the chain-permitted `Traded` ceiling (§9.1) the 15% share holds ~**6.7 h** desktop
  // / ~**1.7 h** mobile of chain-wide trade rows"*. That is the honest ceiling for a window held
  // in memory too — a window the index could not have stored is one the client should not
  // materialise — so the bound is that arithmetic rather than a new number. Reproducing the
  // published cells is what makes the derivation checkable: a bound invented here would agree
  // with itself and with nothing in the specification.
  const desktop = tradeTapeBound(platformBudget('desktop'), SIZES);
  const mobile = tradeTapeBound(platformBudget('mobile'), SIZES);

  assert.equal(desktop.maxRows, 375_000, '45 MB of events share at 120 B per row');
  assert.equal(desktop.maxBlocks, 4_032);
  assert.equal(Math.round(tradeTapeHours(desktop) * 10) / 10, 6.7, '§9.2 publishes ~6.7 h desktop');

  assert.equal(mobile.maxRows, 93_750);
  assert.equal(mobile.maxBlocks, 1_008);
  assert.equal(Math.round(tradeTapeHours(mobile) * 10) / 10, 1.7, '§9.2 publishes ~1.7 h mobile');

  // §9.1's ceiling is the *maximum* a block can carry, not a typical: sizing a window on a
  // typical rate produces a bound that holds until the day it matters. 70 primary + 23 external.
  assert.equal(TRADED_FILLS_PER_BLOCK_CEILING, 93);
  assert.equal(desktop.maxBlocks, Math.floor(desktop.maxRows / TRADED_FILLS_PER_BLOCK_CEILING));

  // A zero row size makes the window unbounded, which is the one property §9.1 forbids it.
  assert.throws(() => tradeTapeBound(platformBudget('desktop'), { ...SIZES, event: 0 }), TradeTapeError);
  await Promise.resolve();
});

test('an over-wide window is REFUSED, never truncated', async () => {
  // A clipped tape is a wrong answer and not a smaller one: the fills it drops are invisible, so
  // a surface totalling volume over a silently-narrowed window reports a quiet market.
  const bound = tradeTapeBound(platformBudget('mobile'), SIZES);
  await assert.rejects(
    () => readTradeTape([], { fromBlock: 0, toBlock: bound.maxBlocks }, bound),
    (error: unknown) => {
      assert.ok(error instanceof TradeTapeError);
      assert.match(error.message, /bounded windowed read/);
      return true;
    },
  );
  // The boundary is inclusive on both ends, so the widest admissible window is exactly the bound.
  const widest = await readTradeTape([], { fromBlock: 0, toBlock: bound.maxBlocks - 1 }, bound);
  assert.deepEqual([...widest.fills], []);
  // ...and an empty stream over an admissible window is the whole window MISSING, not a quiet
  // market. This is the degenerate case of the same rule the gap test below asserts.
  assert.deepEqual([...widest.observed], []);
  assert.deepEqual(
    [...widest.missing],
    [{ fromBlock: 0, toBlock: bound.maxBlocks - 1 }],
    'an empty stream reported the window as delivered and quiet',
  );

  // An inverted window reads as *no fills*, which on a trade tape is *the market was quiet* — the
  // same silent inversion `holesIn` refuses for a coverage span.
  await assert.rejects(() => readTradeTape([], { fromBlock: 10, toBlock: 5 }, bound), TradeTapeError);
});

test('the tape reads the SCAN STREAM and reports fills in chain order', async () => {
  const bound = tradeTapeBound(platformBudget('desktop'), SIZES);
  const tape = await readTradeTape(
    [
      traded(100, [{ bookId: '7', price1e9: 100n }]),
      // Outside the window: skipped rather than refused, because the caller drives one
      // subscription for the whole ingest loop and cannot be asked to run a second for this.
      traded(400, [{ bookId: '7', price1e9: 999n }]),
      traded(101, [
        { bookId: '7', price1e9: 200n },
        { bookId: '9', price1e9: 300n },
      ]),
    ],
    { fromBlock: 100, toBlock: 200 },
    bound,
  );
  assert.equal(tape.fills.length, 3, 'a fill outside the window was reported, or one inside was dropped');
  assert.deepEqual(
    tape.fills.map((fill) => [fill.blockNumber, fill.bookId, fill.price1e9, fill.eventIndex]),
    [
      [100, '7', 100n, 0],
      [101, '7', 200n, 0],
      [101, '9', 300n, 1],
    ],
  );
  assert.equal(nth(tape.fills, 0, 'fill').price1e9, 100n);
  // The two blocks the stream delivered inside the window, merged — and 400 is not among them,
  // because an out-of-window scan is not an observation of the window.
  assert.deepEqual([...tape.observed], [{ fromBlock: 100, toBlock: 101 }]);
  assert.deepEqual([...tape.missing], [{ fromBlock: 102, toBlock: 200 }]);
});

test('a block the stream never delivered is DISCLOSED, not reported as a quiet market (SQ-900)', async () => {
  // The defect this closes, in one sentence: a scan outside the window and a block the stream
  // never delivered were skipped by the same `continue`, so a reconnect gap inside 100..200 came
  // back as fewer fills with nothing saying why — which is exactly what a surface renders as *the
  // market was quiet*. The module already refuses an INVERTED window for that reason and did not
  // apply the reasoning to a gap.
  //
  // Whether 10 §6.3's "every history query returns data plus the coverage it came from" binds this
  // read is SQ-900: §6.3 is scoped to the layer-3 index and §9.1 makes the tape deliberately not
  // layer 3, while INV-FE-15's "never silently spliced" carries no such scoping. The conservative
  // reading is implemented and the question is filed rather than settled here.
  const bound = tradeTapeBound(platformBudget('desktop'), SIZES);
  const tape = await readTradeTape(
    [
      traded(100, [{ bookId: '7', price1e9: 100n }]),
      traded(101, []),
      // 102..149 never arrive — a dropped subscription, a paused tab, a stream that resumed late.
      traded(150, [{ bookId: '7', price1e9: 500n }]),
    ],
    { fromBlock: 100, toBlock: 200 },
    bound,
  );
  // The fills are the honest ones: two, over a window whose middle nobody saw.
  assert.equal(tape.fills.length, 2);
  // A block that WAS delivered and carried no fills is an observation — *the market was quiet
  // here* is a true statement about block 101 and a false one about 102..149. That distinction is
  // the whole content of this test: both look like "no fills" to the caller without it.
  assert.deepEqual([...tape.observed], [
    { fromBlock: 100, toBlock: 101 },
    { fromBlock: 150, toBlock: 150 },
  ]);
  assert.deepEqual([...tape.missing], [
    { fromBlock: 102, toBlock: 149 },
    { fromBlock: 151, toBlock: 200 },
  ]);
});

test('out-of-order and duplicated scans do not manufacture coverage of the window', async () => {
  // A subscription is not a sorted list, and a re-delivered block must not read as two. Both are
  // properties of the `Set` + merge rather than of a running cursor, and a cursor is the obvious
  // implementation — it would report 100..101 for a stream that delivered 101 twice.
  const bound = tradeTapeBound(platformBudget('desktop'), SIZES);
  const tape = await readTradeTape(
    [traded(103, []), traded(101, []), traded(101, []), traded(102, [])],
    { fromBlock: 100, toBlock: 104 },
    bound,
  );
  assert.deepEqual([...tape.observed], [{ fromBlock: 101, toBlock: 103 }]);
  assert.deepEqual([...tape.missing], [
    { fromBlock: 100, toBlock: 100 },
    { fromBlock: 104, toBlock: 104 },
  ]);
});

test('a chain busier than §9.1’s ceiling refuses PART-WAY rather than answering short', async () => {
  // The second refusal, and the only one that cannot be checked before reading: the window fits
  // the bound and the chain then delivers more than §9.1's own ceiling models. Truncating there
  // would be the same wrong answer arrived at by a different route.
  const bound = { maxRows: 2, maxBlocks: 10 };
  await assert.rejects(
    () =>
      readTradeTape(
        [
          traded(1, [
            { bookId: '7', price1e9: 1n },
            { bookId: '7', price1e9: 2n },
            { bookId: '7', price1e9: 3n },
          ]),
        ],
        { fromBlock: 1, toBlock: 5 },
        bound,
      ),
    /refused rather than clipped/,
  );
});
