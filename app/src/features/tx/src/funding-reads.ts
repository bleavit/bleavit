/**
 * S12/S13's reads — 11 §11.9.1 and §11.9.2 over **two** light clients.
 *
 * Every other reader in this client takes one reader and stamps one pin onto every leaf
 * (`readShellState`, `readProposals`). This one cannot, and the difference is the whole
 * module: the deposit screen shows Asset Hub state beside futarchy-chain state, read from
 * two light clients at two finalized blocks that have no relation to each other.
 *
 * ## The mistake this module is built to make impossible
 *
 * `readDepositInputs(reader, reader, …)` — one reader passed twice — is a single-character
 * slip that typechecks perfectly, and every Asset Hub figure on screen would then be a
 * futarchy-chain read wearing an Asset Hub label. Nothing downstream could notice: both
 * chains answer every read they are given, the badges would say `verified-finalized`, and
 * they would be telling the truth about the wrong chain. So `fundingReaders()` **refuses two
 * readers with the same chain identity**, which is the same refusal `attachAssetHub` makes
 * against a bundle pinning our own genesis, at the other end of the same path.
 *
 * ## Two legs, two provenances, and no `assertOnePin`
 *
 * `readShellState` re-checks that every leaf carries the reader's pin. The analogue here
 * would be wrong: a deposit model whose leaves all shared one pin would be a model that had
 * mixed the chains. What is checked instead is per **leg** — each Asset Hub leaf carries the
 * Asset Hub reader's pin and each local leaf the local one — which is the property 11 §11.9
 * states as *"both legs are labelled with their own provenance"*.
 *
 * ## Why the two legs fail differently, and why that is not an inconsistency
 *
 * §11.9.1 lists *"AH connection synced & descriptors compatible"* as a precondition **row**:
 * without Asset Hub there is no deposit, and E17 requires the flow *"blocked with diagnostics
 * (never a blind 'send anyway')"*. §11.9.2 says the opposite for withdraw — *"without the AH
 * connection the check degrades to a warning, never silently skipped"* — because withdraw is
 * a local `pallet_xcm` call that Asset Hub's availability does not gate. Encoding one rule
 * for both legs would either take withdraw offline whenever Asset Hub is down, or let a
 * deposit proceed on unread preconditions. So deposit takes both readers and withdraw takes
 * only the local one, and the Asset Hub reader is not even in scope for it.
 *
 * ## Keys are injected, for the same reason decoders are
 *
 * A storage key is SCALE-encoded, and `packages/chain-client` is the only package permitted
 * to import `polkadot-api` (10 §10.1, app-code rule 13). So this module names the frozen
 * surfaces and receives the encoder, exactly as `readShellState` receives its decoders.
 */

import type { Finalized, FinalizedBlockRef, StorageItem } from '@bleavit/chain-client';
import type { Verified } from '@bleavit/shared-types';
import type { DepositInputs, WithdrawInputs } from './funding.js';

/** A decode failure is data, not an exception — INV-FE-12, app-code rule 10. */
export type Decoded<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string };

/** A value the client read but could not interpret. Rendered, never substituted. */
export interface UndecodableRead {
  readonly label: string;
  readonly rawHex: string;
  readonly reason: string;
}

/** One pin, and finalized storage reads at it. Structural, per `ShellStateReader`. */
export interface FundingReader {
  readonly at: FinalizedBlockRef;
  storage(
    key: string,
    type?: 'value' | 'descendantsValues',
  ): Promise<Finalized<readonly StorageItem[]>>;
}

/**
 * The frozen surfaces these screens read.
 *
 * `assetHub.*` are 02 §7.7's three, and the set is **closed**: §7.7 freezes exactly those,
 * so a fourth Asset Hub read would be one 10 §5.2's foreign classifier never probes — which
 * means the compatibility lattice could not fail on it, and a runtime upgrade that moved it
 * would leave the client reporting `full` while the deposit path silently broke (SQ-580's
 * exact shape). `local.*` are 02 §7.3/§7.4 reads on this chain.
 */
export const FUNDING_READS = Object.freeze({
  assetHub: Object.freeze({
    usdc: 'Assets.Account',
    account: 'System.Account',
  }),
  local: Object.freeze({
    phaseFlags: 'Constitution.PhaseFlags',
    freeUsdc: 'ForeignAssets.Account',
  }),
} as const);

/**
 * 02 §7.3 bit 4, `sudo present`.
 *
 * Named, and named **here**, because 11 §11.9.1 and §11.10 both turn on it and V-115 is the
 * record of what happens when it is treated as a number: `PhaseFlags` is a `u32` bitset with
 * no ordering, a real bootstrap value of 17 satisfies `17 >= 4` and fails `17 < 4`, so the
 * numeric readings hide the sudo banner and skip D-13's caps respectively — each in the
 * unsafe direction, and neither raising an error.
 */
export const SUDO_PRESENT_BIT = 1 << 4;

export function sudoActive(phaseFlags: number): boolean {
  return (phaseFlags & SUDO_PRESENT_BIT) !== 0;
}

/**
 * Storage-key construction, injected.
 *
 * Per-surface functions rather than one `key(pallet, item, ...args)`, because a single
 * generic entry point invites a call site to pass the wrong arguments for the wrong map and
 * nothing would catch it — the key would encode to *something*, the read would return
 * nothing, and an empty balance is indistinguishable from a real zero.
 */
export interface FundingKeys {
  /** 02 §7.7 — Asset Hub `Assets.Account(assetId, who)`. */
  assetHubUsdc(assetId: number, who: string): string;
  /** 02 §7.7 — Asset Hub `System.Account(who)`. */
  assetHubAccount(who: string): string;
  /** 02 §7.3 — this chain's `Constitution.PhaseFlags`. */
  phaseFlags(): string;
  /** 02 §7.4 — this chain's `ForeignAssets.Account(usdcLocation, who)`. */
  localFreeUsdc(who: string): string;
}

/**
 * The value decoders, **one per surface** — never one per shape.
 *
 * The USDC balance is read on both chains, and an earlier version served both with a single
 * `assetAccount` decoder because both are `pallet-assets` account records. That is the same
 * mistake as `readDepositInputs(reader, reader, …)` wearing different clothes: a decoder is
 * bound to one chain's codecs at the composition root, so one of the two legs would have
 * been decoding Asset Hub bytes through this chain's type or the reverse.
 *
 * It happened to work. Measured on the pinned pair: the two `AssetAccount` types are
 * byte-identical today, and each chain's codec decodes the other's record. But that is a
 * coincidence of both runtimes carrying the same `pallet-assets` with the same `Extra`, it
 * is gated by nothing, and the day it stops holding the failure is either a spurious decode
 * error or — worse, and quite possible if a field is added ahead of `balance` — a wrong
 * balance rendered with a `verified-finalized` badge.
 *
 * So the surfaces are named separately, exactly as {@link FundingKeys} names them.
 */
export interface FundingDecoders {
  /** 02 §7.7 — Asset Hub's `Assets.Account`. `undefined` for an absent account, not a failure. */
  readonly assetHubUsdc: (raw: string) => Decoded<{ readonly balance: bigint } | undefined>;
  /** 02 §7.4 — **this** chain's `ForeignAssets.Account`. A different chain, a different codec. */
  readonly localFreeUsdc: (raw: string) => Decoded<{ readonly balance: bigint } | undefined>;
  /**
   * A `frame_system` account record, reduced to the one question §11.9.1 asks of it.
   *
   * `undefined` for an absent account. That is **not** a decode failure and **not** a viable
   * account either — it is the third state, and collapsing it into either is what
   * `destinationWarning` already refuses to do on the withdraw side.
   */
  readonly systemAccount: (raw: string) => Decoded<{ readonly viable: boolean } | undefined>;
  readonly phaseFlags: (raw: string) => Decoded<number>;
}

/**
 * The two readers, proven distinct.
 *
 * A branded pair rather than a plain object literal: `readDepositInputs` accepts only a value
 * produced here, so the same-chain check cannot be skipped by assembling `{ local, assetHub }`
 * at the call site. The brand is a module-private symbol in the type, the construction
 * `Finalized<T>` uses (10 §2.1) and for the same reason — a structural shape would be
 * satisfiable by any object literal, which is exactly the check being avoided.
 */
declare const readerPairBrand: unique symbol;

export interface FundingReaders {
  readonly local: FundingReader;
  readonly assetHub: FundingReader;
  readonly [readerPairBrand]: true;
}

export class SameChainError extends Error {
  constructor(chain: string) {
    super(
      `the local and Asset Hub readers are both on chain ${chain}. Every Asset Hub figure ` +
        'would be a futarchy-chain read under an Asset Hub label — a true statement about ' +
        'the wrong chain, which no badge and no later check can detect (11 §11.9.1).',
    );
    this.name = 'SameChainError';
  }
}

/**
 * A value supplied to one leg that was read on a different chain.
 *
 * Distinct from `SameChainError` because it reports the opposite mistake — that one is two
 * ports that should differ and do not, this is a value that should match a port and does
 * not — and a shared message could only describe one of them honestly.
 */
export class WrongChainInputError extends Error {
  constructor(label: string, expected: string, actual: string | undefined) {
    super(
      `${label} was read on chain ${String(actual)} while this leg is pinned to ${expected}. ` +
        'A limit read elsewhere would bound this deposit against a cap that does not apply ' +
        'to it (11 §11.9.1, D-13).',
    );
    this.name = 'WrongChainInputError';
  }
}

export function fundingReaders(local: FundingReader, assetHub: FundingReader): FundingReaders {
  if (local.at.chain === assetHub.at.chain) throw new SameChainError(local.at.chain);
  return { local, assetHub } as FundingReaders;
}

function firstValue(items: readonly StorageItem[]): string | undefined {
  return items[0]?.value;
}

/** Stamp a value with a reader's own pin. Each leg calls this with **its** reader. */
function finalizedAt<T>(at: FinalizedBlockRef, value: T): Verified<T> {
  return {
    value,
    status: {
      kind: 'verified-finalized',
      chain: at.chain,
      blockHash: at.blockHash,
      blockNumber: at.blockNumber,
    },
  };
}

/** What the caller must pin per release rather than this module inventing it. */
export interface DepositReadParams {
  readonly who: string;
  /**
   * The Asset Hub USDC asset index — 1337, resolved (02 §8; PLAN.md V-17, V-105).
   *
   * Still a **parameter with no default**, and the reason survives the resolution: 02 §7.7
   * pins the Asset Hub of the relay each release targets, so this is a per-release pin and a
   * compiled-in default would be a release constant that no longer tracks the release.
   */
  readonly assetId: number;
  readonly amount: bigint;
  readonly assetHubFee: bigint;
  /** USDC `min_balance`, 10⁴ — a 02 §8 build-time pin, not a chain read. */
  readonly minBalance: bigint;
  /** From `xcmWarning`'s source; degraded health warns rather than blocks (§11.9.1). */
  readonly xcmHealthy: boolean;
  /**
   * `depositMayProceed(classifyForeign(…))` — 10 §5.2's **foreign** verdict, never the local
   * one. The two are different types precisely so this argument cannot take the wrong verdict.
   */
  readonly assetHubCompatible: boolean;
  /** Bootstrap cap headroom, read on the **local** chain. Absent ⇒ `depositBlocks` blocks. */
  readonly caps?: DepositInputs['caps'];
}

export interface DepositRead {
  readonly inputs: DepositInputs;
  readonly undecodable: readonly UndecodableRead[];
}

/**
 * Read S12's deposit preconditions — Asset Hub leg on the Asset Hub reader, local leg on the
 * local one, each leaf stamped with its own reader's pin.
 */
export async function readDepositInputs(
  readers: FundingReaders,
  keys: FundingKeys,
  decoders: FundingDecoders,
  params: DepositReadParams,
): Promise<DepositRead> {
  const undecodable: UndecodableRead[] = [];
  const ah = readers.assetHub.at;

  // The caps arrive already stamped, because they are read by the same local reader through
  // the constitution surface rather than here. That makes them the one place a foreign-chain
  // value could enter the local leg unchallenged, so their chain is checked against the local
  // reader's — the same refusal `fundingReaders` makes, applied to a value instead of a port.
  if (params.caps !== undefined) {
    for (const [label, cap] of [
      ['globalTvlHeadroom', params.caps.globalTvlHeadroom],
      ['perAccountHeadroom', params.caps.perAccountHeadroom],
    ] as const) {
      const chain = 'chain' in cap.status ? cap.status.chain : undefined;
      if (chain !== readers.local.at.chain) {
        throw new WrongChainInputError(`the D-13 cap "${label}"`, readers.local.at.chain, chain);
      }
    }
  }

  const usdcRaw = firstValue(
    (await readers.assetHub.storage(keys.assetHubUsdc(params.assetId, params.who))).value,
  );
  const usdcDecoded =
    usdcRaw === undefined
      ? ({ ok: true, value: undefined } as const) // an absent account is a real zero balance
      : decoders.assetHubUsdc(usdcRaw);
  if (!usdcDecoded.ok) {
    undecodable.push({
      label: `${FUNDING_READS.assetHub.usdc}(${params.assetId}, who)`,
      rawHex: usdcRaw ?? '0x',
      reason: usdcDecoded.reason,
    });
  }

  const accountRaw = firstValue((await readers.assetHub.storage(keys.assetHubAccount(params.who))).value);
  const accountDecoded =
    accountRaw === undefined
      ? ({ ok: true, value: undefined } as const)
      : decoders.systemAccount(accountRaw);
  if (!accountDecoded.ok) {
    undecodable.push({
      label: `${FUNDING_READS.assetHub.account}(who)`,
      rawHex: accountRaw ?? '0x',
      reason: accountDecoded.reason,
    });
  }

  const flagsRaw = firstValue((await readers.local.storage(keys.phaseFlags())).value);
  const flagsDecoded =
    flagsRaw === undefined
      ? ({ ok: false, reason: 'the storage key returned no value' } as const)
      : decoders.phaseFlags(flagsRaw);
  if (!flagsDecoded.ok) {
    undecodable.push({
      label: FUNDING_READS.local.phaseFlags,
      rawHex: flagsRaw ?? '0x',
      reason: flagsDecoded.reason,
    });
  }

  return {
    inputs: {
      // The Asset Hub leg, stamped with the **Asset Hub** pin. A failed decode contributes 0
      // rather than a guess, and `undecodable` is what says the figure is not to be believed
      // — the balance check then blocks, which is the direction that cannot overspend.
      assetHubBalance: finalizedAt(ah, usdcDecoded.ok ? (usdcDecoded.value?.balance ?? 0n) : 0n),
      amount: params.amount,
      assetHubFee: params.assetHubFee,
      minBalance: params.minBalance,
      // Unread and undecodable collapse here, as they do in `readShellState`: both mean the
      // client cannot establish that sudo is gone, and INV-FE-12 gives them one fail-closed
      // answer — treat the caps as applying (V-115's unsafe direction is skipping them).
      bootstrapPhase: flagsDecoded.ok ? sudoActive(flagsDecoded.value) : true,
      ...(params.caps === undefined ? {} : { caps: params.caps }),
      // Both halves are required: a compatible Asset Hub runtime whose account state could
      // not be established is not a deposit-ready one. E17 blocks the flow with diagnostics
      // rather than sending anyway.
      assetHubReady: params.assetHubCompatible && accountDecoded.ok && accountDecoded.value?.viable === true,
      xcmHealthy: params.xcmHealthy,
    },
    undecodable,
  };
}

export interface WithdrawReadParams {
  readonly who: string;
  readonly amount: bigint;
  readonly localFee: bigint;
  readonly minBalance: bigint;
  readonly ledgerFrozen: boolean;
  /**
   * Destination viability on Asset Hub — `undefined` when Asset Hub could not be read.
   *
   * Supplied rather than read here, and that is the point of §11.9.2: withdraw runs on the
   * local reader alone, so this module cannot be the thing that couples it to Asset Hub's
   * availability. `destinationWarning` turns all three states into copy.
   */
  readonly destinationViable: boolean | undefined;
}

export interface WithdrawRead {
  readonly inputs: WithdrawInputs;
  readonly undecodable: readonly UndecodableRead[];
}

/**
 * Read S13's withdraw preconditions — **local reader only**.
 *
 * The signature is the specification: there is no Asset Hub reader parameter, so no future
 * edit can make withdraw depend on Asset Hub being up without changing this line and meeting
 * §11.9.2 on the way past.
 */
export async function readWithdrawInputs(
  reader: FundingReader,
  keys: FundingKeys,
  decoders: FundingDecoders,
  params: WithdrawReadParams,
): Promise<WithdrawRead> {
  const undecodable: UndecodableRead[] = [];
  const raw = firstValue((await reader.storage(keys.localFreeUsdc(params.who))).value);
  const decoded =
    raw === undefined ? ({ ok: true, value: undefined } as const) : decoders.localFreeUsdc(raw);
  if (!decoded.ok) {
    undecodable.push({
      label: `${FUNDING_READS.local.freeUsdc}(who)`,
      rawHex: raw ?? '0x',
      reason: decoded.reason,
    });
  }

  return {
    inputs: {
      freeBalance: finalizedAt(reader.at, decoded.ok ? (decoded.value?.balance ?? 0n) : 0n),
      amount: params.amount,
      localFee: params.localFee,
      minBalance: params.minBalance,
      // Always present, never conditionally spread: `WithdrawInputs` declares it
      // `boolean | undefined` **required**, so that `undefined` is a value the model must
      // handle rather than a field a caller may omit. `destinationWarning` gives all three
      // states different copy, which an absent field would collapse into "not checked".
      destinationViable: params.destinationViable,
      ledgerFrozen: params.ledgerFrozen,
    },
    undecodable,
  };
}
