/**
 * The pinned PAPI issues JSON-RPC methods; the pinned smoldot has to serve them.
 * Nothing checked that, and a version bump on either side is silent (F1 / FE-P2, V-137).
 *
 * The client's entire read path is `chainHead_v1_*` over a light client (10 §4.1–§4.2).
 * Those method names are chosen by `@polkadot-api/substrate-client` and answered inside
 * smoldot's wasm, so both ends live in `node_modules` and neither is visible to the type
 * checker, dependency-cruiser, or any suite in this repository: `tests/chain-client`
 * drives the transport against *recorded transcripts*, which by construction answer
 * whatever was recorded. A smoldot release that dropped a method, or a PAPI release that
 * started issuing a new one, would pass every gate here and fail in a browser.
 *
 * So this gate compares the two pinned packages directly, and **derives both sides**:
 *
 *  - the issued set from PAPI's own `methods.js`, the module that builds the wire names;
 *  - the served set from smoldot's shipped wasm, whose JSON-RPC dispatch matches method
 *    names against string literals in its data section.
 *
 * Neither list is written down here. A hand-copied list is the defect this repository
 * keeps finding (SQ-490): it agrees with itself forever.
 *
 * **What this proves, and what it does not.** Presence in the dispatch table proves the
 * dispatcher *knows* a name, not that it *serves* it — measured, not assumed: smoldot
 * 3.3.2 carries `system_localPeerId` in the same sorted run and answers it with
 * `-32000 "Not implemented in smoldot yet"`. So this is a **removal** detector, and the
 * unimplemented case is covered at runtime instead, by reading a failed call as *unknown*
 * rather than as a value (V-137). Stated rather than left for a reader to discover, since
 * a gate believed to prove more than it does is worse than none.
 *
 * Run: `pnpm run check:smoldot-surface` (and `:witness`, which must fail).
 */

import { inflateSync } from 'node:zlib';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * A transitive dependency's directory, found the way `check-smoldot-budget.mjs` finds
 * smoldot and for the same two reasons.
 *
 * Neither package is hoisted, so `require.resolve` cannot see them from here; and
 * `exports` maps do not publish `./package.json` (verified — `@polkadot-api/
 * substrate-client` exports exactly `"."`), so resolving *through* the dependent fails
 * too. The store layout is the only path that works.
 *
 * **Exactly one copy is required.** With two in the store this gate would be reading a
 * package the app might not run, which is worse than not running at all.
 */
function pinnedPackage(storePrefix: string, packagePath: string): { version: string; dir: string } {
  const store = join(APP, 'node_modules', '.pnpm');
  const escaped = storePrefix.replace(/[+/@]/g, (c) => `\\${c}`);
  const dirs = readdirSync(store).filter((n) => new RegExp(`^${escaped}@\\d+\\.`).test(n));
  if (dirs.length !== 1) {
    throw new Error(
      `expected exactly one pinned ${storePrefix} in the store, found ${dirs.length} ` +
        `(${dirs.join(', ')}); this gate cannot tell which one the app would run`,
    );
  }
  return {
    version: dirs[0].slice(storePrefix.length + 1),
    dir: join(store, dirs[0], 'node_modules', packagePath),
  };
}

const smoldotDir = () => pinnedPackage('smoldot', 'smoldot');
const substrateClientDir = () =>
  pinnedPackage('@polkadot-api+substrate-client', '@polkadot-api/substrate-client').dir;

/**
 * Every JSON-RPC method the pinned PAPI can put on the wire.
 *
 * Read out of `methods.js` rather than imported: the module is not an export of the
 * package, and importing by deep path would break on a layout change *silently* if the
 * import were optional. Parsed here, a layout change is an error.
 */
function issuedMethods(): string[] {
  const src = readFileSync(join(substrateClientDir(), 'dist', 'methods.js'), 'utf8');

  // `const chainHead = { body: "", call: "", … };` … then every key is rewritten to
  // `${group}_v1_${key}`. Reproduce that construction from the source rather than
  // hardcoding the result, so a new group or a changed version infix is picked up.
  const groups = [...src.matchAll(/const\s+(\w+)\s*=\s*\{([^}]*)\}/g)];
  const infix = /\$\{fnGroupName\}(_v\d+_)\$\{methodName\}/.exec(src)?.[1];
  if (!infix) {
    throw new Error(
      "methods.js no longer builds names as `${fnGroupName}_vN_${methodName}`; this gate " +
        'cannot derive the issued set and refuses to guess it',
    );
  }
  const names: string[] = [];
  for (const [, group, body] of groups) {
    for (const [, key] of body.matchAll(/(\w+)\s*:/g)) names.push(`${group}${infix}${key}`);
  }
  if (names.length === 0) throw new Error('derived an empty issued-method set from methods.js');
  return names.sort();
}

/** smoldot's wasm, decoded out of the base64+zlib chunks the package ships. */
function smoldotWasm(dir: string): Buffer {
  const chunks: string[] = [];
  for (let i = 0; ; i += 1) {
    let src: string;
    try {
      src = readFileSync(join(dir, 'dist', 'mjs', 'internals', 'bytecode', `wasm${i}.js`), 'utf8');
    } catch {
      break;
    }
    const m = /return\s+"([A-Za-z0-9+/=]+)"/.exec(src);
    if (!m) throw new Error(`smoldot bytecode chunk ${i} is not the expected base64 payload`);
    chunks.push(m[1]);
  }
  if (chunks.length === 0) throw new Error('found no smoldot bytecode chunks; the layout moved');
  const wasm = inflateSync(Buffer.from(chunks.join(''), 'base64'));
  if (wasm.subarray(0, 4).toString('binary') !== '\0asm') {
    throw new Error('decoded smoldot payload is not a wasm module');
  }
  return wasm;
}

function main(): number {
  const witness = process.argv.includes('--witness');
  const { version, dir } = smoldotDir();
  const wasm = smoldotWasm(dir);
  const issued = issuedMethods();

  // Anti-vacuity, both directions, before any verdict is reported. A decoder that
  // returned an empty buffer would fail the first; a matcher that always said yes would
  // fail the second. Without these the gate passes loudest when it is broken.
  const controlPresent = 'chainHead_v1_follow';
  const controlAbsent = 'chainHead_v1_thisMethodDoesNotExist';
  if (!wasm.includes(controlPresent)) {
    console.error(`control failed: ${controlPresent} absent from the decoded wasm`);
    return 1;
  }
  if (wasm.includes(controlAbsent)) {
    console.error(`control failed: ${controlAbsent} reported present; the matcher is vacuous`);
    return 1;
  }

  const probes = witness ? [...issued, controlAbsent] : issued;
  const missing = probes.filter((name) => !wasm.includes(name));

  console.log(
    `smoldot ${version}: ${wasm.length.toLocaleString()} B decoded; ` +
      `${issued.length} method(s) issued by the pinned PAPI`,
  );
  for (const name of probes) console.log(`  ${missing.includes(name) ? 'MISSING' : 'present'}  ${name}`);

  if (witness) {
    if (missing.length === 1 && missing[0] === controlAbsent) {
      console.log('\nwitness OK — the gate detects a method the pinned smoldot does not carry');
      return 0;
    }
    console.error(`\nwitness FAILED — expected exactly [${controlAbsent}], got [${missing}]`);
    return 1;
  }

  if (missing.length > 0) {
    console.error(
      `\n${missing.length} method(s) the pinned PAPI issues are absent from the pinned ` +
        `smoldot's dispatch table. A bump moved one side without the other; the client ` +
        `would fail in a browser with no test here going red.`,
    );
    return 1;
  }
  console.log('\nevery method the pinned PAPI issues is carried by the pinned smoldot');
  return 0;
}

process.exit(main());
