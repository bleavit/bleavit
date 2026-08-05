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
  DEGRADATION_ROWS,
  Outlet,
  PENDING_SCREENS,
  PHASE_FLAG_BITS,
  SHELL_READS,
  assertOnePin,
  reachableScreens,
  hasPhaseFlag,
  implementedScreens,
  namedPhaseFlags,
  unaccountedScreens,
  readShellState,
  respondTo,
  screenFor,
  VerificationPanelView,
  screenForHash,
  shellDecoders,
  sudoActive,
  sudoBannerFor,
} from '@bleavit/application';
import {
  ConfirmSurface,
  EpochShrinkNotice,
  PayloadMismatchError,
  CONFIRM_ABORT_COPY,
  ConvictionLock,
  PROPOSAL_READS,
  ProposalDetail,
  BALLOT_NOT_ROUTINE,
  CANNOT_COMPLETE,
  OracleResolutionBallot,
  DelegationForm,
  RatificationPanel,
  UNRATIFIED_CONSEQUENCE,
  allowanceRemaining,
  REGISTRY_HOLDS_SETTLEMENT,
  approvalBlocks,
  challengeWindowCopy,
  claimBlocks,
  mayChallenge,
  noOpWarning,
  snapshotCrankState,
  claimableNow,
  depositBlocks,
  insuranceCopy,
  insuranceStanding,
  destinationWarning,
  mayActivatePlaybook,
  proposalBlocks,
  triggerRefusal,
  isApplicable,
  submissionOutlook,
  verifyArtifact,
  progressCopy,
  withdrawBlocks,
  xcmWarning,
  SPLIT_NO_CONVICTION,
  UnlockForm,
  VoteForm,
  canStillComplete,
  ReferendaList,
  ReferendumDetail,
  decodeForConfirm,
  confirmProps,
  mayOfferSigning,
  readProposals,
  summarise,
  viewFor,
} from '@bleavit/features-tx';
import { ImportRefused, ImportReview, UnlabellableClampError } from '@bleavit/features-handoff';
import { ShareContext } from '@bleavit/features-handoff';
import {
  AlwaysVisible,
  DeferredMeaningChangingFactError,
  Disclosure,
  Undecodable,
  aboveTheFold,
} from '@bleavit/ui';
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

test('the phase-flag bit table matches 02 §7.3 exactly', () => {
  // The assignments are wire format frozen in the contract, not a tunable, so they are
  // compiled in — and bound to the document's own sentence so a reassignment fails here
  // rather than silently disagreeing with the runtime.
  const doc = readFileSync(join(REPO, 'docs/architecture/02-integration-contract.md'), 'utf8');
  const sentence = /Bit assignments: ([^|]+?); bits 8–31 reserved/.exec(doc);
  assert.ok(sentence, 'the §7.3 bit-assignment sentence moved — re-point this binding');
  const declared = Object.fromEntries(
    sentence[1].split(',').map((part) => {
      const [bit, name] = part.split('=').map((x) => x.trim());
      return [name, Number(bit)];
    }),
  );
  assert.equal(Object.keys(declared).length, 8, `parsed ${JSON.stringify(declared)}`);
  assert.deepEqual({ ...PHASE_FLAG_BITS }, declared);
});

test('the sudo banner keys off bit 4, not off a phase number', () => {
  // The defect this replaced: the first version tested `phase >= 4`, which shares the digit
  // with "bit 4" and is the opposite check. The recorded chain value is the witness.
  const RECORDED = 17; // 0b10001 — shadow mode + sudo present, decoded from the real fixture
  assert.equal(sudoActive(RECORDED), true);
  assert.notEqual(sudoBannerFor(finalized(RECORDED)), null, 'the banner hid on a sudo chain');
  // Under the old reading `17 >= 4` was true and the banner would have been hidden.
  assert.ok(RECORDED >= 4, 'the witness must be a value the old check got wrong');

  // Bit 4 clear, other bits set: no banner.
  assert.equal(sudoActive(0b1111), false);
  assert.equal(sudoBannerFor(finalized(0b1111)), null);
  // Bit 4 alone: banner.
  assert.equal(sudoActive(1 << 4), true);
  assert.notEqual(sudoBannerFor(finalized(1 << 4)), null);
  // Nothing set at all: no banner, and that is a read rather than an absence.
  assert.equal(sudoBannerFor(finalized(0)), null);
});

test('flags are tested by name, and a set reserved bit changes nothing', () => {
  assert.deepEqual(namedPhaseFlags(17), ['shadow mode', 'sudo present']);
  // Reserved bits 8–31 are unnamed, and setting them must not disturb the named ones.
  // `1 << 31` is negative in JS, which is why it is the interesting case — and the reason
  // `hasPhaseFlag` needs no sign normalisation: every named bit is 0–7, so the mask is
  // positive and the result is non-negative whatever the sign of the input.
  assert.equal(hasPhaseFlag((1 << 31) | (1 << 4), 'sudo present'), true);
  assert.equal(hasPhaseFlag(1 << 31, 'sudo present'), false);
  assert.deepEqual(namedPhaseFlags((1 << 31) | 17), ['shadow mode', 'sudo present']);
});

test('an unestablished PhaseFlags means sudo is assumed active (INV-FE-12)', () => {
  // `sudoActive`'s own undefined branch. Every earlier test reached it through
  // `sudoBannerFor`, which has a separate `undefined` branch of its own — so a mutation
  // flipping this one survived, with the banner still showing for the other function's
  // reason rather than for this one's.
  assert.equal(sudoActive(undefined), true);
  assert.equal(sudoActive(0), false);
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
  phaseFlags: phase === undefined ? undefined : finalized(phase),
});

test('the banner renders above the navigation, on the shell, with nothing to dismiss it', () => {
  const html = renderToStaticMarkup(
    h(Shell, {
      chain: shellChain(1 << 4),
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
        chain: shellChain(1 << 4),
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
  for (const leaf of [state.epoch, state.phaseLabel, state.finalizedHeight, state.phaseFlags]) {
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
  assert.equal(state.phaseFlags, undefined);
  assert.notEqual(sudoBannerFor(state.phaseFlags), null);
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
    phaseFlags: ok(4),
  };
  assert.doesNotThrow(() => assertOnePin(consistent, at.blockHash));

  // One leaf from a different block: a header showing the epoch at one block and the phase
  // at another is a view that never existed, and nothing on screen distinguishes it.
  for (const field of ['epoch', 'phaseLabel', 'finalizedHeight', 'phaseFlags']) {
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

test('the not-yet-reachable set is declared, and every member is a real screen', () => {
  // A screen *dropped* from the client must not be able to hide among the pending ones, so
  // every pending id has to exist in the inventory.
  //
  // The set's meaning was sharpened once `unaccountedScreens()` existed: it means "this
  // build does not reach it", which covers both *not built* and *built but unwired*. S2,
  // S21 and S22 are the second kind — components that exist with no data path yet — and
  // this test previously asserted the opposite, that they were absent from the map. They
  // were, and that is exactly what left them rendering as "coming soon" with no owner.
  const inventory = new Set(INVENTORY_IDS);
  for (const id of Object.keys(PENDING_SCREENS)) {
    assert.ok(inventory.has(id), `${id} is declared pending but is not in the inventory`);
  }
  // The built-but-unwired three say so in their own entries, rather than being indexed as
  // unbuilt — a reader who cannot tell the two apart does the wrong work.
  for (const id of ['S2', 'S21', 'S22']) {
    assert.ok(
      /\bexist(s)?\b/.test(PENDING_SCREENS[id]),
      `${id} does not say it is already built: ${PENDING_SCREENS[id]}`,
    );
  }
  // S1 is chrome — the shell's own header, never routed through the outlet — so it is in
  // neither map, and `unaccountedScreens()` excludes it for that reason alone.
  assert.ok(!(('S1') in PENDING_SCREENS), 'S1 is chrome and must not be listed as a route');
  // Everything else is accounted for exactly once.
  const accounted = new Set([...Object.keys(PENDING_SCREENS), ...Object.keys(implementedScreens()), 'S1']);
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

// -------------------- end to end: recorded bytes → real codecs → the shell

/** The exact values recorded from the runtime at one pinned block. */
function recordedStorageValue(fixture) {
  const doc = JSON.parse(
    readFileSync(join(REPO, 'app/fixtures/chainhead', fixture), 'utf8'),
  );
  for (const request of doc.requests) {
    for (const event of request.response.events ?? []) {
      for (const item of event.items ?? []) {
        if (item.value !== undefined) return item.value;
      }
    }
  }
  throw new Error(`${fixture} records no storage value`);
}

test('the recorded chain bytes reach the shell as the right model', async () => {
  // The whole path with no node: recorded bytes → the real PAPI codecs → the read layer →
  // the screen model. Every layer between is exercised, and the expected values come from
  // the RUNTIME's own recording rather than from a shape written out of the docs — which is
  // how the PhaseFlags defect was found in the first place.
  const { bleavit } = await import('@polkadot-api/descriptors');
  const { loadCodecs } = await import('@bleavit/chain-client');
  const codecs = await loadCodecs(bleavit);

  const pin = { blockHash: '0xbeef', blockNumber: 4242 };
  const reader = readerDouble(pin, {
    [SHELL_READS.epochOf]: recordedStorageValue('storage.epoch.epoch_of.json'),
    [SHELL_READS.phaseFlags]: recordedStorageValue('storage.constitution.phase_flags.json'),
  });

  const { state, undecodable } = await readShellState(reader, shellDecoders(codecs));
  assert.deepEqual(undecodable, [], JSON.stringify(undecodable));
  assert.equal(state.epoch.value, 1);
  assert.equal(state.phaseLabel.value, 'Intake');
  assert.equal(state.phaseFlags.value, 17);

  // And the consequence that matters: this chain has sudo, so the banner shows.
  assert.equal(sudoActive(state.phaseFlags.value), true);
  const html = renderToStaticMarkup(
    h(Shell, { chain: state, handoffEnabled: true, activeScreen: 'S21', children: null }),
  );
  assert.ok(html.includes('data-fact="sudo-era-banner"'), 'the banner is absent on a sudo chain');
  assert.ok(html.includes('Intake'), html);
});

test('a decode failure keeps its own reason instead of being relabelled', () => {
  // Mutation M60 survived without this: replacing the propagation with a shape check still
  // produced `ok: false`, so every existing assertion passed — while the reason changed
  // from "these bytes did not decode" to "this is not a record", which sends a reader
  // hunting a runtime-shape problem that is not there.
  const failing = {
    query: {
      Epoch: { EpochOf: { value: { dec: () => { throw new Error('bytes ran out'); } } } },
      Constitution: { PhaseFlags: { value: { dec: () => { throw new Error('bytes ran out'); } } } },
    },
  };
  const built = shellDecoders(failing);
  for (const decode of [built.epochOf, built.phaseFlags]) {
    const result = decode('0xdead');
    assert.equal(result.ok, false);
    assert.match(result.reason, /bytes ran out/, `the underlying reason was replaced: ${result.reason}`);
  }
});

test('a runtime whose EpochOf shape moved fails loudly rather than rendering NaN', async () => {
  // The direction a silent field read gets wrong: `undefined` in, `NaN` and the word
  // "undefined" on the header out.
  const decoders = {
    epochOf: () => ({ ok: true, value: { somethingElse: 1 } }),
    phaseFlags: () => ({ ok: true, value: 0 }),
  };
  const pin = { blockHash: '0xbeef', blockNumber: 1 };
  // The shape check lives in `shellDecoders`, so drive it directly with a stub codec set.
  const { shellDecoders: build } = await import('@bleavit/application');
  const stub = { query: { Epoch: { EpochOf: { value: { dec: () => ({ somethingElse: 1 }) } } },
                          Constitution: { PhaseFlags: { value: { dec: () => 1.5 } } } } };
  const built = build(stub);
  const epoch = built.epochOf('0x00');
  assert.equal(epoch.ok, false);
  assert.match(epoch.reason, /encodes the epoch differently/);
  // A non-integer bitset is refused too: testing bits on a float yields nonsense silently.
  const flags = built.phaseFlags('0x00');
  assert.equal(flags.ok, false);
  assert.match(flags.reason, /integer/);
  void decoders;
  void pin;
});

// ------------------------------------------ the degradation matrix (F12, SQ-593)

test('every row doc 11 §11.12 defines has a scripted client response', () => {
  // The property SQ-593 exposed the absence of: nothing counted the rows, so a client
  // scripting a subset looked finished. This binds the registry to the spec's own set.
  const doc = readFileSync(DOC11, 'utf8');
  const section = /^## 11\.12 UX degradation matrix[\s\S]*?^---$/m.exec(doc);
  assert.ok(section, 'the §11.12 section moved — re-point this binding');
  const declared = [...section[0].matchAll(/^\*\*E(\d+) /gm)].map((m) => `E${m[1]}`);
  // Fail closed on a thin parse: an empty expectation is satisfied by an empty registry.
  assert.ok(declared.length >= 20, `parsed only ${declared.length} rows: ${declared}`);
  assert.deepEqual([...DEGRADATION_ROWS].sort(), [...declared].sort());
});

test('every response says something, names what it blocks, and states its recovery', () => {
  for (const row of DEGRADATION_ROWS) {
    const response = respondTo(row);
    assert.ok(response.says.length > 20, `${row} says nothing useful`);
    // `blocks` is required even when nothing is blocked, so "blocks nothing" is
    // distinguishable from "nobody wrote down what it blocks".
    assert.ok(response.blocks.length > 0, `${row} does not name what it blocks`);
    assert.ok(
      ['automatic', 'user-action', 'none'].includes(response.recovery),
      `${row} has no recovery classification`,
    );
  }
});

test('the three unrecoverable rows are exactly the ones that cannot be recovered', () => {
  // `recovery: 'none'` is a claim, and a wrong one either overstates the client's power or
  // strands a user who could have acted. These three are the rows where no retry helps: a
  // genesis mismatch is a different chain, a quote disagreement is a contract defect, and
  // an expired checkpoint has lost a guarantee nothing local restores.
  const unrecoverable = DEGRADATION_ROWS.filter((row) => respondTo(row).recovery === 'none');
  assert.deepEqual(unrecoverable.sort(), ['E14', 'E16', 'E20', 'E6'].sort());
});

test('no response promises a repair the client cannot perform', () => {
  // INV-FE-8's habit, applied to copy: divergence is surfaced, never repaired. A response
  // telling a user to "try again" for a condition classified unrecoverable would be the
  // screen contradicting its own classification.
  for (const row of DEGRADATION_ROWS) {
    const response = respondTo(row);
    if (response.recovery !== 'none') continue;
    assert.ok(
      !/try again|retry|refresh the page|reload/i.test(response.says),
      `${row} suggests a retry for a condition it classifies as unrecoverable`,
    );
  }
});

// ----------------------------------------------------- S9/S10 governance (F16)

const REF = (over = {}) => ({
  index: finalized('7'),
  track: finalized('constitution'),
  status: { kind: 'ongoing' },
  tally: { ayes: finalized(100n), nays: finalized(20n), support: finalized(60n) },
  call: { kind: 'decoded', pallet: finalized('Constitution'), call: finalized('set_param') },
  ...over,
});

test('each side of a tally carries its own provenance badge', () => {
  // §11.7.6: "a tally is never shown from provider data". Wrapping the pair in one
  // `Verified` would let a single status stand for both and hide a mismatch between them.
  const mixed = REF({
    tally: {
      ayes: finalized(100n),
      nays: { value: 20n, status: { kind: 'provider', providerId: 'p', sampled: false } },
      support: finalized(60n),
    },
  });
  const html = renderToStaticMarkup(h(ReferendumDetail, { referendum: mixed }));
  assert.ok(html.includes('data-status="verified-finalized"'), html);
  assert.ok(html.includes('data-status="provider"'), 'the provider-served side is not badged');
  assert.ok(/unverified/i.test(html), html);
});

test('the list renders ayes and nays as the different figures they are', () => {
  // Mutation M75 survived without this: the provenance test above only drove
  // `ReferendumDetail`, which renders each side in its own field, so a LIST that showed
  // `ayes` twice passed. A tally where both columns show the same number is the one
  // rendering error a reader cannot detect from the screen.
  const html = renderToStaticMarkup(
    h(ReferendaList, { referenda: [REF()], onOpen: () => {} }),
  );
  assert.ok(html.includes('>100<'), `the ayes are missing: ${html}`);
  assert.ok(html.includes('>20<'), `the nays are missing: ${html}`);
  // And each side is badged, so a provenance mismatch between them is visible here too.
  const badges = html.match(/class="badge badge--/g) ?? [];
  assert.ok(badges.length >= 4, `expected a badge per datum, got ${badges.length}`);
});

test('Confirming states the abort semantics wherever it renders', () => {
  // The countdown is not a countdown, and nothing else on the screen would say so.
  const confirming = REF({ status: { kind: 'confirming', confirmEndsAt: finalized(9_000) } });
  const html = renderToStaticMarkup(h(ReferendumDetail, { referendum: confirming }));
  assert.ok(html.includes(CONFIRM_ABORT_COPY.slice(0, 40)), html);
  assert.ok(/restarts/.test(html), html);
  assert.ok(/earliest/.test(html), 'the end date is presented as certain');
  // And an ongoing referendum does not carry the copy — otherwise it says nothing.
  const ongoing = renderToStaticMarkup(h(ReferendumDetail, { referendum: REF() }));
  assert.ok(!/restarts/.test(ongoing), ongoing);
});

test('an undecodable call cannot be rendered as a call name', () => {
  // The `undecodable` arm has no name field, so there is nothing for a screen to read.
  const undecodable = REF({
    call: { kind: 'undecodable', rawHex: '0xdeadbeef', reason: 'unknown call index 250' },
  });
  const html = renderToStaticMarkup(h(ReferendumDetail, { referendum: undecodable }));
  assert.ok(html.includes('0xdeadbeef'), html);
  assert.ok(/could not decode/.test(html), html);
  assert.ok(!/What it would do/.test(html), 'a call description rendered for undecodable bytes');
});

test('the conviction lock states what a referendum ending does not release', () => {
  const html = renderToStaticMarkup(
    h(ConvictionLock, {
      amount: finalized(5_000_000n),
      decimals: 6,
      symbol: 'VIT',
      conviction: finalized(6),
      unlockAt: finalized(1_500_000),
    }),
  );
  assert.ok(/locked if you sign/.test(html), html);
  assert.ok(/not released by the referendum ending/.test(html), html);
  assert.ok(html.includes('5.000000 VIT'), html);
});

test('the conviction lock refuses to sit behind a disclosure', () => {
  // §11.2 constraint 3 names `conviction-vote-lock`. The content lives in `features/tx`;
  // the placement is enforced by `ui`, and this asserts the two compose as intended.
  const fold = aboveTheFold(
    'conviction-vote-lock',
    h(ConvictionLock, {
      amount: finalized(1n), decimals: 6, symbol: 'VIT',
      conviction: finalized(1), unlockAt: finalized(2),
    }),
  );
  assert.throws(
    () => renderToStaticMarkup(h(Disclosure, { summary: 'details' }, h(AlwaysVisible, { fold }))),
    DeferredMeaningChangingFactError,
  );
});

// ------------------------------------------------- S11 the oracle ballot (F16)

const BALLOT = (power) => ({
  component: finalized('reserve_ratio'),
  epoch: finalized(12),
  rounds: [
    { round: finalized(1), reporter: finalized('5Grw…utQY'), bond: finalized(1_000_000n), evidenceHash: finalized('0xab') },
    { round: finalized(3), reporter: finalized('5Fhi…m3ZP'), bond: finalized(4_000_000n), evidenceHash: finalized('0xcd') },
  ],
  power,
});

test('a weightless vote is warned about before signing, with no number to misread', () => {
  // The failure has no on-chain symptom: the extrinsic succeeds and the stake counts for
  // nothing. Everything about this obligation is pre-sign.
  const html = renderToStaticMarkup(
    h(OracleResolutionBallot, {
      ballot: BALLOT({ kind: 'weightless', lockedAt: finalized(900), snapshotAt: finalized(500) }),
      decimals: 6,
      symbol: 'VIT',
    }),
  );
  assert.ok(/count for nothing/.test(html), html);
  assert.ok(/succeed and change no outcome/.test(html), html);
  assert.ok(html.includes('data-severity="danger"'), html);
  // The arm carries no power field, so there is no zero to render and no figure to misread.
  assert.ok(!/Your weight in this ballot<\/span>/.test(html), 'a weight figure rendered');
});

test('an unestablished snapshot shows no figure at all (R-2, the open [VERIFY])', () => {
  const html = renderToStaticMarkup(
    h(OracleResolutionBallot, {
      ballot: BALLOT({ kind: 'unestablished', reason: 'The snapshot rule is not yet verified.' }),
      decimals: 6,
      symbol: 'VIT',
    }),
  );
  assert.ok(/cannot be established/.test(html), html);
  assert.ok(/would look exactly like one that was checked/.test(html), html);
  assert.ok(html.includes('data-severity="danger"'), html);
  // No amount is rendered anywhere in the power section — a computed figure resting on a
  // guessed mechanism is the confident wrong answer the [VERIFY] tag exists to prevent.
  assert.ok(!/VIT<\/span><span class="badge badge--verified-finalized"[^>]*>finalized #0</.test(html));
});

test('a counted power renders with its snapshot block beside it', () => {
  // The anti-vacuity control: without this, every assertion above passes for the trivial
  // reason that the screen never shows a power.
  const html = renderToStaticMarkup(
    h(OracleResolutionBallot, {
      ballot: BALLOT({ kind: 'counted', power: finalized(2_500_000n), snapshotAt: finalized(500) }),
      decimals: 6,
      symbol: 'VIT',
    }),
  );
  assert.ok(html.includes('2.500000 VIT'), html);
  assert.ok(/snapshot block/.test(html), html);
  assert.ok(!/count for nothing/.test(html), html);
});

test('the ballot always says it is not a routine vote', () => {
  // Rule 4. Unconditional, and there is no prop that could replace it — asserted across
  // every power state so it cannot be conditional on one.
  for (const power of [
    { kind: 'counted', power: finalized(1n), snapshotAt: finalized(1) },
    { kind: 'weightless', lockedAt: finalized(2), snapshotAt: finalized(1) },
    { kind: 'unestablished', reason: 'x' },
  ]) {
    const html = renderToStaticMarkup(
      h(OracleResolutionBallot, { ballot: BALLOT(power), decimals: 6, symbol: 'VIT' }),
    );
    assert.ok(html.includes(BALLOT_NOT_ROUTINE.slice(0, 50)), `${power.kind}: copy missing`);
    assert.ok(/unprofitable/.test(html), `${power.kind}: the reason is missing`);
  }
});

test('the dispute lineage shows every round with its bond', () => {
  const html = renderToStaticMarkup(
    h(OracleResolutionBallot, {
      ballot: BALLOT({ kind: 'counted', power: finalized(1n), snapshotAt: finalized(1) }),
      decimals: 6, symbol: 'VIT',
    }),
  );
  assert.ok(html.includes('1.000000 VIT') && html.includes('4.000000 VIT'), html);
  assert.ok(html.includes('0xab') && html.includes('0xcd'), 'evidence hashes are missing');
});

// ------------------------------------------- §11.7.4 the ratification panel (F16)

const WINDOW = { maturity: finalized(1_000), graceEnd: finalized(2_000), now: finalized(1_500) };
const panelProps = (view) => ({
  view, window: WINDOW, onSubmitReferendum: () => {}, onBindIndex: () => {},
});

test('the guard record alone cannot produce a lifecycle claim', () => {
  // §11.7.4: "NoPassedRecord ... deliberately does not distinguish never submitted,
  // submitted-but-unbound, submitted and ongoing, or submitted and rejected." A caller
  // holding only the guard's record has nothing to pass for `referendum`, so it cannot
  // build the view at all — the rule is a missing argument rather than a thing to recall.
  const noRecord = { kind: 'no-passed-record', referendum: { kind: 'none-submitted' } };
  assert.ok('referendum' in noRecord, 'the arm carries the referendum side');
  const html = renderToStaticMarkup(h(RatificationPanel, panelProps(noRecord)));
  // And it renders as "none submitted", never as "not ratified".
  assert.ok(/No ratification referendum has been submitted/.test(html), html);
  assert.ok(!/not ratified/i.test(html), `the guard record was rendered as a verdict: ${html}`);
});

test('an ongoing referendum is never shown as unratified', () => {
  const ongoing = {
    kind: 'no-passed-record',
    referendum: {
      kind: 'ongoing', index: finalized('9'),
      ayes: finalized(80n), nays: finalized(10n), blocksStillNeeded: finalized(100),
    },
  };
  const html = renderToStaticMarkup(h(RatificationPanel, panelProps(ongoing)));
  assert.ok(/>80</.test(html) && /></.test(html), html);
  assert.ok(!/not ratified|rejected/i.test(html), html);
  assert.ok(!/no longer complete/.test(html), '100 blocks fit in 500 remaining');
});

test('the cannot-complete warning is arithmetic, and only fires when it truly cannot', () => {
  // The warning says the proposal WILL reject. A false positive tells a proposer to
  // abandon something still live, so it fires only when the periods genuinely do not fit.
  const link = (needed) => ({
    kind: 'ongoing', index: finalized('9'),
    ayes: finalized(1n), nays: finalized(0n), blocksStillNeeded: finalized(needed),
  });
  // 500 blocks remain (graceEnd 2000 − now 1500).
  assert.equal(canStillComplete(link(499), WINDOW), true);
  assert.equal(canStillComplete(link(500), WINDOW), true, 'exactly fitting must not warn');
  assert.equal(canStillComplete(link(501), WINDOW), false);

  const html = renderToStaticMarkup(
    h(RatificationPanel, panelProps({ kind: 'no-passed-record', referendum: link(900) })),
  );
  assert.ok(html.includes(CANNOT_COMPLETE), html);
  assert.ok(html.includes('data-severity="danger"'), html);
});

test('a question that was not asked gets no confident answer', () => {
  // None-submitted and already-approved have no remaining-period figure to compare;
  // inventing one would produce a confident answer to a different question.
  assert.equal(canStillComplete({ kind: 'none-submitted' }, WINDOW), undefined);
  assert.equal(canStillComplete({ kind: 'rejected', index: finalized('9') }, WINDOW), undefined);
  assert.equal(
    canStillComplete({ kind: 'approved-not-recorded', index: finalized('9') }, WINDOW),
    undefined,
  );
  for (const referendum of [
    { kind: 'none-submitted' },
    { kind: 'approved-not-recorded', index: finalized('9') },
  ]) {
    const html = renderToStaticMarkup(
      h(RatificationPanel, panelProps({ kind: 'no-passed-record', referendum })),
    );
    assert.ok(!html.includes(CANNOT_COMPLETE), `${referendum.kind} warned about time`);
  }
});

test('the window states blocks, not only a countdown', () => {
  // A countdown alone presents an estimate as the deadline, and on a chain whose blocks
  // slow down that estimate is wrong in the direction that runs out of time.
  const html = renderToStaticMarkup(
    h(RatificationPanel, panelProps({ kind: 'passed', index: finalized('9') })),
  );
  assert.ok(html.includes('#1,000') && html.includes('#2,000'), html);
  assert.ok(/blocks remaining/.test(html), html);
});

test('approved-but-unrecorded is timing, not failure', () => {
  const html = renderToStaticMarkup(
    h(RatificationPanel, panelProps({
      kind: 'no-passed-record',
      referendum: { kind: 'approved-not-recorded', index: finalized('9') },
    })),
  );
  assert.ok(/matter of timing rather than a failure/.test(html), html);
  assert.ok(!html.includes('data-severity="danger"'), html);
});

// ------------------------------------------------- S10's forms (F16, last piece)

const LOCK_FOLD = () =>
  aboveTheFold('conviction-vote-lock', h('p', null, 'locked for 32 enactment periods'));

test('the vote form renders the lock above the fold, and cannot hide it', () => {
  const html = renderToStaticMarkup(
    h(VoteForm, {
      intent: { kind: 'standard', aye: true, balance: 1n },
      conviction: 'Locked6x',
      lock: LOCK_FOLD(),
      onIntentChange: () => {}, onConvictionChange: () => {}, onSubmit: () => {},
    }),
  );
  assert.ok(html.includes('data-fact="conviction-vote-lock"'), html);
  // The prop is `AboveTheFold`, not `ReactNode`, so a caller cannot substitute a plain
  // node — and the whole form refuses to render inside a disclosure.
  assert.throws(
    () =>
      renderToStaticMarkup(
        h(Disclosure, { summary: 'vote' },
          h(VoteForm, {
            intent: { kind: 'standard', aye: true, balance: 1n },
            conviction: 'Locked1x', lock: LOCK_FOLD(),
            onIntentChange: () => {}, onConvictionChange: () => {}, onSubmit: () => {},
          })),
      ),
    DeferredMeaningChangingFactError,
  );
});

test('a split vote disables conviction and says why, in text not only a tooltip', () => {
  // Silently ignoring the choice would tell the user two false things at once: that their
  // tokens are locked, and that their vote weighs more than it does.
  const html = renderToStaticMarkup(
    h(VoteForm, {
      intent: { kind: 'split', aye: 1n, nay: 1n },
      conviction: 'Locked6x', lock: LOCK_FOLD(),
      onIntentChange: () => {}, onConvictionChange: () => {}, onSubmit: () => {},
    }),
  );
  // Asserted on the RENDERED ATTRIBUTE and on ELEMENT TEXT, and the first version of this
  // test was wrong on both counts — mutations M94 and M95 survived it. `/<select[^>]*disabled/`
  // matched `aria-describedby="conviction-disabled"` whether or not the control was
  // disabled, and `html.includes(SPLIT_NO_CONVICTION)` matched the `title` attribute, so
  // deleting the visible paragraph changed nothing. Both are the same shape: an assertion
  // satisfied by a second occurrence elsewhere in the markup.
  assert.ok(/<select[^>]*\sdisabled=""/.test(html), `the selector is enabled on a split vote: ${html}`);
  assert.ok(html.includes(`>${SPLIT_NO_CONVICTION}</p>`), 'the reason is not rendered as text');
  // And a standard vote leaves it enabled, so the control is not vacuously disabled.
  const standard = renderToStaticMarkup(
    h(VoteForm, {
      intent: { kind: 'standard', aye: false, balance: 1n },
      conviction: 'None', lock: LOCK_FOLD(),
      onIntentChange: () => {}, onConvictionChange: () => {}, onSubmit: () => {},
    }),
  );
  assert.ok(!/<select[^>]*\sdisabled=""/.test(standard), standard);
  assert.ok(!standard.includes(SPLIT_NO_CONVICTION), standard);
});

test('the unlock form names the account it acts on', () => {
  // G-5's subject is `recipient`. A form saying only "your tokens" while submitting for a
  // target would describe a different transaction than the one being signed.
  const html = renderToStaticMarkup(
    h(UnlockForm, {
      target: finalized('5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY'),
      locks: [
        { track: finalized('constitution'), amount: finalized(1n), unlocksAt: finalized(900), expired: false },
        { track: finalized('metric'), amount: finalized(2n), unlocksAt: finalized(100), expired: true },
      ],
      onUnlock: () => {},
    }),
  );
  assert.ok(/Unlocking for/.test(html), html);
  assert.ok(html.includes('5Grwva'), 'the target account is not shown');
  // The unexpired one is disabled with a reason; the expired one is not.
  assert.ok(/has not expired yet/.test(html), html);
  const disabled = html.match(/disabled=""/g) ?? [];
  assert.equal(disabled.length, 1, `exactly one lock is unexpired: ${html}`);
});

test('an unlock screen with nothing unlockable says so rather than looking broken', () => {
  const html = renderToStaticMarkup(
    h(UnlockForm, {
      target: finalized('5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY'),
      locks: [{ track: finalized('metric'), amount: finalized(1n), unlocksAt: finalized(900), expired: false }],
      onUnlock: () => {},
    }),
  );
  assert.ok(/Nothing is unlockable yet/.test(html), html);
  assert.ok(/refused by the chain, not by this screen/.test(html), html);
});

test('undelegate is disabled with a reason when not delegating', () => {
  const html = renderToStaticMarkup(
    h(DelegationForm, {
      target: finalized('5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY'),
      conviction: 'Locked2x', lock: LOCK_FOLD(),
      onConvictionChange: () => {}, onSubmit: () => {}, onUndelegate: () => {},
      currentlyDelegating: false,
    }),
  );
  assert.ok(/not currently delegating/.test(html), html);
  assert.ok(html.includes('data-fact="conviction-vote-lock"'), 'the lock is not above the fold');
});

// ------------------------------------------------------ S12/S13 funding (F18)

const DEPOSIT = (over = {}) => ({
  assetHubBalance: finalized(100_000_000n),
  amount: 10_000_000n,
  assetHubFee: 100_000n,
  minBalance: 10_000n,
  bootstrapPhase: false,
  assetHubReady: true,
  xcmHealthy: true,
  ...over,
});

test('Asset Hub finality is never rendered as arrival', () => {
  // XCM delivery is asynchronous. A tracker showing "done" when the AH extrinsic finalized
  // tells a user their money arrived when it has not — and the `credited` arm REQUIRES the
  // futarchy-chain observation, so it cannot be reached from the AH leg alone.
  const sent = { kind: 'sent-awaiting-arrival', assetHubBlock: finalized(500) };
  assert.ok(!('creditedAtLocalBlock' in sent), 'the sent arm must carry no local credit');
  assert.match(progressCopy(sent), /message was sent, not that the funds have arrived/);
  assert.match(progressCopy(sent), /awaiting arrival/i);

  const credited = {
    kind: 'credited', assetHubBlock: finalized(500),
    creditedAtLocalBlock: finalized(900), creditedAmount: finalized(10_000_000n),
  };
  assert.match(progressCopy(credited), /its own finalized state/);
});

test('the bootstrap caps read a bit, and an unreadable cap blocks (V-115, D-13)', () => {
  // The spec said "while PhaseFlags < Phase 4", which is unperformable on a bitset and
  // would have SKIPPED the caps entirely during bootstrap. Repaired; here the flag is a
  // boolean the caller derives from bit 4.
  const noCaps = depositBlocks(DEPOSIT({ bootstrapPhase: true }));
  assert.ok(noCaps.some((b) => /exposure caps/i.test(b.check)), JSON.stringify(noCaps));
  assert.match(noCaps[0].detail, /blocked rather than proceeding without the limit/);

  const overGlobal = depositBlocks(DEPOSIT({
    bootstrapPhase: true,
    caps: { globalTvlHeadroom: finalized(1_000n), perAccountHeadroom: finalized(999_000_000n) },
  }));
  assert.ok(overGlobal.some((b) => b.check === 'Global TVL cap'));

  // Outside bootstrap the caps do not apply at all — so the control is not vacuous.
  assert.deepEqual(depositBlocks(DEPOSIT({ bootstrapPhase: false })), []);
});

test('every block is reported, not just the first', () => {
  // A user told to fix one thing who then hits the next learns the screen is guessing.
  const blocks = depositBlocks(DEPOSIT({
    assetHubReady: false, amount: 1n, assetHubBalance: finalized(0n),
  }));
  assert.ok(blocks.length >= 3, JSON.stringify(blocks.map((b) => b.check)));
});

test('degraded XCM health warns and does not block', () => {
  // I-24 is fail-static: the funds are held, not lost. Blocking would refuse what the chain
  // accepts, which 15 §4.8's mirror rule forbids.
  assert.deepEqual(depositBlocks(DEPOSIT({ xcmHealthy: false })), []);
  assert.match(xcmWarning({ xcmHealthy: false }), /held, not lost/);
  assert.equal(xcmWarning({ xcmHealthy: true }), undefined);
});

test('a withdrawal that would dust the remainder is blocked, but a full one is not', () => {
  const base = {
    freeBalance: finalized(1_000_000n), localFee: 1_000n, minBalance: 10_000n,
    destinationViable: true, ledgerFrozen: false,
  };
  // Leaves 5,000 — below the 10,000 minimum.
  assert.ok(withdrawBlocks({ ...base, amount: 994_000n }).some((b) => /dusted/.test(b.check)));
  // Leaves exactly zero: a full withdrawal, which is fine. The check is a band, not a floor.
  assert.deepEqual(withdrawBlocks({ ...base, amount: 999_000n }), []);
  // Leaves 20,000 — comfortably above.
  assert.deepEqual(withdrawBlocks({ ...base, amount: 979_000n }), []);
});

test('an unknown destination is distinct from a bad one and from a good one', () => {
  // "Degrades to a warning, never silently skipped": collapsing unknown into either of the
  // other two is exactly what silently skipped means.
  assert.equal(destinationWarning(true), undefined);
  assert.match(destinationWarning(false), /would not survive/);
  assert.match(destinationWarning(undefined), /has not been established either way/);
});

// -------------------------------------------------- S17 the upgrade crank (F17)

const AUTHORIZED = {
  codeHash: finalized('0xaaaa'),
  applicableAt: finalized(5_000),
};

test('a mismatched artifact hard-blocks and never becomes a submission', () => {
  // §11.8.4 step 3: "a mismatch hard-blocks with FE-UPG-001 and never reaches the wallet."
  // It throws rather than returning a result, because a refusal a caller can ignore is not
  // a hard block — and this is the most consequential signature the client can produce.
  assert.throws(
    () => verifyArtifact(new Uint8Array([1, 2, 3]), AUTHORIZED, () => '0xbbbb'),
    (error) => {
      assert.equal(error.code, 'FE-UPG-001');
      assert.match(error.message, /hard block/);
      assert.match(error.message, /no gateway is retried into acceptance/);
      return true;
    },
  );
});

test('a matching artifact verifies, and the brand stays phantom', () => {
  const artifact = verifyArtifact(new Uint8Array(4_194_304), AUTHORIZED, () => '0xaaaa');
  assert.equal(artifact.hash, '0xaaaa');
  assert.equal(artifact.byteLength, 4_194_304);
  assert.deepEqual(
    Object.keys(artifact).sort(),
    ['byteLength', 'hash'],
    'the brand materialised at runtime — it must stay phantom and uncopyable',
  );
});

test('applicable_at is read, and no lead-time arithmetic exists in the module', () => {
  // SQ-552: `DescriptorLeadTime` was once recomputed client-side against a clock the call
  // itself starts. §11.8.4 says read the stored field. A reader can confirm the absence.
  assert.equal(isApplicable(AUTHORIZED, finalized(4_999)), false);
  assert.equal(isApplicable(AUTHORIZED, finalized(5_000)), true);
  const source = readFileSync(
    join(REPO, 'app/src/features/tx/src/upgrade-crank.ts'),
    'utf8',
  );
  assert.ok(
    !/DescriptorLeadTime|authorized_at\s*\+|leadTime/i.test(source.replace(/\/\*[\s\S]*?\*\//g, '')),
    'lead-time arithmetic reappeared in the upgrade crank',
  );
});

test('the submission outlook states uncertainty rather than predicting success', () => {
  // FE-P10 is unresolved. A screen that implied a 4 MiB extrinsic will go through would be
  // asserting the very thing the prototype gate exists to find out.
  const artifact = verifyArtifact(new Uint8Array(4_194_304), AUTHORIZED, () => '0xaaaa');
  const outlook = submissionOutlook(artifact);
  assert.match(outlook, /has not been established/);
  assert.match(outlook, /FE-P10/);
  assert.match(outlook, /4\.0 MiB/);
  // And it says the verification is not wasted if submission fails.
  assert.match(outlook, /already verified/);
});

// ------------------------------------------ the composition root (F7's outlet closed)

test('every inventory screen is either implemented or declared pending, never neither', () => {
  // The failure this prevents: a screen absent from both maps renders as pending with no
  // owner named, which reads as "coming soon" forever and is exactly how a dropped screen
  // hides. S1 is excluded because it renders as the shell's own header, not through the
  // outlet.
  assert.deepEqual(unaccountedScreens(), []);
});

test('nothing is registered that is also declared pending', () => {
  // The other direction: a screen in both maps would render for real while the client still
  // claims it is not built, and the PLAN row that owns it would never close.
  const implemented = Object.keys(implementedScreens());
  for (const id of implemented) {
    assert.ok(!(id in PENDING_SCREENS), `${id} is both implemented and declared pending`);
    assert.ok(INVENTORY_IDS.includes(id) || id === 'confirm', `${id} is not a real screen`);
  }
});

test('an unregistered screen renders as pending rather than blank', () => {
  // The composition root being empty must not produce a blank app — the outlet's placeholder
  // is what makes an unbuilt screen say so.
  const html = renderToStaticMarkup(
    h(Outlet, { hash: '#/referenda', handoffEnabled: true, implemented: implementedScreens() }),
  );
  assert.ok(/not in this build/.test(html), html);
  assert.ok(/F16/.test(html), 'the owning milestone is not named');
});

// --------------------------------------------------- S15 the guardian console (F17)

const ACTION = (over = {}) => ({
  actionId: finalized('a1'), power: finalized('activate_playbook'),
  justificationHash: finalized('0xjh'), approvals: finalized(3),
  threshold: finalized(5), expiresAt: finalized(9_000), ...over,
});

test('an unread trigger is treated exactly as an inactive one', () => {
  // E20: playbooks are admissible only under VERIFIED triggers. Collapsing "could not
  // check" into "checked and fine" is the fail-open reading, on the one power whose whole
  // justification is that the condition holds right now.
  assert.equal(mayActivatePlaybook({ kind: 'active', since: finalized(1) }), true);
  assert.equal(mayActivatePlaybook({ kind: 'inactive' }), false);
  assert.equal(mayActivatePlaybook({ kind: 'unread', reason: 'the storage read failed' }), false);
  // And the two refusals say different things, because the guardian's next step differs.
  assert.match(triggerRefusal({ kind: 'inactive' }), /the condition being absent/);
  assert.match(
    triggerRefusal({ kind: 'unread', reason: 'the storage read failed' }),
    /could not establish/,
  );
  assert.equal(triggerRefusal({ kind: 'active', since: finalized(1) }), undefined);
});

test('approving twice is its own refusal, not "not eligible"', () => {
  // A guardian who approves again believes they moved the count. Folding this into a
  // generic refusal leaves them unable to tell whether the action is stuck or they are.
  const blocks = approvalBlocks({
    action: ACTION(), callerIsMember: true, callerHasApproved: true, now: finalized(100),
  });
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].check, 'Already approved');
  assert.match(blocks[0].detail, /does not add to the count/);
});

test('every approval blocker is reported together', () => {
  const blocks = approvalBlocks({
    action: ACTION({ expiresAt: finalized(10) }),
    callerIsMember: false, callerHasApproved: true, now: finalized(100),
  });
  assert.deepEqual(blocks.map((b) => b.check).sort(), ['Already approved', 'Expiry', 'Membership']);
  // And a clean context blocks nothing, so the checks are not vacuously firing.
  assert.deepEqual(
    approvalBlocks({ action: ACTION(), callerIsMember: true, callerHasApproved: false, now: finalized(100) }),
    [],
  );
});

test('an overrun allowance reads as zero remaining, never as negative headroom', () => {
  // A negative would be treated as headroom by any arithmetic downstream.
  assert.equal(allowanceRemaining({ power: 'delay_once', used: finalized(3), limit: finalized(5) }), 2);
  assert.equal(allowanceRemaining({ power: 'delay_once', used: finalized(9), limit: finalized(5) }), 0);
});

test('the unratified-action consequence names the guardian own bond', () => {
  // §11.8.2's ratification tracker. It is a fact about their money, not about protocol
  // hygiene, and it applies whether or not the action turns out to have been correct.
  assert.match(UNRATIFIED_CONSEQUENCE, /half your bond is slashed/);
  assert.match(UNRATIFIED_CONSEQUENCE, /recalled/);
  assert.match(UNRATIFIED_CONSEQUENCE, /whether or not the action turns out to have been correct/);
});

test('a proposal is blocked by allowance and by trigger independently', () => {
  const meter = { power: 'activate_playbook', used: finalized(0), limit: finalized(2) };
  assert.deepEqual(proposalBlocks(meter, { kind: 'active', since: finalized(1) }), []);
  assert.deepEqual(
    proposalBlocks({ ...meter, used: finalized(2) }, { kind: 'active', since: finalized(1) })
      .map((b) => b.check),
    ['Allowance'],
  );
  assert.deepEqual(
    proposalBlocks(meter, { kind: 'unread', reason: 'x' }).map((b) => b.check),
    ['Trigger condition'],
  );
  // A power with no trigger passes none, and is not blocked for lacking one.
  assert.deepEqual(proposalBlocks({ ...meter, power: 'pause_intake' }, undefined), []);
});

// ------------------------------------------------ S16 treasury streams (F17)

const STREAM = (over = {}) => ({
  id: finalized('s1'), recipient: finalized('5Grw'),
  total: finalized(1_000_000n), claimed: finalized(0n),
  startBlock: finalized(100), endBlock: finalized(1_100),
  cancelled: finalized(false), ...over,
});

test('vesting floors against the claimant, and the last unit is not invented', () => {
  // R-7's rounding rule. `total * elapsed / span` on bigint — a float would round a
  // recipient's last unit into or out of existence.
  assert.equal(claimableNow(STREAM(), finalized(600)).amount, 500_000n);
  // 1 block into a 1000-block stream of 1,000,000 vests exactly 1,000.
  assert.equal(claimableNow(STREAM(), finalized(101)).amount, 1_000n);
  // A total that does not divide evenly floors rather than rounding up.
  assert.equal(claimableNow(STREAM({ total: finalized(999n) }), finalized(101)).amount, 0n);
});

test('not-started and fully-claimed are different zeros', () => {
  // A screen showing a bare zero for both tells a recipient the wrong thing to do.
  assert.deepEqual(claimableNow(STREAM(), finalized(50)), { amount: 0n, reason: 'not-started' });
  assert.deepEqual(
    claimableNow(STREAM({ claimed: finalized(1_000_000n) }), finalized(2_000)),
    { amount: 0n, reason: 'fully-claimed' },
  );
  assert.equal(claimableNow(STREAM({ cancelled: finalized(true) }), finalized(600)).reason, 'cancelled');
});

test('a stream whose end is not after its start is refused, not divided by', () => {
  // Returning the whole total — the "treat it as instant" reading — would credit a
  // recipient everything from malformed chain state.
  const bad = claimableNow(STREAM({ startBlock: finalized(500), endBlock: finalized(500) }), finalized(900));
  assert.deepEqual(bad, { amount: 0n, reason: 'malformed' });
  const blocks = claimBlocks({
    stream: STREAM({ startBlock: finalized(500), endBlock: finalized(500) }),
    callerIsRecipient: true, now: finalized(900),
  });
  assert.match(blocks[0].detail, /no vesting schedule can be derived/);
});

test('vesting stops at the end block rather than continuing past it', () => {
  assert.equal(claimableNow(STREAM(), finalized(1_100)).amount, 1_000_000n);
  assert.equal(claimableNow(STREAM(), finalized(99_999)).amount, 1_000_000n);
});

test('INSURANCE is classified against its target, never shown as a bare trend', () => {
  // E1: a rising INSURANCE balance is not protocol income. The screen gets a
  // classification, not a number a component could plot as earnings.
  assert.deepEqual(insuranceStanding(finalized(100n), finalized(100n)), { kind: 'at-target' });
  assert.deepEqual(
    insuranceStanding(finalized(60n), finalized(100n)),
    { kind: 'below-target', shortfall: 40n },
  );
  assert.deepEqual(
    insuranceStanding(finalized(140n), finalized(100n)),
    { kind: 'awaiting-overflow', excess: 40n },
  );
});

test('an above-target INSURANCE says it is not income and not a surplus', () => {
  const copy = insuranceCopy({ kind: 'awaiting-overflow', excess: 40n });
  assert.match(copy, /not protocol income/);
  assert.match(copy, /not a surplus/);
  assert.match(copy, /revenue routes entirely to MAIN/);
  // And the below-target copy says where it refills from, which is not revenue either.
  assert.match(insuranceCopy({ kind: 'below-target', shortfall: 1n }), /not funded from revenue/);
});

test('only the recipient may claim, and both blocks report together', () => {
  const blocks = claimBlocks({
    stream: STREAM({ cancelled: finalized(true) }), callerIsRecipient: false, now: finalized(600),
  });
  assert.deepEqual(blocks.map((b) => b.check), ['Recipient', 'Claimable amount']);
  assert.deepEqual(
    claimBlocks({ stream: STREAM(), callerIsRecipient: true, now: finalized(600) }),
    [],
  );
});

// ------------------------------- S18/S19 the snapshot crank and registry (F17)

test('a crank that would do nothing says so before it costs a fee', () => {
  // §11.5 row P-15: "never sign a guaranteed no-op without an explicit expert override".
  // The part a user cannot see is that the button looks identical either way.
  const notYet = snapshotCrankState(finalized(7), false, false);
  assert.equal(notYet.kind, 'no-op');
  assert.match(noOpWarning(notYet), /pay a fee and change nothing/);

  const done = snapshotCrankState(finalized(7), true, true);
  assert.equal(done.reason, 'already-taken');
  assert.match(noOpWarning(done), /already been taken/);

  // Ready is distinct, and carries no warning — so the control is not vacuously warning.
  const ready = snapshotCrankState(finalized(7), true, false);
  assert.equal(ready.kind, 'ready');
  assert.equal(noOpWarning(ready), undefined);
});

test('the registry copy says a challenge cannot stall a decision', () => {
  // The natural reading of "a challenge is open" is that governance is paused. It is not,
  // and believing otherwise credits an incident filing with leverage the design withholds.
  assert.match(REGISTRY_HOLDS_SETTLEMENT, /holds the settlement/);
  assert.match(REGISTRY_HOLDS_SETTLEMENT, /does not pause a governance decision/);
  assert.match(REGISTRY_HOLDS_SETTLEMENT, /cannot stall a decision/);
});

test('an unread watchtower extension makes the deadline indeterminate, not the base window', () => {
  // A countdown that ignored an extension tells a challenger they are out of time when
  // they are not — losing them exactly the window the extension exists to grant.
  const unknown = { kind: 'indeterminate', reason: 'the storage read failed' };
  assert.equal(mayChallenge(unknown), false);
  assert.match(challengeWindowCopy(unknown), /not assuming the base window/);
  assert.match(challengeWindowCopy(unknown), /out of time when you are not/);

  assert.equal(mayChallenge({ kind: 'open', closesAt: finalized(9_000), extended: true }), true);
  assert.match(
    challengeWindowCopy({ kind: 'open', closesAt: finalized(9_000), extended: true }),
    /extended by watchtower quorum/,
  );
  assert.equal(mayChallenge({ kind: 'closed', closedAt: finalized(100) }), false);
});
