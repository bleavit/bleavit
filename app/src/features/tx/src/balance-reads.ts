/**
 * S20's reads — the two frozen balance surfaces of 02 §7.4.
 *
 * Small on purpose. The whole risk here is naming the wrong map, and a wrong storage key does
 * not fail: it returns no value, which decodes as *this account holds nothing*. So the two
 * surfaces are named separately, the decoders are named separately, and neither takes a
 * pallet argument that a call site could get wrong.
 *
 * ## An absent account is a real zero, and an undecodable one is not
 *
 * `System.Account` and `ForeignAssets.Account` both answer an account that has never been
 * touched with **no value**, which is a true zero balance. A record that is present and does
 * not decode is a different thing entirely, and the two must not collapse: the first is a
 * balance to render, the second is bytes to show under `Undecodable` with the figure
 * suppressed. `funding-reads.ts` draws the same line for the same reason.
 *
 * An **undecodable** record therefore makes its figure **absent**, and the screen renders a
 * refusal in its place. It used to contribute a `0n` badged `verified-finalized`, on the
 * argument that the `undecodable` row beside it said the figure was not to be believed.
 * 10 §2.2 settles that against the argument in one sentence — the status is assigned *"only
 * to values read through smoldot with storage proofs checked, or computed client-side purely
 * from such values"* — and a zero this module chose is neither. INV-FE-9 attaches the label
 * to *the datum*, so an explanation living in a sibling array does not reach the field the
 * user is looking at.
 *
 * ## No leaf is stamped here, and the account is not a read at all (V-183)
 *
 * This module used to define a local `finalized` helper that wrapped **any** value in a
 * hand-written `verified-finalized` status object. The brand is a non-exported `unique
 * symbol` in `packages/chain-client`, so what it produced was a plain `Verified<T>` that no
 * gate could tell from a real read: `check:casts` wants an assertion, and the render gate's
 * rule B wants a borrowed `.status` access. It is the V-182 defect, found in
 * `market-reads.ts` and repaired there.
 *
 * Its worst call site was `who`. The account is the **key** these two maps are read at, not
 * a value either of them returned, and 10 §5 lists *"a selected account"* among the chosen
 * values that *"can never be represented as verified"*. It was nonetheless rendered under a
 * `verified-finalized` badge in the panel's own subject line, which is a complete provenance
 * claim about a value the chain was never asked for. It now arrives as a `Verified<string>`
 * and is passed through under the caller's own status — this module cannot make an input
 * more verified by holding it.
 *
 * The two balances are genuinely computed from reads this module made, so they descend from
 * them through `derive` — 10 §2.2's *"computed client-side purely from such values"* clause.
 *
 * @see docs/architecture/02-integration-contract.md §7.4, §8
 * @see docs/architecture/11-frontend-workflows.md §11.2
 * @see docs/architecture/10-frontend-architecture.md §2.1, §2.2, §5
 */

import {
  derive,
  type Finalized,
  type FinalizedBlockRef,
  type StorageItem,
} from '@bleavit/chain-client';
import type { Verified } from '@bleavit/shared-types';

import type { BalancesView } from './balances.js';
import type { UndecodableRead } from './positions.js';

/** A decode failure is data, not an exception — INV-FE-12. */
export type Decoded<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string };

/**
 * The frozen 02 §7.4 surfaces, and the one this screen must never use.
 *
 * `forbidden` is listed rather than merely avoided so `app/tests/screens` can assert it
 * appears nowhere in this module's reads — the prohibition is normative in two documents
 * (11 §11.2, 02 §7.4) and a silently-correct implementation proves nothing about the next
 * edit.
 */
export const BALANCE_READS = Object.freeze({
  account: 'System.Account',
  freeUsdc: 'ForeignAssets.Account',
  forbidden: 'Assets.Account',
} as const);

/** One pin, and finalized storage reads at it. Structural, per `FundingReader`. */
export interface BalanceReader {
  readonly at: FinalizedBlockRef;
  storage(
    key: string,
    type?: 'value' | 'descendantsValues',
  ): Promise<Finalized<readonly StorageItem[]>>;
}

/**
 * Storage-key construction, injected.
 *
 * The USDC location is bound inside `freeUsdc` at the composition root — 02 §7.7 pins the
 * asset per release, so a location parameter here would be a release constant that stops
 * tracking the release. Same shape as `FundingKeys.localFreeUsdc`.
 */
export interface BalanceKeys {
  /** 02 §7.4 — `System.Account(who)`. */
  account(who: string): string;
  /** 02 §7.4 — `ForeignAssets.Account(USDC_LOCATION, who)`. */
  freeUsdc(who: string): string;
}

export interface BalanceDecoders {
  /** `frame_system`'s `AccountInfo`. `undefined` for an absent account — a real zero. */
  readonly account: (
    raw: string,
  ) => Decoded<{ readonly free: bigint; readonly reserved: bigint } | undefined>;
  /** **This** chain's `ForeignAssets.Account`. `undefined` for an absent account. */
  readonly freeUsdc: (raw: string) => Decoded<{ readonly balance: bigint } | undefined>;
}

export interface BalanceReadParams {
  /**
   * Whose balances these are, with the provenance the caller resolved the account under.
   *
   * A `Verified<string>` rather than a bare `string` because it is *rendered* (INV-FE-9),
   * and the caller's rather than this module's because it is a chosen value: 10 §5 says a
   * selected account *"can never be represented as verified"*, and this module reads two
   * maps **keyed** by it rather than reading it. The payload builds the keys; the status
   * reaches the screen untouched.
   */
  readonly who: Verified<string>;
  /** The native asset's unit — a chain identity value (02 §8), supplied, never defaulted. */
  readonly vitDecimals: number;
  readonly vitSymbol: string;
  /** USDC's unit (D-17). */
  readonly usdcDecimals: number;
  readonly usdcSymbol: string;
  /** From `xcmWarning`'s source. Degraded health warns and never blocks (§11.9.2). */
  readonly xcmHealthy: boolean;
}

function firstValue(items: readonly StorageItem[]): string | undefined {
  return items[0]?.value;
}

export async function readBalances(
  reader: BalanceReader,
  keys: BalanceKeys,
  decoders: BalanceDecoders,
  params: BalanceReadParams,
): Promise<BalancesView> {
  const undecodable: UndecodableRead[] = [];
  const who = params.who.value;

  const accountRead = await reader.storage(keys.account(who));
  const accountRaw = firstValue(accountRead.value);
  const account =
    accountRaw === undefined
      ? ({ ok: true, value: undefined } as const)
      : decoders.account(accountRaw);
  if (!account.ok) {
    undecodable.push({
      label: `${BALANCE_READS.account}(who)`,
      rawHex: accountRaw ?? '0x',
      reason: account.reason,
    });
  }

  const usdcRead = await reader.storage(keys.freeUsdc(who));
  const usdcRaw = firstValue(usdcRead.value);
  const usdc =
    usdcRaw === undefined
      ? ({ ok: true, value: undefined } as const)
      : decoders.freeUsdc(usdcRaw);
  if (!usdc.ok) {
    undecodable.push({
      label: `${BALANCE_READS.freeUsdc}(USDC_LOCATION, who)`,
      rawHex: usdcRaw ?? '0x',
      reason: usdc.reason,
    });
  }

  // Each figure descends from the read that produced it, and an **absent** record is a
  // genuine zero computed from that read — the storage answer was *no value*, which is what
  // an untouched account looks like on this chain. An **undecodable** one is absent from the
  // model instead, with its raw bytes in `undecodable`: 10 §2.2 gives a substituted zero no
  // status it may wear, and INV-FE-12 forbids guessing at an encoding.
  return {
    // The caller's own reading, restated rather than re-stamped. A selected account asserts
    // nothing about the chain (10 §5), so whatever badge it arrived with is the honest one.
    who: params.who,
    vit: {
      free: account.ok ? derive(accountRead, () => account.value?.free ?? 0n) : undefined,
      decimals: params.vitDecimals,
      symbol: params.vitSymbol,
    },
    vitReserved: account.ok ? derive(accountRead, () => account.value?.reserved ?? 0n) : undefined,
    usdc: {
      free: usdc.ok ? derive(usdcRead, () => usdc.value?.balance ?? 0n) : undefined,
      decimals: params.usdcDecimals,
      symbol: params.usdcSymbol,
    },
    xcmHealthy: params.xcmHealthy,
    undecodable,
  };
}
