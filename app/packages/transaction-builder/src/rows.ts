/**
 * The P-1…P-15 precondition tables — 11 §11.5–§11.9.
 *
 * 11 §11.5's rows are sets of clauses ("each row = the exact re-reads at B′"), and this is
 * that table as data: one entry per clause, each naming the **surface it is read from**.
 *
 * Three things are deliberate about the shape.
 *
 * **Surfaces are cited, not spelled.** A clause names a `CRITICAL_SURFACE` id, and
 * `CRITICAL_SURFACE` is generated from the frozen `tools/release/surface-manifest.json`.
 * So a clause that reads a storage item or constant the runtime does not publish is a
 * *build* failure, not a runtime surprise — and app-code rule 7's ban on hand-listing a
 * frozen surface is honoured by construction rather than by review. `SURFACE_IDS` below
 * is a union type derived from the generated array, so the check is the compiler's.
 *
 * **`[C]` is carried, because it is the clause most easily got wrong.** 11 §11.5 marks
 * constants-API reads explicitly, and 11 §11.4 rule 2 makes them a *distinct* source
 * rather than a variant of storage: `MinSplit`, `MinTransfer`, `MaxPositionsPerAccount`
 * and the per-trade bounds have **no storage representation at all**. A client that went
 * looking for them in storage would find nothing and would have to invent a default,
 * which is exactly the hardcode X-11e/X-11h forbid. Marking the source in the table means
 * a clause cannot be implemented against the wrong one silently.
 *
 * **P-12 is not restated here.** `execution_guard.execute` carries the complete
 * dispatch-time list in its own 11 §11.5 sub-table, and that list is bound to 09 §1.2 by
 * `tools/ci/check-dispatch-mirror.py` (15 §4.8). Restating it in a second place would
 * give the mirror gate a copy to agree with instead of a source to check — the defect
 * SQ-552 was, one level along.
 *
 * **What this file is not.** These are the *declarations*: which reads, from which
 * surface, under which spec row. The predicates that decide a clause from a decoded value
 * (`PreconditionRow.satisfiedBy`) need the typed decode layer, which is F4's remaining
 * work — so they are supplied at the call site rather than baked in here. Writing
 * predicates against undecoded hex would mean re-implementing SCALE per clause, which is
 * how a client acquires its own opinion about what the chain said.
 */

import type { SurfaceId } from '@bleavit/descriptors';

export type { SurfaceId };

/** 11 §11.5's `[C]` marker — a constants-API read, per 11 §11.4 rule 2's third source. */
export type ClauseSource = 'storage' | 'runtime-api' | 'constant';

export interface PreconditionClause {
  /** The `P-n` row this clause belongs to. */
  readonly row: PreconditionRowId;
  /** What must hold, in the words a blocked user is shown (rule 5). */
  readonly requirement: string;
  /** The `CRITICAL_SURFACE` id it is read from. */
  readonly surface: SurfaceId;
  readonly source: ClauseSource;
}

export type PreconditionRowId =
  | 'P-1' | 'P-2' | 'P-3' | 'P-4' | 'P-5' | 'P-6' | 'P-7' | 'P-8'
  | 'P-9' | 'P-10' | 'P-11' | 'P-12' | 'P-13' | 'P-14' | 'P-15';

const clause = (
  row: PreconditionRowId,
  requirement: string,
  surface: SurfaceId,
  source: ClauseSource,
): PreconditionClause => ({ row, requirement, surface, source });

/**
 * P-1 — `market.buy/sell` on a decision or gate book.
 *
 * The proposal-state clause is `∈ {Trading, Extended}` **only**: 11 §11.5 says "only",
 * and a book whose proposal has left those states is one the chain will refuse. The fee
 * appears twice on purpose — 02 §4/§9 rule 4 requires the frozen `Market::Fee` metadata
 * constant to be cross-checked against raw `params(mkt.fee)` by the floored
 * `Perbill / 100,000` projection, because agreeing with itself is not a check.
 */
const P1: readonly PreconditionClause[] = [
  clause('P-1', 'the owning proposal is Trading or Extended', 'storage.epoch.proposals', 'storage'),
  clause('P-1', 'the book exists and its phase is Open', 'storage.market.markets', 'storage'),
  clause('P-1', 'the quoted cost still satisfies max_cost / min_proceeds', 'api.quote', 'runtime-api'),
  clause('P-1', 'the chain fee rate matches the client’s', 'constant.market.min_trade', 'constant'),
  clause('P-1', 'the raw fee parameter agrees with the metadata constant', 'api.params', 'runtime-api'),
  clause('P-1', 'the trade is within the per-trade minimum', 'constant.market.min_trade', 'constant'),
  clause('P-1', 'the trade is within the per-trade maximum ratio', 'constant.market.max_trade_ratio', 'constant'),
  clause('P-1', 'trading is enabled by the constitution’s phase flags', 'storage.constitution.phase_flags', 'storage'),
  clause('P-1', 'your USDC balance covers the purchase', 'storage.foreign_assets.account', 'storage'),
  clause('P-1', 'your position balance covers the sale', 'storage.ledger.positions', 'storage'),
];

/**
 * P-2 — `market.buy/sell` on the **Baseline** book.
 *
 * Two separate existence clauses, not one: 04 §8.3 (SQ-304) makes `BaselineMarketOf(epoch)`
 * and its coextensive `Markets[id]` entry *independently* blocking, so a client that
 * checked only the pointer would trade against a book that is not there.
 */
const P2: readonly PreconditionClause[] = [
  clause('P-2', 'the epoch has a Baseline book', 'storage.market.baseline_market_of', 'storage'),
  clause('P-2', 'that Baseline book exists in Markets', 'storage.market.markets', 'storage'),
  clause('P-2', 'the epoch trading window is open', 'storage.epoch.epoch_of', 'storage'),
  clause('P-2', 'the Baseline vault for the epoch is open', 'storage.ledger.baseline_vaults', 'storage'),
  clause('P-2', 'the trade is within the per-trade minimum', 'constant.market.min_trade', 'constant'),
  clause('P-2', 'the trade is within the per-trade maximum ratio', 'constant.market.max_trade_ratio', 'constant'),
  clause('P-2', 'trading is enabled by the constitution’s phase flags', 'storage.constitution.phase_flags', 'storage'),
];

/** P-3 — `ledger.split` / `split_scalar`. */
const P3: readonly PreconditionClause[] = [
  clause('P-3', 'the vault is Open', 'storage.ledger.vaults', 'storage'),
  clause('P-3', 'your USDC balance covers the amount plus fee headroom', 'storage.foreign_assets.account', 'storage'),
  clause('P-3', 'the amount is at least the minimum split', 'constant.ledger.min_split', 'constant'),
  clause('P-3', 'you have room for each new position key', 'constant.ledger.max_positions_per_account', 'constant'),
  clause('P-3', 'your current position count leaves room', 'storage.ledger.position_totals', 'storage'),
  clause('P-3', 'the ledger is not frozen by PB-LEDGER-FREEZE', 'storage.constitution.phase_flags', 'storage'),
];

/**
 * P-4 — `ledger.merge` / `merge_scalar`.
 *
 * The admissible set includes **`Voided`**: merge is the D-1 par path and 03 §5.1 makes it
 * available in every non-`ScalarSettled` state. A client that excluded `Voided` would
 * refuse the one action that still pays out on a voided vault.
 */
const P4: readonly PreconditionClause[] = [
  clause('P-4', 'the vault is Open, Resolved or Voided', 'storage.ledger.vaults', 'storage'),
  clause('P-4', 'you hold enough of both sides of the pair', 'storage.ledger.positions', 'storage'),
  clause('P-4', 'the ledger is not frozen by PB-LEDGER-FREEZE', 'storage.constitution.phase_flags', 'storage'),
];

/**
 * P-5 — `ledger.redeem` (branch-USDC).
 *
 * `ScalarSettled` **only**. 03 §2.3's outflow monotonicity means `Resolved` admits no
 * unpaired redemption at all; the par path there is `merge` (P-4). Widening this row is
 * how a client offers an action that can only revert.
 */
const P5: readonly PreconditionClause[] = [
  clause('P-5', 'the vault is ScalarSettled', 'storage.ledger.vaults', 'storage'),
  clause('P-5', 'you hold enough winning-branch USDC', 'storage.ledger.positions', 'storage'),
];

/** P-6 — `ledger.redeem_scalar` / `redeem_baseline`. The fee is chain-read (contract v17). */
const P6: readonly PreconditionClause[] = [
  clause('P-6', 'the vault is ScalarSettled with a settlement value', 'storage.ledger.vaults', 'storage'),
  clause('P-6', 'the Baseline position view is BaselineSettled', 'storage.ledger.baseline_vaults', 'storage'),
  clause('P-6', 'your LONG or SHORT balance covers the amount', 'storage.ledger.positions', 'storage'),
  clause('P-6', 'the redemption-fee rate is readable and agrees with its raw parameter', 'api.params', 'runtime-api'),
];

/** P-7 — `ledger.redeem_scalar_pair` / `redeem_baseline_pair`; payout is exactly `a` gross. */
const P7: readonly PreconditionClause[] = [
  clause('P-7', 'the vault is ScalarSettled', 'storage.ledger.vaults', 'storage'),
  clause('P-7', 'the Baseline position view is BaselineSettled', 'storage.ledger.baseline_vaults', 'storage'),
  clause('P-7', 'you hold at least the amount of both LONG and SHORT', 'storage.ledger.positions', 'storage'),
  clause('P-7', 'the redemption-fee rate is readable and agrees with its raw parameter', 'api.params', 'runtime-api'),
];

/** P-8 — `ledger.redeem_void`. 11 §11.6 owns the row; the vault state is the shared clause. */
const P8: readonly PreconditionClause[] = [
  clause('P-8', 'the vault is Voided', 'storage.ledger.vaults', 'storage'),
  clause('P-8', 'you hold the position being redeemed', 'storage.ledger.positions', 'storage'),
];

/** P-9 — `ledger.transfer`. */
const P9: readonly PreconditionClause[] = [
  clause('P-9', 'the vault is Open, Resolved or Voided', 'storage.ledger.vaults', 'storage'),
  clause('P-9', 'the recipient has room for another position', 'constant.ledger.max_positions_per_account', 'constant'),
  clause('P-9', 'the recipient’s current position count leaves room', 'storage.ledger.position_totals', 'storage'),
  clause('P-9', 'the amount is at least the minimum transfer', 'constant.ledger.min_transfer', 'constant'),
  clause('P-9', 'you can cover the per-entry position deposit', 'constant.ledger.position_deposit', 'constant'),
];

/** P-10 — `epoch.submit`. The preimage must be *noted and pinned*, not merely noted. */
const P10: readonly PreconditionClause[] = [
  clause('P-10', 'the epoch is in its Intake phase', 'storage.epoch.epoch_of', 'storage'),
  clause('P-10', 'the intake queue has room', 'storage.epoch.intake_queue', 'storage'),
  clause('P-10', 'the intake queue bound is not reached', 'constant.epoch.max_intake_queue', 'constant'),
  clause('P-10', 'you are under your per-epoch intake rate limit', 'storage.epoch.intake_queue', 'storage'),
  clause('P-10', 'your class bond balance is sufficient', 'storage.system.account', 'storage'),
];

/** P-11 — `epoch.withdraw`: Submitted, caller is proposer, before Qualify. */
const P11: readonly PreconditionClause[] = [
  clause('P-11', 'the proposal is still Submitted', 'storage.epoch.proposals', 'storage'),
  clause('P-11', 'the epoch has not reached Qualify', 'storage.epoch.epoch_of', 'storage'),
];

/**
 * P-12 — `execution_guard.execute`.
 *
 * Deliberately a pointer rather than a list. The complete dispatch-time set lives in
 * 11 §11.5's own sub-table and is diffed against 09 §1.2 by the 15 §4.8 mirror gate; a
 * second copy here would be something for that gate to agree with rather than check.
 */
const P12: readonly PreconditionClause[] = [
  clause('P-12', 'the proposal is queued and not cancelled', 'storage.execution_guard.queue', 'storage'),
  clause('P-12', 'the execution window is open', 'storage.execution_guard.queue', 'storage'),
  clause('P-12', 'the mandate is ratified', 'storage.execution_guard.ratifications', 'storage'),
  clause('P-12', 'the attestor quorum is met', 'storage.attestor.attestations', 'storage'),
  clause('P-12', 'no guardian suspension is active', 'storage.guardian.members', 'storage'),
  clause('P-12', 'the constitution’s gate flags permit execution', 'storage.constitution.phase_flags', 'storage'),
  clause('P-12', 'the batch is within its declared bounds', 'api.execution_queue', 'runtime-api'),
];

/** P-13 — `oracle.report`. The bond is `max(flat_floor, bps × cohort_escrow)`, recomputed. */
const P13: readonly PreconditionClause[] = [
  clause('P-13', 'the round is open and its report window has not elapsed', 'storage.oracle.rounds', 'storage'),
  clause('P-13', 'you are a registered reporter holding the full stake', 'storage.oracle.reporters', 'storage'),
  clause('P-13', 'your balance covers the recomputed round bond', 'storage.system.account', 'storage'),
];

/** P-14 — `oracle.challenge`. The bond doubles per round against a value-scaled floor. */
const P14: readonly PreconditionClause[] = [
  clause('P-14', 'the round is open and its challenge window has not elapsed', 'storage.oracle.rounds', 'storage'),
  clause('P-14', 'any watchtower-quorum extension is accounted for', 'storage.oracle.watchtowers', 'storage'),
  clause('P-14', 'your balance covers the escalated bond', 'storage.system.account', 'storage'),
];

/**
 * P-15 — the crank calls.
 *
 * The row's substance is the refusal: a crank whose staleness precondition is false is a
 * *guaranteed* no-op, and 11 §11.5 says never sign one without an explicit expert
 * override. Signing a no-op costs a fee and does nothing, which is indistinguishable on
 * screen from the crank having run.
 */
const P15: readonly PreconditionClause[] = [
  clause('P-15', 'the epoch crank has work to do', 'storage.epoch.epoch_of', 'storage'),
  clause('P-15', 'the observation crank is due', 'storage.market.markets', 'storage'),
  clause('P-15', 'the cohort is settleable', 'storage.epoch.cohorts', 'storage'),
  clause('P-15', 'the welfare snapshot for the epoch is not yet taken', 'storage.welfare.snapshots', 'storage'),
];

/** 11 §11.5's table, as data. */
export const PRECONDITION_ROWS: Readonly<Record<PreconditionRowId, readonly PreconditionClause[]>> = {
  'P-1': P1, 'P-2': P2, 'P-3': P3, 'P-4': P4, 'P-5': P5,
  'P-6': P6, 'P-7': P7, 'P-8': P8, 'P-9': P9, 'P-10': P10,
  'P-11': P11, 'P-12': P12, 'P-13': P13, 'P-14': P14, 'P-15': P15,
};

/** Every clause, flattened — the form the binding gate checks. */
export const ALL_CLAUSES: readonly PreconditionClause[] = Object.values(PRECONDITION_ROWS).flat();

/**
 * The rows a call must satisfy before it may be signed.
 *
 * Throws rather than returning an empty set for an unknown call: an empty precondition
 * set is indistinguishable from "nothing to check", and a call that reached the gate with
 * no rows would pass it. 11 §11.4 rule 1 asks for the gate to be unbypassable, and a
 * silent empty set is a bypass with extra steps.
 */
export function rowsFor(id: PreconditionRowId): readonly PreconditionClause[] {
  const rows = PRECONDITION_ROWS[id];
  if (rows === undefined || rows.length === 0) {
    throw new Error(`no precondition clauses for ${id}; refusing to treat that as "nothing to check"`);
  }
  return rows;
}
