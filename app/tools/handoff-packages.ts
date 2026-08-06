/**
 * The D-21 handoff trust domain, in one place.
 *
 * Two gates enforce 10 §13's "the client makes no network request on any handoff path":
 * `.dependency-cruiser.mjs` over the module graph, and `check-handoff-network.ts` over
 * the source text. Each needs to know *which* packages are on a handoff path, and two
 * copies of that list is one copy too many — a new handoff package added to one and
 * forgotten in the other is silently unguarded by the gate that did not hear about it,
 * with both still green.
 *
 * So the list lives here and both read it. The scanner additionally fails if a listed
 * directory is missing or empty, because a typo'd path is the same defect wearing a
 * different hat: a scan that covers nothing reports success.
 *
 * TypeScript, reached from the `.mjs` dependency-cruiser configs through a dynamic
 * `import()` Node type-strips — see `depcruise-external.ts` for why the configs cannot
 * themselves be TypeScript.
 *
 * `src/features/handoff` is on the list and is not a `packages/` entry — it is the 10 §10.2
 * compilation unit, whose reference set is its own `package.json`. It gets the same
 * treatment because it is on the same path.
 */

/** Package directory names under `packages/`, alphabetical. */
export const HANDOFF_PACKAGES: readonly string[] = [
  'contexts',
  'handoff-envelope',
  'intents',
  'llm-handoff',
  'receipts',
];

/** Every source root on a handoff path, relative to `app/`. */
export const HANDOFF_SOURCE_DIRS: readonly string[] = [
  ...HANDOFF_PACKAGES.map((name) => `packages/${name}/src`),
  'src/features/handoff/src',
];

/** A dependency-cruiser `path` matching any handoff module. */
export const HANDOFF_PATH = `^(packages/(${HANDOFF_PACKAGES.join('|')})|src/features/handoff)/`;

/**
 * Every dependency type that means "not a module in this repository".
 *
 * `core` is in the list deliberately: `node:net`, `node:http` and `node:fs` are as much a
 * network and filesystem surface as any package, and nothing on a handoff path has a
 * reason to reach one. Unresolvable specifiers are matched separately — dependency-cruiser
 * records those verbatim with `couldNotResolve`, never as a dependency type, which is the
 * V-86 trap in its general form.
 */
export const NON_LOCAL_DEPENDENCY_TYPES: readonly string[] = [
  'npm',
  'npm-dev',
  'npm-optional',
  'npm-peer',
  'npm-no-pkg',
  'npm-unknown',
  'core',
];
