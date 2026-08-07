/**
 * Match an external package by BOTH the forms dependency-cruiser records it in.
 *
 * A `node_modules/…` matcher alone can never fire (V-86). An external specifier the
 * resolver cannot follow — one that is not installed, or whose `exports` map hides its
 * subpaths from enhanced-resolve — is recorded verbatim as the bare specifier with
 * `couldNotResolve: true`, never as a `node_modules/` path. So the three rules that used
 * that matcher were structurally incapable of firing, and reported success for it. Proven
 * by injecting `import 'ws'` into a handoff package and watching nothing happen — the
 * same way `depcruise:witness` came to exist.
 *
 * The bare form is anchored so a local module whose path merely contains the name (say
 * `packages/chain-client/src/smoldot.ts`) is not swept up.
 *
 * Lives in its own module because dependency-cruiser clones the config it is given: a
 * function hung off the config's own exports fails with "could not be cloned". The
 * witness imports this file directly, so it exercises the production matcher rather than
 * a restatement of it.
 *
 * TypeScript, imported from an `.mjs` dependency-cruiser config through a dynamic
 * `import()` that Node 22.18 type-strips (measured, not assumed). The config files
 * themselves stay JavaScript because dependency-cruiser reads them with `import()` only
 * for `.js`/`.cjs`/`.mjs` and JSON5-parses every other extension — so a `.ts` config is
 * not a thing that can exist. That is the honest boundary: the *logic* here, which has
 * shipped two vacuous-matcher defects (V-86, V-92), is typed; the rule lists are data in
 * the only format the tool accepts.
 */
export const EXTERNAL = (names: string): string => `^(${names})(/|$)|/node_modules/(${names})/`;

/**
 * Every package that can open a chain connection, **in both the naming forms that reach it**.
 *
 * `polkadot-api` is an umbrella: its providers are separately published, separately
 * installable **scoped** packages — `@polkadot-api/ws-provider`, `@polkadot-api/sm-provider`,
 * `@polkadot-api/smoldot` — and they are already in this repo's store as transitive
 * dependencies. The previous pattern was `EXTERNAL('polkadot-api|smoldot')`, whose bare arm
 * is `^(polkadot-api|smoldot)(/|$)`: anchored at `^`, it **cannot match a specifier starting
 * with `@`**. So a package that added `@polkadot-api/ws-provider` to its own `package.json`
 * would get a working provider with the CI-fatal rule structurally unable to object.
 *
 * Measured rather than reasoned, by adding both scoped specifiers to the witness: they were
 * reported by `witness-could-not-resolve` alone — which fires *because* they are not
 * installed there — and by neither `witness-external-package-matcher` nor
 * `witness-polkadot-api-non-signer-matcher`. Declaring the dependency is exactly what makes
 * them resolvable, so that one rule stops firing at the same moment the import starts working.
 *
 * This is the third instance of V-86/V-92's class in these matchers, so it is written as a
 * **wildcard with a named exception** rather than a list: an enumeration of provider packages
 * goes stale the first time PAPI publishes another one, and goes stale silently.
 *
 * The exception is `@polkadot-api/descriptors`, which is not an external package at all —
 * it is this workspace's own `packages/papi-descriptors` under its generated name. It carries
 * generated type data and can construct nothing, so forbidding it would fail a future import
 * that the danger this rule names does not cover.
 */
export const CHAIN_SDK_PACKAGES = 'polkadot-api|smoldot|@polkadot-api/(?!descriptors($|/))[^/]+';

/**
 * The host and native SDKs 10 §10.1 names — `only-platform-touches-host-sdks`.
 *
 * Lifted out of the rule and shared with the witness for the reason this file exists: a
 * witness carrying its own copy of a pattern proves the copy fires, not the rule. It matters
 * more here than elsewhere, because **nothing in `app/` imports either package**. F22
 * declined the permission 10 §10.1 grants — `packages/platform` reaches a host through an
 * injected bridge, so the desktop shell can embed the published `dist/` byte for byte — and
 * a forbidden rule with no real edge anywhere in the tree is precisely the shape that goes
 * vacuous without anybody noticing. `tests/depcruise-witness/forbidden-external.ts` imports
 * both spellings and MUST be reported.
 */
export const HOST_SDK_PACKAGES = '@tauri-apps|@parity/product-sdk';

/**
 * The same trap, one layer in: a **workspace subpath export**.
 *
 * `@bleavit/signing/testing` resolves at build time through the package's `exports` map,
 * but enhanced-resolve does not follow it, so dependency-cruiser records the bare
 * specifier with `couldNotResolve: true` — exactly as it does for an uninstalled external
 * package. A rule written against the resolved `packages/signing/dist/testing` path is
 * therefore vacuous, which is how INV-FE-5's "no test signer in a release chunk" rule
 * first shipped unable to fire.
 *
 * The general statement, worth keeping in one place: **dependency-cruiser records any
 * specifier it cannot resolve verbatim.** Always match both the specifier a source file
 * writes and the path it would resolve to.
 */
export const WORKSPACE_SUBPATH = (specifier: string, distPath: string): string =>
  `^${specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|/)|^${distPath}`;

/**
 * `polkadot-api`, minus the two subpaths that are only a signer.
 *
 * `packages/signing` is exempt from `only-chain-client-opens-a-chain-connection` for
 * `polkadot-api/pjs-signer` and `polkadot-api/signer`, and this pattern is what keeps
 * "only" true. The exemption follows that rule's own stated reason rather than its
 * letter: the danger named there is a second package able to construct a chain or a
 * provider and serve reads that never passed the finalized-only discipline.
 * `getPolkadotSignerFromPjs(address, signPayload, signRaw)` takes two callbacks and
 * returns a signer — it cannot read anything. The root entry point, `/smoldot` and the
 * provider subpaths still *can*, so they stay forbidden.
 *
 * Shared with the witness rather than restated there, for V-86's reason: a witness
 * carrying its own copy of a pattern proves the copy fires, not the rule.
 *
 * **Both recorded forms, and here the split is not hypothetical — it is measured.**
 * `import 'polkadot-api'` *resolves*, so it is recorded as
 * `node_modules/.pnpm/polkadot-api@…/dist/…`; every subpath (`/smoldot`, `/ws-provider`,
 * `/pjs-signer`) is hidden from enhanced-resolve by the package's `exports` map and is
 * recorded as the bare specifier with `couldNotResolve: true`. A bare-only pattern
 * therefore forbids the subpaths and lets the **root entry point** — the one that can
 * construct everything — straight through. That version was written, with a comment
 * citing V-86 directly above it, and the root import passed clean.
 *
 * The `node_modules` alternative carries the signer exclusion too. Today it is redundant,
 * because the signer subpaths never resolve; it is there so that a resolver or packaging
 * change which *does* resolve them cannot silently flip a permitted import into a
 * forbidden one.
 */
export const POLKADOT_API_NON_SIGNER: string =
  '^polkadot-api(?!/(pjs-signer|signer)($|/))(/|$)' +
  '|/node_modules/polkadot-api/(?!dist/reexports/(pjs-signer|signer)\\.)' +
  // The scoped half, for `CHAIN_SDK_PACKAGES`' reason. `packages/signing` is exempted from
  // `only-chain-client-opens-a-chain-connection` by path, so this pattern is the *whole* of
  // what stops it reaching a provider — and without these two arms it stopped only the
  // unscoped spelling. `@polkadot-api/pjs-signer` is the scoped form of the permitted
  // subpath and is excluded here for the same reason `polkadot-api/pjs-signer` is above:
  // it takes two callbacks and returns a signer, so it can construct nothing and read
  // nothing. `descriptors` is excluded for `CHAIN_SDK_PACKAGES`' reason.
  '|^@polkadot-api/(?!(pjs-signer|signer|descriptors)($|/))[^/]+' +
  '|/node_modules/@polkadot-api/(?!(pjs-signer|signer|descriptors)/)';
