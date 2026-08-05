/**
 * The P-1…P-15 precondition tables — 11 §11.5.
 *
 * What is worth testing about a table of declarations is the *binding*, not the contents:
 * the contents are the spec's, and restating them here would only prove the file was
 * copied twice. So these assert the two properties a declaration can get wrong silently —
 * that every clause reads from a surface the chain actually publishes, and that a clause
 * marked as a constants-API read really cites a constant.
 *
 * The first is also enforced by the compiler (`SurfaceId` is a generated literal union),
 * and that is deliberately not a reason to skip it here. The type-level version of this
 * check shipped broken: `(typeof CRITICAL_SURFACE)[number]['id']` widens to `string`
 * because the array carries an explicit annotation, so every clause typechecked against
 * every string. A runtime assertion cannot be widened away.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ALL_CLAUSES,
  CONVICTIONS,
  CRANK_CALLS,
  GOVERNANCE_ROW_IDS,
  NO_WRAPPER,
  PRECONDITION_ROWS,
  aboveTheFoldClauses,
  acceptsConviction,
  accountForClause,
  clauseGroupsFor,
  clausesNeedingOtherAccounts,
  crankStaleness,
  discloseLock,
  governanceRowsFor,
  lockPeriods,
  rowsFor,
} from '@bleavit/transaction-builder';
import { CRITICAL_SURFACE } from '@bleavit/descriptors';

const ROW_IDS = [
  'P-1', 'P-2', 'P-3', 'P-4', 'P-5', 'P-6', 'P-7', 'P-8',
  'P-9', 'P-10', 'P-11', 'P-12', 'P-13', 'P-14', 'P-15',
];

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../../..');

test('11 §11.5 publishes fifteen rows and every one carries clauses', () => {
  assert.deepEqual(Object.keys(PRECONDITION_ROWS).sort(), [...ROW_IDS].sort());
  for (const id of ROW_IDS) {
    assert.ok(rowsFor(id, 'USDC').length > 0, `${id} has no clauses — it would pass the gate by default`);
  }
});

test('every clause reads from a surface the frozen manifest publishes', () => {
  const published = new Set(CRITICAL_SURFACE.map((entry) => entry.id));
  assert.ok(published.size > 100, 'the surface set looks empty — this test would be vacuous');
  for (const clause of ALL_CLAUSES) {
    assert.ok(
      published.has(clause.surface),
      `${clause.row} reads ${clause.surface}, which the runtime does not publish`,
    );
  }
});

test('a clause marked as a constants-API read cites a constant, and vice versa', () => {
  // 11 §11.4 rule 2 makes the constants API a *distinct* source, not a variant of storage:
  // MinSplit, MinTransfer, MaxPositionsPerAccount and the per-trade bounds have no storage
  // representation at all. A clause that looked for one in storage would find nothing and
  // have to invent a default — the hardcode X-11e/X-11h forbid. Both directions, because
  // reading a *storage* item through the constants API fails just as silently.
  const group = new Map(CRITICAL_SURFACE.map((entry) => [entry.id, entry.compatGroup]));
  const expected = { constant: 'constants', storage: 'query', 'runtime-api': 'apis' };
  for (const clause of ALL_CLAUSES) {
    assert.equal(
      group.get(clause.surface),
      expected[clause.source],
      `${clause.row} declares source '${clause.source}' but ${clause.surface} is a ` +
        `'${group.get(clause.surface)}' surface`,
    );
  }
});

test('the constants-API clauses are the ones 11 §11.5 marks [C]', () => {
  // Anti-vacuity for the test above: if no clause were marked `constant`, the both-ways
  // check would pass over an empty set. 11 §11.5 marks per-trade bounds, MinSplit,
  // MinTransfer and MaxPositionsPerAccount with `[C]`, so those must be present.
  const constants = ALL_CLAUSES.filter((clause) => clause.source === 'constant');
  assert.ok(constants.length >= 8, `only ${constants.length} constants-API clauses`);
  const cited = new Set(constants.map((clause) => clause.surface));
  for (const required of [
    'constant.ledger.min_split',
    'constant.ledger.min_transfer',
    'constant.ledger.max_positions_per_account',
    'constant.market.min_trade',
    'constant.market.max_trade_ratio',
  ]) {
    assert.ok(cited.has(required), `11 §11.5 marks ${required} [C] and no clause reads it`);
  }
});

/**
 * P-12 carries all thirteen dispatch checks (contract v26; SQ-589).
 *
 * **This replaces a test that asserted `rowsFor('P-12').length < 13`** — deliberately, on
 * the theory that `check-dispatch-mirror.py` owned the diff. It does not: that gate parses
 * docs 09 §1.2 and 11 §11.5 and never reads `rows.ts`, so nothing checked the client
 * implemented these at all, and the assertion passed for a trivial reason. An adversarial
 * review found it.
 *
 * Asserted by **surface**, not by count. A count is satisfied by thirteen copies of the
 * cheapest clause, which is exactly the failure the original had in the other direction.
 */
const P12_REQUIRED_SURFACES = [
  'storage.execution_guard.queue',                 // 1, 2, 4 — queue state, window, version
  'storage.preimage.preimage_for',                 // 3  — BadPreimage
  'storage.execution_guard.ratifications',         // 5  — NotRatified
  'storage.attestor.attestations',                 // 6  — AttestationMissing
  'storage.execution_guard.attestation_bindings',  // 6  — bound to THIS payload
  'storage.constitution.capabilities',             // 7  — CapabilityDenied
  'api.execution_queue',                           // 8, 13 — meters, batch bounds
  'storage.execution_guard.held_resources',        // 9  — ResourceLockMissing
  'storage.epoch.proposals',                       // 10 — GuardianHold (rerun_held)
  'storage.execution_guard.gate_suspension',       // 10 — GateSuspended
  'storage.epoch.epoch_of',                        // 10 — the epoch it is keyed to
  'storage.execution_guard.hard_gate_breach',      // 11 — FreezeActive
  'storage.welfare.gate_breach_flags',             // 11 — the breach flags
  'storage.execution_guard.dead_man_freeze',       // 12 — the guard's own latch
  'storage.constitution.phase_flags',              // 12 — LEDGER_FROZEN / DEAD_MAN_ENGAGED
  'storage.execution_guard.migration_halt',        // 12 — MigrationHalt
  'storage.execution_guard.expedited',             // 12 — the exemption
];

test('P-12 reads every surface its thirteen dispatch checks need', () => {
  const cited = new Set(rowsFor('P-12', 'USDC').map((c) => c.surface));
  for (const surface of P12_REQUIRED_SURFACES) {
    assert.ok(cited.has(surface), `P-12 has no clause reading ${surface}; a dispatch check is unmirrored`);
  }
});

test('P-12 reads the resource locks the GUARD holds, not the epoch pallet’s own set', () => {
  // 11 §11.5's check 9 cited `Epoch.ResourceLocks`. `do_execute` reads
  // `ExecutionGuard.HeldResources` (lib.rs:2067). Both items exist and are frozen, so the
  // wrong one is a plausible read that passes rows the guard refuses — corrected at v26.
  const cited = new Set(rowsFor('P-12', 'USDC').map((c) => c.surface));
  assert.ok(cited.has('storage.execution_guard.held_resources'));
  assert.equal(cited.has('storage.epoch.resource_locks'), false);
});

test('P-12 carries the expedited exemption, not just the freeze flags', () => {
  // Reading the freezes without this tells a user they are blocked when the chain would
  // execute: fail-closed in the safe direction and still wrong on screen.
  const clauses = rowsFor('P-12', 'USDC');
  assert.ok(clauses.some((c) => c.surface === 'storage.execution_guard.expedited'));
  assert.ok(clauses.some((c) => c.surface === 'storage.execution_guard.migration_halt'));
});

test('rowsFor refuses an unknown row rather than returning an empty set', () => {
  // An empty precondition set is indistinguishable from "nothing to check", and a call
  // that reached the gate with no rows would pass it (11 §11.4 rule 1).
  assert.throws(() => rowsFor('P-99', 'USDC'), /refusing to treat that as "nothing to check"/);
});

// ---------------------------------------------------------------------------
// Clause subjects — 11 §11.3's multisig and proxy wrappers, applied to the table.
//
// The defect these guard is not an encoding mistake but a silent misattribution: a
// wrapped call executes as the multisig or proxied account while the signer pays, so a
// clause with no subject implicitly reads "the signer" and checks the wrong balance.
// It fails green — the signer is healthy, every row passes, and the runtime rejects the
// inner call because the proxied account is short.
// ---------------------------------------------------------------------------

test('every clause declares whose account it reads', () => {
  const subjects = new Set(['chain', 'acting', 'signer', 'recipient']);
  for (const c of ALL_CLAUSES) {
    assert.ok(subjects.has(c.subject), `${c.row} "${c.requirement}" has subject ${c.subject}`);
  }
});

test('no clause reads one account for two different questions', () => {
  // The conflation this splits: 11 §11.5's P-3 text is "USDC balance >= amount + fee
  // headroom", which is one read only while signer and origin coincide. A clause whose
  // requirement names both a spendable amount and a fee is checking two accounts under a
  // wrapper, so the table must not contain one.
  const conflated = ALL_CLAUSES.filter(
    (c) => /\bfee\b/.test(c.requirement) && /\b(balance|covers the amount|holds?)\b/.test(c.requirement) && c.subject !== 'signer',
  );
  assert.deepEqual(
    conflated.map((c) => `${c.row}: ${c.requirement}`),
    [],
    'a clause mixes a spendable balance with a fee; split it by subject',
  );
});

test('P-3 checks the amount against the acting account and the fee against the signer', () => {
  const p3 = rowsFor('P-3', 'USDC');
  const amount = p3.find((c) => c.requirement.includes('covers the amount'));
  const fee = p3.find((c) => c.requirement.includes('fee headroom'));
  assert.ok(amount && fee, 'P-3 lost its split balance clauses');
  assert.equal(amount.subject, 'acting');
  assert.equal(fee.subject, 'signer');
});

test('an unwrapped call resolves every clause to the signer', () => {
  const SIGNER = '5Signer';
  for (const c of ALL_CLAUSES) {
    if (c.subject === 'recipient') continue;
    const who = accountForClause(c, NO_WRAPPER, SIGNER);
    if (c.subject === 'chain') assert.equal(who, undefined, `${c.row} chain clause named an account`);
    else assert.equal(who, SIGNER, `${c.row} "${c.requirement}"`);
  }
});

test('a proxy sends acting clauses to `real` and fee clauses to the signer', () => {
  const SIGNER = '5Signer';
  const wrapper = { kind: 'proxy', real: '5Real', proxyType: 'Any' };
  const p3 = rowsFor('P-3', 'USDC');
  const amount = p3.find((c) => c.requirement.includes('covers the amount'));
  const fee = p3.find((c) => c.requirement.includes('fee headroom'));
  assert.equal(accountForClause(amount, wrapper, SIGNER), '5Real');
  assert.equal(accountForClause(fee, wrapper, SIGNER), SIGNER);
  // The two must differ, or the split is decorative.
  assert.notEqual(accountForClause(amount, wrapper, SIGNER), accountForClause(fee, wrapper, SIGNER));
});

test('a multisig sends acting clauses to the multisig account', () => {
  const SIGNER = '5Signer';
  const wrapper = { kind: 'multisig', multisig: '5Multi', threshold: 2, otherSignatories: ['5Other'] };
  const acting = ALL_CLAUSES.find((c) => c.subject === 'acting');
  assert.equal(accountForClause(acting, wrapper, SIGNER), '5Multi');
  assert.equal(accountForClause({ ...acting, subject: 'signer' }, wrapper, SIGNER), SIGNER);
});

test('a recipient clause refuses to fall back to the signer', () => {
  // P-9's bounds are about the destination. Substituting the sender would check a healthy
  // sender's position count against the recipient's bound and pass a transfer the runtime
  // refuses — so an absent recipient throws rather than defaulting.
  const recipientClause = ALL_CLAUSES.find((c) => c.subject === 'recipient');
  assert.ok(recipientClause, 'P-9 lost its recipient clauses');
  assert.throws(() => accountForClause(recipientClause, NO_WRAPPER, '5Signer'), /recipient/);
  assert.equal(accountForClause(recipientClause, NO_WRAPPER, '5Signer', '5Dest'), '5Dest');
});

test('wrapping actually moves reads off the signer', () => {
  // Anti-vacuity for the whole mechanism: if no row had an account-scoped clause, every
  // test above would pass while the wrapper changed nothing that gets read.
  const SIGNER = '5Signer';
  const proxied = { kind: 'proxy', real: '5Real', proxyType: 'Any' };
  assert.equal(clausesNeedingOtherAccounts('P-1', NO_WRAPPER, SIGNER, 'USDC').length, 0);
  assert.ok(
    clausesNeedingOtherAccounts('P-1', proxied, SIGNER, 'USDC').length >= 2,
    'P-1 has no clause the proxy moves; the split would be inert',
  );
});

test('the acting subject is used by more than one row', () => {
  // A single acting clause in a single row would satisfy every assertion above while
  // leaving the other fourteen rows implicitly reading the signer.
  const rows = new Set(ALL_CLAUSES.filter((c) => c.subject === 'acting').map((c) => c.row));
  assert.ok(rows.size >= 8, `only ${rows.size} rows carry an acting clause`);
});

test('P-9 checks the protocol-destination refusal, and does it as a CHAIN READ', () => {
  // The clause 11 §11.5 mandates and this table could not express until contract v25.
  // `ledger.transfer` refuses a protocol destination, and the runtime's test is a
  // `Contains` implementation — not storage — so there was no `SurfaceId` to cite and the
  // clause was simply absent. A user could be walked through a green precondition table
  // to a signature the runtime then refuses (SQ-588).
  const clause = rowsFor('P-9', 'USDC').find((c) => c.surface === 'api.is_reserved_protocol_destination');
  assert.ok(clause, 'P-9 lost the protocol-destination clause');

  // §11.4 rule 2: every row in this table is an EXACT CHAIN READ. A client deriving
  // membership from frozen constants would be evaluating a computation, which is why this
  // is a `runtime-api` source and not a `constant` one. If someone "optimises" it into a
  // local namespace test, this is the assertion that objects.
  assert.equal(clause.source, 'runtime-api');
  assert.notEqual(clause.source, 'constant');

  // And it asks about the RECIPIENT — the address the user just typed, which is exactly
  // the value no local predicate should be trusted to classify.
  assert.equal(clause.subject, 'recipient');
});

test('the P-9 surface is a real frozen surface, not a plausible string', () => {
  // The SQ-581 defect in its general form: a clause citing a `SurfaceId` that happens to
  // typecheck but names something else. `CRITICAL_SURFACE` is generated from the manifest,
  // so membership here is the manifest's answer rather than this file's.
  const entry = CRITICAL_SURFACE.find((s) => s.id === 'api.is_reserved_protocol_destination');
  assert.ok(entry, 'the manifest does not freeze the surface P-9 cites');
  assert.equal(entry.compatGroup, 'apis');
  assert.equal(entry.pallet, 'FutarchyApi');
  assert.equal(entry.member, 'is_reserved_protocol_destination');
  assert.equal(entry.required, true);
});

/* ============================================================================
 * The adversarial-review round: ten findings against this table (F6 majors).
 *
 * Each test below is written to fail against the table as it stood, because a
 * remediation test that passes both before and after proves the fix was never needed.
 * They assert the *property* rather than the corrected string, so the next edit to a
 * requirement's wording does not silently retire the check.
 * ========================================================================== */

/** Every clause of every row, at both fee selections — the corpus these scans run over. */
const EVERY_CLAUSE = ['VIT', 'USDC'].flatMap((asset) =>
  ROW_IDS.flatMap((id) => rowsFor(id, asset)),
);

test('the fee asset is required, and omitting it throws rather than dropping a clause', () => {
  // The defect this guards: filtering by an absent asset matches no fee clause, so the row
  // comes back MINUS its headroom check and reads as a row that passed. The type system
  // cannot reach an untyped JS caller; this throw can.
  assert.throws(() => rowsFor('P-3'), /needs the selected fee asset/);
  assert.throws(() => rowsFor('P-3', 'DOT'), /needs the selected fee asset/);
  assert.throws(() => rowsFor('P-3', null), /needs the selected fee asset/);
});

test('fee headroom is read from a different pallet per currency (11 §11.3)', () => {
  const headroom = (asset) =>
    rowsFor('P-3', asset).filter((c) => c.requirement.includes('fee headroom'));
  const vit = headroom('VIT');
  const usdc = headroom('USDC');
  // Exactly one each — two would mean both are demanded, which strands every account that
  // holds only one currency.
  assert.equal(vit.length, 1, 'VIT selection must yield exactly one headroom clause');
  assert.equal(usdc.length, 1, 'USDC selection must yield exactly one headroom clause');
  assert.equal(vit[0].surface, 'storage.system.account');
  assert.equal(usdc[0].surface, 'storage.foreign_assets.account');
  assert.notEqual(vit[0].surface, usdc[0].surface, 'the split is decorative if both read the same item');
});

test('no clause cites PositionTotals for a per-account position count (#9)', () => {
  // `PositionTotals` is the total supply of ONE position id; the bound the runtime enforces
  // is `PositionCount`, a different item. An account at 64 positions passed this row
  // whenever global supply happened to be low.
  const miscited = EVERY_CLAUSE.filter(
    (c) => /position count/i.test(c.requirement) && c.surface === 'storage.ledger.position_totals',
  );
  assert.deepEqual(
    miscited.map((c) => `${c.row}: ${c.requirement}`),
    [],
    'a position-count clause reads per-position supply, which is not the enforced bound',
  );
  // ...and the count is actually read, from the chain's own answer.
  for (const row of ['P-3', 'P-9']) {
    const counted = rowsFor(row, 'USDC').find((c) => /position count/i.test(c.requirement));
    assert.ok(counted, `${row} lost its position-count clause`);
    assert.equal(counted.surface, 'api.account_positions');
  }
});

test('the ledger freeze is never inferred from the constitution phase flags (#8)', () => {
  // `Constitution.PhaseFlags` is what the execution guard reads (`configs.rs:9411`) and is
  // correct THERE — P-12 keeps it. Everywhere else the ledger's own `FrozenUntil` latch is
  // what refuses the call, and phase flags can be entirely green while it is set.
  const freeze = EVERY_CLAUSE.filter((c) => /PB-LEDGER-FREEZE/.test(c.requirement));
  assert.ok(freeze.length > 0, 'no row declares the freeze at all');
  for (const c of freeze) {
    if (c.row === 'P-12') continue;
    assert.equal(
      c.surface,
      'api.epoch_status',
      `${c.row} infers the ledger freeze from ${c.surface}, which answers a different question`,
    );
  }
  // Every ledger and market row that the freeze blocks must declare it.
  for (const row of ['P-1', 'P-2', 'P-3', 'P-4']) {
    assert.ok(
      rowsFor(row, 'USDC').some((c) => /PB-LEDGER-FREEZE/.test(c.requirement)),
      `${row} is blocked by PB-LEDGER-FREEZE and does not check it`,
    );
  }
});

test('bond and stake balances are read in USDC, not from System.Account (#10)', () => {
  // `RuntimeProposalBond::hold` transfers through ForeignAssets at `usdc_location()`
  // (`configs.rs:6332`), and oracle stakes are USDC custody (`configs.rs:7566`).
  // `System.Account` is the VIT balance, which a bond hold never touches.
  const bonds = EVERY_CLAUSE.filter((c) => /bond|stake/i.test(c.requirement) && /balance/i.test(c.requirement));
  assert.ok(bonds.length >= 3, 'expected the submit and both oracle bond clauses');
  for (const c of bonds) {
    assert.equal(
      c.surface,
      'storage.foreign_assets.account',
      `${c.row} checks a USDC bond against ${c.surface}`,
    );
  }
});

test('P-2 carries P-1’s book, quote and balance clauses rather than citing them (#7)', () => {
  // "book state + slippage recheck **as P-1**" is a clause set, not a cross-reference a
  // reader supplies. A Baseline buy by an account with no USDC passed every declared clause.
  const p2 = rowsFor('P-2', 'USDC');
  const has = (re) => p2.some((c) => re.test(c.requirement));
  assert.ok(has(/max_cost \/ min_proceeds/), 'P-2 has no slippage clause');
  assert.ok(has(/recompute agree/), 'P-2 never compares the chain quote to its own');
  assert.ok(has(/USDC balance covers/), 'P-2 never checks the buyer can pay');
  assert.ok(has(/fee rate matches/), 'P-2 never cross-checks the fee');
});

test('P-6 and P-7 read their settlement clause as a disjunction (#11)', () => {
  // 11 §11.5: "proposal vault ScalarSettled, **or** Baseline position view BaselineSettled".
  // Flat, these evaluate conjunctively and block BOTH lawful redemptions — no account holds
  // the two states at once.
  for (const row of ['P-6', 'P-7']) {
    const groups = clauseGroupsFor(row, 'USDC');
    const alternative = groups.find((g) => g.length > 1);
    assert.ok(alternative, `${row}'s settlement clause is a conjunction; it blocks the lawful case`);
    assert.equal(alternative.length, 2);
    assert.ok(
      alternative.some((c) => /ScalarSettled/.test(c.requirement)) &&
        alternative.some((c) => /BaselineSettled/.test(c.requirement)),
      `${row} grouped the wrong pair`,
    );
    // Every other clause stays its own obligation — grouping everything would be worse than
    // grouping nothing, since one satisfied clause would carry the row.
    assert.ok(groups.filter((g) => g.length > 1).length === 1, `${row} has more than one alternative group`);
  }
});

test('the redemption fee is cross-checked against its metadata constant (#12)', () => {
  // Reading only `params` is the SQ-581 shape: a value that agrees with itself is not a
  // check. The point is to catch a metadata surface that drifted from what is charged.
  for (const row of ['P-6', 'P-7']) {
    const fee = rowsFor(row, 'USDC').filter((c) => /redemption-fee/.test(c.requirement));
    const surfaces = new Set(fee.map((c) => c.surface));
    assert.ok(surfaces.has('constant.ledger.redemption_fee'), `${row} never reads the frozen constant`);
    assert.ok(surfaces.has('api.params'), `${row} never reads the raw parameter`);
  }
});

test('balance clauses state an amount rather than mere possession (#13)', () => {
  // "you hold the position" passes for a holder of 1 signing a redemption of 2.
  const p8 = rowsFor('P-8', 'USDC').find((c) => c.subject === 'acting');
  assert.match(p8.requirement, /at least the amount/);
  // P-9's deposit needs the recipient's balance, not just the constant that sizes it.
  const p9 = rowsFor('P-9', 'USDC');
  assert.ok(
    p9.some((c) => c.subject === 'recipient' && c.surface === 'storage.foreign_assets.account'),
    'P-9 sizes the deposit and never asks whether the recipient can pay it',
  );
});

test('P-10 counts the funder’s entries and reads the limit live (#14)', () => {
  const p10 = rowsFor('P-10', 'USDC');
  const limit = p10.find((c) => /rate limit/.test(c.requirement));
  assert.ok(limit, 'P-10 lost its rate-limit clause');
  // The runtime counts `Proposals` by funder (`epoch-core:774`), not the intake queue.
  assert.equal(limit.surface, 'api.proposal_summaries');
  assert.match(limit.requirement, /funder/, 'the cap is keyed to the funder, not the caller (05 §1.5, E6)');
  // `intake.max_acct` is META-amendable within [2,8]; a client that baked 4 stops tracking
  // the chain the moment governance moves it.
  assert.ok(p10.some((c) => c.surface === 'api.params'), 'P-10 assumes the limit instead of reading it');
  // The preimage must be pinned, which is a different item from being noted.
  assert.ok(p10.some((c) => c.surface === 'storage.preimage.preimage_for'));
  assert.ok(p10.some((c) => c.surface === 'storage.preimage.status_for'));
});

test('P-11 admits the funder as well as the author, as a disjunction (#15)', () => {
  // `epoch-core:823` admits `p.proposer == who || p.funder == who`. 11 §11.5 said "caller is
  // proposer" until this review corrected it — implementing the narrower text produces a
  // client that refuses a lawful funder withdrawal.
  const groups = clauseGroupsFor('P-11', 'USDC');
  const identity = groups.find((g) => g.length > 1);
  assert.ok(identity, 'P-11 has no identity clause, or states it conjunctively');
  assert.ok(identity.some((c) => /author/.test(c.requirement)));
  assert.ok(identity.some((c) => /funded its bond/.test(c.requirement)));
});

test('every crank has its own staleness read, or a named refusal (#16)', () => {
  // The row previously applied four generic clauses to all six cranks, so
  // `ledger.sweep_redemption_fees` was gated on epoch, market and welfare state unrelated to
  // whether any fees have accrued — the user signs a guaranteed no-op.
  assert.equal(CRANK_CALLS.length, 6);
  // The **mapping** is asserted, not a count of distinct surfaces. A first version of this
  // test checked `distinct >= 3` and a mutation that repointed `market.crank_observe` at the
  // epoch item survived it — three surfaces remained, and the crank was reading state
  // unrelated to whether it has work. Correspondence is the whole content of P-15, so
  // correspondence is what gets pinned.
  const EXPECTED = {
    'epoch.tick': 'storage.epoch.epoch_of',
    'market.crank_observe': 'storage.market.markets',
    'market.reap': 'storage.market.markets',
    'epoch.settle_cohort': 'storage.epoch.cohorts',
  };
  for (const call of CRANK_CALLS) {
    const staleness = crankStaleness(call);
    if (staleness.kind === 'readable') {
      assert.equal(staleness.clause.surface, EXPECTED[call], `${call} reads the wrong state to decide it has work`);
    } else {
      // An unreadable condition must SAY so and point at the override, not go quiet.
      assert.match(staleness.reason, /expert override/);
      assert.ok(staleness.reason.length > 40, `${call}'s refusal gives the user nothing to act on`);
    }
  }
  assert.throws(() => crankStaleness('market.nonexistent'), /refusing to assume it has work/);
});

test('the two unreadable cranks are exactly the ones with no frozen surface', () => {
  // Pinned deliberately: if 02 later freezes accrued fees or revenue, this test fails and
  // the refusal gets replaced by a real read rather than surviving as permanent scaffolding.
  const unreadable = CRANK_CALLS.filter((c) => crankStaleness(c).kind === 'unreadable');
  assert.deepEqual(unreadable.sort(), ['ledger.sweep_redemption_fees', 'market.sweep_revenue']);
});

// ------------------------------------------- the 11 §11.7.3 governance rows (F16)

test('every row 11 §11.7.3 defines has clauses', () => {
  const doc = readFileSync(join(REPO, 'docs/architecture/11-frontend-workflows.md'), 'utf8');
  const section = /^### 11\.7\.3 Extrinsics and precondition rows[\s\S]*?(?=^###)/m.exec(doc);
  assert.ok(section, 'the §11.7.3 section moved — re-point this binding');
  const declared = [...section[0].matchAll(/^\| (G-\d+) \|/gm)].map((m) => m[1]);
  assert.ok(declared.length >= 8, `parsed only ${declared.length} rows: ${declared}`);
  assert.deepEqual([...GOVERNANCE_ROW_IDS].sort(), [...declared].sort());
  for (const row of GOVERNANCE_ROW_IDS) {
    assert.ok(governanceRowsFor(row).length > 0, `${row} has no clauses`);
  }
});

test('G-5 reads the unlock TARGET, not the caller', () => {
  // `unlock(class, target)` unlocks for `target`, whom anyone may name. Reading the
  // caller's locks passes green whenever the caller has none — the ordinary case when
  // somebody unlocks for a friend — and the chain then refuses. P-9's lesson, new place.
  const clauses = governanceRowsFor('G-5');
  assert.equal(clauses.length, 1);
  assert.equal(clauses[0].subject, 'recipient');
  assert.equal(clauses[0].surface, 'storage.conviction_voting.class_locks_for');
});

test('a delegation target is a recipient read, not an echo of the form', () => {
  // §11.3 anti-substitution applied to G-2: the address is a chain-read identity.
  const target = governanceRowsFor('G-2').find((c) => c.subject === 'recipient');
  assert.ok(target, 'G-2 has no clause about the delegation target');
});

test('conviction locks are marked above the fold on both rows that impose one', () => {
  // 11 §11.7.6 and §11.2 constraint 3: the lock consequence is one of the five facts that
  // may not be deferred. Marked in the row rather than left to a screen, because a screen
  // is where it gets forgotten.
  const folds = aboveTheFoldClauses();
  assert.deepEqual(folds.map((c) => c.row).sort(), ['G-1', 'G-2']);
  for (const fold of folds) assert.match(fold.requirement, /lock/i);
});

test('conviction-voting rows are subject `acting`, never `signer`', () => {
  // Under a proxy, `conviction_voting` operates on the proxied account's votes and locks,
  // while the fee and nonce stay with the signer. A row that resolved one account for both
  // checks the wrong one and fails green — P-3's finding.
  for (const row of ['G-1', 'G-3', 'G-4']) {
    for (const c of governanceRowsFor(row)) {
      assert.ok(
        c.subject !== 'signer',
        `${row} reads conviction-voting state against the signer: ${c.requirement}`,
      );
    }
  }
  // And the deposit rows genuinely are the signer's, so the distinction is not vacuous.
  assert.ok(governanceRowsFor('G-6').some((c) => c.subject === 'signer'));
  assert.ok(governanceRowsFor('G-7').some((c) => c.subject === 'signer'));
});

test('every governance clause names a surface CRITICAL_SURFACE probes', () => {
  // An unprobed read is one the 10 §5.2 lattice cannot fail on — SQ-580's consequence.
  //
  // **The compiler is the real control here, not this test.** `SurfaceId` is a string-literal
  // union generated from `CRITICAL_SURFACE`, so naming a surface that does not exist is a
  // `TS2345` at the clause, proven by mutation. This assertion is kept as a second reading
  // of the same fact — it would catch a future `SurfaceId` widened to `string` — but it
  // should not be mistaken for what stops the defect today.
  const probed = new Set(CRITICAL_SURFACE.map((entry) => entry.id));
  for (const row of GOVERNANCE_ROW_IDS) {
    for (const c of governanceRowsFor(row)) {
      assert.ok(probed.has(c.surface), `${row} reads unprobed surface ${c.surface}`);
    }
  }
});

// -------------------------------------------------- conviction and its lock (F16)

test('the lock multipliers match the pinned SDK exactly', () => {
  // Verified 2026-08-05 against polkadot-sdk@polkadot-stable2606,
  // substrate/frame/conviction-voting/src/conviction.rs — read rather than inferred from
  // the doubling, because the pattern *looks* like it starts at 1 and these numbers are
  // what a user's tokens are locked by.
  assert.deepEqual(
    CONVICTIONS.map((c) => [c, lockPeriods(c)]),
    [['None', 0], ['Locked1x', 1], ['Locked2x', 2], ['Locked3x', 4],
     ['Locked4x', 8], ['Locked5x', 16], ['Locked6x', 32]],
  );
});

test('the lock is computed from the chain’s enactment period, never a default', () => {
  const week = 100_800;
  const six = discloseLock('Locked6x', week, 1_000);
  assert.equal(six.lockBlocks, 32 * week);
  assert.equal(six.unlocksAtEarliest, 1_000 + 32 * week);
  // `None` locks nothing and still votes — at 10 %.
  const none = discloseLock('None', week, 1_000);
  assert.equal(none.lockBlocks, 0);
  assert.equal(none.unlocksAtEarliest, 1_000);
  assert.equal(none.weightTenths, 1);
  assert.equal(six.weightTenths, 60);
});

test('a nonsense enactment period is refused rather than producing a wrong lock', () => {
  assert.throws(() => discloseLock('Locked1x', -1, 0), RangeError);
  assert.throws(() => discloseLock('Locked1x', 1.5, 0), RangeError);
  assert.throws(() => discloseLock('Locked1x', 10, -5), RangeError);
});

test('a vote cannot reach signing without its lock having been disclosed', () => {
  // The structural half of "displayed before signing". `LockDisclosed` is branded and
  // `discloseLock` is its only producer, so a hand-built object does not typecheck —
  // `tests/firewall` carries the fixture. Here we assert the produced value is usable and
  // that the brand is a phantom with no runtime footprint to copy.
  const lock = discloseLock('Locked3x', 100, 50);
  const vote = { poll: 7n, intent: { kind: 'standard', aye: true, balance: 5n }, lock };
  assert.equal(vote.lock.lockBlocks, 400);
  assert.deepEqual(
    Object.keys(lock).sort(),
    ['conviction', 'lockBlocks', 'unlocksAtEarliest', 'weightTenths'],
    'the brand materialised as a runtime property — it must stay phantom',
  );
});

test('only a standard vote accepts a conviction', () => {
  // pallet-conviction-voting's own shape: Split and SplitAbstain have no conviction field.
  // A form that appeared to accept 6× on a split vote would tell the user both that their
  // tokens are locked and that their vote weighs 6× — and neither is true.
  assert.equal(acceptsConviction({ kind: 'standard', aye: true, balance: 1n }), true);
  assert.equal(acceptsConviction({ kind: 'split', aye: 1n, nay: 1n }), false);
  assert.equal(acceptsConviction({ kind: 'split-abstain', aye: 1n, nay: 1n, abstain: 1n }), false);
});
