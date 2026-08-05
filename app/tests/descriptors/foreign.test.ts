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
import type { ForeignObservation, SurfaceProbe } from '@bleavit/descriptors';

const PIN = {
  label: 'Asset Hub',
  genesisHash: '0x68d56f15f85d3136970ec16946040bc1752654e906147f7e43e9d539d7c3de2f',
  supportedSpecVersions: [1_004_000, 1_004_001],
};

const allProven = (): SurfaceProbe[] =>
  FOREIGN_SURFACE.map((entry) => ({ id: entry.id, compatible: true, level: 'identical' }));

/**
 * A verdict's reason, or a failure saying it gave none.
 *
 * `ForeignVerdict.reason` is `string | undefined` because a `proven` verdict has nothing to
 * explain. Every assertion below is on a *blocking* verdict, where a missing reason is the
 * defect — 10 §5.2 requires the deposit leg to be disabled *with a named reason* — so an
 * absent one should fail here rather than be silently matched against `undefined`.
 */
function reasonOf(verdict: { readonly reason: string | undefined }): string {
  assert.ok(verdict.reason !== undefined, 'the verdict blocks the deposit leg without saying why');
  return verdict.reason;
}

const observation = (over: Partial<ForeignObservation> = {}): ForeignObservation => ({
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

test('this release pins Asset Hub Paseo, and every pin is backed by a committed artifact', () => {
  // The empty case was the shipped default while the artifacts did not exist. It is now
  // filled, and what this asserts is the *binding* rather than the values: the numbers
  // themselves are cross-checked against `fixtures/foreign-chain-feed/` in both directions
  // by `pnpm run foreign:check`, so restating them here would only add a third copy to
  // keep true. What cannot be checked there, and is checked here, is that the shape is
  // well-formed — a pin missing its genesis hash cannot answer the `wrong-chain` question,
  // which would make the one terminal verdict unreachable.
  assert.ok(FOREIGN_CHAIN_PINS.length > 0, 'the Asset Hub pin landed 2026-08-04 (F4)');
  for (const pin of FOREIGN_CHAIN_PINS) {
    assert.match(pin.genesisHash, /^0x[0-9a-f]{64}$/, `${pin.label}: genesis must be 32 bytes`);
    assert.ok(pin.supportedSpecVersions.length > 0, `${pin.label}: no spec_version`);
    for (const version of pin.supportedSpecVersions) {
      assert.ok(Number.isInteger(version) && version > 0, `${pin.label}: bad spec_version`);
    }
  }
});

test('with no pin the verdict is unreachable and the deposit leg is blocked, not permitted', () => {
  // Still reachable, and deliberately so: 08 §2.5 phases the Asset Hub connection — Paseo
  // at Phase 2, Polkadot at Phase 3 — so a release targeting a relay whose Asset Hub this
  // repository has not pinned is a state the rollout *has*, not a historical one. Passing
  // an explicit empty pin set exercises it without depending on the shipped constant, which
  // is what let this test keep its meaning after the pin landed.
  const verdict = classifyForeign(observation(), []);
  assert.equal(verdict.mode, 'unreachable');
  assert.equal(depositMayProceed(verdict), false);
  assert.match(reasonOf(verdict), /pins no Asset Hub runtime/);
  assert.match(reasonOf(verdict), /every other part of the app is unaffected/);
});

/* ------------------------------------------------------------------- identity vs compat */

test('a genesis mismatch is wrong-chain, never unsupported — a different chain, not an older one', () => {
  const verdict = classifyForeign(observation({ genesisHash: '0xdead' }), [PIN]);
  assert.equal(verdict.mode, 'wrong-chain');
  assert.match(reasonOf(verdict), /different chain/);
  assert.match(reasonOf(verdict), /retrying will not change this/);
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
  // A deliberately *unfrozen* id: the point is that coverage is checked by identity, not by
  // count. `SurfaceProbe.id` is a plain `string`, so this needs no escape — but the array
  // came from `FOREIGN_SURFACE`, whose element ids are literal types, hence the annotation.
  const foreign: SurfaceProbe = { id: 'assethub.Something.Else', compatible: true, level: 'identical' };
  wrong.push(foreign);
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
  assert.match(reasonOf(verdict), /Deposits are disabled/);
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
