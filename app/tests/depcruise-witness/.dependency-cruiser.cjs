// Witness config — 15 §4.1's anti-vacuity discipline applied to dependency-cruiser.
//
// It reuses the PRODUCTION options object verbatim. An earlier version restated a
// simplified copy, and that copy fired while the production config was silently
// cruising a graph with no edges in it. A witness that does not share the thing it
// witnesses is decoration.
const production = require('../../.dependency-cruiser.cjs');

module.exports = {
  forbidden: [
    {
      name: 'witness-wallet-never-imports-acceleration',
      severity: 'error',
      from: { path: '^tests/depcruise-witness/' },
      to: { path: '^packages/(providers|local-index|contexts|intents|receipts|llm-handoff)/' },
    },
  ],
  // Verbatim, minus the exclude that would hide the witness from itself.
  options: { ...production.options, exclude: { path: '(^|/)tests/firewall/fixtures/' } },
};
