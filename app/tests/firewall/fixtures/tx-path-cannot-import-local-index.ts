// expect-error: TS2307 — the tx path cannot even resolve the local index; 10 §10.2 makes the firewall a module-resolution failure, not a lint
// MUST FAIL: `packages/transaction-builder` and `packages/signing` are on the transaction
// path, and INV-FE-7 states that path "never reads" browser-local storage. 10 §10.1 makes that
// a **package boundary**: neither declares `@bleavit/local-index`, so under pnpm's isolated
// node_modules the specifier does not resolve at all.
//
// This fixture existed nowhere, and its absence is the gap that matters. The `→ local-index`
// edge is the one INV-FE-7 rests on: every other control in `packages/local-index` — the
// unexported `selfRange`, the `SelfIngested` brand, the coverage validation — is documented as
// tolerable *because* the transaction path cannot read this package. `coverage.ts` says so in
// as many words ("What makes that harmless is INV-FE-7 plus the firewall"), and until now the
// only thing asserting it was a test that greps the dependency-cruiser config for a rule name.
// A config a rule is written in is not a compiler.
//
// Both import forms are here for the same reason `forbidden-package-edge.ts` carries both: the
// side-effect form is the one TypeScript ignores unless `noUncheckedSideEffectImports` is set.
import '@bleavit/local-index';
import { isVerifiedAt } from '@bleavit/local-index';
import { evaluate } from '@bleavit/transaction-builder';

// And the shape the rule exists to forbid: a precondition satisfied by locally-indexed
// coverage. 10 §6.3's `isVerifiedAt` answers a question about *this device's own index*, which
// INV-FE-3 says may never satisfy a precondition — so even if the import resolved, the value it
// produces has no route into `evaluate`, whose only input is `Finalized<T>`.
export const laundered = [isVerifiedAt, evaluate];
