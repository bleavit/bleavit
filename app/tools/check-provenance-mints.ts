#!/usr/bin/env node
/**
 * The provenance-**construction** gate — 10 §2.1/§2.2, INV-FE-1, INV-FE-9.
 *
 * A badge on screen is read off `status.kind`. Nothing else decides it: `ProvenanceBadge`
 * switches on that string, and `Verified<T>` carries no brand — deliberately, because screens
 * display values and do not authorise on them (10 §2.1 puts the brand on `Finalized<T>`, for
 * the transaction path alone). So **writing a `VerificationStatus` out longhand is a complete
 * provenance claim**, made with no read behind it, and the three controls that already exist
 * each miss it for a specific structural reason:
 *
 *   - `check:casts` matches `as Finalized<…>` and type predicates. A longhand literal is
 *     neither: it is not an assertion, it produces only a `Verified<T>`, and it compiles.
 *   - `check:render-provenance` rule B matches an object literal whose `status` initializer is
 *     a `.status` **access** — the promote-by-arithmetic case. A status written out field by
 *     field is not an access, so the rule cannot see it.
 *   - dependency-cruiser's `no-testing-import` matches `@bleavit/chain-client/testing`, which
 *     this shape never imports. It needs nothing from `chain-client` at all.
 *
 * All three were green over a helper that read, in full:
 *
 * ```ts
 * const finalized = <T,>(value: T): Verified<T> => ({
 *   value,
 *   status: { kind: 'verified-finalized', chain: at.chain, blockHash: at.blockHash, ... },
 * });
 * ```
 *
 * — copied into four modules, covering seventeen call sites, of which six badged something no
 * read produced: a fallback manufactured on a decode-failure path, a pre-read sentinel, and a
 * number the caller supplied beside a pin the caller also supplied.
 *
 * ## The rule
 *
 * A `VerificationStatus` may be **constructed** only in the two modules that own provenance:
 * `packages/shared-types/src/provenance.ts` (the union itself, and `externalProposal`, which
 * 10 §2.1 makes deliberately unrestricted because *"it asserts nothing"*) and
 * `packages/chain-client/src/provenance.ts` (the single `Finalized<T>` mint site). One further
 * module is named below with its reason.
 *
 * Everywhere else, a status must be **carried** rather than written: `derive` for a value
 * computed from a read, `combine`/`combine2` for one computed from several, `externalProposal`
 * for an imported request, and a caller-supplied `Verified<T>` passed straight through.
 *
 * ## Why it matches the discriminant rather than the string
 *
 * `VerificationStatus` is a closed discriminated union, so **every** member must be built with
 * a `kind` property carrying one of six literals. There is no other way in — which is what
 * makes a rule over that one position complete rather than a list of spellings. It is also
 * what keeps the gate quiet: `status.kind === 'verified-finalized'` comparisons, `switch`
 * arms, `BodyProvenance`'s same-named string tags in `local-index`, and the type declarations
 * themselves are all *not* property assignments in an object literal, so the gate says nothing
 * about them and no exemption is needed for any of them.
 *
 * Two evasions are handled and one is not, stated rather than implied:
 *
 *   - an identifier initializer is **constant-folded** through same-file `const` declarations,
 *     so `const K = 'verified-best'; { kind: K, … }` is caught;
 *   - shorthand (`{ kind, chain, … }`) is resolved the same way;
 *   - a status parsed out of a **string** at runtime (`JSON.parse('{"kind":…}')`) is not, and
 *     deliberately: reading string bodies is the tokenizer hole this repository has removed
 *     from three gates in a row, and it would fire on every diagnostic message here. What
 *     covers that case is that a runtime-parsed status cannot be typed as `VerificationStatus`
 *     without a cast, which `check:casts`' `as unknown as` ban already reaches.
 *
 * Exit 0 = clean. Exit 1 = a status was constructed outside the modules that own provenance.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The six statuses of 10 §2.1, which are the whole of `VerificationStatus`.
 *
 * Listed rather than parsed out of `shared-types`, and the reason is the direction of the
 * check: parsing would make the gate agree with whatever the union currently says, so a
 * seventh status added without a spec amendment would become mintable by adding it. A
 * mismatch between this list and the union is caught by the witness, which asserts the two
 * sets are equal — the same "derived on one side, pinned on the other" arrangement
 * `check-chain-literals` uses for 02 §9's table.
 */
const STATUS_KINDS: ReadonlySet<string> = new Set([
  'verified-finalized',
  'verified-best',
  'derived-local',
  'provider',
  'stale-cache',
  'external-proposal',
]);

/**
 * The modules that own provenance, each with the reason it is one.
 *
 * A short list of whole modules rather than line waivers, for the reason app-code rule 7
 * gives about the chain-literal classification: a waiver attached to a line is inherited by
 * whatever is pasted next to it, while a module named here has to be argued for.
 */
const OWNING_MODULES: ReadonlyMap<string, string> = new Map([
  [
    join('packages', 'shared-types', 'src', 'provenance.ts'),
    'declares `VerificationStatus` itself, and `externalProposal`, which 10 §2.1 makes ' +
      'deliberately unrestricted — it asserts nothing, and the type system\'s job there is to ' +
      'stop the value being mistaken for an observation, not to stop it being made',
  ],
  [
    join('packages', 'chain-client', 'src', 'provenance.ts'),
    'the single `Finalized<T>` mint site (10 §2.1), whose `finalize` is the one function that ' +
      'may attach a verified status — and which is withheld from the package barrel so only a ' +
      'read, `readmitFromLeader` or `derive` can reach it',
  ],
  [
    join('packages', 'chain-client', 'src', 'reads.ts'),
    '`providerRead`, the never-promote disclaimer of 10 §2.2. `provider` is the status that ' +
      'says a value was NOT verified by this client, so constructing one claims nothing — and ' +
      'it belongs beside the reads it labels',
  ],
]);

/**
 * Trees outside the canonical client, excluded with their reason.
 *
 * `bleavit-client-ts` is N10's standalone kit for other people's runtimes. It declares its own
 * `Finalized<T>` and its own status shape, imports neither `shared-types` nor `chain-client`,
 * and is exempt from the canonical client's package rules for the same reason app-code rule 13
 * exempts it from the one-chain-connection rule: it is not this client. Its own mint is
 * guarded on its own terms — `readReport` refuses unless the adapter returned the requested
 * pin with a checked storage proof.
 */
const OUTSIDE_THE_CLIENT: readonly string[] = [join('packages', 'bleavit-client-ts')];

/**
 * Where the canonical client's code lives. `tests/` is deliberately not scanned.
 *
 * A suite must be able to write a `Verified<T>` fixture — that is what an unbranded
 * `Verified<T>` is for, and roughly thirty do. A gate firing on all of them would be answered
 * by switching it off, which is this repository's most-repeated defect and the thing this file
 * exists to avoid adding another of. Nothing in `tests/` can reach production: the firewall is
 * a compilation boundary and no `src` or `packages` project references the test tree.
 */
const SCAN_ROOTS: readonly string[] = ['packages', 'src', 'tools'];

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'fixtures', '.papi']);

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx|mts)$/.test(entry)) yield full;
  }
}

/** The two ways a status literal can name its discriminant. */
type Rule = 'status-literal' | 'status-shorthand';

interface Violation {
  readonly rule: Rule;
  readonly file: string;
  readonly line: number;
  readonly kind: string;
  readonly detail: string;
}

/**
 * The string a node denotes, folding one level of `const` indirection.
 *
 * `check-chain-literals` learned the same lesson: a rule that reads only literals is defeated
 * by naming the literal, and naming it is what a developer does when a gate complains. Folding
 * through the file's own `const` declarations closes that without a type checker.
 */
function stringValueOf(node: ts.Node, source: ts.SourceFile): string | undefined {
  if (ts.isParenthesizedExpression(node)) return stringValueOf(node.expression, source);
  if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
    return stringValueOf(node.expression, source);
  }
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isIdentifier(node)) return constantsOf(source).get(node.text);
  return undefined;
}

const CONSTANT_CACHE = new WeakMap<ts.SourceFile, Map<string, string>>();

/**
 * Every `const NAME = '<string>'` in a file, at any depth.
 *
 * Depth-insensitive on purpose. Scoping would be more precise and would buy nothing here: two
 * different `const`s in one file both holding a status string is not a case that arises, and
 * missing one because it sat inside a function is exactly the evasion being closed.
 */
function constantsOf(source: ts.SourceFile): Map<string, string> {
  const cached = CONSTANT_CACHE.get(source);
  if (cached) return cached;
  const constants = new Map<string, string>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined
    ) {
      const literal = node.initializer;
      const text =
        ts.isStringLiteral(literal) || ts.isNoSubstitutionTemplateLiteral(literal)
          ? literal.text
          : ts.isAsExpression(literal) &&
              (ts.isStringLiteral(literal.expression) ||
                ts.isNoSubstitutionTemplateLiteral(literal.expression))
            ? literal.expression.text
            : undefined;
      if (text !== undefined) constants.set(node.name.text, text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  CONSTANT_CACHE.set(source, constants);
  return constants;
}

/** Whether a property name is literally `kind` — identifier, `'kind'` or `"kind"`. */
function isKindName(name: ts.PropertyName): boolean {
  if (ts.isIdentifier(name)) return name.text === 'kind';
  if (ts.isStringLiteral(name)) return name.text === 'kind';
  return false;
}

export function scan(files: readonly string[]): Violation[] {
  const violations: Violation[] = [];
  for (const file of files) {
    const rel = relative(appRoot, file);
    const normalised = rel.split('/').join(sep);
    if (OWNING_MODULES.has(normalised)) continue;
    if (OUTSIDE_THE_CLIENT.some((prefix) => normalised.startsWith(prefix))) continue;

    const source = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.ES2022,
      true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

    const report = (node: ts.Node, rule: Rule, kind: string): void => {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
      violations.push({
        rule,
        file: rel,
        line: line + 1,
        kind,
        detail: `constructs a \`${kind}\` VerificationStatus`,
      });
    };

    const visit = (node: ts.Node): void => {
      if (ts.isObjectLiteralExpression(node)) {
        for (const property of node.properties) {
          // `{ kind: 'verified-finalized', … }` — the discriminant written out. Every member
          // of the union needs this property, so this is the constructor position.
          if (ts.isPropertyAssignment(property) && isKindName(property.name)) {
            const value = stringValueOf(property.initializer, source);
            if (value !== undefined && STATUS_KINDS.has(value)) {
              report(property, 'status-literal', value);
            }
          }
          // `{ kind, chain, … }` — the same construction with the discriminant named. A
          // separate rule rather than a branch, so the witness can require each to fire.
          if (ts.isShorthandPropertyAssignment(property) && property.name.text === 'kind') {
            const value = constantsOf(source).get('kind');
            if (value !== undefined && STATUS_KINDS.has(value)) {
              report(property, 'status-shorthand', value);
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return violations;
}

/**
 * The anti-vacuity leg, per declared line, with negative controls checked in both directions.
 *
 * Per **rule** would be satisfied by the two easiest fixture lines while the folded constant,
 * the nested literal and the five other statuses all went unmatched under a green witness —
 * the defect `check-finalized-casts` adopted this same discipline after (V-91).
 *
 * The `undeclared` half is not decoration. Everything at the bottom of the fixture is a shape
 * a cruder gate fires on: a comparison, a `switch` arm, a type declaration, a same-named
 * string that is not a status. Each must produce nothing, and a rewrite that quietly widened
 * the match would otherwise pass.
 */
function runWitness(): number {
  const fixture = join(appRoot, 'tools/fixtures/provenance-mint-witness.ts');
  const lines = readFileSync(fixture, 'utf8').split('\n');
  const markers: { at: number; rule: Rule; kind: string; note: string }[] = [];
  lines.forEach((line, index) => {
    const match = /^\s*\/\/ expect: (status-literal|status-shorthand) (\S+)\s*(.*)$/.exec(line);
    if (match) {
      markers.push({
        at: index + 1,
        rule: match[1] as Rule,
        kind: match[2] as string,
        note: match[3] ?? '',
      });
    }
  });
  if (markers.length === 0) {
    console.error(`WITNESS HAS NO EXPECTATIONS — ${fixture} declares nothing to catch`);
    return 1;
  }

  // Every status must appear in the fixture. A witness proving only that
  // `verified-finalized` is caught would leave the other five mintable, and they are the ones
  // a future defect is likelier to use precisely because they attract less attention.
  const declaredKinds = new Set(markers.map((marker) => marker.kind));
  const missingKinds = [...STATUS_KINDS].filter((kind) => !declaredKinds.has(kind));
  if (missingKinds.length > 0) {
    console.error(
      `WITNESS IS INCOMPLETE — no expectation declares: ${missingKinds.join(', ')}. Every ` +
        'status in the union must be witnessed, or the untested ones are mintable.',
    );
    return 1;
  }
  const strayKinds = [...declaredKinds].filter((kind) => !STATUS_KINDS.has(kind));
  if (strayKinds.length > 0) {
    console.error(
      `WITNESS DECLARES A STATUS THE GATE DOES NOT KNOW: ${strayKinds.join(', ')}. Either ` +
        '10 §2.1 gained a status and `STATUS_KINDS` is stale, or the fixture has a typo — ' +
        'and a typo here is an expectation that can never fire.',
    );
    return 1;
  }

  // A marker claims the lines from just after it up to the next marker: what it describes is
  // often a declaration spanning several lines with the literal in the body.
  const expectations = markers.map((marker, index) => ({
    ...marker,
    from: marker.at + 1,
    to: index + 1 < markers.length ? (markers[index + 1]?.at ?? lines.length) - 1 : lines.length,
  }));
  const findings = scan([fixture]);
  const claims = (finding: Violation, expected: (typeof expectations)[number]): boolean =>
    finding.rule === expected.rule &&
    finding.kind === expected.kind &&
    finding.line >= expected.from &&
    finding.line <= expected.to;

  const missed = expectations.filter((expected) => !findings.some((f) => claims(f, expected)));
  for (const expected of missed) {
    console.error(
      `  ${fixture}:${expected.from}-${expected.to}  expected ${expected.rule} ` +
        `${expected.kind} — ${expected.note}`,
    );
  }
  const undeclared = findings.filter((f) => !expectations.some((e) => claims(f, e)));
  for (const finding of undeclared) {
    console.error(
      `  ${fixture}:${finding.line}  undeclared ${finding.rule} ${finding.kind} — a negative ` +
        'control fired',
    );
  }
  if (missed.length > 0 || undeclared.length > 0) {
    console.error(
      `\nWITNESS FAILED: ${missed.length} declared expectation(s) did not fire and ` +
        `${undeclared.length} finding(s) were undeclared.`,
    );
    return 1;
  }
  console.log(
    `witness fired on all ${expectations.length} declared expectations across all ` +
      `${STATUS_KINDS.size} statuses, with no undeclared findings`,
  );
  return 0;
}

function main(argv: readonly string[]): number {
  if (argv.includes('--witness')) return runWitness();
  const files = SCAN_ROOTS.flatMap((root) => [...walk(join(appRoot, root))]);
  const violations = scan(files);
  if (violations.length > 0) {
    console.error('VerificationStatus construction gate FAILED (10 §2.1, §2.2, INV-FE-9):\n');
    for (const v of violations) console.error(`  ${v.file}:${v.line}  ${v.detail}`);
    console.error(
      '\nA status written out longhand is a complete provenance claim with no read behind\n' +
        'it: the badge on screen is read off `status.kind`, and `Verified<T>` carries no\n' +
        'brand to stop the literal. Only these modules may construct one:\n',
    );
    for (const [module, reason] of OWNING_MODULES) console.error(`  ${module}\n      ${reason}\n`);
    console.error(
      'Elsewhere, carry the status instead of writing it:\n' +
        '  · a value computed from one read      → `derive(read, compute)`\n' +
        '  · a value computed from several       → `combine` / `combine2`\n' +
        '  · an imported request                 → `externalProposal(value)`\n' +
        '  · a value the caller already holds    → pass its `Verified<T>` through\n' +
        '  · a value no read produced            → there is no status for it. It is absent.',
    );
    return 1;
  }
  console.log(
    `VerificationStatus construction gate OK — ${files.length} files scanned, ` +
      `${OWNING_MODULES.size} owning modules.`,
  );
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === `file://${resolve(process.argv[1])}`) {
  process.exit(main(process.argv.slice(2)));
}
