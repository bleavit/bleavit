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
 * @see docs/architecture/11-frontend-workflows.md §11.2, §11.5
 * @see docs/architecture/02-integration-contract.md §7.1, §7.3, §9
 */

import type { Finalized, FinalizedBlockRef, StorageItem } from '@bleavit/chain-client';
import { maxTradeAmount, type BookState, type TradeBounds } from '@bleavit/protocol';
import { combine, type Verified } from '@bleavit/shared-types';

import type { MarketTradeScreen } from './market-trade.js';
import type { UndecodableRead } from './positions.js';
import type { BookIdentity, ProposalState, TradeInputs } from './trade-ticket.js';

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
  /** `quote()`'s `QuoteView` — only its charge is used here (02 §4). */
  readonly quote: (raw: string) => Decoded<{ readonly charge: bigint }>;
  readonly phaseFlags: (raw: string) => Decoded<number>;
}

export interface MarketReadParams {
  readonly bookId: bigint;
  /** Established by the §11.2a rule-1 bit test before this read was requested. */
  readonly book: BookIdentity;
  /** Absent for a Baseline book, which has no owning proposal (04 §6.1). */
  readonly proposalState?: Verified<ProposalState> | undefined;
  /** Baseline books only — the epoch whose mapping decides reaped-vs-live (§11.5). */
  readonly epoch?: number | undefined;
  /** The trade size as the user entered it, in base units. */
  readonly amount: bigint;
  /** `quote()`'s SCALE arguments, encoded by the caller's codecs. */
  readonly quoteArgsHex: string;
  /** The client's own LMSR recompute of the same trade (04 §5, E6). */
  readonly clientCharge: bigint;
  /** `Market::Fee` `[C]`, basis points. */
  readonly feeMetadataBps: Verified<bigint>;
  /** Raw `params(mkt.fee)`, a `Perbill` inner scalar (02 §9 rule 4). */
  readonly feeParamsPerbill: Verified<bigint>;
  /** `Market::MinTrade` and `Market::MaxTradeRatio` `[C]` — no defaults. */
  readonly bounds: Verified<TradeBounds>;
  /** USDC on a buy, position balance on a sell. Read by the balances layer. */
  readonly spendable: Verified<bigint>;
  /** P-2 only: the epoch trading window, incl. any pair still in `Extended` (04 §8.4). */
  readonly baselineWindowOpen?: Verified<boolean> | undefined;
  /** P-2 only: `BaselineVaults(epoch)` still open (03). */
  readonly baselineVaultOpen?: Verified<boolean> | undefined;
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
  const at = reader.at;
  const undecodable: UndecodableRead[] = [];
  const finalized = <T,>(value: T): Verified<T> => ({
    value,
    status: {
      kind: 'verified-finalized',
      chain: at.chain,
      blockHash: at.blockHash,
      blockNumber: at.blockNumber,
    },
  });

  const bookRaw = firstValue((await reader.storage(keys.market(params.bookId))).value);
  const bookDecoded =
    bookRaw === undefined
      ? ({ ok: true, value: undefined } as const)
      : decoders.market(bookRaw);
  if (!bookDecoded.ok) {
    undecodable.push({
      label: `${MARKET_READS.markets}(${params.bookId})`,
      rawHex: bookRaw ?? '0x',
      reason: bookDecoded.reason,
    });
  }
  const book = bookDecoded.ok ? bookDecoded.value : undefined;

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
    const mappingRaw = firstValue(
      (await reader.storage(keys.baselineMarketOf(params.epoch))).value,
    );
    const mapping =
      mappingRaw === undefined
        ? ({ ok: true, value: undefined } as const)
        : decoders.baselineMarketOf(mappingRaw);
    if (!mapping.ok) {
      undecodable.push({
        label: `${MARKET_READS.baselineMarketOf}(${params.epoch})`,
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
            `${MARKET_READS.baselineMarketOf}(${params.epoch}) is absent while ` +
            `${MARKET_READS.markets}(${params.bookId}) still holds a book. Reap removes the ` +
            'book and its mapping atomically, so this state cannot arise from a completed ' +
            'reap (11 §11.5, SQ-304).',
        };
      }
      // Both gone: reaped and archived. No price is rendered and no action is offered,
      // because the arm returned here carries neither.
      return {
        kind: 'screen',
        screen: { kind: 'reaped', epoch: finalized(params.epoch) },
        undecodable,
      };
    }
    if (book === undefined || mapped !== params.bookId) {
      return {
        kind: 'corrupt',
        detail:
          `${MARKET_READS.baselineMarketOf}(${params.epoch}) maps to ${mapped} while this ` +
          `ticket was built for ${params.bookId}` +
          (book === undefined ? ', and no book exists at that id' : '') +
          '. A present mapping with an absent or mismatched book is corrupt chain state ' +
          '(11 §11.5).',
      };
    }
  } else if (book === undefined) {
    return {
      kind: 'corrupt',
      detail:
        `${MARKET_READS.markets}(${params.bookId}) holds no book. A decision or gate book is ` +
        'reached from state that names it, so its absence is not an ordinary empty read.',
    };
  }

  const flagsRaw = firstValue((await reader.storage(keys.phaseFlags())).value);
  const flags =
    flagsRaw === undefined
      ? ({ ok: false, reason: 'the storage key returned no value' } as const)
      : decoders.phaseFlags(flagsRaw);
  if (!flags.ok) {
    undecodable.push({
      label: MARKET_READS.phaseFlags,
      rawHex: flagsRaw ?? '0x',
      reason: flags.reason,
    });
  }
  // Unread and undecodable collapse, as they do elsewhere in this client: both mean the
  // client cannot establish that trading is permitted, and INV-FE-12 gives them one
  // fail-closed answer.
  const flagsValue = flags.ok ? flags.value : LEDGER_FROZEN_BIT;

  // FE-P2's conservative default: `quote()` is admitted alongside the `Market.Markets`
  // prefix it must agree with, both read at this reader's one pin (10 §4.2).
  const quoteRaw = await reader.crossCheckedCall({
    api: MARKET_READS.quote,
    storagePrefix: keys.marketsPrefix(),
    argsHex: params.quoteArgsHex,
  });
  const quote = decoders.quote(quoteRaw.value.result);
  if (!quote.ok) {
    undecodable.push({
      label: MARKET_READS.quote,
      rawHex: quoteRaw.value.result,
      reason: quote.reason,
    });
  }

  // A book that failed to decode contributes a zero state. That is not a price on screen:
  // `chargeFromChain` below is the chain's own answer, and the client recompute is the
  // caller's — this only bounds the per-trade maximum, and a zero `b` yields a zero
  // ceiling, which admits no trade at all (the status-quo direction, G-1).
  const state: BookState = book?.book ?? { qLong: 0n, qShort: 0n, b: 0n };

  const inputs: TradeInputs = {
    book: params.book,
    ...(params.proposalState === undefined ? {} : { proposalState: params.proposalState }),
    marketOpen: finalized(book?.open === true),
    fee: { metadataBps: params.feeMetadataBps, paramsPerbill: params.feeParamsPerbill },
    quote: {
      // A failed quote decode contributes a charge of zero, which cannot equal a non-zero
      // client recompute — so `FE-CHAIN-005` fires rather than the ticket passing on a
      // figure nobody read.
      chargeFromChain: finalized(quote.ok ? quote.value.charge : 0n),
      chargeFromClient: params.clientCharge,
    },
    amount: params.amount,
    minTrade: finalized(params.bounds.value.minTrade),
    maxTrade: finalized(maxTradeAmount(state.b, params.bounds.value)),
    spendable: params.spendable,
    tradingEnabled: finalized(tradingEnabled(flagsValue)),
    ledgerFrozen: finalized(ledgerFrozen(flagsValue)),
    ...(params.book.kind === 'baseline'
      ? {
          // Reaching here at all means the mapping and the book both exist and agree; the
          // reaped and corrupt cases returned above.
          baselineBookPresent: finalized(true),
          ...(params.baselineWindowOpen === undefined
            ? {}
            : { baselineWindowOpen: params.baselineWindowOpen }),
          ...(params.baselineVaultOpen === undefined
            ? {}
            : { baselineVaultOpen: params.baselineVaultOpen }),
        }
      : {}),
  };

  return {
    kind: 'screen',
    screen: {
      kind: 'tradable',
      bookId: finalized(params.bookId.toString()),
      inputs,
      // The recompute is derived from the book state and the bounds, so it carries the
      // weakest of those provenances — and refuses outright if they were read at different
      // blocks, which is what `Derived` renders instead of a number.
      clientCharge: combine(params.clientCharge, [
        quoteRaw.status,
        params.bounds.status,
        params.feeMetadataBps.status,
      ]),
    },
    undecodable,
  };
}
