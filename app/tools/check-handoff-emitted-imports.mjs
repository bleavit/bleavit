/**
 * Every import in the **emitted** modules on a handoff path — F7, V-109 corrected.
 *
 * ## The hole this closes, and how it was found
 *
 * 10 §10.1's last handoff rule is that *"No package on a handoff path imports anything
 * external"*, and 10 §10.2 names the enforcement: *"An import … fails compilation — module
 * resolution cannot see it. This requires an isolated `node_modules` layout."* dependency-
 * cruiser is the stated second, redundant gate.
 *
 * Building F7's screens made it necessary to check that claim rather than repeat it, and
 * it is false in two independent ways at once — measured, not reasoned:
 *
 * 1. **`tsc` is satisfied by types alone.** `--traceResolution` on a handoff-unit file
 *    importing `react/jsx-runtime` resolves it to `@types/react/jsx-runtime.d.ts` at the
 *    app root and compiles clean, even though the `react` *runtime* package is reachable
 *    from nowhere in that project. A types package declared once at the workspace root is
 *    visible to every project regardless of the isolated layout, so for any external
 *    package with a `@types/…` counterpart the primary gate does not fire.
 * 2. **dependency-cruiser never sees a compiler-injected import.** It cruises source with
 *    `tsPreCompilationDeps`, and `import { jsx } from "react/jsx-runtime"` exists only in
 *    the emitted output. Confirmed by cruising a handoff `.tsx` file: zero errors, and the
 *    edge is absent from the graph entirely.
 *
 * So a handoff screen written the obvious way — `jsx: "react-jsx"` with the default
 * `jsxImportSource` — would have carried an external import into the trust domain with
 * **every gate green**. The first failure would have been `vite build`, at release time,
 * reading as a packaging problem rather than a firewall breach.
 *
 * `jsxImportSource: "@bleavit/ui"` is the repair (see `packages/ui/src/jsx-runtime.ts`).
 * This gate is what keeps the repair from being a convention: it reads what was actually
 * emitted, which is the only artefact that reflects both the source *and* the compiler.
 *
 * ## Why the emitted tree and not, say, a stricter tsconfig
 *
 * Because the emitted tree is what runs. Whatever a future compiler flag, JSX transform,
 * helper-emit setting or downlevel polyfill injects, it appears here. A gate over source
 * can only ever cover what somebody wrote.
 */

import { createRequire } from 'node:module';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const APP_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
// The same single list dependency-cruiser and the network scanner read, so three gates
// cannot disagree about what counts as a handoff path.
const { HANDOFF_SOURCE_DIRS } = require('./handoff-packages.cjs');

/**
 * A specifier that is local: relative, or a workspace package.
 *
 * `@bleavit/*` is not waved through on trust — those packages are themselves on the
 * handoff path or are `ui`, and each is covered by the dependency-cruiser rules over the
 * source graph. What this gate adds is the *non*-`@bleavit` case, which that graph cannot
 * see.
 */
const isLocal = (specifier) => specifier.startsWith('.') || specifier.startsWith('@bleavit/');

/**
 * Every module specifier an emitted file actually imports — read off the AST.
 *
 * The first version of this matched `from '…'` with a regex and immediately reported
 * `packages/contexts/dist/scope.js` importing `"opt-in"`, from the sentence *"…are opt-in
 * per export"* inside a doc comment. That is the same tokenizer hole `check-chain-literals`
 * was rebuilt to avoid, and the lesson is identical: a comment body and a string body are
 * simply not import declarations to a parser, and no amount of regex refinement gets there.
 *
 * Four node kinds carry a specifier, and all four are covered because each is a real way to
 * pull a module in: static `import`, re-exporting `export … from`, dynamic `import()`, and
 * `require()` (which emitted ESM should never contain — and if it appears, that is precisely
 * what this gate should say out loud rather than skip).
 */
function specifiersIn(file, source) {
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
  const found = [];
  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      found.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node)) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      const [first] = node.arguments;
      if ((isDynamicImport || isRequire) && first !== undefined && ts.isStringLiteral(first)) {
        found.push(first.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return found;
}

function* jsFilesUnder(directory) {
  let entries;
  try {
    entries = readdirSync(directory);
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      yield* jsFilesUnder(path);
      continue;
    }
    if (entry.endsWith('.js')) yield path;
  }
}

/**
 * Check one emitted tree.
 *
 * Exported so the witness drives the real function over a fixture rather than restating
 * its logic — a witness carrying its own copy proves the copy fires (V-86).
 */
export function checkEmittedTree(distDir, { label = distDir } = {}) {
  const findings = [];
  let scanned = 0;
  for (const file of jsFilesUnder(distDir)) {
    scanned += 1;
    const source = readFileSync(file, 'utf8');
    for (const specifier of specifiersIn(file, source)) {
      if (isLocal(specifier)) continue;
      findings.push({ file: relative(APP_ROOT, file), specifier, label });
    }
  }
  return { scanned, findings };
}

/**
 * The witness — the same production function over a fixture tree that MUST be flagged.
 *
 * Per-case rather than "the gate fired at least once": a single assertion is satisfied by
 * whichever fixture is easiest, and the two that matter here are the ones that were wrong
 * in the first draft — the compiler-injected JSX import (the whole reason the gate exists)
 * and the doc-comment false positive (which made the gate unusable rather than merely
 * incomplete). Negative controls must produce nothing, since a scanner that flags
 * everything passes every "it fired" test perfectly.
 */
const WITNESS_FIXTURES = [
  {
    name: 'compiler-injected-jsx.js',
    mustFlag: ['react/jsx-runtime'],
    source: [
      '// Exactly what `--jsx react-jsx` emits with the default jsxImportSource.',
      'import { jsx as _jsx } from "react/jsx-runtime";',
      'export const view = () => _jsx("div", {});',
    ].join('\n'),
  },
  {
    name: 'plain-external.js',
    mustFlag: ['ky'],
    source: 'import ky from "ky";\nexport const get = ky;\n',
  },
  {
    name: 'reexport.js',
    mustFlag: ['node:fs'],
    source: 'export { readFileSync } from "node:fs";\n',
  },
  {
    name: 'dynamic-and-require.js',
    mustFlag: ['undici', 'axios'],
    source: [
      'export const later = () => import("undici");',
      'export const older = () => require("axios");',
    ].join('\n'),
  },
  {
    name: 'control-local-only.js',
    mustFlag: [],
    source: [
      'import { canonicalJson } from "@bleavit/handoff-envelope";',
      'import { parse } from "./parse.js";',
      'export const use = () => parse(canonicalJson({}));',
    ].join('\n'),
  },
  {
    name: 'control-prose-and-strings.js',
    mustFlag: [],
    source: [
      '/**',
      ' * The default scope excludes account data — positions are opt-in per export, and a',
      ' * producer reading this from "ky" or from `import x from "axios"` in prose is reading',
      ' * a sentence, not an import.',
      ' */',
      'export const NOTE = \'see: import { thing } from "undici"\';',
      'export const RE = /from "node:net"/;',
    ].join('\n'),
  },
];

function witness() {
  const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
  const { tmpdir } = require('node:os');
  const root = mkdtempSync(join(tmpdir(), 'bleavit-emitted-witness-'));
  let failed = 0;
  try {
    for (const fixture of WITNESS_FIXTURES) {
      writeFileSync(join(root, fixture.name), fixture.source);
    }
    for (const fixture of WITNESS_FIXTURES) {
      const single = mkdtempSync(join(tmpdir(), 'bleavit-emitted-one-'));
      writeFileSync(join(single, fixture.name), fixture.source);
      const { findings } = checkEmittedTree(single, { label: fixture.name });
      rmSync(single, { recursive: true, force: true });
      const flagged = findings.map((finding) => finding.specifier).sort();
      const expected = [...fixture.mustFlag].sort();
      if (JSON.stringify(flagged) !== JSON.stringify(expected)) {
        console.error(
          `WITNESS ${fixture.name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(flagged)}`,
        );
        failed += 1;
        continue;
      }
      console.log(
        `witness ${fixture.name}: ${expected.length === 0 ? 'clean, as required' : `flagged ${expected.join(', ')}`}`,
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  if (failed > 0) {
    console.error(`\n${failed} witness case(s) did not behave as declared — the gate is not live.`);
    process.exit(1);
  }
  console.log(`\n${WITNESS_FIXTURES.length} witness cases behaved exactly as declared.`);
}

function main() {
  if (process.argv.includes('--witness')) {
    witness();
    return;
  }
  let scanned = 0;
  const findings = [];
  const empty = [];

  for (const sourceDir of HANDOFF_SOURCE_DIRS) {
    // `packages/intents/src` → `packages/intents/dist`.
    const distDir = join(APP_ROOT, sourceDir.replace(/\/src$/, '/dist'));
    const result = checkEmittedTree(distDir, { label: sourceDir });
    // A scan that covers nothing reports success. A handoff package with no emitted output
    // means the build did not run, and a green result here would be a lie about it.
    if (result.scanned === 0) empty.push(relative(APP_ROOT, distDir));
    scanned += result.scanned;
    findings.push(...result.findings);
  }

  for (const dir of empty) {
    console.error(
      `EMPTY ${dir} — no emitted modules. Run \`pnpm run build\` first; a scan over an ` +
        'empty tree passes without having checked anything.',
    );
  }
  for (const { file, specifier, label } of findings) {
    console.error(
      `EXTERNAL ${file} imports "${specifier}" — ${label} is on a handoff path, and ` +
        '10 §10.1 admits no external import there. If the compiler injected it, change the ' +
        'setting that made it do so (see `packages/ui/src/jsx-runtime.ts`); do not exempt it.',
    );
  }

  if (empty.length > 0 || findings.length > 0) process.exit(1);
  console.log(
    `OK ${scanned} emitted modules across ${HANDOFF_SOURCE_DIRS.length} handoff trees ` +
      'import nothing external.',
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
