// Witness config — 15 §4.1's anti-vacuity discipline applied to dependency-cruiser.
//
// It reuses the PRODUCTION options object verbatim. An earlier version restated a
// simplified copy, and that copy fired while the production config was silently
// cruising a graph with no edges in it. A witness that does not share the thing it
// witnesses is decoration.
const production = require('../../.dependency-cruiser.cjs');
const { EXTERNAL } = require('../../tools/depcruise-external.cjs');

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
  ],
  // Verbatim, minus the exclude that would hide the witness from itself.
  options: { ...production.options, exclude: { path: '(^|/)tests/firewall/fixtures/' } },
};
