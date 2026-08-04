/**
 * The injected (PJS-compatible extension) signer — 11 §11.3.
 *
 * Written against a **structural** view of `polkadot-api/pjs-signer`, with the real
 * binding in `pjs-binding.ts`. That is the `light-client.ts` pattern rather than a
 * testability flourish: an extension only exists inside a browser with something
 * installed, so a module that imported the real one would drag every test of this logic
 * behind a manual step, and the logic here is where the safety properties live.
 *
 * **What this adapter declares, and what it refuses to.** An injected extension proves
 * `external-key-custody` — the key never enters this app. `decoded-payload` is granted
 * **only when the connected extension exposes `signTx`**, and that condition was added by
 * an adversarial review: the capability used to be declared unconditionally while this
 * adapter signed through `signBytes`. The two are different channels. PAPI's `signTx`
 * takes the call data, the signed extensions and the **metadata**, so the extension decodes
 * and renders the call on its own screen, which is the independent second channel 11 §11.3
 * requires against substitution; `signBytes` is documented as signing *"an arbitrary
 * payload"* and as possibly *refusing* bytes that constitute a valid extrinsic. An
 * extension asked that way shows the user an opaque blob, so declaring the capability told
 * them their wallet had verified a call it had never seen.
 *
 * It does **not** declare `metadata-hash`, which is now unreachable rather than merely
 * undeclared — there is no grant function for it anywhere while FE-P6 is unresolved. It
 * does not declare `hashed-payload` either: an extension that falls back to signing a hash
 * of an oversized payload is signing something it did not show anyone, which is the
 * substitution this whole surface exists to prevent.
 *
 * **Account selection is not a capability question.** An extension can be connected and
 * still not hold the account the payload was built for, and signing with a different
 * account produces a valid signature for a transaction the chain will reject on nonce or
 * origin. So the account is checked against the connected set before the request goes out,
 * and the mismatch is named rather than surfaced as a wallet error.
 */

import {
  describeSigner,
  grantsDecodedPayload,
  grantsExternalKeyCustody,
  type SignTxFn,
  type SignedPayload,
  type SignerAdapter,
  type SignerDescriptor,
  type SigningRequest,
} from './adapters.js';
import type { HexString } from '@bleavit/shared-types';

/* --------------------------------------------------- the structural pjs-signer surface */

/** Structurally `@polkadot-api/pjs-signer`'s `InjectedPolkadotAccount`. */
export interface InjectedAccountLike {
  readonly address: string;
  readonly name?: string | undefined;
  readonly polkadotSigner: PolkadotSignerLike;
}

/** Structurally PAPI's `PolkadotSigner`, narrowed to what a signature needs. */
export interface PolkadotSignerLike {
  readonly publicKey: Uint8Array;
  signBytes: (data: Uint8Array) => Promise<Uint8Array>;
  /**
   * PAPI's transaction-signing entry point — the wallet-side decode channel.
   *
   * Optional in this structural view because an extension may not expose it, and INV-FE-12
   * makes that absence a *capability* question rather than an error: the adapter still
   * works, it simply does not hold `decoded-payload`.
   */
  signTx?: SignTxFn;
}

/** Structurally `InjectedExtension`. */
export interface InjectedExtensionLike {
  getAccounts: () => readonly InjectedAccountLike[];
  readonly name?: string;
}

/** The two entry points 11 §11.3 names, as this module needs them (V-96). */
export interface PjsSignerApi {
  getInjectedExtensions: () => readonly string[];
  connectInjectedExtension: (name: string, dappName?: string) => Promise<InjectedExtensionLike>;
}

export class NoExtensionError extends Error {
  readonly code = 'FE-SIGN-001';
  constructor(message: string) {
    super(message);
    this.name = 'NoExtensionError';
  }
}

export class AccountNotHeldError extends Error {
  readonly code = 'FE-SIGN-002';
  constructor(account: string, available: readonly string[], extension: string) {
    super(
      `${extension} does not hold ${account}. It offers ${available.length} account(s): ` +
        `${available.join(', ') || 'none'}. Signing with a different account produces a valid ` +
        'signature for a transaction the chain will reject, so this is refused here rather ' +
        'than surfaced later as a wallet error.',
    );
    this.name = 'AccountNotHeldError';
  }
}

const toHex = (bytes: Uint8Array): HexString =>
  `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}` as HexString;

/**
 * Decode payload hex, refusing anything that is not hex — INV-FE-14.
 *
 * The odd-length check alone is not enough, and the gap is silent. `Number.parseInt('zz',
 * 16)` is `NaN`, and `Uint8Array` coerces `NaN` to **zero** — so `'0xzz'` has even length,
 * parses without error, and yields `0x00`. The adapter then asks the wallet to sign a byte
 * the payload never contained, and every layer downstream sees a well-formed signature over
 * well-formed bytes. INV-FE-14 requires the *exact* raw SCALE bytes to reach the signer;
 * a zero-filled stand-in is the one substitution nothing else in this path can detect.
 *
 * An empty payload is refused for the same reason: it is a caller defect that presents as a
 * successful signature over nothing.
 */
const hexToBytes = (hex: string): Uint8Array => {
  if (typeof hex !== 'string' || !/^0x[0-9a-fA-F]*$/.test(hex)) {
    throw new Error(
      `payload is not 0x-prefixed hex: ${String(hex).slice(0, 20)}… — refusing to sign, because ` +
        'a non-hex digit parses to NaN and coerces to a zero byte rather than failing',
    );
  }
  const body = hex.slice(2);
  if (body.length === 0) throw new Error('refusing to sign an empty payload');
  if (body.length % 2 !== 0) throw new Error(`odd-length payload hex: ${hex.slice(0, 20)}…`);
  const out = new Uint8Array(body.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(body.slice(i * 2, i * 2 + 2), 16);
  return out;
};

/** List the extensions the page can see. Empty is a normal state, not an error. */
export function availableExtensions(api: PjsSignerApi): readonly string[] {
  return api.getInjectedExtensions();
}

/**
 * The injected descriptor — a function of the extension name, and of what it exposes.
 *
 * **`decoded-payload` is granted only when the extension provides `signTx`.** It was
 * declared unconditionally while this adapter signed through `signBytes`, and the two are
 * different channels: PAPI's `signTx` takes the call data, the signed extensions and the
 * **metadata**, so the extension decodes and renders the call itself — the independent
 * second channel 11 §11.3 requires against substitution. `signBytes` signs *"an arbitrary
 * payload"* and is documented as possibly *refusing* bytes that look like a valid
 * extrinsic; an extension asked that way shows the user an opaque blob. Declaring the
 * capability anyway told the user their wallet had verified the call when nothing had.
 *
 * So the grant is derived from the connected object rather than asserted about it, and an
 * extension exposing only `signBytes` yields an adapter whose `decoded-payload` is
 * **absent** — which INV-FE-12 then turns into a named refusal at the dependent surface
 * instead of a silent downgrade.
 */
export const INJECTED_DESCRIPTOR = (
  extensionName: string,
  decodeChannel?: SignTxFn,
): SignerDescriptor =>
  describeSigner({
    id: `injected:${extensionName}`,
    label: `${extensionName} (browser extension)`,
    // `metadata-hash` is unreachable by construction — there is no grant function for it
    // while FE-P6 is unresolved. `hashed-payload` is deliberately absent: an extension that
    // falls back to signing a hash of an oversized payload is signing something it did not
    // show anyone, which is the substitution this surface exists to prevent.
    grants: [
      ...(decodeChannel === undefined ? [] : [grantsDecodedPayload({ kind: 'sign-tx', signTx: decodeChannel })]),
      grantsExternalKeyCustody(
        'the extension holds the key and returns only a signature; this adapter has no path ' +
          'that accepts key material',
      ),
    ],
    testOnly: false,
  });

/**
 * Connect one extension and adapt it.
 *
 * The connection happens once, here, rather than per signature: `connectInjectedExtension`
 * is what triggers the extension's authorization prompt, and doing it inside `sign()`
 * would put a permission dialog between the user pressing confirm and the signature
 * request, where it reads as the signature prompt itself.
 */
export async function connectInjected(
  api: PjsSignerApi,
  extensionName: string,
  dappName: string,
): Promise<SignerAdapter> {
  const available = api.getInjectedExtensions();
  if (!available.includes(extensionName)) {
    throw new NoExtensionError(
      `no injected extension named ${extensionName} is available` +
        (available.length > 0 ? `; found ${available.join(', ')}` : ' (none are installed or enabled)'),
    );
  }
  const extension = await api.connectInjectedExtension(extensionName, dappName);
  // Derive the capability from what the connected extension actually exposes. Probed on
  // the accounts it offers rather than assumed: an extension that exposes `signTx` on some
  // accounts and not others cannot be described by one claim, so the capability is granted
  // only when **every** account can serve it.
  const connectedAccounts = extension.getAccounts();
  const decodeChannel =
    connectedAccounts.length > 0 &&
    connectedAccounts.every((account) => typeof account.polkadotSigner.signTx === 'function')
      ? connectedAccounts[0]!.polkadotSigner.signTx
      : undefined;
  const descriptor = INJECTED_DESCRIPTOR(extensionName, decodeChannel);

  return {
    descriptor,
    async sign(request: SigningRequest): Promise<SignedPayload> {
      // Re-read the accounts per signature. An extension's account set changes while the
      // page is open — the user switches, locks, or revokes — and a set captured at
      // connect time would let a revoked account look signable right up to the prompt.
      const accounts = extension.getAccounts();
      const match = accounts.find((account) => account.address === request.account);
      if (match === undefined) {
        throw new AccountNotHeldError(
          request.account,
          accounts.map((account) => account.address),
          descriptor.label,
        );
      }
      const signature = await match.polkadotSigner.signBytes(hexToBytes(request.prep.scaleHex));
      return {
        signatureHex: toHex(signature),
        signedBy: request.account,
        signerId: descriptor.id,
      };
    },
  };
}
