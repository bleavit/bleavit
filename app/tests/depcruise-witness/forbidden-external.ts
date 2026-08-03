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
