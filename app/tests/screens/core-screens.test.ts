/**
 * S5, S6, S7 and S8 — the four core screens of F7b — plus S2's missing `decision_stats` read.
 *
 * Every screen here is a way to state something false with entirely genuine chain bytes, so
 * almost nothing below is a happy path. The claims that carry the suite:
 *
 * * **S5** keys its rate limit and its bond to the **funder** (11 §11.5 P-10), admits a
 *   withdrawal from **either** identity (P-11), and states the condition it cannot read
 *   rather than passing it silently or blocking on it.
 * * **S6** renders **fourteen** rows, never thirteen: the dead-man latch and the triggering
 *   freeze are separate because the expedited lane waives one and not the other, and an
 *   unread row is a third verdict rather than a pass.
 * * **S7** cannot render a version for a chain with no active MetricSpec, and cannot present
 *   an unsampled epoch as a clean one.
 * * **S8** cannot render a welfare score for a voided cohort, and says so when a ring is full.
 * * **S2's** `decided` arm is now reachable **from a read** rather than only from a fixture.
 *
 * The spec claims are parsed out of docs 11, 02 and 05 at test time, with an anti-vacuity
 * check on every slice: a regex that matched nothing would make its test pass for want of
 * contradicting text, which is the failure a document-bound test exists to avoid.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement as h } from 'react';

import { finalize } from '@bleavit/chain-client/testing';
import type { Finalized, FinalizedBlockRef, StorageItem } from '@bleavit/chain-client';
import type { HexString, Verified } from '@bleavit/shared-types';
import { PENDING_SCREENS } from '@bleavit/application';
import {
  BASELINE_BOOK_COPY,
  EXECUTION_OUTCOME_COPY,
  ExecutionQueue,
  FIXED_DECIMALS,
  GATE_READING_COPY,
  PROPOSAL_READS,
  QUEUE_READS,
  RAW_SCALAR_NOTE,
  RecentSettlements,
  SETTLEMENT_READS,
  SUBMIT_READS,
  SUBMIT_SLASH_WARNING,
  SubmitProposal,
  UNREADABLE_SUBMIT_CONDITIONS,
  VOIDED_COHORT_COPY,
  WELFARE_READS,
  WITHDRAW_IDENTITIES,
  WelfareDashboard,
  WithdrawProposal,
  WrongSubjectError,
  assertOnePin,
  baselineBookState,
  checkSubmit,
  cohortRow,
  executeBlocks,
  executeChecks,
  funderReads,
  gateReading,
  gatesOf,
  mandateEnded,
  mayExecute,
  maySubmit,
  mayWithdrawProposal,
  readBaselineBookPresent,
  readExecutionQueue,
  readProposals,
  readSettlements,
  readSubmitInputs,
  readWelfare,
  ringCaveat,
  ringFull,
  snapshotWindowFull,
  submitCaveat,
  viewFor,
  windowStateFor,
  withdrawProposalBlocks,
} from '@bleavit/features-tx';
import type {
  BatchBoundsInputs,
  CohortRecord,
  CoreDecoders,
  CoreKeys,
  CoreReader,
  Decoded,
  ExecuteInputs,
  PreimageState,
  ProposalArgs,
  ProposalDecoders,
  ProposalsReader,
  SettlementsView,
  SubmitInputs,
  WelfareCurrentRecord,
  WelfareDashboardModel,
  WithdrawProposalInputs,
} from '@bleavit/features-tx';

// ------------------------------------------------------------------- fixtures

const here = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(here, '../../..');
const DOC_02 = resolve(REPO, 'docs/architecture/02-integration-contract.md');
const DOC_05 = resolve(REPO, 'docs/architecture/05-welfare-and-decision-engine.md');
const DOC_11 = resolve(REPO, 'docs/architecture/11-frontend-workflows.md');

const CHAIN: HexString = `0x${'ce'.repeat(32)}`;
const BLOCK: HexString = `0x${'11'.repeat(32)}`;
const OTHER_BLOCK: HexString = `0x${'22'.repeat(32)}`;
const AT: FinalizedBlockRef = { chain: CHAIN, blockHash: BLOCK, blockNumber: 900_000 };

/**
 * A `Verified<T>` fixture at the pinned block.
 *
 * `Verified<T>` carries no brand — screens display it, they do not authorise on it — so a
 * plain object is the right fixture. The annotation is what keeps `kind` from widening to
 * `string` and matching nothing.
 */
const v = <T,>(value: T, blockHash: HexString = BLOCK): Verified<T> => ({
  value,
  status: { kind: 'verified-finalized', chain: CHAIN, blockHash, blockNumber: 900_000 },
});

/** A slice of a document, with the anti-vacuity check every parse here owes. */
function slice(path: string, from: string, to: string, atLeast = 400): string {
  const doc = readFileSync(path, 'utf8');
  const start = doc.indexOf(from);
  assert.notEqual(start, -1, `"${from}" is no longer in ${path}; this binding must be re-pointed`);
  const end = doc.indexOf(to, start + from.length);
  assert.notEqual(end, -1, `"${to}" is no longer in ${path}; this binding must be re-pointed`);
  const body = doc.slice(start, end);
  assert.ok(body.length >= atLeast, `the slice from "${from}" is ${body.length} chars — it found nothing`);
  return body;
}

/** Copy a function was expected to produce, or a throw naming the silence. */
const copy = (text: string | undefined, what: string): string => {
  assert.ok(text, `expected ${what}; got nothing, which renders as no warning at all`);
  return text;
};

/** Source with comments removed, for the assertions made by **absence**. */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

// ============================================================ S5 — submit / withdraw

const PREIMAGE_HASH = `0x${'ab'.repeat(32)}`;

const PREIMAGE: PreimageState = {
  declaredHash: PREIMAGE_HASH,
  declaredLen: 128,
  bytesHash: PREIMAGE_HASH,
  bytesLen: 128,
  noted: v(true),
  requested: v(true),
};

function submitInputs(patch: Partial<SubmitInputs> = {}): SubmitInputs {
  return {
    phase: v('Intake'),
    intakeQueueLen: v(3),
    maxIntakeQueue: v(64),
    maxPerAccount: v(2),
    funder: 'FUNDER',
    funderReads: funderReads('FUNDER', {
      entriesThisEpoch: undefined,
      freeBalance: v(10_000_000_000n),
    }),
    classBond: v(1_000_000_000n),
    preimage: PREIMAGE,
    resourcesMatchFootprint: v(true),
    ...patch,
  };
}

test('S5 checks the clauses 11 §11.5 P-10 states, and P-10 is what names them', () => {
  const row = slice(DOC_11, '| P-10 | `epoch.submit`', '\n| P-11 |', 600);
  // Each fragment is doc 11's own wording. If the row is rewritten, this fails rather than
  // letting the client keep checking a rule the spec no longer states.
  assert.match(row, /`Epoch\.EpochOf\.phase == Intake`/);
  assert.match(row, /the \*\*funder's\*\* intake entries this epoch < `intake\.max_per_account`/);
  assert.match(row, /keyed to the \*\*funder\*\*, not the caller or the author/);
  assert.match(row, /class bond balance/);
  assert.match(
    row,
    /preimage noted with matching hash \+ len \*\*and pinned via `preimage\.request_preimage`\*\*/,
  );
  assert.match(row, /resource-domain validity/);

  // And each check exists, one refusal at a time, from a base case that passes.
  assert.deepEqual(checkSubmit(submitInputs()).blocks, []);
  const named = (patch: Partial<SubmitInputs>): readonly string[] =>
    checkSubmit(submitInputs(patch)).blocks.map((block) => block.check);
  assert.deepEqual(named({ phase: v('Trade') }), ['P-10 epoch phase']);
  assert.deepEqual(named({ intakeQueueLen: v(64) }), ['P-10 intake queue']);
  assert.deepEqual(named({ classBond: v(10_000_000_001n) }), ['P-10 class bond']);
  assert.deepEqual(named({ preimage: { ...PREIMAGE, noted: v(false) } }), ['P-10 preimage noted']);
  assert.deepEqual(named({ preimage: { ...PREIMAGE, requested: v(false) } }), [
    'P-10 preimage pinned',
  ]);
  assert.deepEqual(named({ resourcesMatchFootprint: v(false) }), ['P-10 resource domains']);
});

test('the intake reads are keyed to the funder, and another account’s are refused', () => {
  // The defect the brand exists for: a proposal may be authored by one account and funded by
  // another (02 §4's `ProposalSummaryView.funder`), so "count this account's entries" has
  // three plausible answers. Supplying the wrong one is not a block — it is a composition
  // defect, and rendering it as a refusal would tell the user their bond is short when what
  // happened is that the client checked somebody else's.
  assert.throws(
    () =>
      checkSubmit(
        submitInputs({
          funderReads: funderReads('AUTHOR', {
            entriesThisEpoch: v(0),
            freeBalance: v(10_000_000_000n),
          }),
        }),
      ),
    WrongSubjectError,
  );
  // The same reads under the right subject pass, so the throw is about the identity and not
  // about the values.
  assert.equal(
    maySubmit(
      submitInputs({
        funderReads: funderReads('FUNDER', {
          entriesThisEpoch: v(0),
          freeBalance: v(10_000_000_000n),
        }),
      }),
    ),
    true,
  );
});

test('the per-funder rate limit is uncheckable, never quietly passed or blocked', () => {
  // The finding is about the contract rather than about this module: no frozen surface
  // answers "how many intake entries does this funder have". Blocking would refuse a lawful
  // submission on the client's own authority; passing would present an unperformed check as
  // a performed one.
  const check = checkSubmit(submitInputs());
  assert.deepEqual(check.blocks, []);
  assert.deepEqual([...check.uncheckable], [...UNREADABLE_SUBMIT_CONDITIONS]);
  assert.equal(maySubmit(submitInputs()), true);
  const caveat = copy(submitCaveat(check), 'the uncheckable-condition caveat');
  assert.match(caveat, /IntakeRateLimited/);
  assert.match(caveat, /the bond is not taken — but the fee is spent/);

  // With the count readable the condition leaves `uncheckable` entirely and becomes an
  // ordinary row — in both directions.
  const under = checkSubmit(
    submitInputs({
      funderReads: funderReads('FUNDER', {
        entriesThisEpoch: v(1),
        freeBalance: v(10_000_000_000n),
      }),
    }),
  );
  assert.deepEqual(under.uncheckable, []);
  assert.deepEqual(under.blocks, []);
  assert.equal(submitCaveat(under), undefined);

  const atLimit = checkSubmit(
    submitInputs({
      funderReads: funderReads('FUNDER', {
        entriesThisEpoch: v(2),
        freeBalance: v(10_000_000_000n),
      }),
    }),
  );
  assert.deepEqual(
    atLimit.blocks.map((block) => block.check),
    ['P-10 per-funder rate limit'],
  );
  assert.deepEqual(atLimit.uncheckable, []);
});

test('an unread precondition blocks; it is never folded into a passing one', () => {
  // `undefined` is *this client did not read it*. An `intakeQueueLen` of 0 means "submit
  // away", and a failed read of the same item must not say that.
  for (const patch of [{ phase: undefined }, { intakeQueueLen: undefined }] as const) {
    const blocks = checkSubmit(submitInputs(patch)).blocks;
    assert.equal(blocks.length, 1, JSON.stringify(patch));
    assert.match(copy(blocks[0]?.detail, 'the unread detail'), /not read/);
  }
  // An unclassifiable payload is not a matching one. 05 §1.4 makes an unclassifiable batch a
  // cancellation carrying the whole bond, so "not checked" must never render as "fine".
  const unclassifiable = checkSubmit(submitInputs({ resourcesMatchFootprint: undefined })).blocks;
  assert.deepEqual(
    unclassifiable.map((block) => block.check),
    ['P-10 resource domains'],
  );
  assert.match(copy(unclassifiable[0]?.detail, 'the detail'), /could not derive/);
});

test('every failing row is returned, not only the first (§11.4 rule 5’s diff)', () => {
  const blocks = checkSubmit(
    submitInputs({
      phase: v('Decide'),
      intakeQueueLen: v(64),
      classBond: v(10_000_000_001n),
      resourcesMatchFootprint: v(false),
    }),
  ).blocks;
  assert.deepEqual(
    blocks.map((block) => block.check),
    ['P-10 epoch phase', 'P-10 intake queue', 'P-10 class bond', 'P-10 resource domains'],
  );
});

test('the preimage hash and length are compared, not trusted', () => {
  // §11.5's `execute` row 3 re-hashes at dispatch time; a proposal whose committed hash never
  // described its own payload cannot execute however far it gets, so S5 says so first.
  assert.deepEqual(
    checkSubmit(submitInputs({ preimage: { ...PREIMAGE, bytesHash: `0x${'cd'.repeat(32)}` } }))
      .blocks.map((block) => block.check),
    ['P-10 preimage hash'],
  );
  assert.deepEqual(
    checkSubmit(submitInputs({ preimage: { ...PREIMAGE, bytesLen: 129 } })).blocks.map(
      (block) => block.check,
    ),
    ['P-10 preimage length'],
  );
});

test('the two 10 % slashes are frozen copy and the "full refund" wording is gone', () => {
  const row = slice(DOC_11, '| P-10 | `epoch.submit`', '\n| P-11 |', 600);
  assert.match(row, /preimage-missing cancellation slashes 10% of the bond/);
  assert.match(row, /non-decision-grade outcomes slash 10% \(to INSURANCE\)/);
  assert.match(row, /the old "full refund" copy is removed/);

  assert.match(SUBMIT_SLASH_WARNING.preimageMissing, /10% of the bond is slashed/);
  assert.match(SUBMIT_SLASH_WARNING.nonDecisionGrade, /INSURANCE/);
  // The removed copy must not have come back anywhere in the module. Comments are stripped
  // first: the module quotes the spec's own "the old 'full refund' copy is removed", and a
  // raw-text scan reports the sentence explaining the absence as the thing itself.
  assert.doesNotMatch(
    stripComments(readFileSync(resolve(REPO, 'app/src/features/tx/src/submit-proposal.ts'), 'utf8')),
    /full refund/i,
  );
});

test('the slash warning renders on the clean path, where the user decides to sign', () => {
  // A warning shown only when something else is already wrong is a warning that never reaches
  // the person it is for.
  const html = renderToStaticMarkup(
    h(SubmitProposal, {
      inputs: submitInputs(),
      decimals: 6,
      symbol: 'USDC',
      onSubmit: () => {},
    }),
  );
  assert.ok(!/notice--danger/.test(html), `the clean path rendered a refusal: ${html}`);
  assert.ok(html.includes(SUBMIT_SLASH_WARNING.preimageMissing), 'the preimage slash is not on screen');
  assert.ok(html.includes(SUBMIT_SLASH_WARNING.nonDecisionGrade), 'the outcome slash is not on screen');
  // And the uncheckable condition is stated on the clean path too, for the same reason.
  assert.ok(html.includes('IntakeRateLimited'), 'the unreadable condition hid behind a green form');
  assert.ok(/<button[^>]*>Submit proposal<\/button>/.test(html), html);
  assert.ok(!/ disabled=""/.test(html), 'a passing form disabled its own button');
});

test('a blocked submission disables the button and names why', () => {
  const html = renderToStaticMarkup(
    h(SubmitProposal, {
      inputs: submitInputs({ phase: v('Trade') }),
      decimals: 6,
      symbol: 'USDC',
      onSubmit: () => {},
    }),
  );
  assert.ok(/ disabled=""/.test(html), `a blocked form left its button live: ${html}`);
  assert.ok(html.includes('P-10 epoch phase'), html);
  // The warning is still there — being blocked does not remove the bond consequences.
  assert.ok(html.includes(SUBMIT_SLASH_WARNING.preimageMissing));
});

function withdrawInputs(patch: Partial<WithdrawProposalInputs> = {}): WithdrawProposalInputs {
  return {
    state: v('Submitted'),
    beforeQualify: v(true),
    proposer: v('AUTHOR'),
    funder: v('FUNDER'),
    caller: 'AUTHOR',
    ...patch,
  };
}

test('P-11 admits the proposer and the funder, and no third account', () => {
  const row = slice(DOC_11, '| P-11 | `epoch.withdraw`', '\n| P-12 |', 300);
  assert.match(row, /caller is the proposer \*\*or the funder\*\*/);
  assert.match(row, /A row written to the narrower reading refuses a lawful withdrawal/);
  assert.deepEqual([...WITHDRAW_IDENTITIES], ['proposer', 'funder']);

  // Both identities, since this is the one row here whose failure direction is
  // over-strictness — a client refusing what the runtime accepts.
  assert.equal(mayWithdrawProposal(withdrawInputs({ caller: 'AUTHOR' })), true);
  assert.equal(mayWithdrawProposal(withdrawInputs({ caller: 'FUNDER' })), true);
  assert.deepEqual(
    withdrawProposalBlocks(withdrawInputs({ caller: 'SOMEONE_ELSE' })).map((block) => block.check),
    ['P-11 caller identity'],
  );
});

test('withdrawal closes at Qualify and outside the Submitted state', () => {
  assert.deepEqual(
    withdrawProposalBlocks(withdrawInputs({ state: v('Trading') })).map((block) => block.check),
    ['P-11 proposal state'],
  );
  assert.deepEqual(
    withdrawProposalBlocks(withdrawInputs({ beforeQualify: v(false) })).map((block) => block.check),
    ['P-11 before Qualify'],
  );
  const html = renderToStaticMarkup(
    h(WithdrawProposal, { inputs: withdrawInputs({ caller: 'FUNDER' }), onWithdraw: () => {} }),
  );
  assert.ok(!/ disabled=""/.test(html), 'the funder was refused a lawful withdrawal');
});

// ================================================================ S6 — execute

const BOUNDS: BatchBoundsInputs = {
  decodable: v(true),
  callCount: v(3),
  maxCalls: v(16),
  payloadBytes: v(4_096),
  maxPayloadBytes: v(65_536),
  declaredWeightWithinLimit: v(true),
  safetyFilterClosed: v(true),
};

function executeInputs(patch: Partial<ExecuteInputs> = {}): ExecuteInputs {
  return {
    klass: v('Code'),
    queued: v(true),
    cancelled: v(false),
    now: v(1_000),
    maturity: v(500),
    graceEnd: v(2_000),
    preimagePresent: v(true),
    preimageHashMatches: v(true),
    runtimeVersionMatches: v(true),
    ratification: v('Passed'),
    attestationRecordsIntact: v(true),
    capability: { domainsWithinDeclared: v(true), rulesAdmitClass: v(true) },
    metersClear: v(true),
    resourceLocks: { declared: v(['treasury']), held: v(['treasury', 'code']) },
    suspension: { suspendedForEpoch: undefined, currentEpoch: v(9), delayedOnce: v(false) },
    hardGateBreach: v(false),
    deadMan: { guardLatch: v(false), phaseFlagBit: v(false) },
    triggeringFreeze: { ledgerFrozen: v(false), migrationHalt: v(false), expedited: v(false) },
    batchBounds: BOUNDS,
    ...patch,
  };
}

/** The 14 check ids doc 11 §11.5 numbers, parsed rather than typed. */
function declaredExecuteChecks(): readonly { readonly id: number; readonly name: string }[] {
  const table = slice(
    DOC_11,
    '### `execution_guard.execute` — the complete precondition row',
    'The FE renders each of the 14 checks',
    1_500,
  );
  const rows = [...table.matchAll(/^\| (\d+)\. (.+?) \| /gm)].map((match) => ({
    id: Number(match[1]),
    name: (match[2] ?? '').replace(/\*\*/g, ''),
  }));
  assert.equal(rows.length, 14, `parsed ${rows.length} checks out of the §11.5 execute table`);
  return rows;
}

test('S6 renders every check doc 11 §11.5 numbers, at its own number', () => {
  const declared = declaredExecuteChecks();
  const rows = executeChecks(executeInputs());
  assert.equal(rows.length, 14);
  assert.deepEqual(
    rows.map((row) => row.id),
    declared.map((row) => row.id),
  );
  // The obligation is "each of the 14 checks as a named row with expected/actual", so every
  // row owes both halves — a blank one renders as a check that was never described.
  for (const row of rows) {
    assert.ok(row.check.length > 0, `row ${row.id} has no name`);
    assert.ok(row.expected.length > 0, `row ${row.id} states no expectation`);
    assert.ok(row.actual.length > 0, `row ${row.id} states no reading`);
  }
  // Row 12 and row 13 are separate rows, which is the whole of the 2026-08-05 split.
  assert.match(declared[11]?.name ?? '', /Dead-man freeze/);
  assert.match(declared[12]?.name ?? '', /Triggering freeze/);
  assert.match(rows.find((row) => row.id === 12)?.check ?? '', /Dead-man/);
  assert.match(rows.find((row) => row.id === 13)?.check ?? '', /Triggering freeze/);
});

test('doc 11 states the split this module is built on, in its own words', () => {
  const table = slice(
    DOC_11,
    '### `execution_guard.execute` — the complete precondition row',
    '**`DescriptorLeadTime` is not an `execute` precondition',
    2_000,
  );
  assert.match(table, /The D-9 expedited lane does \*\*not\*\* reach this row/);
  assert.match(
    table,
    /The waiver is over the \*\*conjunction\*\*: expedited clears both, and neither clears the other/,
  );
  assert.match(table, /A single row cannot carry both/);
  assert.match(table, /MUST NOT present a pre-grace failure as terminal/);
});

test('the dead-man latch is never waived by the expedited marker', () => {
  // The one latch D-9 makes unconditional. A client that let the exemption satisfy it would
  // offer a signature the runtime refuses, on exactly the check that exists to be unwaivable.
  for (const latch of [
    { guardLatch: v(true), phaseFlagBit: v(false) },
    { guardLatch: v(false), phaseFlagBit: v(true) },
    { guardLatch: v(true), phaseFlagBit: v(true) },
  ]) {
    const row = executeChecks(
      executeInputs({
        deadMan: latch,
        triggeringFreeze: { ledgerFrozen: v(false), migrationHalt: v(false), expedited: v(true) },
      }),
    ).find((entry) => entry.id === 12);
    assert.equal(row?.verdict, 'fail', JSON.stringify(latch));
    assert.equal(row?.code, 'FreezeActive');
    assert.equal(mayExecute(executeInputs({ deadMan: latch })), false);
  }
});

test('the expedited marker waives the triggering freeze, over the conjunction', () => {
  for (const freeze of [
    { ledgerFrozen: v(true), migrationHalt: v(false) },
    { ledgerFrozen: v(false), migrationHalt: v(true) },
    { ledgerFrozen: v(true), migrationHalt: v(true) },
  ]) {
    const blocked = executeChecks(
      executeInputs({ triggeringFreeze: { ...freeze, expedited: v(false) } }),
    ).find((row) => row.id === 13);
    assert.equal(blocked?.verdict, 'fail', JSON.stringify(freeze));
    assert.equal(blocked?.code, 'FreezeActive');

    const waived = executeChecks(
      executeInputs({ triggeringFreeze: { ...freeze, expedited: v(true) } }),
    ).find((row) => row.id === 13);
    // Reporting this as a block would refuse the emergency upgrade the lane exists to admit.
    assert.equal(waived?.verdict, 'pass', JSON.stringify(freeze));
    assert.match(waived?.actual ?? '', /expedited marker, which waives it/);
  }
});

test('an unread row is a third verdict, and it blocks', () => {
  // INV-FE-12: an unproven capability is absent, and absence disables the dependent surface
  // with a named reason. Every input is required-and-nullable so a caller cannot omit one and
  // receive a green row.
  const nullable: readonly (keyof ExecuteInputs)[] = [
    'queued',
    'cancelled',
    'now',
    'maturity',
    'graceEnd',
    'preimagePresent',
    'preimageHashMatches',
    'runtimeVersionMatches',
    'ratification',
    'attestationRecordsIntact',
    'capability',
    'metersClear',
    'resourceLocks',
    'suspension',
    'hardGateBreach',
    'deadMan',
    'triggeringFreeze',
    'batchBounds',
  ];
  for (const field of nullable) {
    const rows = executeChecks(executeInputs({ [field]: undefined }));
    const unread = rows.filter((row) => row.verdict === 'unread');
    assert.ok(unread.length > 0, `dropping ${field} produced no unread row`);
    for (const row of unread) {
      assert.match(row.actual, /did not perform the read/);
      // An unread row carries no dispatch code: the runtime returned nothing, so claiming one
      // would attribute a refusal to a chain that never made it.
      assert.equal(row.code, undefined, `unread row ${row.id} claims a dispatch error`);
    }
    assert.equal(mayExecute(executeInputs({ [field]: undefined })), false, field);
  }
  // Row 6 is the one exception, and by class rather than by omission: a non-attested class
  // passes it whether or not the read happened.
  const param = executeChecks(
    executeInputs({ klass: v('Param'), attestationRecordsIntact: undefined }),
  ).find((row) => row.id === 6);
  assert.equal(param?.verdict, 'pass');
  assert.match(param?.actual ?? '', /not applicable to class Param/);
});

test('a pre-grace refusal blocks without being terminal; past grace, everything is', () => {
  // §11.5 row 5: `NotRatified` before `grace_end` leaves the proposal Queued and retryable,
  // and the FE MUST NOT present it as terminal — the ratification panel stays actionable.
  const pending = executeInputs({ ratification: v('NoPassedRecord') });
  const row = executeChecks(pending).find((entry) => entry.id === 5);
  assert.equal(row?.verdict, 'fail');
  assert.equal(row?.code, 'NotRatified');
  assert.equal(row?.terminal, false, 'a pre-grace ratification failure was presented as terminal');
  assert.match(row?.actual ?? '', /stays retryable until grace_end/);
  assert.equal(mayExecute(pending), false, 'the client must still block pre-sign');
  assert.equal(mandateEnded(pending), false);

  // Past `grace_end` the same reading is terminal, because `execute` is unreachable at all.
  const expired = executeInputs({ ratification: v('NoPassedRecord'), now: v(2_001) });
  const expiredRow = executeChecks(expired).find((entry) => entry.id === 5);
  assert.equal(expiredRow?.terminal, true);
  assert.match(expiredRow?.actual ?? '', /the grace window has closed/);
  assert.equal(mandateEnded(expired), true);
});

test('an in-window malformed payload is terminal even though the state reads Queued', () => {
  // 09 §1.2 item 11: the dispatch errors, so the proposal keeps reading `Queued` while being
  // permanently unexecutable. Presenting it as live is the failure that rule names.
  const row = executeChecks(
    executeInputs({ batchBounds: { ...BOUNDS, decodable: v(false) } }),
  ).find((entry) => entry.id === 14);
  assert.equal(row?.verdict, 'fail');
  assert.equal(row?.terminal, true);
  assert.match(row?.actual ?? '', /This is permanent/);
  // A committed hash that never described its own payload is the same shape.
  assert.equal(
    executeChecks(executeInputs({ preimageHashMatches: v(false) })).find((entry) => entry.id === 3)
      ?.terminal,
    true,
  );
});

test('the window is a three-way reading, and each arm reports its own code', () => {
  assert.equal(windowStateFor(499, 500, 2_000), 'before-maturity');
  assert.equal(windowStateFor(500, 500, 2_000), 'open');
  assert.equal(windowStateFor(2_000, 500, 2_000), 'open');
  assert.equal(windowStateFor(2_001, 500, 2_000), 'past-grace');

  const early = executeChecks(executeInputs({ now: v(499) })).find((row) => row.id === 2);
  assert.equal(early?.verdict, 'fail');
  assert.equal(early?.code, 'NotMature');
  assert.equal(early?.terminal, false, 'a mandate that is merely early was called dead');

  assert.equal(
    executeChecks(executeInputs({ now: v(2_001) })).find((row) => row.id === 2)?.terminal,
    true,
  );
});

test('a suspension for a past epoch blocks nothing; one for the current epoch does', () => {
  // `Some(epoch)` is a suspension only when that epoch is the current one (02 §7.8). Reading
  // its mere presence as a suspension refuses an execution the guard would admit.
  const stale = executeChecks(
    executeInputs({
      suspension: { suspendedForEpoch: v(8), currentEpoch: v(9), delayedOnce: v(false) },
    }),
  ).find((row) => row.id === 10);
  assert.equal(stale?.verdict, 'pass');

  const live = executeChecks(
    executeInputs({
      suspension: { suspendedForEpoch: v(9), currentEpoch: v(9), delayedOnce: v(false) },
    }),
  ).find((row) => row.id === 10);
  assert.equal(live?.verdict, 'fail');
  assert.equal(live?.code, 'GateSuspended');

  const held = executeChecks(
    executeInputs({
      suspension: { suspendedForEpoch: undefined, currentEpoch: v(9), delayedOnce: v(true) },
    }),
  ).find((row) => row.id === 10);
  assert.equal(held?.verdict, 'fail');
  assert.match(held?.actual ?? '', /delay_once/);
});

test('a declared resource domain that is no longer held is named, not counted', () => {
  const row = executeChecks(
    executeInputs({
      resourceLocks: { declared: v(['treasury', 'code', 'meta']), held: v(['treasury']) },
    }),
  ).find((entry) => entry.id === 9);
  assert.equal(row?.verdict, 'fail');
  assert.equal(row?.code, 'ResourceLockMissing');
  assert.match(row?.actual ?? '', /code, meta/);
  // Held-but-undeclared is not a failure: the guard checks the declared set is still held,
  // not that nothing else is.
  assert.equal(
    executeChecks(executeInputs({ resourceLocks: { declared: v([]), held: v(['treasury']) } })).find(
      (entry) => entry.id === 9,
    )?.verdict,
    'pass',
  );
});

test('the meters row is the chain’s answer, and its copy says what that answers', () => {
  const clear = executeChecks(executeInputs()).find((row) => row.id === 8);
  assert.equal(clear?.verdict, 'pass');
  assert.match(clear?.actual ?? '', /does not predict that dispatch succeeds/);
  const blocked = executeChecks(executeInputs({ metersClear: v(false) })).find((row) => row.id === 8);
  assert.equal(blocked?.code, 'MeterExceeded');
  assert.equal(blocked?.terminal, false, 'a meter block within grace is not the end of a mandate');
});

test('each batch bound is checked against a chain-read limit, one row at a time', () => {
  const cases: readonly [Partial<BatchBoundsInputs>, RegExp][] = [
    [{ callCount: v(17) }, /17 calls and the limit is 16/],
    [{ payloadBytes: v(65_537) }, /65537 bytes and the limit is 65536/],
    [{ declaredWeightWithinLimit: v(false) }, /declared weight exceeds/],
    [{ safetyFilterClosed: v(false) }, /nested wrapper/],
  ];
  for (const [patch, expected] of cases) {
    const row = executeChecks(executeInputs({ batchBounds: { ...BOUNDS, ...patch } })).find(
      (entry) => entry.id === 14,
    );
    assert.equal(row?.verdict, 'fail', JSON.stringify(patch));
    assert.match(row?.actual ?? '', expected);
  }
  // At the bound rather than over it, both pass: the runtime's own test is `>`.
  assert.equal(
    executeChecks(
      executeInputs({ batchBounds: { ...BOUNDS, callCount: v(16), payloadBytes: v(65_536) } }),
    ).find((entry) => entry.id === 14)?.verdict,
    'pass',
  );
});

test('every failing dispatch row carries the code the runtime would return', () => {
  // "any failure blocks with the same reason code the runtime would return" — a row that
  // blocked without one would leave the user unable to match the client's refusal to the
  // chain's.
  const broken = executeInputs({
    queued: v(false),
    now: v(300),
    preimagePresent: v(false),
    runtimeVersionMatches: v(false),
    ratification: v('NoPassedRecord'),
    attestationRecordsIntact: v(false),
    capability: { domainsWithinDeclared: v(false), rulesAdmitClass: v(true) },
    metersClear: v(false),
    resourceLocks: { declared: v(['a']), held: v([]) },
    suspension: { suspendedForEpoch: v(9), currentEpoch: v(9), delayedOnce: v(false) },
    hardGateBreach: v(true),
    deadMan: { guardLatch: v(true), phaseFlagBit: v(false) },
    triggeringFreeze: { ledgerFrozen: v(true), migrationHalt: v(false), expedited: v(false) },
    batchBounds: { ...BOUNDS, decodable: v(false) },
  });
  const blocking = executeBlocks(broken);
  assert.equal(blocking.length, 14, 'every row of this fixture blocks');
  for (const row of blocking) {
    assert.equal(row.verdict, 'fail', `row ${row.id}`);
    assert.ok(row.code !== undefined, `row ${row.id} blocks with no dispatch code`);
  }
  assert.equal(mayExecute(broken), false);
});

test('S6 renders the whole table, and a non-terminal block is not dressed as a dead one', () => {
  const entry = {
    pid: v('7'),
    klass: v('Code'),
    payloadHash: v(PREIMAGE_HASH),
    maturity: v(500),
    graceEnd: v(2_000),
    ratification: v('NoPassedRecord'),
    metersClear: v(true),
  };
  const html = renderToStaticMarkup(
    h(ExecutionQueue, {
      entry,
      inputs: executeInputs({ ratification: v('NoPassedRecord') }),
      onExecute: () => {},
    }),
  );
  // All fourteen rows, passing ones included — a table of expected against actual.
  for (let id = 1; id <= 14; id += 1) {
    assert.ok(html.includes(`<td>${id}</td>`), `row ${id} is not in the rendered table`);
  }
  assert.ok(/data-severity="caution"/.test(html), 'the pre-grace block was not rendered as a wait');
  assert.ok(!/data-severity="danger"/.test(html), `a retryable mandate was rendered as dead: ${html}`);
  assert.ok(html.includes('blocked, not finished'), html);
  assert.ok(/ disabled=""/.test(html), 'a blocked mandate offered its execute button');

  // Past grace the same reading is danger, and the reassurance is gone.
  const dead = renderToStaticMarkup(
    h(ExecutionQueue, {
      entry,
      inputs: executeInputs({ ratification: v('NoPassedRecord'), now: v(2_001) }),
      onExecute: () => {},
    }),
  );
  assert.ok(/data-severity="danger"/.test(dead), 'an ended mandate was rendered as a wait');
  assert.ok(!dead.includes('blocked, not finished'), 'an ended mandate was called retryable');
});

// ================================================================ S7 — welfare

function dashboard(patch: Partial<WelfareDashboardModel> = {}): WelfareDashboardModel {
  return {
    pillars: {
      epoch: v(9),
      sPillar1e9: v(900_000_000n),
      cOnchain1e9: v(800_000_000n),
      cAttested1e9: v(700_000_000n),
      pPillar1e9: v(600_000_000n),
      aPillar1e9: v(500_000_000n),
      gateS1e9: v(1_000_000_000n),
      gateC1e9: v(1_000_000_000n),
      wCurrent1e9: v(400_000_000n),
    },
    activeSpec: { available: true, version: v(3) },
    sGate: 'no-breach-so-far',
    cGate: 'no-breach-so-far',
    reserveFlag: v(false),
    snapshots: [{ epoch: v(9), specVersion: v(3), w1e9: v(400_000_000n) }],
    snapshotBound: v(60),
    params: [
      {
        key: v('mkt.fee'),
        value: v(3_000_000n),
        min: v(0n),
        max: v(10_000_000n),
        minNext: v(1_500_000n),
        maxNext: v(6_000_000n),
        cooldownBlocks: v(201_600),
        lastChange: v(100),
        klass: v('Param'),
      },
    ],
    ...patch,
  };
}

test('a chain with no active MetricSpec has nowhere to put a version', () => {
  // 02 §4: `spec_version` is meaningful only under `active_spec_available`, and a selected
  // version of zero is legal. The tempting shape renders "MetricSpec v0" for a chain that has
  // no active spec at all — a truthful-looking label over an absent fact.
  const doc = readFileSync(DOC_02, 'utf8');
  assert.match(
    doc,
    /`WelfareView\.spec_version` is meaningful only when `active_spec_available == true`/,
  );
  assert.match(doc, /A selected `MetricSpecVersion` of zero is legal and MUST still set/);

  const html = renderToStaticMarkup(
    h(WelfareDashboard, { dashboard: dashboard({ activeSpec: { available: false } }) }),
  );
  assert.ok(html.includes('No unique active MetricSpec'), html);
  assert.ok(!/Active version/.test(html), 'a version was rendered for a chain that has none');
  assert.ok(html.includes('Active version') === false, html);

  assert.ok(
    renderToStaticMarkup(h(WelfareDashboard, { dashboard: dashboard() })).includes('Active version'),
    'the available arm renders no version either',
  );
});

test('an unsampled epoch and a clean one are different facts, said differently', () => {
  // 05 §4.7: `day_bitmap` records breached days only, so "no breach recorded" and "nothing
  // recorded" are the same bitmap. Entry presence is the sampling fact.
  const doc = readFileSync(DOC_05, 'utf8');
  assert.match(
    doc,
    /records breached days only, so "no breach recorded" and "nothing recorded" are the same bitmap/,
  );
  assert.match(doc, /entry presence \*\*is\*\* "sampled at least once"/);
  // And the permissive display default survives, which is the half a fail-closed reading
  // would have dropped.
  assert.match(doc, /a not-yet-sampled current epoch legitimately reads "no breach so far"/);

  assert.equal(gateReading(true, true), 'breached');
  assert.equal(gateReading(true, false), 'breached');
  assert.equal(gateReading(false, true), 'no-breach-so-far');
  assert.equal(gateReading(false, false), 'not-sampled');
  assert.notEqual(GATE_READING_COPY['not-sampled'], GATE_READING_COPY['no-breach-so-far']);
  assert.match(GATE_READING_COPY['not-sampled'], /not the same as "no breach"/);
  assert.match(GATE_READING_COPY['no-breach-so-far'], /not about the whole epoch/);
});

test('both gates are called out, because W is a product and not one figure', () => {
  assert.deepEqual(gatesOf(dashboard({ sGate: 'breached', cGate: 'not-sampled' })), [
    { pillar: 'S', reading: 'breached' },
    { pillar: 'C', reading: 'not-sampled' },
  ]);
  const html = renderToStaticMarkup(
    h(WelfareDashboard, { dashboard: dashboard({ sGate: 'breached', cGate: 'not-sampled' }) }),
  );
  assert.ok(html.includes('S gate — breached'), html);
  assert.ok(html.includes('C gate — not-sampled'), html);
  assert.ok(html.includes(GATE_READING_COPY.breached), html);
  assert.ok(/data-severity="danger"/.test(html), 'a breached gate rendered as an ordinary note');
});

test('a params row is the raw stored scalar, and the screen says so', () => {
  // 02 §4 forbids interpreting a `ParamView` scalar as a display unit, and `ParamView`
  // publishes no unit tag — so a converted figure would be a second copy of doc 13's type
  // column, drifting from the one that governs.
  assert.match(
    readFileSync(DOC_02, 'utf8'),
    /These fields MUST NOT be interpreted as the human\/display unit in \[13\]/,
  );

  const html = renderToStaticMarkup(h(WelfareDashboard, { dashboard: dashboard() }));
  assert.ok(html.includes(RAW_SCALAR_NOTE), 'the raw-scalar note is not on screen');
  // The raw Perbill is on screen; the tempting 30 bps / 0.3 % projections are not.
  assert.ok(html.includes('3,000,000'), html);
  assert.ok(!/30 bps|0\.3\s*%/.test(html), `a raw scalar was dressed as a display unit: ${html}`);
  // And nothing on S7 goes through the parts-per-million formatter: the pillars are on the
  // 1e9 grid, so a ppm render is a factor of a thousand in the direction that makes a
  // breached gate look healthy.
  assert.doesNotMatch(
    stripComments(readFileSync(resolve(REPO, 'app/src/features/tx/src/core-screens.tsx'), 'utf8')),
    /\bRatio\b/,
    'S7 reached for the ppm formatter',
  );
  assert.equal(FIXED_DECIMALS, 9, 'the contract grid is 1e9');
});

test('a full snapshot ring is labelled a window, not a history', () => {
  const full = dashboard({
    snapshotBound: v(2),
    snapshots: [
      { epoch: v(9), specVersion: v(3), w1e9: v(4n) },
      { epoch: v(8), specVersion: v(3), w1e9: v(5n) },
    ],
  });
  assert.equal(snapshotWindowFull(full), true);
  assert.equal(snapshotWindowFull(dashboard()), false);
  assert.ok(
    renderToStaticMarkup(h(WelfareDashboard, { dashboard: full })).includes(
      'This is the retained window',
    ),
  );
  assert.ok(
    !renderToStaticMarkup(h(WelfareDashboard, { dashboard: dashboard() })).includes(
      'This is the retained window',
    ),
    'a partial ring claimed to be a window',
  );
});

test('S7 renders no external-book figure, because the model has no field for one', () => {
  // 11 §11.2a rule 3: no external book, position, volume or fee may be rendered as an input
  // to a decision statistic, a gate, a welfare pillar, or NAV. Asserted structurally — the
  // model has nowhere to put one — rather than by a comment.
  assert.match(
    readFileSync(DOC_11, 'utf8'),
    /No external book, position, volume or fee may be rendered as an input to a decision statistic, a gate, a welfare pillar, or NAV\./,
  );
  assert.doesNotMatch(
    stripComments(readFileSync(resolve(REPO, 'app/src/features/tx/src/welfare-dashboard.ts'), 'utf8')),
    /service|external|hosted/i,
    'S7 grew a service-domain field',
  );
});

// ============================================================ S8 — settlements

function cohortRecord(patch: Partial<CohortRecord> = {}): CohortRecord {
  return {
    epoch: v(9),
    s1e9: v(750_000_000n),
    baselineTwap1e9: v(500_000_000n),
    proposals: [{ id: v('7'), klass: v('Treasury'), outcome: v('Adopt') }],
    voided: v(false),
    settledAt: v(880_000),
    ...patch,
  };
}

function settlements(patch: Partial<SettlementsView> = {}): SettlementsView {
  return {
    cohorts: [cohortRow(cohortRecord())],
    cohortRingBound: v(32),
    executions: [
      {
        pid: v('7'),
        payloadHash: v(PREIMAGE_HASH),
        klass: v('Treasury'),
        executedAt: v(890_000),
        succeeded: v(true),
      },
    ],
    executionRingBound: v(256),
    ...patch,
  };
}

test('a voided cohort has no score field at all, and keeps its members’ decisions', () => {
  // 05 §7(4): a voided cohort computes no `s`, so no proposal book settles on one — while
  // `CohortSummary` still carries an `s_1e9` field, because SCALE structs have no absent
  // variants. A screen mapping the struct field-for-field renders a welfare score for a
  // cohort that never computed one.
  const doc = readFileSync(DOC_05, 'utf8');
  assert.match(doc, /VOIDed cohorts skip this section entirely/);
  assert.match(doc, /a voided cohort computes no `s`, so no proposal book settles on one/);

  const voided = cohortRow(cohortRecord({ voided: v(true), s1e9: v(999_999_999n) }));
  assert.equal(voided.kind, 'voided');
  assert.ok(!('s1e9' in voided), 'the voided arm carries a welfare score');
  assert.ok(!('baselineTwap1e9' in voided), 'the voided arm carries a settled TWAP');
  // The per-proposal outcomes are the opposite case and are kept: the archive is the only
  // durable record of what the market concluded.
  assert.equal(voided.proposals.length, 1);
  assert.equal(voided.proposals[0]?.outcome.value, 'Adopt');

  const settled = cohortRow(cohortRecord());
  assert.equal(settled.kind, 'settled');
  assert.equal(settled.kind === 'settled' ? settled.s1e9.value : 0n, 750_000_000n);

  const html = renderToStaticMarkup(
    h(RecentSettlements, {
      view: settlements({ cohorts: [voided] }),
      baselineBooks: { 9: 'live' },
    }),
  );
  assert.ok(html.includes(VOIDED_COHORT_COPY), html);
  assert.ok(!/Settlement score/.test(html), `a voided cohort rendered a score: ${html}`);
  assert.ok(html.includes('Adopt'), 'the recorded decision was dropped with the score');
});

test('an execution record reports its own outcome, never inclusion alone', () => {
  // The guard writes a record whether the batch dispatched cleanly or rolled back, so a list
  // without outcomes presents every recorded mandate as a completed one.
  const html = renderToStaticMarkup(
    h(RecentSettlements, {
      view: settlements({
        executions: [
          {
            pid: v('7'),
            payloadHash: v(PREIMAGE_HASH),
            klass: v('Treasury'),
            executedAt: v(890_000),
            succeeded: v(false),
            failure: v('call 2: BadOrigin'),
          },
        ],
      }),
      baselineBooks: { 9: 'live' },
    }),
  );
  assert.ok(html.includes('rolled back'), html);
  assert.ok(html.includes(EXECUTION_OUTCOME_COPY.failed), html);
  assert.ok(html.includes('call 2: BadOrigin'), 'the failing call index was dropped');
  assert.match(EXECUTION_OUTCOME_COPY.failed, /nothing this proposal asked for took effect/);

  const clean = renderToStaticMarkup(
    h(RecentSettlements, { view: settlements(), baselineBooks: { 9: 'live' } }),
  );
  assert.ok(!clean.includes(EXECUTION_OUTCOME_COPY.failed), 'a clean run claimed a rollback');
  assert.ok(clean.includes('succeeded'), clean);
});

test('a full ring says it is a window; a partial one makes no such claim', () => {
  assert.equal(ringFull(32, v(32)), true);
  assert.equal(ringFull(31, v(32)), false);
  assert.equal(ringCaveat(settlements()), undefined);

  assert.match(
    copy(ringCaveat(settlements({ cohortRingBound: v(1) })), 'the cohort caveat'),
    /The cohort ring is full/,
  );
  assert.match(
    copy(ringCaveat(settlements({ executionRingBound: v(1) })), 'the execution caveat'),
    /The execution ring is full/,
  );
  const both = settlements({ cohortRingBound: v(1), executionRingBound: v(1) });
  assert.match(copy(ringCaveat(both), 'the combined caveat'), /Both rings are full/);

  assert.ok(
    renderToStaticMarkup(
      h(RecentSettlements, { view: both, baselineBooks: { 9: 'live' } }),
    ).includes('This is a window, not the whole history'),
  );
  assert.ok(
    !renderToStaticMarkup(
      h(RecentSettlements, { view: settlements(), baselineBooks: { 9: 'live' } }),
    ).includes('This is a window, not the whole history'),
    'a partial ring claimed to be a window',
  );
});

test('a reaped Baseline book is labelled, and its row keeps rendering', () => {
  // §11.5's reaped-book rule pulls two ways: label the book reaped and render no price, but
  // keep rendering cohort history from `RecentCohortSummaries`.
  const rule = slice(DOC_11, '**Reaped Baseline books (normative; SQ-304', '## 11.6', 500);
  assert.match(rule, /MUST label the book \*\*reaped\/archived\*\*/);
  assert.match(rule, /MUST NOT render a missing or fail-closed zero quote as a market price/);
  assert.match(rule, /cohort history continues to render from `RecentCohortSummaries`/);

  assert.equal(baselineBookState(true), 'live');
  assert.equal(baselineBookState(false), 'reaped');
  assert.match(BASELINE_BOOK_COPY.reaped, /reaped and archived/);
  assert.match(BASELINE_BOOK_COPY.reaped, /There is no price to show/);

  // An epoch with no entry in the map renders as reaped rather than as live, which is the
  // fail-closed direction: a missing mapping is a reaped book.
  const html = renderToStaticMarkup(
    h(RecentSettlements, { view: settlements(), baselineBooks: {} }),
  );
  assert.ok(html.includes(BASELINE_BOOK_COPY.reaped), html);
  assert.ok(html.includes('Cohort — settled'), 'the cohort row stopped rendering with its book');
  assert.ok(html.includes('Adopt'), 'the cohort history was dropped with the book');
});

// ================================================================ the read layer

interface Recorded {
  readonly items: Record<string, readonly StorageItem[]>;
  readonly cross: Record<
    string,
    { readonly result: string; readonly witness: readonly StorageItem[] }
  >;
}

/**
 * A reader over recorded answers, which **refuses** an unrecorded request.
 *
 * The `mock-runtime` discipline: a double that answers everything turns a missing surface
 * into a green run, so each reader below is also asserted by the requests it makes.
 */
function reader(
  recorded: Partial<Recorded> = {},
  at: FinalizedBlockRef = AT,
): CoreReader & { readonly asked: string[] } {
  const asked: string[] = [];
  const items = recorded.items ?? {};
  const cross = recorded.cross ?? {};
  return {
    asked,
    at,
    async storage(key: string, type: 'value' | 'descendantsValues' = 'value') {
      asked.push(`storage:${key}:${type}`);
      return finalize(items[key] ?? [], at);
    },
    async call(api: string, argsHex?: string) {
      asked.push(`call:${api}:${argsHex ?? '0x'}`);
      throw new Error(`no recorded answer for ${api}`);
    },
    async crossCheckedCall(source: { readonly api: string; readonly storagePrefix: string }) {
      asked.push(`cross:${source.api}:${source.storagePrefix}`);
      const answer = cross[source.api];
      if (answer === undefined) throw new Error(`no recorded answer for ${source.api}`);
      return finalize(answer, at);
    },
  };
}

/** A `CoreKeys` that records which of its functions were reached. */
function countingKeys(): CoreKeys & { readonly used: Set<string> } {
  const used = new Set<string>();
  const mark = <T,>(name: string, value: T): T => {
    used.add(name);
    return value;
  };
  return {
    used,
    intakeQueue: () => mark('intakeQueue', 'k:intakeQueue'),
    preimageFor: (hash, len) => mark('preimageFor', `k:preimageFor:${hash}:${len}`),
    preimageStatus: (hash) => mark('preimageStatus', `k:preimageStatus:${hash}`),
    gateBreachFlags: (epoch) => mark('gateBreachFlags', `k:gateBreachFlags:${epoch}`),
    executionRecords: () => mark('executionRecords', 'k:executionRecords'),
    baselineMarketOf: (epoch) => mark('baselineMarketOf', `k:baselineMarketOf:${epoch}`),
    constitutionParamsPrefix: () => mark('constitutionParamsPrefix', 'k:params'),
  };
}

const KEYS: CoreKeys = countingKeys();

const OK = <T,>(value: T): Decoded<T> => ({ ok: true, value });
const BAD = <T,>(reason: string): Decoded<T> => ({ ok: false, reason });

const WELFARE_RECORD: WelfareCurrentRecord = {
  epoch: 9,
  specVersion: 0,
  sPillar1e9: 1n,
  cOnchain1e9: 2n,
  cAttested1e9: 3n,
  pPillar1e9: 4n,
  aPillar1e9: 5n,
  gateS1e9: 6n,
  gateC1e9: 7n,
  wCurrent1e9: 8n,
  sBreached: false,
  cBreached: false,
  reserveFlag: false,
  activeSpecAvailable: true,
};

function decoders(patch: Partial<CoreDecoders> = {}): CoreDecoders {
  return {
    epochStatus: () => OK({ epoch: 9, phase: 'Intake', phaseFlags: 0 }),
    intakeQueue: () => OK<readonly string[]>(['1', '2', '3']),
    preimageBytes: () => OK({ len: 128 }),
    preimageStatus: () => OK({ requested: true }),
    executionQueue: () =>
      OK([
        {
          pid: '7',
          klass: 'Code',
          payloadHash: PREIMAGE_HASH,
          maturity: 500,
          graceEnd: 2_000,
          cancelled: false,
          ratification: 'Passed',
          metersClear: true,
        },
      ]),
    welfareCurrent: () => OK(WELFARE_RECORD),
    welfareSnapshot: () => OK({ epoch: 9, specVersion: 3, w1e9: 8n }),
    gateBreachFlags: () => OK({ sBreached: false, cBreached: false }),
    paramRecord: () =>
      OK({
        key: 'mkt.fee',
        value: 3_000_000n,
        min: 0n,
        max: 10_000_000n,
        minNext: 1_500_000n,
        maxNext: 6_000_000n,
        cooldownBlocks: 201_600,
        lastChange: 100,
        klass: 'Param',
      }),
    recentCohorts: () =>
      OK([
        {
          epoch: 9,
          s1e9: 750_000_000n,
          baselineTwap1e9: 500_000_000n,
          proposals: [{ id: '7', klass: 'Treasury', outcome: 'Adopt' }],
          voided: false,
          settledAt: 880_000,
        },
      ]),
    executionRecords: () =>
      OK([
        {
          pid: '7',
          payloadHash: PREIMAGE_HASH,
          klass: 'Treasury',
          executedAt: 890_000,
          succeeded: true,
        },
      ]),
    ...patch,
  };
}

test('the surfaces these readers name are the ones doc 11 §11.2 gives each screen', () => {
  const inventory = slice(DOC_11, '| # | Screen / workflow | Area |', 'USDC balance reads', 3_000);
  const rowFor = (id: string): string => {
    const match = new RegExp(`^\\| ${id} \\|.*$`, 'm').exec(inventory);
    assert.ok(match, `doc 11 has no ${id} row`);
    return match[0];
  };
  // A read a screen makes must be one its own inventory row names. The doc writes storage
  // items unqualified in these rows, so the item half is what is bound.
  const item = (surface: string): string => surface.split('.').at(-1) ?? surface;
  const bindings: readonly (readonly [string, readonly string[]])[] = [
    ['S5', [SUBMIT_READS.epochStatus, SUBMIT_READS.intakeQueue]],
    ['S6', [QUEUE_READS.executionQueue, QUEUE_READS.queue]],
    [
      'S7',
      [
        WELFARE_READS.current,
        WELFARE_READS.snapshots,
        WELFARE_READS.metricSpecs,
        WELFARE_READS.gateBreachFlags,
      ],
    ],
    ['S8', [SETTLEMENT_READS.recentCohorts, SETTLEMENT_READS.executionRecords]],
  ];
  for (const [id, reads] of bindings) {
    const row = rowFor(id);
    for (const surface of reads) {
      assert.ok(row.includes(item(surface)), `${id}'s row does not name ${surface}`);
    }
  }
  // S7's constitution rows come through `params()`, whose backing storage 02 §7.3 declares.
  assert.ok(rowFor('S7').includes('params()'));
  assert.match(
    readFileSync(DOC_02, 'utf8'),
    /\| `Params` \| `map ParamKey → ParamRecord` \| read via `params\(\)`/,
  );
  assert.equal(WELFARE_READS.params, 'Constitution.Params');
  // S5's preimage surfaces are 02 §7.6's, and the row names the flow rather than the items.
  assert.ok(rowFor('S5').includes('preimage flow'));
  assert.equal(SUBMIT_READS.preimageFor, 'Preimage.PreimageFor');
  assert.equal(SUBMIT_READS.preimageStatus, 'Preimage.StatusFor');
});

test('S5’s reader distinguishes an empty queue from a queue it could not read', async () => {
  const answers: Partial<Recorded> = {
    items: {
      'k:intakeQueue': [{ key: 'k:intakeQueue', value: '0x0c' }],
      [`k:preimageFor:${PREIMAGE_HASH}:128`]: [{ key: 'a', value: '0xaa' }],
      [`k:preimageStatus:${PREIMAGE_HASH}`]: [{ key: 'b', value: '0xbb' }],
    },
    cross: { epoch_status: { result: '0x01', witness: [] } },
  };
  const read = await readSubmitInputs(reader(answers), KEYS, decoders(), {
    payloadHash: PREIMAGE_HASH,
    declaredLen: 128,
  });
  assert.equal(read.intakeQueueLen?.value, 3);
  assert.equal(read.phase?.value, 'Intake');
  assert.equal(read.preimageNoted.value, true);
  assert.equal(read.preimageRequested.value, true);
  assert.equal(read.notedLen?.value, 128);
  assert.deepEqual(read.undecodable, []);

  // An undecodable queue is **absent**, not zero: zero says "the queue is empty, submit
  // away", which is the direction that walks a user into `IntakeFull`.
  const broken = await readSubmitInputs(
    reader(answers),
    KEYS,
    decoders({ intakeQueue: () => BAD('trailing bytes') }),
    { payloadHash: PREIMAGE_HASH, declaredLen: 128 },
  );
  assert.equal(broken.intakeQueueLen, undefined);
  assert.equal(broken.undecodable.length, 1);
  assert.equal(broken.undecodable[0]?.label, SUBMIT_READS.intakeQueue);

  // An absent key is a genuine empty queue, because the value-query default of a
  // `BoundedVec` item is the empty vector.
  const empty = await readSubmitInputs(
    reader({ ...answers, items: { ...answers.items, 'k:intakeQueue': [] } }),
    KEYS,
    decoders(),
    { payloadHash: PREIMAGE_HASH, declaredLen: 128 },
  );
  assert.equal(empty.intakeQueueLen?.value, 0);

  // An undecodable epoch status leaves the phase **absent**, not defaulted. A substituted
  // `Intake` is the one value that turns a failed read into a passing precondition, and
  // `checkSubmit` would then admit a submission in any phase at all. (Found by mutation:
  // this file asserted the happy path and the queue's absent case, and nothing here
  // distinguished an unread phase from a read one until this paragraph.)
  const blind = await readSubmitInputs(
    reader(answers),
    KEYS,
    decoders({ epochStatus: () => BAD('unknown EpochPhase variant') }),
    { payloadHash: PREIMAGE_HASH, declaredLen: 128 },
  );
  assert.equal(blind.phase, undefined);
  assert.deepEqual(
    blind.undecodable.map((entry) => entry.label),
    [SUBMIT_READS.epochStatus],
  );
  assert.equal(blind.undecodable[0]?.rawHex, '0x01');
  // And the screen's own rule holds over it: an unread phase blocks.
  assert.equal(maySubmit(submitInputs({ phase: blind.phase })), false);
});

test('an absent or undecodable preimage reads as *not noted*, which is fail-closed', async () => {
  // The opposite default walks the user into the 10 % preimage-missing slash.
  const bare = await readSubmitInputs(
    reader({ cross: { epoch_status: { result: '0x01', witness: [] } } }),
    KEYS,
    decoders(),
    { payloadHash: PREIMAGE_HASH, declaredLen: 128 },
  );
  assert.equal(bare.preimageNoted.value, false);
  assert.equal(bare.preimageRequested.value, false);
  assert.equal(bare.notedLen, undefined);

  // A present-but-unrequested status is not a pin.
  const unpinned = await readSubmitInputs(
    reader({
      items: {
        [`k:preimageFor:${PREIMAGE_HASH}:128`]: [{ key: 'a', value: '0xaa' }],
        [`k:preimageStatus:${PREIMAGE_HASH}`]: [{ key: 'b', value: '0xbb' }],
      },
      cross: { epoch_status: { result: '0x01', witness: [] } },
    }),
    KEYS,
    decoders({ preimageStatus: () => OK({ requested: false }) }),
    { payloadHash: PREIMAGE_HASH, declaredLen: 128 },
  );
  assert.equal(unpinned.preimageNoted.value, true);
  assert.equal(unpinned.preimageRequested.value, false);
});

test('S6’s queue is cross-checked against its own prefix, and gaps are reported', async () => {
  const source = reader({
    cross: {
      execution_queue: {
        result: '0xff',
        witness: [{ key: 'q1', value: '0xaa' }, { key: 'q2' }],
      },
    },
  });
  const read = await readExecutionQueue(source, decoders());
  // The pairing is the reader's, never the call site's — satisfying one domain's view with
  // another's keys is what would make the check vacuous.
  assert.deepEqual(source.asked, [`cross:${QUEUE_READS.executionQueue}:${QUEUE_READS.queue}`]);
  assert.equal(read.entries.length, 1);
  assert.equal(read.entries[0]?.pid.value, '7');
  // A prefix key carrying no value is reported rather than dropped: dropping it shortens the
  // list, everything left decodes perfectly, and nothing says a mandate is missing.
  assert.equal(read.undecodable.length, 1);
  assert.match(copy(read.undecodable[0]?.reason, 'the gap reason'), /carries no value/);

  const broken = await readExecutionQueue(
    reader({ cross: { execution_queue: { result: '0xff', witness: [] } } }),
    decoders({ executionQueue: () => BAD('unknown variant') }),
  );
  assert.deepEqual(broken.entries, []);
  assert.equal(broken.undecodable[0]?.rawHex, '0xff');
});

test('S7’s reader withholds a spec version the chain says means nothing', async () => {
  const answers: Partial<Recorded> = {
    items: {
      'k:gateBreachFlags:9': [{ key: 'g', value: '0x00' }],
      'k:params': [{ key: 'p1', value: '0xaa' }, { key: 'p2' }],
    },
    cross: { welfare_current: { result: '0x11', witness: [{ key: 's1', value: '0xbb' }] } },
  };
  const available = await readWelfare(reader(answers), KEYS, decoders());
  assert.equal(available.activeSpecAvailable?.value, true);
  assert.equal(available.specVersion?.value, 0, 'a selected version of zero is legal');
  assert.equal(available.gateEpochSampled?.value, true);
  assert.equal(available.snapshots.length, 1);
  assert.equal(available.params.length, 1);
  // The `params` key with no value is reported, not silently absent.
  assert.equal(available.undecodable.length, 1);
  assert.match(copy(available.undecodable[0]?.label, 'the label'), /Constitution\.Params/);

  const unavailable = await readWelfare(
    reader(answers),
    KEYS,
    decoders({ welfareCurrent: () => OK({ ...WELFARE_RECORD, activeSpecAvailable: false }) }),
  );
  assert.equal(unavailable.activeSpecAvailable?.value, false);
  assert.equal(
    unavailable.specVersion,
    undefined,
    'the unavailable version was handed up one field away from a screen that renders it',
  );
});

test('the gate sampling fact comes from entry presence, not from clear flags', async () => {
  const answers: Partial<Recorded> = {
    items: { 'k:params': [] },
    cross: { welfare_current: { result: '0x11', witness: [] } },
  };
  // No entry at all: not sampled.
  const unsampled = await readWelfare(reader(answers), KEYS, decoders());
  assert.equal(unsampled.gateEpochSampled?.value, false);
  assert.equal(unsampled.sBreached?.value, false, 'the display flags are still the chain’s');
  assert.equal(gateReading(false, unsampled.gateEpochSampled?.value ?? true), 'not-sampled');

  // An entry with identical clear flags: sampled. Same bytes, different fact.
  const sampled = await readWelfare(
    reader({
      ...answers,
      items: { ...answers.items, 'k:gateBreachFlags:9': [{ key: 'g', value: '0x00' }] },
    }),
    KEYS,
    decoders(),
  );
  assert.equal(sampled.gateEpochSampled?.value, true);
  assert.equal(gateReading(false, sampled.gateEpochSampled?.value ?? false), 'no-breach-so-far');
});

test('the gate read is keyed to the epoch the welfare view names', async () => {
  // Guessing an epoch to read would answer a question about a different one.
  const source = reader({
    items: { 'k:params': [] },
    cross: { welfare_current: { result: '0x11', witness: [] } },
  });
  await readWelfare(source, KEYS, decoders());
  assert.ok(source.asked.includes('storage:k:gateBreachFlags:9:value'), source.asked.join('\n'));

  // With the view undecodable there is no epoch, so no keyed read is attempted at all.
  const blind = reader({
    items: { 'k:params': [] },
    cross: { welfare_current: { result: '0x11', witness: [] } },
  });
  const read = await readWelfare(blind, KEYS, decoders({ welfareCurrent: () => BAD('short read') }));
  assert.equal(read.gateEpochSampled, undefined);
  assert.ok(
    !blind.asked.some((request) => request.startsWith('storage:k:gateBreachFlags')),
    'a gate read was issued against a guessed epoch',
  );
  assert.equal(read.pillars, undefined);
  assert.equal(read.undecodable[0]?.label, WELFARE_READS.current);
});

test('S8’s reader returns records, leaving the VOID projection to its one constructor', async () => {
  const source = reader({
    items: { 'k:executionRecords': [{ key: 'r', value: '0xee' }] },
    cross: { recent_cohorts: { result: '0xdd', witness: [] } },
  });
  const read = await readSettlements(source, KEYS, decoders());
  assert.deepEqual(source.asked, [
    `cross:${SETTLEMENT_READS.recentCohorts}:${SETTLEMENT_READS.recentCohortSummaries}`,
    'storage:k:executionRecords:value',
  ]);
  assert.equal(read.cohorts.length, 1);
  // A record, not a row: `cohortRow` is the single place the VOID rule is applied, so a
  // reader that also projected would be a second place it could be got wrong.
  assert.equal(read.cohorts[0]?.voided.value, false);
  assert.equal(read.executions[0]?.succeeded.value, true);
  assert.deepEqual(read.undecodable, []);

  const failed = await readSettlements(
    reader({
      items: { 'k:executionRecords': [{ key: 'r', value: '0xee' }] },
      cross: { recent_cohorts: { result: '0xdd', witness: [] } },
    }),
    KEYS,
    decoders({ executionRecords: () => BAD('ring length past bound') }),
  );
  assert.deepEqual(failed.executions, []);
  assert.equal(failed.undecodable[0]?.label, SETTLEMENT_READS.executionRecords);
});

test('a Baseline book’s presence is read as presence, never decoded into a zero', async () => {
  const live = reader({ items: { 'k:baselineMarketOf:9': [{ key: 'm', value: '0x07' }] } });
  assert.equal((await readBaselineBookPresent(live, KEYS, 9)).value, true);
  const reaped = await readBaselineBookPresent(reader(), KEYS, 9);
  assert.equal(reaped.value, false);
  assert.equal(baselineBookState(reaped.value), 'reaped');
});

test('no injected storage key is dead — every one is reached by a reader', async () => {
  // An injected port with no caller can disagree with the key its surface really needs, and
  // nothing can see it: the read returns nothing, and an empty map is indistinguishable from
  // a real empty one. So the whole `CoreKeys` surface is exercised and counted.
  const keys = countingKeys();
  const answers: Partial<Recorded> = {
    items: { 'k:params': [], 'k:executionRecords': [] },
    cross: {
      epoch_status: { result: '0x01', witness: [] },
      welfare_current: { result: '0x11', witness: [] },
      recent_cohorts: { result: '0xdd', witness: [] },
    },
  };
  await readSubmitInputs(reader(answers), keys, decoders(), {
    payloadHash: PREIMAGE_HASH,
    declaredLen: 128,
  });
  await readWelfare(reader(answers), keys, decoders());
  await readSettlements(reader(answers), keys, decoders());
  await readBaselineBookPresent(reader(answers), keys, 9);

  const declared = Object.keys(countingKeys()).filter((name) => name !== 'used');
  assert.equal(declared.length, 7, `the CoreKeys surface is ${declared.length} functions`);
  assert.deepEqual([...keys.used].sort(), declared.sort());
});

test('every leaf of every model belongs to the reader’s own block', () => {
  // `assertOnePin` is redundant while every leaf comes from the reader's own stamp, and it is
  // exported so this test can reach it: a defensive check whose test cannot reach it is the
  // vacuous control this repository keeps finding. A settlements table whose cohort ring came
  // from one block and whose execution ring came from the next is not a stale view — it is a
  // view that never existed, and nothing on screen distinguishes the two.
  assert.doesNotThrow(() => assertOnePin([v(1), v(2n), v('x')], BLOCK));
  assert.throws(() => assertOnePin([v(1), v(2n, OTHER_BLOCK)], BLOCK), /mixes blocks/);
  // A status carrying no block at all is refused rather than skipped for lack of a hash.
  assert.throws(
    () => assertOnePin([{ value: 1, status: { kind: 'external-proposal' } }], BLOCK),
    /mixes blocks/,
  );
  assert.doesNotThrow(() => assertOnePin([], BLOCK), 'an empty model has nothing to mix');
});

// ======================================================== S2's missing second read

const STATS_ARGS: ProposalArgs = { decisionStats: (pid) => `0xpid${pid}` };

function proposalsReader(
  states: readonly string[],
  stats: Record<string, string>,
): ProposalsReader & { readonly asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    at: AT,
    async crossCheckedCall(): Promise<
      Finalized<{ readonly result: string; readonly witness: readonly StorageItem[] }>
    > {
      asked.push('cross:proposal_summaries');
      return finalize(
        {
          result: '0x00',
          witness: states.map((state, index) => ({ key: `p${index}`, value: state })),
        },
        AT,
      );
    },
    async call(api: string, argsHex?: string): Promise<Finalized<string>> {
      asked.push(`${api}:${argsHex ?? '0x'}`);
      const answer = stats[argsHex ?? '0x'];
      if (answer === undefined) throw new Error(`no recorded answer for ${argsHex}`);
      return finalize(answer, AT);
    },
  };
}

/** Decoders whose proposal states are the recorded witness values, so a test can set them. */
function proposalDecoders(
  onStats: ProposalDecoders['decisionStats'],
): ProposalDecoders {
  return {
    proposals: (raw) =>
      OK(
        raw.map((state, index) => ({
          id: String(index),
          title: `proposal ${index}`,
          klass: 'Treasury',
          state,
        })),
      ),
    decisionStats: onStats,
  };
}

test('the decided arm of ProposalView is reachable from a read, not only from a fixture', async () => {
  // The defect this closes: `decision_stats` was named in `PROPOSAL_READS`, decoded by
  // `ProposalDecoders` and ruled on by `viewFor` — and nothing called it. The `decided` arm
  // was constructible only by hand, so `ProposalDetail`'s dashboard was a panel no read could
  // fill, and a green suite said nothing about any of it.
  const source = proposalsReader(['Settled'], { '0xpid0': '0xstats' });
  const read = await readProposals(
    source,
    proposalDecoders(() => OK({ outcome: 'Adopt', upliftPpm: 12_500n })),
    STATS_ARGS,
  );
  assert.equal(read.views.length, 1);
  const view = read.views[0];
  assert.equal(view?.stage, 'decided', 'the decided arm is still unreachable from a read');
  assert.equal(view?.stage === 'decided' ? view.decisionStats.outcome.value : undefined, 'Adopt');
  assert.equal(view?.stage === 'decided' ? view.decisionStats.upliftPpm.value : undefined, 12_500n);
  // Every leaf carries the reader's own pin, including the ones the second call produced.
  const status = view?.stage === 'decided' ? view.decisionStats.outcome.status : undefined;
  assert.equal(status?.kind, 'verified-finalized');
  assert.equal(status?.kind === 'verified-finalized' ? status.blockHash : undefined, BLOCK);
  assert.deepEqual(read.anomalies, []);
  // The frozen method name, taken whole because `call` does not prefix while
  // `crossCheckedCall` does.
  assert.ok(source.asked.includes('FutarchyApi_decision_stats:0xpid0'), source.asked.join('\n'));
  assert.equal(PROPOSAL_READS.decisionStats, 'decision_stats');
});

test('doc 02 freezes the method this read calls, and the `None` rule it depends on', () => {
  const doc = readFileSync(DOC_02, 'utf8');
  assert.match(doc, /fn decision_stats\(pid: ProposalId\) -> Option<DecisionStatsView>;/);
  assert.match(
    doc,
    /`decision_stats\(pid\)` MUST return `None` until the proposal's registered decision windows have been sealed/,
  );
  // And doc 11 is what forbids rendering it as a preview while a market is open.
  assert.match(
    readFileSync(DOC_11, 'utf8'),
    /S2 and S3 MUST render no projected uplift, projected PASS\/REJECT, or other in-Trade preview derived from it/,
  );
});

test('the read asks about open markets too, which is what makes the anomaly reachable', async () => {
  // Asking only about sealed proposals is the obvious implementation and it makes `viewFor`'s
  // anomaly branch unreachable from a real read — a `Some` returned for a `Trading` proposal
  // is precisely the contradiction that branch exists to report.
  const source = proposalsReader(['Trading', 'Extended', 'Settled'], {
    '0xpid0': '0xsome',
    '0xpid1': '0xnone',
    '0xpid2': '0xnone',
  });
  const read = await readProposals(
    source,
    proposalDecoders((raw) => (raw === '0xsome' ? OK({ outcome: 'Adopt', upliftPpm: 1n }) : OK(undefined))),
    STATS_ARGS,
  );
  assert.deepEqual(
    source.asked.filter((request) => request.startsWith('FutarchyApi_')),
    [
      'FutarchyApi_decision_stats:0xpid0',
      'FutarchyApi_decision_stats:0xpid1',
      'FutarchyApi_decision_stats:0xpid2',
    ],
  );
  // The contradiction is reported and the statistics are not rendered: an outcome shown on an
  // open market is a trading signal.
  assert.equal(read.anomalies.length, 1);
  assert.equal(read.anomalies[0]?.proposalId, '0');
  assert.match(copy(read.anomalies[0]?.detail, 'the anomaly detail'), /not a timing artefact/);
  for (const view of read.views) assert.equal(view.stage, 'pre-decision');
});

test('a pre-market proposal is not asked about at all', async () => {
  // The question is not merely expected to be `None` there — it is meaningless, because no
  // window has opened. An unknown state from a newer runtime falls here too and renders no
  // statistics either way.
  const source = proposalsReader(['Submitted', 'Qualified', 'SomethingNewer'], {});
  const read = await readProposals(source, proposalDecoders(() => OK(undefined)), STATS_ARGS);
  assert.deepEqual(
    source.asked.filter((request) => request.startsWith('FutarchyApi_')),
    [],
  );
  assert.equal(read.views.length, 3);
  for (const view of read.views) assert.equal(view.stage, 'pre-decision');
  assert.deepEqual(read.anomalies, []);
});

test('a failed statistics call is reported, never collapsed into a None', async () => {
  // Collapsing the two would render "no statistics yet" for a decided proposal whose read
  // failed — a confident statement about chain state the client never obtained.
  const source = proposalsReader(['Settled'], {});
  const read = await readProposals(source, proposalDecoders(() => OK(undefined)), STATS_ARGS);
  assert.equal(read.views[0]?.stage, 'pre-decision');
  assert.equal(read.undecodable.length, 1);
  assert.match(copy(read.undecodable[0]?.label, 'the label'), /decision_stats\(0\)/);
  assert.match(copy(read.undecodable[0]?.reason, 'the reason'), /the runtime call failed/);

  // An undecodable answer is reported with its bytes rather than substituted.
  const undecodable = await readProposals(
    proposalsReader(['Settled'], { '0xpid0': '0xgarbage' }),
    proposalDecoders(() => BAD('unknown DecisionOutcome variant')),
    STATS_ARGS,
  );
  assert.equal(undecodable.undecodable.length, 1);
  assert.equal(undecodable.undecodable[0]?.rawHex, '0xgarbage');
  assert.equal(undecodable.views[0]?.stage, 'pre-decision');
});

test('viewFor’s allowlist still governs, whatever the fetch decided to ask', () => {
  // The fetch set and the render allowlist are deliberately different sets, so the render rule
  // is asserted on its own: an unknown state renders no statistics even when the runtime
  // handed some back.
  const summary = {
    id: v('7'),
    title: v('a proposal'),
    klass: v('Treasury'),
    state: v('SomethingNewer'),
  };
  const stats = { outcome: v('Adopt'), upliftPpm: v(1n) };
  const ruled = viewFor(summary, stats);
  assert.equal(ruled.view.stage, 'pre-decision');
  assert.notEqual(ruled.anomaly, undefined);
  assert.equal(viewFor({ ...summary, state: v('Settled') }, stats).view.stage, 'decided');
});

// ================================================================== the route map

test('S5–S8 are declared built-unwired, with an honest reason', () => {
  for (const id of ['S5', 'S6', 'S7', 'S8']) {
    const pending = PENDING_SCREENS[id];
    assert.ok(pending, `${id} left the pending map without being wired`);
    assert.ok(pending.state === 'built-unwired', `${id} is declared ${pending.state}`);
    assert.equal(pending.milestone, 'F7b', id);
    assert.match(pending.waitingOn, /transport/, `${id} does not say what it is waiting on`);
  }
  // S5's extra blocker is the contract gap rather than a build gap — stated where a reader of
  // the route map will meet it.
  const s5 = PENDING_SCREENS['S5'];
  assert.ok(s5?.state === 'built-unwired');
  assert.match(s5.waitingOn, /per-funder intake rate limit/);
});
