#!/usr/bin/env node
/**
 * The 10 §9.3 smoldot artifact budget, measured rather than asserted (FE-P4, V-88).
 *
 * §9.3 budgets *"smoldot WASM (worker, lazy) ≤ 3.5 MB gz"* and tagged the figure
 * `[VERIFY artifact size — FE-P4]`. It is now measured — 2.23 MiB gz for `smoldot@3.3.2` —
 * and this gate keeps it measured, because a budget nothing checks is a sentence, and the
 * one thing certain about a dependency's compressed size is that it changes.
 *
 * What it measures, and why that shape: smoldot ships its bytecode as **JavaScript modules
 * carrying zlib-compressed, base64-encoded string literals**, not as a `.wasm` file. So
 * the transferred bytes are those modules gzipped — which is what §9.3's "MB gz" means and
 * what a static gateway actually serves.
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

/** 10 §9.3, the transferred-size budget for the lazily loaded light client. */
const BUDGET_GZ_BYTES = 3.5 * 1024 * 1024;

function smoldotBytecodeDir() {
  const store = join(APP, 'node_modules', '.pnpm');
  const dirs = readdirSync(store).filter((n) => /^smoldot@\d+\./.test(n));
  if (dirs.length !== 1) {
    throw new Error(
      `expected exactly one pinned smoldot in the store, found ${dirs.length} (${dirs.join(', ')}). ` +
        'Two copies would make this measurement meaningless — 10 §10 rule 13 pins smoldot 3.x.',
    );
  }
  return {
    version: dirs[0].slice('smoldot@'.length),
    dir: join(store, dirs[0], 'node_modules', 'smoldot', 'dist', 'mjs', 'internals', 'bytecode'),
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
const mib = (n) => `${(n / 1024 / 1024).toFixed(2)} MiB`;

console.log(`smoldot ${version}: ${files.length} bytecode module(s), ${mib(blob.length)} raw -> ${mib(gz)} gz`);
console.log(`10 §9.3 budget: ${mib(BUDGET_GZ_BYTES)} gz`);

if (gz > BUDGET_GZ_BYTES) {
  console.error(
    `FAIL over the 10 §9.3 budget by ${mib(gz - BUDGET_GZ_BYTES)}. This is not a lint: the light ` +
      'client is the only path to a verified read (INV-FE-1), so its transfer size is what a user ' +
      'on a poor connection pays before the app can do anything at all.',
  );
  process.exit(1);
}
console.log(`OK  ${mib(BUDGET_GZ_BYTES - gz)} of headroom`);
