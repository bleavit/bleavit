/**
 * S12/S13's reads over two light clients — 11 §11.9.1, §11.9.2.
 *
 * The properties here are all about *which chain a figure came from* and *what happens when
 * a read does not arrive*. Neither is visible on screen when it goes wrong: a wrong-chain
 * balance renders with a `verified-finalized` badge and is telling the truth about the wrong
 * chain, and a missing read renders as a plausible number.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SUDO_PRESENT_BIT,
  SameChainError,
  WrongChainInputError,
  depositBlocks,
  fundingReaders,
  readDepositInputs,
  readWithdrawInputs,
  sudoActive,
  withdrawBlocks,
} from '@bleavit/features-tx';
import type { FundingDecoders, FundingKeys, FundingReader } from '@bleavit/features-tx';
import type { Finalized, StorageItem } from '@bleavit/chain-client';
import { finalize } from '@bleavit/chain-client/testing';
import type { HexString, Verified } from '@bleavit/shared-types';

const LOCAL_CHAIN: HexString = `0x${'ce'.repeat(32)}`;
const AH_CHAIN: HexString = `0x${'a5'.repeat(32)}`;

/**
 * A reader over a fixed key→value map.
 *
 * An unlisted key returns **no items**, which is what a real chain does for an absent
 * account — and is the case several tests below turn on, since "absent" and "zero" must not
 * be the same outcome for the same reason "unknown" and "false" must not be.
 *
 * **`blockHash` is an explicit argument, and an earlier version derived it from `chain`.**
 * That made every same-chain pair share a block hash and every cross-chain pair differ, so a
 * `fundingReaders` that compared *blocks* instead of *chains* passed the whole suite — the
 * mutation survived. The fixture had quietly made the two properties the same property.
 * Separating them is what lets the tests below hold one fixed while varying the other.
 */
function reader(
  chain: HexString,
  values: Readonly<Record<string, string>>,
  height = 42,
  blockHash: HexString = `0x${'11'.repeat(32)}`,
): FundingReader {
  const at = { chain, blockHash, blockNumber: height };
  return {
    at,
    async storage(key: string): Promise<Finalized<readonly StorageItem[]>> {
      const value = values[key];
      return finalize(value === undefined ? [] : [{ key, value }], at);
    },
  };
}

const KEYS: FundingKeys = {
  assetHubUsdc: (assetId, who) => `ah:assets:${assetId}:${who}`,
  assetHubAccount: (who) => `ah:system:${who}`,
  phaseFlags: () => 'local:flags',
  localFreeUsdc: (who) => `local:usdc:${who}`,
};

/**
 * A USDC decoder that says WHICH chain's decoder it is.
 *
 * The two are separate members of `FundingDecoders` precisely so one chain's bytes cannot go
 * through the other chain's codec — but a symmetric stub makes that split untestable: swap
 * the two in `funding-reads.ts` and every assertion still passes. So each stub refuses the
 * other leg's marker prefix, which turns the swap into a decode failure a test can see.
 */
const usdcDecoder =
  (leg: 'ah' | 'local') =>
  (raw: string): ReturnType<FundingDecoders['assetHubUsdc']> => {
    if (raw.startsWith('bad')) return { ok: false, reason: 'not an account record' };
    const [marker, amount] = raw.split(':');
    if (marker !== leg) {
      return { ok: false, reason: `the ${leg} decoder was handed a "${String(marker)}" value` };
    }
    return { ok: true, value: { balance: BigInt(amount ?? '0') } };
  };

const DECODERS: FundingDecoders = {
  assetHubUsdc: usdcDecoder('ah'),
  localFreeUsdc: usdcDecoder('local'),
  systemAccount: (raw) =>
    raw.startsWith('bad')
      ? { ok: false, reason: 'not a system account' }
      : { ok: true, value: { viable: raw === 'viable' } },
  phaseFlags: (raw) => (raw.startsWith('bad') ? { ok: false, reason: 'not a u32' } : { ok: true, value: Number(raw) }),
};

const WHO = '5Grw';
const PARAMS = {
  who: WHO,
  assetId: 1337,
  amount: 1_000_000n,
  assetHubFee: 10_000n,
  minBalance: 10_000n,
  xcmHealthy: true,
  assetHubCompatible: true,
} as const;

type Values = Readonly<Record<string, string>>;

const AH_VALUES: Values = { [`ah:assets:1337:${WHO}`]: 'ah:5000000', [`ah:system:${WHO}`]: 'viable' };
const LOCAL_VALUES: Values = { 'local:flags': '0' };

const pair = (ah: Values = AH_VALUES, local: Values = LOCAL_VALUES) =>
  fundingReaders(reader(LOCAL_CHAIN, local, 7), reader(AH_CHAIN, ah, 99));

/* ------------------------------------------------------- the two chains must be two chains */

const BLOCK_A: HexString = `0x${'11'.repeat(32)}`;
const BLOCK_B: HexString = `0x${'22'.repeat(32)}`;

test('two readers on the SAME chain are refused — at DIFFERENT blocks, so only the chain can refuse', () => {
  // The single-character slip: `fundingReaders(r, r)`. Every Asset Hub figure would then be a
  // futarchy-chain read under an Asset Hub label — true about the wrong chain, which no badge
  // and no later check can detect.
  //
  // The blocks are deliberately different. A same-chain pair sharing a block hash is also
  // refused by a check comparing *blocks*, so a test built that way witnesses nothing — and
  // an earlier version of this file was built exactly that way, deriving the block hash from
  // the chain, which let a block-comparing mutant survive the whole suite.
  const one = reader(LOCAL_CHAIN, {}, 7, BLOCK_A);
  assert.throws(() => fundingReaders(one, one), SameChainError);
  assert.throws(() => fundingReaders(one, reader(LOCAL_CHAIN, {}, 900, BLOCK_B)), SameChainError);
});

test('two readers on different chains are accepted AT THE SAME BLOCK HASH AND HEIGHT', () => {
  // The complement, and the other half of the same construction: two chains routinely reach
  // the same height, and a fixture may hand them the same hash. A check comparing blocks
  // would refuse this correct pair. Only a chain comparison accepts it.
  const readers = fundingReaders(
    reader(LOCAL_CHAIN, {}, 42, BLOCK_A),
    reader(AH_CHAIN, {}, 42, BLOCK_A),
  );
  assert.equal(readers.local.at.chain, LOCAL_CHAIN);
  assert.equal(readers.assetHub.at.chain, AH_CHAIN);
});

test('each leg is stamped with ITS OWN pin, never the other leg’s', async () => {
  // 11 §11.9: "both legs are labelled with their own provenance". The Asset Hub balance must
  // carry the Asset Hub chain and the Asset Hub block — a model whose leaves all shared one
  // pin would be a model that had silently mixed the two chains.
  const { inputs } = await readDepositInputs(pair(), KEYS, DECODERS, PARAMS);
  assert.ok(inputs.assetHubBalance !== undefined, 'the Asset Hub balance decoded and is present');
  const status = inputs.assetHubBalance.status;
  assert.ok(status.kind === 'verified-finalized');
  assert.equal(status.chain, AH_CHAIN, 'the Asset Hub balance was stamped with the local chain');
  assert.equal(status.blockNumber, 99, 'the Asset Hub balance was stamped with the local block');
});

test('a D-13 cap read on another chain is refused', async () => {
  // The caps arrive already stamped, so they are the one place a foreign value can enter the
  // local leg unchallenged — and a cap from elsewhere bounds the deposit against a limit that
  // does not apply to it.
  const onAh = (value: bigint): Verified<bigint> => ({
    value,
    status: { kind: 'verified-finalized', chain: AH_CHAIN, blockHash: `0x${'aa'.repeat(32)}`, blockNumber: 99 },
  });
  await assert.rejects(
    () =>
      readDepositInputs(pair(), KEYS, DECODERS, {
        ...PARAMS,
        caps: { globalTvlHeadroom: onAh(1n), perAccountHeadroom: onAh(1n) },
      }),
    WrongChainInputError,
  );
});

test('a D-13 cap read on the local chain is accepted', async () => {
  // The complement, so the refusal above cannot pass by refusing everything.
  const onLocal = (value: bigint): Verified<bigint> => ({
    value,
    status: { kind: 'verified-finalized', chain: LOCAL_CHAIN, blockHash: `0x${'cc'.repeat(32)}`, blockNumber: 7 },
  });
  const { inputs } = await readDepositInputs(pair(), KEYS, DECODERS, {
    ...PARAMS,
    caps: { globalTvlHeadroom: onLocal(9n), perAccountHeadroom: onLocal(9n) },
  });
  assert.equal(inputs.caps?.globalTvlHeadroom.value, 9n);
});

/* ------------------------------------------------------------------- the bit, not a number */

test('sudo is a BIT, and the two numeric readings are each wrong in an unsafe direction', () => {
  // V-115. `PhaseFlags` is a u32 bitset with no ordering. A real bootstrap value of 17 is
  // shadow-mode + sudo-present: `17 >= 4` is true and would *hide* the sudo banner, `17 < 4`
  // is false and would *skip* D-13's caps during exactly the window they exist for. Both
  // numeric readings compare without error, which is why this is asserted rather than assumed.
  assert.equal(sudoActive(17), true);
  assert.equal(17 >= 4, true, 'the reading that hides the banner');
  assert.equal(17 < 4, false, 'the reading that skips the caps');

  assert.equal(sudoActive(0), false);
  assert.equal(sudoActive(SUDO_PRESENT_BIT), true);
  // A high bit set with sudo clear must read as clear, not as "some flag is set".
  assert.equal(sudoActive(1 | 2 | 8), false);
});

test('an unreadable PhaseFlags means the caps APPLY, not that they do not', async () => {
  // INV-FE-12: unread and undecodable collapse to the same fail-closed answer, because both
  // mean the client cannot establish that sudo is gone. The unsafe direction is skipping the
  // caps, so the default is to treat them as in force.
  for (const local of [{}, { 'local:flags': 'bad' }]) {
    const { inputs, undecodable } = await readDepositInputs(pair(AH_VALUES, local), KEYS, DECODERS, PARAMS);
    assert.equal(inputs.bootstrapPhase, true);
    assert.equal(undecodable.length, 1, 'the failed read was not reported');
    // And the consequence, through the model: with no caps supplied, the deposit blocks.
    assert.ok(depositBlocks(inputs).some((b) => b.check === 'Phase-3 exposure caps'));
  }
});

/* --------------------------------------------------------------- absent, zero and unreadable */

test('an ABSENT Asset Hub account is a real zero balance, not a failure', async () => {
  // A user who has never held USDC on Asset Hub has no account record. That is not a decode
  // failure and must not be reported as one, or the screen would tell them the client is
  // broken when it is simply reading an empty account.
  const { inputs, undecodable } = await readDepositInputs(
    pair({ [`ah:system:${WHO}`]: 'viable' }),
    KEYS,
    DECODERS,
    PARAMS,
  );
  assert.equal(inputs.assetHubBalance?.value, 0n);
  assert.deepEqual(undecodable, []);
  assert.ok(depositBlocks(inputs).some((b) => b.check === 'Asset Hub balance'));
});

test('an UNDECODABLE balance is ABSENT — a zero here would be a badge nobody earned', async () => {
  // The two failure states are different facts and the model now says so. An **absent**
  // account is a real zero and keeps its badge (the test above); an **undecodable** record
  // yields no value at all, because 10 §2.2 assigns `verified-finalized` "only to values read
  // through smoldot with storage proofs checked" and a substituted `0n` is not one. Until this
  // was fixed both produced a badged zero, and no screen could tell them apart.
  //
  // The safe direction is unchanged, which is the second half of the assertion: the deposit
  // still blocks, and now it blocks on the absence rather than on a manufactured figure.
  const { inputs, undecodable } = await readDepositInputs(
    pair({ [`ah:assets:1337:${WHO}`]: 'bad', [`ah:system:${WHO}`]: 'viable' }),
    KEYS,
    DECODERS,
    PARAMS,
  );
  assert.equal(inputs.assetHubBalance, undefined);
  assert.equal(undecodable.length, 1);
  assert.match(undecodable[0]?.label ?? '', /Assets\.Account\(1337/);
  assert.equal(undecodable[0]?.rawHex, 'bad');
  assert.ok(
    depositBlocks(inputs).some((b) => b.check === 'Asset Hub balance'),
    'an undecodable balance must still block the deposit',
  );
});

test('an UNDECODABLE free balance is ABSENT, and withdraw blocks on the absence', async () => {
  // The withdraw leg's copy of the same rule. The dust-remainder check is skipped too: a
  // remainder arithmetic'd out of a balance nobody stated would name an exact figure the
  // client cannot support.
  const { inputs, undecodable } = await readWithdrawInputs(
    reader(LOCAL_CHAIN, { [`local:usdc:${WHO}`]: 'bad' }, 7),
    KEYS,
    DECODERS,
    { who: WHO, amount: 1n, localFee: 1n, minBalance: 10_000n, ledgerFrozen: false, destinationViable: undefined },
  );
  assert.equal(inputs.freeBalance, undefined);
  assert.equal(undecodable.length, 1);
  const blocks = withdrawBlocks(inputs);
  assert.ok(blocks.some((b) => b.check === 'Free balance'));
  assert.ok(
    !blocks.some((b) => b.check === 'Remainder would be dusted'),
    'a dust figure was computed from a balance the chain never stated',
  );
});

test('assetHubReady needs the compat verdict AND a viable account — each alone is not enough', async () => {
  // E17: "AH connection unavailable ⇒ flow blocked with diagnostics (never a blind 'send
  // anyway')". A compatible runtime whose account state could not be established is not a
  // deposit-ready one, and an absent account is exactly that state rather than a viable one.
  const cases = [
    ['both good', AH_VALUES, true, true],
    ['compat false', AH_VALUES, false, false],
    ['account not viable', { ...AH_VALUES, [`ah:system:${WHO}`]: 'dead' }, true, false],
    ['account absent', { [`ah:assets:1337:${WHO}`]: 'ah:5000000' }, true, false],
    ['account undecodable', { ...AH_VALUES, [`ah:system:${WHO}`]: 'bad' }, true, false],
  ] as const;

  for (const [label, ah, compatible, expected] of cases) {
    const { inputs } = await readDepositInputs(pair(ah), KEYS, DECODERS, {
      ...PARAMS,
      assetHubCompatible: compatible,
    });
    assert.equal(inputs.assetHubReady, expected, label);
    if (!expected) {
      assert.ok(
        depositBlocks(inputs).some((b) => b.check === 'Asset Hub connection'),
        `${label}: the flow was not blocked`,
      );
    }
  }
});

/* ------------------------------------------------------------------- withdraw stands alone */

test('withdraw reads on the LOCAL reader only — Asset Hub is not in its scope', async () => {
  // §11.9.2: withdraw is a local `pallet_xcm` call, so Asset Hub's availability does not gate
  // it. The signature carries that rule: there is no Asset Hub reader to pass, so no future
  // edit can couple the two without changing this call and meeting §11.9.2 on the way past.
  const { inputs } = await readWithdrawInputs(
    reader(LOCAL_CHAIN, { [`local:usdc:${WHO}`]: 'local:900000' }, 7),
    KEYS,
    DECODERS,
    { who: WHO, amount: 1n, localFee: 1n, minBalance: 10_000n, ledgerFrozen: false, destinationViable: undefined },
  );
  assert.ok(inputs.freeBalance !== undefined, 'the free balance decoded and is present');
  assert.equal(inputs.freeBalance.value, 900_000n);
  const status = inputs.freeBalance.status;
  assert.ok(status.kind === 'verified-finalized');
  assert.equal(status.chain, LOCAL_CHAIN);
});

test('an unknown destination stays UNKNOWN — the field is present and undefined', async () => {
  // Three states, and the field must exist to carry the third. Dropping it would make
  // "unchecked" indistinguishable from "not supplied", which is what §11.9.2's "never
  // silently skipped" forbids.
  const { inputs } = await readWithdrawInputs(reader(LOCAL_CHAIN, {}, 7), KEYS, DECODERS, {
    who: WHO,
    amount: 1n,
    localFee: 1n,
    minBalance: 10_000n,
    ledgerFrozen: false,
    destinationViable: undefined,
  });
  assert.equal('destinationViable' in inputs, true, 'the three-state field was dropped');
  assert.equal(inputs.destinationViable, undefined);
});
