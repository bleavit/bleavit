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

import type { ChainApiCodecs, ChainCodecs, ChainMetadata, StorageKeyBuilder } from '@bleavit/chain-client';
import {
  apiArgs,
  apiDecoder,
  concatDigestBytes,
  storageDecoder,
  storageHashers,
  storageKeyBuilder,
  type StorageItem,
} from '@bleavit/chain-client';
import {
  CAPS_READS,
  FUNDING_READS,
  type CapParamView,
  type CapsDecoders,
  type CapsKeys,
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

/* ------------------------------------------------------- D-13's caps (11 §11.9.1, SQ-1034) */

/** The runtime API 02 §3 freezes. Named once so a typo is one failure rather than three. */
const FUTARCHY_API = 'FutarchyApi';

/** `ParamKey`'s width — 13 rule 6's own bound, and the reason `phase3.dep_cap` has that name. */
const PARAM_KEY_BYTES = 16;

/**
 * A 13 key name as the runtime's `ParamKey` — the ASCII name, zero-padded to 16 bytes.
 *
 * This mirrors `constitution_core::key16`, which is the *only* producer of the keys the
 * constitution is indexed by, and it lives here rather than in `funding-reads.ts` because it
 * is a chain encoding. Getting it wrong is silent in the direction that matters: `params()`
 * omits a key it holds no record for, so a mis-padded key yields a short answer rather than
 * an error, and a client reading absence as "no cap" would skip D-13 entirely.
 */
function paramKeyHex(name: string): string {
  const bytes = new TextEncoder().encode(name);
  if (bytes.length > PARAM_KEY_BYTES) {
    throw new Error(
      `"${name}" is ${bytes.length} bytes and a ParamKey is ${PARAM_KEY_BYTES} (13 rule 6). ` +
        'The constitution is indexed by the padded key, so a longer name has no record at ' +
        'all and params() would answer by silently omitting it.',
    );
  }
  const padded = new Uint8Array(PARAM_KEY_BYTES);
  padded.set(bytes, 0);
  let hex = '0x';
  for (const byte of padded) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

/** The inverse — a decoded `ParamKey` back to the 13 name, with its padding removed. */
function paramKeyName(hex: string): Decoded<string> {
  const body = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (body.length !== PARAM_KEY_BYTES * 2 || !/^[0-9a-fA-F]*$/.test(body)) {
    return { ok: false, reason: `a ParamKey is ${PARAM_KEY_BYTES} bytes; this one is "${hex}"` };
  }
  const bytes = new Uint8Array(PARAM_KEY_BYTES);
  for (let i = 0; i < PARAM_KEY_BYTES; i += 1) bytes[i] = Number.parseInt(body.slice(i * 2, i * 2 + 2), 16);
  // Trailing NULs are `key16`'s padding. Stripping them anywhere else would corrupt the name.
  let end = PARAM_KEY_BYTES;
  while (end > 0 && bytes[end - 1] === 0) end -= 1;
  return { ok: true, value: new TextDecoder().decode(bytes.subarray(0, end)) };
}

/**
 * The local chain, plus the **runtime-API** half of its codec surface.
 *
 * `FundingChain` deliberately names only `query`, and widening it to reach `params()` would
 * make every storage-only stub in the suites fail to typecheck for a property none of them
 * touches — the reason `chain-client` declares `ChainApiCodecs` apart from `ChainCodecs` in
 * the first place. So the caps composition names the larger surface it actually reaches, and
 * a `CapsChain` still satisfies `FundingChain` wherever only storage is needed.
 */
export interface CapsChain {
  readonly codecs: ChainCodecs & ChainApiCodecs;
  readonly metadata: ChainMetadata;
}

/** Everything `capsKeys` needs: the local chain and the USDC `Location` its maps are keyed by. */
export interface CapsKeyInputs {
  /** **Local only.** D-13's three surfaces are this chain's; Asset Hub answers none of them. */
  readonly local: CapsChain;
  /** The XCM `Location` of USDC, as `FundingKeyInputs` requires it and for the same reason. */
  readonly usdcLocation: unknown;
}

/**
 * D-13's three key/argument builders, all on the **local** chain.
 *
 * `usdcAsset` takes the same `Location` as `localFreeUsdc` and from the same field, because
 * `ForeignAssets` is keyed by the XCM Location throughout (02 §7.4/§8, X-11a). Two Locations
 * in one composition root would be two things to keep in step with one chain.
 */
export function capsKeys(inputs: CapsKeyInputs): CapsKeys {
  const paramsArgs = apiArgs(inputs.local.codecs, FUTARCHY_API, CAPS_READS.paramsApi);
  const cumulativeDeposits = builder(inputs.local, CAPS_READS.cumulativeDeposits);
  const usdcAsset = builder(inputs.local, CAPS_READS.usdcAsset);

  return {
    // One argument, and it is a *list* — `params(keys)` takes a `BoundedVec<ParamKey, 64>`,
    // so the array is the single argument rather than the argument list.
    paramsArgs: (keys) => paramsArgs([keys.map(paramKeyHex)]),
    cumulativeDeposits: (who) => cumulativeDeposits.key([who]),
    usdcAsset: () => usdcAsset.key([inputs.usdcLocation]),
  };
}

/** One `params()` row, narrowed to the two fields a cap check reads. */
function asParamViews(value: unknown): Decoded<readonly CapParamView[]> {
  if (!Array.isArray(value)) {
    return { ok: false, reason: 'params() did not decode to a list of views' };
  }
  const rows: CapParamView[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) {
      return { ok: false, reason: 'params() returned a view that is not a record' };
    }
    const row = entry as { key?: unknown; value?: unknown };
    if (typeof row.key !== 'string') {
      return { ok: false, reason: 'a params() view carries no ParamKey' };
    }
    if (typeof row.value !== 'bigint') {
      // `ParamView.value` is the `u128` scalar `ParamValue::as_u128()` produced (02 §4). A
      // view whose value is not a bigint is a runtime this release does not understand, and
      // INV-FE-12 renders that rather than coercing it.
      return { ok: false, reason: `params() view "${row.key}" carries no u128 value` };
    }
    const name = paramKeyName(row.key);
    if (!name.ok) return name;
    rows.push({ key: name.value, value: row.value });
  }
  return { ok: true, value: rows };
}

/** The stored `ParamRecord`, narrowed to the scalar `ParamView.value` restates (02 §4). */
function asParamRecordValue(value: unknown): Decoded<bigint> {
  if (typeof value !== 'object' || value === null) {
    return { ok: false, reason: 'Constitution.Params did not decode to a ParamRecord' };
  }
  const scalar = (value as { value?: unknown }).value;
  if (typeof scalar !== 'bigint') {
    return {
      ok: false,
      reason:
        'a stored ParamRecord carries no bigint `value`. The witness exists to disagree with ' +
        'params() when the runtime view and its own storage differ, and a record this release ' +
        'cannot read is not evidence that they agree.',
    };
  }
  return { ok: true, value: scalar };
}

/**
 * The FE-P2 witness decoder for `Constitution.Params` — 10 §11's fourth bullet, 10 §4.2.
 *
 * `params()` answers a `ParamView` the runtime **computes**; this prefix holds the
 * `ParamRecord` it stores. Reducing both to `(name, scalar)` is what makes the comparison
 * meaningful rather than circular — the one field a cap check consumes, from two sources.
 *
 * The name is read out of the storage **key**, because a `ParamRecord` does not carry its own.
 * `ParamKey` is `[u8; 16]`, so its SCALE encoding is exactly those sixteen bytes with no length
 * prefix, and the width is asserted rather than assumed. The offset it starts at comes from the
 * hasher in this chain's own metadata (`concatDigestBytes`) rather than from a tabulated
 * constant, so a runtime that hashed this map differently is read at the right offset instead
 * of a fixed number of bytes late — the same discipline `keySplitter` applies to `Positions`.
 */
function paramWitnessDecoder(local: CapsChain): CapsDecoders['paramEntries'] {
  const [pallet, item] = split(CAPS_READS.params);
  const hashers = storageHashers(local.metadata, pallet, item);
  const [hasher] = hashers;
  if (hashers.length !== 1 || hasher === undefined) {
    throw new Error(
      `"${CAPS_READS.params}" is keyed by ${hashers.length} hashed position(s); 02 §7.3 ` +
        'declares it `ParamKey -> ParamRecord`, one hash. A key read at the wrong offset ' +
        'names the wrong parameter with a perfectly well-formed string.',
    );
  }
  /** `storagePrefix` is `twox128(pallet) ‖ twox128(item)` — two 16-byte digests. */
  const PREFIX_BYTES = 32;
  const digestBytes = concatDigestBytes(hasher);
  const keyOffset = PREFIX_BYTES + digestBytes;
  const scalarOf = decoderFor(local, CAPS_READS.params, asParamRecordValue);

  return (items: readonly StorageItem[]): Decoded<readonly CapParamView[]> => {
    const rows: CapParamView[] = [];
    for (const entry of items) {
      // A key with no value carries no scalar to compare. Skipping it here is what makes it
      // surface as `no record` on the comparison side rather than as a silent agreement.
      if (entry.value === undefined) continue;
      const body = entry.key.startsWith('0x') ? entry.key.slice(2) : entry.key;
      const keyHex = body.slice(keyOffset * 2);
      if (keyHex.length !== PARAM_KEY_BYTES * 2) {
        return {
          ok: false,
          reason:
            `${CAPS_READS.params}: a key carries ${keyHex.length / 2} byte(s) after its ` +
            `${digestBytes}-byte digest, and a ParamKey is ${PARAM_KEY_BYTES}`,
        };
      }
      const name = paramKeyName(`0x${keyHex}`);
      if (!name.ok) return name;
      const scalar = scalarOf(entry.value);
      if (!scalar.ok) return scalar;
      rows.push({ key: name.value, value: scalar.value });
    }
    return { ok: true, value: rows };
  };
}

/** `InflowCaps.CumulativeDeposits` — a bare `u128`, and nothing else is accepted for it. */
function asMeter(value: unknown): Decoded<bigint> {
  if (typeof value !== 'bigint') {
    return {
      ok: false,
      reason:
        'InflowCaps.CumulativeDeposits did not decode to a u128. This runtime meters the ' +
        'Phase-3 per-account cap differently than this release expects.',
    };
  }
  return { ok: true, value };
}

/** `ForeignAssets.Asset` — `AssetDetails`, of which the cap check reads only `supply`. */
function asAssetDetails(value: unknown): Decoded<{ readonly supply: bigint }> {
  if (typeof value !== 'object' || value === null) {
    return { ok: false, reason: 'ForeignAssets.Asset did not decode to a record' };
  }
  const supply = (value as { supply?: unknown }).supply;
  if (typeof supply !== 'bigint') {
    return {
      ok: false,
      reason:
        'ForeignAssets.Asset decoded to a record without a bigint `supply`. Total local USDC ' +
        'issuance is the quantity phase3.tvl_cap bounds, so without it the global cap cannot ' +
        'be checked at all.',
    };
  }
  return { ok: true, value: { supply } };
}

/** D-13's three decoders, each bound to the local chain — the only chain that answers them. */
export function capsDecoders(local: CapsChain): CapsDecoders {
  return {
    paramViews: through(
      apiDecoder(local.codecs, FUTARCHY_API, CAPS_READS.paramsApi),
      asParamViews,
    ),
    paramEntries: paramWitnessDecoder(local),
    cumulativeDeposits: decoderFor(local, CAPS_READS.cumulativeDeposits, asMeter),
    usdcAsset: decoderFor(local, CAPS_READS.usdcAsset, asAssetDetails),
  };
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
