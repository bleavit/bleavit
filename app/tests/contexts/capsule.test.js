/**
 * `bleavit.context.v1` — the exporter (10 §13.1; 11 §11.14.4, §11.2a).
 *
 * Three properties carry this suite, and each of them fails **silently** in production:
 *
 *  1. **Scope is checked in both directions.** The filter-only implementation cannot leak,
 *     so it looks safe — and it emits a capsule that announces `positions` and carries
 *     none, which reads to every tool and every human as *this user holds no positions*.
 *     A false statement about the chain, made by the document whose job is to carry true
 *     ones. So the corpus asserts the lying direction as hard as the leaking one.
 *  2. **A book's `kind` and its id must agree.** Deriving the label instead of checking it
 *     would export a claim the user never saw on screen; trusting it would let a hosted
 *     book leave the app dressed as a governance market.
 *  3. **Ids are `bigint` end to end.** `SERVICE_ID_BASE` is 2^63, so every service-domain
 *     id is past 2^53 and `Number` rounds it — two distinct books become one, and the bit
 *     test that decides the domain answers about the wrong id.
 *
 * The happy path is one test. It is the least informative thing here.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CONTEXT_SCHEMA,
  CapsuleError,
  buildCapsule,
  capsuleDigestPreimage,
  defaultScope,
  refuseUnverifiedExport,
  scopeFromConsent,
  serializeCapsule,
} from '@bleavit/contexts';
import * as contextsModule from '@bleavit/contexts';
import { REFUSAL_CODES, RETIRED_CODES } from '@bleavit/handoff-envelope';

/**
 * A stand-in for `Finalized<T>` — the brand is a module-private symbol in `chain-client`
 * and a test cannot mint one. That is the property being relied on rather than worked
 * around: TypeScript checks provenance at the one place it can be checked, and this suite
 * checks the projection.
 */
const finalized = (value) => ({ value, status: { kind: 'verified-finalized' } });

/**
 * Capture a refusal so its code, detail and recovery can be asserted.
 *
 * `assert.throws` does **not** return the thrown error in `node:test` — it returns
 * `undefined`, so `const error = assert.throws(...)` asserts against nothing and every
 * check after it passes for free. That exact defect already shipped once in this
 * subsystem's suites and was caught by review rather than by a red run, which is the
 * reason it is worth a helper: the shape that produces it is no longer writable here.
 */
function refusalFrom(build) {
  try {
    build();
  } catch (error) {
    return error;
  }
  return assert.fail('expected a refusal; the export succeeded');
}

const BINDING = {
  genesisHash: '0x91b171bb158e2d3848fa23a9f1c25182fb8e20313b2c1eb49219da7a70ce90c3',
  specVersion: 2,
  contractVersion: 27,
};

/** `ConditionalLedger::ServiceIdBase` as the runtime publishes it (16 §7.1). */
const BOUNDARY = { serviceIdBase: 1n << 63n };
const SERVICE_ID = (1n << 63n) + 7n;

const anchor = finalized({ blockHash: '0xfeed', blockNumber: 4_242 });

const book = (over = {}) => ({
  id: '12',
  kind: 'primary',
  proposalId: '3',
  branch: 'PASS',
  pricePpm: 612_500,
  ...over,
});

/** The public-only default scope, with every consented read supplied. */
const publicReads = () => ({
  proposal: finalized([{ id: '3', state: 'Trading', title: 'Raise the fee' }]),
  market: finalized([book()]),
  decision: finalized([]),
  epoch: finalized({ index: 9, startBlock: 4_000 }),
});

const input = (over = {}) => ({
  binding: BINDING,
  anchor,
  scope: defaultScope(),
  reads: publicReads(),
  boundary: BOUNDARY,
  ...over,
});

/* ------------------------------------------------------ the shape of a valid capsule */

test('a public-scope capsule carries the schema, binding, anchor and stated scope', () => {
  const capsule = buildCapsule(input());
  assert.equal(capsule.schema, CONTEXT_SCHEMA);
  assert.deepEqual(capsule.binding, BINDING);
  assert.deepEqual(capsule.anchor, { blockHash: '0xfeed', blockNumber: 4_242 });
  assert.deepEqual(capsule.scope.included, ['decision', 'epoch', 'market', 'proposal']);
  assert.equal(capsule.scope.pseudonymized, false);
  // Nothing account-bearing arrives without being asked for.
  assert.equal(capsule.positions, undefined);
  assert.equal(capsule.balances, undefined);
  assert.equal(capsule.address, undefined);
});

test('an absent field is omitted from the serialized document, not rendered as null', () => {
  // The in-memory object carries `positions: undefined`; the document must not carry the
  // key at all. A `"positions": null` would read as a positive claim about the account.
  const text = serializeCapsule(buildCapsule(input()));
  assert.equal(text.includes('positions'), false);
  assert.equal(text.includes('null'), false);
  assert.deepEqual(Object.keys(JSON.parse(text)).sort(), [
    'anchor',
    'binding',
    'decision',
    'epoch',
    'market',
    'proposal',
    'schema',
    'scope',
  ]);
});

/* ------------------------------------- 11 §11.14.4 scope, checked in BOTH directions */

test('data outside the consented scope is refused, never dropped — FE-HANDOFF-012', () => {
  const error = refusalFrom(() =>
    buildCapsule(
      input({
        reads: { ...publicReads(), positions: finalized([{ bookId: '12', baseUnits: 5n }]) },
      }),
    ),
  );
  assert.ok(error instanceof CapsuleError);
  assert.equal(error.code, 'FE-HANDOFF-012');
  // A silent drop would leave the export screen and the exporter disagreeing about what
  // was shared, with nothing anywhere to surface it.
  assert.match(error.detail, /refused rather than dropped/i);
});

test('a consented scope with no read supplied is refused — the lying direction', () => {
  const error = refusalFrom(() =>
    buildCapsule(
      input({
        scope: scopeFromConsent(['proposal', 'market', 'decision', 'epoch', 'positions']),
        reads: publicReads(),
      }),
    ),
  );
  assert.ok(error instanceof CapsuleError);
  // Not 012: nothing was asked for that the user refused. The document would simply have
  // been false, so it is malformed.
  assert.equal(error.code, 'FE-HANDOFF-002');
  assert.match(error.detail, /empty is data, absent is not/);
});

test('an empty array is data — a user with no positions exports that fact', () => {
  const capsule = buildCapsule(
    input({
      scope: scopeFromConsent(['proposal', 'market', 'decision', 'epoch', 'positions']),
      reads: { ...publicReads(), positions: finalized([]) },
    }),
  );
  // Present and empty, which is a different claim from absent.
  assert.deepEqual(capsule.positions, { primary: [], service: [] });
  assert.ok(serializeCapsule(capsule).includes('"positions"'));
});

test('every scope key is covered by the both-directions check, not just the account ones', () => {
  // A public scope that is consented but unsupplied must refuse exactly as an account one
  // does. Written as a loop over the scope vocabulary so a scope added later without a
  // read behind it fails here rather than being silently unexportable.
  for (const key of ['proposal', 'market', 'decision', 'epoch']) {
    const reads = { ...publicReads() };
    delete reads[key];
    const error = refusalFrom(() => buildCapsule(input({ reads })));
    assert.equal(error.code, 'FE-HANDOFF-002', `${key} unsupplied was not refused`);
    assert.match(error.detail, new RegExp(key));
  }
});

/* ------------------------------------------------- 11 §11.14.4 pseudonymization */

test('pseudonymization withholds the address and says so, leaving the holdings', () => {
  const capsule = buildCapsule(
    input({
      scope: scopeFromConsent(
        ['proposal', 'market', 'decision', 'epoch', 'address', 'positions'],
        true,
      ),
      reads: {
        ...publicReads(),
        address: finalized('5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY'),
        positions: finalized([{ bookId: '12', baseUnits: 5n }]),
      },
    }),
  );
  assert.equal(capsule.address, undefined);
  // The flag stays in the document: a reader must be able to tell a withheld address from
  // an absent one, and the holdings are untouched because that is what the label promises.
  assert.equal(capsule.scope.pseudonymized, true);
  assert.ok(capsule.scope.included.includes('address'));
  assert.deepEqual(capsule.positions.primary, [{ bookId: '12', baseUnits: 5n }]);
});

/* --------------------------------------------------- 11 §11.2a rules 1 and 2, domain */

test('positions are keyed by domain, and the domain comes from the id', () => {
  const capsule = buildCapsule(
    input({
      scope: scopeFromConsent(['proposal', 'market', 'decision', 'epoch', 'positions']),
      reads: {
        ...publicReads(),
        positions: finalized([
          { bookId: '12', baseUnits: 5n },
          { bookId: SERVICE_ID.toString(), baseUnits: 9n },
        ]),
      },
    }),
  );
  assert.deepEqual(capsule.positions.primary, [{ bookId: '12', baseUnits: 5n }]);
  assert.deepEqual(capsule.positions.service, [
    { bookId: SERVICE_ID.toString(), baseUnits: 9n },
  ]);
});

test('the document has no field a cross-domain total could occupy', () => {
  const capsule = buildCapsule(
    input({
      scope: scopeFromConsent(['proposal', 'market', 'decision', 'epoch', 'positions']),
      reads: {
        ...publicReads(),
        positions: finalized([
          { bookId: '12', baseUnits: 5n },
          { bookId: SERVICE_ID.toString(), baseUnits: 9n },
        ]),
      },
    }),
  );
  // Rule 2 is enforced by shape: `positions` is a record keyed by domain, so there is
  // nowhere to put a merged figure and nothing to remember not to compute.
  assert.deepEqual(Object.keys(capsule.positions).sort(), ['primary', 'service']);
  assert.equal(Array.isArray(capsule.positions), false);
});

test('a book whose label disagrees with its id is refused, not corrected', () => {
  const error = refusalFrom(() =>
    buildCapsule(
      input({ reads: { ...publicReads(), market: finalized([book({ kind: 'service' })]) } }),
    ),
  );
  assert.ok(error instanceof CapsuleError);
  assert.equal(error.code, 'FE-HANDOFF-002');
  assert.match(error.detail, /a claim the user never read/);
});

test('a service-band book must be labelled service', () => {
  const error = refusalFrom(() =>
    buildCapsule(
      input({
        reads: {
          ...publicReads(),
          market: finalized([book({ id: SERVICE_ID.toString(), kind: 'primary' })]),
        },
      }),
    ),
  );
  assert.ok(error instanceof CapsuleError);
  assert.equal(error.code, 'FE-HANDOFF-002');
  assert.match(error.detail, /is in the service band/);
});

test('the id one below the boundary stays primary — the bit test runs on bigint', () => {
  // The sharpest case, and the only one with teeth. `2^63 - 1` is the largest primary id;
  // as a double it rounds *up to* 2^63, which is the boundary itself, so a `Number`-based
  // parse classifies the last primary book as **service**.
  //
  // An earlier version of this test used two huge service ids and asserted they stayed
  // distinct. It passed under a deliberately `Number`-corrupted parse and proved nothing:
  // `bookId` is echoed verbatim into the document, so nothing in the assertion depended on
  // the value the domain test actually saw. Mutation testing is what surfaced that; the
  // rewrite is what the mutation could not survive.
  const lastPrimary = (1n << 63n) - 1n;
  assert.equal(Number(lastPrimary), Number(1n << 63n), 'precondition: it rounds to the boundary');

  const capsule = buildCapsule(
    input({
      scope: scopeFromConsent(['proposal', 'market', 'decision', 'epoch', 'positions']),
      reads: {
        ...publicReads(),
        positions: finalized([
          { bookId: lastPrimary.toString(), baseUnits: 1n },
          { bookId: SERVICE_ID.toString(), baseUnits: 2n },
        ]),
      },
    }),
  );
  assert.deepEqual(
    capsule.positions.primary.map((p) => p.bookId),
    [lastPrimary.toString()],
    'the last primary id was classified into the service band',
  );
  assert.deepEqual(
    capsule.positions.service.map((p) => p.bookId),
    [SERVICE_ID.toString()],
  );
});

test('a book one below the boundary must be labelled primary, and the check sees it', () => {
  // The same rounding, on the label path rather than the position path. Under a Number
  // parse the derived label is `service`, so a correctly-labelled `primary` book is
  // *refused* — a false rejection is the friendlier direction and still wrong.
  const lastPrimary = ((1n << 63n) - 1n).toString();
  const capsule = buildCapsule(
    input({ reads: { ...publicReads(), market: finalized([book({ id: lastPrimary })]) } }),
  );
  assert.equal(capsule.market[0].kind, 'primary');
});

test('a non-canonical id is refused rather than coerced', () => {
  for (const id of ['012', '0x0c', '-1', '', '1.0', ' 12']) {
    const error = refusalFrom(() =>
      buildCapsule(input({ reads: { ...publicReads(), market: finalized([book({ id })]) } })),
    );
    assert.equal(error.code, 'FE-HANDOFF-002', `id ${JSON.stringify(id)} was accepted`);
  }
});

/* ------------------------------------------------------------ FE-HANDOFF-013 and copy */

test('export from unverified state is a named refusal carrying the mode as detail', () => {
  const error = refuseUnverifiedExport('RPC-only mode');
  assert.equal(error.code, 'FE-HANDOFF-013');
  // The user-facing sentence is fixed and comes from the one table; the mode is the
  // "stated reason" 10 §13.1 asks for and travels as expert detail.
  assert.equal(error.message, 'Bleavit cannot export while it has no verified view of the chain.');
  assert.match(error.detail, /RPC-only mode/);
  assert.ok(error.recovery.length > 0);
});

test('the refusal family has one home — contexts and receipts agree on 013', async () => {
  // The defect this replaced: `receipts` could not import the inbound parser across the
  // §10.1 firewall, so it declared its own union and its own sentence for the same code.
  // Two homes, two answers, and no call site takes both — so the compiler could not see it.
  const receipts = await import('@bleavit/receipts');
  assert.equal(
    refuseUnverifiedExport('degraded sync').message,
    receipts.refuseUnverifiedExport('degraded sync').message,
  );
});

test('FE-HANDOFF-012 is now emitted by something — the code was defined and unreachable', () => {
  assert.ok(REFUSAL_CODES.includes('FE-HANDOFF-012'));
  const error = refusalFrom(() =>
    buildCapsule(input({ reads: { ...publicReads(), balances: finalized([]) } })),
  );
  assert.equal(error.code, 'FE-HANDOFF-012');
});

test('009 stays retired and every live code carries a recovery', () => {
  assert.deepEqual([...RETIRED_CODES], ['FE-HANDOFF-009']);
  assert.equal(REFUSAL_CODES.includes('FE-HANDOFF-009'), false);
  assert.equal(REFUSAL_CODES.length, 12);
});

/* --------------------------------------------------------- the digest, and what is not */

test('the digest covers the whole document, so a mutated capsule reports damage', () => {
  const capsule = buildCapsule(input());
  const before = capsuleDigestPreimage(capsule);
  const after = capsuleDigestPreimage({ ...capsule, anchor: { ...capsule.anchor, blockNumber: 1 } });
  assert.notDeepEqual(before, after);
});

test('the exporter offers nothing that could pass for authentication', () => {
  // 10 §13.1: capsules are deliberately unsigned. A helper here that *looked* like
  // authentication would manufacture the artifact that section refuses to manufacture —
  // and this is the module where adding one would feel most natural.
  const forbidden = /^(sign|verify|authenticate|attest|certify|prove)/i;
  for (const name of Object.keys(contextsModule)) {
    assert.equal(forbidden.test(name), false, `@bleavit/contexts exports ${name}`);
  }
  // Negative control: the matcher must be able to fire. An earlier version matched
  // substrings and flagged `refuseUnverifiedExport` on the `verif` in *Unverified*, and
  // loosening it to fix that would have let `verifySignature` through.
  assert.ok(forbidden.test('verifySignature'));
  assert.equal(forbidden.test('refuseUnverifiedExport'), false);
});

test('the capsule carries no expiry — staleness is structural, never a producer timer', () => {
  // 11 §11.14.3: the capsule's age is displayed and diffed, never trusted, and a stated
  // maximum age narrows only. A producer-chosen lifetime on the way out would be a timer
  // the client is not entitled to believe, so there is no field for one.
  const capsule = buildCapsule(input());
  const keys = Object.keys(JSON.parse(serializeCapsule(capsule)));
  for (const forbidden of ['expiresAt', 'expiry', 'ttl', 'validUntil', 'maxAge']) {
    assert.equal(keys.includes(forbidden), false, `capsule carries ${forbidden}`);
  }
  // What it carries instead is the block it was read at, which a reader can check.
  assert.equal(capsule.anchor.blockNumber, 4_242);
});
