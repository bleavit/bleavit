/**
 * Signers — 11 §11.3; INV-FE-5, INV-FE-12, INV-FE-14.
 *
 * The safety property this package exists for is not "sign correctly"; it is **a signer
 * cannot be reached without a gate that passed**. 11 §11.4 rule 1 asks for that
 * structurally, and the structure is here: `SigningRequest` requires a `GatePassed`, which
 * `@bleavit/transaction-builder` alone can mint and only from a refresh it owns in which every
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

declare const CAPABILITY_ESTABLISHED: unique symbol;

/**
 * A capability that was **established**, not asserted — INV-FE-12.
 *
 * The defect this replaces: `capabilities` was a `Set` literal on the descriptor, and
 * `requireCapability` trusted whatever was in it. Any adapter could name
 * `decoded-payload`, `hashed-payload` or `metadata-hash` and be believed, so a transport
 * that merely renders full hex on a screen could advertise itself as decode-capable and
 * hash-capable while doing neither. INV-FE-12 says an unproven capability is *absent*; a
 * self-declared set makes "proven" and "claimed" the same word.
 *
 * A grant is mintable only by the function below that requires the thing which does the
 * work. The two capabilities that carry the anti-substitution guarantee —
 * `decoded-payload` and `hashed-payload` — cannot be granted without passing the function
 * that performs the decode or the hash, so the claim and the machinery are the same object.
 */
export interface CapabilityGrant {
  readonly capability: SignerCapability;
  /** What established it, for the confirm surface and for a receipt. */
  readonly basis: string;
  readonly [CAPABILITY_ESTABLISHED]: true;
}

const grant = (capability: SignerCapability, basis: string): CapabilityGrant =>
  ({ capability, basis }) as CapabilityGrant;

/** PAPI's `PolkadotSigner['signTx']` — the wallet-side decode channel (11 §11.3). */
export type SignTxFn = (
  callData: Uint8Array,
  signedExtensions: Record<string, { identifier: string; value: Uint8Array; additionalSigned: Uint8Array }>,
  metadata: Uint8Array,
  atBlockNumber: number,
) => Promise<Uint8Array>;

/**
 * How a decode capability was established.
 *
 * The `sign-tx` evidence is not decorative. PAPI draws the line exactly here: `signTx`
 * takes call data, signed extensions and **the metadata**, so the wallet decodes and
 * renders the call on its own screen — which is what 11 §11.3 means by an independent
 * second channel. `signBytes`, by contrast, is documented as signing *"an arbitrary
 * payload"* and as possibly refusing bytes that constitute a valid extrinsic. An adapter
 * built on `signBytes` shows the wallet nothing it can interpret, so it cannot hold this
 * capability however it describes itself.
 *
 * Two kinds, kept **distinguishable on purpose**. `sign-tx` is machine-checked: the
 * function that performs the decode is the argument, so the claim and the machinery are
 * the same object. `attested-flow` is not checkable from here — whether a hardware wallet
 * renders a Bleavit call on its own screen is a fact about that device — and it is
 * therefore recorded as an attestation, with its basis carried into the grant.
 *
 * Collapsing the two would be the defect one level up: a surface that cannot tell a proof
 * from a promise reports both as "proven", which is what a bare `Set` did.
 */
export type DecodeEvidence =
  | { readonly kind: 'sign-tx'; readonly signTx: SignTxFn }
  | { readonly kind: 'attested-flow'; readonly basis: string };

export function grantsDecodedPayload(evidence: DecodeEvidence): CapabilityGrant {
  if (evidence.kind === 'sign-tx') {
    if (typeof evidence.signTx !== 'function') {
      throw new TypeError(
        'decoded-payload requires the signTx function that performs the wallet-side decode; ' +
          'it cannot be declared without one (INV-FE-12)',
      );
    }
    return grant('decoded-payload', 'proven: the signer exposes signTx, so the wallet decodes the call');
  }
  if (typeof evidence.basis !== 'string' || evidence.basis.length < 20) {
    throw new TypeError('an attested decode channel needs a stated basis, not a bare assertion');
  }
  return grant('decoded-payload', `attested: ${evidence.basis}`);
}

/** `hashed-payload`, established by the hasher that produces the digest, or attested. */
export function grantsHashedPayload(
  evidence: { readonly kind: 'hasher'; readonly hasher: (bytes: Uint8Array) => Uint8Array } | { readonly kind: 'attested-flow'; readonly basis: string },
): CapabilityGrant {
  if (evidence.kind === 'hasher') {
    if (typeof evidence.hasher !== 'function') {
      throw new TypeError('hashed-payload requires the hash function that produces the digest');
    }
    return grant('hashed-payload', 'proven: the adapter hashes the payload with a supplied digest');
  }
  if (typeof evidence.basis !== 'string' || evidence.basis.length < 20) {
    throw new TypeError('an attested hashed-payload flow needs a stated basis');
  }
  return grant('hashed-payload', `attested: ${evidence.basis}`);
}

/**
 * `external-key-custody` — architectural, and labelled as such.
 *
 * Nothing at runtime can prove a key never entered this process; what establishes it is
 * that the adapter has no path to receive one. Stating the basis in words is the honest
 * encoding: it is checked by review, and this function exists so the *claim* still travels
 * with a reason rather than appearing in a set beside two claims that are machine-checked.
 */
export function grantsExternalKeyCustody(basis: string): CapabilityGrant {
  if (typeof basis !== 'string' || basis.length < 20) {
    throw new TypeError('external-key-custody needs a stated basis, not a bare assertion');
  }
  return grant('external-key-custody', basis);
}

export interface SignerDescriptor {
  readonly id: string;
  /** Shown to the user; never a bare id. */
  readonly label: string;
  /** Derived from `grants` — never written directly. */
  readonly capabilities: ReadonlySet<SignerCapability>;
  /** Why each capability is held, in the order granted. */
  readonly grants: readonly CapabilityGrant[];
  /** True only for adapters that must never appear in a release chunk (INV-FE-5). */
  readonly testOnly: boolean;
}

/**
 * Build a descriptor. The only way to obtain one whose capabilities are populated.
 *
 * `capabilities` is computed here from the grants rather than accepted from the caller, so
 * the set cannot contain anything nobody established. There is deliberately no
 * `metadata-hash` grant function at all: whether a wallet honours `CheckMetadataHash` for a
 * custom chain is FE-P6's remaining device/display question, so the capability is currently
 * *unreachable* rather than merely undeclared. B21 proves the chain accepts mode 1; only a
 * future wallet probe can prove the independent display channel and mint this grant.
 */
export function describeSigner(input: {
  readonly id: string;
  readonly label: string;
  readonly grants: readonly CapabilityGrant[];
  readonly testOnly: boolean;
}): SignerDescriptor {
  const seen = new Set<SignerCapability>();
  for (const g of input.grants) {
    if (seen.has(g.capability)) {
      throw new Error(`${input.id} grants ${g.capability} twice; a duplicate hides which basis applies`);
    }
    seen.add(g.capability);
  }
  return {
    id: input.id,
    label: input.label,
    capabilities: seen,
    grants: [...input.grants],
    testOnly: input.testOnly,
  };
}

/**
 * A request to sign.
 *
 * Carrying the `GatePassed` rather than a boolean is the point: a boolean can be written
 * by anyone, and this cannot. The window is also the sole source of signing bytes and account,
 * so an authentic proof cannot be paired with a different request. It carries *which block*
 * the gate ran at, so the confirm surface can tell the user what the signature is against.
 */
export interface SigningRequest {
  readonly window: GatePassed;
  /** Independent overrides are forbidden: the gate proof is the sole authority. */
  readonly prep?: never;
  readonly account?: never;
}

export class SigningBindingError extends Error {
  constructor(message: string) {
    super(`the signing request does not match its gate proof: ${message}`);
    this.name = 'SigningBindingError';
  }
}

/**
 * Resolve the only bytes/account a signer may consume.
 *
 * The request has no independent values to pair with a valid window. The runtime checks keep
 * the same rule fail-closed for untyped JavaScript callers and detect mutation of the named
 * preparation after the gate captured its immutable authorization snapshot.
 */
export function signingTarget(request: SigningRequest): Readonly<{
  readonly prep: TxPreparation;
  readonly scaleHex: HexString;
  readonly account: string;
}> {
  if ('prep' in request || 'account' in request) {
    throw new SigningBindingError(
      'bytes and account must come from window.authorization; independent overrides are refused',
    );
  }
  const { prep, authorization } = request.window;
  if (
    prep.scaleHex !== authorization.scaleHex ||
    prep.signingAccount !== authorization.account
  ) {
    throw new SigningBindingError(
      'the preparation changed after the gate passed; refresh and gate the exact bytes/account again',
    );
  }
  return Object.freeze({
    prep,
    scaleHex: authorization.scaleHex,
    account: authorization.account,
  });
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
export const RAW_PAYLOAD_DESCRIPTOR: SignerDescriptor = describeSigner({
  id: 'raw-payload',
  label: 'Air-gapped / hardware (QR or hex)',
  grants: [
    // Attested, not proven, and the grant says so. Whether a given device renders a
    // Bleavit call on its own screen is a fact about that device, and 11 §11.3's
    // raw-external flow is premised on it. What this side can guarantee is that the
    // **complete** payload is handed over — never a truncation and never a digest the
    // device did not compute — which is the half that makes the device's decode possible.
    grantsDecodedPayload({
      kind: 'attested-flow',
      basis:
        'the raw-external flow transmits the complete payload to a device that renders the ' +
        'call itself; nothing here truncates or pre-digests it (11 §11.3)',
    }),
    grantsHashedPayload({
      kind: 'attested-flow',
      basis:
        'an oversized payload is presented as a digest the device recomputes from the bytes ' +
        'it was shown, never one supplied by this app',
    }),
    grantsExternalKeyCustody(
      'the payload leaves as bytes and a signature returns; this adapter has no path that ' +
        'accepts key material at any point',
    ),
  ],
  testOnly: false,
});

// The injected browser-extension descriptor moved to `injected.ts` when the adapter
// landed: it is a **function of the extension name**, not a constant. A single `injected`
// id cannot distinguish two installed extensions, and a generic "Browser extension" label
// asks the user to confirm a signature without saying which wallet will be asked.
// The capability surface is unchanged, and still decided here rather than inferred from
// whatever an extension happens to expose at runtime.
