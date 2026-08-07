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
  EpochHeader,
  Outlet,
  PENDING_SCREENS,
  pendingCopy,
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
import type {
  ScreenArea,
  ShellChainState,
  ShellDecoders,
  ShellStateReader,
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
  UNCHECKABLE_REGISTRATION_CONDITIONS,
  approvalBlocks,
  checkRegistration,
  registrationCaveat,
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
  ApproveAction,
  ProposeAction,
  PendingActions,
  RegisterReporter,
  SnapshotCrank,
  RegistryFiling,
  InsurancePanel,
  TreasuryStreams,
  UpgradeCrank,
  UpgradeHashMismatch,
  UpgradeHashMismatchError,
  snapshotStaleness,
  admitEvidence,
  evidenceUnavailable,
  EvidencePanel,
  EVIDENCE_UNRETRIEVABLE,
  NavPanel,
  HAIRCUT_BANNER,
  PARTIAL_CUSTODY_NOTE,
  FLOOR_CLASSES,
  accountLines,
  floorDistances,
  incomeLabel,
  navPresentation,
  admitRegistryWindowEvent,
  challengeBlocks,
  escalationConsequence,
  filingBlocks,
  reportBlocks,
  reportBondFloor,
  ChallengeRound,
  ProofRefused,
  RecomputeProof,
  SubmitReport,
  RegistryInstanceCollisionError,
  REPORT_BOND_NOT_ESTABLISHED,
  recomputeProof,
  maySubmitRecompute,
  ProofMismatchError,
  NonDeterministicComponentError,
  DepositForm,
  DepositTracker,
  WithdrawForm,
  EmptyArtifactError,
  INSURANCE_TARGET_UNREADABLE,
  POWER_FIELDS,
  RatificationTracker,
  P13_CHECK_KEYS,
  RegistryFilingForm,
  STAKE_HOLD_CONSEQUENCE,
  UnimplementedClauseError,
  challengeFilingBlocks,
  feeHeadroomBlock,
  leadTimeCountdown,
  operatorGate,
  operatorSubmit,
  progressLine,
  proposeFormBlocks,
  ratificationCopy,
  p13Predicate,
  ratificationFor,
  upgradeFeeHeadroom,
} from '@bleavit/features-tx';
import type { DecisionStats } from '@bleavit/features-tx';
import {
  ClampProvenanceMismatchError,
  ImportRefused,
  ImportReview,
  UnlabellableClampError,
} from '@bleavit/features-handoff';
import type { ImportReviewProps, ReviewedClamp, ReviewedLimits } from '@bleavit/features-handoff';
import { ShareContext } from '@bleavit/features-handoff';
import {
  AlwaysVisible,
  DeferredMeaningChangingFactError,
  Disclosure,
  Undecodable,
  aboveTheFold,
} from '@bleavit/ui';
import type { HexString, Combined, Verified } from '@bleavit/shared-types';
import type { FinalizedBlockRef } from '@bleavit/chain-client';
// `finalize` is test-only on purpose — see packages/chain-client/src/testing.ts.
import { finalize } from '@bleavit/chain-client/testing';
import {
  OPERATOR_SURFACE_ROWS,
  declaredCoverageIds,
  gate,
  rowsFor,
} from '@bleavit/transaction-builder';
import type {
  ClauseId,
  DeclarableRowId,
  GatePassed,
  PreconditionResult,
  TxPreparation,
  TxSession,
  TxState,
} from '@bleavit/transaction-builder';
import type {
  AllowanceMeter,
  ChallengeWindow,
  DepositProgress,
  ProposalSummary,
  ApprovalContext,
  ApprovedCall,
  EffectivePower,
  ReferendumLink,
  AuthorizedUpgrade,
  DepositInputs,
  ExecutionWindow,
  NavView,
  OracleBallot,
  PendingAction,
  ProposalsReader,
  RatificationView,
  RawDecoded,
  RawEvent,
  RecomputeInputs,
  Referendum,
  RegistrationInputs,
  ChallengeInputs,
  OracleRound,
  RegistryInstances,
  ReportBlock,
  ReportInputs,
  Stream,
  ArtifactSource,
  ChallengeFilingInputs,
  EvidenceState,
  FetchProgress,
  FilingInputs,
  InsuranceTarget,
  RatificationEvent,
  ReviewReferendum,
  StreamingHasher,

  UpgradeFeeInputs,
} from '@bleavit/features-tx';
import { defaultScope } from '@bleavit/contexts';
import { refuse } from '@bleavit/handoff-envelope';
import type { Clamped, Intent } from '@bleavit/intents';
import { classifyCheckpointAge } from '@bleavit/verify';
import type { VerificationPanel } from '@bleavit/verify';
import type { Fixture } from '@bleavit/mock-runtime';

/** The chain identity every verified fixture in this file is read against (F18).
 *  A named constant rather than a literal per site: the point of the field is that two
 *  reads agree on it, and copies of a hex string agree until one is edited. */
const TEST_CHAIN = `0x${'ce'.repeat(32)}` as HexString;


const REPO = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const DOC11 = join(REPO, 'docs/architecture/11-frontend-workflows.md');

// `Verified<T>` deliberately has no brand — screens display it, they do not authorise on
// it, and 10 §2.1 puts the brand on `Finalized<T>` for the transaction path alone. So a
// plain object is the right fixture here; the annotation is what keeps `kind` and
// `blockHash` from widening to `string` and the status from matching nothing.
const finalized = <T>(value: T, blockNumber = 1_000_000): Verified<T> => ({
  value,
  status: { kind: 'verified-finalized', chain: TEST_CHAIN, blockHash: '0xdead', blockNumber },
});
const AT: FinalizedBlockRef = { chain: TEST_CHAIN, blockHash: '0xdead', blockNumber: 1_000_000 };
/**
 * Whether a labelled button is really disabled.
 *
 * `/disabled/` is NOT the test: React renders the enabled case as `aria-disabled="false"`,
 * which contains the substring, so a bare match passes on an enabled button and asserts
 * nothing. The boolean attribute is `disabled=""`; that is what a browser honours and what
 * this looks for.
 */
const buttonDisabled = (html: string, label: string): boolean => {
  const tag = new RegExp(`<button[^>]*>${label}</button>`).exec(html);
  assert.ok(tag !== null, `no button labelled "${label}" in:\n${html}`);
  return / disabled=""/.test(tag[0]);
};

/** Unwrap a `Combined<T>` that must be statable — asserting rather than optional-chaining. */
/**
 * The block a leaf was read at, or a throw naming the status that carries none.
 *
 * `VerificationStatus` is a union and only two of its six arms have a block — which is the
 * point of `assertOnePin`, so a helper that optional-chained past it would soften exactly
 * what the shell must refuse.
 */
const pinOf = (leaf: Verified<unknown>): FinalizedBlockRef => {
  const { status } = leaf;
  assert.ok(
    status.kind === 'verified-finalized' || status.kind === 'verified-best',
    `a shell leaf carries ${status.kind}, which names no block`,
  );
  return { chain: TEST_CHAIN, blockHash: status.blockHash, blockNumber: status.blockNumber };
};

const stated = <T,>(combined: Combined<T>): T => {
  assert.equal(combined.kind, 'stated', combined.kind === 'incomparable' ? combined.reason : '');
  return combined.datum.value;
};

/**
 * Copy a function was expected to produce, or a throw.
 *
 * These helpers return `string | undefined` on purpose — `undefined` means *no warning*,
 * and the tests below are about the arms that must warn. Asserting through this rather
 * than `!` keeps the finding "it said nothing" instead of a match against `undefined`.
 */
const copy = (text: string | undefined, what = 'copy'): string => {
  assert.ok(text, `expected ${what}; got nothing, which renders as no warning at all`);
  return text;
};

/** The nth element of a result array, or a throw naming how many there really were. */
/**
 * Source with comments removed, for the tests that assert code by its **absence**.
 *
 * A raw-text scan reports the prose explaining why a thing is absent as the thing itself —
 * the same tokenizer hole every version of `check:chain-literals` had to close.
 */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const nth = <T,>(items: readonly T[], index: number, what: string): T => {
  const item = items.at(index);
  if (item === undefined) throw new Error(`expected a ${what} at ${index}; there are ${items.length}`);
  return item;
};

/** A regex capture group that must have matched, or a throw naming the pattern. */
const captured = (match: RegExpExecArray | null, group: number, what: string): string => {
  assert.ok(match, `${what} did not match — this binding must be re-pointed`);
  const value = match[group];
  assert.ok(value !== undefined, `${what} matched but capture ${group} is empty`);
  return value;
};

// ------------------------------------------------------- the screen inventory

test('every screen doc 11 §11.2 lists is present in the client', () => {
  const doc = readFileSync(DOC11, 'utf8');
  const table = /^## 11\.2 Screen inventory$([\s\S]*?)^USDC balance reads/m.exec(doc);
  const body = captured(table, 1, 'the §11.2 inventory table');
  const declared = [...body.matchAll(/^\| (S\d+) \|/gm)].map((match) => match[1]);
  // Fail closed on a parse that found nothing: an empty expectation is satisfied by an
  // empty client, which is precisely the state constraint 1 forbids.
  assert.ok(declared.length >= 20, `parsed only ${declared.length} rows out of doc 11`);
  assert.deepEqual([...INVENTORY_IDS].sort(), [...declared].sort());
});

test('the areas match doc 11 row for row, since placement is derived from them', () => {
  const doc = readFileSync(DOC11, 'utf8');
  const table = /^## 11\.2 Screen inventory$([\s\S]*?)^USDC balance reads/m.exec(doc);
  const body = captured(table, 1, 'the §11.2 inventory table');
  const declared = new Map(
    [...body.matchAll(/^\| (S\d+) \| [^|]+ \| ([^|]+) \|/gm)].map((match) => [
      match[1],
      (match[2] ?? '').trim().replace(/\*\*/g, ''),
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
  for (const area of ['core', 'FE-14', 'FE-15', 'funding'] as const satisfies readonly ScreenArea[]) {
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
  const assignments = captured(sentence, 1, 'the §7.3 bit-assignment sentence');
  const declared = Object.fromEntries(
    assignments.split(',').map((part) => {
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

const shellChain = (phase?: number): ShellChainState => ({
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

/**
 * A whole `DecisionStats` model, every leaf badged by the caller's `finalized`.
 *
 * A helper because 02 §4's view has fourteen fields, and a per-test literal is a place for
 * one of them to be dropped without any assertion noticing.
 */
function decisionStats(overrides: Partial<DecisionStats> = {}): DecisionStats {
  return {
    twapAccept1e9: finalized(562_000_000n),
    twapReject1e9: finalized(521_000_000n),
    twapBaseline1e9: finalized(523_000_000n),
    rEff1e9: finalized(521_000_000n),
    trailingAccept1e9: finalized(562_000_000n),
    trailingReject1e9: finalized(522_200_000n),
    uplift1e9: finalized(41_000_000n),
    coveragePct: finalized(97),
    tradedVolume: finalized(1_000_000n),
    vMinRequired: finalized(500_000n),
    converged: finalized(true),
    gates: {
      present: true,
      survivalAdopt1e9: finalized(11_000_000n),
      survivalReject1e9: finalized(9_000_000n),
      securityAdopt1e9: finalized(17_000_000n),
      securityReject1e9: finalized(15_000_000n),
    },
    attackCostHat: finalized(9_000_000n),
    inCapPrize: finalized(1_000_000n),
    ...overrides,
  };
}

test('a proposal still trading has nowhere to put decision statistics', () => {
  const summary = {
    id: finalized('42'),
    payloadHash: finalized(`0x${'ab'.repeat(32)}`),
    klass: finalized('TREASURY'),
    state: finalized('Trading'),
  };
  const html = renderToStaticMarkup(
    h(ProposalDetail, {
      view: { stage: 'pre-decision', summary, reason: 'trading' },
      decimals: 6,
      symbol: 'USDC',
    }),
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
          payloadHash: finalized(`0x${'ab'.repeat(32)}`),
          klass: finalized('TREASURY'),
          state: finalized('Settled'),
        },
        decisionStats: decisionStats(),
      },
      decimals: 6,
      symbol: 'USDC',
    }),
  );
  // The 1e9 grid, rendered on its own grid — `0.562000000`, not a percentage and not ppm.
  assert.ok(html.includes('0.562000000'), html);
  // The derived uplift, `twap_accept − r_eff`.
  assert.ok(html.includes('0.041000000'), html);
  // A balance is a balance: USDC base units at six decimals, with its symbol.
  assert.ok(html.includes('1.000000 USDC'), html);
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

const PREP: TxPreparation = {
  scaleHex: '0x0a0b0c0d',
  builtFor: { specVersion: 2, metadataHash: '0xfeed' },
  preparedAt: AT,
  requires: ['P-1'],
  feeAsset: 'USDC',
};

/**
 * Every obligation a row imposes under this fixture's fee asset.
 *
 * A row is a set of clauses, and the gate demands a result per clause: one result naming
 * `O-1` used to satisfy all five of its obligations, so the registry read alone could mint a
 * signing window for a 100,000-USDC stake nobody had checked the balance for. Fixtures
 * therefore build complete sets rather than a token row.
 */
const coverageOf = (row: DeclarableRowId): readonly ClauseId[] =>
  declaredCoverageIds(row, PREP.feeAsset);

/** One obligation of a row, where a fixture needs an id rather than the set. */
const firstCoverage = (row: DeclarableRowId): ClauseId => {
  const [id] = coverageOf(row);
  assert.ok(id, `${row} declares no obligations`);
  return id;
};

const DECODER = (): RawDecoded => ({
  pallet: 'Market',
  call: 'buy',
  args: [{ name: 'max_cost', typeName: 'u128', display: '9.500000 USDC' }],
});

const PASSING_ROW: PreconditionResult = {
  id: firstCoverage('P-1'),
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
        { ...PASSING_ROW, id: firstCoverage('P-2'), ok: false, expected: 'Open', actual: 'Closed' },
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
          { summary: 'Transaction', children: null },
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

const INTENT: Intent = {
  schema: 'bleavit.intent.v1',
  binding: { genesisHash: '0x91b1', specVersion: 2, contractVersion: 27 },
  action: { kind: 'prepare_pass_position', id: 42n, collateral: 10_000_000n },
  limits: { maxCost: 10_000_000n },
  // Integrity only — `Intent.digest` authenticates nothing (10 §13.1), and nothing on
  // these screens may read it as provenance. Present because admission produced it.
  digest: 'a'.repeat(64),
};

const reviewProps = (
  limits: ReviewedLimits,
  extra: Partial<ImportReviewProps> = {},
): ImportReviewProps => ({
  intent: INTENT,
  limits,
  resolvedTarget: finalized('Proposal 42 — “Fund the thing” (TREASURY, Trading)'),
  decimals: 6,
  symbol: 'USDC',
  expert: false,
  onBuild: () => {},
  onDiscard: () => {},
  ...extra,
});

const MAX_COST: Clamped<bigint> = {
  asked: 10_000_000n,
  chain: 9_500_000n,
  encoded: 9_500_000n,
  boundBy: 'chain',
  narrowed: true,
};

/**
 * Pair a clamp with the provenance of the client's own number in it.
 *
 * There is no `refreshedAt` prop any more. The screen used to take B′ as a bare
 * `FinalizedBlockRef` beside `Clamped<bigint>` and assemble a `verified-finalized` status out
 * of the two, which meant the badge was manufactured on the render path from arguments
 * nothing related. The datum now carries its own status and the screen passes it through.
 */
const reviewed = (clamped: Clamped<bigint>): ReviewedClamp => ({
  clamped,
  chain: finalized(clamped.chain),
});

const CLAMPED: ReviewedLimits = {
  maxCost: reviewed(MAX_COST),
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
        maxCost: reviewed({
          ...MAX_COST,
          encoded: 9_000_000n,
          chain: 9_500_000n,
          boundBy: 'intent',
          asked: 9_000_000n,
        }),
      }),
    ),
  );
  const askedBound = /will be encoded<\/span><span class="datum__value">[^<]*<\/span><span class="badge badge--(\w[\w-]*)"/.exec(
    intentBound,
  );
  assert.ok(askedBound, intentBound);
  assert.equal(askedBound[1], 'external-proposal');
});

test('the chain-bound badge is the READ’s, not one the screen assembled', () => {
  // The provenance now travels on the datum, so the badge the screen renders is the one the
  // read carried. Asserting the *block number* is what makes that visible: a screen that
  // still minted its own status would show whichever pin it was handed, and before this
  // change there was a separate `refreshedAt` prop for exactly that.
  const html = renderToStaticMarkup(
    h(
      ImportReview,
      reviewProps({
        ...CLAMPED,
        maxCost: { clamped: MAX_COST, chain: finalized(MAX_COST.chain, 777_777) },
      }),
    ),
  );
  assert.ok(/data-block="777777"/.test(html) || html.includes('777777'), html);
});

test('a clamp whose datum is not its own chain number is refused', () => {
  // The pairing is what carries the provenance. A datum holding some other number is a badge
  // belonging to a different read, and rendering it puts a block reference beside a figure
  // that block never described.
  assert.throws(
    () =>
      renderToStaticMarkup(
        h(
          ImportReview,
          reviewProps({
            ...CLAMPED,
            maxCost: { clamped: MAX_COST, chain: finalized(1n) },
          }),
        ),
      ),
    ClampProvenanceMismatchError,
  );
});

test('a policy-bound clamp refuses rather than wearing a status that misdescribes it', () => {
  assert.throws(
    () =>
      renderToStaticMarkup(
        h(
          ImportReview,
          reviewProps({
            ...CLAMPED,
            maxCost: reviewed({ ...MAX_COST, boundBy: 'policy' }),
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
    assert.ok(!/checked/.test(nth(box, 1, 'capture')), `${account} is on by default`);
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

/**
 * A `FinalizedReader`-shaped double: one pin, and storage answers it was given.
 *
 * Typed as `ShellStateReader` — the structural port `readShellState` declares — rather
 * than the `FinalizedReader` class, which is nominal because of its `#private` fields.
 * A double satisfying the whole class is impossible, and a suite driving the real reader
 * would depend on the transport, the codecs and a recorded transcript, so a defect in any
 * of those would make it agree rather than catch.
 */
function readerDouble(pin: FinalizedBlockRef, values: Record<string, string>): ShellStateReader {
  return {
    at: pin,
    async storage(key: string) {
      const raw = values[key];
      return finalize(raw === undefined ? [] : [{ key, value: raw }], pin);
    },
  };
}

const DECODERS_OK: ShellDecoders = {
  epochOf: () => ({ ok: true, value: { epoch: 7, phase: 'Trade' } }),
  phaseFlags: () => ({ ok: true, value: 4 }),
};

test('every leaf of the shell model comes from the reader’s one pinned block', async () => {
  const pin: FinalizedBlockRef = { chain: TEST_CHAIN, blockHash: '0xbeef', blockNumber: 42 };
  const reader = readerDouble(pin, { [SHELL_READS.epochOf]: '0x01', [SHELL_READS.phaseFlags]: '0x04' });
  const { state, undecodable } = await readShellState(reader, DECODERS_OK);
  assert.deepEqual(undecodable, []);
  const leaves = [state.epoch, state.phaseLabel, state.finalizedHeight, state.phaseFlags];
  for (const leaf of leaves) {
    assert.ok(leaf, 'a shell leaf is missing entirely');
    assert.deepEqual(pinOf(leaf), { chain: TEST_CHAIN, blockHash: '0xbeef', blockNumber: 42 });
  }
});

test('an undecodable read renders raw SCALE and is never guessed at', async () => {
  const pin: FinalizedBlockRef = { chain: TEST_CHAIN, blockHash: '0xbeef', blockNumber: 42 };
  const reader = readerDouble(pin, {
    [SHELL_READS.epochOf]: '0xdeadbeef',
    [SHELL_READS.phaseFlags]: '0x04',
  });
  const { state, undecodable } = await readShellState(reader, {
    ...DECODERS_OK,
    epochOf: () => ({ ok: false, reason: 'variant index 9 is not in this enum' }),
  });
  assert.equal(undecodable.length, 1);
  const row = undecodable[0];
  assert.ok(row, 'nothing was reported undecodable');
  assert.equal(row.label, SHELL_READS.epochOf);
  assert.equal(row.rawHex, '0xdeadbeef');
  // The bytes reach the screen; a substituted value would be the guess rule 10 forbids.
  const html = renderToStaticMarkup(h(Undecodable, row));
  assert.ok(html.includes('0xdeadbeef'), html);
  assert.ok(/could not decode/.test(html), html);

  // Both fields of the failed decode are ABSENT. They used to be `0` and `'unknown'` wearing
  // a `verified-finalized` badge, defended on the grounds that the `undecodable` row beside
  // them said the number was not to be believed. 10 §2.2 gives that status "only to values
  // read through smoldot with storage proofs checked, or computed client-side purely from
  // such values", and INV-FE-9 attaches the label to the datum — so an explanation held in a
  // sibling array is not the datum being labelled, and a renderer showing the field without
  // the array showed an invented number as a chain answer.
  assert.equal(state.epoch, undefined, 'a manufactured epoch was badged as a chain read');
  assert.equal(state.phaseLabel, undefined, 'a manufactured phase was badged as a chain read');
  // …and the header says so in words rather than rendering a number with no badge.
  const header = renderToStaticMarkup(h(EpochHeader, { chain: state }));
  assert.ok(/Not read yet/.test(header), header);
  assert.ok(!/>0</.test(header), `a zero reached the header: ${header}`);
});

test('the failed-decode path treats BOTH of its fields the way phaseFlags always did', async () => {
  // The defect this asserts against was an internal inconsistency, not just a wrong badge:
  // one object literal chose a badged fallback for the epoch decode and `undefined` for the
  // flags decode, three lines apart, for the identical situation. Failing both reads at once
  // is what makes the two paths comparable.
  const pin: FinalizedBlockRef = { chain: TEST_CHAIN, blockHash: '0xbeef', blockNumber: 42 };
  const reader = readerDouble(pin, { [SHELL_READS.epochOf]: '0xaa', [SHELL_READS.phaseFlags]: '0xbb' });
  const { state, undecodable } = await readShellState(reader, {
    epochOf: () => ({ ok: false, reason: 'no' }),
    phaseFlags: () => ({ ok: false, reason: 'no' }),
  });
  assert.equal(undecodable.length, 2);
  assert.deepEqual(
    [state.epoch, state.phaseLabel, state.phaseFlags],
    [undefined, undefined, undefined],
    'two identical failure paths were still resolved differently',
  );
  // The height is the pin itself rather than a decode, so it survives both failures.
  assert.equal(state.finalizedHeight?.value, 42);
});

test('an unreadable PhaseFlags fails closed to the banner, not to post-sudo', async () => {
  const pin: FinalizedBlockRef = { chain: TEST_CHAIN, blockHash: '0xbeef', blockNumber: 42 };
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
  const at: FinalizedBlockRef = { chain: TEST_CHAIN, blockHash: '0xbeef', blockNumber: 42 };
  const ok = <T,>(value: T): Verified<T> => ({ value, status: { kind: 'verified-finalized', ...at } });
  const consistent: ShellChainState = {
    epoch: ok(7),
    phaseLabel: ok('Trade'),
    finalizedHeight: ok(42),
    phaseFlags: ok(4),
  };
  assert.doesNotThrow(() => assertOnePin(consistent, at.blockHash));

  // One leaf from a different block: a header showing the epoch at one block and the phase
  // at another is a view that never existed, and nothing on screen distinguishes it.
  const fields = ['epoch', 'phaseLabel', 'finalizedHeight', 'phaseFlags'] as const;
  for (const field of fields) {
    const leaf = consistent[field];
    assert.ok(leaf, `the consistent fixture has no ${field}`);
    const mixed: ShellChainState = {
      ...consistent,
      [field]: {
        value: leaf.value,
        status: { kind: 'verified-finalized', chain: TEST_CHAIN, blockHash: '0xcafe', blockNumber: 43 },
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
  // Each entry declares which of the two reasons applies, as a closed union rather than as
  // prose — see the bidirectional check below, which is what stops it going stale.
  for (const [id, pending] of Object.entries(PENDING_SCREENS)) {
    assert.ok(
      pending.state === 'not-built' || pending.state === 'built-unwired',
      `${id} declares no reason`,
    );
    assert.match(pending.component, /^@bleavit\/[a-z-]+#[A-Za-z]+$/, `${id}: ${pending.component}`);
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
    payloadHash: finalized(`0x${'ab'.repeat(32)}`),
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
  const summary: ProposalSummary = {
    id: finalized('42'), payloadHash: finalized(`0x${'ab'.repeat(32)}`), klass: finalized('P'), state: finalized('Extended'),
  };
  const { view } = viewFor(summary, undefined);
  assert.equal(view.stage, 'pre-decision');
  assert.equal(view.reason, 'extended');
});

test('statistics arriving on an open market are refused and reported, not rendered', () => {
  // The case a "render it if the API returned some" implementation gets wrong. Both reads
  // came from one pinned block, so it is a contradiction rather than a race, and only one
  // reading is safe to act on.
  const summary = {
    id: finalized('42'), payloadHash: finalized(`0x${'ab'.repeat(32)}`), klass: finalized('P'), state: finalized('Trading'),
  };
  const stats = decisionStats();
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
    id: finalized('42'), payloadHash: finalized(`0x${'ab'.repeat(32)}`), klass: finalized('P'),
    state: finalized('SomeStateFromANewerRuntime'),
  };
  const stats = decisionStats();
  const { view, anomaly } = viewFor(summary, stats);
  assert.equal(view.stage, 'pre-decision');
  assert.ok(anomaly, 'an unknown state let statistics through');
});

test('a sealed proposal does render its statistics', () => {
  // The anti-vacuity control: if this failed, every test above would pass for the trivial
  // reason that nothing ever renders statistics.
  const summary = {
    id: finalized('42'), payloadHash: finalized(`0x${'ab'.repeat(32)}`), klass: finalized('P'), state: finalized('Settled'),
  };
  const stats = decisionStats();
  const { view, anomaly } = viewFor(summary, stats);
  assert.equal(view.stage, 'decided');
  assert.equal(anomaly, undefined);
  assert.equal(view.decisionStats.uplift1e9.value, 41_000_000n);
});

/**
 * The injected `decision_stats(pid)` argument encoder.
 *
 * A stub, because the real one lives in `chain-client` (only that package may encode
 * SCALE). What matters for these two tests is that the reader is handed one at all.
 */
const STATS_ARGS = { decisionStats: (pid: string) => `0x${pid}` };

test('the proposal list is cross-checked against its own storage prefix (FE-P2)', async () => {
  const pin: FinalizedBlockRef = { chain: TEST_CHAIN, blockHash: '0xbeef', blockNumber: 42 };
  let asked: { api: string; storagePrefix: string } | undefined;
  const reader: ProposalsReader = {
    at: pin,
    async crossCheckedCall(source) {
      asked = source;
      return finalize(
        { result: '0x00', witness: [{ key: 'k1', value: '0xaa' }, { key: 'k2', value: '0xbb' }] },
        pin,
      );
    },
    async call() {
      return finalize('0x00', pin);
    },
  };
  const read = await readProposals(
    reader,
    {
      proposals: (raw) => ({
        ok: true,
        value: raw.map((hex, i) => ({ id: String(i), payloadHash: hex, klass: 'P', state: 'Settled' })),
      }),
      decisionStats: () => ({ ok: true, value: undefined }),
    },
    STATS_ARGS,
  );
  // The API and the prefix are paired by the reader, never by this call site — satisfying
  // one domain's view with the other's keys is what would make the check vacuous.
  assert.deepEqual(asked, { api: PROPOSAL_READS.summaries, storagePrefix: PROPOSAL_READS.proposals });
  assert.equal(read.summaries.length, 2);
  for (const summary of read.summaries) assert.equal(pinOf(summary.id).blockHash, '0xbeef');
});

test('a prefix key with no value is reported, never silently dropped', async () => {
  // The failure this catches shortens the list and passes: the remaining entries decode
  // perfectly, the screen shows fewer proposals than the chain has, and nothing says so.
  const pin: FinalizedBlockRef = { chain: TEST_CHAIN, blockHash: '0xbeef', blockNumber: 42 };
  const reader: ProposalsReader = {
    at: pin,
    async crossCheckedCall() {
      return finalize({ result: '0x00', witness: [{ key: 'k1', value: '0xaa' }, { key: 'k2' }] }, pin);
    },
    async call() {
      return finalize('0x00', pin);
    },
  };
  const read = await readProposals(
    reader,
    {
      proposals: (raw) => ({
        ok: true,
        value: raw.map((hex, i) => ({ id: String(i), payloadHash: hex, klass: 'P', state: 'Settled' })),
      }),
      decisionStats: () => ({ ok: true, value: undefined }),
    },
    STATS_ARGS,
  );
  assert.equal(read.summaries.length, 1);
  assert.equal(read.undecodable.length, 1);
  const missing = read.undecodable[0];
  assert.ok(missing, 'the valueless key was not reported');
  assert.match(missing.label, /Epoch\.Proposals\[k2\]/);
  assert.match(missing.reason, /carries no value/);
});

// ------------------------------------------- the confirm surface's gate wiring

const session = (overrides: Partial<TxSession> = {}): TxSession => ({
  state: 'Draft', prep: undefined, failed: [], lastError: undefined,
  signingWindow: undefined, ...overrides,
});
/**
 * A real `GatePassed` at a chosen block.
 *
 * The brand is a non-exported `unique symbol`, so it is obtained by running the gate —
 * the only thing that can mint one, and the reason `as unknown as` is banned across
 * `app/` (10 §2.1). The rows are the ones the caller wants the confirm surface to show.
 */
const gatePassedAt = (at: FinalizedBlockRef, rows: readonly DeclarableRowId[]): GatePassed => {
  const prep: TxPreparation = { ...PREP, requires: rows };
  const results = rows.flatMap((row) =>
    coverageOf(row).map((id) => ({ ...PASSING_ROW, id, at })),
  );
  const outcome = gate(prep, at, prep.builtFor, results);
  assert.equal(outcome.kind, 'proceed', 'the gate fixture no longer opens');
  return outcome.passed;
};

const confirmInputs = () => ({
  decoded: decodeForConfirm(PREP.scaleHex, DECODER),
  sudoActive: false, expert: false, onSign: () => {}, onEdit: () => {},
});

/**
 * A session in which the §11.8 gate is **open** for one row.
 *
 * Built by running the real `gate()`, exactly as `gatePassedAt` is and for the same reason:
 * `GatePassed` is branded by a non-exported symbol, so a fixture cannot fake one, and an
 * operator console that could be driven by a hand-made object would prove nothing about the
 * property under test.
 */
const readySession = (row: DeclarableRowId): TxSession => {
  const prep: TxPreparation = { ...PREP, requires: [row] };
  // Every obligation of the row, because the gate demands one result per clause — and the
  // preparation the proof names must be the one the session holds, because `reduce` and
  // `operatorGate` both refuse a proof minted for different bytes.
  const results = coverageOf(row).map((id) => ({ ...PASSING_ROW, id, at: AT }));
  const outcome = gate(prep, AT, prep.builtFor, results);
  assert.equal(outcome.kind, 'proceed', 'the operator gate fixture no longer opens');
  return session({ state: 'AwaitingSignature', prep, signingWindow: outcome.passed });
};

/** A session that has not been refreshed — a prepared transaction, no gate result. */
const preparedSession = (row: DeclarableRowId): TxSession =>
  session({ state: 'Prepared', prep: { ...PREP, requires: [row] } });

const EVIDENCE_FIXTURE: EvidenceState = evidenceUnavailable(3);
const noSubmit = (_window: GatePassed): void => {};

/**
 * Whether a `Field` with **exactly** this label is on screen.
 *
 * `assert.match(html, /Fee headroom/)` is satisfied by a field renamed `Fee headroom-NOT`,
 * and three mutations renaming labels survived the first version of these tests. The label
 * is its own element, so the exact element is what gets asserted.
 */
const fieldPresent = (html: string, label: string): boolean =>
  html.includes(`<span class="field__label">${label}</span>`);

/** §11.8.6 row 2's inputs, minus the two the panel derives from its own window. */
const CHALLENGE_FILING = (
  over: Partial<Omit<ChallengeFilingInputs, 'windowOpen' | 'windowReason'>> = {},
): Omit<ChallengeFilingInputs, 'windowOpen' | 'windowReason'> => ({
  kind: 'incident',
  freeUsdc: finalized(10_000_000n),
  challengeBond: finalized(1_000_000n),
  evidenceHash: '0xevidence',
  ...over,
});

/** §11.8.6 row 1's inputs — the clean path, so a refusal elsewhere is not this fixture. */
const FILING = (over: Partial<FilingInputs> = {}): FilingInputs => ({
  kind: 'incident',
  freeUsdc: finalized(10_000_000n),
  filingBond: finalized(1_000_000n),
  filingsUsed: finalized(1),
  filingsBound: finalized(8),
  evidenceHash: '0xevidence',
  ...over,
});

/** A fee the account covers — the neutral case, so a refusal elsewhere is not this one. */
const COVERED_FEE = (): UpgradeFeeInputs => ({
  asset: 'VIT',
  free: finalized(10_000_000_000_000n),
  estimatedFee: finalized(1_000_000_000n),
});

test('no confirm screen exists before the chain has been re-read', () => {
  // A confirm screen is a statement that the chain was re-read at a named block. In these
  // states that statement is not yet true, so there is nothing to render — not a screen
  // with empty or remembered rows.
  for (const state of ['Draft', 'Prepared', 'Refreshing'] as const satisfies readonly TxState[]) {
    assert.equal(
      confirmProps(session({ state, prep: PREP }), confirmInputs()),
      undefined,
      state,
    );
  }
});

test('AwaitingSignature renders the gate’s own passing rows', () => {
  const passed = gatePassedAt(AT, ['P-1', 'P-2']);
  const props = confirmProps(
    session({ state: 'AwaitingSignature', prep: PREP, signingWindow: passed }),
    confirmInputs(),
  );
  assert.ok(props);
  assert.deepEqual(props.preconditions.map((r) => r.id), [...coverageOf('P-1'), ...coverageOf('P-2')]);
  assert.equal(mayOfferSigning(session({ state: 'AwaitingSignature' })), true);
});

test('Blocked renders the failures only — rule 5’s diff view, not a padded set', () => {
  const failed = [{ ...PASSING_ROW, id: firstCoverage('P-2'), ok: false, expected: 'Open', actual: 'Closed' }];
  // The session MUST carry a stale signing window, and the first version of this test did
  // not: with `signingWindow: undefined` a controller that preferred the window would fall
  // back to `failed` and pass. Mutation M34 survived on exactly that. The dangerous session
  // is `Blocked` reached *after* a gate once passed — a full set of rows that were true at
  // a block B′ has already moved past.
  const stale = gatePassedAt({ chain: TEST_CHAIN, blockHash: '0xold', blockNumber: 999 }, ['P-1', 'P-3']);
  const props = confirmProps(
    session({ state: 'Blocked', prep: PREP, failed, signingWindow: stale }),
    confirmInputs(),
  );
  assert.ok(props);
  assert.deepEqual(props.preconditions.map((r) => r.id), [firstCoverage('P-2')]);
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
  assert.ok(
    !props.preconditions.some((r: PreconditionResult) => !r.ok),
    'no row is at fault, by construction',
  );
});

test('the confirm controller reaches no signer', async () => {
  // `src/features/tx` may reference `signing` (10 §10.2), so this restraint is not
  // structural and has to be asserted. The controller hands `onSign` back to its caller.
  const source = readFileSync(
    join(REPO, 'app/src/features/tx/src/confirm-controller.ts'),
    'utf8',
  );
  assert.ok(!/@bleavit\/signing/.test(source), 'the confirm controller imports a signer');
  // Every identifier this module *calls* whose name mentions signing, compared against the
  // one that is allowed. The previous form stripped `mayOfferSigning|onSign` and then
  // looked for `sign(`, which was dead code twice over: the capital S in both names means
  // neither could ever have matched a lowercase `\bsign\s*\(`, and that narrow pattern
  // missed `signPayload(` and `signRaw(` — the two names a signer is actually reached by —
  // entirely. Naming the permitted callee is strictly stronger, and it is a match rather
  // than a strip, so it does not read as sanitization.
  const signCalls = [...source.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)]
    .map((match) => match[1] ?? '')
    .filter((name) => /sign/i.test(name));
  assert.deepEqual(
    [...new Set(signCalls)].sort(),
    ['mayOfferSigning'],
    `the confirm controller calls a signer: ${JSON.stringify([...new Set(signCalls)])}`,
  );
});

// ------------------------------------------------ the verification panel (F10)

const PANEL: VerificationPanel = {
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
    assert.ok(body?.includes(expected), `a ${kind} row carries no words saying so: ${body}`);
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

/** The follow events a recorded exchange replays, as this reader needs them. */
interface RecordedEvents {
  readonly events?: readonly { readonly items?: readonly { readonly key: string; readonly value: string }[] }[];
}

/** The exact values recorded from the runtime at one pinned block. */
function recordedStorageValue(fixture: string): string {
  const doc = JSON.parse(
    readFileSync(join(REPO, 'app/fixtures/chainhead', fixture), 'utf8'),
  ) as Fixture;
  for (const request of doc.requests) {
    for (const event of (request.response as RecordedEvents).events ?? []) {
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

  const pin: FinalizedBlockRef = { chain: TEST_CHAIN, blockHash: '0xbeef', blockNumber: 4242 };
  const reader = readerDouble(pin, {
    [SHELL_READS.epochOf]: recordedStorageValue('storage.epoch.epoch_of.json'),
    [SHELL_READS.phaseFlags]: recordedStorageValue('storage.constitution.phase_flags.json'),
  });

  const { state, undecodable } = await readShellState(reader, shellDecoders(codecs));
  assert.deepEqual(undecodable, [], JSON.stringify(undecodable));
  assert.equal(state.epoch?.value, 1);
  assert.equal(state.phaseLabel?.value, 'Intake');
  const flags = state.phaseFlags;
  assert.ok(flags, 'PhaseFlags did not decode from the recorded bytes');
  assert.equal(flags.value, 17);

  // And the consequence that matters: this chain has sudo, so the banner shows.
  assert.equal(sudoActive(flags.value), true);
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
  const pin = { chain: TEST_CHAIN, blockHash: '0xbeef', blockNumber: 1 };
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

const REF = (over: Partial<Referendum> = {}): Referendum => ({
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
    () => renderToStaticMarkup(h(Disclosure, { summary: 'details', children: null }, h(AlwaysVisible, { fold }))),
    DeferredMeaningChangingFactError,
  );
});

// ------------------------------------------------- S11 the oracle ballot (F16)

const BALLOT = (power: OracleBallot['power']): OracleBallot => ({
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
  const powers: readonly EffectivePower[] = [
    { kind: 'counted', power: finalized(1n), snapshotAt: finalized(1) },
    { kind: 'weightless', lockedAt: finalized(2), snapshotAt: finalized(1) },
    { kind: 'unestablished', reason: 'x' },
  ];
  for (const power of powers) {
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

const WINDOW: ExecutionWindow = { maturity: finalized(1_000), graceEnd: finalized(2_000), now: finalized(1_500) };
const panelProps = (view: RatificationView) => ({
  view, window: WINDOW, onSubmitReferendum: () => {}, onBindIndex: () => {},
});

test('the guard record alone cannot produce a lifecycle claim', () => {
  // §11.7.4: "NoPassedRecord ... deliberately does not distinguish never submitted,
  // submitted-but-unbound, submitted and ongoing, or submitted and rejected." A caller
  // holding only the guard's record has nothing to pass for `referendum`, so it cannot
  // build the view at all — the rule is a missing argument rather than a thing to recall.
  const noRecord: RatificationView = { kind: 'no-passed-record', referendum: { kind: 'none-submitted' } };
  assert.ok('referendum' in noRecord, 'the arm carries the referendum side');
  const html = renderToStaticMarkup(h(RatificationPanel, panelProps(noRecord)));
  // And it renders as "none submitted", never as "not ratified".
  assert.ok(/No ratification referendum has been submitted/.test(html), html);
  assert.ok(!/not ratified/i.test(html), `the guard record was rendered as a verdict: ${html}`);
});

test('an ongoing referendum is never shown as unratified', () => {
  const ongoing: RatificationView = {
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
  const link = (needed: number): ReferendumLink => ({
    kind: 'ongoing', index: finalized('9'),
    ayes: finalized(1n), nays: finalized(0n), blocksStillNeeded: finalized(needed),
  });
  // 500 blocks remain (graceEnd 2000 − now 1500).
  assert.equal(canStillComplete(link(499), WINDOW).kind, 'yes');
  assert.equal(canStillComplete(link(500), WINDOW).kind, 'yes', 'exactly fitting must not warn');
  assert.equal(canStillComplete(link(501), WINDOW).kind, 'no');

  const html = renderToStaticMarkup(
    h(RatificationPanel, panelProps({ kind: 'no-passed-record', referendum: link(900) })),
  );
  assert.ok(html.includes(CANNOT_COMPLETE), html);
  assert.ok(html.includes('data-severity="danger"'), html);
});

test('reads spanning two blocks say so, rather than silently hiding the warning', () => {
  // The panel warns on `no` and shows nothing otherwise, so folding an indeterminate answer
  // into "not applicable" would hide a real "this cannot complete" behind a blank space.
  // That is the unsafe direction, so it gets its own arm and its own notice.
  const staleWindow: ExecutionWindow = {
    maturity: finalized(1_000),
    graceEnd: finalized(2_000, 1_000_000),
    now: { value: 1_500, status: { kind: 'verified-finalized', chain: TEST_CHAIN, blockHash: '0xbeef', blockNumber: 999_000 } },
  };
  const link: ReferendumLink = {
    kind: 'ongoing', index: finalized('9'),
    ayes: finalized(1n), nays: finalized(0n), blocksStillNeeded: finalized(900),
  };
  const verdict = canStillComplete(link, staleWindow);
  assert.equal(verdict.kind, 'indeterminate');

  // 900 needed against 500 remaining would have warned; the panel must not, and must not be
  // silent either.
  const html = renderToStaticMarkup(
    h(RatificationPanel, {
      view: { kind: 'no-passed-record', referendum: link } satisfies RatificationView,
      window: staleWindow,
      onSubmitReferendum: () => {},
      onBindIndex: () => {},
    }),
  );
  assert.ok(!html.includes(CANNOT_COMPLETE), 'must not claim a verdict it cannot reach');
  assert.match(html, /Whether this can still complete is unknown/);
  assert.match(html, /different blocks/);
  // And the countdown itself is withheld rather than computed across the two.
  assert.match(html, /Not available/);
  assert.ok(!html.includes('>500<'), 'the cross-block difference must not be rendered');
});

test('a question that was not asked gets no confident answer', () => {
  // None-submitted and already-approved have no remaining-period figure to compare;
  // inventing one would produce a confident answer to a different question.
  assert.equal(canStillComplete({ kind: 'none-submitted' }, WINDOW).kind, 'not-applicable');
  assert.equal(
    canStillComplete({ kind: 'rejected', index: finalized('9') }, WINDOW).kind,
    'not-applicable',
  );
  assert.equal(
    canStillComplete({ kind: 'approved-not-recorded', index: finalized('9') }, WINDOW).kind,
    'not-applicable',
  );
  const referenda: readonly ReferendumLink[] = [
    { kind: 'none-submitted' },
    { kind: 'approved-not-recorded', index: finalized('9') },
  ];
  for (const referendum of referenda) {
    const html = renderToStaticMarkup(
      h(RatificationPanel, panelProps({ kind: 'no-passed-record', referendum } satisfies RatificationView)),
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
        h(Disclosure, { summary: 'vote', children: null },
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

const DEPOSIT = (over: Partial<DepositInputs> = {}): DepositInputs => ({
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
  const sent: DepositProgress = { kind: 'sent-awaiting-arrival', assetHubBlock: finalized(500) };
  assert.ok(!('creditedAtLocalBlock' in sent), 'the sent arm must carry no local credit');
  assert.match(copy(progressCopy(sent)), /message was sent, not that the funds have arrived/);
  assert.match(copy(progressCopy(sent)), /awaiting arrival/i);

  const credited: DepositProgress = {
    kind: 'credited', assetHubBlock: finalized(500),
    creditedAtLocalBlock: finalized(900), creditedAmount: finalized(10_000_000n),
  };
  assert.match(copy(progressCopy(credited)), /its own finalized state/);
});

test('the bootstrap caps read a bit, and an unreadable cap blocks (V-115, D-13)', () => {
  // The spec said "while PhaseFlags < Phase 4", which is unperformable on a bitset and
  // would have SKIPPED the caps entirely during bootstrap. Repaired; here the flag is a
  // boolean the caller derives from bit 4.
  const noCaps = depositBlocks(DEPOSIT({ bootstrapPhase: true }));
  assert.ok(noCaps.some((b) => /exposure caps/i.test(b.check)), JSON.stringify(noCaps));
  assert.match(nth(noCaps, 0, 'block').detail, /blocked rather than proceeding without the limit/);

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
  assert.match(copy(xcmWarning({ xcmHealthy: false })), /held, not lost/);
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
  assert.match(copy(destinationWarning(false)), /would not survive/);
  assert.match(copy(destinationWarning(undefined)), /has not been established either way/);
});

// -------------------------------------------------- S17 the upgrade crank (F17)

const AUTHORIZED: AuthorizedUpgrade = {
  codeHash: finalized('0xaaaa'),
  applicableAt: finalized(5_000),
};

/** A chunked source: §11.8.4 step 3's "streaming … over the downloaded bytes". */
const chunkSource = (chunks: readonly Uint8Array[], totalBytes?: number): ArtifactSource => ({
  ...(totalBytes === undefined ? {} : { totalBytes }),
  async *chunks() {
    for (const chunk of chunks) yield chunk;
  },
});

/** An incremental hasher that records what it was actually fed, chunk by chunk. */
const recordingHasher = (digestValue: string) => {
  const seen: number[] = [];
  return {
    seen,
    hasher: {
      update(chunk: Uint8Array) {
        for (const byte of chunk) seen.push(byte);
      },
      digest: () => digestValue,
    } satisfies StreamingHasher,
  };
};

test('a mismatched artifact hard-blocks and never becomes a submission', async () => {
  // §11.8.4 step 3: "a mismatch hard-blocks with FE-UPG-001 and never reaches the wallet."
  // It throws rather than returning a result, because a refusal a caller can ignore is not
  // a hard block — and this is the most consequential signature the client can produce.
  await assert.rejects(
    verifyArtifact(
      chunkSource([new Uint8Array([1, 2, 3])]),
      AUTHORIZED,
      recordingHasher('0xbbbb').hasher,
    ),
    (error: unknown) => {
      assert.ok(error instanceof UpgradeHashMismatchError, `not the hard block: ${String(error)}`);
      assert.equal(error.code, 'FE-UPG-001');
      assert.match(error.message, /hard block/);
      assert.match(error.message, /no gateway is retried into acceptance/);
      return true;
    },
  );
});

test('the hash is fed in chunks, and the verified bytes are exactly the hashed ones', async () => {
  // §11.8.4 step 3 says *streaming*, and the first implementation hashed a whole array in
  // one call. The distinction is load-bearing twice over: the memory note in §11.8.4 is
  // about bounded chunks, and — the part a passing one-shot test cannot see — the bytes a
  // submission carries must be the bytes that were hashed. A caller keeping its own copy
  // beside the verified one is how a verified hash comes to describe different bytes.
  const { seen, hasher } = recordingHasher('0xaaaa');
  const artifact = await verifyArtifact(
    chunkSource([new Uint8Array([1, 2]), new Uint8Array([3]), new Uint8Array([4, 5])]),
    AUTHORIZED,
    hasher,
  );
  assert.deepEqual(seen, [1, 2, 3, 4, 5], 'the hasher was not fed every chunk, in order');
  assert.deepEqual([...artifact.copyBytes()], seen, 'the retained bytes are not the hashed bytes');
  assert.equal(artifact.byteLength, 5);
});

test('an empty source is its own refusal, not a hash of nothing', async () => {
  // A zero-byte body yields a well-formed digest, which a comparison reports as a content
  // mismatch — hiding a transport failure behind FE-UPG-001 and sending the operator to
  // look for a corrupted artifact that is not the problem.
  await assert.rejects(
    verifyArtifact(chunkSource([]), AUTHORIZED, recordingHasher('0xaaaa').hasher),
    (error: unknown) => {
      assert.ok(error instanceof EmptyArtifactError, `not the empty refusal: ${String(error)}`);
      assert.match(error.message, /not a runtime/);
      return true;
    },
  );
});

test('fetch progress reports bytes, and an undeclared length is not zero', async () => {
  // E19 asks for fetch progress. `undefined` total is not the same as a zero-length
  // download: a bar computed from it would read complete before anything arrived.
  const seenProgress: FetchProgress[] = [];
  await verifyArtifact(
    chunkSource([new Uint8Array(2), new Uint8Array(3)], 5),
    AUTHORIZED,
    recordingHasher('0xaaaa').hasher,
    (progress) => seenProgress.push(progress),
  );
  assert.deepEqual(
    seenProgress.map((entry) => entry.bytesRead),
    [2, 5],
    'progress must be reported per chunk, cumulatively',
  );
  assert.match(progressLine({ bytesRead: 1_048_576, totalBytes: 5_242_880 }), /1\.0 MiB of 5\.0 MiB/);
  const unknown = progressLine({ bytesRead: 1_048_576, totalBytes: undefined });
  assert.match(unknown, /did not declare a length/);
  assert.match(unknown, /not stalled/);
  assert.doesNotMatch(unknown, /of 0\.0 MiB/, 'an undeclared length rendered as zero');
});

test('a matching artifact verifies, and the brand stays phantom', async () => {
  const artifact = await verifyArtifact(
    chunkSource([new Uint8Array(4_194_304)]),
    AUTHORIZED,
    recordingHasher('0xaaaa').hasher,
  );
  assert.equal(artifact.hash, '0xaaaa');
  assert.equal(artifact.byteLength, 4_194_304);
  // **The verified bytes are not a property.** `readonly bytes: Uint8Array` stopped the
  // reference being replaced and left the array's contents writable through a valid brand,
  // so a caller could edit the runtime after verification and keep the proof. They now live
  // in a `#` private field, which is unreachable at runtime as well as at compile time —
  // asserted here rather than argued, because "private" in TypeScript alone is a comment.
  assert.deepEqual(
    Object.keys(artifact).sort(),
    ['byteLength', 'hash'],
    'the verified bytes are enumerable again — a caller can reach and mutate them',
  );
  assert.equal(
    Object.getOwnPropertyDescriptor(artifact, 'bytes'),
    undefined,
    'a `bytes` property exists — the private field was reintroduced as a public one',
  );
});

test('the verified bytes cannot be mutated through the artifact (Codex #3730437896)', async () => {
  // The defect in its exact shape: `readonly` prevents `artifact.bytes = other` and permits
  // `artifact.bytes[0] = 0`, so bytes whose hash was never compared with the authorization
  // could be carried into `UpgradeSubmission` under a genuine brand — on the single most
  // consequential signature this client can produce.
  const original = Uint8Array.from([1, 2, 3, 4]);
  const artifact = await verifyArtifact(
    chunkSource([original]),
    AUTHORIZED,
    recordingHasher('0xaaaa').hasher,
  );
  const first = artifact.copyBytes();
  first.fill(0xff);
  const second = artifact.copyBytes();
  assert.deepEqual([...second], [1, 2, 3, 4], 'the copy is a view — mutating it edited the artifact');
  // Two copies are independent of each other as well as of the artifact, because a shared
  // buffer handed out twice is the same defect one indirection further away.
  assert.notEqual(first.buffer, second.buffer);
  // And mutating the caller's *input* after verification does not reach the verified bytes:
  // the artifact snapshotted them.
  original.fill(0x99);
  assert.deepEqual([...artifact.copyBytes()], [1, 2, 3, 4], 'the artifact aliases the caller\'s buffer');
});

test('a source that reuses one buffer between yields is snapshotted (Codex #3730437903)', async () => {
  // `ArtifactSource` is an interface anybody may implement, and reusing a scratch buffer
  // across yields is an ordinary way to write a streaming reader. The hasher consumes each
  // chunk's contents immediately; `parts` was retaining the reference, so every entry
  // pointed at the same memory and the concatenation produced the LAST chunk repeated —
  // returned as a branded artifact whose hash described entirely different bytes.
  const scratch = new Uint8Array(2);
  const reusing = {
    totalBytes: 4,
    async *chunks(): AsyncIterable<Uint8Array> {
      scratch.set([1, 2]);
      yield scratch;
      scratch.set([3, 4]);
      yield scratch;
    },
  };
  const seen: number[] = [];
  const hasher = {
    update: (chunk: Uint8Array) => { seen.push(...chunk); },
    digest: () => '0xaaaa',
  };
  const artifact = await verifyArtifact(reusing, AUTHORIZED, hasher);
  assert.deepEqual(seen, [1, 2, 3, 4], 'the hasher did not see the stream in order');
  assert.deepEqual(
    [...artifact.copyBytes()],
    seen,
    'the retained bytes are not the bytes that were hashed — the chunk was kept by reference',
  );
});

test('the lead-time countdown is over the STORED field, and refuses across blocks', async () => {
  // E19 wants the countdown; SQ-552 forbids deriving `applicable_at`. Those are compatible
  // and the difference is exact — this subtracts `now` from the chain's own field.
  assert.equal(stated(leadTimeCountdown(AUTHORIZED, finalized(4_900))), 100);
  assert.equal(stated(leadTimeCountdown(AUTHORIZED, finalized(5_050))), -50);
  const split = leadTimeCountdown(AUTHORIZED, {
    value: 4_900,
    status: { kind: 'verified-finalized', chain: TEST_CHAIN, blockHash: '0xbeef', blockNumber: 7 },
  });
  assert.equal(split.kind, 'incomparable', 'a countdown spanning two blocks is a deadline for neither');
});

test('fee headroom blocks when short AND when it cannot be established', () => {
  // §11.8.4 step 4 asks for fee headroom "displayed — it is large", and the row carried no
  // fee clause at all. Both failure directions block: this is the biggest fee the client
  // can incur, and the cost of guessing wrong is a lost multi-megabyte download.
  const covered = upgradeFeeHeadroom({ asset: 'VIT', free: finalized(100n), estimatedFee: finalized(60n) });
  assert.deepEqual(stated(covered), { covered: true, shortfall: 0n });
  assert.equal(feeHeadroomBlock(covered), undefined);

  const short = upgradeFeeHeadroom({ asset: 'VIT', free: finalized(50n), estimatedFee: finalized(60n) });
  assert.deepEqual(stated(short), { covered: false, shortfall: 10n });
  assert.match(copy(feeHeadroomBlock(short)?.detail), /length fee is far/);

  const split = upgradeFeeHeadroom({
    asset: 'USDC',
    free: { value: 100n, status: { kind: 'verified-finalized', chain: TEST_CHAIN, blockHash: '0xbeef', blockNumber: 7 } },
    estimatedFee: finalized(60n),
  });
  assert.equal(split.kind, 'incomparable');
  assert.match(copy(feeHeadroomBlock(split)?.detail), /cannot establish/);
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
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(
    !/DescriptorLeadTime|authorized_at/i.test(code),
    'lead-time arithmetic reappeared in the upgrade crank',
  );
  // E19's countdown is NOT that arithmetic, and the difference is exact: it subtracts `now`
  // from the **stored** field and never produces `applicable_at`. Asserted rather than left
  // to the reader, because a blanket ban on the word would have to delete the countdown the
  // degradation matrix requires.
  assert.match(code, /applicableAt,\s*now,\s*\(applicableAt, current\) => applicableAt - current/);
});

test('the submission outlook states uncertainty rather than predicting success', async () => {
  // FE-P10 is unresolved. A screen that implied a 4 MiB extrinsic will go through would be
  // asserting the very thing the prototype gate exists to find out.
  const artifact = await verifyArtifact(
    chunkSource([new Uint8Array(4_194_304)]),
    AUTHORIZED,
    recordingHasher('0xaaaa').hasher,
  );
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

const JUSTIFICATION = () =>
  admitEvidence(new TextEncoder().encode('why this action'), finalized('0xjust'), () => '0xjust');
const CALL = (pallet = 'Constitution', call = 'set_param'): ApprovedCall => ({
  kind: 'decoded', pallet: finalized(pallet), call: finalized(call), args: [finalized('42')],
});
const ACTION = (over: Partial<PendingAction> = {}): PendingAction => ({
  actionId: finalized('a1'), power: finalized('activate_playbook'), target: finalized('PB-LEDGER-FREEZE'),
  justificationHash: finalized('0xjh'), approvals: finalized(3),
  threshold: finalized(5), expiresAt: finalized(9_000), dispatched: finalized(false),
  // §11.8.2 requires the exact batch; an action without one cannot be built.
  calls: [CALL()], ...over,
});

test('an unread trigger is treated exactly as an inactive one', () => {
  // E20: playbooks are admissible only under VERIFIED triggers. Collapsing "could not
  // check" into "checked and fine" is the fail-open reading, on the one power whose whole
  // justification is that the condition holds right now.
  assert.equal(mayActivatePlaybook({ kind: 'active', since: finalized(1) }), true);
  assert.equal(mayActivatePlaybook({ kind: 'inactive' }), false);
  assert.equal(mayActivatePlaybook({ kind: 'unread', reason: 'the storage read failed' }), false);
  // And the two refusals say different things, because the guardian's next step differs.
  assert.match(copy(triggerRefusal({ kind: 'inactive' })), /the condition being absent/);
  assert.match(
    copy(triggerRefusal({ kind: 'unread', reason: 'the storage read failed' })),
    /could not establish/,
  );
  assert.equal(triggerRefusal({ kind: 'active', since: finalized(1) }), undefined);
});

test('approving twice is its own refusal, not "not eligible"', () => {
  // A guardian who approves again believes they moved the count. Folding this into a
  // generic refusal leaves them unable to tell whether the action is stuck or they are.
  const blocks = approvalBlocks({
    action: ACTION(), justification: JUSTIFICATION(),
    callerIsMember: true, callerHasApproved: true, now: finalized(100),
  } satisfies ApprovalContext);
  assert.equal(blocks.length, 1);
  assert.equal(nth(blocks, 0, 'block').check, 'Already approved');
  assert.match(nth(blocks, 0, 'block').detail, /does not add to the count/);
});

test('a DISPATCHED action cannot be approved — 11 §11.8.2\'s "pending" half', () => {
  // The blocker an R-6 review found on 2026-08-07. §11.8.2's approve row declares "the action is
  // pending and has not expired", and only the second half was evaluated. `guardian_core` keeps a
  // dispatched action in `PendingActions` for the whole review window so a veto can still reach it
  // (`crates/guardian-core/src/lib.rs:655-656`), and `approve_action` refuses one with
  // `AlreadyDispatched` (`:480`). So the client offered the system's most privileged signature on
  // an action the chain would reject — 11 §11.5's P-11 rule inverted.
  const blocks = approvalBlocks({
    action: ACTION({ dispatched: finalized(true) }), justification: JUSTIFICATION(),
    callerIsMember: true, callerHasApproved: false, now: finalized(100),
  } satisfies ApprovalContext);
  assert.deepEqual(blocks.map((b) => b.check), ['Already dispatched']);
  assert.match(nth(blocks, 0, 'block').detail, /already executed/);
  // It must not read as expiry or as a lost race: the action ran, and the listing is deliberate.
  assert.match(nth(blocks, 0, 'block').detail, /still be vetoed/);

  // The control: the same action un-dispatched blocks nothing, so this is not a check that
  // fires on everything.
  assert.deepEqual(
    approvalBlocks({
      action: ACTION({ dispatched: finalized(false) }), justification: JUSTIFICATION(),
      callerIsMember: true, callerHasApproved: false, now: finalized(100),
    } satisfies ApprovalContext),
    [],
  );
});

test('every approval blocker is reported together', () => {
  const blocks = approvalBlocks({
    action: ACTION({ expiresAt: finalized(10) }), justification: JUSTIFICATION(),
    callerIsMember: false, callerHasApproved: true, now: finalized(100),
  } satisfies ApprovalContext);
  assert.deepEqual(blocks.map((b) => b.check).sort(), ['Already approved', 'Expiry', 'Membership']);
  // And a clean context blocks nothing, so the checks are not vacuously firing.
  assert.deepEqual(
    approvalBlocks({
      action: ACTION(), justification: JUSTIFICATION(),
      callerIsMember: true, callerHasApproved: false, now: finalized(100),
    } satisfies ApprovalContext),
    [],
  );
});

test('an overrun allowance reads as zero remaining, never as negative headroom', () => {
  // A negative would be treated as headroom by any arithmetic downstream.
  const two = allowanceRemaining({ power: 'delay_once', used: finalized(3), limit: finalized(5) });
  assert.equal(two.kind, 'stated');
  assert.equal(two.datum.value, 2);
  const overrun = allowanceRemaining({ power: 'delay_once', used: finalized(9), limit: finalized(5) });
  assert.equal(overrun.kind, 'stated');
  assert.equal(overrun.datum.value, 0);
});

test('an allowance read across two blocks is refused, not rendered', () => {
  // `limit` at one block and `used` at another describe no single budget. The figure is not
  // weakened — it is withheld, and `proposalBlocks` turns that into a block on the most
  // privileged actions in the system.
  const split = allowanceRemaining({
    power: 'delay_once',
    used: finalized(3, 1_000_000),
    limit: { value: 5, status: { kind: 'verified-finalized', chain: TEST_CHAIN, blockHash: '0xbeef', blockNumber: 999_000 } },
  });
  assert.equal(split.kind, 'incomparable');
  assert.match(split.reason, /different blocks/);
});

test('an allowance derived from provider data is never rendered as verified', () => {
  const mixed = allowanceRemaining({
    power: 'delay_once',
    used: { value: 3, status: { kind: 'provider', providerId: 'p', sampled: false } },
    limit: finalized(5),
  });
  assert.equal(mixed.kind, 'stated');
  assert.equal(mixed.datum.status.kind, 'provider', 'the light-client badge must not be inherited');
});

test('a power whose remaining allowance cannot be established is not offered', () => {
  // Fail-closed: "we could not check the budget" is not a reason to spend it.
  const blocks = proposalBlocks(
    {
      power: 'delay_once',
      used: finalized(0, 1_000_000),
      limit: { value: 5, status: { kind: 'verified-finalized', chain: TEST_CHAIN, blockHash: '0xbeef', blockNumber: 999_000 } },
    },
    undefined,
  );
  assert.deepEqual(blocks.map((b) => b.check), ['Allowance']);
  assert.match(nth(blocks, 0, 'block').detail, /cannot establish/);
});

test('the unratified-action consequence names the guardian own bond', () => {
  // §11.8.2's ratification tracker. It is a fact about their money, not about protocol
  // hygiene, and it applies whether or not the action turns out to have been correct.
  assert.match(UNRATIFIED_CONSEQUENCE, /half your bond is slashed/);
  assert.match(UNRATIFIED_CONSEQUENCE, /recalled/);
  assert.match(UNRATIFIED_CONSEQUENCE, /whether or not the action turns out to have been correct/);
});

test('a proposal is blocked by allowance and by trigger independently', () => {
  const meter: AllowanceMeter = { power: 'activate_playbook', used: finalized(0), limit: finalized(2) };
  assert.deepEqual(proposalBlocks(meter, { kind: 'active', since: finalized(1) }), []);
  assert.deepEqual(
    proposalBlocks({ ...meter, used: finalized(2) } satisfies AllowanceMeter, { kind: 'active', since: finalized(1) })
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

const STREAM = (over: Partial<Stream> = {}): Stream => ({
  id: finalized('s1'), recipient: finalized('5Grw'),
  total: finalized(1_000_000n), claimed: finalized(0n),
  startBlock: finalized(100), endBlock: finalized(1_100),
  cancelled: finalized(false), ...over,
});

test('vesting floors against the claimant, and the last unit is not invented', () => {
  // R-7's rounding rule. `total * elapsed / span` on bigint — a float would round a
  // recipient's last unit into or out of existence.
  assert.equal(stated(claimableNow(STREAM(), finalized(600))).amount, 500_000n);
  // 1 block into a 1000-block stream of 1,000,000 vests exactly 1,000.
  assert.equal(stated(claimableNow(STREAM(), finalized(101))).amount, 1_000n);
  // A total that does not divide evenly floors rather than rounding up.
  assert.equal(stated(claimableNow(STREAM({ total: finalized(999n) }), finalized(101))).amount, 0n);
});

test('the claimable figure carries the provenance of every read it came from', () => {
  // Six reads: total, claimed, startBlock, endBlock, cancelled and now. Every call site had
  // been picking `claimed`'s status for the result, which renders a figure derived partly
  // from provider data with a verified badge — INV-FE-1 by arithmetic. `check-render-
  // provenance`'s rule B caught it in this very file.
  const mixed = claimableNow(
    STREAM({ total: { value: 1_000_000n, status: { kind: 'provider', providerId: 'p', sampled: false } } }),
    finalized(600),
  );
  assert.equal(mixed.kind, 'stated');
  assert.equal(mixed.datum.status.kind, 'provider', 'must not inherit the verified badge');
});

test('a claim across two blocks is refused rather than shown — this is somebody’s money', () => {
  const split = claimableNow(
    STREAM({ claimed: { value: 0n, status: { kind: 'verified-finalized', chain: TEST_CHAIN, blockHash: '0xbeef', blockNumber: 999_000 } } }),
    finalized(600),
  );
  assert.equal(split.kind, 'incomparable');
  const blocks = claimBlocks({
    stream: STREAM({ claimed: { value: 0n, status: { kind: 'verified-finalized', chain: TEST_CHAIN, blockHash: '0xbeef', blockNumber: 999_000 } } }),
    callerIsRecipient: true,
    now: finalized(600),
  });
  assert.deepEqual(blocks.map((b) => b.check), ['Claimable amount']);
  assert.match(nth(blocks, 0, 'block').detail, /cannot establish what is claimable/);
});

test('not-started and fully-claimed are different zeros', () => {
  // A screen showing a bare zero for both tells a recipient the wrong thing to do.
  assert.deepEqual(stated(claimableNow(STREAM(), finalized(50))), { amount: 0n, reason: 'not-started' });
  assert.deepEqual(
    stated(claimableNow(STREAM({ claimed: finalized(1_000_000n) }), finalized(2_000))),
    { amount: 0n, reason: 'fully-claimed' },
  );
  assert.equal(
    stated(claimableNow(STREAM({ cancelled: finalized(true) }), finalized(600))).reason,
    'cancelled',
  );
});

test('a stream whose end is not after its start is refused, not divided by', () => {
  // Returning the whole total — the "treat it as instant" reading — would credit a
  // recipient everything from malformed chain state.
  const bad = claimableNow(STREAM({ startBlock: finalized(500), endBlock: finalized(500) }), finalized(900));
  assert.deepEqual(stated(bad), { amount: 0n, reason: 'malformed' });
  const blocks = claimBlocks({
    stream: STREAM({ startBlock: finalized(500), endBlock: finalized(500) }),
    callerIsRecipient: true, now: finalized(900),
  });
  assert.match(nth(blocks, 0, 'block').detail, /no vesting schedule can be derived/);
});

test('vesting stops at the end block rather than continuing past it', () => {
  assert.equal(stated(claimableNow(STREAM(), finalized(1_100))).amount, 1_000_000n);
  assert.equal(stated(claimableNow(STREAM(), finalized(99_999))).amount, 1_000_000n);
});

const READ_TARGET = (value: bigint): InsuranceTarget => ({ kind: 'read', value: finalized(value) });

test('INSURANCE is classified against its target, never shown as a bare trend', () => {
  // E1: a rising INSURANCE balance is not protocol income. The screen gets a
  // classification, not a number a component could plot as earnings.
  assert.deepEqual(stated(insuranceStanding(finalized(100n), READ_TARGET(100n))), { kind: 'at-target' });
  assert.deepEqual(
    stated(insuranceStanding(finalized(60n), READ_TARGET(100n))),
    { kind: 'below-target', shortfall: 40n },
  );
  assert.deepEqual(
    stated(insuranceStanding(finalized(140n), READ_TARGET(100n))),
    { kind: 'awaiting-overflow', excess: 40n },
  );
});

test('an unobtainable T_ins is its own arm, never rendered as "at target"', () => {
  // SQ-616: `T_ins` is a treasury-internal counter (08 §1.2) and no frozen surface carries
  // it — `NavView` publishes `insurance` and nothing beside it. The old signature demanded
  // a `Verified<bigint>` target, so the only way to satisfy it was to invent one, and an
  // invented zero classifies an empty reserve as *exactly sized*.
  const standing = insuranceStanding(finalized(140n), {
    kind: 'unestablished',
    reason: INSURANCE_TARGET_UNREADABLE,
  });
  assert.equal(stated(standing).kind, 'unestablished');
  assert.match(INSURANCE_TARGET_UNREADABLE, /SQ-616/);
  // It still carries the balance's own provenance — the block is knowable, the comparison
  // is not, and collapsing the two would withhold more than is actually missing.
  assert.equal(standing.kind === 'stated' && standing.datum.status.kind, 'verified-finalized');
  // And the copy still says the one thing that holds either way.
  assert.match(copy(insuranceCopy(stated(standing))), /not protocol income/);
});

test('a standing derived across two blocks is refused, not classified', () => {
  const split = insuranceStanding(finalized(140n), {
    kind: 'read',
    value: { value: 100n, status: { kind: 'verified-finalized', chain: TEST_CHAIN, blockHash: '0xbeef', blockNumber: 7 } },
  });
  assert.equal(split.kind, 'incomparable');
});

test('an above-target INSURANCE says it is not income and not a surplus', () => {
  const aboveTarget = copy(insuranceCopy({ kind: 'awaiting-overflow', excess: 40n }));
  assert.match(aboveTarget, /not protocol income/);
  assert.match(aboveTarget, /not a surplus/);
  assert.match(aboveTarget, /revenue routes entirely to MAIN/);
  // And the below-target copy says where it refills from, which is not revenue either.
  assert.match(copy(insuranceCopy({ kind: 'below-target', shortfall: 1n })), /not funded from revenue/);
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
  const notYet = snapshotCrankState(finalized(7), finalized(3), false, false);
  assert.equal(notYet.kind, 'no-op');
  assert.match(copy(noOpWarning(notYet)), /pay a fee and change nothing/);

  const done = snapshotCrankState(finalized(7), finalized(3), true, true);
  assert.equal(done.kind, 'no-op');
  assert.equal(done.reason, 'already-taken');
  assert.match(copy(noOpWarning(done)), /already exists for this epoch at this MetricSpec version/);

  // Ready is distinct, and carries no warning — so the control is not vacuously warning.
  const ready = snapshotCrankState(finalized(7), finalized(3), true, false);
  assert.equal(ready.kind, 'ready');
  assert.equal(noOpWarning(ready), undefined);
});

test('"already taken" is keyed on the PAIR, so a second admissible version is not refused', () => {
  // `Welfare.Snapshots` is keyed `(epoch, spec_version)` and the call is
  // `record_snapshot(epoch, spec_version)`. A bare `alreadyTaken` boolean stood in for the
  // epoch alone, so across a MetricSpec amendment a lawful record at the **active** version
  // was refused because some *other* version already had one for that epoch — a client
  // refusing what the chain accepts, on the crank whose overdue state engages the dead-man
  // rule. The signature no longer admits an epoch-only answer.
  const otherVersionTaken = snapshotCrankState(finalized(7), finalized(4), true, false);
  assert.equal(otherVersionTaken.kind, 'ready', 'a lawful second-version record was refused');
  assert.equal(otherVersionTaken.specVersion.value, 4, 'the version must travel with the state');
  // And the refusal copy names the pair, so an operator can tell a genuine no-op from this.
  const taken = snapshotCrankState(finalized(7), finalized(4), true, true);
  assert.match(copy(noOpWarning(taken)), /about the pair, not about the epoch/);
  // The version must reach the screen too: without it "a snapshot already exists" cannot be
  // told apart from the defect above, which is the whole reason the pair is carried.
  const html = renderToStaticMarkup(
    h(SnapshotCrank, {
      epoch: finalized(7), specVersion: finalized(4), boundaryPassed: true, takenAtThisVersion: false,
      staleness: snapshotStaleness(finalized(100), finalized(200), 1_000, 5_000),
      session: readySession('O-7'), onCrank: noSubmit,
    }),
  );
  assert.ok(fieldPresent(html, 'MetricSpec version'), html);
  assert.match(html, />4</, 'the version itself must be on screen, badged');
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
  const unknown: ChallengeWindow = { kind: 'indeterminate', reason: 'the storage read failed' };
  assert.equal(mayChallenge(unknown), false);
  assert.match(copy(challengeWindowCopy(unknown)), /not assuming the base window/);
  assert.match(copy(challengeWindowCopy(unknown)), /out of time when you are not/);

  assert.equal(mayChallenge({ kind: 'open', closesAt: finalized(9_000), extended: true }), true);
  assert.match(
    challengeWindowCopy({ kind: 'open', closesAt: finalized(9_000), extended: true }),
    /extended by watchtower quorum/,
  );
  assert.equal(mayChallenge({ kind: 'closed', closedAt: finalized(100) }), false);
});

// -------------------------- S14 the reporter console, and SQ-564's stated gap (F17)

const REGISTRATION = (over: Partial<RegistrationInputs> = {}): RegistrationInputs => ({
  freeUsdc: finalized(200_000_000_000n),
  reporterStake: finalized(100_000_000_000n),
  alreadyRegistered: finalized(false),
  ...over,
});

test('the check can never present itself as complete', () => {
  // SQ-564: two conditions are not client-readable because 02 §7 does not freeze the store
  // they live in. `uncheckable` is a REQUIRED field, so there is no shape of the result in
  // which they are absent — a screen cannot render a green "ready to sign".
  const clean = checkRegistration(REGISTRATION());
  assert.deepEqual(clean.blocks, []);
  assert.equal(clean.uncheckable.length, 2);
  // Even when everything checkable blocks, the uncheckable list is still there.
  const blocked = checkRegistration(REGISTRATION({ alreadyRegistered: finalized(true) }));
  assert.equal(blocked.uncheckable.length, 2);
});

test('each unreadable condition names its dispatch error and why it cannot be read', () => {
  // "This might fail" teaches nothing. Named, a user recognises the outcome when it
  // arrives and a support conversation starts in the right place.
  const codes = UNCHECKABLE_REGISTRATION_CONDITIONS.map((c) => c.dispatchError).sort();
  assert.deepEqual(codes, ['ReporterEjected', 'ReporterRecordsSaturated']);
  for (const condition of UNCHECKABLE_REGISTRATION_CONDITIONS) {
    assert.ok(condition.condition.length > 10, 'the condition is not stated in words');
    assert.match(condition.why, /does not freeze|not readable through any frozen surface/);
  }
});

test('the caveat does not say "ready to sign", and says what a failure costs', () => {
  const caveat = registrationCaveat(checkRegistration(REGISTRATION()));
  assert.ok(!/ready to sign/i.test(caveat), caveat);
  assert.match(caveat, /Everything this client can check passes/);
  assert.match(caveat, /ReporterEjected/);
  assert.match(caveat, /ReporterRecordsSaturated/);
  // And it is honest about the outcome: the stake is safe, the fee is not.
  assert.match(caveat, /the stake is not taken — but the fee is spent/);
});

test('the checkable preconditions still work, so the gap is not an excuse', () => {
  assert.deepEqual(
    checkRegistration(REGISTRATION({ alreadyRegistered: finalized(true) })).blocks.map((b) => b.check),
    ['Already registered'],
  );
  assert.deepEqual(
    checkRegistration(REGISTRATION({ freeUsdc: finalized(1n) })).blocks.map((b) => b.check),
    ['Reporter stake'],
  );
});

// ------------------------------------------- the rendered operator consoles (F17)

const ACTION_ROW = (): PendingAction => ({
  actionId: finalized('0xacc'),
  power: finalized('activate_playbook'),
  target: finalized('cohort-42'),
  justificationHash: finalized('0xjust'),
  dispatched: finalized(false),
  approvals: finalized(2),
  threshold: finalized(5),
  expiresAt: finalized(9_000),
  calls: [CALL('Epoch', 'force_rerun')],
});

test('m-of-n shows BOTH numbers — never a percentage and never a bar alone', () => {
  // "3 of 5 required" tells a guardian whether their signature closes it. "60%" does not,
  // and at 4-of-5 versus 5-of-7 a bar looks the same while the decisions differ entirely.
  const html = renderToStaticMarkup(
    h(PendingActions, { actions: [ACTION_ROW()], justifications: () => JUSTIFICATION(), onOpen: () => {} }),
  );
  assert.match(html, />2</, 'the approvals so far must be on screen');
  assert.match(html, />5</, 'the threshold must be on screen');
  assert.ok(!html.includes('%'), 'a percentage replaces the two numbers that matter');
});

test('a blocked approval lists EVERY reason, not the first', () => {
  // The model returns them all; a screen rendering only the first teaches a guardian who
  // fixes one blocker and hits the next that the screen is guessing.
  const html = renderToStaticMarkup(
    h(ApproveAction, {
      context: {
        action: ACTION_ROW(),
        callerIsMember: false,
        callerHasApproved: true,
        now: finalized(99_999),
        justification: JUSTIFICATION(),
      },
      session: readySession('O-3'),
      onApprove: noSubmit,
    }),
  );
  // Asserted on the notice HEADINGS, not on the raw string. The button's `title` joins every
  // block check into one attribute, so `html.includes('Expiry')` passes even when a single
  // notice rendered — a mutation dropping all but the first survived exactly that way.
  const headings = [...html.matchAll(/<strong class="notice__heading">([^<]*)<\/strong>/g)].map(
    (match) => match[1],
  );
  // Three headings, and it used to be five. Contract v28 froze `Guardian.PendingActions` and
  // `Guardian.Approvals` (SQ-616), so O-3's pending-action read is an ordinary clause and the
  // row carries no unreadable obligation at all — which also removes the caveat list the gate
  // control renders for one. Until that seam was retired every render of this control carried
  // a blocking reason and the approve button could never open, so this suite had only ever
  // seen S15 refuse.
  assert.deepEqual(headings.sort(), ['Already approved', 'Expiry', 'Membership']);
});

test('the unratified consequence renders BEFORE any propose action, unconditionally', () => {
  // §11.8.2 requires it stated. The moment it matters is while the guardian is deciding, so
  // it is not behind the button — and it renders on the clean path too, where a screen that
  // showed it only alongside a refusal would omit it exactly when the action will happen.
  const clean = renderToStaticMarkup(
    h(ProposeAction, {
      meter: { power: 'pause_intake', used: finalized(0), limit: finalized(3) },
      inputs: { args: { power: 'pause_intake', until: 5_000 }, justificationHash: '0xj' },
      session: readySession('O-4'),
      onPropose: noSubmit,
    }),
  );
  assert.ok(clean.includes(UNRATIFIED_CONSEQUENCE), 'must state the bond consequence');
  assert.ok(
    clean.indexOf(UNRATIFIED_CONSEQUENCE) < clean.indexOf('Propose</button>'),
    'the consequence must precede the button, not follow it',
  );
});

test('a propose panel offers nothing when the allowance cannot be established', () => {
  const html = renderToStaticMarkup(
    h(ProposeAction, {
      meter: {
        power: 'pause_intake',
        used: finalized(0, 1_000_000),
        limit: { value: 3, status: { kind: 'verified-finalized', chain: TEST_CHAIN, blockHash: '0xbeef', blockNumber: 9 } },
      },
      inputs: { args: { power: 'pause_intake', until: 5_000 }, justificationHash: '0xj' },
      session: readySession('O-4'),
      onPropose: noSubmit,
    }),
  );
  assert.ok(buttonDisabled(html, 'Propose'), html);
  assert.match(html, /cannot establish/);
  assert.match(html, /Not available/, 'the figure is withheld, not fabricated');
});

test('the reporter console shows its two unreadable conditions on the CLEAN path', () => {
  // The dangerous rendering is a green "ready to sign" when nothing checkable blocks — that
  // is exactly when the caveat carries information, and exactly when a screen is tempted to
  // drop it.
  const html = renderToStaticMarkup(
    h(RegisterReporter, {
      inputs: {
        freeUsdc: finalized(10_000_000n),
        reporterStake: finalized(1_000_000n),
        alreadyRegistered: finalized(false),
      },
      decimals: 6,
      symbol: 'USDC',
      session: readySession('O-1'),
      onRegister: noSubmit,
    }),
  );
  for (const condition of UNCHECKABLE_REGISTRATION_CONDITIONS) {
    assert.ok(html.includes(condition.dispatchError), `${condition.dispatchError} must appear`);
  }
  assert.ok(!html.includes('ready to sign'), 'must never claim a complete check');
  assert.match(html, /the fee is spent/, 'the cost of the failure it cannot predict');
});

test('a no-op crank is disabled and says the fee would be spent for nothing', () => {
  const html = renderToStaticMarkup(
    h(SnapshotCrank, {
      epoch: finalized(7),
      specVersion: finalized(3),
      boundaryPassed: false,
      takenAtThisVersion: false,
      staleness: snapshotStaleness(finalized(100), finalized(200), 1_000, 5_000),
      session: readySession('O-7'),
      onCrank: noSubmit,
    }),
  );
  assert.ok(buttonDisabled(html, 'Take the snapshot'), html);
  assert.match(html, /pay a fee and change nothing/);
  // And the ready case is enabled, so the refusal is not vacuous.
  const ready = renderToStaticMarkup(
    h(SnapshotCrank, {
      epoch: finalized(7),
      specVersion: finalized(3),
      boundaryPassed: true,
      takenAtThisVersion: false,
      staleness: snapshotStaleness(finalized(100), finalized(200), 1_000, 5_000),
      session: readySession('O-7'),
      onCrank: noSubmit,
    }),
  );
  assert.ok(!buttonDisabled(ready, 'Take the snapshot'), ready);
});

test('a registry filing states what a challenge holds — on every arm of the window', () => {
  // The natural reading of "a challenge is open" is that governance is paused. It is not,
  // and the sentence must not be conditional on the window being open.
  for (const window of [
    { kind: 'open', closesAt: finalized(900), extended: false },
    { kind: 'closed', closedAt: finalized(100) },
    { kind: 'indeterminate', reason: 'the watchtower read failed' },
  ] satisfies readonly ChallengeWindow[]) {
    const html = renderToStaticMarkup(
      h(RegistryFiling, {
        filingId: finalized('0xfile'),
        window,
        inputs: CHALLENGE_FILING(),
        decimals: 6,
        symbol: 'USDC',
        evidence: EVIDENCE_FIXTURE,
        session: readySession('O-9'),
        onChallenge: noSubmit,
      }),
    );
    assert.ok(html.includes(REGISTRY_HOLDS_SETTLEMENT), `missing on ${window.kind}`);
  }
});

test('an indeterminate challenge window disables the challenge rather than guessing', () => {
  const html = renderToStaticMarkup(
    h(RegistryFiling, {
      filingId: finalized('0xfile'),
      window: { kind: 'indeterminate', reason: 'the watchtower read failed' },
      inputs: CHALLENGE_FILING(),
      decimals: 6,
      symbol: 'USDC',
      evidence: EVIDENCE_FIXTURE,
      session: readySession('O-9'),
      onChallenge: noSubmit,
    }),
  );
  assert.ok(buttonDisabled(html, 'Challenge this filing'), html);
  assert.match(html, /cannot say when the window closes/);
});

test('INSURANCE renders its classification and never a bare balance beside it', () => {
  // E1: a rising INSURANCE balance is not protocol income. A number a reader can watch move
  // is an invitation to read it as one, so the panel shows the standing and the copy only.
  const html = renderToStaticMarkup(
    h(InsurancePanel, { standing: insuranceStanding(finalized(140n), READ_TARGET(100n)) }),
  );
  assert.match(html, /awaiting-overflow/);
  assert.match(html, /not protocol income/);
  assert.ok(!html.includes('140'), 'the raw balance must not be rendered beside the copy');
});

test('an unestablished INSURANCE standing renders the refusal, never a classification', () => {
  const html = renderToStaticMarkup(
    h(InsurancePanel, {
      standing: insuranceStanding(finalized(140n), {
        kind: 'unestablished',
        reason: INSURANCE_TARGET_UNREADABLE,
      }),
    }),
  );
  assert.match(html, /unestablished/);
  assert.doesNotMatch(html, /at-target|below-target|awaiting-overflow/, 'a standing was invented');
  assert.match(html, /not protocol income/, 'the one thing that holds either way must survive');
});

test('a claimable amount derived across two blocks is withheld in the streams table', () => {
  const stream = STREAM({
    claimed: { value: 0n, status: { kind: 'verified-finalized', chain: TEST_CHAIN, blockHash: '0xbeef', blockNumber: 9 } },
  });
  const html = renderToStaticMarkup(
    h(TreasuryStreams, {
      streams: [stream],
      now: finalized(600),
      decimals: 6,
      symbol: 'USDC',
      callerIsRecipient: () => true,
      onSelect: () => {},
    }),
  );
  assert.match(html, /Not available/);
  assert.ok(buttonDisabled(html, 'Claim'), 'no claim is offered against a figure it cannot state');
});

test('every stream row carries its own claim control, named by that row', () => {
  // Three defects lived in the gap between the table and a second loop of buttons: every
  // button read "Claim" with nothing naming its stream, the loop **skipped** blocked streams
  // so the nth button was not the nth row, and `describedBy` pointed at an id no element
  // carried — an `aria-describedby` to nothing, which reads as an unlabelled control rather
  // than as a degraded one.
  const claimable = STREAM({ id: finalized('s1') });
  const blocked = STREAM({ id: finalized('s2'), cancelled: finalized(true) });
  const html = renderToStaticMarkup(
    h(TreasuryStreams, {
      streams: [blocked, claimable],
      now: finalized(600),
      decimals: 6,
      symbol: 'USDC',
      callerIsRecipient: () => true,
      onSelect: () => {},
    }),
  );
  // One control per stream — a blocked one is disabled with a reason, never absent, since
  // absence reads as "this stream has no claim action".
  assert.equal((html.match(/>Claim<\/button>/g) ?? []).length, 2, html);
  // Every `aria-describedby` resolves to an element that exists in this markup.
  const referenced = [...html.matchAll(/aria-describedby="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(referenced.sort(), ['stream-s1', 'stream-s2'], html);
  for (const id of referenced) {
    assert.ok(html.includes(`id="${id}"`), `aria-describedby="${id}" resolves to nothing`);
  }
});

const AUTH_FOR_SCREEN = () => ({ codeHash: finalized('0xcode'), applicableAt: finalized(5_000) });

test('the upgrade crank offers nothing until an artifact has been verified', () => {
  // The structural half is in the model — `UpgradeSubmission` requires a `VerifiedArtifact`,
  // whose only mint site is `verifyArtifact`. The screen's job is to not imply otherwise.
  const html = renderToStaticMarkup(
    h(UpgradeCrank, {
      submission: undefined,
      authorized: AUTH_FOR_SCREEN(),
      now: finalized(9_000),
      fee: COVERED_FEE(),
      decimals: 12,
      symbol: 'VIT',
      session: readySession('O-6'),
      onSubmit: noSubmit,
    }),
  );
  assert.ok(buttonDisabled(html, 'Submit the upgrade'), html);
  assert.match(html, /hashed on this device/);
});

test('the FE-P10 outlook precedes the submit control, because it decides whether to start', async () => {
  const artifact = await verifyArtifact(
    chunkSource([new Uint8Array(3 * 1024 * 1024)]),
    AUTH_FOR_SCREEN(),
    recordingHasher('0xcode').hasher,
  );
  const html = renderToStaticMarkup(
    h(UpgradeCrank, {
      submission: { artifact, authorized: AUTH_FOR_SCREEN() },
      authorized: AUTH_FOR_SCREEN(),
      now: finalized(9_000),
      fee: COVERED_FEE(),
      decimals: 12,
      symbol: 'VIT',
      session: readySession('O-6'),
      onSubmit: noSubmit,
    }),
  );
  assert.match(html, /has not been established \(FE-P10\)/);
  assert.ok(
    html.indexOf('FE-P10') < html.indexOf('Submit the upgrade'),
    'the outlook must come before the control it qualifies',
  );
  // **The control opens, and until this review it could not.** `UNREADABLE['O-6']` declared
  // both of §11.8.4's reads unfrozen and `blocking`, so `operatorGate` returned `blocked`
  // for every session — contract v28 had already frozen `System.AuthorizedUpgrade` and
  // `ExecutionGuard.PendingUpgrade` in this branch's own base and PLAN.md marked SQ-615
  // resolved. S17 was unreachable, and this assertion said so instead of exercising it: a
  // verified artifact, a reached `applicable_at`, covered fees and a live gate is the whole
  // point of the screen.
  assert.ok(!buttonDisabled(html, 'Submit the upgrade'), html);
  assert.ok(!/SQ-615/.test(html), 'a resolved spec question is still closing this control');
  assert.ok(!/No artifact has been verified/.test(html), 'the artifact half must have succeeded');
});

test('an upgrade before its stored applicable_at is refused with the chain’s own field', async () => {
  const artifact = await verifyArtifact(
    chunkSource([new Uint8Array(16)]),
    AUTH_FOR_SCREEN(),
    recordingHasher('0xcode').hasher,
  );
  const html = renderToStaticMarkup(
    h(UpgradeCrank, {
      submission: { artifact, authorized: AUTH_FOR_SCREEN() },
      authorized: AUTH_FOR_SCREEN(),
      now: finalized(4_999),
      fee: COVERED_FEE(),
      decimals: 12,
      symbol: 'VIT',
      session: readySession('O-6'),
      onSubmit: noSubmit,
    }),
  );
  assert.ok(buttonDisabled(html, 'Submit the upgrade'), html);
  // SQ-552: the field is read, not recomputed, and the copy says so rather than presenting
  // a countdown this client derived.
  assert.match(html, /not a countdown this client computed/);
});

test('§11.8.4 step 4 fee headroom is displayed, and a shortfall blocks the submission', async () => {
  const artifact = await verifyArtifact(
    chunkSource([new Uint8Array(16)]),
    AUTH_FOR_SCREEN(),
    recordingHasher('0xcode').hasher,
  );
  const html = renderToStaticMarkup(
    h(UpgradeCrank, {
      submission: { artifact, authorized: AUTH_FOR_SCREEN() },
      authorized: AUTH_FOR_SCREEN(),
      now: finalized(9_000),
      fee: { asset: 'VIT', free: finalized(1n), estimatedFee: finalized(1_000_000_000_000n) },
      decimals: 12,
      symbol: 'VIT',
      session: readySession('O-6'),
      onSubmit: noSubmit,
    }),
  );
  // The **exact** label, not a substring: `assert.match(html, /Fee headroom/)` passes on a
  // field renamed `Fee headroom-NOT`, and a mutation doing exactly that survived the first
  // version of this test.
  assert.ok(fieldPresent(html, 'Fee headroom'), 'the figure step 4 asks to display is absent');
  assert.match(html, /short by/);
  assert.ok(buttonDisabled(html, 'Submit the upgrade'), html);
});

test('E19 renders fetch progress and the lead-time countdown', async () => {
  const artifact = await verifyArtifact(
    chunkSource([new Uint8Array(16)]),
    AUTH_FOR_SCREEN(),
    recordingHasher('0xcode').hasher,
  );
  const html = renderToStaticMarkup(
    h(UpgradeCrank, {
      submission: { artifact, authorized: AUTH_FOR_SCREEN() },
      authorized: AUTH_FOR_SCREEN(),
      now: finalized(4_900),
      progress: { bytesRead: 2_097_152, totalBytes: 5_242_880 },
      fee: COVERED_FEE(),
      decimals: 12,
      symbol: 'VIT',
      session: readySession('O-6'),
      onSubmit: noSubmit,
    }),
  );
  assert.match(html, /2\.0 MiB of 5\.0 MiB/, 'E19 requires fetch progress');
  assert.ok(
    fieldPresent(html, 'Blocks until applicable'),
    'E19 requires the DescriptorLeadTime countdown',
  );
  assert.match(html, />100</, 'the countdown must show the remaining blocks');
});

test('a hash mismatch is a refusal with both hashes — never a retry', () => {
  // Re-downloading cannot make different bytes into the authorized ones. Offering "try
  // again" would suggest the failure was transport rather than identity.
  const html = renderToStaticMarkup(
    h(UpgradeHashMismatch, { expected: '0xcode', computed: '0xother' }),
  );
  assert.match(html, /FE-UPG-001/);
  assert.match(html, /0xcode/);
  assert.match(html, /0xother/);
  assert.match(html, /will not change this result/);
  assert.ok(!/retry|Retry|try again</.test(html), `must not offer a retry: ${html}`);
});

test('a pending declaration expires the moment its component exists — in both directions', async () => {
  // Prose could not hold this. Within a day of the "name the reason" fix, nine entries still
  // read "F17 — the reporter console" for screens that had since been built, because nothing
  // made the claim answerable. So each entry names the component it waits on, and both
  // directions are checked:
  //
  //   built-unwired whose component is ABSENT  → a false promise;
  //   not-built     whose component is PRESENT → exactly the staleness above, and this now
  //                                              fails the build the moment it lands.
  //
  // The second direction is the point: a declaration that cannot outlive the condition it
  // describes, the same mechanical expiry the monitoring seams and the limit-coverage
  // registry use.
  const modules = {
    '@bleavit/features-tx': await import('@bleavit/features-tx'),
    '@bleavit/features-handoff': await import('@bleavit/features-handoff'),
  };
  const wrong = [];
  for (const [id, pending] of Object.entries(PENDING_SCREENS)) {
    const [pkg, name] = pending.component.split('#');
    assert.ok(pkg !== undefined && name !== undefined, `${id} has a malformed component reference`);
    const module = (modules as Record<string, object>)[pkg];
    assert.ok(module, `${id} names an unknown package ${pkg}`);
    const exists = name in module;
    if (pending.state === 'built-unwired' && !exists) {
      wrong.push(`${id}: declared built-unwired, but ${pending.component} does not exist`);
    }
    if (pending.state === 'not-built' && exists) {
      wrong.push(
        `${id}: declared not-built, but ${pending.component} EXISTS — the entry is stale. ` +
          "Change it to state: 'built-unwired' and say what it is waiting on.",
      );
    }
  }
  assert.deepEqual(wrong, []);
});

test('the pending copy distinguishes the two reasons in words a user reads', () => {
  // The structured entry is for the checker; this is what reaches the screen. "Not built"
  // and "built, waiting on a transport" are different promises and must read differently.
  //
  // The examples are **derived** from `PENDING_SCREENS` rather than named by hash. The first
  // version pinned `#/positions` as its not-built case and broke the day S4 was built —
  // which is the right kind of failure in the wrong file, since the fixture was an accident
  // of which milestone had landed rather than anything about the copy.
  const hashFor = (id: string): string => {
    const screen = SCREENS.find((candidate) => candidate.id === id);
    assert.ok(screen !== undefined, `${id} is pending but not in the inventory`);
    return screen.path;
  };
  const pick = (state: string): string | undefined =>
    Object.entries(PENDING_SCREENS).find(([, pending]) => pending.state === state)?.[0];

  // `pendingCopy` is asserted directly as well as through the outlet, because Track F ends
  // with `not-built` empty and a render-only test would then quietly stop exercising that
  // arm — the vacuity this repository keeps finding in its own checkers.
  assert.match(
    pendingCopy({ state: 'not-built', milestone: 'FX', component: '@bleavit/x#Y' }),
    /has not been built yet/,
  );
  assert.match(
    pendingCopy({
      state: 'built-unwired',
      milestone: 'FX',
      component: '@bleavit/x#Y',
      waitingOn: 'a live transport',
    }),
    /this screen is built; it is waiting on a live transport/,
  );

  const notBuilt = pick('not-built');
  if (notBuilt !== undefined) {
    const unbuilt = renderToStaticMarkup(
      h(Outlet, { hash: hashFor(notBuilt), handoffEnabled: true, implemented: {} }),
    );
    assert.match(unbuilt, /has not been built yet/);
  }

  const unwiredId = pick('built-unwired');
  assert.ok(unwiredId !== undefined, 'no screen is declared built-unwired');
  const unwired = renderToStaticMarkup(
    h(Outlet, { hash: hashFor(unwiredId), handoffEnabled: true, implemented: {} }),
  );
  assert.match(unwired, /this screen is built; it is waiting on/);
  assert.ok(!unwired.includes('has not been built yet'), unwired);
});

// -------------------------------- §11.8.2's enumerated call batch (F17)

test('the approve flow renders every call in the batch, decoded', () => {
  // §11.8.2: "playbooks are preimage-committed enumerated batches — decoded and displayed,
  // never summarized away". A count, a summary, or the justification hash alone would each
  // let a guardian put the system's most privileged signature behind calls nobody read.
  const html = renderToStaticMarkup(
    h(ApproveAction, {
      context: {
        action: ACTION({ calls: [CALL('Constitution', 'set_param'), CALL('Epoch', 'force_rerun')] }),
        callerIsMember: true,
        callerHasApproved: false,
        now: finalized(100),
        justification: JUSTIFICATION(),
      },
      session: readySession('O-3'),
      onApprove: noSubmit,
    }),
  );
  for (const name of ['Constitution', 'set_param', 'Epoch', 'force_rerun']) {
    assert.ok(html.includes(name), `${name} must be displayed: ${html}`);
  }
  // Present in the markup is not the same as shown. A mutation adding `hidden` to the list
  // left every assertion above passing while the batch was invisible, so the container is
  // checked for the markup-level ways to conceal it.
  //
  // **The limit is stated rather than implied**: CSS can still hide this list and no string
  // assertion over `renderToStaticMarkup` output can see that — the same boundary
  // `tests/ui` already declares for badge legibility. What is covered is concealment that
  // travels with the component; what is not is concealment that travels with the stylesheet.
  const list = /<ol class="call-batch"([^>]*)>/.exec(html);
  assert.ok(list !== null, `the batch list must render: ${html}`);
  assert.ok(!/\bhidden\b/.test(nth(list, 1, 'capture')), `the batch list is hidden: ${nth(list, 0, 'capture')}`);
  assert.ok(!/aria-hidden="true"/.test(nth(list, 1, 'capture')), `the batch list is aria-hidden: ${nth(list, 0, 'capture')}`);
  assert.ok(!/display:\s*none/.test(nth(list, 1, 'capture')), `the batch list is display:none: ${nth(list, 0, 'capture')}`);
  // **And the control opens.** Until contract v28 froze `Guardian.PendingActions` this row
  // carried a blocking unreadable obligation, so this assertion read `buttonDisabled` and
  // matched `SQ-616` — a test that could pass with the batch rendering nothing at all,
  // because the refusal came from somewhere else entirely. A decoded batch on a live session
  // is the case S15 exists for, and it is the case nothing had ever exercised.
  assert.ok(!buttonDisabled(html, 'Approve'), html);
  assert.ok(!/SQ-616/.test(html), 'a resolved spec question is still closing this control');
  assert.ok(!/Empty batch|Undecodable call/.test(html), `the batch itself must not block: ${html}`);
});

test('an undecodable call blocks the approval and renders as raw bytes, never a name', () => {
  // R-7's reading: on the powers that cannot be undone, "we could not decode it" must not
  // land on the same side as "we decoded it and it is fine". The undecodable arm carries no
  // pallet or call field, so no screen can render a guessed name for it.
  const html = renderToStaticMarkup(
    h(ApproveAction, {
      context: {
        action: ACTION({
          calls: [CALL(), { kind: 'undecodable', rawHex: '0xdeadbeef', reason: 'unknown call index' }],
        }),
        callerIsMember: true,
        callerHasApproved: false,
        now: finalized(100),
        justification: JUSTIFICATION(),
      },
      session: readySession('O-3'),
      onApprove: noSubmit,
    }),
  );
  assert.ok(buttonDisabled(html, 'Approve'), html);
  assert.match(html, /0xdeadbeef/);
  assert.match(html, /cannot be decoded/);
});

test('an empty batch is refused — it is not a harmless approval', () => {
  // The dangerous reading: no calls looks like nothing to worry about. It means the batch
  // could not be read at all, and approving it puts a signature behind something unseen.
  const blocks = approvalBlocks({
    action: ACTION({ calls: [] }),
    justification: JUSTIFICATION(),
    callerIsMember: true,
    callerHasApproved: false,
    now: finalized(100),
  } satisfies ApprovalContext);
  assert.deepEqual(blocks.map((b) => b.check), ['Empty batch']);
  assert.match(nth(blocks, 0, 'block').detail, /nobody has seen/);
});

test('snapshot staleness classifies against thresholds it is GIVEN, never ones it knows', () => {
  // App-code rule 7: "> 4 days" is a chain tunable, so both thresholds are required
  // arguments with no default. Baking them in would leave the client warning at the wrong
  // point after a governance amendment — late, which is the unsafe direction.
  assert.equal(stated(snapshotStaleness(finalized(0), finalized(500), 1_000, 5_000)).kind, 'current');
  assert.equal(stated(snapshotStaleness(finalized(0), finalized(1_000), 1_000, 5_000)).kind, 'overdue');
  assert.equal(
    stated(snapshotStaleness(finalized(0), finalized(5_000), 1_000, 5_000)).kind,
    'dead-man-engaged',
  );
  // Same age, different thresholds, different verdict — which is the point of passing them.
  assert.equal(stated(snapshotStaleness(finalized(0), finalized(5_000), 9_000, 9_999)).kind, 'current');
});

test('an engaged dead-man rule is a danger notice, not a staleness count', () => {
  // §11.8.5 + 05: past its threshold this is a system-wide state change, and a screen that
  // showed only "5,000 blocks since" would present an incident as housekeeping.
  const html = renderToStaticMarkup(
    h(SnapshotCrank, {
      epoch: finalized(7),
      specVersion: finalized(3),
      boundaryPassed: true,
      takenAtThisVersion: false,
      staleness: snapshotStaleness(finalized(0), finalized(6_000), 1_000, 5_000),
      session: readySession('O-7'),
      onCrank: noSubmit,
    }),
  );
  assert.match(html, /data-severity="danger"/);
  assert.match(html, /The dead-man rule is engaged/);
  assert.match(html, /stopped treating its welfare readings as current/);
  // And a current snapshot is not dressed as an incident, so the severity is not vacuous.
  const fine = renderToStaticMarkup(
    h(SnapshotCrank, {
      epoch: finalized(7),
      specVersion: finalized(3),
      boundaryPassed: true,
      takenAtThisVersion: false,
      staleness: snapshotStaleness(finalized(0), finalized(10), 1_000, 5_000),
      session: readySession('O-7'),
      onCrank: noSubmit,
    }),
  );
  assert.ok(!fine.includes('data-severity="danger"'), fine);
  assert.match(fine, /The welfare snapshot is current/);
});

// ---------------------------------------- §11.8.1 content-addressed evidence (F17)

test('evidence is admitted only when the received bytes re-hash to the recorded hash', () => {
  // A content address exists so the channel serving it need not be trusted, and an evidence
  // gateway is an arbitrary host in the one place a dispute is being decided.
  const bytes = new TextEncoder().encode('the filing');
  const ok = admitEvidence(bytes, finalized('0xabc'), () => '0xabc');
  assert.equal(ok.kind, 'admitted');
  assert.equal(ok.text, 'the filing');

  const wrong = admitEvidence(bytes, finalized('0xabc'), () => '0xdef');
  assert.equal(wrong.kind, 'hash-mismatch');
  assert.equal(wrong.expected, '0xabc');
  assert.equal(wrong.computed, '0xdef');
});

test('the hash function is a REQUIRED argument, so admission cannot default to unchecked', () => {
  // The `FE-HANDOFF-010` lesson: an optional digest function is a digest check that defaults
  // off. `admitEvidence.length` is 3 — there is no arity at which the hash can be omitted.
  assert.equal(admitEvidence.length, 3);
});

test('unavailable and mismatched are DIFFERENT facts, and neither is silent', () => {
  // 07 adjudicates unobtainable evidence as absent, so a blank panel would let a reader
  // conclude none was filed. The mismatch arm additionally says another gateway may help —
  // this one served something else.
  const missing = evidenceUnavailable(3);
  const html = renderToStaticMarkup(h(EvidencePanel, { state: missing, label: 'Evidence' }));
  assert.ok(html.includes(EVIDENCE_UNRETRIEVABLE), html);
  assert.match(html, /Sources tried: 3/);

  const mismatch = admitEvidence(new Uint8Array([1]), finalized('0xabc'), () => '0xdef');
  const mismatchHtml = renderToStaticMarkup(
    h(EvidencePanel, { state: mismatch, label: 'Evidence' }),
  );
  assert.match(mismatchHtml, /does not match the hash recorded on chain/);
  assert.match(mismatchHtml, /Trying a different gateway may retrieve the real document/);
  assert.ok(!html.includes('different gateway'), 'the unavailable arm must not claim a mismatch');
});

test('evidence renders as text, and markup in it stays text', () => {
  // Adversary-chosen bytes inside the console of the most privileged actors. The whole-app
  // control is `check:no-html-sinks`; this asserts the component itself escapes.
  const hostile = new TextEncoder().encode('<img src=x onerror="alert(1)">');
  const state = admitEvidence(hostile, finalized('0xh'), () => '0xh');
  const html = renderToStaticMarkup(h(EvidencePanel, { state, label: 'Evidence' }));
  assert.ok(!html.includes('<img'), `markup was not escaped: ${html}`);
  assert.match(html, /&lt;img/);
});

test('invalid UTF-8 shows replacement characters rather than blanking the document', () => {
  // Refusing to display on one bad byte would hand a filer a way to make their own evidence
  // unreadable while still hashing correctly. Replacement characters are visible; a blank
  // panel is not.
  const state = admitEvidence(new Uint8Array([0xff, 0x41]), finalized('0xu'), () => '0xu');
  assert.equal(state.kind, 'admitted');
  assert.match(state.text, /A$/);
  assert.ok(state.text.includes('\uFFFD'), JSON.stringify(state.text));
});

// ------------------------------------------------ §11.8.3 the nav() view (F17)

const NAV = (over: Partial<NavView> = {}): NavView => ({
  total: finalized(1_000_000_000n),
  main: finalized(400_000_000n),
  pol: finalized(300_000_000n),
  insurance: finalized(50_000_000n),
  keeper: finalized(10_000_000n),
  oracle: finalized(5_000_000n),
  rewards: finalized(5_000_000n),
  streamRemainders: finalized(20_000_000n),
  obligations: finalized(30_000_000n),
  haircutFlag: finalized(false),
  spendableNav: finalized(900_000_000n),
  meterUtilizationBps: finalized(1_500),
  classFloors: [finalized(100n), finalized(200n), finalized(300n), finalized(400n)],
  ...over,
});

test('the account lines cannot be presented as a decomposition — no sum is exported', () => {
  // §11.8.3: the account fields are a PARTIAL view; nine ops lines have no field, so the
  // parts do not add to `total`. The obvious table with a sum at the bottom is wrong, and a
  // reader who sees a decomposition assumes it decomposes.
  const lines = accountLines(NAV());
  assert.equal(lines.length, 6);
  for (const line of lines) {
    assert.equal(line.partialNote, PARTIAL_CUSTODY_NOTE, `${line.account} lost its note`);
  }
  // The parts genuinely do not add to the total, which is why no sum is offered.
  const parts = lines.reduce((acc, line) => acc + line.balance.value, 0n);
  assert.notEqual(parts, NAV().total.value);
});

test('under the haircut flag there is NO headline field to render full backing from', () => {
  // "The FE never renders full backing while the flag is set" cannot be a discipline — it is
  // one <Amount datum={nav.total}> away at all times. So the haircut arm has no `headline`
  // property at all; `total` exists only as a subordinate, explicitly-labelled line.
  const haircut = navPresentation(NAV({ haircutFlag: finalized(true), spendableNav: finalized(0n) }));
  assert.equal(haircut.kind, 'haircut');
  assert.ok(!('headline' in haircut), 'the haircut arm must expose no headline');
  assert.equal(haircut.headlineSpendable.value, 0n);
  assert.equal(haircut.banner, HAIRCUT_BANNER);
  assert.match(haircut.unbackedTotalLabel, /not backing available to spend/);

  const full = navPresentation(NAV());
  assert.equal(full.kind, 'full');
  assert.equal(full.headline.value, 1_000_000_000n);
});

test('the haircut banner is persistent and states PB-RESERVE verbatim', () => {
  const html = renderToStaticMarkup(
    h(NavPanel, {
      nav: NAV({ haircutFlag: finalized(true), spendableNav: finalized(0n) }),
      decimals: 6,
      symbol: 'USDC',
    }),
  );
  assert.ok(html.includes(HAIRCUT_BANNER), html);
  assert.match(html, /data-severity="danger"/);
  assert.match(html, /PB-RESERVE/);
  // A Notice takes no dismiss handler, so "persistent" is structural rather than styled.
  assert.ok(!/dismiss|close/i.test(html), 'the banner must not be dismissible');

  // The stated residual: the component also holds the raw NavView, so the type alone cannot
  // stop `nav.total` being rendered in headline position by hand. This is the check for that
  // deliberate bypass — under the flag there is no bare "NAV" field label, only
  // "Spendable NAV" and a "Gross total" that carries its own not-backing caveat.
  const labels = [...html.matchAll(/<span class="field__label">([^<]*)<\/span>/g)].map((m) => m[1] ?? '');
  assert.ok(!labels.includes('NAV'), `full backing rendered as the headline: ${labels}`);
  assert.ok(labels.includes('Spendable NAV'), labels.join(', '));
  assert.ok(labels.includes('Gross total'), labels.join(', '));
  // ...and the full-backing render DOES have it, so the assertion is not vacuous.
  const clean = renderToStaticMarkup(h(NavPanel, { nav: NAV(), decimals: 6, symbol: 'USDC' }));
  const cleanLabels = [...clean.matchAll(/<span class="field__label">([^<]*)<\/span>/g)].map((m) => m[1] ?? '');
  assert.ok(cleanLabels.includes('NAV'), cleanLabels.join(', '));
});

test('class-floor distance is continuous and measured against SPENDABLE nav', () => {
  // A pass/fail badge hides the approach: one USDC above a floor and a million above look
  // identical, and the first is about to stop being able to fund its class. Measured against
  // spendable_nav because under a haircut that is 0 and every floor is genuinely unmet —
  // measuring `total` would report floors met while the protocol refuses the spend.
  const rows = stated(floorDistances(NAV({ spendableNav: finalized(250n) })));
  assert.deepEqual(rows.map((r) => r.klass), [...FLOOR_CLASSES]);
  assert.deepEqual(rows.map((r) => r.distance), [150n, 50n, -50n, -150n]);
  assert.deepEqual(rows.map((r) => r.meetsFloor), [true, true, false, false]);

  const underHaircut = stated(
    floorDistances(NAV({ haircutFlag: finalized(true), spendableNav: finalized(0n) })),
  );
  assert.deepEqual(underHaircut.map((r) => r.meetsFloor), [false, false, false, false]);
});

test('an income figure cannot exist without its window, and says it is not lifetime', () => {
  // §11.8.3: derived from the ingest-set events within the committed history window and
  // "labelled as the partial, window-bounded total it is — never as lifetime protocol
  // revenue". There is no constructor for an unbounded one.
  const label = incomeLabel({
    revenueSwept: finalized(5n),
    redemptionFeesSwept: finalized(3n),
    fromBlock: 100,
    toBlock: 900,
  });
  assert.match(label, /between blocks 100 and 900/);
  assert.match(label, /not lifetime protocol revenue/);
  assert.match(label, /RevenueSwept and RedemptionFeesSwept/);
  // InsuranceSwept is not in 02 §5's ingest set, so nothing here may depend on it.
  assert.ok(!label.includes('InsuranceSwept'));
});

test('the conservative zeros are explained, not just shown as 0', () => {
  const html = renderToStaticMarkup(h(NavPanel, { nav: NAV(), decimals: 6, symbol: 'USDC' }));
  assert.match(html, /In-flight XCM: 0/);
  assert.match(html, /VIT holdings: 0/);
  assert.match(html, /not an asset the treasury can spend/);
  // And every NavView field reaches the screen.
  assert.match(html, /Stream remainders/);
  assert.match(html, /Obligations/);
  assert.match(html, /Rolling-meter utilization/);
  assert.match(html, /Class floors/);
});

// ------------------ §11.8.6 the pallet-bound ingest filter and the filing path (F17)

/** Just enough of `tools/release/surface-manifest.json` to name pallets and their fields. */
interface SurfaceManifest {
  readonly entries: readonly {
    readonly id: string;
    readonly pallet: string;
    readonly layout?: { readonly fields?: readonly { readonly name: string }[] };
  }[];
}

/**
 * The registry pallet names come from the **frozen surface manifest**, never from the module.
 *
 * V-169: this filter shipped bound to `REGISTRY_PALLET = 'Registry'` and this suite built its
 * fixtures out of that same constant, so the two agreed with each other while neither agreed
 * with the chain. **No pallet of that name exists** — `pallet-registry` is instantiated twice
 * — so the filter matched nothing, every real window event was rejected, and §11.8.6's
 * countdown adjustments could never happen. Nothing in a client with no live stream yet looks
 * different when that is true.
 *
 * `tools/release/surface-manifest.json` is the 02 §6 frozen surface: `surface:check`
 * byte-compares `CRITICAL_SURFACE` against it and `test:mock-runtime` checks that against real
 * recorded metadata in both directions. Taking the names from there is what makes this suite
 * unable to agree with a wrong constant — and it carries the field lists too, so the oracle
 * fixture below is the event the chain really emits rather than one written here to be refused.
 */
const SURFACE = JSON.parse(
  readFileSync(join(REPO, 'tools/release/surface-manifest.json'), 'utf8'),
) as SurfaceManifest;

function surfaceEntry(id: string): SurfaceManifest['entries'][number] {
  const entry = SURFACE.entries.find((candidate) => candidate.id === id);
  if (entry === undefined) throw new Error(`the frozen surface has no entry ${id}`);
  return entry;
}

function surfaceFields(id: string): readonly string[] {
  const fields = surfaceEntry(id).layout?.fields;
  if (fields === undefined) throw new Error(`${id} declares no field layout`);
  return fields.map((field) => field.name);
}

const REGISTRIES: RegistryInstances = {
  incident: surfaceEntry('event.registry.window_extended.incident').pallet,
  milestone: surfaceEntry('event.registry.window_extended.milestone').pallet,
};

test('there is no pallet named `Registry`, and the module holds no name of its own (V-169)', () => {
  const pallets = new Set(SURFACE.entries.map((entry) => entry.pallet));
  assert.ok(!pallets.has('Registry'), 'the frozen surface declares no pallet named `Registry`');
  assert.ok(pallets.has(REGISTRIES.incident));
  assert.ok(pallets.has(REGISTRIES.milestone));
  assert.notEqual(REGISTRIES.incident, REGISTRIES.milestone);

  // Asserted by absence, the way `upgrade-crank.ts` proves it does no lead-time arithmetic:
  // a chain identifier this module cannot name is one it cannot get wrong.
  // Comments stripped first, the way the upgrade crank's own absence test does it: a scan
  // over raw text sees the prose explaining why the name is absent and reports it present.
  const source = stripComments(
    readFileSync(join(REPO, 'app/src/features/tx/src/registry-filing.ts'), 'utf8'),
  );
  for (const name of ['Registry', REGISTRIES.incident, REGISTRIES.milestone]) {
    assert.ok(
      !source.includes(`'${name}'`) && !source.includes(`"${name}"`),
      `registry-filing.ts must not name ${name} — the instances are supplied`,
    );
  }
  // Not vacuous: the same scan finds the names where they DO live, in the frozen manifest.
  assert.ok(REGISTRIES.incident.length > 0 && REGISTRIES.milestone.length > 0);
});

test('two registries configured under one name throw rather than merging their ids', () => {
  // A composition mistake, not untrusted input. Collapsed, one filing's extension would move
  // the other's countdown — the same defect the pallet binding exists to prevent, one level
  // down, because the two instances allocate filing ids independently.
  assert.throws(
    () =>
      admitRegistryWindowEvent(REG_EXTENDED(), {
        incident: REGISTRIES.incident,
        milestone: REGISTRIES.incident,
      }),
    RegistryInstanceCollisionError,
  );
});

const REG_EXTENDED = (over: Partial<RawEvent> = {}): RawEvent => ({
  pallet: REGISTRIES.incident,
  variant: 'WindowExtended',
  fields: { epoch: 7, filing_id: 42, new_deadline: 9_000 },
  ...over,
});

test('an oracle event of the same name is refused — the filter binds the pallet', () => {
  // The defect hides perfectly: matching `variant === 'WindowExtended'` compiles, runs, and
  // ingests oracle events about a different sub-game. The symptom is a registry countdown
  // that moves when an ORACLE watchtower extends an ORACLE round, and a challenger who
  // trusted it misses their window.
  const oracleFields = surfaceFields('event.oracle.window_extended');
  assert.deepEqual([...oracleFields].sort(), ['component', 'epoch', 'new_deadline', 'round']);
  const fromOracle = admitRegistryWindowEvent(
    {
      pallet: surfaceEntry('event.oracle.window_extended').pallet,
      variant: 'WindowExtended',
      fields: Object.fromEntries(oracleFields.map((name) => [name, 1])),
    },
    REGISTRIES,
  );
  assert.equal(fromOracle.kind, 'rejected');
  assert.match(fromOracle.reason, /which is neither/);

  // Both registries' own events are admitted, so the refusal is not vacuous — and each says
  // WHICH registry allocated the id, because a bare `filingId` is not an identifier when two
  // independent allocators can both produce 42.
  for (const registry of ['incident', 'milestone'] as const) {
    const admitted = admitRegistryWindowEvent(
      REG_EXTENDED({ pallet: REGISTRIES[registry] }),
      REGISTRIES,
    );
    assert.equal(admitted.kind, 'admitted');
    assert.equal(admitted.event.variant, 'WindowExtended');
    assert.equal(admitted.event.registry, registry);
    assert.equal(admitted.event.filingId, 42);
    assert.equal(admitted.event.newDeadline, 9_000);
  }
});

test('a right-pallet, wrong-body event is refused too — checking the label trusts the labeller', () => {
  // The second direction. One check alone is weaker than it looks: an event labelled with a
  // registry while carrying `component`/`round` is the same failure arriving another way.
  const mislabelled = admitRegistryWindowEvent(
    REG_EXTENDED({ fields: { component: 3, epoch: 7, round: 2, filing_id: 42, new_deadline: 9_000 } }),
    REGISTRIES,
  );
  assert.equal(mislabelled.kind, 'rejected');
  assert.match(mislabelled.reason, /carries `component`/);
  assert.match(mislabelled.reason, /label and the body disagree/);
});

test('acknowledgements admit with their watchtower, and a missing field refuses', () => {
  const ack = admitRegistryWindowEvent(
    {
      pallet: REGISTRIES.milestone,
      variant: 'WindowAcknowledged',
      fields: { epoch: 7, filing_id: 42, watchtower: '5Gw...' },
    },
    REGISTRIES,
  );
  assert.equal(ack.kind, 'admitted');
  assert.equal(ack.event.variant, 'WindowAcknowledged');
  assert.equal(ack.event.registry, 'milestone');
  assert.equal(ack.event.watchtower, '5Gw...');
  // The manifest's own field list for that event, so the fixture cannot drift from the chain.
  assert.deepEqual(
    [...surfaceFields('event.registry.window_acknowledged.milestone')].sort(),
    ['epoch', 'filing_id', 'watchtower'],
  );

  // A refusal, never a silent drop: an event this client cannot read is information, and a
  // countdown built on a stream nobody audited is how the wrong deadline gets rendered.
  const truncated = admitRegistryWindowEvent(
    REG_EXTENDED({ fields: { epoch: 7, filing_id: 42 } }),
    REGISTRIES,
  );
  assert.equal(truncated.kind, 'rejected');
  assert.match(truncated.reason, /missing `new_deadline`/);
});

test('a filing is blocked by bond, bounds and evidence independently', () => {
  const ok = filingBlocks({
    kind: 'incident',
    freeUsdc: finalized(1_000n),
    filingBond: finalized(100n),
    filingsUsed: finalized(3),
    filingsBound: finalized(10),
    evidenceHash: '0xev',
  });
  assert.deepEqual(ok, []);

  const all = filingBlocks({
    kind: 'incident',
    freeUsdc: finalized(10n),
    filingBond: finalized(100n),
    filingsUsed: finalized(10),
    filingsBound: finalized(10),
    evidenceHash: undefined,
  });
  assert.deepEqual(all.map((b) => b.check), ['Filing bond', 'Registry bounds', 'Evidence']);
  // The bond is value-scaled, so the copy says it is read rather than fixed — a client that
  // implied a constant would under-report after the first amendment.
  assert.match(nth(all, 0, 'block').detail, /value-scaled/);
  // Filing without evidence commits a claim that adjudicates as unsupported.
  assert.match(nth(all, 2, 'block').detail, /adjudicated as\s+absent/);

  // An EMPTY hash is not a hash. Checking only for `undefined` let `''` through, which is
  // what an unfilled form field actually produces — the mutation that survived first pass.
  const empty = filingBlocks({
    kind: 'milestone',
    freeUsdc: finalized(1_000n),
    filingBond: finalized(100n),
    filingsUsed: finalized(0),
    filingsBound: finalized(10),
    evidenceHash: '',
  });
  assert.deepEqual(empty.map((b) => b.check), ['Evidence']);
});

test('the pending-actions list shows the target, not just the power', () => {
  // "delay_once" says a delay is proposed and not what is being delayed; a guardian cannot
  // weigh a force_rerun without knowing which cohort it re-runs.
  const html = renderToStaticMarkup(
    h(PendingActions, { actions: [ACTION_ROW()], justifications: () => JUSTIFICATION(), onOpen: () => {} }),
  );
  assert.match(html, /Target/);
  assert.match(html, /cohort-42/);
});

// ------------------------------- §11.8.1 `oracle.recompute_proof` (F17)

const RECOMPUTE = (over: Partial<RecomputeInputs> = {}): RecomputeInputs => ({
  component: 3,
  epoch: 7,
  specVersion: 2,
  claimedValue1e9: finalized(1_234_000_000n),
  deterministic: finalized(true),
  rawData: new Uint8Array([1, 2, 3]),
  ...over,
});

test('a proof the client cannot reproduce is never submittable — the type has no path', () => {
  // §11.8.1: "never submit a proof the client's own recomputation contradicts". A comparison
  // a caller is asked to remember is not "never", so `RecomputedProof` is branded with one
  // mint site and `RecomputeSubmission` requires one.
  assert.throws(
    () => recomputeProof(RECOMPUTE(), () => 9_999n),
    (error) => {
      assert.ok(error instanceof ProofMismatchError);
      assert.equal(error.claimed, 1_234_000_000n);
      assert.equal(error.recomputed, 9_999n);
      assert.match(error.message, /stakes your bond on a number you have already disproved/);
      return true;
    },
  );
  // Agreement mints it, so the refusal is not vacuous.
  const proof = recomputeProof(RECOMPUTE(), () => 1_234_000_000n);
  assert.equal(proof.value1e9, 1_234_000_000n);
  assert.equal(proof.specVersion, 2);
});

test('a non-deterministic component is refused rather than evaluated', () => {
  // The half a client would skip. Running an evaluator over a non-deterministic component
  // produces a number, and a number that disagrees looks like fraud when it is really a
  // component nobody promised would reproduce.
  let evaluated = false;
  assert.throws(
    () =>
      recomputeProof(RECOMPUTE({ deterministic: finalized(false) }), () => {
        evaluated = true;
        return 1n;
      }),
    NonDeterministicComponentError,
  );
  assert.equal(evaluated, false, 'the evaluator must not run on a non-deterministic component');
});

test('the evaluator is a required argument, so recomputation cannot default off', () => {
  // The `FE-HANDOFF-010` shape again: an optional check is a check that defaults off.
  assert.equal(recomputeProof.length, 2);
});

test('a closed round blocks submission even with a reproduced proof', () => {
  // §11.8.1's precondition has two halves and both are read at B′.
  const proof = recomputeProof(RECOMPUTE(), () => 1_234_000_000n);
  assert.equal(maySubmitRecompute({ proof, roundOpen: finalized(true) }), true);
  assert.equal(maySubmitRecompute({ proof, roundOpen: finalized(false) }), false);
});

// --------------------- §11.8.1 `oracle.report` / `oracle.challenge` — P-13/P-14 (F17)

// Real SS58 addresses, because 07 §5.2's self-challenge refusal is decided on the **public
// key** and `accountKey` refuses anything that is not a valid 32-byte account. Placeholder
// strings would take every case down the `undecidable` arm and quietly stop exercising the
// comparison this fixture exists to drive. Alice and Bob, generic prefix 42 — deliberately
// *not* the 7777 that 02 §8 freezes, since the whole point is that the prefix is not the
// identity. `REPORTER_SS58_LOCAL_PREFIX` is the same key under 7777, derived rather than typed.
const REPORTER_SS58 = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
const CHALLENGER_SS58 = '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty';
/** The same key as `REPORTER_SS58`, rendered under this chain's own prefix 7777 (02 §8). */
const REPORTER_SS58_LOCAL_PREFIX = 'fvJdNW3p1BT1RfWzfZegj9tbVTUAXWf6Zf5kD9sJukyeafVR8';

const ROUND = (over: Partial<OracleRound> = {}): OracleRound => ({
  component: finalized(3),
  epoch: finalized(7),
  specVersion: finalized(2),
  round: finalized(2),
  reporter: finalized(REPORTER_SS58),
  value1e9: finalized(620_000_000n),
  evidenceHash: finalized('0xev'),
  bond: finalized(20_000_000_000n),
  challengeDeadline: finalized(43_200),
  ackedByWatchtowers: finalized(3),
  escalated: finalized(true),
  ...over,
});

const REPORT = (over: Partial<ReportInputs> = {}): ReportInputs => ({
  roundOpen: finalized(true),
  feeAsset: 'USDC',
  reportWindowOpen: finalized(true),
  registered: finalized(true),
  stakeHeld: finalized(100_000_000_000n),
  reporterStake: finalized(100_000_000_000n),
  freeUsdc: finalized(50_000_000_000n),
  bondFloor: reportBondFloor(finalized(10_000_000_000n)),
  evidenceHash: '0xev',
  ...over,
});

const CHALLENGE = (over: Partial<ChallengeInputs> = {}): ChallengeInputs => ({
  round: ROUND(),
  caller: CHALLENGER_SS58,
  freeUsdc: finalized(50_000_000_000n),
  now: finalized(1_000),
  evidenceHash: '0xev',
  ...over,
});

test('no bond arithmetic exists in this client — the round bond is read (SQ-552 shape)', () => {
  // P-14 says the escalation bond "doubles per round", which invites `B_1 << (round - 1)`.
  // 07 §6.1 freezes `B_1` per game at creation and forbids re-reading `orc.bond_floor`,
  // `orc.bond_bps` or `orc.rounds` on escalation, so a client that doubled would price the
  // round off TODAY's parameters while the chain prices it off the frozen ones — and after
  // any lawful amendment the user is shown a number that is not the charge.
  const code = stripComments(
    readFileSync(join(REPO, 'app/src/features/tx/src/oracle-reporting.ts'), 'utf8'),
  );
  for (const forbidden of ['**', '<<', '2n', '10_000n', 'Math.pow', 'bond_bps', 'bondBps']) {
    assert.ok(
      !code.includes(forbidden),
      `oracle-reporting.ts must contain no bond arithmetic — found ${forbidden}`,
    );
  }
  // And the amount a challenge compares against is the round's own read, unmodified.
  const round = ROUND({ bond: finalized(20_000_000_000n) });
  const short = challengeBlocks(CHALLENGE({ round, freeUsdc: finalized(19_999_999_999n) }));
  assert.deepEqual(short.map((block) => block.check), ['Matching bond']);
  const exact = challengeBlocks(CHALLENGE({ round, freeUsdc: finalized(20_000_000_000n) }));
  assert.deepEqual(exact, []);
});

test('the round-1 report bond is a labelled floor, never presented as the amount (SQ-598)', () => {
  // `StakeAtRisk` is on no frozen surface, so P-13's "recomputed and displayed" cannot be
  // honoured for a fresh report. The honest shape is SQ-564's: state the bound that CAN be
  // read and refuse to let a screen render it where an exact amount would go.
  // **The path is closed, not captioned.** The floor is not the bond for any component with
  // stake at risk, so an account passing a floor-only check is either short at dispatch or
  // has more taken than the screen showed — money the user was shown and would reasonably
  // read as the price. §11.5's redemption-fee rule 5 rules exactly this case: unreadable ⇒
  // no figure and the transaction blocked, and the FE must not mirror the runtime's own
  // fail-open read. The block is the table's declaration, so the module cannot disagree
  // with it again.
  const check = reportBlocks(REPORT());
  assert.deepEqual(check.blocks.map((block) => block.check), ['Bond amount']);
  assert.match(nth(check.blocks, 0, 'block').detail, /SQ-598/);
  // Required, not optional — there is no shape of the result without it. It is the module's
  // own sentence **bound to the table's obligation by id**, so the two answers that once
  // shipped disagreeing cannot drift again: drop P-13's declaration and this throws.
  assert.ok(check.bondUnknown.startsWith(REPORT_BOND_NOT_ESTABLISHED), check.bondUnknown);
  assert.match(check.bondUnknown, /cannot state the bond/);
  assert.match(check.bondUnknown, /the least the bond can be/);
  assert.match(check.bondUnknown, /SQ-598/, 'the caveat must carry its own expiry pointer');

  // Below even the floor the row says both things: the bond is unknown AND the balance does
  // not cover the least it can be. Two reasons rather than one, because they have different
  // remedies and a merged sentence would send the user to the wrong one.
  const poor = reportBlocks(REPORT({ freeUsdc: finalized(9_999_999_999n) }));
  assert.deepEqual(poor.blocks.map((block) => block.check), ['Bond amount', 'Round bond']);
  assert.match(nth(poor.blocks, 1, 'block').detail, /even the floor/);
});

test('the report control is CLOSED while the bond is unreadable (Codex #3730437906)', () => {
  // R-7's direction, applied to the gate rather than to the model: a reporter must not be
  // walked to a signature for a value-scaled bond nobody can show them. `operatorGate`
  // converts P-13's blocking obligation into a closed control, and the anti-vacuity half is
  // `oracle.challenge`, whose bond IS readable (`OracleRoundView.bond`) and which opens on
  // the same session shape.
  const report = operatorGate('oracle.report', readySession('P-13'), []);
  assert.equal(report.state, 'blocked', 'a report was offered on a bond nobody can state');
  assert.equal(report.window, undefined);
  assert.ok(report.blocks.some((block) => block.detail.includes('SQ-598')), 'the block names no reason');
  assert.equal(operatorGate('oracle.challenge', readySession('P-14'), []).state, 'ready');
});

test('P-13 blocks on window, registry, a short stake and evidence — each independently', () => {
  // Every case carries the unreadable-bond block as well, since it holds unconditionally;
  // what this test is about is that the *clause* blocks are reported one per failing group.
  const clauseBlocks = (over: Partial<ReportInputs>): readonly string[] =>
    reportBlocks(REPORT(over)).blocks.map((b) => b.check).filter((check) => check !== 'Bond amount');
  assert.deepEqual(clauseBlocks({ reportWindowOpen: finalized(false) }), ['Report window']);
  assert.deepEqual(clauseBlocks({ registered: finalized(false) }), ['Reporter registry']);
  // Registered but under-staked is its own state with its own remedy: a prior slash leaves
  // the registration standing and the hold short, and "not registered" would send the user
  // to the wrong screen.
  const short = reportBlocks(REPORT({ stakeHeld: finalized(99_999_999_999n) }));
  assert.deepEqual(clauseBlocks({ stakeHeld: finalized(99_999_999_999n) }), ['Reporter stake']);
  assert.match(nth(short.blocks.filter((b) => b.check === 'Reporter stake'), 0, 'block').detail, /previous slash/);
  // An EMPTY hash is not a hash — what an unfilled form field actually produces.
  assert.deepEqual(clauseBlocks({ evidenceHash: '' }), ['Evidence']);
});

test('a reporter may not challenge their own round — 07 §5.2, and the view carries it', () => {
  // §11.5's P-14 row does not list this, but `OracleRoundView.reporter` is an exact chain
  // read and the chain refuses the call: left out, it costs a fee and returns an error the
  // user cannot map to anything they did.
  const own = challengeBlocks(CHALLENGE({ caller: REPORTER_SS58 }));
  assert.deepEqual(own.map((block) => block.check), ['Own round']);
  assert.match(nth(own, 0, 'block').detail, /no counterparty/);

  // The defect Codex found: SS58 is a rendering, not an identity. The same key under this
  // chain's prefix must still be refused — a `===` on the strings answers "different" and
  // clears the refusal, and the chain then rejects the call with `SelfChallenge`.
  const sameKeyOtherPrefix = challengeBlocks(CHALLENGE({ caller: REPORTER_SS58_LOCAL_PREFIX }));
  assert.deepEqual(sameKeyOtherPrefix.map((block) => block.check), ['Own round']);
  assert.match(nth(sameKeyOtherPrefix, 0, 'block').detail, /no counterparty/);

  // And an address no chain can name blocks rather than reading as "not the reporter" —
  // the fail-open answer, on a comparison that gates a refusal.
  const unparseable = challengeBlocks(CHALLENGE({ caller: 'not-an-address' }));
  assert.deepEqual(unparseable.map((block) => block.check), ['Own round']);
  assert.match(nth(unparseable, 0, 'block').detail, /cannot tell whether you are/);
});

test('the challenge deadline is the stored one, extension included — never recomputed', () => {
  const round = ROUND({ challengeDeadline: finalized(43_200) });
  // 07 §5.2's window is HALF-OPEN and the client must close on the same block the chain does.
  // `oracle_core::Oracle::challenge` enforces `now < challenge_deadline`, pinned by
  // `pallets/oracle/src/tests.rs::challenge_window_is_half_open_at_the_deadline`. The last
  // block a challenge lands on is `deadline - 1`; the deadline block itself is `WindowClosed`.
  assert.deepEqual(challengeBlocks(CHALLENGE({ round, now: finalized(43_199) })), []);
  const atDeadline = challengeBlocks(CHALLENGE({ round, now: finalized(43_200) }));
  assert.deepEqual(atDeadline.map((block) => block.check), ['Challenge window']);
  const late = challengeBlocks(CHALLENGE({ round, now: finalized(43_201) }));
  assert.deepEqual(late.map((block) => block.check), ['Challenge window']);
  assert.match(nth(late, 0, 'block').detail, /already includes any extension/);
  // The consequence copy is FIXED and takes no argument: a `Verified<T>` interpolated into a
  // string is 10 §2.1's render-edge defect, and this notice is rendered as raw text.
  const consequence = escalationConsequence();
  assert.match(consequence, /does not predict it/);
  assert.match(consequence, /40% to the counterparty and 60% to INSURANCE/);
});

test('the escalation copy cannot carry a chain value — it is given none (10 §2.1)', () => {
  // A regression guard with teeth: the defect was a template literal, so asserting the
  // *arity* is what forbids it returning. A one-argument version typechecks at every call
  // site and puts an unbadged chain read on screen.
  assert.equal(escalationConsequence.length, 0, 'escalationConsequence must take no argument');
  const code = stripComments(
    readFileSync(join(REPO, 'app/src/features/tx/src/oracle-reporting.ts'), 'utf8'),
  );
  const body = code.slice(code.indexOf('export function escalationConsequence'));
  assert.ok(!body.includes('${'), 'the escalation copy must contain no interpolation at all');
});

test('the report screen shows the floor caveat on the CLEAN path, where it matters', () => {
  // A blocked form already says why. The dangerous render is the one with nothing wrong,
  // where a reporter reads the floor as the charge and budgets for the wrong number.
  const html = renderToStaticMarkup(
    h(SubmitReport, {
      inputs: REPORT(),
      decimals: 6,
      symbol: 'USDC',
      evidence: EVIDENCE_FIXTURE,
      session: readySession('P-13'),
      onReport: noSubmit,
    }),
  );
  assert.match(html, /a floor, not the amount/);
  assert.match(html, /cannot state the bond/);
  assert.match(html, /Round bond — at least/);
});

test('the challenge screen renders the chain’s own bond and the risk before the control', () => {
  const html = renderToStaticMarkup(
    h(ChallengeRound, {
      inputs: CHALLENGE(),
      decimals: 6,
      symbol: 'USDC',
      evidence: EVIDENCE_FIXTURE,
      session: readySession('P-14'),
      onChallenge: noSubmit,
    }),
  );
  assert.match(html, /Bond to post/);
  assert.match(html, /Challenge window closes at/);
  assert.match(html, /What a challenge risks/);
  // The consequence precedes the button, because it is what decides whether to start.
  assert.ok(html.indexOf('What a challenge risks') < html.indexOf('>Challenge<'));
});

test('the recompute screen has no arm for a contradicted proof, and its refusals differ', () => {
  // The screen takes a submission, which requires a branded proof, which only agreement
  // mints — so "never submit a proof the client's own recomputation contradicts" is a
  // property of the type rather than a check this component could omit.
  const proof = recomputeProof(RECOMPUTE(), () => 1_234_000_000n);
  const html = renderToStaticMarkup(
    h(RecomputeProof, {
      submission: { proof, roundOpen: finalized(true) },
      session: readySession('O-2'),
      onSubmit: noSubmit,
    }),
  );
  assert.match(html, /reproduces the committed value/);
  assert.match(html, /1,234,000,000/);

  const closed = renderToStaticMarkup(
    h(RecomputeProof, {
      submission: { proof, roundOpen: finalized(false) },
      session: readySession('O-2'),
      onSubmit: noSubmit,
    }),
  );
  assert.match(closed, /no longer open/);

  // Two refusals, not one: a non-deterministic component is not a reporter behaving badly,
  // and collapsing them would be a false accusation in that direction.
  const mismatch = renderToStaticMarkup(
    h(ProofRefused, { reason: { kind: 'mismatch', claimed: 5n, recomputed: 6n } }),
  );
  assert.match(mismatch, /FE-ORC-001/);
  assert.match(mismatch, /the action is a challenge, not a proof/);
  const nonDeterministic = renderToStaticMarkup(
    h(ProofRefused, { reason: { kind: 'non-deterministic', component: 3 } }),
  );
  assert.match(nonDeterministic, /FE-ORC-002/);
  assert.match(nonDeterministic, /Nothing here indicates the reported value is wrong/);
});

// ------------------------------------------ S12/S13 the funding screens (F18)

const DEPOSIT_SCREEN = (over: Partial<DepositInputs> = {}): DepositInputs => ({
  xcmHealthy: true,
  assetHubBalance: finalized(1_000_000_000n),
  amount: 10_000_000n,
  assetHubFee: 100_000n,
  minBalance: 1_000_000n,
  assetHubReady: true,
  bootstrapPhase: false,
  ...over,
});

test('a WARNING does not disable the deposit — a client that refuses what the chain accepts', () => {
  // §11.9.1/§11.9.2 and I-24: degraded XCM health means the funds are held, not lost. If the
  // warning rendered in the same red box as a block, the user reads "there is a problem" and
  // does not send — a lawful deposit stopped by presentation. This is the assertion a
  // happy-path suite never makes and a cautious developer breaks first.
  const html = renderToStaticMarkup(
    h(DepositForm, {
      inputs: DEPOSIT_SCREEN(),
      xcmHealthy: false,
      decimals: 6,
      symbol: 'USDC',
      onDeposit: () => {},
    }),
  );
  assert.match(html, /XCM channel health is degraded/);
  assert.match(html, /data-severity="caution"/);
  assert.ok(!html.includes('data-severity="danger"'), 'a warning must not render as a block');
  assert.ok(!buttonDisabled(html, 'Deposit'), 'the deposit stays available under a warning');
});

test('a real block DOES disable it, so the warning test is not vacuous', () => {
  const html = renderToStaticMarkup(
    h(DepositForm, {
      inputs: DEPOSIT_SCREEN({ assetHubReady: false }),
      xcmHealthy: true,
      decimals: 6,
      symbol: 'USDC',
      onDeposit: () => {},
    }),
  );
  assert.ok(buttonDisabled(html, 'Deposit'), html);
  assert.match(html, /data-severity="danger"/);
  assert.match(html, /blocked rather than offering to send anyway/);
});

test('"sent" is never rendered as "arrived", and the block says which chain it is', () => {
  // The model makes `credited` unreachable from the Asset Hub leg. The screen's job is not to
  // undo that in copy — a bare block number with no chain beside it is how a user concludes
  // the transfer landed.
  const sent = renderToStaticMarkup(
    h(DepositTracker, {
      progress: { kind: 'sent-awaiting-arrival', assetHubBlock: finalized(500) },
      decimals: 6,
      symbol: 'USDC',
    }),
  );
  assert.match(sent, /awaiting arrival/);
  assert.match(sent, /means the message was sent, not that the funds have arrived/);
  assert.match(sent, /Asset Hub block \(sent\)/);
  assert.ok(!sent.includes('Credited'), 'must not claim arrival');

  const credited = renderToStaticMarkup(
    h(DepositTracker, {
      progress: {
        kind: 'credited',
        assetHubBlock: finalized(500),
        creditedAtLocalBlock: finalized(900),
        creditedAmount: finalized(10_000_000n),
      },
      decimals: 6,
      symbol: 'USDC',
    }),
  );
  assert.match(credited, /seen the balance in its own finalized state/);
  // Both chains' blocks are shown and each is labelled, so neither can be read as the other.
  assert.match(credited, /Asset Hub block \(sent\)/);
  assert.match(credited, /This chain’s block \(credited\)/);
});

test('an unverifiable withdraw destination warns in its own words, and does not block', () => {
  // `undefined` (connection down) and `false` (would be dusted) call for different actions,
  // and collapsing either into the other is what "silently skipped" means.
  const unknown = renderToStaticMarkup(
    h(WithdrawForm, {
      inputs: {
        freeBalance: finalized(1_000_000_000n),
        amount: 10_000_000n,
        localFee: 100_000n,
        minBalance: 1_000_000n,
        destinationViable: undefined,
        ledgerFrozen: false,
      },
      destination: finalized('5Gw...'),
      decimals: 6,
      symbol: 'USDC',
      onWithdraw: () => {},
    }),
  );
  assert.match(unknown, /has not been established either way/);
  assert.ok(!buttonDisabled(unknown, 'Withdraw'), 'an unchecked destination is not a block');

  const dusting = renderToStaticMarkup(
    h(WithdrawForm, {
      inputs: {
        freeBalance: finalized(1_000_000_000n),
        amount: 10_000_000n,
        localFee: 100_000n,
        minBalance: 1_000_000n,
        destinationViable: false,
        ledgerFrozen: false,
      },
      destination: finalized('5Gw...'),
      decimals: 6,
      symbol: 'USDC',
      onWithdraw: () => {},
    }),
  );
  assert.match(dusting, /risks the funds being dusted on arrival/);
  assert.ok(!dusting.includes('has not been established'), 'the two states must read differently');
});

// ============================================ F17's operator gate and its consoles

/**
 * 11 §11.4 rule 1, applied to §11.8: *"Every submit path passes through `refreshAndGate` —
 * **structurally** (the tx machine has no bypass edge), not by convention."*
 *
 * These tests are written against the bypass, not the happy path. A console rendering
 * correctly proves nothing here: the defect was that each one enabled its control on its own
 * module-local check, with no refresh, no `spec_version` re-check and no proof that the reads
 * described one state — all of which a green render is entirely consistent with.
 */

/**
 * The §11.8 calls whose row this release can actually read end to end.
 *
 * It was five and it is now nine. Contract v28 froze the guardian pending-action pair, the
 * two upgrade items and the registry's three maps (SQ-615/616/619), which retired the
 * `blocking` declarations that had kept S15, S17 and S19 shut; `oracle.report` left the list
 * in the other direction, because its bond is money no frozen surface publishes.
 */
const OPENABLE_CALLS = [
  'oracle.register_reporter',
  'oracle.recompute_proof',
  'welfare.record_snapshot',
  'oracle.challenge',
  'guardian.approve_action',
  'system.apply_authorized_upgrade',
  'registry.challenge',
] as const;

test('no operator control opens without a gate result the screen cannot mint', () => {
  // The structural half: `operatorGate` yields a `window` only from `AwaitingSignature`, and
  // that state has one inbound edge requiring a `GatePassed` whose brand only `gate()` mints.
  for (const call of Object.keys(OPERATOR_SURFACE_ROWS) as (keyof typeof OPERATOR_SURFACE_ROWS)[]) {
    const row = OPERATOR_SURFACE_ROWS[call];
    const notRefreshed = operatorGate(call, preparedSession(row), []);
    assert.notEqual(notRefreshed.state, 'ready', call);
    assert.equal(notRefreshed.window, undefined, `${call} offered a window without a gate`);
  }
  // For a row this release can read end to end, the state is `not-refreshed` and **not**
  // `blocked`: nothing is wrong, the chain has simply not been re-read, and telling an
  // operator a condition failed sends them hunting a problem that does not exist. The other
  // four rows are `blocked` for a stated reason — asserted separately below.
  for (const call of OPENABLE_CALLS) {
    const gated = operatorGate(call, preparedSession(OPERATOR_SURFACE_ROWS[call]), []);
    assert.equal(gated.state, 'not-refreshed', call);
    assert.deepEqual(gated.blocks, [], call);
    // And a refreshed session opens it, so `not-refreshed` is not a permanent refusal.
    assert.equal(operatorGate(call, readySession(OPERATOR_SURFACE_ROWS[call]), []).state, 'ready', call);
  }
});

test('every row whose central read 02 does not freeze is CLOSED, with its id named', () => {
  // INV-FE-12's lattice: an unproven capability is absent, and absence disables the
  // dependent surface with a named reason.
  //
  // **Four rows, and it was six.** Contract v28 froze six surfaces in this branch's own base
  // and PLAN.md marked SQ-615, SQ-616 and SQ-619 resolved, while the declarations stayed —
  // so S15, S17 and S19 could not reach `ready` at all and this test asserted that as though
  // it were the specification. What is left is genuinely unread: the trigger→item mapping
  // §11.8.2 never states (SQ-730), the per-stream treasury read §7.6 forbids (SQ-601), the
  // filing bond's exposure (SQ-731) and the report bond's `StakeAtRisk` (SQ-598).
  const closed: Record<string, string> = {
    'guardian.propose_action': 'SQ-730',
    'futarchy_treasury.claim_stream': 'SQ-601',
    'registry.file': 'SQ-731',
    'oracle.report': 'SQ-598',
  };
  for (const [call, sq] of Object.entries(closed)) {
    const row = OPERATOR_SURFACE_ROWS[call as keyof typeof OPERATOR_SURFACE_ROWS];
    const gated = operatorGate(call as keyof typeof OPERATOR_SURFACE_ROWS, readySession(row), []);
    assert.equal(gated.state, 'blocked', `${call} opened on an unread condition`);
    assert.equal(gated.window, undefined, call);
    assert.ok(
      gated.blocks.some((block) => block.detail.includes(sq)),
      `${call} is closed without naming ${sq}`,
    );
  }
  // The retired ones open, which is the half a "closed" list can never assert about itself.
  for (const call of ['guardian.approve_action', 'system.apply_authorized_upgrade', 'registry.challenge'] as const) {
    const gated = operatorGate(call, readySession(OPERATOR_SURFACE_ROWS[call]), []);
    assert.equal(gated.state, 'ready', `${call} is still closed on a resolved spec question`);
  }
});

test('a preparation declaring somebody else’s row is refused, not gated against it', () => {
  // `gate()` verifies the rows a preparation *declares* — it cannot know whether the
  // declaration is the right one for the call being signed. A preparation for
  // `guardian.approve_action` declaring `P-1` gates perfectly against the market row and
  // authorises the wrong signature, so the call→row binding is data and it is checked here.
  const wrong = operatorGate('oracle.register_reporter', readySession('P-1'), []);
  assert.equal(wrong.state, 'blocked');
  assert.equal(wrong.window, undefined);
  assert.deepEqual(wrong.blocks.map((block) => block.check), ['Declared precondition row']);
  assert.match(nth(wrong.blocks, 0, 'block').detail, /passes its gate and authorises this signature/);
  // And the right declaration opens, so the refusal is not vacuous.
  assert.equal(operatorGate('oracle.register_reporter', readySession('O-1'), []).state, 'ready');
});

test('an authentic window with NO preparation is refused (Codex #3730437885)', () => {
  // `declarationBlock` returned `undefined` for an absent preparation — "nothing declared,
  // nothing to disagree with" — which read as harmless and was not: paired with a real window
  // it produced a `ready` control for a call whose bytes nothing had ever named. `TxSession`
  // is structural, so this session is assemblable by any screen.
  const real = readySession('O-1');
  const orphaned = { ...real, prep: undefined } as TxSession;
  const gated = operatorGate('oracle.register_reporter', orphaned, []);
  assert.equal(gated.state, 'blocked', 'a privileged control opened over no transaction');
  assert.equal(gated.window, undefined);
  // Two reasons, and both are true of this session: it names no transaction, and the proof
  // it holds was minted for one it does not name.
  assert.deepEqual(
    gated.blocks.map((block) => block.check).sort(),
    ['Gate proof', 'Prepared transaction'],
  );
});

test('an authentic window minted for OTHER bytes is refused, not honoured', () => {
  // A `GatePassed` is evidence about the preparation it names and nothing else. The window
  // here is real — it came out of `gate()` — and it describes a different transaction.
  const mine = readySession('O-1');
  const theirs = readySession('O-1');
  const crossed = { ...mine, signingWindow: theirs.signingWindow } as TxSession;
  const gated = operatorGate('oracle.register_reporter', crossed, []);
  assert.equal(gated.state, 'blocked', 'a proof for another preparation opened this control');
  assert.ok(gated.blocks.some((block) => block.check === 'Gate proof'), gated.blocks.map((b) => b.check).join(', '));
  // Anti-vacuity: the untampered session opens, so the refusal is the crossing's.
  assert.equal(operatorGate('oracle.register_reporter', mine, []).state, 'ready');
});

test('the window a control hands its submitter carries the bytes it proves', () => {
  // What makes the binding usable rather than decorative: a submitter encodes
  // `window.prep.scaleHex` and has no reason to hold a second copy of the payload.
  const ready = operatorGate('oracle.register_reporter', readySession('O-1'), []);
  assert.equal(ready.state, 'ready');
  let handed: GatePassed | undefined;
  const submit = operatorSubmit(ready, (window) => { handed = window; });
  assert.ok(submit, 'a ready control offered no handler');
  submit();
  assert.equal(handed?.prep.scaleHex, PREP.scaleHex);
  assert.ok(handed?.prep.requires.includes('O-1'));
});

test('a blocking unreadable obligation closes the control even with a passing gate', () => {
  // `clauseGroupsFor` answers "every declared read passed", which for a row whose central
  // read 02 freezes no surface for is **vacuously** true. INV-FE-12's lattice says an
  // unproven capability is absent, so the row is closed with its spec question named.
  const blocked = operatorGate('futarchy_treasury.claim_stream', readySession('O-5'), []);
  assert.equal(blocked.state, 'blocked', 'a row with no lawful source opened its control');
  assert.match(nth(blocked.blocks, 0, 'block').detail, /SQ-601/);
  assert.match(nth(blocked.blocks, 0, 'block').detail, /control is closed rather than offered/);
  // Anti-vacuity: a row with no blocking obligation opens on the same session shape, so the
  // refusal above is the obligation's and not a gate that never opens for anything.
  assert.equal(operatorGate('welfare.record_snapshot', readySession('O-7'), []).state, 'ready');
});

test('a STATED obligation is carried without blocking, and never dropped', () => {
  // §11.8.1's SQ-564 posture: the transaction is offered and the gap is named. The two
  // dispositions are genuinely different and collapsing either into the other is wrong in
  // one direction each — blocking a stated gap removes a lawful action, and stating a
  // blocking one acts on a condition nobody read.
  const stated = operatorGate('oracle.register_reporter', readySession('O-1'), []);
  assert.equal(stated.state, 'ready', 'a stated gap must not close the control');
  assert.equal(stated.unreadable.length, 2, 'the two SQ-564 conditions must travel with the gate');
  for (const entry of stated.unreadable) assert.equal(entry.disposition, 'stated');
});

test('the model’s own blocks reach the control, and every one of them is reported', () => {
  const gated = operatorGate('oracle.register_reporter', readySession('O-1'), [
    { check: 'First', detail: 'one' },
    { check: 'Second', detail: 'two' },
  ]);
  assert.equal(gated.state, 'blocked');
  assert.deepEqual(gated.blocks.map((block) => block.check), ['First', 'Second']);
});

test('every operator console refuses to submit from an unrefreshed session', () => {
  // The end-to-end form of the first test: each console's control must be disabled, with a
  // reason, when the chain has not been re-read. A rendering check rather than a model one,
  // because the model can be right while the screen wires its own handler.
  const cases: readonly { readonly label: string; readonly node: ReturnType<typeof h> }[] = [
    {
      label: 'Register',
      node: h(RegisterReporter, {
        inputs: { freeUsdc: finalized(10_000_000n), reporterStake: finalized(1_000_000n), alreadyRegistered: finalized(false) },
        decimals: 6, symbol: 'USDC', session: preparedSession('O-1'), onRegister: noSubmit,
      }),
    },
    {
      label: 'Post the report',
      node: h(SubmitReport, {
        inputs: REPORT(), decimals: 6, symbol: 'USDC', evidence: EVIDENCE_FIXTURE,
        session: preparedSession('P-13'), onReport: noSubmit,
      }),
    },
    {
      label: 'Take the snapshot',
      node: h(SnapshotCrank, {
        epoch: finalized(7), specVersion: finalized(3), boundaryPassed: true, takenAtThisVersion: false,
        staleness: snapshotStaleness(finalized(100), finalized(200), 1_000, 5_000),
        session: preparedSession('O-7'), onCrank: noSubmit,
      }),
    },
    {
      label: 'File',
      node: h(RegistryFilingForm, {
        inputs: FILING(), decimals: 6, symbol: 'USDC', evidence: EVIDENCE_FIXTURE,
        session: preparedSession('O-8'), onFile: noSubmit,
      }),
    },
  ];
  for (const { label, node } of cases) {
    const html = renderToStaticMarkup(node);
    assert.ok(buttonDisabled(html, label), `${label} submitted without a gate result:\n${html}`);
  }
});

test('a gated console enables its control, so the refusals above are not vacuous', () => {
  const html = renderToStaticMarkup(
    h(SnapshotCrank, {
      epoch: finalized(7), specVersion: finalized(3), boundaryPassed: true, takenAtThisVersion: false,
      staleness: snapshotStaleness(finalized(100), finalized(200), 1_000, 5_000),
      session: readySession('O-7'), onCrank: noSubmit,
    }),
  );
  assert.ok(!buttonDisabled(html, 'Take the snapshot'), html);
});

// -------------------------------------------- P-13 has ONE implementation now

test('reportBlocks consumes P-13’s clause list rather than re-deriving one', () => {
  // The blocker: `rows.ts` recomputed the round bond and checked USDC headroom against it
  // while `oracle-reporting.ts` declared the bond structurally uncomputable — two answers to
  // "what will this hold?" in one release, on a bonded and slashable action. The repair is a
  // direction of dependency, and this asserts the direction rather than the agreement.
  const keys = rowsFor('P-13', 'USDC').map((clause) => clause.key);
  assert.ok(keys.every((key) => key !== undefined), 'a P-13 clause lost its key');
  // Every clause has a predicate: one at a time, make exactly that clause fail and require a
  // block. A clause the module silently skipped would produce none.
  const failing: Record<string, Partial<ReportInputs>> = {
    'round-open': { roundOpen: finalized(false) },
    'report-window': { reportWindowOpen: finalized(false) },
    registered: { registered: finalized(false) },
    'stake-held': { stakeHeld: finalized(1n) },
    'bond-headroom': { freeUsdc: finalized(0n) },
    evidence: { evidenceHash: undefined },
  };
  for (const [key, over] of Object.entries(failing)) {
    const check = reportBlocks(REPORT(over)).blocks.filter((block) => block.check !== 'Bond amount');
    assert.ok(check.length > 0, `P-13 clause ${key} has no predicate that can fail`);
  }
  assert.deepEqual(
    reportBlocks(REPORT()).blocks.map((block) => block.check),
    ['Bond amount'],
    'the clean fixture must block on the unreadable bond and nothing else',
  );
  // And the caveat text is the table's own obligation, so the two cannot drift again.
  assert.match(reportBlocks(REPORT()).bondUnknown, /SQ-598|not computable|StakeAtRisk/);
});

test('a P-13 clause with no predicate throws rather than being skipped', () => {
  // The failure mode this closes is a check that is absent while the screen still reports
  // that everything passes. `clauseGroupsFor` is the work list, so a clause added to the
  // table must be implemented, and the guard is exercised here with a synthetic clause
  // rather than proven by the table happening to agree with the map today.
  const real = nth(rowsFor('P-13', 'USDC'), 0, 'clause');
  assert.ok(p13Predicate(real), 'a real P-13 clause has no predicate');
  assert.throws(
    () => p13Predicate({ ...real, key: 'a-clause-nobody-implemented' }),
    (error: unknown) => {
      assert.ok(error instanceof UnimplementedClauseError, String(error));
      assert.match(error.message, /reports "everything passes" while never having run/);
      return true;
    },
  );
  // A clause that lost its key entirely is the same refusal — not a silent skip.
  const { key: _dropped, ...keyless } = real;
  assert.throws(() => p13Predicate(keyless), UnimplementedClauseError);
  // And the other direction: a predicate with no clause behind it is dead code.
  const tableKeys = new Set(rowsFor('P-13', 'USDC').map((clause) => clause.key));
  for (const key of P13_CHECK_KEYS) {
    assert.ok(tableKeys.has(key), `${key} is implemented and P-13 declares no such clause`);
  }
});

test('round open and report window are reported as SEPARATE blocks', () => {
  // A counter-report on a live round: the round is open and the window has elapsed. One
  // collapsed flag cannot say which half failed, and the two have different remedies.
  const clauseBlocks = (over: Partial<ReportInputs>): readonly ReportBlock[] =>
    reportBlocks(REPORT(over)).blocks.filter((block) => block.check !== 'Bond amount');
  const windowGone = clauseBlocks({ reportWindowOpen: finalized(false) });
  assert.deepEqual(windowGone.map((block) => block.check), ['Report window']);
  assert.deepEqual(clauseBlocks({ roundOpen: finalized(false) }).map((b) => b.check), ['Round open']);
  assert.match(nth(windowGone, 0, 'block').detail, /round itself may still be open/);
});

// ------------------------------------- §11.8.1's stake-hold consequence (F17)

test('the stake-hold consequence is a REQUIRED field and renders on the clean path', () => {
  // §11.8.1 row 1's last clause is "stake-hold consequence displayed". It shipped inside a
  // `RegistrationBlock` detail, which fires only when free USDC is short — so the one reader
  // who needs it, an account that CAN afford the stake and is about to commit it, was the
  // only one who never saw it. A consequence is not a failure message.
  const clean = checkRegistration({
    freeUsdc: finalized(10_000_000n),
    reporterStake: finalized(1_000_000n),
    alreadyRegistered: finalized(false),
  });
  assert.deepEqual(clean.blocks, [], 'the fixture must be the clean path');
  assert.equal(clean.stakeHold, STAKE_HOLD_CONSEQUENCE);
  const html = renderToStaticMarkup(
    h(RegisterReporter, {
      inputs: { freeUsdc: finalized(10_000_000n), reporterStake: finalized(1_000_000n), alreadyRegistered: finalized(false) },
      decimals: 6, symbol: 'USDC', session: readySession('O-1'), onRegister: noSubmit,
    }),
  );
  assert.ok(html.includes(STAKE_HOLD_CONSEQUENCE), `the consequence is absent on the clean path:\n${html}`);
  // It says what a hold *is* — not spent, not transferred, and not available either.
  assert.match(STAKE_HOLD_CONSEQUENCE, /not available to you/);
  assert.match(STAKE_HOLD_CONSEQUENCE, /registration survives the slash/);
});

// -------------------------------------- §11.8.2's ratification tracker (F17)

const REVIEW_UNREAD: ReviewReferendum = { kind: 'unread', reason: 'the referendum read failed' };

test('an unobserved review is NOT "no review required" — the fail-closed arm', () => {
  // §11.8.2: every executed action's review is **auto-scheduled**. So an action with no
  // `ReviewScheduled` in the ingested window means this client has not seen it, never that
  // none exists. Rendering that as "not subject to ratification" tells a guardian their
  // exposure has ended, about their own bond.
  const state = ratificationFor('a1', [], REVIEW_UNREAD);
  assert.equal(state.kind, 'unobserved');
  assert.match(copy(ratificationCopy(state)), /gap in what this device has seen/);
  assert.match(copy(ratificationCopy(state)), /not a statement that none exists/);
});

test('the tracker folds the four frozen guardian events, keyed by action', () => {
  const events: readonly RatificationEvent[] = [
    { variant: 'ReviewScheduled', actionId: 'a1', referendum: 42 },
    { variant: 'ReviewFailed', actionId: 'a2', slashedEach: 500n },
    { variant: 'RecallScheduled', actionId: 'a2', referendum: 43 },
    { variant: 'ActionRatified', actionId: 'a3' },
  ];
  const pending = ratificationFor('a1', events, REVIEW_UNREAD);
  assert.equal(pending.kind, 'pending');
  assert.equal(pending.kind === 'pending' && pending.referendum, 42);
  const failed = ratificationFor('a2', events, REVIEW_UNREAD);
  assert.equal(failed.kind, 'failed');
  assert.equal(failed.kind === 'failed' && failed.slashedEach, 500n);
  assert.equal(failed.kind === 'failed' && failed.recall, 43);
  assert.equal(ratificationFor('a3', events, REVIEW_UNREAD).kind, 'ratified');
  // Another action's events must not become this one's verdict — an action id is the only
  // thing binding these events, so the filter lives here rather than in a caller.
  assert.equal(ratificationFor('a4', events, REVIEW_UNREAD).kind, 'unobserved');
});

test('two terminal events for one action refuse rather than pick a winner', () => {
  // Chain-impossible, so it is evidence the stream is mis-keyed. Resolving it by precedence
  // would report a definite outcome from an ingest just shown to be untrustworthy — and the
  // wrong half of that coin tells a guardian their bond is safe.
  const state = ratificationFor(
    'a1',
    [
      { variant: 'ActionRatified', actionId: 'a1' },
      { variant: 'ReviewFailed', actionId: 'a1', slashedEach: 1n },
    ],
    REVIEW_UNREAD,
  );
  assert.equal(state.kind, 'contradictory');
  assert.match(copy(ratificationCopy(state)), /keyed\s+wrongly/);
});

test('the tracker screen states the consequence first, and never hides an unread review', () => {
  const html = renderToStaticMarkup(
    h(RatificationTracker, {
      actionId: finalized('a1'),
      state: ratificationFor('a1', [{ variant: 'ReviewScheduled', actionId: 'a1', referendum: 42 }], REVIEW_UNREAD),
    }),
  );
  assert.ok(html.includes(UNRATIFIED_CONSEQUENCE), 'the 50%-slash consequence must be stated');
  assert.ok(
    html.indexOf(UNRATIFIED_CONSEQUENCE) < html.indexOf('Where the review stands'),
    'the consequence must precede the state, not depend on which arm rendered',
  );
  assert.match(html, /could not be read/, 'an unread review must be stated, not rendered as quiet');
  assert.match(html, /treat the consequence above as live/);
});

// ------------------------------------- §11.8.2's power-specific forms (F17)

test('each power renders its OWN arguments, and the empty one says so', () => {
  // SQ-621: one call, five argument sets. `suspend_on_gate` takes none, so a generic form
  // renders an empty one — which reads as a form that failed to load, on the screen whose
  // next click is a privileged signature.
  assert.deepEqual(POWER_FIELDS.suspend_on_gate, []);
  assert.equal(POWER_FIELDS.activate_playbook.length, 4);
  const empty = renderToStaticMarkup(
    h(ProposeAction, {
      meter: { power: 'suspend_on_gate', used: finalized(0), limit: finalized(3) },
      inputs: { args: { power: 'suspend_on_gate' }, justificationHash: '0xj' },
      session: readySession('O-4'), onPropose: noSubmit,
    }),
  );
  assert.match(empty, /This power takes no arguments/);
  const playbook = renderToStaticMarkup(
    h(ProposeAction, {
      meter: { power: 'activate_playbook', used: finalized(0), limit: finalized(3) },
      inputs: {
        args: { power: 'activate_playbook', id: 'PB-1', trigger: 'GateBreach', expiry: 9_000 },
        justificationHash: '0xj',
      },
      trigger: { kind: 'active', since: finalized(10) },
      session: readySession('O-4'), onPropose: noSubmit,
    }),
  );
  for (const field of POWER_FIELDS.activate_playbook) {
    assert.ok(playbook.includes(field), `${field} must be on the activate_playbook form`);
  }
});

test('the propose form refuses a missing justification and a misplaced cohort target', () => {
  // `propose_action(power, justification_hash)` — the hash is an argument, and the pending
  // list resolves the document behind it, so proposing without one asks six other guardians
  // to approve something with no stated reason.
  assert.deepEqual(
    proposeFormBlocks({ args: { power: 'suspend_on_gate' }, justificationHash: undefined })
      .map((block) => block.check),
    ['Justification'],
  );
  // `ActivatePlaybook.target` is accepted by the VOID playbook and rejected by every other,
  // so a form offering it generally builds a call the chain refuses after signing.
  assert.deepEqual(
    proposeFormBlocks({
      args: { power: 'activate_playbook', id: 'PB-1', trigger: 'GateBreach', expiry: 1, target: 7 },
      justificationHash: '0xj',
    }).map((block) => block.check),
    ['Cohort target'],
  );
  assert.deepEqual(
    proposeFormBlocks({
      args: { power: 'activate_playbook', id: 'PB-1', trigger: 'VoidInFlight', expiry: 1, target: 7 },
      justificationHash: '0xj',
    }),
    [],
    'the VOID playbook does take a target — the refusal must not be blanket',
  );
});

// -------------------------- §11.8.2's pending list: hash AND resolved document

test('the pending list renders the justification hash and the resolved document', () => {
  // §11.8.2's row is field-by-field: "power, target, justification_hash (+ resolved
  // justification document …), current approvals m-of-7, expiry". The table carried neither
  // of the middle two, so the list ranked five privileged actions by nothing but their ids
  // and the document that distinguishes them appeared one click after the choice it informs.
  const html = renderToStaticMarkup(
    h(PendingActions, {
      actions: [ACTION_ROW()],
      justifications: () => evidenceUnavailable(3),
      onOpen: () => {},
    }),
  );
  assert.match(html, /<th scope="col">Justification<\/th>/, 'the justification column is missing');
  assert.ok(html.includes(ACTION_ROW().justificationHash.value), 'the hash itself must be on the row');
  assert.match(html, /evidence unretrievable/i, 'an unfetchable document must be stated, not blank');
  // Present in the markup is not the same as shown — the same limit `tests/ui` states for
  // the call batch. A mutation wrapping the cell in `hidden` left every assertion above
  // passing while the column was invisible, which is the exact failure the column exists to
  // prevent: a guardian ranking privileged actions by their ids alone.
  const cell = /<span[^>]*>\s*<span class="datum datum--identifier"[^>]*title="0xjust"/.exec(html);
  assert.ok(cell !== null, `the justification cell must render: ${html}`);
  const opening = /<span([^>]*)>\s*<span class="datum datum--identifier"[^>]*title="0xjust"/.exec(html);
  const attrs = opening === null ? '' : nth(opening, 1, 'capture');
  assert.ok(!/\bhidden\b/.test(attrs), `the justification cell is hidden: ${attrs}`);
  assert.ok(!/aria-hidden="true"/.test(attrs), `the justification cell is aria-hidden: ${attrs}`);
  assert.ok(!/display:\s*none/.test(attrs), `the justification cell is display:none: ${attrs}`);
});

// ------------------------------------------ S19: the filing screen and the bond

test('registry.challenge checks the bond balance, not only the window', () => {
  // §11.8.6 row 2 reads "filing within its 72 h challenge window …; challenge bond balance",
  // and `mayChallenge` tested only the window — so the client offered a challenge to an
  // account that cannot post the bond, on the screen where the user has a deadline and one
  // attempt inside it.
  assert.deepEqual(
    challengeFilingBlocks({ ...CHALLENGE_FILING(), windowOpen: true, windowReason: 'open' }),
    [],
  );
  assert.deepEqual(
    challengeFilingBlocks({
      ...CHALLENGE_FILING({ freeUsdc: finalized(1n) }),
      windowOpen: true,
      windowReason: 'open',
    }).map((block) => block.check),
    ['Challenge bond'],
  );
  // Both directions together, and the window's own reason travels with it.
  assert.deepEqual(
    challengeFilingBlocks({
      ...CHALLENGE_FILING({ freeUsdc: finalized(1n), evidenceHash: undefined }),
      windowOpen: false,
      windowReason: 'the watchtower extension could not be read',
    }).map((block) => block.check),
    ['Challenge window', 'Challenge bond', 'Evidence'],
  );
});

test('a challenge with no bond is disabled on the screen, not only in the model', () => {
  const html = renderToStaticMarkup(
    h(RegistryFiling, {
      filingId: finalized('0xfile'),
      window: { kind: 'open', closesAt: finalized(900), extended: false },
      inputs: CHALLENGE_FILING({ freeUsdc: finalized(1n) }),
      decimals: 6, symbol: 'USDC', evidence: EVIDENCE_FIXTURE,
      session: readySession('O-9'), onChallenge: noSubmit,
    }),
  );
  assert.ok(buttonDisabled(html, 'Challenge this filing'), html);
  assert.match(html, /does not cover the challenge bond/);
});

test('S19 has a filing screen, and it renders the bond, the bounds and the evidence', () => {
  // `filingBlocks` existed and nothing rendered it: the console offered the flow that
  // disputes a filing and not the one that creates it.
  const html = renderToStaticMarkup(
    h(RegistryFilingForm, {
      inputs: FILING(), decimals: 6, symbol: 'USDC', evidence: EVIDENCE_FIXTURE,
      session: readySession('O-8'), onFile: noSubmit,
    }),
  );
  assert.match(html, /File an incident/);
  assert.match(html, /Filing bond/);
  assert.match(html, /Filings this epoch/);
  assert.ok(html.includes(REGISTRY_HOLDS_SETTLEMENT), 'the settlement statement must reach the filer too');
  assert.match(html, /evidence unretrievable/i, 'the evidence panel must render here');
});

// --------------------------------------- evidence reaches the round and filing panels

test('EvidencePanel renders on the round and the filing panels, not only in the model', () => {
  // §11.8.1's evidence paragraph is written for the reporter console and §11.8.6 applies its
  // rules to the registry. The panel existed and no operator surface mounted it, so an
  // unretrievable document was silently omitted — exactly what E22 forbids.
  const report = renderToStaticMarkup(
    h(SubmitReport, {
      inputs: REPORT(), decimals: 6, symbol: 'USDC', evidence: EVIDENCE_FIXTURE,
      session: readySession('P-13'), onReport: noSubmit,
    }),
  );
  const challenge = renderToStaticMarkup(
    h(ChallengeRound, {
      inputs: CHALLENGE(), decimals: 6, symbol: 'USDC', evidence: EVIDENCE_FIXTURE,
      session: readySession('P-14'), onChallenge: noSubmit,
    }),
  );
  for (const html of [report, challenge]) {
    assert.ok(html.includes(EVIDENCE_UNRETRIEVABLE), `the evidence state is not rendered:\n${html}`);
  }
});

// ------------------------------------------------ S17's pending declaration (F17)

test('S17 waits on what the screen needs, not on the prototype gating its submit control', () => {
  // §11.8.4's own fallback: steps 1–3 ship regardless, and "verification stays in-browser
  // even when submission cannot". Naming FE-P10 as what the *screen* waits on said the
  // opposite, and would keep a working verification surface unwired for an outcome it does
  // not depend on.
  const s17 = PENDING_SCREENS['S17'];
  assert.ok(s17 !== undefined && s17.state === 'built-unwired');
  assert.ok(!s17.waitingOn.includes('FE-P10'), `S17 still waits on FE-P10: ${s17.waitingOn}`);
});
