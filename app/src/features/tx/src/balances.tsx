/**
 * S20 — balances and funding status (11 §11.2's S20 row, 02 §7.4).
 *
 * Two balances, in two different assets, read from two frozen storage items. The whole of
 * this screen's difficulty is in what it must **not** do with them.
 *
 * ## There is no total, and no unit in which there could be one
 *
 * VIT and USDC are different assets with different decimals and different symbols. A
 * "total balance" would need an exchange rate, and the only rate this system has —
 * `fee.vit_usdc_rate` — is a *fee conversion* key bounded to [0.1×, 10×] around a reference
 * (§11.3), not a market price and not a valuation. So {@link BalancesView} carries two
 * {@link AssetBalance} values and **no** total field, and each `AssetBalance` carries its own
 * `decimals` and `symbol`, which is what makes adding two of them meaningless rather than
 * merely discouraged.
 *
 * ## USDC comes from `ForeignAssets`, never from `Assets`
 *
 * 11 §11.2: *"USDC balance reads use the `ForeignAssets` instance keyed by the pinned XCM
 * `Location` … never `Assets.Account`."* 02 §7.4 says the same with the counter-example
 * spelled out (`NOT Assets.Account(1337, who)` — X-11a). `Assets.Account(1337, who)` on this
 * chain is a well-formed read of a different map that returns nothing, which renders as a
 * user holding no USDC — the failure mode a wrong storage key always has. The prohibition is
 * about **this** chain and does not reach 02 §7.7's Asset Hub read, which is the same asset
 * seen from the chain that hosts it; `balance-reads.ts` keeps them apart by naming the
 * surfaces separately, exactly as `funding-reads.ts` does.
 *
 * ## Funding status is a warning, never a block
 *
 * §11.9.2 and E18: degraded XCM health warns that arrival may be delayed and never blocks,
 * because I-24's fail-static property means funds are held rather than lost. This screen
 * reads no balance through XCM and gates nothing on it, so the health line is rendered at
 * `caution` beside the entry points and leaves both enabled.
 *
 * @see docs/architecture/11-frontend-workflows.md §11.2, §11.9
 * @see docs/architecture/02-integration-contract.md §7.4, §8
 */

import {
  Amount,
  Button,
  Field,
  Identifier,
  Notice,
  Panel,
  Undecodable,
  type ReactNode,
} from '@bleavit/ui';
import type { Verified } from '@bleavit/shared-types';

import { xcmWarning } from './funding.js';
import type { UndecodableRead } from './positions.js';

/**
 * One asset's holding, carrying its own unit.
 *
 * `decimals` and `symbol` travel with the figure rather than being screen-level props,
 * because there are two assets on this screen and a single pair of props is how one of them
 * gets rendered in the other's unit — true digits under a false symbol, which no badge can
 * detect.
 */
export interface AssetBalance {
  /**
   * The figure, or **absent** when the record was read and did not decode (V-183).
   *
   * Not a substituted `0n`. 10 §2.2 assigns `verified-finalized` *"only to values read
   * through smoldot with storage proofs checked, or computed client-side purely from such
   * values"*, and a zero chosen by this client on a failure path is neither. An **absent
   * account** is a different fact and stays a badged zero: the chain answered, and its
   * answer is that the account holds nothing.
   */
  readonly free: Verified<bigint> | undefined;
  readonly decimals: number;
  readonly symbol: string;
}

/**
 * The S20 model.
 *
 * No `total`, no `portfolio`, no `combined` — see the module note. Adding one requires adding
 * a field, which is a diff a reviewer sees.
 */
export interface BalancesView {
  /**
   * The account these balances belong to, under the provenance the caller resolved it with.
   *
   * `Verified<string>` rather than a bare `string` because it is rendered, and INV-FE-9
   * admits no unlabeled rendering path. It is **not** a chain read: 10 §5 lists *"a
   * selected account"* among the chosen values that *"can never be represented as
   * verified"*, so the badge it carries is the caller's — this screen holds it and does
   * not observe it.
   */
  readonly who: Verified<string>;
  /** `System.Account(who).data.free` — the native asset (02 §7.4). */
  readonly vit: AssetBalance;
  /** `System.Account(who).data.reserved` — held for deposits, not spendable. */
  readonly vitReserved: Verified<bigint> | undefined;
  /** `ForeignAssets.Account(USDC_LOCATION, who).balance` — never `Assets.Account`. */
  readonly usdc: AssetBalance;
  /** §11.9's channel health. A warning here, never a gate. */
  readonly xcmHealthy: boolean;
  readonly undecodable: readonly UndecodableRead[];
}

/** Why the two figures are never added. Fixed copy — it carries no chain value. */
export const NO_COMBINED_BALANCE =
  'These are two different assets and Bleavit does not add them together. There is no ' +
  'valuation rate in this system to convert one into the other: the fee-currency selector ' +
  'uses a bounded conversion key to price a transaction fee, which is not a market price.';

/** 02 §7.4's own prohibition, said to the user in expert terms. */
export const USDC_SOURCE_NOTE =
  'Your USDC balance is read from the ForeignAssets instance keyed by the pinned XCM ' +
  'location of the asset, which is the identifier this chain uses for it.';

/**
 * A balance the client read and could not decode.
 *
 * No number and no badge. The model made the field absent rather than substituting `0n`
 * (10 §2.2, INV-FE-12), and a screen that filled the gap back in with a zero would restore
 * the defect one layer up — with no `Verified<T>` left for a badge to hang off, so nothing
 * on screen would mark the figure as manufactured. The raw bytes are already in the
 * `Undecodable` list below; this row is what stops the field itself reading as a zero.
 *
 * Shaped like `ui`'s own `Derived` refusal (`datum--unavailable` + a reason) so an absent
 * figure looks the same wherever it comes from. It is not `Derived`: that component takes a
 * `Combined<T>`, and there is nothing here to combine.
 */
function BalanceUnreadable({ what }: { readonly what: string }): ReactNode {
  return (
    <span className="datum datum--unread" role="status">
      <span className="datum__unavailable">Not available</span>
      <span className="datum__reason">
        {what} was read and could not be decoded, so this client is not stating a figure for
        it. Nothing is being substituted, and the raw bytes are shown below.
      </span>
    </span>
  );
}

export function Balances({
  view,
  onDeposit,
  onWithdraw,
}: {
  readonly view: BalancesView;
  readonly onDeposit: () => void;
  readonly onWithdraw: () => void;
}): ReactNode {
  const warning = xcmWarning({ xcmHealthy: view.xcmHealthy });
  return (
    <Panel title="Balances" subject={<Identifier datum={view.who} />} tone="advanced">
      <Notice severity="info" heading="Two assets, two balances">
        {NO_COMBINED_BALANCE}
      </Notice>

      {/* Each label names its asset. Two fields both labelled "Available", distinguished only
          by the symbol inside the badged figure, is a row a user reads by position — and the
          native and USDC balances differ by six orders of magnitude in their own units, so
          the wrong one looks like the right one having a bad day. The native asset is named
          "native" rather than by its symbol, which is a chain-identity read (02 §8) and has
          no business in a bundled string. */}
      <Field label="Native asset — available">
        {view.vit.free === undefined ? (
          <BalanceUnreadable what="Your available native balance" />
        ) : (
          <Amount datum={view.vit.free} decimals={view.vit.decimals} symbol={view.vit.symbol} />
        )}
      </Field>
      <Field label="Native asset — reserved">
        {view.vitReserved === undefined ? (
          <BalanceUnreadable what="Your reserved native balance" />
        ) : (
          <Amount datum={view.vitReserved} decimals={view.vit.decimals} symbol={view.vit.symbol} />
        )}
      </Field>
      <Field label="USDC — available">
        {view.usdc.free === undefined ? (
          <BalanceUnreadable what="Your available USDC balance" />
        ) : (
          <Amount datum={view.usdc.free} decimals={view.usdc.decimals} symbol={view.usdc.symbol} />
        )}
      </Field>
      <Notice severity="info" heading="Where this USDC figure comes from">
        {USDC_SOURCE_NOTE}
      </Notice>

      {/* A warning at caution severity, and it disables neither control: a degraded channel
          delays arrival and never puts funds at risk (I-24, §11.9.2, E18). */}
      {warning === undefined ? null : (
        <Notice severity="caution" heading="XCM channel health is degraded">
          {warning}
        </Notice>
      )}

      <Button label="Deposit USDC" intent="primary" onClick={onDeposit} />
      <Button label="Withdraw USDC" onClick={onWithdraw} />

      {view.undecodable.map((row) => (
        <Undecodable label={row.label} rawHex={row.rawHex} reason={row.reason} key={row.label} />
      ))}
    </Panel>
  );
}
