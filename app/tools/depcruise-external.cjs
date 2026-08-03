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
 * witness requires this file directly, so it exercises the production matcher rather than
 * a restatement of it.
 */
const EXTERNAL = (names) => `^(${names})(/|$)|/node_modules/(${names})/`;

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
const WORKSPACE_SUBPATH = (specifier, distPath) =>
  `^${specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|/)|^${distPath}`;

module.exports = { EXTERNAL, WORKSPACE_SUBPATH };
