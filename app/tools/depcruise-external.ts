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
  '|/node_modules/polkadot-api/(?!dist/reexports/(pjs-signer|signer)\\.)';
