#!/usr/bin/env node
/**
 * The F28 style-coverage gate — every class the markup uses has a rule, and every rule the
 * stylesheet defines is used.
 *
 * ## Why this exists
 *
 * The markup carried 92 semantic class names for weeks with **no stylesheet at all**, and
 * nothing said so: `className="verification__row"` typechecks, renders, and passes every
 * suite whether or not a rule exists. The failure is invisible in exactly the direction that
 * matters — an unstyled element still contains its text, so a screen reads as "working" in a
 * test and as broken to a person.
 *
 * The reverse direction matters as much and is the one a stylesheet accumulates over time:
 * a rule for a class nobody renders is dead weight in a tree that is content-addressed,
 * budgeted and published forever.
 *
 * ## The part that is not a grep
 *
 * A first version of this check reported **100 % coverage and zero dynamic families** on a
 * tree that had five of them. Its pattern required a quote immediately after `className=`,
 * so it never saw `className={`badge badge--${status.kind}`}` — every conditional class in
 * the application was invisible to it, and the reassuring number was computed over the
 * subset it could parse. That is the same shape of defect the gate is written to catch, so
 * the rule here is: a class name this tool cannot resolve is a **failure**, never a silent
 * skip.
 *
 * Dynamic families are therefore declared, not inferred. `DYNAMIC_FAMILIES` lists each stem
 * with the exact variants its source can produce; the tool checks that every declared
 * variant has a rule, and that no undeclared family appears in the markup. Adding a variant
 * to a union without adding it here fails the build rather than rendering unstyled.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import process from 'node:process';

const APP = new URL('..', import.meta.url).pathname;
const STYLESHEET = join(APP, 'src/styles/app.css');
const ROOTS = ['src', 'packages'];

/**
 * Class-name families built by interpolation, with the full set each source can emit.
 *
 * Every entry names where the values come from, because that is what a reader has to
 * re-check when a union grows. A family present in the markup and absent here is an error:
 * the alternative is a tool that quietly ignores what it cannot read.
 */
const DYNAMIC_FAMILIES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  // `VerificationStatus['kind']` — 10 §2.1, six statuses, INV-FE-9's enumeration.
  badge: [
    'verified-finalized',
    'verified-best',
    'derived-local',
    'provider',
    'stale-cache',
    'external-proposal',
  ],
  // `PanelProps['tone']` — packages/ui/src/chrome.tsx.
  panel: ['plain', 'advanced'],
  // `NoticeProps['severity']` — packages/ui/src/chrome.tsx.
  notice: ['info', 'caution', 'danger'],
  // `ButtonProps['intent']` — packages/ui/src/chrome.tsx.
  button: ['primary', 'secondary', 'danger'],
  // `MeaningChangingFact` — packages/ui/src/disclosure.tsx, five §-cited facts.
  'above-fold': [
    'charged-redemption-net-payout',
    'void-recovery-decomposition',
    'conviction-vote-lock',
    'sudo-era-banner',
    'imported-action-origin',
  ],
  // Conditional literals rather than a union: shell.tsx's active link, share.tsx's scopes.
  nav__link: ['active'],
  scope: ['account', 'pseudonymize'],
});

/**
 * Variants that deliberately have no rule of their own because the base class already *is*
 * their appearance. Listed rather than tolerated: a missing rule and an intentionally absent
 * one look identical in a stylesheet, and only one of them is correct.
 */
const VARIANTS_WITHOUT_RULES: Readonly<Record<string, string>> = Object.freeze({
  'panel--plain': 'the default tone — `.panel` is the plain panel, so a rule would be a no-op',
  'above-fold--conviction-vote-lock':
    'a lock duration is a commitment rather than a loss or a warning, so it keeps the neutral ' +
    'brand treatment of `.above-fold`',
});

/** `className="a b"` and `className={`a b--${x}`}`, which is the pair the first version missed. */
const CLASS_ATTR = /className=(?:"([^"]*)"|\{`([^`]*)`\})/g;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry === 'node_modules' || entry === 'dist') continue;
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.tsx')) out.push(full);
  }
  return out;
}

interface Usage {
  readonly statics: Map<string, string[]>;
  readonly families: Map<string, string[]>;
}

function collectUsage(roots: readonly string[]): Usage {
  const statics = new Map<string, string[]>();
  const families = new Map<string, string[]>();
  for (const root of roots) {
    for (const file of walk(join(APP, root))) {
      const where = relative(APP, file);
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(CLASS_ATTR)) {
        const literal = match[1] ?? match[2] ?? '';
        // Inside a template the conditional arms are themselves quoted strings, so a
        // ` nav__link--active` hiding in `${cond ? ' nav__link--active' : ''}` is recovered
        // here rather than thrown away with the interpolation.
        const inlineArms = [...literal.matchAll(/'([^']*)'/g)].map((m) => m[1] ?? '');
        const outsideArms = literal.replace(/\$\{[^}]*\}/g, ' ');
        for (const token of [outsideArms, ...inlineArms].join(' ').split(/\s+/)) {
          // A token ending in `--` is the stem left behind by stripping `${…}`; the family
          // loop below owns it. Recording it as a class would report `badge--` unstyled on
          // a stylesheet that styles all six badges.
          if (!token || token.endsWith('--')) continue;
          (statics.get(token) ?? statics.set(token, []).get(token)!).push(where);
        }
        for (const interpolation of literal.matchAll(/([a-zA-Z0-9_-]+)--\$\{/g)) {
          const stem = interpolation[1]!;
          (families.get(stem) ?? families.set(stem, []).get(stem)!).push(where);
        }
      }
    }
  }
  return { statics, families };
}

function definedSelectors(stylesheet: string): Set<string> {
  // Comments and quoted strings first. The file explains itself at length and names `.tsx`
  // files and class names in prose, and its `@source '../../src/**/*.tsx'` directives are
  // globs — a scan that reads either reports rules that do not exist. `.tsx` was reported as
  // a dead rule until this line stripped the glob it came from.
  const css = readFileSync(stylesheet, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'[^']*'|"[^"]*"/g, ' ');
  // A class selector cannot begin with a digit, and the dot must not be a decimal point.
  // Without both halves the scan reports `.5rem`, `.95` and `.0625rem` as dead rules — 84 of
  // them on the first run, which is the volume that gets a gate switched off rather than read.
  return new Set(
    [...css.matchAll(/(?<![\w.#%)-])\.(-?[a-zA-Z_][a-zA-Z0-9_-]*)/g)].map((m) => m[1]!),
  );
}

interface Analysis {
  readonly errors: readonly string[];
  readonly statics: number;
  readonly families: number;
  readonly selectors: number;
}

/**
 * The whole check, over an arbitrary pair of source roots and stylesheet.
 *
 * Extracted so the witness can run the *same* code over a deliberately broken fixture. A
 * witness that exercises a different path than the gate proves the path it exercises.
 */
function analyse(
  roots: readonly string[],
  stylesheet: string,
  dynamicFamilies: Readonly<Record<string, readonly string[]>>,
  withoutRules: Readonly<Record<string, string>>,
): Analysis {
  const { statics, families } = collectUsage(roots);
  const defined = definedSelectors(stylesheet);
  const errors: string[] = [];

  const expected = new Set<string>();
  for (const [stem, variants] of Object.entries(dynamicFamilies)) {
    expected.add(stem);
    for (const variant of variants) expected.add(`${stem}--${variant}`);
  }

  for (const [cls, where] of statics) {
    if (!defined.has(cls) && !expected.has(cls)) {
      errors.push(`unstyled class \`${cls}\` used in ${[...new Set(where)].join(', ')}`);
    }
  }

  for (const [stem, where] of families) {
    if (!(stem in dynamicFamilies)) {
      errors.push(
        `undeclared dynamic family \`${stem}--\${…}\` in ${[...new Set(where)].join(', ')} — ` +
          'add it to DYNAMIC_FAMILIES with the exact variants its source can emit, so the ' +
          'variants are checked rather than skipped',
      );
    }
  }

  for (const [stem, variants] of Object.entries(dynamicFamilies)) {
    for (const variant of variants) {
      const full = `${stem}--${variant}`;
      if (!defined.has(full) && !(full in withoutRules)) {
        errors.push(
          `declared variant \`${full}\` has no rule — style it, or record in ` +
            'VARIANTS_WITHOUT_RULES why the base class is already its appearance',
        );
      }
      if (defined.has(full) && full in withoutRules) {
        errors.push(
          `\`${full}\` has a rule but is listed in VARIANTS_WITHOUT_RULES — one of the two is ` +
            'stale, and the list is what a reader trusts',
        );
      }
    }
  }

  const used = new Set([...statics.keys(), ...expected]);
  // Framework and state selectors are not class usage.
  const IGNORED = /^(tw-|dark$|group$|peer$|sr-only$)/;
  for (const selector of defined) {
    if (!used.has(selector) && !IGNORED.test(selector)) {
      errors.push(`dead rule \`.${selector}\` matches no rendered class`);
    }
  }

  return { errors, statics: statics.size, families: families.size, selectors: defined.size };
}

/**
 * The witness fixture, and what each of its four defects must produce.
 *
 * The previous witness asserted only that the three collectors returned something non-empty,
 * which proves the tool can read files and nothing about whether any rule fires. That is the
 * weaker half of the very control this gate argues for, and every other `:witness` in this
 * workspace does the stronger thing — `depcruise:witness` inverts an exit code on a known-bad
 * edge, `check-no-html-sinks` requires each marked line to be detected, and 15 §4.1 requires
 * the model checker's witness configs to actually violate.
 */
const WITNESS_ROOTS = ['tools/fixtures/style-coverage-witness'];
const WITNESS_STYLESHEET = join(APP, 'tools/fixtures/style-coverage-witness/witness.css');
const WITNESS_FAMILIES = Object.freeze({ 'witness-declared': ['present', 'gone'] });
const WITNESS_EXPECTATIONS: readonly (readonly [string, RegExp])[] = [
  ['an unstyled class is reported', /unstyled class `witness-unstyled-class`/],
  ['an undeclared dynamic family is reported', /undeclared dynamic family `witness-undeclared--/],
  ['a declared variant with no rule is reported', /declared variant `witness-declared--gone`/],
  ['a dead rule is reported', /dead rule `\.witness-dead-rule`/],
];

function main(): void {
  if (process.argv.includes('--witness')) {
    const { errors } = analyse(WITNESS_ROOTS, WITNESS_STYLESHEET, WITNESS_FAMILIES, {});
    const missed = WITNESS_EXPECTATIONS.filter(([, pattern]) => !errors.some((e) => pattern.test(e)));
    if (missed.length > 0) {
      console.error('witness: the gate did not fire on its own fixture:');
      for (const [what] of missed) console.error(`  - ${what}`);
      console.error('  reported instead:');
      for (const error of errors) console.error(`    ${error}`);
      process.exit(1);
    }
    console.log(
      `witness fired on all ${WITNESS_EXPECTATIONS.length} declared expectations ` +
        `(${errors.length} finding(s) over the fixture): unstyled class, undeclared family, ` +
        'declared variant without a rule, dead rule.',
    );
    return;
  }

  const { errors, statics, families, selectors } = analyse(
    ROOTS,
    STYLESHEET,
    DYNAMIC_FAMILIES,
    VARIANTS_WITHOUT_RULES,
  );
  if (errors.length > 0) {
    console.error('Style coverage errors:');
    for (const error of [...errors].sort()) console.error(`  - ${error}`);
    process.exit(1);
  }
  console.log(
    `Style coverage OK — ${statics} rendered class(es), ${families} dynamic family/families ` +
      `over ${Object.keys(DYNAMIC_FAMILIES).length} declared, ${selectors} selector(s), ` +
      'no unstyled markup and no dead rules.',
  );
}

main();
