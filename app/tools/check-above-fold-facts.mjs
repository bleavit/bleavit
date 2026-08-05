/**
 * Every meaning-changing fact has an emitter, or is declared as not-yet-built.
 *
 * ## The defect class this closes, which this repository keeps rediscovering
 *
 * `FE-HANDOFF-012` shipped **defined and unreachable** — a refusal code with zero emitting
 * call sites, which no green run distinguishes from one that never fires. `FE-HANDOFF-010`
 * was the same shape one milestone earlier. So was the `>>> 0` normalisation that could not
 * fail, and so was a screen sitting in neither the implemented nor the pending map.
 *
 * 11 §11.2 constraint 3's five facts are the highest-consequence instance available: each
 * is a thing that changes the meaning of a signature, and each is emitted by exactly one
 * call site. If `sudo-era-banner` lost its emitter in a refactor, every existing test would
 * still pass — the `ui` suite proves `AlwaysVisible` *works*, and the screens suite proves
 * the shell renders it *when given one*. Neither asks whether anything still gives it one.
 *
 * ## Not-yet-built is declared, never inferred
 *
 * Two facts have no emitter today and both are correct: `conviction-vote-lock` is supplied
 * by the vote flow's caller, which is unwired; `void-recovery-decomposition` belongs to S4,
 * which is F7b. Those are listed below **with the milestone that will supply them**, exactly
 * as `PENDING_SCREENS` does — because "nobody emits it yet" and "nobody emits it any more"
 * look identical from a count, and only the first is acceptable.
 *
 * The list shrinks to empty as Track F closes. An entry that becomes wrong — a fact that
 * gains an emitter while still declared pending — **fails**, so the declaration cannot rot
 * into a permanent excuse.
 *
 * ## What this gate does NOT cover, measured rather than assumed
 *
 * It asks whether a fact has **an** emitter, not whether it has the *right ones*. A fact can
 * carry more than one obligation: §11.10 requires the sudo banner on **every route** (the
 * shell) *and* *"repeated as a line item on every transaction confirm screen"* — two sites,
 * two rules. Deleting the shell's emitter leaves the confirm one, so this gate stays green.
 *
 * That is not a hole, because the per-site obligations have their own tests, and the
 * complement was checked rather than hoped for: removing the shell's emitter fails **three**
 * assertions in `app/tests/screens` (the banner above navigation, the no-prop-can-hide-it
 * sweep, and the recorded-bytes end-to-end). The division of labour is deliberate — a gate
 * over call sites cannot know *where* a fact belongs, and a render test cannot know whether
 * anything still constructs one.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const APP_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SOURCE_ROOTS = ['src', 'packages'];
const FACTS_MODULE = join(APP_ROOT, 'packages/ui/src/disclosure.tsx');

/**
 * Facts with no emitter yet, and the milestone that will supply one.
 *
 * Keep this in step with PLAN.md. An entry here is a promise, not a waiver.
 */
const AWAITING_EMITTER = Object.freeze({
  'conviction-vote-lock':
    'F16 — `VoteForm` takes it as a prop; the vote flow that constructs it is not wired yet',
  'void-recovery-decomposition':
    'F7b — S4’s VOID redemption screen, where the recovery decomposition is rendered',
});

/** The declared facts, read from `MEANING_CHANGING_FACTS` rather than restated. */
function declaredFacts() {
  const source = readFileSync(FACTS_MODULE, 'utf8');
  const parsed = ts.createSourceFile(FACTS_MODULE, source, ts.ScriptTarget.ES2022, true);
  const facts = [];
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'MEANING_CHANGING_FACTS' &&
      node.initializer !== undefined
    ) {
      // `Object.freeze({ 'fact': '§n', … } as const)` — walk to the object literal.
      const literal = findObjectLiteral(node.initializer);
      if (literal !== undefined) {
        for (const property of literal.properties) {
          if (ts.isPropertyAssignment(property) && ts.isStringLiteral(property.name)) {
            facts.push(property.name.text);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return facts;
}

function findObjectLiteral(node) {
  let found;
  const visit = (candidate) => {
    if (found !== undefined) return;
    if (ts.isObjectLiteralExpression(candidate)) {
      found = candidate;
      return;
    }
    ts.forEachChild(candidate, visit);
  };
  visit(node);
  return found;
}

function* sourceFiles(directory) {
  let entries;
  try {
    entries = readdirSync(directory);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      yield* sourceFiles(path);
      continue;
    }
    if (entry.endsWith('.ts') || entry.endsWith('.tsx')) yield path;
  }
}

/**
 * Every `aboveTheFold('<fact>', …)` call site.
 *
 * Off the AST, not a regex: the calls span lines (the node argument is usually JSX), and a
 * line-oriented pattern misses exactly the multi-line ones — which is how a first pass at
 * this check reported three facts unemitted when only two were.
 */
export function emittersByFact(roots = SOURCE_ROOTS) {
  const emitters = new Map();
  for (const root of roots) {
    for (const file of sourceFiles(join(APP_ROOT, root))) {
      const text = readFileSync(file, 'utf8');
      const parsed = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
      const visit = (node) => {
        if (
          ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === 'aboveTheFold'
        ) {
          const [first] = node.arguments;
          if (first !== undefined && ts.isStringLiteral(first)) {
            const list = emitters.get(first.text) ?? [];
            list.push(relative(APP_ROOT, file));
            emitters.set(first.text, list);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(parsed);
    }
  }
  return emitters;
}

function main() {
  const facts = declaredFacts();
  const emitters = emittersByFact();
  const errors = [];

  // Fail closed: parsing no facts would make every check below vacuously true.
  if (facts.length < 5) {
    errors.push(
      `parsed only ${facts.length} facts out of MEANING_CHANGING_FACTS — the declaration ` +
        'shape changed, and a check over an empty set passes without checking anything',
    );
  }

  for (const fact of facts) {
    const sites = emitters.get(fact) ?? [];
    const pending = AWAITING_EMITTER[fact];
    if (sites.length === 0 && pending === undefined) {
      errors.push(
        `"${fact}" is declared by 11 §11.2 constraint 3 and nothing emits it. A fact that ` +
          'is defined and unreachable is indistinguishable from one that never fires — the ' +
          'FE-HANDOFF-012 shape. Either render it, or declare it in AWAITING_EMITTER with ' +
          'the milestone that will.',
      );
    }
    if (sites.length > 0 && pending !== undefined) {
      errors.push(
        `"${fact}" is declared as awaiting an emitter but ${sites.length} call site(s) now ` +
          `emit it (${sites.join(', ')}). Remove it from AWAITING_EMITTER — a stale ` +
          'declaration is how a promise becomes a permanent excuse.',
      );
    }
  }

  for (const fact of Object.keys(AWAITING_EMITTER)) {
    if (!facts.includes(fact)) {
      errors.push(`AWAITING_EMITTER names "${fact}", which is not a declared fact`);
    }
  }

  if (errors.length > 0) {
    console.error('Above-the-fold fact errors:');
    for (const error of errors) console.error(`  - ${error}`);
    return 1;
  }

  const emitted = facts.filter((fact) => (emitters.get(fact) ?? []).length > 0);
  console.log(
    `OK  ${emitted.length}/${facts.length} meaning-changing facts have an emitter; ` +
      `${Object.keys(AWAITING_EMITTER).length} declared as awaiting one.`,
  );
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main());
