#!/usr/bin/env node
/**
 * The **bare-rows** gate — 10 §6.3's opening rule, as something that can fail.
 *
 * > Every history query returns data *plus* the coverage it came from — a `CoveredResult<T>`,
 * > **never bare rows**, because bare rows render as a complete series and *"there were no
 * > observations in this window"* and *"we never ingested this window"* then arrive as the same
 * > empty answer.
 *
 * That sentence has been violated three times in this package in three consecutive review rounds,
 * and every time the repair was a function nothing was obliged to call: `CoveredResult<T>` was
 * declared with no producer; then a producer existed and read the one tier with no writer; and a
 * chart could still be drawn with `db.candles1h.toArray()`, which typechecks, needs no cast,
 * crosses no firewall edge and returns an array that looks exactly like a complete history.
 *
 * **The reason it keeps happening is that nothing checks it.** `coveredSamples` and
 * `coveredCandles` are the correct path and a convention; a Dexie table is a public property on
 * the database object and reaching it is one line shorter. So this gate makes the convention
 * structural: the chart tables may be **named** only where §6.3 and §9.1/§9.2 permit, and every
 * other reference is a build failure.
 *
 * ## The two rules
 *
 * **A — `chart-table-outside-package`.** No module outside `packages/local-index/src/` may name a
 * chart table at all. That is the rule with the user-visible consequence: a screen, a feature
 * module or `packages/providers` reaching `db.candles1h` gets rows with no coverage beside them,
 * and renders a flat line across blocks nobody ingested. The covered reads are the whole surface
 * such a caller needs, and they return the coverage, the §9.2 labels and any migration discard
 * with the rows.
 *
 * **B — `chart-read-outside-covered-query`.** Inside the package, a chart-table reference must be
 * lexically inside a `coveredQuery(…)` call — the one wrapper — or in a module named in
 * `INDEX_INTERNALS` with the reason it answers no history question. Two modules are named there
 * and nothing else is, `store.ts` included: its own chart reads sit inside the covered query, so a
 * bare one added beside them fails this gate rather than passing on the file's reputation.
 *
 * ## What it deliberately does not catch, stated rather than implied
 *
 * `.table(name)` where `name` is a runtime value — a loop variable over `REKEYED_TABLES`, say — is
 * not matched: the checker folds one level of same-file `const` and does not evaluate. The
 * migration's own `tx.table(table)` loop is exactly that shape and is intentionally out of reach.
 * What covers it is rule A: outside the package there is no `LocalIndex` to loop over, and inside
 * it the two modules that do this are the ones a reviewer already has to read.
 *
 * Matching is on the **TypeScript AST**, so a table named in a comment, in a string body, or as a
 * property name in a type declaration is not a property access and produces nothing. Every hole
 * adversarial review has found in this repository's other gates was a tokenizer hole, and the two
 * negative-control blocks in the witness fixture are what keep this one from acquiring one.
 *
 * Exit 0 = clean. Exit 1 = a chart tier is reachable as bare rows.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 10 §7's chart tiers: the raw observation table and §9.2's three candle rungs.
 *
 * Listed rather than parsed out of the schema declaration, and for the same reason
 * `check-provenance-mints` pins its status list: parsing would make the gate agree with whatever
 * the schema currently says, so a fifth chart tier added without a covered read would become
 * unreachable by the gate by the act of adding it. The witness asserts this set against
 * `SCHEMA_V3`'s own declaration, which is where a real divergence shows up.
 */
const CHART_TABLES: ReadonlySet<string> = new Set([
  'priceSamples',
  'candles1h',
  'candles4h',
  'candles1d',
]);

/** The one wrapper. A reference inside its argument is by definition a covered read. */
const COVERED_QUERY = 'coveredQuery';

/** Where the covered reads and the tables live. */
const INDEX_PACKAGE = join('packages', 'local-index', 'src');

/**
 * The modules inside the package that touch a chart table and answer no history question.
 *
 * Whole modules with a stated reason, never line waivers: a waiver attached to a line is inherited
 * by whatever is pasted next to it. `store.ts` is deliberately **absent** — it owns the covered
 * query, so its own chart references are inside one and it earns no standing exemption.
 */
const INDEX_INTERNALS: ReadonlyMap<string, string> = new Map([
  [
    join(INDEX_PACKAGE, 'quota.ts'),
    "10 §9.2's retention ladder. It folds and deletes rows rather than answering a question " +
      'about them, and its disclosure obligation is the "downsampled" label written in the same ' +
      'transaction as the delete (§9.2 obligation 1), not a `CoveredResult`',
  ],
  [
    join(INDEX_PACKAGE, 'loop-store.ts'),
    "10 §9.1's scan-time aggregate: the read-modify-write of the bucket this block contributes " +
      'to, inside the ingest transaction. It reads one bucket in order to write it, and a bar ' +
      'written from a covered read would be a bar summarising a block the coverage does not claim',
  ],
]);

/**
 * Trees outside the canonical client, excluded with their reason.
 *
 * `bleavit-client-ts` is N10's standalone kit for other people's runtimes: it has no local index,
 * no Dexie and no §6.3 obligation, and app-code rule 13 already exempts it from this client's
 * package rules.
 */
const OUTSIDE_THE_CLIENT: readonly string[] = [join('packages', 'bleavit-client-ts')];

/** `tests/` is not scanned: a suite must be able to seed a chart table to have anything to read. */
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

type Rule = 'chart-table-outside-package' | 'chart-read-outside-covered-query';

interface Violation {
  readonly rule: Rule;
  readonly file: string;
  readonly line: number;
  readonly table: string;
  readonly detail: string;
}

/**
 * The chart table a node denotes, folding one level of same-file `const`.
 *
 * A rule that reads only literals is defeated by naming the literal, and naming it is what a
 * developer does when a gate complains — the lesson `check-chain-literals` and
 * `check-provenance-mints` both encode.
 */
function chartTableOf(node: ts.Node, source: ts.SourceFile): string | undefined {
  if (ts.isParenthesizedExpression(node)) return chartTableOf(node.expression, source);
  if (ts.isAsExpression(node)) return chartTableOf(node.expression, source);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return CHART_TABLES.has(node.text) ? node.text : undefined;
  }
  if (ts.isIdentifier(node)) {
    const folded = constantsOf(source).get(node.text);
    return folded !== undefined && CHART_TABLES.has(folded) ? folded : undefined;
  }
  // `candleTableFor(resolution)` resolves to one of the three candle tables by construction — it
  // is the package's own name for "the table this rung lives in", and its whole purpose is to be
  // handed to `.table()`.
  if (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'candleTableFor'
  ) {
    return 'candleTableFor(…)';
  }
  return undefined;
}

const CONSTANT_CACHE = new WeakMap<ts.SourceFile, Map<string, string>>();

function constantsOf(source: ts.SourceFile): Map<string, string> {
  const cached = CONSTANT_CACHE.get(source);
  if (cached) return cached;
  const constants = new Map<string, string>();
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
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

/** Whether a node sits lexically inside an argument of a `coveredQuery(…)` call. */
function insideCoveredQuery(node: ts.Node): boolean {
  for (let current = node.parent; current !== undefined; current = current.parent) {
    if (
      ts.isCallExpression(current) &&
      ts.isIdentifier(current.expression) &&
      current.expression.text === COVERED_QUERY &&
      // The callee itself is not "inside" the call, and a reference in the `db`/`span` arguments
      // is not a read either — only the `read` callback can name a table, and it is an argument.
      current.arguments.some((argument) => argument.pos <= node.pos && node.end <= argument.end)
    ) {
      return true;
    }
  }
  return false;
}

export function scan(files: readonly string[], forcePackageModule = false): Violation[] {
  const violations: Violation[] = [];
  for (const file of files) {
    const rel = relative(appRoot, file);
    const normalised = rel.split('/').join(sep);
    if (OUTSIDE_THE_CLIENT.some((prefix) => normalised.startsWith(prefix))) continue;
    if (INDEX_INTERNALS.has(normalised)) continue;
    const insidePackage = forcePackageModule || normalised.startsWith(INDEX_PACKAGE + sep);

    const source = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.ES2022,
      true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

    const report = (node: ts.Node, table: string, how: string): void => {
      // Inside the package the covered query is the exemption; outside it there is none, because
      // `coveredQuery` is not exported for a caller to wrap its own bare read in — the two named
      // covered reads are the surface.
      if (insidePackage && insideCoveredQuery(node)) return;
      const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
      violations.push({
        rule: insidePackage ? 'chart-read-outside-covered-query' : 'chart-table-outside-package',
        file: rel,
        line: line + 1,
        table,
        detail: `${how} \`${table}\` outside a covered query`,
      });
    };

    const visit = (node: ts.Node): void => {
      // `db.candles1h…` — the one-liner that returns bare rows.
      if (ts.isPropertyAccessExpression(node) && CHART_TABLES.has(node.name.text)) {
        report(node, node.name.text, 'reaches');
      }
      // `db.table('candles1h')` / `db.table(candleTableFor(rung))` — the same reach, spelled so a
      // property-access rule cannot see it.
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'table'
      ) {
        const first = node.arguments[0];
        const table = first === undefined ? undefined : chartTableOf(first, source);
        if (table !== undefined) report(node, table, 'opens');
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
 * The fixture is read **twice** — once as an ordinary module (rule A) and once as though it lived
 * inside the index package (rule B) — because the two rules are selected by path and one fixture
 * cannot be in two places. Both passes run over the same declared expectations, so a marker states
 * which rules its lines must produce, and a covered read must produce rule A **and nothing** in the
 * second pass: without that half, an exemption widened to "anything in the package" would pass
 * every expectation while making the gate vacuous exactly where it matters.
 */
function runWitness(): number {
  const fixture = join(appRoot, 'tools/fixtures/covered-history-witness.ts');
  const lines = readFileSync(fixture, 'utf8').split('\n');
  const markers: { at: number; rules: readonly Rule[]; note: string }[] = [];
  lines.forEach((line, index) => {
    // `outside+uncovered` is listed **first**: a regex alternation is ordered, and with `outside`
    // ahead of it every two-rule marker matched the one-rule arm with `+uncovered` swallowed into
    // the note — a witness declaring half of what it meant, which is the failure mode a witness
    // exists to prevent, arriving inside the witness itself.
    const match = /^\s*\/\/ expect: (none|outside\+uncovered|outside)\s*(.*)$/.exec(line);
    if (match === null) return;
    const rules: Rule[] =
      match[1] === 'none'
        ? []
        : match[1] === 'outside'
          ? ['chart-table-outside-package']
          : ['chart-table-outside-package', 'chart-read-outside-covered-query'];
    markers.push({ at: index + 1, rules, note: match[2] ?? '' });
  });
  if (markers.length === 0) {
    console.error(`WITNESS HAS NO EXPECTATIONS — ${fixture} declares nothing to catch`);
    return 1;
  }
  const witnessed = new Set(markers.flatMap((marker) => marker.rules));
  const missingRules = (['chart-table-outside-package', 'chart-read-outside-covered-query'] as const).filter(
    (rule) => !witnessed.has(rule),
  );
  if (missingRules.length > 0) {
    console.error(`WITNESS IS INCOMPLETE — no expectation declares: ${missingRules.join(', ')}`);
    return 1;
  }
  // Every chart tier must be named by some expectation. A witness proving only that `candles1h`
  // is caught leaves the other three reachable, and they are the rungs §9.2's ladder degrades
  // *into* — the ones a chart falls back to and the ones nobody looks at.
  const declaredTables = new Set(
    markers.flatMap((marker) => [...CHART_TABLES].filter((table) => marker.note.includes(table))),
  );
  const missingTables = [...CHART_TABLES].filter((table) => !declaredTables.has(table));
  if (missingTables.length > 0) {
    console.error(
      `WITNESS DOES NOT NAME EVERY TIER — ${missingTables.join(', ')} appear in no expectation note`,
    );
    return 1;
  }

  const expectations = markers.map((marker, index) => ({
    ...marker,
    from: marker.at + 1,
    to: index + 1 < markers.length ? (markers[index + 1]?.at ?? lines.length) - 1 : lines.length,
  }));
  const findings = [...scan([fixture], false), ...scan([fixture], true)];
  const claims = (finding: Violation, expected: (typeof expectations)[number]): boolean =>
    expected.rules.includes(finding.rule) &&
    finding.line >= expected.from &&
    finding.line <= expected.to;

  const missed = expectations.flatMap((expected) =>
    expected.rules
      .filter((rule) => !findings.some((f) => f.rule === rule && claims(f, expected)))
      .map((rule) => ({ expected, rule })),
  );
  for (const { expected, rule } of missed) {
    console.error(`  ${fixture}:${expected.from}-${expected.to}  expected ${rule} — ${expected.note}`);
  }
  const undeclared = findings.filter((f) => !expectations.some((e) => claims(f, e)));
  for (const finding of undeclared) {
    console.error(
      `  ${fixture}:${finding.line}  undeclared ${finding.rule} on ${finding.table} — a negative ` +
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
    `witness fired on all ${expectations.filter((e) => e.rules.length > 0).length} declared ` +
      `expectations across both rules and all ${CHART_TABLES.size} tiers, with no undeclared findings`,
  );
  return 0;
}

function main(argv: readonly string[]): number {
  if (argv.includes('--witness')) return runWitness();
  const files = SCAN_ROOTS.flatMap((root) => [...walk(join(appRoot, root))]);
  const violations = scan(files);
  if (violations.length > 0) {
    console.error('Bare-rows gate FAILED (10 §6.3, INV-FE-15):\n');
    for (const v of violations) console.error(`  ${v.file}:${v.line}  ${v.rule} — ${v.detail}`);
    console.error(
      '\n10 §6.3: "Every history query returns data plus the coverage it came from — a\n' +
        '`CoveredResult<T>`, never bare rows, because bare rows render as a complete series."\n\n' +
        'Read a chart tier through the covered reads instead:\n' +
        '  · raw observations  → `coveredSamples(db, bookId, span)`\n' +
        '  · a candle rung     → `coveredCandles(db, bookId, resolution, span)`\n\n' +
        'Both return the rows, the ranges they came from, the span-bounded holes, §9.2\'s\n' +
        'downsampled labels and any migration discard over the span. Only these modules may\n' +
        'name a chart table directly:\n',
    );
    for (const [module, reason] of INDEX_INTERNALS) console.error(`  ${module}\n      ${reason}\n`);
    return 1;
  }
  console.log(
    `Bare-rows gate OK — ${files.length} files scanned, ${CHART_TABLES.size} chart tiers, ` +
      `${INDEX_INTERNALS.size} named internals.`,
  );
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === `file://${resolve(process.argv[1])}`) {
  process.exit(main(process.argv.slice(2)));
}
