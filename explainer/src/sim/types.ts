import type { DecisionTrace } from '../protocol/decide';
import type { TransitionId } from '../protocol/lifecycle';
import type {
  Branch,
  FilingState,
  MarketKind,
  MarketPhase,
  ProposalClass,
  ProposalState,
  RatificationStatus,
  RejectReason,
  SettlePath,
  VaultState,
} from '../protocol/types';
import type { SceneId, ScenarioId } from '../state/store';
import type { Citation } from '../protocol/citations';

/**
 * The simulated world.
 *
 * Everything here is invented to make the mechanism concrete, and the UI labels
 * it as such. What is *not* invented is the arithmetic: prices, hurdles,
 * payouts, welfare and the decision trace all come from the certified protocol
 * core, so the numbers move the way the chain would move them.
 */

export interface SimFlags {
  /** Relay-parent gap or an overdue snapshot: the queue and clock freeze. */
  deadManEngaged: boolean;
  /** PB-LEDGER-FREEZE. */
  ledgerFrozen: boolean;
  migrationHalt: boolean;
  gateBreachS: boolean;
  gateBreachC: boolean;
  /** PB-RESERVE: split inflows halted and NAV renders with a haircut. */
  reserveImpaired: boolean;
  intakePaused: boolean;
}

export interface BookState {
  readonly kind: MarketKind;
  /** LMSR liquidity parameter, in whole USDC. */
  b: number;
  qLong: number;
  qShort: number;
  /** Latest quote. */
  spot: number;
  /** Decision-window (72 h) TWAP. */
  twap: number;
  /** Trailing (24 h) TWAP. */
  trailingTwap: number;
  coveragePct: number;
  staleEvents: number;
  contestCapital: number;
  phase: MarketPhase;
  /** True once the book has been reaped and can no longer be quoted. */
  reaped: boolean;
}

export interface ProposalSim {
  id: number;
  cls: ProposalClass;
  title: string;
  /** Treasury ask in whole USDC; 0 for non-treasury classes. */
  ask: number;
  envelope: number | undefined;
  bond: number;
  state: ProposalState;
  rejectReason: RejectReason | null;
  extended: boolean;
  rerun: boolean;
  decideAt: number;
  maturity: number | null;
  graceEnd: number | null;
  ratification: RatificationStatus;
  /** Which transitions have fired, and when. */
  history: { id: TransitionId; block: number }[];
}

export interface OracleSim {
  /** MetricId under dispute. */
  component: number;
  componentName: string;
  /** 0 = nothing open. */
  round: number;
  reporterValue: number | null;
  challengerValue: number | null;
  /** Round bond in whole USDC; doubles each round. */
  bond: number;
  cumulativeBond: number;
  windowEnd: number;
  acks: number;
  extensionUsed: boolean;
  settledPath: SettlePath | null;
  settledValue: number | null;
  /** Whether this dispute is merit-bonded and touches the frozen spec —
   * the condition under which it holds a *decision* (step 2), not just money. */
  holdsDecision: boolean;
}

export interface RegistrySim {
  kind: 'Incident' | 'Milestone';
  filingId: number;
  severity: 'S1' | 'S2' | 'S3';
  points: number;
  bond: number;
  state: FilingState;
  /** The multiplier this filing would apply to the C pillar if upheld. */
  incidentMultiplier: number;
}

export interface GuardCheck {
  readonly n: number;
  readonly name: string;
  readonly expected: string;
  actual: string;
  ok: boolean;
  readonly cite: Citation;
}

export interface GuardSim {
  queued: boolean;
  checks: GuardCheck[];
  /** 1-based index of the first failing check, or null. */
  blockedAt: number | null;
  blockedReason: RejectReason | 'GraceExpired' | null;
  attempts: number;
}

export interface WelfareSim {
  /** Pillar values on [0,1]. */
  s: number;
  cOnchain: number;
  cAttested: number;
  p: number;
  a: number;
  w: number;
  /** Realised settlement score, once the cohort settles. */
  settlement: number | null;
  gateS: number;
  gateC: number;
}

export interface VaultSim {
  state: VaultState;
  /** Total escrowed USDC (whole units). */
  escrowed: number;
  /** Holdings of the illustrative participant, keyed by position label. */
  holdings: Record<string, number>;
}

export interface LogEntry {
  block: number;
  text: string;
  kind: 'transition' | 'market' | 'oracle' | 'registry' | 'guard' | 'flag' | 'settle';
}

export interface SimState {
  block: number;
  epoch: number;
  epochLength: number;
  blockInEpoch: number;
  proposal: ProposalSim;
  books: BookState[];
  vault: VaultSim;
  oracle: OracleSim;
  registry: RegistrySim;
  guard: GuardSim;
  welfare: WelfareSim;
  flags: SimFlags;
  decision: DecisionTrace | null;
  /** Narration for the current step, shown in the transport bar. */
  narration: string;
  stepTitle: string;
  log: LogEntry[];
  /** Which scenario produced this state, and how far through it we are. */
  scenario: ScenarioId;
  cursor: number;
  stepCount: number;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type SimEvent =
  | { t: 'advanceTo'; block: number }
  | { t: 'transition'; id: TransitionId; reason?: RejectReason }
  | { t: 'seedMarkets' }
  | { t: 'setBook'; kind: MarketKind; patch: Partial<BookState> }
  | { t: 'split'; amount: number }
  | { t: 'buy'; kind: MarketKind; side: 'Long' | 'Short'; amount: number }
  | { t: 'runDecide' }
  | { t: 'setFlag'; flag: keyof SimFlags; value: boolean }
  | { t: 'oracleReport'; component: number; name: string; value: number }
  | { t: 'oracleChallenge'; counterValue: number }
  | { t: 'oracleAck'; count: number }
  | { t: 'oracleEscalate' }
  | { t: 'oracleSettle'; path: SettlePath; value: number }
  | { t: 'oracleHoldsDecision'; value: boolean }
  | { t: 'registryFile'; severity: 'S1' | 'S2' | 'S3'; bond: number }
  | { t: 'registryChallenge' }
  | { t: 'registryResolve'; uphold: boolean }
  | { t: 'guardAttempt' }
  | { t: 'guardSetCheck'; n: number; actual: string; ok: boolean }
  | { t: 'vaultResolve'; winner: Branch }
  | { t: 'vaultVoid' }
  | { t: 'vaultSettleScalar'; winner: Branch; s: number }
  | { t: 'setWelfare'; patch: Partial<WelfareSim> }
  | { t: 'settleCohort'; s: number }
  | { t: 'log'; text: string; kind: LogEntry['kind'] };

export interface ScenarioStep {
  readonly id: string;
  readonly title: string;
  /** One or two plain sentences. What just happened, and why it matters. */
  readonly narrate: string;
  /** The scene that best shows this step. */
  readonly focus: SceneId;
  readonly cite?: readonly Citation[];
  readonly events: readonly SimEvent[];
}

export interface Scenario {
  readonly id: ScenarioId;
  readonly title: string;
  /** The question this scenario answers. */
  readonly premise: string;
  readonly cite: readonly Citation[];
  readonly steps: readonly ScenarioStep[];
  /** Asserted in tests, so narration cannot drift from the engine. */
  readonly expect: {
    readonly finalState: ProposalState;
    readonly rejectReason?: RejectReason;
    readonly stoppedAt?: number;
  };
}
