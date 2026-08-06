/**
 * What the S3/S4/S20 suites read instead of restating it.
 *
 * Three kinds of evidence, and each exists because the obvious alternative is a test that
 * agrees with itself:
 *
 * - **the specification**, parsed at test time. A rule quoted into an assertion is a copy
 *   that stops tracking the document the moment the document moves, and nothing fails.
 * - **the recorded chain constants** (`app/fixtures/chainhead/`), decoded from the transcript
 *   rather than typed. A hand-written `min_split` of 1,000,000 waives the redemption fee on
 *   every amount 03 §5.3a works in, which is how a fee comparison compares two zeroes.
 * - **the client's own source**, for the shape claims. Several rules in doc 11 are satisfied
 *   here by a type having *no field* to put a forbidden figure in — a claim no render can
 *   demonstrate, since a screen that omits a field it does not have renders identically to
 *   one that has it and left it undefined.
 *
 * Nothing here reads `dist/`. That directory is gitignored build output, so a suite that
 * asserted a shape from it would pass or fail on whether somebody had run `tsc -b`.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** `app/`. */
export const APP_ROOT = resolve(here, '../..');
/** The repository root, which is where `docs/architecture/` lives. */
export const REPO_ROOT = resolve(here, '../../..');

export const DOC_02 = '02-integration-contract.md';
export const DOC_03 = '03-conditional-ledger.md';
export const DOC_11 = '11-frontend-workflows.md';

/** One architecture document, whole. */
export function architecture(doc: string): string {
  return readFileSync(resolve(REPO_ROOT, 'docs/architecture', doc), 'utf8');
}

/** One `src/features/tx/src/` module's source text. */
export function txSource(file: string): string {
  return readFileSync(resolve(APP_ROOT, 'src/features/tx/src', file), 'utf8');
}

/**
 * The line of a document that contains `needle`, refusing if there is not exactly one.
 *
 * Zero matches is the vacuity case every doc-parsing test has: the assertion below it then
 * holds over nothing. Two is worse — it silently picks the first, so an edit elsewhere in the
 * document changes which sentence the suite is binding to without failing anything.
 */
export function theLineContaining(text: string, needle: string): string {
  const lines = text.split('\n').filter((line) => line.includes(needle));
  assert.equal(lines.length, 1, `expected exactly one line containing ${JSON.stringify(needle)}`);
  return lines[0] as string;
}

// ------------------------------------------------------------- the recorded chain constants

interface RecordedLayout {
  readonly type: string;
  readonly value: string;
}

/**
 * A metadata constant as `app/fixtures/chainhead/` recorded it, with its declared SCALE type.
 *
 * The type is returned rather than assumed, because the decoders below are per width and a
 * `(u32,u32)` run through the integer decoder yields a plausible number from the wrong bytes.
 */
export function recordedConstant(surface: string): RecordedLayout {
  const path = resolve(APP_ROOT, 'fixtures/chainhead', `${surface}.json`);
  const recorded: unknown = JSON.parse(readFileSync(path, 'utf8'));
  const requests = (
    recorded as {
      requests: { method: string; response?: { expected_layout?: RecordedLayout } }[];
    }
  ).requests;
  const layout = requests.find((row) => row.method === 'metadata_presence')?.response
    ?.expected_layout;
  assert.ok(layout !== undefined, `${surface} records no constant layout`);
  return layout;
}

function leBytes(hex: string): string[] {
  const bytes = hex.replace(/^0x/, '').match(/../g);
  assert.ok(bytes !== null, 'a recorded constant has no readable encoding');
  return bytes;
}

function fromLe(bytes: readonly string[]): bigint {
  return BigInt(`0x${[...bytes].reverse().join('')}`);
}

/** A recorded scalar constant (`u32`/`u64`/`u128`), decoded little-endian. */
export function recordedScalar(surface: string): bigint {
  const layout = recordedConstant(surface);
  assert.match(layout.type, /^u(32|64|128)$/, `${surface} is ${layout.type}, not a scalar`);
  return fromLe(leBytes(layout.value));
}

/** A recorded `(u32, u32)` constant — `Market::MaxTradeRatio` is the only one these suites read. */
export function recordedU32Pair(surface: string): readonly [bigint, bigint] {
  const layout = recordedConstant(surface);
  assert.equal(layout.type, '(u32,u32)', `${surface} is ${layout.type}, not a u32 pair`);
  const bytes = leBytes(layout.value);
  assert.equal(bytes.length, 8, `${surface} is not eight bytes`);
  return [fromLe(bytes.slice(0, 4)), fromLe(bytes.slice(4, 8))];
}

// --------------------------------------------------------------------- the client's own shapes

/**
 * Source with its comments removed, so a brace or a field name inside a doc comment cannot be
 * read as code. `{@link Combined}` inside a JSDoc block is the case that breaks the naive
 * version, and every interface in these modules carries several.
 *
 * The `[^:]` guard on the line-comment form is what keeps a `https://` inside a string from
 * swallowing the rest of the line; it is the same shape `ledger-domain.test.ts` uses.
 */
export function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function matchingBrace(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  assert.fail('unbalanced braces in a declaration');
}

/**
 * The text of one exported `interface` or `type` declaration, comments stripped.
 *
 * Used for the claims doc 11 makes about *absence* — a fee field on an exempt payout, a
 * winning branch under VOID, a merged portfolio total. Those cannot be demonstrated by
 * rendering, because a type with an undefined optional field renders exactly like a type
 * without the field, so the declaration is the only artefact that carries the claim.
 */
export function declarationOf(source: string, name: string): string {
  const stripped = withoutComments(source);
  const iface = new RegExp(String.raw`export interface ${name}\s*(?:<[^>]*>)?\s*\{`).exec(stripped);
  if (iface !== null) {
    const open = iface.index + iface[0].length - 1;
    return stripped.slice(open, matchingBrace(stripped, open) + 1);
  }
  const alias = new RegExp(String.raw`export type ${name}\s*(?:<[^>]*>)?\s*=`).exec(stripped);
  assert.ok(alias !== null, `${name} is not an exported interface or type alias here`);
  // A union of object arms runs to the first `;` outside any brace, which is where the
  // declaration ends. Scanning rather than regexing, since every arm contains `;` itself.
  let depth = 0;
  for (let i = alias.index + alias[0].length; i < stripped.length; i += 1) {
    const char = stripped[i];
    if (char === '{') depth += 1;
    else if (char === '}') depth -= 1;
    else if (char === ';' && depth === 0) {
      return stripped.slice(alias.index, i + 1);
    }
  }
  assert.fail(`${name}'s declaration never terminates`);
}

/**
 * A `<button>` carrying the boolean `disabled` attribute, as `react-dom/server` emits it.
 *
 * Written once because both plausible spellings are wrong in the silent direction.
 * `html.includes('disabled')` is **true of every button React renders**, since it always
 * emits `aria-disabled`; and `\sdisabled(?=[\s>])` matches nothing at all, because the server
 * renderer writes the boolean attribute as `disabled=""` — so a `doesNotMatch` assertion
 * built on it passes over a screen with everything disabled. Each suite using this pattern
 * also asserts it fires on a render that really is blocked, for that reason.
 */
export const DISABLED_BUTTON = /<button[^>]*\sdisabled=""/;

/**
 * Every property name a declaration mentions, at any depth.
 *
 * Deliberately over-collecting: these are used for *forbidden-name* assertions, where seeing
 * a nested field too is the safe direction. A field-set equality check would need the depth,
 * and the flat interfaces it is used on have none.
 */
export function propertyNames(declaration: string): readonly string[] {
  return [...declaration.matchAll(/(?:readonly\s+)?([A-Za-z_]\w*)\s*\??\s*:/g)].map(
    (match) => match[1] as string,
  );
}
