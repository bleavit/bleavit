/**
 * S3 — the market trading ticket, for decision, gate, Baseline **and external** books.
 *
 * `trade-ticket.ts` decides whether the ticket may be signed; this file decides what a user
 * is shown while they decide. Four rules in doc 11 are about the rendering specifically, and
 * each of them fails silently under the obvious implementation.
 *
 * ## 1. A reaped Baseline book has no price, and no arm to put one on
 *
 * §11.5's reaped-book paragraph: when cohort history identifies epoch `e` but
 * `BaselineMarketOf(e)` is absent, the UI *"MUST label the book **reaped/archived**, MUST NOT
 * render a missing or fail-closed zero quote as a market price, and MUST disable every trade
 * action on it."*
 *
 * The dangerous form is not a missing label — it is the fail-closed zero. A book that was
 * reaped answers every read with nothing, and nothing formats as `0.00`, which on a trading
 * screen reads as *this is currently worth zero* rather than *this book no longer exists*.
 * So {@link MarketTradeScreen}'s `reaped` arm carries **no** book, no quote and no inputs:
 * there is no field a zero could occupy and no control to disable, because none is
 * constructed.
 *
 * ## 2. Domain is labelled, always, and never implies governance
 *
 * §11.2a rule 1 requires the domain visible wherever a row renders; rule 3 forbids copy that
 * implies trading a hosted book participates in governing Bleavit. The label therefore comes
 * from a frozen copy record keyed by the domain the *model* established (rule 1's bit test),
 * not from anything this component works out.
 *
 * ## 2a. The quote is two figures on each side, never one
 *
 * 02 §4 publishes `cost` and `fee` as separate fields and 04 §6.1 combines them differently
 * per direction — `cost + fee` debited on a buy, `cost − fee` credited on a sell. A chain
 * answer of `(100, 3)` and a client answer of `(101, 2)` agree on a buy's total and disagree
 * on a sell's net, so a screen showing one combined figure per side would show two agreeing
 * numbers for a disagreement that blocks the ticket. Both fields render on both sides, with
 * the direction's own combination beneath them — six figures, and the combination is the one
 * `max_cost`/`min_proceeds` is compared against.
 *
 * ## 3. `FE-CHAIN-005` blocks, it does not warn
 *
 * E6: *"trading is **blocked**, not warned about, because the disagreement means one of the
 * two is wrong about what the chain will charge … R: none client-side; it is a contract
 * defect and is reported as one."* It renders through `Refusal` — which carries a code and a
 * recovery — rather than as one more red notice among the others, because the recovery for
 * this one is genuinely different: there is nothing for the user to retry.
 *
 * ## 4. There is no in-Trade preview, because there is no field for one
 *
 * §11.2: *"while a proposal remains in Trade/Extended and the view returns `None`, S2 and S3
 * MUST render no projected uplift, projected PASS/REJECT, or other in-Trade preview derived
 * from it."* S2 made that structural by giving its pre-decision arm no statistics field. S3
 * is stronger and simpler: **no arm of this screen has one at all**, and `app/tests/screens`
 * asserts that by reading the exported types rather than by trusting this paragraph.
 *
 * @see docs/architecture/11-frontend-workflows.md §11.2, §11.2a, §11.5
 * @see docs/architecture/04-markets-and-pricing.md §6.1, §8.3, §8.4
 */

import {
  Amount,
  Button,
  Count,
  Derived,
  Field,
  Notice,
  Panel,
  Refusal,
  formatBaseUnits,
  type ReactNode,
} from '@bleavit/ui';
import type { Combined, Verified } from '@bleavit/shared-types';

import type { LedgerDomain } from './ledger-domain.js';
import { tradeBlocks, type TradeDirection, type TradeInputs } from './trade-ticket.js';

/**
 * One side of the E6 comparison, itemized as 02 §4 publishes it.
 *
 * Generic in the wrapper because the two sides carry different provenance kinds and must:
 * the chain's figures are one runtime-API read, and the client's are derived from the book
 * state and the fee rate, which `Combined` refuses to state at all if those were read at
 * two blocks.
 */
export interface QuoteBreakdown<T> {
  /** `QuoteView.cost` — charged on a buy, paid on a sell, before the fee either way. */
  readonly cost: T;
  /** `QuoteView.fee` at the current `mkt.fee`. */
  readonly fee: T;
  /** 04 §6.1's combination for this direction, and what the slippage bound is compared to. */
  readonly total: T;
}

/**
 * What this screen can be showing.
 *
 * Note what neither arm carries: any decision statistic, projected outcome or uplift. §11.2
 * forbids one on an open market, and the strongest available form of that is a type with
 * nowhere to put it.
 */
export type MarketTradeScreen =
  | {
      readonly kind: 'tradable';
      /**
       * The traded book's id, under the provenance it was resolved with.
       *
       * `Combined` rather than `Verified` because the read layer restates it through
       * `combine` rather than re-stamping it: a decision book's id comes from a proposal
       * record and a Baseline book's from cohort history, and neither becomes a
       * finalized read by being handed to this screen.
       */
      readonly bookId: Combined<string>;
      readonly inputs: TradeInputs;
      /**
       * Both quotes, itemized (E6).
       *
       * The client's side is `Combined` because it is derived from more than one read —
       * two reads at two blocks make it true of neither, and `Derived` renders that
       * refusal rather than a number.
       */
      readonly quote: {
        readonly fromChain: QuoteBreakdown<Verified<bigint>>;
        readonly fromClient: QuoteBreakdown<Combined<bigint>>;
      };
    }
  | {
      /** §11.5's reaped-book rule. No book, no quote, no price — see the module note. */
      readonly kind: 'reaped';
      readonly epoch: Verified<number>;
    };

/**
 * The domain label, per §11.2a rules 1 and 3.
 *
 * The service copy says what a hosted book is *not* as well as what it is. Rule 3's
 * prohibition is on copy implying that trading one participates in governing Bleavit, and
 * silence on the point is exactly what a user fills in from context — every other book on
 * this screen is a governance market.
 */
export const BOOK_DOMAIN_COPY: Readonly<
  Record<LedgerDomain, { readonly label: string; readonly note: string }>
> = Object.freeze({
  primary: {
    label: 'Bleavit governance market',
    note:
      'This book is one of Bleavit’s own decision markets. Trading it is how the protocol ' +
      'forms the price its governance acts on.',
  },
  service: {
    label: 'External (hosted) book',
    note:
      'This book belongs to a question hosted for an external client. It is settled from a ' +
      'separate ledger with its own reserves, and trading it does not participate in ' +
      'governing Bleavit: no price here feeds a decision, a gate, a welfare pillar or NAV.',
  },
});

/** §11.5's reaped/archived label. Fixed copy — it names a state, not a price. */
export const REAPED_BOOK_COPY =
  'This Baseline book was reaped and archived after its epoch settled. It no longer exists ' +
  'on chain, so there is no price to show and nothing here can be traded. Positions already ' +
  'held redeem from the vault, which is unaffected.';

/**
 * The quote labels, per direction — 02 §4's two fields and 04 §6.1's combination of them.
 *
 * Keyed by direction rather than written once, because the same two numbers mean opposite
 * things on the two sides: `cost` is what the buyer pays and what the seller is paid, and
 * the fee is *added* to one and *withheld* from the other. One set of labels would be
 * wrong for whichever direction it was not written for, and a mislabelled fee on a sale
 * reads as a larger payout than the chain will make.
 */
export const QUOTE_COPY: Readonly<
  Record<
    TradeDirection,
    { readonly chain: string; readonly client: string; readonly cost: string; readonly total: string }
  >
> = Object.freeze({
  buy: {
    chain: 'What the chain says this costs',
    client: 'What this client recomputes',
    cost: 'cost before fee',
    total: 'total debited',
  },
  sell: {
    chain: 'What the chain says this pays',
    client: 'What this client recomputes',
    cost: 'proceeds before fee',
    total: 'net credited',
  },
});

/** The fee label, which is the one term that reads the same on both sides. */
export const QUOTE_FEE_LABEL = 'fee';

/** E6's recovery for `FE-CHAIN-005`: there is none client-side, and saying so is the point. */
export const QUOTE_DISAGREEMENT_RECOVERY =
  'There is nothing to retry. The chain’s own quote and this client’s recompute of the same ' +
  'trade disagree, which means one of them is wrong about what you would be charged. That is ' +
  'a defect in the contract between this release and this runtime, and it is reported as one.';

const FE_CHAIN_005 = 'FE-CHAIN-005';

export function MarketTrade({
  screen,
  decimals,
  symbol,
  onTrade,
}: {
  readonly screen: MarketTradeScreen;
  readonly decimals: number;
  readonly symbol: string;
  readonly onTrade: () => void;
}): ReactNode {
  if (screen.kind === 'reaped') {
    // No price field exists on this arm, so a fail-closed zero has nowhere to be rendered
    // from, and there is no trade control to disable because none is built.
    return (
      <Panel title="This book has been archived" tone="advanced">
        {/* `Count`, never `Amount`: an epoch index is not money, and `Amount` is the only
            component that can render a currency. */}
        <Field label="Epoch">
          <Count datum={screen.epoch} />
        </Field>
        <Notice severity="caution" heading="Reaped / archived">
          {REAPED_BOOK_COPY}
        </Notice>
      </Panel>
    );
  }

  const { inputs, quote } = screen;
  const blocks = tradeBlocks(inputs);
  const quoteDisagreement = blocks.find((block) => block.code === FE_CHAIN_005);
  const otherBlocks = blocks.filter((block) => block.code !== FE_CHAIN_005);
  const domain = BOOK_DOMAIN_COPY[inputs.book.domain];
  const render = (value: bigint): string => `${formatBaseUnits(value, decimals)} ${symbol}`;
  const copy = QUOTE_COPY[inputs.order.direction];

  return (
    <Panel
      title="Trade"
      subject={<Derived combined={screen.bookId} render={(id) => id} />}
      tone="advanced"
    >
      {/* §11.2a rule 1: the domain is stated wherever the book is rendered, and it came
          from the bit test on the id rather than from which call fetched it. */}
      <Notice severity="info" heading={domain.label}>
        {domain.note}
      </Notice>

      {/* E6: the client's own recomputed quote beside the chain's — and 02 §4's two fields
          kept apart on both sides, because their sum agrees on a buy for a pair that
          disagrees on a sell (see the module note). */}
      <Field label={copy.chain}>
        <Amount datum={quote.fromChain.cost} name={copy.cost} decimals={decimals} symbol={symbol} />
        <Amount
          datum={quote.fromChain.fee}
          name={QUOTE_FEE_LABEL}
          decimals={decimals}
          symbol={symbol}
        />
        <Amount
          datum={quote.fromChain.total}
          name={copy.total}
          decimals={decimals}
          symbol={symbol}
        />
      </Field>
      <Field label={copy.client}>
        <Derived combined={quote.fromClient.cost} name={copy.cost} render={render} />
        <Derived combined={quote.fromClient.fee} name={QUOTE_FEE_LABEL} render={render} />
        <Derived combined={quote.fromClient.total} name={copy.total} render={render} />
      </Field>

      {quoteDisagreement === undefined ? null : (
        <Refusal
          code={FE_CHAIN_005}
          message={quoteDisagreement.detail}
          recovery={QUOTE_DISAGREEMENT_RECOVERY}
        />
      )}

      {/* Every failing row, not the first (§11.4 rule 5). A user with three problems should
          see three, rather than one per signing attempt. */}
      {otherBlocks.map((block) => (
        <Notice severity="danger" heading={block.check} key={block.check}>
          {block.detail}
        </Notice>
      ))}

      <Button
        label="Review and sign"
        intent="primary"
        onClick={onTrade}
        disabled={blocks.length > 0}
        {...(blocks.length > 0
          ? { disabledReason: blocks.map((block) => block.check).join('; ') }
          : {})}
      />
    </Panel>
  );
}
