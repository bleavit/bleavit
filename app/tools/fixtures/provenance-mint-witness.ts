/**
 * Witness for the VerificationStatus construction gate — never compiled, never imported.
 *
 * The gate exists because three shipped controls were each green over the same defect, so a
 * fourth one observed only through a green run would be worth nothing. Every construction
 * below declares what it must produce, and `--witness` fails on a declared line that goes
 * unmatched **or** on a finding nothing declared.
 *
 * All six statuses appear. A witness proving only that `verified-finalized` is caught leaves
 * the other five mintable, and those are the likelier vehicle for the next defect precisely
 * because they attract less attention — `verified-best` on a pre-read sentinel was one of the
 * six real findings this gate was written from.
 *
 * The negative controls at the bottom must produce **nothing**. Each is a shape a cruder rule
 * fires on, and each occurs in real client code: a `.kind` comparison (`shared-types`), a
 * `switch` arm (`packages/ui/src/badge.tsx`), a type declaration (`Finalized<T>` itself), a
 * same-spelled string that is not a status (`local-index`'s `BodyProvenance`), and the strings
 * inside comments and template literals that turned an earlier line-scanning gate into a
 * report on its own source.
 *
 * The file lives under `tools/fixtures/`, which the scan skips, so it is a fixture rather than
 * a permanent finding — and it is outside `tsconfig.tests.json`'s `tools/*.ts` slice, so it is
 * never type-checked either.
 */

/* eslint-disable */

const CHAIN = '0xabc';
const BLOCK = '0xdef';

// expect: status-literal verified-finalized the exact helper shape the gate was written from
export const finalizedHelper = <T>(value: T, at: { chain: string; blockHash: string; blockNumber: number }) => ({
  value,
  status: {
    kind: 'verified-finalized',
    chain: at.chain,
    blockHash: at.blockHash,
    blockNumber: at.blockNumber,
  },
});

// expect: status-literal verified-best the pre-read sentinel, minted as a standalone const
export const unread = { kind: 'verified-best', chain: '0x', blockHash: '0x', blockNumber: 0 } as const;

// expect: status-literal derived-local nested two objects deep, where a top-level rule stops
export const nested = {
  outer: {
    datum: { value: 1, status: { kind: 'derived-local', coverage: { ranges: [], holes: [] } } },
  },
};

// expect: status-literal stale-cache built through a spread, so the pin is not written here
export function fromSpread(pin: { asOfBlock: number; ageMs: number }) {
  return { kind: 'stale-cache', ...pin };
}

// expect: status-literal external-proposal returned straight out of an arrow, no `status:` key
export const proposed = () => ({ kind: 'external-proposal' });

// expect: status-literal provider the discriminant NAMED rather than written, and folded
const NAMED_KIND = 'provider';
export const named = { value: 0, status: { kind: NAMED_KIND, providerId: 'p', sampled: false } };

// expect: status-shorthand verified-finalized shorthand property, resolved the same way
const kind = 'verified-finalized';
export const shorthand = { kind, chain: CHAIN, blockHash: BLOCK, blockNumber: 1 };

/* ------------------------------------------------------------- negative controls: silence */

/** A comparison. Every consumer of a status does this; none of them mints one. */
export function isFinalizedish(status: { kind: string }): boolean {
  return status.kind === 'verified-finalized' || status.kind === 'verified-best';
}

/** A `switch` arm — `packages/ui/src/badge.tsx` in miniature. */
export function copyFor(status: { kind: string }): string {
  switch (status.kind) {
    case 'verified-finalized':
      return 'Verified at a finalized block';
    case 'provider':
      return 'From a provider, unverified';
    default:
      return 'Unlabelled';
  }
}

/** A **type** declaration. `Finalized<T>` is written exactly this way and must stay silent. */
export interface FinalizedLike {
  readonly status: {
    readonly kind: 'verified-finalized';
    readonly chain: string;
  };
}

export type StatusUnion =
  | { readonly kind: 'verified-finalized'; readonly blockHash: string }
  | { readonly kind: 'stale-cache'; readonly ageMs: number };

/** A same-spelled string that is not a status — `local-index`'s `BodyProvenance` tag. */
export type BodyProvenance = 'verified-finalized' | 'provider';
export function bodyProvenance(origin: string): BodyProvenance {
  return origin === 'self' ? 'verified-finalized' : 'provider';
}

/** A property named something else, holding the same string. Not a discriminant. */
export const notADiscriminant = { origin: 'verified-finalized', label: 'provider' };

/** A `kind` property that is not a status kind at all. */
export const otherKind = { kind: 'stated', datum: { value: 1 } };

/**
 * Strings inside a comment: kind: 'verified-finalized', kind: 'provider'.
 * A line scanner reports both of these, which is how a previous gate came to fire on its own
 * source and had to be rewritten onto the AST.
 */
export const inAString = "kind: 'verified-finalized'";
export const inATemplate = `status: { kind: 'stale-cache' }`;
