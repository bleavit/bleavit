// Witness config — 15 §4.1's anti-vacuity discipline applied to dependency-cruiser.
//
// It reuses the PRODUCTION options object verbatim. An earlier version restated a
// simplified copy, and that copy fired while the production config was silently
// cruising a graph with no edges in it. A witness that does not share the thing it
// witnesses is decoration.
const production = require('../../.dependency-cruiser.cjs');
const { EXTERNAL, WORKSPACE_SUBPATH, POLKADOT_API_NON_SIGNER } = require('../../tools/depcruise-external.cjs');

module.exports = {
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
      to: { path: EXTERNAL('polkadot-api|smoldot') },
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
      // The workspace-subpath matcher, likewise imported rather than restated.
      name: 'witness-workspace-subpath-matcher',
      severity: 'error',
      from: { path: '^tests/depcruise-witness/' },
      to: { path: WORKSPACE_SUBPATH('@bleavit/signing/testing', 'packages/signing/dist/testing') },
    },
  ],
  // Verbatim, minus the exclude that would hide the witness from itself.
  options: { ...production.options, exclude: { path: '(^|/)tests/firewall/fixtures/' } },
};
