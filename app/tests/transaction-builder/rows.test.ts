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
  OPERATOR_ROWS,
  operatorRowsFor,
  OPERATOR_SURFACE_ROWS,
  blockingObligationsFor,
  obligationAppliesTo,
  scopedObligationsFor,
  unreadableObligationsFor,
  NO_WRAPPER,
  PRECONDITION_ROWS,
  aboveTheFoldClauses,
  acceptsConviction,
  accountForClause,
  clauseGroupsFor,
  clausesNeedingOtherAccounts,
  deriveMultisigAccount,
  multisigWrapper,
  crankStaleness,
  discloseLock,
  governanceRowsFor,
  lockPeriods,
  rowsFor,
} from '@bleavit/transaction-builder';
import type {
  CallWrapper,
  CrankCall,
  FeeAsset,
  GovernanceRowId,
  ObligationScope,
  OperatorRowId,
  PreconditionClause,
  PreconditionRowId,
  UnreadableObligation,
} from '@bleavit/transaction-builder';
import { CRITICAL_SURFACE } from '@bleavit/descriptors';
import { blake2b } from '@noble/hashes/blake2b';
import type { SurfaceId } from '@bleavit/descriptors';

// `satisfies` rather than a bare literal: 11 §11.5's fifteen rows are checked against the
// union `rows.ts` publishes, so a row added there without one here (or vice versa) is a
// compile error rather than a `deepEqual` nobody re-reads.
const ROW_IDS = [
  'P-1', 'P-2', 'P-3', 'P-4', 'P-5', 'P-6', 'P-7', 'P-8',
  'P-9', 'P-10', 'P-11', 'P-12', 'P-13', 'P-14', 'P-15',
] as const satisfies readonly PreconditionRowId[];

/**
 * A multisig wrapper built the only way the client can build one.
 *
 * `CallWrapper`'s `multisig` field is branded and `deriveMultisigAccount` is its sole
 * mint, so a literal `'5Multi'` is a wrapper the production path cannot produce — and the
 * account is exactly what every clause with subject `acting` resolves to.
 */
function multisigFixture(): Extract<CallWrapper, { kind: 'multisig' }> {
  const key = (byte: string): string => `0x${byte.repeat(32)}`;
  const derivation = deriveMultisigAccount(
    [key('11'), key('22')],
    2,
    (bytes: Uint8Array) => blake2b(bytes, { dkLen: 32 }),
  );
  const wrapper = multisigWrapper(derivation, key('11'));
  assert.equal(wrapper.kind, 'multisig');
  return wrapper;
}

/** The nth element, or a throw naming how many there were. */
function nth<T>(items: readonly T[], index: number, what: string): T {
  const item = items.at(index);
  if (item === undefined) throw new Error(`expected a ${what} at ${index}; there are ${items.length}`);
  return item;
}

/** A clause matching a predicate, or a throw naming what was searched for. */
function clauseWhere(
  clauses: readonly PreconditionClause[],
  predicate: (clause: PreconditionClause) => boolean,
  what: string,
): PreconditionClause {
  const found = clauses.find(predicate);
  if (found === undefined) throw new Error(`no clause matching ${what} among ${clauses.length}`);
  return found;
}

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
  ] as const satisfies readonly SurfaceId[]) {
    assert.ok(cited.has(required), `11 §11.5 marks ${required} [C] and no clause reads it`);
  }
});

/**
 * P-12 carries all fourteen dispatch checks (contract v26; SQ-589; row 12 split 2026-08-05).
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
  'storage.execution_guard.dead_man_freeze',       // 12 — the guard's own latch (never waived)
  'storage.constitution.phase_flags',              // 12 DEAD_MAN_ENGAGED / 13 LEDGER_FROZEN
  'storage.execution_guard.migration_halt',        // 13 — MigrationHalt (waivable)
  'storage.execution_guard.expedited',             // 13 — the D-9 exemption
] as const satisfies readonly SurfaceId[];

test('P-12 reads every surface its fourteen dispatch checks need', () => {
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

/**
 * The expedited exemption waives exactly the two freezes the runtime waives — and the
 * test evaluates that rather than inspecting the shape.
 *
 * The test above asserts only that the clauses are *present*, and presence is what shipped:
 * the exemption sat in the list with no `anyOf`, so `clauseGroupsFor` made it a mandatory
 * requirement and the client refused the emergency upgrade during exactly the freeze the
 * D-9 lane exists for. The obvious repair — one group holding all the freeze clauses and
 * the exemption — is worse, because a flat any-of would let *no migration halt* alone
 * satisfy the whole obligation, waiving the dead-man latch.
 *
 * The runtime (`pallets/execution-guard/src/lib.rs`, check §1.2(10)) is two `ensure!`s:
 *
 *     !HardGateBreach && !DeadManFreeze && !dead_man_freeze_active()        // never waived
 *     !(ledger_freeze_active() || MigrationHalt) || Expedited(pid)          // waived
 *
 * so the client owes `(¬L ∨ E) ∧ (¬M ∨ E)`, which is `(¬L ∧ ¬M) ∨ E` distributed into two
 * groups sharing the exemption clause.
 */
// Keyed on `requirement`, NOT on `surface` — and the difference is load-bearing rather
// than stylistic. `Constitution.PhaseFlags` is one storage item carrying **both** the
// DEAD_MAN_ENGAGED bit and the LEDGER_FROZEN bit, whose waivability is opposite: one is
// never waived, the other is waived by the expedited lane. Anything keyed on the surface
// conflates them and cannot express "ledger freeze clear, dead-man engaged" at all. A
// clause's surface says what to read; its requirement says which check it is, and a
// single read legitimately answers two.
const DEAD_MAN = ['the dead-man switch is not engaged', 'the dead-man phase flag is clear'];
const EXPEDITED = 'or this proposal holds the expedited exemption';

/** Every P-12 group holds, given the checks currently reading clear. */
function p12Satisfied(satisfied: ReadonlySet<string>): boolean {
  return clauseGroupsFor('P-12', 'USDC').every((group) =>
    group.some((clause) => satisfied.has(clause.requirement)),
  );
}

test('the expedited exemption waives the triggering freeze — and nothing else', () => {
  const groups = clauseGroupsFor('P-12', 'USDC');
  const sharing = groups.filter((g) => g.some((c) => c.requirement === EXPEDITED));
  assert.equal(
    sharing.length,
    2,
    'the exemption must share a group with each waivable freeze — one group each, not one combined',
  );
  for (const group of sharing) {
    assert.equal(group.length, 2, 'a waivable group is exactly {the freeze, the exemption}');
  }
  // The freezes it waives are the two the runtime waives, and no others.
  assert.deepEqual(
    sharing.map((g) => clauseWhere(g, (c) => c.requirement !== EXPEDITED, 'the waived freeze').requirement).sort(),
    ['PB-LEDGER-FREEZE is clear', 'no migration halt is in force'],
  );

  // ...and the dead-man latch is NOT among them. It is its own mandatory group, so no
  // exemption can satisfy it. This is the fail-open direction, and it is the one that
  // matters: D-9's whole point is a latch nothing clears.
  for (const check of DEAD_MAN) {
    const holding = groups.filter((g) => g.some((c) => c.requirement === check));
    assert.ok(holding.length >= 1, `no group carries the check ${check}`);
    for (const g of holding) {
      assert.equal(
        g.some((c) => c.requirement === EXPEDITED),
        false,
        `${check} shares a group with the exemption — expedited would waive the dead-man switch`,
      );
    }
  }
});

test('the P-12 grouping evaluates the way the runtime does', () => {
  // Shape assertions can agree with a wrong shape. These four evaluate it.
  const everythingElse = new Set(
    rowsFor('P-12', 'USDC')
      .map((c) => c.requirement)
      .filter((r) => r !== EXPEDITED && r !== 'no migration halt is in force'),
  );

  // 1. A frozen ledger with no exemption blocks — the ordinary case.
  const frozen = new Set(everythingElse);
  frozen.delete('PB-LEDGER-FREEZE is clear');
  assert.equal(p12Satisfied(frozen), false, 'a live freeze with no exemption must block');

  // 2. The same state WITH the exemption proceeds. This is the case the shipped list got
  //    wrong: it refused the emergency upgrade during the freeze it repairs.
  assert.equal(
    p12Satisfied(new Set([...frozen, EXPEDITED])),
    true,
    'the expedited lane must proceed under the freeze it exists to repair',
  );

  // 3. A migration halt is waived the same way, and only together — the waiver is over the
  //    conjunction, so an exemption clears both or the state was never blocking.
  const halted = new Set(everythingElse);
  assert.equal(p12Satisfied(halted), false, 'a migration halt with no exemption must block');
  assert.equal(p12Satisfied(new Set([...halted, EXPEDITED])), true);

  // 4. **The dead-man switch is not waivable.** Every surface satisfied, exemption held,
  //    dead-man engaged — still blocked. If this ever passes, the client is offering a
  //    signature the runtime refuses on the one latch that has no exemption.
  const deadMan = new Set([...everythingElse, EXPEDITED]);
  deadMan.delete('the dead-man switch is not engaged');
  assert.equal(
    p12Satisfied(deadMan),
    false,
    'the expedited exemption must never satisfy the dead-man latch',
  );
});

test('rowsFor refuses an unknown row rather than returning an empty set', () => {
  // An empty precondition set is indistinguishable from "nothing to check", and a call
  // that reached the gate with no rows would pass it (11 §11.4 rule 1).
  // Deliberately outside `PreconditionRowId`: the refusal is what an untyped caller —
  // a rehydrated draft, a handoff document naming a row this release does not have —
  // must meet, and an empty set would read as "nothing to check".
  assert.throws(() => rowsFor('P-99' as PreconditionRowId, 'USDC'), /refusing to treat that as "nothing to check"/);
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
  const wrapper: CallWrapper = { kind: 'proxy', real: '5Real', proxyType: 'Any' };
  const p3 = rowsFor('P-3', 'USDC');
  const amount = clauseWhere(p3, (c) => c.requirement.includes('covers the amount'), 'the amount clause');
  const fee = clauseWhere(p3, (c) => c.requirement.includes('fee headroom'), 'the fee-headroom clause');
  assert.equal(accountForClause(amount, wrapper, SIGNER), '5Real');
  assert.equal(accountForClause(fee, wrapper, SIGNER), SIGNER);
  // The two must differ, or the split is decorative.
  assert.notEqual(accountForClause(amount, wrapper, SIGNER), accountForClause(fee, wrapper, SIGNER));
});

test('a multisig sends acting clauses to the multisig account', () => {
  const SIGNER = '5Signer';
  const wrapper = multisigFixture();
  const acting = clauseWhere(ALL_CLAUSES, (c) => c.subject === 'acting', 'an acting-subject clause');
  assert.equal(accountForClause(acting, wrapper, SIGNER), wrapper.multisig);
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
  const proxied: CallWrapper = { kind: 'proxy', real: '5Real', proxyType: 'Any' };
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
const EVERY_CLAUSE = (['VIT', 'USDC'] as const satisfies readonly FeeAsset[]).flatMap((asset) =>
  ROW_IDS.flatMap((id) => rowsFor(id, asset)),
);

test('the fee asset is required, and omitting it throws rather than dropping a clause', () => {
  // The defect this guards: filtering by an absent asset matches no fee clause, so the row
  // comes back MINUS its headroom check and reads as a row that passed. The type system
  // cannot reach an untyped JS caller; this throw can.
  // Each argument here is deliberately outside the signature. That is the whole test: the
  // comment above says "the type system cannot reach an untyped JS caller", and these three
  // are what such a caller supplies — a forgotten argument, a chain asset this release does
  // not price fees in, and an explicit null from a cleared form field.
  const untypedFeeAsset = (value: unknown): FeeAsset => value as FeeAsset;
  assert.throws(() => rowsFor('P-3', untypedFeeAsset(undefined)), /needs the selected fee asset/);
  assert.throws(() => rowsFor('P-3', untypedFeeAsset('DOT')), /needs the selected fee asset/);
  assert.throws(() => rowsFor('P-3', untypedFeeAsset(null)), /needs the selected fee asset/);
});

test('fee headroom is read from a different pallet per currency (11 §11.3)', () => {
  const headroom = (asset: FeeAsset): readonly PreconditionClause[] =>
    rowsFor('P-3', asset).filter((c) => c.requirement.includes('fee headroom'));
  const vit = headroom('VIT');
  const usdc = headroom('USDC');
  // Exactly one each — two would mean both are demanded, which strands every account that
  // holds only one currency.
  assert.equal(vit.length, 1, 'VIT selection must yield exactly one headroom clause');
  assert.equal(usdc.length, 1, 'USDC selection must yield exactly one headroom clause');
  assert.equal(nth(vit, 0, 'headroom clause').surface, 'storage.system.account');
  assert.equal(nth(usdc, 0, 'headroom clause').surface, 'storage.foreign_assets.account');
  assert.notEqual(nth(vit, 0, 'headroom clause').surface, nth(usdc, 0, 'headroom clause').surface, 'the split is decorative if both read the same item');
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
  for (const row of ['P-3', 'P-9'] as const satisfies readonly PreconditionRowId[]) {
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
  for (const row of ['P-1', 'P-2', 'P-3', 'P-4'] as const satisfies readonly PreconditionRowId[]) {
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
  const has = (re: RegExp): boolean => p2.some((c) => re.test(c.requirement));
  assert.ok(has(/max_cost \/ min_proceeds/), 'P-2 has no slippage clause');
  assert.ok(has(/recompute agree/), 'P-2 never compares the chain quote to its own');
  assert.ok(has(/USDC balance covers/), 'P-2 never checks the buyer can pay');
  assert.ok(has(/fee rate matches/), 'P-2 never cross-checks the fee');
});

test('P-6 and P-7 read their settlement clause as a disjunction (#11)', () => {
  // 11 §11.5: "proposal vault ScalarSettled, **or** Baseline position view BaselineSettled".
  // Flat, these evaluate conjunctively and block BOTH lawful redemptions — no account holds
  // the two states at once.
  for (const row of ['P-6', 'P-7'] as const satisfies readonly PreconditionRowId[]) {
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
  for (const row of ['P-6', 'P-7'] as const satisfies readonly PreconditionRowId[]) {
    const fee = rowsFor(row, 'USDC').filter((c) => /redemption-fee/.test(c.requirement));
    const surfaces = new Set(fee.map((c) => c.surface));
    assert.ok(surfaces.has('constant.ledger.redemption_fee'), `${row} never reads the frozen constant`);
    assert.ok(surfaces.has('api.params'), `${row} never reads the raw parameter`);
  }
});

test('balance clauses state an amount rather than mere possession (#13)', () => {
  // "you hold the position" passes for a holder of 1 signing a redemption of 2.
  const p8 = clauseWhere(rowsFor('P-8', 'USDC'), (c) => c.subject === 'acting', 'P-8 acting clause');
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
  //
  // Seven since F17: §11.8.5's welfare snapshot binds itself to P-15 by name and was absent
  // from the union, so the one crank §11.8's own text puts in this table could not be gated.
  assert.equal(CRANK_CALLS.length, 7);
  // The **mapping** is asserted, not a count of distinct surfaces. A first version of this
  // test checked `distinct >= 3` and a mutation that repointed `market.crank_observe` at the
  // epoch item survived it — three surfaces remained, and the crank was reading state
  // unrelated to whether it has work. Correspondence is the whole content of P-15, so
  // correspondence is what gets pinned.
  // Partial because the two unreadable cranks have no surface at all — and a *readable*
  // crank missing from this map is caught below rather than compared against `undefined`,
  // which would pass for whichever surface it happened to read.
  const EXPECTED: Partial<Record<CrankCall, SurfaceId>> = {
    'epoch.tick': 'storage.epoch.epoch_of',
    'market.crank_observe': 'storage.market.markets',
    'market.reap': 'storage.market.markets',
    'epoch.settle_cohort': 'storage.epoch.cohorts',
    'welfare.record_snapshot': 'storage.welfare.snapshots',
  };
  for (const call of CRANK_CALLS) {
    const staleness = crankStaleness(call);
    if (staleness.kind === 'readable') {
      const expected = EXPECTED[call];
      assert.ok(expected, `${call} became readable and this test declares no surface for it`);
      assert.equal(staleness.clause.surface, expected, `${call} reads the wrong state to decide it has work`);
    } else {
      // An unreadable condition must SAY so and point at the override, not go quiet.
      assert.match(staleness.reason, /expert override/);
      assert.ok(staleness.reason.length > 40, `${call}'s refusal gives the user nothing to act on`);
    }
  }
  // Deliberately outside `CrankCall`: a keeper UI reading a call name off a URL is the
  // untyped caller, and "nothing to crank" is the reading that must not happen.
  assert.throws(() => crankStaleness('market.nonexistent' as CrankCall), /refusing to assume it has work/);
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
  assert.equal(nth(clauses, 0, 'clause').subject, 'recipient');
  assert.equal(nth(clauses, 0, 'clause').surface, 'storage.conviction_voting.class_locks_for');
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
  for (const row of ['G-1', 'G-3', 'G-4'] as const satisfies readonly GovernanceRowId[]) {
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

// ------------------------------------- 11 §11.8's operator rows (F17)

/**
 * `satisfies`, as with the P-rows: §11.8's nine calls are checked against the union
 * `rows.ts` publishes, so a row added on one side without the other is a compile error.
 */
const OPERATOR_IDS = [
  'O-1', 'O-2', 'O-3', 'O-4', 'O-5', 'O-6', 'O-7', 'O-8', 'O-9',
] as const satisfies readonly OperatorRowId[];

test('11 §11.8 publishes an operator row family, separate from §11.5’s fifteen', () => {
  // The blocker this closes: `PreconditionRowId` closed at P-15, so `oracle.register_reporter`,
  // `guardian.approve_action`, `futarchy_treasury.claim_stream`, `system.apply_authorized_upgrade`
  // and the rest had **no id they could declare** in `TxPreparation.requires`. `gate()` then
  // had nothing to demand of them, and every §11.8 console gated its own button on a
  // module-local check — the bypass §11.4 rule 1 names, reached by omission.
  assert.deepEqual(Object.keys(OPERATOR_ROWS).sort(), [...OPERATOR_IDS].sort());
  for (const id of OPERATOR_IDS) {
    assert.ok(rowsFor(id, 'USDC').length > 0, `${id} has no clauses — it would pass the gate by default`);
  }
  // Separate unions, so §11.5's "fifteen rows" stays a checkable spec fact.
  for (const id of OPERATOR_IDS) {
    assert.ok(!(id in PRECONDITION_ROWS), `${id} leaked into §11.5's table`);
  }
  assert.equal(Object.keys(PRECONDITION_ROWS).length, 15);
});

test('the two registry rows read the instance they are filed against — 11 §11.8.6', () => {
  // The blocker an R-6 review found on 2026-08-07. §11.8.6 gives ONE precondition row for TWO
  // allocators, and 02 §7.4 freezes six items across them precisely because "the allocators are
  // independent and share no filing-id space". O-8 and O-9 named `storage.incident_registry.*`
  // unconditionally while `FilingKind` was threaded through the inputs and read by nobody — so a
  // MILESTONE challenge was gated on the INCIDENT registry's window, closure and occupancy. It
  // fails both ways: admitting a challenge on a closed milestone window whose incident twin is
  // open, and refusing a lawful one.
  const surfacesOf = (rows: ReturnType<typeof operatorRowsFor>, id: 'O-8' | 'O-9') =>
    new Set(rows[id].map((c) => c.surface));

  for (const id of ['O-8', 'O-9'] as const) {
    const incident = surfacesOf(operatorRowsFor('incident'), id);
    const milestone = surfacesOf(operatorRowsFor('milestone'), id);
    assert.ok(
      [...milestone].some((s) => s.startsWith('storage.milestone_registry.')),
      `${id} must read the milestone registry when that is the instance filed against`,
    );
    assert.ok(
      ![...milestone].some((s) => s.startsWith('storage.incident_registry.')),
      `${id} must not read the incident registry for a milestone filing`,
    );
    assert.ok(
      ![...incident].some((s) => s.startsWith('storage.milestone_registry.')),
      `${id} must not read the milestone registry for an incident filing`,
    );
    // And the two differ, or the parameter is doing nothing.
    assert.notDeepEqual(incident, milestone, `${id} is not instance-parameterised at all`);
  }

  // The rest of the rows are the same either way — only the two registry rows are per instance.
  const others = OPERATOR_IDS.filter((id) => id !== 'O-8' && id !== 'O-9');
  for (const id of others) {
    assert.deepEqual(operatorRowsFor('milestone')[id], OPERATOR_ROWS[id], `${id} must not move`);
  }
});

test('every §11.8 submit call names exactly one row, and that row has clauses', () => {
  // A convention is what a hurried edge ignores; this is the data a gate can be built on.
  // The two §11.8.1 calls whose rows live in §11.5 are here too — its own table routes
  // `oracle.report`/`oracle.challenge` to "rows P-13/P-14 (§11.5)", and giving them a second
  // `O-n` row would be two tables for one obligation.
  const rows = new Set<string>();
  for (const [call, row] of Object.entries(OPERATOR_SURFACE_ROWS)) {
    assert.ok(rowsFor(row as PreconditionRowId, 'USDC').length > 0, `${call} → ${row} has no clauses`);
    rows.add(row);
  }
  assert.equal(OPERATOR_SURFACE_ROWS['oracle.report'], 'P-13');
  assert.equal(OPERATOR_SURFACE_ROWS['oracle.challenge'], 'P-14');
  // Every operator row is reachable from some call — an unreferenced row is a table entry
  // nothing declares, which is exactly as unenforced as no row at all.
  for (const id of OPERATOR_IDS) assert.ok(rows.has(id), `${id} is named by no call`);
});

test('every operator row computes fee headroom in the SELECTED asset', () => {
  // 11 §11.3: "USDC-only accounts are always viable: every precondition table below computes
  // fee headroom in the *selected* fee asset". A single hardcoded read would report VIT
  // headroom for an account paying in USDC — a balance the transaction never touches.
  for (const id of OPERATOR_IDS) {
    for (const asset of ['VIT', 'USDC'] as const satisfies readonly FeeAsset[]) {
      const fee = rowsFor(id, asset).filter((clause) => clause.feeAsset !== undefined);
      assert.equal(fee.length, 1, `${id} has ${fee.length} fee clauses under ${asset}`);
      assert.equal(nth(fee, 0, 'fee clause').feeAsset, asset);
    }
  }
  // And the two assets read *different* surfaces, or the selector would be decoration.
  const vit = nth(rowsFor('O-1', 'VIT').filter((c) => c.feeAsset !== undefined), 0, 'clause');
  const usdc = nth(rowsFor('O-1', 'USDC').filter((c) => c.feeAsset !== undefined), 0, 'clause');
  assert.notEqual(vit.surface, usdc.surface);
});

test('P-13 reads the bond and never recomputes or floors it (contract v29)', () => {
  // Two disagreeing implementations of P-13 once shipped in one client: this table declared
  // the bond "recomputed and displayed" from a cohort escrow, while `oracle-reporting.ts`
  // had concluded it is structurally uncomputable and shipped that. A bonded, slashable
  // action carried two different answers to "what will this hold?".
  //
  // Contract v29 settles it in the third direction, which neither implementation had:
  // `FutarchyApi.bond_quote` publishes the amount, so the row makes one exact chain read.
  const clauses = rowsFor('P-13', 'USDC');
  // The escrow clause cited `storage.epoch.cohorts`, and `CohortInfo { epoch, proposals,
  // status }` carries no escrow field at all — a clause reading a map that cannot answer it,
  // which typechecks because a `SurfaceId` says nothing about what the item holds.
  assert.ok(
    !clauses.some((clause) => clause.surface === 'storage.epoch.cohorts'),
    'P-13 still reads the cohort map for an escrow it does not carry',
  );
  assert.ok(
    !clauses.some((clause) => /recomputed|recompute/i.test(clause.requirement)),
    'P-13 still promises a recomputed bond',
  );
  // The **floor clause is deleted, not kept beside the quote** (SQ-620): a floor is a lower
  // bound on the bond and never the bond, and two answers to "what will this hold?" is the
  // defect this row already carried once.
  assert.ok(
    !clauses.some((clause) => clause.key === 'bond-floor'),
    'P-13 still reads a floor beside the quote — two answers to one question',
  );
  assert.ok(
    !clauses.some((clause) => /floor/i.test(clause.requirement)),
    'a P-13 clause still describes the bond as a floor',
  );
  // What it does read: the quote, from the method 02 §3 publishes, and the headroom against
  // **that amount** rather than against a bound.
  const quote = clauses.find((clause) => clause.key === 'bond-quote');
  assert.ok(quote !== undefined, 'P-13 declares no bond-quote clause');
  assert.equal(quote.surface, 'api.bond_quote');
  assert.equal(quote.source, 'runtime-api');
  const headroom = clauses.find((clause) => clause.key === 'bond-headroom');
  assert.ok(headroom !== undefined, 'P-13 declares no bond-headroom clause');
  assert.match(headroom.requirement, /covers that bond/, 'the headroom is not against the quote');
  // And the gap is gone rather than restated: SQ-598 was the declaration, and the method is
  // the answer, so the row now carries no unreadable obligation at all.
  assert.deepEqual(unreadableObligationsFor('P-13'), []);
});

test('O-8 reads the same one method, and O-5 reads the per-caller stream projection', () => {
  // 02 §3 publishes **one** fold under two names — `StakeAtRisk(c, m)` and
  // `Exposure(kind, m)` are the same sum of `CohortEscrow(k)` in different scopes — so a
  // second surface here would be the drift the single method exists to prevent.
  for (const instance of ['incident', 'milestone'] as const) {
    const clauses = operatorRowsFor(instance)['O-8'];
    const quote = clauses.find((clause) => clause.key === 'bond-quote');
    assert.ok(quote !== undefined, `O-8/${instance} declares no bond-quote clause`);
    // One method for both instances — the request enum names the instance
    // (`IncidentFiling` / `MilestoneFiling`), so this clause needs no per-instance surface.
    assert.equal(quote.surface, 'api.bond_quote', instance);
  }
  assert.deepEqual(unreadableObligationsFor('O-8'), []);

  // O-5's three clauses over one method, not one: presence in a per-caller projection **is**
  // the exists-and-is-yours check, `cancelled` is a separate refusal, and `claimable_now > 0`
  // is the amount. Folding them would report one reason for three different states, which is
  // exactly what 11 §11.8.3 rule 2 forbids on screen.
  const o5 = rowsFor('O-5', 'USDC');
  const streams = o5.filter((clause) => clause.surface === 'api.treasury_streams');
  assert.deepEqual(
    streams.map((clause) => clause.key).sort(),
    ['claimable', 'stream-live', 'stream-yours'],
  );
  // Per **caller**: the projection is `treasury_streams(who)`, so these are `acting` reads
  // rather than chain-wide ones — a `chain` subject would read somebody else's streams.
  for (const clause of streams) assert.equal(clause.subject, 'acting', clause.key);
  // §7.6's closing rule still stands unamended: the row binds `nav()` as well, and no raw
  // `pallet-futarchy-treasury` storage appears anywhere in it.
  assert.ok(o5.some((clause) => clause.surface === 'api.nav'), 'O-5 stopped binding nav()');
  assert.ok(
    !o5.some((clause) => clause.surface.startsWith('storage.futarchy_treasury')),
    'O-5 binds raw treasury storage, which 02 §7.6 forbids',
  );
  assert.deepEqual(unreadableObligationsFor('O-5'), []);
});

test('O-4 declares every readable trigger item, not the one the form happens to select', () => {
  // 11 §11.8.2 makes the trigger read part of the precondition row, and `gate()` checks a
  // preparation's declared clauses against the **row**. A clause list that varied with a form
  // field would let a preparation built for one trigger mint a window a different trigger's
  // evaluation never covered — the `GatePassed`-for-other-bytes defect, one level up.
  const surfaces = new Set(rowsFor('O-4', 'USDC').map((clause) => clause.surface));
  // Typed as `SurfaceId`, so an item 02 §7 does not freeze is a compile error here rather
  // than a runtime miss — the same discipline the row itself is held to.
  for (const item of [
    'storage.constitution.phase_flags',
    'storage.welfare.gate_breach_flags',
    'storage.epoch.epoch_of',
    'storage.execution_guard.migration_halt',
    'storage.epoch.pending_oracle_voids',
    'storage.ledger.ledger_drifted',
  ] as const satisfies readonly SurfaceId[]) {
    assert.ok(surfaces.has(item), `O-4 does not read ${item}`);
  }
  // **Not `PhaseFlags` bit 5**, which is the applied freeze effect and is clear at the moment
  // an activation is proposed — a client bound to it would refuse the one action the drift
  // authorizes (02 §7.4, contract v29; 06 §6.3). The item read is the I-4 latch itself, and
  // the row says so rather than leaving the distinction to a comment.
  const drift = rowsFor('O-4', 'USDC').find(
    (clause) => clause.surface === 'storage.ledger.ledger_drifted',
  );
  assert.ok(drift !== undefined);
  assert.match(drift.requirement, /ledger-drift latch/);
  assert.deepEqual(unreadableObligationsFor('O-4'), []);
});

test('m9 — the pending-action COUNT is a propose obligation, so O-4 declares it (SQ-1022)', () => {
  // SQ-1022's own text says the count is readable and points at O-3 for the declaration. But
  // `guardian_core::propose_action` is what refuses on `pending.len() >= 64`, so the count is
  // a **propose**-side precondition and O-3 is the approve row — which declares
  // `PendingActions` because an approval reads the action itself, not because anybody counts.
  // The clause was therefore declared on the row that does not need it and missing from the
  // one that does, and `clauseGroupsFor` reports an undeclared read as vacuously passed.
  const o4 = rowsFor('O-4', 'USDC').find((clause) => clause.key === 'pending-count');
  assert.ok(o4 !== undefined, 'O-4 does not read the pending-action queue');
  assert.equal(o4.surface, 'storage.guardian.pending_actions');
  assert.equal(o4.subject, 'chain');
  // O-3 keeps its own, for its own reason — the action, not the count.
  const o3 = rowsFor('O-3', 'USDC').find(
    (clause) => clause.surface === 'storage.guardian.pending_actions',
  );
  assert.ok(o3 !== undefined, 'O-3 stopped reading the action it is approving');
  assert.equal(o3.key, 'pending');
});

test('m10 — the allowance is a GLOBAL StorageValue, so its clause is chain-scoped on both rows', () => {
  // `pallet_guardian` declares `Allowances: StorageValue<_, AllowanceState>` — one value with
  // no account key at all, and the counters inside it are per power and per epoch, never per
  // guardian. Both rows marked it `subject: 'acting'`, so `accountForClause` resolved an
  // account for a read that has none: a proxy or multisig wrapper silently changed which key
  // a keyless read was attributed to, and a refresh could then compare two different answers
  // to a question that has exactly one.
  for (const row of ['O-3', 'O-4'] as const) {
    const allowance = rowsFor(row, 'USDC').find((clause) => clause.key === 'allowance');
    assert.ok(allowance !== undefined, `${row} declares no allowance clause`);
    assert.equal(allowance.surface, 'storage.guardian.allowances');
    assert.equal(allowance.subject, 'chain', `${row}'s allowance clause resolves an account`);
    // Anti-vacuity: the same row still has genuinely account-scoped clauses, so this is not a
    // sweep that made every subject `chain`.
    assert.ok(
      rowsFor(row, 'USDC').some((clause) => clause.subject === 'acting'),
      `${row} has no acting-scoped clause left, so the subject check proves nothing`,
    );
  }
});

test('P-13 splits "round open" from "report window not elapsed"', () => {
  // §11.5 writes them with a semicolon between them, and they come apart on a live round: a
  // round still open whose report window has elapsed refuses the report, and one collapsed
  // flag cannot say which half failed.
  const keys = rowsFor('P-13', 'USDC').map((clause) => clause.key);
  assert.ok(keys.includes('round-open'), 'the round-open clause is missing');
  assert.ok(keys.includes('report-window'), 'the report-window clause is missing');
});

/**
 * The status cell of a PLAN.md spec-question row, or `undefined` when there is no such row.
 *
 * The table is `| id | question | spec refs | raised | status |`, and the status cell is the
 * last one. Read rather than searched for a keyword, because "Resolved" appears inside the
 * *question* text of several rows that are still open.
 */
function specQuestionStatus(plan: string, id: string): string | undefined {
  const row = plan.split('\n').find((line) => line.startsWith(`| ${id} |`));
  if (row === undefined) return undefined;
  const cells = row.split('|');
  // `split` yields a leading and a trailing empty cell for a well-formed GFM row.
  return cells[cells.length - 2]?.trim();
}

test('an unreadable obligation names an OPEN spec question, and blocking ones close a control', () => {
  // The declaration expires the way the limit-coverage registry's unwired keys do — by the
  // row closing in PLAN.md, not by somebody remembering to delete a comment.
  //
  // **That is what this test says and, until 2026-08-06, not what it checked.** It asserted
  // the cited id was *a row* in the table and never looked at the row's status, so contract
  // v28 could resolve SQ-615, SQ-616 and SQ-619 — freezing six surfaces in this branch's own
  // base — while three `blocking` entries stayed behind and closed S15, S17 and S19 for good.
  // A screen that can never reach `ready` is a screen nothing has exercised, and the operator
  // suite had settled for asserting the block. The status cell is now read.
  const plan = readFileSync(join(REPO, 'PLAN.md'), 'utf8');
  const all = [...ROW_IDS, ...OPERATOR_IDS].flatMap((id) => unreadableObligationsFor(id));
  assert.ok(all.length > 0, 'no obligations declared — this test would be vacuous');
  for (const entry of all) {
    assert.match(entry.specQuestion, /^SQ-\d+$/, `${entry.requirement} cites no spec question`);
    const status = specQuestionStatus(plan, entry.specQuestion);
    assert.ok(status !== undefined, `${entry.specQuestion} is not a row in PLAN.md's spec-question table`);
    assert.ok(
      /open/i.test(status) && !/^resolved/i.test(status),
      `${entry.specQuestion} is "${status}" in PLAN.md, so this declaration outlived the ` +
        'question it waits on and is closing a control for a reason that no longer holds',
    );
    assert.ok(entry.reason.length > 40, `${entry.specQuestion}'s reason says nothing usable`);
  }
  // Anti-vacuity for the status check itself: a resolved row must be rejected, or the
  // predicate above could be matching everything.
  assert.ok(
    !/open/i.test(specQuestionStatus(plan, 'SQ-615') ?? ''),
    'SQ-615 reads as open — the resolved-row half of this check proves nothing',
  );
  // `stated` is §11.8.1's SQ-564 posture — the transaction is offered and the gap is named.
  assert.ok(all.some((entry) => entry.disposition === 'stated'));
  // **`blocking` is empty again.** It was empty at contract v29, two entries on 2026-08-08
  // (both `O-3`, both SQ-1030 — `approve_action` reads `Guardian.PlaybookRegistered[id]` and
  // `dispatch` reads `Guardian.ActivePlaybooks`, both **after** the fifth approval is counted),
  // and empty from 2026-08-09 because contract v30 froze both maps. It is asserted rather than
  // assumed in either direction: a blocking entry closes an operator control, so appearing here
  // must be a deliberate act — and disappearing must be a freeze rather than a deletion, which
  // is what the replacement-clause assertions below check.
  assert.deepEqual(
    all.filter((entry) => entry.disposition === 'blocking').map((entry) => entry.row),
    [],
    'the blocking set changed; every entry closes an operator control, so this is deliberate',
  );
  // Each retired row's replacement read is present, so "no obligation" is not "no check".
  // O-6 (SQ-615, contract v28): §11.8.4 steps 1 and 4 became ordinary clauses.
  assert.deepEqual(blockingObligationsFor('O-6'), [], 'S17 is still closed on a resolved question');
  assert.ok(
    rowsFor('O-6', 'USDC').some((clause) => clause.surface === 'storage.system.authorized_upgrade'),
    'O-6 does not read the authorized hash it is supposed to compare against',
  );
  assert.ok(
    rowsFor('O-6', 'USDC').some((clause) => clause.surface === 'storage.execution_guard.pending_upgrade'),
    'O-6 does not read the stored applicable_at',
  );
  // P-13 / O-8 (SQ-598, SQ-731) and O-5 (SQ-601), contract v29: the bond and the claimable
  // amount are published, so each row reads the figure instead of declaring it unreadable.
  for (const [row, surface] of [
    ['P-13', 'api.bond_quote'],
    ['O-8', 'api.bond_quote'],
    ['O-5', 'api.treasury_streams'],
  ] as const) {
    assert.deepEqual(blockingObligationsFor(row), [], `${row} is still closed on a resolved question`);
    assert.ok(
      rowsFor(row, 'USDC').some((clause) => clause.surface === surface),
      `${row} declares no ${surface} clause, so its check was retired rather than replaced`,
    );
  }
  // O-4 (SQ-730): the trigger reads §11.8.2 now binds, one clause per readable variant.
  assert.deepEqual(blockingObligationsFor('O-4'), []);
  assert.ok(
    rowsFor('O-4', 'USDC').filter((clause) => clause.key?.startsWith('trigger-')).length >= 6,
    'O-4 declares no trigger reads, so §11.8.2’s precondition was dropped rather than bound',
  );
  // O-3 (SQ-1030), contract v30: the two maps `approve_action` and `dispatch` refuse on.
  assert.deepEqual(blockingObligationsFor('O-3'), [], 'S15 is still closed on a resolved question');
  // **Both guardian rows, not only the approve one.** The refusals fall on the dispatching
  // approval and the runtime checks neither at propose time — which is exactly what it does
  // with `PB-MIGRATION`'s empty admissible call set, and the client blocks that at propose
  // time because 06 §6.2 guarantees the fifth approval reverts and records nothing. Same cost,
  // same signatures; a propose row declaring every other dispatch input and not these two
  // leaves them undeclared, which `clauseGroupsFor` reports as vacuously passed.
  for (const row of ['O-3', 'O-4'] as const) {
    for (const surface of ['storage.guardian.playbook_registered', 'storage.guardian.active_playbooks'] as const) {
      assert.ok(
        rowsFor(row, 'USDC').some((clause) => clause.surface === surface),
        `${row} declares no ${surface} clause, so its check was retired rather than replaced`,
      );
    }
  }
});

test('a meter is a pair, so both guardian rows declare the limit as well as the counter', () => {
  // Contract v30's own words in 02 §9's binding row: the four constants are read "**together
  // with** §7.4's `Guardian.Allowances`, which stores the used counters alone. A meter is the
  // pair; neither half is a meter."
  //
  // Before the freeze no constant published a bound, so `AllowanceMeter.limit` had no producer
  // and the only way to satisfy §11.8.2's "allowance remaining for the power" precondition was
  // to invent one — INV-FE-1 twice over. A row declaring the counter and not the limit leaves
  // the other half undeclared, which `clauseGroupsFor` reports as vacuously passed.
  const required = [
    'constant.guardian.delay_once_allowance_per_epoch',
    'constant.guardian.force_rerun_allowance_per_epoch',
    'constant.guardian.pause_intake_allowance',
    // Two for `pause_intake`, because a count without its window is not a rate: the counter is
    // reset lazily at consume time, so a client holding it without the window length and the
    // epoch to measure from reads an exhausted meter for a power the chain would accept.
    'constant.guardian.pause_intake_allowance_window_epochs',
    'storage.epoch.epoch_of',
    'storage.guardian.allowances',
  ] as const;
  for (const row of ['O-3', 'O-4'] as const) {
    const declared = new Set(rowsFor(row, 'USDC').map((clause) => clause.surface));
    for (const surface of required) {
      assert.ok(declared.has(surface), `${row} does not declare ${surface}`);
    }
    // The window read is its own clause rather than sharing the trigger clause's requirement
    // sentence — O-5's `api.nav` precedent: one read can answer two questions, and two
    // refusals with different remedies cannot share one sentence.
    const epochClauses = rowsFor(row, 'USDC').filter(
      (clause) => clause.surface === 'storage.epoch.epoch_of',
    );
    assert.deepEqual(
      epochClauses.map((clause) => clause.key).sort(),
      ['allowance-window-epoch', 'trigger-epoch'],
      `${row} folded the allowance window's epoch read into the trigger clause`,
    );
  }
});

test('an obligation is scoped by ONE predicate, so the two lists cannot describe different actions', () => {
  // A row is one id for a whole call. `guardian.approve_action` is `O-3` for all five powers,
  // and the runtime does not evaluate one set of conditions for all five — so an obligation
  // attached to the row unconditionally closes the control for powers whose dispatch never
  // reads it. That is the inverse of the defect this list exists to prevent, and it is not the
  // harmless direction: 09 §1.2's mirror is about a client refusing what the runtime accepts.
  //
  // The Codex review of #287 found the repair **half applied**: the filter was on
  // `blockingObligationsFor` alone, while `operatorGate.unreadable` — which `GateControl`
  // renders unconditionally — kept the unscoped set. So the control opened for a `pause_intake`
  // and the caveat panel beside it still described a playbook activation's dispatch. There is
  // one predicate now, and both lists take it.
  //
  // **The scoped users are gone and the machinery stays.** Contract v30 froze both maps, so
  // `O-3`'s two scoped obligations became clauses; `ObligationScope` is kept because `O-3` is
  // still one row for five powers and the next narrow obligation needs it, and because
  // re-adding a control after deleting it is how the half-applied state arose. That makes this
  // test synthetic by necessity: the real table carries no scoped entry, so a test over it
  // would agree vacuously and prove nothing.
  const scoped = (scope?: ObligationScope): UnreadableObligation => ({
    row: 'O-3',
    requirement: 'a condition only one dispatch arm reads',
    reason: 'synthetic — this exercises the predicate, not the table',
    specQuestion: 'SQ-1022',
    disposition: 'blocking',
    ...(scope === undefined ? {} : { scope }),
  });
  const unscoped = scoped();
  const anyActivation = scoped({ power: 'activate_playbook' });
  const freezeOnly = scoped({ power: 'activate_playbook', playbook: 'PB-LEDGER-FREEZE' });

  // An unscoped obligation is about the whole call and survives every subject.
  for (const power of ['pause_intake', 'delay_once', 'force_rerun', 'suspend_on_gate', 'activate_playbook'] as const) {
    assert.equal(obligationAppliesTo(unscoped, { power }), true, power);
  }
  // No subject at all: everything is kept. A caller that cannot name the power has not shown
  // the narrow obligations do not apply, and dropping one on that would be fail-open.
  assert.equal(obligationAppliesTo(freezeOnly, undefined), true);
  // A positive match failure on the power…
  for (const power of ['pause_intake', 'delay_once', 'force_rerun', 'suspend_on_gate'] as const) {
    assert.equal(obligationAppliesTo(anyActivation, { power }), false, power);
  }
  assert.equal(obligationAppliesTo(anyActivation, { power: 'activate_playbook' }), true);
  // …and on the playbook, which is the narrower half. A power-scoped obligation is NOT
  // narrowed by a playbook it does not name — dropping it there would soften an obligation
  // rather than scope it.
  assert.equal(obligationAppliesTo(anyActivation, { power: 'activate_playbook', playbook: 'PB-DEPEG' }), true);
  assert.equal(obligationAppliesTo(freezeOnly, { power: 'activate_playbook', playbook: 'PB-DEPEG' }), false);
  assert.equal(
    obligationAppliesTo(freezeOnly, { power: 'activate_playbook', playbook: 'PB-LEDGER-FREEZE' }),
    true,
  );

  // Both public lists route through it, and `scopedObligationsFor` filters on **scope, never
  // on disposition**: a `stated` obligation does not close a control and must still be shown.
  for (const subject of [
    undefined,
    { power: 'pause_intake' },
    { power: 'activate_playbook' },
    { power: 'activate_playbook', playbook: 'PB-LEDGER-FREEZE' },
  ] as const) {
    const shown = scopedObligationsFor('O-3', subject);
    assert.deepEqual(
      blockingObligationsFor('O-3', subject),
      shown.filter((entry) => entry.disposition === 'blocking'),
      'the blocking list and the displayed list disagree about which action they describe',
    );
    assert.ok(
      shown.some((entry) => entry.disposition === 'stated'),
      'a stated obligation was filtered out — the filter is on scope, not on disposition',
    );
  }
});

test('the pallet still guards both playbook refusals where the client evaluates them', () => {
  // The scoping moved from `O-3`'s obligations into `guardian.ts`'s model when contract v30
  // froze the maps, and the runtime claim it rests on did not change: `approve_action` guards
  // `PlaybookRegistered` behind `ActivatePlaybook`, and `dispatch` narrows
  // `PlaybookAlreadyActive` to `LedgerFreeze` alone.
  //
  // Asserted against the **pallet**, not restated from the client. If a future change widens
  // either check to every power or every playbook, this fails and says which way the client
  // must move — the only way a claim and the code it describes can be kept from drifting
  // apart in silence.
  const pallet = readFileSync(join(REPO, 'pallets/guardian/src/lib.rs'), 'utf8');
  const core = readFileSync(join(REPO, 'crates/guardian-core/src/lib.rs'), 'utf8');
  assert.match(
    pallet,
    /if let GuardianPower::ActivatePlaybook \{ id, \.\. \} = action\.power \{\s*ensure!\(\s*PlaybookRegistered::<T>::get\(id\),/,
    'approve_action no longer guards PlaybookRegistered behind ActivatePlaybook — rescope the client',
  );
  assert.match(
    core,
    /if self\.active_playbooks\.iter\(\)\.any\(\|p\| p\.id == id\) \{\s*ensure!\(\s*!matches!\(id, PlaybookId::LedgerFreeze\),/,
    'dispatch no longer narrows PlaybookAlreadyActive to LedgerFreeze — rescope the client',
  );
});

test('the welfare snapshot crank is in P-15’s staleness table', () => {
  // §11.8.5 binds it to row P-15 by name — "otherwise 'no-op — nothing to crank' (row
  // P-15)" — while `CrankCall` listed six members and this was not one. `crankStaleness`
  // throws on an unrecognised call by design, so the one crank §11.8's own text puts in the
  // table could not be gated at all, and the S18 console had to answer the staleness
  // question itself.
  assert.ok(CRANK_CALLS.includes('welfare.record_snapshot'), CRANK_CALLS.join(', '));
  const staleness = crankStaleness('welfare.record_snapshot');
  assert.equal(staleness.kind, 'readable', 'Welfare.Snapshots is frozen surface — it needs no exemption');
  assert.equal(staleness.clause.surface, 'storage.welfare.snapshots');
});
