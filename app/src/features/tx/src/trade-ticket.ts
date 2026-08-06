/**
 * The S3 trade ticket's precondition rows — 11 §11.5 P-1 and P-2.
 *
 * `packages/protocol` answers *what will this trade charge*; this module answers
 * *may it be signed at all*, which is a different question with a different
 * failure mode. Every row here is a refusal the runtime would also make, and the
 * discipline of 11 §11.4 is that the client makes it **first**, so a user is not
 * charged a fee for a transaction that was never going to succeed.
 *
 * ## The inputs are `Finalized<T>`, and that is the row nobody can forget
 *
 * 11 §11.4 rule 4 is one sentence — *"provider/local-index data never satisfies any
 * precondition"* — and a `Verified<T>` parameter makes it a review obligation repeated
 * at every call site. A `provider` read is a perfectly well-formed `Verified<T>`, so a
 * ticket assembled from an operator snapshot would return an empty block list and read
 * as *every precondition passed*. `Finalized<T>` is constructible only inside
 * `@bleavit/chain-client` (10 §2.1), so here the wrong input does not typecheck. That
 * is the same control `transaction-builder`'s `evaluate` uses, for the same reason.
 *
 * The type carries the block but cannot compare two of them, so **one pin across every
 * leaf is a row**. §11.4 pins a single B′ per gate: rows read at two blocks are each
 * true and their conjunction describes a state that never existed, which is exactly
 * what nothing on screen distinguishes from a state that did.
 *
 * ## Three rows carry real safety content and the rest are bookkeeping
 *
 * 1. **The two fee representations must agree.** 02 §9 rule 4 publishes the trade
 *    fee twice — as the `Market::Fee` basis-point metadata constant and as raw
 *    `params(mkt.fee)` in `Perbill` — and P-1 requires the client to cross-check
 *    them by the floored `Perbill / 100,000` projection. They are the same number
 *    from two surfaces, so a disagreement means one of them is stale, and quoting
 *    from the stale one produces a `max_cost` the chain refuses. Neither is
 *    preferred on disagreement: the ticket blocks.
 * 2. **`quote()` and the client recompute must agree** or trading is blocked with
 *    `FE-CHAIN-005`. Agreement here is **exact**, not approximate, and that is a
 *    stronger reading than P-1's *"within the fixed-point bounds"* on purpose:
 *    `packages/protocol` reproduces the runtime's integer path — the same three
 *    roundings in the same order — and `crates/market-core/fixtures/chain-quote-agreement.json`
 *    certifies that it lands on the same base unit. A tolerance would admit a
 *    disagreement the port is built not to have, and the direction that matters is
 *    the unsafe one: a quote a base unit under the chain's charge hands the user a
 *    transaction that reverts (04 §6.1 step 4). Both published fields are compared,
 *    not their sum: a chain `cost`/`fee` of `(100, 3)` against a client `(101, 2)`
 *    agrees on a buy's total and disagrees on a sell's net.
 * 3. **The owning proposal must be in `Trading` or `Extended`, and nothing else.**
 *    P-1 says *"— **only**"*, because D-8 cut forecast trading: books close at
 *    branch resolution and never reopen. A `Resolved` book that still answered
 *    quotes would be a screen selling a claim that cannot be created.
 *
 * ## A buy and a sell are not one row set, and the difference is money
 *
 * P-1 states two of its rows per direction, and a ticket that carried no direction
 * could implement neither. **The slippage recheck** — *"recheck `max_cost`/`min_proceeds`
 * still satisfiable"* — compares the refreshed quote against the ceiling or floor this
 * ticket will encode, which the runtime enforces at 04 §6.1 step 4. Without it every
 * other row passes on a buy drafted at `max_cost = 1,002,000` whose refreshed charge is
 * `1,003,000`, and the signed call comes back `SlippageExceeded`. **The balance row**
 * reads *"user USDC balance (buy) / position balance (sell)"*: a sell delivers `amount`
 * position units and receives USDC, so comparing the seller's holdings against the
 * quoted proceeds admits a user who holds less than they are selling whenever the
 * proceeds happen to be smaller.
 *
 * ## What this module does not do
 *
 * It computes no quote and reads no chain. Both quotes arrive as arguments — the
 * chain's and the client's — because a module that recomputed one of them could
 * not be the thing that compares them. The one figure it derives is 04 §6.1's own
 * combination of the two fields `QuoteView` already publishes (02 §4): `cost + fee`
 * debited on a buy, `cost − fee` credited on a sell. And it names no fee rate, no
 * minimum and no maximum: every one is a chain read supplied by the caller, so a
 * client that forgot to read one gets a type error rather than a launch value baked
 * into a precondition (app-code rule 7).
 *
 * ## Hosted books relax nothing
 *
 * 11 §11.2a rule 4 is explicit that §11.3–§11.4 apply unchanged to external books.
 * `book.domain` is carried so a caller must have established it (rule 1) before it
 * can build the inputs at all, and it changes **no** row here — it is rendered, not
 * branched on. A row that softened for hosted books would be the relaxation the
 * rule forbids.
 *
 * @see docs/architecture/11-frontend-workflows.md §11.5, §11.4, §11.2a
 * @see docs/architecture/04-markets-and-pricing.md §6.1, §8.3, §8.4
 * @see docs/architecture/02-integration-contract.md §4 (`QuoteView`)
 */

import type { Finalized } from '@bleavit/chain-client';

import type { LedgerDomain } from './ledger-domain.js';

/** A reason the ticket cannot be signed. Rendered with what it read (INV-FE-14). */
export interface TradeBlock {
  /** The §11.5 row or check this comes from, for the expected/actual display. */
  readonly check: string;
  readonly detail: string;
  /** Set where the spec names a code for this refusal. */
  readonly code?: 'FE-CHAIN-005';
}

/** The lifecycle states a proposal's books may be traded in (P-1: these only). */
export type TradableState = 'Trading' | 'Extended';

/** Every proposal state the client can observe on the owning proposal. */
export type ProposalState =
  | TradableState
  | 'Submitted'
  | 'Qualified'
  | 'Seeded'
  | 'Deciding'
  | 'Resolved'
  | 'Settled'
  | 'Rejected'
  | 'Withdrawn'
  | 'Voided';

/** Which book this ticket trades. Baseline carries P-2's extra rows. */
export type BookKind = 'decision' | 'gate' | 'baseline';

export interface BookIdentity {
  readonly kind: BookKind;
  /** Established by the §11.2a rule-1 bit test before these inputs were built. */
  readonly domain: LedgerDomain;
}

/** The two published forms of the trade fee (02 §9 rule 4). */
export interface FeeReadings {
  /** `Market::Fee`, in basis points, from the constants API. */
  readonly metadataBps: Finalized<bigint>;
  /** Raw `params(mkt.fee)`, a `Perbill` inner scalar. */
  readonly paramsPerbill: Finalized<bigint>;
}

/**
 * `QuoteView`'s two monetary fields (02 §4), kept apart because 04 §6.1 combines
 * them differently per direction and because a sum hides a disagreement in either.
 */
export interface QuoteFigures {
  /** USDC the wrapper charges (buy) or pays (sell), excluding the fee. */
  readonly cost: bigint;
  /** USDC fee at the current `mkt.fee`. */
  readonly fee: bigint;
}

/** The chain's own quote and the client's recompute of the same trade. */
export interface QuoteAgreement {
  /** `quote()`'s `QuoteView` figures at B′ — one runtime-API read, so one pin. */
  readonly fromChain: Finalized<QuoteFigures>;
  /** `packages/protocol`'s figures for the same book state, amount and side. */
  readonly fromClient: QuoteFigures;
}

/**
 * The direction and the slippage limit this ticket will encode (04 §6.1).
 *
 * A union rather than a direction plus two optional limits: a buy has no
 * `min_proceeds` and a sell has no `max_cost`, and a shape that admitted both would
 * let a ticket be built with neither — a signed trade carrying no slippage bound at
 * all, which is what 11 §11.14's *"never widens a limit"* rule exists to prevent on
 * the import path.
 */
export type TradeOrder =
  | {
      readonly direction: 'buy';
      /** `cost + fee ≤ max_cost` is the runtime's own check (04 §6.1 step 4). */
      readonly maxCost: bigint;
    }
  | {
      readonly direction: 'sell';
      /** `min_proceeds` bounds the USDC-equivalent **net** the seller receives. */
      readonly minProceeds: bigint;
    };

export type TradeDirection = TradeOrder['direction'];

export interface TradeInputs {
  readonly book: BookIdentity;
  /** What is being signed: the side, and the ceiling or floor it encodes. */
  readonly order: TradeOrder;
  /** Absent for a Baseline book, which has no owning proposal (04 §6.1). */
  readonly proposalState?: Finalized<ProposalState>;
  /** `Market.Markets[id].phase` — a book stops quoting when it is not open. */
  readonly marketOpen: Finalized<boolean>;
  readonly fee: FeeReadings;
  readonly quote: QuoteAgreement;
  /** The trade size in base units, as the user entered it. */
  readonly amount: bigint;
  /** `MinTrade` / `MaxTrade` from the constants API — chain reads, never defaults. */
  readonly minTrade: Finalized<bigint>;
  readonly maxTrade: Finalized<bigint>;
  /** Spendable balance on the side being traded: USDC on a buy, positions on a sell. */
  readonly spendable: Finalized<bigint>;
  /** `Constitution.PhaseFlags`'s trading-enabled bit. */
  readonly tradingEnabled: Finalized<boolean>;
  /** PB-LEDGER-FREEZE (06 §6.3) — a freeze blocks every ledger-touching call. */
  readonly ledgerFrozen: Finalized<boolean>;
  /** P-2 only: `BaselineMarketOf(epoch)` resolved to a live book. */
  readonly baselineBookPresent?: Finalized<boolean>;
  /** P-2 only: the epoch trading window, incl. any pair still in `Extended`. */
  readonly baselineWindowOpen?: Finalized<boolean>;
  /** P-2 only: `BaselineVaults(epoch)` still open (03). */
  readonly baselineVaultOpen?: Finalized<boolean>;
}

/** `Perbill → basis points`, floored — the 02 §9 rule 4 projection. */
export function perbillToBps(perbill: bigint): bigint {
  if (perbill < 0n) throw new RangeError('a Perbill rate cannot be negative');
  return perbill / 100_000n;
}

/**
 * What this order moves in USDC: the total debited on a buy, the net credited on a
 * sell (04 §6.1 — the fee is added to the buyer's cost and withheld from the
 * seller's proceeds).
 *
 * Exported because the same figure is the headline on the confirm screen and the
 * one the slippage bound is compared against, and two derivations of it would be
 * two chances to combine the fields the wrong way round.
 */
export function orderTotal(direction: TradeDirection, quote: QuoteFigures): bigint {
  return direction === 'buy' ? quote.cost + quote.fee : quote.cost - quote.fee;
}

const TRADABLE: readonly ProposalState[] = Object.freeze(['Trading', 'Extended']);

/** Every finalized read this ticket was assembled from, labelled for the pin row. */
function pinnedLeaves(inputs: TradeInputs): readonly (readonly [string, Finalized<unknown>])[] {
  const optional = ([label, read]: readonly [string, Finalized<unknown> | undefined]) =>
    read === undefined ? [] : [[label, read] as const];
  return [
    ...optional(['the proposal state', inputs.proposalState]),
    ['the market phase', inputs.marketOpen],
    ['Market::Fee', inputs.fee.metadataBps],
    ['params(mkt.fee)', inputs.fee.paramsPerbill],
    ['quote()', inputs.quote.fromChain],
    ['MinTrade', inputs.minTrade],
    ['MaxTrade', inputs.maxTrade],
    ['the spendable balance', inputs.spendable],
    ['PhaseFlags', inputs.tradingEnabled],
    ['the ledger freeze', inputs.ledgerFrozen],
    ...optional(['BaselineMarketOf(epoch)', inputs.baselineBookPresent]),
    ...optional(['the epoch trading window', inputs.baselineWindowOpen]),
    ...optional(['BaselineVaults(epoch)', inputs.baselineVaultOpen]),
  ];
}

/**
 * Every §11.5 P-1/P-2 row that refuses this ticket, in the order a screen shows
 * them. An empty array means the pre-sign gate may proceed to `refreshAndGate`.
 *
 * Rows are evaluated **independently** and all failures are returned. Stopping at
 * the first would show a user one obstacle at a time across as many signing
 * attempts as they have problems, and §11.4 rule 5 asks for the diff, not the
 * first difference.
 */
export function tradeBlocks(inputs: TradeInputs): readonly TradeBlock[] {
  const blocks: TradeBlock[] = [];

  // §11.4: one B′ per gate. Every leaf is finalized by its type, so what remains
  // checkable is whether they are the *same* finalized block — a ticket assembled
  // from two of them is a set of individually true rows about no state at all.
  const byPin = new Map<string, string[]>();
  for (const [label, read] of pinnedLeaves(inputs)) {
    const pin = `${read.status.chain} block ${read.status.blockNumber} (${read.status.blockHash})`;
    byPin.set(pin, [...(byPin.get(pin) ?? []), label]);
  }
  if (byPin.size > 1) {
    const spread = [...byPin].map(([pin, labels]) => `${labels.join(', ')} at ${pin}`).join('; ');
    blocks.push({
      check: 'ticket pin',
      detail:
        `this ticket mixes blocks — ${spread}. Every precondition is read at one B′ ` +
        '(11 §11.4), and rows from two blocks describe a state that never existed',
    });
  }

  // P-1: the owning proposal, and *only* Trading/Extended (D-8 cut forecast
  // trading, so a Resolved book that still quoted would sell an uncreatable claim).
  if (inputs.book.kind === 'baseline') {
    if (inputs.proposalState !== undefined) {
      blocks.push({
        check: 'book identity',
        detail: 'a Baseline book has no owning proposal; this ticket was built from two models',
      });
    }
  } else if (inputs.proposalState === undefined) {
    blocks.push({
      check: 'P-1 proposal state',
      detail: 'the owning proposal state was not read; an unread precondition is not a passed one',
    });
  } else if (!TRADABLE.includes(inputs.proposalState.value)) {
    blocks.push({
      check: 'P-1 proposal state',
      detail: `the owning proposal is ${inputs.proposalState.value}; trading is admitted only in Trading or Extended`,
    });
  }

  if (!inputs.marketOpen.value) {
    blocks.push({ check: 'P-1 market phase', detail: 'this book is not open' });
  }

  // P-1: the two published fee representations must agree under the 02 §9 rule 4
  // projection. Neither is preferred on disagreement — one of them is stale, and
  // quoting from the stale one produces a max_cost the chain refuses.
  const projected = perbillToBps(inputs.fee.paramsPerbill.value);
  if (projected !== inputs.fee.metadataBps.value) {
    blocks.push({
      check: 'P-1 fee cross-check',
      detail:
        `Market::Fee reads ${inputs.fee.metadataBps.value} bps and params(mkt.fee) projects to ` +
        `${projected} bps; the two published forms of one rate disagree, so neither can be quoted from`,
    });
  }

  // P-1: FE-CHAIN-005. Exact, because the port reproduces the runtime's integer
  // path and `chain-quote-agreement.json` certifies the same base unit. Compared
  // field by field: one sum can hide two offsetting differences, and which of them
  // matters depends on the direction.
  const chainQuote = inputs.quote.fromChain.value;
  const clientQuote = inputs.quote.fromClient;
  if (chainQuote.cost !== clientQuote.cost || chainQuote.fee !== clientQuote.fee) {
    blocks.push({
      check: 'P-1 quote agreement',
      code: 'FE-CHAIN-005',
      detail:
        `quote() reports cost ${chainQuote.cost} and fee ${chainQuote.fee} base units, and the ` +
        `client recomputes cost ${clientQuote.cost} and fee ${clientQuote.fee}; trading is ` +
        'blocked until they agree',
    });
  }

  // P-1: "recheck max_cost/min_proceeds still satisfiable". The refreshed quote is
  // compared against the bound this ticket will encode, which is the same test the
  // runtime makes at 04 §6.1 step 4 — after the user has paid a transaction fee.
  const total = orderTotal(inputs.order.direction, chainQuote);
  if (inputs.order.direction === 'buy') {
    if (total > inputs.order.maxCost) {
      blocks.push({
        check: 'P-1 slippage bound',
        detail:
          `the refreshed charge is ${total} base units and this ticket encodes max_cost ` +
          `${inputs.order.maxCost}; the runtime refuses a buy whose cost plus fee exceeds it`,
      });
    }
  } else if (total < inputs.order.minProceeds) {
    blocks.push({
      check: 'P-1 slippage bound',
      detail:
        `the refreshed net proceeds are ${total} base units and this ticket encodes min_proceeds ` +
        `${inputs.order.minProceeds}; the runtime refuses a sale that pays less`,
    });
  }

  // P-1: per-trade bounds, both from the constants API.
  if (inputs.amount < inputs.minTrade.value) {
    blocks.push({
      check: 'P-1 per-trade minimum',
      detail: `${inputs.amount} is below MinTrade (${inputs.minTrade.value})`,
    });
  }
  if (inputs.amount > inputs.maxTrade.value) {
    blocks.push({
      check: 'P-1 per-trade maximum',
      detail: `${inputs.amount} is above MaxTrade (${inputs.maxTrade.value})`,
    });
  }

  // P-1 reads "user USDC balance (buy) / position balance (sell)", and the two are
  // different quantities in different assets. On a buy the balance is checked
  // against the **charge**, not the amount, because those differ by the fee and
  // checking the amount passes a trade the runtime refuses for want of the last few
  // base units. On a sell the seller delivers positions and receives USDC, so the
  // holdings are checked against the amount: comparing them against the proceeds
  // passes a user who holds less than they are selling whenever the sale pays less
  // than they hold.
  if (inputs.order.direction === 'buy') {
    if (inputs.spendable.value < total) {
      blocks.push({
        check: 'P-1 USDC balance',
        detail: `the charge is ${total} base units and ${inputs.spendable.value} is available`,
      });
    }
  } else if (inputs.spendable.value < inputs.amount) {
    blocks.push({
      check: 'P-1 position balance',
      detail:
        `this sale delivers ${inputs.amount} position units and ${inputs.spendable.value} is held`,
    });
  }

  if (!inputs.tradingEnabled.value) {
    blocks.push({
      check: 'P-1 PhaseFlags',
      detail: 'the constitution’s trading-enabled bit is clear',
    });
  }
  if (inputs.ledgerFrozen.value) {
    blocks.push({ check: 'P-1 PB-LEDGER-FREEZE', detail: 'a ledger freeze is active' });
  }

  if (inputs.book.kind === 'baseline') {
    // P-2. Each is fail-closed on an unread input: 04 §8.3 says either absent
    // blocks trading, and §11.5's reaped-book paragraph forbids rendering a
    // missing book's fail-closed zero as a market price.
    const row = (
      value: Finalized<boolean> | undefined,
      check: string,
      absent: string,
      unmet: string,
    ): void => {
      if (value === undefined) blocks.push({ check, detail: absent });
      else if (!value.value) blocks.push({ check, detail: unmet });
    };
    row(
      inputs.baselineBookPresent,
      'P-2 Baseline book',
      'BaselineMarketOf(epoch) was not read',
      'the Baseline book is absent — reaped or archived; it is not a book with a zero price',
    );
    row(
      inputs.baselineWindowOpen,
      'P-2 epoch trading window',
      'the epoch trading window was not read',
      'the epoch trading window is closed and no epoch-e pair remains in Extended',
    );
    row(
      inputs.baselineVaultOpen,
      'P-2 BaselineVaults',
      'BaselineVaults(epoch) was not read',
      'the Baseline vault for this epoch is not open',
    );
  } else if (
    inputs.baselineBookPresent !== undefined ||
    inputs.baselineWindowOpen !== undefined ||
    inputs.baselineVaultOpen !== undefined
  ) {
    blocks.push({
      check: 'book identity',
      detail: 'P-2 Baseline reads were supplied for a book that is not the Baseline book',
    });
  }

  return blocks;
}

/** Whether the ticket may hand off to `refreshAndGate` (11 §11.4 rule 1). */
export function mayPrepareTrade(inputs: TradeInputs): boolean {
  return tradeBlocks(inputs).length === 0;
}
