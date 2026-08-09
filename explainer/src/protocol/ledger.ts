/**
 * The conditional ledger — escrow, dual minting, and redemption (doc 03).
 *
 * The whole system rests on one identity. `split` does not halve value, it
 * doubles worlds: paying `a` USDC into a vault mints `a` ACCEPT-USDC *and*
 * `a` REJECT-USDC, both to the same caller. Only one world will ever pay, so
 * the escrow is never over-committed, and because every mint is dual there is
 * no cross-branch counter that can underflow (doc 03 §6.1, B-4).
 *
 * Everything downstream — the LMSR books, the decision rule, the VOID
 * schedule — is bookkeeping on top of the per-branch conservation identity
 *
 *     E = usdc_b + Q_b + G_{b,Survival} + G_{b,Security}   for EACH b        (L-1)
 *
 * Rounding is always against the claimant (doc 03 §7 R-1). That is not a
 * detail: it is the reason `Σ payouts ≤ E` survives arbitrary fragmentation of
 * holdings across accounts (doc 03 §6.3, finding B-5).
 *
 * This module models the vault (`VaultInfo` supplies + `PositionTotals`), not
 * the per-account `Positions` double map. Conservation is stated over supplies,
 * so that is the level at which it can be checked.
 */

import { cite } from './citations';
import type { Citation } from './citations';
import { MIN_SPLIT_USDC, MIN_TRANSFER_USDC } from './constants';
import { FIXED_SCALE, roundPayoutDown } from './units';
import { param } from './params';
import { BRANCHES, GATE_TYPES, POSITION_KINDS, SCALAR_SIDES } from './types';
import type {
  Branch,
  GateType,
  PositionId,
  PositionKind,
  ScalarSide,
  VaultState,
} from './types';

/** Every citation in this module lands in doc 03; this keeps the rows short. */
const L = (at: string, note?: string): Citation => cite('03', at, note);

// ---------------------------------------------------------------------------
// Position identity
// ---------------------------------------------------------------------------

/**
 * The 14 instruments of a proposal vault: 2 branches x 7 kinds (doc 03 §2.1).
 *
 * Fourteen, not two, because every branch carries a decision-scalar pair and
 * two gate pairs on top of its branch-USDC. Gate instruments exist for every
 * vault even when the class does not trade them (finding B-2).
 */
export function proposalPositions(proposal: number): PositionId[] {
  return BRANCHES.flatMap((branch) =>
    POSITION_KINDS.map(
      (kind): PositionId => ({ scope: 'Proposal', proposal, branch, kind }),
    ),
  );
}

/**
 * The 2 instruments of an epoch Baseline vault (doc 03 §2.1, finding B-3).
 *
 * Baseline is unconditional — collateralized in USDC directly, with no branch
 * layer — so it has no branch-USDC and no gates.
 */
export function baselinePositions(epoch: number): PositionId[] {
  return SCALAR_SIDES.map((side): PositionId => ({ scope: 'Baseline', epoch, side }));
}

/**
 * A stable string key for a `PositionId` (doc 03 §4).
 *
 * On-chain the `Positions` double map is keyed `(PositionId, AccountId)` in
 * that order so per-vault reaping drains a prefix; this key preserves the same
 * grouping, vault first.
 */
export function positionKey(id: PositionId): string {
  if (id.scope === 'Baseline') return `B/${id.epoch}/${id.side}`;
  const k = id.kind;
  const kind =
    k.kind === 'GateYes' || k.kind === 'GateNo' ? `${k.kind}:${k.gate}` : k.kind;
  return `P/${id.proposal}/${id.branch}/${kind}`;
}

// ---------------------------------------------------------------------------
// Payout primitives
// ---------------------------------------------------------------------------

/**
 * The settlement score as the chain stores it: an integer on the 1e9 grid.
 *
 * Rounds rather than floors, because `s` is *always* a `FixedU64` — the double
 * we are handed is an approximation of a grid point, not an arbitrary real, and
 * flooring an approximation from below picks the wrong grid point. Returns
 * `null` for anything outside [0,1] (`InvalidScore`, doc 03 §5.2).
 */
function scoreRaw(s: number): number | null {
  if (!Number.isFinite(s) || s < 0 || s > 1) return null;
  return Math.round(s * FIXED_SCALE);
}

/**
 * `floor(amount · raw / 1e9)` computed exactly.
 *
 * The chain uses u256 intermediates (doc 03 §5.3). A double loses precision
 * past 2^53 and escrow balances reach that scale, so the product is taken in
 * BigInt — an off-by-one here is an off-by-one in someone's payout.
 */
function floorScaled(amount: number, raw: number): number {
  return Number((BigInt(amount) * BigInt(raw)) / BigInt(FIXED_SCALE));
}

/**
 * Unpaired scalar-leg payout at settlement score `s` (doc 03 §5.3, §6.3).
 *
 * LONG pays `floor(a·s)`, SHORT pays `floor(a·(1−s))` — note SHORT is *not*
 * `a − floor(a·s)`. That superseded rule rounded in the claimant's favour and
 * was insolvent by one base unit under fragmentation (finding B-5): at
 * `s = 0.70005` and `E = 20,000`, one 20,000 LONG plus two 10,000 SHORTs drew
 * 20,001 from 20,000 of escrow.
 *
 * An `s` outside [0,1] pays 0 here; the vault path raises `InvalidScore`, which
 * is where that condition belongs.
 */
export function scalarPayout(s: number, side: ScalarSide, amount: number): number {
  const raw = scoreRaw(s);
  if (raw === null || !Number.isSafeInteger(amount) || amount < 0) return 0;
  return side === 'Long'
    ? floorScaled(amount, raw)
    : floorScaled(amount, FIXED_SCALE - raw);
}

/**
 * A complete LONG+SHORT set pays exactly `a` (doc 03 §5.3 `redeem_scalar_pair`).
 *
 * Redeeming the two legs separately floors twice and can lose a base unit;
 * the atomic pair call exists precisely so no complete-set holder pays for the
 * escrow-favouring rounding that protects the fragmented case.
 */
export function scalarPairPayout(amount: number): number {
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : 0;
}

/**
 * Baseline redemption at epoch settlement score `s_e` (doc 03 §5.3, §6.3).
 *
 * Identical arithmetic to the proposal scalar legs — a separate export because
 * the Baseline vault is a different escrow (`E_base`) with its own state
 * machine, and conflating them is how a UI ends up reading a proposal's `s`
 * against the epoch's collateral.
 */
export function baselinePayout(s: number, side: ScalarSide, amount: number): number {
  return scalarPayout(s, side, amount);
}

/**
 * VOID payout for an unpaired holding (doc 03 §5.3, §6.4; decision D-1).
 *
 * Branch-USDC is worth ½ and every scalar or gate leg ¼ — not a haircut, but
 * the correct price of a binary claim whose question will never be answered.
 * Pairing beats redeeming: a cross-branch branch-USDC pair merges at par, which
 * is the only 100 % path out of a voided vault.
 */
export function redeemVoidPayout(kind: PositionKind, amount: number): number {
  if (!Number.isSafeInteger(amount) || amount < 0) return 0;
  return kind.kind === 'BranchUsdc'
    ? roundPayoutDown(amount / 2)
    : roundPayoutDown(amount / 4);
}

// ---------------------------------------------------------------------------
// The redemption fee (doc 03 §5.3a, milestone E1)
// ---------------------------------------------------------------------------

/**
 * `ledger.redeem_fee`, as parts per billion. Doc 13 §1 seeds it at 30 bps.
 *
 * Read from the registry rather than restated, for the reason doc 13 rule 1
 * exists: this app may not carry a second copy of a governed number.
 */
export const DEFAULT_REDEEM_FEE_PPB = param('ledger.rdm_fee').raw;

/**
 * The fee on a gross settlement payout (doc 03 §5.3a(2)).
 *
 * Two properties are load-bearing and neither is obvious:
 *
 *  - **It rounds up, against the claimant.** Same direction as every other
 *    charge in the system (R-1): the protocol never rounds in its own disfavour.
 *  - **The small-payout waiver tests the NET, not the gross.** A gross-based
 *    test does not do the job it exists for. `ledger.min_split` and USDC's own
 *    `min_balance` are both 10,000 base units, so a gross of exactly 10,000
 *    clears a gross-based waiver, is charged 30, and nets 9,970 — below
 *    `min_balance`, which is the exact failure the waiver exists to prevent.
 *    Testing the net covers the whole band by construction.
 */
export function redemptionFee(gross: number, ratePpb: number = DEFAULT_REDEEM_FEE_PPB): number {
  if (!Number.isSafeInteger(gross) || gross <= 0) return 0;
  if (!Number.isFinite(ratePpb) || ratePpb <= 0) return 0;
  const charged = Math.ceil((gross * ratePpb) / FIXED_SCALE);
  if (charged >= gross) return 0;
  return gross - charged < MIN_SPLIT_USDC ? 0 : charged;
}

/**
 * The fee on a complete-set pair call (doc 03 §5.3a(2a)).
 *
 * Deliberately **not** `redemptionFee(a)`. The pair pays exactly `a` gross, but
 * its fee is the sum of what the two legs would each pay, so that the pair path
 * can never cost more than redeeming the same holdings leg by leg.
 *
 * The witness for why the simpler form is wrong is in the spec and worth
 * keeping: at `a = 20,000`, `s = 0.70005` and 30 bps, `redemptionFee(20,000)` is
 * 60 and nets 19,940, while leg-by-leg pays 43 on the LONG leg and nothing on
 * the SHORT leg (its own waiver exempts it) and nets 19,957. Charging the
 * combined base would make holding a complete set the worse strategy, which
 * inverts the whole reason the atomic call exists.
 */
export function pairRedemptionFee(
  amount: number,
  s: number,
  ratePpb: number = DEFAULT_REDEEM_FEE_PPB,
): number {
  const long = scalarPayout(s, 'Long', amount);
  const short = scalarPayout(s, 'Short', amount);
  return redemptionFee(long, ratePpb) + redemptionFee(short, ratePpb);
}

/**
 * What `amount` units of `kind` pay in `state`, on the redeemable branch.
 *
 * Returns 0 wherever no unpaired redemption exists — which is a legality fact,
 * not a valuation: `Resolved` bars unpaired redemption deliberately (doc 03
 * §2.3, §6.4), because VOID is reachable *from* `Resolved` and paying par
 * before that fork would leave the losing branch's undiminished claim mass
 * against reduced escrow. Ask `legalCallsFor` what the UI may offer; ask this
 * what the offer is worth. `gateOutcome` is the `settle_gate` breach flag for
 * the holder's gate; without it a gate leg is `GateNotSettled` and pays 0.
 */
export function redeemPayout(
  state: VaultState,
  kind: PositionKind,
  amount: number,
  gateOutcome?: boolean,
): number {
  if (!Number.isSafeInteger(amount) || amount < 0) return 0;
  if (state.kind === 'Open' || state.kind === 'Resolved') return 0;
  if (state.kind === 'Voided') return redeemVoidPayout(kind, amount);
  if (state.kind === 'BaselineSettled') {
    // The Baseline vault has no branch layer, so only the scalar legs exist.
    if (kind.kind === 'Long') return baselinePayout(state.s, 'Long', amount);
    if (kind.kind === 'Short') return baselinePayout(state.s, 'Short', amount);
    return 0;
  }
  switch (kind.kind) {
    case 'BranchUsdc':
      return amount;
    case 'Long':
      return scalarPayout(state.s, 'Long', amount);
    case 'Short':
      return scalarPayout(state.s, 'Short', amount);
    case 'GateYes':
      return gateOutcome === true ? amount : 0;
    case 'GateNo':
      return gateOutcome === false ? amount : 0;
  }
}

// ---------------------------------------------------------------------------
// The legal call surface
// ---------------------------------------------------------------------------

/** The Signed-origin ledger calls of doc 03 §5.1 and §5.3, in spec spelling. */
export const LEDGER_CALLS = [
  'split',
  'merge',
  'split_scalar',
  'merge_scalar',
  'split_gate',
  'merge_gate',
  'transfer',
  'split_baseline',
  'merge_baseline',
  'redeem',
  'redeem_scalar',
  'redeem_scalar_pair',
  'redeem_gate',
  'redeem_void',
  'redeem_baseline',
  'redeem_baseline_pair',
] as const;
export type LedgerCall = (typeof LEDGER_CALLS)[number];

/**
 * Which Signed calls a vault in `state` admits (doc 03 §5.1, §5.3; I-27).
 *
 * The authority transitions — `resolve`, `void`, `settle_*` — are deliberately
 * absent: no user can invoke them, so no UI may offer them.
 *
 * Two entries repay attention. `transfer` is legal under `Voided` (so
 * counterparties can assemble the pairs that recover par) but *not* under
 * `ScalarSettled`, where the redemption calls subsume it. And the `Voided` row
 * is exactly the five calls invariant I-27 permits — anything else in a voided
 * vault is a defect.
 */
export function legalCallsFor(state: VaultState): LedgerCall[] {
  switch (state.kind) {
    case 'Open':
      return [
        'split',
        'merge',
        'split_scalar',
        'merge_scalar',
        'split_gate',
        'merge_gate',
        'transfer',
      ];
    case 'Resolved':
      return ['merge', 'merge_scalar', 'merge_gate', 'transfer'];
    case 'ScalarSettled':
      return ['redeem', 'redeem_scalar', 'redeem_scalar_pair', 'redeem_gate'];
    case 'Voided':
      return ['merge', 'merge_scalar', 'merge_gate', 'transfer', 'redeem_void'];
    case 'BaselineSettled':
      return ['redeem_baseline', 'redeem_baseline_pair'];
  }
}

// ---------------------------------------------------------------------------
// The redemption matrix, as data
// ---------------------------------------------------------------------------

/** Settlement facts a matrix row may need. VOID rows ignore both. */
export interface RedemptionContext {
  /** Settlement score `s`, a real on the 1e9 grid. */
  readonly s: number;
  /** Whether the holder's gate side matches the recorded breach outcome. */
  readonly gateWins: boolean;
}

export interface RedemptionRow {
  readonly state: VaultState['kind'];
  /** The holding, in the words a holder would use. */
  readonly holding: string;
  /** The call that realises it, or `null` where no payout path exists. */
  readonly call: LedgerCall | null;
  readonly rule: string;
  /** The **gross** payout. Charged rows pay this less the §5.3a fee. */
  readonly payout: (amount: number, ctx: RedemptionContext) => number;
  readonly cite: Citation;
}

/**
 * The five calls the doc 03 §5.3a redemption fee reaches.
 *
 * Everything else is exempt, and the exemptions are the interesting part: the
 * par leg (`redeem`), the failure path (`redeem_void`) and every `merge*` are
 * all untouched. The rule a reader can carry away is that **settlement payouts
 * are charged and getting your own money back is not**.
 */
export const FEE_CHARGED_CALLS: readonly LedgerCall[] = Object.freeze([
  'redeem_scalar',
  'redeem_scalar_pair',
  'redeem_gate',
  'redeem_baseline',
  'redeem_baseline_pair',
]);

/** Whether a call is charged the doc 03 §5.3a redemption fee. */
export function isFeeCharged(call: LedgerCall | null): boolean {
  return call !== null && FEE_CHARGED_CALLS.includes(call);
}

/**
 * Vault state x holding x call -> payout rule (doc 03 §5.1, §5.3, §6.4).
 *
 * Data, not prose, so the rendered table and the tests cannot drift apart. The
 * `null`-call rows are the load-bearing ones: they record where the protocol
 * deliberately pays nothing, which is exactly where a reader assumes it must
 * pay something.
 */
export const REDEMPTION_MATRIX: readonly RedemptionRow[] = Object.freeze([
  {
    state: 'Open',
    holding: 'Accept + Reject branch-USDC pair',
    call: 'merge',
    rule: 'par — 1 USDC per pair',
    payout: (a: number) => a,
    cite: L('§5.1'),
  },
  {
    state: 'Open',
    holding: 'same-branch LONG + SHORT set',
    call: 'merge_scalar',
    rule: 'no USDC; mints 1 same-branch branch-USDC',
    payout: () => 0,
    cite: L('§5.1'),
  },
  {
    state: 'Open',
    holding: 'same-branch gate YES + NO set',
    call: 'merge_gate',
    rule: 'no USDC; mints 1 same-branch branch-USDC',
    payout: () => 0,
    cite: L('§5.1'),
  },
  {
    state: 'Open',
    holding: 'any unpaired instrument',
    call: null,
    rule: 'no redemption before a terminal state',
    payout: () => 0,
    cite: L('§2.3', 'outflow monotonicity'),
  },
  {
    state: 'Resolved',
    holding: 'Accept + Reject branch-USDC pair',
    call: 'merge',
    rule: 'par — the D-1 primary recovery path, VOID-safe',
    payout: (a: number) => a,
    cite: L('§5.1'),
  },
  {
    state: 'Resolved',
    holding: 'same-branch scalar or gate set',
    call: 'merge_scalar',
    rule: 'value-neutral; climbs back to branch-USDC',
    payout: () => 0,
    cite: L('§5.1'),
  },
  {
    state: 'Resolved',
    holding: 'unpaired winning branch-USDC',
    call: null,
    rule: 'barred until ScalarSettled — VOID is reachable from here',
    payout: () => 0,
    cite: L('§6.4'),
  },
  {
    state: 'Resolved',
    holding: 'any losing-branch instrument',
    call: null,
    rule: 'frozen, not burned',
    payout: () => 0,
    cite: L('§5.2'),
  },
  {
    state: 'ScalarSettled',
    holding: 'winning branch-USDC',
    call: 'redeem',
    rule: '1:1',
    payout: (a: number) => a,
    cite: L('§5.3'),
  },
  {
    state: 'ScalarSettled',
    holding: 'winning-branch LONG',
    call: 'redeem_scalar',
    rule: 'floor(a·s)',
    payout: (a: number, ctx: RedemptionContext) => scalarPayout(ctx.s, 'Long', a),
    cite: L('§5.3'),
  },
  {
    state: 'ScalarSettled',
    holding: 'winning-branch SHORT',
    call: 'redeem_scalar',
    rule: 'floor(a·(1−s))',
    payout: (a: number, ctx: RedemptionContext) => scalarPayout(ctx.s, 'Short', a),
    cite: L('§6.3', 'B-5'),
  },
  {
    state: 'ScalarSettled',
    holding: 'winning-branch LONG + SHORT pair',
    call: 'redeem_scalar_pair',
    rule: 'exactly a — no double flooring',
    payout: (a: number) => scalarPairPayout(a),
    cite: L('§5.3'),
  },
  {
    state: 'ScalarSettled',
    holding: 'winning gate side of the winning branch',
    call: 'redeem_gate',
    rule: '1:1 if the side matches the breach outcome, else 0',
    payout: (a: number, ctx: RedemptionContext) => (ctx.gateWins ? a : 0),
    cite: L('§5.3'),
  },
  {
    state: 'ScalarSettled',
    holding: 'any losing-branch instrument',
    call: null,
    rule: 'frozen; reap-only',
    payout: () => 0,
    cite: L('§5.2'),
  },
  {
    state: 'Voided',
    holding: 'Accept + Reject branch-USDC pair',
    call: 'merge',
    rule: 'par — the only 100 % path out of a voided vault',
    payout: (a: number) => a,
    cite: L('§6.4', 'B-1'),
  },
  {
    state: 'Voided',
    holding: 'same-branch LONG + SHORT set',
    call: 'merge_scalar',
    rule: 'no USDC; mints 1 same-branch branch-USDC, worth ½ until paired',
    payout: () => 0,
    cite: L('§6.4'),
  },
  {
    state: 'Voided',
    holding: 'same-branch gate YES + NO set',
    call: 'merge_gate',
    rule: 'no USDC; mints 1 same-branch branch-USDC, worth ½ until paired',
    payout: () => 0,
    cite: L('§6.4'),
  },
  {
    state: 'Voided',
    holding: 'unpaired branch-USDC',
    call: 'redeem_void',
    rule: 'floor(a/2)',
    payout: (a: number) => redeemVoidPayout({ kind: 'BranchUsdc' }, a),
    cite: L('§5.3', 'D-1'),
  },
  {
    state: 'Voided',
    holding: 'unpaired LONG / SHORT / gate YES / gate NO',
    call: 'redeem_void',
    rule: 'floor(a/4)',
    payout: (a: number) => redeemVoidPayout({ kind: 'Long' }, a),
    cite: L('§5.3', 'D-1'),
  },
  {
    state: 'BaselineSettled',
    holding: 'B-LONG',
    call: 'redeem_baseline',
    rule: 'floor(a·s)',
    payout: (a: number, ctx: RedemptionContext) => baselinePayout(ctx.s, 'Long', a),
    cite: L('§5.3'),
  },
  {
    state: 'BaselineSettled',
    holding: 'B-SHORT',
    call: 'redeem_baseline',
    rule: 'floor(a·(1−s))',
    payout: (a: number, ctx: RedemptionContext) => baselinePayout(ctx.s, 'Short', a),
    cite: L('§5.3'),
  },
  {
    state: 'BaselineSettled',
    holding: 'B-LONG + B-SHORT pair',
    call: 'redeem_baseline_pair',
    rule: 'exactly a',
    payout: (a: number) => scalarPairPayout(a),
    cite: L('§5.3'),
  },
]);

// ---------------------------------------------------------------------------
// The vault
// ---------------------------------------------------------------------------

/**
 * Doc 03 §8's exact ordered pallet error metadata. Reproduced in order because
 * SCALE indices are positional: a UI that decodes by index needs the order, and
 * the five superseded names it omits (`VaultNotOpen`, `AlreadyResolved`,
 * `AlreadyVoided`, `NotResolved`, `NotSettled`) must never reappear.
 */
export const LEDGER_ERRORS = [
  'BadOrigin',
  'UnknownVault',
  'UnknownBaselineVault',
  'WrongVaultState',
  'BelowMinimum',
  'ArithmeticOverflow',
  'InsufficientPosition',
  'TooManyPositions',
  'InvalidScore',
  'GateAlreadySettled',
  'GateNotSettled',
  'TryStateViolation',
  'ReapNotDue',
  'DepositFailed',
  'SplitPaused',
  'Frozen',
  'FreezeOutOfBounds',
  'FreezeRenewalExhausted',
  'InflowCapExceeded',
  'ProtocolDestination',
] as const;
export type LedgerErrorName = (typeof LEDGER_ERRORS)[number];

/**
 * Per-branch supplies (doc 03 §2.2).
 *
 * `usdc`/`scalarSets`/`gateSets` are the stored `BranchSupply`; the four leg
 * counts mirror `PositionTotals`. They are equal by L-4 while `Open`, and
 * diverge once terminal redemption burns legs asymmetrically — which is why
 * both are tracked rather than derived.
 */
export interface BranchSupply {
  /** `usdc_b` — outstanding branch-USDC. */
  readonly usdc: number;
  /** `Q_b` — complete LONG/SHORT sets outstanding. */
  readonly scalarSets: number;
  /** `G_{b,g}` — complete YES/NO sets outstanding, per gate. */
  readonly gateSets: Readonly<Record<GateType, number>>;
  readonly long: number;
  readonly short: number;
  readonly gateYes: Readonly<Record<GateType, number>>;
  readonly gateNo: Readonly<Record<GateType, number>>;
}

export interface Vault {
  readonly proposal: number;
  /** `E` — USDC base units held in escrow for this vault. */
  readonly escrowed: number;
  readonly state: VaultState;
  readonly branches: Readonly<Record<Branch, BranchSupply>>;
  /** Winning-branch breach outcomes [Survival, Security]; `null` = unset. */
  readonly gateOutcomes: Readonly<Record<GateType, boolean | null>>;
  /** Everything ever split in — the denominator of the solvency claim. */
  readonly collateralIn: number;
  /** Everything ever paid out. `paidOut + escrowed === collateralIn` always. */
  readonly paidOut: number;
  /**
   * How many terminal redemptions have fired. L-1 is stated over the
   * pre-redemption bookkeeping (doc 03 §9); after the first asymmetric burn the
   * per-branch identity is replaced by the L-3 valuation bound.
   */
  readonly terminalRedemptions: number;
}

/** A minted or burned quantity of one instrument. */
export interface PositionDelta {
  readonly position: PositionId;
  readonly amount: number;
}

/** What a call did, in the terms the UI animates. */
export interface LedgerEffect {
  readonly call: LedgerCall | 'resolve' | 'void' | 'settle_scalar' | 'settle_gate';
  /** USDC base units the caller pays into escrow. */
  readonly escrowIn: number;
  /**
   * USDC base units the caller actually receives — **net of the doc 03 §5.3a
   * redemption fee** where one is charged.
   *
   * This is the headline number, and it is the net rather than the gross for a
   * blunt reason: it is what lands in the claimant's account, and a screen that
   * shows the gross has told them they will get money they will not get.
   */
  readonly payout: number;
  /**
   * What escrow released, before the fee. Escrow falls by this amount; the
   * difference between it and `payout` is retained as protocol revenue rather
   * than staying in the vault, so conservation is unaffected.
   *
   * Equal to `payout` on every exempt call, which is most of them.
   */
  readonly grossPayout: number;
  /** The doc 03 §5.3a fee withheld. Zero on every exempt call. */
  readonly fee: number;
  readonly minted: readonly PositionDelta[];
  readonly burned: readonly PositionDelta[];
  readonly note: string;
  readonly cite: Citation;
}

export type LedgerResult =
  | { readonly ok: true; readonly vault: Vault; readonly effect: LedgerEffect }
  | { readonly ok: false; readonly error: LedgerErrorName; readonly why: string };

const ZERO_GATES: Readonly<Record<GateType, number>> = Object.freeze({
  Survival: 0,
  Security: 0,
});

function emptySupply(): BranchSupply {
  return {
    usdc: 0,
    scalarSets: 0,
    gateSets: ZERO_GATES,
    long: 0,
    short: 0,
    gateYes: ZERO_GATES,
    gateNo: ZERO_GATES,
  };
}

/** A fresh `Open` proposal vault (doc 03 §5.5 `create_vault`). */
export function createVault(proposal: number): Vault {
  return {
    proposal,
    escrowed: 0,
    state: { kind: 'Open' },
    branches: { Accept: emptySupply(), Reject: emptySupply() },
    gateOutcomes: { Survival: null, Security: null },
    collateralIn: 0,
    paidOut: 0,
    terminalRedemptions: 0,
  };
}

function fail(error: LedgerErrorName, why: string): LedgerResult {
  return { ok: false, error, why };
}

function setGateValue(
  map: Readonly<Record<GateType, number>>,
  gate: GateType,
  value: number,
): Record<GateType, number> {
  return gate === 'Survival'
    ? { Survival: value, Security: map.Security }
    : { Survival: map.Survival, Security: value };
}

function withBranch(vault: Vault, branch: Branch, next: BranchSupply): Vault {
  return {
    ...vault,
    branches:
      branch === 'Accept'
        ? { Accept: next, Reject: vault.branches.Reject }
        : { Accept: vault.branches.Accept, Reject: next },
  };
}

function badAmount(amount: number): boolean {
  return !Number.isSafeInteger(amount) || amount < 0;
}

function supplyOf(supply: BranchSupply, kind: PositionKind): number {
  switch (kind.kind) {
    case 'BranchUsdc':
      return supply.usdc;
    case 'Long':
      return supply.long;
    case 'Short':
      return supply.short;
    case 'GateYes':
      return supply.gateYes[kind.gate];
    case 'GateNo':
      return supply.gateNo[kind.gate];
  }
}

function burnLeg(supply: BranchSupply, kind: PositionKind, amount: number): BranchSupply {
  switch (kind.kind) {
    case 'BranchUsdc':
      return { ...supply, usdc: supply.usdc - amount };
    case 'Long':
      return { ...supply, long: supply.long - amount };
    case 'Short':
      return { ...supply, short: supply.short - amount };
    case 'GateYes':
      return {
        ...supply,
        gateYes: setGateValue(supply.gateYes, kind.gate, supply.gateYes[kind.gate] - amount),
      };
    case 'GateNo':
      return {
        ...supply,
        gateNo: setGateValue(supply.gateNo, kind.gate, supply.gateNo[kind.gate] - amount),
      };
  }
}

const at = (vault: Vault, branch: Branch, kind: PositionKind): PositionId => ({
  scope: 'Proposal',
  proposal: vault.proposal,
  branch,
  kind,
});

/** States that admit balanced pair operations (doc 03 §5.1). */
function admitsPairOps(state: VaultState): boolean {
  return state.kind === 'Open' || state.kind === 'Resolved' || state.kind === 'Voided';
}

// --- Minting and merging ---------------------------------------------------

/**
 * `split(pid, a)` — pay `a` USDC in, receive `a` ACCEPT-USDC **and** `a`
 * REJECT-USDC (doc 03 §5.1, §6).
 *
 * The dual mint is the whole trick. Both branches gain `a`, so L-1 holds on
 * both sides simultaneously and neither can be drained ahead of the other.
 */
export function split(vault: Vault, amount: number): LedgerResult {
  if (vault.state.kind !== 'Open') {
    return fail('WrongVaultState', `split requires Open, vault is ${vault.state.kind}`);
  }
  if (badAmount(amount)) return fail('BelowMinimum', 'amount must be a non-negative integer');
  if (amount < MIN_SPLIT_USDC) {
    return fail('BelowMinimum', `split is below MinSplit (${MIN_SPLIT_USDC} base units)`);
  }
  let next: Vault = {
    ...vault,
    escrowed: vault.escrowed + amount,
    collateralIn: vault.collateralIn + amount,
  };
  for (const branch of BRANCHES) {
    const supply = next.branches[branch];
    next = withBranch(next, branch, { ...supply, usdc: supply.usdc + amount });
  }
  return {
    ok: true,
    vault: next,
    effect: {
      call: 'split',
      escrowIn: amount,
      payout: 0,
      grossPayout: 0,
      fee: 0,
      minted: BRANCHES.map((b) => ({
        position: at(vault, b, { kind: 'BranchUsdc' }),
        amount,
      })),
      burned: [],
      note: 'dual mint: one branch-USDC per world, not a half share of one',
      cite: L('§5.1'),
    },
  };
}

/**
 * `merge(pid, a)` — burn a cross-branch pair, recover `a` USDC at par
 * (doc 03 §5.1).
 *
 * Available in `Open`, `Resolved` *and* `Voided`: a complete Accept+Reject pair
 * is worth exactly one USDC under every valuation, so it can never be the call
 * that breaks solvency. This is the D-1 primary recovery path.
 */
export function merge(vault: Vault, amount: number): LedgerResult {
  if (!admitsPairOps(vault.state)) {
    return fail('WrongVaultState', `merge is barred in ${vault.state.kind}`);
  }
  if (badAmount(amount)) return fail('BelowMinimum', 'amount must be a non-negative integer');
  for (const branch of BRANCHES) {
    if (vault.branches[branch].usdc < amount) {
      return fail('InsufficientPosition', `${branch} branch-USDC supply below ${amount}`);
    }
  }
  let next: Vault = {
    ...vault,
    escrowed: vault.escrowed - amount,
    paidOut: vault.paidOut + amount,
  };
  for (const branch of BRANCHES) {
    const supply = next.branches[branch];
    next = withBranch(next, branch, { ...supply, usdc: supply.usdc - amount });
  }
  return {
    ok: true,
    vault: next,
    effect: {
      call: 'merge',
      escrowIn: 0,
      // Exempt: every `merge*` is what makes a complete set worth exactly one
      // unit. A fee here would open a spread around par and break the
      // arbitrage-free structure the whole market construction rests on.
      payout: amount,
      grossPayout: amount,
      fee: 0,
      minted: [],
      burned: BRANCHES.map((b) => ({
        position: at(vault, b, { kind: 'BranchUsdc' }),
        amount,
      })),
      note: 'par recovery — the only 100 % path in a voided vault',
      cite: L('§6.4'),
    },
  };
}

/**
 * `split_scalar(pid, b, a)` — turn `a` branch-USDC into `a` LONG_b + `a` SHORT_b
 * (doc 03 §5.1, §6).
 *
 * Value moves *within* one branch: `usdc_b −= a; Q_b += a`. L-1 is untouched,
 * which is why the POL seeding flow of §6.2 cannot underflow however large the
 * decision-book seed is relative to the gate seeds.
 */
export function splitScalar(vault: Vault, branch: Branch, amount: number): LedgerResult {
  if (vault.state.kind !== 'Open') {
    return fail('WrongVaultState', `split_scalar requires Open, vault is ${vault.state.kind}`);
  }
  if (badAmount(amount)) return fail('BelowMinimum', 'amount must be a non-negative integer');
  // The minimum binds here because this call *creates* position entries, and it
  // is checked after the state test so a terminal vault still refuses with
  // `WrongVaultState`. Market-authority movements are exempt and exact by
  // construction; this models the Signed path a person takes.
  if (amount < MIN_SPLIT_USDC) {
    return fail('BelowMinimum', `split is below MinSplit (${MIN_SPLIT_USDC} base units)`);
  }
  const supply = vault.branches[branch];
  if (supply.usdc < amount) {
    return fail('InsufficientPosition', `${branch} branch-USDC supply below ${amount}`);
  }
  const next = withBranch(vault, branch, {
    ...supply,
    usdc: supply.usdc - amount,
    scalarSets: supply.scalarSets + amount,
    long: supply.long + amount,
    short: supply.short + amount,
  });
  return {
    ok: true,
    vault: next,
    effect: {
      call: 'split_scalar',
      escrowIn: 0,
      payout: 0,
      grossPayout: 0,
      fee: 0,
      minted: [
        { position: at(vault, branch, { kind: 'Long' }), amount },
        { position: at(vault, branch, { kind: 'Short' }), amount },
      ],
      burned: [{ position: at(vault, branch, { kind: 'BranchUsdc' }), amount }],
      note: 'intra-branch: usdc_b -= a, Q_b += a',
      cite: L('§6'),
    },
  };
}

/**
 * `merge_scalar(pid, b, a)` — burn a same-branch LONG+SHORT set back to `a`
 * branch-USDC (doc 03 §5.1, §6.4).
 *
 * Pays no USDC in any state, including `Voided`: the set is worth one
 * *branch*-USDC, which under VOID is worth ½ until it finds its opposite-branch
 * counterpart. Conflating the two ledger layers is how "annulment refunds
 * everyone" got over-claimed (SQ-171).
 */
export function mergeScalar(vault: Vault, branch: Branch, amount: number): LedgerResult {
  if (!admitsPairOps(vault.state)) {
    return fail('WrongVaultState', `merge_scalar is barred in ${vault.state.kind}`);
  }
  if (badAmount(amount)) return fail('BelowMinimum', 'amount must be a non-negative integer');
  const supply = vault.branches[branch];
  if (supply.long < amount || supply.short < amount || supply.scalarSets < amount) {
    return fail('InsufficientPosition', `${branch} lacks a complete set of ${amount}`);
  }
  const next = withBranch(vault, branch, {
    ...supply,
    usdc: supply.usdc + amount,
    scalarSets: supply.scalarSets - amount,
    long: supply.long - amount,
    short: supply.short - amount,
  });
  return {
    ok: true,
    vault: next,
    effect: {
      call: 'merge_scalar',
      escrowIn: 0,
      payout: 0,
      grossPayout: 0,
      fee: 0,
      minted: [{ position: at(vault, branch, { kind: 'BranchUsdc' }), amount }],
      burned: [
        { position: at(vault, branch, { kind: 'Long' }), amount },
        { position: at(vault, branch, { kind: 'Short' }), amount },
      ],
      note: 'value-neutral; no USDC leaves escrow',
      cite: L('§6.4'),
    },
  };
}

/**
 * `split_gate(pid, b, g, a)` — turn `a` branch-USDC into `a` GateYes(g)_b +
 * `a` GateNo(g)_b (doc 03 §5.1; finding B-2).
 *
 * Gate instruments exist in every vault. The ledger does not restrict gate
 * splitting by proposal class: a gate set is fully collateralized regardless,
 * and class policy is doc 04's problem, not the escrow's.
 */
export function splitGate(
  vault: Vault,
  branch: Branch,
  gate: GateType,
  amount: number,
): LedgerResult {
  if (vault.state.kind !== 'Open') {
    return fail('WrongVaultState', `split_gate requires Open, vault is ${vault.state.kind}`);
  }
  if (badAmount(amount)) return fail('BelowMinimum', 'amount must be a non-negative integer');
  // Same floor, same reason, same ordering as `splitScalar` — see the note there.
  if (amount < MIN_SPLIT_USDC) {
    return fail('BelowMinimum', `split is below MinSplit (${MIN_SPLIT_USDC} base units)`);
  }
  const supply = vault.branches[branch];
  if (supply.usdc < amount) {
    return fail('InsufficientPosition', `${branch} branch-USDC supply below ${amount}`);
  }
  const next = withBranch(vault, branch, {
    ...supply,
    usdc: supply.usdc - amount,
    gateSets: setGateValue(supply.gateSets, gate, supply.gateSets[gate] + amount),
    gateYes: setGateValue(supply.gateYes, gate, supply.gateYes[gate] + amount),
    gateNo: setGateValue(supply.gateNo, gate, supply.gateNo[gate] + amount),
  });
  return {
    ok: true,
    vault: next,
    effect: {
      call: 'split_gate',
      escrowIn: 0,
      payout: 0,
      grossPayout: 0,
      fee: 0,
      minted: [
        { position: at(vault, branch, { kind: 'GateYes', gate }), amount },
        { position: at(vault, branch, { kind: 'GateNo', gate }), amount },
      ],
      burned: [{ position: at(vault, branch, { kind: 'BranchUsdc' }), amount }],
      note: 'intra-branch: usdc_b -= a, G_{b,g} += a',
      cite: L('§6'),
    },
  };
}

/** `merge_gate(pid, b, g, a)` — the inverse of {@link splitGate} (doc 03 §5.1). */
export function mergeGate(
  vault: Vault,
  branch: Branch,
  gate: GateType,
  amount: number,
): LedgerResult {
  if (!admitsPairOps(vault.state)) {
    return fail('WrongVaultState', `merge_gate is barred in ${vault.state.kind}`);
  }
  if (badAmount(amount)) return fail('BelowMinimum', 'amount must be a non-negative integer');
  const supply = vault.branches[branch];
  if (
    supply.gateYes[gate] < amount ||
    supply.gateNo[gate] < amount ||
    supply.gateSets[gate] < amount
  ) {
    return fail('InsufficientPosition', `${branch}/${gate} lacks a complete set of ${amount}`);
  }
  const next = withBranch(vault, branch, {
    ...supply,
    usdc: supply.usdc + amount,
    gateSets: setGateValue(supply.gateSets, gate, supply.gateSets[gate] - amount),
    gateYes: setGateValue(supply.gateYes, gate, supply.gateYes[gate] - amount),
    gateNo: setGateValue(supply.gateNo, gate, supply.gateNo[gate] - amount),
  });
  return {
    ok: true,
    vault: next,
    effect: {
      call: 'merge_gate',
      escrowIn: 0,
      payout: 0,
      grossPayout: 0,
      fee: 0,
      minted: [{ position: at(vault, branch, { kind: 'BranchUsdc' }), amount }],
      burned: [
        { position: at(vault, branch, { kind: 'GateYes', gate }), amount },
        { position: at(vault, branch, { kind: 'GateNo', gate }), amount },
      ],
      note: 'value-neutral; no USDC leaves escrow',
      cite: L('§6.4'),
    },
  };
}

/**
 * `transfer(position_id, to, a)` — move a holding between accounts
 * (doc 03 §5.1, §7 R-2).
 *
 * Escrow-neutral, so the vault is returned unchanged; what this checks is
 * legality. It stays available under `Voided` on purpose — without it,
 * counterparties could not assemble the cross-branch pairs that recover par.
 * It is *not* available under `ScalarSettled`, where redemption subsumes it.
 */
export function transfer(vault: Vault, position: PositionId, amount: number): LedgerResult {
  if (!admitsPairOps(vault.state)) {
    return fail('WrongVaultState', `transfer is barred in ${vault.state.kind}`);
  }
  if (position.scope !== 'Proposal' || position.proposal !== vault.proposal) {
    return fail('UnknownVault', 'position does not belong to this vault');
  }
  if (badAmount(amount)) return fail('BelowMinimum', 'amount must be a non-negative integer');
  if (amount < MIN_TRANSFER_USDC) {
    return fail('BelowMinimum', `transfer is below MinTransfer (${MIN_TRANSFER_USDC})`);
  }
  if (supplyOf(vault.branches[position.branch], position.kind) < amount) {
    return fail('InsufficientPosition', `supply below ${amount}`);
  }
  return {
    ok: true,
    vault,
    effect: {
      call: 'transfer',
      escrowIn: 0,
      payout: 0,
      grossPayout: 0,
      fee: 0,
      minted: [],
      burned: [],
      note: 'escrow-neutral; changes who holds the claim, not what it is worth',
      cite: L('§5.1'),
    },
  };
}

/**
 * Doc 03 §7 R-2: a transfer that would leave the sender below `MinTransfer`
 * moves the whole balance instead.
 *
 * Dust entries are not free — each `Positions` row costs a 0.1 USDC deposit and
 * one of 64 per-account slots — so leaving un-transferable crumbs behind is the
 * position-cap-dusting attack, not a rounding nicety.
 */
export function applyTransferRemainderRule(balance: number, requested: number): number {
  if (badAmount(balance) || badAmount(requested) || requested > balance) return 0;
  const remainder = balance - requested;
  return remainder > 0 && remainder < MIN_TRANSFER_USDC ? balance : requested;
}

// --- Authority transitions -------------------------------------------------

/**
 * `resolve(pid, w)` — `Open -> Resolved(w)` (doc 03 §5.2; I-3, D-8).
 *
 * Losing-branch positions are frozen, not burned. Burning them would look
 * tidier and would be wrong: VOID is still reachable from `Resolved`, and a
 * voided vault owes those holders the D-1 neutral valuation.
 */
export function resolve(vault: Vault, winner: Branch): LedgerResult {
  if (vault.state.kind !== 'Open') {
    return fail('WrongVaultState', `resolve requires Open, vault is ${vault.state.kind}`);
  }
  return {
    ok: true,
    vault: { ...vault, state: { kind: 'Resolved', winner } },
    effect: {
      call: 'resolve',
      escrowIn: 0,
      payout: 0,
      grossPayout: 0,
      fee: 0,
      minted: [],
      burned: [],
      note: `${winner} wins; losing-branch claims frozen, not burned`,
      cite: L('§5.2'),
    },
  };
}

/**
 * `void(pid)` — `Open | Resolved -> Voided` (doc 03 §5.2, §6.4; D-1, X-6).
 *
 * Barred from `ScalarSettled`: redemptions at `s` may already have paid out, so
 * a retroactive VOID would revalue claims that no longer exist. Barred from
 * `Voided` too — it is terminal (SQ-165).
 */
export function voidVault(vault: Vault): LedgerResult {
  if (vault.state.kind !== 'Open' && vault.state.kind !== 'Resolved') {
    return fail('WrongVaultState', `void is barred in ${vault.state.kind}`);
  }
  return {
    ok: true,
    vault: { ...vault, state: { kind: 'Voided' } },
    effect: {
      call: 'void',
      escrowIn: 0,
      payout: 0,
      grossPayout: 0,
      fee: 0,
      minted: [],
      burned: [],
      note: 'all positions unfrozen; branch-USDC now values at ½, every leg at ¼',
      cite: L('§6.4'),
    },
  };
}

/**
 * `settle_scalar(pid, s)` — `Resolved(w) -> ScalarSettled{w, s}`
 * (doc 03 §5.2).
 *
 * `s` must lie in [0,1] on the 1e9 grid; anything else is `InvalidScore`. The
 * winner is carried into the terminal state because `redeem`/`redeem_scalar`
 * derive the branch themselves — no caller names a branch, which is why no
 * wrong-branch error exists (SQ-170).
 */
export function settleScalar(vault: Vault, s: number): LedgerResult {
  if (vault.state.kind !== 'Resolved') {
    return fail('WrongVaultState', `settle_scalar requires Resolved, vault is ${vault.state.kind}`);
  }
  if (scoreRaw(s) === null) return fail('InvalidScore', 's must be in [0,1]');
  return {
    ok: true,
    vault: { ...vault, state: { kind: 'ScalarSettled', winner: vault.state.winner, s } },
    effect: {
      call: 'settle_scalar',
      escrowIn: 0,
      payout: 0,
      grossPayout: 0,
      fee: 0,
      minted: [],
      burned: [],
      note: `settlement score fixed at ${s}`,
      cite: L('§5.2'),
    },
  };
}

/**
 * `settle_gate(pid, g, outcome)` — record the winning branch's breach flag
 * (doc 03 §5.2).
 *
 * Legal from `Resolved` *and* `ScalarSettled`: the two settle calls ride the
 * same e+3 transaction and the spec fixes no order between them. Once set, an
 * outcome cannot be overwritten (`GateAlreadySettled`).
 */
export function settleGate(vault: Vault, gate: GateType, outcome: boolean): LedgerResult {
  if (vault.state.kind !== 'Resolved' && vault.state.kind !== 'ScalarSettled') {
    return fail('WrongVaultState', `settle_gate is barred in ${vault.state.kind}`);
  }
  if (vault.gateOutcomes[gate] !== null) {
    return fail('GateAlreadySettled', `${gate} outcome already recorded`);
  }
  return {
    ok: true,
    vault: {
      ...vault,
      gateOutcomes:
        gate === 'Survival'
          ? { Survival: outcome, Security: vault.gateOutcomes.Security }
          : { Survival: vault.gateOutcomes.Survival, Security: outcome },
    },
    effect: {
      call: 'settle_gate',
      escrowIn: 0,
      payout: 0,
      grossPayout: 0,
      fee: 0,
      minted: [],
      burned: [],
      note: `${gate} breach = ${outcome}; the matching side pays 1, the other 0`,
      cite: L('§5.2'),
    },
  };
}

// --- Redemption ------------------------------------------------------------

function payout(vault: Vault, amount: number): Vault {
  return {
    ...vault,
    escrowed: vault.escrowed - amount,
    paidOut: vault.paidOut + amount,
    terminalRedemptions: vault.terminalRedemptions + 1,
  };
}

/** `redeem(pid, a)` — winning branch-USDC pays 1:1 (doc 03 §5.3). */
export function redeem(vault: Vault, amount: number): LedgerResult {
  if (vault.state.kind !== 'ScalarSettled') {
    return fail('WrongVaultState', `redeem requires ScalarSettled, vault is ${vault.state.kind}`);
  }
  if (badAmount(amount)) return fail('BelowMinimum', 'amount must be a non-negative integer');
  const branch = vault.state.winner;
  const supply = vault.branches[branch];
  if (supply.usdc < amount) return fail('InsufficientPosition', `supply below ${amount}`);
  const next = withBranch(payout(vault, amount), branch, {
    ...supply,
    usdc: supply.usdc - amount,
  });
  return {
    ok: true,
    vault: next,
    effect: {
      call: 'redeem',
      escrowIn: 0,
      // Exempt, and this is the most consequential exemption in the schedule.
      // This is the par leg — the mirror credit every wrapper buy leaves with
      // the buyer — and the system's central promise is that a buyer on the
      // losing branch gets their money back "losing only fees". Charging here
      // would make the most common path lose fees *and* a slice of principal.
      payout: amount,
      grossPayout: amount,
      fee: 0,
      minted: [],
      burned: [{ position: at(vault, branch, { kind: 'BranchUsdc' }), amount }],
      note: 'winning-branch par',
      cite: L('§5.3'),
    },
  };
}

/**
 * `redeem_scalar(pid, kind, a)` — an unpaired winning-branch leg
 * (doc 03 §5.3, §6.3).
 */
export function redeemScalar(vault: Vault, side: ScalarSide, amount: number): LedgerResult {
  if (vault.state.kind !== 'ScalarSettled') {
    return fail('WrongVaultState', `redeem_scalar requires ScalarSettled, vault is ${vault.state.kind}`);
  }
  if (badAmount(amount)) return fail('BelowMinimum', 'amount must be a non-negative integer');
  const branch = vault.state.winner;
  const supply = vault.branches[branch];
  const held = side === 'Long' ? supply.long : supply.short;
  if (held < amount) return fail('InsufficientPosition', `supply below ${amount}`);
  const paid = scalarPayout(vault.state.s, side, amount);
  const next = withBranch(
    payout(vault, paid),
    branch,
    side === 'Long'
      ? { ...supply, long: supply.long - amount }
      : { ...supply, short: supply.short - amount },
  );
  return {
    ok: true,
    vault: next,
    effect: {
      call: 'redeem_scalar',
      escrowIn: 0,
      payout: paid - redemptionFee(paid),
      grossPayout: paid,
      fee: redemptionFee(paid),
      minted: [],
      burned: [{ position: at(vault, branch, { kind: side }), amount }],
      note: side === 'Long' ? 'floor(a·s), less the redemption fee' : 'floor(a·(1−s)), less the redemption fee',
      cite: L('§6.3'),
    },
  };
}

/**
 * `redeem_scalar_pair(pid, a)` — a complete winning-branch set pays exactly `a`
 * (doc 03 §5.3, §6.3).
 *
 * This call exists so the escrow-favouring floor never costs a complete-set
 * holder anything: leg-by-leg it would pay `floor(a·s) + floor(a·(1−s))`, which
 * is `a − 1` whenever neither product is integral.
 */
export function redeemScalarPair(vault: Vault, amount: number): LedgerResult {
  if (vault.state.kind !== 'ScalarSettled') {
    return fail(
      'WrongVaultState',
      `redeem_scalar_pair requires ScalarSettled, vault is ${vault.state.kind}`,
    );
  }
  if (badAmount(amount)) return fail('BelowMinimum', 'amount must be a non-negative integer');
  const branch = vault.state.winner;
  const supply = vault.branches[branch];
  if (supply.long < amount || supply.short < amount || supply.scalarSets < amount) {
    return fail('InsufficientPosition', `no complete set of ${amount}`);
  }
  const next = withBranch(payout(vault, amount), branch, {
    ...supply,
    long: supply.long - amount,
    short: supply.short - amount,
    scalarSets: supply.scalarSets - amount,
  });
  return {
    ok: true,
    vault: next,
    effect: {
      call: 'redeem_scalar_pair',
      escrowIn: 0,
      payout: amount - pairRedemptionFee(amount, vault.state.s),
      grossPayout: amount,
      fee: pairRedemptionFee(amount, vault.state.s),
      minted: [],
      burned: [
        { position: at(vault, branch, { kind: 'Long' }), amount },
        { position: at(vault, branch, { kind: 'Short' }), amount },
      ],
      note: 'exactly a gross — no double flooring — less each leg’s own fee',
      cite: L('§5.3'),
    },
  };
}

/**
 * `redeem_gate(pid, g, a)` — the winning gate side pays 1:1, the other 0
 * (doc 03 §5.3).
 */
export function redeemGate(
  vault: Vault,
  gate: GateType,
  side: 'Yes' | 'No',
  amount: number,
): LedgerResult {
  if (vault.state.kind !== 'ScalarSettled') {
    return fail('WrongVaultState', `redeem_gate requires ScalarSettled, vault is ${vault.state.kind}`);
  }
  const outcome = vault.gateOutcomes[gate];
  if (outcome === null) return fail('GateNotSettled', `${gate} outcome not recorded`);
  if (badAmount(amount)) return fail('BelowMinimum', 'amount must be a non-negative integer');
  const branch = vault.state.winner;
  const supply = vault.branches[branch];
  const kind: PositionKind = side === 'Yes' ? { kind: 'GateYes', gate } : { kind: 'GateNo', gate };
  if (supplyOf(supply, kind) < amount) {
    return fail('InsufficientPosition', `supply below ${amount}`);
  }
  const wins = (side === 'Yes') === outcome;
  const paid = wins ? amount : 0;
  const next = withBranch(payout(vault, paid), branch, burnLeg(supply, kind, amount));
  return {
    ok: true,
    vault: next,
    effect: {
      call: 'redeem_gate',
      escrowIn: 0,
      payout: paid - redemptionFee(paid),
      grossPayout: paid,
      fee: redemptionFee(paid),
      minted: [],
      burned: [{ position: at(vault, branch, kind), amount }],
      note: wins ? 'winning side, 1:1 less the redemption fee' : 'losing side, pays 0',
      cite: L('§5.3'),
    },
  };
}

/**
 * `redeem_void(pid, kind_coords, a)` — the D-1 neutral valuation
 * (doc 03 §5.3, §6.4).
 *
 * Branch-USDC `floor(a/2)`, any leg `floor(a/4)`. Legal from either branch:
 * VOID means the question died, so no branch is losing.
 */
export function redeemVoid(
  vault: Vault,
  branch: Branch,
  kind: PositionKind,
  amount: number,
): LedgerResult {
  if (vault.state.kind !== 'Voided') {
    return fail('WrongVaultState', `redeem_void requires Voided, vault is ${vault.state.kind}`);
  }
  if (badAmount(amount)) return fail('BelowMinimum', 'amount must be a non-negative integer');
  const supply = vault.branches[branch];
  if (supplyOf(supply, kind) < amount) {
    return fail('InsufficientPosition', `supply below ${amount}`);
  }
  const paid = redeemVoidPayout(kind, amount);
  const next = withBranch(payout(vault, paid), branch, burnLeg(supply, kind, amount));
  return {
    ok: true,
    vault: next,
    effect: {
      call: 'redeem_void',
      escrowIn: 0,
      // Exempt. VOID is the protocol failing, and charging users for the
      // protocol's own failure would turn the emergency path into a revenue
      // event.
      payout: paid,
      grossPayout: paid,
      fee: 0,
      minted: [],
      burned: [{ position: at(vault, branch, kind), amount }],
      note: kind.kind === 'BranchUsdc' ? 'floor(a/2)' : 'floor(a/4)',
      cite: L('§6.4'),
    },
  };
}

// ---------------------------------------------------------------------------
// Conservation
// ---------------------------------------------------------------------------

/** `usdc_b + Q_b + G_{b,S} + G_{b,C}` — one side of L-1 (doc 03 §6.1). */
export function branchIdentity(supply: BranchSupply): number {
  return (
    supply.usdc +
    supply.scalarSets +
    supply.gateSets.Survival +
    supply.gateSets.Security
  );
}

/**
 * The largest total any set of holders can still extract (doc 03 §6.5, §9 L-3).
 *
 * Valued **pair-first**, because that is the schedule a rational holder uses and
 * therefore the one solvency must survive: complete sets merge before residuals
 * are floored. Under `ScalarSettled` the pair-first sum is algebraically equal
 * to L-3's un-floored bound (`p·s + p·(1−s) = p`), so this is the same
 * invariant, tightened by the rounding the protocol keeps.
 *
 * An unsettled gate counts its larger side: `settle_gate` fixes a payout
 * parameter inside an already-counted bound, it never raises it.
 */
export function maxClaimValue(vault: Vault): number {
  const { state } = vault;
  if (state.kind === 'Open') {
    return Math.max(...BRANCHES.map((b) => branchIdentity(vault.branches[b])));
  }
  if (state.kind === 'Resolved') {
    return branchIdentity(vault.branches[state.winner]);
  }
  if (state.kind === 'Voided') {
    // Same-branch sets climb to branch-USDC first, then cross-branch pairs
    // merge at par; only what is left over takes the ½ / ¼ floors.
    let leftovers = 0;
    const effective = BRANCHES.map((branch) => {
      const s = vault.branches[branch];
      const scalarPairs = Math.min(s.long, s.short);
      let usdc = s.usdc + scalarPairs;
      leftovers += roundPayoutDown((s.long - scalarPairs) / 4);
      leftovers += roundPayoutDown((s.short - scalarPairs) / 4);
      for (const gate of GATE_TYPES) {
        const gatePairs = Math.min(s.gateYes[gate], s.gateNo[gate]);
        usdc += gatePairs;
        leftovers += roundPayoutDown((s.gateYes[gate] - gatePairs) / 4);
        leftovers += roundPayoutDown((s.gateNo[gate] - gatePairs) / 4);
      }
      return usdc;
    });
    const accept = effective[0] ?? 0;
    const reject = effective[1] ?? 0;
    const cross = Math.min(accept, reject);
    return (
      cross +
      roundPayoutDown((accept - cross) / 2) +
      roundPayoutDown((reject - cross) / 2) +
      leftovers
    );
  }
  if (state.kind === 'ScalarSettled') {
    const supply = vault.branches[state.winner];
    const pairs = Math.min(supply.long, supply.short);
    let total =
      supply.usdc +
      pairs +
      scalarPayout(state.s, 'Long', supply.long - pairs) +
      scalarPayout(state.s, 'Short', supply.short - pairs);
    for (const gate of GATE_TYPES) {
      const outcome = vault.gateOutcomes[gate];
      total +=
        outcome === null
          ? Math.max(supply.gateYes[gate], supply.gateNo[gate])
          : outcome
            ? supply.gateYes[gate]
            : supply.gateNo[gate];
    }
    return total;
  }
  // `BaselineSettled` is a view-only projection; a proposal vault must never
  // hold it (doc 03 §2.3), and try-state rejects one that does.
  return Number.POSITIVE_INFINITY;
}

/**
 * The try-state assertion of doc 03 §9: L-1, L-4 and the L-3 valuation bound.
 *
 * The bound is the whole solvency argument in one line. Under `Voided` it holds
 * because `v(branch-USDC) = ½` and `v(any leg) = ¼`, so
 *
 *     V = Σ_b [ ½·usdc_b + ¼·2Q_b + ¼·2G_{b,S} + ¼·2G_{b,C} ]
 *       = ½ · Σ_b [ usdc_b + Q_b + G_{b,S} + G_{b,C} ]
 *       = ½ · (E + E)   by L-1, which holds at entry to Voided
 *       = E.
 *
 * That identity is why the 2x insolvency class is excluded by construction
 * rather than by a check: the superseded "both branches redeem 1:1" rule made
 * V = 2E, and the first redeemers drained the vault (finding B-1).
 *
 * L-1 itself is asserted only before the first terminal redemption — after one,
 * legs burn asymmetrically and the per-branch identity is meant to break.
 */
export function checkConservation(vault: Vault): boolean {
  if (vault.escrowed < 0 || vault.paidOut < 0) return false;
  if (vault.escrowed + vault.paidOut !== vault.collateralIn) return false;
  if (vault.state.kind === 'BaselineSettled') return false;
  if (vault.terminalRedemptions === 0) {
    for (const branch of BRANCHES) {
      const supply = vault.branches[branch];
      if (branchIdentity(supply) !== vault.escrowed) return false;
      if (supply.long !== supply.short || supply.long !== supply.scalarSets) return false;
      for (const gate of GATE_TYPES) {
        if (supply.gateYes[gate] !== supply.gateNo[gate]) return false;
        if (supply.gateYes[gate] !== supply.gateSets[gate]) return false;
      }
    }
  }
  return maxClaimValue(vault) <= vault.escrowed;
}
