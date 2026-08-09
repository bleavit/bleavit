/**
 * The treasury arithmetic the decision rule depends on — doc 08 §5.2–§5.5.
 *
 * Only the part step 9 of `decide()` consumes lives here: how deep the market
 * actually is, what it would cost to move it for a whole decision window, and
 * how large a prize the proposal puts inside that window.
 *
 * The security question is blunt: *could someone profitably buy this decision?*
 * The rule says no adoption unless the cost of holding a manipulated price for
 * the full decision window is at least three times the prize on offer.
 */

import { cite } from './citations';
import { BLOCKS_PER_DAY, SECURITY_FACTOR } from './constants';
import type { ProposalClass } from './types';

export const SIZING_CITATION = cite('05', '§5.6', 'security sizing, 3·InCapPrize ≤ AttackCost̂');
export const LN2 = Math.LN2;

/** Round to µUSDC. Direction is chosen per quantity, never globally. */
const MICRO = 1_000_000;
const floorMicro = (x: number): number => Math.floor(x * MICRO) / MICRO;
const ceilMicro = (x: number): number => Math.ceil(x * MICRO - 1e-9) / MICRO;

/** Seeded headroom for one book: the LMSR's worst-case maker loss. */
export function polCommitment(b: number): number {
  return b * LN2;
}

/**
 * The shallower of the two decision books binds. A manipulator only has to move
 * the cheaper side, so security is measured at the thin one.
 */
export function decisionPairContestCapital(accept: number, reject: number): number {
  return Math.min(accept, reject);
}

/**
 * Measured depth `L̂` — protocol-owned liquidity plus the contest capital that
 * actually showed up, but never more than `sec.flow_cap` multiples of the
 * seeded liquidity.
 *
 * The ceiling exists because contest capital is a *measurement*, and an
 * unbounded measurement is an unbounded claim about safety. Capping it at a
 * multiple of what the protocol itself put up keeps the security estimate tied
 * to something the protocol controls.
 */
export function lHat(
  polDepth: number,
  pairContest: number,
  flowCap: number,
  bAccept: number,
  bReject: number,
): number {
  const ceiling = flowCap * (bAccept + bReject);
  return polDepth + Math.min(pairContest, ceiling);
}

export interface AttackCostOptions {
  /** Published daily arbitrage capital `F̂_pub`, once it has been measured. */
  publishedFlowPerDay?: number | undefined;
  /** `dec.window` in blocks. */
  decisionWindow?: number;
}

/**
 * `AttackCost̂ = F̂ · T_dec`, rounded **down** — the estimate must never flatter
 * itself.
 *
 * `F̂ = min(L̂/2, F̂_pub)` per day. Until `F̂_pub` is measured in Phases 3–4, the
 * `L̂/2` term stands alone, and that is an *assumption*, not a measurement: doc
 * 05 §5.6 is explicit that `AttackCost̂` must not be presented as a measured
 * quantity today.
 */
export function attackCostHat(
  measuredLiquidity: number,
  opts: AttackCostOptions = {},
): number {
  const decisionWindow = opts.decisionWindow ?? 43_200;
  const days = decisionWindow / BLOCKS_PER_DAY;
  const perDay =
    opts.publishedFlowPerDay === undefined
      ? measuredLiquidity / 2
      : Math.min(measuredLiquidity / 2, opts.publishedFlowPerDay);
  return floorMicro(perDay * days);
}

export interface PrizeInputs {
  readonly ask?: number | undefined;
  /** Certified capability-envelope value. Required for PARAM, CODE and META. */
  readonly envelope?: number | undefined;
  readonly spendableNav?: number | undefined;
  readonly capProposal?: number;
  /** CODE/META only: whether the payload is a runtime upgrade (doc 08 §5.2). */
  readonly upgradePayload?: boolean;
}

/**
 * `InCapPrize` — the value a successful capture could extract, rounded **up**.
 *
 * Returns `null` when the class has no defined proxy. That is deliberate and
 * load-bearing: doc 05 §5.6 says an undefined prize proxy MUST NOT pass, so the
 * caller must reject rather than substitute a default. A UI must render this as
 * *unavailable*, never as zero.
 *
 * **A noted discrepancy.** Doc 05 §5.6's prose describes the PARAM prize as the
 * certified capability-envelope value *floored at `sec.prize.param`*. The
 * executable reference model applies no such floor — it returns the envelope,
 * rounded up — and the vector corpus agrees with the model: the `rate_limited`
 * row passes an envelope of 0 through sizing and is rejected at step 10, which
 * a 50,000 USDC floor would make impossible. This implementation follows the
 * corpus, because the corpus is what the chain's own differential suites
 * replay. The `sec.prize.*` rows remain a floor on the *registry parameter*,
 * which is a different thing from a floor inside this function.
 */
export function inCapPrize(
  proposalClass: ProposalClass,
  inputs: PrizeInputs = {},
): number | null {
  const {
    ask = 0,
    envelope,
    spendableNav = 0,
    capProposal = 0.05,
    upgradePayload = true,
  } = inputs;

  if (proposalClass === 'Treasury') return ceilMicro(ask);

  // Every remaining class needs a certified envelope. Absent means no proxy at
  // all — not a zero prize.
  if (envelope === undefined) return null;
  if (proposalClass === 'Param') return ceilMicro(envelope);
  if (proposalClass === 'Constitutional') return null; // carries no markets

  // CODE and META. The NAV floor is conditional on the payload being a runtime
  // upgrade; a caller signals "not an upgrade" with `spendableNav = 0`, which
  // zeroes it. That is the convention the published Phase-0 calibration was run
  // under, and making the floor unconditional would silently disagree with that
  // evidence and with every conforming runtime.
  const floor = upgradePayload ? capProposal * spendableNav : 0;
  return ceilMicro(Math.max(ask, envelope, floor));
}

/** `3 · InCapPrize ≤ AttackCost̂`. The factor 3 is a kernel floor. */
export function securitySizingOk(prize: number, attackCost: number): boolean {
  return SECURITY_FACTOR * prize <= attackCost;
}

/**
 * `ManipFloor̂` — a finer lower bound on manipulation cost.
 *
 * Emitted as a diagnostic and **never gating in v1**. `AttackCost̂` is an *upper*
 * bound on manipulation bleed; this is the lower one. Showing both is honest;
 * gating on this one is not yet supported by evidence.
 */
export function manipFloorHat(
  displacementCost: number,
  holdingCost: number,
): number {
  return floorMicro(displacementCost + holdingCost);
}

/**
 * The NAV a class must hold before it may seed its books at all (doc 08 §4.1).
 *
 * These are frozen constants, not quantities to re-derive at read time. They do
 * not share one rounding convention, and doc 08 §4.1 makes the literals
 * themselves normative for exactly that reason.
 *
 * `Constitutional` runs no markets, so it is outside the doc 08 table's closed
 * list. The treasury still answers for it, defensively, with META's floor — the
 * strictest of the four — rather than leaving the lookup undefined.
 */
export const CLASS_NAV_FLOOR_USDC: Readonly<Record<string, number>> = Object.freeze({
  Param: 4_620_989,
  Treasury: 7_393_600,
  Code: 13_862_944,
  Meta: 21_256_533,
  Constitutional: 21_256_533,
});
