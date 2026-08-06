// Witness config — 15 §4.1's anti-vacuity discipline applied to dependency-cruiser.
//
// It reuses the PRODUCTION options object verbatim. An earlier version restated a
// simplified copy, and that copy fired while the production config was silently
// cruising a graph with no edges in it. A witness that does not share the thing it
// witnesses is decoration.
const { default: production } = await import('../../.dependency-cruiser.mjs');
const { CHAIN_SDK_PACKAGES, EXTERNAL, WORKSPACE_SUBPATH, POLKADOT_API_NON_SIGNER } = await import('../../tools/depcruise-external.ts');
const { NON_LOCAL_DEPENDENCY_TYPES } = await import('../../tools/handoff-packages.ts');

export default {
  forbidden: [
    {
      name: 'witness-wallet-never-imports-acceleration',
      severity: 'error',
      from: { path: '^tests/depcruise-witness/' },
      to: { path: '^packages/(providers|local-index|contexts|intents|receipts|llm-handoff)/' },
    },
    {
      // The EXTERNAL matcher itself, imported from production rather than restated — the
      // `node_modules/…` form it replaced could never fire (V-86), and a witness that
      // carried its own copy of the pattern would not have noticed.
      name: 'witness-external-package-matcher',
      severity: 'error',
      from: { path: '^tests/depcruise-witness/' },
      to: { path: EXTERNAL(CHAIN_SDK_PACKAGES) },
    },
    {
      // The signing exemption's boundary. `packages/signing` may import
      // `polkadot-api/pjs-signer`, and this proves the *rest* of `polkadot-api` still
      // fails from there — a narrowed firewall rule nobody watches fail is how the next
      // vacuous control ships.
      name: 'witness-polkadot-api-non-signer-matcher',
      severity: 'error',
      from: { path: '^tests/depcruise-witness/' },
      to: { path: POLKADOT_API_NON_SIGNER },
    },
    {
      // The two matchers that replaced the handoff denylist. `dependencyTypes` catches a
      // resolvable package and `couldNotResolve` catches one that is not installed — and
      // the second is the half a rule usually lacks, so both are witnessed rather than
      // assumed to be equivalent.
      name: 'witness-non-local-dependency-types',
      severity: 'error',
      from: { path: '^tests/depcruise-witness/' },
      to: { dependencyTypes: NON_LOCAL_DEPENDENCY_TYPES },
    },
    {
      name: 'witness-could-not-resolve',
      severity: 'error',
      from: { path: '^tests/depcruise-witness/' },
      to: { couldNotResolve: true },
    },
    {
      // The workspace-subpath matcher, likewise imported rather than restated.
      name: 'witness-workspace-subpath-matcher',
      severity: 'error',
      from: { path: '^tests/depcruise-witness/' },
      to: { path: WORKSPACE_SUBPATH('@bleavit/signing/testing', 'packages/signing/dist/testing') },
    },
    {
      // The range-minting subpath. Witnessed on its own because `WORKSPACE_SUBPATH` is
      // parameterised by specifier *and* dist path: a typo in either would make
      // `no-range-minting-outside-ingest` vacuous with the signing witness still green.
      name: 'witness-local-index-testing-subpath',
      severity: 'error',
      from: { path: '^tests/depcruise-witness/' },
      to: {
        path: WORKSPACE_SUBPATH('@bleavit/local-index/testing', 'packages/local-index/dist/testing'),
      },
    },
    {
      // The sampling-rate subpath. Witnessed on its own for the same reason as the two
      // around it: a typo in either half of `WORKSPACE_SUBPATH` leaves
      // `no-loosened-sampling-rate-in-production` unable to fire while every other subpath
      // witness stays green, and a sampler a caller can widen silently is 14 TH-49's stated
      // rate with nothing enforcing it.
      name: 'witness-providers-testing-subpath',
      severity: 'error',
      from: { path: '^tests/depcruise-witness/' },
      to: {
        path: WORKSPACE_SUBPATH('@bleavit/providers/testing', 'packages/providers/dist/testing'),
      },
    },
    {
      // The `Finalized<T>` mint subpath, witnessed separately for the same parameterisation
      // reason — and it is the one whose vacuity would cost most, since
      // `no-finalized-minting-outside-chain-client` is what stops the transaction path
      // labelling an arbitrary value as light-client-verified.
      name: 'witness-chain-client-testing-subpath',
      severity: 'error',
      from: { path: '^tests/depcruise-witness/' },
      to: {
        path: WORKSPACE_SUBPATH('@bleavit/chain-client/testing', 'packages/chain-client/dist/testing'),
      },
    },
  ],
  // Verbatim, minus the exclude that would hide the witness from itself.
  options: { ...production.options, exclude: { path: '(^|/)tests/firewall/fixtures/' } },
};
