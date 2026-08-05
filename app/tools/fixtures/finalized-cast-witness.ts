/**
 * Witness for the `Finalized<T>` assertion gate — never compiled, never imported.
 *
 * The gate was rewritten from a line scanner to an AST walk when `app/`'s tools became
 * TypeScript (#31) and the scanner started matching its own diagnostic strings. Rewriting a
 * detection engine and observing a green run proves nothing about the new one — this
 * repository has already shipped a dependency-cruiser rule whose matcher could never fire
 * (V-86) and a hostile-intent digest code no path emitted, both under green CI. So every
 * line below declares what it must produce and `--witness` fails on a declared line that
 * goes unmatched.
 *
 * Three expectations, one per mint mechanism:
 *
 *   `double`     — `as unknown as`, the assertion that defeats every nominal technique
 *   `assertion`  — an assertion to a type mentioning `Finalized`
 *   `predicate`  — `x is Finalized<T>`, which asserts a phantom field it cannot check (V-81)
 *
 * The wrapper and line-wrapped cases are here because the regexes the AST replaced could not
 * see them, so they are the ones a reader would most reasonably doubt.
 *
 * The negative controls at the bottom must produce **nothing**. They are the failure the
 * rewrite was for: a comment and a string body containing the exact banned phrases. Under a
 * line scanner those fire, which is how the gate came to be reporting its own source.
 *
 * The file lives outside the scanned scope (`tools/fixtures/`), so it is a fixture rather
 * than a permanent finding.
 */

import type { Finalized } from '@bleavit/chain-client';

declare const value: unknown;

// expect: double — the plain form
export const plainDouble = value as unknown as string;

// expect: double — split across lines, which a text pattern for `as unknown as` cannot see
export const wrappedDouble = value as
  unknown as string;

// expect: assertion — the direct mint
export const direct = value as Finalized<number>;

// expect: assertion — wrapped in a utility type; mints exactly as effectively
export const wrapped = value as Readonly<Finalized<number>>;

// expect: assertion — an array of them, same
export const asArray = value as Finalized<number>[];

// expect: assertion — a union arm, so narrowing the caller yields the brand
export const inUnion = value as Finalized<number> | undefined;

// expect: predicate — asserts the phantom field, so it is a mint (V-81)
export function looksFinalized(x: unknown): x is Finalized<number> {
  return typeof x === 'object';
}

// ---------------------------------------------------------------------------------------
// Negative controls. Nothing below may produce a finding.
//
// A line scanner fires on every one of them, and that is not a hypothetical: it is why the
// gate failed against its own source the moment the tool became TypeScript.

// as unknown as string — a comment carrying the banned phrase
// x is Finalized<number> — a comment carrying the predicate form

export const inAString = 'value as unknown as string';
export const inATemplate = `a predicate reads x is Finalized<T> and mints`;
export const alsoFine = value as string;
