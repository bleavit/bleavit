/**
 * Units and the fixed-point discipline.
 *
 * The chain has no floating point. Two grids matter here:
 *
 *  - **USDC base units** — 6 decimals, so 1 USDC = 1_000_000 base units
 *    (`futarchy_primitives::currency::USDC`). Ledger payouts are exact integers
 *    on this grid, and the corpus asserts them exactly.
 *  - **`Fixed` = `FixedU64` on the 1e9 grid** — every price, probability, welfare
 *    value and settlement score. Doc 05 §4.4 requires each multiplication to
 *    round *down* to this grid immediately, so the welfare pipeline is a chain of
 *    floors, not a chain of reals.
 *
 * Rounding direction is a solvency property, not a detail (doc 04 §6): every
 * charge rounds up, every payout rounds down. Both directions favour the escrow.
 */

import { cite } from './citations';

/** 1 USDC in base units. `futarchy_primitives::currency::USDC`. */
export const USDC = 1_000_000;
/** 0.01 USDC — the ledger's minimum split/transfer. */
export const USDC_CENT = 10_000;
/** VIT carries 12 decimals. Used for bonds, never for market collateral. */
export const VIT = 1_000_000_000_000;

/** The `FixedU64` scale: values are integers `x` representing `x / 1e9`. */
export const FIXED_SCALE = 1_000_000_000;

export const UNIT_CITATION = cite(
  '13',
  '§0',
  'USDC 6 decimals, VIT 12 decimals, Fixed = FixedU64 on the 1e9 grid',
);

/**
 * Floor a real onto the 1e9 grid and return the real it represents.
 *
 * This is the workhorse of the welfare pipeline: doc 05 §4.4 mandates flooring
 * after each step, so results drift deliberately downward rather than rounding
 * to nearest. Reproducing that is what lets this implementation agree with the
 * reference corpus instead of merely coming close.
 */
export function floorFixed(x: number): number {
  return fromFixed1e9(toFixed1e9(x));
}

/**
 * Integer representation on the 1e9 grid, as the chain stores it.
 *
 * The snap is not a fudge, it is the point. `0.500000005` is exactly on the
 * grid, but `0.500000005 * 1e9` evaluates to `500000004.99999994` in binary
 * doubles, so a bare `Math.floor` would drop an ulp from a value that needed no
 * flooring at all. Flooring onto the grid has to be idempotent for values
 * already on it, or every pillar in the welfare pipeline bleeds an ulp per step
 * and stops agreeing with the reference model. The chain has no such problem —
 * it holds these as integers and never leaves the grid.
 */
export function toFixed1e9(x: number): number {
  if (!Number.isFinite(x)) return x;
  const scaled = x * FIXED_SCALE;
  const nearest = Math.round(scaled);
  // A double carries ~15–16 significant digits; at this magnitude the
  // representation error is ~1e-7 units, far below the 0.5 that would indicate
  // a genuinely off-grid value.
  if (Math.abs(scaled - nearest) < 1e-6) return nearest;
  return Math.floor(scaled);
}

/** Real value of a stored 1e9-grid integer. */
export function fromFixed1e9(raw: number): number {
  return raw / FIXED_SCALE;
}

/** Charges round up — against the payer, in the escrow's favour (04 §6). */
export function roundChargeUp(baseUnits: number): number {
  return Math.ceil(baseUnits - 1e-9);
}

/** Payouts round down — against the claimant, in the escrow's favour (04 §6). */
export function roundPayoutDown(baseUnits: number): number {
  return Math.floor(baseUnits + 1e-9);
}

/** Basis points of an amount, rounded up (fees are a charge). */
export function bpsUp(amount: number, bps: number): number {
  return roundChargeUp((amount * bps) / 10_000);
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

const groups = (s: string): string => s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** Format USDC base units for display. Never used inside protocol math. */
export function formatUsdc(baseUnits: number, opts?: { decimals?: number }): string {
  const decimals = opts?.decimals ?? (Math.abs(baseUnits) >= USDC ? 2 : 6);
  const sign = baseUnits < 0 ? '-' : '';
  const abs = Math.abs(baseUnits);
  const whole = Math.floor(abs / USDC);
  const frac = abs - whole * USDC;
  if (decimals === 0) return `${sign}${groups(String(whole))}`;
  const fracStr = String(frac).padStart(6, '0').slice(0, decimals);
  return `${sign}${groups(String(whole))}.${fracStr}`;
}

/** Format a VIT amount (12 decimals) for display. */
export function formatVit(planck: number, decimals = 0): string {
  const whole = Math.floor(planck / VIT);
  if (decimals === 0) return groups(String(whole));
  const frac = Math.floor((planck - whole * VIT) / 10 ** (12 - decimals));
  return `${groups(String(whole))}.${String(frac).padStart(decimals, '0')}`;
}

/**
 * Prices are probabilities of welfare and always render on [0,1] with three
 * decimals — the resolution at which the decision hurdle actually operates
 * (δ ranges from 0.0375 to 0.090).
 */
export function formatPrice(p: number, decimals = 3): string {
  return p.toFixed(decimals);
}

export function formatPercent(x: number, decimals = 1): string {
  return `${(x * 100).toFixed(decimals)}%`;
}

export function formatBps(perbillRaw: number): number {
  // Doc 02 §4: the canonical Perbill -> bps projection divides by 100,000 and floors.
  return Math.floor(perbillRaw / 100_000);
}
