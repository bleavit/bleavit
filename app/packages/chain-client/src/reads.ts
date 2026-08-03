/**
 * Finalized-only reads over chainHead — 10 §2.2, §4.1, §4.2, §11.
 *
 * Every read here is pinned to a **finalized** block and yields `Finalized<T>`; there is
 * no code path that produces one from anything else. The transport is injected rather
 * than constructed, for a reason that is not merely testability: the smoldot connection
 * and the *rule that reads are finalized-only* are separate concerns, and folding them
 * together is how a fallback path acquires the ability to mint verified values. With the
 * transport as a parameter, swapping in an RPC provider changes nothing about what this
 * module will hand back — it still refuses to finalize anything it did not read at a
 * pinned finalized block, which is 10 §2.2's never-promote rule expressed as a type.
 *
 * **smoldot exposes the `chainHead` group only — there are no `archive_*` methods**
 * (10 §4.2). Historical reads at arbitrary depth do not exist through the light client,
 * so this module offers none; depth is the three-layer model's problem (§6), not a read
 * option that quietly falls back to a provider.
 */

import { finalize, type Finalized, type FinalizedBlockRef } from './provenance.js';
import { domainOf, type DomainBoundary, type Domained, type LedgerDomain } from './domain.js';

/** A storage item as chainHead returns it. */
export interface StorageItem {
  readonly key: string;
  readonly value?: string;
}

/**
 * The minimum a transport must do. Deliberately narrow: exactly the two chainHead
 * operations 02 §11's fixtures record, so the mock-runtime test double and a real
 * smoldot connection satisfy the same interface with nothing to diverge on.
 */
export interface ChainHeadTransport {
  /** The finalized block every read in a batch is pinned to. */
  pinnedBlock(): FinalizedBlockRef;
  storage(key: string, type: 'value' | 'descendantsValues'): readonly StorageItem[];
  call(api: string, argsHex?: string): string;
}

export class UnverifiedReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnverifiedReadError';
  }
}

/**
 * A reader bound to one finalized block.
 *
 * Bound to *one* block, not "the latest": INV-FE-2 requires every precondition to be
 * evaluated at a single finalized block, and a reader that re-pinned per call would
 * produce a set of values no block ever held simultaneously — each individually
 * verified, the combination fictional.
 */
export class FinalizedReader {
  readonly #transport: ChainHeadTransport;
  readonly #pin: FinalizedBlockRef;

  constructor(transport: ChainHeadTransport) {
    this.#transport = transport;
    this.#pin = transport.pinnedBlock();
    if (!/^0x[0-9a-f]{64}$/i.test(this.#pin.blockHash)) {
      throw new UnverifiedReadError(`transport pinned a malformed block hash: ${this.#pin.blockHash}`);
    }
  }

  /** The block every value from this reader is true at. */
  get at(): FinalizedBlockRef {
    return this.#pin;
  }

  /** A raw storage read, finalized at this reader's pinned block. */
  storage(key: string, type: 'value' | 'descendantsValues' = 'value'): Finalized<readonly StorageItem[]> {
    this.#assertStillPinned();
    return finalize(this.#transport.storage(key, type), this.#pin);
  }

  /**
   * A runtime-API result.
   *
   * 10 §4.2 flags **FE-P2** as pivotal and unresolved: whether PAPI routes typed runtime
   * calls through `chainHead_call` pinned to a finalized hash. Until it resolves, "every
   * `FutarchyApi` result used on the tx path is cross-checked against direct storage
   * reads (the conservative mode is the **default**, not the fallback)". So this method
   * is deliberately not the transaction path's entry point — `crossCheckedCall` is.
   */
  call(api: string, argsHex = '0x'): Finalized<string> {
    this.#assertStillPinned();
    return finalize(this.#transport.call(api, argsHex), this.#pin);
  }

  /**
   * The FE-P2 conservative read: an API result admitted only alongside the storage
   * prefix it must agree with, **in the same domain**.
   *
   * 10 §11's final bullet is the sharp edge here: satisfying one domain's view with the
   * other's keys would make the check vacuous in exactly the case it exists for. The
   * prefix is therefore not a caller-supplied argument — it is derived from the domain
   * along with the API name, so the pairing cannot be got wrong at a call site.
   */
  crossCheckedCall(
    source: { readonly api: string; readonly storagePrefix: string; readonly argsHex?: string },
  ): Finalized<{ readonly result: string; readonly witness: readonly StorageItem[] }> {
    this.#assertStillPinned();
    const result = this.#transport.call(`FutarchyApi_${source.api}`, source.argsHex ?? '0x');
    const witness = this.#transport.storage(source.storagePrefix, 'descendantsValues');
    return finalize({ result, witness }, this.#pin);
  }

  /** Attach the ledger domain to a read, deriving it from the id (10 §11 rule 1). */
  domained<T>(id: bigint, value: Finalized<T>, boundary: DomainBoundary): Finalized<Domained<T>> {
    if (value.status.blockHash !== this.#pin.blockHash) {
      throw new UnverifiedReadError(
        'refusing to attach a domain to a value read at a different block; the result ' +
          'would not be a consistent view (INV-FE-2)',
      );
    }
    return finalize({ domain: domainOf(id, boundary), value: value.value }, this.#pin);
  }

  #assertStillPinned(): void {
    const now = this.#transport.pinnedBlock();
    if (now.blockHash !== this.#pin.blockHash) {
      // The pin moved under us. Returning a value read at a different block than this
      // reader claims would produce a `Finalized<T>` whose status is a lie — the one
      // outcome the brand exists to make impossible.
      throw new UnverifiedReadError(
        `the transport re-pinned from ${this.#pin.blockHash} to ${now.blockHash}; ` +
          'open a new reader rather than mixing blocks (INV-FE-2)',
      );
    }
  }
}

/**
 * A `provider`-status read, for completeness of the never-promote rule (10 §2.2).
 *
 * There is no function here that turns one of these into a `Finalized<T>`, and that
 * absence is the point: 10 §2.2 deleted the promotion rule outright, because hash
 * equality authenticates the *header*, not the storage values under it — a hostile
 * endpoint returns the genuine public finalized hash and lies about every value. If a
 * provider-served value must become verified, the key is **re-read** through the light
 * client, in which case the provider contributed nothing and drops out of the chain.
 */
export interface ProviderRead<T> {
  readonly value: T;
  readonly status: { readonly kind: 'provider'; readonly providerId: string; readonly sampled: boolean };
}

export function providerRead<T>(value: T, providerId: string, sampled = false): ProviderRead<T> {
  return { value, status: { kind: 'provider', providerId, sampled } };
}

/** The per-domain position source, paired so the FE-P2 check cannot be crossed. */
export function positionReadFor(domain: LedgerDomain, storagePrefix: string): {
  readonly api: string;
  readonly storagePrefix: string;
} {
  return {
    api: domain === 'service' ? 'service_positions' : 'account_positions',
    storagePrefix,
  };
}
