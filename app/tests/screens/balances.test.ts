/**
 * S20 — balances and funding status (11 §11.2's S20 row, 02 §7.4).
 *
 * Two balances in two assets, from two frozen storage items. Everything that can go wrong
 * here goes wrong *quietly*, which is why none of these tests renders the happy path and
 * checks a number:
 *
 * - reading `Assets.Account(1337, who)` instead of `ForeignAssets.Account` is a well-formed
 *   read of a different map that returns nothing, and nothing renders as **no USDC**;
 * - rendering one asset's figure with the other's decimals or symbol produces true digits
 *   under a false unit, which no badge can detect;
 * - adding the two into a "total" produces a larger, confident, meaningless number.
 *
 * The prohibition and the two mandated surfaces are parsed out of 02 §7.4 and 11 §11.2 at
 * test time. A list written beside the code agrees with the code and with nothing else.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement as h } from 'react';

import {
  BALANCE_READS,
  Balances,
  NO_COMBINED_BALANCE,
  readBalances,
  type BalanceDecoders,
  type BalanceKeys,
  type BalanceReadParams,
  type BalanceReader,
  type BalancesView,
} from '@bleavit/features-tx';
import type { Finalized, StorageItem } from '@bleavit/chain-client';
import { finalize } from '@bleavit/chain-client/testing';
import type { HexString } from '@bleavit/shared-types';

import { Button } from '@bleavit/ui';

import {
  DISABLED_BUTTON,
  DOC_02,
  DOC_11,
  architecture,
  declarationOf,
  propertyNames,
  theLineContaining,
  txSource,
} from './spec-sources.ts';

const CHAIN: HexString = `0x${'ce'.repeat(32)}`;
const BLOCK: HexString = `0x${'11'.repeat(32)}`;
const WHO = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';

/* ------------------------------------------------------- the two surfaces, bound to doc 02 */

test('the mandated surfaces and the forbidden one are 02 §7.4’s own, not this file’s', () => {
  // §7.4's closing sentence names all three in one breath, which is why it is parsed as one
  // line: the prohibition only means anything beside the thing it replaces.
  const line = theLineContaining(architecture(DOC_02), 'NOT `Assets.Account(1337, who)`');
  const named = [...line.matchAll(/`([A-Z]\w*\.\w+)/g)].map((match) => match[1]);

  assert.ok(named.includes(BALANCE_READS.account), `02 §7.4 does not name ${BALANCE_READS.account}`);
  assert.ok(named.includes(BALANCE_READS.freeUsdc), `02 §7.4 does not name ${BALANCE_READS.freeUsdc}`);

  // The forbidden read, parsed from the `NOT` clause itself rather than from the same list —
  // otherwise the assertion would hold just as well with the two swapped.
  const forbidden = /NOT `([A-Z]\w*\.\w+)\(/.exec(line);
  assert.ok(forbidden?.[1] !== undefined, '02 §7.4 states no forbidden read');
  assert.equal(BALANCE_READS.forbidden, forbidden[1]);
  assert.notEqual(BALANCE_READS.freeUsdc, BALANCE_READS.forbidden);
});

test('11 §11.2’s S20 row names the same two reads and does not name the forbidden one', () => {
  const row = theLineContaining(architecture(DOC_11), '| S20 |');
  const reads = row.split('|')[4] ?? '';
  assert.ok(reads.includes(BALANCE_READS.account), `the S20 row omits ${BALANCE_READS.account}`);
  assert.ok(reads.includes(BALANCE_READS.freeUsdc), `the S20 row omits ${BALANCE_READS.freeUsdc}`);
  // `ForeignAssets.Account` contains no `Assets.Account` substring, so this really is a check
  // on the forbidden map rather than an accident of the two names sharing a word.
  assert.equal(reads.includes(`\`${BALANCE_READS.forbidden}`), false);
});

/* ------------------------------------------------------------------------- the read layer */

interface Recorded {
  readonly keysBuilt: string[];
  readonly keysRead: string[];
}

function recorder(): Recorded {
  return { keysBuilt: [], keysRead: [] };
}

function keysOf(log: Recorded): BalanceKeys {
  return {
    account(who) {
      log.keysBuilt.push(`${BALANCE_READS.account}(${who})`);
      return `key:system:${who}`;
    },
    freeUsdc(who) {
      log.keysBuilt.push(`${BALANCE_READS.freeUsdc}(USDC_LOCATION, ${who})`);
      return `key:foreign:${who}`;
    },
  };
}

function reader(log: Recorded, values: Readonly<Record<string, string>>): BalanceReader {
  const at = { chain: CHAIN, blockHash: BLOCK, blockNumber: 42 };
  return {
    at,
    async storage(key: string): Promise<Finalized<readonly StorageItem[]>> {
      log.keysRead.push(key);
      const value = values[key];
      return finalize(value === undefined ? [] : [{ key, value }], at);
    },
  };
}

/**
 * Decoders that say **which** decoder they are.
 *
 * A symmetric stub makes the split untestable: swap `account` and `freeUsdc` inside
 * `readBalances` and every assertion still passes. Each refuses the other's marker, so the
 * swap becomes a decode failure a test can see.
 */
const DECODERS: BalanceDecoders = {
  account: (raw) => {
    if (raw.startsWith('bad')) return { ok: false, reason: 'not an AccountInfo' };
    const [marker, free, reserved] = raw.split(':');
    if (marker !== 'system') {
      return { ok: false, reason: `the System.Account decoder was handed "${String(marker)}"` };
    }
    return { ok: true, value: { free: BigInt(free ?? '0'), reserved: BigInt(reserved ?? '0') } };
  },
  freeUsdc: (raw) => {
    if (raw.startsWith('bad')) return { ok: false, reason: 'not a ForeignAssets account' };
    const [marker, balance] = raw.split(':');
    if (marker !== 'foreign') {
      return { ok: false, reason: `the ForeignAssets decoder was handed "${String(marker)}"` };
    }
    return { ok: true, value: { balance: BigInt(balance ?? '0') } };
  },
};

/** Two units that cannot be confused: different widths and different symbols. */
const PARAMS: BalanceReadParams = {
  who: WHO,
  vitDecimals: 12,
  vitSymbol: 'NATIVE',
  usdcDecimals: 6,
  usdcSymbol: 'USDC',
  xcmHealthy: true,
};

const HELD = {
  [`key:system:${WHO}`]: 'system:7000000000000:2000000000000',
  [`key:foreign:${WHO}`]: 'foreign:5000000',
} as const;

async function read(
  values: Readonly<Record<string, string>> = HELD,
  params: BalanceReadParams = PARAMS,
): Promise<{ view: BalancesView; log: Recorded }> {
  const log = recorder();
  const view = await readBalances(reader(log, values), keysOf(log), DECODERS, params);
  return { view, log };
}

test('exactly the two mandated keys are built and read — no third read exists', async () => {
  const { log } = await read();
  assert.deepEqual(log.keysBuilt, [
    `${BALANCE_READS.account}(${WHO})`,
    `${BALANCE_READS.freeUsdc}(USDC_LOCATION, ${WHO})`,
  ]);
  assert.deepEqual(log.keysRead, [`key:system:${WHO}`, `key:foreign:${WHO}`]);
});

test('each figure comes through its OWN decoder, so a swap is a decode failure', async () => {
  const { view } = await read();
  assert.equal(view.vit.free.value, 7_000_000_000_000n);
  assert.equal(view.vitReserved.value, 2_000_000_000_000n);
  assert.equal(view.usdc.free.value, 5_000_000n);
  assert.deepEqual([...view.undecodable], []);
});

test('an ABSENT account is a real zero, and is not reported as undecodable', async () => {
  // A user who has never been paid has no `System.Account` record and no `ForeignAssets`
  // one. That is a true zero balance; reporting it as a decode failure tells them the client
  // is broken when it is reading an empty account.
  const { view } = await read({});
  assert.equal(view.vit.free.value, 0n);
  assert.equal(view.vitReserved.value, 0n);
  assert.equal(view.usdc.free.value, 0n);
  assert.deepEqual([...view.undecodable], []);
});

test('an UNDECODABLE account reads zero AND is reported — both halves', async () => {
  // Zero is the direction that cannot overstate a holding, and the `undecodable` row is what
  // stops that zero being read as a fact about the account. A silent zero is a guess.
  const { view } = await read({
    [`key:system:${WHO}`]: 'bad',
    [`key:foreign:${WHO}`]: 'bad',
  });
  assert.equal(view.vit.free.value, 0n);
  assert.equal(view.usdc.free.value, 0n);
  assert.equal(view.undecodable.length, 2);
  assert.deepEqual(
    view.undecodable.map((row) => row.label),
    [`${BALANCE_READS.account}(who)`, `${BALANCE_READS.freeUsdc}(USDC_LOCATION, who)`],
  );
  for (const row of view.undecodable) assert.equal(row.rawHex, 'bad');
});

test('each asset carries its own unit, so neither can be rendered in the other’s', async () => {
  const { view } = await read();
  assert.equal(view.vit.decimals, PARAMS.vitDecimals);
  assert.equal(view.vit.symbol, PARAMS.vitSymbol);
  assert.equal(view.usdc.decimals, PARAMS.usdcDecimals);
  assert.equal(view.usdc.symbol, PARAMS.usdcSymbol);
  // The two really are distinguishable, or the assertions above hold for the wrong reason.
  assert.notEqual(PARAMS.vitDecimals, PARAMS.usdcDecimals);
  assert.notEqual(PARAMS.vitSymbol, PARAMS.usdcSymbol);
});

test('every leaf is stamped with the reader’s one pin', async () => {
  const { view } = await read();
  for (const datum of [view.who, view.vit.free, view.vitReserved, view.usdc.free]) {
    assert.equal(datum.status.kind, 'verified-finalized');
    assert.ok('chain' in datum.status && datum.status.chain === CHAIN);
    assert.ok('blockNumber' in datum.status && datum.status.blockNumber === 42);
  }
});

/* ------------------------------------------------------------------ there is no total, ever */

test('BalancesView has no field a combined figure could occupy', () => {
  // §11.2a's reasoning applies to assets as well as ledgers, and here it is stronger: VIT and
  // USDC have different decimals and different symbols, and the only rate in this system —
  // `fee.vit_usdc_rate` — is a bounded fee conversion, not a valuation. A `total` field would
  // have to be denominated in something.
  const fields = propertyNames(declarationOf(txSource('balances.tsx'), 'BalancesView'));
  assert.deepEqual(
    [...fields].sort(),
    ['undecodable', 'usdc', 'vit', 'vitReserved', 'who', 'xcmHealthy'],
  );
  // The parse must actually see fields, or the equality above is over an empty list.
  assert.equal(fields.length, 6);
});

test('the unit travels with the figure, not with the screen', () => {
  // A single screen-level `decimals`/`symbol` pair is how one asset gets rendered in the
  // other's unit. `AssetBalance` carries its own, so the two cannot share a prop.
  const fields = propertyNames(declarationOf(txSource('balances.tsx'), 'AssetBalance'));
  assert.deepEqual([...fields].sort(), ['decimals', 'free', 'symbol']);
});

/* ------------------------------------------------------------------------ what is rendered */

function markupOf(view: BalancesView): string {
  return renderToStaticMarkup(
    h(Balances, { view, onDeposit: () => undefined, onWithdraw: () => undefined }),
  );
}

test('each balance renders in its own unit and its own symbol', async () => {
  const { view } = await read();
  const html = markupOf(view);
  // 7 whole native units at 12 decimals, and 5 whole USDC at 6. Reading either figure with
  // the other's width produces a number that is wrong by six orders of magnitude and looks
  // entirely plausible.
  assert.ok(html.includes('7.000000000000 NATIVE'), html);
  assert.ok(html.includes('2.000000000000 NATIVE'), html);
  assert.ok(html.includes('5.000000 USDC'), html);
  assert.equal(html.includes('7.000000 NATIVE'), false, 'the native figure took USDC’s width');
  assert.equal(html.includes('5.000000000000 USDC'), false, 'the USDC figure took the native width');
});

test('the three balance labels are distinct, so no row is read by position', async () => {
  const { view } = await read();
  const labels = [...markupOf(view).matchAll(/<span class="field__label">([^<]*)<\/span>/g)].map(
    (match) => match[1],
  );
  assert.equal(new Set(labels).size, labels.length, `duplicate field labels: ${labels.join(', ')}`);
  assert.equal(labels.length, 3);
});

test('no total is rendered, and the screen says why in its own voice', async () => {
  const { view } = await read();
  const html = markupOf(view);
  assert.ok(html.includes(NO_COMBINED_BALANCE), 'the no-total explanation is missing');
  assert.doesNotMatch(html, /field__label">[^<]*[Tt]otal/, 'a total field is rendered');
  // The sum of the two payloads must not appear in any unit, which is the arithmetic form of
  // the same rule: 7,000,000,000,000 + 5,000,000 base units.
  assert.equal(html.includes('7,000,005,000,000'), false, 'the two balances were added');
});

test('every rendered chain figure carries a badge', async () => {
  const { view } = await read();
  const html = markupOf(view);
  // Four leaves: the account, both native figures and the USDC one. `Verified<T>` is an
  // object React refuses to render, so the only way onto the screen is through a `ui` datum
  // component — and each of those emits the status it was handed.
  //
  // Counted on the **badge**, not on `data-status`: the datum wrapper carries that attribute
  // too, so a `data-status` count is twice the number of badges and would still pass if the
  // badge itself stopped rendering.
  assert.equal([...html.matchAll(/class="badge badge--verified-finalized"/g)].length, 4);
});

test('degraded XCM health warns and disables NEITHER control', async () => {
  // §11.9.2 / E18: I-24's fail-static property means funds are held, not lost, so a degraded
  // channel delays arrival and never puts them at risk. Rendering it in the same red box as a
  // block is how a lawful deposit stops happening.
  const { view } = await read(HELD, { ...PARAMS, xcmHealthy: false });
  const html = markupOf(view);
  assert.ok(html.includes('data-severity="caution"'), html);
  assert.equal(html.includes('data-severity="danger"'), false, 'a warning rendered as a block');
  assert.equal([...html.matchAll(/<button/g)].length, 2);
  // The boolean attribute as `react-dom/server` writes it, not the substring: every button
  // React renders carries `aria-disabled`, so `html.includes('disabled')` is true of a screen
  // with nothing disabled at all.
  //
  // Nothing on S20 is ever disabled, so the pattern is proven against a control that really
  // is — otherwise this whole assertion would hold because the regex matches nothing.
  const reallyDisabled = renderToStaticMarkup(
    h(Button, { label: 'x', onClick: () => undefined, disabled: true, disabledReason: 'proof' }),
  );
  assert.match(reallyDisabled, DISABLED_BUTTON, 'the disabled-button pattern matches nothing');
  assert.doesNotMatch(html, DISABLED_BUTTON, 'a warning disabled a control');

  // The healthy case must not render the warning, or the assertion above passes for a screen
  // that always warns.
  const healthy = markupOf((await read()).view);
  assert.equal(healthy.includes('data-severity="caution"'), false);
});

test('an undecodable read renders its raw bytes, and no substituted figure', async () => {
  const { view } = await read({ [`key:foreign:${WHO}`]: 'bad' });
  const html = markupOf(view);
  assert.ok(html.includes('undecodable__raw'), html);
  assert.ok(html.includes(`data-undecodable="${BALANCE_READS.freeUsdc}(USDC_LOCATION, who)"`), html);
});
