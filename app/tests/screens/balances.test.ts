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
import { providerRead, type Finalized, type StorageItem } from '@bleavit/chain-client';
import { finalize } from '@bleavit/chain-client/testing';
import { externalProposal, type HexString } from '@bleavit/shared-types';

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

/**
 * Two units that cannot be confused: different widths and different symbols.
 *
 * `who` arrives as a chosen value under `external-proposal`, which 10 §2.1 calls *"the one
 * status a chosen value may carry when it is displayed as a data item"*. A selected account
 * is exactly that (10 §5) — the reader keys two maps with it and never reads it.
 */
const PARAMS: BalanceReadParams = {
  who: externalProposal(WHO),
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
  assert.equal(view.vit.free?.value, 7_000_000_000_000n);
  assert.equal(view.vitReserved?.value, 2_000_000_000_000n);
  assert.equal(view.usdc.free?.value, 5_000_000n);
  assert.deepEqual([...view.undecodable], []);
});

test('an ABSENT account is a real zero, and is not reported as undecodable', async () => {
  // A user who has never been paid has no `System.Account` record and no `ForeignAssets`
  // one. That is a true zero balance; reporting it as a decode failure tells them the client
  // is broken when it is reading an empty account.
  const { view } = await read({});
  assert.equal(view.vit.free?.value, 0n);
  assert.equal(view.vitReserved?.value, 0n);
  assert.equal(view.usdc.free?.value, 0n);
  assert.deepEqual([...view.undecodable], []);
});

test('an UNDECODABLE account has NO figure, and is reported — both halves', async () => {
  // The V-183 repair, and the pair of facts it keeps apart. An absent record (above) is the
  // chain saying *this account holds nothing*; an undecodable one is the client unable to
  // say anything. Substituting `0n` for the second answers a question nobody asked and
  // badges it `verified-finalized`, which 10 §2.2 assigns only to values actually read —
  // so the figure is **absent** and the raw bytes go to `undecodable`.
  const { view } = await read({
    [`key:system:${WHO}`]: 'bad',
    [`key:foreign:${WHO}`]: 'bad',
  });
  assert.equal(view.vit.free, undefined);
  assert.equal(view.vitReserved, undefined);
  assert.equal(view.usdc.free, undefined);
  assert.equal(view.undecodable.length, 2);
  assert.deepEqual(
    view.undecodable.map((row) => row.label),
    [`${BALANCE_READS.account}(who)`, `${BALANCE_READS.freeUsdc}(USDC_LOCATION, who)`],
  );
  for (const row of view.undecodable) assert.equal(row.rawHex, 'bad');
});

test('one undecodable read leaves the OTHER asset’s figure alone', async () => {
  // The complement, so "undecodable is absent" cannot quietly become "any failure empties
  // the screen". Each surface has its own decoder and its own read, so each fails alone.
  const { view } = await read({ ...HELD, [`key:foreign:${WHO}`]: 'bad' });
  assert.equal(view.vit.free?.value, 7_000_000_000_000n);
  assert.equal(view.vitReserved?.value, 2_000_000_000_000n);
  assert.equal(view.usdc.free, undefined);
  assert.equal(view.undecodable.length, 1);
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

test('every figure descends from the read that produced it, at the reader’s one pin', async () => {
  const { view } = await read();
  const figures = [view.vit.free, view.vitReserved, view.usdc.free];
  assert.equal(figures.filter((datum) => datum !== undefined).length, 3);
  for (const datum of figures) {
    assert.equal(datum?.status.kind, 'verified-finalized');
    assert.ok(datum !== undefined && 'chain' in datum.status && datum.status.chain === CHAIN);
    assert.ok(datum !== undefined && 'blockNumber' in datum.status && datum.status.blockNumber === 42);
  }
});

test('the ACCOUNT is not stamped by this reader — it is the key, not a read (V-183)', async () => {
  // The defect this test exists for: `who` used to be badged `verified-finalized` at the
  // reader's own pin, and it renders in the panel's subject line. The chain was never asked
  // for it — it is the key both maps are read at, and 10 §5 lists a selected account among
  // the chosen values that "can never be represented as verified". So it is the caller's
  // datum, passed through byte for byte.
  const { view } = await read();
  assert.equal(view.who, PARAMS.who, 'the account was rebuilt rather than passed through');
  assert.equal(view.who.status.kind, 'external-proposal');
  assert.equal('blockHash' in view.who.status, false, 'the reader’s pin reached the account');

  // And it is really the caller's, whatever the caller says: a second status must survive
  // the same journey, or the assertion above holds because one status happens to be produced.
  const other = await read(HELD, { ...PARAMS, who: providerRead(WHO, 'an-address-book') });
  assert.equal(other.view.who.status.kind, 'provider');
});

test('the S20 reader mints no provenance of its own — every figure descends from a read', () => {
  // V-183, the shape V-182 found in `market-reads.ts`. A local `finalized` helper wrapped
  // any value in a hand-written `verified-finalized` status object: brand-less, structurally
  // a plain `Verified<T>`, and applied to four values — one of them the account, which is
  // the *key* these maps are read at rather than anything they returned. Neither
  // `check:casts` nor the render gate can see that shape (the first looks for an assertion,
  // the second for a borrowed `.status` access), so what covers it is this source assertion.
  const source = txSource('balance-reads.ts');
  assert.doesNotMatch(
    source,
    /kind:\s*'verified-finalized'/,
    'balance-reads.ts constructs a verification status of its own',
  );
  assert.doesNotMatch(source, /\bas\s+Finalized</, 'balance-reads.ts asserts the brand');
  // And the sanctioned derivation really is what it uses, or the two assertions above hold
  // over a module that has stopped producing finalized figures altogether.
  assert.match(source, /\bderive\(/);
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

test('every rendered chain figure carries a badge, and the account carries its own', async () => {
  const { view } = await read();
  const html = markupOf(view);
  // Three chain figures — both native ones and the USDC one. `Verified<T>` is an object
  // React refuses to render, so the only way onto the screen is through a `ui` datum
  // component, and each of those emits the status it was handed.
  //
  // Counted on the **badge**, not on `data-status`: the datum wrapper carries that attribute
  // too, so a `data-status` count is twice the number of badges and would still pass if the
  // badge itself stopped rendering.
  assert.equal([...html.matchAll(/class="badge badge--verified-finalized"/g)].length, 3);
  // The fourth datum is the account, and it renders under the caller's status rather than
  // the reader's pin — four badges in total, so nothing lost its label (INV-FE-9).
  assert.equal([...html.matchAll(/class="badge badge--external-proposal"/g)].length, 1);
  assert.equal([...html.matchAll(/class="badge badge--/g)].length, 4);
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
  const { view } = await read({ ...HELD, [`key:foreign:${WHO}`]: 'bad' });
  const html = markupOf(view);
  assert.ok(html.includes('undecodable__raw'), html);
  assert.ok(html.includes(`data-undecodable="${BALANCE_READS.freeUsdc}(USDC_LOCATION, who)"`), html);

  // The other half of the test's own name, which went unasserted until V-183: the USDC field
  // must show a refusal rather than `0.000000 USDC`. A zero under a `finalized` badge is a
  // number the chain never stated, and the `Undecodable` row above does not unsay it —
  // INV-FE-9 attaches the label to the datum, not to a list somewhere else on the page.
  assert.equal(html.includes('0.000000 USDC'), false, 'a substituted zero was rendered');
  assert.ok(html.includes('datum--unread'), html);
  assert.equal([...html.matchAll(/class="badge badge--verified-finalized"/g)].length, 2);

  // The native figures are untouched, so the refusal is the failed read's and not the page's.
  assert.ok(html.includes('7.000000000000 NATIVE'), html);
});
