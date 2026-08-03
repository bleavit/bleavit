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
