#!/usr/bin/env node
/**
 * The assertion gate for `Finalized<T>` — 10 §2.1, layer 2 of 3.
 *
 * The brand makes `Finalized<T>` unforgeable by object literal, spread, or
 * `satisfies`. It does NOT stop a type assertion: `x as Finalized<T>` is a
 * narrowing assertion between related types, which TypeScript permits by design.
 * The corpus proved that empirically rather than us assuming it.
 *
 * So the brand is not the whole control. This gate is the other half: exactly one
 * site in the workspace may assert to `Finalized<T>`, and `as unknown as` — the
 * double assertion that defeats any nominal technique in TypeScript — is banned
 * outright. Both are grep-able, which is precisely why the phantom-symbol design
 * was chosen over a class with a private member.
 *
 * Exit 0 = clean. Exit 1 = a new assertion site appeared.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The single site permitted to mint the brand (10 §2.1). */
const ALLOWED_MINT_SITE = join('packages', 'chain-client', 'src', 'provenance.ts');

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'fixtures']);

const FINALIZED_CAST = /\bas\s+Finalized\s*</;
const DOUBLE_CAST = /\bas\s+unknown\s+as\b/;

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx|mts)$/.test(entry)) yield full;
  }
}

const violations = [];
for (const file of walk(appRoot)) {
  const rel = relative(appRoot, file);
  const isMintSite = rel.split('/').join(sep) === ALLOWED_MINT_SITE;
  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    if (line.trimStart().startsWith('*') || line.trimStart().startsWith('//')) return;
    if (DOUBLE_CAST.test(line)) {
      violations.push(`${rel}:${i + 1}  banned double assertion \`as unknown as\``);
    }
    if (FINALIZED_CAST.test(line) && !isMintSite) {
      violations.push(`${rel}:${i + 1}  \`as Finalized<...>\` outside ${ALLOWED_MINT_SITE}`);
    }
  });
}

if (violations.length > 0) {
  console.error('Finalized<T> assertion gate FAILED (10 §2.1):\n');
  for (const v of violations) console.error(`  ${v}`);
  console.error(
    '\nThe brand stops object literals; it cannot stop an assertion. Exactly one\n' +
      `site may mint a Finalized<T>: ${ALLOWED_MINT_SITE}. If you need one\n` +
      'elsewhere, you need a light-client read instead.',
  );
  process.exit(1);
}
console.log(`Finalized<T> assertion gate OK — one permitted mint site, no double assertions.`);
