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
 *
 * ## Each leg's pin comes off its own read, and a failed decode has no pin at all
 *
 * The stamping helper this module used to carry — `finalizedAt(at, value)` — took the leg's
 * `FinalizedBlockRef` and any value whatsoever, so keeping the two legs apart was a matter of
 * passing the right first argument at each of its two call sites. `derive` removes the
 * argument: it carries the pin of the read handed to it, so an Asset Hub figure can only be
 * badged with the Asset Hub read that produced it.
 *
 * It also removes the second, quieter defect at those sites. Both passed `0n` on a decode
 * failure and badged it `verified-finalized`, which 10 §2.2 assigns *"only to values read
 * through smoldot with storage proofs checked"* — a substituted zero is not one, and it is
 * not made one by the failure also appearing in `undecodable`. A balance that could not be
 * decoded is now **absent**, and `depositBlocks`/`withdrawBlocks` block on the absence. The
 * safe direction is unchanged; what changes is that the screen no longer shows a manufactured
 * zero under a verified badge while doing it.
 */

import { derive, type Finalized, type FinalizedBlockRef, type StorageItem } from '@bleavit/chain-client';
import type { Verified } from '@bleavit/shared-types';
import type { DepositCaps, DepositInputs, WithdrawInputs } from './funding.js';

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
 * D-13's own surfaces — all local, all frozen, and deliberately **not** in `FUNDING_READS`.
 *
 * `paramsApi` is the read and `params` the prefix it is cross-checked against, per
 * `WELFARE_READS`: 02 §9 binds the two Phase-3 caps to **`params()`** — *"using the canonical
 * keys in 13, combined with §7.4 `CumulativeDeposits`"* — and 11 §11.4 rule 2 makes each
 * precondition an exact chain read, so the client asks the runtime for the projection rather
 * than re-deriving one from the stored `ParamRecord`.
 *
 * `usdcAsset` is the term the *global* cap is measured against, and it is here because
 * nothing else can supply it. 09 §5.2 caps **total local USDC issuance**, and 02 §9's binding
 * row names only `params()` and `CumulativeDeposits` — which together answer the per-account
 * half and leave the global half with no meter. `ForeignAssets.Asset` is frozen in 02 §8 and
 * its `AssetDetails.supply` is exactly what the runtime's own `ForeignUsdcIssuance` provider
 * reads, so this is a frozen surface put to the use the runtime already makes of it, not a
 * new read invented to fill a gap.
 *
 * ## Why a separate object, stated rather than assumed
 *
 * `FUNDING_READS` is split `assetHub`/`local` because S12/S13 span **two chains**, and the
 * 15 §4.8 client-boot drill binds that split per leg: `REQUIRED_SURFACES` in
 * `zombienet/drills/js/client-boot-rules.js` names the surfaces a live run must have read,
 * and `drill-harness-rules.test.ts` asserts the two agree in both directions. The three reads
 * here belong to a **third** reader on one chain — the drill opens no constitution reader and
 * does not perform them — so folding them into `FUNDING_READS.local` would demand of the
 * drill a read it never makes, and the honest place for them is beside the reader that does.
 * `drill-harness-rules.test.ts` asserts the exclusion, so this is a stated boundary rather
 * than a set that quietly escaped one.
 */
export const CAPS_READS = Object.freeze({
  paramsApi: 'params',
  params: 'Constitution.Params',
  cumulativeDeposits: 'InflowCaps.CumulativeDeposits',
  usdcAsset: 'ForeignAssets.Asset',
} as const);

/**
 * The two 13 §1 keys D-13's caps live under — *not* the row headings above them.
 *
 * 13 spells the per-account row **`phase3.deposit_cap` (key: `phase3.dep_cap`)**, and only
 * the parenthesised form is the `ParamKey`: 13 rule 6 caps a key at 16 bytes and
 * `phase3.deposit_cap` is 18, so a client asking `params()` for the heading gets a
 * well-formed request the runtime simply has no record for — and `params()` answers a key it
 * does not hold by **omitting** it, which is silence rather than an error. The runtime's own
 * `key16(b"phase3.dep_cap")` call sites are the oracle (`crates/constitution-core`,
 * `runtime/bleavit-runtime/src/configs.rs`).
 *
 * These are key **names**, not values, so app-code rule 7 is not in play: the client must
 * name what it is asking for, and the number that comes back is the chain's.
 */
export const PHASE3_CAP_KEYS = Object.freeze({
  /** Global cap on total local USDC issuance — 13 §1, 09 §5.2. */
  globalTvl: 'phase3.tvl_cap',
  /** Per-account cumulative deposit cap — 13 §1's canonical key, 09 §5.2. */
  perAccount: 'phase3.dep_cap',
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
  /**
   * D-13's caps and meters, from {@link readDepositCaps} on the **local** chain.
   *
   * Absent ⇒ `depositBlocks` blocks while the sudo bit is set. It stays a parameter rather
   * than a read this function makes, because the caps come off the local reader through the
   * constitution's runtime API and this function's whole shape is the two-chain split — a
   * `crossCheckedCall` here would have to be reachable from the Asset Hub reader too.
   */
  readonly caps?: DepositCaps;
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

  // The caps arrive already stamped, because they are read by the same local reader through
  // the constitution surface rather than here. That makes them the one place a foreign-chain
  // value could enter the local leg unchallenged, so their chain is checked against the local
  // reader's — the same refusal `fundingReaders` makes, applied to a value instead of a port.
  if (params.caps !== undefined) {
    for (const [label, cap] of [
      ['globalTvlCap', params.caps.globalTvlCap],
      ['totalIssuance', params.caps.totalIssuance],
      ['perAccountCap', params.caps.perAccountCap],
      ['accountCumulative', params.caps.accountCumulative],
    ] as const) {
      const chain = 'chain' in cap.status ? cap.status.chain : undefined;
      if (chain !== readers.local.at.chain) {
        throw new WrongChainInputError(`the D-13 cap "${label}"`, readers.local.at.chain, chain);
      }
    }
  }

  const usdcRead = await readers.assetHub.storage(keys.assetHubUsdc(params.assetId, params.who));
  const usdcRaw = firstValue(usdcRead.value);
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
  // An **absent** account is a real zero and stays badged; an **undecodable** one is absent
  // from the model. The two look the same on the wire and are not the same fact.
  const assetHubBalance = usdcDecoded.ok
    ? derive(usdcRead, () => usdcDecoded.value?.balance ?? 0n)
    : undefined;

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
      // The Asset Hub leg, carrying the **Asset Hub** read's own pin. A failed decode makes
      // it absent, and `depositBlocks` blocks on the absence — the same direction the old
      // substituted `0n` produced, minus the claim that the chain answered it.
      assetHubBalance,
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

/* ------------------------------------------------------- D-13's caps (11 §11.9.1, SQ-1034) */

/**
 * The local reader the caps need — storage **and** a cross-checked runtime call.
 *
 * A separate interface from {@link FundingReader} rather than a widening of it, because
 * `FundingReader` is the type **both** legs are held to and Asset Hub has no `params()`. A
 * `crossCheckedCall` on that interface would be a method the Asset Hub reader must either
 * implement or fake, and the one defect this module exists to prevent is a local question
 * answered by the foreign chain.
 *
 * The FE-P2 pairing is not optional here: these reads gate a signature, and 02 §3 asks a
 * conservative client to cross-check every runtime-API result on the transaction path
 * against the storage prefix behind it.
 */
export interface CapsReader extends FundingReader {
  crossCheckedCall(source: {
    readonly api: string;
    readonly storagePrefix: string;
    readonly argsHex?: string;
  }): Promise<Finalized<{ readonly result: string; readonly witness: readonly StorageItem[] }>>;
}

/** Key and argument construction for D-13's three surfaces, injected as everywhere else. */
export interface CapsKeys {
  /**
   * SCALE arguments for `params(keys)` — a `BoundedVec<ParamKey, 64>` of 16-byte keys.
   *
   * Takes the 13 key **names**; padding them to `ParamKey` is the composition root's job,
   * because that is a chain encoding and this module may not import the chain SDK.
   */
  paramsArgs(keys: readonly string[]): string;
  /** 02 §7.4 — `InflowCaps.CumulativeDeposits(who)` on this chain. */
  cumulativeDeposits(who: string): string;
  /** 02 §8 — `ForeignAssets.Asset(usdcLocation)`, keyed by Location and not by an index. */
  usdcAsset(): string;
}

/** One `params()` row, reduced to the two fields a cap check reads. */
export interface CapParamView {
  /** The 13 key name, with `ParamKey`'s zero padding already removed. */
  readonly key: string;
  /** `ParamView.value` — the raw `u128` scalar, which for a `Balance` key is base units. */
  readonly value: bigint;
}

/** The value decoders, one per surface — never one per shape (see {@link FundingDecoders}). */
export interface CapsDecoders {
  /** The whole `params(keys)` answer — a `BoundedVec<ParamView, 64>` (02 §3/§4). */
  readonly paramViews: (raw: string) => Decoded<readonly CapParamView[]>;
  /**
   * The FE-P2 witness — `Constitution.Params`' own entries, read at the same pin (10 §11).
   *
   * A decoder of its own rather than a reuse of {@link paramViews}, because the two shapes are
   * genuinely different: `params()` answers `ParamView`s that the runtime computes, and the
   * storage prefix holds `ParamRecord`s. Only the scalar the cap check consumes is common to
   * both, which is exactly what makes the comparison meaningful rather than circular.
   */
  readonly paramEntries: (items: readonly StorageItem[]) => Decoded<readonly CapParamView[]>;
  /** `InflowCaps.CumulativeDeposits` — a bare `u128` meter. */
  readonly cumulativeDeposits: (raw: string) => Decoded<bigint>;
  /** `ForeignAssets.Asset` — `AssetDetails`, of which only `supply` is read. */
  readonly usdcAsset: (raw: string) => Decoded<{ readonly supply: bigint }>;
}

export interface DepositCapsRead {
  /**
   * The four figures, or **absent** when any one of them could not be established.
   *
   * All four or none, because the two checks are not independent of each other's failure
   * modes in the way a partial answer would suggest: a screen offered one cap and not the
   * other would run half of D-13's containment while looking like it ran all of it.
   */
  readonly caps: DepositCaps | undefined;
  readonly undecodable: readonly UndecodableRead[];
}

/**
 * Read D-13's exposure caps — 11 §11.9.1's Phase-3 row, on the **local** reader.
 *
 * > global TVL cap headroom and per-account deposit cap headroom (constitution keys)
 * > re-read; a deposit that would exceed either is blocked with the cap shown
 *
 * ## What it does not do
 *
 * It does not read `PhaseFlags`. The bit that decides whether these caps *bind* is read once,
 * by `readDepositInputs`, and reading it a second time here would put two answers to one
 * question in one model — possibly from two blocks. `depositBlocks` consults the caps only
 * while `bootstrapPhase`, so calling this outside the bootstrap window is wasted work rather
 * than a wrong answer.
 *
 * ## Absence is graded, because the chain grades it
 *
 * An absent `CumulativeDeposits(who)` row is a **real zero**: the pallet declares the map
 * `ValueQuery` and never writes a zero entry (`pallets/inflow-caps/src/lib.rs` refuses to,
 * and `try_state` rejects one), so "no row" is the chain saying this account has deposited
 * nothing. An absent `ForeignAssets.Asset(USDC)` row is not the analogous fact: 02 §8 freezes
 * that row as chain identity, so its absence means the client cannot establish issuance at
 * all — and a substituted `0n` there would report maximum headroom under the cap that matters
 * most. And `params()` **omits** a key it holds no record for (13 rule 7), which is the same
 * silence, so a missing row is reported rather than read as an absent limit.
 */
export async function readDepositCaps(
  reader: CapsReader,
  keys: CapsKeys,
  decoders: CapsDecoders,
  params: { readonly who: string },
): Promise<DepositCapsRead> {
  const undecodable: UndecodableRead[] = [];
  const wanted = [PHASE3_CAP_KEYS.globalTvl, PHASE3_CAP_KEYS.perAccount];

  const paramsRead = await reader.crossCheckedCall({
    api: CAPS_READS.paramsApi,
    storagePrefix: CAPS_READS.params,
    argsHex: keys.paramsArgs(wanted),
  });
  const views = decoders.paramViews(paramsRead.value.result);
  if (!views.ok) {
    undecodable.push({
      label: CAPS_READS.paramsApi,
      rawHex: paramsRead.value.result,
      reason: views.reason,
    });
  }
  // **FE-P2's other half, which this reader fetched and discarded until 2026-08-09.**
  //
  // `crossCheckedCall` reads `Constitution.Params` at the same pin as `params()` precisely so
  // the view can be admitted *alongside the prefix it must agree with* (10 §11's fourth
  // bullet, 10 §4.2). Fetching the witness and never comparing it is the shape this repository
  // keeps finding: a check that cannot fail reports the same thing as one that passed, and the
  // module's own note already said the FE-P2 pairing is not optional here.
  const witness = decoders.paramEntries(paramsRead.value.witness);
  if (!witness.ok) {
    undecodable.push({
      label: CAPS_READS.params,
      rawHex: paramsRead.value.witness.map((item) => item.value ?? '0x').join(''),
      reason: witness.reason,
    });
  }
  const stored: ReadonlyMap<string, bigint> = witness.ok
    ? new Map(witness.value.map((row) => [row.key, row.value] as const))
    : new Map();

  const capOf = (key: string): Verified<bigint> | undefined => {
    if (!views.ok) return undefined;
    const view = views.value.find((row) => row.key === key);
    if (view === undefined) {
      undecodable.push({
        label: `${CAPS_READS.paramsApi}(${key})`,
        rawHex: '0x',
        reason:
          'params() did not answer for this key: either the constitution holds no such ' +
          'record, or the record is malformed and the runtime skipped it rather than ' +
          'presenting it as unbounded. Either way the cap is unknown, not absent.',
      });
      return undefined;
    }
    // The witness decides nothing on its own — it is the second view that has to agree. A key
    // the runtime answered and the prefix does not hold is a **disagreement**, not an absence:
    // `params()` omits a key it holds no record for (13 rule 7), so a view row implies a stored
    // record, and the two were read at one pin so a difference cannot be a race.
    // An unreadable second view is **not** agreement. 10 §11 admits the API result only
    // *alongside* the prefix it must agree with, so a prefix this release cannot decode leaves
    // the view uncorroborated rather than corroborated. The failure is already reported once,
    // above, against the prefix itself — reporting it again per key would say the same thing
    // three times about one read.
    if (!witness.ok) return undefined;
    {
      const fromStorage = stored.get(key);
      if (fromStorage !== view.value) {
        undecodable.push({
          label: `${CAPS_READS.paramsApi}(${key})`,
          rawHex: paramsRead.value.result,
          reason:
            `${CAPS_READS.paramsApi}() reports ${view.value} for this key and ` +
            `${CAPS_READS.params} reports ` +
            `${fromStorage === undefined ? 'no record' : String(fromStorage)} at the same ` +
            'finalized block. The runtime view and its own storage disagree, so the cap is ' +
            'not established and the deposit is refused rather than checked against the ' +
            'lower of the two (10 §4.2, FE-P2).',
        });
        return undefined;
      }
    }
    return derive(paramsRead, () => view.value);
  };
  const globalTvlCap = capOf(PHASE3_CAP_KEYS.globalTvl);
  const perAccountCap = capOf(PHASE3_CAP_KEYS.perAccount);

  const meterRead = await reader.storage(keys.cumulativeDeposits(params.who));
  const meterRaw = firstValue(meterRead.value);
  // A `ValueQuery` map with no row for this account is a badged zero, not a guess.
  const meterDecoded =
    meterRaw === undefined ? ({ ok: true, value: 0n } as const) : decoders.cumulativeDeposits(meterRaw);
  if (!meterDecoded.ok) {
    undecodable.push({
      label: `${CAPS_READS.cumulativeDeposits}(who)`,
      rawHex: meterRaw ?? '0x',
      reason: meterDecoded.reason,
    });
  }
  const accountCumulative = meterDecoded.ok ? derive(meterRead, () => meterDecoded.value) : undefined;

  const assetRead = await reader.storage(keys.usdcAsset());
  const assetRaw = firstValue(assetRead.value);
  const assetDecoded =
    assetRaw === undefined
      ? ({
          ok: false,
          reason:
            'the USDC asset record 02 §8 freezes is not present at this block, so total ' +
            'issuance — the quantity phase3.tvl_cap bounds — cannot be established. It is ' +
            'not read as zero: a zero here would report the whole cap as headroom.',
        } as const)
      : decoders.usdcAsset(assetRaw);
  if (!assetDecoded.ok) {
    undecodable.push({
      label: `${CAPS_READS.usdcAsset}(USDC)`,
      rawHex: assetRaw ?? '0x',
      reason: assetDecoded.reason,
    });
  }
  const totalIssuance = assetDecoded.ok ? derive(assetRead, () => assetDecoded.value.supply) : undefined;

  const caps =
    globalTvlCap !== undefined &&
    totalIssuance !== undefined &&
    perAccountCap !== undefined &&
    accountCumulative !== undefined
      ? { globalTvlCap, totalIssuance, perAccountCap, accountCumulative }
      : undefined;

  return { caps, undecodable };
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
  const read = await reader.storage(keys.localFreeUsdc(params.who));
  const raw = firstValue(read.value);
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
      // Absent when the decode failed, for the reason the deposit leg gives. `withdrawBlocks`
      // blocks on the absence rather than on a zero the chain never stated.
      freeBalance: decoded.ok ? derive(read, () => decoded.value?.balance ?? 0n) : undefined,
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
