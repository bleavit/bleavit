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
 * Keep integers too large for `float64` as their exact source text.
 *
 * The third reviver argument is the JSON source-text access shipped in the
 * Node version `app/.nvmrc` pins. Safe integers are left as numbers so ordinary
 * fields (block heights, counts) keep behaving like numbers.
 */
function preserveExactIntegers(_key, value, context) {
  if (typeof value === 'number' && !Number.isSafeInteger(value) && context?.source !== undefined) {
    return context.source;
  }
  return value;
}

export function loadCorpus() {
  let text;
  try {
    text = readFileSync(CORPUS_PATH, 'utf8');
  } catch (cause) {
    throw new Error(
      `the reference corpus is unreadable at ${CORPUS_PATH}. This suite certifies ` +
        `against the generated artifact and has nothing to compare without it (04 §5).`,
      { cause },
    );
  }
  const corpus = JSON.parse(text, preserveExactIntegers);
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
 * A corpus scalar as an exact `bigint`.
 *
 * Refuses an unsafe `number` rather than converting it: reaching here with a
 * `float64` means the reviver above did not fire, and silently rounding would
 * reintroduce exactly the corruption it exists to prevent.
 */
export function bigFrom(value) {
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
export function decimalToRaw64x64(text) {
  const negative = text.startsWith('-');
  const body = negative ? text.slice(1) : text;
  const [wholeText, fracText = ''] = body.split('.');
  const scale = 10n ** BigInt(fracText.length);
  const numerator = BigInt(wholeText) * scale + (fracText === '' ? 0n : BigInt(fracText));
  const shifted = numerator * TWO_64;
  const raw = shifted / scale + ((shifted % scale) * 2n >= scale ? 1n : 0n);
  return negative ? -raw : raw;
}

/**
 * A decimal string as an exact rational `{ numerator, denominator }`.
 *
 * Used where the comparison must stay exact rather than round first — the TWAP
 * grid checks assert a *direction* against the real value (I-13), and rounding
 * the real value onto the grid before comparing would erase the very quantity
 * being asserted.
 */
export function decimalToRational(text) {
  const negative = text.startsWith('-');
  const body = negative ? text.slice(1) : text;
  const [wholeText, fracText = ''] = body.split('.');
  const denominator = 10n ** BigInt(fracText.length);
  const magnitude =
    BigInt(wholeText) * denominator + (fracText === '' ? 0n : BigInt(fracText));
  return { numerator: negative ? -magnitude : magnitude, denominator };
}

/** `|a − b|` for bigints. */
export function absDiff(a, b) {
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
export function catchThrown(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected a refusal, but the call returned normally');
}
