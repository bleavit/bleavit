/**
 * S12/S13's keys and decoders, built from two chains' own artifacts — F18, 11 §11.9.
 *
 * `funding-reads.ts` names the frozen surfaces and *receives* the keys and decoders, because
 * `packages/chain-client` is the only package permitted to import the chain SDK (10 §10.1,
 * app-code rule 13). This file is the other end of that injection: it turns a chain's
 * metadata and descriptors into the four key functions and four decoders those readers need.
 *
 * ## Everything here is per chain, twice
 *
 * There are two chains, and the entire risk of this file is a value from one appearing under
 * the other's label. `readDepositInputs` already refuses two readers with the same chain
 * identity; the same discipline has to hold for the two artifacts *behind* those readers,
 * and it holds here structurally — {@link fundingKeys} and {@link fundingDecoders} take a
 * `local` and an `assetHub` chain and each surface is built from exactly one of them.
 *
 * That is why {@link FundingDecoders} has a decoder per **surface** rather than per shape.
 * Asset Hub's `Assets.Account` and this chain's `ForeignAssets.Account` are both
 * `pallet-assets` records, and binding one decoder to both would put one chain's bytes
 * through the other chain's codec — see the note on `FundingDecoders`.
 *
 * ## The USDC Location is a parameter with no default
 *
 * `ForeignAssets.Account` is keyed by the **XCM Location** of USDC (02 §7.4/§8), not by the
 * `u32` Asset Hub uses for the same asset (02 §7.7 says so explicitly, and X-11a is the
 * ruling behind it). The Location is a per-release identity pin, exactly like `assetId` in
 * `DepositReadParams` — and for the identical stated reason, it is required with no
 * compiled-in default: a default would be a release constant that no longer tracks the
 * release, and 10 §5.4 forbids a chain value appearing as a literal in this source.
 *
 * The confusion it guards against fails loudly rather than silently, which was measured
 * rather than assumed: handing key 0 the number `1337` throws inside the Location codec.
 * That is worth knowing, because the *other* half of this module's failure mode is silence —
 * a well-formed key for the wrong entry returns no value, and no value renders as **0 USDC**.
 */

import type { ChainCodecs, ChainMetadata, StorageKeyBuilder } from '@bleavit/chain-client';
import { storageDecoder, storageKeyBuilder } from '@bleavit/chain-client';
import {
  FUNDING_READS,
  type Decoded,
  type FundingDecoders,
  type FundingKeys,
} from './funding-reads.js';

/** One chain's two artifacts. Both are needed: metadata has the hashers, descriptors the codecs. */
export interface FundingChain {
  readonly codecs: ChainCodecs;
  readonly metadata: ChainMetadata;
}

export interface FundingChains {
  readonly local: FundingChain;
  readonly assetHub: FundingChain;
}

export interface FundingKeyInputs extends FundingChains {
  /**
   * The XCM `Location` of USDC as this chain's `ForeignAssets` codec accepts it — 02 §8.
   *
   * `unknown` rather than a shape written out here, deliberately. The only authority on what
   * a `Location` looks like is the chain's own codec, and restating it in this file would be
   * a second declaration to keep in step with the first — with no compiler able to compare
   * them. A wrong value is refused by the codec at key-construction time.
   */
  readonly usdcLocation: unknown;
}

/** Split a `Pallet.Item` name so the key and the decoder cannot drift into different items. */
function split(qualified: string): readonly [string, string] {
  const [pallet, item] = qualified.split('.');
  if (pallet === undefined || item === undefined) {
    throw new Error(`"${qualified}" is not a Pallet.Item name`);
  }
  return [pallet, item];
}

function builder(chain: FundingChain, qualified: string): StorageKeyBuilder {
  const [pallet, item] = split(qualified);
  return storageKeyBuilder(chain.codecs, chain.metadata, pallet, item);
}

/**
 * The four key functions S12/S13 need.
 *
 * Each builder is constructed **once, here**, so the arity cross-check between metadata and
 * codecs runs at composition time rather than on the first read — a chain whose metadata and
 * descriptors disagree fails while the app is wiring itself up, not while a user is looking
 * at a deposit screen.
 */
export function fundingKeys(inputs: FundingKeyInputs): FundingKeys {
  const assetHubUsdc = builder(inputs.assetHub, FUNDING_READS.assetHub.usdc);
  const assetHubAccount = builder(inputs.assetHub, FUNDING_READS.assetHub.account);
  const phaseFlags = builder(inputs.local, FUNDING_READS.local.phaseFlags);
  const localFreeUsdc = builder(inputs.local, FUNDING_READS.local.freeUsdc);

  return {
    assetHubUsdc: (assetId, who) => assetHubUsdc.key([assetId, who]),
    assetHubAccount: (who) => assetHubAccount.key([who]),
    phaseFlags: () => phaseFlags.key([]),
    // The Location first, the account second — the key order `ForeignAssets.Account`
    // declares. Reversing them encodes both values correctly and hashes them into a key for
    // nothing, which reads as an empty balance.
    localFreeUsdc: (who) => localFreeUsdc.key([inputs.usdcLocation, who]),
  };
}

/** A `pallet-assets` account record, as far as the funding screens need it. */
interface AssetAccountValue {
  readonly balance: bigint;
}

/** A `frame_system` account record, reduced to §11.9.1's one question about it. */
interface SystemAccountValue {
  readonly providers: number;
  readonly sufficients: number;
}

function asAssetAccount(surface: string) {
  return (value: unknown): Decoded<AssetAccountValue | undefined> => {
    if (typeof value !== 'object' || value === null) {
      return { ok: false, reason: `${surface} did not decode to a record` };
    }
    const balance = (value as Partial<AssetAccountValue>).balance;
    if (typeof balance !== 'bigint') {
      return {
        ok: false,
        reason:
          `${surface} decoded to a record without a bigint \`balance\`. This runtime encodes ` +
          'the asset account differently than this release expects.',
      };
    }
    return { ok: true, value: { balance } };
  };
}

/**
 * Viability, from the account record — 11 §11.9.1's *"AH existential/fee viability"* row.
 *
 * An account is viable when something is keeping it alive: a provider reference, or a
 * sufficient asset. USDC is a sufficient asset on Asset Hub, so a user holding only USDC has
 * `providers: 0` and `sufficients: 1` and is perfectly able to receive — reading viability
 * off `providers` alone would block exactly the users this screen exists for.
 */
function asSystemAccount(value: unknown): Decoded<{ readonly viable: boolean } | undefined> {
  if (typeof value !== 'object' || value === null) {
    return { ok: false, reason: 'System.Account did not decode to a record' };
  }
  const record = value as Partial<SystemAccountValue>;
  if (typeof record.providers !== 'number' || typeof record.sufficients !== 'number') {
    return {
      ok: false,
      reason:
        'System.Account decoded to a record without numeric `providers` and `sufficients`. ' +
        'Viability cannot be established from it, and INV-FE-12 gives an unestablished ' +
        'precondition one answer: not established.',
    };
  }
  return { ok: true, value: { viable: record.providers > 0 || record.sufficients > 0 } };
}

function asBitset(value: unknown): Decoded<number> {
  // `Number.isInteger`, not `typeof === 'number'`: a u32 that decoded to a float is not a
  // bitset, and testing bit 4 of one yields nonsense rather than failing. V-115 is the record
  // of what a misread `PhaseFlags` costs — it decides whether D-13's caps apply.
  if (!Number.isInteger(value)) {
    return { ok: false, reason: 'Constitution.PhaseFlags did not decode to an integer' };
  }
  return { ok: true, value: value as number };
}

/** Lift a `chain-client` decode result through a shape check, per `shell-decoders.ts`. */
function through<T>(
  decode: (raw: string) => Decoded<unknown>,
  narrow: (value: unknown) => Decoded<T>,
): (raw: string) => Decoded<T> {
  return (raw) => {
    const decoded = decode(raw);
    return decoded.ok ? narrow(decoded.value) : { ok: false, reason: decoded.reason };
  };
}

function decoderFor<T>(
  chain: FundingChain,
  qualified: string,
  narrow: (value: unknown) => Decoded<T>,
): (raw: string) => Decoded<T> {
  const [pallet, item] = split(qualified);
  return through(storageDecoder(chain.codecs, pallet, item), narrow);
}

/** The four decoders, each bound to the chain whose bytes it will actually see. */
export function fundingDecoders(chains: FundingChains): FundingDecoders {
  return {
    assetHubUsdc: decoderFor(
      chains.assetHub,
      FUNDING_READS.assetHub.usdc,
      asAssetAccount(FUNDING_READS.assetHub.usdc),
    ),
    localFreeUsdc: decoderFor(
      chains.local,
      FUNDING_READS.local.freeUsdc,
      asAssetAccount(FUNDING_READS.local.freeUsdc),
    ),
    systemAccount: decoderFor(chains.assetHub, FUNDING_READS.assetHub.account, asSystemAccount),
    phaseFlags: decoderFor(chains.local, FUNDING_READS.local.phaseFlags, asBitset),
  };
}
