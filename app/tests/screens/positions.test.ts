/**
 * S4 — positions, the redemption ticket and the VOID layout, across both ledger domains.
 *
 * The arithmetic is decided elsewhere and already certified: `ledger-domain.test.ts` owns the
 * bit test and the per-domain total, `void-recovery.test.ts` owns the decomposition,
 * `redemption-ticket.test.ts` owns the charged/exempt verdict. What is asserted here is the
 * layer where every model can be right and the screen still wrong:
 *
 * - a row rendered under the **other** domain's label claims a backing pool that does not
 *   stand behind it, and I-4 holds per instance;
 * - a *winning branch* rendered for a `Voided` or Baseline vault is a fabricated fact about
 *   a settlement that never picked one;
 * - a headline quoting the **par pair** rather than the total recovery overstates what a
 *   mixed holding actually gets back, which is the exact overstatement SQ-171 names;
 * - a fee line on an exempt payout misstates the par promise G-3 depends on.
 *
 * Every rule is parsed out of doc 11 at test time and every chain constant out of the
 * recorded metadata.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement as h } from 'react';

import {
  CONSOLIDATION_IS_NOT_RECOVERY,
  DOMAIN_COPY,
  FEE_IS_NOT_THE_TRANSACTION_FEE,
  NO_MERGED_TOTAL,
  PAR_COPY,
  PART_PAR_COPY,
  POSITION_READS,
  Positions,
  RedemptionTicket,
  VOID_COPY,
  VOID_NEUTRAL_PRICE,
  VoidRecoveryPanel,
  WrongChainBoundaryError,
  quoteRedemption,
  readPositions,
  voidRecoveryView,
  type PositionDecoders,
  type PositionKeys,
  type PositionReadParams,
  type PositionRecord,
  type PositionWitnessEntry,
  type PositionsReader,
  type PositionsView,
  type VoidRecoveryView,
} from '@bleavit/features-tx';
import type { Finalized, StorageItem } from '@bleavit/chain-client';
import { finalize } from '@bleavit/chain-client/testing';
import { Disclosure, DeferredMeaningChangingFactError } from '@bleavit/ui';
import type { HexString, Verified } from '@bleavit/shared-types';

import {
  DISABLED_BUTTON,
  DOC_11,
  architecture,
  declarationOf,
  propertyNames,
  recordedScalar,
  theLineContaining,
  txSource,
} from './spec-sources.ts';

const CHAIN: HexString = `0x${'ce'.repeat(32)}`;
const OTHER_CHAIN: HexString = `0x${'a5'.repeat(32)}`;
const BLOCK: HexString = `0x${'11'.repeat(32)}`;
const AT = { chain: CHAIN, blockHash: BLOCK, blockNumber: 42 };
const UNIT = { decimals: 6, symbol: 'USDC' } as const;

function verified<T>(value: T, chain: HexString = CHAIN): Verified<T> {
  return { value, status: { kind: 'verified-finalized', chain, blockHash: BLOCK, blockNumber: 42 } };
}

const SERVICE_ID_BASE = recordedScalar('constant.ledger.service_id_base');
const FEE_BPS = recordedScalar('constant.ledger.redemption_fee');
const MIN_SPLIT = recordedScalar('constant.ledger.min_split');

test('the recorded boundary partitions the id space, so every domain test below can fail', () => {
  assert.ok(SERVICE_ID_BASE > 0n, 'ServiceIdBase recorded as zero — every row would be hosted');
  assert.equal(SERVICE_ID_BASE & (SERVICE_ID_BASE - 1n), 0n, 'the boundary is not a single bit');
});

/* ------------------------------------------------------------------- the document bindings */

test('§11.2a rule 2 forbids a merged total, and PositionsView has nowhere to put one', () => {
  const rule = theLineContaining(architecture(DOC_11), '2. **No merged portfolio total.**');
  assert.match(rule, /the client MUST NOT present one/);
  assert.match(rule, /Per-domain totals, shown side by side, are the honest form/);

  const fields = propertyNames(declarationOf(txSource('positions.tsx'), 'PositionsView'));
  assert.deepEqual([...fields].sort(), ['anomalies', 'primary', 'service', 'undecodable']);
  // Each domain's own book does carry a total, or the assertion above would be satisfied by
  // a screen that totals nothing at all.
  assert.ok(propertyNames(declarationOf(txSource('positions.tsx'), 'DomainBook')).includes('total'));
});

test('§11.6 and §11.2 forbid a winning branch, and two arms have no field for one', () => {
  const void_ = theLineContaining(architecture(DOC_11), 'There is no "winning branch" under VOID');
  assert.match(void_, /MUST NOT render for a `Voided` vault/);
  const baseline = theLineContaining(architecture(DOC_11), '**Position-state projection.**');
  assert.match(baseline, /MUST NOT fabricate or display a winning branch for a Baseline vault/);

  // The declaration is where the claim lives: an optional `winner?` plus a comment renders
  // identically to no field at all until the day somebody supplies one.
  const projection = declarationOf(txSource('positions.tsx'), 'VaultProjection');
  const arms = projection.split('|').filter((arm) => arm.includes('kind:'));
  assert.equal(arms.length, 5, projection);
  for (const arm of arms) {
    const named = /kind: '([a-z-]+)'/.exec(arm)?.[1];
    const carriesWinner = /winner/.test(arm);
    assert.equal(
      carriesWinner,
      named === 'scalar-settled',
      `the ${String(named)} arm ${carriesWinner ? 'carries' : 'lacks'} a winner`,
    );
  }
});

test('the S4 row gives the service domain no BaselineVaults read, and neither does this client', () => {
  const row = theLineContaining(architecture(DOC_11), '| S4 |');
  assert.match(row, /no `BaselineVaults` read, that map is structurally empty in the service domain/);
  assert.ok('baselineVaults' in POSITION_READS.primary);
  assert.equal('baselineVaults' in POSITION_READS.service, false);
  // The two APIs are the domain's own, per 02 §7.4.
  assert.equal(POSITION_READS.primary.api, 'account_positions');
  assert.equal(POSITION_READS.service.api, 'service_positions');
});

test('§11.5 rule 3 makes net the headline and forbids summing the two fees', () => {
  const rule = theLineContaining(architecture(DOC_11), '3. **Presentation.** `net` is the headline');
  assert.match(rule, /`gross` and `fee` are itemized beside it/);
  assert.match(rule, /MUST NOT be summed into one line/);
  // The screen says the same thing to the user rather than only to a reader of this file.
  assert.match(FEE_IS_NOT_THE_TRANSACTION_FEE, /never added together/);
});

test('§11.6 step 3 makes the TOTAL the headline, and SQ-171 bounds the par copy', () => {
  const step3 = theLineContaining(architecture(DOC_11), '3. **Mixed holdings**');
  assert.match(step3, /headline figure MUST be the \*\*total recovery those actual holdings reach\*\*/);
  assert.match(step3, /never the par value of the pairs alone/);

  const sq171 = theLineContaining(architecture(DOC_11), 'Nor may any copy promise "par"');
  assert.match(sq171, /unless the displayed holdings are complete across both branches/);
  // The two sentences the client offers instead, and they must differ.
  assert.notEqual(PAR_COPY, PART_PAR_COPY);
  assert.match(PAR_COPY, /full principal/);
  assert.match(PART_PAR_COPY, /less than par/);
});

test('E16 makes the cross-branch merge primary and forbids a 100 % label on consolidation', () => {
  const e16 = theLineContaining(architecture(DOC_11), '**E16 Redeeming from a voided vault.**');
  assert.match(e16, /MUST be visually primary whenever a cross-branch pair exists/);
  assert.match(e16, /100 %-recovery label MUST NOT be attached to `merge_scalar`\/`merge_gate`/);
  assert.match(CONSOLIDATION_IS_NOT_RECOVERY, /Consolidating pays no USDC/);
});

/* -------------------------------------------------------------------------- the read layer */

const WHO = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
const WHO_KEY = `0x${'aa'.repeat(32)}`;
const SOMEBODY_ELSE = `0x${'bb'.repeat(32)}`;

function row(id: bigint, balance: bigint, label = `pos-${id}`): PositionRecord {
  return {
    subject: { kind: 'proposal', id },
    positionId: label,
    instrument: 'BranchUsdc(Accept)',
    balance,
    vault: { kind: 'open' },
  };
}

const PRIMARY_ROW = row(1n, 1_000_000n, 'primary-1');
const SERVICE_ROW = row(SERVICE_ID_BASE + 1n, 4_000_000n, 'service-1');
const BASELINE_ROW: PositionRecord = {
  subject: { kind: 'baseline', epoch: 4 },
  positionId: 'baseline-4',
  instrument: 'Long',
  balance: 7_000_000n,
  vault: { kind: 'baseline-settled', score: 700_050_000n },
};

interface Book {
  readonly records: readonly PositionRecord[];
  readonly witness: readonly PositionWitnessEntry[];
  readonly decodesView?: boolean;
  readonly decodesWitness?: boolean;
}

function witnessFor(records: readonly PositionRecord[]): PositionWitnessEntry[] {
  return records.map((record) => ({
    positionId: record.positionId,
    account: WHO_KEY,
    balance: record.balance,
  }));
}

function book(records: readonly PositionRecord[], overrides: Partial<Book> = {}): Book {
  return { records, witness: witnessFor(records), ...overrides };
}

interface CallLog {
  readonly calls: { api: string; storagePrefix: string; argsHex?: string }[];
}

const KEYS: PositionKeys = { positionsPrefix: (pallet) => `prefix:${pallet}.Positions` };

function harness(primary: Book, service: Book, log: CallLog) {
  const books = new Map<string, Book>([
    [POSITION_READS.primary.api, primary],
    [POSITION_READS.service.api, service],
  ]);
  const reader: PositionsReader = {
    at: AT,
    async crossCheckedCall(source): Promise<
      Finalized<{ result: string; witness: readonly StorageItem[] }>
    > {
      log.calls.push({ ...source });
      return finalize(
        { result: source.api, witness: [{ key: source.storagePrefix, value: source.api }] },
        AT,
      );
    },
  };
  const decoders: PositionDecoders = {
    positions: (raw) => {
      const found = books.get(raw);
      if (found === undefined || found.decodesView === false) {
        return { ok: false, reason: `no view decodes from ${raw}` };
      }
      return { ok: true, value: found.records };
    },
    positionEntries: (items) => {
      const found = books.get(items[0]?.value ?? '');
      if (found === undefined || found.decodesWitness === false) {
        return { ok: false, reason: 'the Positions prefix did not decode' };
      }
      return { ok: true, value: found.witness };
    },
  };
  return { reader, decoders };
}

const PARAMS: PositionReadParams = {
  who: WHO,
  whoArgsHex: '0xaaaa',
  whoAccountKey: WHO_KEY,
  serviceIdBase: verified(SERVICE_ID_BASE),
};

async function read(
  primary: Book = book([PRIMARY_ROW]),
  service: Book = book([SERVICE_ROW]),
  params: PositionReadParams = PARAMS,
): Promise<{ view: PositionsView; log: CallLog }> {
  const log: CallLog = { calls: [] };
  const { reader, decoders } = harness(primary, service, log);
  const view = await readPositions(reader, KEYS, decoders, params);
  return { view, log };
}

function stated(combined: PositionsView['primary']['total']): bigint | undefined {
  return combined.kind === 'stated' ? combined.datum.value : undefined;
}

test('each domain’s view is cross-checked against ITS OWN prefix, never the other’s', async () => {
  // 02 §7.4: the client "performs that cross-check per domain against that domain's own
  // prefix, and MUST NOT satisfy a service-domain read with a primary-domain key." The pallet
  // is derived from the domain rather than taken from the caller, which is what makes the
  // pairing unavailable to get wrong.
  const { log } = await read();
  assert.deepEqual(log.calls, [
    {
      api: POSITION_READS.primary.api,
      storagePrefix: `prefix:${'ConditionalLedger'}.Positions`,
      argsHex: PARAMS.whoArgsHex,
    },
    {
      api: POSITION_READS.service.api,
      storagePrefix: `prefix:${'ServiceLedger'}.Positions`,
      argsHex: PARAMS.whoArgsHex,
    },
  ]);
});

test('both domains are read even when one is empty, and each states its own total', async () => {
  const { view } = await read(book([PRIMARY_ROW]), book([]));
  assert.equal(view.primary.rows.length, 1);
  assert.equal(view.service.rows.length, 0);
  assert.equal(stated(view.primary.total), PRIMARY_ROW.balance);
  // The fix this suite exists to hold: a domain that was read and answered with no rows
  // states a **zero**, not "not available". `combine(0n, [])` is incomparable, which beside
  // "this account holds nothing here" tells a user the client could not say when it did.
  assert.equal(view.service.total.kind, 'stated');
  assert.equal(stated(view.service.total), 0n);
});

test('a view that did not decode has NO total, which is the honest arm', async () => {
  // The complement of the test above, so "empty states zero" cannot become "everything
  // states zero". Here nothing was read, so nothing may be claimed.
  const { view } = await read(book([PRIMARY_ROW]), book([], { decodesView: false }));
  assert.equal(view.service.total.kind, 'incomparable');
  assert.equal(view.undecodable.length, 1);
  assert.equal(view.undecodable[0]?.label, POSITION_READS.service.api);
});

test('a row whose id places it in the OTHER domain is dropped and reported — both ways', async () => {
  // §11.2a rule 1: the datum decides. The call site "knows" which domain it asked for, and
  // that is exactly the knowledge that must not be trusted — the label is what asserts which
  // reserves stand behind the balance.
  const crossed = await read(book([PRIMARY_ROW, SERVICE_ROW]), book([]));
  assert.deepEqual(crossed.view.primary.rows.map((r) => r.positionId.value), ['primary-1']);
  assert.equal(crossed.view.anomalies.length, 1);
  assert.match(crossed.view.anomalies[0]?.detail ?? '', /service ledger rather than the primary/);

  const other = await read(book([]), book([SERVICE_ROW, PRIMARY_ROW]));
  assert.deepEqual(other.view.service.rows.map((r) => r.positionId.value), ['service-1']);
  assert.equal(other.view.anomalies.length, 1);
  assert.match(other.view.anomalies[0]?.detail ?? '', /primary ledger rather than the service/);
});

test('a Baseline position is primary by structure, and hosted Baseline state is an anomaly', async () => {
  // A Baseline position is keyed by **epoch**, not by an id from the partitioned space, so it
  // never goes through the bit test — putting an epoch through it would classify a large one
  // as hosted, fabricating a domain for a row the user really holds. 16 §7.6 gives a hosted
  // question no Baseline leg at all, so the same record arriving from `service_positions()`
  // is corrupt state rather than a row.
  const primary = await read(book([BASELINE_ROW]), book([]));
  assert.deepEqual(primary.view.primary.rows.map((r) => r.positionId.value), ['baseline-4']);
  assert.deepEqual([...primary.view.anomalies], []);

  const hosted = await read(book([]), book([BASELINE_ROW]));
  assert.equal(hosted.view.service.rows.length, 0);
  assert.equal(hosted.view.anomalies.length, 1);
});

test('FE-P2: a view disagreeing with its own storage drops the row and says so', async () => {
  // Both legs were read at one pin, so a disagreement is a real disagreement rather than a
  // race — and a balance the runtime view and the runtime's own storage do not share is not
  // one to render under a finalized badge.
  const disagreeing = book([PRIMARY_ROW], {
    witness: [{ positionId: PRIMARY_ROW.positionId, account: WHO_KEY, balance: 999n }],
  });
  const { view } = await read(disagreeing, book([]));
  assert.equal(view.primary.rows.length, 0);
  assert.match(view.anomalies[0]?.detail ?? '', /FE-P2/);
});

test('a witness entry belonging to somebody else does not satisfy the cross-check', async () => {
  // The `Positions` prefix is keyed `(PositionId, AccountId)`, so the whole map comes back.
  // Matching on the position id alone would let another account's balance vouch for this
  // account's row.
  const foreign = book([PRIMARY_ROW], {
    witness: [
      { positionId: PRIMARY_ROW.positionId, account: SOMEBODY_ELSE, balance: PRIMARY_ROW.balance },
    ],
  });
  const { view } = await read(foreign, book([]));
  assert.equal(view.primary.rows.length, 0);
  assert.match(view.anomalies[0]?.detail ?? '', /no entry/);
});

test('an undecodable prefix reports itself and does not silently pass the cross-check', async () => {
  // The rows still render — INV-FE-12 renders undecodable data with a warning rather than
  // hiding the account's whole portfolio — but the failure is reported beside them, so the
  // skipped cross-check is visible rather than assumed to have passed.
  const { view } = await read(book([PRIMARY_ROW], { decodesWitness: false }), book([]));
  assert.equal(view.primary.rows.length, 1);
  assert.equal(view.undecodable.length, 1);
  assert.equal(view.undecodable[0]?.label, POSITION_READS.primary.positions);
});

test('an unread boundary blocks the WHOLE screen, not one row', async () => {
  // Without the boundary the client cannot say which reserves back *any* balance, and rule 1
  // forbids rendering a row whose domain it could not establish. A client that defaulted the
  // boundary would label every hosted position as a governance one.
  const { view, log } = await read(book([PRIMARY_ROW]), book([SERVICE_ROW]), {
    ...PARAMS,
    serviceIdBase: undefined,
  });
  assert.equal(view.primary.rows.length, 0);
  assert.equal(view.service.rows.length, 0);
  assert.equal(view.primary.total.kind, 'incomparable');
  assert.equal(view.undecodable.length, 1);
  assert.equal(view.undecodable[0]?.label, POSITION_READS.serviceIdBase);
  assert.deepEqual(log.calls, [], 'the views were read anyway');
});

test('a boundary read on another chain is refused rather than applied', async () => {
  // The constants API is the one input this reader does not read itself, so it is the one
  // place a foreign value could enter. Its **chain** is checked and not its block: 11 §11.4
  // rule 2 re-reads constants only when `spec_version` moves, so a different block is lawful.
  await assert.rejects(
    () => read(book([PRIMARY_ROW]), book([]), {
      ...PARAMS,
      serviceIdBase: verified(SERVICE_ID_BASE, OTHER_CHAIN),
    }),
    WrongChainBoundaryError,
  );
});

/* ------------------------------------------------------------------- the positions render */

function positionsMarkup(view: PositionsView): string {
  return renderToStaticMarkup(h(Positions, { view, ...UNIT }));
}

test('two books render side by side, each labelled, with no figure spanning both', async () => {
  const { view } = await read();
  const html = positionsMarkup(view);
  assert.ok(html.includes(DOMAIN_COPY.primary.title), 'the primary book is unlabelled');
  assert.ok(html.includes(DOMAIN_COPY.service.title), 'the service book is unlabelled');
  assert.ok(html.includes(NO_MERGED_TOTAL), 'the screen never says why there is no total');
  // 1 USDC + 4 USDC. The merged figure must appear nowhere, in any rendering.
  assert.ok(html.includes('1.000000 USDC') && html.includes('4.000000 USDC'), html);
  assert.equal(html.includes('5.000000 USDC'), false, 'the two domains were added');
});

test('the hosted book’s copy denies that trading it governs anything', async () => {
  const { view } = await read();
  const html = positionsMarkup(view);
  assert.ok(html.includes(DOMAIN_COPY.service.note), html);
  assert.match(DOMAIN_COPY.service.note, /not part of governing Bleavit/);
  assert.doesNotMatch(DOMAIN_COPY.primary.note, /not part of governing/);
});

test('an empty hosted book still renders, rather than vanishing', async () => {
  // A domain that disappeared because the account holds nothing in it is indistinguishable
  // from a client that stopped reading it, and rule 1 wants the split visible.
  const { view } = await read(book([PRIMARY_ROW]), book([]));
  const html = positionsMarkup(view);
  assert.ok(html.includes(DOMAIN_COPY.service.title), html);
  assert.ok(html.includes('This account holds nothing here'), html);
  assert.ok(html.includes('0.000000 USDC'), 'the empty book stated no total');
});

test('no winning branch renders for a voided or a Baseline-settled vault', async () => {
  const voided = row(2n, 3_000_000n, 'voided-2');
  const cases: readonly [string, PositionRecord][] = [
    ['voided', { ...voided, vault: { kind: 'voided' } }],
    ['baseline-settled', BASELINE_ROW],
  ];
  for (const [label, record] of cases) {
    const { view } = await read(book([record]), book([]));
    const html = positionsMarkup(view);
    assert.equal(html.includes('Winning branch'), false, `${label} rendered a winning branch`);
    assert.ok(html.includes(`data-vault-state="${record.vault.kind}"`), html);
  }

  // Anti-vacuity: the one state that *does* have a winner must render it, or the loop above
  // holds for a screen that never renders one.
  const settled = await read(
    book([{ ...voided, vault: { kind: 'scalar-settled', winner: 'Accept', score: 700_050_000n } }]),
    book([]),
  );
  assert.ok(positionsMarkup(settled.view).includes('Winning branch'), 'no winner ever renders');
});

test('anomalies and undecodable reads render, rather than becoming a shorter list', async () => {
  const { view } = await read(
    book([PRIMARY_ROW, SERVICE_ROW], { decodesWitness: false }),
    book([]),
  );
  const html = positionsMarkup(view);
  assert.ok(html.includes('A row was read but not rendered'), html);
  assert.ok(html.includes('undecodable__raw'), html);
});

/* ------------------------------------------------------------------ the redemption ticket */

function labelsIn(html: string): readonly string[] {
  return [
    ...html.matchAll(/<span class="(?:field__label|datum__name)">([^<]*)<\/span>/g),
  ].map((match) => match[1] as string);
}

function ticketMarkup(quote: Parameters<typeof RedemptionTicket>[0]['quote']): string {
  return renderToStaticMarkup(
    h(RedemptionTicket, { quote, ...UNIT, onSubmit: () => undefined }),
  );
}

const RATE = {
  metadataBps: verified(FEE_BPS),
  paramsPerbill: verified(FEE_BPS * 100_000n),
};

test('a charged payout leads with net and itemizes gross and fee beside it', () => {
  const quote = quoteRedemption({
    call: 'redeem_scalar',
    gross: verified(10_000_000n),
    rate: RATE,
    minSplit: verified(MIN_SPLIT),
  });
  const html = ticketMarkup(quote);
  const labels = labelsIn(html);
  assert.ok(labels.includes('You will receive'), labels.join(' | '));
  assert.ok(labels.includes('gross'), labels.join(' | '));
  assert.ok(labels.includes('redemption fee'), labels.join(' | '));
  // The two deductions are never one line — §11.5 rule 3, said to the user.
  assert.ok(html.includes(FEE_IS_NOT_THE_TRANSACTION_FEE), html);
  // The net is the figure the fold carries, and the fold is the above-the-fold one.
  assert.ok(html.includes('data-fact="charged-redemption-net-payout"'), html);
  assert.ok(html.includes('9.970000 USDC') && html.includes('10.000000 USDC'), html);
});

test('an exempt payout renders NO fee line at all', () => {
  // §11.5 rule 1: the deduction MUST NOT be applied, shown, **or implied**. The exempt arm
  // carries no `fee` and no `net`, so there is nothing for a render to put on screen.
  const quote = quoteRedemption({
    call: 'redeem',
    gross: verified(10_000_000n),
    rate: RATE,
    minSplit: verified(MIN_SPLIT),
  });
  const labels = labelsIn(ticketMarkup(quote));
  assert.deepEqual([...labels].filter((label) => /fee|net/i.test(label)), []);
  assert.deepEqual([...labels], ['You will receive']);
});

test('an unstatable payout renders a refusal and a disabled control, never a number', () => {
  // §11.5 rule 5. The runtime's own read fails open on an unreadable rate; a client must not
  // mirror that and display a fee-free payout it cannot verify.
  const quote = quoteRedemption({
    call: 'redeem_scalar',
    gross: verified(10_000_000n),
    rate: { metadataBps: undefined, paramsPerbill: undefined },
    minSplit: undefined,
  });
  const html = ticketMarkup(quote);
  assert.equal(quote.kind, 'unavailable');
  assert.match(html, DISABLED_BUTTON, 'an unstatable payout left the control live');
  assert.equal(html.includes('USDC'), false, 'a figure was rendered anyway');
  assert.ok(html.includes('This payout cannot be stated'), html);
});

test('the charged payout cannot be deferred behind a disclosure step', () => {
  // 11 §11.2 constraint 3. The type layer stops the direct form; this is the indirect one —
  // a fold handed down through components and rendered inside a collapsed region.
  const quote = quoteRedemption({
    call: 'redeem_scalar',
    gross: verified(10_000_000n),
    rate: RATE,
    minSplit: verified(MIN_SPLIT),
  });
  assert.throws(
    () =>
      renderToStaticMarkup(
        h(Disclosure, {
          summary: 'Details',
          children: h(RedemptionTicket, { quote, ...UNIT, onSubmit: () => undefined }),
        }),
      ),
    DeferredMeaningChangingFactError,
  );
});

/* ------------------------------------------------------------------------ the VOID layout */

type Holdings = Parameters<typeof voidRecoveryView>[0]['value'];

function holdings(overrides: Partial<Holdings> = {}): Holdings {
  const zeroGates = {
    Accept: { Survival: 0n, Security: 0n },
    Reject: { Survival: 0n, Security: 0n },
  };
  return {
    branchUsdc: { Accept: 0n, Reject: 0n },
    long: { Accept: 0n, Reject: 0n },
    short: { Accept: 0n, Reject: 0n },
    gateYes: zeroGates,
    gateNo: zeroGates,
    ...overrides,
  };
}

function voidView(overrides: Partial<Holdings>): VoidRecoveryView {
  return voidRecoveryView(verified(holdings(overrides)));
}

function voidMarkup(view: VoidRecoveryView): string {
  return renderToStaticMarkup(
    h(VoidRecoveryPanel, {
      view,
      ...UNIT,
      onMergePairs: () => undefined,
      onConsolidate: () => undefined,
      onRedeemVoid: () => undefined,
    }),
  );
}

/**
 * The balanced element a marker opens.
 *
 * Regions matter here because several of these rules are about *where* something appears
 * rather than whether it appears: the fold must carry the total and not the pair value, and
 * a 100 %-recovery label must sit on the merge action and nowhere near consolidation. A
 * whole-document `includes` cannot express either, and §11.6's own copy mentions 100 % in a
 * sentence that is required to be on the screen — so an unscoped check reads that as a
 * violation and would be relaxed until it said nothing.
 */
function elementAround(html: string, marker: string, tag: 'div' | 'section'): string {
  const at = html.indexOf(marker);
  assert.ok(at >= 0, `${marker} is not in the markup`);
  const open = html.lastIndexOf(`<${tag}`, at);
  assert.ok(open >= 0, `${marker} is in no <${tag}>`);
  const close = `</${tag}>`;
  let depth = 0;
  for (let i = open; i < html.length; i += 1) {
    if (html.startsWith(`<${tag}`, i)) depth += 1;
    else if (html.startsWith(close, i)) {
      depth -= 1;
      if (depth === 0) return html.slice(open, i + close.length);
    }
  }
  assert.fail(`${marker}'s region never closes`);
}

/** One `Panel`, by the title it renders as its accessible name. */
function panelTitled(html: string, title: string): string {
  return elementAround(html, `aria-label="${title}"`, 'section');
}

const COMPLETE = { branchUsdc: { Accept: 100_000_000n, Reject: 100_000_000n } };
const MIXED = { branchUsdc: { Accept: 100_000_000n, Reject: 60_000_000n } };
const UNPAIRED = { branchUsdc: { Accept: 100_000_000n, Reject: 0n } };

test('the headline is the TOTAL recovery, not the par value of the pairs', () => {
  // §11.6 step 3. The mixed case is the one where the two differ: 60 pairs at par plus a
  // residue of 40 at 0.5 recovers 80, and a headline quoting the pair alone says 60 — under
  // by a quarter, in the direction that looks like a smaller correct number.
  const view = voidView(MIXED);
  assert.equal(view.total.kind === 'stated' ? view.total.datum.value : -1n, 80_000_000n);
  assert.equal(view.parPair.kind === 'stated' ? view.parPair.datum.value : -1n, 60_000_000n);

  const fold = elementAround(voidMarkup(view), 'data-fact="void-recovery-decomposition"', 'div');
  assert.ok(fold.includes('80.000000 USDC'), 'the fold does not carry the total');
  assert.equal(fold.includes('60.000000 USDC'), false, 'the fold leads with the pair value');
});

test('SQ-171: the par promise is made only for holdings complete across both branches', () => {
  const complete = voidMarkup(voidView(COMPLETE));
  assert.ok(complete.includes(PAR_COPY), 'complete holdings were not promised par');
  assert.equal(complete.includes(PART_PAR_COPY), false);

  // A pair exists, so the *action* is offered — and the copy is not, because residue remains.
  const mixed = voidMarkup(voidView(MIXED));
  assert.equal(mixed.includes(PAR_COPY), false, 'par was promised over a residue');
  assert.ok(mixed.includes(PART_PAR_COPY), mixed);
  assert.ok(mixed.includes('Merge pairs'), 'the par action was withheld where a pair exists');

  // No pair at all: neither sentence, and no merge action to attach a 100 % label to.
  const unpaired = voidMarkup(voidView(UNPAIRED));
  assert.equal(unpaired.includes(PAR_COPY), false);
  assert.equal(unpaired.includes(PART_PAR_COPY), false);
  assert.equal(unpaired.includes('Merge pairs'), false);
});

test('the 100 % label sits on the merge action, and never on consolidation (E16)', () => {
  // Scoped to the panels, not to the document: §11.6 step 2's required copy says "recover
  // 100% by merging" and must be on screen in every case, so a document-wide search for the
  // string reports the honest sentence as a violation.
  const mixed = voidMarkup(voidView(MIXED));
  assert.match(panelTitled(mixed, 'Merge pairs → 100% recovery'), /100% recovery/);

  // A same-branch set consolidates and pays no USDC; presenting it under a 100 %-recovery
  // heading is the overstatement §11.6 step 1a names.
  const consolidating = voidMarkup(
    voidView({ long: { Accept: 8n, Reject: 0n }, short: { Accept: 8n, Reject: 0n } }),
  );
  const panel = panelTitled(consolidating, 'Consolidate same-branch sets');
  assert.equal(panel.includes('100'), false, `consolidation wore a 100 % label: ${panel}`);
  assert.ok(panel.includes(CONSOLIDATION_IS_NOT_RECOVERY), panel);
  // And there is no merge action at all here, so nothing could have carried the label.
  assert.equal(consolidating.includes('Merge pairs → 100% recovery'), false);
});

test('the VOID panel carries no fee line anywhere', () => {
  // `redeem_void` and every merge primitive are exempt (03 §5.3a(1)), so the floored rates
  // are what the account receives, gross and net alike. A fee line here would be wrong, not
  // merely redundant.
  for (const overrides of [COMPLETE, MIXED, UNPAIRED]) {
    const labels = labelsIn(voidMarkup(voidView(overrides)));
    assert.deepEqual([...labels].filter((label) => /fee|net/i.test(label)), [], labels.join(' | '));
  }
  // The pattern does catch a fee line where one belongs, or the loop proves nothing.
  const charged = quoteRedemption({
    call: 'redeem_scalar',
    gross: verified(10_000_000n),
    rate: RATE,
    minSplit: verified(MIN_SPLIT),
  });
  assert.ok(labelsIn(ticketMarkup(charged)).some((label) => /fee/i.test(label)));
});

test('the honesty copy renders, and calls the rates neutral rather than a penalty', () => {
  const html = voidMarkup(voidView(MIXED));
  assert.ok(html.includes(VOID_COPY), 'the §11.6 step 2 copy is missing');
  assert.ok(html.includes(VOID_NEUTRAL_PRICE), 'the neutral-price sentence is missing');
  assert.doesNotMatch(VOID_COPY, /penalty|confiscat/i);
  assert.doesNotMatch(VOID_NEUTRAL_PRICE, /confiscat/i);
});

test('every VOID figure carries the holdings’ own provenance', () => {
  // One `Verified<VoidHoldings>` in, provenance on every figure out. Splitting the input into
  // independently badged reads would invite a total whose parts came from two blocks, which
  // the decomposition itself has no way to detect.
  const view = voidView(MIXED);
  const figures = [view.total, view.parPair, ...view.residuals.flatMap((r) => [r.amount, r.payout])];
  assert.ok(figures.length >= 4);
  for (const figure of figures) {
    assert.equal(figure.kind, 'stated');
    if (figure.kind !== 'stated') continue;
    assert.equal(figure.datum.status.kind, 'verified-finalized');
  }
  const html = voidMarkup(view);
  assert.ok(html.includes('badge badge--verified-finalized'), 'no figure carried a badge');
});

test('the residue table states the exact floored payout per unpaired instrument', () => {
  // §11.6 step 2's rates, rendered as data beside the copy rather than folded into it: an
  // unpaired branch-USDC pays floor(a/2) and an unpaired leg floor(a/4).
  const view = voidView({
    branchUsdc: { Accept: 100_000_000n, Reject: 0n },
    long: { Accept: 4_000_001n, Reject: 0n },
  });
  const html = voidMarkup(view);
  assert.ok(html.includes('50.000000 USDC'), 'the branch-USDC residue is not floor(a/2)');
  assert.ok(html.includes('1.000000 USDC'), 'the leg residue is not floor(a/4)');
  // 4,000,001 / 4 floors to 1,000,000 — against the redeemer, and the display is the exact
  // floor computation rather than a rounded one.
  assert.equal(html.includes('1.000000 USDC') && html.includes('1.000001'), false);
});

test('the VOID decomposition cannot be deferred behind a disclosure step', () => {
  assert.throws(
    () =>
      renderToStaticMarkup(
        h(Disclosure, {
          summary: 'Details',
          children: h(VoidRecoveryPanel, {
            view: voidView(MIXED),
            ...UNIT,
            onMergePairs: () => undefined,
            onConsolidate: () => undefined,
            onRedeemVoid: () => undefined,
          }),
        }),
      ),
    DeferredMeaningChangingFactError,
  );
});
