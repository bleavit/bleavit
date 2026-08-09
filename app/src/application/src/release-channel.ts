/**
 * The newer-release pointer a stranded client reads — 02 §12, 10 §5.3. F26.
 *
 * ## The remedy the shell named and never pointed at
 *
 * `CompatNotice`'s `read-only-incompatible` arm told the user that nothing can be signed
 * *"until a newer release is loaded"*, and **no module in `src` or `packages` read
 * `Constitution.ReleaseChannel` at all**. So the client named a remedy it could not help
 * anybody reach, on the one screen whose whole subject is being stuck. 10 §5.3 is explicit
 * about the shape of the repair:
 *
 * > Pinned/stranded releases read the **`ReleaseChannel` fixed-layout raw storage key** in
 * > `pallet-constitution` (SCALE layout frozen forever, readable without current metadata —
 * > D-14) to display the newer-release pointer. The `system.remark` announcement mechanism is
 * > deleted: stranded apps could not decode it, which was its only job.
 *
 * That last sentence is the design constraint, not a footnote. `read-only-incompatible` means
 * this release ships **no descriptors** for the runtime in front of it, so every typed read is
 * gone: `storageKeyBuilder` needs metadata, the PAPI codecs need a descriptor set, and neither
 * exists here. The one thing that still works is a raw key over a raw value, which is why 02
 * §12 freezes both forever and why this module parses by **byte offset** and imports no codec.
 *
 * ## The key is derived, never written down
 *
 * `twox128("Constitution") ++ twox128("ReleaseChannel")` is 02 §12's own definition of the key,
 * and `storagePrefix` is that function. A hex literal would be a second copy of a frozen fact
 * with nothing comparing it to the first — and a wrong storage key does not fail, it returns
 * no value, which is indistinguishable from a chain that names no release. The recorded
 * fixture's key is what pins the derivation (`tests/screens`).
 *
 * ## Absence of a pointer is never evidence of absence
 *
 * Four arms, because a client that cannot state the pointer must not say the same thing as one
 * that read *"there is none"*, and neither may resemble *"you are up to date"*:
 *
 * - {@link ReleaseChannelPointer} `named` — the record names a canonical release. This is the
 *   pointer §5.3 requires, and it carries the Arweave TXID because a version string alone is
 *   not something a stranded user can fetch.
 * - `unnamed` — the read landed and the record names no release. That is a **real** state, not
 *   a defect: the genesis record is 168 zero-ish bytes with `schema = 1`, so a chain that has
 *   never repointed answers exactly this.
 * - `undecodable` — bytes arrived that are not this layout. Rendered with the raw hex per
 *   app-code rule 10 (*"undecodable data renders as raw SCALE with a warning; never guess at
 *   encodings"*), because a guess here sends a user to fetch an artifact nobody published.
 * - `unread` — the read did not land at all.
 *
 * The three failing arms all say, in their own words, that this client could not establish the
 * pointer **and that this is not a statement about whether one exists**. Collapsing them into
 * *"no newer release"* is the defect class this repository keeps finding: a check that answers
 * from the absence of evidence rather than from evidence of absence.
 *
 * ## What this module deliberately does not do
 *
 * It does not decide whether the named release is *newer* than this one. That would be a client
 * computation standing where 11 §11.4 rule 2 requires an exact chain read, and this bundle
 * carries no version constant to compare against in the first place. What the chain publishes
 * is *the canonical release*, so that is the words on screen; the user compares it with the one
 * they are running, which is the comparison they can actually make.
 *
 * It also does not refuse an unexpected `schema` byte. 02 §12 says *"always `1`; any other
 * value ⇒ layout extended append-only, **prefix still valid**"* — so a reader that refused on it
 * would strand exactly the client this key exists to rescue, on the day the layout grows.
 */

import { derive, storagePrefix, type Finalized, type StorageItem } from '@bleavit/chain-client';

/**
 * The item 02 §12 freezes, by name — the key is hashed from these two strings.
 *
 * Separate strings rather than one dotted name for the reason `storage-keys.ts` gives: a name
 * assembled by concatenation hashes into a perfectly well-formed key for an item that does not
 * exist, and the node answers that key with nothing.
 */
export const RELEASE_CHANNEL_READ = Object.freeze({
  pallet: 'Constitution',
  item: 'ReleaseChannel',
} as const);

/** `twox128(pallet) ++ twox128(item)` — 02 §12's frozen raw key, derived rather than copied. */
export function releaseChannelKey(): string {
  return storagePrefix(RELEASE_CHANNEL_READ.pallet, RELEASE_CHANNEL_READ.item);
}

/**
 * 02 §12's frozen offsets, in bytes.
 *
 * Only the fields this pointer renders are named. The rest of the record — the release hash,
 * the minimum supported version, the keyring generation and its revocation bitmask — belong to
 * the 12 §2 signature verification that `tools/verify-release` performs against a downloaded
 * artifact, and reading them here would put two decoders of one layout in the bundle.
 */
const FROZEN_LAYOUT = Object.freeze({
  /** Total width of the frozen prefix. A shorter value is not this record. */
  bytes: 168,
  version: Object.freeze({ at: 1, width: 32 }),
  manifestTxid: Object.freeze({ at: 33, width: 43 }),
  updatedAt: Object.freeze({ at: 108, width: 4 }),
});

/** What the chain publishes about the canonical release — or why this client cannot say. */
export type ReleaseChannelPointer =
  | {
      readonly kind: 'named';
      /** `version: [u8; 32]` — the canonical release's UTF-8 semver. */
      readonly version: Finalized<string>;
      /** `manifest_txid: [u8; 43]` — the Arweave TXID the release is fetched from. */
      readonly manifestTxid: Finalized<string>;
      /** `updated_at: u32` — the block the record was last written at. */
      readonly updatedAt: Finalized<number>;
    }
  /** Read, decoded, and it names no release. A chain that has never repointed says this. */
  | { readonly kind: 'unnamed'; readonly reason: string }
  /** Bytes arrived and are not the frozen layout. Carries them, per app-code rule 10. */
  | { readonly kind: 'undecodable'; readonly reason: string; readonly rawHex: string }
  /** The read did not land. A different fact with a different remedy. */
  | { readonly kind: 'unread'; readonly reason: string };

function firstValue(items: readonly StorageItem[]): string | undefined {
  return items[0]?.value;
}

function hexToBytes(raw: string): Uint8Array | undefined {
  const body = raw.startsWith('0x') ? raw.slice(2) : raw;
  if (body.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(body)) return undefined;
  const out = new Uint8Array(body.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(body.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * A zero-padded fixed-width UTF-8 field, or `undefined` if it is not one.
 *
 * The padding is stripped from the **end** only, and an interior NUL is a refusal rather than a
 * truncation: `"1.4.0\0\0evil"` truncated silently would put a release version on screen that
 * the record does not name. This is the same reading `tools/monitoring/common.py` takes of the
 * same layout, deliberately — one frozen layout should not have two dialects.
 */
function paddedText(bytes: Uint8Array, at: number, width: number): string | undefined {
  const field = bytes.subarray(at, at + width);
  let end = field.length;
  while (end > 0 && field[end - 1] === 0) end -= 1;
  const body = field.subarray(0, end);
  if (body.includes(0)) return undefined;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch {
    return undefined;
  }
}

/**
 * A `u32` LE field — 02 §12 writes every integer in the record this way.
 *
 * Shifts rather than multiplication by place value, and that is a gate rather than a taste:
 * `0x10000` is the frozen value of `ExecutionGuard::MaxPayloadBytes`, so a byte-assembly
 * written with place multipliers trips `check:chain-literals` rule B — correctly, since the
 * rule cannot tell a chain bound from a radix. The final `>>> 0` is load-bearing too: `b3 << 24`
 * is signed in JavaScript, so a channel written past block 2^31 would render as a negative
 * block height.
 */
function u32LittleEndian(bytes: Uint8Array, at: number): number {
  const b0 = bytes[at] ?? 0;
  const b1 = bytes[at + 1] ?? 0;
  const b2 = bytes[at + 2] ?? 0;
  const b3 = bytes[at + 3] ?? 0;
  return ((b3 << 24) | (b2 << 16) | (b1 << 8) | b0) >>> 0;
}

/**
 * Parse a raw `ReleaseChannel` value at 02 §12's frozen offsets.
 *
 * Exported so the layout can be tested against the recorded bytes without a transport, which is
 * the only way to exercise the arms a live chain does not currently produce.
 *
 * The read is passed whole rather than as bytes, so every field the pointer renders descends
 * from it and carries its pin — the discipline `readShellState` follows for the same reason.
 */
export function decodeReleaseChannel(read: Finalized<string | undefined>): ReleaseChannelPointer {
  const raw = read.value;
  if (raw === undefined) {
    return {
      kind: 'unnamed',
      reason: 'the release-channel key holds no value on this chain',
    };
  }
  const bytes = hexToBytes(raw);
  if (bytes === undefined) {
    return { kind: 'undecodable', reason: 'the value is not a hex string', rawHex: raw };
  }
  if (bytes.length < FROZEN_LAYOUT.bytes) {
    return {
      kind: 'undecodable',
      reason:
        `the value is ${bytes.length} bytes and the frozen prefix is ${FROZEN_LAYOUT.bytes} ` +
        '(02 §12)',
      rawHex: raw,
    };
  }
  const version = paddedText(bytes, FROZEN_LAYOUT.version.at, FROZEN_LAYOUT.version.width);
  const txid = paddedText(bytes, FROZEN_LAYOUT.manifestTxid.at, FROZEN_LAYOUT.manifestTxid.width);
  if (version === undefined || txid === undefined) {
    return {
      kind: 'undecodable',
      reason: 'the version or the manifest TXID is not zero-padded UTF-8 (02 §12)',
      rawHex: raw,
    };
  }
  // **Both** halves, and not either: a version with no TXID cannot be fetched, and a TXID with
  // no version cannot be checked against what is running. Naming one without the other would
  // put half a remedy on screen, which reads as a whole one.
  if (version.length === 0 || txid.length === 0) {
    return {
      kind: 'unnamed',
      reason:
        'the release-channel record names no canonical release yet — its version and Arweave ' +
        'TXID fields are empty',
    };
  }
  return {
    kind: 'named',
    version: derive(read, () => version),
    manifestTxid: derive(read, () => txid),
    updatedAt: derive(read, () => u32LittleEndian(bytes, FROZEN_LAYOUT.updatedAt.at)),
  };
}

/**
 * What this read needs from a reader: one finalized storage read, and nothing else.
 *
 * Narrower than `ShellStateReader`, and it does not name `at`. The pointer describes the channel
 * rather than the block, and every field it renders descends from the read through `derive`, so
 * the pin rides on the value and this module never has to be trusted to stamp one. Declaring the
 * port here also keeps `release-channel.ts` off `chain-reads.ts`, which `shell.tsx` already
 * depends on in the other direction — a cycle `no-circular` correctly refuses.
 *
 * Structural rather than the `FinalizedReader` class, for the reason `ShellStateReader` gives:
 * the class is nominal because of its `#private` fields, so a suite could only reach this code
 * through the transport, the codecs and a recorded transcript.
 */
export interface ReleaseChannelReader {
  storage(
    key: string,
    type?: 'value' | 'descendantsValues',
  ): Promise<Finalized<readonly StorageItem[]>>;
}

/**
 * Read the pointer at the reader's pinned block.
 *
 * A rejected read becomes the `unread` arm rather than an exception. This is the read a client
 * makes precisely when everything else has failed, so a throw here would replace the one screen
 * that explains the situation with a boot failure — and 10 §3.1 makes `ReadOnlyIncompatible` a
 * *renderable* state, not a terminal one.
 */
export async function readReleaseChannel(
  reader: ReleaseChannelReader,
): Promise<ReleaseChannelPointer> {
  let read: Finalized<readonly StorageItem[]>;
  try {
    read = await reader.storage(releaseChannelKey());
  } catch (error) {
    return {
      kind: 'unread',
      reason: `the release-channel read did not land (${String(error)})`,
    };
  }
  return decodeReleaseChannel(derive(read, firstValue));
}
