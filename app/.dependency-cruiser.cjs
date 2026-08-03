/**
 * The 10 §10.1 forbidden edges — CI-fatal.
 *
 * This is the SECOND gate, deliberately redundant. The primary gate is module
 * resolution: `src/features/*` and `packages/*` are workspace packages whose
 * `package.json` dependencies are their reference sets, and pnpm's isolated
 * `node_modules` (pinned in `.npmrc`, not defaulted) makes an undeclared import
 * unresolvable rather than merely un-referenced.
 *
 * Redundancy is the point. The primary gate is a property of the install layout,
 * so a future `node-linker=hoisted` — or a `paths` alias added for convenience —
 * would silently demote it. These rules keep failing in that case.
 */
module.exports = {
  forbidden: [
    {
      name: 'tx-unit-isolation',
      severity: 'error',
      comment:
        '10 §10.2: the tx unit may not see analysis or handoff, or any acceleration ' +
        'package. Provider- and index-fed data must be structurally unable to seed ' +
        'transaction form state (INV-FE-3).',
      from: { path: '^src/features/tx/' },
      to: {
        path: '^(src/features/(analysis|handoff)|packages/(providers|local-index|contexts|intents|receipts|llm-handoff))/',
      },
    },
    {
      name: 'wallet-never-imports-acceleration',
      severity: 'error',
      comment:
        '10 §10.1: `transaction-builder` and `signing` (the reviewed `wallet`) never ' +
        'import providers, the local index, or any handoff package.',
      from: { path: '^packages/(transaction-builder|signing)/' },
      to: { path: '^packages/(providers|local-index|contexts|intents|receipts|llm-handoff)/' },
    },
    {
      name: 'handoff-never-reaches-a-signer',
      severity: 'error',
      comment:
        '10 §10.1: the handoff packages may not reach `signing` or ' +
        '`transaction-builder`. The import path terminates in a TxPreparation ' +
        'entering Draft; it adds no edge to the tx machine (INV-FE-2).',
      from: { path: '^packages/(contexts|intents|receipts|llm-handoff)/' },
      to: { path: '^packages/(signing|transaction-builder|providers|local-index)/' },
    },
    {
      name: 'shared-types-depends-on-nothing',
      severity: 'error',
      comment:
        '10 §2.1: `shared-types` is the dependency-free root. If it gains a dependency ' +
        'it becomes a place the Finalized<T> brand could reach, and the brand in the ' +
        'universal sink package is the invariant being void with green CI.',
      from: { path: '^packages/shared-types/' },
      to: { path: '^packages/', pathNot: '^packages/shared-types/' },
    },
    {
      name: 'nothing-bypasses-chain-client',
      severity: 'error',
      comment:
        '10 §10.1: `chain-client` imports nothing above it in the graph.',
      from: { path: '^packages/chain-client/' },
      to: { path: '^packages/', pathNot: '^packages/(chain-client|shared-types)/' },
    },
    {
      name: 'only-platform-touches-host-sdks',
      severity: 'error',
      comment:
        '10 §10.1: `platform` is the only package permitted to import a native or host ' +
        'SDK. Concrete adapters are injected, so a tx surface cannot reach one.',
      from: { pathNot: '^packages/platform' },
      to: { path: 'node_modules/(@tauri-apps|@parity/product-sdk)' },
    },
    {
      name: 'no-mock-signer-in-the-bundle',
      severity: 'error',
      comment:
        'INV-FE-5: the test double must be structurally impossible to ship. ' +
        '`mock-runtime` is a devDependency of the suites and a dependency of nothing.',
      from: { path: '^(src|packages)/', pathNot: '^tests/' },
      to: { path: '^packages/mock-runtime/' },
    },
    {
      name: 'no-network-primitive-in-handoff',
      severity: 'error',
      comment:
        'D-21 / INV-FE-6: the handoff packages contain no network primitive at all. ' +
        'The source gate in CI covers the global forms; this covers module imports.',
      from: { path: '^packages/(contexts|intents|receipts|llm-handoff)/' },
      to: { path: 'node_modules/(axios|node-fetch|undici|ws|socket\\.io)' },
    },
    { name: 'no-circular', severity: 'error', from: {}, to: { circular: true } },
    { name: 'no-orphans', severity: 'warn', from: { orphan: true, pathNot: '\\.d\\.ts$' }, to: {} },
  ],
  options: {
    // `doNotFollow`, NOT `exclude`, for dist: cross-package specifiers resolve to
    // each package's `dist/`, so EXCLUDING dist drops the target module and every
    // cross-package edge with it — the rules then pass on a graph with no edges in
    // it. That is how an injected `signing -> providers` went undetected here.
    // `doNotFollow` records the edge and declines to traverse further, which is
    // what we want.
    doNotFollow: { path: '(node_modules|(^|/)dist/)' },
    exclude: { path: '(^|/)tests/(firewall/fixtures|depcruise-witness)/' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    // NO `enhancedResolveOptions` here. Setting `conditionNames` broke resolution
    // outright: every edge silently disappeared and all rules below became
    // vacuous while still reporting "0 errors". Found by injecting a forbidden
    // edge and watching nothing happen — which is why `pnpm run depcruise:witness`
    // exists and runs in CI beside this.
    //
    // Workspace specifiers resolve through pnpm's symlinks to real paths under
    // `packages/`, so the `^packages/...` matchers above see the true package, not
    // `node_modules/@bleavit/...`. They resolve to each package's `dist/`, so the
    // build must run first — one more reason the witness is not optional.
  },
};
