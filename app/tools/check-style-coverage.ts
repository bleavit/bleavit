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

function collectUsage(): Usage {
  const statics = new Map<string, string[]>();
  const families = new Map<string, string[]>();
  for (const root of ROOTS) {
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

function definedSelectors(): Set<string> {
  // Comments and quoted strings first. The file explains itself at length and names `.tsx`
  // files and class names in prose, and its `@source '../../src/**/*.tsx'` directives are
  // globs — a scan that reads either reports rules that do not exist. `.tsx` was reported as
  // a dead rule until this line stripped the glob it came from.
  const css = readFileSync(STYLESHEET, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'[^']*'|"[^"]*"/g, ' ');
  // A class selector cannot begin with a digit, and the dot must not be a decimal point.
  // Without both halves the scan reports `.5rem`, `.95` and `.0625rem` as dead rules — 84 of
  // them on the first run, which is the volume that gets a gate switched off rather than read.
  return new Set(
    [...css.matchAll(/(?<![\w.#%)-])\.(-?[a-zA-Z_][a-zA-Z0-9_-]*)/g)].map((m) => m[1]!),
  );
}

function main(): void {
  const witness = process.argv.includes('--witness');
  const { statics, families } = collectUsage();
  const defined = definedSelectors();
  const errors: string[] = [];

  const expected = new Set<string>();
  for (const [stem, variants] of Object.entries(DYNAMIC_FAMILIES)) {
    expected.add(stem);
    for (const variant of variants) expected.add(`${stem}--${variant}`);
  }

  for (const [cls, where] of statics) {
    if (!defined.has(cls) && !expected.has(cls)) {
      errors.push(`unstyled class \`${cls}\` used in ${[...new Set(where)].join(', ')}`);
    }
  }

  for (const [stem, where] of families) {
    if (!(stem in DYNAMIC_FAMILIES)) {
      errors.push(
        `undeclared dynamic family \`${stem}--\${…}\` in ${[...new Set(where)].join(', ')} — ` +
          'add it to DYNAMIC_FAMILIES with the exact variants its source can emit, so the ' +
          'variants are checked rather than skipped',
      );
    }
  }

  for (const [stem, variants] of Object.entries(DYNAMIC_FAMILIES)) {
    for (const variant of variants) {
      const full = `${stem}--${variant}`;
      if (!defined.has(full) && !(full in VARIANTS_WITHOUT_RULES)) {
        errors.push(
          `declared variant \`${full}\` has no rule in app.css — style it, or record in ` +
            'VARIANTS_WITHOUT_RULES why the base class is already its appearance',
        );
      }
      if (defined.has(full) && full in VARIANTS_WITHOUT_RULES) {
        errors.push(
          `\`${full}\` has a rule but is listed in VARIANTS_WITHOUT_RULES — one of the two is ` +
            'stale, and the list is what a reader trusts',
        );
      }
    }
  }

  const used = new Set([...statics.keys(), ...expected]);
  // Rules that belong to the framework or to element/state selectors are not class usage.
  const IGNORED = /^(tw-|dark$|group$|peer$|sr-only$)/;
  for (const selector of defined) {
    if (!used.has(selector) && !IGNORED.test(selector)) {
      errors.push(`dead rule \`.${selector}\` in app.css matches no rendered class`);
    }
  }

  if (witness) {
    // The gate has three rules; each must be shown to fire, or a green run proves nothing.
    const shown = [
      statics.size > 0 && 'markup classes were collected',
      families.size > 0 && 'dynamic families were collected',
      defined.size > 0 && 'stylesheet selectors were collected',
    ].filter(Boolean);
    if (shown.length !== 3) {
      console.error(`witness: only ${shown.length}/3 collectors produced anything — ${shown}`);
      process.exit(1);
    }
    console.log(
      `witness fired: ${statics.size} class(es), ${families.size} dynamic family/families, ` +
        `${defined.size} selector(s); all three collectors non-empty`,
    );
    return;
  }

  if (errors.length > 0) {
    console.error('Style coverage errors:');
    for (const error of errors.sort()) console.error(`  - ${error}`);
    process.exit(1);
  }

  console.log(
    `Style coverage OK — ${statics.size} rendered class(es), ` +
      `${families.size} dynamic family/families over ${Object.keys(DYNAMIC_FAMILIES).length} ` +
      `declared, ${defined.size} selector(s), no unstyled markup and no dead rules.`,
  );
}

main();
