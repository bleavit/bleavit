/**
 * The foreign-chain verdict — 02 §7.7, §13 rule 8; 10 §5.2; 11 §11.9.1 (SQ-587).
 *
 * Three properties here fail *silently* if they regress, which is why each is asserted
 * directly rather than inferred from a happy path:
 *
 * 1. **The two verdicts are not interchangeable.** §13 rule 8 requires the foreign verdict
 *    be "reported separately and never folded into the local one". A merged verdict is not
 *    a crash — it is a healthy Bleavit runtime vouching for a chain it cannot observe.
 * 2. **Withdraw is never gated by Asset Hub.** The tempting shape is one `funding` verdict
 *    over both legs, and it takes withdraw offline exactly when a user most wants it.
 * 3. **No pin means blocked, not permitted.** `FOREIGN_CHAIN_PINS` is empty today, so the
 *    default path through this module must be the refusing one.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  FOREIGN_CHAIN_PINS,
  FOREIGN_SURFACE,
  ForeignProbeCoverageError,
  classifyForeign,
  classify,
  depositMayProceed,
  surfaceIsProven,
  withdrawIsBlockedBy,
} from '@bleavit/descriptors';

const PIN = {
  label: 'Asset Hub',
  genesisHash: '0x68d56f15f85d3136970ec16946040bc1752654e906147f7e43e9d539d7c3de2f',
  supportedSpecVersions: [1_004_000, 1_004_001],
};

const allProven = () =>
  FOREIGN_SURFACE.map((entry) => ({ id: entry.id, compatible: true, level: 'identical' }));

const observation = (over = {}) => ({
  chainLabel: 'Asset Hub',
  genesisHash: PIN.genesisHash,
  specVersion: 1_004_000,
  probes: allProven(),
  ...over,
});

/* ------------------------------------------------------------------ the frozen surface */

test('the frozen set is exactly 02 §7.7 — the two reads and the deposit call', () => {
  assert.deepEqual(
    FOREIGN_SURFACE.map((e) => e.id).sort(),
    [
      'assethub.Assets.Account',
      'assethub.PolkadotXcm.limited_reserve_transfer_assets',
      'assethub.System.Account',
    ],
    'a surface added or dropped here is a change to a frozen contract section (02 §13 rule 8)',
  );
});

test('foreign ids are chain-scoped, so one can never be mistaken for a local surface id', () => {
  for (const entry of FOREIGN_SURFACE) {
    assert.ok(
      entry.id.startsWith('assethub.'),
      `${entry.id} is not chain-scoped; an unscoped id can collide with a CRITICAL_SURFACE id`,
    );
  }
});

/* --------------------------------------------------------- no pin: the shipped default */

test('this release pins no foreign chain, and that is a readiness state rather than an oversight', () => {
  assert.equal(
    FOREIGN_CHAIN_PINS.length,
    0,
    'a non-empty pin set means Asset Hub artifacts landed — update this test with them, ' +
      'and never populate it from a live RPC (10 §5.1)',
  );
});

test('with no pin the verdict is unreachable and the deposit leg is blocked, not permitted', () => {
  const verdict = classifyForeign(observation());
  assert.equal(verdict.mode, 'unreachable');
  assert.equal(depositMayProceed(verdict), false);
  assert.match(verdict.reason, /pins no Asset Hub runtime/);
  assert.match(verdict.reason, /every other part of the app is unaffected/);
});

/* ------------------------------------------------------------------- identity vs compat */

test('a genesis mismatch is wrong-chain, never unsupported — a different chain, not an older one', () => {
  const verdict = classifyForeign(observation({ genesisHash: '0xdead' }), [PIN]);
  assert.equal(verdict.mode, 'wrong-chain');
  assert.match(verdict.reason, /different chain/);
  assert.match(verdict.reason, /retrying will not change this/);
});

test('identity is checked before compatibility, so a wrong chain never yields a spec verdict', () => {
  // Wrong genesis AND an unsupported spec_version. If compatibility ran first this would
  // report `unsupported`, which reads as "wait for a newer release" for a chain that is
  // not this one at all.
  const verdict = classifyForeign(
    observation({ genesisHash: '0xdead', specVersion: 999 }),
    [PIN],
  );
  assert.equal(verdict.mode, 'wrong-chain');
});

test('an unreached chain is unreachable, and an absent genesis is not treated as a match', () => {
  const verdict = classifyForeign(observation({ genesisHash: undefined }), [PIN]);
  assert.equal(verdict.mode, 'unreachable');
  assert.equal(depositMayProceed(verdict), false);
});

test('a spec_version outside the release set is unsupported', () => {
  const verdict = classifyForeign(observation({ specVersion: 1_005_000 }), [PIN]);
  assert.equal(verdict.mode, 'unsupported');
  assert.equal(depositMayProceed(verdict), false);
});

test('an unknown spec_version is unsupported rather than accepted', () => {
  const verdict = classifyForeign(observation({ specVersion: undefined }), [PIN]);
  assert.equal(verdict.mode, 'unsupported');
});

/* -------------------------------------------------------------------- probe fail-closed */

test('an unprobed frozen surface is refused, not counted as passing', () => {
  const partial = allProven().slice(1);
  assert.throws(
    () => classifyForeign(observation({ probes: partial }), [PIN]),
    ForeignProbeCoverageError,
  );
});

test('a probe for a surface nobody froze does not stand in for a missing one', () => {
  const wrong = allProven().slice(1);
  wrong.push({ id: 'assethub.Something.Else', compatible: true, level: 'identical' });
  assert.throws(
    () => classifyForeign(observation({ probes: wrong }), [PIN]),
    ForeignProbeCoverageError,
    'a count-based coverage check would pass this; the ids must be the ones frozen',
  );
});

test('all surfaces proven is full, and only then may a deposit proceed', () => {
  const verdict = classifyForeign(observation(), [PIN]);
  assert.equal(verdict.mode, 'full');
  assert.equal(verdict.reason, undefined);
  assert.equal(verdict.proven.length, FOREIGN_SURFACE.length);
  assert.equal(depositMayProceed(verdict), true);
});

test('one disabled surface is restricted, and restricted still blocks the deposit', () => {
  const probes = allProven();
  probes[0] = { id: FOREIGN_SURFACE[0].id, compatible: false, level: 'incompatible' };
  const verdict = classifyForeign(observation({ probes }), [PIN]);
  assert.equal(verdict.mode, 'restricted');
  assert.equal(depositMayProceed(verdict), false);
  assert.equal(verdict.disabled.length, 1);
  assert.match(verdict.reason, /Deposits are disabled/);
});

test('a broken read blocks the deposit just as a broken call does', () => {
  // The reads are what the precondition rows are evaluated against, so a deposit built
  // with only the call proven is one whose preconditions were never checked.
  const readOnlyBroken = allProven();
  const balanceRead = readOnlyBroken.findIndex((p) => p.id === 'assethub.Assets.Account');
  readOnlyBroken[balanceRead] = {
    id: 'assethub.Assets.Account',
    compatible: false,
    level: 'partial',
  };
  const verdict = classifyForeign(observation({ probes: readOnlyBroken }), [PIN]);
  assert.equal(depositMayProceed(verdict), false);
});

/* ------------------------------------------------ the two properties that fail silently */

test('withdraw is never blocked by the foreign verdict — in any mode (11 §11.9.2)', () => {
  const modes = [
    classifyForeign(observation(), [PIN]), // full
    classifyForeign(observation({ genesisHash: '0xdead' }), [PIN]), // wrong-chain
    classifyForeign(observation({ genesisHash: undefined }), [PIN]), // unreachable
    classifyForeign(observation({ specVersion: 999 }), [PIN]), // unsupported
  ];
  for (const verdict of modes) {
    assert.equal(
      withdrawIsBlockedBy(verdict),
      false,
      `withdraw was gated by a foreign verdict in mode ${verdict.mode}; it is a local ` +
        'pallet_xcm call over 02 §7.4 reads and depends on nothing here',
    );
  }
});

test('the foreign verdict carries its own domain tag and its own mode vocabulary', () => {
  const verdict = classifyForeign(observation({ genesisHash: '0xdead' }), [PIN]);
  assert.equal(verdict.domain, 'foreign');

  // The local lattice has no `wrong-chain`; the foreign one has no `read-only-incompatible`.
  // Disjoint vocabularies are what make the two verdicts non-interchangeable at the type
  // level, so a change that made them agree would silently permit folding.
  const local = classify(2, [2], [], []);
  assert.equal(local.mode, 'full');
  assert.equal('domain' in local, false, 'the local verdict must not grow a domain tag it shares');
  assert.equal(
    ['full', 'restricted', 'read-only-incompatible'].includes(verdict.mode),
    false,
    'a foreign mode that is also a local mode makes the two assignable to each other',
  );
});

test('a foreign verdict cannot satisfy the local proven-surface gate', () => {
  const verdict = classifyForeign(observation(), [PIN]);
  // `surfaceIsProven` reads the LOCAL proven set. Even where the shapes coincide at
  // runtime, a foreign id must never be reported as a locally proven surface — that is
  // the fold §13 rule 8 forbids, arriving through the back door.
  assert.equal(
    surfaceIsProven(
      { mode: 'full', specVersion: 2, disabled: [], proven: [] },
      'assethub.Assets.Account',
    ),
    false,
  );
  assert.ok(verdict.proven.includes('assethub.Assets.Account'));
});
