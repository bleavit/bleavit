#!/usr/bin/env node
/**
 * The 10 §9.4 initial-JS budget, measured over the built tree (F14).
 *
 * §9.4 budgets *"Initial JS (critical path, gz) ≤ 350 KB / hard-fail 450 KB"* and names
 * its enforcement a **bundle-size CI gate**. No such gate existed: the row has been in the
 * document since the reviewed design, CI has built the release tree per commit for as long
 * as `release:build` has existed, and nothing measured what it emitted. That is the same
 * shape as SQ-557 — a published budget whose enforcement column names a mechanism that was
 * never written — and it is the row a client actually regresses on, because a dependency
 * added for one screen lands on the critical path of every screen.
 *
 * ## What "critical path" means here, mechanically
 *
 * The bytes a browser must fetch and execute before it can render anything: the entry
 * chunk named by `index.html`, plus every chunk reachable from it through **static**
 * imports, transitively. A `import(...)` edge is deliberately *not* followed — that is
 * precisely the lazy boundary §9.4 draws when it budgets smoldot on its own separate row,
 * and a gate that summed the whole `assets/` directory would charge the critical path for
 * code that a first render never touches, then get relaxed until it stopped complaining.
 *
 * `<link rel="modulepreload">` targets are included when present. They are fetched during
 * initial load by definition, so leaving them out would let a chunk move off the budget by
 * being preloaded rather than imported.
 *
 * ## Units
 *
 * KB is 10^3 bytes, per the convention 10 §9 states once for the whole section. The
 * budget constants below are bound to §9.4's published cell by
 * `tools/ci/check-frontend-budgets.py`, so this file cannot drift from the document the
 * way `check-smoldot-budget.ts` did — it held its own copy of a bound and read it as MiB.
 *
 * ## Fails closed
 *
 * A missing `dist/`, an `index.html` with no module entry, or a referenced chunk that is
 * not on disk all exit non-zero. The failure this must never have is measuring nothing and
 * reporting a comfortable number.
 */

import { gzipSync } from 'node:zlib';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, '..');
const DIST = join(APP, 'dist');

/** 10 §9.4, the p50 target for initial critical-path JavaScript, gzipped. Decimal KB. */
const TARGET_GZ_BYTES = 350_000;
/** 10 §9.4's hard failure threshold for the same measurement. */
const HARD_FAIL_GZ_BYTES = 450_000;

function fail(message: string): never {
  console.error(`FAIL ${message}`);
  process.exit(1);
}

/** Static import specifiers only — `import(...)` is the lazy boundary and is not followed. */
function staticImports(source: string): string[] {
  const specifiers: string[] = [];
  // `import … from '…'`, bare `import '…'`, and `export … from '…'`. Rollup emits all
  // three; a dynamic `import(` never matches because the quote does not follow the keyword.
  const pattern = /(?:^|[\s;])(?:import|export)(?:[\s\S]*?\sfrom)?\s*["']([^"']+)["']/g;
  for (const match of source.matchAll(pattern)) {
    const specifier = match[1];
    if (specifier !== undefined && specifier.startsWith('.')) specifiers.push(specifier);
  }
  return specifiers;
}

function chunkPath(fromDistRelative: string, specifier: string): string {
  return normalize(join(dirname(fromDistRelative), specifier));
}

function main(): void {
  if (!existsSync(DIST)) {
    fail(
      `no ${DIST} — run \`pnpm run release:build\` first. This gate measures the emitted tree, ` +
        'so an absent one is an unmeasured release, never a passing one.',
    );
  }
  const html = join(DIST, 'index.html');
  if (!existsSync(html)) fail(`${html} is missing; the build did not emit an entry document`);
  const document = readFileSync(html, 'utf8');

  const entries: string[] = [];
  for (const match of document.matchAll(/<script[^>]*type="module"[^>]*src="([^"]+)"/g)) {
    if (match[1] !== undefined) entries.push(match[1]);
  }
  for (const match of document.matchAll(/<link[^>]*rel="modulepreload"[^>]*href="([^"]+)"/g)) {
    if (match[1] !== undefined) entries.push(match[1]);
  }
  if (entries.length === 0) {
    fail(
      'index.html declares no `<script type="module">` entry. Either the build changed shape — ' +
        'update this gate — or nothing is being loaded, and either way the budget is unmeasured.',
    );
  }

  const seen = new Set<string>();
  const queue = entries.map((href) => normalize(href.replace(/^\.\//, '')));
  let total = 0;
  const measured: Array<{ file: string; raw: number; gz: number }> = [];

  while (queue.length > 0) {
    const relative = queue.shift();
    if (relative === undefined || seen.has(relative)) continue;
    seen.add(relative);
    const absolute = join(DIST, relative);
    if (!existsSync(absolute)) {
      fail(
        `${relative} is referenced from the critical path but is not in the built tree. A chunk ` +
          'that cannot be found cannot be weighed, and skipping it would understate the budget.',
      );
    }
    const source = readFileSync(absolute, 'utf8');
    const gz = gzipSync(Buffer.from(source), { level: 9 }).length;
    total += gz;
    measured.push({ file: relative, raw: Buffer.byteLength(source), gz });
    for (const specifier of staticImports(source)) queue.push(chunkPath(relative, specifier));
  }

  const kb = (n: number): string => `${(n / 1000).toFixed(1)} KB`;
  for (const { file, raw, gz } of measured) {
    console.log(`  ${file}: ${kb(raw)} raw -> ${kb(gz)} gz`);
  }
  console.log(
    `initial JS critical path: ${measured.length} chunk(s), ${kb(total)} gz ` +
      `(10 §9.4 target ${kb(TARGET_GZ_BYTES)}, hard fail ${kb(HARD_FAIL_GZ_BYTES)})`,
  );

  if (total > HARD_FAIL_GZ_BYTES) {
    fail(
      `over 10 §9.4's hard-fail threshold by ${kb(total - HARD_FAIL_GZ_BYTES)}. This is the ` +
        'first-load cost every user pays on every screen, including the ones that need it least.',
    );
  }
  if (total > TARGET_GZ_BYTES) {
    // Over target but under the hard fail: reported loudly and non-fatally, because §9.4
    // states two thresholds and collapsing them to one would either block work the
    // document permits or let the target rot into decoration.
    console.warn(
      `WARN over 10 §9.4's ${kb(TARGET_GZ_BYTES)} target by ${kb(total - TARGET_GZ_BYTES)}, ` +
        `inside the ${kb(HARD_FAIL_GZ_BYTES)} hard fail. The document permits this; it does not ` +
        'expect it to stay that way.',
    );
  }
  console.log(`OK  ${kb(HARD_FAIL_GZ_BYTES - total)} below the hard-fail threshold`);
}

main();
