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
  declaredCoverageIds,
  evaluate,
  gate,
  reduce,
  txTransitionEdges,
} from '@bleavit/transaction-builder';
import type {
  ClauseId,
  DeclarableRowId,
  GatePassed,
  PreconditionResult,
  PreconditionRow,
  TxPreparation,
  TxSession,
  TxState,
  TxEvent,
} from '@bleavit/transaction-builder';
import type { CompatClassification } from '@bleavit/descriptors';
import type { FinalizedBlockRef } from '@bleavit/chain-client';
import { INJECTED_DESCRIPTOR, RAW_PAYLOAD_DESCRIPTOR, SignerCapabilityError, SignerRegistry, requireCapability } from '@bleavit/signing';
import { MOCK_SIGNER_DESCRIPTOR, MockSigner } from '@bleavit/signing/testing';
// `finalize` is test-only on purpose — see packages/chain-client/src/testing.ts.
import { finalize } from '@bleavit/chain-client/testing';

/** The chain identity every pin in this file is read against (F18). Named, not inlined:
 *  the field exists so two reads can agree on it, and copies agree until one is edited. */
const TEST_CHAIN = `0x${'ce'.repeat(32)}` as `0x${string}`;


const HERE = dirname(fileURLToPath(import.meta.url));
const DOC = resolve(HERE, '..', '..', '..', 'docs', 'architecture', '11-frontend-workflows.md');

const PIN: FinalizedBlockRef = { chain: TEST_CHAIN, blockHash: `0x${'11'.repeat(32)}`, blockNumber: 100 };
const BUILT_FOR: TxPreparation['builtFor'] = { specVersion: 2, metadataHash: `0x${'ab'.repeat(32)}` };
/**
 * The compat verdict every test below passes unless it is testing the compat gate itself.
 *
 * `full`, because 10 §3.2's table gives that mode and only that mode an enabled signing column,
 * and `callIsProven` fail-closes every other mode to `false` while `CRITICAL_SURFACE` carries
 * no call entries (SQ-577). A shared constant rather than a literal per call site: the gate now
 * refuses without one, so a test that built its own could quietly assert the machine's shape
 * against a session that may not sign.
 */
const PROVEN: CompatClassification = { mode: 'full', specVersion: 2, disabled: [], proven: [] };
// `requires` is the rows this call declares. It is required and non-empty: without it the
// gate could not distinguish "every precondition holds" from "nobody read one", and those
// were the same value — every check in `gate` is a filter, and a filter over an empty array
// is empty. An adversarial review found `gate(PREP, PIN, BUILT_FOR, [])` returning `proceed`.
const PREP: TxPreparation = {
  scaleHex: '0x0403aabbcc',
  builtFor: BUILT_FOR,
  preparedAt: { chain: TEST_CHAIN, blockHash: `0x${'22'.repeat(32)}`, blockNumber: 99 },
  requires: ['P-1'],
  feeAsset: 'USDC',
};

/**
 * Every obligation a row imposes under this preparation's fee asset.
 *
 * A row is a *set of clauses*, and until the coverage check was expanded through this
 * function one result naming `P-1` covered all of them — so a preparation could reach a
 * signer having read one clause out of nine. The fixtures therefore build complete sets,
 * because that is what the shipped gate demands.
 */
const coverageOf = (row: DeclarableRowId): readonly ClauseId[] =>
  declaredCoverageIds(row, PREP.feeAsset);

/** One obligation of a row, where a test needs an id rather than the set. */
const firstOf = (row: DeclarableRowId): ClauseId => {
  const [id] = coverageOf(row);
  assert.ok(id, `${row} declares no obligations`);
  return id;
};

const okRow = (id: ClauseId): PreconditionResult =>
  ({ id, ok: true, requirement: 'r', expected: 'e', actual: 'a', at: PIN });
const failRow = (id: ClauseId): PreconditionResult => ({ ...okRow(id), ok: false });

/** A complete, all-passing read set for one row. */
const covering = (row: DeclarableRowId = 'P-1'): readonly PreconditionResult[] =>
  coverageOf(row).map(okRow);

/** The gate proof a signing session carries, or a throw if the gate never opened. */
function windowOf(session: TxSession): GatePassed {
  const { signingWindow } = session;
  assert.ok(signingWindow, `no gate proof in state ${session.state}`);
  return signingWindow;
}

/** Drive a session to AwaitingSignature the only way the machine allows. */
function toAwaitingSignature(results: readonly PreconditionResult[] = covering()): TxSession {
  let s = reduce(INITIAL_TX_SESSION, { type: 'prepared', prep: PREP });
  s = reduce(s, { type: 'submit-requested' });
  return reduce(s, { type: 'gate-result', outcome: gate(PREP, PIN, BUILT_FOR, PROVEN, results) });
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
  const refreshing: TxSession = { ...INITIAL_TX_SESSION, state: 'Refreshing', prep: PREP };
  const blocked = gate(PREP, PIN, BUILT_FOR, PROVEN, [failRow(firstOf('P-1'))]);
  assert.equal(reduce(refreshing, { type: 'gate-result', outcome: blocked }).state, 'Blocked');
  const bypasses = [
    { type: 'signed' },
    { type: 'prepared', prep: PREP },
    { type: 'submit-requested' },
    { type: 'edit' },
    { type: 'finalized' },
  ] as const satisfies readonly TxEvent[];
  for (const event of bypasses) {
    assert.equal(reduce(refreshing, event).state, 'Refreshing', `${event.type} bypassed the gate`);
  }
});

/* ------------------------------------- INV-FE-12 at the one edge that reaches a signer
 *
 * > signing is disabled wherever compatibility is unproven
 *
 * The classifier has produced this verdict since F4 and `callIsProven` has answered it since
 * F4, and until the gate took it as an argument nothing consulted either: a session that had
 * classified `restricted` minted `GatePassed` values exactly like a `full` one. The invariant
 * was implemented, tested, and unwired — which no passing test can distinguish from wired.
 */

const RESTRICTED: CompatClassification = {
  mode: 'restricted',
  specVersion: 2,
  disabled: [{ id: 'storage.epoch.epoch_of', level: 'incompatible', reason: 'absent from this runtime.' }],
  proven: [],
};
const READ_ONLY: CompatClassification = {
  mode: 'read-only-incompatible',
  specVersion: 4_242,
  disabled: [],
  proven: [],
};

test('an unproven runtime blocks the gate, in every mode 10 §3.2 does not enable signing for', () => {
  // The whole lattice, driven rather than sampled: `full` is the one row of §3.2's table whose
  // signing column reads *enabled*, and every other outcome — including having no verdict at
  // all — must refuse. A test naming only `restricted` would pass on a gate that admitted
  // `read-only-incompatible`, which is the mode where the client cannot decode the chain.
  const refusing: readonly (CompatClassification | undefined)[] = [RESTRICTED, READ_ONLY, undefined];
  for (const compat of refusing) {
    const outcome = gate(PREP, PIN, BUILT_FOR, compat, covering());
    assert.equal(outcome.kind, 'blocked', `${compat?.mode ?? 'unestablished'} reached a signer`);
    assert.ok(outcome.kind === 'blocked');
    // Not a failed row: nothing about the preconditions is wrong, and padding the diff view with
    // one would send an operator looking for a chain condition that holds perfectly.
    assert.deepEqual(outcome.failed, []);
    assert.match(outcome.detail, /signing is unavailable|nothing may be signed/);
  }
  // …and the mode that does enable it still passes, so the refusal is not vacuous.
  assert.equal(gate(PREP, PIN, BUILT_FOR, PROVEN, covering()).kind, 'proceed');
});

test('the compat refusal is checked before FE-TX-007, because it is the root cause', () => {
  // Both are true here: the runtime moved under the preparation *and* the session may not sign.
  // A user told only that these bytes are stale would rebuild, and find the new preparation
  // refused for the reason nobody mentioned.
  const moved: TxPreparation['builtFor'] = { specVersion: 9, metadataHash: BUILT_FOR.metadataHash };
  const outcome = gate(PREP, PIN, moved, RESTRICTED, covering());
  assert.equal(outcome.kind, 'blocked');
  assert.ok(outcome.kind === 'blocked');
  assert.match(outcome.detail, /signing is unavailable/);
  // …and with a proven runtime the same call reports the staleness it really has.
  const stale = gate(PREP, PIN, moved, PROVEN, covering());
  assert.ok(stale.kind === 'blocked');
  assert.equal(stale.code, 'FE-TX-007');
});

test('no compat mode but `full` can reach AwaitingSignature through the reducer', () => {
  // The machine half of the same property: `AwaitingSignature` has one inbound edge and it
  // needs a `GatePassed`, so a gate that refuses leaves the session in `Blocked` — there is no
  // second path for a screen to take.
  for (const compat of [RESTRICTED, READ_ONLY, undefined]) {
    let s = reduce(INITIAL_TX_SESSION, { type: 'prepared', prep: PREP });
    s = reduce(s, { type: 'submit-requested' });
    s = reduce(s, { type: 'gate-result', outcome: gate(PREP, PIN, BUILT_FOR, compat, covering()) });
    assert.equal(s.state, 'Blocked', `${compat?.mode ?? 'unestablished'} opened a signer`);
    assert.equal(s.signingWindow, undefined);
  }
});

/* ------------------------------------------------ the gate cannot pass by shrinking */

test('a gate over zero reads is BLOCKED — it certifies nothing (adversarial review, 2026-08-04)', () => {
  // The defect this replaces: every check in `gate` is a filter over `results`, and every
  // filter over an empty array is empty — so `gate(PREP, PIN, BUILT_FOR, [])` returned
  // `proceed` and the reducer reached AwaitingSignature having read nothing. "Every
  // precondition holds" and "nobody read one" were the same value.
  const outcome = gate(PREP, PIN, BUILT_FOR, PROVEN, []);
  assert.equal(outcome.kind, 'blocked');
  assert.match(outcome.detail, /never read at this block/);
});

test('a declared row with no result blocks, naming the row', () => {
  const twoRows: TxPreparation = { ...PREP, requires: ['P-1', 'P-3'] };
  const outcome = gate(twoRows, PIN, BUILT_FOR, PROVEN, [...covering('P-1')]);
  assert.equal(outcome.kind, 'blocked');
  assert.match(outcome.detail, /P-3/);
});

test('one result cannot cover a multi-clause row (Codex #3730437892)', () => {
  // The defect: every clause of a row carried the **row's** id, and coverage compared row
  // ids — so a single passing read satisfied the whole row. On `O-1` the registry check
  // alone minted a signing window for a 100,000-USDC stake whose balance, whose stake amount
  // and whose fee headroom were never evaluated.
  const oneRow: TxPreparation = { ...PREP, requires: ['O-1'] };
  const obligations = coverageOf('O-1');
  assert.ok(obligations.length > 1, 'O-1 is no longer multi-clause — this test would be vacuous');
  for (let i = 0; i < obligations.length; i += 1) {
    const partial = obligations.filter((_, index) => index !== i).map(okRow);
    const outcome = gate(oneRow, PIN, BUILT_FOR, PROVEN, partial);
    assert.equal(outcome.kind, 'blocked', `O-1 passed without ${obligations[i]}`);
    assert.match(outcome.detail, /never read at this block/);
  }
  // And the complete set opens, so the refusal above is coverage and not a gate that never
  // opens for anything.
  assert.equal(gate(oneRow, PIN, BUILT_FOR, PROVEN, obligations.map(okRow)).kind, 'proceed');
});

test('the fee asset selects which obligations a row has, and it comes from the preparation', () => {
  // Fee headroom is a `System.Account` read in VIT and a `ForeignAssets` one in USDC, so the
  // obligation set differs by currency. A gate that guessed would demand the wrong read or
  // drop the clause entirely — which is a row that lost a precondition, reported as a row
  // that passed.
  const usdc = declaredCoverageIds('O-1', 'USDC');
  const vit = declaredCoverageIds('O-1', 'VIT');
  assert.equal(usdc.length, vit.length);
  const inVit: TxPreparation = { ...PREP, requires: ['O-1'], feeAsset: 'VIT' };
  assert.equal(gate(inVit, PIN, BUILT_FOR, PROVEN, vit.map(okRow)).kind, 'proceed');
  // The clause ids agree (they share a `key`), so what differs is the surface behind them —
  // asserted in `rows.test.ts`. What matters here is that the gate reads the preparation's
  // own answer rather than assuming one.
  assert.deepEqual([...usdc], [...vit]);
});

test('a malformed declaration blocks rather than throwing on the signing path', () => {
  // `rowsFor` throws for an unknown row, and this runs from a click handler on the only edge
  // to a signer: a thrown error there is an unhandled rejection that leaves the control in
  // whatever state it was in. Fail closed, and say what happened.
  // The argument is deliberately outside the signature — an untyped JavaScript caller is
  // exactly who supplies a row id no table has, and the type system cannot reach them.
  const untypedRow = (value: string): DeclarableRowId => value as DeclarableRowId;
  const bogus: TxPreparation = { ...PREP, requires: [untypedRow('P-99')] };
  const outcome = gate(bogus, PIN, BUILT_FOR, PROVEN, covering());
  assert.equal(outcome.kind, 'blocked');
  assert.match(outcome.detail, /could not be expanded into the reads they require/);
});

test('a gate proof names the preparation it was minted for (Codex #3730437885)', () => {
  // `GatePassed` used to carry only a block and a result set, so it proved that *some* call
  // to `gate()` succeeded and nothing about which bytes. An authentic window could then be
  // paired with a different preparation and authorise it.
  const outcome = gate(PREP, PIN, BUILT_FOR, PROVEN, covering());
  assert.equal(outcome.kind, 'proceed');
  assert.ok(outcome.kind === 'proceed');
  assert.equal(outcome.passed.prep, PREP, 'the proof does not name what it proves');
  assert.equal(outcome.passed.prep.scaleHex, PREP.scaleHex);
});

test('a proof for other bytes cannot open THIS session — the machine refuses the pairing', () => {
  // The attack the field exists to stop: gate preparation A, dispatch its outcome into a
  // session holding preparation B, and the signer opens against bytes no precondition was
  // evaluated for.
  const other: TxPreparation = { ...PREP, scaleHex: '0x0403ddeeff' };
  const foreign = gate(other, PIN, BUILT_FOR, PROVEN, covering());
  assert.equal(foreign.kind, 'proceed');
  let s = reduce(INITIAL_TX_SESSION, { type: 'prepared', prep: PREP });
  s = reduce(s, { type: 'submit-requested' });
  const next = reduce(s, { type: 'gate-result', outcome: foreign });
  assert.equal(next.state, 'Blocked', 'a proof for other bytes opened the signer');
  assert.equal(next.signingWindow, undefined);
  // The same event with this session's own proof does open it, so the refusal is the
  // pairing's and not a machine that never proceeds.
  const own = gate(PREP, PIN, BUILT_FOR, PROVEN, covering());
  assert.equal(reduce(s, { type: 'gate-result', outcome: own }).state, 'AwaitingSignature');
});

test('a preparation declaring no rows at all is refused rather than trivially passing', () => {
  // 11 §11.5 gives every call at least one row, so an empty `requires` is a defect in the
  // builder — and the fail-open reading of it is a signature nothing gated.
  const noRows: TxPreparation = { ...PREP, requires: [] };
  const outcome = gate(noRows, PIN, BUILT_FOR, PROVEN, []);
  assert.equal(outcome.kind, 'blocked');
  assert.match(outcome.detail, /declares no precondition rows/);
});

test('extra results beyond the declared set do not substitute for a missing one', () => {
  // A count-based coverage check would pass this: two declared, two supplied.
  const twoRows: TxPreparation = { ...PREP, requires: ['P-1', 'P-3'] };
  const outcome = gate(twoRows, PIN, BUILT_FOR, PROVEN, [...covering('P-1'), ...covering('P-7')]);
  assert.equal(outcome.kind, 'blocked');
  assert.match(outcome.detail, /P-3/);
});

test('the edge enumerator reaches AwaitingSignature through a covered gate, not an empty one', () => {
  // txTransitionEdges() built its own `proceed` from an empty read set, which is the bypass
  // it exists to prove absent. If that regressed, this edge would vanish.
  const edges = txTransitionEdges();
  assert.ok(
    edges.some(([from, to]) => from === 'Refreshing' && to === 'AwaitingSignature'),
    'the enumerator can no longer reach AwaitingSignature — its gate stopped passing',
  );
});

test('a session in AwaitingSignature carries the gate proof, and nothing else does', () => {
  const signing = toAwaitingSignature();
  assert.equal(signing.state, 'AwaitingSignature');
  assert.ok(signing.signingWindow, 'no gate proof was carried into the signing state');
  assert.equal(signing.signingWindow.at.blockHash, PIN.blockHash);

  const preSigning = ['Draft', 'Prepared', 'Refreshing', 'Blocked', 'Broadcast'] as const satisfies readonly TxState[];
  for (const state of preSigning) {
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
  const outcome = gate(PREP, PIN, { specVersion: 3, metadataHash: BUILT_FOR.metadataHash }, PROVEN, [failRow(firstOf('P-1'))]);
  assert.equal(outcome.kind, 'blocked');
  assert.equal(outcome.code, 'FE-TX-007');
  assert.deepEqual(outcome.failed, [], 'precondition results leaked into a runtime-change block');
  assert.match(outcome.detail, /rebuilt rather than re-checked/);

  // A changed metadata hash at the same spec_version is equally disqualifying.
  const rehashed = gate(PREP, PIN, { specVersion: 2, metadataHash: `0x${'cd'.repeat(32)}` }, PROVEN, covering());
  assert.equal(rehashed.kind, 'blocked');
  assert.equal(rehashed.code, 'FE-TX-007');
});

test('a blocked gate returns to Draft with the preparation preserved (rule 5)', () => {
  let s = reduce(INITIAL_TX_SESSION, { type: 'prepared', prep: PREP });
  s = reduce(s, { type: 'submit-requested' });
  s = reduce(s, { type: 'gate-result', outcome: gate(PREP, PIN, BUILT_FOR, PROVEN, [...covering(), failRow(firstOf('P-2'))]) });
  assert.equal(s.state, 'Blocked');
  assert.equal(s.lastError, 'FE-TX-004');
  assert.deepEqual(s.failed.map((f) => f.id), [firstOf('P-2')], 'the diff view must carry only the failures');

  const back = reduce(s, { type: 'edit' });
  assert.equal(back.state, 'Draft');
  assert.deepEqual(back.failed, []);
  assert.ok(back.prep, 'form state was lost — that is how people learn to click through warnings');
});

test('preconditions read at different blocks cannot authorise a signature (INV-FE-2)', () => {
  // Not a precondition failure — a defect in how the batch was read. Passing it would
  // certify a conjunction that was never simultaneously true.
  const elsewhere: PreconditionResult = {
    ...okRow(firstOf('P-3')),
    at: { chain: TEST_CHAIN, blockHash: `0x${'99'.repeat(32)}`, blockNumber: 101 },
  };
  const outcome = gate(PREP, PIN, BUILT_FOR, PROVEN, [...covering(), elsewhere]);
  assert.equal(outcome.kind, 'blocked');
  assert.deepEqual(outcome.failed.map((f) => f.id), [firstOf('P-3')]);
  assert.match(outcome.detail, /does not describe one state/);
});

test('InBestBlock is not success: retraction and dropping are both live edges', () => {
  const edges = new Set(txTransitionEdges().map(([f, t]) => `${f}>${t}`));
  assert.ok(edges.has('InBestBlock>Finalized'));
  assert.ok(edges.has('InBestBlock>Retracted'), 'a transaction that went backwards has nowhere to go');
  assert.ok(edges.has('InBestBlock>Dropped'));
  const terminals = ['Finalized', 'Dropped', 'Retracted'] as const satisfies readonly TxState[];
  for (const terminal of terminals) {
    assert.ok(TX_TERMINAL_STATES.has(terminal));
    assert.equal(reduce({ ...INITIAL_TX_SESSION, state: terminal }, { type: 'edit' }).state, terminal);
  }
});

test('a precondition is evaluated from a finalized read and reports both sides', () => {
  // Rule 3: expected and actual both render. A gate that reported only "failed" leaves the
  // user unable to tell a stale form from a moved chain.
  const row: PreconditionRow<bigint> = {
    id: 'P-1/the account holds at least the trade cost',
    requirement: 'the account holds at least the trade cost',
    source: { kind: 'storage', key: '0xdead', query: 'value' },
    satisfiedBy: (v: bigint) => v >= 1000n,
    expected: () => '>= 1000',
  };
  const result = evaluate(row, finalize(999n, PIN));
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
  const window = windowOf(session);
  const signed = await signer.sign({ prep: PREP, window, account: '5Grw' });
  assert.equal(signed.signerId, 'mock');
  assert.equal(signer.seen.length, 1);
  const seen = signer.seen[0];
  assert.ok(seen, 'the signer recorded no request');
  assert.equal(seen.window.at.blockHash, PIN.blockHash);
  // Anti-substitution (11 §11.3): the bytes that reach the signer are `prep.scaleHex`.
  assert.equal(seen.prep.scaleHex, PREP.scaleHex);
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
  const window = windowOf(toAwaitingSignature());
  return Promise.all([
    signer.sign({ prep: PREP, window, account: '5Grw' }),
    signer.sign({ prep: { ...PREP, scaleHex: '0x0403ddeeff' }, window, account: '5Grw' }),
    signer.sign({ prep: PREP, window, account: '5Fbc' }),
  ]).then(([a, b, c]) => {
    assert.notEqual(a.signatureHex, b.signatureHex, 'different bytes produced the same signature');
    assert.notEqual(a.signatureHex, c.signatureHex, 'different accounts produced the same signature');
  });
});
