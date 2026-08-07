#!/usr/bin/env node
/**
 * The 10 §9.4 smoldot artifact budget, measured rather than asserted (FE-P4, V-88).
 *
 * §9.4 budgets *"smoldot WASM (worker, lazy) ≤ 3.5 MB gz"* and tagged the figure
 * `[VERIFY artifact size — FE-P4]`. It is now measured — 2.21 MiB gz for `smoldot@3.3.2` —
 * and this gate keeps it measured, because a budget nothing checks is a sentence, and the
 * one thing certain about a dependency's compressed size is that it changes.
 *
 * What it measures, and why that shape: smoldot ships its bytecode as **JavaScript modules
 * carrying zlib-compressed, base64-encoded string literals**, not as a `.wasm` file. So
 * the transferred bytes are those modules gzipped — which is what §9.4's "MB gz" means and
 * what a static gateway actually serves.
 *
 * **The gz figure is toolchain-dependent, and only the gz one (V-300).** V-88 recorded
 * 2,333,920 B for this same package; the same four modules now compress to 2,320,965 B —
 * 12,955 B less — while the **raw** total (3,082,260 B) and the **brotli** total
 * (2,312,719 B) are byte-identical to V-88. Identical input and identical brotli with a
 * different gzip means the DEFLATE implementation moved, not the dependency. So this gate
 * is a *budget* check and must never become an equality check against a recorded number:
 * pinning the byte count would fail on a Node upgrade while nothing shipped had changed.
 * It is also why the doc cell is quoted to two decimals rather than to the byte.
 *
 * **Fails closed.** If the expected files are not where the pinned version puts them, this
 * exits non-zero rather than reporting a small number: a version bump that reorganised the
 * package would otherwise measure nothing and pass.
 */

import { gzipSync } from 'node:zlib';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, '..');

/**
 * 10 §9.4, the transferred-size budget for the lazily loaded light client.
 *
 * Decimal MB (10^6), which is §9's stated convention throughout — §9.2's depth tables are
 * only reproducible under it, and reading this one cell as MiB would silently grant 5 % more
 * budget than the document allots. `tools/ci/check-frontend-budgets.py` binds this constant
 * to the published cell so the two cannot drift apart again.
 */
const BUDGET_GZ_BYTES = 3.5e6;

function smoldotBytecodeDir() {
  const store = join(APP, 'node_modules', '.pnpm');
  const dirs = readdirSync(store).filter((n) => /^smoldot@\d+\./.test(n));
  if (dirs.length !== 1) {
    throw new Error(
      `expected exactly one pinned smoldot in the store, found ${dirs.length} (${dirs.join(', ')}). ` +
        'Two copies would make this measurement meaningless — 10 §10 rule 13 pins smoldot 3.x.',
    );
  }
  const only = dirs[0];
  // Unreachable given the length check above, and stated anyway: `dirs[0]` on an empty list
  // is `undefined`, and `undefined.slice` would report as a crash in the measurement rather
  // than as the pin problem the check above exists to name.
  if (only === undefined) throw new Error('the pinned-smoldot check found a directory and then lost it');
  return {
    version: only.slice('smoldot@'.length),
    dir: join(store, only, 'node_modules', 'smoldot', 'dist', 'mjs', 'internals', 'bytecode'),
  };
}

const { version, dir } = smoldotBytecodeDir();
if (!/^3\./.test(version)) {
  console.error(`FAIL smoldot ${version} is not the 3.x the stack pins (01 §9 / 10 §10 rule 13)`);
  process.exit(1);
}

const files = readdirSync(dir).filter((n) => n.endsWith('.js')).sort();
if (files.length === 0) {
  console.error(`FAIL no bytecode modules under ${dir}; the package layout moved and nothing was measured`);
  process.exit(1);
}

const blob = Buffer.concat(files.map((n) => readFileSync(join(dir, n))));
const gz = gzipSync(blob, { level: 9 }).length;
const mib = (n: number): string => `${(n / 1024 / 1024).toFixed(2)} MiB`;

console.log(`smoldot ${version}: ${files.length} bytecode module(s), ${mib(blob.length)} raw -> ${mib(gz)} gz`);
console.log(`10 §9.4 budget: ${mib(BUDGET_GZ_BYTES)} gz`);

if (gz > BUDGET_GZ_BYTES) {
  console.error(
    `FAIL over the 10 §9.4 budget by ${mib(gz - BUDGET_GZ_BYTES)}. This is not a lint: the light ` +
      'client is the only path to a verified read (INV-FE-1), so its transfer size is what a user ' +
      'on a poor connection pays before the app can do anything at all.',
  );
  process.exit(1);
}
console.log(`OK  ${mib(BUDGET_GZ_BYTES - gz)} of headroom`);
