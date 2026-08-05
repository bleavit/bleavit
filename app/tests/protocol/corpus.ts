/**
 * The corpus loader — 04 §5, 15 §4.4.
 *
 * The file is read from `reference-model/fixtures/vectors.json` **in place**,
 * not from a copy under `app/`. 04 §5's single-generator rule says every
 * fixture any implementation certifies against derives from the one reference
 * generator; a copy in this tree would be a second artifact that drifts
 * silently the first time the corpus is regenerated and this suite is not.
 *
 * Loading is fail-loud on purpose, twice over.
 *
 * A differential suite whose corpus failed to load iterates zero rows and
 * reports success — the exact failure mode that makes a green build meaningless
 * — so `loadCorpus` throws rather than returning empty, and every suite asserts
 * its row count before comparing.
 *
 * The subtler hazard is that the corpus stores raw 64.64 values as JSON
 * *numbers*, and they run past 2⁵³. `JSON.parse` turns those into `float64`
 * and loses the low bits, so a naive load silently compares this port against
 * a corrupted reference — and the corruption is far larger than the error
 * bounds being asserted, so a wrong implementation would pass. Numbers outside
 * the safe-integer range are therefore recovered from the parser's own source
 * text, and `bigFrom` refuses an unsafe number outright rather than converting
 * one. `loadCorpus` proves the recovery is live before returning.
 *
 * ## Why the corpus is read, never imported (V-74, restated for the type layer)
 *
 * `resolveJsonModule` would give this file a typed corpus for free and would
 * reintroduce the defect above in its worst form: a JSON module import goes
 * through the stock parser, with no reviver, so every raw 64.64 value would
 * arrive rounded — and the *type* would then assert they are exact `number`s.
 * The corpus must keep being read as text and parsed here.
 *
 * ## What the interfaces below are, and are not
 *
 * They describe **what these four suites read**, not the corpus schema. Nothing
 * derives them from the artifact, so they cannot be a schema check and must not
 * be mistaken for one — `loadCorpus` does that job at runtime, against the
 * declared `schema` string and the V1 precision probe. What they buy is narrower
 * and still worth having: a mistyped field name fails at compile time instead of
 * silently comparing against `undefined`, and the heterogeneous vectors (V1–V6
 * have four different shapes) can no longer be read as each other.
 *
 * A top-level key absent here is simply one no suite reads yet; add it when a
 * suite does.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

/** `app/tests/protocol` → repo root → the single generated corpus. */
export const CORPUS_PATH = resolve(here, '../../../reference-model/fixtures/vectors.json');

/** The schema major this suite understands (04 §5: append-only within a major). */
export const EXPECTED_SCHEMA = 'bleavit.reference-model.v4';

/**
 * A corpus integer as it survives the reviver below.
 *
 * `number | string` rather than either alone, and that union is measured rather
 * than defensive: within a single field the corpus carries both. 8 of the 9
 * `price_raw_64x64_nearest` samples exceed 2⁵³ and arrive as source text; the
 * ninth fits and stays a `number`. 1,285 of the 1,286 `transcendental_corpus`
 * `in` values are text and one is not.
 *
 * So the union is also the control that makes `bigFrom` unbypassable: a field
 * typed this way cannot be used as an integer without going through it, and
 * `bigFrom` is where an unsafe `number` — the shape a lost reviver produces —
 * is refused instead of rounded.
 */
export type CorpusInteger = number | string;

/** A vector stating one exact value, in decimal and as its raw 64.64 integer. */
export interface ValueVector {
  action: string;
  value: string;
  raw_64x64_nearest: CorpusInteger;
}

/** V3 — a cost and the position delta that produced it. */
export interface CostDeltaVector {
  action: string;
  cost: string;
  delta: string;
}

/** V5 — a sell whose proceeds are stated before fees, with the fee-only net. */
export interface ProceedsVector {
  action: string;
  net_fees_only: string;
  proceeds_before_fees: string;
}

/** V6 — a trade the reference model refuses, and the error it refuses with. */
export interface RefusalVector {
  action: string;
  amount: string;
  b: string;
  error: string;
  q_long: string;
  q_short: string;
  side: string;
}

export interface LmsrVectors {
  V1: ValueVector;
  V2: ValueVector;
  V3: CostDeltaVector;
  V4: ValueVector;
  V5: ProceedsVector;
  V6: RefusalVector;
}

export interface HighPrecisionSample {
  cost: string;
  cost_raw_64x64_nearest: CorpusInteger;
  price_long: string;
  price_raw_64x64_nearest: CorpusInteger;
  q_long: string;
  q_short: string;
}

export interface HighPrecisionCorpus {
  b: string;
  samples: HighPrecisionSample[];
}

/**
 * One transcendental point.
 *
 * `f` is deliberately `string` and not `'exp2' | 'log2' | 'ln'`. The differential
 * suite switches on it and its `default:` arm fails with *"this suite must be
 * widened before it passes"* — the guard that catches a regenerated corpus
 * carrying a function this port does not implement. A closed union would make
 * that arm unreachable, turning a live check into dead code, and would type a
 * future `f: "cbrt"` row as one of the three functions it is not.
 */
export interface TranscendentalRow {
  f: string;
  in: CorpusInteger;
  out: CorpusInteger;
}

export interface TranscendentalCorpus {
  count: number;
  exp2_relative_bound: string;
  primitive_abs_ulp_bound: CorpusInteger;
  rows: TranscendentalRow[];
  seed: string;
}

/** One recorded observation input: the block, and the quote standing at it. */
export interface TwapObservationInput {
  block: number;
  previous_quote: string;
}

/** Two clamped observations and the window means they imply. */
export interface BackwardWeightedMeanScenario {
  name: 'backward_weighted_mean';
  inputs: { initial: string; observations: TwapObservationInput[] };
  mean_0_20: string;
  mean_10_20: string;
  recorded: string[];
  stale_events: number;
}

/** A single observation after a gap wide enough to charge a stale event. */
export interface StaleGapAccountingScenario {
  name: 'stale_gap_accounting';
  inputs: TwapObservationInput;
  recorded: string;
  stale_events: number;
}

/**
 * The TWAP scenarios, as a union discriminated by `name`.
 *
 * The two rows genuinely have different shapes — `recorded` is a list of prices
 * in one and a single price in the other, and only the first carries window
 * means — so a common interface would have to make every distinguishing field
 * optional, which is the same as not typing them. Reach for `twapScenario()`
 * rather than `.find()`: a callback predicate does not narrow the union.
 */
export type TwapScenario = BackwardWeightedMeanScenario | StaleGapAccountingScenario;

export interface WindowStaleScenario {
  name: string;
  inputs: {
    start: number;
    end: number;
    stale_gap_blocks: number;
    observations: number[];
  };
  stale_events: number;
}

export interface Corpus {
  schema: string;
  lmsr_vectors: LmsrVectors;
  high_precision_corpus: HighPrecisionCorpus;
  transcendental_corpus: TranscendentalCorpus;
  twap_scenarios: TwapScenario[];
  window_stale_scenarios: WindowStaleScenario[];
}

/**
 * Keep integers too large for `float64` as their exact source text.
 *
 * The third reviver argument is the JSON source-text access shipped in the
 * Node version `app/.nvmrc` pins. Safe integers are left as numbers so ordinary
 * fields (block heights, counts) keep behaving like numbers.
 *
 * TypeScript's `lib` still declares the two-parameter reviver, but `JSON.parse`
 * is a *method*, and method parameters are checked bivariantly — so passing this
 * three-parameter function is accepted as written, with no cast and no global
 * augmentation of `JSON` (which would change the return type of every
 * `JSON.parse` in the tests project, since a merged overload is resolved first).
 */
function preserveExactIntegers(
  _key: string,
  value: unknown,
  context?: { source?: string },
): unknown {
  if (typeof value === 'number' && !Number.isSafeInteger(value) && context?.source !== undefined) {
    return context.source;
  }
  return value;
}

export function loadCorpus(): Corpus {
  let text: string;
  try {
    text = readFileSync(CORPUS_PATH, 'utf8');
  } catch (cause) {
    throw new Error(
      `the reference corpus is unreadable at ${CORPUS_PATH}. This suite certifies ` +
        `against the generated artifact and has nothing to compare without it (04 §5).`,
      { cause },
    );
  }
  // The parse is `unknown` until the two checks below pass, which is the only
  // evidence this file has that the artifact is the one these suites read.
  const parsed: unknown = JSON.parse(text, preserveExactIntegers);
  const corpus = parsed as Corpus;
  if (corpus.schema !== EXPECTED_SCHEMA) {
    throw new Error(
      `corpus schema is ${corpus.schema}, this suite reads ${EXPECTED_SCHEMA}. ` +
        `A major bump means the layout changed; read 04 §5 before widening this check.`,
    );
  }
  // Prove the exact-integer recovery is live. V1's raw is ~9.45 × 10²¹ and can
  // only survive as text; if this is a number, the runtime lost the low bits and
  // every comparison below would be against a corrupted reference.
  const probe = corpus.lmsr_vectors?.V1?.raw_64x64_nearest;
  if (typeof probe !== 'string') {
    throw new Error(
      `the corpus loader lost precision: V1.raw_64x64_nearest arrived as ${typeof probe}. ` +
        `Exact integers past 2⁵³ must survive as source text — see this file's header.`,
    );
  }
  return corpus;
}

/**
 * The TWAP scenario with this name, narrowed to its own arm of the union.
 *
 * `corpus.twap_scenarios.find((row) => row.name === n)` cannot do this: a
 * callback predicate leaves the result as the whole union, so the caller sees
 * only the fields both arms share. It also throws where `.find` returns
 * `undefined`, which matters more than the narrowing — a scenario dropped from a
 * regenerated corpus should stop the suite, not skip a test.
 */
export function twapScenario<N extends TwapScenario['name']>(
  corpus: Corpus,
  name: N,
): Extract<TwapScenario, { name: N }> {
  const found = corpus.twap_scenarios.find((row) => row.name === name);
  if (found === undefined) {
    throw new Error(
      `the corpus carries no TWAP scenario named ${name}; it has ` +
        `${corpus.twap_scenarios.map((row) => row.name).join(', ')}`,
    );
  }
  return found as Extract<TwapScenario, { name: N }>;
}

/**
 * A corpus scalar as an exact `bigint`.
 *
 * Refuses an unsafe `number` rather than converting it: reaching here with a
 * `float64` means the reviver above did not fire, and silently rounding would
 * reintroduce exactly the corruption it exists to prevent.
 */
export function bigFrom(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'string') return BigInt(value);
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new Error(
        `corpus value ${value} is not a safe integer and arrived as a number — ` +
          `its exact digits are already lost. Load through loadCorpus().`,
      );
    }
    return BigInt(value);
  }
  throw new TypeError(`cannot read a corpus integer from ${typeof value}`);
}

const TWO_64 = 1n << 64n;

/**
 * A decimal string as the nearest raw 64.64 integer.
 *
 * Half-up, matching the reference model's `raw_64x64_nearest`
 * (`floor(x·2^64 + 0.5)`), so a corpus row that carries both a decimal string
 * and a raw integer agrees with itself under this conversion. Exact: the whole
 * computation is integer.
 */
export function decimalToRaw64x64(text: string): bigint {
  const negative = text.startsWith('-');
  const body = negative ? text.slice(1) : text;
  const [wholeText = '', fracText = ''] = body.split('.');
  const scale = 10n ** BigInt(fracText.length);
  const numerator = BigInt(wholeText) * scale + (fracText === '' ? 0n : BigInt(fracText));
  const shifted = numerator * TWO_64;
  const raw = shifted / scale + ((shifted % scale) * 2n >= scale ? 1n : 0n);
  return negative ? -raw : raw;
}

/** An exact rational: `numerator / denominator`, with the sign on the numerator. */
export interface Rational {
  numerator: bigint;
  denominator: bigint;
}

/**
 * A decimal string as an exact rational `{ numerator, denominator }`.
 *
 * Used where the comparison must stay exact rather than round first — the TWAP
 * grid checks assert a *direction* against the real value (I-13), and rounding
 * the real value onto the grid before comparing would erase the very quantity
 * being asserted.
 */
export function decimalToRational(text: string): Rational {
  const negative = text.startsWith('-');
  const body = negative ? text.slice(1) : text;
  const [wholeText = '', fracText = ''] = body.split('.');
  const denominator = 10n ** BigInt(fracText.length);
  const magnitude =
    BigInt(wholeText) * denominator + (fracText === '' ? 0n : BigInt(fracText));
  return { numerator: negative ? -magnitude : magnitude, denominator };
}

/** `|a − b|` for bigints. */
export function absDiff(a: bigint, b: bigint): bigint {
  return a >= b ? a - b : b - a;
}

/**
 * Run `fn` and return the error it threw.
 *
 * `assert.throws` returns `undefined`, so reading `.code` off its result reads
 * it off nothing and the assertion that follows never runs. This returns the
 * error and fails if none was thrown, so a call that stops refusing is caught
 * rather than skipped.
 */
export function catchThrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected a refusal, but the call returned normally');
}
