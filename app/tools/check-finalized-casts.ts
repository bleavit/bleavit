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

/**
 * The brands this gate governs are **discovered**, not listed — added 2026-08-07.
 *
 * It governed exactly one, `Finalized`, while the workspace had grown fifteen `unique symbol`
 * brands. Every one of them rests on the same argument this file opens with: the phantom field
 * stops an object literal, a spread and `satisfies`, and it does **not** stop `x as Brand`, which
 * TypeScript permits between related types. So fourteen brands had the weaker half of the control
 * and not the other half, and nothing said so.
 *
 * An R-6 review found it through `AdmittedSnapshot`, whose docstring claimed a page "has no way to
 * name the brand" — true of the literal and false of a single assertion.
 *
 * A hand-maintained list would have been the third time this gate enumerated where it could parse
 * (the line scanner, then the wrapper types). Discovery instead: a brand is a `declare const S:
 * unique symbol` plus the exported types in that same file carrying `[S]`, and the declaring file
 * is that brand's one mint site. A brand added tomorrow is covered without anyone remembering.
 */
interface Brand {
  /** The exported type name an assertion would name. */
  readonly name: string;
  /** Repo-relative path of the file that declares the symbol — its only mint site. */
  readonly mintSite: string;
}

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'fixtures']);

/**
 * Every exported type in `file` whose shape carries a `unique symbol` declared in that same file.
 *
 * Both halves have to be local. A symbol declared elsewhere is not a brand this file mints, and a
 * type that merely *references* a branded type (a union arm, a field) is not itself a mint — only
 * a declaration whose own members include the computed key can be asserted into existence.
 */
function brandsDeclaredIn(source: ts.SourceFile, rel: string): Brand[] {
  const symbols = new Set<string>();
  source.forEachChild((node) => {
    if (!ts.isVariableStatement(node)) return;
    const declaresAmbient = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword);
    if (declaresAmbient !== true) return;
    for (const decl of node.declarationList.declarations) {
      const isUniqueSymbol =
        decl.type !== undefined &&
        ts.isTypeOperatorNode(decl.type) &&
        decl.type.operator === ts.SyntaxKind.UniqueKeyword;
      if (isUniqueSymbol && ts.isIdentifier(decl.name)) symbols.add(decl.name.text);
    }
  });
  if (symbols.size === 0) return [];

  const carriesBrandKey = (node: ts.Node): boolean => {
    let found = false;
    const walkMembers = (inner: ts.Node): void => {
      if (found) return;
      if (ts.isPropertySignature(inner) && ts.isComputedPropertyName(inner.name)) {
        const expr = inner.name.expression;
        if (ts.isIdentifier(expr) && symbols.has(expr.text)) {
          found = true;
          return;
        }
      }
      ts.forEachChild(inner, walkMembers);
    };
    ts.forEachChild(node, walkMembers);
    return found;
  };

  const brands: Brand[] = [];
  source.forEachChild((node) => {
    const exported = ts.canHaveModifiers(node)
      ? ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) === true
      : false;
    if (!exported) return;
    if (!ts.isInterfaceDeclaration(node) && !ts.isTypeAliasDeclaration(node)) return;
    if (carriesBrandKey(node)) brands.push({ name: node.name.text, mintSite: rel });
  });
  return brands;
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx|mts)$/.test(entry)) yield full;
  }
}

/**
 * Which governed brand a type node mentions anywhere inside it, or `undefined`.
 *
 * Recursive rather than a top-level name comparison, because a wrapper mints just as well:
 * `as Readonly<Finalized<T>>`, `as Finalized<T>[]` and `as Finalized<T> | undefined` all
 * produce a value the transaction path accepts, and a check that only read the outermost
 * name would pass every one of them.
 */
function mentionsBrand(node: ts.TypeNode, brands: ReadonlyMap<string, Brand>): Brand | undefined {
  if (ts.isTypeReferenceNode(node)) {
    const name = ts.isIdentifier(node.typeName) ? node.typeName.text : node.typeName.right.text;
    const hit = brands.get(name);
    if (hit !== undefined) return hit;
  }
  let found: Brand | undefined;
  node.forEachChild((child) => {
    if (found === undefined && ts.isTypeNode(child)) found = mentionsBrand(child, brands);
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

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.ES2022,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

/** Pass one: every brand in the workspace, keyed by the type name an assertion would write. */
function discoverBrands(files: readonly string[]): Map<string, Brand> {
  const brands = new Map<string, Brand>();
  for (const file of files) {
    const rel = relative(appRoot, file);
    for (const brand of brandsDeclaredIn(parse(file), rel)) brands.set(brand.name, brand);
  }
  return brands;
}

function scan(files: readonly string[], brands: ReadonlyMap<string, Brand>): Violation[] {
  const violations: Violation[] = [];
  for (const file of files) {
    const rel = relative(appRoot, file);
    const here = rel.split('/').join(sep);
    const source = parse(file);
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
        const asserted = mentionsBrand(node.type, brands);
        if (asserted !== undefined && here !== asserted.mintSite) {
          report(
            node,
            'assertion',
            `assertion to a ${asserted.name} type outside ${asserted.mintSite}`,
          );
        }
      }
      // `x is Finalized<T>` — the third mint mechanism, and the one the gate was originally
      // blind to (V-81). A predicate *asserts* the phantom field; it cannot check it, because
      // the field has no runtime representation, which is the property that makes the design
      // survive structured clone. So a predicate is exactly as powerful as `as Finalized<T>`.
      // A shipped `isFinalized(v: Verified<T>): v is Finalized<T>` let any package launder a
      // forged literal into the transaction path with green CI.
      if (ts.isTypePredicateNode(node) && node.type) {
        const predicated = mentionsBrand(node.type, brands);
        if (predicated !== undefined && here !== predicated.mintSite) {
          report(
            node,
            'predicate',
            `\`... is ${predicated.name}\` type predicate outside ${predicated.mintSite} — a ` +
              'predicate asserts the brand it cannot check, so it mints',
          );
        }
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
  // The witness declares `Finalized` expectations, so the fixture is scanned against the brands
  // the workspace really declares — not a set invented for it. A witness run against a synthetic
  // brand table would prove the fixture matches the fixture.
  const findings = scan([fixture], discoverBrands([...walk(appRoot)]));
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
  const files = [...walk(appRoot)];
  const brands = discoverBrands(files);
  if (brands.size === 0) {
    // Discovery finding nothing is indistinguishable from a clean workspace, and it is the one
    // way this gate can silently stop checking anything at all.
    console.error('BRAND DISCOVERY FOUND NOTHING — the gate would pass by measuring nothing');
    return 1;
  }
  const violations = scan(files, brands);
  if (violations.length > 0) {
    console.error('Brand assertion gate FAILED (10 §2.1):\n');
    for (const v of violations) console.error(`  ${v.file}:${v.line}  ${v.detail}`);
    console.error(
      '\nA brand stops object literals, spreads and `satisfies`; it cannot stop an\n' +
        'assertion. Each brand may be minted only in the file that declares its symbol.\n' +
        'If you need one elsewhere, you need the check the brand stands for instead.',
    );
    return 1;
  }
  const named = [...brands.keys()].sort().join(', ');
  console.log(`Brand assertion gate OK — ${brands.size} brands, each with one mint site: ${named}`);
  return 0;
}

process.exit(main(process.argv.slice(2)));
