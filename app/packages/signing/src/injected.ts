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
 * `external-key-custody` — the key never enters this app — and `decoded-payload`, because
 * PJS `signPayload` takes a `SignerPayloadJSON` the extension decodes itself. It does
 * **not** declare `metadata-hash`: whether a given extension honours `CheckMetadataHash`
 * for a custom chain is FE-P6, unresolved, and 11 §11.3 makes that decode the independent
 * second channel against substitution. Declaring it would tell the user their wallet
 * verified the call when nothing here has established it can. It does not declare
 * `hashed-payload` either — an extension that falls back to signing a hash of an oversized
 * payload is signing something it did not show anyone, which is the substitution this
 * whole surface exists to prevent.
 *
 * **Account selection is not a capability question.** An extension can be connected and
 * still not hold the account the payload was built for, and signing with a different
 * account produces a valid signature for a transaction the chain will reject on nonce or
 * origin. So the account is checked against the connected set before the request goes out,
 * and the mismatch is named rather than surfaced as a wallet error.
 */

import {
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

const hexToBytes = (hex: string): Uint8Array => {
  const body = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (body.length % 2 !== 0) throw new Error(`odd-length payload hex: ${hex.slice(0, 20)}…`);
  const out = new Uint8Array(body.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(body.slice(i * 2, i * 2 + 2), 16);
  return out;
};

/** List the extensions the page can see. Empty is a normal state, not an error. */
export function availableExtensions(api: PjsSignerApi): readonly string[] {
  return api.getInjectedExtensions();
}

export const INJECTED_DESCRIPTOR = (extensionName: string): SignerDescriptor => ({
  id: `injected:${extensionName}`,
  label: `${extensionName} (browser extension)`,
  // `metadata-hash` and `hashed-payload` are deliberately absent — see the module note.
  capabilities: new Set(['decoded-payload', 'external-key-custody'] as const),
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
  const descriptor = INJECTED_DESCRIPTOR(extensionName);

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
