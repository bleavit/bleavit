/**
 * The F7 surfaces — S1, S2, confirm-and-sign, S21 and S22.
 *
 * What is asserted here is the set of obligations doc 11 states in a way that a screen can
 * violate silently: a banner that is present but collapsible, a preview that is only
 * rendered when a value happens to be there, a summary that agrees with the form rather
 * than with the bytes. The tests are written against the *failure*, not against the happy
 * path, because a happy-path render of any of these screens passes either way.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement as h } from 'react';
import {
  INVENTORY_IDS,
  SCREENS,
  Shell,
  navigationFor,
  placementOf,
  Outlet,
  PENDING_SCREENS,
  SHELL_READS,
  assertOnePin,
  reachableScreens,
  readShellState,
  screenFor,
  VerificationPanelView,
  screenForHash,
  sudoBannerFor,
} from '@bleavit/application';
import {
  ConfirmSurface,
  EpochShrinkNotice,
  PayloadMismatchError,
  PROPOSAL_READS,
  ProposalDetail,
  decodeForConfirm,
  confirmProps,
  mayOfferSigning,
  readProposals,
  summarise,
  viewFor,
} from '@bleavit/features-tx';
import { ImportRefused, ImportReview, UnlabellableClampError } from '@bleavit/features-handoff';
import { ShareContext } from '@bleavit/features-handoff';
import { DeferredMeaningChangingFactError, Disclosure, Undecodable } from '@bleavit/ui';
import { externalProposal } from '@bleavit/shared-types';
import { defaultScope } from '@bleavit/contexts';
import { refuse } from '@bleavit/handoff-envelope';
import { classifyCheckpointAge } from '@bleavit/verify';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const DOC11 = join(REPO, 'docs/architecture/11-frontend-workflows.md');

const finalized = (value, blockNumber = 1_000_000) => ({
  value,
  status: { kind: 'verified-finalized', blockHash: '0xdead', blockNumber },
});
const AT = { blockHash: '0xdead', blockNumber: 1_000_000 };

// ------------------------------------------------------- the screen inventory

test('every screen doc 11 §11.2 lists is present in the client', () => {
  const doc = readFileSync(DOC11, 'utf8');
  const table = /^## 11\.2 Screen inventory$([\s\S]*?)^USDC balance reads/m.exec(doc);
  assert.ok(table, 'the §11.2 inventory table moved — this binding must be re-pointed');
  const declared = [...table[1].matchAll(/^\| (S\d+) \|/gm)].map((match) => match[1]);
  // Fail closed on a parse that found nothing: an empty expectation is satisfied by an
  // empty client, which is precisely the state constraint 1 forbids.
  assert.ok(declared.length >= 20, `parsed only ${declared.length} rows out of doc 11`);
  assert.deepEqual([...INVENTORY_IDS].sort(), [...declared].sort());
});

test('the areas match doc 11 row for row, since placement is derived from them', () => {
  const doc = readFileSync(DOC11, 'utf8');
  const table = /^## 11\.2 Screen inventory$([\s\S]*?)^USDC balance reads/m.exec(doc);
  const declared = new Map(
    [...table[1].matchAll(/^\| (S\d+) \| [^|]+ \| ([^|]+) \|/gm)].map((match) => [
      match[1],
      match[2].trim().replace(/\*\*/g, ''),
    ]),
  );
  assert.ok(declared.size >= 20, `parsed only ${declared.size} areas`);
  for (const screen of SCREENS) {
    if (!screen.id.startsWith('S')) continue;
    assert.equal(screen.area, declared.get(screen.id), `${screen.id} area drifted from doc 11`);
  }
});

test('placement is a function of area — handoff first, everything else Advanced', () => {
  assert.equal(placementOf('global'), 'chrome');
  assert.equal(placementOf('handoff'), 'primary');
  for (const area of ['core', 'FE-14', 'FE-15', 'funding']) {
    assert.equal(placementOf(area), 'advanced', area);
  }
});

test('the front door is the handoff surfaces, and the depth is one step behind', () => {
  const nav = navigationFor(true);
  assert.deepEqual(
    nav.primary.map((screen) => screen.id).sort(),
    ['S21', 'S22', 'confirm'],
  );
  // Demoted, not removed — 11 §11.2 constraint 1.
  for (const id of ['S3', 'S4', 'S7', 'S9', 'S14', 'S16']) {
    assert.ok(nav.advanced.some((screen) => screen.id === id), `${id} is not reachable`);
  }
});

test('with the handoff disabled, every other screen is still reachable (INV-FE-4)', () => {
  // The 15 §4.8 no-infrastructure posture. The failure this catches is a release whose
  // front door is optional: disable the handoff and the app has no navigation at all.
  const withHandoff = new Set(reachableScreens(true).map((screen) => screen.id));
  const without = new Set(reachableScreens(false).map((screen) => screen.id));
  const lost = [...withHandoff].filter((id) => !without.has(id));
  assert.deepEqual(lost.sort(), ['S21', 'S22', 'confirm']);
  const nav = navigationFor(false);
  assert.ok(nav.primary.length > 0, 'disabling the handoff left the client with no front door');
  assert.equal(nav.promotedForNoHandoff, true);
});

test('no screen was quietly dropped from the client', () => {
  // The direction the previous test cannot see: `reachableScreens` is derived from
  // `SCREENS`, so a screen deleted from both stays consistent and invisible. This one
  // compares against the count the doc declares.
  assert.equal(INVENTORY_IDS.length, 22);
  assert.equal(new Set(SCREENS.map((s) => s.path)).size, SCREENS.length, 'duplicate route path');
});

// --------------------------------------------------------------- S1 / shell

test('the sudo banner shows below phase 4, hides at and above it', () => {
  assert.notEqual(sudoBannerFor(finalized(0)), null);
  assert.notEqual(sudoBannerFor(finalized(3)), null);
  assert.equal(sudoBannerFor(finalized(4)), null);
  assert.equal(sudoBannerFor(finalized(5)), null);
});

test('an unread phase shows the banner — unknown is not post-sudo', () => {
  // INV-FE-12's direction. A read failure that hid the banner would present bootstrap
  // state as post-sudo state, which is the one error that cannot be recovered by looking
  // more carefully at the screen.
  const banner = sudoBannerFor(undefined);
  assert.notEqual(banner, null);
  const html = renderToStaticMarkup(banner);
  assert.ok(/could not be read/.test(html), html);
  assert.ok(html.includes('data-severity="danger"'), html);
});

const shellChain = (phase) => ({
  epoch: finalized(7),
  phaseLabel: finalized('Trade'),
  finalizedHeight: finalized(1_000_000),
  bootstrapPhase: phase === undefined ? undefined : finalized(phase),
});

test('the banner renders above the navigation, on the shell, with nothing to dismiss it', () => {
  const html = renderToStaticMarkup(
    h(Shell, {
      chain: shellChain(1),
      handoffEnabled: true,
      activeScreen: 'S21',
      children: h('p', null, 'content'),
    }),
  );
  assert.ok(html.includes('data-fact="sudo-era-banner"'), html);
  // Above navigation: the banner's markup precedes the nav element.
  assert.ok(html.indexOf('data-fact="sudo-era-banner"') < html.indexOf('<nav'), html);
  // Non-dismissible: the only buttons on a shell would be a dismiss control.
  assert.ok(!/<button/.test(html), `a dismiss control appeared: ${html}`);
});

test('the shell offers no prop that could hide the banner', () => {
  // 11 §11.10: "It MUST NOT be gated behind settings, themes, or 'compact mode'." Asserted
  // by rendering with every extra prop a future settings layer would plausibly add and
  // requiring the banner to survive all of them.
  for (const extra of [
    { compact: true },
    { theme: 'dark' },
    { showBanner: false },
    { dismissedBanners: ['sudo-era-banner'] },
  ]) {
    const html = renderToStaticMarkup(
      h(Shell, {
        chain: shellChain(0),
        handoffEnabled: true,
        activeScreen: 'S21',
        children: null,
        ...extra,
      }),
    );
    assert.ok(
      html.includes('data-fact="sudo-era-banner"'),
      `${JSON.stringify(extra)} suppressed the banner`,
    );
  }
});

// ------------------------------------------------------------------ S2

test('a proposal still trading has nowhere to put decision statistics', () => {
  const summary = {
    id: finalized('42'),
    title: finalized('Fund the thing'),
    klass: finalized('TREASURY'),
    state: finalized('Trading'),
  };
  const html = renderToStaticMarkup(
    h(ProposalDetail, { view: { stage: 'pre-decision', summary, reason: 'trading' } }),
  );
  assert.ok(/No decision statistics yet/.test(html), html);
  assert.ok(!/uplift/i.test(html), `an uplift figure leaked into a trading proposal: ${html}`);
  // The structural half: the pre-decision arm has no field for statistics at all, so a
  // caller cannot supply them. Asserted by construction — a `decisionStats` key on this
  // arm is a compile error, and `tests/firewall` carries the fixture.
  assert.ok(!('decisionStats' in { stage: 'pre-decision', summary, reason: 'trading' }));
});

test('a decided proposal renders its statistics with a badge', () => {
  const html = renderToStaticMarkup(
    h(ProposalDetail, {
      view: {
        stage: 'decided',
        summary: {
          id: finalized('42'),
          title: finalized('Fund the thing'),
          klass: finalized('TREASURY'),
          state: finalized('Settled'),
        },
        decisionStats: { outcome: finalized('PASS'), upliftPpm: finalized(12_500n) },
      },
    }),
  );
  assert.ok(/1\.2500 %/.test(html), html);
  assert.ok(html.includes('data-status="verified-finalized"'), html);
});

test('an epoch shrink renders slot counts, never money', () => {
  const html = renderToStaticMarkup(
    h(EpochShrinkNotice, {
      shrunk: {
        epoch: finalized(7),
        requested: finalized(12),
        funded: finalized(9),
        dropped: [finalized('41'), finalized('44')],
      },
    }),
  );
  assert.ok(/>12</.test(html), html);
  assert.ok(/>9</.test(html), html);
  assert.ok(!/USDC|VIT/.test(html), `a currency symbol appeared on a slot count: ${html}`);
  assert.ok(/41/.test(html) && /44/.test(html), 'the dropped proposal ids are not shown');
});

// ------------------------------------------------------- confirm and sign

const PREP = {
  scaleHex: '0x0a0b0c0d',
  builtFor: { specVersion: 2, metadataHash: '0xfeed' },
  preparedAt: AT,
  requires: ['P-1'],
};

const DECODER = () => ({
  pallet: 'Market',
  call: 'buy',
  args: [{ name: 'max_cost', typeName: 'u128', display: '9.500000 USDC' }],
});

const PASSING_ROW = {
  id: 'P-1',
  ok: true,
  requirement: 'the proposal is trading',
  expected: 'Trading',
  actual: 'Trading',
  at: AT,
};

test('the confirm summary can only be built from bytes', () => {
  const decoded = decodeForConfirm(PREP.scaleHex, DECODER);
  assert.equal(decoded.fromHex, PREP.scaleHex);
  assert.equal(summarise(decoded), 'Market.buy(max_cost = 9.500000 USDC)');
});

test('a decode of different bytes is refused, not rendered', () => {
  // The substitution attack in its exact shape: a truthful-looking summary of one
  // transaction beside a wallet signing another.
  const otherDecode = decodeForConfirm('0xffffffff', DECODER);
  assert.throws(
    () =>
      renderToStaticMarkup(
        h(ConfirmSurface, {
          prep: PREP,
          decoded: otherDecode,
          preconditions: [PASSING_ROW],
          sudoActive: false,
          onSign: () => {},
          onEdit: () => {},
          expert: false,
        }),
      ),
    PayloadMismatchError,
  );
});

test('every precondition row renders expected against actual', () => {
  const html = renderToStaticMarkup(
    h(ConfirmSurface, {
      prep: PREP,
      decoded: decodeForConfirm(PREP.scaleHex, DECODER),
      preconditions: [
        PASSING_ROW,
        { ...PASSING_ROW, id: 'P-2', ok: false, expected: 'Open', actual: 'Closed' },
      ],
      sudoActive: false,
      onSign: () => {},
      onEdit: () => {},
      expert: false,
    }),
  );
  assert.ok(html.includes('P-1') && html.includes('P-2'), html);
  assert.ok(html.includes('Closed'), 'the actual value is not shown');
  assert.ok(/does not hold/.test(html), html);
  // A failed row disables signing, with a reason.
  assert.ok(/disabled=""/.test(html), 'signing was not disabled by a failed precondition');
});

test('a charged redemption shows its net payout above the fold, never behind a step', () => {
  const payout = {
    net: finalized(9_970_000n),
    gross: finalized(10_000_000n),
    fee: finalized(30_000n),
    decimals: 6,
    symbol: 'USDC',
  };
  const html = renderToStaticMarkup(
    h(ConfirmSurface, {
      prep: PREP,
      decoded: decodeForConfirm(PREP.scaleHex, DECODER),
      preconditions: [PASSING_ROW],
      payout,
      sudoActive: false,
      onSign: () => {},
      onEdit: () => {},
      expert: false,
    }),
  );
  assert.ok(html.includes('data-fact="charged-redemption-net-payout"'), html);
  // The net is the headline, and it precedes the `<details>` that carries the depth.
  assert.ok(
    html.indexOf('9.970000') < html.indexOf('<details'),
    'the net payout was rendered after the disclosure',
  );
  assert.ok(html.includes('9.970000 USDC') && html.includes('10.000000 USDC'), html);
});

test('wrapping the confirm surface in a disclosure fails loudly', () => {
  // The composition a later layout change would make: "the confirm detail is long, put it
  // in an accordion". Both above-the-fold facts on this screen refuse it.
  assert.throws(
    () =>
      renderToStaticMarkup(
        h(
          Disclosure,
          { summary: 'Transaction' },
          h(ConfirmSurface, {
            prep: PREP,
            decoded: decodeForConfirm(PREP.scaleHex, DECODER),
            preconditions: [PASSING_ROW],
            sudoActive: true,
            onSign: () => {},
            onEdit: () => {},
            expert: false,
          }),
        ),
      ),
    DeferredMeaningChangingFactError,
  );
});

test('expert mode shows the raw SCALE, and ordinary mode does not', () => {
  const shared = {
    prep: PREP,
    decoded: decodeForConfirm(PREP.scaleHex, DECODER),
    preconditions: [PASSING_ROW],
    sudoActive: false,
    onSign: () => {},
    onEdit: () => {},
  };
  const expert = renderToStaticMarkup(h(ConfirmSurface, { ...shared, expert: true }));
  const plain = renderToStaticMarkup(h(ConfirmSurface, { ...shared, expert: false }));
  assert.ok(expert.includes(PREP.scaleHex), expert);
  assert.ok(!plain.includes(PREP.scaleHex), plain);
});

// ------------------------------------------------------------------- S22

const INTENT = {
  schema: 'bleavit.intent.v1',
  binding: { genesisHash: '0x91b1', specVersion: 2, contractVersion: 27 },
  action: { kind: 'prepare_pass_position', id: 42n, collateral: 10_000_000n },
  limits: { maxCost: 10_000_000n },
};

const reviewProps = (limits, extra = {}) => ({
  intent: INTENT,
  limits,
  resolvedTarget: finalized('Proposal 42 — “Fund the thing” (TREASURY, Trading)'),
  refreshedAt: AT,
  decimals: 6,
  symbol: 'USDC',
  expert: false,
  onBuild: () => {},
  onDiscard: () => {},
  ...extra,
});

const CLAMPED = {
  maxCost: {
    asked: 10_000_000n,
    chain: 9_500_000n,
    encoded: 9_500_000n,
    boundBy: 'chain',
    narrowed: true,
  },
  deadlineBlock: { asked: 1_000_100, chain: 1_000_064, encoded: 1_000_064, boundBy: 'chain', narrowed: true },
  anyNarrowed: true,
};

test('the imported action shows what its id actually resolves to on chain', () => {
  const html = renderToStaticMarkup(h(ImportReview, reviewProps(CLAMPED)));
  assert.ok(html.includes('Fund the thing'), 'the chain-read identity is missing');
  // The id as written is a request; what it resolves to is a finalized read. Both appear,
  // and they are badged differently — which is the whole substitution defence.
  assert.ok(html.includes('data-status="external-proposal"'), html);
  assert.ok(html.includes('data-status="verified-finalized"'), html);
});

test('the origin disclosure is above the fold and carries no tool-supplied label', () => {
  const html = renderToStaticMarkup(h(ImportReview, reviewProps(CLAMPED)));
  assert.ok(html.includes('data-fact="imported-action-origin"'), html);
  assert.ok(html.includes('data-section="§11.14.4"'), html);
  assert.ok(/outside Bleavit/.test(html), html);
});

test('the encoded number is badged by where it came from, not by where the file came from', () => {
  // The defect this test was written from: badging the encoded side `external-proposal`
  // unconditionally told the user a tool asked for a number the client itself computed.
  const chainBound = renderToStaticMarkup(h(ImportReview, reviewProps(CLAMPED)));
  const willBeEncoded = /will be encoded<\/span><span class="datum__value">[^<]*<\/span><span class="badge badge--(\w[\w-]*)"/.exec(
    chainBound,
  );
  assert.ok(willBeEncoded, chainBound);
  assert.equal(willBeEncoded[1], 'verified-finalized');

  const intentBound = renderToStaticMarkup(
    h(
      ImportReview,
      reviewProps({
        ...CLAMPED,
        maxCost: { ...CLAMPED.maxCost, encoded: 9_000_000n, chain: 9_500_000n, boundBy: 'intent', asked: 9_000_000n },
      }),
    ),
  );
  const askedBound = /will be encoded<\/span><span class="datum__value">[^<]*<\/span><span class="badge badge--(\w[\w-]*)"/.exec(
    intentBound,
  );
  assert.ok(askedBound, intentBound);
  assert.equal(askedBound[1], 'external-proposal');
});

test('a policy-bound clamp refuses rather than wearing a status that misdescribes it', () => {
  assert.throws(
    () =>
      renderToStaticMarkup(
        h(
          ImportReview,
          reviewProps({
            ...CLAMPED,
            maxCost: { ...CLAMPED.maxCost, boundBy: 'policy' },
          }),
        ),
      ),
    UnlabellableClampError,
  );
});

test('a refused document gets its own screen, with the recovery 10 §13.3 requires', () => {
  const refusal = refuse('FE-HANDOFF-004', 'unknown key "priceHint" inside action');
  const html = renderToStaticMarkup(h(ImportRefused, { refusal, onDismiss: () => {} }));
  assert.ok(html.includes('FE-HANDOFF-004'), html);
  assert.ok(html.includes(refusal.recovery), 'the refusal rendered without its recovery');
  assert.ok(html.includes('priceHint'), 'the detail was dropped');
});

// ------------------------------------------------------------------- S21

test('the export scope starts with no account data and is per export', () => {
  const scope = defaultScope();
  const html = renderToStaticMarkup(
    h(ShareContext, {
      scope,
      onScopeChange: () => {},
      onExport: () => {},
      anchorBlock: 1_000_000,
    }),
  );
  for (const account of ['positions', 'balances', 'address']) {
    const box = new RegExp(`data-scope="${account}"><input type="checkbox"([^>]*)`).exec(html);
    assert.ok(box, `${account} is not offered at all`);
    assert.ok(!/checked/.test(box[1]), `${account} is on by default`);
  }
});

test('an empty export is refused with a reason rather than silently producing nothing', () => {
  const html = renderToStaticMarkup(
    h(ShareContext, {
      scope: { included: [], pseudonymized: false },
      onScopeChange: () => {},
      onExport: () => {},
      anchorBlock: 1_000_000,
    }),
  );
  assert.ok(/disabled=""/.test(html), html);
  assert.ok(/would tell the tool nothing/.test(html), html);
});

test('pseudonymization is offered only with account data, and labelled for its limits', () => {
  const without = renderToStaticMarkup(
    h(ShareContext, {
      scope: { included: ['proposal'], pseudonymized: false },
      onScopeChange: () => {},
      onExport: () => {},
      anchorBlock: 1,
    }),
  );
  assert.ok(!/pseudonymize/i.test(without), 'offered with nothing to pseudonymize');

  const withAccount = renderToStaticMarkup(
    h(ShareContext, {
      scope: { included: ['proposal', 'positions'], pseudonymized: true },
      onScopeChange: () => {},
      onExport: () => {},
      anchorBlock: 1,
    }),
  );
  assert.ok(/pseudonymize/i.test(withAccount), withAccount);
  // Labelled for what it does NOT do — 11 §11.14.4.
  assert.ok(/holdings|fingerprint|linkage/i.test(withAccount), withAccount);
});

test('the share screen has no persistence surface at all', async () => {
  // "never included because the last export included them" — the way that breaks is a
  // convenience call somebody adds. The module exports nothing that could make one.
  const module = await import('@bleavit/features-handoff');
  const names = Object.keys(module);
  for (const name of names) {
    assert.ok(
      !/remember|persist|save|store|recall|preference/i.test(name),
      `${name} looks like a persistence surface on the handoff unit`,
    );
  }
});

// -------------------------------------------------------------- S1's reads

/** A `FinalizedReader`-shaped double: one pin, and storage answers it was given. */
function readerDouble(pin, values) {
  return {
    at: pin,
    async storage(key) {
      const raw = values[key];
      return {
        value: raw === undefined ? [] : [{ key, value: raw }],
        status: { kind: 'verified-finalized', blockHash: pin.blockHash, blockNumber: pin.blockNumber },
      };
    },
  };
}

const DECODERS_OK = {
  epochOf: () => ({ ok: true, value: { epoch: 7, phase: 'Trade' } }),
  phaseFlags: () => ({ ok: true, value: { governancePhase: 4 } }),
};

test('every leaf of the shell model comes from the reader’s one pinned block', async () => {
  const pin = { blockHash: '0xbeef', blockNumber: 42 };
  const reader = readerDouble(pin, { [SHELL_READS.epochOf]: '0x01', [SHELL_READS.phaseFlags]: '0x04' });
  const { state, undecodable } = await readShellState(reader, DECODERS_OK);
  assert.deepEqual(undecodable, []);
  for (const leaf of [state.epoch, state.phaseLabel, state.finalizedHeight, state.bootstrapPhase]) {
    assert.equal(leaf.status.blockHash, '0xbeef');
    assert.equal(leaf.status.blockNumber, 42);
  }
});

test('an undecodable read renders raw SCALE and is never guessed at', async () => {
  const pin = { blockHash: '0xbeef', blockNumber: 42 };
  const reader = readerDouble(pin, {
    [SHELL_READS.epochOf]: '0xdeadbeef',
    [SHELL_READS.phaseFlags]: '0x04',
  });
  const { state, undecodable } = await readShellState(reader, {
    ...DECODERS_OK,
    epochOf: () => ({ ok: false, reason: 'variant index 9 is not in this enum' }),
  });
  assert.equal(undecodable.length, 1);
  assert.equal(undecodable[0].label, SHELL_READS.epochOf);
  assert.equal(undecodable[0].rawHex, '0xdeadbeef');
  // The bytes reach the screen; a substituted value would be the guess rule 10 forbids.
  const html = renderToStaticMarkup(h(Undecodable, undecodable[0]));
  assert.ok(html.includes('0xdeadbeef'), html);
  assert.ok(/could not decode/.test(html), html);
  assert.equal(state.phaseLabel.value, 'unknown');
});

test('an unreadable PhaseFlags fails closed to the banner, not to post-sudo', async () => {
  const pin = { blockHash: '0xbeef', blockNumber: 42 };
  // The key returns nothing at all — the case where a substituted 4 would silently claim
  // sudo has been removed.
  const reader = readerDouble(pin, { [SHELL_READS.epochOf]: '0x01' });
  const { state, undecodable } = await readShellState(reader, DECODERS_OK);
  assert.equal(state.bootstrapPhase, undefined);
  assert.notEqual(sudoBannerFor(state.bootstrapPhase), null);
  assert.ok(undecodable.some((row) => row.label === SHELL_READS.phaseFlags));
});

test('a model assembled from two blocks is refused rather than rendered', () => {
  // The guard is tested DIRECTLY, and the first version of this test was not: it drove
  // `readShellState`, which stamps every leaf from `reader.at`, so the only thing it could
  // assert was that two hashes the test wrote itself were different. That proved nothing
  // about the guard — the same vacuous shape this repository keeps finding.
  const at = { blockHash: '0xbeef', blockNumber: 42 };
  const ok = (value) => ({ value, status: { kind: 'verified-finalized', ...at } });
  const consistent = {
    epoch: ok(7),
    phaseLabel: ok('Trade'),
    finalizedHeight: ok(42),
    bootstrapPhase: ok(4),
  };
  assert.doesNotThrow(() => assertOnePin(consistent, at.blockHash));

  // One leaf from a different block: a header showing the epoch at one block and the phase
  // at another is a view that never existed, and nothing on screen distinguishes it.
  for (const field of ['epoch', 'phaseLabel', 'finalizedHeight', 'bootstrapPhase']) {
    const mixed = {
      ...consistent,
      [field]: {
        value: consistent[field].value,
        status: { kind: 'verified-finalized', blockHash: '0xcafe', blockNumber: 43 },
      },
    };
    assert.throws(() => assertOnePin(mixed, at.blockHash), /mixes blocks/, field);
  }

  // A leaf whose status carries no block at all — a provider or external-proposal value
  // reaching the header — is refused too, rather than skipped for lack of a hash.
  assert.throws(
    () => assertOnePin({ ...consistent, epoch: { value: 7, status: { kind: 'external-proposal' } } }, at.blockHash),
    /mixes blocks/,
  );
});

// ------------------------------------------------------------- the outlet

test('every navigable screen resolves to something, in both handoff postures', () => {
  for (const handoff of [true, false]) {
    for (const screen of reachableScreens(handoff)) {
      const resolved = screenFor(screen.path, handoff);
      assert.equal(resolved.id, screen.id, `${screen.path} did not resolve to ${screen.id}`);
    }
  }
});

test('an unknown hash lands on the front door rather than on nothing', () => {
  assert.equal(screenFor('#/nonsense', true).id, 'S21');
  assert.equal(screenFor('#/nonsense', false).id, 'S2');
  assert.equal(screenFor('', true).id, 'S21');
});

test('the not-yet-built set is declared, and every member is a real screen', () => {
  // The direction that matters: a screen *dropped* from the client must not be able to
  // hide among the pending ones. Every pending id has to exist in the inventory, and no
  // pending id may be one this build actually implements.
  const inventory = new Set(INVENTORY_IDS);
  for (const id of Object.keys(PENDING_SCREENS)) {
    assert.ok(inventory.has(id), `${id} is declared pending but is not in the inventory`);
  }
  const built = ['S1', 'S2', 'S21', 'S22'];
  for (const id of built) {
    assert.ok(!(id in PENDING_SCREENS), `${id} is built but declared pending`);
  }
  // And the two sets together cover the whole inventory — no screen is unaccounted for.
  const accounted = new Set([...Object.keys(PENDING_SCREENS), ...built]);
  assert.deepEqual([...inventory].filter((id) => !accounted.has(id)), []);
});

test('a pending screen says which milestone owns it, and offers no action', () => {
  const html = renderToStaticMarkup(
    h(Outlet, { hash: '#/guardian', handoffEnabled: true, implemented: {} }),
  );
  assert.ok(/F17/.test(html), html);
  assert.ok(/not in this build/.test(html), html);
  assert.ok(!/<button/.test(html), `a pending screen offered an action: ${html}`);
});

test('an implemented screen renders its own component instead of the placeholder', () => {
  const html = renderToStaticMarkup(
    h(Outlet, {
      hash: '#/share',
      handoffEnabled: true,
      implemented: { S21: () => h('p', { id: 'real' }, 'the real screen') },
    }),
  );
  assert.ok(html.includes('the real screen'), html);
  assert.ok(!/not in this build/.test(html), html);
});

test('the navigation highlight and the outlet agree on which screen is showing', () => {
  // They were briefly two implementations of one lookup. A disagreement would highlight one
  // screen in the nav while rendering another, and each half would look right on its own.
  for (const handoff of [true, false]) {
    for (const hash of [...SCREENS.map((s) => s.path), '#/nonsense', '']) {
      assert.equal(screenForHash(hash, handoff), screenFor(hash, handoff).id, `${hash}/${handoff}`);
    }
  }
});

// ---------------------------------------------------------- S2's reads

test('no statistics render while a proposal is still trading', () => {
  const summary = {
    id: finalized('42'),
    title: finalized('t'),
    klass: finalized('TREASURY'),
    state: finalized('Trading'),
  };
  const { view, anomaly } = viewFor(summary, undefined);
  assert.equal(view.stage, 'pre-decision');
  assert.equal(view.reason, 'trading');
  assert.equal(anomaly, undefined);
  assert.ok(!('decisionStats' in view));
});

test('an Extended proposal gets its own copy, not the generic one', () => {
  const summary = {
    id: finalized('42'), title: finalized('t'), klass: finalized('P'), state: finalized('Extended'),
  };
  assert.equal(viewFor(summary, undefined).view.reason, 'extended');
});

test('statistics arriving on an open market are refused and reported, not rendered', () => {
  // The case a "render it if the API returned some" implementation gets wrong. Both reads
  // came from one pinned block, so it is a contradiction rather than a race, and only one
  // reading is safe to act on.
  const summary = {
    id: finalized('42'), title: finalized('t'), klass: finalized('P'), state: finalized('Trading'),
  };
  const stats = { outcome: finalized('PASS'), upliftPpm: finalized(12_500n) };
  const { view, anomaly } = viewFor(summary, stats);
  assert.equal(view.stage, 'pre-decision');
  assert.ok(anomaly, 'the contradiction was swallowed');
  assert.match(anomaly.detail, /trading signal/);
  assert.equal(anomaly.proposalId, '42');
});

test('an unknown lifecycle state renders no statistics — fail closed, not fail open', () => {
  // INV-FE-12. A denylist alone would admit a state from a runtime upgrade, or one a
  // plausible-but-wrong decode produced.
  const summary = {
    id: finalized('42'), title: finalized('t'), klass: finalized('P'),
    state: finalized('SomeStateFromANewerRuntime'),
  };
  const stats = { outcome: finalized('PASS'), upliftPpm: finalized(1n) };
  const { view, anomaly } = viewFor(summary, stats);
  assert.equal(view.stage, 'pre-decision');
  assert.ok(anomaly, 'an unknown state let statistics through');
});

test('a sealed proposal does render its statistics', () => {
  // The anti-vacuity control: if this failed, every test above would pass for the trivial
  // reason that nothing ever renders statistics.
  const summary = {
    id: finalized('42'), title: finalized('t'), klass: finalized('P'), state: finalized('Settled'),
  };
  const stats = { outcome: finalized('PASS'), upliftPpm: finalized(12_500n) };
  const { view, anomaly } = viewFor(summary, stats);
  assert.equal(view.stage, 'decided');
  assert.equal(anomaly, undefined);
  assert.equal(view.decisionStats.upliftPpm.value, 12_500n);
});

test('the proposal list is cross-checked against its own storage prefix (FE-P2)', async () => {
  const pin = { blockHash: '0xbeef', blockNumber: 42 };
  let asked;
  const reader = {
    at: pin,
    async crossCheckedCall(source) {
      asked = source;
      return {
        value: { result: '0x00', witness: [{ key: 'k1', value: '0xaa' }, { key: 'k2', value: '0xbb' }] },
        status: { kind: 'verified-finalized', ...pin },
      };
    },
  };
  const read = await readProposals(reader, {
    proposals: (raw) => ({
      ok: true,
      value: raw.map((hex, i) => ({ id: String(i), title: hex, klass: 'P', state: 'Settled' })),
    }),
    decisionStats: () => ({ ok: true, value: undefined }),
  });
  // The API and the prefix are paired by the reader, never by this call site — satisfying
  // one domain's view with the other's keys is what would make the check vacuous.
  assert.deepEqual(asked, { api: PROPOSAL_READS.summaries, storagePrefix: PROPOSAL_READS.proposals });
  assert.equal(read.summaries.length, 2);
  for (const summary of read.summaries) assert.equal(summary.id.status.blockHash, '0xbeef');
});

test('a prefix key with no value is reported, never silently dropped', async () => {
  // The failure this catches shortens the list and passes: the remaining entries decode
  // perfectly, the screen shows fewer proposals than the chain has, and nothing says so.
  const pin = { blockHash: '0xbeef', blockNumber: 42 };
  const reader = {
    at: pin,
    async crossCheckedCall() {
      return {
        value: { result: '0x00', witness: [{ key: 'k1', value: '0xaa' }, { key: 'k2' }] },
        status: { kind: 'verified-finalized', ...pin },
      };
    },
  };
  const read = await readProposals(reader, {
    proposals: (raw) => ({
      ok: true,
      value: raw.map((hex, i) => ({ id: String(i), title: hex, klass: 'P', state: 'Settled' })),
    }),
    decisionStats: () => ({ ok: true, value: undefined }),
  });
  assert.equal(read.summaries.length, 1);
  assert.equal(read.undecodable.length, 1);
  assert.match(read.undecodable[0].label, /Epoch\.Proposals\[k2\]/);
  assert.match(read.undecodable[0].reason, /carries no value/);
});

// ------------------------------------------- the confirm surface's gate wiring

const session = (overrides) => ({
  state: 'Draft', prep: undefined, failed: [], lastError: undefined,
  signingWindow: undefined, ...overrides,
});
const confirmInputs = () => ({
  decoded: decodeForConfirm(PREP.scaleHex, DECODER),
  sudoActive: false, expert: false, onSign: () => {}, onEdit: () => {},
});

test('no confirm screen exists before the chain has been re-read', () => {
  // A confirm screen is a statement that the chain was re-read at a named block. In these
  // states that statement is not yet true, so there is nothing to render — not a screen
  // with empty or remembered rows.
  for (const state of ['Draft', 'Prepared', 'Refreshing']) {
    assert.equal(
      confirmProps(session({ state, prep: PREP }), confirmInputs()),
      undefined,
      state,
    );
  }
});

test('AwaitingSignature renders the gate’s own passing rows', () => {
  const passed = { at: AT, results: [PASSING_ROW, { ...PASSING_ROW, id: 'P-2' }] };
  const props = confirmProps(
    session({ state: 'AwaitingSignature', prep: PREP, signingWindow: passed }),
    confirmInputs(),
  );
  assert.ok(props);
  assert.deepEqual(props.preconditions.map((r) => r.id), ['P-1', 'P-2']);
  assert.equal(mayOfferSigning(session({ state: 'AwaitingSignature' })), true);
});

test('Blocked renders the failures only — rule 5’s diff view, not a padded set', () => {
  const failed = [{ ...PASSING_ROW, id: 'P-2', ok: false, expected: 'Open', actual: 'Closed' }];
  // The session MUST carry a stale signing window, and the first version of this test did
  // not: with `signingWindow: undefined` a controller that preferred the window would fall
  // back to `failed` and pass. Mutation M34 survived on exactly that. The dangerous session
  // is `Blocked` reached *after* a gate once passed — a full set of rows that were true at
  // a block B′ has already moved past.
  const stale = { at: { blockHash: '0xold', blockNumber: 999 }, results: [PASSING_ROW, { ...PASSING_ROW, id: 'P-3' }] };
  const props = confirmProps(
    session({ state: 'Blocked', prep: PREP, failed, signingWindow: stale }),
    confirmInputs(),
  );
  assert.ok(props);
  assert.deepEqual(props.preconditions.map((r) => r.id), ['P-2']);
  assert.ok(!props.preconditions.some((r) => r.ok), 'a superseded passing row was rendered');
});

test('signing is offered on the state, never on "every row passes"', () => {
  // FE-TX-007 blocks with an EMPTY `failed` array — the runtime changed, so the bytes are
  // wrong and no precondition is at fault. "Every row passes" is vacuously true of it, and
  // a surface deriving the signer from the rows would offer to sign stale bytes.
  const runtimeChanged = session({
    state: 'Blocked', prep: PREP, failed: [], lastError: 'FE-TX-007',
  });
  assert.equal(mayOfferSigning(runtimeChanged), false);
  const props = confirmProps(runtimeChanged, confirmInputs());
  assert.ok(props);
  assert.deepEqual(props.preconditions, []);
  assert.ok(!props.preconditions.some((r) => !r.ok), 'no row is at fault, by construction');
});

test('the confirm controller reaches no signer', async () => {
  // `src/features/tx` may reference `signing` (10 §10.2), so this restraint is not
  // structural and has to be asserted. The controller hands `onSign` back to its caller.
  const source = readFileSync(
    join(REPO, 'app/src/features/tx/src/confirm-controller.ts'),
    'utf8',
  );
  assert.ok(!/@bleavit\/signing/.test(source), 'the confirm controller imports a signer');
  assert.ok(!/\bsign\s*\(/.test(source.replace(/mayOfferSigning|onSign/g, '')), source);
});

// ------------------------------------------------ the verification panel (F10)

const PANEL = {
  status: 'unverified',
  rows: [
    { label: 'Release (Arweave TXID)', value: 'txid-abc', kind: 'pinned' },
    { label: 'Relay genesis', value: '0x91b1…c3', kind: 'pinned' },
    { label: 'Observed genesis', value: '0x91b1…c3', kind: 'observed' },
  ],
  warnings: [],
  chainIdentityVerified: false,
};

test('a pin is distinguishable from an observation in words, not only in markup', () => {
  // "A panel that renders both identically lets a pin masquerade as a verification." A
  // class name or a colour is not a fact a reader can act on.
  //
  // Asserted PER ROW, and the first version was not: it searched the whole document for the
  // two phrases, which also appear in the "not verified yet" notice above the list. Deleting
  // the per-row label entirely left that test green — mutation M41 survived on it.
  const html = renderToStaticMarkup(h(VerificationPanelView, { panel: PANEL }));
  const rows = [...html.matchAll(/<div class="verification__row" data-kind="(\w+)"[^>]*>(.*?)<\/div>/g)];
  assert.equal(rows.length, PANEL.rows.length, `expected ${PANEL.rows.length} rows: ${html}`);
  for (const [, kind, body] of rows) {
    const expected = kind === 'pinned' ? 'in this bundle' : 'reported by the chain';
    assert.ok(body.includes(expected), `a ${kind} row carries no words saying so: ${body}`);
  }
});

test('the panel renders with no chain handle and nothing verified (10 §3.2)', () => {
  // Under FE-BOOT-002 the worker never started and no verified read exists. The panel is
  // one of the surfaces that must still work — it takes no chain, and says so plainly.
  const html = renderToStaticMarkup(h(VerificationPanelView, { panel: PANEL }));
  assert.ok(/has not been verified yet/.test(html), html);
  assert.ok(html.includes('txid-abc'), 'the pinned rows are absent');
});

test('divergence is reported and explicitly not repaired', () => {
  const html = renderToStaticMarkup(
    h(VerificationPanelView, {
      panel: { ...PANEL, status: 'divergent', warnings: ['index.html differs from the release'] },
    }),
  );
  assert.ok(/does not match/.test(html), html);
  assert.ok(/re-fetching would ask the same channel/.test(html), html);
  assert.ok(html.includes('index.html differs'), html);
});

test('a fresh checkpoint renders no reassurance at all', () => {
  // A green "checkpoint is current" line is a claim about the future: the bound lapses on
  // a clock the client does not control, so the reassurance would go stale silently.
  //
  // Asserted as BYTE EQUALITY against the panel with no checkpoint supplied at all. The
  // first version only checked that the three warning phrases were absent, which any other
  // reassuring wording passes — mutation M42 added "Release is current" and survived.
  const fresh = renderToStaticMarkup(
    h(VerificationPanelView, { panel: PANEL, checkpoint: { kind: 'fresh', ageMillis: 0 } }),
  );
  const none = renderToStaticMarkup(h(VerificationPanelView, { panel: PANEL }));
  assert.equal(fresh, none, 'a fresh checkpoint rendered something a missing one does not');
});

test('an expired checkpoint is rendered at danger, with its own message', () => {
  const verdict = classifyCheckpointAge(0, 40 * 24 * 60 * 60 * 1000, {
    bondingDurationEras: 28, slashDeferDurationEras: 27, eraMillis: 24 * 60 * 60 * 1000,
  });
  const html = renderToStaticMarkup(h(VerificationPanelView, { panel: PANEL, checkpoint: verdict }));
  assert.ok(/too old to verify/.test(html), html);
  assert.ok(html.includes('data-severity="danger"'), html);
  assert.ok(/newer release/.test(html), html);
});

test('an indeterminate age is danger too, never quietly info', () => {
  const clockBack = classifyCheckpointAge(100 * 24 * 60 * 60 * 1000, 0, {
    bondingDurationEras: 28, slashDeferDurationEras: 27, eraMillis: 24 * 60 * 60 * 1000,
  });
  const html = renderToStaticMarkup(h(VerificationPanelView, { panel: PANEL, checkpoint: clockBack }));
  assert.ok(/cannot be established/.test(html), html);
  assert.ok(html.includes('data-severity="danger"'), html);
});
