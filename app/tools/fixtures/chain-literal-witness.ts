/**
 * Witness for the 10 §5.4 no-hardcoded-chain-value gate — never compiled, never imported.
 *
 * A gate proven only by a green run is not proven: this repository has already shipped a
 * dependency-cruiser rule whose matcher could never fire and a hostile-intent digest code
 * that no path emitted, and both passed CI every day.
 *
 * **Every line below declares what it must produce** (`// expect: A` or `// expect: B`), and
 * `--witness` fails if any declared line goes unmatched. Requiring only "each rule fired
 * once" was the first version and it was too weak: the two easiest lines satisfy it while
 * every hard form — the typed binding, the shift expression, the hex literal — could go
 * unmatched under a green witness. Same discipline as the negative-compilation corpus's
 * `expect-error` markers, adopted after the same class of defect (V-91).
 *
 * The file lives outside the scanned scope (`tools/fixtures/`), so it is a fixture rather
 * than a permanent finding.
 */

// expect: A — the plain form, with the *correct* value, which a value scan would wave through
export const MAX_POSITIONS_PER_ACCOUNT = 64;

// expect: A — the other casing convention, so a rename cannot dodge the rule
export const maxLiveProposals = 32;

// expect: A, B — a type annotation between the name and the number; the regex draft missed
// this, and the value is distinctive too, so both rules must fire on the one line
export const MaxPayloadBytes: number = 65536;

// expect: B — a distinctive frozen value with no name attached (`DescriptorLeadTime`)
export function isDescriptorLate(blocksSinceAuthorisation: number): boolean {
  return blocksSinceAuthorisation > 43200;
}

// expect: B — the form app-code rule 8 names outright: never the literal `1n << 63n`
export function isServiceDomain(id: bigint): boolean {
  return id >= 1n << 63n;
}

// expect: B — hexadecimal, which the text-scanning draft could not see at all
export const payloadCeiling = 0x10000;

// expect: A, B — exponent form of the same boundary, and the name is the constant's own
export const serviceIdBase = 2 ** 63;

// A regex literal containing a frozen value is NOT code and must not be reported. There is
// no expectation on this line, so a scanner that reported it would produce an undeclared
// finding — visible in the witness output — while a scanner that blanked the following
// lines as a comment would miss the declared line below it.
export const looksLikeADeadline = /43200/;

// expect: B — reachable only if the line above did not swallow it
export const stillScanned = 201600;

// A string body is not code either, and this one contains a comment opener that the
// text-scanning draft treated as the start of a real comment.
export const openComment = '/*';

// expect: B — reachable only if the string above did not open a comment
export const afterTheString = 100800;
