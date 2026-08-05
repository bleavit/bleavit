/**
 * The raw-payload signer — air-gapped and hardware wallets, 11 §11.3.
 *
 * The app hands out bytes and takes a signature back; no key material passes through it at
 * any point (INV-FE-5). What makes that safe is not the absence of a key, though — it is
 * that **the bytes presented are the bytes signed**, and this module's whole job is to
 * make substituting them between those two moments impossible from here.
 *
 * **The transport is injected and given no room to edit.** `present()` receives the exact
 * payload and returns only a signature; there is no return path by which a QR renderer, a
 * USB bridge or a hex textarea can hand back a *different* payload for the app to accept.
 * A transport that wanted to substitute would have to lie to the user on screen, which is
 * a threat this layer cannot address and the wallet's own decode is supposed to (11 §11.3
 * makes that decode the independent second channel — and see the capability note below).
 *
 * **What is deliberately not here: the QR framing.** 11 §11.3 says "QR/hex" and names no
 * standard, and the real ones (UOS, and RaptorQ fountain-coding for payloads past a
 * single frame) are external formats with their own versioning. Implementing a *plausible*
 * chunking here would be R-2 fabrication — a format that looks right, interoperates with
 * nothing, and fails in front of a user holding an air-gapped device. So framing belongs
 * to the transport, and the standard to verify is raised as SQ-579. The hex path needs no
 * framing and works today.
 *
 * **`metadata-hash` is refused, and the reason is now verified rather than pending.**
 * This started as "FE-P6 is unresolved, so assume nothing". Reading the pinned
 * `frame-metadata-hash-extension` settled the load-bearing half without a device (SQ-594,
 * V-122): the digest comes from a **compile-time** `RUNTIME_METADATA_HASH` env var that
 * `substrate-wasm-builder` sets only when metadata-hash generation is enabled, and the
 * extension returns `Err(UnknownTransaction::CannotLookup)` for mode `Enabled` when it is
 * absent. Bleavit's runtime declares `CheckMetadataHash` in its `TxExtension` stack but is
 * built with `build_using_defaults()` and no `metadata-hash` feature — so **the chain
 * rejects every transaction signed with mode 1**, today.
 *
 * That changes what this refusal means. It is not caution about an unknown device: granting
 * the capability would build transactions this chain is guaranteed to refuse, and the user
 * would meet the failure after signing on a hardware wallet. The runtime fix is milestone
 * B21; until it lands and this comment is re-derived against the rebuilt runtime, the
 * capability stays absent with a named reason (INV-FE-12).
 *
 * The narrower question that still needs hardware is whether a Ledger app falls back to
 * blind signing when a chain offers no digest — which is exactly the outcome the mechanism
 * exists to prevent, and so is not a fallback this client may rely on either way.
 */

import {
  RAW_PAYLOAD_DESCRIPTOR,
  type SignedPayload,
  type SignerAdapter,
  type SigningRequest,
} from './adapters.js';
import type { HexString } from '@bleavit/shared-types';

/**
 * How a payload reaches the signing device and a signature comes back.
 *
 * Deliberately one method with one argument and one return. Anything richer — a session
 * object, a mutable context, a payload the transport may rewrite — would be a channel for
 * the substitution this adapter exists to close off.
 */
export interface RawPayloadTransport {
  readonly id: string;
  readonly label: string;
  present: (payload: RawPayloadPresentation) => Promise<string>;
}

export interface RawPayloadPresentation {
  /** Exactly `prep.scaleHex`. */
  readonly payloadHex: HexString;
  /** The account the payload was built for, so the device screen can be compared to it. */
  readonly account: string;
  /** The block the gate ran at — what the user is being asked to sign *against*. */
  readonly atBlock: number;
  /**
   * The 256-block era (11 §11.3), stated so a transport can show how long this stays
   * signable. It is a longer replay window than the in-app 64, which is why it is worth
   * putting in front of someone rather than leaving implicit.
   */
  readonly mortalityBlocks: number;
}

export class RawSignatureError extends Error {
  readonly code = 'FE-SIGN-003';
  constructor(message: string) {
    super(`the signature returned from the signing device is unusable: ${message}`);
    this.name = 'RawSignatureError';
  }
}

/** 11 §11.3's raw-external era. Re-stated from `transaction-builder` would drift; imported would cycle. */
export const RAW_EXTERNAL_ERA_BLOCKS = 256;

/**
 * sr25519 and ed25519 signatures are 64 bytes; a SCALE `MultiSignature` prefixes one
 * enum byte, and ecdsa is 65 bytes of signature plus that prefix. Accepting any length
 * would let an empty string, a truncated scan or an error message through as a signature —
 * and a malformed signature fails at submission, long after the device is back in a
 * drawer.
 */
const ACCEPTED_SIGNATURE_BYTES = new Set([64, 65, 66]);

function validateSignature(raw: string): HexString {
  const trimmed = raw.trim();
  if (trimmed.length === 0) throw new RawSignatureError('it is empty');
  const hex = trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`;
  if (!/^0x[0-9a-fA-F]+$/.test(hex)) {
    throw new RawSignatureError(
      `it is not hexadecimal (${trimmed.slice(0, 24)}${trimmed.length > 24 ? '…' : ''}). ` +
        'A scanner that returned an error string would otherwise be signed for.',
    );
  }
  const bytes = (hex.length - 2) / 2;
  if ((hex.length - 2) % 2 !== 0 || !ACCEPTED_SIGNATURE_BYTES.has(bytes)) {
    throw new RawSignatureError(
      `it is ${bytes} byte(s); a Substrate signature is 64, or 65–66 with a MultiSignature ` +
        'or ecdsa prefix. A truncated scan is the usual cause.',
    );
  }
  return hex.toLowerCase() as HexString;
}

/**
 * Adapt a transport into a signer.
 *
 * The descriptor is shared with `adapters.ts` rather than rebuilt per transport: the
 * capability set is a property of the *raw-payload flow* — no metadata-hash until FE-P6 —
 * not of whichever QR library or USB bridge is carrying the bytes. A transport that could
 * declare its own capabilities could declare that one.
 */
export function rawPayloadSigner(transport: RawPayloadTransport): SignerAdapter {
  return {
    descriptor: {
      ...RAW_PAYLOAD_DESCRIPTOR,
      id: `${RAW_PAYLOAD_DESCRIPTOR.id}:${transport.id}`,
      label: transport.label,
    },
    async sign(request: SigningRequest): Promise<SignedPayload> {
      const signature = await transport.present({
        payloadHex: request.prep.scaleHex,
        account: request.account,
        atBlock: request.window.at.blockNumber,
        mortalityBlocks: RAW_EXTERNAL_ERA_BLOCKS,
      });
      return {
        signatureHex: validateSignature(signature),
        signedBy: request.account,
        signerId: `${RAW_PAYLOAD_DESCRIPTOR.id}:${transport.id}`,
      };
    },
  };
}
