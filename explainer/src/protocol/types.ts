/**
 * The protocol vocabulary.
 *
 * Every name here is the name the chain uses. Doc 02 is a frozen integration
 * contract: SCALE indices and variant names are part of the freeze, so they are
 * reproduced verbatim — including the `MarketKind` naming asymmetry
 * (`DecisionAccept`/`DecisionReject` vs `GateS_Adopt`/`GateS_Reject`), which is
 * frozen as-is and is deliberately not normalised.
 *
 * Mirrors `crates/futarchy-primitives/src/lib.rs`.
 */

// ---------------------------------------------------------------------------
// Proposals
// ---------------------------------------------------------------------------

/** `futarchy_primitives::ProposalClass` (lib.rs:447). */
export const PROPOSAL_CLASSES = ['Param', 'Treasury', 'Code', 'Meta', 'Constitutional'] as const;
export type ProposalClass = (typeof PROPOSAL_CLASSES)[number];

/** Classes that carry the four gate books. `Constitutional` runs the referendum path. */
export const GATE_BEARING_CLASSES = ['Param', 'Treasury', 'Code', 'Meta'] as const;
export type GateBearingClass = (typeof GATE_BEARING_CLASSES)[number];

export function requiresGateMarkets(c: ProposalClass): c is GateBearingClass {
  return c !== 'Constitutional';
}

/** Classes that must be ratified by referendum before `execute` (doc 06, D-5). */
export function requiresRatification(c: ProposalClass): boolean {
  return c === 'Code' || c === 'Meta';
}

/**
 * `futarchy_primitives::RejectReason` (lib.rs:467). SCALE indices are frozen at
 * lib.rs:1651 and are reproduced here because the contract freezes them.
 */
export const REJECT_REASONS = [
  'NotDecisionGrade',
  'GateVetoSurvival',
  'GateVetoSecurity',
  'HurdleNotMet',
  'ConvergenceFailed',
  'SecondExtensionFailed',
  'ProcessHold',
  'ConstitutionViolation',
  'ResourceConflict',
  'RateLimited',
  'VetoUpheldByReview',
  'StaleQueue',
  'PayloadReverted',
  'NotRatified',
  'SecuritySizing',
  'AttestationMissing',
  'RolloverExhausted',
] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];

export const REJECT_REASON_INDEX: Readonly<Record<RejectReason, number>> =
  Object.freeze(
    Object.fromEntries(REJECT_REASONS.map((r, i) => [r, i])) as Record<RejectReason, number>,
  );

/** `futarchy_primitives::ProposalState` (lib.rs:502). */
export const PROPOSAL_STATES = [
  'Submitted',
  'Screening',
  'Qualified',
  'Trading',
  'Extended',
  'Queued',
  'Suspended',
  'Rerun',
  'Rejected',
  'Executed',
  'FailedExecuted',
  'Measuring',
  'Settled',
  'Cancelled',
  'Expired',
] as const;
export type ProposalState = (typeof PROPOSAL_STATES)[number];

/** `futarchy_primitives::DecisionOutcome` (lib.rs:555). */
export type DecisionOutcome =
  | { readonly kind: 'Adopt' }
  | { readonly kind: 'Extend' }
  | { readonly kind: 'Reject'; readonly reason: RejectReason };

export const ADOPT: DecisionOutcome = { kind: 'Adopt' };
export const EXTEND: DecisionOutcome = { kind: 'Extend' };
export const reject = (reason: RejectReason): DecisionOutcome => ({ kind: 'Reject', reason });

/** `futarchy_primitives::RatificationStatus` (lib.rs:590). */
export type RatificationStatus =
  | { readonly kind: 'NotRequired' }
  /** Deliberately agnostic between never-submitted, in-flight and failed (doc 02 §4). */
  | { readonly kind: 'NoPassedRecord' }
  | { readonly kind: 'Passed'; readonly referendum: number };

// ---------------------------------------------------------------------------
// Epoch
// ---------------------------------------------------------------------------

/** `futarchy_primitives::EpochPhase` (lib.rs:532). */
export const EPOCH_PHASES = [
  'Intake',
  'Qualify',
  'Seed',
  'Trade',
  'Decide',
  'Review',
  'Execute',
  'Housekeeping',
] as const;
export type EpochPhase = (typeof EPOCH_PHASES)[number];

/** `epoch_core::CohortStatus` (epoch-core/src/lib.rs:359). */
export type CohortStatus =
  | { readonly kind: 'Measuring'; readonly untilEpoch: number }
  | { readonly kind: 'AwaitingOracle' }
  | { readonly kind: 'Settling'; readonly cursor: number }
  | { readonly kind: 'Settled' }
  | { readonly kind: 'Void' };

// ---------------------------------------------------------------------------
// Markets
// ---------------------------------------------------------------------------

/** `futarchy_primitives::Branch` (lib.rs:332). SCALE: Accept 0, Reject 1. */
export const BRANCHES = ['Accept', 'Reject'] as const;
export type Branch = (typeof BRANCHES)[number];

/** `futarchy_primitives::ScalarSide` (lib.rs:349). */
export const SCALAR_SIDES = ['Long', 'Short'] as const;
export type ScalarSide = (typeof SCALAR_SIDES)[number];

/** `futarchy_primitives::GateType` (lib.rs:366). */
export const GATE_TYPES = ['Survival', 'Security'] as const;
export type GateType = (typeof GATE_TYPES)[number];

/**
 * `futarchy_primitives::MarketKind` (lib.rs:637), SCALE indices at lib.rs:1638.
 * The underscored spelling is load-bearing and frozen by doc 02 §6.
 */
export const MARKET_KINDS = [
  'DecisionAccept',
  'DecisionReject',
  'GateS_Adopt',
  'GateS_Reject',
  'GateC_Adopt',
  'GateC_Reject',
  'Baseline',
] as const;
export type MarketKind = (typeof MARKET_KINDS)[number];

export const MARKET_KIND_INDEX: Readonly<Record<MarketKind, number>> = Object.freeze(
  Object.fromEntries(MARKET_KINDS.map((k, i) => [k, i])) as Record<MarketKind, number>,
);

/** `futarchy_primitives::TradeSide` (lib.rs:608). */
export const TRADE_SIDES = ['BuyLong', 'BuyShort', 'SellLong', 'SellShort'] as const;
export type TradeSide = (typeof TRADE_SIDES)[number];

/** `market_core::MarketPhase` (market-core/src/lib.rs:224). */
export type MarketPhase = 'Trading' | 'Extended' | 'Closed' | 'Settled';

/** `market_core::BookKind` (market-core/src/lib.rs:197). */
export type BookKind =
  | { readonly kind: 'Decision'; readonly proposal: number; readonly branch: Branch }
  | { readonly kind: 'Gate'; readonly proposal: number; readonly branch: Branch; readonly gate: GateType }
  | { readonly kind: 'Baseline'; readonly epoch: number };

// ---------------------------------------------------------------------------
// Conditional ledger
// ---------------------------------------------------------------------------

/** `futarchy_primitives::PositionKind` (lib.rs:383). Seven per branch. */
export type PositionKind =
  | { readonly kind: 'BranchUsdc' }
  | { readonly kind: 'Long' }
  | { readonly kind: 'Short' }
  | { readonly kind: 'GateYes'; readonly gate: GateType }
  | { readonly kind: 'GateNo'; readonly gate: GateType };

export const POSITION_KINDS: readonly PositionKind[] = Object.freeze([
  { kind: 'BranchUsdc' },
  { kind: 'Long' },
  { kind: 'Short' },
  { kind: 'GateYes', gate: 'Survival' },
  { kind: 'GateNo', gate: 'Survival' },
  { kind: 'GateYes', gate: 'Security' },
  { kind: 'GateNo', gate: 'Security' },
]);

/** `futarchy_primitives::PositionId` (lib.rs:403). 14 proposal + 2 baseline. */
export type PositionId =
  | {
      readonly scope: 'Proposal';
      readonly proposal: number;
      readonly branch: Branch;
      readonly kind: PositionKind;
    }
  | { readonly scope: 'Baseline'; readonly epoch: number; readonly side: ScalarSide };

/** `futarchy_primitives::VaultState` (lib.rs:427). */
export type VaultState =
  | { readonly kind: 'Open' }
  | { readonly kind: 'Resolved'; readonly winner: Branch }
  | { readonly kind: 'ScalarSettled'; readonly winner: Branch; readonly s: number }
  | { readonly kind: 'Voided' }
  /** View-only projection of `BaselineState::Settled` — never a proposal vault. */
  | { readonly kind: 'BaselineSettled'; readonly s: number };

/** `conditional_ledger_core::BaselineState` (lib.rs:91). No `Voided` variant. */
export type BaselineState =
  | { readonly kind: 'Open' }
  | { readonly kind: 'Settled'; readonly s: number };

export function positionKindLabel(k: PositionKind): string {
  switch (k.kind) {
    case 'BranchUsdc':
      return 'branch-USDC';
    case 'Long':
      return 'LONG';
    case 'Short':
      return 'SHORT';
    case 'GateYes':
      return `Gate${k.gate === 'Survival' ? 'S' : 'C'} YES`;
    case 'GateNo':
      return `Gate${k.gate === 'Survival' ? 'S' : 'C'} NO`;
  }
}

// ---------------------------------------------------------------------------
// Welfare
// ---------------------------------------------------------------------------

/** `welfare_core::Pillar` (welfare-core/src/lib.rs:168). */
export const PILLARS = ['S', 'COnchain', 'CAttested', 'P', 'A'] as const;
export type Pillar = (typeof PILLARS)[number];

/** `epoch_core::WelfareGrade` (epoch-core/src/lib.rs:397). */
export type WelfareGrade = 'Ok' | 'Insufficient' | 'Invalid';

/** `welfare_core::SourceClass` (welfare-core/src/lib.rs:189). */
export type SourceClass = 'Onchain' | 'RelayDerived' | 'Attested';

// ---------------------------------------------------------------------------
// Oracle and registry
// ---------------------------------------------------------------------------

/** `oracle_core::SettlePath` (oracle-core/src/lib.rs:172). */
export const SETTLE_PATHS = [
  'Unchallenged',
  'Recomputed',
  'Adjudicated',
  'ChallengerDefault',
  'Neutral',
] as const;
export type SettlePath = (typeof SETTLE_PATHS)[number];

/** `oracle_core::BondDisposition` (oracle-core/src/lib.rs:238). */
export type BondDisposition = 'ReporterWins' | 'ChallengerWins' | 'RefundBoth';

/** `registry_core::RegistryKind` (registry-core/src/lib.rs:55). Dual instance. */
export type RegistryKind = 'Incident' | 'Milestone';

/** `registry_core::FilingClass` (registry-core/src/lib.rs:72). */
export type FilingClass =
  | { readonly kind: 'S1' }
  | { readonly kind: 'S2' }
  | { readonly kind: 'S3' }
  | { readonly kind: 'Scope'; readonly points: number };

/** `registry_core::FilingState` (registry-core/src/lib.rs:91). */
export type FilingState =
  | { readonly kind: 'Filed'; readonly windowEnd: number; readonly extended: boolean; readonly acks: number }
  | {
      readonly kind: 'Challenged';
      readonly round: number;
      readonly windowEnd: number;
      readonly challenger: string;
      readonly evidenceHash: string;
    }
  | { readonly kind: 'Upheld' }
  | { readonly kind: 'Rejected' };

// ---------------------------------------------------------------------------
// Guardian playbooks and phase flags
// ---------------------------------------------------------------------------

/** `guardian_core::PlaybookId` (guardian-core/src/lib.rs:86). */
export const PLAYBOOK_IDS = [
  'Depeg',
  'Migration',
  'OracleVoid',
  'HaltIntake',
  'Reserve',
  'LedgerFreeze',
] as const;
export type PlaybookId = (typeof PLAYBOOK_IDS)[number];

/** `guardian_core::PlaybookTrigger` (guardian-core/src/lib.rs:116). */
export const PLAYBOOK_TRIGGERS = [
  'DepegMedian',
  'MigrationHalt',
  'OracleDeadlock',
  'GateBreach',
  'DeadMan',
  'VoidInFlight',
  'ReserveHealth',
  'LedgerDrift',
] as const;
export type PlaybookTrigger = (typeof PLAYBOOK_TRIGGERS)[number];

/** `constitution_core` PhaseFlags bit assignment (constitution-core/src/lib.rs:462). */
export const PHASE_FLAG_BITS = [
  'SHADOW_MODE',
  'PARAM_ARMED',
  'TREASURY_ARMED',
  'CODE_META_ARMED',
  'SUDO_PRESENT',
  'LEDGER_FROZEN',
  'DEAD_MAN_ENGAGED',
  'RESERVE_HEALTH_FLAG',
] as const;
export type PhaseFlag = (typeof PHASE_FLAG_BITS)[number];

export function phaseFlagBit(flag: PhaseFlag): number {
  return 1 << PHASE_FLAG_BITS.indexOf(flag);
}

export function phaseFlagsSet(bits: number): PhaseFlag[] {
  return PHASE_FLAG_BITS.filter((_, i) => (bits & (1 << i)) !== 0);
}
