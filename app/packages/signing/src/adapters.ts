/**
 * Signers — 11 §11.3; INV-FE-5, INV-FE-12, INV-FE-14.
 *
 * The safety property this package exists for is not "sign correctly"; it is **a signer
 * cannot be reached without a gate that passed**. 11 §11.4 rule 1 asks for that
 * structurally, and the structure is here: `SigningRequest` requires a `GatePassed`, which
 * `@bleavit/transaction-builder` alone can mint and only from an evaluation in which every
 * precondition held at one finalized block. There is no overload, no options bag and no
 * "advanced" path that takes bytes alone — an unguarded signature is untypeable rather
 * than discouraged.
 *
 * **Capabilities are a fail-closed lattice** (INV-FE-12). An adapter declares what it has
 * *proven*, and anything undeclared is **absent** — absence disables the dependent surface
 * with a named reason rather than being tried and failing at the worst moment, which for a
 * hardware wallet is after the user has gone to fetch it.
 *
 * The mock adapter is **not exported from this module**. It lives behind the `./testing`
 * subpath so shipping it takes a deliberate import a release build refuses, per 10 §10.1's
 * "no signer adapter marked test-only may appear in a release chunk".
 */

import type { GatePassed, TxPreparation } from '@bleavit/transaction-builder';
import type { HexString } from '@bleavit/shared-types';

/** What an adapter has *proven* it can do. Anything absent is absent (INV-FE-12). */
export type SignerCapability =
  /** Signs a full SCALE payload it can decode itself — the anti-substitution channel. */
  | 'decoded-payload'
  /** Signs a blake2-256 hash of an oversized payload. */
  | 'hashed-payload'
  /** Honours `CheckMetadataHash`, so the wallet's own decode is a second opinion. */
  | 'metadata-hash'
  /** Produces a signature without the app holding key material at any point. */
  | 'external-key-custody';

export interface SignerDescriptor {
  readonly id: string;
  /** Shown to the user; never a bare id. */
  readonly label: string;
  readonly capabilities: ReadonlySet<SignerCapability>;
  /** True only for adapters that must never appear in a release chunk (INV-FE-5). */
  readonly testOnly: boolean;
}

/**
 * A request to sign.
 *
 * Carrying the `GatePassed` rather than a boolean is the point: a boolean can be written
 * by anyone, and this cannot. It also carries *which block* the gate ran at, so the
 * confirm surface can tell the user what the signature is being taken against.
 */
export interface SigningRequest {
  readonly prep: TxPreparation;
  readonly window: GatePassed;
  /** SS58 address of the account the payload was built for. */
  readonly account: string;
}

export interface SignedPayload {
  readonly signatureHex: HexString;
  readonly signedBy: string;
  /** Which adapter produced it, so a receipt can name it. */
  readonly signerId: string;
}

export class SignerCapabilityError extends Error {
  readonly missing: SignerCapability;
  constructor(descriptor: SignerDescriptor, missing: SignerCapability, why: string) {
    super(
      `${descriptor.label} cannot do this: the ${missing} capability is not proven for it. ${why} ` +
        'An unproven capability is treated as absent (INV-FE-12); it is not attempted and hoped for.',
    );
    this.name = 'SignerCapabilityError';
    this.missing = missing;
  }
}

export interface SignerAdapter {
  readonly descriptor: SignerDescriptor;
  sign(request: SigningRequest): Promise<SignedPayload>;
}

/**
 * Assert a capability before offering a surface that needs it.
 *
 * Named `require...` rather than `can...` deliberately: a boolean helper invites a
 * try-anyway branch, and the whole content of INV-FE-12's lattice is that there is none.
 */
export function requireCapability(
  adapter: SignerAdapter,
  capability: SignerCapability,
  why: string,
): void {
  if (!adapter.descriptor.capabilities.has(capability)) {
    throw new SignerCapabilityError(adapter.descriptor, capability, why);
  }
}

/**
 * The registry a UI picks from.
 *
 * Refuses a `testOnly` adapter outright — belt-and-braces beside the `./testing` subpath
 * and the firewall rule, and the one layer that still works if someone vendors the mock
 * into their own module, which the other two cannot see.
 */
export class SignerRegistry {
  readonly #adapters = new Map<string, SignerAdapter>();

  register(adapter: SignerAdapter): void {
    if (adapter.descriptor.testOnly) {
      throw new Error(
        `refusing to register ${adapter.descriptor.id}: it is marked test-only, and INV-FE-5 ` +
          'makes a test signer structurally impossible to ship rather than merely discouraged.',
      );
    }
    this.#adapters.set(adapter.descriptor.id, adapter);
  }

  get(id: string): SignerAdapter | undefined {
    return this.#adapters.get(id);
  }

  /** Adapters that can serve a given need, so a UI can explain an empty list. */
  supporting(capability: SignerCapability): readonly SignerAdapter[] {
    return [...this.#adapters.values()].filter((a) => a.descriptor.capabilities.has(capability));
  }

  list(): readonly SignerDescriptor[] {
    return [...this.#adapters.values()].map((a) => a.descriptor);
  }
}

/**
 * The raw-payload (QR / air-gapped / hardware) descriptor — 11 §11.3.
 *
 * `metadata-hash` is **not** declared. 11 §11.3 makes the wallet's metadata-hash decode
 * the *independent second channel* against substitution, and whether a given hardware
 * wallet honours `CheckMetadataHash` for a custom chain is FE-P6, unresolved. Declaring it
 * unproven is not pessimism — it is what stops a surface telling the user their device
 * verified the call when nothing here has established that it can.
 */
export const RAW_PAYLOAD_DESCRIPTOR: SignerDescriptor = Object.freeze({
  id: 'raw-payload',
  label: 'Air-gapped / hardware (QR or hex)',
  capabilities: new Set<SignerCapability>(['decoded-payload', 'hashed-payload', 'external-key-custody']),
  testOnly: false,
});

/**
 * The injected browser-extension descriptor — 11 §11.3.
 *
 * Exact export names on `polkadot-api/pjs-signer` are FE-P1's remaining slice; the
 * capability surface is decided here rather than inferred from whatever an extension
 * happens to expose at runtime.
 */
export const INJECTED_DESCRIPTOR: SignerDescriptor = Object.freeze({
  id: 'injected',
  label: 'Browser extension',
  capabilities: new Set<SignerCapability>(['decoded-payload', 'external-key-custody']),
  testOnly: false,
});
