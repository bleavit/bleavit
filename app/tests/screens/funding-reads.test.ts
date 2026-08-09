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
  PHASE3_CAP_KEYS,
  SUDO_PRESENT_BIT,
  SameChainError,
  WrongChainInputError,
  depositBlocks,
  fundingReaders,
  readDepositCaps,
  readDepositInputs,
  readWithdrawInputs,
  sudoActive,
  withdrawBlocks,
} from '@bleavit/features-tx';
import type {
  CapsDecoders,
  CapsKeys,
  CapsReader,
  FundingDecoders,
  FundingKeys,
  FundingReader,
} from '@bleavit/features-tx';
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
        caps: {
          globalTvlCap: onAh(1n),
          totalIssuance: onAh(0n),
          perAccountCap: onAh(1n),
          accountCumulative: onAh(0n),
        },
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
    caps: {
      globalTvlCap: onLocal(9n),
      totalIssuance: onLocal(0n),
      perAccountCap: onLocal(9n),
      accountCumulative: onLocal(0n),
    },
  });
  assert.equal(inputs.caps?.globalTvlCap.value, 9n);
});

test('EVERY cap leaf is chain-checked, not just the first', async () => {
  // The loop that checks them is the whole control, and a loop over a subset passes every
  // assertion above. A meter read on Asset Hub is exactly as wrong as a cap read there —
  // `phase3.tvl_cap` bounds *this* chain's issuance, so a foreign supply figure would report
  // headroom that has nothing to do with the chain the deposit lands on.
  const onLocal = (value: bigint): Verified<bigint> => ({
    value,
    status: { kind: 'verified-finalized', chain: LOCAL_CHAIN, blockHash: `0x${'cc'.repeat(32)}`, blockNumber: 7 },
  });
  const onAh = (value: bigint): Verified<bigint> => ({
    value,
    status: { kind: 'verified-finalized', chain: AH_CHAIN, blockHash: `0x${'aa'.repeat(32)}`, blockNumber: 99 },
  });
  const good = {
    globalTvlCap: onLocal(9n),
    totalIssuance: onLocal(0n),
    perAccountCap: onLocal(9n),
    accountCumulative: onLocal(0n),
  };
  for (const field of ['globalTvlCap', 'totalIssuance', 'perAccountCap', 'accountCumulative'] as const) {
    await assert.rejects(
      () => readDepositInputs(pair(), KEYS, DECODERS, { ...PARAMS, caps: { ...good, [field]: onAh(1n) } }),
      WrongChainInputError,
      `"${field}" was not chain-checked`,
    );
  }
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

/* --------------------------------------------------- D-13's caps (11 §11.9.1, SQ-1034) */

/**
 * A local reader that also answers `params()` — the shape `readDepositCaps` requires.
 *
 * The runtime-API result is a **marked** string rather than a shape, for the reason the two
 * USDC decoders are separate: a stub that answered every call identically would let the
 * reader ask for the wrong API and still pass. The marker is asserted below.
 */
function capsReader(
  values: Readonly<Record<string, string>>,
  chain: HexString = LOCAL_CHAIN,
  height = 7,
): CapsReader {
  const at = { chain, blockHash: `0x${'11'.repeat(32)}` as HexString, blockNumber: height };
  return {
    at,
    async storage(key: string): Promise<Finalized<readonly StorageItem[]>> {
      const value = values[key];
      return finalize(value === undefined ? [] : [{ key, value }], at);
    },
    async crossCheckedCall(source) {
      return finalize(
        {
          result: `${source.api}|${source.storagePrefix}|${source.argsHex}`,
          // The FE-P2 witness is **not** empty by default. An empty `Constitution.Params`
          // prefix beside a `params()` answer is a real disagreement, so a stub that returned
          // one would make every agreeing test exercise the refusal path instead.
          witness: [{ key: 'params-witness', value: WITNESS_STATE ?? PARAM_STATE ?? '' }],
        },
        at,
      );
    },
  };
}

const CAPS_KEYS: CapsKeys = {
  paramsArgs: (names) => `args:${names.join(',')}`,
  cumulativeDeposits: (who) => `local:meter:${who}`,
  usdcAsset: () => 'local:usdc-asset',
};

/** What the `params()` stub answers with. Set per test; an omitted key is 13 rule 7's silence. */
let PARAM_STATE: string | undefined;

/**
 * What the `Constitution.Params` witness holds.
 *
 * `undefined` means *the same as `PARAM_STATE`* — the agreeing case, which is what every test
 * about something else wants. A test sets it to force the FE-P2 disagreement, and resets it.
 */
let WITNESS_STATE: string | undefined;

/** A `params()` stub reading `key=value;key=value` out of whatever the call returned. */
function capsDecoderStub(patch: Partial<CapsDecoders> = {}): CapsDecoders {
  return {
    paramViews: (raw) => {
      const body = raw.split('|')[2] ?? '';
      if (!body.startsWith('args:')) {
        return { ok: false, reason: `params() was called with "${body}"` };
      }
      const rows = (PARAM_STATE ?? '')
        .split(';')
        .filter((row) => row.length > 0)
        .map((row) => {
          const [key, value] = row.split('=');
          return { key: String(key), value: BigInt(String(value)) };
        });
      return { ok: true, value: rows };
    },
    paramEntries: (items) => {
      const body = items.map((entry) => entry.value ?? '').join('');
      if (body.startsWith('bad')) {
        return { ok: false, reason: 'the Constitution.Params prefix did not decode' };
      }
      return {
        ok: true,
        value: body
          .split(';')
          .filter((row) => row.length > 0)
          .map((row) => {
            const [key, value] = row.split('=');
            return { key: String(key), value: BigInt(String(value)) };
          }),
      };
    },
    cumulativeDeposits: (raw) =>
      raw.startsWith('bad') ? { ok: false, reason: 'not a u128' } : { ok: true, value: BigInt(raw) },
    usdcAsset: (raw) =>
      raw.startsWith('bad')
        ? { ok: false, reason: 'not an AssetDetails' }
        : { ok: true, value: { supply: BigInt(raw) } },
    ...patch,
  };
}

const CAPS_VALUES = { 'local:meter:5Grw': '4000', 'local:usdc-asset': '900000' } as const;

test('the caps reader asks the runtime for BOTH 13 keys, cross-checked against Constitution.Params', async () => {
  // 02 §9 binds the caps to `params()` "using the canonical keys in 13, combined with §7.4
  // CumulativeDeposits", and 11 §11.4 rule 2 makes a precondition an exact chain read. The
  // keys are the parenthesised canonical ones: `phase3.deposit_cap` is the ROW HEADING and is
  // 18 bytes, which no ParamKey can hold — asking for it would get silence, not an error.
  assert.deepEqual([PHASE3_CAP_KEYS.globalTvl, PHASE3_CAP_KEYS.perAccount], [
    'phase3.tvl_cap',
    'phase3.dep_cap',
  ]);

  PARAM_STATE = 'phase3.tvl_cap=2000000;phase3.dep_cap=20000';
  let asked: { api: string; storagePrefix: string; argsHex?: string } | undefined;
  const reader = capsReader(CAPS_VALUES);
  const spy: CapsReader = {
    ...reader,
    async crossCheckedCall(source) {
      asked = { ...source };
      return reader.crossCheckedCall(source);
    },
  };
  const { caps, undecodable } = await readDepositCaps(spy, CAPS_KEYS, capsDecoderStub(), { who: WHO });
  assert.deepEqual(undecodable, []);
  assert.equal(asked?.api, 'params');
  assert.equal(asked?.storagePrefix, 'Constitution.Params');
  assert.equal(asked?.argsHex, 'args:phase3.tvl_cap,phase3.dep_cap');
  assert.equal(caps?.globalTvlCap.value, 2_000_000n);
  assert.equal(caps?.perAccountCap.value, 20_000n);
  assert.equal(caps?.accountCumulative.value, 4_000n);
  assert.equal(caps?.totalIssuance.value, 900_000n);
});

test('every cap leaf carries the LOCAL reader’s pin, so readDepositInputs accepts them', async () => {
  // The four figures are the one place a foreign value could enter the local leg, and
  // `readDepositInputs` refuses a set stamped anywhere else. That refusal is only reachable
  // because this reader stamps each leaf with the read that produced it.
  PARAM_STATE = 'phase3.tvl_cap=2000000;phase3.dep_cap=20000';
  const { caps } = await readDepositCaps(capsReader(CAPS_VALUES), CAPS_KEYS, capsDecoderStub(), {
    who: WHO,
  });
  assert.ok(caps !== undefined);
  for (const [label, leaf] of Object.entries(caps)) {
    assert.equal(leaf.status.kind, 'verified-finalized', label);
    assert.ok('chain' in leaf.status && leaf.status.chain === LOCAL_CHAIN, `${label} left the local chain`);
  }
  const { inputs } = await readDepositInputs(pair(), KEYS, DECODERS, { ...PARAMS, caps });
  assert.equal(inputs.caps?.globalTvlCap.value, 2_000_000n);
});

test('an ABSENT deposit meter is a badged zero — the map is ValueQuery and never holds one', async () => {
  // `pallets/inflow-caps` refuses to write a zero entry and `try_state` rejects one, so "no
  // row" is the chain stating this account has deposited nothing. Treating it as unreadable
  // would block every first-time depositor, which is the population the flow exists for.
  PARAM_STATE = 'phase3.tvl_cap=2000000;phase3.dep_cap=20000';
  const { caps, undecodable } = await readDepositCaps(
    capsReader({ 'local:usdc-asset': '900000' }),
    CAPS_KEYS,
    capsDecoderStub(),
    { who: WHO },
  );
  assert.deepEqual(undecodable, []);
  assert.equal(caps?.accountCumulative.value, 0n);
  assert.equal(caps?.accountCumulative.status.kind, 'verified-finalized');
});

test('an ABSENT USDC asset row is NOT a zero — a zero there reports the whole cap as headroom', async () => {
  // The asymmetry with the meter above is the point, and it is the direction that matters:
  // `phase3.tvl_cap` bounds total local issuance, so substituting `0n` would say the chain has
  // issued nothing and admit any deposit. 02 §8 freezes the row as chain identity, so its
  // absence is a client that cannot establish the quantity, not a chain that holds none.
  PARAM_STATE = 'phase3.tvl_cap=2000000;phase3.dep_cap=20000';
  const { caps, undecodable } = await readDepositCaps(
    capsReader({ 'local:meter:5Grw': '4000' }),
    CAPS_KEYS,
    capsDecoderStub(),
    { who: WHO },
  );
  assert.equal(caps, undefined, 'an unestablished issuance must not yield a usable cap set');
  assert.equal(undecodable.length, 1);
  assert.match(undecodable[0]?.label ?? '', /ForeignAssets\.Asset/);
});

test('a params() answer that OMITS a key fails closed, and says which key', async () => {
  // 13 rule 7: `params()` skips a record whose bounds do not project, and skips a key it holds
  // no record for. Both are silence on the wire. A client reading silence as "no cap applies"
  // would skip D-13 on exactly the malformed-constitution chain that most needs it.
  PARAM_STATE = 'phase3.tvl_cap=2000000';
  const { caps, undecodable } = await readDepositCaps(
    capsReader(CAPS_VALUES),
    CAPS_KEYS,
    capsDecoderStub(),
    { who: WHO },
  );
  assert.equal(caps, undefined);
  assert.equal(undecodable.length, 1);
  assert.match(undecodable[0]?.label ?? '', /params\(phase3\.dep_cap\)/);
});

test('an undecodable read of ANY leaf leaves the whole set absent', async () => {
  // All four or none. A screen handed one cap and not the other would run half of D-13's
  // containment while looking like it ran all of it.
  const cases = [
    ['params', capsDecoderStub({ paramViews: () => ({ ok: false, reason: 'trailing bytes' }) }), CAPS_VALUES],
    ['meter', capsDecoderStub(), { ...CAPS_VALUES, 'local:meter:5Grw': 'bad' }],
    ['asset', capsDecoderStub(), { ...CAPS_VALUES, 'local:usdc-asset': 'bad' }],
  ] as const;
  for (const [label, decoders, values] of cases) {
    PARAM_STATE = 'phase3.tvl_cap=2000000;phase3.dep_cap=20000';
    const { caps, undecodable } = await readDepositCaps(capsReader(values), CAPS_KEYS, decoders, {
      who: WHO,
    });
    assert.equal(caps, undefined, label);
    assert.ok(undecodable.length >= 1, `${label}: the failure was not reported`);
    // And the consequence through the model: fail-closed, with the reason the row demands.
    const blocks = depositBlocks({
      assetHubBalance: undefined,
      amount: 1n,
      assetHubFee: 0n,
      minBalance: 0n,
      bootstrapPhase: true,
      assetHubReady: true,
      xcmHealthy: true,
    });
    assert.ok(blocks.some((b) => b.check === 'Phase-3 exposure caps'), label);
  }
});

/* ------------------------------------------------- FE-P2: the witness has to be able to say no */

test('a params() view the Constitution.Params prefix DISAGREES with is refused, not averaged', async () => {
  // 10 §11's fourth bullet admits a runtime-API view only alongside the storage prefix it must
  // agree with, and both legs come from one pin, so a difference is a difference rather than a
  // race. Until 2026-08-09 this reader fetched the witness and never compared it — the check
  // could not fail, which reports exactly what a passing check reports.
  //
  // The refusal is total on purpose. Taking the lower of the two figures would be a client
  // inventing a cap the chain does not hold, and 11 §11.4 rule 2 forbids a client computation
  // standing in for an exact chain read.
  PARAM_STATE = 'phase3.tvl_cap=2000000;phase3.dep_cap=20000';
  WITNESS_STATE = 'phase3.tvl_cap=2000000;phase3.dep_cap=999';
  try {
    const { caps, undecodable } = await readDepositCaps(
      capsReader(CAPS_VALUES),
      CAPS_KEYS,
      capsDecoderStub(),
      { who: WHO },
    );
    assert.equal(caps, undefined, 'a disagreeing witness still produced a cap set');
    const reported = undecodable.find((row) => row.label.includes('phase3.dep_cap'));
    assert.ok(reported !== undefined, 'the disagreement was not reported against its key');
    assert.match(reported.reason, /20000/, 'the reason does not carry what params\\(\\) said');
    assert.match(reported.reason, /999/, 'the reason does not carry what storage said');
    // The key that DID agree is not implicated by name — only the deposit is refused.
    assert.equal(undecodable.some((row) => row.label.includes('phase3.tvl_cap')), false);
  } finally {
    WITNESS_STATE = undefined;
  }
});

test('a key params() answers and the prefix does not hold is a disagreement, not an absence', async () => {
  // 13 rule 7: `params()` OMITS a key it holds no record for. So a view row implies a stored
  // record, and a missing one is the runtime's view contradicting the runtime's own storage.
  PARAM_STATE = 'phase3.tvl_cap=2000000;phase3.dep_cap=20000';
  WITNESS_STATE = 'phase3.tvl_cap=2000000';
  try {
    const { caps, undecodable } = await readDepositCaps(
      capsReader(CAPS_VALUES),
      CAPS_KEYS,
      capsDecoderStub(),
      { who: WHO },
    );
    assert.equal(caps, undefined);
    const reported = undecodable.find((row) => row.label.includes('phase3.dep_cap'));
    assert.ok(reported !== undefined);
    assert.match(reported.reason, /no record/);
  } finally {
    WITNESS_STATE = undefined;
  }
});

test('an UNDECODABLE witness refuses the caps — an unreadable second view is not agreement', async () => {
  PARAM_STATE = 'phase3.tvl_cap=2000000;phase3.dep_cap=20000';
  WITNESS_STATE = 'bad';
  try {
    const { caps, undecodable } = await readDepositCaps(
      capsReader(CAPS_VALUES),
      CAPS_KEYS,
      capsDecoderStub(),
      { who: WHO },
    );
    assert.equal(caps, undefined, 'an unreadable witness was treated as a passing cross-check');
    assert.ok(undecodable.some((row) => row.label === 'Constitution.Params'));
  } finally {
    WITNESS_STATE = undefined;
  }
});

test('an AGREEING witness establishes the caps — the refusal is not unconditional', async () => {
  // The anti-vacuity half. Without it every assertion above is satisfied by a reader that
  // refuses everything, which is the failure mode a fail-closed check invites.
  PARAM_STATE = 'phase3.tvl_cap=2000000;phase3.dep_cap=20000';
  WITNESS_STATE = 'phase3.dep_cap=20000;phase3.tvl_cap=2000000';
  try {
    const { caps, undecodable } = await readDepositCaps(
      capsReader(CAPS_VALUES),
      CAPS_KEYS,
      capsDecoderStub(),
      { who: WHO },
    );
    assert.deepEqual(undecodable, [], 'an agreeing witness reported a problem');
    assert.ok(caps !== undefined, 'an agreeing witness did not establish the caps');
    assert.equal(caps.globalTvlCap.value, 2_000_000n);
    assert.equal(caps.perAccountCap.value, 20_000n);
  } finally {
    WITNESS_STATE = undefined;
  }
});
