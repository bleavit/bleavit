#!/usr/bin/env node
/**
 * The 10 §2.1 / INV-FE-9 render gate — the half `Verified<T>` cannot enforce by itself.
 *
 * `packages/ui/src/datum.tsx` says it out loud: a data component takes a `Verified<T>` and
 * React refuses to render the object, so the *easy* path is the correct one. But
 *
 * ```tsx
 * <Panel title={`Approve ${action.actionId.value}`}>
 * ```
 *
 * typechecks perfectly. The payload of a `Verified<string>` is a `string`, a `string` is a
 * valid title, and the identifier reaches the user's screen with **no badge beside it**. No
 * type can stop that, because there is nothing ill-typed about it.
 *
 * That matters more for an identifier than it looks. A quantity rendered unbadged is a number
 * the user may over-trust; an *identifier* rendered unbadged is a user acting confidently on
 * the wrong object — the heading says "Referendum 42" from an unverified read while every
 * badged figure below it describes whatever 42 actually is.
 *
 * ## Why this is type-aware rather than a grep
 *
 * The survey that motivated the gate found 37 `.value` accesses in `.tsx` files. Most are
 * `key={…}` and event handlers, which are never displayed. Two more are not `Verified<T>` at
 * all:
 *
 * - `event.currentTarget.value` — the DOM's own input value.
 * - `<code>{row.value}</code>` in the verification panel, whose rows carry a `kind`
 *   (`pinned`/`observed`) *as their provenance display* and whose `value` is a plain string
 *   (SQ-592: a release-constant-derived value has no `VerificationStatus`, by ruling).
 *
 * A syntactic rule fires on both. A gate that fires on correct code gets switched off — the
 * same reasoning that narrowed `check-chain-literals.ts`'s rule B to four-digit values. So
 * this one asks the type checker whether the object being unwrapped is a `Verified<T>`, and
 * says nothing otherwise.
 *
 * ## What counts as a display position, and what does not
 *
 * Flagged:
 *   - a JSX **child** expression — `{x.value}` between tags;
 *   - a JSX **attribute** in `DISPLAY_ATTRIBUTES` — the props of `@bleavit/ui` that a
 *     component renders as text.
 *
 * Not flagged, and each for a reason rather than for convenience:
 *   - `key` — React never renders it; it is identity, and identity *should* be the raw value;
 *   - `on*` handlers — an argument to a callback is not on screen;
 *   - everything outside JSX — model code unwraps values constantly and must.
 *
 * The attribute list is closed and derived from what `@bleavit/ui` actually renders as text.
 * A new text prop must be added here, and `check-render-provenance-witness` fails if the
 * list ever stops matching the components — because an attribute silently missing from this
 * set is a hole with a green run over it, which is the failure mode this whole file exists
 * to prevent.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Props of `@bleavit/ui` components that are rendered to the user as text.
 *
 * Kept in sync with the components by the witness, not by discipline.
 */
export const DISPLAY_ATTRIBUTES = Object.freeze([
  'caption',
  'detail',
  'disabledReason',
  'heading',
  'label',
  'message',
  'name',
  'reason',
  'recovery',
  'title',
]);

/** The projects whose `.tsx` files render to a user. */
const PROJECTS = ['src/application', 'src/features/tx', 'src/features/analysis', 'src/features/handoff', 'packages/ui'];

/** `datum.tsx` is where unwrapping is the job; every other file in `ui` is held to the rule. */
const EXEMPT = new Set(['packages/ui/src/datum.tsx']);

/** Where the one real `Verified<T>` is declared. Matched on the path, not on the name alone. */
const VERIFIED_DECLARATION = /packages[/\\]shared-types[/\\](src|dist)[/\\]provenance\.(d\.)?ts$/;

/**
 * Whether an expression's type is *the* `Verified<T>`.
 *
 * Identified by its **declaration site** rather than by its members. `getPropertiesOfType`
 * returns `[]` for a generic type reference the checker has not resolved yet, which silently
 * turned the whole rule off in the witness project while the app scan happened to work —
 * a gate that passes because it examined nothing.
 *
 * The path check also does the job the member check was there for: a future package that
 * happens to export its own `Verified` does not match.
 */
/** Where a `Verified<T>.value` ends up on screen, or why it is not a render at all. */
type DisplayPosition =
  | { readonly kind: 'child' }
  | { readonly kind: 'attribute'; readonly name: string }
  | { readonly kind: 'borrowed-status'; readonly borrowedFrom: string };

interface RenderFinding {
  readonly file: string;
  readonly line: number;
  readonly position: DisplayPosition;
  readonly text: string;
}

function isVerifiedType(_checker: ts.TypeChecker, type: ts.Type): boolean {
  const symbol = type.getSymbol() ?? type.aliasSymbol;
  if (symbol === undefined) return false;
  if (symbol.getName() !== 'Verified') return false;
  const declarations = symbol.getDeclarations() ?? [];
  return declarations.some((declaration) =>
    VERIFIED_DECLARATION.test(declaration.getSourceFile().fileName),
  );
}

/**
 * Walk up from a `.value` access to the JSX position that renders it, if any.
 *
 * Returns `{ kind: 'child' }`, `{ kind: 'attribute', name }`, or `undefined` when the access
 * never reaches JSX — stopping at the first function boundary that is a JSX *handler*, since
 * an argument passed to `onClick` is not on screen even though the call sits inside JSX.
 */
function displayPosition(node: ts.Node): DisplayPosition | undefined {
  let parent: ts.Node | undefined = node.parent;
  while (parent !== undefined) {
    if (ts.isJsxExpression(parent)) {
      const holder = parent.parent;
      if (ts.isJsxAttribute(holder)) {
        const name = holder.name.getText();
        if (name === 'key') return undefined;
        if (/^on[A-Z]/.test(name)) return undefined;
        return DISPLAY_ATTRIBUTES.includes(name) ? { kind: 'attribute', name } : undefined;
      }
      // A child expression: `{x.value}` between tags.
      return { kind: 'child' };
    }
    // An arrow/function body inside JSX: only a handler prop short-circuits, and that is
    // handled above when we reach the attribute. A render callback (`rows.map(...)`) must
    // keep walking, because its result *is* rendered.
    parent = parent.parent;
  }
  return undefined;
}

/**
 * Rule B — a `Verified<T>` hand-built from *another* one's status.
 *
 * ```tsx
 * <Count datum={{ value: graceEnd.value - now.value, status: now.status }} />
 * ```
 *
 * The number is derived from two reads and wears the badge of one of them. If the other was
 * a provider read, the difference renders as verified — INV-FE-1's exact prohibition, reached
 * by arithmetic rather than by an assignment. And if both were verified but at *different*
 * blocks, the figure is true of neither, which no badge can express.
 *
 * `combine`/`combine2` in `@bleavit/shared-types` is the sanctioned path: it takes the weakest
 * input status and refuses outright when the blocks disagree.
 *
 * Matched structurally — an object literal carrying both `value` and `status` where the
 * `status` initializer is a `.status` access — because that shape *is* the borrowing. A
 * literal whose status is written out (`{ kind: 'external-proposal' }`) is not flagged: it
 * claims nothing it did not construct, which is what `externalProposal()` exists to do.
 */
function borrowedStatus(node: ts.Node): { borrowedFrom: string } | undefined {
  if (!ts.isObjectLiteralExpression(node)) return undefined;
  const props = node.properties.filter(ts.isPropertyAssignment);
  const value = props.find((p) => p.name.getText() === 'value');
  const status = props.find((p) => p.name.getText() === 'status');
  if (value === undefined || status === undefined) return undefined;
  if (!ts.isPropertyAccessExpression(status.initializer)) return undefined;
  if (status.initializer.name.getText() !== 'status') return undefined;
  return { borrowedFrom: status.initializer.expression.getText() };
}

/** Module-resolution failures in a project — used to prove the witness fixture is not empty. */
function scanDiagnostics(project: string): string[] {
  const config = parsedConfig(project);
  const program = ts.createProgram(programOptions(config));
  return ts
    .getPreEmitDiagnostics(program)
    .filter((d) => d.code === 2307 || d.code === 2305) // cannot find module / no exported member
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' '));
}

/**
 * Read a project's `tsconfig.json`, refusing an unreadable one.
 *
 * Shared by the scan and the diagnostics leg because they must see the *same* program: an
 * earlier version built two, and a config change that emptied one silently turned the whole
 * rule off in that project while the other happened to work.
 */
function parsedConfig(project: string): ts.ParsedCommandLine {
  const configPath = join(APP, project, 'tsconfig.json');
  const config = ts.getParsedCommandLineOfConfigFile(configPath, {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (d) => {
      throw new Error(ts.flattenDiagnosticMessageText(d.messageText, ' '));
    },
  });
  if (config === undefined) throw new Error(`could not read ${configPath}`);
  return config;
}

/**
 * `projectReferences` is omitted rather than passed as `undefined`.
 *
 * `exactOptionalPropertyTypes` distinguishes the two, and `CreateProgramOptions` declares
 * the field optional without admitting `undefined` — so spreading it in unconditionally is
 * a type error rather than a no-op.
 */
function programOptions(config: ts.ParsedCommandLine): ts.CreateProgramOptions {
  const base = {
    rootNames: config.fileNames,
    options: { ...config.options, noEmit: true },
  };
  return config.projectReferences === undefined
    ? base
    : { ...base, projectReferences: config.projectReferences };
}

export function scan({ projects = PROJECTS }: { projects?: readonly string[] } = {}): RenderFinding[] {
  const findings: RenderFinding[] = [];
  for (const project of projects) {
    const config = parsedConfig(project);
    const program = ts.createProgram(programOptions(config));
    const checker = program.getTypeChecker();

    for (const source of program.getSourceFiles()) {
      if (source.isDeclarationFile) continue;
      const rel = relative(APP, source.fileName);
      if (rel.startsWith('..') || rel.includes('node_modules')) continue;
      if (!rel.endsWith('.tsx')) continue;
      if (EXEMPT.has(rel)) continue;

      const visit = (node: ts.Node): void => {
        const borrowed = borrowedStatus(node);
        if (borrowed !== undefined) {
          const { line } = source.getLineAndCharacterOfPosition(node.getStart());
          findings.push({
            file: rel,
            line: line + 1,
            position: { kind: 'borrowed-status', borrowedFrom: borrowed.borrowedFrom },
            text: node.getText().replace(/\s+/g, ' '),
          });
        }
        if (
          ts.isPropertyAccessExpression(node) &&
          node.name.getText() === 'value'
        ) {
          const position = displayPosition(node);
          if (position !== undefined) {
            const type = checker.getTypeAtLocation(node.expression);
            if (isVerifiedType(checker, type)) {
              const { line } = source.getLineAndCharacterOfPosition(node.getStart());
              findings.push({
                file: rel,
                line: line + 1,
                position,
                text: node.getText(),
              });
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  }
  return findings;
}

const WITNESS = 'tools/fixtures/render-provenance-witness';

/**
 * Props of `@bleavit/ui` components that are deliberately **not** display text.
 *
 * Every string-typed prop on an exported component must be in this list or in
 * `DISPLAY_ATTRIBUTES`. A new one forces the classification rather than defaulting to
 * "not checked" — an attribute silently missing from the display set is a hole with a green
 * run over it, which is the exact failure this gate exists to prevent.
 */
const NON_DISPLAY_PROPS = Object.freeze([
  'rawHex', // rendered as raw SCALE inside `Undecodable`, which is the warning itself
  'code', // FE-HANDOFF-* identifier — release copy, not a chain read
  'describedBy', // an element id
  'symbol', // the asset ticker, release copy
  'key', // React identity; never rendered
  'tone', // presentation discriminant → a CSS class
  'severity', // presentation discriminant → a CSS class
  'intent', // presentation discriminant → a CSS class
]);

/**
 * The second half of the witness: the display list must keep matching the components.
 *
 * Reads every exported component in `@bleavit/ui` and collects its string-typed props. A prop
 * classified in neither list fails — so adding `subtitle: string` to `Panel` cannot quietly
 * open a position the gate does not watch.
 */
function checkAttributeCoverage(): string[] {
  const files = ['packages/ui/src/chrome.tsx', 'packages/ui/src/datum.tsx'];
  const unclassified: string[] = [];
  for (const file of files) {
    const source = ts.createSourceFile(
      file,
      readFileSync(join(APP, file), 'utf8'),
      ts.ScriptTarget.ESNext,
      true,
      ts.ScriptKind.TSX,
    );
    const visit = (node: ts.Node): void => {
      if (ts.isPropertySignature(node) && node.type !== undefined) {
        // Only props that are *themselves* text. `Verified<string>` is the correct path (it
        // arrives badged), `(value: T) => string` is a formatter, and `readonly string[]` is
        // a header row of in-bundle copy — a substring match on `string` swept in all three
        // and would have forced meaningless classifications until the check was deleted.
        const text = node.type.getText().replace(/\s*\|\s*undefined\s*$/, '').trim();
        const isText = text === 'string' || /^'[^']*'(\s*\|\s*'[^']*')*$/.test(text);
        if (isText) {
          const name = node.name.getText();
          if (!DISPLAY_ATTRIBUTES.includes(name) && !NON_DISPLAY_PROPS.includes(name)) {
            unclassified.push(`${file}: ${name}: ${text}`);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return unclassified;
}

function runWitness(): number {
  const source = readFileSync(join(APP, WITNESS, 'src/witness.tsx'), 'utf8').split('\n');
  const expectations: { rule: string; kind: string; from: number; to: number }[] = [];
  source.forEach((line, index) => {
    const match = /^\s*\/\/ expect: ([AB]) (\w+)$/.exec(line);
    // The expectation sits on the line before the code it describes; a JSX expression can
    // span lines, so accept a small window rather than an exact line.
    if (match !== null && match[1] !== undefined && match[2] !== undefined) {
      expectations.push({ rule: match[1], kind: match[2], from: index + 2, to: index + 5 });
    }
  });
  if (expectations.length === 0) {
    console.error('witness: no `// expect:` lines found — the fixture cannot prove anything.');
    return 1;
  }

  let failed = 0;

  // The fixture must actually resolve its imports. A witness whose `@bleavit/*` specifiers do
  // not resolve still *parses*, and an unresolved type reference still prints as
  // `Verified<string>` — so every rule inspects nothing and every expectation reports "did
  // not fire", which reads exactly like a rule that broke. That happened here: this fixture is
  // not a workspace package, so pnpm links nothing beside it. Checked rather than trusted.
  const unresolved = scanDiagnostics(WITNESS);
  for (const message of unresolved) {
    console.error(
      `witness: ${message}\n` +
        '  The fixture must resolve its imports, or every rule examines an unresolved type ' +
        'and the run proves nothing.',
    );
    failed += 1;
  }

  const findings = scan({ projects: [WITNESS] });

  for (const expected of expectations) {
    const hit = findings.find((finding) => {
      if (finding.line < expected.from || finding.line > expected.to) return false;
      const rule = finding.position.kind === 'borrowed-status' ? 'B' : 'A';
      if (rule !== expected.rule) return false;
      return expected.kind === 'borrowed'
        ? finding.position.kind === 'borrowed-status'
        : finding.position.kind === expected.kind;
    });
    if (hit === undefined) {
      console.error(
        `witness: rule ${expected.rule}/${expected.kind} did NOT fire at witness.tsx:` +
          `${expected.from}-${expected.to} — the rule cannot detect the thing it forbids.`,
      );
      failed += 1;
    }
  }

  // Negative controls: anything reported outside a declared window is a false positive, and a
  // gate that fires on correct code gets switched off rather than fixed.
  const claimed = (finding: RenderFinding): boolean =>
    expectations.some((e) => finding.line >= e.from && finding.line <= e.to);
  for (const finding of findings.filter((f) => !claimed(f))) {
    console.error(
      `witness: FALSE POSITIVE at witness.tsx:${finding.line} — ${finding.text}\n` +
        '  This line is a negative control: it is correct code the gate must stay silent on.',
    );
    failed += 1;
  }

  const unclassified = checkAttributeCoverage();
  for (const prop of unclassified) {
    console.error(
      `witness: unclassified string prop — ${prop}\n` +
        '  Add it to DISPLAY_ATTRIBUTES (it renders as text) or to NON_DISPLAY_PROPS (it does ' +
        'not). Leaving it out is a position the gate silently does not watch.',
    );
    failed += 1;
  }

  if (failed > 0) return 1;
  console.log(
    `witness fired on all ${expectations.length} declared expectations, no false positives ` +
      `on ${source.filter((l) => /^export function Control/.test(l)).length} negative controls, ` +
      `${DISPLAY_ATTRIBUTES.length + NON_DISPLAY_PROPS.length} props classified`,
  );
  return 0;
}

function main() {
  if (process.argv.includes('--witness')) return runWitness();
  const findings = scan();
  if (findings.length === 0) {
    console.log('check-render-provenance: no unbadged Verified<T> payload reaches a display position.');
    return 0;
  }
  console.error('check-render-provenance: a chain value reaches the screen without its badge.\n');
  for (const finding of findings) {
    console.error(`  ${finding.file}:${finding.line}  ${finding.text}`);
    if (finding.position.kind === 'borrowed-status') {
      console.error(
        `      a derived value wearing \`${finding.position.borrowedFrom}\`'s status — INV-FE-1: ` +
          'the result is no stronger than its weakest input, and two reads at different blocks ' +
          'do not combine at all.',
      );
      console.error(
        "      Use `combine2(a, b, (x, y) => …)` from @bleavit/shared-types and render the " +
          'result with `<Derived>`.\n',
      );
      continue;
    }
    const where =
      finding.position.kind === 'child'
        ? 'rendered as a JSX child'
        : `passed as the display prop \`${finding.position.name}\``;
    console.error(`      ${where} — INV-FE-9 requires a typed status beside it.`);
    console.error(
      '      Render the whole Verified<T> through a @bleavit/ui data component instead of ' +
        'unwrapping it.\n',
    );
  }
  console.error(
    `${findings.length} finding(s). If a value genuinely has no provenance (a release ` +
      'constant, a DOM input), it should not be typed Verified<T> in the first place.',
  );
  return 1;
}

if (process.argv[1] !== undefined && import.meta.url === `file://${resolve(process.argv[1])}`) {
  process.exit(main());
}
