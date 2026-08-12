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
 *
 * ## Why this file is JavaScript in an otherwise-TypeScript tree
 *
 * dependency-cruiser reads its config with `import()` for `.js`/`.cjs`/`.mjs` and
 * JSON5-parses every other extension, so a `.ts` config is not a thing that can exist —
 * it would be read as data and fail. What *can* be TypeScript is the logic, and that is
 * where the defects have actually been: the matcher helpers below have shipped two rules
 * that could never fire (V-86, V-92). They live in `tools/*.ts` and are reached through a
 * dynamic `import()` Node 22.18 type-strips. What remains here is the rule list, which is
 * data.
 */
const { CHAIN_SDK_PACKAGES, EXTERNAL, HOST_SDK_PACKAGES, WORKSPACE_SUBPATH, POLKADOT_API_NON_SIGNER, TRANSACTION_BUILDER_MACHINE_MODULE } = await import('./tools/depcruise-external.ts');
const { HANDOFF_PATH, NON_LOCAL_DEPENDENCY_TYPES } = await import('./tools/handoff-packages.ts');

export default {
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
        path: '^(src/features/(analysis|handoff)|packages/(providers|local-index|contexts|handoff-envelope|intents|receipts|llm-handoff))/',
      },
    },
    {
      name: 'wallet-never-imports-acceleration',
      severity: 'error',
      comment:
        '10 §10.1: `transaction-builder` and `signing` (the reviewed `wallet`) never ' +
        'import providers, the local index, or any handoff package.',
      from: { path: '^packages/(transaction-builder|signing)/' },
      to: { path: '^packages/(providers|local-index|contexts|handoff-envelope|intents|receipts|llm-handoff)/' },
    },
    {
      name: 'handoff-never-reaches-a-signer',
      severity: 'error',
      comment:
        '10 §10.1: the handoff packages may not reach `signing` or ' +
        '`transaction-builder`. The import path terminates in a TxPreparation ' +
        'entering Draft; it adds no edge to the tx machine (INV-FE-2).',
      from: { path: '^packages/(contexts|handoff-envelope|intents|receipts|llm-handoff)/' },
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
        'SDK. Concrete adapters are injected, so a tx surface cannot reach one. F22 ' +
        'declines the permission entirely — the desktop shell reaches its host in Rust, ' +
        'so no JavaScript in this tree imports either package — which means this rule has ' +
        'no real edge to catch and is proven live only by ' +
        '`tests/depcruise-witness/forbidden-external.ts`. The cruise path was widened to ' +
        '`src-tauri` and `tools/desktop` with the same milestone: a rule that cannot see ' +
        'the one directory whose whole job is talking to a host is a rule about nothing.',
      from: { pathNot: '^packages/platform' },
      to: { path: EXTERNAL(HOST_SDK_PACKAGES) },
    },
    {
      name: 'only-chain-client-opens-a-chain-connection',
      severity: 'error',
      comment:
        '10 §2.1/§4.1: `chain-client` is the sole home of the light-client connection, and ' +
        'therefore the sole source of `Finalized<T>`. A second package able to construct a ' +
        'smoldot chain or a PAPI provider would not need to forge the brand — it could serve ' +
        'reads that never passed the finalized-only discipline and hand them to a UI that ' +
        'cannot tell the difference. `bleavit-client-ts` is exempt because it is not part of ' +
        'the canonical client: it is N10\'s facade for third parties integrating the hosted ' +
        'question service, and nothing in `src/` may import it.',
      from: { pathNot: '^packages/(chain-client|bleavit-client-ts|papi-descriptors|signing)/' },
      to: { path: EXTERNAL(CHAIN_SDK_PACKAGES) },
    },
    {
      name: 'signing-may-only-reach-the-signer-surface',
      severity: 'error',
      comment:
        '`packages/signing` is exempt from the rule above for the *signer* subpaths only ' +
        '(`polkadot-api/pjs-signer`, `polkadot-api/signer`), and this rule is what makes ' +
        '"only" true. The exemption follows the rule above\'s own stated reason rather than ' +
        'its letter: the danger it names is a second package able to construct a chain or a ' +
        'provider and serve reads that never passed the finalized-only discipline. ' +
        '`getPolkadotSignerFromPjs(address, signPayload, signRaw)` constructs neither and ' +
        'cannot read anything — it takes two callbacks and returns a signer. The root entry ' +
        'point, `polkadot-api/smoldot` and the provider subpaths remain forbidden here, ' +
        'because those *can*.',
      from: { path: '^packages/signing/' },
      // `polkadot-api` and every subpath except the two signer ones. smoldot has no
      // signer surface at all, so it stays wholly forbidden via the rule above.
      to: { path: POLKADOT_API_NON_SIGNER },
    },
    {
      name: 'no-test-signer-in-the-bundle',
      severity: 'error',
      comment:
        'INV-FE-5 / 10 §10.1: "no signer adapter marked test-only may appear in a release ' +
        'chunk". `@bleavit/signing/testing` is reachable only by a deliberate subpath import, ' +
        'and this makes that deliberate act fail. The runtime refusal in `SignerRegistry` is ' +
        'the third control, and the only one that survives someone copying the file.',
      from: { path: '^(src|packages)/', pathNot: '^tests/' },
      to: { path: WORKSPACE_SUBPATH('@bleavit/signing/testing', 'packages/signing/dist/testing') },
    },
    {
      name: 'no-test-gate-mint-in-production',
      severity: 'error',
      comment:
        'INV-FE-2/12: the pure gate evaluator exists only to exercise structural tests while ' +
        'the public refresh boundary fails closed. A production import of the testing subpath ' +
        'would recover the caller-controlled proof mint this quarantine removes.',
      from: { path: '^(src|packages)/', pathNot: '^tests/' },
      to: {
        path: WORKSPACE_SUBPATH(
          '@bleavit/transaction-builder/testing',
          'packages/transaction-builder/dist/testing',
          'packages/transaction-builder/src/testing',
        ),
      },
    },
    {
      name: 'no-deep-gate-mint-import-in-production',
      severity: 'error',
      comment:
        'INV-FE-2/12: the package root withholds the pure gate evaluator, but a relative import ' +
        'of the machine module bypasses the exports map. Only the root barrel and quarantined ' +
        'testing entry point may import that module; every other production edge is forbidden.',
      from: {
        path: '^(src|packages)/',
        pathNot: '^packages/transaction-builder/(src|dist)/(index|testing)($|\\.)',
      },
      // A type-only `GatePassed` import grants no runtime constructor. `fees.ts` uses exactly
      // that shape; value-bearing imports are the capability this rule forbids.
      to: {
        path: TRANSACTION_BUILDER_MACHINE_MODULE,
        dependencyTypesNot: ['type-only'],
      },
    },
    {
      name: 'no-range-minting-outside-ingest',
      severity: 'error',
      comment:
        '10 §2.2/§6.3: an `origin ≠ self` range keeps its origin forever — there is no ' +
        'promotion path. `selfRange` mints `origin: "self"` from three plain numbers, so any ' +
        'package holding it can relabel provider data as light-client verified, which is that ' +
        'promotion arriving through the front door. It is barred from the package barrel and ' +
        'reachable only through `@bleavit/local-index/testing`; this makes that import fail in ' +
        'production code. `providers` is the package that matters — it backfills from operator ' +
        'endpoints, indexers and snapshots, and one call would launder any of it.',
      from: { path: '^(src|packages)/', pathNot: '^tests/' },
      to: {
        path: WORKSPACE_SUBPATH('@bleavit/local-index/testing', 'packages/local-index/dist/testing'),
      },
    },
    {
      name: 'no-loosened-sampling-rate-in-production',
      severity: 'error',
      comment:
        '10 §8.4 states the 1-in-16-page re-verification rate normatively and 14 TH-49\'s ' +
        'residual-risk argument is computed from it. `selectSampleAtRate` and ' +
        '`runSamplingRoundAtRate` take that rate as an argument, so holding one is holding a ' +
        'way to switch the sampler off without failing anything: at a large enough rate every ' +
        'import forms one stratum, one row is compared, and every round still reports `clean`. ' +
        'They are barred from the package barrel and reachable only through ' +
        '`@bleavit/providers/testing`; this makes that import fail in production code. Same ' +
        'shape as `no-range-minting-outside-ingest`, and the same failure mode — a control ' +
        'that is present, green, and doing nothing.',
      from: { path: '^(src|packages)/', pathNot: '^tests/' },
      to: {
        path: WORKSPACE_SUBPATH('@bleavit/providers/testing', 'packages/providers/dist/testing'),
      },
    },
    {
      name: 'no-finalized-minting-outside-chain-client',
      severity: 'error',
      comment:
        'INV-FE-1 / 10 §2.1: `Finalized<T>` is the one type the transaction path accepts, ' +
        'and `finalize(value, pin)` mints it from two arguments the caller supplies. Held ' +
        'by `transaction-builder` or `signing`, one call relabels a provider read — or a ' +
        'literal invented on the spot — as light-client-verified state. Neither sibling ' +
        'control can see that: `check:casts` looks for `as Finalized<T>` and there is no ' +
        'assertion, and no import rule fires because reaching `@bleavit/chain-client` is ' +
        'precisely what those packages are allowed to do. So the mint is barred from the ' +
        'package barrel and reachable only through `@bleavit/chain-client/testing`; this ' +
        'makes that import fail in production code. Same shape as ' +
        '`no-range-minting-outside-ingest`, one layer down: that rule protects which ' +
        'origin a range *renders* as, this one protects what may be *signed*.',
      from: { path: '^(src|packages)/', pathNot: '^tests/' },
      to: {
        path: WORKSPACE_SUBPATH('@bleavit/chain-client/testing', 'packages/chain-client/dist/testing'),
      },
    },
    {
      name: 'no-node-light-client-in-the-bundle',
      severity: 'error',
      comment:
        'app-code rule 13, F27. `@bleavit/chain-client/node-light-client` is a SECOND way to ' +
        'start a light client, for drill harnesses under Node. It lives inside `chain-client` ' +
        'so the smoldot import stays where the rule can see it — but that is not sufficient on ' +
        'its own, and an earlier comment in `pnpm-workspace.yaml` wrongly claimed workspace ' +
        'membership confined it: membership confines a ROOT dependency, not a subpath export, ' +
        'and ten packages already declare `@bleavit/chain-client`. ' +
        '`only-chain-client-opens-a-chain-connection` cannot fire on it either, because a ' +
        'caller needs no forbidden external import — `startNodeLightClient` takes only ' +
        '`BundledChain`s. Note the contrast with `./light-client`, which is safe by typing: ' +
        'its `SmoldotClientFactory` must return a real smoldot `Client`, which an outside ' +
        'caller cannot construct. This one hands out the capability outright, so it needs the ' +
        'same explicit bar the five `*/testing` subpaths carry.\n\n' +
        '**Proven in scope, and the witness suite cannot prove it.** This rule\'s `from` is ' +
        '`^(src|packages)/`, and `tests/depcruise-witness` is outside it — a witness module ' +
        'placed there fires `witness-could-not-resolve` instead, which would report success ' +
        'about a different rule. It was verified by importing the subpath from ' +
        '`src/features/tx/src/` and observing this rule name in the error, then removing the ' +
        'probe. Re-run that probe if the rule is ever edited.',
      from: { path: '^(src|packages)/', pathNot: '^tests/' },
      to: {
        path: WORKSPACE_SUBPATH(
          '@bleavit/chain-client/node-light-client',
          'packages/chain-client/dist/node-light-client',
        ),
      },
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
        'The source gate in CI covers the global forms; this covers module imports. ' +
        'Strictly weaker than the two rules below and kept anyway, because it names the ' +
        'libraries in its failure message and a named refusal is easier to act on.',
      from: { path: HANDOFF_PATH },
      to: { path: EXTERNAL('axios|node-fetch|undici|ws|socket\\.io') },
    },
    {
      name: 'handoff-imports-nothing-external',
      severity: 'error',
      comment:
        'D-21: a named-library denylist only forbids the libraries somebody thought of — ' +
        '`import ky` defeated the rule above while every gate stayed green. Nothing on a ' +
        'handoff path imports any external package today, so the honest rule is that none ' +
        'may. `core` is included: node:net and node:fs are as much a network and ' +
        'filesystem surface as any package.',
      from: { path: HANDOFF_PATH },
      to: { dependencyTypes: NON_LOCAL_DEPENDENCY_TYPES },
    },
    {
      name: 'handoff-imports-nothing-unresolvable',
      severity: 'error',
      comment:
        'The other half, and the one a rule usually misses: dependency-cruiser records a ' +
        'specifier it cannot resolve VERBATIM, with no dependency type at all (V-86). An ' +
        'uninstalled package therefore slips past a dependencyTypes rule entirely.',
      from: { path: HANDOFF_PATH },
      to: { couldNotResolve: true },
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
