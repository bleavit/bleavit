#!/usr/bin/env node
/**
 * Derive the explainer's test fixtures from the repository's own artifacts.
 *
 * The protocol core in `src/protocol/` is a third independent implementation of
 * the spec math (alongside the Rust pallets and the Python reference model). It
 * earns the right to claim accuracy by certifying against the same corpus the
 * Rust differential suites replay — `.claude/rules/reference-model.md` rule 4:
 *
 *   "The backend differential suites and the frontend TypeScript port both
 *    certify against this one artifact."
 *
 * Sources (read-only, outside this package):
 *   ../reference-model/fixtures/vectors.json     schema bleavit.reference-model.v4
 *   ../tools/limit-coverage/genesis-keys.json    the seeded doc-13 registry keys
 *   ../crates/market-core/fixtures/chain-quote-agreement.json
 *                                                schema bleavit.chain-quote-agreement.v1
 *
 * The third source is not part of the reference corpus and is deliberately
 * separate from it. The corpus states what the *arithmetic* is; this fixture
 * states what **this runtime's quote surface answers**, including the roundings
 * and — the part nothing else pins — which failures are refusals rather than
 * numbers. It is the artifact that caught `buy()` pricing an out-of-domain
 * post-state the chain declines to price at all.
 *
 * Output is checked in, so `npm test` never reaches outside `explainer/`.
 *
 * WHICH IS EXACTLY WHY `--check` EXISTS. A checked-in copy of somebody else's
 * artifact is a claim that goes stale silently: regenerate the reference corpus,
 * add a genesis key, re-record the quote fixture, and every suite here keeps
 * replaying yesterday's copy and keeps passing. The certification claim would
 * then be true of a corpus that no longer exists. So `npm run verify` runs
 * `--check`, which re-derives in memory and compares byte-for-byte, and the
 * failure names the source that moved rather than the copy that did not.
 *
 * `--check` never writes. Regeneration stays an explicit `npm run fixtures`, for
 * the same reason `build-math.mjs` splits them: a gate that silently repairs
 * what it is measuring reports success at the moment it should report drift.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..');
const outDir = resolve(here, '..', 'src', 'protocol', '__fixtures__');

const read = (rel) => {
  const path = resolve(repo, rel);
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (cause) {
    throw new Error(
      `cannot read required repository artifact ${rel} — the explainer's ` +
        `fixtures are derived from it and must not be hand-authored`,
      { cause },
    );
  }
};

const vectors = read('reference-model/fixtures/vectors.json');
const genesisKeys = read('tools/limit-coverage/genesis-keys.json');
const chainQuotes = read('crates/market-core/fixtures/chain-quote-agreement.json');

const EXPECTED_SCHEMA = 'bleavit.reference-model.v4';
if (vectors.schema !== EXPECTED_SCHEMA) {
  throw new Error(
    `vectors.json schema is "${vectors.schema}", expected "${EXPECTED_SCHEMA}". ` +
      `The corpus layout changed; review the fixture mapping before regenerating.`,
  );
}

/** Families the explainer certifies against. Everything else is dropped. */
const FAMILIES = [
  'lmsr_vectors',
  'lmsr_maker_example',
  'high_precision_corpus',
  'twap_scenarios',
  'window_stale_scenarios',
  'decision_scenarios',
  'welfare_scenarios',
  'ledger_scenarios',
  'ledger_score_scenarios',
  'treasury_scenarios',
];

const missing = FAMILIES.filter((f) => !(f in vectors));
if (missing.length > 0) {
  throw new Error(`vectors.json is missing expected families: ${missing.join(', ')}`);
}

const slim = { schema: vectors.schema, precision: vectors.precision };
for (const family of FAMILIES) slim[family] = vectors[family];

if (!Array.isArray(genesisKeys) || genesisKeys.length === 0) {
  throw new Error('genesis-keys.json must be a non-empty array of key strings');
}

const QUOTE_SCHEMA = 'bleavit.chain-quote-agreement.v1';
if (chainQuotes.schema !== QUOTE_SCHEMA) {
  throw new Error(
    `chain-quote-agreement.json schema is "${chainQuotes.schema}", expected "${QUOTE_SCHEMA}". ` +
      `The quote-surface fixture changed shape; review the replay suite before regenerating.`,
  );
}
if (!Array.isArray(chainQuotes.cases) || chainQuotes.cases.length === 0) {
  throw new Error('chain-quote-agreement.json must carry a non-empty `cases` array');
}

// Stable key order and a trailing newline keep regeneration diff-free.
const serialize = (value) => `${JSON.stringify(value, null, 2)}\n`;

/** What the checked-in fixtures must contain, derived from the sources above. */
const OUTPUTS = [
  ['vectors.slim.json', serialize(slim), 'reference-model/fixtures/vectors.json'],
  [
    'genesis-keys.json',
    serialize([...genesisKeys].sort()),
    'tools/limit-coverage/genesis-keys.json',
  ],
  [
    'chain-quotes.json',
    serialize(chainQuotes),
    'crates/market-core/fixtures/chain-quote-agreement.json',
  ],
];

const counts = FAMILIES.map((f) => {
  const v = slim[f];
  const n = Array.isArray(v) ? v.length : Object.keys(v).length;
  return `${f}=${n}`;
}).join(' ');

const summary =
  `${FAMILIES.length} families (${counts}), ` +
  `${genesisKeys.length} genesis keys, ` +
  `${chainQuotes.cases.length} chain quote books`;

if (process.argv.includes('--check')) {
  const stale = [];
  for (const [name, want, source] of OUTPUTS) {
    const path = resolve(outDir, name);
    if (!existsSync(path) || readFileSync(path, 'utf8') !== want) {
      stale.push(`${name} no longer matches ${source}`);
    }
  }
  if (stale.length > 0) {
    process.stderr.write(
      'Checked-in fixtures are stale, so the suites that replay them are ' +
        'certifying against an artifact this repository no longer holds.\n' +
        'Run `npm run fixtures`, then re-read the diff before committing it: a ' +
        'moved source is a protocol change, not a formatting one.\n  ' +
        `${stale.join('\n  ')}\n`,
    );
    process.exit(1);
  }
  process.stdout.write(`fixtures are current: ${summary}\n`);
} else {
  mkdirSync(outDir, { recursive: true });
  for (const [name, body] of OUTPUTS) writeFileSync(resolve(outDir, name), body);
  process.stdout.write(`fixtures: ${summary}\n`);
}
