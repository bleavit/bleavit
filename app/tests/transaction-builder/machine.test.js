/**
 * The tx machine, the gate, and the signer boundary — 11 §11.3, §11.4; INV-FE-2/3/5/12.
 *
 * 11 §11.4 rule 1 asks for something unusual: *"Every submit path passes through
 * `refreshAndGate` — **structurally** (the tx machine has no bypass edge), not by
 * convention."* A test that merely checked the happy path would not test that at all, so
 * what is asserted here is mostly the shape of the state space: which states can reach a
 * signer, what a `GatePassed` costs to obtain, and what happens to it when the flow backs
 * up.
 *
 * The lifecycle is read **out of the specification** (11 §11.3's `- **Lifecycle.**` line)
 * and compared against the reducer's reachable states, the same method
 * `tests/chain-client/boot.test.js` uses on 10 §3.1's mermaid diagram: the document and
 * the code are two renderings of one artifact, and drift is a failure rather than a
 * discrepancy nobody re-reads.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  INITIAL_TX_SESSION,
  TX_TERMINAL_STATES,
  evaluate,
  gate,
  reduce,
  txTransitionEdges,
} from '@bleavit/transaction-builder';
import { INJECTED_DESCRIPTOR, RAW_PAYLOAD_DESCRIPTOR, SignerCapabilityError, SignerRegistry, requireCapability } from '@bleavit/signing';
import { MOCK_SIGNER_DESCRIPTOR, MockSigner } from '@bleavit/signing/testing';

const HERE = dirname(fileURLToPath(import.meta.url));
const DOC = resolve(HERE, '..', '..', '..', 'docs', 'architecture', '11-frontend-workflows.md');

const PIN = { blockHash: `0x${'11'.repeat(32)}`, blockNumber: 100 };
const BUILT_FOR = { specVersion: 2, metadataHash: `0x${'ab'.repeat(32)}` };
const PREP = { scaleHex: '0x0403aabbcc', builtFor: BUILT_FOR, preparedAt: { blockHash: `0x${'22'.repeat(32)}`, blockNumber: 99 } };

const okRow = (id) => ({ id, ok: true, requirement: 'r', expected: 'e', actual: 'a', at: PIN });
const failRow = (id) => ({ ...okRow(id), ok: false });

/** Drive a session to AwaitingSignature the only way the machine allows. */
function toAwaitingSignature(results = [okRow('P-1')]) {
  let s = reduce(INITIAL_TX_SESSION, { type: 'prepared', prep: PREP });
  s = reduce(s, { type: 'submit-requested' });
  return reduce(s, { type: 'gate-result', outcome: gate(PREP, PIN, BUILT_FOR, results) });
}

test('the reducer reaches exactly the states 11 §11.3 writes out', () => {
  const text = readFileSync(DOC, 'utf8');
  const line = text.split('\n').find((l) => l.includes('**Lifecycle.**'));
  assert.ok(line, '11 §11.3 no longer carries a Lifecycle line — this suite would be vacuous');
  const declared = new Set(
    (line.match(/\b(Draft|Prepared|Refreshing|Blocked|AwaitingSignature|Broadcast|InBestBlock|Finalized|Dropped|Retracted)\b/g) ?? []),
  );
  const reachable = new Set(txTransitionEdges().flat());
  reachable.add('Draft'); // the initial state has no inbound edge
  assert.deepEqual([...declared].sort(), [...reachable].sort());
  assert.ok(declared.size >= 10, `parsed only ${declared.size} states — the parser has stopped matching`);
});

test('AwaitingSignature is reachable ONLY from Refreshing, and only with a passed gate', () => {
  // This is 11 §11.4 rule 1 as a property of the state space rather than a review note.
  const inbound = txTransitionEdges().filter(([, to]) => to === 'AwaitingSignature');
  assert.deepEqual(inbound, [['Refreshing', 'AwaitingSignature']]);

  // And from Refreshing, only a `proceed` outcome opens it.
  const refreshing = { ...INITIAL_TX_SESSION, state: 'Refreshing', prep: PREP };
  const blocked = gate(PREP, PIN, BUILT_FOR, [failRow('P-1')]);
  assert.equal(reduce(refreshing, { type: 'gate-result', outcome: blocked }).state, 'Blocked');
  for (const type of ['signed', 'prepared', 'submit-requested', 'edit', 'finalized']) {
    assert.equal(reduce(refreshing, { type, prep: PREP }).state, 'Refreshing', `${type} bypassed the gate`);
  }
});

test('a session in AwaitingSignature carries the gate proof, and nothing else does', () => {
  const signing = toAwaitingSignature();
  assert.equal(signing.state, 'AwaitingSignature');
  assert.ok(signing.signingWindow, 'no gate proof was carried into the signing state');
  assert.equal(signing.signingWindow.at.blockHash, PIN.blockHash);

  for (const state of ['Draft', 'Prepared', 'Refreshing', 'Blocked', 'Broadcast']) {
    assert.equal(
      reduce({ ...INITIAL_TX_SESSION, state }, { type: 'signed' }).signingWindow,
      undefined,
      `${state} produced a signing window`,
    );
  }
});

test('a declined signature drops the window, so re-submitting must re-run the gate', () => {
  // The pin is now old. Reusing it would sign against a block that has since been
  // superseded — which is exactly the state INV-FE-2 exists to exclude.
  const declined = reduce(toAwaitingSignature(), { type: 'signature-declined' });
  assert.equal(declined.state, 'Draft');
  assert.equal(declined.signingWindow, undefined);
  assert.ok(declined.prep, 'the preparation was discarded along with the window');
});

test('FE-TX-007 is checked before the preconditions, not alongside them', () => {
  // A runtime that changed under the preparation invalidates the *encoding*, so evaluating
  // rows against it would be decoding new metadata with old assumptions: every row could
  // pass and the bytes still be wrong.
  const outcome = gate(PREP, PIN, { specVersion: 3, metadataHash: BUILT_FOR.metadataHash }, [failRow('P-1')]);
  assert.equal(outcome.kind, 'blocked');
  assert.equal(outcome.code, 'FE-TX-007');
  assert.deepEqual(outcome.failed, [], 'precondition results leaked into a runtime-change block');
  assert.match(outcome.detail, /rebuilt rather than re-checked/);

  // A changed metadata hash at the same spec_version is equally disqualifying.
  const rehashed = gate(PREP, PIN, { specVersion: 2, metadataHash: `0x${'cd'.repeat(32)}` }, []);
  assert.equal(rehashed.code, 'FE-TX-007');
});

test('a blocked gate returns to Draft with the preparation preserved (rule 5)', () => {
  let s = reduce(INITIAL_TX_SESSION, { type: 'prepared', prep: PREP });
  s = reduce(s, { type: 'submit-requested' });
  s = reduce(s, { type: 'gate-result', outcome: gate(PREP, PIN, BUILT_FOR, [okRow('P-1'), failRow('P-2')]) });
  assert.equal(s.state, 'Blocked');
  assert.equal(s.lastError, 'FE-TX-004');
  assert.deepEqual(s.failed.map((f) => f.id), ['P-2'], 'the diff view must carry only the failures');

  const back = reduce(s, { type: 'edit' });
  assert.equal(back.state, 'Draft');
  assert.deepEqual(back.failed, []);
  assert.ok(back.prep, 'form state was lost — that is how people learn to click through warnings');
});

test('preconditions read at different blocks cannot authorise a signature (INV-FE-2)', () => {
  // Not a precondition failure — a defect in how the batch was read. Passing it would
  // certify a conjunction that was never simultaneously true.
  const elsewhere = { ...okRow('P-3'), at: { blockHash: `0x${'99'.repeat(32)}`, blockNumber: 101 } };
  const outcome = gate(PREP, PIN, BUILT_FOR, [okRow('P-1'), elsewhere]);
  assert.equal(outcome.kind, 'blocked');
  assert.deepEqual(outcome.failed.map((f) => f.id), ['P-3']);
  assert.match(outcome.detail, /does not describe one state/);
});

test('InBestBlock is not success: retraction and dropping are both live edges', () => {
  const edges = new Set(txTransitionEdges().map(([f, t]) => `${f}>${t}`));
  assert.ok(edges.has('InBestBlock>Finalized'));
  assert.ok(edges.has('InBestBlock>Retracted'), 'a transaction that went backwards has nowhere to go');
  assert.ok(edges.has('InBestBlock>Dropped'));
  for (const terminal of ['Finalized', 'Dropped', 'Retracted']) {
    assert.ok(TX_TERMINAL_STATES.has(terminal));
    assert.equal(reduce({ ...INITIAL_TX_SESSION, state: terminal }, { type: 'edit' }).state, terminal);
  }
});

test('a precondition is evaluated from a finalized read and reports both sides', () => {
  // Rule 3: expected and actual both render. A gate that reported only "failed" leaves the
  // user unable to tell a stale form from a moved chain.
  const row = {
    id: 'P-1',
    requirement: 'the account holds at least the trade cost',
    source: { kind: 'storage', key: '0xdead', query: 'value' },
    satisfiedBy: (v) => v >= 1000n,
    expected: () => '>= 1000',
  };
  const read = { value: 999n, status: { kind: 'verified-finalized', blockHash: PIN.blockHash, blockNumber: PIN.blockNumber } };
  const result = evaluate(row, read);
  assert.equal(result.ok, false);
  assert.equal(result.expected, '>= 1000');
  assert.equal(result.actual, '999');
  assert.equal(result.at.blockHash, PIN.blockHash);
});

/* ------------------------------------------------------------------- the signer edge */

test('a signer cannot be called without the gate proof', async () => {
  // The type-level half is `tests/firewall/fixtures/unguarded-signature.ts`; this asserts
  // the runtime shape carries the window through to the adapter, so the confirm surface
  // can say which block the signature is being taken against.
  const signer = new MockSigner();
  const session = toAwaitingSignature();
  const signed = await signer.sign({ prep: PREP, window: session.signingWindow, account: '5Grw' });
  assert.equal(signed.signerId, 'mock');
  assert.equal(signer.seen.length, 1);
  assert.equal(signer.seen[0].window.at.blockHash, PIN.blockHash);
  // Anti-substitution (11 §11.3): the bytes that reach the signer are `prep.scaleHex`.
  assert.equal(signer.seen[0].prep.scaleHex, PREP.scaleHex);
});

test('the registry refuses a test-only signer (INV-FE-5)', () => {
  const registry = new SignerRegistry();
  assert.throws(() => registry.register(new MockSigner()), /test-only/);
  assert.deepEqual(registry.list(), []);
  assert.equal(MOCK_SIGNER_DESCRIPTOR.testOnly, true);
  assert.equal(RAW_PAYLOAD_DESCRIPTOR.testOnly, false);
  // A function of the extension name since the adapter landed — a single `injected`
  // id cannot distinguish two installed extensions. Strict-equal against `false`
  // rather than `assert.ok(!…)`, which would have passed vacuously on `undefined`
  // and hidden this change.
  assert.equal(INJECTED_DESCRIPTOR('talisman').testOnly, false);
});

test('capabilities are fail-closed: unproven means absent, with a named reason', () => {
  // 11 §11.3 makes the wallet's metadata-hash decode the independent second channel
  // against substitution, and whether a hardware wallet honours CheckMetadataHash for a
  // custom chain is FE-P6 — unresolved. So it is not declared, and a surface that needs it
  // is disabled rather than attempted.
  const raw = { descriptor: RAW_PAYLOAD_DESCRIPTOR, sign: async () => { throw new Error('unused'); } };
  assert.equal(RAW_PAYLOAD_DESCRIPTOR.capabilities.has('metadata-hash'), false);
  assert.throws(
    () => requireCapability(raw, 'metadata-hash', 'FE-P6 is unresolved.'),
    (e) => e instanceof SignerCapabilityError && e.missing === 'metadata-hash' && /INV-FE-12/.test(e.message),
  );
  requireCapability(raw, 'decoded-payload', 'declared');

  const registry = new SignerRegistry();
  registry.register(raw);
  assert.deepEqual(registry.supporting('metadata-hash'), [], 'an unproven capability must yield an empty list');
  assert.equal(registry.supporting('hashed-payload').length, 1);
});

test('the mock signature is derived from the payload, not constant', () => {
  // A constant signature could not tell a test whether the right bytes ever reached the
  // signer — which is the only thing 11 §11.3's anti-substitution rule is about.
  const signer = new MockSigner();
  const window = toAwaitingSignature().signingWindow;
  return Promise.all([
    signer.sign({ prep: PREP, window, account: '5Grw' }),
    signer.sign({ prep: { ...PREP, scaleHex: '0x0403ddeeff' }, window, account: '5Grw' }),
    signer.sign({ prep: PREP, window, account: '5Fbc' }),
  ]).then(([a, b, c]) => {
    assert.notEqual(a.signatureHex, b.signatureHex, 'different bytes produced the same signature');
    assert.notEqual(a.signatureHex, c.signatureHex, 'different accounts produced the same signature');
  });
});
