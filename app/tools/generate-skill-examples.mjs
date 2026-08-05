/**
 * Generate and verify `app/skills/bleavit-analysis/examples/` — the published corpus.
 *
 * `--write` regenerates; the default runs every committed example through the **real
 * parser** and asserts the outcome its filename claims.
 *
 * ## Why this is a gate and not documentation
 *
 * The examples exist so a producer author can test against something. A published example
 * that no longer does what it says is worse than no example at all: someone debugging a
 * refusal against a stale corpus concludes the client is wrong, and the most natural next
 * move — loosen the document until it passes — is the exact behaviour `reference/safety.md`
 * rule 7 tells them not to have.
 *
 * So the label is in the **filename**, and the filename is checked against `admitIntent`:
 *
 *     admitted--<slug>.json
 *     refused-FE-HANDOFF-0NN--<slug>.json
 *
 * A separate manifest would be a second place for the truth to live. The filename cannot
 * drift from itself.
 *
 * ## Why they are generated
 *
 * Every valid document carries a SHA-256 over its own core under a NUL-terminated tag.
 * Hand-writing one means hand-computing a digest, which nobody does twice — so the corpus
 * would ossify at whatever the format was on the day it was written. Generating from a
 * table of mutations means the whole corpus moves with the parser, and the *tamper* case
 * stays honest: it is the one document whose digest is deliberately not recomputed.
 *
 * ## What the corpus can and cannot cover, stated rather than skipped
 *
 * The family is `FE-HANDOFF-001..013`. An **inbound document corpus** can only demonstrate
 * the codes an inbound document can cause, and that is a strict subset:
 *
 *  - `001..008` and `010` come from admission — a property of the file. Covered here.
 *  - `011` comes from the *clamp*, at a refreshed block against live chain state. A file
 *    cannot cause it on its own, and `app/tests/intents` covers it where it lives.
 *  - `012` (scope refused) and `013` (export from unverified state) are **export-side**.
 *    No inbound document can produce one, so a corpus that claimed to cover them would be
 *    lying about what it demonstrates.
 *
 * The checker asserts coverage over exactly the inbound set and names the exclusions, so
 * "we cover the family" cannot quietly become "we cover the seven that were easy".
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = dirname(HERE);
const OUT_DIR = join(APP, 'skills/bleavit-analysis/examples');

async function loadPackage(name) {
  try {
    return await import(`../packages/${name}/dist/index.js`);
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') {
      console.error(`cannot load @bleavit/${name} from packages/${name}/dist — run \`pnpm run build\` first.`);
      process.exit(1);
    }
    throw error;
  }
}

const { INTENT_DOMAIN_TAG, INTENT_SCHEMA, admitIntent } = await loadPackage('intents');
const { digestPreimage } = await loadPackage('handoff-envelope');

/**
 * The context every example is judged against, published in the README beside them.
 *
 * A fixed genesis and block height rather than anything read live: these files are
 * documentation, and a corpus whose verdicts depended on the chain's current height would
 * change meaning overnight.
 */
const LIVE = {
  genesisHash: '0x91b171bb158e2d3848fa23a9f1c25182fb8e20313b2c1eb49219da7a70ce90c3',
  specVersion: 2,
  contractVersion: 27,
};
const CURRENT_BLOCK = 1_000_000;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const CONTEXT = { live: LIVE, currentBlock: CURRENT_BLOCK, digest: sha256 };

/** The codes an inbound document can cause. The rest are covered where they live. */
const INBOUND_CODES = [
  'FE-HANDOFF-001',
  'FE-HANDOFF-002',
  'FE-HANDOFF-003',
  'FE-HANDOFF-004',
  'FE-HANDOFF-005',
  'FE-HANDOFF-006',
  'FE-HANDOFF-007',
  'FE-HANDOFF-008',
  'FE-HANDOFF-010',
];

const core = (d) => ({ schema: d.schema, binding: d.binding, action: d.action, limits: d.limits });
const sign = (d) => ({ ...d, digest: sha256(digestPreimage(INTENT_DOMAIN_TAG, core(d))) });

const prepare = (over = {}) => ({
  schema: INTENT_SCHEMA,
  binding: { ...LIVE },
  action: { kind: 'prepare_pass_position', id: '7', collateral: '25000000' },
  limits: { maxCost: '26000000' },
  ...over,
});

const close = (over = {}) => ({
  schema: INTENT_SCHEMA,
  binding: { ...LIVE },
  action: { kind: 'close_position', id: '7', fractionPpm: 250_000 },
  limits: { minProceeds: '1000000' },
  ...over,
});

/**
 * The corpus. `document` is emitted as-is — signing is explicit per entry, so the tamper
 * case can sign one thing and ship another without a special case in the writer.
 */
const CORPUS = [
  // -------------------------------------------------------------- admitted
  {
    label: 'admitted',
    slug: 'prepare-pass-position',
    note: 'A 25 USDC position on the PASS side of book 7, with a 26 USDC ceiling.',
    document: sign(prepare()),
  },
  {
    label: 'admitted',
    slug: 'prepare-fail-position',
    note: 'The same on the FAIL side. Sizing is collateral in both cases.',
    document: sign(prepare({ action: { kind: 'prepare_fail_position', id: '7', collateral: '5000000' } })),
  },
  {
    label: 'admitted',
    slug: 'close-a-quarter-of-a-position',
    note: 'A close is a fraction, so it stays correct if the holding changed since export.',
    document: sign(close()),
  },
  {
    label: 'admitted',
    slug: 'with-a-deadline',
    note: 'A deadline is compared against the CHAIN clock, never a device clock.',
    document: sign(prepare({ limits: { maxCost: '26000000', deadlineBlock: CURRENT_BLOCK + 500 } })),
  },
  {
    label: 'admitted',
    slug: 'with-a-top-level-annotation',
    note: 'An unknown key at the TOP LEVEL is a producer annotation and is tolerated. Compare with foreign-key-inside-action.',
    document: sign(prepare({ producedBy: 'an external analysis tool', rationale: 'see the chat' })),
  },

  // -------------------------------------------------------------- refused
  {
    label: 'refused-FE-HANDOFF-001',
    slug: 'unknown-schema',
    note: 'The schema string is compared by exact equality. A version bump is a different format, not a compatible one.',
    document: sign({ ...prepare(), schema: 'bleavit.intent.v2' }),
  },
  {
    label: 'refused-FE-HANDOFF-002',
    slug: 'missing-a-core-object',
    note: 'Refused WHOLE. The parser never strips a field and proceeds, and never falls back to a safe subset.',
    document: (() => {
      const { limits, ...rest } = sign(prepare());
      return rest;
    })(),
  },
  {
    label: 'refused-FE-HANDOFF-003',
    slug: 'unknown-action',
    note: 'The vocabulary is closed at three actions. Transfers, votes and redemptions are deliberately not expressible.',
    document: sign(prepare({ action: { kind: 'transfer_to_address', id: '7', collateral: '1' } })),
  },
  {
    label: 'refused-FE-HANDOFF-004',
    slug: 'foreign-key-inside-action',
    note: 'THE case this format exists for. Inside `action` an unknown key is a proposed semantic — precisely where an encoded call would be placed — so it is refused, unlike the same key at the top level.',
    document: sign(prepare({ action: { kind: 'prepare_pass_position', id: '7', collateral: '25000000', callData: '0x2904060000' } })),
  },
  {
    label: 'refused-FE-HANDOFF-005',
    slug: 'wrong-chain',
    note: 'The binding is compared by exact equality, which is what stops a request prepared for one chain being replayed on another.',
    document: sign(prepare({ binding: { ...LIVE, genesisHash: `0x${'ab'.repeat(32)}` } })),
  },

  {
    label: 'refused-FE-HANDOFF-006',
    slug: 'newer-runtime-than-the-client',
    note: 'Asymmetric on purpose: a NEWER runtime is refused because the surface is unknown, while an older one is admitted and rebuilt. An intent never selects an encoding.',
    document: sign(prepare({ binding: { ...LIVE, specVersion: LIVE.specVersion + 1 } })),
  },
  {
    label: 'refused-FE-HANDOFF-007',
    slug: 'no-cost-ceiling',
    note: 'There is no safe default for money. A prepare must state maxCost; the client will not supply one.',
    document: sign(prepare({ limits: {} })),
  },
  {
    label: 'refused-FE-HANDOFF-007',
    slug: 'limit-in-the-wrong-direction',
    note: 'A prepare buys, so a proceeds floor binds nothing. Worse than omitting it: on the confirm screen it looks like protection.',
    document: sign(prepare({ limits: { minProceeds: '1000000' } })),
  },
  {
    label: 'refused-FE-HANDOFF-007',
    slug: 'amount-as-a-json-number',
    note: 'Base units run past what a JSON number holds exactly. As a number this is corrupted silently; as a string it is not.',
    document: sign(prepare({ action: { kind: 'prepare_pass_position', id: '7', collateral: 25000000 } })),
  },
  {
    label: 'refused-FE-HANDOFF-008',
    slug: 'expired',
    note: 'Compared against the chain height in the context below, never a device clock.',
    document: sign(prepare({ limits: { maxCost: '26000000', deadlineBlock: CURRENT_BLOCK - 1 } })),
  },
  {
    label: 'refused-FE-HANDOFF-010',
    slug: 'altered-after-signing',
    note: 'The collateral was changed after the digest was computed. This is what a truncated or edited file looks like, and the digest is the only thing that sees it.',
    document: (() => {
      const signed = sign(prepare());
      return { ...signed, action: { ...signed.action, collateral: '999000000' } };
    })(),
  },
];

/* ------------------------------------------------------------------------ emit/check */

const fileName = (entry) => `${entry.label}--${entry.slug}.json`;
const render = (entry) => `${JSON.stringify(entry.document, null, 2)}\n`;

const expectedOutcome = (label) =>
  label === 'admitted' ? { ok: true } : { ok: false, code: label.replace(/^refused-/, '') };

const write = process.argv.includes('--write');
let failed = 0;

if (write) {
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });
}

const seen = new Set();
for (const entry of CORPUS) {
  const name = fileName(entry);
  if (seen.has(name)) {
    console.error(`DUPLICATE ${name} — two entries would overwrite each other`);
    failed += 1;
    continue;
  }
  seen.add(name);

  const path = join(OUT_DIR, name);
  const text = render(entry);
  if (write) {
    writeFileSync(path, text);
    continue;
  }

  let committed;
  try {
    committed = readFileSync(path, 'utf8');
  } catch {
    console.error(`MISSING ${name} — run \`pnpm run skills:generate\``);
    failed += 1;
    continue;
  }
  if (committed !== text) {
    console.error(`DRIFT ${name} — the committed example is not what the generator emits.`);
    failed += 1;
    continue;
  }

  // The claim in the filename, checked against the parser that will actually judge it.
  const expected = expectedOutcome(entry.label);
  // eslint-disable-next-line no-await-in-loop
  const result = await admitIntent(committed, CONTEXT);
  if (result.ok !== expected.ok) {
    console.error(
      `WRONG ${name} — the filename claims ${expected.ok ? 'admitted' : expected.code} and the ` +
        `parser ${result.ok ? 'admitted it' : `refused with ${result.refusal.code}`}.`,
    );
    failed += 1;
    continue;
  }
  if (!expected.ok && result.refusal.code !== expected.code) {
    console.error(
      `WRONG ${name} — the filename claims ${expected.code}, the parser returned ` +
        `${result.refusal.code}. A published example must name the code it actually produces.`,
    );
    failed += 1;
    continue;
  }
  console.log(`OK ${name}`);
}

if (write) {
  console.log(`wrote ${CORPUS.length} examples to skills/bleavit-analysis/examples/`);
  process.exit(0);
}

// An extra file is drift the per-entry loop cannot see: a stale example reads as current
// to anyone who opens the directory.
for (const found of readdirSync(OUT_DIR)) {
  if (!seen.has(found) && found !== 'README.md') {
    console.error(`UNEXPECTED ${found} — the corpus is exactly what the generator emits.`);
    failed += 1;
  }
}

// Coverage over the codes an inbound document CAN cause. Not over the whole family: 011
// needs live chain state, and 012/013 are export-side, so a corpus claiming them would be
// describing something it does not contain.
const covered = new Set(
  CORPUS.filter((e) => e.label !== 'admitted').map((e) => e.label.replace(/^refused-/, '')),
);
const uncovered = INBOUND_CODES.filter((code) => !covered.has(code));
if (uncovered.length > 0) {
  console.error(`UNCOVERED inbound refusal classes: ${uncovered.join(', ')}`);
  failed += 1;
}
const stray = [...covered].filter((code) => !INBOUND_CODES.includes(code));
if (stray.length > 0) {
  console.error(
    `${stray.join(', ')} is claimed by the corpus but is not an inbound-document class — ` +
      'either the class list is wrong or the example is demonstrating something else.',
  );
  failed += 1;
}

if (failed > 0) process.exit(1);
console.log(
  `\n${CORPUS.length} examples verified against the parser; all ${INBOUND_CODES.length} ` +
    'inbound refusal classes covered (011 needs live state; 012/013 are export-side).',
);
