/**
 * `FutarchyApi.bond_quote` — the amount a not-yet-created bonded action would hold.
 *
 * 02 §3/§4, contract v29; 07 §6.1 (`B_1`) and §7 (`F(kind, m)`). Serves 11 §11.5's P-13
 * and §11.8.6's O-8.
 *
 * ## One module for two rows, because the chain publishes one fold
 *
 * `StakeAtRisk(c, m)` and `Exposure(kind, m)` are the same sum of `CohortEscrow(k)` over
 * the live cohort schedules, differing only in which cohorts are in scope. 02 §3 publishes
 * them through **one** method for that reason, and a client that split the answer across
 * two modules would recreate the drift the single method exists to prevent.
 *
 * ## This module contains no bond arithmetic, and that is the point
 *
 * 07 §6.1 states three separable normative details — the `/ 10,000` division rounds **up**,
 * rounding resolves toward custody, and the `max` against the floor applies **after**
 * rounding. A client applying them itself owns all three, and getting any wrong
 * under-collateralizes a bond: the under-custody direction I-4 and I-28 name as the unsafe
 * one, on money a user must post. So `bond` is read and displayed, `exposure` is disclosure
 * beside it, and there is no multiplication anywhere in this file.
 *
 * ## `undeterminable` is the chain's own answer, not a read failure
 *
 * 07 §7 makes the Milestone exposure not determinable until the aggregate is bound to a
 * component, and requires `file` to refuse with `ExposureUnavailable` — *"which is the
 * status-quo default (G-1), not a gap"*. `bond_quote` returns `None` there, and this union
 * carries it as its own arm so a screen must handle it. `unread` is the different case: the
 * call itself did not answer. Both block, and each says which happened, because the
 * remedies differ — one waits for the aggregate, the other retries the read.
 *
 * A floor is deliberately **not** a fallback for either. `orc.bond_floor` and `reg.bond_*`
 * are lower bounds on the bond, never the bond, and presenting one as the amount understates
 * what the user is about to commit — which is exactly what 11 §11.5's P-13 did until
 * contract v29 published the figure.
 */

import type { Verified } from '@bleavit/shared-types';

/** 02 §4's `BondQuoteView`, as the client holds it. */
export interface BondQuote {
  /** The amount the action would hold. The only figure a screen may present as the bond. */
  readonly bond: Verified<bigint>;
  /** `StakeAtRisk(c, m)` / `Exposure(kind, m)`. Disclosure only — never an input here. */
  readonly exposure: Verified<bigint>;
  /** The block the escrow fold was read at. The quote is priced here. */
  readonly readAt: Verified<number>;
}

export type BondQuoteState =
  | { readonly kind: 'quoted'; readonly quote: BondQuote }
  /** The chain answered `None`: 07 §7's not-determinable exposure. */
  | { readonly kind: 'undeterminable' }
  /** The call did not answer. Distinct from the above — see the module note. */
  | { readonly kind: 'unread'; readonly reason: string };

/**
 * 02 §3's required disclosure: the figure is priced at the read block and fixes at
 * submission.
 *
 * Fixed copy, and returned for the **quoted** case rather than only for the refusals — a
 * quote presented as the settled amount is the misreading this sentence exists to prevent,
 * and it is the case where nothing else on screen signals it.
 */
export const BOND_QUOTE_IS_A_QUOTE =
  'This amount is priced at the block shown and fixes when your transaction is included. ' +
  'The bond scales with the escrow of every cohort the claim can move (07 §6), and the ' +
  'chain reads that escrow when the game is created — so the figure can move between now ' +
  'and then, and the chain’s reading is the one that binds.';

/**
 * Which of 02 §4's `BondQuoteRequest` arms a refusal is about.
 *
 * Required at every call site, because the two arms answer `None` for **different reasons**
 * and the copy is what a user acts on. One sentence served both until 2026-08-07 and it was
 * the registry's: it named 07 §7's not-determinable aggregate and the `ExposureUnavailable`
 * error, and `oracle.report` returns neither — that error belongs to `pallet-registry`. A
 * reporter was shown another pallet's error name and told to wait for an aggregate that has
 * nothing to do with their round.
 */
export type BondQuoteRequestKind = 'oracle-report' | 'incident-filing' | 'milestone-filing';

/**
 * Why the chain answered `None`, per request arm — 02 §3's third normative property.
 *
 * The **filing** arms are 07 §7's: `cohort_exposure(kind, epoch)` is not determinable until
 * the aggregate is bound to a component, and `file` MUST then refuse with
 * `ExposureUnavailable` (`pallets/registry/src/lib.rs:875-879`). The **oracle** arm is not
 * that case at all: `report_bond_quote` folds the stake at risk and answers nothing when the
 * live parameters cannot price a round-1 bond whose whole frozen doubling ladder is
 * representable (`pallets/oracle/src/lib.rs:1183-1192`), which is a statement about
 * parameters rather than about a missing aggregate.
 */
export const BOND_QUOTE_UNDETERMINABLE: Readonly<Record<BondQuoteRequestKind, string>> =
  Object.freeze({
    'oracle-report':
      'The chain cannot price this report’s bond at this block: the live oracle parameters ' +
      'do not yield a round-1 bond whose full escalation ladder it could hold. This is a ' +
      'statement about the parameters, not about your account, and the amount is withheld ' +
      'rather than floored — the floor is the least the bond can be and not the bond. This ' +
      'control stays closed rather than asking you to commit an amount nobody can state.',
    'incident-filing':
      'The chain cannot price this filing’s bond yet: the exposure it scales against is not ' +
      'determinable until the aggregate is bound to a component (07 §7). `file` itself would ' +
      'be refused with `ExposureUnavailable`, so this control stays closed rather than asking ' +
      'you to commit an amount nobody can state.',
    'milestone-filing':
      'The chain cannot price this filing’s bond yet: the exposure it scales against is not ' +
      'determinable until the aggregate is bound to a component (07 §7). `file` itself would ' +
      'be refused with `ExposureUnavailable`, so this control stays closed rather than asking ' +
      'you to commit an amount nobody can state.',
  });

/**
 * Why the bond blocks, or `undefined` when it is quoted.
 *
 * `request` is a **required** argument rather than a field on the state, because it is a
 * property of the question the caller asked and every caller here is a row that knows which
 * one it asked. An optional one would default to some arm, and the arm it defaulted to would
 * be wrong for the other caller.
 */
export function bondQuoteRefusal(
  state: BondQuoteState,
  request: BondQuoteRequestKind,
): string | undefined {
  switch (state.kind) {
    case 'quoted':
      return undefined;
    case 'undeterminable':
      return BOND_QUOTE_UNDETERMINABLE[request];
    case 'unread':
      return (
        `The bond this action will hold could not be read (${state.reason}). It is not ` +
        'defaulted to a floor: the floor is the least the bond can be and not the amount, ' +
        'so showing it would understate what you are committing.'
      );
  }
}

/**
 * Does free balance cover the quoted bond?
 *
 * `false` whenever the bond is not quoted, and that is not a shortcut: with no amount there
 * is nothing to compare, and answering `true` would let a headroom check pass on a figure
 * that was never established.
 */
export function coversBond(state: BondQuoteState, freeUsdc: Verified<bigint>): boolean {
  return state.kind === 'quoted' && freeUsdc.value >= state.quote.bond.value;
}
