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
 * outright.
 *
 * ## Why it reads the AST rather than the lines
 *
 * It used to scan line by line, and that survived only because the gate itself was a
 * `.mjs` file the scan skipped. Converting `app/`'s tools to TypeScript (#31) put this file
 * inside its own scope and it failed immediately — on its own diagnostic strings, which
 * contain the very phrases it looks for.
 *
 * The tempting repair is an exemption for this path. That is the wrong one: the file that
 * would then be unscannable is the file that defines the control, so a mint added here
 * would be the only mint nothing could see. The right repair is the one
 * `check-chain-literals` already learned the same way — parse. A string body and a comment
 * are simply not `AsExpression` or `TypePredicate` nodes, so the whole class of tokenizer
 * hole disappears rather than being enumerated: an apostrophe inside a comment, a regex
 * character class read as a comment, a phrase inside a template literal.
 *
 * Reading the AST also makes the check *stricter* than the regexes were. `as unknown as`
 * was matched as text, so it missed the same defeat written across two lines or through a
 * named alias; as a node it is an assertion whose operand is an assertion to `unknown`,
 * however it is spelled. Likewise `as Finalized<T>` is now matched by the type's *name*,
 * so `as Readonly<Finalized<T>>` and `as Finalized<T>[]` are caught too — each of which
 * mints the brand exactly as effectively and none of which the old pattern saw.
 *
 * Exit 0 = clean. Exit 1 = a new assertion site appeared.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The single site permitted to mint the brand (10 §2.1). */
const ALLOWED_MINT_SITE = join('packages', 'chain-client', 'src', 'provenance.ts');

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'fixtures']);

/** The branded type this gate governs. */
const BRAND = 'Finalized';

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx|mts)$/.test(entry)) yield full;
  }
}

/**
 * Whether a type node mentions `Finalized` anywhere inside it.
 *
 * Recursive rather than a top-level name comparison, because a wrapper mints just as well:
 * `as Readonly<Finalized<T>>`, `as Finalized<T>[]` and `as Finalized<T> | undefined` all
 * produce a value the transaction path accepts, and a check that only read the outermost
 * name would pass every one of them.
 */
function mentionsBrand(node: ts.TypeNode): boolean {
  if (ts.isTypeReferenceNode(node)) {
    const name = ts.isIdentifier(node.typeName) ? node.typeName.text : node.typeName.right.text;
    if (name === BRAND) return true;
  }
  let found = false;
  node.forEachChild((child) => {
    if (!found && ts.isTypeNode(child) && mentionsBrand(child)) found = true;
  });
  return found;
}

function isUnknownKeyword(node: ts.Node): boolean {
  return ts.isTypeNode(node) && node.kind === ts.SyntaxKind.UnknownKeyword;
}

/** The three mint mechanisms, named so the witness can declare which one a line must trip. */
type Rule = 'double' | 'assertion' | 'predicate';

interface Violation {
  readonly rule: Rule;
  readonly file: string;
  readonly line: number;
  readonly detail: string;
}

function scan(files: readonly string[]): Violation[] {
  const violations: Violation[] = [];
  for (const file of files) {
    const rel = relative(appRoot, file);
    const isMintSite = rel.split('/').join(sep) === ALLOWED_MINT_SITE;
    const source = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.ES2022,
      true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

    const report = (node: ts.Node, rule: Rule, detail: string): void => {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
      violations.push({ rule, file: rel, line: line + 1, detail });
    };

    const visit = (node: ts.Node): void => {
      // `x as unknown as T`, in either assertion syntax and however it is line-wrapped: the
      // outer assertion's operand is itself an assertion to `unknown`.
      if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
        const inner = node.expression;
        const innerType =
          ts.isAsExpression(inner) || ts.isTypeAssertionExpression(inner) ? inner.type : undefined;
        if (innerType && isUnknownKeyword(innerType)) {
          report(node, 'double', 'banned double assertion `as unknown as`');
        }
        if (!isMintSite && mentionsBrand(node.type)) {
          report(node, 'assertion', `assertion to a ${BRAND}<...> type outside ${ALLOWED_MINT_SITE}`);
        }
      }
      // `x is Finalized<T>` — the third mint mechanism, and the one the gate was originally
      // blind to (V-81). A predicate *asserts* the phantom field; it cannot check it, because
      // the field has no runtime representation, which is the property that makes the design
      // survive structured clone. So a predicate is exactly as powerful as `as Finalized<T>`.
      // A shipped `isFinalized(v: Verified<T>): v is Finalized<T>` let any package launder a
      // forged literal into the transaction path with green CI.
      if (ts.isTypePredicateNode(node) && !isMintSite && node.type && mentionsBrand(node.type)) {
        report(
          node,
          'predicate',
          `\`... is ${BRAND}<...>\` type predicate outside ${ALLOWED_MINT_SITE} — a predicate ` +
            'asserts the brand it cannot check, so it mints',
        );
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return violations;
}

/**
 * The anti-vacuity leg, asserting **per declared line** rather than per rule.
 *
 * Per-rule would be satisfied by the three easiest fixture lines while every form the AST
 * rewrite was actually for — the wrapper types, the line-wrapped double, the union arm —
 * went unmatched under a green witness. Same discipline as the negative-compilation
 * corpus's `expect-error` markers, adopted after the same class of defect (V-91).
 *
 * The negative controls are checked in the other direction: an *undeclared* finding fails
 * too, because the comment and the string at the bottom of the fixture are precisely what a
 * line scanner fires on, and a rewrite that quietly reacquired that behaviour would
 * otherwise pass.
 */
function runWitness(): number {
  const fixture = join(appRoot, 'tools/fixtures/finalized-cast-witness.ts');
  const lines = readFileSync(fixture, 'utf8').split('\n');
  const markers: { at: number; rule: Rule; note: string }[] = [];
  lines.forEach((line, index) => {
    const match = /^\s*\/\/ expect: (double|assertion|predicate)\s*(.*)$/.exec(line);
    if (match) markers.push({ at: index + 1, rule: match[1] as Rule, note: match[2] ?? '' });
  });
  if (markers.length === 0) {
    console.error(`WITNESS HAS NO EXPECTATIONS — ${fixture} declares nothing to catch`);
    return 1;
  }
  // A marker claims the lines from just after it to the next marker: what it describes is
  // often a declaration spanning several lines, with the assertion in the body.
  const expectations = markers.map((marker, index) => ({
    ...marker,
    from: marker.at + 1,
    to: index + 1 < markers.length ? (markers[index + 1]?.at ?? lines.length) - 1 : lines.length,
  }));
  const findings = scan([fixture]);
  const claims = (finding: Violation, expected: (typeof expectations)[number]): boolean =>
    finding.rule === expected.rule && finding.line >= expected.from && finding.line <= expected.to;

  const missed = expectations.filter((expected) => !findings.some((f) => claims(f, expected)));
  for (const expected of missed) {
    console.error(`  ${fixture}:${expected.from}-${expected.to}  expected ${expected.rule} — ${expected.note}`);
  }
  const undeclared = findings.filter((f) => !expectations.some((e) => claims(f, e)));
  for (const finding of undeclared) {
    console.error(`  ${fixture}:${finding.line}  undeclared ${finding.rule} finding — a negative control fired`);
  }
  if (missed.length > 0 || undeclared.length > 0) {
    console.error(
      `\nWITNESS FAILED: ${missed.length} declared expectation(s) did not fire and ` +
        `${undeclared.length} finding(s) were undeclared.`,
    );
    return 1;
  }
  console.log(`witness fired on all ${expectations.length} declared expectations, with no undeclared findings`);
  return 0;
}

function main(argv: readonly string[]): number {
  if (argv.includes('--witness')) return runWitness();
  const violations = scan([...walk(appRoot)]);
  if (violations.length > 0) {
    console.error(`${BRAND}<T> assertion gate FAILED (10 §2.1):\n`);
    for (const v of violations) console.error(`  ${v.file}:${v.line}  ${v.detail}`);
    console.error(
      '\nThe brand stops object literals; it cannot stop an assertion. Exactly one\n' +
        `site may mint one: ${ALLOWED_MINT_SITE}. If you need one\n` +
        'elsewhere, you need a light-client read instead.',
    );
    return 1;
  }
  console.log(`${BRAND}<T> assertion gate OK — one permitted mint site, no double assertions.`);
  return 0;
}

process.exit(main(process.argv.slice(2)));
