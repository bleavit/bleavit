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

export type { FeeAsset } from './fee-asset.js';

import { isFeeAsset, type FeeAsset } from './fee-asset.js';

export interface PreconditionClause {
  /** The `P-n` or `O-n` row this clause belongs to. */
  readonly row: RowId;
  /** What must hold, in the words a blocked user is shown (rule 5). */
  readonly requirement: string;
  /**
   * A stable short name for this clause, so a checker can **consume** the table.
   *
   * Optional only because retro-fitting one onto every P-row clause is churn with no
   * reader. Where a module evaluates a row it takes the clause list as its work list and
   * refuses a clause it has no predicate for — see `oracle-reporting.ts`. That refusal is
   * the whole point: a clause added to the table then has to be implemented, rather than
   * being silently absent from a check that still reports "everything passes".
   */
  readonly key?: string;
  /** The `CRITICAL_SURFACE` id it is read from. */
  readonly surface: SurfaceId;
  readonly source: ClauseSource;
  /** Whose account the read is against. Required — an omitted subject is the defect. */
  readonly subject: ClauseSubject;
  /**
   * Set only on a clause whose *surface* depends on the selected fee currency.
   *
   * `undefined` means the clause applies whichever asset pays. A clause that names an
   * asset is selected out when the other is chosen — see `rowsFor`.
   */
  readonly feeAsset?: FeeAsset;
  /**
   * Alternative-group id — clauses sharing one satisfy the row if **any** of them holds.
   *
   * 11 §11.5 states several rows as disjunctions ("proposal vault `ScalarSettled`, **or**
   * Baseline position view `BaselineSettled`"), and a flat clause list is read
   * conjunctively by anything that evaluates it. That is not a cosmetic mismatch: it
   * blocks the *lawful* case. A user redeeming a settled proposal position who never held
   * a Baseline position failed the Baseline clause and was refused an action the chain
   * would have accepted — a client refusing what the runtime allows, which is the
   * direction 15 §4.8's mirror rule exists to forbid.
   */
  readonly anyOf?: string;
}

export type PreconditionRowId =
  | 'P-1' | 'P-2' | 'P-3' | 'P-4' | 'P-5' | 'P-6' | 'P-7' | 'P-8'
  | 'P-9' | 'P-10' | 'P-11' | 'P-12' | 'P-13' | 'P-14' | 'P-15';

/**
 * The 11 §11.8 operator rows — S14…S19's calls, which §11.5 does not table.
 *
 * §11.8's opening sentence binds every workflow below it to §11.4 discipline, and §11.4
 * rule 1 requires the gate **structurally**. A call with no row cannot declare one in
 * `TxPreparation.requires`, so `gate()` has nothing to demand and every operator console
 * was left gating its own button on a module-local check. That is the bypass rule 1 names,
 * reached by omission rather than by an added edge.
 *
 * They are a separate union from `PreconditionRowId` for the reason `GovernanceRowId` is:
 * §11.5's table is fifteen rows and a test asserts that spec fact. These are §11.8's.
 */
export type OperatorRowId =
  | 'O-1' | 'O-2' | 'O-3' | 'O-4' | 'O-5' | 'O-6' | 'O-7' | 'O-8' | 'O-9';

/** Any row a preparation may declare. */
export type RowId = PreconditionRowId | OperatorRowId;

const clause = (
  row: RowId,
  requirement: string,
  surface: SurfaceId,
  source: ClauseSource,
  subject: ClauseSubject,
  extra: {
    readonly feeAsset?: FeeAsset;
    readonly anyOf?: string;
    readonly key?: string;
  } = {},
): PreconditionClause => ({ row, requirement, surface, source, subject, ...extra });

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
  // 11 §11.5's "`quote()` vs. client recompute agree within the fixed-point bounds (else
  // `FE-CHAIN-005`, trading blocked)". The book's `q_L, q_S, b` is the recompute's input
  // and is read above; this is the *agreement*, which is a separate precondition — a
  // client that recomputed and never compared would trade on its own arithmetic.
  clause('P-1', 'the chain’s quote and the client’s recompute agree', 'storage.market.markets', 'storage', 'chain'),
  // PB-LEDGER-FREEZE. **Not `Constitution.PhaseFlags`** — that is the trading-enabled bit
  // one clause up, a different flag that can be green while the call is refused as frozen.
  // The market's own guard reads `pallet_conditional_ledger::FrozenUntil`
  // (`pallets/market/src/lib.rs:262`) alongside its own; neither is frozen surface, and
  // `EpochStatusView.ledger_frozen` is the chain's own answer to exactly this question.
  clause('P-1', 'the ledger is not frozen by PB-LEDGER-FREEZE', 'api.epoch_status', 'runtime-api', 'chain'),
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
  // "book state + slippage recheck **as P-1**" is a full clause set, not a cross-reference
  // a reader supplies. This row carried the existence and phase clauses and stopped there,
  // so a Baseline buy by an account with no USDC passed every declared clause and was
  // refused by `market.buy`. The user was walked to a signature on a green table.
  clause('P-2', 'the quoted cost still satisfies max_cost / min_proceeds', 'api.quote', 'runtime-api', 'chain'),
  clause('P-2', 'the chain’s quote and the client’s recompute agree', 'storage.market.markets', 'storage', 'chain'),
  clause('P-2', 'the chain fee rate matches the client’s', 'constant.market.fee', 'constant', 'chain'),
  clause('P-2', 'the raw fee parameter agrees with the metadata constant', 'api.params', 'runtime-api', 'chain'),
  clause('P-2', 'the ledger is not frozen by PB-LEDGER-FREEZE', 'api.epoch_status', 'runtime-api', 'chain'),
  clause('P-2', 'your USDC balance covers the purchase', 'storage.foreign_assets.account', 'storage', 'acting'),
  clause('P-2', 'your position balance covers the sale', 'storage.ledger.positions', 'storage', 'acting'),
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
  // Fee headroom in the **selected** asset (11 §11.3). One clause per currency, and
  // `rowsFor` selects; a single hardcoded `ForeignAssets` read reported USDC headroom for
  // an account paying in VIT, which is a balance the transaction never touches.
  clause('P-3', 'your fee headroom covers the fee in VIT', 'storage.system.account', 'storage', 'signer', { feeAsset: 'VIT' }),
  clause('P-3', 'your fee headroom covers the fee in USDC', 'storage.foreign_assets.account', 'storage', 'signer', { feeAsset: 'USDC' }),
  clause('P-3', 'the amount is at least the minimum split', 'constant.ledger.min_split', 'constant', 'chain'),
  clause('P-3', 'you have room for each new position key', 'constant.ledger.max_positions_per_account', 'constant', 'chain'),
  // **The per-account count, not the per-position supply.** `PositionTotals`
  // (`pallets/conditional-ledger/src/lib.rs:380`) is the total supply of one position id;
  // the bound the runtime enforces is `PositionCount` (`:375`), a different item, and
  // `TooManyPositions` fires on it. An account already holding 64 positions passed this
  // clause whenever global supply happened to be low — the check was reading a number that
  // has nothing to do with the limit it was cited for.
  //
  // `PositionCount` is not frozen surface, but it does not need to be: `account_positions`
  // returns the account's positions in a `BoundedVec` whose bound *is*
  // `MAX_ACCOUNT_POSITIONS = 64 = MaxPositionsPerAccount`, so its length is the count
  // exactly. Reading the chain's own answer also keeps §11.4 rule 2 — a client deriving
  // the count some other way would be evaluating a computation, not performing a read.
  clause('P-3', 'your current position count leaves room', 'api.account_positions', 'runtime-api', 'acting'),
  // PB-LEDGER-FREEZE. `Constitution.PhaseFlags` is what the *execution guard* reads
  // (`configs.rs:9411`) and it is genuinely correct there — but the ledger keeps its own
  // `FrozenUntil` latch (`lib.rs:438`) and that is what refuses these calls. Phase flags
  // can be entirely green while every ledger call reverts as frozen.
  clause('P-3', 'the ledger is not frozen by PB-LEDGER-FREEZE', 'api.epoch_status', 'runtime-api', 'chain'),
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
  clause('P-4', 'the ledger is not frozen by PB-LEDGER-FREEZE', 'api.epoch_status', 'runtime-api', 'chain'),
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

/**
 * P-6 — `ledger.redeem_scalar` / `redeem_baseline`. The fee is chain-read (contract v17).
 *
 * **The settlement clause is a disjunction and must stay one.** 11 §11.5 reads "proposal
 * vault `ScalarSettled { winner, s }`, **or** Baseline position view `BaselineSettled { s }`"
 * — these are two different calls sharing a row, and no account holds both states for one
 * redemption. Listed flat, they were evaluated conjunctively and blocked every lawful
 * redemption of either kind.
 *
 * **The fee is cross-checked, not merely read.** 11 §11.5 requires the frozen
 * `ConditionalLedger::RedemptionFee` metadata constant *and* raw `params(ledger.redeem_fee)`,
 * with disagreement blocking. Reading one alone is the SQ-581 shape: a value that agrees
 * with itself is not a check, and the whole point is to catch a metadata surface that has
 * drifted from the parameter the runtime actually charges.
 */
const P6: readonly PreconditionClause[] = [
  clause('P-6', 'the vault is ScalarSettled with a settlement value', 'storage.ledger.vaults', 'storage', 'chain', { anyOf: 'P-6/settled' }),
  clause('P-6', 'the Baseline position view is BaselineSettled', 'storage.ledger.baseline_vaults', 'storage', 'chain', { anyOf: 'P-6/settled' }),
  clause('P-6', 'your LONG or SHORT balance covers the amount', 'storage.ledger.positions', 'storage', 'acting'),
  clause('P-6', 'the redemption-fee constant is readable', 'constant.ledger.redemption_fee', 'constant', 'chain'),
  clause('P-6', 'the redemption-fee rate agrees with its raw parameter', 'api.params', 'runtime-api', 'chain'),
];

/** P-7 — `ledger.redeem_scalar_pair` / `redeem_baseline_pair`; payout is exactly `a` gross. */
const P7: readonly PreconditionClause[] = [
  clause('P-7', 'the vault is ScalarSettled', 'storage.ledger.vaults', 'storage', 'chain', { anyOf: 'P-7/settled' }),
  clause('P-7', 'the Baseline position view is BaselineSettled', 'storage.ledger.baseline_vaults', 'storage', 'chain', { anyOf: 'P-7/settled' }),
  clause('P-7', 'you hold at least the amount of both LONG and SHORT', 'storage.ledger.positions', 'storage', 'acting'),
  clause('P-7', 'the redemption-fee constant is readable', 'constant.ledger.redemption_fee', 'constant', 'chain'),
  clause('P-7', 'the redemption-fee rate agrees with its raw parameter', 'api.params', 'runtime-api', 'chain'),
];

/** P-8 — `ledger.redeem_void`. 11 §11.6 owns the row; the vault state is the shared clause. */
const P8: readonly PreconditionClause[] = [
  clause('P-8', 'the vault is Voided', 'storage.ledger.vaults', 'storage', 'chain'),
  // "≥ the amount", not "holds it". A balance clause that only asks whether the entry
  // exists passes for a holder of 1 signing a redemption of 2 — the row is green, the
  // runtime rejects, and the difference between the two readings is the whole check.
  clause('P-8', 'your balance of that position is at least the amount', 'storage.ledger.positions', 'storage', 'acting'),
];

/** P-9 — `ledger.transfer`. */
const P9: readonly PreconditionClause[] = [
  clause('P-9', 'the vault is Open, Resolved or Voided', 'storage.ledger.vaults', 'storage', 'chain'),
  clause('P-9', 'the recipient has room for another position', 'constant.ledger.max_positions_per_account', 'constant', 'recipient'),
  // The per-account count — see P-3. `PositionTotals` is per-position supply and answers a
  // different question entirely.
  clause('P-9', 'the recipient’s current position count leaves room', 'api.account_positions', 'runtime-api', 'recipient'),
  clause('P-9', 'the amount is at least the minimum transfer', 'constant.ledger.min_transfer', 'constant', 'chain'),
  clause('P-9', 'you hold at least the amount being transferred', 'storage.ledger.positions', 'storage', 'acting'),
  // The deposit is taken from the **entry owner**, and 03 §4's storage-deposit paragraph
  // names that explicitly as "the *recipient* on `transfer`". Classified `acting` at
  // first, which is the sender — so a sender with a healthy balance passed the row while
  // the runtime rejected the transfer for the recipient's insufficient deposit headroom.
  // The wording moved with the subject: "you" was the wrong person.
  clause('P-9', 'the recipient can cover the per-entry position deposit', 'constant.ledger.position_deposit', 'constant', 'recipient'),
  // The constant states the *size* of the deposit; it says nothing about whether the
  // recipient can pay it. Reading only the constant made this row pass for a recipient
  // holding no USDC at all — `settle_deposits` then fails, after signature.
  clause('P-9', 'the recipient’s USDC balance covers that deposit', 'storage.foreign_assets.account', 'storage', 'recipient'),
  // The clause 11 §11.5 mandates and this table could not express until contract v25.
  //
  // `ledger.transfer` refuses a protocol destination, and the runtime's test is
  // `ReservedProtocolDestinations::contains` — a `Contains` implementation over a
  // domain-separated address namespace plus a set of PalletId-derived singletons, which
  // is not storage. There was therefore no `SurfaceId` to cite and the clause was simply
  // absent: a user could be walked through a green precondition table to a signature the
  // runtime then refuses (SQ-588).
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

/**
 * P-10 — `epoch.submit`. The preimage must be *noted and pinned*, not merely noted.
 *
 * **The rate limit is keyed to the funder and read from a different item than the queue.**
 * `IntakeQueue` is the 64-entry family cap; the per-account limit is a separate count the
 * runtime takes over `Proposals` filtered by `p.epoch == current && p.funder == funder`
 * (`crates/epoch-core/src/lib.rs:774`) against `params.intake_max_per_account`. Citing the
 * queue for both meant a queue of three with four prior submissions by the same funder read
 * as healthy and returned `IntakeFull` after signature.
 *
 * Two things about that were wrong in **11 §11.5 itself**, and were repaired rather than
 * worked around (R-1): the row said "caller's" where the runtime counts the **funder** —
 * 05 §1.5/E6 split authorship from funding precisely because a cap keyed to the author is
 * satisfiable by minting throwaway authors — and it wrote the bound as the literal `4`,
 * where `intake.max_acct` is META-amendable within [2, 8] (13 §1). A client hardcoding
 * that 4 stops tracking the chain the moment governance moves it, which is the defect
 * 10 §5.4's no-literal gate exists to catch.
 */
const P10: readonly PreconditionClause[] = [
  clause('P-10', 'the epoch is in its Intake phase', 'storage.epoch.epoch_of', 'storage', 'chain'),
  clause('P-10', 'the intake queue has room', 'storage.epoch.intake_queue', 'storage', 'chain'),
  clause('P-10', 'the intake queue bound is not reached', 'constant.epoch.max_intake_queue', 'constant', 'chain'),
  clause('P-10', 'the funder is under the per-epoch intake rate limit', 'api.proposal_summaries', 'runtime-api', 'acting'),
  clause('P-10', 'that rate limit is read live, not assumed', 'api.params', 'runtime-api', 'chain'),
  // The bond is **USDC**: `RuntimeProposalBond::hold` transfers through `ForeignAssets` at
  // `usdc_location()` (`configs.rs:6332`). `System.Account` is the VIT balance and is not
  // touched by a bond hold, so this row passed for an account with no USDC whatsoever.
  clause('P-10', 'your class bond balance in USDC is sufficient', 'storage.foreign_assets.account', 'storage', 'acting'),
  // 11 §11.5 requires the preimage **noted with matching hash + len and pinned** — pinning
  // is a separate storage item from noting, and an unpinned preimage can be reaped between
  // submission and execution (B-13).
  clause('P-10', 'the payload preimage is noted with a matching hash and length', 'storage.preimage.preimage_for', 'storage', 'chain'),
  clause('P-10', 'that preimage is pinned and cannot be reaped', 'storage.preimage.status_for', 'storage', 'chain'),
  clause('P-10', 'every declared resource domain is valid for this class', 'storage.constitution.capabilities', 'storage', 'chain'),
];

/**
 * P-11 — `epoch.withdraw`: Submitted, caller is the proposer **or the funder**, before Qualify.
 *
 * The identity clause was absent entirely, so a third party who could see a `Submitted`
 * proposal was walked to a signature the runtime refuses.
 *
 * It is a **disjunction**, and 11 §11.5 said "caller is proposer" until this review
 * corrected it (R-1). `epoch-core:823` admits `p.proposer == who || p.funder == who`, with
 * the reasoning stated in the source: restricting T2 to the author strands the funder's
 * bond behind an abandoned proposal, and restricting it to the funder lets a funder hold a
 * disowned proposal hostage. Implementing the doc's narrower text would have produced a
 * client that refuses a lawful funder withdrawal — the failure direction 15 §4.8's mirror
 * rule names, and one no amount of testing against the client's own table would surface.
 */
const P11: readonly PreconditionClause[] = [
  clause('P-11', 'the proposal is still Submitted', 'storage.epoch.proposals', 'storage', 'chain'),
  clause('P-11', 'the epoch has not reached Qualify', 'storage.epoch.epoch_of', 'storage', 'chain'),
  clause('P-11', 'you are the proposal’s author', 'api.proposal_summaries', 'runtime-api', 'acting', { anyOf: 'P-11/identity' }),
  clause('P-11', 'or you are the account that funded its bond', 'api.proposal_summaries', 'runtime-api', 'acting', { anyOf: 'P-11/identity' }),
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
  // 12. `FreezeActive`, the never-waived half (11 §11.5 row 12). The guard's own latch and
  //     the DEAD_MAN_ENGAGED phase-flag bit are two reads and two `ensure!` operands; the
  //     D-9 exemption reaches neither.
  clause('P-12', 'the dead-man switch is not engaged', 'storage.execution_guard.dead_man_freeze', 'storage', 'chain'),
  clause('P-12', 'the dead-man phase flag is clear', 'storage.constitution.phase_flags', 'storage', 'chain'),
  // 13. `FreezeActive`, the half the expedited lane waives (11 §11.5 row 13; 09 §3.1).
  //
  //     The runtime is `ensure!(!(ledger_freeze || migration_halt) || expedited)` — a waiver
  //     over the **conjunction**. That is written here as two `anyOf` groups sharing the
  //     expedited clause, because `(¬L ∨ E) ∧ (¬M ∨ E)` ≡ `(¬L ∧ ¬M) ∨ E`. The distributed
  //     form is why the flat group model needs no nesting to express this.
  //
  //     Both halves of getting this wrong are live. Leaving the exemption ungrouped — as
  //     this list did — makes it a *requirement*, so the client refuses the emergency
  //     upgrade during exactly the freeze the lane exists for. Putting all four freeze
  //     clauses in one group instead would let any single one satisfy the whole obligation,
  //     including waiving the dead-man latch. The first is fail-closed, the second
  //     fail-open, and only the runtime's own grouping is neither.
  clause('P-12', 'PB-LEDGER-FREEZE is clear', 'storage.constitution.phase_flags', 'storage', 'chain', { anyOf: 'P-12/ledger-freeze-or-expedited' }),
  clause('P-12', 'or this proposal holds the expedited exemption', 'storage.execution_guard.expedited', 'storage', 'chain', { anyOf: 'P-12/ledger-freeze-or-expedited' }),
  clause('P-12', 'no migration halt is in force', 'storage.execution_guard.migration_halt', 'storage', 'chain', { anyOf: 'P-12/migration-halt-or-expedited' }),
  clause('P-12', 'or this proposal holds the expedited exemption', 'storage.execution_guard.expedited', 'storage', 'chain', { anyOf: 'P-12/migration-halt-or-expedited' }),
  // 13. Batch bounds and the SafetyFilter closure over the decoded preimage.
  clause('P-12', 'the decoded batch is within its call, size and weight bounds', 'api.execution_queue', 'runtime-api', 'chain'),
];

/**
 * P-13 — `oracle.report`. The bond is **not computable by any client** (SQ-598).
 *
 * The bond is **USDC**, not VIT: `configs.rs:7566` is explicit that oracle registration
 * stakes and round-bond collateral are held in `ForeignAssets` USDC custody. Reading
 * `System.Account` reported healthy headroom from a balance the bond never draws on.
 *
 * ## Two disagreeing answers shipped in one client, and this row held the wrong one
 *
 * §11.5's P-13 text says the bond is `max(flat_floor, bps × cohort_escrow)` *"recomputed
 * and displayed"*, and this row declared exactly that: a clause reading a cohort escrow,
 * and a headroom clause against the recomputed amount. `oracle-reporting.ts` had already
 * concluded the opposite and shipped it — the bond is **structurally uncomputable** from
 * any surface 02 freezes, so the module states a floor and refuses to present it as the
 * amount. Nothing bound the two, so a bonded, slashable action carried two different
 * answers to *"what will this hold?"*, in one release.
 *
 * The escrow clause was worse than redundant. It cited `storage.epoch.cohorts` as *"the
 * cohort escrow the bond scales against"*, and `CohortInfo { epoch, proposals, status }`
 * (`pallets/epoch/src/lib.rs:602`) carries **no escrow field at all** — a clause reading a
 * map that cannot answer it, which typechecks because a `SurfaceId` says nothing about
 * what the item holds. It is deleted rather than re-pointed: 07 §6.1's `StakeAtRisk(c, m)`
 * sums escrow over every cohort whose frozen MetricSpec consumes the component, and
 * reassembling that from cohort membership would be a client *computation* where §11.4
 * rule 2 requires an exact read.
 *
 * What survives is what can be read: the floor parameter, and whether the balance covers
 * it. The rest is declared **unreadable** below, with SQ-598 as its citation, so the row
 * states the gap instead of implying an arithmetic nobody can perform.
 *
 * ## *Round open* and *report window not elapsed* are two clauses
 *
 * They were one, and they are distinct for a **counter-report on a live round**: a round
 * still open whose report window has elapsed refuses the report, and one clause covering
 * both cannot say which half failed. §11.5 writes them with a semicolon between them.
 */
const P13: readonly PreconditionClause[] = [
  clause('P-13', 'the round is open', 'storage.oracle.rounds', 'storage', 'chain', { key: 'round-open' }),
  clause('P-13', 'the report window has not elapsed', 'storage.oracle.rounds', 'storage', 'chain', { key: 'report-window' }),
  clause('P-13', 'you are a registered reporter', 'storage.oracle.reporters', 'storage', 'acting', { key: 'registered' }),
  clause('P-13', 'your reporter stake is held in full', 'storage.oracle.reporters', 'storage', 'acting', { key: 'stake-held' }),
  clause('P-13', 'the round-bond floor is read live', 'api.params', 'runtime-api', 'chain', { key: 'bond-floor' }),
  clause('P-13', 'your USDC balance covers at least the bond floor', 'storage.foreign_assets.account', 'storage', 'acting', { key: 'bond-headroom' }),
  clause('P-13', 'an evidence hash is attached to the report', 'storage.oracle.rounds', 'storage', 'chain', { key: 'evidence' }),
];

/** P-14 — `oracle.challenge`. The bond doubles per round against a value-scaled floor. */
const P14: readonly PreconditionClause[] = [
  clause('P-14', 'the round is open and its challenge window has not elapsed', 'storage.oracle.rounds', 'storage', 'chain'),
  clause('P-14', 'any watchtower-quorum extension is accounted for', 'storage.oracle.watchtowers', 'storage', 'chain'),
  // The escalation round is what the doubling is a function of; without it the "escalated
  // bond" is whatever the client last believed the round to be.
  clause('P-14', 'the current escalation round sets the bond multiple', 'storage.oracle.rounds', 'storage', 'chain'),
  clause('P-14', 'your USDC balance covers the escalated bond', 'storage.foreign_assets.account', 'storage', 'acting'),
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
  clause('P-15', 'this crank’s own staleness condition holds', 'storage.epoch.epoch_of', 'storage', 'chain'),
];

/**
 * The crank calls P-15 covers, and the staleness read that answers for **each**.
 *
 * 11 §11.5 says the *"corresponding* staleness precondition", and correspondence is the
 * whole content of the row. The table previously carried four generic clauses — epoch
 * phase, a market, a cohort, a welfare snapshot — and applied all four to every crank, so
 * `ledger.sweep_redemption_fees` was gated on epoch, market and welfare state that has
 * nothing to do with whether any redemption fees have accrued. With zero accrued fees and
 * a busy chain, all four clauses pass and the user signs a guaranteed no-op: a fee paid
 * for nothing, and on screen indistinguishable from the crank having run.
 *
 * **Two of the six have no frozen surface that answers them**, and that is recorded here
 * rather than papered over. `RedemptionFeesAccrued`
 * (`pallets/conditional-ledger/src/lib.rs:404`) and the market's accrued revenue are real
 * runtime state that 02 §7 does not freeze, so no `SurfaceId` cites them and inventing one
 * is the hand-listing app-code rule 7 forbids. The honest encoding is a **named refusal**:
 * the client cannot assert the crank has work, so it falls to the explicit expert override
 * 11 §11.5 already requires for signing a possible no-op. Fail-closed and legible, versus
 * an omitted clause, which reads as "checked, fine".
 *
 * Discriminated rather than `undefined` on purpose — an optional clause makes "no surface
 * answers this" and "nothing to check" the same value, which is the shape every defect in
 * this review round took.
 */
export type CrankCall =
  | 'epoch.tick'
  | 'market.crank_observe'
  | 'market.reap'
  | 'epoch.settle_cohort'
  | 'market.sweep_revenue'
  | 'ledger.sweep_redemption_fees'
  /**
   * §11.8.5's crank, and it was missing from this union.
   *
   * §11.8.5 binds the welfare snapshot to row P-15 by name — *"otherwise 'no-op —
   * nothing to crank' (row P-15)"* — while `CrankCall` listed six members and this was
   * not one. `crankStaleness` **throws** on an unrecognised call by design, so the one
   * crank §11.8's own text puts in the table could not be gated at all: the S18 console
   * had to answer the staleness question itself, which is the re-derivation the table
   * exists to prevent.
   *
   * `Welfare.Snapshots` is frozen surface (02 §7), so this member needs no exemption:
   * unlike the two sweeps, the client can read whether the snapshot exists.
   */
  | 'welfare.record_snapshot';

export type CrankStaleness =
  | { readonly kind: 'readable'; readonly clause: PreconditionClause }
  | { readonly kind: 'unreadable'; readonly reason: string };

const readable = (requirement: string, surface: SurfaceId, source: ClauseSource): CrankStaleness => ({
  kind: 'readable',
  clause: clause('P-15', requirement, surface, source, 'chain'),
});

const unreadable = (reason: string): CrankStaleness => ({ kind: 'unreadable', reason });

const CRANK_STALENESS: Readonly<Record<CrankCall, CrankStaleness>> = {
  'epoch.tick': readable('the epoch has reached its next boundary', 'storage.epoch.epoch_of', 'storage'),
  'market.crank_observe': readable('an observation window is due on this book', 'storage.market.markets', 'storage'),
  'market.reap': readable('this book is archivable', 'storage.market.markets', 'storage'),
  'epoch.settle_cohort': readable('the cohort has reached its settlement point', 'storage.epoch.cohorts', 'storage'),
  'market.sweep_revenue': unreadable(
    'accrued market revenue is not a surface 02 §7 freezes, so this release cannot tell ' +
      'you whether there is anything to sweep. Signing this needs the expert override.',
  ),
  'ledger.sweep_redemption_fees': unreadable(
    'accrued redemption fees (`ConditionalLedger::RedemptionFeesAccrued`) are not a surface ' +
      '02 §7 freezes, so this release cannot tell you whether there is anything to sweep. ' +
      'Signing this needs the expert override.',
  ),
  // Keyed by `(epoch, spec_version)`, which is why the read is the snapshot map rather than
  // the epoch clock: a second admissible MetricSpec version needs its own record, and the
  // epoch boundary alone cannot answer whether *this* version has one. See `snapshotTaken`.
  'welfare.record_snapshot': readable(
    'no snapshot exists for this epoch at this MetricSpec version',
    'storage.welfare.snapshots',
    'storage',
  ),
};

/**
 * The staleness condition for one crank.
 *
 * Throws on an unknown call rather than returning a permissive default: an unrecognized
 * crank is one this table has never been reviewed against, and treating it as
 * unconditionally crankable is how a no-op reaches a signature.
 */
export function crankStaleness(call: CrankCall): CrankStaleness {
  const entry = CRANK_STALENESS[call];
  if (entry === undefined) {
    throw new Error(`no staleness precondition declared for crank "${call}"; refusing to assume it has work`);
  }
  return entry;
}

/** Every crank P-15 covers — exported so a caller cannot silently miss one. */
export const CRANK_CALLS = Object.keys(CRANK_STALENESS) as readonly CrankCall[];

/* ------------------------------------------------------------------ 11 §11.8 operator rows */

/**
 * A read 11 §11.8 requires and 02 freezes no surface for.
 *
 * This is the `CrankStaleness.unreadable` arm generalised, and it exists because the
 * alternative shapes are both wrong. **Omitting** the obligation makes an unperformed
 * check indistinguishable from a passed one, which is the defect every entry below would
 * otherwise be. **Inventing** a `SurfaceId` for it is the hand-listing app-code rule 7
 * forbids, and it would make `surface:check` agree with a fiction.
 *
 * `disposition` is not a severity dial — it records which of two things the specification
 * says, and the two are genuinely different:
 *
 * - **`stated`** — §11.8 accepts that the transaction is offered and requires the gap
 *   named. §11.8.1's SQ-564 paragraph is the worked example: the client *"MUST render both
 *   errors explicitly rather than as a generic failure, and MUST NOT present registration
 *   as unconditionally available"*, which is a caveat, not a disabled control. The cost is
 *   bounded and stated there: one transaction fee.
 * - **`blocking`** — nothing in §11.8 licenses acting on an unread condition, so the
 *   control is closed with the reason named. This is INV-FE-12's fail-closed lattice: an
 *   unproven capability is *absent*, and absence disables the dependent surface.
 *
 * Every entry carries the open spec-question id that owns it, so the declaration expires
 * the way the limit-coverage registry and the monitoring seams do — by the row closing,
 * not by somebody remembering to delete a comment.
 */
export interface UnreadableObligation {
  readonly row: RowId;
  /** The condition §11.8 requires, in the words the user is shown. */
  readonly requirement: string;
  /** Why no frozen surface answers it. */
  readonly reason: string;
  /** The open PLAN.md spec-question id. */
  readonly specQuestion: string;
  readonly disposition: 'stated' | 'blocking';
}

const unread = (
  row: RowId,
  requirement: string,
  reason: string,
  specQuestion: string,
  disposition: 'stated' | 'blocking',
): UnreadableObligation => ({ row, requirement, reason, specQuestion, disposition });

/**
 * Fee headroom in the **selected** asset — 11 §11.3, applied to every operator row.
 *
 * > USDC-only accounts are always viable: every precondition table below computes fee
 * > headroom in the *selected* fee asset.
 *
 * That sentence is normative and scoped to every table under it, so it is written once
 * here rather than forgotten per row. A single hardcoded `ForeignAssets` read would report
 * USDC headroom for an account paying in VIT, which is a balance the transaction never
 * touches; `rowsFor` selects on the asset the user chose.
 */
const feeHeadroom = (row: RowId): readonly PreconditionClause[] => [
  clause(row, 'your fee headroom covers the fee in VIT', 'storage.system.account', 'storage', 'signer', {
    feeAsset: 'VIT',
    key: 'fee-headroom',
  }),
  clause(row, 'your fee headroom covers the fee in USDC', 'storage.foreign_assets.account', 'storage', 'signer', {
    feeAsset: 'USDC',
    key: 'fee-headroom',
  }),
];

/**
 * O-1 — `oracle.register_reporter()` (§11.8.1 row 1).
 *
 * The stake is **USDC** (`configs.rs:7566`), so free balance is a `ForeignAssets` read and
 * `orc.reporter_stake` is read live rather than carried as 13's launch value.
 */
const O1: readonly PreconditionClause[] = [
  clause('O-1', 'you are not already in the reporter registry', 'storage.oracle.reporters', 'storage', 'acting', { key: 'not-registered' }),
  clause('O-1', 'the reporter stake is read live', 'api.params', 'runtime-api', 'chain', { key: 'stake-amount' }),
  clause('O-1', 'your free USDC covers the reporter stake', 'storage.foreign_assets.account', 'storage', 'acting', { key: 'stake-headroom' }),
  ...feeHeadroom('O-1'),
];

/** O-2 — `oracle.recompute_proof(component, epoch, spec_version, proof)` (§11.8.1 row 3). */
const O2: readonly PreconditionClause[] = [
  clause('O-2', 'the round is open', 'storage.oracle.rounds', 'storage', 'chain', { key: 'round-open' }),
  // The *second* half of §11.8.1's row, and the one a client would skip: running an
  // evaluator over a non-deterministic component produces a number, and a number that
  // disagrees with the reporter's is indistinguishable from fraud when it is really a
  // component nobody promised would reproduce.
  clause('O-2', 'this component’s frozen MetricSpec permits deterministic recomputation', 'storage.welfare.metric_specs', 'storage', 'chain', { key: 'deterministic' }),
  ...feeHeadroom('O-2'),
];

/** O-3 — `guardian.approve_action(action_id)` (§11.8.2 approve flow). */
const O3: readonly PreconditionClause[] = [
  clause('O-3', 'you are a guardian', 'storage.guardian.members', 'storage', 'acting', { key: 'member' }),
  clause('O-3', 'the approval threshold and seat count are read live', 'constant.guardian.guardian_threshold', 'constant', 'chain', { key: 'threshold' }),
  // §11.8.2: playbooks are preimage-committed enumerated batches, "decoded and displayed,
  // never summarized away". The preimage itself is frozen surface; the action's link to it
  // is not — see the unreadable list.
  clause('O-3', 'the enumerated call batch’s preimage is noted', 'storage.preimage.preimage_for', 'storage', 'chain', { key: 'batch-preimage' }),
  ...feeHeadroom('O-3'),
];

/** O-4 — `guardian.propose_action(...)` (§11.8.2 propose flow). */
const O4: readonly PreconditionClause[] = [
  clause('O-4', 'you are a guardian', 'storage.guardian.members', 'storage', 'acting', { key: 'member' }),
  clause('O-4', 'this power’s allowance has room', 'storage.guardian.allowances', 'storage', 'acting', { key: 'allowance' }),
  ...feeHeadroom('O-4'),
];

/** O-5 — `futarchy_treasury.claim_stream(stream_id)` (§11.8.3). */
const O5: readonly PreconditionClause[] = [
  // 02 §7.6's closing rule: every treasury consumer binds `nav()` rather than raw state.
  // It is the only treasury read this row can lawfully make, and it publishes the
  // `stream_remainders` aggregate rather than any one stream — see the unreadable list.
  clause('O-5', 'the treasury view the chain publishes is read at B′', 'api.nav', 'runtime-api', 'chain', { key: 'nav' }),
  ...feeHeadroom('O-5'),
];

/** O-6 — `system.apply_authorized_upgrade(code)` (§11.8.4 step 4). */
const O6: readonly PreconditionClause[] = [
  // §11.8.4 step 4's closing clause: "fee headroom for a multi-MB extrinsic (displayed —
  // it is large)". The row carried no fee clause at all until this review.
  ...feeHeadroom('O-6'),
];

/** O-7 — `welfare.record_snapshot(epoch, spec_version)` (§11.8.5, row P-15). */
const O7: readonly PreconditionClause[] = [
  clause('O-7', 'the epoch boundary has passed', 'storage.epoch.epoch_of', 'storage', 'chain', { key: 'boundary' }),
  clause('O-7', 'no snapshot exists for this epoch at this MetricSpec version', 'storage.welfare.snapshots', 'storage', 'chain', { key: 'not-taken' }),
  clause('O-7', 'the MetricSpec version this snapshot would record', 'storage.welfare.metric_specs', 'storage', 'chain', { key: 'spec-version' }),
  ...feeHeadroom('O-7'),
];

/** O-8 — `registry.file_incident(...)` / `file_milestone(...)` (§11.8.6 row 1). */
const O8: readonly PreconditionClause[] = [
  clause('O-8', 'your free USDC covers the filing bond', 'storage.foreign_assets.account', 'storage', 'acting', { key: 'bond-headroom' }),
  ...feeHeadroom('O-8'),
];

/** O-9 — `registry.challenge_filing(epoch, filing_id, evidence_hash)` (§11.8.6 row 2). */
const O9: readonly PreconditionClause[] = [
  // §11.8.6 row 2 requires the **challenge bond balance**, and `mayChallenge` tested only
  // the window: a client offering a challenge the chain refuses for want of bond.
  clause('O-9', 'your free USDC covers the challenge bond', 'storage.foreign_assets.account', 'storage', 'acting', { key: 'bond-headroom' }),
  ...feeHeadroom('O-9'),
];

/** 11 §11.8's rows, as data. Separate from §11.5's fifteen — see `OperatorRowId`. */
export const OPERATOR_ROWS: Readonly<Record<OperatorRowId, readonly PreconditionClause[]>> = {
  'O-1': O1, 'O-2': O2, 'O-3': O3, 'O-4': O4, 'O-5': O5,
  'O-6': O6, 'O-7': O7, 'O-8': O8, 'O-9': O9,
};

export const OPERATOR_ROW_IDS: readonly OperatorRowId[] = Object.freeze(
  Object.keys(OPERATOR_ROWS) as OperatorRowId[],
);

/**
 * The operator calls, each bound to its row.
 *
 * A map rather than a naming convention, because the binding is what a preparation
 * declares and a convention is what a hurried edge ignores. Note that three of these names
 * are disputed between documents — 11 §11.8.6 and 06 §5.1 write
 * `registry.{file_incident, file_milestone, challenge}` while 07 §7 writes
 * `challenge_filing(epoch, filing_id, evidence_hash)` and the runtime has two instances of
 * `file(epoch, class, points, evidence_hash, spec_version)`. The names below are the
 * documents' (§11.8.6 is the owning section for this surface); the disagreement is filed
 * rather than resolved here, because picking one silently is how V-169 happened.
 */
export type OperatorCall =
  | 'oracle.register_reporter'
  | 'oracle.recompute_proof'
  | 'guardian.approve_action'
  | 'guardian.propose_action'
  | 'futarchy_treasury.claim_stream'
  | 'system.apply_authorized_upgrade'
  | 'welfare.record_snapshot'
  | 'registry.file'
  | 'registry.challenge';

export const OPERATOR_CALL_ROWS: Readonly<Record<OperatorCall, OperatorRowId>> = Object.freeze({
  'oracle.register_reporter': 'O-1',
  'oracle.recompute_proof': 'O-2',
  'guardian.approve_action': 'O-3',
  'guardian.propose_action': 'O-4',
  'futarchy_treasury.claim_stream': 'O-5',
  'system.apply_authorized_upgrade': 'O-6',
  'welfare.record_snapshot': 'O-7',
  'registry.file': 'O-8',
  'registry.challenge': 'O-9',
});

/**
 * Every call an §11.8 console submits, bound to the row it declares.
 *
 * Two of them are **not** operator rows, and that is §11.8.1's own routing rather than an
 * exception made here: its table writes `oracle.report` / `oracle.challenge` as *"rows
 * P-13/P-14 (§11.5)"*. A separate `O-n` row for either would be a second table for one
 * obligation, and the two would drift — which is exactly the defect P-13 already carried
 * when a module re-derived its clause list instead of consuming it.
 *
 * The map exists so a console cannot pick its own row. `gate()` verifies the rows a
 * preparation *declares*; nothing in the machine can know whether the declaration is the
 * right one for the call being signed, so that binding has to be data somewhere, and a
 * naming convention is what a hurried edge ignores.
 */
export type OperatorSurfaceCall = OperatorCall | 'oracle.report' | 'oracle.challenge';

export const OPERATOR_SURFACE_ROWS: Readonly<Record<OperatorSurfaceCall, RowId>> = Object.freeze({
  ...OPERATOR_CALL_ROWS,
  'oracle.report': 'P-13',
  'oracle.challenge': 'P-14',
});

/**
 * Every §11.8 read that has no surface behind it, by row.
 *
 * Partial on purpose: an absent row has nothing unreadable, and `unreadableObligationsFor`
 * returns an empty list for it. That is not the same as an empty *array* being meaningful
 * — every entry here is a condition the specification requires and this release cannot
 * evaluate, and each one names the spec question that will retire it.
 */
const UNREADABLE: Partial<Readonly<Record<RowId, readonly UnreadableObligation[]>>> = {
  'P-13': [
    unread(
      'P-13',
      'the bond this report will hold',
      'The bond is value-scaled against `StakeAtRisk(c, m)` — the escrow of every cohort ' +
        'whose frozen MetricSpec consumes this component (07 §6.1) — and 02 freezes no ' +
        'surface publishing it. `open_oracle_rounds()` returns rounds that already exist, ' +
        'so a first report has none to read. What is shown is the floor, which is the least ' +
        'it can be.',
      'SQ-598',
      'stated',
    ),
  ],
  'O-1': [
    unread(
      'O-1',
      'your account carries no retained 07 §3 ejection',
      'The offence record lives in a pallet-internal store 02 §7 deliberately does not ' +
        'freeze. The dispatch error is `ReporterEjected`.',
      'SQ-564',
      'stated',
    ),
    unread(
      'O-1',
      'permissionless entry is not closed by the §3 saturation clause',
      'The same store, and the same reason. The dispatch error is `ReporterRecordsSaturated`.',
      'SQ-564',
      'stated',
    ),
  ],
  'O-3': [
    unread(
      'O-3',
      'the action is pending and unexpired, and you have not already approved it',
      '§11.8.2 calls the guardian pending-action items "frozen in 02", and 02 §7.4 names ' +
        'only membership and allowances. Neither `Guardian.PendingActions` nor its approval ' +
        'set is in the manifest, so S15’s central read has no contract surface.',
      'SQ-616',
      'blocking',
    ),
  ],
  'O-4': [
    unread(
      'O-4',
      'the playbook’s on-chain trigger condition is active at B′',
      'The five triggers §11.8.2 names read five different frozen items, but which trigger ' +
        'a playbook requires is a property of the playbook registration, which 02 does not ' +
        'freeze. `TriggerState.unread` carries the same refusal at the model layer.',
      'SQ-616',
      'blocking',
    ),
  ],
  'O-5': [
    unread(
      'O-5',
      'the stream exists, is not cancelled, and you are its recipient',
      '02 §7 freezes no `pallet-futarchy-treasury` storage, and 02 §7.6’s closing rule says ' +
        'every treasury consumer MUST bind `nav()` rather than raw state — while `nav()` ' +
        'publishes only the `stream_remainders` aggregate. Per-stream reads have no lawful ' +
        'source, so the claimable amount §11.8.3 requires computed client-side has no inputs.',
      'SQ-615',
      'blocking',
    ),
  ],
  'O-6': [
    unread(
      'O-6',
      'an upgrade is authorized, and its stored applicable_at has been reached',
      'Neither `ExecutionGuard.PendingUpgrade` nor `ParachainSystem.AuthorizedUpgrade` is ' +
        'frozen surface. §11.8.4 step 4 also forbids recomputing `applicable_at` from ' +
        '`authorized_at + DescriptorLeadTime`, so the constant this release *can* read is ' +
        'not a substitute (SQ-552).',
      'SQ-615',
      'blocking',
    ),
  ],
  'O-8': [
    unread(
      'O-8',
      'the filing bond amount, and that the registry bounds are not exceeded',
      '07 §7 stores both per instance and 02 §7 freezes no registry storage — only the ' +
        'events. The bond is value-scaled, so it cannot be carried as a constant either.',
      'SQ-619',
      'blocking',
    ),
  ],
  'O-9': [
    unread(
      'O-9',
      'the filing is inside its challenge window, and the challenge bond amount',
      'Registry filings, their windows, watchtower acknowledgements and slash outcomes are ' +
        'all required renders in §11.8.6 with only the *events* frozen in 02 §6. An event ' +
        'stream is not one of §11.4 rule 2’s three precondition sources.',
      'SQ-619',
      'blocking',
    ),
  ],
};

/**
 * What a row requires and this release cannot read.
 *
 * Empty for most rows. A caller MUST consult it — `clauseGroupsFor` alone answers "every
 * declared read passed", which for a row whose reads were never declarable is vacuously
 * true, and that is precisely the shape this list exists to make visible.
 */
export function unreadableObligationsFor(id: RowId): readonly UnreadableObligation[] {
  return UNREADABLE[id] ?? [];
}

/** The obligations that close a control rather than being stated beside it. */
export function blockingObligationsFor(id: RowId): readonly UnreadableObligation[] {
  return unreadableObligationsFor(id).filter((entry) => entry.disposition === 'blocking');
}

/** 11 §11.5's table, as data. */
export const PRECONDITION_ROWS: Readonly<Record<PreconditionRowId, readonly PreconditionClause[]>> = {
  'P-1': P1, 'P-2': P2, 'P-3': P3, 'P-4': P4, 'P-5': P5,
  'P-6': P6, 'P-7': P7, 'P-8': P8, 'P-9': P9, 'P-10': P10,
  'P-11': P11, 'P-12': P12, 'P-13': P13, 'P-14': P14, 'P-15': P15,
};

/**
 * Both tables in one map, which is what `rowsFor` indexes.
 *
 * A merged record rather than two lookups with a fallback: `PRECONDITION_ROWS[id]` for an
 * `O-n` id is `undefined` at runtime and an *error* to the compiler, so the fallback form
 * needed an `as` on each half — two assertions guarding a lookup that a single total record
 * makes unnecessary. `Record<RowId, …>` is total over the union, so a row added to either
 * family without a clause list is a type error here rather than a throw at the call site.
 */
const ALL_ROWS: Readonly<Record<RowId, readonly PreconditionClause[]>> = {
  ...PRECONDITION_ROWS,
  ...OPERATOR_ROWS,
};

/** Every clause, flattened — the form the binding gate checks. Both families. */
export const ALL_CLAUSES: readonly PreconditionClause[] = Object.values(ALL_ROWS).flat();

/** Every row id a preparation may declare from these two tables, in table order. */
export const ROW_IDS: readonly RowId[] = Object.freeze(Object.keys(ALL_ROWS) as RowId[]);

/**
 * The rows a call must satisfy before it may be signed.
 *
 * Throws rather than returning an empty set for an unknown call: an empty precondition
 * set is indistinguishable from "nothing to check", and a call that reached the gate with
 * no rows would pass it. 11 §11.4 rule 1 asks for the gate to be unbypassable, and a
 * silent empty set is a bypass with extra steps.
 */
export function rowsFor(id: RowId, feeAsset: FeeAsset): readonly PreconditionClause[] {
  const rows: readonly PreconditionClause[] | undefined = ALL_ROWS[id];
  if (rows === undefined || rows.length === 0) {
    throw new Error(`no precondition clauses for ${id}; refusing to treat that as "nothing to check"`);
  }
  // `feeAsset` is required rather than defaulted. A default is a decision about someone
  // else's balance made silently: 11 §11.3 promises "USDC-only accounts are always
  // viable", and a table that assumed VIT would tell such an account it has no headroom.
  //
  // Checked at runtime, not only by the compiler. The consumers of this table include
  // untyped JavaScript, and an omitted argument would otherwise match no clause's
  // `feeAsset` and quietly return the row *minus its fee headroom check* — a row that has
  // lost a precondition, reported as a row that passed. The type system cannot reach that
  // caller; this throw can.
  if (!isFeeAsset(feeAsset)) {
    throw new Error(
      `rowsFor(${id}) needs the selected fee asset ('VIT' | 'USDC'); got ${String(feeAsset)}. ` +
        'Fee headroom is read from a different pallet per currency (11 §11.3), so there is ' +
        'no safe default to fall back to.',
    );
  }
  const selected = rows.filter((entry) => entry.feeAsset === undefined || entry.feeAsset === feeAsset);
  if (selected.length === 0) {
    throw new Error(`every clause of ${id} was filtered out by fee asset ${feeAsset}; that is a table defect`);
  }
  return selected;
}

/**
 * Group a row's clauses into the units that must each hold.
 *
 * Returns one entry per independent obligation: a plain clause is its own group, and
 * clauses sharing an `anyOf` id collapse into a single group satisfied by **any** member.
 * Evaluators must consume this rather than the flat list — the flat list is a conjunction,
 * and reading a disjunctive row as a conjunction blocks the lawful case rather than the
 * unlawful one, which is the direction that produces a client refusing what the chain
 * accepts.
 */
export function clauseGroupsFor(
  id: RowId,
  feeAsset: FeeAsset,
): readonly (readonly PreconditionClause[])[] {
  const groups = new Map<string, PreconditionClause[]>();
  const ordered: (readonly PreconditionClause[])[] = [];
  for (const entry of rowsFor(id, feeAsset)) {
    if (entry.anyOf === undefined) {
      ordered.push([entry]);
      continue;
    }
    const existing = groups.get(entry.anyOf);
    if (existing === undefined) {
      const fresh = [entry];
      groups.set(entry.anyOf, fresh);
      ordered.push(fresh);
    } else {
      existing.push(entry);
    }
  }
  return ordered;
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
  id: RowId,
  wrapper: CallWrapper,
  signer: AccountId,
  feeAsset: FeeAsset,
): readonly PreconditionClause[] {
  return rowsFor(id, feeAsset).filter((entry) => {
    if (entry.subject === 'recipient') return true;
    const account = accountForClause(entry, wrapper, signer);
    return account !== undefined && account !== signer;
  });
}
