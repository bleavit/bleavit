/**
 * The client half of the chain↔client quote-agreement gate — 02 §4, 04 §6.1.
 *
 * The reference-corpus differential in `differential.test.js` proves the
 * *mathematics* is right to 04 §4's bounds. It cannot prove the layer above:
 * which roundings apply in which order, which failure fires first, and whether
 * the per-trade bound is a refusal or a datum. This suite does, by binding to
 * `crates/market-core/fixtures/chain-quote-agreement.json` — written by the
 * runtime's own `quote()` and checked, on the Rust side, to still describe it.
 *
 * The split is deliberate: neither CI job needs the other's toolchain, and
 * whichever side moved is the side whose job goes red. If both go red, the
 * fixture was regenerated without the client following, which is exactly the
 * state that would otherwise ship a wrong number to a confirm screen.
 *
 * This gate is not decorative. Both of the defects it was built from passed all
 * 1,286 corpus rows: the port refused an order above `MaxTrade` that the
 * runtime prices, and reported an oversized sell as `PriceBoundExceeded` where
 * the runtime returns `ArithmeticOverflow`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  ProtocolError,
  baseUnitsToFixed,
  lmsrCost,
  lmsrPriceLong,
  maxTradeAmount,
  quoteBuy,
  quoteSell,
  toRaw,
} from '@bleavit/protocol';

import { catchThrown } from './corpus.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(here, '../../../crates/market-core/fixtures/chain-quote-agreement.json');

function loadFixture() {
  let text;
  try {
    text = readFileSync(FIXTURE_PATH, 'utf8');
  } catch (cause) {
    throw new Error(
      `the chain quote-agreement fixture is unreadable at ${FIXTURE_PATH}. Regenerate it with ` +
        `BLEAVIT_WRITE_QUOTE_FIXTURE=1 cargo test -p market-core quote_agreement`,
      { cause },
    );
  }
  // Every number in this file is a string by construction — see the Rust
  // module header — so a plain parse is exact and no reviver is needed.
  const fixture = JSON.parse(text);
  if (fixture.schema !== 'bleavit.chain-quote-agreement.v1') {
    throw new Error(`unexpected fixture schema ${fixture.schema}`);
  }
  return fixture;
}

const fixture = loadFixture();
const FEE_BPS = BigInt(fixture.fee_bps);
const BOUNDS = {
  minTrade: BigInt(fixture.trade_bounds.min_trade),
  maxTradeNumerator: BigInt(fixture.trade_bounds.max_trade_numerator),
  maxTradeDenominator: BigInt(fixture.trade_bounds.max_trade_denominator),
};

/** The four `TradeSide` columns, mapped onto this package's two entry points. */
const COLUMNS = [
  { key: 'buy_long', run: (book, amount) => quoteBuy(book, 'long', amount, FEE_BPS, BOUNDS) },
  { key: 'buy_short', run: (book, amount) => quoteBuy(book, 'short', amount, FEE_BPS, BOUNDS) },
  { key: 'sell_long', run: (book, amount) => quoteSell(book, 'long', amount, FEE_BPS, BOUNDS) },
  { key: 'sell_short', run: (book, amount) => quoteSell(book, 'short', amount, FEE_BPS, BOUNDS) },
];

test('the fixture is present and exercises both refusal kinds', () => {
  // Anti-vacuity, mirroring the Rust side: the loops below iterate the case
  // list, so an empty or all-erroring fixture would pass by running nothing.
  assert.ok(fixture.cases.length >= 8, `only ${fixture.cases.length} cases`);
  const rendered = JSON.stringify(fixture);
  assert.ok(rendered.includes('"PriceBoundExceeded"'), 'no domain refusal in the fixture');
  assert.ok(rendered.includes('"ArithmeticOverflow"'), 'no balance underflow in the fixture');
  assert.ok(rendered.includes('"cost"'), 'no priced case in the fixture');
});

test('every quote column agrees with the runtime, value for value', () => {
  let priced = 0;
  let refused = 0;

  for (const row of fixture.cases) {
    const book = {
      qLong: BigInt(row.q_long),
      qShort: BigInt(row.q_short),
      b: BigInt(row.b),
    };
    const amount = BigInt(row.amount);

    for (const column of COLUMNS) {
      const expected = row[column.key];
      const where = `${row.name}.${column.key}`;

      if (expected.error !== undefined) {
        const error = catchThrown(() => column.run(book, amount));
        assert.ok(error instanceof ProtocolError, `${where}: refused with ${error}`);
        assert.equal(error.code, expected.error, `${where}: wrong dispatch error`);
        refused += 1;
        continue;
      }

      const actual = column.run(book, amount);
      assert.equal(actual.cost, BigInt(expected.cost), `${where}: cost`);
      assert.equal(actual.fee, BigInt(expected.fee), `${where}: fee`);
      assert.equal(actual.pAfter1e9, BigInt(expected.p_after_1e9), `${where}: post-trade price`);
      assert.equal(actual.maxTrade, BigInt(expected.max_trade), `${where}: MaxTrade`);
      assert.equal(actual.withinDomain, expected.within_domain, `${where}: domain flag`);
      priced += 1;
    }
  }

  assert.ok(priced >= 8, `only ${priced} priced comparisons`);
  assert.ok(refused >= 2, `only ${refused} refusal comparisons`);
});

test('the raw 64.64 kernel values agree exactly, not merely within the error bounds', () => {
  // The corpus differential admits 04 §4's error band. This admits none: the
  // client and the runtime run the same integer algorithm, so anything but bit
  // equality means one of them changed.
  let compared = 0;
  for (const row of fixture.cases) {
    const long = baseUnitsToFixed(BigInt(row.q_long));
    const short = baseUnitsToFixed(BigInt(row.q_short));
    const b = baseUnitsToFixed(BigInt(row.b));

    if (row.cost_raw_64x64 !== null) {
      assert.equal(toRaw(lmsrCost(long, short, b)), BigInt(row.cost_raw_64x64), `${row.name}: cost raw`);
      compared += 1;
    }
    if (row.price_long_raw_64x64 !== null) {
      assert.equal(
        toRaw(lmsrPriceLong(long, short, b)),
        BigInt(row.price_long_raw_64x64),
        `${row.name}: price raw`,
      );
      compared += 1;
    }
  }
  assert.ok(compared >= 16, `only ${compared} raw comparisons`);
});

test('MaxTrade is derived from the ratio the fixture carries, not from a launch literal', () => {
  for (const row of fixture.cases) {
    assert.equal(
      maxTradeAmount(BigInt(row.b), BOUNDS),
      (BigInt(row.b) * BOUNDS.maxTradeNumerator) / BOUNDS.maxTradeDenominator,
      `${row.name}: MaxTrade`,
    );
  }
});
