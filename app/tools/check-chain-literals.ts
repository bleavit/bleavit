#!/usr/bin/env node
/**
 * The no-hardcoded-chain-value gate — 10 §5.4, F11.
 *
 * 10 §5.4: *"No numeric chain constant may appear as a literal in FE source; CI enforces
 * via a lint gate on the protocol packages plus a review-listed allowlist (UI-only
 * numbers)."* The failure it exists to prevent is quiet and specific: a client that checks
 * `positions.length >= 64` keeps working right up until governance moves the bound, and
 * then refuses a transaction the chain would have accepted — or permits one it would not,
 * with the user finding out at signature time.
 *
 * ## It reads the TypeScript AST, not the text
 *
 * The first draft scanned lines with regexes and blanked comments and strings first. An
 * adversarial review took it apart in five ways, and every one of them was a *tokenizer*
 * bug rather than a rule bug: `const open = "/*"` made the scanner treat the following
 * lines as a comment and skip a real hardcode; `/[//]/` read as a line comment; template
 * interpolation — which is executable code — was blanked along with the template text;
 * a regex literal `/43200/` produced a false finding. Writing a better tokenizer by regex
 * is the trap. `typescript` is already a pinned dependency of this workspace, so the gate
 * uses the compiler's own scanner: comments and string bodies are simply not literal
 * nodes, and there is nothing left to get wrong about where code ends.
 *
 * ## Two rules, because one of them alone is either blind or useless
 *
 * **Rule A — name-anchored.** A binding whose name is a frozen constant's and whose
 * initialiser evaluates to a number. `const MAX_POSITIONS_PER_ACCOUNT = 64` is the defect
 * in its purest form, and this rule catches it whatever the value happens to be —
 * including a value that is *currently correct*, which is exactly the case a value scan
 * would wave through. Type annotations, `enum` members and object properties are the same
 * binding wearing different syntax, so all four node kinds are covered.
 *
 * **Rule B — value-anchored, and deliberately not applied to every value.** A literal
 * equal to a frozen constant. Applied to *all* the frozen values this rule would be
 * unusable: `32` and `64` are hash widths, hex-string lengths and array sizes throughout,
 * so the gate would fire dozens of times a day on nothing and be switched off — the
 * failure mode this repository designs against. It is therefore applied only to values
 * that are **distinctive**: 43,200 and 17,984 and 65,536 mean one thing in this codebase.
 *
 * Both rules **constant-fold** the arithmetic somebody would reach for instead of writing
 * the number: `1n << 63n`, `2 ** 63`, `0x10000`, `2 * 21600`. app-code rule 8 names the
 * first of those explicitly — *"never from the literal `1n << 63n`"* — and a gate that
 * only matched the decimal spelling would have missed the one form the rules call out.
 *
 * ## What it gives up, stated rather than implied
 *
 * A hardcoded `64` or `196` that is never *named* and never *folded* passes both rules —
 * `if (positions.length >= 64)`. That is the price of Rule B's threshold, and what covers
 * it is not this file: `CRITICAL_SURFACE` fails the build when a constant the client must
 * read is absent from metadata, and 15 §4.8's mock-runtime suite asserts bounds against
 * 02 §9's frozen table rather than against a recording.
 *
 * ## Classification, not an allowlist of numbers
 *
 * `packages/protocol` compiles in the 04 §4 kernel — `USDC_ONE`, `BPS_DENOMINATOR` — because
 * the package *is* the kernel: neither has a 02 §9 row, a `Params` key or a governance
 * track that could move it, and there is nowhere to read them from. Those are a
 * **classified group** with a stated reason and a file scope, not line-by-line exemptions,
 * so a new file cannot inherit an exemption by copying a number.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const HERE = dirname(fileURLToPath(import.meta.url));
export const APP_ROOT = resolve(HERE, '..');
const REPO_ROOT = resolve(APP_ROOT, '..');
const SPEC = resolve(REPO_ROOT, 'docs/architecture/02-integration-contract.md');
const CLASSIFICATION = resolve(HERE, 'release/sources/chain-literal-classification.json');

/** The heading whose table this gate reads. Scoped, because §7's storage table has the same
 * four-column shape and was being parsed as constants — which also kept the fail-closed
 * "parsed nothing" check from ever firing. */
const FROZEN_TABLE_HEADING = '### Frozen metadata-constant names';

/**
 * Rule B applies only to values of **four decimal digits or more**, minus the round numbers
 * below. See the header for why the threshold exists and what it costs.
 */
const RULE_B_MIN_DIGITS = 4;
const NOT_DISTINCTIVE = new Set(['1000', '1024', '2048', '4096']);

/**
 * The scanned set is **derived** from the workspace, not listed.
 *
 * A hand-kept list is a list somebody forgets to extend, and the review found exactly that:
 * `packages/llm-handoff` is in 10 §10.1's inventory and was outside the scope, so a
 * hardcoded deadline there would never have been looked at. Every `packages/*` and `src/*`
 * directory is scanned unless it is excluded here **with a reason**.
 */
const EXCLUDED_PACKAGES = new Map([
  ['papi-descriptors', 'generated by PAPI from runtime metadata; not hand-written client source'],
  ['bleavit-client-ts', 'N10 SDK facade for third-party clients, not part of the canonical client'],
  ['mock-runtime', 'a test double whose whole job is to reproduce 02 §9 values from a fixture'],
]);
const EXCLUDED_DIRS = new Set(['dist', 'node_modules']);

/** One row of 02 §9's frozen-constant table. */
export interface FrozenConstant {
  readonly pallet: string;
  readonly name: string;
  /** Exactly one decimal string, or empty when the cell yields a tuple (see `scalarValues`). */
  readonly values: readonly string[];
}

/** A classified exemption: a value or a constant name, in named files, for a stated reason. */
export interface ClassificationGroup {
  readonly name: string;
  readonly reason: string;
  readonly files: readonly string[];
  readonly values?: readonly string[];
  readonly constants?: readonly string[];
}

export interface Classification {
  readonly groups: readonly ClassificationGroup[];
}

export type LiteralRule = 'A' | 'B';

export interface Finding {
  readonly rule: LiteralRule;
  readonly file: string;
  readonly line: number;
  readonly detail: string;
}

export function extractFrozenConstants(specText: string): FrozenConstant[] {
  const start = specText.indexOf(FROZEN_TABLE_HEADING);
  if (start === -1) {
    throw new Error(`${SPEC} has no "${FROZEN_TABLE_HEADING}" section; the gate has nothing to read`);
  }
  // The section ends at the next heading of the same or higher level.
  const rest = specText.slice(start + FROZEN_TABLE_HEADING.length);
  const end = rest.search(/\n#{1,3} /);
  const section = end === -1 ? rest : rest.slice(0, end);

  const constants: FrozenConstant[] = [];
  const seen = new Set<string>();
  const row = /^\|\s*([^|]+?)\s*\|\s*`([A-Za-z0-9_]+)`\s*\|\s*([^|]+?)\s*\|\s*(.+?)\s*\|\s*$/;
  for (const line of section.split('\n')) {
    const match = row.exec(line);
    if (!match) continue;
    const [, pallet, name, , source] = match;
    // The four capture groups are unconditional, so an absent one is a regex change rather
    // than a table row this parser should tolerate — and tolerating it would silently drop
    // a frozen constant from the set the gate compares against.
    if (pallet === undefined || name === undefined || source === undefined) continue;
    if (pallet === 'Pallet' || /^-+$/.test(pallet)) continue;
    const key = `${pallet}::${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    constants.push({ pallet, name, values: scalarValues(source) });
  }
  if (constants.length === 0) {
    throw new Error(
      `no frozen metadata constants parsed out of ${SPEC}'s ${FROZEN_TABLE_HEADING} table; ` +
        'the table shape moved and this gate would have passed by comparing against nothing',
    );
  }
  return constants;
}

/**
 * Pull the `(= N)` scalar out of a value-source cell, as a **decimal string**.
 *
 * A string rather than a `number` because `ServiceIdBase = 2^63` is the value the client is
 * most explicitly forbidden (app-code rule 8) and it sits exactly where JS number formatting
 * stops being exact. Comparing normalised decimal text is exact at every width.
 *
 * A cell yielding **more than one** scalar is skipped: those are tuples and per-class arrays
 * (`MaxTradeRatio (1, 4)`), and flattening them would ban their members everywhere on the
 * strength of a shape this parser guessed at.
 */
function scalarValues(source: string): string[] {
  const values: string[] = [];
  for (const match of source.matchAll(/=\s*(2\^(\d+)|[0-9][0-9,]*)/g)) {
    const exponent = match[2];
    const literal = match[1];
    if (exponent !== undefined) values.push((2n ** BigInt(exponent)).toString());
    else if (literal !== undefined) values.push(literal.replaceAll(',', ''));
  }
  return values.length === 1 ? values : [];
}

/** `MaxPositionsPerAccount`, `MAX_POSITIONS_PER_ACCOUNT` and `maxPositionsPerAccount` all
 * normalise to the same token, so the rule cannot be sidestepped by a casing convention. */
export function normaliseIdentifier(name: string): string {
  return name.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
}

function walk(dir: string, out: string[]): string[] {
  for (const entry of readdirSync(dir)) {
    if (EXCLUDED_DIRS.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      walk(path, out);
      continue;
    }
    if (/\.(ts|tsx|mts)$/.test(entry) && !/\.d\.ts$/.test(entry)) out.push(path);
  }
  return out;
}

export function sourceFiles(appRoot: string = APP_ROOT): string[] {
  const files: string[] = [];
  const packagesDir = resolve(appRoot, 'packages');
  for (const entry of readdirSync(packagesDir)) {
    if (EXCLUDED_PACKAGES.has(entry)) continue;
    const dir = join(packagesDir, entry);
    if (statSync(dir).isDirectory()) walk(dir, files);
  }
  walk(resolve(appRoot, 'src'), files);
  // F22: `tools/desktop/` decides what the desktop shell may embed, so it is client source in
  // every sense that matters here even though it runs on a build machine. It is named rather
  // than swept from `tools/` because the rest of that directory is checkers — several of which
  // carry 02 §9 values as the data they check *against*, so scanning them would make this gate
  // fire on its own oracle.
  walk(resolve(appRoot, 'tools/desktop'), files);
  return files.sort();
}

/**
 * Evaluate an initialiser to a decimal string, or `undefined` if it is not a constant.
 *
 * The folding is the point rather than a nicety: `1n << 63n`, `2 ** 63` and `0x10000` are
 * the three forms somebody reaches for instead of writing the number, and app-code rule 8
 * names the first of them explicitly. `BigInt` throughout, because `2 ** 63` is past the
 * safe-integer range and a `number` fold would silently produce a neighbouring value.
 */
export function foldConstant(node: ts.Node): string | undefined {
  switch (node.kind) {
    case ts.SyntaxKind.NumericLiteral:
    case ts.SyntaxKind.BigIntLiteral: {
      const text = (node as ts.LiteralLikeNode).text.replace(/n$/, '').replaceAll('_', '');
      // A fractional or exponent-notation literal is not a chain constant; refusing to
      // fold it is safer than rounding it into one.
      if (/[.eE]/.test(text) && !/^0[xXbBoO]/.test(text)) return undefined;
      try {
        return BigInt(text).toString();
      } catch {
        return undefined;
      }
    }
    case ts.SyntaxKind.ParenthesizedExpression:
      return foldConstant((node as ts.ParenthesizedExpression).expression);
    case ts.SyntaxKind.PrefixUnaryExpression:
      // Only `+`; a negated chain constant is not one, and folding `-` would let `-43200`
      // report as the positive value.
    {
      const unary = node as ts.PrefixUnaryExpression;
      return unary.operator === ts.SyntaxKind.PlusToken ? foldConstant(unary.operand) : undefined;
    }
    case ts.SyntaxKind.BinaryExpression: {
      const binary = node as ts.BinaryExpression;
      const left = foldConstant(binary.left);
      const right = foldConstant(binary.right);
      if (left === undefined || right === undefined) return undefined;
      const a = BigInt(left);
      const b = BigInt(right);
      switch (binary.operatorToken.kind) {
        case ts.SyntaxKind.LessThanLessThanToken:
          return b >= 0n && b < 1024n ? (a << b).toString() : undefined;
        case ts.SyntaxKind.AsteriskAsteriskToken:
          return b >= 0n && b < 1024n ? (a ** b).toString() : undefined;
        case ts.SyntaxKind.AsteriskToken:
          return (a * b).toString();
        case ts.SyntaxKind.PlusToken:
          return (a + b).toString();
        default:
          return undefined;
      }
    }
    default:
      return undefined;
  }
}

/** The four syntactic forms one binding wears. A gate that knew only `const x = 1` would be
 * dodged by a type annotation, which is the second thing the review found. */
function boundName(node: ts.Node): string | undefined {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) return node.name.text;
  if (ts.isPropertyDeclaration(node) && ts.isIdentifier(node.name)) return node.name.text;
  if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name)) return node.name.text;
  if (ts.isEnumMember(node) && ts.isIdentifier(node.name)) return node.name.text;
  return undefined;
}

function classificationFor(
  classification: Classification,
  appRoot: string,
  file: string,
  { value, constantName }: { readonly value?: string | undefined; readonly constantName?: string | undefined },
): ClassificationGroup | undefined {
  const relativePath = relative(appRoot, file).replaceAll('\\', '/');
  for (const group of classification.groups) {
    // A prefix must end at a path boundary, or `admission.ts`'s exemption would cover
    // `admission.tsx` — a different file that merely starts the same way.
    const scoped = group.files.some(
      (prefix) => relativePath === prefix || relativePath.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`),
    );
    if (!scoped) continue;
    if (value !== undefined && (group.values ?? []).includes(value)) return group;
    if (constantName !== undefined && (group.constants ?? []).includes(constantName)) return group;
  }
  return undefined;
}

export interface ScanInputs {
  readonly appRoot?: string;
  readonly constants: readonly FrozenConstant[];
  readonly classification: Classification;
  readonly files: readonly string[];
}

export function scan({ appRoot = APP_ROOT, constants, classification, files }: ScanInputs): Finding[] {
  const findings: Finding[] = [];
  const byNormalisedName = new Map<string, FrozenConstant>();
  const distinctive = new Map<string, FrozenConstant>();
  for (const constant of constants) {
    byNormalisedName.set(normaliseIdentifier(constant.name), constant);
    for (const value of constant.values) {
      if (value.length >= RULE_B_MIN_DIGITS && !NOT_DISTINCTIVE.has(value)) {
        distinctive.set(value, constant);
      }
    }
  }

  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true, scriptKind(file));
    const at = (node: ts.Node): { file: string; line: number } => ({
      file: relative(appRoot, file).replaceAll('\\', '/'),
      line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
    });

    const visit = (node: ts.Node): void => {
      // Rule A — a frozen constant's name bound to a constant-foldable number.
      const name = boundName(node);
      const initializer = initializerOf(node);
      if (name !== undefined && initializer !== undefined) {
        const constant = byNormalisedName.get(normaliseIdentifier(name));
        const folded = foldConstant(initializer);
        if (constant && folded !== undefined) {
          if (!classificationFor(classification, appRoot, file, { constantName: constant.name })) {
            findings.push({
              rule: 'A',
              ...at(node),
              detail:
                `${name} is bound to the literal ${folded}, but ${constant.pallet}::${constant.name} ` +
                'is a frozen metadata constant the client must read from chain metadata (10 §5.4). ' +
                'A literal that is correct today is the failure this rule exists for.',
            });
          }
        }
      }

      // Rule B — a distinctive frozen value, however it is spelled.
      // Every foldable expression is tried, with no guard on the parent. An earlier draft
      // skipped a `BinaryExpression` whose parent was one — to avoid double-reporting the
      // operands of `1n << 63n` — and that silently exempted the single most important
      // form: inside `id >= 1n << 63n` the shift's parent *is* a binary expression. The
      // `return` below is what prevents the double report, and it does it without
      // depending on the shape of the enclosing expression.
      if (ts.isNumericLiteral(node) || ts.isBigIntLiteral(node) || ts.isBinaryExpression(node)) {
        const folded = foldConstant(node);
        const constant = folded === undefined ? undefined : distinctive.get(folded);
        if (constant && !classificationFor(classification, appRoot, file, { value: folded })) {
          findings.push({
            rule: 'B',
            ...at(node),
            detail:
              `the expression \`${node.getText(source)}\` is the frozen value of ` +
              `${constant.pallet}::${constant.name} (${folded}). Read it from chain metadata, or ` +
              'classify it in tools/release/sources/chain-literal-classification.json with a reason.',
          });
          // Do not descend: `1n << 63n` would otherwise also report its operands.
          return;
        }
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(source, visit);
  }
  // Deduplicate: a folded binary expression and its enclosing declaration can both match.
  const unique = new Map<string, Finding>();
  for (const finding of findings) unique.set(`${finding.file}:${finding.line}:${finding.rule}`, finding);
  return [...unique.values()];
}

/** The initialiser of whichever of the four binding forms `boundName` accepted. */
function initializerOf(node: ts.Node): ts.Expression | undefined {
  if (ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node) || ts.isEnumMember(node)) {
    return node.initializer;
  }
  if (ts.isPropertyAssignment(node)) return node.initializer;
  return undefined;
}

function scriptKind(file: string): ts.ScriptKind {
  return file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

export function loadClassification(path: string = CLASSIFICATION): Classification {
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
  const groups = isRecord(raw) ? raw['groups'] : undefined;
  if (!Array.isArray(groups)) throw new Error('classification: groups must be an array');
  for (const candidate of groups) {
    const group = isRecord(candidate) ? candidate : {};
    if (!group['name'] || !group['reason'] || !Array.isArray(group['files'])) {
      throw new Error(`classification group ${String(group['name'] ?? '<unnamed>')} is missing a required field`);
    }
    const values = group['values'];
    const constants = group['constants'];
    const exempts = (Array.isArray(values) ? values.length : 0) + (Array.isArray(constants) ? constants.length : 0);
    const files = group['files'];
    if (exempts === 0 || files.length === 0) {
      // A group scoped to nothing exempts nothing and reads, in a diff, as deliberate
      // coverage of something. Refused so the file cannot accumulate reassuring no-ops.
      throw new Error(`classification group ${String(group['name'])} exempts nothing; delete it instead`);
    }
  }
  return { groups: groups as ClassificationGroup[] };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The anti-vacuity leg — and it asserts **per line**, not per rule.
 *
 * The first version required only that each rule fired at least once, which the review
 * pointed out is satisfied by the two easiest fixture lines while every hard form —
 * the typed binding, the shift expression, the hex literal — goes unmatched. So the fixture
 * declares what each line must produce (`// expect: A` / `// expect: B` on the line above),
 * and a declared line that produces nothing fails. Same discipline as the negative-
 * compilation corpus's `expect-error` markers, adopted for the same reason (V-91).
 */
function runWitness(constants: readonly FrozenConstant[], classification: Classification): number {
  const fixture = resolve(HERE, 'fixtures/chain-literal-witness.ts');
  const lines = readFileSync(fixture, 'utf8').split('\n');
  const markers: { at: number; rules: LiteralRule[]; note: string }[] = [];
  lines.forEach((line, index) => {
    const match = /^\s*\/\/ expect: ([AB](?:\s*,\s*[AB])*)\s*(.*)$/.exec(line);
    if (!match || match[1] === undefined) return;
    markers.push({
      at: index + 1,
      // A line can legitimately trip both rules — a *named* frozen constant bound to its
      // own distinctive value trips A for the name and B for the value — so the marker
      // takes a list. Declaring only one leaves the other reported as undeclared, which
      // fails; the witness is as strict about surprises as about omissions.
      rules: match[1].split(',').map((token) => token.trim() as LiteralRule),
      note: match[2] ?? '',
    });
  });
  // A marker claims the lines from just after it up to the next marker, because the thing
  // it describes is often a declaration spanning several lines and the literal sits in the
  // body — `return blocks > 43200` is three lines below its own marker. The range is
  // computed over marker *positions* before the rule lists are expanded, or a two-rule
  // marker would end its own range one line before it starts.
  const expectations = markers.flatMap((marker, index) => {
    const to = index + 1 < markers.length ? (markers[index + 1]?.at ?? lines.length) - 1 : lines.length;
    return marker.rules.map((rule) => ({ rule, note: marker.note, from: marker.at + 1, to }));
  });
  if (expectations.length === 0) {
    console.error(`WITNESS HAS NO EXPECTATIONS — ${fixture} declares nothing to catch`);
    return 1;
  }
  const findings = scan({ constants, classification, files: [fixture] });
  const missed = expectations.filter(
    (expected) =>
      !findings.some(
        (finding) =>
          finding.rule === expected.rule && finding.line >= expected.from && finding.line <= expected.to,
      ),
  );
  if (missed.length > 0) {
    console.error(`WITNESS DID NOT FIRE on ${missed.length} declared expectation(s):`);
    for (const expected of missed) {
      console.error(
        `  ${fixture}:${expected.from}-${expected.to}  expected rule ${expected.rule} — ${expected.note}`,
      );
    }
    return 1;
  }
  // Undeclared findings are reported too, without failing: the two negative-control lines
  // (a regex literal and a string containing a comment opener) must produce nothing, and
  // printing anything unexpected is how a reader notices they started to.
  const claimed = (finding: Finding): boolean =>
    expectations.some(
      (expected) =>
        finding.rule === expected.rule && finding.line >= expected.from && finding.line <= expected.to,
    );
  const undeclared = findings.filter((finding) => !claimed(finding));
  for (const finding of undeclared) {
    console.log(`  undeclared finding at ${fixture}:${finding.line} [rule ${finding.rule}]`);
  }
  console.log(
    `witness fired on all ${expectations.length} declared expectations ` +
      `(${findings.length} findings, ${undeclared.length} undeclared)`,
  );
  return undeclared.length > 0 ? 1 : 0;
}

function main(argv: readonly string[]): number {
  const constants = extractFrozenConstants(readFileSync(SPEC, 'utf8'));
  const classification = loadClassification();
  if (argv.includes('--witness')) return runWitness(constants, classification);

  const files = sourceFiles();
  const findings = scan({ constants, classification, files });
  if (findings.length > 0) {
    console.error(`${findings.length} hardcoded chain value(s) — 10 §5.4:\n`);
    for (const finding of findings) {
      console.error(`  ${finding.file}:${finding.line}  [rule ${finding.rule}] ${finding.detail}`);
    }
    return 1;
  }
  console.log(
    `no hardcoded chain values: ${constants.length} frozen constants checked over ${files.length} source files`,
  );
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exit(main(process.argv.slice(2)));
}
