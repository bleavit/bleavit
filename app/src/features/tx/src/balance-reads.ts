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
 * @see docs/architecture/02-integration-contract.md §7.4, §8
 * @see docs/architecture/11-frontend-workflows.md §11.2
 */

import type { Finalized, FinalizedBlockRef, StorageItem } from '@bleavit/chain-client';
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
  readonly who: string;
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

  const accountRaw = firstValue((await reader.storage(keys.account(params.who))).value);
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

  const usdcRaw = firstValue((await reader.storage(keys.freeUsdc(params.who))).value);
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

  // A failed decode contributes zero **and** an `undecodable` row. The row is what says the
  // figure is not to be believed; without it the zero would be indistinguishable from an
  // account that really holds nothing, which is the one confusion this screen cannot afford.
  return {
    who: finalized(params.who),
    vit: {
      free: finalized(account.ok ? (account.value?.free ?? 0n) : 0n),
      decimals: params.vitDecimals,
      symbol: params.vitSymbol,
    },
    vitReserved: finalized(account.ok ? (account.value?.reserved ?? 0n) : 0n),
    usdc: {
      free: finalized(usdc.ok ? (usdc.value?.balance ?? 0n) : 0n),
      decimals: params.usdcDecimals,
      symbol: params.usdcSymbol,
    },
    xcmHealthy: params.xcmHealthy,
    undecodable,
  };
}
