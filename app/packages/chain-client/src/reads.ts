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
 * **This module offers no read at depth, and 10 §4.2's stated reason changed under it
 * (FE-P5, V-303).** The comment here used to say *"smoldot exposes the `chainHead` group
 * only — there are no `archive_*` methods"*, quoting the specification. Half of that is
 * right: `smoldot@3.3.2` implements no `archive_*` method. The other half is wrong, and
 * §4.2 has been corrected — the legacy group is present, and `state_getMetadata` /
 * `state_call` accept **any** block hash at unbounded depth, proof-verified against that
 * block's own header. What is actually missing is the step before: `chain_getBlockHash`
 * refuses every height but genesis and best, because a light client cannot verify a full
 * node's answer to "which block was at height N". Depth is reachable only by walking
 * `parentHash` from a hash already trusted, at one round trip per block.
 *
 * The conclusion is unchanged and the module still offers no such read. Recording the
 * right reason matters because the wrong one is *self-enforcing* — "the method does not
 * exist" needs no discipline, while "the method exists and must not be used for this"
 * does. Depth is the three-layer model's problem (§6), not a read option that quietly
 * falls back to a provider.
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
 *
 * Two properties of this interface were wrong when it first shipped, and both were found
 * by writing the smoldot transport against it rather than by reasoning about it:
 *
 * - **It is asynchronous, necessarily** (V-83). smoldot runs in a Web Worker (§4.1) and
 *   every answer arrives by `postMessage`, so a synchronous read could only be served by
 *   blocking the main thread on `Atomics.wait` — which needs cross-origin isolation the
 *   Arweave distribution does not control, and which freezes the UI for the duration of a
 *   proof-backed read. The synchronous shape was satisfiable by a test double and by
 *   nothing else, which is the precise shape of a mock that agrees with an interface no
 *   real implementation can meet.
 * - **Reads take the block explicitly** (V-84). When the transport chose the block, a
 *   reader pinned at N could be handed a value read at N+1 and would label it N — each
 *   read individually verified, the label a lie. A guard that re-checked the head
 *   *before* issuing the read did not prevent it, because the read happened after the
 *   check. Passing `at` makes "read at the block I pinned" unbypassable rather than
 *   merely checked around: the transport reads that block or fails.
 */
export interface ChainHeadTransport {
  /** The current finalized head. */
  pinnedBlock(): Promise<FinalizedBlockRef>;
  /** Read at `at`. MUST throw rather than substitute another block if `at` is gone. */
  storage(
    at: FinalizedBlockRef,
    key: string,
    type: 'value' | 'descendantsValues',
  ): Promise<readonly StorageItem[]>;
  call(at: FinalizedBlockRef, api: string, argsHex?: string): Promise<string>;
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
 *
 * The finalized head advancing is **not** an error and does not invalidate a reader —
 * that is what pinning is for, and a reader that died every time the chain moved would
 * have a useful life of one block time. What ends a reader is its block ceasing to be
 * readable, which the transport reports by failing the read.
 */
export class FinalizedReader {
  readonly #transport: ChainHeadTransport;
  readonly #pin: FinalizedBlockRef;

  private constructor(transport: ChainHeadTransport, pin: FinalizedBlockRef) {
    this.#transport = transport;
    this.#pin = pin;
  }

  /**
   * Open a reader at the transport's current finalized block.
   *
   * A factory rather than a constructor because the pin is fetched across the worker
   * boundary. Taking it *once*, here, is what makes every read this reader ever serves
   * belong to the same block.
   */
  static async open(transport: ChainHeadTransport): Promise<FinalizedReader> {
    const pin = await transport.pinnedBlock();
    if (!/^0x[0-9a-f]{64}$/i.test(pin.blockHash)) {
      throw new UnverifiedReadError(`transport pinned a malformed block hash: ${pin.blockHash}`);
    }
    return new FinalizedReader(transport, pin);
  }

  /** The block every value from this reader is true at. */
  get at(): FinalizedBlockRef {
    return this.#pin;
  }

  /** A raw storage read, finalized at this reader's pinned block. */
  async storage(
    key: string,
    type: 'value' | 'descendantsValues' = 'value',
  ): Promise<Finalized<readonly StorageItem[]>> {
    return finalize(await this.#transport.storage(this.#pin, key, type), this.#pin);
  }

  /**
   * A runtime-API result.
   *
   * 10 §4.2 flags **FE-P2** as pivotal: whether PAPI routes typed runtime calls through
   * `chainHead_call` pinned to a finalized hash. Its routing half is answered (V-82) but
   * its execution half rides the B7 drills, so "every `FutarchyApi` result used on the tx
   * path is cross-checked against direct storage reads (the conservative mode is the
   * **default**, not the fallback)" still stands. This method is therefore deliberately
   * not the transaction path's entry point — `crossCheckedCall` is.
   */
  async call(api: string, argsHex = '0x'): Promise<Finalized<string>> {
    return finalize(await this.#transport.call(this.#pin, api, argsHex), this.#pin);
  }

  /**
   * The FE-P2 conservative read: an API result admitted only alongside the storage
   * prefix it must agree with, **in the same domain**.
   *
   * 10 §11's final bullet is the sharp edge here: satisfying one domain's view with the
   * other's keys would make the check vacuous in exactly the case it exists for. The
   * prefix is therefore not a caller-supplied argument — it is derived from the domain
   * along with the API name, so the pairing cannot be got wrong at a call site.
   *
   * Both legs are read at `this.#pin`, so the comparison is between two views of one
   * state. A cross-check whose halves came from different blocks would be worse than no
   * check at all: disagreement would be expected, so agreement would prove nothing.
   */
  async crossCheckedCall(
    source: { readonly api: string; readonly storagePrefix: string; readonly argsHex?: string },
  ): Promise<Finalized<{ readonly result: string; readonly witness: readonly StorageItem[] }>> {
    const result = await this.#transport.call(
      this.#pin,
      `FutarchyApi_${source.api}`,
      source.argsHex ?? '0x',
    );
    const witness = await this.#transport.storage(this.#pin, source.storagePrefix, 'descendantsValues');
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
