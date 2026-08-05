// expect-error: TS2322 — 10 §2.1: a data component takes `Verified<T>`; a raw value cannot be rendered
// MUST FAIL: this is the load-bearing half of INV-FE-9's render rule. `Verified<T>` is an
// object, `ReactNode` does not accept an arbitrary object, so a screen holding a model
// whose leaves are `Verified<T>` cannot put one on screen without going through a `ui`
// component — and every `ui` component derives the badge from the status it was handed.
//
// If this ever compiles, the rule has become a convention: a screen could render a chain
// value with no provenance label at all, and no test of the happy path would notice.
import type { ReactNode } from '@bleavit/ui';
import type { Verified } from '@bleavit/shared-types';

declare const price: Verified<bigint>;
export const child: ReactNode = price;
