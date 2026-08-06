/**
 * Generate `app/schemas/` — the published JSON Schema for the three handoff formats.
 *
 * `--write` regenerates; the default checks the committed files byte-for-byte, the same
 * discipline `surface:generate`/`surface:check` and `descriptors:check` follow.
 *
 * ## Why these are generated and not written
 *
 * A published schema is a promise to a tool author about what this client accepts. The one
 * way to keep it is for the promise to be *derived from the code that decides*, so the two
 * cannot drift — and the specific drift that matters here is not a missing field.
 *
 * **JSON Schema's `additionalProperties` defaults to `true`.** A hand-written schema that
 * simply omits it on `action` publishes the exact opposite of 10 §13.2's asymmetry: it
 * tells every tool that an extra key inside `action` is acceptable, which is *"precisely
 * where an encoded call would be placed"*. Absence reads as permission, silently, in a file
 * whose whole audience is people writing producers. So the closed cores come from the
 * parser's own `CORE_CONTAINERS` / `*_KEY_NAMES`, the patterns from the `RegExp.source` the
 * parser tests with, and the bounds from the same computed constants 10 §13.2 requires.
 *
 * ## What the schema deliberately cannot express
 *
 * A schema validates a *file*. It cannot express an admission check that reads chain state
 * or recomputes anything: the digest must match the document's own bytes, the binding must
 * equal the live chain's, `deadlineBlock` is compared against `B′`, and every limit is
 * narrowed against a freshly computed value. Those are 11 §11.14.1's distinction — file
 * properties versus preconditions — and a schema that pretended to cover them would be
 * telling a tool author their document is *accepted* when it is merely *well-formed*.
 *
 * That is stated in the generated `description` of every such field rather than left for a
 * reader to discover, because a producer that believes a green validation means admission
 * will ship documents that fail at the user.
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = dirname(HERE);
const OUT_DIR = join(APP, 'schemas');

/**
 * The packages are imported from their **built** output by relative path.
 *
 * Not by package name: `app/`'s root has an isolated `node_modules` that declares only the
 * build toolchain, and adding four workspace packages to it so a generator could name them
 * would put the whole handoff subsystem into the root manifest — where `depcruise` and the
 * §10.2 project graph would then have to reason about a dependency nothing ships.
 *
 * The cost is that `pnpm run build` must have run, which CI does immediately before the
 * test chain. A missing `dist/` is reported as exactly that rather than as a mysterious
 * resolution failure.
 */
/**
 * `any` because the shape is whatever the built package exports, and that is deliberate:
 * this generator's whole claim is that the schema is derived from the **parser's own
 * declarations**, so a hand-written interface here would reintroduce exactly the second
 * copy the generator exists to remove. What checks the result is `assertCovers` below,
 * bidirectionally, plus the `test:intents` differential.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadPackage(name: string): Promise<any> {
  try {
    return await import(`../packages/${name}/dist/index.js`);
  } catch (error) {
    if (isRecord(error) && error['code'] === 'ERR_MODULE_NOT_FOUND') {
      console.error(
        `cannot load @bleavit/${name} from packages/${name}/dist — run \`pnpm run build\` first.`,
      );
      process.exit(1);
    }
    throw error;
  }
}

const {
  INTENT_SCHEMA,
  INTENT_ACTIONS,
  INTENT_PATTERNS,
  CORE_CONTAINERS,
  BINDING_KEY_NAMES,
  ACTION_KEY_NAMES,
  LIMIT_KEY_NAMES,
  MAX_DOCUMENT_BYTES,
  MAX_DEPTH,
  DIGEST_HEX_CHARS,
  PPM,
} = await loadPackage('intents');
const { CONTEXT_SCHEMA } = await loadPackage('contexts');
const { RECEIPT_SCHEMA } = await loadPackage('receipts');

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

/** The `$id` a producer resolves. In-bundle and offline — nothing here is fetched. */
const ID_BASE = 'https://bleavit.org/schemas';

const DIALECT = 'https://json-schema.org/draft/2020-12/schema';

/** A decimal-string amount. Bases past 2^53 never travel as JSON numbers (V-74). */
/** A JSON Schema fragment. Structural, because these are assembled and then serialised. */
type SchemaFragment = Record<string, unknown>;

const decimalString = (bits: number, description: string): SchemaFragment => ({
  type: 'string',
  pattern: INTENT_PATTERNS.canonicalDecimal,
  description: `${description} A canonical decimal string for a u${bits} — no sign, no leading zeros, no exponent. It is a string because base units run past 2^53 and JSON.parse corrupts a larger number silently.`,
});

const u32 = (description: string): SchemaFragment => ({
  type: 'integer',
  minimum: 0,
  maximum: 2 ** 32 - 1,
  description,
});

const binding = {
  type: 'object',
  description:
    'The chain binding (10 §13.1). Gated on the live chain by exact equality — a schema cannot check that, so a valid binding here is not an admitted one.',
  properties: {
    genesisHash: {
      type: 'string',
      pattern: INTENT_PATTERNS.genesisHash,
      description: 'Genesis hash of the chain this document was prepared against.',
    },
    specVersion: u32('The runtime spec_version. A NEWER one than the client is refused; an older one is rebuilt.'),
    contractVersion: u32('INTEGRATION_CONTRACT_VERSION, as the producing client reported it.'),
  },
  required: [...BINDING_KEY_NAMES],
  additionalProperties: false,
};

/**
 * The two action variants, as a `oneOf` rather than an optional-fields object.
 *
 * The mutual exclusion is the point: a prepare is sized in **collateral** and a close in a
 * **fraction** (11 §11.14.2), and each refuses the other's field. An object with both
 * optional would validate a document carrying neither and one carrying both, so the shape
 * that permits it is the shape that publishes the wrong rule.
 */
const prepareKinds = INTENT_ACTIONS.filter((kind: string) => kind.startsWith('prepare_'));
const closeKinds = INTENT_ACTIONS.filter((kind: string) => !kind.startsWith('prepare_'));

const actionId = {
  type: 'string',
  pattern: INTENT_PATTERNS.canonicalDecimal,
  description:
    "The target's u64 chain id, as a decimal string. The client re-reads what it resolves to and renders that beside it (11 §11.14.4) — id substitution is the sharpest attack this format admits.",
};

/**
 * The document's two variants: an action and the limit that matches its direction.
 *
 * The `oneOf` sits at the **document** level rather than around `action` alone, because the
 * required limit is a function of `action.kind` and a schema that split only the action
 * could not say so. The parser's rule, which this now publishes:
 *
 *   - a prepare buys, so it MUST state `maxCost` and must not state `minProceeds`;
 *   - a close sells, so it MUST state `minProceeds` and must not state `maxCost`;
 *   - `deadlineBlock` is optional on both.
 *
 * An earlier version of this generator published `limits` with everything optional and
 * `required: []`. That is materially more permissive than the parser, and the differential
 * suite caught it on the empty-limits case: a producer following the published schema would
 * emit `"limits": {}`, validate cleanly, and be refused at the user with no way to have
 * known. The wrong direction is worse still — a proceeds floor on a purchase sits on the
 * confirm screen looking like protection while binding nothing.
 *
 * "There is no safe default for money" (10 §13.2) is the reason the limit is required at
 * all, and it is a property of the file, so the schema is obliged to carry it.
 */
const prepareAction = {
  type: 'object',
  properties: {
    kind: { enum: [...prepareKinds] },
    id: actionId,
    collateral: decimalString(128, 'How much collateral to spend, in base units.'),
  },
  required: ['kind', 'id', 'collateral'],
  additionalProperties: false,
};

const closeAction = {
  type: 'object',
  properties: {
    kind: { enum: [...closeKinds] },
    id: actionId,
    fractionPpm: {
      type: 'integer',
      minimum: 1,
      maximum: PPM,
      description:
        'What fraction of the held position to close, in parts per million. A fraction rather than an amount because an absolute amount from a stale document can exceed the current holding or leave unredeemable dust (11 §11.14.2).',
    },
  },
  required: ['kind', 'id', 'fractionPpm'],
  additionalProperties: false,
};

const deadlineBlock = u32(
  "A block height after which the request is stale. Compared against B\u2032, the CHAIN clock, never a device clock \u2014 so a schema cannot tell you whether it has passed.",
);

const prepareLimits = {
  type: 'object',
  description:
    'A prepare buys, so it states a cost ceiling and never a proceeds floor. The client narrows it against its own recomputed cost and never widens it (11 §11.14.3).',
  properties: {
    maxCost: decimalString(128, 'The most the producer wants spent, in collateral base units.'),
    deadlineBlock,
  },
  required: ['maxCost'],
  additionalProperties: false,
};

const closeLimits = {
  type: 'object',
  description:
    'A close sells, so it states a proceeds floor and never a cost ceiling. The client raises it and never lowers it (11 §11.14.3).',
  properties: {
    minProceeds: decimalString(128, 'The least the producer wants received, in base units.'),
    deadlineBlock,
  },
  required: ['minProceeds'],
  additionalProperties: false,
};

const variants = [
  {
    title: 'prepare a position',
    properties: { action: prepareAction, limits: prepareLimits },
    required: ['action', 'limits'],
  },
  {
    title: 'close a fraction of a position',
    properties: { action: closeAction, limits: closeLimits },
    required: ['action', 'limits'],
  },
];

const intentSchema = {
  $schema: DIALECT,
  $id: `${ID_BASE}/${INTENT_SCHEMA}.schema.json`,
  title: INTENT_SCHEMA,
  description: [
    'A proposed action handed to Bleavit by an external tool (10 §13.2; D-21).',
    '',
    'Validating against this schema means the document is WELL FORMED. It does not mean it will be admitted: the digest must match the document, the binding must equal the live chain, the deadline is compared against the chain clock, and every limit is re-derived at a fresh block. Those are chain reads, and no schema performs one (11 §11.14.1).',
    '',
    'The document carries no encoded call, no bytes-typed field, and no free text — by design, in both directions (10 §13).',
  ].join('\n'),
  type: 'object',
  properties: {
    schema: { const: INTENT_SCHEMA, description: 'Validated by exact equality.' },
    binding,
    digest: {
      type: 'string',
      pattern: INTENT_PATTERNS.digest,
      description: `SHA-256 over the document's core projection under a NUL-terminated domain tag, as ${DIGEST_HEX_CHARS} lowercase hex characters. An integrity check against truncation and transcription damage — it AUTHENTICATES NOTHING (10 §13.1).`,
    },
  },
  required: ['schema', 'binding', 'action', 'limits', 'digest'],
  // The top level tolerates producer annotations; the cores above do not. That asymmetry
  // is 10 §13.2's, and it is the single most important thing this file publishes.
  additionalProperties: true,
  oneOf: variants,
  $comment: [
    `Parser bounds, computed from 02-frozen type widths (10 §13.2): at most ${MAX_DOCUMENT_BYTES} bytes of UTF-8, nesting at most ${MAX_DEPTH} deep, and no object may repeat a key.`,
    'Closed cores: ' + CORE_CONTAINERS.join(', ') + '.',
  ].join(' '),
};

/* ------------------------------------------------------------------ outbound formats */

const anchor = (description: string): SchemaFragment => ({
  type: 'object',
  description,
  properties: {
    blockHash: { type: 'string', pattern: INTENT_PATTERNS.genesisHash },
    blockNumber: u32('The finalized block this was read at.'),
  },
  required: ['blockHash', 'blockNumber'],
  additionalProperties: false,
});

const contextSchema = {
  $schema: DIALECT,
  $id: `${ID_BASE}/${CONTEXT_SCHEMA}.schema.json`,
  title: CONTEXT_SCHEMA,
  description: [
    "A user's verified view of the chain at one finalized block, limited to what they agreed to share for this export (10 §13.1; 11 §11.14.4).",
    '',
    'Export only. Bleavit never reads one back in — the only inbound format is bleavit.intent.v1, and it carries no chain state at all.',
    '',
    'Absence is meaningful: a field missing from `scope.included` was not shared, and a field named in `scope.included` is present even when empty. An empty array means "none exist"; an absent key means "not shared".',
  ].join('\n'),
  type: 'object',
  properties: {
    schema: { const: CONTEXT_SCHEMA },
    binding,
    anchor: anchor('The finalized block every value here was read at. Re-read it to check any of them.'),
    scope: {
      type: 'object',
      description:
        'What the user consented to share, this time. Consent is per export and never inherited (11 §11.14.4).',
      properties: {
        included: { type: 'array', items: { type: 'string' } },
        pseudonymized: {
          type: 'boolean',
          description:
            'When true the address is withheld. It does NOT hide the holdings, which remain a fingerprint — what pseudonymization removes is linkage, not content.',
        },
      },
      required: ['included', 'pseudonymized'],
      additionalProperties: false,
    },
    positions: {
      type: 'object',
      description:
        'Holdings, keyed by ledger domain. There is no combined field, deliberately: solvency holds per instance against its own sovereign account, so a merged total would assert one backing pool where there are two (11 §11.2a rule 2).',
      properties: {
        primary: { type: 'array' },
        service: { type: 'array' },
      },
      required: ['primary', 'service'],
      additionalProperties: false,
    },
  },
  required: ['schema', 'binding', 'anchor', 'scope'],
  additionalProperties: true,
};

const receiptSchema = {
  $schema: DIALECT,
  $id: `${ID_BASE}/${RECEIPT_SCHEMA}.schema.json`,
  title: RECEIPT_SCHEMA,
  description: [
    'What the chain recorded about one finalized extrinsic (10 §13.1).',
    '',
    'Export only, and deliberately NOT a copy of the transaction that produced it. There is no encoded call, no signature and no payload here — a receipt carrying call bytes teaches a tool to offer them back, and they would not have been rebuilt against current state (10 §13, third rule).',
    '',
    'What makes a receipt checkable is the anchor: re-read the chain at that block and that extrinsic index.',
  ].join('\n'),
  type: 'object',
  properties: {
    schema: { const: RECEIPT_SCHEMA },
    binding,
    anchor: {
      type: 'object',
      properties: {
        blockHash: { type: 'string', pattern: INTENT_PATTERNS.genesisHash },
        blockNumber: u32('The finalized block containing the extrinsic.'),
        extrinsicIndex: u32('Its index within that block, so a reader can find the exact one.'),
      },
      required: ['blockHash', 'blockNumber', 'extrinsicIndex'],
      additionalProperties: false,
    },
    outcome: {
      type: 'object',
      properties: {
        call: { type: 'string', description: 'Pallet.Call, as a NAME. Never an index and never bytes — a name cannot be resubmitted.' },
        success: { type: 'boolean', description: 'A failed dispatch is still a finalized fact.' },
        error: { type: 'string', description: 'Pallet.ErrorName from the frozen 02 §6 set, when it failed.' },
      },
      required: ['call', 'success'],
      additionalProperties: false,
    },
  },
  required: ['schema', 'binding', 'anchor', 'outcome'],
  additionalProperties: true,
};

/* ------------------------------------------------------------------------ emit/check */

/**
 * The vocabulary is the parser's; the per-variant split is the schema's.
 *
 * `action`'s two variants cannot be derived from `ACTION_KEY_NAMES` alone — which field
 * belongs to a prepare and which to a close is knowledge this file adds. So the split is
 * written here and the **coverage** is checked against the parser: a field added to
 * `IntentAction` or `IntentLimits` without a home in the schema fails the generator rather
 * than being published as forbidden.
 *
 * That is the direction that matters. A schema silently missing a field tells every tool
 * author the field is not allowed, and the client accepts it — so the format grows a member
 * nobody outside this repository can discover.
 */
function assertCovers(label: string, declared: readonly string[], published: readonly string[]): void {
  const missing = declared.filter((key) => !published.includes(key));
  const extra = published.filter((key) => !declared.includes(key));
  if (missing.length > 0 || extra.length > 0) {
    console.error(
      `${label}: the schema and the parser disagree about the field set.` +
        (missing.length > 0 ? `\n  declared by the parser, absent from the schema: ${missing.join(', ')}` : '') +
        (extra.length > 0 ? `\n  published by the schema, unknown to the parser: ${extra.join(', ')}` : ''),
    );
    process.exit(1);
  }
}

/**
 * Every field name the schema publishes inside `action` or `limits`, across all variants.
 *
 * Read through `properties` rather than off a declared type, because that is the artefact
 * being checked: the assertion below is that the *published* set equals the parser's, and a
 * type standing between the two would let them agree with each other and not with the file.
 */
const publishedIn = (container: 'action' | 'limits'): string[] => [
  ...new Set(
    variants.flatMap((variant: SchemaFragment) => {
      const properties = variant['properties'] as Record<string, SchemaFragment>;
      const section = properties[container];
      return Object.keys((section?.['properties'] ?? {}) as SchemaFragment);
    }),
  ),
];
assertCovers('action', [...ACTION_KEY_NAMES], publishedIn('action'));
assertCovers('limits', [...LIMIT_KEY_NAMES], publishedIn('limits'));
assertCovers('binding', [...BINDING_KEY_NAMES], Object.keys(binding.properties));

const FILES: readonly (readonly [string, SchemaFragment])[] = [
  [`${INTENT_SCHEMA}.schema.json`, intentSchema],
  [`${CONTEXT_SCHEMA}.schema.json`, contextSchema],
  [`${RECEIPT_SCHEMA}.schema.json`, receiptSchema],
];

/** Two-space JSON with a trailing newline — stable across runs and readable in a diff. */
const render = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

const write = process.argv.includes('--write');
mkdirSync(OUT_DIR, { recursive: true });

let failed = 0;
for (const [name, schema] of FILES) {
  const path = join(OUT_DIR, name);
  const expected = render(schema);
  if (write) {
    writeFileSync(path, expected);
    console.log(`wrote ${name} (${createHash('sha256').update(expected).digest('hex').slice(0, 12)})`);
    continue;
  }
  let actual: string;
  try {
    actual = readFileSync(path, 'utf8');
  } catch {
    console.error(`MISSING ${name} — run \`pnpm run schemas:generate\``);
    failed += 1;
    continue;
  }
  if (actual !== expected) {
    console.error(
      `DRIFT ${name} — the committed schema does not match what the parser declares.\n` +
        '      Regenerate with `pnpm run schemas:generate`. Never edit the schema to match a\n' +
        '      producer; the parser is what decides, and the schema is what it promises.',
    );
    failed += 1;
    continue;
  }
  console.log(`OK ${name}`);
}

if (!write) {
  // An extra file in the directory is drift too, and it is the direction a per-file loop
  // cannot see — a schema for a format that no longer exists reads as current to anyone
  // who opens it.
  const expectedNames = new Set([...FILES.map(([name]) => name), 'README.md']);
  for (const found of readdirSync(OUT_DIR)) {
    if (!expectedNames.has(found)) {
      console.error(`UNEXPECTED ${found} — schemas/ holds exactly the three published formats.`);
      failed += 1;
    }
  }
}

if (failed > 0) process.exit(1);
if (!write) console.log(`\n${FILES.length} published schemas match the parser's own declarations.`);
