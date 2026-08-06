/**
 * S3's reads — the book, the chain's quote, and the client's own recompute beside it.
 *
 * 11 §11.2's S3 row names `Market.Markets`, `BaselineMarketOf` and *"`quote()` + client LMSR
 * cross-check"*. This module performs exactly those and assembles the `TradeInputs`
 * `trade-ticket.ts` evaluates; it decides nothing about admissibility and computes no fee.
 *
 * ## What is read here and what arrives as a parameter
 *
 * Storage and runtime-API reads happen here. **Constants-API reads do not** — §11.4 rule 2
 * makes them a different kind of read, re-evaluated only when the compat layer sees a new
 * `spec_version`, and they are shared across every screen. So `Market::Fee`, `MinTrade` and
 * `MaxTradeRatio` arrive as parameters, exactly as `funding-reads.ts` takes the USDC location
 * and the D-13 caps. Each is required with no default, so a client that forgot to read one
 * gets a type error rather than a launch value baked into a precondition (app-code rule 7).
 *
 * ## `MaxTrade` is derived, never read
 *
 * 02 §9 freezes `Market::MaxTradeRatio`, not a per-trade ceiling: the ceiling is
 * `b · numerator / denominator` and depends on the book. It is computed by
 * `maxTradeAmount` from `@bleavit/protocol` — the same function the quote pipeline uses —
 * rather than re-derived here, because a second implementation of a bound is this
 * repository's most-repeated defect and this one has a nasty property: both of
 * `market-core`'s degenerate cases return **zero** rather than erroring, and a client that
 * "improved" that to a throw would refuse trades the chain admits.
 *
 * ## Trading enablement is PhaseFlags **bit 5**, and that took establishing
 *
 * §11.5 P-1 asks for *"`Constitution.PhaseFlags` trading-enabled bit set; no PB-LEDGER-FREEZE
 * active"* as two clauses, and 02 §7.3's bit table assigns **no bit named "trading enabled"**.
 * Guessing one is what R-2 forbids, so the reading was established from the documents that do
 * assign it: 02 §7.3 calls `PhaseFlags` *"the key the frontend binds trading enablement … to"*
 * and assigns bit 5 to `ledger frozen (PB-LEDGER-FREEZE)`; 06 §6.3 makes bit 5 one leg of a
 * three-part applied-effect tuple with live `ledger.FrozenUntil` and live `market.FrozenUntil`
 * that *"must all agree"*, written only by the PB-LEDGER-FREEZE path, and says the public
 * status surfaces read *"the actual bit-5/effect state"*. There is exactly one trading-related
 * bit, and both of P-1's clauses are it.
 *
 * So both `TradeInputs` fields are derived from bit 5 and neither is invented. They stay two
 * fields because `trade-ticket.ts` owns that shape and a hosted book relaxes nothing about it.
 *
 * ## Every leaf is a real read, and this module mints no provenance (V-182)
 *
 * `TradeInputs`' leaves are `Finalized<T>` because 11 §11.4 rule 4 says provider data never
 * satisfies a precondition, and the brand is what makes that structural (10 §2.1). This
 * module obtains them the only way a module outside `packages/chain-client` can: from the
 * transport it already reads through. `reader.storage` and `reader.crossCheckedCall` return
 * `Finalized<…>`, `derive` projects one of those, and `meet` combines two — so every leaf
 * below descends from a read that was actually made.
 *
 * It did not, until this file was repaired. A local helper wrapped any value in a
 * hand-written finalized status object: brand-less, structurally a `Verified<T>`, and
 * applied to nine values — two of them caller-supplied inputs the chain was never asked
 * about, and two more the *payload* of caller-supplied `Verified<T>`s whose own status it
 * discarded. A `provider` bounds read went in and a finalized-looking `MinTrade` came out,
 * which is INV-FE-1's promotion performed by a helper function. `app/tests/screens` asserts
 * over this file's source that no such status is constructed here again, because neither
 * `check:casts` nor the render gate can see that shape.
 *
 * The caller-supplied readings are therefore `Finalized<T>` too, and they are checked
 * against this reader's pin (`assertOnePin`) rather than trusted: §11.4 pins a single B′
 * per gate, and rows from two blocks are each true of a state that never existed. That is
 * a client defect rather than a chain state, so it throws — the same answer
 * `readDepositInputs` gives a cap read on the wrong chain, and `FinalizedReader.domained`
 * gives a value read at another block.
 *
 * @see docs/architecture/11-frontend-workflows.md §11.2, §11.4, §11.5
 * @see docs/architecture/02-integration-contract.md §4, §7.1, §7.3, §9
 * @see docs/architecture/10-frontend-architecture.md §2.1, §2.2
 */

import { derive, meet, type Finalized, type FinalizedBlockRef, type StorageItem } from '@bleavit/chain-client';
import { maxTradeAmount, type BookState, type TradeBounds } from '@bleavit/protocol';
import { combine, type Verified } from '@bleavit/shared-types';

import { assertOnePin } from './core-screen-reads.js';
import type { MarketTradeScreen } from './market-trade.js';
import type { UndecodableRead } from './positions.js';
import {
  orderTotal,
  type BookIdentity,
  type ProposalState,
  type QuoteFigures,
  type TradeInputs,
  type TradeOrder,
} from './trade-ticket.js';

/** A decode failure is data, not an exception — INV-FE-12. */
export type Decoded<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string };

/** The frozen 02 §7.1/§7.3/§3 surfaces this screen reads. */
export const MARKET_READS = Object.freeze({
  markets: 'Market.Markets',
  baselineMarketOf: 'Market.BaselineMarketOf',
  quote: 'quote',
  phaseFlags: 'Constitution.PhaseFlags',
} as const);

/**
 * 02 §7.3 bit 5, `ledger frozen (PB-LEDGER-FREEZE)`.
 *
 * Named here for the reason `SUDO_PRESENT_BIT` is named in `funding-reads.ts`: `PhaseFlags`
 * is a `u32` **bitset** with no ordering, and V-115 is the record of what a numeric
 * comparison does to it. A bit assignment is wire format frozen in 02 §7.3 — the same class
 * as a call index — not a tunable with a metadata home, and `app/tests/screens` binds this
 * value to that section's own sentence so a reassignment fails the suite.
 */
export const LEDGER_FROZEN_BIT = 1 << 5;

export function ledgerFrozen(phaseFlags: number): boolean {
  return (phaseFlags & LEDGER_FROZEN_BIT) !== 0;
}

/**
 * Trading enablement, which is the same bit read the other way (see the module note).
 *
 * Written as its own function rather than as `!ledgerFrozen(f)` at the call site, so the
 * derivation is stated once and the §11.5 P-1 clause it answers is named beside it.
 */
export function tradingEnabled(phaseFlags: number): boolean {
  return !ledgerFrozen(phaseFlags);
}

/** One pin, storage reads at it, and the FE-P2 cross-checked call. Structural. */
export interface MarketReader {
  readonly at: FinalizedBlockRef;
  storage(
    key: string,
    type?: 'value' | 'descendantsValues',
  ): Promise<Finalized<readonly StorageItem[]>>;
  crossCheckedCall(source: {
    readonly api: string;
    readonly storagePrefix: string;
    readonly argsHex?: string;
  }): Promise<Finalized<{ readonly result: string; readonly witness: readonly StorageItem[] }>>;
}

/**
 * Storage-key construction, injected — `packages/chain-client` is the only package that may
 * import `polkadot-api` (10 §10.1). Per-surface, never one generic `key(pallet, item, …)`:
 * a wrong key encodes to *something*, returns no value, and an absent book is
 * indistinguishable from a reaped one, which is the exact confusion §11.5 forbids.
 */
export interface MarketKeys {
  /** 02 §7.1 — `Market.Markets(id)`. */
  market(bookId: bigint): string;
  /** 02 §7.1 — `Market.BaselineMarketOf(epoch)`. */
  baselineMarketOf(epoch: number): string;
  /** The 32-byte `Market.Markets` prefix, for the FE-P2 cross-check of `quote()`. */
  marketsPrefix(): string;
  /** 02 §7.3 — `Constitution.PhaseFlags`. */
  phaseFlags(): string;
}

export interface MarketDecoders {
  /** `Market.Markets[id]`. `undefined` for an absent book — not a decode failure. */
  readonly market: (
    raw: string,
  ) => Decoded<{ readonly open: boolean; readonly book: BookState } | undefined>;
  /** `Market.BaselineMarketOf(epoch)`. `undefined` means the mapping is absent (reaped). */
  readonly baselineMarketOf: (raw: string) => Decoded<bigint | undefined>;
  /**
   * `quote()`'s `QuoteView`, reduced to the two monetary fields 02 §4 publishes.
   *
   * Both, never their sum: 04 §6.1 debits `cost + fee` on a buy and credits `cost − fee`
   * on a sell, so one figure hides two offsetting differences and hides them in exactly
   * the direction the sell side would not survive.
   */
  readonly quote: (raw: string) => Decoded<QuoteFigures>;
  readonly phaseFlags: (raw: string) => Decoded<number>;
}

export interface MarketReadParams {
  /**
   * Which book this ticket trades, with the provenance it was resolved under.
   *
   * A `Verified<bigint>` rather than a bare `bigint` because the id is *rendered*, and a
   * rendered chain reference needs a status (INV-FE-9). It is the caller's, and it is
   * passed through rather than re-stamped: a decision book's id comes from the proposal
   * record and a Baseline book's from cohort history, so the honest badge is whatever
   * that read carried — this module cannot make an input more verified by holding it.
   */
  readonly bookId: Verified<bigint>;
  /** Established by the §11.2a rule-1 bit test before this read was requested. */
  readonly book: BookIdentity;
  /** The side being traded and the slippage bound it will encode (04 §6.1 step 4). */
  readonly order: TradeOrder;
  /** Absent for a Baseline book, which has no owning proposal (04 §6.1). */
  readonly proposalState?: Finalized<ProposalState> | undefined;
  /**
   * Baseline books only — the epoch whose mapping decides reaped-vs-live (§11.5).
   *
   * Carries its provenance for {@link MarketReadParams.bookId}'s reason: §11.5's rule
   * begins *"when cohort history identifies epoch `e`"*, so the epoch is that read's
   * value and renders under that read's badge.
   */
  readonly epoch?: Verified<number> | undefined;
  /** The trade size as the user entered it, in base units. */
  readonly amount: bigint;
  /** `quote()`'s SCALE arguments, encoded by the caller's codecs. */
  readonly quoteArgsHex: string;
  /**
   * The client's own recompute of this trade — `quoteBuy`/`quoteSell` from
   * `@bleavit/protocol`, whose `BuyQuote`/`SellQuote` already publish `cost` and `fee`
   * separately.
   *
   * It arrives as a parameter and is not computed here, for `trade-ticket.ts`'s reason
   * one layer down: the module that recomputed one of the two quotes could not be the
   * thing that compares them. The caller MUST compute it over the book state at this
   * reader's pin — a recompute against a book read at another block disagrees with
   * `quote()` for a reason that has nothing to do with the port, and `FE-CHAIN-005` tells
   * the user there is nothing to retry.
   */
  readonly clientQuote: QuoteFigures;
  /** `Market::Fee` `[C]`, basis points. */
  readonly feeMetadataBps: Finalized<bigint>;
  /** Raw `params(mkt.fee)`, a `Perbill` inner scalar (02 §9 rule 4). */
  readonly feeParamsPerbill: Finalized<bigint>;
  /** `Market::MinTrade` and `Market::MaxTradeRatio` `[C]` — no defaults. */
  readonly bounds: Finalized<TradeBounds>;
  /** USDC on a buy, position balance on a sell. Read by the balances layer. */
  readonly spendable: Finalized<bigint>;
  /** P-2 only: the epoch trading window, incl. any pair still in `Extended` (04 §8.4). */
  readonly baselineWindowOpen?: Finalized<boolean> | undefined;
  /** P-2 only: `BaselineVaults(epoch)` still open (03). */
  readonly baselineVaultOpen?: Finalized<boolean> | undefined;
}

/**
 * What the read produced.
 *
 * `corrupt` is its own arm because §11.5 gives it its own consequence: *"A present mapping
 * with an absent or mismatched book is corrupt chain state and triggers the compatibility
 * hard block."* That is a shell-level verdict, not a screen state, so this module reports it
 * and the composition root escalates — rather than this module reaching into the compat
 * machine, or worse, rendering the reaped label for a state that is not reaped.
 */
export type MarketTradeRead =
  | {
      readonly kind: 'screen';
      readonly screen: MarketTradeScreen;
      readonly undecodable: readonly UndecodableRead[];
    }
  | { readonly kind: 'corrupt'; readonly detail: string };

function firstValue(items: readonly StorageItem[]): string | undefined {
  return items[0]?.value;
}

/**
 * What a failed quote decode contributes: neither published field was read.
 *
 * Zero is not a price here — it is the one pair that cannot equal a real recompute, so
 * `FE-CHAIN-005` fires rather than the ticket passing on figures nobody read.
 *
 * Written from a named zero rather than two bare literals, and the reason is worth
 * stating: `fee` is a frozen metadata constant's name, so 10 §5.4 rule A reads
 * `fee: 0n` as a hardcoded `Market::Fee` — correctly, on the spelling. What is
 * different here is only that this `fee` is a charged amount in base units and not the
 * rate, and the rate in this file (`feeMetadataBps`) is a required parameter with no
 * default. A classification group exempting the constant *name* in this file would
 * cover a genuinely hardcoded rate too, which is a worse trade than one named local.
 */
const NOTHING_READ = 0n;
const NO_QUOTE: QuoteFigures = Object.freeze({ cost: NOTHING_READ, fee: NOTHING_READ });

/**
 * A caller-supplied reading that was not made at this reader's block.
 *
 * Thrown rather than returned, because it is a defect in whatever assembled the call —
 * not a state of the chain, and nothing on a screen could describe it truthfully. The
 * same answer `readDepositInputs` gives a D-13 cap read on the wrong chain, and
 * `FinalizedReader.domained` gives a value read at another block.
 */
export class MixedPinError extends Error {
  constructor(detail: string) {
    super(
      `${detail} Every §11.5 row of one gate is read at a single B′ (11 §11.4), and rows ` +
        'from two blocks are each true of a state that never existed.',
    );
    this.name = 'MixedPinError';
  }
}

/**
 * Read S3's ticket at the reader's pinned block.
 *
 * Fail-closed throughout: an unreadable `PhaseFlags` is treated as a freeze, because the
 * unsafe direction here is offering a trade the runtime refuses after the user has signed —
 * and an absent book on a Baseline surface is reaped rather than priced at zero.
 */
export async function readMarketTrade(
  reader: MarketReader,
  keys: MarketKeys,
  decoders: MarketDecoders,
  params: MarketReadParams,
): Promise<MarketTradeRead> {
  const undecodable: UndecodableRead[] = [];
  const bookId = params.bookId.value;

  // Every reading the caller brings must belong to this reader's block before anything is
  // combined with it. `tradeBlocks`' own pin row covers a ticket assembled anywhere else;
  // here the mismatch is caught before a derived leaf can wear one block's pin over
  // another block's number.
  try {
    assertOnePin(
      [
        ...(params.proposalState === undefined ? [] : [params.proposalState]),
        params.feeMetadataBps,
        params.feeParamsPerbill,
        params.bounds,
        params.spendable,
        ...(params.baselineWindowOpen === undefined ? [] : [params.baselineWindowOpen]),
        ...(params.baselineVaultOpen === undefined ? [] : [params.baselineVaultOpen]),
      ],
      reader.at.blockHash,
    );
  } catch (cause) {
    throw new MixedPinError(cause instanceof Error ? cause.message : String(cause));
  }

  const bookRead = await reader.storage(keys.market(bookId));
  // Decoded inside the derivation, so the result descends from the read rather than being
  // stamped with its pin afterwards — which is the difference between a finalized value
  // and a claim about one.
  const bookDecoded = derive(bookRead, (items) => {
    const raw = firstValue(items);
    return raw === undefined
      ? ({ ok: true, value: undefined } as const)
      : decoders.market(raw);
  });
  if (!bookDecoded.value.ok) {
    undecodable.push({
      label: `${MARKET_READS.markets}(${bookId})`,
      rawHex: firstValue(bookRead.value) ?? '0x',
      reason: bookDecoded.value.reason,
    });
  }
  const book = bookDecoded.value.ok ? bookDecoded.value.value : undefined;

  // §11.5's reaped-book rule, and its corrupt-state companion. Only a Baseline book has a
  // `BaselineMarketOf` mapping, so only a Baseline book can be reaped in this sense.
  if (params.book.kind === 'baseline') {
    if (params.epoch === undefined) {
      return {
        kind: 'corrupt',
        detail:
          'a Baseline ticket was requested without the epoch whose BaselineMarketOf mapping ' +
          'decides whether the book is live or reaped (11 §11.5, SQ-304)',
      };
    }
    const epoch = params.epoch.value;
    const mappingRaw = firstValue((await reader.storage(keys.baselineMarketOf(epoch))).value);
    const mapping =
      mappingRaw === undefined
        ? ({ ok: true, value: undefined } as const)
        : decoders.baselineMarketOf(mappingRaw);
    if (!mapping.ok) {
      undecodable.push({
        label: `${MARKET_READS.baselineMarketOf}(${epoch})`,
        rawHex: mappingRaw ?? '0x',
        reason: mapping.reason,
      });
    }
    const mapped = mapping.ok ? mapping.value : undefined;
    if (mapped === undefined) {
      if (book !== undefined) {
        return {
          kind: 'corrupt',
          detail:
            `${MARKET_READS.baselineMarketOf}(${epoch}) is absent while ` +
            `${MARKET_READS.markets}(${bookId}) still holds a book. Reap removes the ` +
            'book and its mapping atomically, so this state cannot arise from a completed ' +
            'reap (11 §11.5, SQ-304).',
        };
      }
      // Both gone: reaped and archived. No price is rendered and no action is offered,
      // because the arm returned here carries neither. The epoch renders under the badge
      // of the cohort-history read that identified it — this module read no epoch and so
      // cannot claim one.
      return {
        kind: 'screen',
        screen: { kind: 'reaped', epoch: params.epoch },
        undecodable,
      };
    }
    if (book === undefined || mapped !== bookId) {
      return {
        kind: 'corrupt',
        detail:
          `${MARKET_READS.baselineMarketOf}(${epoch}) maps to ${mapped} while this ` +
          `ticket was built for ${bookId}` +
          (book === undefined ? ', and no book exists at that id' : '') +
          '. A present mapping with an absent or mismatched book is corrupt chain state ' +
          '(11 §11.5).',
      };
    }
  } else if (book === undefined) {
    return {
      kind: 'corrupt',
      detail:
        `${MARKET_READS.markets}(${bookId}) holds no book. A decision or gate book is ` +
        'reached from state that names it, so its absence is not an ordinary empty read.',
    };
  }

  const flagsRead = await reader.storage(keys.phaseFlags());
  const flagsDecoded = derive(flagsRead, (items) => {
    const raw = firstValue(items);
    return raw === undefined
      ? ({ ok: false, reason: 'the storage key returned no value' } as const)
      : decoders.phaseFlags(raw);
  });
  if (!flagsDecoded.value.ok) {
    undecodable.push({
      label: MARKET_READS.phaseFlags,
      rawHex: firstValue(flagsRead.value) ?? '0x',
      reason: flagsDecoded.value.reason,
    });
  }
  // Unread and undecodable collapse, as they do elsewhere in this client: both mean the
  // client cannot establish that trading is permitted, and INV-FE-12 gives them one
  // fail-closed answer.
  const flags = derive(flagsDecoded, (decoded) => (decoded.ok ? decoded.value : LEDGER_FROZEN_BIT));

  // FE-P2's conservative default: `quote()` is admitted alongside the `Market.Markets`
  // prefix it must agree with, both read at this reader's one pin (10 §4.2).
  const quoteRead = await reader.crossCheckedCall({
    api: MARKET_READS.quote,
    storagePrefix: keys.marketsPrefix(),
    argsHex: params.quoteArgsHex,
  });
  const quoteDecoded = derive(quoteRead, (result) => decoders.quote(result.result));
  if (!quoteDecoded.value.ok) {
    undecodable.push({
      label: MARKET_READS.quote,
      rawHex: quoteRead.value.result,
      reason: quoteDecoded.value.reason,
    });
  }
  // One runtime-API read, so **one** pin over the pair rather than one per field: `cost`
  // and `fee` arrive in a single `QuoteView` and pinning them separately would let a
  // future edit re-read one of them and leave the ticket's own pin row unable to notice.
  // A failed decode contributes zeroes, which cannot equal a real recompute — so
  // `FE-CHAIN-005` fires rather than the ticket passing on figures nobody read.
  const fromChain = derive(quoteDecoded, (decoded) => (decoded.ok ? decoded.value : NO_QUOTE));

  // A book that failed to decode contributes a zero state. That is not a price on screen:
  // `fromChain` above is the chain's own answer and the recompute is the caller's — this
  // only bounds the per-trade maximum, and a zero `b` yields a zero ceiling, which admits
  // no trade at all (the status-quo direction, G-1).
  const bookState = derive(
    bookDecoded,
    (decoded): BookState =>
      (decoded.ok ? decoded.value?.book : undefined) ?? { qLong: 0n, qShort: 0n, b: 0n },
  );
  // The one leaf genuinely combining two reads: this book's `b` and the chain's ratio.
  // `meet` refuses two blocks rather than picking one, and `assertOnePin` above already
  // established they agree — so `undefined` here means the two reads came from different
  // *chains*, which nothing else in this module would notice.
  const maxTrade = meet(bookState, params.bounds, (state, bounds) =>
    maxTradeAmount(state.b, bounds),
  );
  if (maxTrade === undefined) {
    throw new MixedPinError(
      `${MARKET_READS.markets}(${bookId}) and the per-trade bounds cannot be combined.`,
    );
  }

  const inputs: TradeInputs = {
    book: params.book,
    order: params.order,
    ...(params.proposalState === undefined ? {} : { proposalState: params.proposalState }),
    marketOpen: derive(bookDecoded, (decoded) => (decoded.ok ? decoded.value?.open : false) === true),
    fee: { metadataBps: params.feeMetadataBps, paramsPerbill: params.feeParamsPerbill },
    quote: { fromChain, fromClient: params.clientQuote },
    amount: params.amount,
    minTrade: derive(params.bounds, (bounds) => bounds.minTrade),
    maxTrade,
    spendable: params.spendable,
    tradingEnabled: derive(flags, tradingEnabled),
    ledgerFrozen: derive(flags, ledgerFrozen),
    ...(params.book.kind === 'baseline'
      ? {
          // Reaching here at all means the mapping and the book both exist and agree; the
          // reaped and corrupt cases returned above. So this is the book read's own
          // answer, derived from the read that established it rather than a literal
          // `true` wearing the reader's pin.
          baselineBookPresent: derive(
            bookDecoded,
            (decoded) => decoded.ok && decoded.value !== undefined,
          ),
          ...(params.baselineWindowOpen === undefined
            ? {}
            : { baselineWindowOpen: params.baselineWindowOpen }),
          ...(params.baselineVaultOpen === undefined
            ? {}
            : { baselineVaultOpen: params.baselineVaultOpen }),
        }
      : {}),
  };

  // The client's recompute descends from the book state and the fee rate, and from
  // nothing else. `quote()`'s own status is deliberately absent: the recompute does not
  // consume the chain's answer, and letting it inherit that provenance would make the
  // figure that exists to check `quote()` carry `quote()`'s badge.
  const clientStatuses = [bookRead.status, params.feeMetadataBps.status];
  const direction = params.order.direction;

  return {
    kind: 'screen',
    screen: {
      kind: 'tradable',
      // Restated from the caller's reading rather than re-stamped: `combine` takes that
      // one status unchanged, so an id resolved from a provider-served list renders as
      // provider — which is what it is.
      bookId: combine(bookId.toString(), [params.bookId.status]),
      inputs,
      quote: {
        fromChain: {
          cost: derive(fromChain, (figures) => figures.cost),
          fee: derive(fromChain, (figures) => figures.fee),
          total: derive(fromChain, (figures) => orderTotal(direction, figures)),
        },
        fromClient: {
          cost: combine(params.clientQuote.cost, clientStatuses),
          fee: combine(params.clientQuote.fee, clientStatuses),
          total: combine(orderTotal(direction, params.clientQuote), clientStatuses),
        },
      },
    },
    undecodable,
  };
}
