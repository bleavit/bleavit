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
  DEPEG_TRIGGER_UNAVAILABLE,
  TRIGGER_READS,
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
  ClaimStream,
  InsurancePanel,
  STREAM_CLAIMS_NOT_WIRED,
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
  INCIDENT_CLASSES,
  reportBlocks,
  BOND_QUOTE_IS_A_QUOTE,
  BOND_QUOTE_UNDETERMINABLE,
  bondQuoteRefusal,
  coversBond,
  ChallengeRound,
  ProofRefused,
  RecomputeProof,
  SubmitReport,
  RegistryInstanceCollisionError,
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
  MIGRATION_NO_ACTION_FOLLOWS,
  PLAYBOOK_TRIGGERS,
  ALLOWANCE_READS,
  allowanceBook,
  guardianCall,
  guardianStatus,
  isMetered,
  meterFor,
  pendingPowerName,
  playbookAdvisory,
  rerunnable,
  triggerOf,
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
  OPERATOR_ROWS,
  OPERATOR_SURFACE_ROWS,
  declaredCoverageIds,
  gate,
  obligationAppliesTo,
  operatorRowsFor,
  rowsFor,
  scopedObligationsFor,
  unreadableObligationsFor,
} from '@bleavit/transaction-builder';
import type {
  ClauseId,
  DeclarableRowId,
  GatePassed,
  ObligationScope,
  PreconditionResult,
  TxPreparation,
  TxSession,
  TxState,
  UnreadableObligation,
} from '@bleavit/transaction-builder';
import type {
  ActivePlaybookReading,
  AllowanceBook,
  AllowanceMeter,
  AllowanceReads,
  ConditionEvidence,
  DispatchEvidence,
  PlaybookAdmissibility,
  RegistrationReading,
  GuardianProposal,
  HoldHorizon,
  MeteredPower,
  PendingPower,
  ProposalStateName,
  ProposeInputs,
  RerunState,
  TriggerSubject,
  BondQuoteState,
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
  PlaybookTrigger,
  TriggerState,
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
  EpochClosure,
  FrozenSpecVersions,
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
import { declarationOf, txSource, withoutComments } from './spec-sources.ts';

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

/**
 * Source reduced to **code**: comments gone, import specifiers gone, and every string or
 * template literal's *text* gone while its `${…}` interpolations survive.
 *
 * Written as a scanner rather than as a regex, because every hole `check:chain-literals` had
 * to close was a tokenizer hole. Both directions bite an absence test over arithmetic: a `*`
 * inside a sentence is not multiplication (`treasury.ts` says "everything **vested** so far"
 * in user copy), and blanking whole template literals would also blank their interpolations
 * — which is precisely where a reinstated computation would sit.
 *
 * It knows nothing about regex literals, which neither module scanned with it contains; the
 * non-vacuity assertions beside each use are what keep that honest.
 */
type ScanMode =
  | { kind: 'code'; braces: number }
  | { kind: 'single' }
  | { kind: 'double' }
  | { kind: 'template' };

/**
 * A shift **operator**, as opposed to two closing generic brackets.
 *
 * `Readonly<Record<Exclude<K, 'x'>, string>>` ends in `>>`, so a substring scan for the
 * operator fires on ordinary TypeScript and the temptation is then to drop the check
 * entirely — which is how `B_1 << (round - 1)` would get back in. Matching an operator
 * *between operands* keeps the check and loses the collision.
 */
const SHIFT_OPERATOR = /[\w)\]]\s*(?:<<|>>>?)\s*[\w(]/;

const codeOnly = (source: string): string => {
  const src = withoutComments(source).replace(/^import[\s\S]*?;$/gm, '');
  // `braces: -1` marks the outermost frame, which never pops.
  const stack: ScanMode[] = [{ kind: 'code', braces: -1 }];
  let out = '';
  for (let index = 0; index < src.length; index += 1) {
    const top = stack[stack.length - 1] as ScanMode;
    const char = src[index] as string;
    if (char === '\\') {
      index += 1;
      continue;
    }
    if (top.kind === 'code') {
      if (char === "'") stack.push({ kind: 'single' });
      else if (char === '"') stack.push({ kind: 'double' });
      else if (char === '`') stack.push({ kind: 'template' });
      else if (char === '{' && top.braces >= 0) {
        top.braces += 1;
        out += char;
      } else if (char === '}' && top.braces >= 0) {
        if (top.braces === 0) stack.pop();
        else {
          top.braces -= 1;
          out += char;
        }
      } else out += char;
      continue;
    }
    if (top.kind === 'template') {
      if (char === '`') stack.pop();
      else if (char === '$' && src[index + 1] === '{') {
        stack.push({ kind: 'code', braces: 0 });
        index += 1;
        out += ' ';
      }
      continue;
    }
    if ((top.kind === 'single' && char === "'") || (top.kind === 'double' && char === '"')) {
      stack.pop();
    }
  }
  return out;
};

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

/**
 * `api.bond_quote` answering — 02 §4's `BondQuoteView`, as `BondQuoteState.quoted`.
 *
 * `exposure` is deliberately **not** derived from `bond` here. 07 §6.1's fold is the chain's
 * and the client performs none of it, so a fixture computing one from the other would encode
 * the very arithmetic `bond-quote.ts` is asserted to contain nowhere — and would then agree
 * with a client that had started doing it.
 */
const QUOTED = (bond: bigint, exposure: bigint, readAt = 1_000_000): BondQuoteState => ({
  kind: 'quoted',
  quote: { bond: finalized(bond), exposure: finalized(exposure), readAt: finalized(readAt) },
});

/** The chain answered `None` — 07 §7's not-determinable exposure, not a read failure. */
const UNDETERMINABLE: BondQuoteState = { kind: 'undeterminable' };
/** The call did not answer. A different state with a different remedy. */
const UNREAD_QUOTE: BondQuoteState = { kind: 'unread', reason: 'the state call timed out' };

/** What both instances carry — the clean path, so a refusal elsewhere is not this fixture. */
const FILING_BASE = () => ({
  freeUsdc: finalized(10_000_000n),
  filingBond: QUOTED(1_000_000n, 40_000_000n),
  filingsUsed: finalized(1),
  filingsBound: finalized(8),
  // §11.8.6's frozen-version clause (contract v29): the version the filing names, and the
  // set `Epoch.CohortSchedules[epoch].specs` says the live cohorts committed to.
  specVersion: 3,
  frozenSpecVersions: { kind: 'read', versions: finalized([2, 3]) } as FrozenSpecVersions,
  // `registry_core::file`'s `AlreadyFinal` — read from `ClosedAt[epoch][spec_version]`.
  epochClosed: { kind: 'open' } as EpochClosure,
  evidenceHash: '0xevidence' as string | undefined,
});

/**
 * §11.8.6 row 1's inputs, per instance.
 *
 * Two builders rather than one with a `kind` override, because `FilingInputs` is a union on
 * the instance and the class type differs across the arms (`validate_class`): a single
 * `Partial<FilingInputs>` would let a milestone fixture carry `S2`, which is the value the
 * union exists to make unbuildable.
 */
const FILING = (over: Partial<Extract<FilingInputs, { kind: 'incident' }>> = {}): FilingInputs =>
  ({ ...FILING_BASE(), kind: 'incident', class: 'S2', ...over });
const MILESTONE_FILING = (
  over: Partial<Extract<FilingInputs, { kind: 'milestone' }>> = {},
): FilingInputs => ({ ...FILING_BASE(), kind: 'milestone', class: { scope: 1 }, ...over });

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
/**
 * A decoded `ActivatePlaybook` power, as `Guardian.PendingActions` stores it.
 *
 * The default is `PB-LEDGER-FREEZE`/`LedgerDrift`, so every approval fixture below carries a
 * condition the model must evaluate — a default of `suspend_on_gate` or a rerun power would
 * have let the trigger arm sit unexercised behind a `no-condition` evidence value.
 */
const PLAYBOOK_POWER = (over: Partial<Extract<PendingPower, { kind: 'activate_playbook' }>> = {}):
  PendingPower => ({
  kind: 'activate_playbook',
  id: finalized<PlaybookId>('PB-LEDGER-FREEZE'),
  trigger: finalized<PlaybookTrigger>('LedgerDrift'),
  expiry: finalized(9_000),
  target: undefined,
  ...over,
});

const ACTION = (over: Partial<PendingAction> = {}): PendingAction => ({
  actionId: finalized('a1'), power: PLAYBOOK_POWER(),
  justificationHash: finalized('0xjh'), approvals: finalized(3),
  threshold: finalized(5), expiresAt: finalized(9_000), dispatched: finalized(false),
  // §11.8.2 requires the exact batch; an action without one cannot be built.
  calls: [CALL()], ...over,
});

/** A trigger reading, with its subject — the B4 repair, so every fixture names one. */
const subject = (trigger: PlaybookTrigger, cohort?: number): TriggerSubject =>
  trigger === 'OracleDeadlock'
    ? { trigger: 'OracleDeadlock', cohort: cohort ?? 0 }
    : { trigger };
const active = (trigger: PlaybookTrigger, cohort?: number): TriggerState =>
  ({ kind: 'active', subject: subject(trigger, cohort), since: finalized(1) });
const inactiveAt = (trigger: PlaybookTrigger, cohort?: number): TriggerState =>
  ({ kind: 'inactive', subject: subject(trigger, cohort) });
const unread = (trigger: PlaybookTrigger, reason = 'the storage read failed'): TriggerState =>
  ({ kind: 'unread', subject: subject(trigger), reason });

/**
 * Every **metered** power's allowance from the one `Guardian.Allowances` value (02 §7.4).
 *
 * Three entries, not five: `AllowanceState` carries counters for exactly these powers and
 * `check_and_consume` charges nothing for `activate_playbook` or `suspend_on_gate` (06 §5.2).
 * Adding either back is a compile error, which is the point — see the firewall fixture
 * `guardian-meter-on-an-unmetered-power.ts`.
 */
const ALLOWANCES = (used = 0, limit = 3): AllowanceBook => ({
  pause_intake: { used: finalized(used), limit: finalized(limit) },
  delay_once: { used: finalized(used), limit: finalized(limit) },
  force_rerun: { used: finalized(used), limit: finalized(limit) },
});

/**
 * The nine reads `allowanceBook` builds a book from — contract v30.
 *
 * The limits are the four constants 02 §9 freezes at their kernel values (2, 1, 1 and a
 * 4-epoch window), never a number this fixture chose. `ALLOWANCES` above stays a hand-built
 * record because the arithmetic tests only care about used-versus-limit — but before v30 that
 * shape was the **only** one available, and this suite shipped `finalized(3)` for every power
 * because no constant published a bound. That is the defect the freeze closes, so the producer
 * is exercised through its real inputs here.
 *
 * `pauseWindowStart === currentEpoch` by default: the window has just opened, which is the
 * state in which the stored counter means what it says.
 */
const READS = (
  over: Partial<Extract<AllowanceReads, { kind: 'read' }>> = {},
): AllowanceReads => ({
  kind: 'read',
  delayUsedThisEpoch: finalized(0),
  forceRerunUsedThisEpoch: finalized(0),
  pauseWindowStart: finalized(10),
  pauseUsedInWindow: finalized(0),
  currentEpoch: finalized(10),
  delayOnceAllowancePerEpoch: finalized(2),
  forceRerunAllowancePerEpoch: finalized(1),
  pauseIntakeAllowance: finalized(1),
  pauseIntakeAllowanceWindowEpochs: finalized(4),
  ...over,
});

/** The book, or a failure naming the refusal — so a test never silently asserts on a refusal. */
const bookOf = (reads: AllowanceReads): AllowanceBook => {
  const state = allowanceBook(reads);
  if (state.kind !== 'book') return assert.fail(`expected a book, got a refusal: ${state.reason}`);
  return state.book;
};

/** The registration and active-record reads an activation is admitted on (02 §7.4, v30). */
const ADMISSIBLE = (over: Partial<{
  readonly registration: RegistrationReading;
  readonly active: ActivePlaybookReading;
}> = {}): PlaybookAdmissibility => ({
  kind: 'activation',
  registration: { kind: 'read', registered: finalized(true) },
  active: { kind: 'read', ids: finalized<readonly PlaybookId[]>([]) },
  ...over,
});

/**
 * An approval context whose condition is, by default, the live one the action names.
 *
 * `playbooks` defaults from the **action's own power**, not from a constant: an activation
 * gets its registration and active-record reads and every other power gets `not-applicable`.
 * A fixture that handed activation evidence to a `pause_intake` would be building an incoherent
 * context, and `playbookBlocks` refuses exactly that — see V30-12, which supplies the wrong
 * kind on purpose. Overriding it still wins, which is how that test reaches the refusal.
 */
const APPROVE = (over: Partial<ApprovalContext> = {}): ApprovalContext => {
  const action = over.action ?? ACTION();
  return {
    action,
    justification: JUSTIFICATION(),
    callerIsMember: true,
    callerHasApproved: false,
    now: finalized(100),
    allowances: ALLOWANCES(),
    condition: { kind: 'trigger', reading: active('LedgerDrift') },
    // The default action is an activation, so the default dispatch evidence is its hold window.
    dispatch: { kind: 'hold', horizon: HORIZON },
    // …and, since contract v30 froze both maps, its registration and active-record reads.
    playbooks: action.power.kind === 'activate_playbook' ? ADMISSIBLE() : { kind: 'not-applicable' },
    ...over,
  };
};

/** `now` and `Guardian.PlaybookFreezeWindowBlocks`, read together. */
const HORIZON: HoldHorizon = { now: finalized(1_000), maxBlocks: finalized(100_000) };

/**
 * A `GateBreach` reading, narrowed — the only condition `suspend_on_gate` can be given.
 *
 * `TriggerState<'GateBreach'>` is not satisfiable by a general reading, which is 06 §5.2's
 * *"while a hard-gate daily breach flag is active"* written into the signature: a fixture
 * cannot hand that power a `LedgerDrift` answer even by accident.
 */
const gateReading = (kind: 'active' | 'inactive' | 'unread' = 'active'): TriggerState<'GateBreach'> => {
  if (kind === 'active') return { kind: 'active', subject: { trigger: 'GateBreach' }, since: finalized(1) };
  if (kind === 'inactive') return { kind: 'inactive', subject: { trigger: 'GateBreach' } };
  return { kind: 'unread', subject: { trigger: 'GateBreach' }, reason: 'the storage read failed' };
};

/** A meter narrowed to one metered power — the shape `GuardianProposal`'s arms demand. */
const METER = <P extends MeteredPower>(power: P, used = 0, limit = 3): AllowanceMeter<P> =>
  ({ power, used: finalized(used), limit: finalized(limit) });

/** A `Epoch.Proposals` reading that admits both rerun powers. */
const RERUNNABLE = (state: ProposalStateName = 'Queued'): RerunState => ({
  kind: 'read', state: finalized(state), rerun: finalized(false), delayedOnce: finalized(false),
});

/**
 * One complete proposal per power, defaulting to the state in which it is admissible.
 *
 * `registration` and `active` default to the admissible pair (registered, nothing active), so
 * every incumbent propose test stays a *clean-path* test. That default is exactly the hazard
 * the approve side hit: a suite whose fixture is always registered cannot tell the check from
 * its absence, so the propose-side refusals are asserted on their own fixtures below (V30-14,
 * V30-15) rather than being assumed to ride along.
 */
const ACTIVATION = (over: Partial<Extract<GuardianProposal, { power: 'activate_playbook' }>> = {}):
  GuardianProposal => ({
  power: 'activate_playbook',
  id: 'PB-HALT-INTAKE',
  trigger: active('GateBreach'),
  expiry: 9_000,
  horizon: HORIZON,
  registration: { kind: 'read', registered: finalized(true) },
  active: { kind: 'read', ids: finalized<readonly PlaybookId[]>([]) },
  ...over,
});

const PROPOSE = (proposal: GuardianProposal = ACTIVATION()): ProposeInputs =>
  ({ proposal, justificationHash: '0xj' });

/**
 * The two playbooks this release refuses whatever the pairing says, and their triggers.
 *
 * Both refusals are 06 §6.2's and both are release-fixed rather than chain-read, and they are
 * still different facts with different remedies: `PB-DEPEG` has no on-chain condition that can
 * set its trigger (`TRIGGER_READS.DepegMedian` is empty), while `PB-MIGRATION`'s condition is
 * perfectly readable and its **admissible call set** is empty — *"a fifth approval reaching it
 * fails closed, the whole extrinsic reverts, and nothing is recorded"*.
 *
 * Written as data because three tests enumerate the whole 6 × 8 pairing space and a literal
 * `id === 'PB-DEPEG'` in each of them is three places to forget the second one.
 */
const RELEASE_REFUSED_PLAYBOOKS = new Set<PlaybookId>(['PB-DEPEG', 'PB-MIGRATION']);
const RELEASE_REFUSED_TRIGGERS = new Set<PlaybookTrigger>(['DepegMedian', 'MigrationHalt']);

test('an unread trigger is treated exactly as an inactive one', () => {
  // E20: playbooks are admissible only under VERIFIED triggers. Collapsing "could not
  // check" into "checked and fine" is the fail-open reading, on the one power whose whole
  // justification is that the condition holds right now.
  assert.equal(mayActivatePlaybook(active('GateBreach')), true);
  assert.equal(mayActivatePlaybook(inactiveAt('GateBreach')), false);
  assert.equal(mayActivatePlaybook(unread('GateBreach')), false);
  // And the two refusals say different things, because the guardian's next step differs.
  assert.match(copy(triggerRefusal(inactiveAt('GateBreach'))), /the condition being absent/);
  assert.match(copy(triggerRefusal(unread('GateBreach'))), /could not establish/);
  assert.equal(triggerRefusal(active('GateBreach')), undefined);
});

test('a trigger reading names the cohort it was READ FOR, and one is not the other (B4)', () => {
  // 11 §11.8.2's `OracleDeadlock` row: "`contains_key(target)` for the **exact cohort** the
  // activation names … a client MUST evaluate this against the `target` in the call, never
  // against the map's non-emptiness". `OracleDeadlock` and `VoidInFlight` read the SAME frozen
  // item under different predicates, so a reading carrying only the variant let the second
  // answer — "is any cohort latched?" — be handed over as the first. A `PB-ORACLE-VOID`
  // naming cohort 42 then passed while cohort 7 was the latched one.
  //
  // The type is the fix: the `OracleDeadlock` subject has a `cohort` field and the other
  // seven do not, so the question cannot be answered without saying what it was asked about.
  const forSeven = active('OracleDeadlock', 7);
  assert.equal(triggerOf(forSeven), 'OracleDeadlock');
  assert.deepEqual(forSeven.subject, { trigger: 'OracleDeadlock', cohort: 7 });
  // The VoidInFlight answer over the same storage item carries no cohort at all — there is
  // no field for one, so it cannot be mistaken for a per-cohort answer.
  assert.deepEqual(active('VoidInFlight').subject, { trigger: 'VoidInFlight' });
  assert.deepEqual(TRIGGER_READS.OracleDeadlock, TRIGGER_READS.VoidInFlight);

  // And the cohort the client evaluated is the cohort the call carries — one number, so a
  // reading for 7 cannot authorize an activation naming 42.
  const call = guardianCall(ACTIVATION({ id: 'PB-ORACLE-VOID', trigger: forSeven }));
  assert.deepEqual(call, {
    power: 'activate_playbook', id: 'PB-ORACLE-VOID', trigger: 'OracleDeadlock',
    expiry: 9_000, target: 7,
  });
});

test('the encoded call is DERIVED, so `target` follows the runtime’s two-sided rule', () => {
  // `guardian_core` requires `Some` for `PlaybookId::OracleVoid` and `None` for every other
  // playbook (`BadPlaybookTarget`), and the chain checks it after five approvals. The client
  // no longer *checks* the rule — it cannot break it, because `target` comes from the same
  // reading `trigger` comes from and no playbook but the VOID one admits `OracleDeadlock`.
  //
  // Iterated over `PLAYBOOK_TRIGGERS`, which the drift-lock test below binds to
  // `guardian_core::trigger_matches` AND to doc 11's own table in both directions — so this
  // is a checked restatement rather than the client agreeing with itself.
  const pairs = Object.entries(PLAYBOOK_TRIGGERS) as [PlaybookId, readonly PlaybookTrigger[]][];
  assert.ok(pairs.length > 0, 'no playbook pairs to enumerate');
  for (const [id, triggers] of pairs) {
    for (const trigger of triggers) {
      const call = guardianCall(ACTIVATION({ id, trigger: active(trigger, 42) }));
      assert.equal(call.power, 'activate_playbook');
      if (call.power !== 'activate_playbook') return;
      assert.equal(call.trigger, trigger, `${id} encoded a trigger it did not evaluate`);
      assert.equal(
        call.target,
        id === 'PB-ORACLE-VOID' ? 42 : undefined,
        `${id}/${trigger} builds a call the chain answers BadPlaybookTarget`,
      );
    }
  }
  // The other four powers encode their own arguments and nothing else.
  assert.deepEqual(
    guardianCall({ power: 'suspend_on_gate', gate: gateReading() }),
    { power: 'suspend_on_gate' },
  );
  assert.deepEqual(
    guardianCall({ power: 'pause_intake', meter: METER('pause_intake'), until: 5_000, horizon: HORIZON }),
    { power: 'pause_intake', until: 5_000 },
  );
});

test('the trigger verdict is DRIVEN by TRIGGER_READS, not by the caller’s arm (SQ-730)', () => {
  // §11.8.2's table maps each variant to the frozen item that establishes it, and until
  // 2026-08-07 nothing in `src/` derived from it: `mayActivatePlaybook` believed whatever
  // arm it was handed. `DepegMedian` binds to NO read (06 §6.2 makes PB-DEPEG unavailable in
  // v1), so an `active` claim about it is a claim about a check that could not have run.
  assert.deepEqual(TRIGGER_READS.DepegMedian, []);
  assert.equal(mayActivatePlaybook(active('DepegMedian')), false);
  assert.equal(copy(triggerRefusal(active('DepegMedian'))), DEPEG_TRIGGER_UNAVAILABLE);
  // The mirror, so the table is load-bearing in both directions rather than a special case
  // for one name: a variant the table DOES bind cannot be reported `unavailable`, because
  // this release can read it and "will never become true" is not something it can say.
  const bogus = copy(
    triggerRefusal({ kind: 'unavailable', subject: subject('LedgerDrift') }),
  );
  assert.match(bogus, /storage\.ledger\.ledger_drifted/);
  assert.equal(
    mayActivatePlaybook({ kind: 'unavailable', subject: subject('LedgerDrift') }),
    false,
  );
  // Anti-vacuity: the same arm on a variant with a read is not simply refused for every
  // input — `active` on `LedgerDrift` passes, so the refusals above are about the table.
  assert.equal(mayActivatePlaybook(active('LedgerDrift')), true);
});

test('approving twice is its own refusal, not "not eligible"', () => {
  // A guardian who approves again believes they moved the count. Folding this into a
  // generic refusal leaves them unable to tell whether the action is stuck or they are.
  const blocks = approvalBlocks(APPROVE({ callerHasApproved: true }));
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
  const blocks = approvalBlocks(APPROVE({ action: ACTION({ dispatched: finalized(true) }) }));
  assert.deepEqual(blocks.map((b) => b.check), ['Already dispatched']);
  assert.match(nth(blocks, 0, 'block').detail, /already executed/);
  // It must not read as expiry or as a lost race: the action ran, and the listing is deliberate.
  assert.match(nth(blocks, 0, 'block').detail, /still be vetoed/);

  // The control: the same action un-dispatched blocks nothing, so this is not a check that
  // fires on everything.
  assert.deepEqual(approvalBlocks(APPROVE({ action: ACTION({ dispatched: finalized(false) }) })), []);
});

test('every approval blocker is reported together', () => {
  const blocks = approvalBlocks(
    APPROVE({ action: ACTION({ expiresAt: finalized(10) }), callerIsMember: false, callerHasApproved: true }),
  );
  assert.deepEqual(blocks.map((b) => b.check).sort(), ['Already approved', 'Expiry', 'Membership']);
  // And a clean context blocks nothing, so the checks are not vacuously firing.
  assert.deepEqual(approvalBlocks(APPROVE()), []);
});

test('B1 — an approval evaluates the trigger the ACTION names, or it is refused (E20)', () => {
  // 11 §11.12 E20's F-facet: "trigger condition not active at B′ ⇒ blocked (playbooks are
  // admissible only under verified triggers)". `ApprovalContext` carried no trigger and
  // `approvalBlocks` had no clause for one, so the approve flow evaluated the condition not
  // at all — while the runtime enforces it at the FIFTH approval, inside `dispatch`.
  //
  // The reproduction: a `PB-HALT-INTAKE` proposed while `GateBreachFlags` was set and
  // approved after it cleared. Before the fix the block list was empty; the fifth guardian
  // saw an enabled button whose transaction reverts with `TriggerInactive`.
  const halt = ACTION({
    power: PLAYBOOK_POWER({
      id: finalized<PlaybookId>('PB-HALT-INTAKE'),
      trigger: finalized<PlaybookTrigger>('GateBreach'),
    }),
  });
  const cleared: ConditionEvidence = { kind: 'trigger', reading: inactiveAt('GateBreach') };
  const blocks = approvalBlocks(APPROVE({ action: halt, condition: cleared }));
  assert.notDeepEqual(blocks, [], 'an inactive trigger must not produce an empty block list');
  assert.deepEqual(blocks.map((b) => b.check), ['Trigger condition']);
  assert.match(nth(blocks, 0, 'block').detail, /the condition being absent/);
  assert.match(nth(blocks, 0, 'block').detail, /threshold approval/);

  // Still set: the approval is clean, so the refusal above is about the condition.
  assert.deepEqual(
    approvalBlocks(
      APPROVE({ action: halt, condition: { kind: 'trigger', reading: active('GateBreach') } }),
    ),
    [],
  );
  // And "could not read" lands on the refusing side, exactly as it does on the propose flow.
  assert.deepEqual(
    approvalBlocks(
      APPROVE({ action: halt, condition: { kind: 'trigger', reading: unread('GateBreach') } }),
    ).map((b) => b.check),
    ['Trigger condition'],
  );
});

test('B1 — evidence for a DIFFERENT condition is a check that did not run', () => {
  // A required field still says nothing about whether it describes the same action as its
  // neighbours — the lesson of the first repair round. So the subject is compared: an action
  // depending on `GateBreach` approved on a live `LedgerDrift` reading is refused.
  const halt = ACTION({
    power: PLAYBOOK_POWER({
      id: finalized<PlaybookId>('PB-HALT-INTAKE'),
      trigger: finalized<PlaybookTrigger>('GateBreach'),
    }),
  });
  const blocks = approvalBlocks(
    APPROVE({ action: halt, condition: { kind: 'trigger', reading: active('LedgerDrift') } }),
  );
  assert.deepEqual(blocks.map((b) => b.check), ['Trigger condition']);
  assert.match(nth(blocks, 0, 'block').detail, /reading supplied is for LedgerDrift/);

  // The cohort half, which is B4 on the approval side: a VOID action naming cohort 42 is not
  // authorized by a deadlock reading taken for cohort 7.
  const wrongCohort = approvalBlocks(
    APPROVE({
      action: ACTION_ROW(),
      condition: { kind: 'trigger', reading: active('OracleDeadlock', 7) },
    }),
  );
  assert.deepEqual(wrongCohort.map((b) => b.check), ['Trigger condition']);
  assert.match(nth(wrongCohort, 0, 'block').detail, /cohort 42/);
  assert.match(nth(wrongCohort, 0, 'block').detail, /never authorizes VOID of another/);
  // The right cohort is clean, so the refusal is the cohort's and not the variant's.
  assert.deepEqual(approvalBlocks(APPROVE_ROW()), []);

  // A VOID action carrying NO cohort target has no question to ask on its behalf, and the
  // map's non-emptiness is the reading 11 §11.8.2 forbids substituting.
  const noTarget = approvalBlocks(
    APPROVE({
      action: ACTION({
        power: PLAYBOOK_POWER({
          id: finalized<PlaybookId>('PB-ORACLE-VOID'),
          trigger: finalized<PlaybookTrigger>('OracleDeadlock'),
          target: undefined,
        }),
      }),
      condition: { kind: 'trigger', reading: active('OracleDeadlock', 7) },
    }),
  );
  assert.deepEqual(noTarget.map((b) => b.check), ['Trigger condition']);
  assert.match(nth(noTarget, 0, 'block').detail, /names no cohort/);
});

test('B1 — the three powers with no condition say so, and saying it wrongly is refused', () => {
  const pause = ACTION({ power: { kind: 'pause_intake', until: finalized(50_000) } });
  assert.deepEqual(approvalBlocks(APPROVE({ action: pause, condition: { kind: 'no-condition' } })), []);
  // The mirror: evidence supplied for a power that depends on none means two actions have
  // been confused, and ignoring it approves whichever one the rest of the context describes.
  const misplaced = approvalBlocks(
    APPROVE({ action: pause, condition: { kind: 'trigger', reading: active('GateBreach') } }),
  );
  assert.deepEqual(misplaced.map((b) => b.check), ['Trigger condition']);
  assert.match(nth(misplaced, 0, 'block').detail, /only activate_playbook/);
  // And the other mirror: `no-condition` claimed for a power that HAS one is the omission
  // this repair exists to stop — the trigger was never evaluated.
  const omitted = approvalBlocks(APPROVE({ condition: { kind: 'no-condition' } }));
  assert.deepEqual(omitted.map((b) => b.check), ['Trigger condition']);
  assert.match(nth(omitted, 0, 'block').detail, /never evaluated/);
});

test('B2 — the approve flow refuses a MISPAIRED playbook (BadPlaybookTrigger), which nothing checked', () => {
  // The blocker of 2026-08-08. `check_and_consume` raises `BadPlaybookTrigger` at the
  // **threshold** approval (`crates/guardian-core/src/lib.rs`), and `approvalBlocks` →
  // `conditionBlocks` asked only whether the reading's subject equalled the action's named
  // trigger and whether that trigger was active. It never asked whether the named **playbook**
  // admits the trigger at all.
  //
  // That is reachable, and by the shortest path there is: `propose_action` validates nothing
  // on chain, so a mispaired action created by any other tool sits in `Guardian.PendingActions`
  // for three days looking approvable — with a live, correctly-subjected trigger reading beside
  // it, which is exactly what makes the old check pass.
  //
  // `PLAYBOOK_TRIGGERS` was already in the same module and the *propose* side already consulted
  // it. Only the approve side, the one flow that inspects somebody else's bytes, did not.
  const mispaired = ACTION({
    power: PLAYBOOK_POWER({
      id: finalized<PlaybookId>('PB-RESERVE'),
      trigger: finalized<PlaybookTrigger>('GateBreach'),
      target: undefined,
    }),
  });
  const blocks = approvalBlocks(
    APPROVE({ action: mispaired, condition: { kind: 'trigger', reading: active('GateBreach') } }),
  );
  assert.deepEqual(blocks.map((b) => b.check), ['Trigger']);
  assert.match(nth(blocks, 0, 'block').detail, /PB-RESERVE is not activated by the GateBreach condition/);
  // It names the cost, because "propose it again" is the only remedy — an approval cannot
  // repair the pairing, and a guardian told only "refused" would keep signing.
  assert.match(nth(blocks, 0, 'block').detail, /threshold approval/);
  assert.match(nth(blocks, 0, 'block').detail, /needs proposing again/);

  // The whole 6 × 8 space, so this is the rule and not one fixture. Every unlawful pairing is
  // refused; every lawful one is not refused *for this reason*.
  for (const [id, triggers] of Object.entries(PLAYBOOK_TRIGGERS) as [PlaybookId, readonly PlaybookTrigger[]][]) {
    for (const trigger of DOC_TRIGGERS) {
      const action = ACTION({
        power: PLAYBOOK_POWER({
          id: finalized<PlaybookId>(id),
          trigger: finalized<PlaybookTrigger>(trigger),
          target: trigger === 'OracleDeadlock' ? finalized(42) : undefined,
        }),
      });
      const checks = approvalBlocks(
        APPROVE({ action, condition: { kind: 'trigger', reading: active(trigger, 42) } }),
      ).map((b) => b.check);
      assert.equal(
        checks.includes('Trigger'),
        !triggers.includes(trigger),
        `${id}/${trigger} pairing verdict is wrong: ${checks.join(', ')}`,
      );
    }
  }
});

test('B2 — the approve flow refuses a stray cohort target (BadPlaybookTarget), the other half', () => {
  // `check_and_consume`: `(OracleVoid, Some(_))` or `(not OracleVoid, None)`, and anything else
  // is `BadPlaybookTarget` — again at the threshold approval. The client's *propose* side
  // cannot build the wrong shape (`guardianCall` derives `target` from the reading's own
  // subject), which is exactly why the approve side needs the check: it reads bytes this
  // client did not build.
  const strayTarget = ACTION({
    power: PLAYBOOK_POWER({
      id: finalized<PlaybookId>('PB-HALT-INTAKE'),
      trigger: finalized<PlaybookTrigger>('GateBreach'),
      target: finalized(42),
    }),
  });
  const blocks = approvalBlocks(
    APPROVE({ action: strayTarget, condition: { kind: 'trigger', reading: active('GateBreach') } }),
  );
  assert.deepEqual(blocks.map((b) => b.check), ['Cohort target']);
  assert.match(nth(blocks, 0, 'block').detail, /PB-HALT-INTAKE carries a cohort target \(42\)/);
  assert.match(nth(blocks, 0, 'block').detail, /only PB-ORACLE-VOID takes/);

  // The lawful VOID carries one and is clean, so the check is about the pairing rather than
  // about targets in general.
  assert.deepEqual(approvalBlocks(APPROVE_ROW()), []);

  // The mirror — a VOID with NO target — is refused by `subjectMismatch` rather than here,
  // because the remedy differs: there is no question to ask on its behalf at all, and the
  // map's non-emptiness is the substitution 11 §11.8.2 forbids.
  const noTarget = approvalBlocks(
    APPROVE({
      action: ACTION({
        power: PLAYBOOK_POWER({
          id: finalized<PlaybookId>('PB-ORACLE-VOID'),
          trigger: finalized<PlaybookTrigger>('OracleDeadlock'),
          target: undefined,
        }),
      }),
      condition: { kind: 'trigger', reading: active('OracleDeadlock', 7) },
    }),
  );
  assert.deepEqual(noTarget.map((b) => b.check), ['Trigger condition']);

  // And both halves report together when both are wrong, because they have different fixes.
  const both = approvalBlocks(
    APPROVE({
      action: ACTION({
        power: PLAYBOOK_POWER({
          id: finalized<PlaybookId>('PB-RESERVE'),
          trigger: finalized<PlaybookTrigger>('GateBreach'),
          target: finalized(42),
        }),
      }),
      condition: { kind: 'trigger', reading: active('GateBreach') },
    }),
  );
  assert.deepEqual(both.map((b) => b.check), ['Trigger', 'Cohort target']);
});

// ------------------------------------------- the allowance book's producer (contract v30)

test('V30-1 — the book is built from the frozen reads, and each limit lands on its own power', () => {
  // Until contract v30 `AllowanceMeter.limit` had **no producer**: `Guardian.Allowances`
  // stores used-counters and no `constant.guardian.*` published a bound, so the only way to
  // satisfy §11.8.2's "allowance remaining for the power" precondition was to fabricate one.
  // The four constants are frozen now, and this is the function that consumes them.
  //
  // Three distinct limits, because the defect a mapping can have is a **swap**: a producer
  // that handed `force_rerun`'s bound to `delay_once` is right about every number and wrong
  // about every power, and a fixture using one value for all three cannot see it.
  const book = bookOf(
    READS({
      delayOnceAllowancePerEpoch: finalized(2),
      forceRerunAllowancePerEpoch: finalized(1),
      pauseIntakeAllowance: finalized(7),
      delayUsedThisEpoch: finalized(11),
      forceRerunUsedThisEpoch: finalized(12),
      pauseUsedInWindow: finalized(13),
    }),
  );
  assert.equal(book.delay_once.limit.value, 2);
  assert.equal(book.force_rerun.limit.value, 1);
  assert.equal(book.pause_intake.limit.value, 7);
  assert.equal(book.delay_once.used.value, 11);
  assert.equal(book.force_rerun.used.value, 12);
  assert.equal(book.pause_intake.used.value, 13);
  // Exactly the three powers `AllowanceState` counts — see M4 for why the other two have none.
  assert.deepEqual(Object.keys(book).sort(), ['delay_once', 'force_rerun', 'pause_intake']);
});

test('V30-2 — a pause_intake meter whose WINDOW has elapsed is available, not exhausted', () => {
  // **The one that matters, and the one a naive subtraction gets wrong in the dangerous
  // direction.** `check_and_consume` resets the pause counter lazily, at consume time:
  //
  //   if self.current_epoch.saturating_sub(self.pause_used_epoch_window_start)
  //       >= PAUSE_INTAKE_ALLOWANCE_WINDOW_EPOCHS
  //   { …window_start = current_epoch; …used_in_window = 0; }
  //   ensure!(self.pause_used_in_window < PAUSE_INTAKE_ALLOWANCE, AllowanceExhausted);
  //
  // So the stored counter is **stale outside the window**. With `PauseIntakeAllowance = 1` a
  // client reading `pause_used_in_window = 1` and subtracting shows zero remaining — an
  // exhausted meter — while the chain would reset the window and accept the call. That is the
  // client refusing what the runtime accepts, on an emergency power.
  const elapsed = bookOf(
    READS({ pauseWindowStart: finalized(0), currentEpoch: finalized(4), pauseUsedInWindow: finalized(1) }),
  );
  assert.equal(elapsed.pause_intake.used.value, 0, 'the stale counter was carried past its window');
  const remaining = allowanceRemaining(meterFor(elapsed, 'pause_intake'));
  assert.equal(remaining.kind, 'stated');
  assert.equal(remaining.kind === 'stated' ? remaining.datum.value : -1, 1);
  // …and the model agrees: the propose control is open.
  assert.deepEqual(
    proposalBlocks(
      PROPOSE({
        power: 'pause_intake',
        meter: meterFor(elapsed, 'pause_intake'),
        until: 5_000,
        horizon: HORIZON,
      }),
    ),
    [],
    'a pause_intake whose window elapsed is refused an allowance the chain would grant',
  );

  // The inside-window case, which is the anti-vacuity control. A test covering only this one
  // passes against the naive subtraction, which is exactly how the defect would survive.
  const inWindow = bookOf(
    READS({ pauseWindowStart: finalized(0), currentEpoch: finalized(3), pauseUsedInWindow: finalized(1) }),
  );
  assert.equal(inWindow.pause_intake.used.value, 1, 'a live window must keep its counter');
  assert.deepEqual(
    proposalBlocks(
      PROPOSE({
        power: 'pause_intake',
        meter: meterFor(inWindow, 'pause_intake'),
        until: 5_000,
        horizon: HORIZON,
      }),
    ).map((b) => b.check),
    ['Allowance'],
    'a pause_intake inside a spent window must still be refused',
  );
});

test('V30-3 — the window boundary is the pallet’s `>=`, and its subtraction saturates', () => {
  // Off-by-one in either direction is a real defect with a real cost: one epoch early grants
  // a second emergency pause inside its window, one epoch late refuses a lawful one. The
  // pallet's comparison is `>=`, so elapsed == window resets and elapsed == window - 1 does
  // not — asserted at both sides of the same boundary rather than at a comfortable distance.
  const usedAt = (start: number, now: number, window = 4): number =>
    bookOf(
      READS({
        pauseWindowStart: finalized(start),
        currentEpoch: finalized(now),
        pauseUsedInWindow: finalized(1),
        pauseIntakeAllowanceWindowEpochs: finalized(window),
      }),
    ).pause_intake.used.value;
  assert.equal(usedAt(10, 13), 1, 'elapsed 3 of a 4-epoch window is still inside it');
  assert.equal(usedAt(10, 14), 0, 'elapsed 4 of a 4-epoch window has left it');

  // **`saturating_sub`, not a signed subtraction**, and the window length is a *read* rather
  // than the 4 this release happens to see — so the arithmetic must be the chain's for every
  // value it can return, not only for the current one. Both fields are `EpochId`, and Rust's
  // subtraction on them saturates at zero.
  //
  // A window start ahead of the current epoch is state a reorg or a mixed read produces. At
  // window 4 the two spellings agree by luck (`-6 >= 4` and `0 >= 4` are both false), which is
  // exactly why that case alone proves nothing — a signed-subtraction mutant survives it. They
  // part at window 0, where the chain resets on every consume: saturating gives `0 >= 0`,
  // signed gives `-6 >= 0`, and the client would carry a counter the chain had just cleared.
  assert.equal(usedAt(20, 14), 1, 'a window start ahead of the epoch must saturate, not go negative');
  assert.equal(usedAt(20, 14, 0), 0, 'the subtraction is unsigned and saturating, as the chain’s is');
  assert.equal(usedAt(10, 14, 0), 0, 'a zero-length window resets on every read, as the chain does');
});

test('V30-4 — the two per-epoch counters are NOT windowed, and the pallet is why', () => {
  // The asymmetry is a fact about `pallets/guardian`, not a simplification here.
  // `sync_epoch()` zeroes both per-epoch counters in `on_initialize`, so at any finalized
  // block they are already current and pass straight through; nothing resets the pause pair
  // outside `check_and_consume`, which is why exactly one meter is derived.
  //
  // Asserted against the pallet source, so a change that made the reset lazy — or that made
  // the pause reset eager — fails here and says which way the client must move.
  const pallet = readFileSync(join(REPO, 'pallets/guardian/src/lib.rs'), 'utf8');
  assert.match(
    pallet,
    /fn on_initialize\([^)]*\) -> Weight \{\s*Self::sync_epoch\(\);/,
    'the per-epoch allowance reset left on_initialize — the client must window those counters too',
  );
  assert.match(
    pallet,
    /fn sync_epoch\(\) \{[\s\S]*?a\.delay_used_this_epoch = 0;\s*a\.force_rerun_used_this_epoch = 0;/,
    'sync_epoch no longer resets both per-epoch counters',
  );
  assert.ok(
    !/sync_epoch\(\)[\s\S]{0,400}pause_used_in_window = 0/.test(pallet),
    'the pause counter gained an eager reset — the client’s window test is now double-counting',
  );

  // The client half of the same claim: a stale-looking per-epoch counter is reported as read,
  // whatever the pause window is doing beside it.
  const book = bookOf(
    READS({
      delayUsedThisEpoch: finalized(2),
      forceRerunUsedThisEpoch: finalized(1),
      pauseWindowStart: finalized(0),
      currentEpoch: finalized(99),
      pauseUsedInWindow: finalized(1),
    }),
  );
  assert.equal(book.delay_once.used.value, 2);
  assert.equal(book.force_rerun.used.value, 1);
  assert.equal(book.pause_intake.used.value, 0, 'the pause counter is the only windowed one');
});

test('V30-5 — an unreadable input refuses the book and names the reads, never a zero', () => {
  // INV-FE-12's lattice: an unproven capability is *absent*, and absence disables the
  // dependent surface with a named reason. A substituted zero would read as *no allowance
  // has been used* — the most permissive answer available — on the five most privileged
  // actions in the system.
  const refused = allowanceBook({ kind: 'unread', reason: 'the storage read failed' });
  assert.equal(refused.kind, 'unreadable');
  if (refused.kind !== 'unreadable') return;
  assert.match(refused.reason, /the storage read failed/);
  // The refusal names the surfaces a meter is read from, taken from `ALLOWANCE_READS` rather
  // than written out — so the sentence cannot drift from the table the client actually reads.
  for (const surface of new Set(Object.values(ALLOWANCE_READS).flat())) {
    assert.ok(refused.reason.includes(surface), `the refusal does not name ${surface}`);
  }
});

test('V30-6 — reads at different blocks refuse the book rather than badging the difference', () => {
  // The window test is a value derived from four reads. Carrying one input's status would be
  // a promotion by arithmetic (app-code rule 2's rule B) and two verified reads at different
  // blocks describe **no** block, which no status can express — so `combine` refuses and the
  // book refuses with it.
  const otherBlock = {
    value: 0,
    status: {
      kind: 'verified-finalized',
      chain: TEST_CHAIN,
      blockHash: '0xbeef',
      blockNumber: 9,
    },
  } as const;
  const state = allowanceBook(READS({ pauseWindowStart: otherBlock }));
  assert.equal(state.kind, 'unreadable');
  if (state.kind !== 'unreadable') return;
  assert.match(state.reason, /different blocks/);
  assert.match(state.reason, /only meaningful inside its window/);
});

test('V30-7 — the derived pause figure carries its weakest input’s provenance', () => {
  // INV-FE-1: provider data is never promoted to verified. The window test reads the epoch,
  // and an epoch this client did not verify makes the derived counter unverified too — the
  // badge follows the arithmetic, not the counter it started from.
  const book = bookOf(
    READS({
      pauseUsedInWindow: finalized(1),
      currentEpoch: { value: 10, status: { kind: 'provider', providerId: 'acme', sampled: false } },
    }),
  );
  assert.equal(book.pause_intake.used.status.kind, 'provider');
  // The unwindowed counters keep their own status, because nothing was derived from them.
  assert.equal(book.delay_once.used.status.kind, 'verified-finalized');
});

test('V30-8 — ALLOWANCE_READS names frozen surfaces, and the pause meter needs four', () => {
  // App-code rule 7: reads go through declared `SurfaceId`s. The type already restricts the
  // ids to `CRITICAL_SURFACE`; what this pins is the *content* — that the pause meter names
  // its window length and the epoch to measure it from, which is the whole difference between
  // a meter and a counter for that power.
  assert.deepEqual(
    [...ALLOWANCE_READS.pause_intake].sort(),
    [
      'constant.guardian.pause_intake_allowance',
      'constant.guardian.pause_intake_allowance_window_epochs',
      'storage.epoch.epoch_of',
      'storage.guardian.allowances',
    ],
  );
  assert.deepEqual(
    [...ALLOWANCE_READS.delay_once].sort(),
    ['constant.guardian.delay_once_allowance_per_epoch', 'storage.guardian.allowances'],
  );
  assert.deepEqual(
    [...ALLOWANCE_READS.force_rerun].sort(),
    ['constant.guardian.force_rerun_allowance_per_epoch', 'storage.guardian.allowances'],
  );
  // Every one of them is declared on both guardian rows, so the gate re-reads at B′ what the
  // meter was computed from. A read the model performs and the row does not declare is one
  // `clauseGroupsFor` reports as vacuously passed.
  for (const row of ['O-3', 'O-4'] as const) {
    const declared = new Set(rowsFor(row, 'USDC').map((entry) => entry.surface));
    for (const surface of new Set(Object.values(ALLOWANCE_READS).flat())) {
      assert.ok(declared.has(surface), `${row} does not declare ${surface}`);
    }
  }
});

test('M4 — the two powers the chain does NOT meter are not refused on a meter (06 §5.2)', () => {
  // 06 §5.2's Allowance column gives `activate_playbook` "per-playbook" and `suspend_on_gate`
  // "condition-gated". Neither is a counter, and `guardian_core::check_and_consume` charges no
  // allowance for either — its `ActivatePlaybook` arm checks expiry, pairing, target and
  // trigger, and its `SuspendOnGate` arm checks the gate flag alone.
  //
  // `AllowanceBook` was a total record over all five powers and `allowanceBlocks` ran
  // unconditionally, so a supplied `used >= limit` refused a lawful activation: a client
  // refusing what the runtime accepts, which 15 §4.8's mirror rule forbids in those words.
  //
  // The chain's own storage says the same thing in its shape — `AllowanceState` is
  // `{ delay_used_this_epoch, force_rerun_used_this_epoch, pause_window_start,
  //    pause_used_in_window }`.
  const exhausted = ALLOWANCES(3, 3);
  assert.deepEqual(Object.keys(exhausted).sort(), ['delay_once', 'force_rerun', 'pause_intake']);
  assert.equal(isMetered('pause_intake'), true);
  assert.equal(isMetered('delay_once'), true);
  assert.equal(isMetered('force_rerun'), true);
  assert.equal(isMetered('activate_playbook'), false);
  assert.equal(isMetered('suspend_on_gate'), false);

  // Approve: an exhausted book blocks neither unmetered power.
  assert.deepEqual(approvalBlocks(APPROVE({ allowances: exhausted })), []);
  const suspend = ACTION({ power: { kind: 'suspend_on_gate' } });
  assert.deepEqual(
    approvalBlocks(
      APPROVE({
        action: suspend,
        allowances: exhausted,
        condition: { kind: 'trigger', reading: active('GateBreach') },
        dispatch: { kind: 'not-applicable' },
      }),
    ),
    [],
  );
  // …and the anti-vacuity control: the same exhausted book DOES block a metered power, so the
  // book is genuinely exhausted rather than the check being switched off.
  const pause = ACTION({ power: { kind: 'pause_intake', until: finalized(50_000) } });
  assert.deepEqual(
    approvalBlocks(
      APPROVE({ action: pause, condition: { kind: 'no-condition' }, allowances: exhausted }),
    ).map((b) => b.check),
    ['Allowance'],
  );

  // Propose: the unmetered arms carry no meter field at all, so the refusal is not merely
  // skipped — there is no value to skip it on. The compiler is the other half of this check
  // (`tests/firewall/fixtures/guardian-meter-on-an-unmetered-power.ts`).
  assert.deepEqual(proposalBlocks(PROPOSE(ACTIVATION())), []);
  assert.deepEqual(
    proposalBlocks(PROPOSE({ power: 'suspend_on_gate', gate: gateReading() })),
    [],
  );

  // And the console renders no meter for them, because a figure there is a budget the chain
  // does not keep — the field is absent rather than showing a zero or a fabricated limit.
  const activationHtml = renderToStaticMarkup(
    h(ApproveAction, { context: APPROVE_ROW(), session: readySession('O-3'), onApprove: noSubmit }),
  );
  assert.ok(!fieldPresent(activationHtml, 'Allowance remaining for activate_playbook'), activationHtml);
  assert.ok(!/Allowance remaining/.test(activationHtml), activationHtml);
  const proposeHtml = renderToStaticMarkup(
    h(ProposeAction, { inputs: PROPOSE(), session: readySession('O-4'), onPropose: noSubmit }),
  );
  assert.ok(!/Allowance remaining/.test(proposeHtml), proposeHtml);
  // Anti-vacuity for the render: a metered power still shows its meter.
  const meteredHtml = renderToStaticMarkup(
    h(ProposeAction, {
      inputs: PROPOSE({ power: 'pause_intake', meter: METER('pause_intake'), until: 5_000, horizon: HORIZON }),
      session: readySession('O-4'),
      onPropose: noSubmit,
    }),
  );
  assert.ok(fieldPresent(meteredHtml, 'Allowance remaining'), meteredHtml);
});

// ------------------------------- the two playbook maps contract v30 froze (SQ-1030 closed)

/** An approval of one named playbook, with its admissibility reads. */
const ACTIVATION_OF = (
  id: PlaybookId,
  trigger: PlaybookTrigger,
  playbooks: PlaybookAdmissibility = ADMISSIBLE(),
): ApprovalContext =>
  APPROVE({
    action: ACTION({
      power: PLAYBOOK_POWER({ id: finalized<PlaybookId>(id), trigger: finalized<PlaybookTrigger>(trigger) }),
    }),
    condition: { kind: 'trigger', reading: active(trigger) },
    playbooks,
  });

test('V30-9 — an unregistered playbook is refused, on the approval the chain refuses it on', () => {
  // `approve_action` reads `PlaybookRegistered::<T>::get(id)` **after** counting the fifth
  // approval and reverts the whole extrinsic (`pallets/guardian/src/lib.rs`). Until contract
  // v30 froze the map this was a `blocking` unreadable obligation citing SQ-1030, which closed
  // S15's approve control for every activation rather than refusing the ones the chain does.
  assert.deepEqual(approvalBlocks(ACTIVATION_OF('PB-RESERVE', 'ReserveHealth')), []);
  assert.deepEqual(
    approvalBlocks(
      ACTIVATION_OF(
        'PB-RESERVE',
        'ReserveHealth',
        ADMISSIBLE({ registration: { kind: 'read', registered: finalized(false) } }),
      ),
    ).map((b) => b.check),
    ['Playbook registration'],
  );
  // All six are registered at genesis (02 §7.4), which is exactly why an unread blocks rather
  // than assuming the common case: "usually true" is the shape of a check that has quietly
  // stopped running.
  assert.deepEqual(
    approvalBlocks(
      ACTIVATION_OF(
        'PB-RESERVE',
        'ReserveHealth',
        ADMISSIBLE({ registration: { kind: 'unread', reason: 'the storage read failed' } }),
      ),
    ).map((b) => b.check),
    ['Playbook registration'],
  );
});

test('V30-10 — presence in ActivePlaybooks blocks PB-LEDGER-FREEZE ALONE (02 §7.4)', () => {
  // 02 §7.4 states the forbidden reading in as many words: *"a client that reads mere
  // presence as blocking refuses five lawful renewals"*. `guardian_core::dispatch` refuses
  // re-activation only for `PB-LEDGER-FREEZE`, which renews through a values referendum
  // (06 §6.3); every other playbook re-activates in place without consuming a slot.
  const renewals: readonly (readonly [PlaybookId, PlaybookTrigger])[] = [
    ['PB-DEPEG', 'DepegMedian'],
    ['PB-MIGRATION', 'MigrationHalt'],
    ['PB-ORACLE-VOID', 'OracleDeadlock'],
    ['PB-HALT-INTAKE', 'GateBreach'],
    ['PB-RESERVE', 'ReserveHealth'],
  ];
  // Five, and the count is the point — 02 §7.4's own sentence is about exactly these.
  assert.equal(renewals.length, 5);
  for (const [id, trigger] of renewals) {
    const alreadyActive = ADMISSIBLE({
      active: { kind: 'read', ids: finalized<readonly PlaybookId[]>([id, 'PB-LEDGER-FREEZE']) },
    });
    assert.ok(
      !approvalBlocks(ACTIVATION_OF(id, trigger, alreadyActive)).some(
        (block) => block.check === 'Playbook already active',
      ),
      `${id} renews by re-activation; blocking it refuses what the chain accepts`,
    );
  }
  // The one it does block, and it is asserted against the core rather than restated: if
  // `dispatch` ever widened the refusal to every playbook, this client would be the one
  // refusing lawful renewals and would have no way to know.
  const core = readFileSync(join(REPO, 'crates/guardian-core/src/lib.rs'), 'utf8');
  assert.match(
    core,
    /if self\.active_playbooks\.iter\(\)\.any\(\|p\| p\.id == id\) \{\s*ensure!\(\s*!matches!\(id, PlaybookId::LedgerFreeze\),/,
    'dispatch no longer narrows PlaybookAlreadyActive to LedgerFreeze — rescope the client',
  );
  const freeze = ADMISSIBLE({
    active: { kind: 'read', ids: finalized<readonly PlaybookId[]>(['PB-LEDGER-FREEZE']) },
  });
  assert.deepEqual(
    approvalBlocks(ACTIVATION_OF('PB-LEDGER-FREEZE', 'LedgerDrift', freeze)).map((b) => b.check),
    ['Playbook already active'],
  );
  // An **unread** record set is narrowed the same way, and that is not a softening: a read
  // that decides nothing about an action cannot make it unsafe by failing. Blocking a
  // PB-RESERVE renewal on it would refuse what the chain accepts, through a failure instead
  // of through a value.
  const unreadSet = ADMISSIBLE({
    active: { kind: 'unread', reason: 'the storage read failed' },
  });
  assert.deepEqual(approvalBlocks(ACTIVATION_OF('PB-RESERVE', 'ReserveHealth', unreadSet)), []);
  assert.deepEqual(
    approvalBlocks(ACTIVATION_OF('PB-LEDGER-FREEZE', 'LedgerDrift', unreadSet)).map((b) => b.check),
    ['Playbook already active'],
  );
});

test('V30-11 — registration is admissibility and can never stand in for a trigger', () => {
  // 02 §7.4 and 06 §6.2: registration is not a trigger source, and neither of these two items
  // may be substituted for §11.8.2's trigger table. Enforced structurally rather than
  // remembered — `triggerRefusal` consults `TRIGGER_READS`, which names neither surface, so
  // there is no path from one answer to the other.
  const triggerSurfaces = new Set(Object.values(TRIGGER_READS).flat());
  assert.ok(!triggerSurfaces.has('storage.guardian.playbook_registered'));
  assert.ok(!triggerSurfaces.has('storage.guardian.active_playbooks'));

  // Behaviourally, both directions: a registered playbook with a dead trigger still blocks…
  assert.deepEqual(
    approvalBlocks(
      APPROVE({
        action: ACTION({
          power: PLAYBOOK_POWER({
            id: finalized<PlaybookId>('PB-RESERVE'),
            trigger: finalized<PlaybookTrigger>('ReserveHealth'),
          }),
        }),
        condition: { kind: 'trigger', reading: inactiveAt('ReserveHealth') },
        playbooks: ADMISSIBLE(),
      }),
    ).map((b) => b.check),
    ['Trigger condition'],
  );
  // …and an unregistered playbook with a live trigger blocks too. Neither answer covers for
  // the other, which is what "admissibility, never a trigger source" means in code.
  assert.deepEqual(
    approvalBlocks(
      ACTIVATION_OF(
        'PB-RESERVE',
        'ReserveHealth',
        ADMISSIBLE({ registration: { kind: 'read', registered: finalized(false) } }),
      ),
    ).map((b) => b.check),
    ['Playbook registration'],
  );
});

test('V30-12 — admissibility evidence must describe THIS action, in both directions', () => {
  // The device every evidence field in this module uses: supplying the wrong kind is a
  // refusal rather than something to ignore, because ignoring it approves whichever action
  // the rest of the context happens to describe.
  const pause = ACTION({ power: { kind: 'pause_intake', until: finalized(50_000) } });
  assert.deepEqual(
    approvalBlocks(
      APPROVE({
        action: pause,
        condition: { kind: 'no-condition' },
        dispatch: { kind: 'hold', horizon: HORIZON },
        playbooks: ADMISSIBLE(),
      }),
    ).map((b) => b.check),
    ['Playbook admissibility'],
    'activation evidence supplied for a pause_intake must be refused, not ignored',
  );
  assert.deepEqual(
    approvalBlocks(
      APPROVE({
        action: pause,
        condition: { kind: 'no-condition' },
        dispatch: { kind: 'hold', horizon: HORIZON },
        playbooks: { kind: 'not-applicable' },
      }),
    ),
    [],
  );
  assert.deepEqual(
    approvalBlocks(
      ACTIVATION_OF('PB-RESERVE', 'ReserveHealth', { kind: 'not-applicable' }),
    ).map((b) => b.check),
    ['Playbook admissibility'],
    'an activation with no admissibility evidence must not be approved on checks that did not run',
  );
});

test('V30-14 — the PROPOSE flow refuses both playbook conditions too, and on the same terms', () => {
  // The runtime raises `PlaybookNotRegistered` and `PlaybookAlreadyActive` on the *dispatching*
  // approval and checks neither at propose time. That is not a defence: it checks
  // `PB-MIGRATION`'s empty admissible call set at propose time either, and `proposalBlocks`
  // blocks that — because 06 §6.2 guarantees the fifth approval reverts and records nothing.
  // Identical cost, identical signatures, so identical treatment. A propose flow modelling
  // every other dispatch refusal and blind to two of them is inconsistent, not narrower.
  //
  // The fixture defaults to registered-and-not-active, so each refusal is given its own
  // fixture here. A suite that only ever proposed an admissible playbook could not tell these
  // checks from their absence — the same shape that let the approve side's caveat defect hide.
  const propose = (over: Partial<Extract<GuardianProposal, { power: 'activate_playbook' }>>) =>
    proposalBlocks(PROPOSE(ACTIVATION(over))).map((b) => b.check);

  assert.deepEqual(propose({}), [], 'the clean path must stay clean');
  assert.deepEqual(
    propose({ registration: { kind: 'read', registered: finalized(false) } }),
    ['Playbook registration'],
  );
  assert.deepEqual(
    propose({ registration: { kind: 'unread', reason: 'the storage read failed' } }),
    ['Playbook registration'],
  );
  // The one playbook whose re-activation `dispatch` refuses. `PB-LEDGER-FREEZE` pairs with
  // `LedgerDrift` alone, so the trigger moves with the id.
  assert.deepEqual(
    propose({
      id: 'PB-LEDGER-FREEZE',
      trigger: active('LedgerDrift'),
      active: { kind: 'read', ids: finalized<readonly PlaybookId[]>(['PB-LEDGER-FREEZE']) },
    }),
    ['Playbook already active'],
  );
  assert.deepEqual(
    propose({
      id: 'PB-LEDGER-FREEZE',
      trigger: active('LedgerDrift'),
      active: { kind: 'unread', reason: 'the storage read failed' },
    }),
    ['Playbook already active'],
  );
});

test('V30-15 — a propose of another playbook is never blocked by the ledger-freeze record', () => {
  // Constraint 2 of the O-3 scoping, restated on the propose side because the code path is a
  // different one: presence blocks `PB-LEDGER-FREEZE` alone, and an **unread** record set
  // narrows with it. Every other playbook renews by re-activation while its trigger holds
  // (06 §6.2), so blocking those refuses five lawful renewals — 02 §7.4's own sentence.
  const renewals: readonly (readonly [PlaybookId, PlaybookTrigger])[] = [
    ['PB-DEPEG', 'DepegMedian'],
    ['PB-MIGRATION', 'MigrationHalt'],
    ['PB-ORACLE-VOID', 'OracleDeadlock'],
    ['PB-HALT-INTAKE', 'GateBreach'],
    ['PB-RESERVE', 'ReserveHealth'],
  ];
  assert.equal(renewals.length, 5, '02 §7.4 counts exactly these five');
  for (const [id, trigger] of renewals) {
    for (const reading of [
      { kind: 'read', ids: finalized<readonly PlaybookId[]>([id, 'PB-LEDGER-FREEZE']) },
      { kind: 'unread', reason: 'the storage read failed' },
    ] as const) {
      const blocks = proposalBlocks(
        PROPOSE(ACTIVATION({ id, trigger: active(trigger), active: reading })),
      );
      assert.ok(
        !blocks.some((block) => block.check === 'Playbook already active'),
        `${id} (${reading.kind}) renews in place; blocking it refuses what the chain accepts`,
      );
    }
  }
  // Anti-vacuity: the identical `read` set DOES block the one playbook it is about, so the
  // loop above is not passing because the check has been switched off.
  assert.deepEqual(
    proposalBlocks(
      PROPOSE(
        ACTIVATION({
          id: 'PB-LEDGER-FREEZE',
          trigger: active('LedgerDrift'),
          active: { kind: 'read', ids: finalized<readonly PlaybookId[]>(['PB-LEDGER-FREEZE']) },
        }),
      ),
    ).map((b) => b.check),
    ['Playbook already active'],
  );
});

test('V30-16 — the four non-activation powers have NO field for a playbook read', () => {
  // Constraint 1, made structural rather than checked. On the approve side the power is
  // decoded from somebody else's bytes, so the evidence travels beside it and `playbookBlocks`
  // compares them. Here the power is the discriminant of a union this client builds, so the
  // reads are fields of the `activate_playbook` arm — and a `pause_intake` proposal cannot be
  // blocked by a playbook read because there is nowhere to put one.
  //
  // The compiler owns that (`tests/firewall/fixtures/playbook-reads-on-a-non-activation.ts`).
  // What is asserted here is the behaviour it guarantees: the other four powers propose
  // cleanly while the record set holds the very entry that blocks an activation.
  assert.deepEqual(
    proposalBlocks(
      PROPOSE({ power: 'pause_intake', meter: METER('pause_intake'), until: 5_000, horizon: HORIZON }),
    ),
    [],
  );
  assert.deepEqual(
    proposalBlocks(
      PROPOSE({ power: 'delay_once', meter: METER('delay_once'), pid: 'p1', proposal: RERUNNABLE() }),
    ),
    [],
  );
  assert.deepEqual(
    proposalBlocks(
      PROPOSE({ power: 'force_rerun', meter: METER('force_rerun'), pid: 'p1', proposal: RERUNNABLE() }),
    ),
    [],
  );
  assert.deepEqual(
    proposalBlocks(PROPOSE({ power: 'suspend_on_gate', gate: gateReading() })),
    [],
  );
  // The arms carry no such key at runtime either, so nothing could read one off them by name.
  for (const proposal of [
    { power: 'pause_intake', meter: METER('pause_intake'), until: 5_000, horizon: HORIZON },
    { power: 'suspend_on_gate', gate: gateReading() },
  ] as const) {
    assert.ok(!('registration' in proposal), proposal.power);
    assert.ok(!('active' in proposal), proposal.power);
  }
});

test('V30-13 — O-3 declares both frozen maps and cites SQ-1030 nowhere', () => {
  // The O-6 precedent: contract v28 froze `PendingUpgrade`, the `blocking` obligation was
  // retired, and the row grew the ordinary clauses that replace it. A retirement without the
  // replacement read would be the check being dropped rather than closed — which is why the
  // surfaces are asserted, not only the absence.
  const surfaces = new Set(rowsFor('O-3', 'USDC').map((entry) => entry.surface));
  assert.ok(surfaces.has('storage.guardian.playbook_registered'));
  assert.ok(surfaces.has('storage.guardian.active_playbooks'));
  const cited = unreadableObligationsFor('O-3').map((entry) => entry.specQuestion);
  assert.ok(!cited.includes('SQ-1030'), 'an obligation outlived the freeze that closes it');
  // The `stated` SQ-1022 caveat is untouched: its bound (128 open review records) has no
  // frozen constant and its count is not frozen either, so it is a different question.
  assert.deepEqual(cited, ['SQ-1022']);
});

test('M3 — `suspend_on_gate` is condition-gated on the APPROVE side too (06 §5.2)', () => {
  // `check_and_consume` refuses it with `TriggerInactive` when no hard-gate breach flag is
  // set, and that runs at the threshold approval like every other dispatch check.
  const suspend = ACTION({ power: { kind: 'suspend_on_gate' } });
  assert.deepEqual(
    approvalBlocks(
      APPROVE({
        action: suspend,
        condition: { kind: 'trigger', reading: active('GateBreach') },
        dispatch: { kind: 'not-applicable' },
      }),
    ),
    [],
  );
  assert.deepEqual(
    approvalBlocks(
      APPROVE({ action: suspend, condition: { kind: 'no-condition' }, dispatch: { kind: 'not-applicable' } }),
    ).map((b) => b.check),
    ['Trigger condition'],
  );
});

test('the approve flow evaluates EVERY dispatch condition, not only the trigger', () => {
  // `check_and_consume` runs inside `dispatch`, which `approve_action` reaches at the
  // threshold approval — so every refusal it can raise falls on the fifth guardian, not only
  // `TriggerInactive`. Evaluating the trigger and leaving `AllowanceExhausted`,
  // `DurationTooLong`, `NotRerunnable` and `AlreadyRerun` unevaluated would be the reported
  // instance fixed and the class left open.
  //
  // 1. The allowance the chain charges at dispatch — on a **metered** power. `pause_intake` is
  // one of the three `AllowanceState` really counts; see the M4 test below for the two it does
  // not, where an exhausted book must NOT block.
  const pause = ACTION({ power: { kind: 'pause_intake', until: finalized(50_000) } });
  assert.deepEqual(
    approvalBlocks(
      APPROVE({ action: pause, condition: { kind: 'no-condition' }, allowances: ALLOWANCES(3, 3) }),
    ).map((b) => b.check),
    ['Allowance'],
  );
  // 2. The hold window, against the activation's own expiry.
  const stale = ACTION({ power: PLAYBOOK_POWER({ expiry: finalized(999) }) });
  assert.deepEqual(
    approvalBlocks(APPROVE({ action: stale })).map((b) => b.check),
    ['Hold window'],
  );
  // 3. The rerun ledger, against the proposal the action names.
  const delay = ACTION({ power: { kind: 'delay_once', pid: finalized('p7') } });
  assert.deepEqual(
    approvalBlocks(
      APPROVE({
        action: delay,
        condition: { kind: 'no-condition' },
        dispatch: { kind: 'rerun', proposal: RERUNNABLE('Trading') },
      }),
    ).map((b) => b.check),
    ['Proposal state'],
  );
  // …and the same action over a queued, unspent proposal is clean, so the checks above are
  // about the conditions and not about the shape of the fixture.
  assert.deepEqual(
    approvalBlocks(
      APPROVE({
        action: delay,
        condition: { kind: 'no-condition' },
        dispatch: { kind: 'rerun', proposal: RERUNNABLE('Queued') },
      }),
    ),
    [],
  );
});

test('dispatch evidence describing a DIFFERENT action is a check that did not run', () => {
  // The same rule the trigger arm carries, at the same surface: evidence for the wrong shape
  // of precondition is not this action's evidence, so it is refused rather than counted.
  const delay = ACTION({ power: { kind: 'delay_once', pid: finalized('p7') } });
  const blocks = approvalBlocks(
    APPROVE({
      action: delay,
      condition: { kind: 'no-condition' },
      dispatch: { kind: 'hold', horizon: HORIZON },
    }),
  );
  assert.deepEqual(blocks.map((b) => b.check), ['Dispatch precondition']);
  assert.match(nth(blocks, 0, 'block').detail, /proposal state/);

  // And the mirror on an activation, whose precondition is the hold window.
  const wrong: DispatchEvidence = { kind: 'rerun', proposal: RERUNNABLE() };
  assert.deepEqual(
    approvalBlocks(APPROVE({ dispatch: wrong })).map((b) => b.check),
    ['Dispatch precondition'],
  );
});

test('an action whose POWER could not be decoded is refused, not approved (INV-FE-12)', () => {
  // A power this client cannot read is one whose preconditions it cannot evaluate, so there
  // is no honest way to render a verdict about it. `PendingPower.undecodable` carries no
  // power name at all, so no screen can render a guessed one either.
  const blocks = approvalBlocks(
    APPROVE({
      action: ACTION({ power: { kind: 'undecodable', rawHex: '0xbeef', reason: 'unknown variant' } }),
      condition: { kind: 'no-condition' },
      dispatch: { kind: 'not-applicable' },
    }),
  );
  assert.deepEqual(blocks.map((b) => b.check), ['Undecodable power']);
  assert.match(nth(blocks, 0, 'block').detail, /unknown variant/);
  assert.equal(
    pendingPowerName({ kind: 'undecodable', rawHex: '0xbeef', reason: 'x' }),
    undefined,
  );
  assert.equal(pendingPowerName({ kind: 'suspend_on_gate' }), 'suspend_on_gate');
});

test('M1 — the approve surface renders the allowance meter and the trigger status (E20 V)', () => {
  // E20's V-facet is four items: "pending action with decoded enumerated call batch, m-of-7
  // progress, allowance meters, trigger-condition status". The last two were rendered
  // nowhere, and both are what the runtime charges at the fifth approval.
  //
  // The meter is rendered for a **metered** power (06 §5.2 meters three of the five). The
  // first version of this test asserted `Allowance remaining for activate_playbook`, which was
  // a figure for a counter the chain does not keep — see the M4 test below.
  const delay = ACTION({ power: { kind: 'delay_once', pid: finalized('p7') } });
  const html = renderToStaticMarkup(
    h(ApproveAction, {
      context: APPROVE({
        action: delay,
        condition: { kind: 'no-condition' },
        dispatch: { kind: 'rerun', proposal: RERUNNABLE('Queued') },
      }),
      session: readySession('O-3'),
      onApprove: noSubmit,
    }),
  );
  assert.ok(fieldPresent(html, 'Allowance remaining for delay_once'), html);
  // The trigger status renders on the activation row, where there is a condition to report.
  const activation = renderToStaticMarkup(
    h(ApproveAction, { context: APPROVE_ROW(), session: readySession('O-3'), onApprove: noSubmit }),
  );
  assert.match(activation, /Trigger condition — OracleDeadlock/);
  assert.match(activation, /re-checks it at the threshold approval/);
  // The meter is the one for THIS action's power, looked up rather than supplied — so a
  // console cannot show a different power's budget beside a privileged signature.
  const book = ALLOWANCES(1, 4);
  assert.deepEqual(meterFor(book, 'delay_once'), { power: 'delay_once', ...book.delay_once });
  // And the batch, the progress and the control are all still there, so this is an addition.
  assert.ok(fieldPresent(html, 'Approvals so far'), html);
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
    PROPOSE({
      power: 'delay_once',
      meter: {
        power: 'delay_once',
        used: finalized(0, 1_000_000),
        limit: { value: 5, status: { kind: 'verified-finalized', chain: TEST_CHAIN, blockHash: '0xbeef', blockNumber: 999_000 } },
      },
      pid: 'p7',
      proposal: RERUNNABLE(),
    }),
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
  assert.deepEqual(proposalBlocks(PROPOSE()), []);
  assert.deepEqual(
    proposalBlocks(
      PROPOSE({ power: 'pause_intake', meter: METER('pause_intake', 2, 2), until: 5_000, horizon: HORIZON }),
    ).map((b) => b.check),
    ['Allowance'],
  );
  assert.deepEqual(
    proposalBlocks(PROPOSE(ACTIVATION({ trigger: unread('GateBreach', 'x') }))).map((b) => b.check),
    ['Trigger condition'],
  );
  // A power with no trigger cannot be given one: its arm has no field for a reading, so the
  // confusion the old shape allowed is not a state this union can hold.
  assert.deepEqual(
    proposalBlocks(PROPOSE({ power: 'pause_intake', meter: METER('pause_intake'), until: 5_000, horizon: HORIZON })),
    [],
  );
});

test('B2 — the trigger EVALUATED and the trigger DISPATCHED are one value (11 §11.8.2 rule 1)', () => {
  // The re-review blocker of 2026-08-08. `proposalBlocks` saw only the `TriggerState` and
  // `proposeFormBlocks` saw only `inputs.args`, so nothing asserted `trigger.trigger ===
  // inputs.args.trigger`. The reproduction: a `PB-LEDGER-FREEZE` activation naming
  // `LedgerDrift` beside a live `GateBreach` reading. `triggerRefusal` returned undefined,
  // `PLAYBOOK_TRIGGERS['PB-LEDGER-FREEZE'].includes('LedgerDrift')` was true, the block list
  // was empty and the control reached `ready` — five signatures on a freeze whose
  // `LedgerDrifted` latch was never read.
  //
  // §11.8.2 rule 1: "the client evaluates the variant the proposer selected". There is now
  // one variant, because the call's `trigger` is derived from the reading. Naming
  // `LedgerDrift` while holding a `GateBreach` reading is therefore not a mismatch that is
  // caught — it is a state with nowhere to live, and what remains is the pairing check.
  const freeze = ACTIVATION({ id: 'PB-LEDGER-FREEZE', trigger: active('GateBreach') });
  assert.deepEqual(proposalBlocks(PROPOSE(freeze)).map((b) => b.check), ['Trigger']);
  const call = guardianCall(freeze);
  assert.equal(call.power === 'activate_playbook' ? call.trigger : undefined, 'GateBreach');

  // And the lawful pairing over the same reading is clean, so the refusal is the pairing's.
  assert.deepEqual(
    proposalBlocks(PROPOSE(ACTIVATION({ id: 'PB-LEDGER-FREEZE', trigger: active('LedgerDrift') }))),
    [],
  );
});

test('B3 — the power the meter names and the power the call names cannot differ', () => {
  // The reproduction: `meter.power = 'pause_intake'` with `inputs.args.power =
  // 'activate_playbook'` and `trigger = {kind:'no-trigger-power'}`. The mirror arm was
  // skipped because the meter said `pause_intake`, `proposeFormBlocks` found the activation
  // lawful, and the panel titled "Propose a pause on intake" listing `until (block)` prepared
  // a playbook activation.
  //
  // `GuardianProposal` keys the meter on the arm's own power, so the mismatch is a type
  // error (`tests/firewall/fixtures/guardian-meter-names-another-power.ts`). What is asserted
  // here is the consequence: the rendered form is the proposal's, never a meter's.
  const html = renderToStaticMarkup(
    h(ProposeAction, { inputs: PROPOSE(), session: readySession('O-4'), onPropose: noSubmit }),
  );
  assert.match(html, /Propose a playbook activation/);
  for (const field of POWER_FIELDS.activate_playbook) assert.ok(html.includes(field), field);
  assert.ok(!html.includes('until (block)'), 'a different power’s form is on screen');
});

test('an activation whose trigger was never evaluated is REFUSED, not proposed (11 §11.8.2)', () => {
  // The 2026-08-07 blocker, kept as a regression: the trigger is a **required field of the
  // activation arm**, so an activation with no reading does not typecheck at all
  // (`tests/firewall/fixtures/playbook-activation-with-no-trigger-check.ts`). What the model
  // still owns is the reading that ran and failed, and "could not read" landing on the
  // refusing side.
  for (const reading of [inactiveAt('GateBreach'), unread('GateBreach')]) {
    const blocks = proposalBlocks(PROPOSE(ACTIVATION({ trigger: reading })));
    assert.notDeepEqual(blocks, [], 'an unestablished trigger must not produce an empty list');
    assert.deepEqual(blocks.map((b) => b.check), ['Trigger condition']);
  }
  assert.match(
    nth(proposalBlocks(PROPOSE(ACTIVATION({ trigger: unread('GateBreach') }))), 0, 'block').detail,
    /could not establish/,
  );
});

test('M3 — `suspend_on_gate` is condition-gated, and the only reachable state said otherwise', () => {
  // 06 §5.2: "freeze the execution queue **while a hard-gate daily breach flag is active**",
  // and `guardian-core/src/lib.rs:884-886` refuses it with `TriggerInactive` otherwise.
  // 11 §11.8.2's row does not name the precondition, so the two documents disagree (SQ-1018).
  //
  // The previous model made supplying ANY trigger for a non-`activate_playbook` power a
  // block, so the only state this power could reach asserted that no condition applied — a
  // control that could reach `ready` with the runtime's own precondition unevaluated.
  const gated = (gate: TriggerState<'GateBreach'>): GuardianProposal =>
    ({ power: 'suspend_on_gate', gate });
  assert.deepEqual(proposalBlocks(PROPOSE(gated(gateReading()))), []);
  for (const reading of [gateReading('inactive'), gateReading('unread')] as const) {
    const blocks = proposalBlocks(PROPOSE(gated(reading)));
    assert.deepEqual(blocks.map((b) => b.check), ['Gate-breach condition']);
    assert.match(nth(blocks, 0, 'block').detail, /auto-releases when the flag clears/);
  }
});

test('SQ-1018 — the hold window is READ, and a hold outside it is refused', () => {
  // `check_and_consume` refuses `PauseIntake.until` and `ActivatePlaybook.expiry` outside
  // `[now, now + HOLD_MAX_BLOCKS]` with `DurationTooLong`, and §11.8.2's propose row lists
  // neither. `HOLD_MAX_BLOCKS` is `Guardian.PlaybookFreezeWindowBlocks` — a frozen constant —
  // so the bound is read at B′ rather than compiled in (10 §5.4).
  const pause = (until: number, horizon = HORIZON): GuardianProposal =>
    ({ power: 'pause_intake', meter: METER('pause_intake'), until, horizon });
  assert.deepEqual(proposalBlocks(PROPOSE(pause(50_000))), []);
  assert.deepEqual(proposalBlocks(PROPOSE(pause(999))).map((b) => b.check), ['Hold window']);
  assert.match(nth(proposalBlocks(PROPOSE(pause(999))), 0, 'block').detail, /in the past/);
  assert.deepEqual(proposalBlocks(PROPOSE(pause(101_001))).map((b) => b.check), ['Hold window']);
  // The same bound on the activation arm, so it is not a `pause_intake` special case.
  assert.deepEqual(
    proposalBlocks(PROPOSE(ACTIVATION({ expiry: 500_000 }))).map((b) => b.check),
    ['Hold window'],
  );
  // And a window this client cannot form is a refusal, not a guess: `now` at one block and
  // the constant at another describes no window at all.
  const split: HoldHorizon = {
    now: finalized(1_000, 1_000_000),
    maxBlocks: { value: 100_000, status: { kind: 'verified-finalized', chain: TEST_CHAIN, blockHash: '0xbeef', blockNumber: 999_000 } },
  };
  const blocks = proposalBlocks(PROPOSE(pause(50_000, split)));
  assert.deepEqual(blocks.map((b) => b.check), ['Hold window']);
  assert.match(nth(blocks, 0, 'block').detail, /cannot establish/);
});

test('SQ-1018 — a rerun power reads the proposal, and the two powers take different states', () => {
  // `delay_once` needs `ProposalStatus::Queued`; `force_rerun` needs `rerunnable()` —
  // `Trading | Extended | Queued`. Both refuse a proposal already delayed or re-run
  // (`AlreadyRerun`). Until 2026-08-08 neither was evaluated and both reached `ready` on the
  // allowance alone.
  const rerunProposal = (power: 'delay_once' | 'force_rerun', proposal: RerunState): GuardianProposal =>
    power === 'delay_once'
      ? { power, meter: METER('delay_once'), pid: 'p7', proposal }
      : { power, meter: METER('force_rerun'), pid: 'p7', proposal };
  const checks = (power: 'delay_once' | 'force_rerun', proposal: RerunState) =>
    proposalBlocks(PROPOSE(rerunProposal(power, proposal))).map((b) => b.check);

  assert.deepEqual(checks('delay_once', RERUNNABLE('Queued')), []);
  assert.deepEqual(checks('force_rerun', RERUNNABLE('Queued')), []);
  // Trading is rerunnable and NOT delayable — the difference the two powers turn on.
  assert.deepEqual(checks('force_rerun', RERUNNABLE('Trading')), []);
  assert.deepEqual(checks('delay_once', RERUNNABLE('Trading')), ['Proposal state']);
  assert.deepEqual(checks('force_rerun', RERUNNABLE('Settled')), ['Proposal state']);

  // `in_rerun` as `RuntimeGuardianStatus::status` computes it — three ways in, all refusing.
  for (const spent of [
    { ...RERUNNABLE('Queued'), rerun: finalized(true) },
    { ...RERUNNABLE('Queued'), delayedOnce: finalized(true) },
    RERUNNABLE('Rerun'),
  ] as RerunState[]) {
    assert.ok(
      checks('force_rerun', spent).includes('Rerun already spent'),
      `a spent rerun was admitted: ${JSON.stringify(spent)}`,
    );
  }
  // An unreadable or absent proposal refuses rather than passing on nothing.
  assert.deepEqual(checks('delay_once', { kind: 'unread', reason: 'x' }), ['Proposal state']);
  assert.deepEqual(checks('delay_once', { kind: 'absent' }), ['Proposal state']);
});

test('the propose control CANNOT reach ready on an unevaluated trigger', () => {
  // The model refusal above, asserted where it matters: a refreshed session with a valid
  // gate proof is exactly the state in which the button used to open. The screen is what an
  // operator sees, so the property is asserted end to end rather than on the model alone.
  const html = renderToStaticMarkup(
    h(ProposeAction, {
      inputs: PROPOSE(ACTIVATION({ trigger: unread('GateBreach', 'the storage read failed') })),
      session: readySession('O-4'),
      onPropose: noSubmit,
    }),
  );
  assert.ok(buttonDisabled(html, 'Propose'), html);
  assert.match(html, /could not be read/);
  // Anti-vacuity: the same panel with a live trigger opens, so the refusal is about the
  // trigger and not about some unrelated block this fixture happens to trip.
  const live = renderToStaticMarkup(
    h(ProposeAction, {
      inputs: PROPOSE(), session: readySession('O-4'), onPropose: noSubmit,
    }),
  );
  assert.ok(!buttonDisabled(live, 'Propose'), live);
});

test('M2 REVERSED — PB-MIGRATION BLOCKS on propose and on approve; "stated, never blocked" was wrong', () => {
  // **This test pinned the opposite claim until 2026-08-08, and the claim was false.** It
  // asserted `proposalBlocks` returned `[]` and the Propose control opened, on the reasoning
  // that "the runtime accepts the activation (`check_and_consume` knows nothing about the call
  // set)". `check_and_consume` is not the last word. 06 §6.2 is normative and exact:
  //
  //   "A playbook row whose admissible call set is empty has no dispatchable activation: a
  //    fifth approval reaching it fails closed, the whole extrinsic reverts, and nothing is
  //    recorded."
  //
  // The runtime implements it. `approve_action` runs inside `with_storage_layer` and calls
  // `EffectDispatcher::dispatch`, which reaches `playbook_calls(Migration, …)` —
  // `Err("PB-MIGRATION cursor retry has no EmergencyPlaybook-safe runtime call")`
  // (`runtime/bleavit-runtime/src/configs.rs`). So the fifth signature buys a revert.
  //
  // Admitting the *propose* "to preserve the record that a council wanted to act" does not
  // survive the same sentence: **nothing is recorded**. Walking five of seven guardians to a
  // guaranteed revert is what §11.4 rule 1 exists to prevent.
  assert.equal(playbookAdvisory('PB-MIGRATION'), MIGRATION_NO_ACTION_FOLLOWS);
  assert.match(MIGRATION_NO_ACTION_FOLLOWS, /empty admissible call set/);
  assert.match(MIGRATION_NO_ACTION_FOLLOWS, /the whole extrinsic reverts and nothing is recorded/);
  // Every other playbook but the unavailable one carries no advisory, so this is a statement
  // about PB-MIGRATION rather than a banner on the screen.
  assert.equal(playbookAdvisory('PB-HALT-INTAKE'), undefined);
  assert.equal(playbookAdvisory('PB-DEPEG'), DEPEG_TRIGGER_UNAVAILABLE);

  // 1. Propose blocks, with the empty-call-set sentence as the reason.
  const migration = ACTIVATION({ id: 'PB-MIGRATION', trigger: active('MigrationHalt') });
  const proposeBlocks = proposalBlocks(PROPOSE(migration));
  assert.deepEqual(proposeBlocks.map((b) => b.check), ['Trigger condition']);
  assert.equal(nth(proposeBlocks, 0, 'block').detail, MIGRATION_NO_ACTION_FOLLOWS);
  const html = renderToStaticMarkup(
    h(ProposeAction, { inputs: PROPOSE(migration), session: readySession('O-4'), onPropose: noSubmit }),
  );
  assert.ok(buttonDisabled(html, 'Propose'), html);
  assert.ok(html.includes(MIGRATION_NO_ACTION_FOLLOWS), html);

  // 2. Approve blocks too, and it must: `propose_action` validates nothing on chain, so a
  // PB-MIGRATION action created by any other tool sits in `PendingActions` for three days.
  const pending = ACTION({
    power: PLAYBOOK_POWER({
      id: finalized<PlaybookId>('PB-MIGRATION'),
      trigger: finalized<PlaybookTrigger>('MigrationHalt'),
      target: undefined,
    }),
  });
  const approve = approvalBlocks(
    APPROVE({ action: pending, condition: { kind: 'trigger', reading: active('MigrationHalt') } }),
  );
  assert.deepEqual(approve.map((b) => b.check), ['Trigger condition']);
  assert.equal(nth(approve, 0, 'block').detail.startsWith(MIGRATION_NO_ACTION_FOLLOWS), true);

  // 3. `mayActivatePlaybook` agrees, because it is derived from the same decision rather than
  // being a second switch — the property `triggerRefusal`'s own note claims.
  assert.equal(mayActivatePlaybook(active('MigrationHalt')), false);
  assert.equal(mayActivatePlaybook(inactiveAt('MigrationHalt')), false);

  // 4. **The refusal is keyed on the trigger and the fact is about the playbook**, and those
  // are the same thing only because `PLAYBOOK_TRIGGERS` binds them one-to-one. Asserted rather
  // than assumed: if the map ever grew, this refusal would be keyed to the wrong thing and
  // this assertion is what says so.
  assert.deepEqual(PLAYBOOK_TRIGGERS['PB-MIGRATION'], ['MigrationHalt']);
  assert.deepEqual(
    (Object.entries(PLAYBOOK_TRIGGERS) as [PlaybookId, readonly PlaybookTrigger[]][])
      .filter(([, triggers]) => triggers.includes('MigrationHalt'))
      .map(([id]) => id),
    ['PB-MIGRATION'],
  );

  // 5. Anti-vacuity: the *readable* half is unchanged. `MigrationHalt` still has a frozen read
  // behind it, so this is not the `DepegMedian` "no read at all" refusal wearing another name.
  assert.deepEqual(TRIGGER_READS.MigrationHalt, ['storage.execution_guard.migration_halt']);
  assert.notEqual(nth(proposeBlocks, 0, 'block').detail, DEPEG_TRIGGER_UNAVAILABLE);
});

// ------------------------------------------------ S16 treasury streams (F17)

/**
 * 02 §4's `StreamView` as the client holds it (contract v29).
 *
 * The default `claimableNow` is deliberately **not** what linear vesting over the other
 * fields would produce: half of `total` at block 600 of a 1,000-block schedule is 500,000,
 * and this fixture answers 400,000. Every test below that reads the amount therefore fails
 * the moment the client re-derives it, rather than agreeing with a re-derivation by
 * coincidence — which is what a self-consistent fixture would have done.
 */
const STREAM = (over: Partial<Stream> = {}): Stream => ({
  id: finalized('s1'),
  total: finalized(1_000_000n), claimed: finalized(0n),
  startBlock: finalized(100), duration: finalized(1_000),
  cancelled: finalized(false), claimableNow: finalized(400_000n),
  ...over,
});

test('claimableNow reports the chain’s own claimable_now, never a figure derived here', () => {
  // 11 §11.8.3 rule 1 (contract v29): "The client MUST NOT re-derive it from `total`,
  // `claimed`, `start` and `duration`: the vesting division floors against the claimant
  // (08 §1.4), and a client rounding the other way shows a payout the chain will not make."
  //
  // The fixture's own fields would vest 500,000 at block 600. The published field says
  // 400,000, and 400,000 is what must come back — so this assertion fails on any client
  // that computes rather than reads, in the direction that matters.
  assert.equal(stated(claimableNow(STREAM(), finalized(600))).amount, 400_000n);

  // The other direction, which a clamp would swallow: a published figure ABOVE what the
  // four schedule fields imply is still reported verbatim. Clamping it to a locally derived
  // ceiling would understate a payout the chain will make — and 02 §4 says the field "is
  // exactly what `claim_stream` would pay", not a bound this client may narrow.
  assert.equal(
    stated(claimableNow(STREAM({ claimableNow: finalized(900_000n) }), finalized(600))).amount,
    900_000n,
  );

  // And it moves with the published field alone: `total`, `claimed`, `startBlock` and
  // `duration` are display and classification inputs, never terms in the amount.
  const same = STREAM({
    total: finalized(7n), claimed: finalized(6n), duration: finalized(2), claimableNow: finalized(123n),
  });
  assert.equal(stated(claimableNow(same, finalized(600))).amount, 123n);
});

test('no vesting arithmetic exists in treasury.ts — the amount is read (11 §11.8.3 rule 1)', () => {
  // Asserted by absence, the way `upgrade-crank.ts` proves it does no lead-time arithmetic.
  // The reason is the same shape as SQ-552's: a second implementation of somebody's payout,
  // rounding the other way, shows money the chain will not pay.
  //
  // Scanned as **code** rather than as text. The module legitimately says "vested" and
  // "vesting" in the copy it shows a recipient, so a word scan over raw source reports the
  // sentence explaining the absence as the thing itself — the tokenizer hole every version
  // of `check:chain-literals` had to close.
  const code = codeOnly(txSource('treasury.ts'));
  for (const forbidden of ['*', '/', '%', 'elapsed', 'span', 'vested', 'Math.']) {
    assert.ok(
      !code.includes(forbidden),
      `treasury.ts must contain no vesting arithmetic — found ${JSON.stringify(forbidden)}`,
    );
  }
  assert.doesNotMatch(code, SHIFT_OPERATOR, 'a shift operator appeared in the treasury module');
  // The shift check is not vacuous, and it is not the generics collision either.
  assert.match('total << 1', SHIFT_OPERATOR);
  assert.doesNotMatch('Readonly<Record<K, string>>', SHIFT_OPERATOR);
  // Not vacuous: the scan still sees the code it is scanning, and it still sees the one
  // subtraction the module is allowed (08 §1.2's target comparison, which is not vesting).
  assert.ok(code.includes('export function claimableNow'), 'the absence scan read an empty file');
  assert.ok(code.includes('sized - held'), 'the scan no longer reaches the module’s own body');
  // …and it really does keep the words out of reach: the copy the scan must not see is in
  // the file, so a scanner that had simply stopped stripping would fail the loop above.
  assert.match(txSource('treasury.ts'), /Everything vested so far has already been claimed/);
});

test('the claimable figure carries the provenance of every read it came from', () => {
  // Six reads: claimableNow, claimed, startBlock, duration, cancelled and now. Every call
  // site had been picking `claimed`'s status for the result, which renders a figure derived
  // partly from provider data with a verified badge — INV-FE-1 by arithmetic. `check-render-
  // provenance`'s rule B caught it in this very file.
  const mixed = claimableNow(
    STREAM({ claimableNow: { value: 400_000n, status: { kind: 'provider', providerId: 'p', sampled: false } } }),
    finalized(600),
  );
  assert.equal(mixed.kind, 'stated');
  assert.equal(mixed.datum.status.kind, 'provider', 'must not inherit the verified badge');
  // A classification input taints it too, not only the amount: `duration` decides `malformed`
  // and `cancelled` decides `cancelled`, so a provider answer for either makes the verdict
  // provider-grade even though the figure itself was verified.
  const providerFlag = claimableNow(
    STREAM({ cancelled: { value: false, status: { kind: 'provider', providerId: 'p', sampled: false } } }),
    finalized(600),
  );
  assert.equal(stated(providerFlag).amount, 400_000n);
  assert.equal(providerFlag.kind === 'stated' && providerFlag.datum.status.kind, 'provider');
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
    streamClaimsWired: finalized(true),
    now: finalized(600),
  });
  assert.deepEqual(blocks.map((b) => b.check), ['Claimable amount']);
  assert.match(nth(blocks, 0, 'block').detail, /cannot establish what is claimable/);
});

test('not-started, fully-claimed and cancelled are different zeros', () => {
  // 11 §11.8.3 rule 2 (contract v29): "Zero has three meanings and the client MUST say
  // which." A screen showing a bare zero for all three tells a recipient the wrong thing.
  // Each fixture keeps a NON-zero `claimableNow` where the chain could still publish one,
  // so the classification is not passing merely because the amount happened to be zero.
  assert.deepEqual(stated(claimableNow(STREAM(), finalized(50))), { amount: 0n, reason: 'not-started' });
  assert.deepEqual(
    stated(claimableNow(STREAM({ claimed: finalized(1_000_000n), claimableNow: finalized(0n) }), finalized(2_000))),
    { amount: 0n, reason: 'fully-claimed' },
  );
  assert.equal(
    stated(claimableNow(STREAM({ cancelled: finalized(true) }), finalized(600))).reason,
    'cancelled',
  );
  // Cancellation wins over a published non-zero amount, which is the safe direction: 02 §4
  // makes cancellation the one discontinuity in an otherwise monotone figure, so a stream
  // read before it was cancelled must not keep offering the amount it was read with.
  assert.equal(stated(claimableNow(STREAM({ cancelled: finalized(true) }), finalized(600))).amount, 0n);
});

test('a zero-length schedule is classified, not divided by — `duration` is the field now', () => {
  // Retained after contract v29 moved the arithmetic on chain: the chain's own
  // `vested_amount` divides by `duration`, so a zero there is real state worth surfacing.
  // It is a *classification*, which is why it survives the removal of the division — the
  // client reports the state, and reports nothing claimable against it.
  const bad = claimableNow(STREAM({ duration: finalized(0), claimableNow: finalized(400_000n) }), finalized(900));
  assert.deepEqual(stated(bad), { amount: 0n, reason: 'malformed' });
  // A negative duration is the same state and must not read as a schedule running backwards.
  assert.equal(
    stated(claimableNow(STREAM({ duration: finalized(-1) }), finalized(900))).reason,
    'malformed',
  );
  const blocks = claimBlocks({
    stream: STREAM({ duration: finalized(0) }),
    callerIsRecipient: true, streamClaimsWired: finalized(true), now: finalized(900),
  });
  assert.match(nth(blocks, 0, 'block').detail, /no vesting schedule can be derived/);
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
  // The arm survives contract v29 rather than being retired with SQ-602. `NavView` now
  // publishes `insurance_target`, so the `read` arm is reachable — but a `nav()` that did
  // not answer must not fall back to an equality test against a fabricated zero, which
  // renders as *this reserve is exactly sized* at the moment it holds nothing.
  const standing = insuranceStanding(finalized(140n), {
    kind: 'unestablished',
    reason: INSURANCE_TARGET_UNREADABLE,
  });
  assert.equal(stated(standing).kind, 'unestablished');
  // The copy must name where the figure comes from — a reason that says only "unavailable"
  // gives an operator nothing to check — and must say the comparison is withheld rather
  // than guessed, which is the sentence that distinguishes this arm from a zero.
  assert.match(INSURANCE_TARGET_UNREADABLE, /nav\(\)/, 'the reason must name the read it needs');
  assert.match(INSURANCE_TARGET_UNREADABLE, /withheld rather than guessed/);
  assert.doesNotMatch(
    INSURANCE_TARGET_UNREADABLE,
    /SQ-6\d\d/,
    'a spec-question pointer outlived the question it pointed at (SQ-602 is resolved at v29)',
  );
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
    stream: STREAM({ cancelled: finalized(true) }), callerIsRecipient: false,
    streamClaimsWired: finalized(true), now: finalized(600),
  });
  assert.deepEqual(blocks.map((b) => b.check), ['Recipient', 'Claimable amount']);
  assert.deepEqual(
    claimBlocks({ stream: STREAM(), callerIsRecipient: true, streamClaimsWired: finalized(true), now: finalized(600) }),
    [],
  );
});

test('an unwired payout leg blocks EVERY claim, first, and names the runtime not the stream', () => {
  // Contract v29's second `NavView` append, and the reason it ships with `treasury_streams`
  // rather than after it. `TreasuryOutflowCustody::is_wired` is `cfg!(runtime-benchmarks)`,
  // so a production runtime refuses every `claim_stream` with `OutflowCustodyUnwired`
  // (08 §1.4's A9 follow-up). Opening S16's control on `claimable_now` alone would have
  // walked a recipient to a guaranteed post-signature refusal — the defect class contract
  // v29 exists to close, reintroduced by the fix for it.
  const blocks = claimBlocks({
    stream: STREAM(),
    callerIsRecipient: true,
    streamClaimsWired: finalized(false),
    now: finalized(600),
  });
  assert.deepEqual(blocks.map((b) => b.check), ['Payout leg']);
  // First, and on a stream with nothing else wrong: the refusal applies to every stream at
  // once, so a per-stream reason would tell a recipient to fix something about theirs.
  assert.equal(nth(blocks, 0, 'block').detail, STREAM_CLAIMS_NOT_WIRED);
  // The words matter as much as the block. It must not read as a defect in the entitlement.
  assert.match(STREAM_CLAIMS_NOT_WIRED, /entitlement is unaffected and keeps vesting/);
  assert.match(STREAM_CLAIMS_NOT_WIRED, /payout leg/);
  assert.doesNotMatch(STREAM_CLAIMS_NOT_WIRED, /your stream|this stream is/i);
});

test('the payout-leg block is reported BEFORE the stream’s own, and never instead of it', () => {
  // Order is the content here: a recipient on an unwired runtime whose stream is also
  // cancelled needs the deployment fact first, because it is the one they cannot act on.
  // But the stream's own state is still reported — suppressing it would hide a second
  // reason that survives the payout leg landing.
  const blocks = claimBlocks({
    stream: STREAM({ cancelled: finalized(true) }),
    callerIsRecipient: false,
    streamClaimsWired: finalized(false),
    now: finalized(600),
  });
  assert.deepEqual(blocks.map((b) => b.check), ['Payout leg', 'Recipient', 'Claimable amount']);
});

test('an unwired runtime disables every row’s claim control, not a chosen one', () => {
  // The table's own half of the same rule. A per-row check that happened to pass for a
  // freshly vesting stream would offer exactly the control the chain refuses.
  const html = renderToStaticMarkup(
    h(TreasuryStreams, {
      streams: [STREAM({ id: finalized('s1') }), STREAM({ id: finalized('s2') })],
      now: finalized(600),
      decimals: 6,
      symbol: 'USDC',
      callerIsRecipient: () => true,
      streamClaimsWired: finalized(false),
      onSelect: () => {},
    }),
  );
  assert.ok(buttonDisabled(html, 'Claim'), 'a claim is offered on a runtime that pays none');
  assert.match(html, /Payout leg/);
});

test('the claim screen still shows what has vested while the payout leg is unwired', () => {
  // Withholding the figure would be the wrong fail-closed: the entitlement is real and the
  // recipient is entitled to see it. What is withheld is the control.
  const html = renderToStaticMarkup(
    h(ClaimStream, {
      context: {
        stream: STREAM(),
        callerIsRecipient: true,
        streamClaimsWired: finalized(false),
        now: finalized(600),
      },
      decimals: 6,
      symbol: 'USDC',
      session: readySession('O-5'),
      onClaim: () => {},
    }),
  );
  assert.match(html, /This runtime cannot pay claims yet/);
  assert.match(html, /0\.400000/, 'the vested figure is withheld along with the control');
});

test('02 §4 and 11 §11.8.3 make stream_claims_wired a checked-first precondition', () => {
  // The document half, so a moved spec fails here rather than in a client nobody re-reads.
  const doc02 = readFileSync(join(REPO, 'docs/architecture/02-integration-contract.md'), 'utf8');
  assert.match(doc02, /pub stream_claims_wired: bool,/);
  assert.match(doc02, /keeps `treasury_streams` from being a trap/);
  const doc11 = readFileSync(DOC11, 'utf8');
  assert.match(doc11, /\*\*`NavView\.stream_claims_wired` true\*\*/);
  assert.match(doc11, /A claimable figure is not an offer to claim/);
  // And the client actually reads it, rather than the document merely asking.
  assert.ok(
    withoutComments(txSource('treasury.ts')).includes('streamClaimsWired'),
    'the claim model does not read the flag the contract publishes for it',
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
  // A VOID activation, so the row exercises the one power whose target is a cohort — and the
  // one whose condition is read for that exact cohort rather than chain-wide.
  power: PLAYBOOK_POWER({
    id: finalized<PlaybookId>('PB-ORACLE-VOID'),
    trigger: finalized<PlaybookTrigger>('OracleDeadlock'),
    target: finalized(42),
  }),
  justificationHash: finalized('0xjust'),
  dispatched: finalized(false),
  approvals: finalized(2),
  threshold: finalized(5),
  expiresAt: finalized(9_000),
  calls: [CALL('Epoch', 'force_rerun')],
});

/** The approval context for `ACTION_ROW`, whose condition is read for its own cohort. */
const APPROVE_ROW = (over: Partial<ApprovalContext> = {}): ApprovalContext =>
  APPROVE({
    action: ACTION_ROW(),
    condition: { kind: 'trigger', reading: active('OracleDeadlock', 42) },
    ...over,
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
      context: APPROVE_ROW({
        callerIsMember: false,
        callerHasApproved: true,
        now: finalized(99_999),
      }),
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
  // Three block headings, and it used to be five. Contract v28 froze `Guardian.PendingActions`
  // and `Guardian.Approvals` (SQ-616), so O-3's pending-action read is an ordinary clause and
  // the row carries no unreadable obligation at all — which also removes the caveat list the
  // gate control renders for one. Until that seam was retired every render of this control
  // carried a blocking reason and the approve button could never open, so this suite had only
  // ever seen S15 refuse.
  //
  // The fourth heading is E20's trigger-condition status, which renders on **every** approval
  // including the clean ones — see the test below.
  //
  // **Two `Not readable at B′` headings arrived on 2026-08-08 and are gone again**: `O-3`
  // declared `PlaybookNotRegistered` and `PlaybookAlreadyActive` as `blocking` obligations
  // citing SQ-1030 for one day, and contract v30 froze both maps — so they are ordinary
  // clauses now and the refusals are model blocks scoped to the arms the runtime guards them
  // behind. What remains is the `stated` SQ-1022 caveat (`TooManyReviews`), whose bound has no
  // frozen constant and whose count is not frozen either; it never blocks and always renders.
  assert.deepEqual(
    headings.sort(),
    [
      'Already approved',
      'Expiry',
      'Membership',
      'Trigger condition — OracleDeadlock',
      'What this client cannot check here',
    ],
  );
});

test('the caveat panel describes THIS action’s dispatch, not the row’s whole call', () => {
  // The Codex finding on #287, in its second half. Scoping was applied to
  // `blockingObligationsFor` alone, so the approve control *opened* for a `pause_intake` while
  // `operatorGate.unreadable` — which `GateControl` renders unconditionally — still told the
  // guardian that playbook registration and an active `PB-LEDGER-FREEZE` record could not be
  // checked. The control opening and the copy describing a different dispatch is the same
  // defect one layer up, and one predicate now serves both lists.
  //
  // Rendered rather than asserted on the model: what was wrong was never `approvalBlocks`, and
  // only a render proves what a guardian is actually shown.
  const caveats = (context: ApprovalContext): readonly string[] => {
    const html = renderToStaticMarkup(
      h(ApproveAction, { context, session: readySession('O-3'), onApprove: noSubmit }),
    );
    const panel = /What this client cannot check here<\/strong>([\s\S]*?)<\/ul>/.exec(html);
    const body = panel?.[1];
    return body === undefined ? [] : [...body.matchAll(/<li>([^<]*)<\/li>/g)].map((m) => m[1] ?? '');
  };

  // Every approval carries the one caveat that is about the row rather than about an arm:
  // `TooManyReviews` applies to all five powers, and a `stated` obligation never blocks — so
  // filtering on disposition instead of on scope would delete exactly the caveat that matters.
  const pause = APPROVE({
    action: { ...ACTION_ROW(), power: { kind: 'pause_intake', until: finalized(9_000) } },
    condition: { kind: 'no-condition' },
    playbooks: { kind: 'not-applicable' },
  });
  const shown = caveats(pause);
  assert.equal(shown.length, 1, `expected exactly the row-wide caveat, got: ${shown.join(' | ')}`);
  assert.match(shown[0] ?? '', /retrospective review record/);
  assert.match(shown[0] ?? '', /SQ-1022/);
  // …and no caveat about a condition this dispatch never reaches.
  assert.ok(!shown.some((entry) => /playbook/i.test(entry)), shown.join(' | '));

  // The mechanism itself, over synthetic obligations, because today's real table carries no
  // scoped entry — `blockingObligationsFor` and the displayed list would agree vacuously and
  // a green run would prove nothing. `ObligationScope` is kept for the same reason: `O-3` is
  // one row for five powers whatever the table happens to hold this week.
  const scoped = (scope?: ObligationScope): UnreadableObligation => ({
    row: 'O-3',
    requirement: 'a condition only one dispatch arm reads',
    reason: 'synthetic — this exercises the predicate, not the table',
    specQuestion: 'SQ-1022',
    disposition: 'stated',
    ...(scope === undefined ? {} : { scope }),
  });
  const unscoped = scoped();
  const anyActivation = scoped({ power: 'activate_playbook' });
  const freezeOnly = scoped({ power: 'activate_playbook', playbook: 'PB-LEDGER-FREEZE' });

  // An unscoped obligation is about the whole call and always applies.
  assert.equal(obligationAppliesTo(unscoped, { power: 'pause_intake' }), true);
  // No subject: everything is kept. A caller that cannot name the power has not shown the
  // narrow ones do not apply, and dropping one on an unproven premise is fail-open.
  assert.equal(obligationAppliesTo(freezeOnly, undefined), true);
  // A positive match failure on the power…
  assert.equal(obligationAppliesTo(anyActivation, { power: 'delay_once' }), false);
  assert.equal(obligationAppliesTo(anyActivation, { power: 'activate_playbook' }), true);
  // …and on the playbook, which is the narrower half.
  assert.equal(
    obligationAppliesTo(freezeOnly, { power: 'activate_playbook', playbook: 'PB-DEPEG' }),
    false,
  );
  assert.equal(
    obligationAppliesTo(freezeOnly, { power: 'activate_playbook', playbook: 'PB-LEDGER-FREEZE' }),
    true,
  );
  // A power-scoped obligation is not narrowed by a playbook it does not name.
  assert.equal(
    obligationAppliesTo(anyActivation, { power: 'activate_playbook', playbook: 'PB-DEPEG' }),
    true,
  );
});

test('the gate’s two lists cannot disagree about which action they describe', () => {
  // The invariant the finding is about, stated so it holds whatever the obligation table
  // contains: a `blocking` obligation that reaches the caveat panel must also have closed the
  // control. If the displayed list ever goes back to the unscoped set, an obligation scoped
  // away from `blocks` would surface here and this fails.
  const subjects: readonly (ObligationScope | undefined)[] = [
    undefined,
    { power: 'pause_intake' },
    { power: 'delay_once' },
    { power: 'force_rerun' },
    { power: 'suspend_on_gate' },
    { power: 'activate_playbook' },
    { power: 'activate_playbook', playbook: 'PB-LEDGER-FREEZE' },
    { power: 'activate_playbook', playbook: 'PB-DEPEG' },
  ];
  for (const subject of subjects) {
    const gateResult = operatorGate('guardian.approve_action', readySession('O-3'), [], subject);
    // The displayed list is the scoped one, `stated` entries included.
    assert.deepEqual(gateResult.unreadable, scopedObligationsFor('O-3', subject));
    const blocked = new Set(gateResult.blocks.map((block) => block.detail));
    for (const entry of gateResult.unreadable) {
      if (entry.disposition !== 'blocking') continue;
      assert.ok(
        [...blocked].some((detail) => detail.includes(entry.requirement)),
        `${entry.requirement} is shown as an unchecked condition but did not close the control`,
      );
    }
    // A `stated` obligation must survive the filter: it never blocks, and dropping it would
    // let a console present a complete verdict for a check it knows to be partial.
    assert.ok(
      gateResult.unreadable.some((entry) => entry.disposition === 'stated'),
      'the row-wide stated caveat was filtered out with the scoped ones',
    );
  }

  // **Asserted on the module's source, and that is not belt-and-braces — it is the only
  // non-vacuous form available today.** Every obligation the real table now carries is
  // unscoped, so `scopedObligationsFor(row, subject)` and `unreadableObligationsFor(row)`
  // return the same list for every subject: a behavioural test cannot tell the fixed code
  // from the defect, and a mutant reverting this line survives the whole suite (measured).
  // The property is *which list this module reads*, so it is checked as one — the same device
  // this file already uses to bind client scoping to the pallet's own `if let`.
  const gateSource = readFileSync(
    join(REPO, 'app/src/features/tx/src/operator-gate.ts'),
    'utf8',
  );
  assert.match(
    gateSource,
    /const unreadable = scopedObligationsFor\(row, subject\);/,
    'operatorGate no longer scopes the obligations it displays',
  );
  assert.ok(
    !/\bunreadableObligationsFor\b/.test(gateSource),
    'operatorGate reads the unscoped obligation list, so its caveats can describe another dispatch',
  );
});

test('the unratified consequence renders BEFORE any propose action, unconditionally', () => {
  // §11.8.2 requires it stated. The moment it matters is while the guardian is deciding, so
  // it is not behind the button — and it renders on the clean path too, where a screen that
  // showed it only alongside a refusal would omit it exactly when the action will happen.
  const clean = renderToStaticMarkup(
    h(ProposeAction, {
      inputs: PROPOSE({ power: 'pause_intake', meter: METER('pause_intake'), until: 5_000, horizon: HORIZON }),
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
      inputs: PROPOSE({
        power: 'pause_intake',
        meter: {
          power: 'pause_intake',
          used: finalized(0, 1_000_000),
          limit: { value: 3, status: { kind: 'verified-finalized', chain: TEST_CHAIN, blockHash: '0xbeef', blockNumber: 9 } },
        },
        until: 5_000,
        horizon: HORIZON,
      }),
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
      streamClaimsWired: finalized(true),
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
      streamClaimsWired: finalized(true),
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
      context: APPROVE({
        action: ACTION({ calls: [CALL('Constitution', 'set_param'), CALL('Epoch', 'force_rerun')] }),
      }),
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
  // **The model opens and so does the control**, and the two are still asserted separately.
  // They used to be one assertion — `!buttonDisabled` — which is the shape that made this test
  // worthless while a blocking obligation stood: the button is disabled whatever the batch
  // does, so a test reading only the button passes with the batch rendering nothing at all.
  //
  // O-3 carried two `blocking` obligations for one day (SQ-1030) and contract v30 froze both
  // maps, so **S15's approve control opens again** — which is the state this test could not
  // reach before and the reason the split is kept rather than collapsed back.
  assert.deepEqual(
    approvalBlocks(
      APPROVE({
        action: ACTION({ calls: [CALL('Constitution', 'set_param'), CALL('Epoch', 'force_rerun')] }),
      }),
    ),
    [],
    'a decoded batch on a clean context must produce no model block',
  );
  assert.ok(!buttonDisabled(html, 'Approve'), html);
  assert.ok(!/SQ-1030/.test(html), 'a resolved spec question is still closing this control');
  assert.ok(!/SQ-616/.test(html), 'a resolved spec question is still closing this control');
  assert.ok(!/Empty batch|Undecodable call/.test(html), `the batch itself must not block: ${html}`);
});

test('an undecodable call blocks the approval and renders as raw bytes, never a name', () => {
  // R-7's reading: on the powers that cannot be undone, "we could not decode it" must not
  // land on the same side as "we decoded it and it is fine". The undecodable arm carries no
  // pallet or call field, so no screen can render a guessed name for it.
  const html = renderToStaticMarkup(
    h(ApproveAction, {
      context: APPROVE({
        action: ACTION({
          calls: [CALL(), { kind: 'undecodable', rawHex: '0xdeadbeef', reason: 'unknown call index' }],
        }),
      }),
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
  const blocks = approvalBlocks(APPROVE({ action: ACTION({ calls: [] }) }));
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
  // Contract v29 (SQ-602). Deliberately **above** `insurance` (50,000,000) so the default
  // fixture classifies as `below-target` — the state 08 §1.2 says the account is expected
  // to sit in, since `T_ins` is a monotone over-estimate in v1. A fixture that happened to
  // equal the balance would make `at-target` the accidental default and hide the arm the
  // panel most often renders.
  insuranceTarget: finalized(80_000_000n),
  // Contract v29. `true` in the default fixture so the *stream* refusals stay the subject
  // of the tests written for them; the unwired case has its own tests, which is where the
  // deployment-level refusal belongs.
  streamClaimsWired: finalized(true),
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

/** Just enough of `tools/release/surface-manifest.json` to name pallets, items and fields. */
interface SurfaceManifest {
  readonly entries: readonly {
    readonly id: string;
    /** Present on `kind: 'storage'` entries; a runtime-API entry names an `api`/`method`. */
    readonly pallet?: string;
    readonly item?: string;
    readonly layout?: {
      readonly fields?: readonly { readonly name: string }[];
      /** The SCALE shape a runtime-API method answers with, as the extractor recorded it. */
      readonly return?: string;
      /** The SCALE shape a storage item's value carries — 02 §7's own layout record. */
      readonly value?: string;
    };
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

/**
 * The pallet a storage or event entry names.
 *
 * Asserted rather than assumed, because the manifest also carries **runtime-API** entries,
 * which name an `api`/`method` pair and no pallet at all. A helper returning `undefined`
 * silently would put the string `"undefined"` into an ingest filter's pallet comparison,
 * which matches nothing — V-169's failure shape, one type-widening later.
 */
function surfacePallet(id: string): string {
  const { pallet } = surfaceEntry(id);
  assert.ok(pallet !== undefined, `${id} names no pallet`);
  return pallet;
}

const REGISTRIES: RegistryInstances = {
  incident: surfacePallet('event.registry.window_extended.incident'),
  milestone: surfacePallet('event.registry.window_extended.milestone'),
};

test('there is no pallet named `Registry`, and the module holds no name of its own (V-169)', () => {
  const pallets = new Set(
    SURFACE.entries.map((entry) => entry.pallet).filter((name): name is string => name !== undefined),
  );
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
      pallet: surfacePallet('event.oracle.window_extended'),
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
  const ok = filingBlocks(FILING({
    freeUsdc: finalized(1_000n),
    filingBond: QUOTED(100n, 4_000n),
    filingsUsed: finalized(3),
    filingsBound: finalized(10),
    evidenceHash: '0xev',
  }));
  assert.deepEqual(ok, []);

  const all = filingBlocks(FILING({
    freeUsdc: finalized(10n),
    filingBond: QUOTED(100n, 4_000n),
    filingsUsed: finalized(10),
    filingsBound: finalized(10),
    evidenceHash: undefined,
  }));
  assert.deepEqual(all.map((b) => b.check), ['Filing bond', 'Registry bounds', 'Evidence']);
  // The bond is value-scaled, so the copy says it is read rather than fixed — a client that
  // implied a constant would under-report after the first amendment.
  assert.match(nth(all, 0, 'block').detail, /value-scaled/);
  // Filing without evidence commits a claim that adjudicates as unsupported.
  assert.match(nth(all, 2, 'block').detail, /adjudicated as\s+absent/);

  // An EMPTY hash is not a hash. Checking only for `undefined` let `''` through, which is
  // what an unfilled form field actually produces — the mutation that survived first pass.
  const empty = filingBlocks(MILESTONE_FILING({
    freeUsdc: finalized(1_000n),
    filingBond: QUOTED(100n, 4_000n),
    filingsUsed: finalized(0),
    filingsBound: finalized(10),
    evidenceHash: '',
  }));
  assert.deepEqual(empty.map((b) => b.check), ['Evidence']);
});

test('M7 — a filing behind a CLOSED epoch is refused (AlreadyFinal), which nothing evaluated', () => {
  // `registry_core::file` refuses when this instance already holds an aggregate for
  // `(epoch, spec_version)`: "a closed-out `(epoch, version)` aggregate is terminal (07 §7):
  // late filings must not land behind an already-derived welfare input". `filingBlocks`
  // evaluated none of `file`'s five refusals and O-8 declared no clause for any of them, so a
  // filer could be walked to a **bonded** signature the chain reverts.
  //
  // The read is exact rather than a proxy: `ClosedAt` is the same `(epoch, spec_version)`
  // double map, written by `close_epoch` in the same call that pushes the aggregate and
  // removed by `reap_epoch` in the same call that removes it. It has been frozen since
  // contract v28 (02 §7.4) and O-9 already cited it.
  assert.deepEqual(filingBlocks(FILING()), [], 'the clean fixture must name an open epoch');
  const closed = filingBlocks(FILING({ epochClosed: { kind: 'closed', at: finalized(88_000) } }));
  assert.deepEqual(closed.map((b) => b.check), ['Epoch closed']);
  assert.match(nth(closed, 0, 'block').detail, /closed out at block 88,?000/);
  assert.match(nth(closed, 0, 'block').detail, /terminal/);
  // The version is named, because a sibling version's close says nothing about this one —
  // the map is keyed on the pair and the core's `ensure!` scopes to the pair too.
  assert.match(nth(closed, 0, 'block').detail, /MetricSpec version 3/);

  // An unread answer fails closed and says which silence it is, exactly as the frozen-spec
  // clause does: retrying a read and choosing another epoch are different remedies.
  const unread = filingBlocks(
    FILING({ epochClosed: { kind: 'unread', reason: 'the storage read failed' } }),
  );
  assert.deepEqual(unread.map((b) => b.check), ['Epoch closed']);
  assert.match(nth(unread, 0, 'block').detail, /could not read/);
  assert.match(nth(unread, 0, 'block').detail, /the storage read failed/);
  assert.notEqual(nth(unread, 0, 'block').detail, nth(closed, 0, 'block').detail);

  // Both instances, because the two allocators close independently and O-8's clause is
  // per-instance for exactly that reason.
  assert.deepEqual(filingBlocks(MILESTONE_FILING()), []);
  assert.deepEqual(
    filingBlocks(MILESTONE_FILING({ epochClosed: { kind: 'closed', at: finalized(1) } }))
      .map((b) => b.check),
    ['Epoch closed'],
  );

  // The row declares it, so the gate re-reads it at B′ rather than trusting this model — and
  // it names **this instance's** map, since the two registries close separately.
  for (const instance of ['incident', 'milestone'] as const) {
    const rows = operatorRowsFor(instance)['O-8'];
    const clause = rows.find((entry) => entry.key === 'not-final');
    assert.ok(clause !== undefined, `O-8/${instance} declares no not-final clause`);
    assert.equal(clause.surface, `storage.${instance}_registry.closed_at`);
    assert.equal(clause.subject, 'chain');
  }
});

test('M7 — the filing CLASS is the instance’s own, and the wrong one cannot be built', () => {
  // `registry_core::validate_class` admits `S1 | S2 | S3` on Incident and `Scope(_)` on
  // Milestone, and refuses anything else with `InvalidClass` — after the bond is committed.
  // `FilingInputs` carried no `class` at all, so the model could not describe two of `file`'s
  // five arguments and the check had nothing to run on.
  //
  // The repair is the union rather than a predicate: `FilingInputs` is keyed on the instance
  // and the arms take disjoint class types, so `InvalidClass` is not a value that exists. The
  // compiler is the test — `tests/firewall/fixtures/registry-filing-class-for-the-wrong-
  // instance.ts` is the executable half.
  const incident = FILING({ class: 'S1' });
  assert.equal(incident.kind === 'incident' ? incident.class : undefined, 'S1');
  const milestone = MILESTONE_FILING({ class: { scope: 4 } });
  assert.deepEqual(milestone.kind === 'milestone' ? milestone.class : undefined, { scope: 4 });
  // Every admissible incident class is offered and nothing else is, so a form built from this
  // list cannot present a class the chain refuses.
  assert.deepEqual([...INCIDENT_CLASSES], ['S1', 'S2', 'S3']);
  for (const severity of INCIDENT_CLASSES) {
    assert.deepEqual(filingBlocks(FILING({ class: severity })), [], `${severity} must be filable`);
  }
  // …and the screen renders it. A value the model carries and no screen shows is V-169's
  // shape — `FilingKind` was threaded everywhere and read by nobody — so the two arguments
  // the filer chooses are on the panel, next to the bond they commit.
  const html = renderToStaticMarkup(
    h(RegistryFilingForm, {
      inputs: FILING({ class: 'S3' }),
      decimals: 6,
      symbol: 'USDC',
      evidence: EVIDENCE_FIXTURE,
      session: readySession('O-8'),
      onFile: noSubmit,
    }),
  );
  assert.ok(fieldPresent(html, 'Class'), html);
  assert.match(html, /<span>S3<\/span>/);
  assert.ok(fieldPresent(html, 'MetricSpec version this filing names'), html);
  const milestoneHtml = renderToStaticMarkup(
    h(RegistryFilingForm, {
      inputs: MILESTONE_FILING({ class: { scope: 7 } }),
      decimals: 6,
      symbol: 'USDC',
      evidence: EVIDENCE_FIXTURE,
      session: readySession('O-8'),
      onFile: noSubmit,
    }),
  );
  assert.match(milestoneHtml, /<span>Scope 7<\/span>/);
  // The two instances never show each other's class vocabulary.
  assert.ok(!/<span>S3<\/span>/.test(milestoneHtml), milestoneHtml);
  assert.ok(!/Scope /.test(html), html);
});

test('O-8 refuses a spec_version no live cohort froze, and refuses an unread set', () => {
  // The MAJOR an R-6 review found on 2026-08-07. §11.8.6's O-8 row requires `spec_version` to
  // be among the versions live cohorts froze for `epoch`, and `FilingInputs` carried no
  // version, `filingBlocks` had no predicate and the row declared no clause. A row whose read
  // is undeclared is **vacuously satisfied** by `clauseGroupsFor`, so O-8 reported complete
  // coverage of a check nothing performed and a filer could post a bond the runtime refuses.
  // Contract v29 freezes `Epoch.CohortSchedules` (02 §7.1) and this is the check it enables.
  assert.deepEqual(filingBlocks(FILING()), [], 'the clean fixture must name a frozen version');
  const wrong = filingBlocks(FILING({ specVersion: 9 }));
  assert.deepEqual(wrong.map((b) => b.check), ['MetricSpec version']);
  assert.match(nth(wrong, 0, 'block').detail, /No live cohort in this epoch froze MetricSpec version 9/);

  // An unread set fails closed and says which silence it is: waiting on a read and naming the
  // wrong version are different remedies, and an empty array is a third fact again.
  const unread = filingBlocks(
    FILING({ frozenSpecVersions: { kind: 'unread', reason: 'the storage read failed' } }),
  );
  assert.deepEqual(unread.map((b) => b.check), ['MetricSpec version']);
  assert.match(nth(unread, 0, 'block').detail, /could not read the versions/);
  assert.match(nth(unread, 0, 'block').detail, /the storage read failed/);
  assert.notEqual(nth(unread, 0, 'block').detail, nth(wrong, 0, 'block').detail);

  // An epoch whose cohorts froze nothing refuses every version rather than admitting any —
  // the empty set is data, and it is not the same value as a failed read.
  const none = filingBlocks(FILING({ frozenSpecVersions: { kind: 'read', versions: finalized([]) } }));
  assert.deepEqual(none.map((b) => b.check), ['MetricSpec version']);

  // The row declares the clause, so the gate re-reads it at B′ rather than trusting this
  // model alone — and it cites the item 02 §7.1 froze, never a two-map reassembly.
  const specClause = OPERATOR_ROWS['O-8'].find((c) => c.key === 'frozen-spec-version');
  assert.ok(specClause !== undefined, 'O-8 declares no frozen-spec-version clause');
  assert.equal(specClause.surface, 'storage.epoch.cohort_schedules');
  assert.ok(
    !OPERATOR_ROWS['O-8'].some((c) => c.surface === 'storage.epoch.proposals'),
    'the version clause must not be reassembled from per-proposal metric_spec reads',
  );
});

test('the exact filing bond is what the headroom is checked against, to the base unit', () => {
  // 11 §11.8.6's O-8 row: "free USDC ≥ that amount". The boundary is where a client that
  // compared against a floor, or that rounded, comes apart from the chain — so it is the
  // boundary that is asserted rather than a comfortable margin.
  const at = (free: bigint) =>
    filingBlocks(FILING({ freeUsdc: finalized(free), filingBond: QUOTED(1_000_000n, 40_000_000n) }))
      .map((block) => block.check);
  assert.deepEqual(at(1_000_000n), [], 'exactly the bond covers it');
  assert.deepEqual(at(999_999n), ['Filing bond'], 'one base unit short must block');
});

test('the pending-actions list shows the target, not just the power', () => {
  // §11.8.2's row is "power, target, `justification_hash` …". A power without its target is
  // not actionable: "delay_once" says a delay is proposed and not *what* is being delayed.
  //
  // The two used to be two `Verified<string>` fields a caller paired by hand, which is how a
  // row could name one action and describe another — and why the approve flow had nothing to
  // evaluate its condition against. Both now come from the decoded `GuardianPower`, so the
  // target cell is the call's own fields, each with its own badge.
  const html = renderToStaticMarkup(
    h(PendingActions, { actions: [ACTION_ROW()], justifications: () => JUSTIFICATION(), onOpen: () => {} }),
  );
  assert.match(html, /<th scope="col">Target<\/th>/, 'the column itself must exist');
  assert.match(html, /PB-ORA…E-VOID/, 'the playbook the action activates');
  assert.match(html, /OracleDeadlock/, 'the trigger the call names');
  assert.match(html, />42</, 'the cohort the VOID acts on');
  // The badge travels with each field rather than with a joined string: a target rendered as
  // one hand-built label would carry one status for values read separately.
  assert.equal(
    (html.match(/badge badge--verified-finalized/g) ?? []).length >= 4,
    true,
    'the decoded fields lost their per-datum provenance',
  );
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
  bondQuote: QUOTED(10_000_000_000n, 400_000_000_000n),
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

test('the round-1 report bond is the chain’s amount, and the disclosure calls it a quote', () => {
  // Contract v29 (SQ-598/SQ-620): `FutarchyApi.bond_quote(OracleReport { component, epoch })`
  // answers `B_1(c, m)`. P-13's `bond-floor` clause is **deleted** rather than kept beside the
  // quote — a floor is a lower bound on the bond and never the bond, and two answers to
  // "what will this hold?" on a bonded, slashable action is the defect SQ-620 was filed about.
  const check = reportBlocks(REPORT());
  assert.deepEqual(check.blocks, [], 'a quoted bond the account covers must block nothing');

  // Required, not optional — there is no shape of the result without it, which is why
  // `bondDisclosure` is a field rather than a block. What it says has changed meaning: it is
  // no longer "we cannot tell you the amount" but "this is a quote priced at a block".
  assert.equal(check.bondDisclosure, BOND_QUOTE_IS_A_QUOTE);
  assert.match(check.bondDisclosure, /priced at the block shown/);
  assert.match(check.bondDisclosure, /fixes when your transaction is included/);
  assert.match(check.bondDisclosure, /the chain’s reading is the one that binds/);
  // And it is stated on the CLEAN path, not only when something is wrong: 02 §3 requires the
  // caveat, and the reader who most needs it is the one with nothing else on screen to
  // signal that the figure can move.
  assert.equal(reportBlocks(REPORT({ freeUsdc: finalized(0n) })).bondDisclosure, check.bondDisclosure);

  // The floor is gone from the copy as well as from the clause list. A sentence still
  // offering a floor is a screen still able to present one as the amount.
  assert.doesNotMatch(check.bondDisclosure, /floor/i, 'the disclosure still offers a floor');
  assert.doesNotMatch(check.bondDisclosure, /SQ-598/, 'the caveat outlived the question it named');
});

test('the headroom is checked against the QUOTED amount, to the base unit', () => {
  // P-13's `bond-headroom` clause now reads "your USDC balance covers that bond", where
  // *that* is the quote. The boundary is where a client comparing against a floor — or
  // rounding — comes apart from the chain, so the boundary is what is asserted.
  const at = (free: bigint) =>
    reportBlocks(REPORT({ freeUsdc: finalized(free) })).blocks.map((block) => block.check);
  assert.deepEqual(at(10_000_000_000n), [], 'exactly the bond covers it');
  assert.deepEqual(at(9_999_999_999n), ['Round bond'], 'one base unit short must block');
  // `coversBond` is false whenever the bond is not quoted, so an unpriced bond can never
  // pass the headroom check on a figure that was never established — and the two clauses
  // then say different things, which is the point of keeping them separate.
  assert.equal(coversBond(UNDETERMINABLE, finalized(10n ** 30n)), false);
  assert.equal(coversBond(UNREAD_QUOTE, finalized(10n ** 30n)), false);
});

test('both non-quoted arms block P-13 and O-8, in different sentences, with no floor', () => {
  // 07 §7's not-determinable exposure and a read that did not land are different states with
  // different remedies — one waits for the aggregate to be bound to a component, the other
  // is a retry. Collapsing them tells a reporter to retry a call the chain answered
  // correctly. Neither may fall back to `orc.bond_floor` / `reg.bond_*`.
  const p13 = (quote: BondQuoteState) => reportBlocks(REPORT({ bondQuote: quote })).blocks;
  const undeterminable = p13(UNDETERMINABLE);
  const unread = p13(UNREAD_QUOTE);
  // Both close the bond clause, and both take the headroom clause down with them: with no
  // amount there is nothing to compare, and `coversBond` answering `true` would let a
  // headroom check pass on a figure nobody established.
  assert.deepEqual(undeterminable.map((b) => b.check), ['Bond amount', 'Round bond']);
  assert.deepEqual(unread.map((b) => b.check), ['Bond amount', 'Round bond']);

  const bondDetail = (blocks: readonly ReportBlock[]) => nth(blocks, 0, 'block').detail;
  assert.notEqual(
    bondDetail(undeterminable),
    bondDetail(unread),
    'the two silences must not share one sentence — the remedies differ',
  );
  // **Per request arm, and P-13's is the oracle one.** One sentence served both rows until
  // 2026-08-07 and it was the registry's: it named 07 §7's not-determinable aggregate and
  // `ExposureUnavailable`, which is `pallet-registry`'s error and one `oracle.report` never
  // returns. A reporter was shown another pallet's error name.
  assert.equal(bondDetail(undeterminable), BOND_QUOTE_UNDETERMINABLE['oracle-report']);
  assert.doesNotMatch(bondDetail(undeterminable), /ExposureUnavailable/);
  assert.doesNotMatch(bondDetail(undeterminable), /aggregate is bound/);
  assert.match(bondDetail(undeterminable), /live oracle parameters/);
  assert.match(bondDetail(unread), /could not be read/);
  assert.match(bondDetail(unread), /the state call timed out/, 'the read’s own reason must travel');
  for (const detail of [bondDetail(undeterminable), bondDetail(unread)]) {
    assert.doesNotMatch(detail, /at least/i, 'a floor was offered in place of the amount');
  }
  // The `unread` sentence says in as many words why a floor is not substituted; the
  // `undeterminable` one says the control stays closed rather than asking for a commitment.
  assert.match(bondDetail(unread), /not\s+defaulted to a floor/);
  assert.match(bondDetail(undeterminable), /stays closed/);

  // The same two arms, one pallet over — O-8 shares `bond-quote.ts` because the chain
  // publishes one fold under two names (02 §3, contract v29).
  const o8 = (quote: BondQuoteState) => filingBlocks(FILING({ filingBond: quote }));
  const filingUndeterminable = o8(UNDETERMINABLE);
  const filingUnread = o8(UNREAD_QUOTE);
  assert.deepEqual(filingUndeterminable.map((b) => b.check), ['Bond amount']);
  assert.deepEqual(filingUnread.map((b) => b.check), ['Bond amount']);
  assert.notEqual(
    nth(filingUndeterminable, 0, 'block').detail,
    nth(filingUnread, 0, 'block').detail,
  );
  // One module and one `unread` sentence — the read failed the same way whichever question
  // was asked, and a second copy of that sentence is how the two would drift.
  assert.equal(nth(filingUnread, 0, 'block').detail, bondDetail(unread));
  // The `undeterminable` sentences are deliberately **not** shared: 07 §7's aggregate and
  // `ExposureUnavailable` are the filing arms' answer, and the reporter's is about oracle
  // parameters. Sharing one was the defect.
  assert.notEqual(nth(filingUndeterminable, 0, 'block').detail, bondDetail(undeterminable));
  assert.equal(nth(filingUndeterminable, 0, 'block').detail, BOND_QUOTE_UNDETERMINABLE['incident-filing']);
  assert.match(nth(filingUndeterminable, 0, 'block').detail, /not determinable/);
  assert.match(nth(filingUndeterminable, 0, 'block').detail, /ExposureUnavailable/);
  assert.match(nth(filingUndeterminable, 0, 'block').detail, /stays closed/);
  // …and the milestone instance gets its own arm rather than the incident one by default,
  // because `filingBlocks` routes on the instance it was given.
  const milestoneUndeterminable = filingBlocks(MILESTONE_FILING({ filingBond: UNDETERMINABLE }));
  assert.equal(
    nth(milestoneUndeterminable, 0, 'block').detail,
    BOND_QUOTE_UNDETERMINABLE['milestone-filing'],
  );
  assert.equal(bondQuoteRefusal(QUOTED(1n, 1n), 'oracle-report'), undefined, 'a quoted bond must not refuse');
});

test('the report control OPENS on a quoted bond, and closes on an unpriced one', () => {
  // Contract v29 retired P-13's `blocking` unreadable obligation, so `operatorGate` no
  // longer closes this control on its own. What must still close it is the model: R-7's
  // direction is that a reporter is never walked to a signature for a bond nobody can show
  // them, and that now travels through `reportBlocks` rather than through the row.
  const open = operatorGate('oracle.report', readySession('P-13'), reportBlocks(REPORT()).blocks);
  assert.equal(open.state, 'ready', 'a fully quoted report is still refused');
  assert.ok(open.window !== undefined);

  for (const quote of [UNDETERMINABLE, UNREAD_QUOTE]) {
    const blocked = operatorGate(
      'oracle.report',
      readySession('P-13'),
      reportBlocks(REPORT({ bondQuote: quote })).blocks,
    );
    assert.equal(blocked.state, 'blocked', `a report was offered on a ${quote.kind} bond`);
    assert.equal(blocked.window, undefined);
    assert.ok(blocked.blocks.some((block) => block.check === 'Bond amount'));
  }
  // Anti-vacuity from the other side: `oracle.challenge`'s bond is a plain read
  // (`OracleRoundView.bond`) and it opens on the same session shape.
  assert.equal(operatorGate('oracle.challenge', readySession('P-14'), []).state, 'ready');
});

test('P-13 blocks on window, registry, a short stake and evidence — each independently', () => {
  // One block per failing group. The bond clause no longer holds unconditionally, so this
  // reads the whole block list rather than filtering it — which also proves the clean
  // fixture is clean.
  const clauseBlocks = (over: Partial<ReportInputs>): readonly string[] =>
    reportBlocks(REPORT(over)).blocks.map((b) => b.check);
  assert.deepEqual(clauseBlocks({}), []);
  assert.deepEqual(clauseBlocks({ roundOpen: finalized(false) }), ['Round state']);
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

test('bond-quote.ts performs no arithmetic at all — the amount is the chain’s (07 §6.1)', () => {
  // 07 §6.1 states three separable normative details: the `/ 10,000` division rounds **up**,
  // rounding resolves toward custody, and the `max` against the floor applies **after**
  // rounding. A client applying them owns all three, and getting any wrong
  // under-collateralizes a bond — the under-custody direction I-4 and I-28 name as unsafe,
  // on money a user must post. So the module reads and displays, and computes nothing.
  //
  // Scanned as **code**: comments, import specifiers and every string body are removed, so
  // the copy explaining the absence cannot be read as the thing itself, while a `${…}`
  // interpolation — where a reinstated computation would sit — is kept.
  const code = codeOnly(txSource('bond-quote.ts'));
  for (const forbidden of ['*', '/', '%', '10_000', '10000', 'Math.']) {
    assert.ok(
      !code.includes(forbidden),
      `bond-quote.ts must contain no arithmetic — found ${JSON.stringify(forbidden)}`,
    );
  }
  // `B_1 << (round - 1)` is the exact shape P-14's "doubles per round" invites, so the shift
  // is checked as an operator rather than as a substring — `Record<K, V>>` ends in `>>`.
  assert.doesNotMatch(code, SHIFT_OPERATOR, 'a shift operator appeared in the bond module');
  assert.match('floor << round', SHIFT_OPERATOR, 'the shift check no longer detects anything');
  // Not vacuous: the scan still reaches the module's body, including the one comparison it
  // is allowed — a `>=` between two read balances is not bond arithmetic.
  assert.ok(code.includes('export function coversBond'), 'the absence scan read an empty file');
  assert.ok(code.includes('freeUsdc.value >= state.quote.bond.value'));
  // And `bond` is never derived from `exposure` — 02 §4's own prohibition, in the only form
  // that can be checked: the field is **declared once and never read**, so there is no site
  // at which the amount could be recomputed from the disclosure beside it.
  assert.equal(
    [...code.matchAll(/exposure/g)].length,
    1,
    '`exposure` is read in bond-quote.ts; 02 §4 makes it disclosure only, never an input',
  );
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

test('the report screen renders the AMOUNT and the quote caveat on the CLEAN path', () => {
  // A blocked form already says why. The dangerous render is the one with nothing wrong,
  // where a reporter reads a qualified figure as the settled charge.
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
  // The amount, not a floor. 10,000,000,000 base units at 6 decimals is 10,000 USDC.
  assert.ok(fieldPresent(html, 'Round bond'), html);
  assert.match(html, /10,000\.000000/, 'the quoted amount is not on screen');
  assert.ok(
    !html.includes('Round bond — at least') && !/a floor, not the amount/.test(html),
    'the screen still labels the bond as a floor',
  );
  // 02 §4 ships `read_at` and `exposure` beside the amount: the block prices the quote, and
  // the exposure is disclosure so a reporter can see what the bond scales with. Both are
  // labelled, so neither can be read as a second price.
  assert.ok(fieldPresent(html, 'Priced at block'), html);
  assert.ok(fieldPresent(html, 'Cohort escrow this bond is scaled against'), html);
  // The caveat renders unconditionally on the clean path — this is the reader with nothing
  // else on screen telling them the figure can move.
  assert.ok(html.includes(BOND_QUOTE_IS_A_QUOTE), `the quote disclosure is absent:\n${html}`);
  assert.ok(!buttonDisabled(html, 'Post the report'), 'a fully quoted report was still refused');
});

test('an unpriced bond renders NO amount field — a floor is not put in that slot', () => {
  // The direction a caption cannot fix: with no quote there is no figure, and any number in
  // the amount slot understates what the reporter is about to commit. 02 §4: "a client that
  // receives it blocks rather than substituting a floor".
  for (const quote of [UNDETERMINABLE, UNREAD_QUOTE]) {
    const html = renderToStaticMarkup(
      h(SubmitReport, {
        inputs: REPORT({ bondQuote: quote }),
        decimals: 6,
        symbol: 'USDC',
        evidence: EVIDENCE_FIXTURE,
        session: readySession('P-13'),
        onReport: noSubmit,
      }),
    );
    assert.ok(!fieldPresent(html, 'Round bond'), `a bond amount was rendered for ${quote.kind}`);
    assert.ok(!fieldPresent(html, 'Priced at block'), quote.kind);
    assert.ok(buttonDisabled(html, 'Post the report'), `${quote.kind} left the control live`);
  }
});

test('the filing screen renders the amount, the block and the same quote caveat', () => {
  // O-8 and P-13 share one method and one freezing rule (07 §7 freezes `F(kind, m)` at
  // creation), so the two screens state the same sentence — asserted rather than assumed,
  // because a second copy is how they would drift.
  const html = renderToStaticMarkup(
    h(RegistryFilingForm, {
      inputs: FILING(), decimals: 6, symbol: 'USDC', evidence: EVIDENCE_FIXTURE,
      session: readySession('O-8'), onFile: noSubmit,
    }),
  );
  assert.ok(fieldPresent(html, 'Filing bond'), html);
  assert.ok(fieldPresent(html, 'Priced at block'), html);
  assert.ok(fieldPresent(html, 'Cohort escrow this bond is scaled against'), html);
  assert.ok(html.includes(BOND_QUOTE_IS_A_QUOTE), `the quote disclosure is absent:\n${html}`);

  const unpriced = renderToStaticMarkup(
    h(RegistryFilingForm, {
      inputs: FILING({ filingBond: UNDETERMINABLE }), decimals: 6, symbol: 'USDC',
      evidence: EVIDENCE_FIXTURE, session: readySession('O-8'), onFile: noSubmit,
    }),
  );
  assert.ok(!fieldPresent(unpriced, 'Filing bond'), 'a bond amount was rendered with no quote');
  assert.ok(buttonDisabled(unpriced, 'File'), unpriced);
  assert.match(unpriced, /not determinable/);
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
 * It was seven, then eleven — every operator surface call there is — then ten for one day, and
 * it is eleven again. Contract v28 froze the guardian pending-action pair, the two upgrade
 * items and the registry's three maps (SQ-615/616/619); contract v29 published the last four
 * reads §11.8 requires and nothing carried — `api.bond_quote` for the report and filing bonds
 * (SQ-598/SQ-731), `api.treasury_streams` for the per-stream claim (SQ-601), and the two
 * storage latches behind §11.8.2's trigger table (SQ-730).
 *
 * **`guardian.approve_action` left the list on 2026-08-08 and returned on 2026-08-09.** It
 * left because `approve_action` refuses on `Guardian.PlaybookRegistered[id]` and on
 * `Guardian.ActivePlaybooks` **after** counting the fifth approval and 02 §7.4 froze neither,
 * so INV-FE-12's lattice made both absent and closed the control. Contract v30 froze both
 * maps: the reads are ordinary O-3 clauses now and the refusals are model blocks scoped to the
 * arms the runtime guards them behind. The day it was closed cost exactly what this file's own
 * note warns of — a screen that cannot open is a screen nothing exercises end to end — so the
 * tests below keep the model and the gate as separate assertions rather than folding both back
 * into one `buttonDisabled`.
 *
 * A list rather than a derivation, deliberately: derived from `UNREADABLE` it would agree
 * with whatever that file says and could never disagree with it. The binding between the two
 * is asserted below instead, in both directions.
 */
const OPENABLE_CALLS = [
  'oracle.register_reporter',
  'oracle.recompute_proof',
  'welfare.record_snapshot',
  'oracle.challenge',
  'oracle.report',
  'guardian.approve_action',
  'guardian.propose_action',
  'futarchy_treasury.claim_stream',
  'system.apply_authorized_upgrade',
  'registry.file',
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
  // operator a condition failed sends them hunting a problem that does not exist. Since
  // contract v29 that is every row — the closed set is empty, and the test below is what
  // keeps that a *derived* fact rather than this list quietly becoming exhaustive.
  //
  // **"Every row" was not true of O-8 until 2026-08-07, and no gate here could see it.**
  // §11.8.6 requires `spec_version` to be among the versions live cohorts froze for `epoch`,
  // and that clause read nothing: `clauseGroupsFor` answers *"every declared read passed"*,
  // which for an undeclared read is vacuously true, so O-8 reached `ready` with a
  // precondition nothing had evaluated and this list called it readable end to end. The
  // `Epoch.CohortSchedules` freeze (02 §7.1) is what made the claim true rather than
  // unfalsifiable — the emptiness of the closed set is about `UNREADABLE`, and a row can be
  // silently incomplete without appearing in it at all.
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
  // **The closed set is now derived, not listed, and it is empty.** It was six, then four;
  // contract v28 froze six surfaces in this branch's own base and PLAN.md marked SQ-615,
  // SQ-616 and SQ-619 resolved while the declarations stayed — so S15, S17 and S19 could not
  // reach `ready` at all and this test asserted that as though it *were* the specification.
  // A hand-written list is what made that possible, so the closed set now comes from the
  // declarations themselves (`OperatorGate.unreadable`) and the two dispositions are checked
  // as an implication in both directions. Contract v29 published the last four reads
  // (SQ-598 / SQ-601 / SQ-730 / SQ-731), so nothing is `blocking` any more — and this test
  // still fails the moment one is declared and the control opens anyway.
  const blocking: string[] = [];
  const stated: string[] = [];
  for (const call of Object.keys(OPERATOR_SURFACE_ROWS) as (keyof typeof OPERATOR_SURFACE_ROWS)[]) {
    const row = OPERATOR_SURFACE_ROWS[call];
    const gated = operatorGate(call, readySession(row), []);
    const blockers = gated.unreadable.filter((entry) => entry.disposition === 'blocking');
    if (blockers.length > 0) {
      blocking.push(call);
      assert.equal(gated.state, 'blocked', `${call} opened on an unread condition`);
      assert.equal(gated.window, undefined, call);
      for (const entry of blockers) {
        assert.ok(
          gated.blocks.some((block) => block.detail.includes(entry.specQuestion)),
          `${call} is closed without naming ${entry.specQuestion}`,
        );
      }
      continue;
    }
    // No blocking obligation ⇒ the control opens. This is the half a "closed" list can
    // never assert about itself, and it is what caught the v28 declarations that outlived
    // their questions.
    stated.push(...gated.unreadable.map((entry) => entry.specQuestion));
    assert.equal(gated.state, 'ready', `${call} is still closed on a resolved spec question`);
  }
  // The list above and the declarations must partition the surface — a call missing from
  // `OPENABLE_CALLS` that nothing blocks is a row nobody is exercising end to end.
  assert.deepEqual(
    [...OPENABLE_CALLS].sort(),
    Object.keys(OPERATOR_SURFACE_ROWS).filter((call) => !blocking.includes(call)).sort(),
  );
  // **Nothing is closed, and the one control that was is open again.** `approve_action` shut
  // for one day on SQ-1030 — `Guardian.PlaybookRegistered` and `Guardian.ActivePlaybooks` were
  // not frozen, and both refusals fall on the fifth approval. Contract v30 froze both, so the
  // reads are ordinary O-3 clauses and the refusals are model blocks. That is the mechanical
  // expiry working: the entries cited an **open** row, and the day it closed they had to go.
  assert.deepEqual(blocking, [], `unexpected blocking set: ${blocking}`);
  // Anti-vacuity for the `stated` half: O-1's two SQ-564 conditions are still surfaced and
  // still do not close a control — and O-3's SQ-1022 caveat now reaches this list too, because
  // the row is no longer blocked and the loop no longer `continue`s past it. That it appears
  // here at all is the evidence S15's approve control is open.
  assert.deepEqual(stated, ['SQ-564', 'SQ-564', 'SQ-1022'], 'the stated obligations stopped being carried');
  const guardian = unreadableObligationsFor('O-3');
  assert.deepEqual(
    guardian.map((entry) => [entry.specQuestion, entry.disposition]),
    [['SQ-1022', 'stated']],
  );
  // The replacement reads are declared, so the two obligations were **closed** rather than
  // dropped. A retirement with no clause behind it is the check going missing quietly, which
  // is the failure mode this whole list exists to make visible.
  const o3 = new Set(rowsFor('O-3', 'USDC').map((entry) => entry.surface));
  assert.ok(o3.has('storage.guardian.playbook_registered'));
  assert.ok(o3.has('storage.guardian.active_playbooks'));
  // `TooManyReviews` is `stated` on purpose and the reasoning is asserted, not just the flag:
  // neither the count (`Guardian.ReviewDeadlines`) nor the bound (128) is readable, so closing
  // the control on it would refuse what the chain accepts — the mirror-rule defect. Naming it
  // is the point; an unenumerated shape is how this class survived its first fix.
  assert.match(nth(guardian, 0, 'obligation').reason, /TooManyReviews/);
  assert.match(nth(guardian, 0, 'obligation').reason, /refuse what the chain accepts/);
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

test('the ROW check reads the window’s preparation, not whatever the session carries', () => {
  // `operator-gate.ts`'s own note has always said the declaration check reads `window.prep`
  // — the preparation the proof was minted for — and the code passed `session.prep`
  // unconditionally until 2026-08-07. The two agreed only because a neighbouring refusal
  // rejects a window minted for a different preparation, so the weaker read was covered by
  // another check rather than by itself. `window.prep` is also the object `operatorSubmit`
  // hands the submitter, so it is the one whose declared rows have to be this call's.
  const mine = readySession('O-1');
  const foreign = readySession('P-1');
  const crossed = { ...mine, signingWindow: foreign.signingWindow } as TxSession;
  const gated = operatorGate('oracle.register_reporter', crossed, []);
  assert.equal(gated.state, 'blocked');
  // Both fire: the proof names another preparation, AND that preparation declares a row this
  // call is not. The second is the one the note claimed and the code did not check.
  assert.deepEqual(
    gated.blocks.map((block) => block.check).sort(),
    ['Declared precondition row', 'Gate proof'],
  );
  assert.match(nth(gated.blocks, 0, 'block').detail, /P-1/);
  // Anti-vacuity: the same session with its own window opens.
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

test('the model’s own refusal closes the control the row no longer closes (O-5, SQ-601)', () => {
  // `clauseGroupsFor` answers "every declared read passed", which for a row whose central
  // read 02 freezes no surface for is **vacuously** true — and that is what O-5's `blocking`
  // declaration used to cover. Contract v29 gave the row a real source
  // (`api.treasury_streams`), so the row opens; what must still refuse is the *model*, and
  // the fail-closed direction has to survive the declaration's retirement rather than
  // travelling with it.
  const open = operatorGate('futarchy_treasury.claim_stream', readySession('O-5'), []);
  assert.equal(open.state, 'ready', 'the claim row is still closed on a resolved question');

  // A figure this client cannot establish is money it must not offer a claim against. The
  // block comes from `claimBlocks`, so it reaches the control through `operatorGate`'s
  // `local` argument — required rather than optional for exactly this reason.
  const acrossBlocks = claimBlocks({
    stream: STREAM({
      claimed: { value: 0n, status: { kind: 'verified-finalized', chain: TEST_CHAIN, blockHash: '0xbeef', blockNumber: 999_000 } },
    }),
    callerIsRecipient: true,
    streamClaimsWired: finalized(true),
    now: finalized(600),
  });
  const blocked = operatorGate('futarchy_treasury.claim_stream', readySession('O-5'), acrossBlocks);
  assert.equal(blocked.state, 'blocked', 'a claim was offered against a figure true of no block');
  assert.equal(blocked.window, undefined);
  assert.match(nth(blocked.blocks, 0, 'block').detail, /cannot establish what is claimable/);
  // And the three zeros close it too, each with its own sentence rather than one refusal.
  // Labelled by name rather than by serializing the fixture: `JSON.stringify` throws on a
  // BigInt, and a message helper that throws turns a real failure into a harness error.
  for (const [label, over, phrase] of [
    ['cancelled', { cancelled: finalized(true) }, /cancelled/],
    ['zero-length', { duration: finalized(0) }, /no vesting schedule can be derived/],
    ['fully claimed', { claimableNow: finalized(0n) }, /already been claimed/],
  ] as const) {
    const gated = operatorGate(
      'futarchy_treasury.claim_stream',
      readySession('O-5'),
      claimBlocks({ stream: STREAM(over), callerIsRecipient: true, streamClaimsWired: finalized(true), now: finalized(600) }),
    );
    assert.equal(gated.state, 'blocked', label);
    assert.match(nth(gated.blocks, 0, 'block').detail, phrase, label);
  }
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
    // Contract v29's clause. It used to hold unconditionally (there was no amount to read),
    // so nothing here could drive it — and a predicate that can only fail is as unexercised
    // as one that can only pass.
    'bond-quote': { bondQuote: UNDETERMINABLE },
    'bond-headroom': { freeUsdc: finalized(0n) },
    evidence: { evidenceHash: undefined },
  };
  // Every clause key the table declares must appear above: a clause added to P-13 with no
  // failing fixture here is one this test would report as covered while never driving it.
  assert.deepEqual(
    [...keys].filter((key) => key !== undefined).sort(),
    Object.keys(failing).sort(),
    'a P-13 clause has no failing fixture in this test',
  );
  for (const [key, over] of Object.entries(failing)) {
    const check = reportBlocks(REPORT(over)).blocks;
    assert.ok(check.length > 0, `P-13 clause ${key} has no predicate that can fail`);
  }
  assert.deepEqual(
    reportBlocks(REPORT()).blocks.map((block) => block.check),
    [],
    'the clean fixture must block on nothing at all',
  );
  // And the disclosure is 02 §3's own obligation, carried on every result including this one.
  assert.equal(reportBlocks(REPORT()).bondDisclosure, BOND_QUOTE_IS_A_QUOTE);
  assert.match(reportBlocks(REPORT()).bondDisclosure, /priced at the block shown/);
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

test('round state and report window are reported as SEPARATE blocks', () => {
  // §11.5 writes them with a semicolon between them, and they have different remedies. One
  // collapsed flag cannot say which half failed.
  const clauseBlocks = (over: Partial<ReportInputs>): readonly ReportBlock[] =>
    reportBlocks(REPORT(over)).blocks;
  const windowGone = clauseBlocks({ reportWindowOpen: finalized(false) });
  assert.deepEqual(windowGone.map((block) => block.check), ['Report window']);
  const roundState = clauseBlocks({ roundOpen: finalized(false) });
  assert.deepEqual(roundState.map((b) => b.check), ['Round state']);
  assert.match(nth(windowGone, 0, 'block').detail, /round itself may still be open/);
  // The round-state copy must NOT assert that the round has been closed or settled. It said
  // exactly that until 2026-08-07, and `oracle_core::report` refuses when a round already
  // **exists** (`AlreadyFinal`) — `report` opens round 1 and a counter-report is
  // `oracle.challenge`. The specification writes "round open" and the runtime reads the
  // other way, so the client names no state while the disagreement is open.
  const detail = nth(roundState, 0, 'block').detail;
  assert.doesNotMatch(detail, /closed or settled/);
  assert.doesNotMatch(detail, /needs a live round/);
  assert.match(detail, /does not name which state/);
  // …and it points at the call that IS the counter-report, so the reader is not left to
  // conclude that reporting again is the remedy.
  assert.match(detail, /oracle\.challenge/);
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

/* ------------------------- §11.8.2's trigger table, bound to the runtime it mirrors */

/**
 * `guardian_core`, read in place.
 *
 * The client's trigger data is a **restatement** of two runtime declarations, and a
 * restatement nothing binds is a copy that stops tracking the thing it copies. Both sides are
 * therefore parsed here — the Rust from `crates/guardian-core/src/lib.rs`, the TypeScript from
 * `guardian.ts` — so a variant added, renamed or re-paired on either side fails this suite
 * rather than surfacing as a 5-of-7 signature the chain refuses with `BadPlaybookTrigger`.
 */
const GUARDIAN_CORE = readFileSync(join(REPO, 'crates/guardian-core/src/lib.rs'), 'utf8');

/** The variant names of one `pub enum` in `guardian-core`, refusing an empty parse. */
function rustEnumVariants(name: string): readonly string[] {
  const start = GUARDIAN_CORE.indexOf(`pub enum ${name} {`);
  assert.ok(start >= 0, `guardian-core no longer declares \`pub enum ${name}\``);
  const end = GUARDIAN_CORE.indexOf('\n}', start);
  assert.ok(end > start, `\`${name}\`'s declaration never terminates`);
  const variants = [...GUARDIAN_CORE.slice(start, end).matchAll(/^\s{4}(\w+),$/gm)].map(
    (match) => match[1] as string,
  );
  // Fail closed on a parse that found nothing: an empty expectation is satisfied by an
  // empty client, which is the vacuity every doc-parsing test in this file guards against.
  assert.ok(variants.length > 0, `parsed no variants out of \`${name}\``);
  return variants;
}

/**
 * `guardian_core::trigger_matches`, as a playbook → triggers map.
 *
 * Parsed by scanning for `PlaybookId::X` and taking every `PlaybookTrigger::Y` up to the next
 * `PlaybookId::`. That shape reads both spellings the `matches!` arm uses — the flat
 * `(PlaybookId::Reserve, PlaybookTrigger::ReserveHealth)` tuples and the grouped
 * `(PlaybookId::HaltIntake, A | B | C)` one — without depending on line breaks, which is
 * what a `rustfmt` run would otherwise move.
 */
function rustTriggerMatches(): ReadonlyMap<string, readonly string[]> {
  const start = GUARDIAN_CORE.indexOf('fn trigger_matches(');
  assert.ok(start >= 0, 'guardian-core no longer declares `trigger_matches`');
  const end = GUARDIAN_CORE.indexOf('\n}', start);
  const body = GUARDIAN_CORE.slice(start, end);
  const marks = [...body.matchAll(/PlaybookId::(\w+)/g)];
  assert.ok(marks.length > 0, 'parsed no playbooks out of `trigger_matches`');
  const pairs = new Map<string, readonly string[]>();
  marks.forEach((mark, index) => {
    const from = (mark.index ?? 0) + mark[0].length;
    const to = index + 1 < marks.length ? marks[index + 1]?.index ?? body.length : body.length;
    const triggers = [...body.slice(from, to).matchAll(/PlaybookTrigger::(\w+)/g)].map(
      (match) => match[1] as string,
    );
    assert.ok(triggers.length > 0, `\`${mark[1]}\` matched no trigger`);
    assert.ok(!pairs.has(mark[1] as string), `\`${mark[1]}\` appears twice in \`trigger_matches\``);
    pairs.set(mark[1] as string, triggers);
  });
  return pairs;
}

/** One `export const NAME … Object.freeze({ … })` block of a `features-tx` module. */
function constBlock(file: string, name: string): string {
  const source = withoutComments(txSource(file));
  const start = source.indexOf(`export const ${name}`);
  assert.ok(start >= 0, `${file} no longer exports \`${name}\``);
  const open = source.indexOf('{', start);
  assert.ok(open > start, `\`${name}\` is not an object literal`);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open, index + 1);
    }
  }
  return assert.fail(`\`${name}\`'s literal never terminates`);
}

/** A `Record<K, readonly string[]>` object literal, as `key -> members`. */
function frozenListMap(file: string, name: string): ReadonlyMap<string, readonly string[]> {
  const block = constBlock(file, name);
  const entries = new Map<string, readonly string[]>();
  for (const match of block.matchAll(/(?:'([^']+)'|(\w+)):\s*Object\.freeze\(\[([\s\S]*?)\]/g)) {
    const key = (match[1] ?? match[2]) as string;
    const members = [...(match[3] ?? '').matchAll(/'([^']+)'/g)].map((entry) => entry[1] as string);
    assert.ok(!entries.has(key), `\`${name}\` declares \`${key}\` twice`);
    entries.set(key, members);
  }
  assert.ok(entries.size > 0, `parsed nothing out of \`${name}\``);
  return entries;
}

/** The members of an exported string-literal union in a `features-tx` module. */
function clientUnion(file: string, name: string): readonly string[] {
  const members = [...declarationOf(txSource(file), name).matchAll(/'([^']+)'/g)].map(
    (match) => match[1] as string,
  );
  assert.ok(members.length > 0, `parsed no members out of \`${name}\``);
  return members;
}

/** 11 §11.8.2's trigger table, one row per `PlaybookTrigger` variant. */
const TRIGGER_TABLE: readonly { trigger: string; playbook: string; item: string }[] = (() => {
  const doc = readFileSync(DOC11, 'utf8');
  const section = /^### The trigger table[\s\S]*?(?=^### )/m.exec(doc);
  assert.ok(section !== null, 'doc 11 no longer carries §11.8.2’s trigger table');
  const rows = [...section[0].matchAll(/^\| `(\w+)` \| `(PB-[A-Z-]+)` \| (.*?) \|\s*$/gm)].map(
    (match) => ({
      trigger: match[1] as string,
      playbook: match[2] as string,
      item: match[3] as string,
    }),
  );
  assert.ok(rows.length >= 8, `parsed only ${rows.length} trigger rows out of doc 11`);
  return rows;
})();

/**
 * The six playbook ids as a compile-time tuple.
 *
 * Written out **only** because `@bleavit/features-tx` does not re-export `PlaybookId` (it is
 * declared and exported in `guardian.ts` and dropped by the barrel), so the suite cannot name
 * the client's own type. The tuple is bound to three independent sources by the drift lock
 * below — `guardian.ts`'s union, doc 11 §11.8.2's table and `guardian_core::PlaybookId` — so
 * it is a checked restatement rather than a copy that can go stale.
 */
const DOC_PLAYBOOK_IDS = [
  'PB-DEPEG',
  'PB-MIGRATION',
  'PB-ORACLE-VOID',
  'PB-HALT-INTAKE',
  'PB-RESERVE',
  'PB-LEDGER-FREEZE',
] as const;
type PlaybookId = (typeof DOC_PLAYBOOK_IDS)[number];

const DOC_TRIGGERS: readonly PlaybookTrigger[] = TRIGGER_TABLE.map(
  (row) => row.trigger as PlaybookTrigger,
);
const DOC_PLAYBOOK_TRIGGERS: readonly (readonly [PlaybookId, PlaybookTrigger])[] =
  TRIGGER_TABLE.map((row) => [row.playbook as PlaybookId, row.trigger as PlaybookTrigger]);

test('PLAYBOOK_TRIGGERS mirrors `guardian_core::trigger_matches` exactly, both ways', () => {
  // A drift lock, so it must fail if **either** side moves. The chain refuses a mismatched
  // pair with `BadPlaybookTrigger` *after* five approvals have been collected, so a client
  // holding the enum and not this map walks a council through five signatures on a refusal —
  // and the failure is invisible until somebody tries it.
  const rustPairs = rustTriggerMatches();
  const rustIds = rustEnumVariants('PlaybookId');
  assert.deepEqual([...rustPairs.keys()].sort(), [...rustIds].sort(), 'a playbook matches no trigger');

  // The Rust variant ↔ document id mapping is **derived**, not written: strip `PB-` and the
  // hyphens and the two names are the same word. A hand-written table here would be a third
  // copy of the thing this test exists to stop from having copies.
  const normalize = (value: string) => value.replace(/^PB-/, '').replace(/-/g, '').toUpperCase();
  const idFor = new Map<string, string>();
  for (const variant of rustIds) {
    const matches = DOC_PLAYBOOK_IDS.filter((id) => normalize(id) === variant.toUpperCase());
    assert.equal(matches.length, 1, `\`PlaybookId::${variant}\` names no single document id`);
    idFor.set(variant, matches[0] as string);
  }
  assert.equal(new Set(idFor.values()).size, DOC_PLAYBOOK_IDS.length, 'the mapping is not a bijection');

  // What the runtime accepts, in the client's own spelling.
  const expected = new Map<string, readonly string[]>(
    [...rustPairs].map(([variant, triggers]) => [idFor.get(variant) as string, [...triggers].sort()]),
  );
  const client = frozenListMap('guardian.ts', 'PLAYBOOK_TRIGGERS');
  const asSorted = (map: ReadonlyMap<string, readonly string[]>) =>
    [...map].map(([key, value]) => [key, [...value].sort()] as const).sort();
  // Both directions in one comparison: a missing pair and an extra pair both fail.
  assert.deepEqual(asSorted(client), asSorted(expected));

  // And doc 11 §11.8.2's table says the same thing, which is the half a two-way lock between
  // two implementations can never assert — the specification is the third party.
  const fromDoc = new Map<string, string[]>();
  for (const [id, trigger] of DOC_PLAYBOOK_TRIGGERS) {
    fromDoc.set(id, [...(fromDoc.get(id) ?? []), trigger].sort());
  }
  assert.deepEqual(asSorted(fromDoc), asSorted(expected), 'doc 11 and the runtime disagree');

  // The client's own `PlaybookId` union is the same closed set — an id it can name and the
  // map cannot key is a form that builds a call nothing checked.
  assert.deepEqual([...clientUnion('guardian.ts', 'PlaybookId')].sort(), [...DOC_PLAYBOOK_IDS].sort());
  assert.deepEqual(
    [...clientUnion('guardian.ts', 'PlaybookTrigger')].sort(),
    [...rustEnumVariants('PlaybookTrigger')].sort(),
  );
});

/**
 * `RuntimeGuardianStatus::status`, read in place — `runtime/bleavit-runtime/src/configs.rs`.
 *
 * The client's `guardianStatus` is a restatement of a projection that decides whether a
 * `delay_once` or a `force_rerun` is admissible, and a restatement nothing binds is a copy
 * that stops tracking the thing it copies. Parsed the same way `trigger_matches` is: scan for
 * `ProposalState::X` and take the `ProposalStatus::Y` that follows, which reads both the flat
 * arms and the grouped `A | B | C => Y` one without depending on line breaks.
 */
function rustGuardianStatus(): ReadonlyMap<string, string> {
  const configs = readFileSync(join(REPO, 'runtime/bleavit-runtime/src/configs.rs'), 'utf8');
  const start = configs.indexOf('impl pallet_guardian::GuardianProposalStatus for RuntimeGuardianStatus');
  assert.ok(start >= 0, 'the runtime no longer implements GuardianProposalStatus');
  const body = configs.slice(start, configs.indexOf('\n}', start));
  const marks = [...body.matchAll(/ProposalState::(\w+)|ProposalStatus::(\w+)/g)];
  assert.ok(marks.length > 0, 'parsed nothing out of `RuntimeGuardianStatus::status`');
  const map = new Map<string, string>();
  let pending: string[] = [];
  for (const mark of marks) {
    if (mark[1] !== undefined) pending.push(mark[1]);
    else if (mark[2] !== undefined) {
      for (const state of pending) map.set(state, mark[2] as string);
      pending = [];
    }
  }
  assert.ok(map.size > 0, 'no ProposalState was mapped to a ProposalStatus');
  return map;
}

test('the rerun projection is the RUNTIME’s, and both predicates are bound to it', () => {
  // Two restatements, one lock. `guardianStatus` mirrors `RuntimeGuardianStatus::status` and
  // `rerunnable` mirrors `guardian_core::ProposalStatus::rerunnable` — and a client whose
  // projection drifted would offer a `delay_once` the chain refuses with `NotRerunnable`
  // after five approvals, or refuse a lawful `force_rerun` outright.
  const rust = rustGuardianStatus();
  // The runtime's default arm is `Other`, and it is not written as a `ProposalState::`, so
  // the parse yields only the explicitly-mapped states. Every one of those must agree.
  for (const [state, status] of rust) {
    assert.equal(
      guardianStatus(state as ProposalStateName),
      status,
      `the client projects ${state} differently from the runtime`,
    );
  }
  assert.ok(rust.size >= 6, `parsed only ${rust.size} explicit arms out of configs.rs`);

  // Every state the SURFACE manifest declares is classified — a state added upstream and
  // unmapped here would fall to `Other`, which reads as *not rerunnable* and silently refuses
  // a lawful action. The manifest is generated from the runtime, so it is the third party.
  const proposals = SURFACE.entries.find((entry) => entry.id === 'storage.epoch.proposals');
  assert.ok(proposals !== undefined, '02 §7.1 no longer freezes Epoch.Proposals');
  // Bracket-depth aware, because `Rejected=8(RejectReasonenum[…])` nests a second enum whose
  // variants a `[^\]]*` capture would silently swallow — and a checker that read
  // `NotDecisionGrade` as a proposal state would demand a projection for a reject reason.
  const layout = proposals.layout?.value ?? '';
  const opened = layout.indexOf('ProposalStateenum[');
  assert.ok(opened >= 0, 'the Proposals layout no longer publishes ProposalState');
  let depth = 0;
  let close = -1;
  for (let k = opened + 'ProposalStateenum'.length; k < layout.length; k += 1) {
    if (layout[k] === '[') depth += 1;
    else if (layout[k] === ']') {
      depth -= 1;
      if (depth === 0) { close = k; break; }
    }
  }
  assert.ok(close > opened, 'the ProposalState enum never terminates');
  const body = layout.slice(opened + 'ProposalStateenum['.length, close);
  const states: string[] = [];
  let nest = 0;
  let token = '';
  for (const char of `${body}|`) {
    if (char === '[' || char === '(') nest += 1;
    else if (char === ']' || char === ')') nest -= 1;
    if (char === '|' && nest === 0) { token = token.trim(); if (token !== '') states.push(token); token = ''; }
    else token += char;
  }
  const stateNames = states.map((entry) => (/^(\w+)=/.exec(entry) ?? [])[1] ?? entry);
  assert.ok(stateNames.length >= 15, `parsed only ${stateNames.length} proposal states`);
  for (const state of stateNames) {
    assert.notEqual(
      guardianStatus(state as ProposalStateName),
      undefined,
      `${state} has no client projection`,
    );
  }

  // `rerunnable()` is `Trading | Extended | Queued`, parsed out of guardian-core itself.
  const matcher = /fn rerunnable\(self\) -> bool \{\s*matches!\(self, ([^)]*)\)/.exec(GUARDIAN_CORE);
  assert.ok(matcher !== null, 'guardian-core no longer declares `rerunnable`');
  const expected = [...nth(matcher, 1, 'capture').matchAll(/Self::(\w+)/g)].map((m) => m[1] as string);
  assert.deepEqual(expected.sort(), ['Extended', 'Queued', 'Trading']);
  for (const status of rustEnumVariants('ProposalStatus')) {
    assert.equal(
      rerunnable(status as ReturnType<typeof guardianStatus>),
      expected.includes(status),
      `\`rerunnable\` disagrees with the runtime about ${status}`,
    );
  }
});

test('TRIGGER_READS covers every PlaybookTrigger and cites only frozen surfaces (SQ-730)', () => {
  // 11 §11.8.2: "the table below binds each variant to the item that establishes it", and
  // "an unreadable trigger is treated exactly as an inactive one". A variant with no read is
  // one a client must invent a read for — on the action that costs a 5-of-7 signature.
  const reads = frozenListMap('guardian.ts', 'TRIGGER_READS');
  const variants = rustEnumVariants('PlaybookTrigger');
  assert.deepEqual([...reads.keys()].sort(), [...variants].sort(), 'a trigger has no declared read');
  assert.deepEqual([...reads.keys()].sort(), [...DOC_TRIGGERS].sort(), 'doc 11’s table drifted');

  // Every cited id is a frozen surface. `surface:check` byte-compares `CRITICAL_SURFACE`
  // against this manifest in both directions, so the manifest **is** that set — and reading
  // it here rather than the generated module keeps the assertion on the artefact 10 §5.2's
  // classifier probes. An unfrozen read is one the compat lattice cannot fail on (SQ-580).
  const frozen = new Map(SURFACE.entries.map((entry) => [entry.id, entry]));
  for (const [trigger, ids] of reads) {
    for (const id of ids) {
      const entry = frozen.get(id);
      assert.ok(entry !== undefined, `${trigger} cites ${id}, which 02 §7 does not freeze`);
      // …and doc 11's own row for that trigger names the same item, so the client is not
      // reading a frozen surface that answers a different question.
      const row = TRIGGER_TABLE.find((candidate) => candidate.trigger === trigger);
      assert.ok(row !== undefined, trigger);
      assert.ok(
        row.item.includes(`${entry.pallet}.${entry.item}`),
        `${trigger} reads ${id}; doc 11 names ${row.item}`,
      );
    }
  }
  // The reverse direction, restricted to `Pallet.Item` pairs that really are frozen storage:
  // an item doc 11 names for a trigger and the client does not read is a check that never
  // runs. (`WelfareView.reserve_flag` and `PhaseFlags bit 5` are filtered out by this — the
  // first is a view field and the second is written without a pallet, deliberately.)
  for (const row of TRIGGER_TABLE) {
    const named = [...row.item.matchAll(/`?([A-Z]\w*)\.([A-Z]\w*)/g)]
      .map(([, pallet, item]) => SURFACE.entries.find((e) => e.pallet === pallet && e.item === item))
      .filter((entry): entry is SurfaceManifest['entries'][number] => entry !== undefined)
      .map((entry) => entry.id);
    assert.deepEqual(
      [...new Set(named)].sort(),
      [...(reads.get(row.trigger) ?? [])].sort(),
      `${row.trigger}: doc 11 names a frozen item the client does not read`,
    );
  }

  // `DepegMedian` maps to the EMPTY list, and that is the answer rather than an omission.
  assert.deepEqual(reads.get('DepegMedian'), [], 'a read was invented for the depeg trigger');
  const depeg = TRIGGER_TABLE.find((row) => row.trigger === 'DepegMedian');
  assert.ok(depeg !== undefined, 'doc 11 dropped the `DepegMedian` row');
  assert.equal(depeg.playbook, 'PB-DEPEG');
  assert.match(depeg.item, /\*\*None — and that is the answer\.\*\*/);
  assert.match(depeg.item, /unavailable in v1/);
  // The half a client gets wrong by being helpful: a monitoring observation is not a source.
  assert.match(depeg.item, /MUST NOT offer a monitoring-derived observation in its place/);
  // …and the client says so in its own words rather than rendering it as merely inactive.
  const unavailable = declarationOf(txSource('guardian.ts'), 'TriggerState');
  assert.match(unavailable, /'unavailable'/, '`TriggerState` lost the arm `DepegMedian` needs');
  // `unavailable` is distinct from `inactive` and from `unread`: one will not become true,
  // one is being measured and does not hold, one is a retry.
  assert.deepEqual(
    [...unavailable.matchAll(/kind: '([a-z]+)'/g)].map((match) => match[1]).sort(),
    ['active', 'inactive', 'unavailable', 'unread'],
  );
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
      inputs: PROPOSE({ power: 'suspend_on_gate', gate: gateReading() }),
      session: readySession('O-4'), onPropose: noSubmit,
    }),
  );
  assert.match(empty, /This power takes no arguments/);
  const playbook = renderToStaticMarkup(
    h(ProposeAction, { inputs: PROPOSE(), session: readySession('O-4'), onPropose: noSubmit }),
  );
  for (const field of POWER_FIELDS.activate_playbook) {
    assert.ok(playbook.includes(field), `${field} must be on the activate_playbook form`);
  }
});

test('the propose form refuses a missing justification', () => {
  // `propose_action(power, justification_hash)` — the hash is an argument, and the pending
  // list resolves the document behind it, so proposing without one asks six other guardians
  // to approve something with no stated reason.
  assert.deepEqual(
    proposalBlocks({
      proposal: { power: 'suspend_on_gate', gate: gateReading() },
      justificationHash: undefined,
    }).map((block) => block.check),
    ['Justification'],
  );
});

test('the cohort-target rule keys on the PLAYBOOK, and it is now unbreakable (contract v29)', () => {
  // **The 2026-08-07 check keyed on `trigger !== 'VoidInFlight'`, and that was wrong in both
  // directions.** `VoidInFlight` is `PB-HALT-INTAKE`'s trigger (11 §11.8.2's table: "any
  // latched cohort is a VOID in flight"), so the old rule *admitted* a target on the one
  // playbook that must not carry one — where `guardian_core` answers `BadPlaybookTarget`
  // after five approvals have been collected. And `PB-ORACLE-VOID`'s trigger is
  // `OracleDeadlock`, so the old rule *refused* the only lawful VOID activation there is.
  //
  // The rule is no longer checked at all, because `target` is derived from the reading's own
  // subject: `OracleDeadlock` is the only subject carrying a cohort, and `PB-ORACLE-VOID` is
  // the only playbook admitting `OracleDeadlock`. What follows is the enumeration proving
  // the derivation agrees with the runtime on every admissible pair, plus the one refusal
  // that remains — the pairing itself.
  for (const [id, triggers] of Object.entries(PLAYBOOK_TRIGGERS) as [PlaybookId, readonly PlaybookTrigger[]][]) {
    for (const trigger of triggers) {
      const call = guardianCall(ACTIVATION({ id, trigger: active(trigger, 7) }));
      if (call.power !== 'activate_playbook') return assert.fail('the call lost its power');
      assert.equal(
        call.target !== undefined,
        id === 'PB-ORACLE-VOID',
        `${id}/${trigger} builds a call the chain answers BadPlaybookTarget`,
      );
      // Two lawful pairings are still refused, each by a different release-fixed control and
      // neither by the pairing itself: `TRIGGER_READS.DepegMedian` is empty, so no read can
      // have established `PB-DEPEG`; and `PB-MIGRATION`'s admissible call set is empty, so its
      // fifth approval reverts the whole extrinsic (06 §6.2, both).
      assert.deepEqual(
        proposalBlocks(PROPOSE(ACTIVATION({ id, trigger: active(trigger, 7) }))).map((b) => b.check),
        RELEASE_REFUSED_PLAYBOOKS.has(id) ? ['Trigger condition'] : [],
      );
    }
  }
  // And the VOID activation cannot be built without its cohort at all: the `OracleDeadlock`
  // subject has no arm without one (`tests/firewall/fixtures/oracle-deadlock-read-without-
  // its-cohort.ts`), so "a VOID that could act on any cohort" has nowhere to live.
  const call = guardianCall(ACTIVATION({ id: 'PB-ORACLE-VOID', trigger: active('OracleDeadlock', 7) }));
  assert.equal(call.power === 'activate_playbook' ? call.target : undefined, 7);
});

test('a playbook is refused under a trigger it does not accept — BadPlaybookTrigger', () => {
  // The chain checks this **after** five approvals have been collected, so a client holding
  // the trigger enum and not the map walks a council through five signatures on a refusal.
  const propose = (id: PlaybookId, trigger: PlaybookTrigger) =>
    proposalBlocks(PROPOSE(ACTIVATION({ id, trigger: active(trigger, 7) })));
  const accepted = new Map<PlaybookId, Set<PlaybookTrigger>>();
  for (const [id, trigger] of DOC_PLAYBOOK_TRIGGERS) {
    const set = accepted.get(id) ?? new Set<PlaybookTrigger>();
    set.add(trigger);
    accepted.set(id, set);
  }
  for (const [id, triggers] of accepted) {
    for (const trigger of DOC_TRIGGERS) {
      const blocks = propose(id, trigger).map((block) => block.check);
      if (triggers.has(trigger)) {
        // Two lawful pairings are refused by a release-fixed control rather than by the
        // pairing: `PB-DEPEG`/`DepegMedian` because the variant has no read at all, and
        // `PB-MIGRATION`/`MigrationHalt` because the playbook's admissible call set is empty
        // and its fifth approval reverts the whole extrinsic (06 §6.2, both).
        assert.deepEqual(
          blocks,
          RELEASE_REFUSED_PLAYBOOKS.has(id) ? ['Trigger condition'] : [],
          `${id} refused its own trigger ${trigger}`,
        );
      } else {
        // `DepegMedian` and `MigrationHalt` each carry a second, independent refusal wherever
        // they appear, and the two are reported together because they have different fixes.
        assert.deepEqual(
          blocks,
          RELEASE_REFUSED_TRIGGERS.has(trigger) ? ['Trigger condition', 'Trigger'] : ['Trigger'],
          `${id} accepted the foreign trigger ${trigger}`,
        );
      }
    }
  }
  // Anti-vacuity: the loop above must actually have exercised both arms.
  assert.equal(accepted.size, 6, 'the playbook set is not the six 06 §6.2 registers');
  assert.equal(DOC_TRIGGERS.length, 8, 'the trigger set is not `guardian_core`’s eight');
  // And the refusal names both sides, so a guardian can tell which half to change.
  assert.match(nth(propose('PB-RESERVE', 'GateBreach'), 0, 'block').detail, /PB-RESERVE is not activated by the GateBreach condition/);
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
