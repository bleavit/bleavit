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
