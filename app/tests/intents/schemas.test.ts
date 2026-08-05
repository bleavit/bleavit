/**
 * `app/schemas/` — the published JSON Schema, differentialled against the parser.
 *
 * `schemas:check` proves the committed files match what the generator emits. That is a
 * determinism check, not a correctness one: it would stay green for a generator that
 * published a schema describing nothing. What makes the schema *true* is this suite, which
 * runs one corpus of documents through both the parser and the schema and asserts they
 * agree where they must.
 *
 * ## The direction that matters
 *
 * **Anything the parser admits must validate.** A schema stricter than the parser tells a
 * tool author their perfectly good request is invalid, and they will change it — usually by
 * removing the field the schema forgot, which is the format quietly shrinking to whatever
 * was published.
 *
 * The other direction is deliberately *not* asserted as equality, because it cannot be: a
 * schema validates a file and the parser reads chain state. A document with a stale
 * `deadlineBlock`, a wrong digest or a foreign chain's binding is well-formed and refused.
 * That gap is 11 §11.14.1's admission-versus-precondition line, and pretending to close it
 * would be the lie — so the suite asserts the gap is exactly where it should be, by
 * refusing each of those for a reason the schema could not have expressed.
 *
 * ## The one place the schema must be as strict as the parser
 *
 * 10 §13.2's asymmetry. A foreign key inside `action`, `limits` or `binding` is the attack,
 * and if the schema permits it a tool author has no way to learn otherwise until a user
 * sees `FE-HANDOFF-004`. So that case is asserted as agreement in **both** directions.
 *
 * ## Why the validator is written here
 *
 * It implements exactly the keywords these schemas use and **throws on any keyword it does
 * not know**. That is the property that keeps it honest: a hand-rolled validator that
 * silently ignores an unimplemented keyword is the vacuous-green failure this repository
 * keeps finding, and it would be invisible — every test would pass, having checked less
 * than it claimed. The unknown-keyword refusal is asserted below, and so is a negative
 * control per keyword.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { digestPreimage } from '@bleavit/handoff-envelope';
import { INTENT_DOMAIN_TAG, INTENT_SCHEMA, admitIntent } from '@bleavit/intents';

const SCHEMA_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../schemas');
const intentSchema = JSON.parse(
  readFileSync(join(SCHEMA_DIR, `${INTENT_SCHEMA}.schema.json`), 'utf8'),
);

/* ------------------------------------------------------------------ the validator */

/** Every keyword this validator implements. Anything else is a hard error. */
const KNOWN = new Set([
  '$schema',
  '$id',
  '$comment',
  'title',
  'description',
  'type',
  'properties',
  'required',
  'additionalProperties',
  'enum',
  'const',
  'pattern',
  'minimum',
  'maximum',
  'items',
  'oneOf',
]);

class UnknownKeyword extends Error {}

/**
 * Validate `value` against `schema`, returning a list of failure paths.
 *
 * Deliberately not a general JSON Schema implementation. It covers this repository's own
 * schemas and refuses to guess at anything else — a validator that skips what it does not
 * understand reports success having checked a subset it never names.
 */
function validate(value, schema, path = '$') {
  for (const keyword of Object.keys(schema)) {
    if (!KNOWN.has(keyword)) {
      throw new UnknownKeyword(
        `${path}: schema keyword "${keyword}" is not implemented by this validator. ` +
          'Implement it or stop using it — silently ignoring it would make every ' +
          'assertion below weaker than it reads.',
      );
    }
  }

  const errors = [];
  const fail = (why) => errors.push(`${path}: ${why}`);

  if (schema.const !== undefined && value !== schema.const) fail(`expected const ${schema.const}`);
  if (schema.enum !== undefined && !schema.enum.includes(value)) fail('not in enum');

  if (schema.type !== undefined) {
    const actual = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
    const ok =
      schema.type === 'integer'
        ? typeof value === 'number' && Number.isInteger(value)
        : actual === schema.type;
    if (!ok) {
      fail(`expected type ${schema.type}, got ${actual}`);
      return errors; // Further keywords would report noise about the wrong shape.
    }
  }

  if (typeof value === 'string' && schema.pattern !== undefined) {
    if (!new RegExp(schema.pattern).test(value)) fail(`does not match ${schema.pattern}`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) fail(`< minimum ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) fail(`> maximum ${schema.maximum}`);
  }

  if (Array.isArray(value) && schema.items !== undefined) {
    value.forEach((item, i) => errors.push(...validate(item, schema.items, `${path}[${i}]`)));
  }

  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(value, key)) fail(`missing required "${key}"`);
    }
    for (const [key, member] of Object.entries(value)) {
      const sub = schema.properties?.[key];
      if (sub !== undefined) {
        errors.push(...validate(member, sub, `${path}.${key}`));
      } else if (schema.additionalProperties === false) {
        fail(`unexpected property "${key}"`);
      }
    }
  }

  if (schema.oneOf !== undefined) {
    const matches = schema.oneOf.filter((option) => validate(value, option, path).length === 0);
    if (matches.length !== 1) fail(`matched ${matches.length} of ${schema.oneOf.length} oneOf`);
  }

  return errors;
}

const valid = (document) => validate(document, intentSchema).length === 0;

/* --------------------------------------------------------------------- the corpus */

const LIVE = {
  genesisHash: '0x91b171bb158e2d3848fa23a9f1c25182fb8e20313b2c1eb49219da7a70ce90c3',
  specVersion: 2,
  contractVersion: 24,
};
const NOW = 1_000;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const ctx = { live: LIVE, currentBlock: NOW, digest: sha256 };

const core = (d) => ({ schema: d.schema, binding: d.binding, action: d.action, limits: d.limits });
const sign = (d) => ({ ...d, digest: sha256(digestPreimage(INTENT_DOMAIN_TAG, core(d))) });

const body = (over = {}) => ({
  schema: INTENT_SCHEMA,
  binding: { ...LIVE },
  action: { kind: 'prepare_pass_position', id: '7', collateral: '1000000' },
  limits: { maxCost: '1100000' },
  ...over,
});

/** Documents the parser must ADMIT. Each must therefore validate. */
const ADMITTED = [
  ['a prepare with a cost ceiling', body()],
  ['a fail-side prepare', body({ action: { kind: 'prepare_fail_position', id: '9', collateral: '5' } })],
  [
    'a close expressed as a fraction',
    body({ action: { kind: 'close_position', id: '3', fractionPpm: 250_000 }, limits: { minProceeds: '1' } }),
  ],
  ['a prepare with a deadline as well as its ceiling', body({ limits: { maxCost: '2', deadlineBlock: NOW + 10 } })],
  [
    'a close with a floor and a deadline',
    body({
      action: { kind: 'close_position', id: '3', fractionPpm: 1 },
      limits: { minProceeds: '1', deadlineBlock: NOW + 10 },
    }),
  ],
  [
    'a u128 amount past 2^53, as a decimal string',
    body({ action: { kind: 'prepare_pass_position', id: '7', collateral: '340282366920938463463374607431768211455' } }),
  ],
  ['a top-level producer annotation', body({ note: 'the tool wrote this and nothing reads it' })],
];

/** Documents that are WELL FORMED and still refused — the admission/precondition gap. */
const WELL_FORMED_BUT_REFUSED = [
  ['a stale deadline', body({ limits: { maxCost: '2', deadlineBlock: NOW - 1 } })],
  ['a foreign chain', body({ binding: { ...LIVE, genesisHash: `0x${'ab'.repeat(32)}` } })],
  ['a newer runtime', body({ binding: { ...LIVE, specVersion: LIVE.specVersion + 1 } })],
];

/* ------------------------------------------------------------------------- tests */

test('every document the parser admits validates against the published schema', async () => {
  for (const [label, document] of ADMITTED) {
    const signed = sign(document);
    const result = await admitIntent(JSON.stringify(signed), ctx);
    assert.equal(result.ok, true, `${label}: the parser refused it — fix the corpus, not the schema`);
    assert.deepEqual(
      validate(signed, intentSchema),
      [],
      `${label}: admitted by the parser and REJECTED by the published schema. A tool author ` +
        'following the schema would remove a field the client accepts.',
    );
  }
});

test('the required monetary limit and its direction are PUBLISHED, not just enforced', async () => {
  // The differential found this: the first schema published both limits as optional with
  // `required: []`, which is materially more permissive than the parser. A producer
  // following it emits `"limits": {}`, validates cleanly, and is refused at the user with
  // no way to have known — and the wrong direction is worse, because a proceeds floor on a
  // purchase sits on the confirm screen looking like protection while binding nothing.
  const cases = [
    ['a prepare with no limits', body({ limits: {} })],
    ['a close with no limits', body({ action: { kind: 'close_position', id: '3', fractionPpm: 1 }, limits: {} })],
    ['a prepare carrying a proceeds floor', body({ limits: { minProceeds: '1' } })],
    [
      'a close carrying a cost ceiling',
      body({ action: { kind: 'close_position', id: '3', fractionPpm: 1 }, limits: { maxCost: '1' } }),
    ],
    ['a prepare carrying both', body({ limits: { maxCost: '2', minProceeds: '1' } })],
  ];
  for (const [label, document] of cases) {
    const signed = sign(document);
    const result = await admitIntent(JSON.stringify(signed), ctx);
    assert.equal(result.ok, false, `${label}: the parser admitted it`);
    assert.equal(result.refusal.code, 'FE-HANDOFF-007');
    assert.equal(valid(signed), false, `${label}: the schema PERMITS what the parser refuses`);
  }
});

test('a foreign key inside a closed core is refused by BOTH — the published asymmetry', async () => {
  for (const container of ['action', 'limits', 'binding']) {
    const document = body();
    const hostile = sign({ ...document, [container]: { ...document[container], callData: '0xdead' } });
    const result = await admitIntent(JSON.stringify(hostile), ctx);
    assert.equal(result.ok, false, `${container}: the parser admitted a foreign key`);
    assert.equal(result.refusal.code, 'FE-HANDOFF-004');
    assert.equal(
      valid(hostile),
      false,
      `${container}: the schema PERMITS a foreign key. additionalProperties defaults to true, ` +
        'so this is what an omission looks like — and it teaches every producer the opposite ' +
        'of 10 §13.2.',
    );
  }
});

test('a top-level extra is tolerated by both — the other half of the asymmetry', async () => {
  // Asserted beside the case above, on the same document shape, so neither can pass for
  // the wrong reason: a schema that closed everything would fail here, one that closed
  // nothing would fail there.
  const document = sign(body({ producedBy: 'some tool', producedAt: 'whenever' }));
  const result = await admitIntent(JSON.stringify(document), ctx);
  assert.equal(result.ok, true);
  assert.equal(valid(document), true);
});

test('the schema cannot express a precondition, and does not pretend to', async () => {
  for (const [label, document] of WELL_FORMED_BUT_REFUSED) {
    const signed = sign(document);
    assert.equal(valid(signed), true, `${label}: should be well formed`);
    const result = await admitIntent(JSON.stringify(signed), ctx);
    assert.equal(result.ok, false, `${label}: the parser should still refuse it`);
  }
});

test('a tampered document validates and is still refused — the digest is not a shape', async () => {
  const signed = sign(body());
  const tampered = { ...signed, action: { ...signed.action, collateral: '999999999' } };
  assert.equal(valid(tampered), true, 'a tampered document is still well formed');
  const result = await admitIntent(JSON.stringify(tampered), ctx);
  assert.equal(result.ok, false);
  assert.equal(result.refusal.code, 'FE-HANDOFF-010');
});

/* --------------------------------------- the schema's own claims, checked directly */

test('an action carrying the other variant\'s size field fails the oneOf', () => {
  // A close sized in collateral, and a prepare sized as a fraction. Both are the shape an
  // optional-fields object would have validated, which is why the schema uses `oneOf`.
  const closeLimits = { minProceeds: '1' };
  assert.equal(
    valid(sign(body({ action: { kind: 'close_position', id: '3', collateral: '5' }, limits: closeLimits }))),
    false,
  );
  assert.equal(
    valid(sign(body({ action: { kind: 'prepare_pass_position', id: '3', fractionPpm: 1 } }))),
    false,
  );
  // And carrying both, which is the case an object with two optional fields admits happily.
  assert.equal(
    valid(
      sign(
        body({
          action: { kind: 'close_position', id: '3', fractionPpm: 1, collateral: '5' },
          limits: closeLimits,
        }),
      ),
    ),
    false,
  );
});

test('an amount sent as a JSON number rather than a decimal string is rejected', () => {
  // The V-74 trap in its published form: a producer that emits `1000000` unquoted has
  // written a value that survives only while it is small.
  assert.equal(valid(sign(body({ action: { kind: 'prepare_pass_position', id: '7', collateral: 1000000 } }))), false);
});

test('a non-canonical decimal STRING is rejected by both — the pattern, not just the type', async () => {
  // Mutation testing found this hole: dropping the `pattern` from `collateral` while
  // leaving `type: 'string'` passed every test in this file, because the only amount case
  // asserted a JSON *number*, which fails on type alone. The pattern governs something
  // else entirely — leading zeros, signs, exponents, whitespace — and none of it was
  // covered.
  //
  // It matters because these are the spellings that survive a round trip through a
  // spreadsheet or a language whose formatter emits `1e+21`, and a producer would have no
  // way to learn the client refuses them.
  for (const collateral of ['0100', '-5', '+3', '1e6', '1.0', ' 7', '7 ', '0x10', '']) {
    const signed = sign(body({ action: { kind: 'prepare_pass_position', id: '7', collateral } }));
    assert.equal(valid(signed), false, `the schema accepted collateral ${JSON.stringify(collateral)}`);
    const result = await admitIntent(JSON.stringify(signed), ctx);
    assert.equal(result.ok, false, `the parser accepted collateral ${JSON.stringify(collateral)}`);
  }
  // The same class on the action id, which is where a substituted target would hide.
  for (const id of ['007', '-1', '1e3']) {
    const signed = sign(body({ action: { kind: 'prepare_pass_position', id, collateral: '5' } }));
    assert.equal(valid(signed), false, `the schema accepted id ${JSON.stringify(id)}`);
  }
});

test('fractionPpm is bounded at 1..1_000_000 inclusive', () => {
  const close = (fractionPpm) =>
    sign(
      body({
        action: { kind: 'close_position', id: '3', fractionPpm },
        limits: { minProceeds: '1' },
      }),
    );
  assert.equal(valid(close(1)), true);
  assert.equal(valid(close(1_000_000)), true);
  assert.equal(valid(close(0)), false);
  assert.equal(valid(close(1_000_001)), false);
});

/* ------------------------------------------- the validator must be able to say no */

test('the validator refuses a keyword it does not implement', () => {
  assert.throws(
    () => validate({}, { type: 'object', minProperties: 1 }),
    UnknownKeyword,
    'an unimplemented keyword was silently ignored, which makes every test above weaker ' +
      'than it reads',
  );
});

test('each implemented keyword has a negative control', () => {
  // Without this, a validator whose `pattern` branch never ran would pass every test in
  // this file: all of them assert that valid documents validate, and a validator that
  // accepts everything does that perfectly.
  const cases = [
    ['const', { const: 'a' }, 'b'],
    ['enum', { enum: ['a'] }, 'b'],
    ['type', { type: 'string' }, 1],
    ['integer', { type: 'integer' }, 1.5],
    ['pattern', { type: 'string', pattern: '^a$' }, 'b'],
    ['minimum', { type: 'integer', minimum: 2 }, 1],
    ['maximum', { type: 'integer', maximum: 2 }, 3],
    ['required', { type: 'object', required: ['a'] }, {}],
    ['additionalProperties', { type: 'object', additionalProperties: false }, { a: 1 }],
    ['items', { type: 'array', items: { type: 'string' } }, [1]],
    ['oneOf', { oneOf: [{ type: 'string' }, { type: 'number' }] }, true],
  ];
  for (const [label, schema, bad] of cases) {
    assert.ok(validate(bad, schema).length > 0, `${label}: the keyword accepted a bad value`);
  }
});

test('the three schemas are self-describing and name their dialect', () => {
  for (const name of ['bleavit.intent.v1', 'bleavit.context.v1', 'bleavit.receipt.v1']) {
    const schema = JSON.parse(readFileSync(join(SCHEMA_DIR, `${name}.schema.json`), 'utf8'));
    assert.equal(schema.title, name);
    assert.match(schema.$schema, /json-schema\.org/);
    assert.equal(schema.properties.schema.const, name, 'the schema string must be exact-equality');
    // Nothing here is fetched at runtime — the `$id` is an identifier, and the file ships
    // in the release. A producer that resolves it over the network is doing so on their
    // own side; the client never does (D-21).
    assert.match(schema.$id, new RegExp(`${name}\\.schema\\.json$`));
  }
});
