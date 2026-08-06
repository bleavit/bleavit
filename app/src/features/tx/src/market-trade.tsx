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
  Identifier,
  Notice,
  Panel,
  Refusal,
  formatBaseUnits,
  type ReactNode,
} from '@bleavit/ui';
import type { Combined, Verified } from '@bleavit/shared-types';

import type { LedgerDomain } from './ledger-domain.js';
import { tradeBlocks, type TradeInputs } from './trade-ticket.js';

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
      readonly bookId: Verified<string>;
      readonly inputs: TradeInputs;
      /**
       * The client's own recompute, beside the chain's (E6).
       *
       * `Combined` rather than `Verified`, because it is derived from the book state — two
       * reads at two blocks make it true of neither, and `Derived` renders that refusal
       * rather than a number.
       */
      readonly clientCharge: Combined<bigint>;
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

  const { inputs, clientCharge } = screen;
  const blocks = tradeBlocks(inputs);
  const quoteDisagreement = blocks.find((block) => block.code === FE_CHAIN_005);
  const otherBlocks = blocks.filter((block) => block.code !== FE_CHAIN_005);
  const domain = BOOK_DOMAIN_COPY[inputs.book.domain];
  const render = (value: bigint): string => `${formatBaseUnits(value, decimals)} ${symbol}`;

  return (
    <Panel title="Trade" subject={<Identifier datum={screen.bookId} />} tone="advanced">
      {/* §11.2a rule 1: the domain is stated wherever the book is rendered, and it came
          from the bit test on the id rather than from which call fetched it. */}
      <Notice severity="info" heading={domain.label}>
        {domain.note}
      </Notice>

      {/* E6: the client's own recomputed quote beside the chain's. Two figures, two
          provenances, never one averaged number. */}
      <Field label="What the chain says this costs">
        <Amount datum={inputs.quote.chargeFromChain} decimals={decimals} symbol={symbol} />
      </Field>
      <Field label="What this client recomputes">
        <Derived combined={clientCharge} render={render} />
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
