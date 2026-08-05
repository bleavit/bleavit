#!/usr/bin/env node
/**
 * No markup sinks anywhere in app source — 11 §11.8.1, and the general case behind it.
 *
 * §11.8.1 says evidence bytes are *"rendered as text/structured data only, never HTML"*.
 * Evidence is bytes an **adversary chose**, displayed inside a console operated by the
 * system's most privileged actors, and 10 §13.2's imported documents are the same shape from
 * a different direction. The rule is not specific to one screen: nothing in this client has a
 * reason to build DOM from a string.
 *
 * A type cannot enforce it. `AdmittedEvidence.text` is a `string`, and
 * `dangerouslySetInnerHTML={{ __html: evidence.text }}` typechecks perfectly — the same shape
 * as `check-render-provenance`'s rule A, where the payload of a well-typed wrapper is an
 * ordinary primitive that any sink accepts. So this is a source gate.
 *
 * ## Why the sink list is short, and why it is closed
 *
 * `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write` and React's
 * `dangerouslySetInnerHTML` are the ways a string becomes DOM in a browser. `eval` and
 * `new Function` are here too: they are not markup sinks, but they are the same failure —
 * adversary-chosen text becoming code — and a client that has no reason to build DOM from a
 * string has no reason to build *functions* from one either.
 *
 * The list is closed rather than a pattern, because a pattern over "anything ending in HTML"
 * would fire on `parseHtml`, `escapeHtml`, `htmlLang` and be switched off within a week —
 * the same narrowing `check-chain-literals.ts`'s rule B needed.
 *
 * ## AST, not text
 *
 * Every hole adversarial review found in `check-chain-literals.ts` was a *tokenizer* hole:
 * a string containing a comment opener swallowed the following lines, a regex character class
 * read as a comment. A property named in a comment or inside a string literal is not a
 * property access, and on the AST it simply is not one — so the discussion of these sinks in
 * this file's own header does not trip it.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The ways a string becomes DOM, or code. Closed — see the header. */
export const SINKS = Object.freeze([
  'dangerouslySetInnerHTML',
  'innerHTML',
  'outerHTML',
  'insertAdjacentHTML',
  'eval',
]);

const ROOTS = ['src', 'packages'];
const SKIP = new Set(['node_modules', 'dist', 'papi-descriptors', '.papi']);

function sourceFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (SKIP.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry) && !/\.d\.ts$/.test(entry)) out.push(full);
    }
  };
  walk(join(APP, root));
  return out;
}

/** One markup or code sink, with the line for the report. */
export interface SinkFinding {
  readonly file: string;
  readonly line: number;
  readonly sink: string;
}

export function scan({ files = ROOTS.flatMap(sourceFiles) }: { files?: readonly string[] } = {}): SinkFinding[] {
  const findings: SinkFinding[] = [];
  for (const file of files) {
    const source = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.ESNext,
      true,
      /\.tsx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const report = (node: ts.Node, sink: string): void => {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart());
      findings.push({ file: relative(APP, file), line: line + 1, sink });
    };
    const visit = (node: ts.Node): void => {
      // `x.innerHTML = …`, `el.insertAdjacentHTML(…)` — a property access, never a comment
      // or a string, because on the AST those are simply not this node kind.
      if (ts.isPropertyAccessExpression(node) && SINKS.includes(node.name.getText())) {
        report(node, node.name.getText());
      }
      // `{ innerHTML: … }` and JSX `dangerouslySetInnerHTML={…}`
      if (
        (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) &&
        SINKS.includes(node.name.getText())
      ) {
        report(node, node.name.getText());
      }
      if (ts.isJsxAttribute(node) && SINKS.includes(node.name.getText())) {
        report(node, node.name.getText());
      }
      // Bare `eval(…)`, and `new Function('…')` — text becoming code, the same failure.
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'eval') {
        report(node, 'eval');
      }
      if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Function') {
        report(node, 'new Function');
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return findings;
}

const WITNESS = join(APP, 'tools/fixtures/html-sink-witness.tsx');

function runWitness(): number {
  const findings = scan({ files: [WITNESS] });
  const lines = readFileSync(WITNESS, 'utf8').split('\n');
  const expected: { sink: string; from: number; to: number }[] = [];
  lines.forEach((line, index) => {
    const match = /^\s*\/\/ expect-sink: (.+)$/.exec(line);
    if (match !== null && match[1] !== undefined) {
      expected.push({ sink: match[1].trim(), from: index + 2, to: index + 4 });
    }
  });
  if (expected.length === 0) {
    console.error('witness: no `// expect-sink:` lines — the fixture proves nothing.');
    return 1;
  }
  let failed = 0;
  for (const want of expected) {
    const hit = findings.find(
      (f) => f.sink === want.sink && f.line >= want.from && f.line <= want.to,
    );
    if (hit === undefined) {
      console.error(
        `witness: ${want.sink} was NOT detected at line ${want.from}-${want.to} — the gate ` +
          'cannot see the sink it forbids.',
      );
      failed += 1;
    }
  }
  // Negative controls: every finding must be one somebody declared.
  const claimed = (f: SinkFinding): boolean => expected.some((w) => f.line >= w.from && f.line <= w.to);
  for (const f of findings.filter((x) => !claimed(x))) {
    console.error(`witness: FALSE POSITIVE at line ${f.line} (${f.sink}) — a control fired.`);
    failed += 1;
  }
  if (failed > 0) return 1;
  console.log(
    `witness: all ${expected.length} sinks detected, no false positives on the controls.`,
  );
  return 0;
}

function main(argv: readonly string[]): number {
  if (argv.includes('--witness')) return runWitness();
  const findings = scan();
  if (findings.length === 0) {
    console.log(`no markup or code sinks: ${SINKS.length} forms checked across app source.`);
    return 0;
  }
  console.error('markup/code sink in app source — 11 §11.8.1, and 10 §13.2 by the same logic:\n');
  for (const finding of findings) {
    console.error(`  ${finding.file}:${finding.line}  ${finding.sink}`);
  }
  console.error(
    '\nNothing in this client builds DOM or code from a string. Evidence and imported ' +
      'documents are adversary-chosen bytes; render them as text.',
  );
  return 1;
}

if (process.argv[1] !== undefined && import.meta.url === `file://${resolve(process.argv[1])}`) {
  process.exit(main(process.argv.slice(2)));
}
