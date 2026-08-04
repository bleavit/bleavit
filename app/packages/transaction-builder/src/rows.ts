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

import { actingAccount, feePayer, type AccountId, type CallWrapper } from './wrappers.js';

/** 11 §11.5's `[C]` marker — a constants-API read, per 11 §11.4 rule 2's third source. */
export type ClauseSource = 'storage' | 'runtime-api' | 'constant';

/**
 * *Whose* account a clause reads — 11 §11.3's multisig and proxy wrappers made explicit.
 *
 * Without this, every clause implicitly reads "the signer", which is correct only for an
 * unwrapped extrinsic. A wrapper splits the identity: `Proxy.proxy` executes the inner
 * call as `real` and `Multisig.as_multi` executes it as the derived multisig account,
 * while the **signer** still pays the fee and owns the nonce. A table that resolves one
 * account for both questions checks the wrong one for at least one of them, and it fails
 * in the dangerous direction — the signer's healthy balance turns every row green while
 * the runtime rejects the inner call because the *proxied* account is short. The user
 * signed something the client had told them would work.
 *
 * `recipient` is a third subject rather than a special case of the others: P-9's
 * `MaxPositionsPerAccount` clauses are about the **transfer destination**, an account
 * that is neither the signer nor the acting origin, and folding it into either would
 * check the sender's position count against the recipient's bound.
 */
export type ClauseSubject =
  /** Not account-scoped: chain state, a constant, or a runtime-wide flag. */
  | 'chain'
  /** The account the call executes as — signer, or the proxied/multisig account. */
  | 'acting'
  /** The account that pays the fee and owns the nonce — always the signer. */
  | 'signer'
  /** A named third party, e.g. `ledger.transfer`'s destination. */
  | 'recipient';

export interface PreconditionClause {
  /** The `P-n` row this clause belongs to. */
  readonly row: PreconditionRowId;
  /** What must hold, in the words a blocked user is shown (rule 5). */
  readonly requirement: string;
  /** The `CRITICAL_SURFACE` id it is read from. */
  readonly surface: SurfaceId;
  readonly source: ClauseSource;
  /** Whose account the read is against. Required — an omitted subject is the defect. */
  readonly subject: ClauseSubject;
}

export type PreconditionRowId =
  | 'P-1' | 'P-2' | 'P-3' | 'P-4' | 'P-5' | 'P-6' | 'P-7' | 'P-8'
  | 'P-9' | 'P-10' | 'P-11' | 'P-12' | 'P-13' | 'P-14' | 'P-15';

const clause = (
  row: PreconditionRowId,
  requirement: string,
  surface: SurfaceId,
  source: ClauseSource,
  subject: ClauseSubject,
): PreconditionClause => ({ row, requirement, surface, source, subject });

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
  clause('P-1', 'the owning proposal is Trading or Extended', 'storage.epoch.proposals', 'storage', 'chain'),
  clause('P-1', 'the book exists and its phase is Open', 'storage.market.markets', 'storage', 'chain'),
  clause('P-1', 'the quoted cost still satisfies max_cost / min_proceeds', 'api.quote', 'runtime-api', 'chain'),
  // 02 §4/§9 rule 4's cross-check, with both halves named — agreeing with itself is not
  // a check. The frozen `Market::Fee` metadata constant against raw `params(mkt.fee)`
  // under the floored `Perbill / 100,000` projection.
  //
  // This clause was absent until SQ-581 was fixed. 02 §9 declared `Market::Fee` frozen and
  // `surface-manifest.json` never listed it, so there was no `SurfaceId` to cite; an
  // earlier draft cited `constant.market.min_trade` — a *different* constant that happens
  // to exist — and both the type checker and a reading eye accepted it. The fix was not a
  // better citation but the missing manifest entry.
  clause('P-1', 'the chain fee rate matches the client’s', 'constant.market.fee', 'constant', 'chain'),
  clause('P-1', 'the raw fee parameter agrees with the metadata constant', 'api.params', 'runtime-api', 'chain'),
  clause('P-1', 'the trade is within the per-trade minimum', 'constant.market.min_trade', 'constant', 'chain'),
  clause('P-1', 'the trade is within the per-trade maximum ratio', 'constant.market.max_trade_ratio', 'constant', 'chain'),
  clause('P-1', 'trading is enabled by the constitution’s phase flags', 'storage.constitution.phase_flags', 'storage', 'chain'),
  clause('P-1', 'your USDC balance covers the purchase', 'storage.foreign_assets.account', 'storage', 'acting'),
  clause('P-1', 'your position balance covers the sale', 'storage.ledger.positions', 'storage', 'acting'),
];

/**
 * P-2 — `market.buy/sell` on the **Baseline** book.
 *
 * Two separate existence clauses, not one: 04 §8.3 (SQ-304) makes `BaselineMarketOf(epoch)`
 * and its coextensive `Markets[id]` entry *independently* blocking, so a client that
 * checked only the pointer would trade against a book that is not there.
 */
const P2: readonly PreconditionClause[] = [
  clause('P-2', 'the epoch has a Baseline book', 'storage.market.baseline_market_of', 'storage', 'chain'),
  clause('P-2', 'that Baseline book exists in Markets', 'storage.market.markets', 'storage', 'chain'),
  clause('P-2', 'the epoch trading window is open', 'storage.epoch.epoch_of', 'storage', 'chain'),
  clause('P-2', 'the Baseline vault for the epoch is open', 'storage.ledger.baseline_vaults', 'storage', 'chain'),
  clause('P-2', 'the trade is within the per-trade minimum', 'constant.market.min_trade', 'constant', 'chain'),
  clause('P-2', 'the trade is within the per-trade maximum ratio', 'constant.market.max_trade_ratio', 'constant', 'chain'),
  clause('P-2', 'trading is enabled by the constitution’s phase flags', 'storage.constitution.phase_flags', 'storage', 'chain'),
];

/** P-3 — `ledger.split` / `split_scalar`. */
const P3: readonly PreconditionClause[] = [
  clause('P-3', 'the vault is Open', 'storage.ledger.vaults', 'storage', 'chain'),
  // 11 §11.5's P-3 text reads "USDC balance ≥ amount + fee headroom (in selected fee
  // asset)" as one clause, and for an unwrapped extrinsic that is exactly right: signer
  // and origin are the same account, so one read answers both. **A wrapper decomposes
  // it.** Under `Proxy.proxy` the amount leaves the *proxied* account while the fee
  // leaves the *signer*, so a single clause resolves to one account and silently checks
  // the wrong balance for the other half. Split here rather than in the spec: the
  // document's sentence stays true of the case it describes, and the two reads it
  // implies are made separate where they are actually performed.
  clause('P-3', 'the acting account’s USDC balance covers the amount', 'storage.foreign_assets.account', 'storage', 'acting'),
  clause('P-3', 'your fee headroom covers the fee in the selected asset', 'storage.foreign_assets.account', 'storage', 'signer'),
  clause('P-3', 'the amount is at least the minimum split', 'constant.ledger.min_split', 'constant', 'chain'),
  clause('P-3', 'you have room for each new position key', 'constant.ledger.max_positions_per_account', 'constant', 'chain'),
  clause('P-3', 'your current position count leaves room', 'storage.ledger.position_totals', 'storage', 'acting'),
  clause('P-3', 'the ledger is not frozen by PB-LEDGER-FREEZE', 'storage.constitution.phase_flags', 'storage', 'chain'),
];

/**
 * P-4 — `ledger.merge` / `merge_scalar`.
 *
 * The admissible set includes **`Voided`**: merge is the D-1 par path and 03 §5.1 makes it
 * available in every non-`ScalarSettled` state. A client that excluded `Voided` would
 * refuse the one action that still pays out on a voided vault.
 */
const P4: readonly PreconditionClause[] = [
  clause('P-4', 'the vault is Open, Resolved or Voided', 'storage.ledger.vaults', 'storage', 'chain'),
  clause('P-4', 'you hold enough of both sides of the pair', 'storage.ledger.positions', 'storage', 'acting'),
  clause('P-4', 'the ledger is not frozen by PB-LEDGER-FREEZE', 'storage.constitution.phase_flags', 'storage', 'chain'),
];

/**
 * P-5 — `ledger.redeem` (branch-USDC).
 *
 * `ScalarSettled` **only**. 03 §2.3's outflow monotonicity means `Resolved` admits no
 * unpaired redemption at all; the par path there is `merge` (P-4). Widening this row is
 * how a client offers an action that can only revert.
 */
const P5: readonly PreconditionClause[] = [
  clause('P-5', 'the vault is ScalarSettled', 'storage.ledger.vaults', 'storage', 'chain'),
  clause('P-5', 'you hold enough winning-branch USDC', 'storage.ledger.positions', 'storage', 'acting'),
];

/** P-6 — `ledger.redeem_scalar` / `redeem_baseline`. The fee is chain-read (contract v17). */
const P6: readonly PreconditionClause[] = [
  clause('P-6', 'the vault is ScalarSettled with a settlement value', 'storage.ledger.vaults', 'storage', 'chain'),
  clause('P-6', 'the Baseline position view is BaselineSettled', 'storage.ledger.baseline_vaults', 'storage', 'chain'),
  clause('P-6', 'your LONG or SHORT balance covers the amount', 'storage.ledger.positions', 'storage', 'acting'),
  clause('P-6', 'the redemption-fee rate is readable and agrees with its raw parameter', 'api.params', 'runtime-api', 'chain'),
];

/** P-7 — `ledger.redeem_scalar_pair` / `redeem_baseline_pair`; payout is exactly `a` gross. */
const P7: readonly PreconditionClause[] = [
  clause('P-7', 'the vault is ScalarSettled', 'storage.ledger.vaults', 'storage', 'chain'),
  clause('P-7', 'the Baseline position view is BaselineSettled', 'storage.ledger.baseline_vaults', 'storage', 'chain'),
  clause('P-7', 'you hold at least the amount of both LONG and SHORT', 'storage.ledger.positions', 'storage', 'acting'),
  clause('P-7', 'the redemption-fee rate is readable and agrees with its raw parameter', 'api.params', 'runtime-api', 'chain'),
];

/** P-8 — `ledger.redeem_void`. 11 §11.6 owns the row; the vault state is the shared clause. */
const P8: readonly PreconditionClause[] = [
  clause('P-8', 'the vault is Voided', 'storage.ledger.vaults', 'storage', 'chain'),
  clause('P-8', 'you hold the position being redeemed', 'storage.ledger.positions', 'storage', 'acting'),
];

/** P-9 — `ledger.transfer`. */
const P9: readonly PreconditionClause[] = [
  clause('P-9', 'the vault is Open, Resolved or Voided', 'storage.ledger.vaults', 'storage', 'chain'),
  clause('P-9', 'the recipient has room for another position', 'constant.ledger.max_positions_per_account', 'constant', 'recipient'),
  clause('P-9', 'the recipient’s current position count leaves room', 'storage.ledger.position_totals', 'storage', 'recipient'),
  clause('P-9', 'the amount is at least the minimum transfer', 'constant.ledger.min_transfer', 'constant', 'chain'),
  // The deposit is taken from the **entry owner**, and 03 §4's storage-deposit paragraph
  // names that explicitly as "the *recipient* on `transfer`". Classified `acting` at
  // first, which is the sender — so a sender with a healthy balance passed the row while
  // the runtime rejected the transfer for the recipient's insufficient deposit headroom.
  // The wording moved with the subject: "you" was the wrong person.
  clause('P-9', 'the recipient can cover the per-entry position deposit', 'constant.ledger.position_deposit', 'constant', 'recipient'),
  // The clause 11 §11.5 mandates and this table could not express until contract v25.
  //
  // `ledger.transfer` refuses a protocol destination, and the runtime's test is
  // `ReservedProtocolDestinations::contains` — a `Contains` implementation over a
  // domain-separated address namespace plus a set of PalletId-derived singletons, which
  // is not storage. There was therefore no `SurfaceId` to cite and the clause was simply
  // absent: a user could be walked through a green precondition table to a signature the
  // runtime then refuses (SQ-586).
  //
  // It reads the chain rather than recomputing the namespace locally, and that is §11.4
  // rule 2 rather than taste: every row here must be *an exact chain read*, and a client
  // deriving membership from frozen constants would be evaluating a computation. It is
  // also the one clause whose subject is the **recipient the user just typed**, which is
  // exactly the value no local predicate should be trusted to classify.
  clause(
    'P-9',
    'the recipient is not a protocol account',
    'api.is_reserved_protocol_destination',
    'runtime-api',
    'recipient',
  ),
];

/** P-10 — `epoch.submit`. The preimage must be *noted and pinned*, not merely noted. */
const P10: readonly PreconditionClause[] = [
  clause('P-10', 'the epoch is in its Intake phase', 'storage.epoch.epoch_of', 'storage', 'chain'),
  clause('P-10', 'the intake queue has room', 'storage.epoch.intake_queue', 'storage', 'chain'),
  clause('P-10', 'the intake queue bound is not reached', 'constant.epoch.max_intake_queue', 'constant', 'chain'),
  clause('P-10', 'you are under your per-epoch intake rate limit', 'storage.epoch.intake_queue', 'storage', 'acting'),
  clause('P-10', 'your class bond balance is sufficient', 'storage.system.account', 'storage', 'acting'),
];

/** P-11 — `epoch.withdraw`: Submitted, caller is proposer, before Qualify. */
const P11: readonly PreconditionClause[] = [
  clause('P-11', 'the proposal is still Submitted', 'storage.epoch.proposals', 'storage', 'chain'),
  clause('P-11', 'the epoch has not reached Qualify', 'storage.epoch.epoch_of', 'storage', 'chain'),
];

/**
 * P-12 — `execution_guard.execute`, all thirteen dispatch checks (contract v26; SQ-589).
 *
 * **This row was seven clauses and a comment claiming the 15 §4.8 mirror gate owned the
 * rest. That claim was false**, and an adversarial review caught it:
 * `tools/ci/check-dispatch-mirror.py` parses docs 09 §1.2 and 11 §11.5 and **never reads
 * this file**, so nothing verified the client implemented the checks at all. The old test
 * asserted `rowsFor('P-12').length < 13`, which passes for a trivial reason.
 *
 * The real obstacle was that seven of the surfaces were not frozen, so there was nothing to
 * cite — inventing a `SurfaceId` is the hand-listing app-code rule 7 forbids. Contract v26
 * froze them (02 §7.8, §7.3), and the list below is derived from `do_execute` itself
 * (`pallets/execution-guard/src/lib.rs:1928-2130`), each clause named for the error the
 * runtime returns when it fails.
 *
 * **Three of these read the way a reviewer would not guess, so they are stated:**
 *
 *  - The **ledger freeze and dead-man** clauses read `Constitution.PhaseFlags` bits 5 and 6,
 *    not a ledger or epoch item — `configs.rs:9411` and `:9416` are where the runtime looks.
 *    The guard *also* keeps its own `DeadManFreeze` latch, which is a different flag with
 *    the same name in prose; both are checked, because `FreezeActive` fires on either.
 *  - **`Expedited` is an exemption, not a check.** An expedited proposal executes *through*
 *    a triggering freeze (`lib.rs:2091`), so a client reading only the freeze flags tells
 *    the user they are blocked when the chain would run the call. Fail-closed in the safe
 *    direction and still wrong on screen.
 *  - **`GateSuspension` is undecidable alone.** `Some(epoch)` is a suspension only when that
 *    epoch is current, so it is read with `Epoch.EpochOf` — whose `index` is the current
 *    epoch — and with the breach flags for that same epoch (`configs.rs:9421`).
 */
const P12: readonly PreconditionClause[] = [
  // 1-2. Queue state and the execution window (`Cancelled`, `NotMature`, `GraceExpired`).
  clause('P-12', 'the proposal is queued and not cancelled', 'storage.execution_guard.queue', 'storage', 'chain'),
  clause('P-12', 'the execution window is open', 'storage.execution_guard.queue', 'storage', 'chain'),
  // 3. `BadPreimage` — the client re-hashes the bytes and compares the noted length.
  clause('P-12', 'the payload preimage is noted and matches the queued hash and length', 'storage.preimage.preimage_for', 'storage', 'chain'),
  // 4. `StaleQueue` — the queued RuntimeVersionConstraint against the live runtime.
  clause('P-12', 'the mandate’s runtime-version constraint still matches this runtime', 'storage.execution_guard.queue', 'storage', 'chain'),
  // 5. `NotRatified`.
  clause('P-12', 'the mandate is ratified', 'storage.execution_guard.ratifications', 'storage', 'chain'),
  // 6. `AttestationMissing` — the records, and the binding to the payload actually queued.
  clause('P-12', 'the attestor quorum is met and unrevoked', 'storage.attestor.attestations', 'storage', 'chain'),
  clause('P-12', 'the attestations are bound to this payload', 'storage.execution_guard.attestation_bindings', 'storage', 'chain'),
  // 7. `CapabilityDenied`.
  clause('P-12', 'every declared call domain’s capability rule admits this class origin', 'storage.constitution.capabilities', 'storage', 'chain'),
  // 8. `MetersBlocked` — the chain's own answer (02 §4), not a client re-derivation.
  clause('P-12', 'the rate meters admit this execution now', 'api.execution_queue', 'runtime-api', 'chain'),
  // 9. `ResourceLockMissing` — the guard reads its own HeldResources, NOT Epoch.ResourceLocks
  //    (11 §11.5's check 9 cited the latter; corrected at v26, SQ-589).
  clause('P-12', 'every declared resource domain is still locked to this proposal', 'storage.execution_guard.held_resources', 'storage', 'chain'),
  // 10. `GuardianHold` / `GateSuspended`.
  clause('P-12', 'the proposal is not suspended or held for rerun', 'storage.epoch.proposals', 'storage', 'chain'),
  clause('P-12', 'no welfare-gate suspension is active for the current epoch', 'storage.execution_guard.gate_suspension', 'storage', 'chain'),
  clause('P-12', 'the current epoch is read for that suspension', 'storage.epoch.epoch_of', 'storage', 'chain'),
  // 11. `FreezeActive` (hard gate) — the guard latch and the welfare flags it mirrors.
  clause('P-12', 'no hard welfare-gate breach is latched', 'storage.execution_guard.hard_gate_breach', 'storage', 'chain'),
  clause('P-12', 'no hard-gate daily breach flag is set', 'storage.welfare.gate_breach_flags', 'storage', 'chain'),
  // 12. `FreezeActive` (dead-man, ledger freeze, migration halt) and the expedited exemption.
  clause('P-12', 'the dead-man switch is not engaged', 'storage.execution_guard.dead_man_freeze', 'storage', 'chain'),
  clause('P-12', 'PB-LEDGER-FREEZE and the dead-man flag are clear', 'storage.constitution.phase_flags', 'storage', 'chain'),
  clause('P-12', 'no migration halt is in force', 'storage.execution_guard.migration_halt', 'storage', 'chain'),
  clause('P-12', 'or this proposal holds the expedited exemption', 'storage.execution_guard.expedited', 'storage', 'chain'),
  // 13. Batch bounds and the SafetyFilter closure over the decoded preimage.
  clause('P-12', 'the decoded batch is within its call, size and weight bounds', 'api.execution_queue', 'runtime-api', 'chain'),
];

/** P-13 — `oracle.report`. The bond is `max(flat_floor, bps × cohort_escrow)`, recomputed. */
const P13: readonly PreconditionClause[] = [
  clause('P-13', 'the round is open and its report window has not elapsed', 'storage.oracle.rounds', 'storage', 'chain'),
  clause('P-13', 'you are a registered reporter holding the full stake', 'storage.oracle.reporters', 'storage', 'acting'),
  clause('P-13', 'your balance covers the recomputed round bond', 'storage.system.account', 'storage', 'acting'),
];

/** P-14 — `oracle.challenge`. The bond doubles per round against a value-scaled floor. */
const P14: readonly PreconditionClause[] = [
  clause('P-14', 'the round is open and its challenge window has not elapsed', 'storage.oracle.rounds', 'storage', 'chain'),
  clause('P-14', 'any watchtower-quorum extension is accounted for', 'storage.oracle.watchtowers', 'storage', 'chain'),
  clause('P-14', 'your balance covers the escalated bond', 'storage.system.account', 'storage', 'acting'),
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
  clause('P-15', 'the epoch crank has work to do', 'storage.epoch.epoch_of', 'storage', 'chain'),
  clause('P-15', 'the observation crank is due', 'storage.market.markets', 'storage', 'chain'),
  clause('P-15', 'the cohort is settleable', 'storage.epoch.cohorts', 'storage', 'chain'),
  clause('P-15', 'the welfare snapshot for the epoch is not yet taken', 'storage.welfare.snapshots', 'storage', 'chain'),
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

/**
 * Resolve which account a clause is read against — the wrapper's identity split applied.
 *
 * Returns `undefined` for a `chain` clause, which is not an "unknown account" but a
 * statement that the read is not account-scoped at all. Callers must treat the two
 * differently: substituting the signer for `undefined` would re-introduce exactly the
 * implicit-signer assumption the subject field exists to remove.
 *
 * `recipient` requires the caller to supply the destination, because it is an argument of
 * the call rather than a property of the session. Omitting it throws rather than falling
 * back: a P-9 evaluation that quietly checked the *sender's* position count against the
 * recipient's `MaxPositionsPerAccount` bound would pass on a healthy sender and let the
 * user sign a transfer the runtime refuses.
 */
export function accountForClause(
  entry: PreconditionClause,
  wrapper: CallWrapper,
  signer: AccountId,
  recipient?: AccountId,
): AccountId | undefined {
  switch (entry.subject) {
    case 'chain':
      return undefined;
    case 'acting':
      return actingAccount(wrapper, signer);
    case 'signer':
      return feePayer(wrapper, signer);
    case 'recipient':
      if (recipient === undefined) {
        throw new Error(
          `clause "${entry.requirement}" (${entry.row}) is read against the transfer ` +
            'recipient, which was not supplied; refusing to substitute the signer',
        );
      }
      return recipient;
  }
}

/**
 * The clauses of a row that must be read against an account other than the signer.
 *
 * Empty for an unwrapped call, non-empty under a wrapper — which is the property that
 * makes the split reviewable rather than asserted: if this returns nothing under a proxy,
 * the row has no account-scoped clause and the wrapper is doing nothing.
 */
export function clausesNeedingOtherAccounts(
  id: PreconditionRowId,
  wrapper: CallWrapper,
  signer: AccountId,
): readonly PreconditionClause[] {
  return rowsFor(id).filter((entry) => {
    if (entry.subject === 'recipient') return true;
    const account = accountForClause(entry, wrapper, signer);
    return account !== undefined && account !== signer;
  });
}
