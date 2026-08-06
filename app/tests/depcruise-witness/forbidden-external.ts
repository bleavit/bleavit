// WITNESS MODULE — this file is SUPPOSED to violate a rule.
//
// The companion to `forbidden-edge.ts`, for the *external package* matcher rather than
// the workspace one. It exists because the `node_modules/…` form those rules used could
// never fire (V-86): an external specifier the resolver cannot follow is recorded as the
// bare specifier, so three CI-fatal rules — including D-21's "no network primitive in the
// handoff packages" — reported success while being structurally incapable of failing.
//
// If `pnpm run depcruise:witness` stops reporting an error for this file, the external
// matcher has gone vacuous again and every green production run above it means nothing.
import 'polkadot-api/sm-provider';
export const usesAnExternalChainSdk = true;

// The workspace-subpath half of the same trap: `@bleavit/signing/testing` resolves through
// the package's `exports` map at build time, but enhanced-resolve does not follow it, so
// dependency-cruiser records the bare specifier. INV-FE-5's "no test signer in a release
// chunk" rule first shipped unable to fire for exactly that reason.
import '@bleavit/signing/testing';

// The SAME matcher with a different specifier, witnessed separately rather than assumed to
// follow from the line above. `WORKSPACE_SUBPATH` takes both a specifier and a dist path, so
// a typo in either leaves `no-range-minting-outside-ingest` structurally unable to fire while
// the signing witness stays green — and that rule is the only thing stopping `providers` from
// minting `origin: 'self'` and laundering backfilled data into light-client-verified.
import '@bleavit/local-index/testing';

// The sampling-rate subpath, witnessed on its own for the same parameterisation reason. A
// typo in either half of `WORKSPACE_SUBPATH('@bleavit/providers/testing', …)` leaves
// `no-loosened-sampling-rate-in-production` unable to fire while every other subpath witness
// stays green — and that rule is the only thing between 14 TH-49's "1 row per 16 pages" and a
// round that compares one row of any import at all and reports it clean.
import '@bleavit/providers/testing';

// And the third instance of the same matcher, for the subpath that matters most:
// `@bleavit/chain-client/testing` is the `Finalized<T>` construction site, so a vacuous
// `no-finalized-minting-outside-chain-client` would let `transaction-builder` mint the one
// type the transaction path accepts. Witnessed on its own, not inferred from the two above.
import '@bleavit/chain-client/testing';

// The signing exemption's boundary, witnessed. `packages/signing` may reach
// `polkadot-api/pjs-signer` because a signer factory cannot serve a read; everything else
// under `polkadot-api` still constructs chains and providers, so it must still fail. A
// narrowed rule that nobody watches fail is how the next V-86 ships.
import 'polkadot-api/ws-provider';

// The RESOLVABLE half of the handoff import ban, and it is here because the first version
// of that witness could not fire. Every import above is one dependency-cruiser cannot
// resolve, so all three are recorded verbatim with `couldNotResolve` and none carries a
// dependency *type* — the `dependencyTypes` matcher matched nothing and the witness for it
// passed green anyway. A node built-in always resolves, and resolves as `core`, which is
// in `NON_LOCAL_DEPENDENCY_TYPES` precisely because `node:net` and `node:fs` are as much a
// network and filesystem surface on a handoff path as any package.
import 'node:http';

// The SCOPED spelling of the same capability, and the third instance of V-86's class in
// these matchers. `polkadot-api`'s providers are separately published, separately
// installable packages — `@polkadot-api/ws-provider`, `@polkadot-api/sm-provider` — and the
// bare arm of the old pattern (`^(polkadot-api|smoldot)(/|$)`) is anchored at `^`, so it
// could never match a specifier starting with `@`. Measured before the repair: both lines
// below were reported by `witness-could-not-resolve` alone, which fires *because* they are
// not installed here — and declaring the dependency, which is what a package would do to
// use one, is exactly what makes that rule stop firing. Both matchers must catch these.
import '@polkadot-api/ws-provider';
import '@polkadot-api/sm-provider';

// The HOST-SDK matcher (`only-platform-touches-host-sdks`, 10 §10.1). F22 declined the
// permission that rule grants — `packages/platform` imports no `@tauri-apps/*` at all, so
// the desktop shell can embed the published `dist/` byte for byte rather than a
// desktop-specific rebuild — and a forbidden rule with nothing anywhere in the tree to
// catch is exactly the shape that goes vacuous unwatched. Both spellings the rule names are
// witnessed, because `EXTERNAL` takes an alternation and a typo in either arm leaves half
// the rule dead while the other half keeps this witness green.
import '@tauri-apps/api';
import '@parity/product-sdk';
