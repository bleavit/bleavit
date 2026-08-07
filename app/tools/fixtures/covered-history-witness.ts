/**
 * Witness for the bare-rows gate — never compiled, never imported.
 *
 * The gate exists because 10 §6.3's *"never bare rows"* was violated three rounds running and
 * every repair was a function nothing was obliged to call. A fourth control observed only through
 * a green run would be worth exactly as much, so every reference below declares what it must
 * produce and `--witness` fails on a declared line that goes unmatched **or** on a finding nothing
 * declared.
 *
 * The file is read twice: once as an ordinary module (rule A, `chart-table-outside-package`) and
 * once as though it lived inside `packages/local-index/src` (rule B,
 * `chart-read-outside-covered-query`). A marker therefore declares one of three things:
 *
 *   · `outside+uncovered` — both rules fire: a bare chart read, wherever it lives.
 *   · `outside`           — rule A only: a read inside a `coveredQuery(…)`, which is the correct
 *                           shape inside the package and still forbidden outside it.
 *   · `none`              — a negative control that must produce nothing in either pass.
 *
 * All four tiers appear by name in the notes, because a witness proving only that `candles1h` is
 * caught leaves the three §9.2 degrades *into* reachable — and those are the rungs a chart falls
 * back to, which is precisely where nobody looks.
 *
 * The negative controls at the bottom are the tokenizer holes every other gate in this repository
 * has had to remove: a table named in a comment, in a string body, as a property name in a type,
 * and a `.table()` call on a table that is not a chart tier.
 *
 * It lives under `tools/fixtures/`, which the scan skips, so it is a fixture rather than a
 * permanent finding — and it is outside `tsconfig.tests.json`'s `tools/*.ts` slice, so it is never
 * type-checked either.
 */

/* eslint-disable */

declare const db: any;
declare const span: any;
declare function coveredQuery(db: any, span: any, read: (db: any) => Promise<any>): Promise<any>;
declare function candleTableFor(resolution: string): string;

// expect: outside+uncovered the bare read of candles1h — one line shorter than the correct path
export const bareCandles = async () => db.candles1h.where('bookId').equals('7').toArray();

// expect: outside+uncovered the same reach into the raw priceSamples tier
export const bareSamples = async () => db.priceSamples.toArray();

// expect: outside+uncovered candles4h, a rung the ladder degrades INTO and nobody watches
export const bareFourHourly = async () => db.candles4h.orderBy('openAt').last();

// expect: outside+uncovered candles1d, the floor of the ladder
export const bareDaily = async () => db.candles1d.count();

// expect: outside+uncovered `.table('candles1h')` spells the same reach past a property rule
export const byLiteralName = async () => db.table('candles1h').toArray();

// expect: outside+uncovered a folded const naming candles4h — a gate that reads only literals is
// defeated by naming the literal, which is what a developer does when a gate complains
const RUNG = 'candles4h';
export const byFoldedConst = async () => db.table(RUNG).toArray();

// expect: outside+uncovered candleTableFor resolves to a candle tier by construction
export const byHelper = async (rung: string) => db.table(candleTableFor(rung)).toArray();

// expect: outside the CORRECT shape: candles1h read inside a coveredQuery callback, which rule B
// must NOT report — without this half an exemption widened to "anything in the package" would
// satisfy every other expectation while making the gate vacuous exactly where it matters
export const covered = async () =>
  coveredQuery(db, span, async (inner: any) => inner.candles1h.where('bookId').equals('7').toArray());

// expect: none the negative controls — every one of these occurs in real client code
// A comment naming db.priceSamples and db.candles1h is not a property access.
const schemaLike = {
  // A schema declaration is a string table, not a read: SCHEMA_V3 names all four tiers.
  priceSamples: '[bookId+sourceKey+blockNumber], bookId, blockNumber, at, origin',
  candles1h: '[bookId+sourceKey+openAt], bookId, openAt, toBlock',
  candles4h: '[bookId+sourceKey+openAt], bookId, openAt, toBlock',
  candles1d: '[bookId+sourceKey+openAt], bookId, openAt, toBlock',
};
interface ChartTables {
  priceSamples: unknown;
  candles1h: unknown;
  candles4h: unknown;
  candles1d: unknown;
}
const documented = 'the ladder folds priceSamples into candles1h, then candles4h, then candles1d';
export const otherTables = async () => [
  await db.table('events').toArray(),
  await db.meta.get('coverage'),
  await db.txHistory.count(),
  schemaLike,
  documented,
  null as unknown as ChartTables,
];
