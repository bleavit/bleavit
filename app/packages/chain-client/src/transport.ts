/**
 * The chainHead-v1 transport — 10 §4.1, §4.2.
 *
 * Speaks the JSON-RPC `chainHead` group directly over a provider connection, rather than
 * going through PAPI's typed client. That is a deliberate choice at this layer, for two
 * reasons that both come from 10 §4.2:
 *
 *  - The pin has to be **ours**. `crossCheckedCall` compares a runtime-API result against
 *    a storage witness, and the comparison only means anything if both were read at the
 *    same block. Issuing both operations against a block hash this module holds is the
 *    difference between a cross-check and two unrelated reads that happen to be near each
 *    other in time.
 *  - There is nothing to decode yet. Descriptors and typed decoding are F4's; this layer
 *    returns hex, and every consumer above it already expects hex. Introducing a typed
 *    client here would put metadata-compatibility failures underneath the read layer,
 *    where 10 §5.2's classifier cannot see them.
 *
 * Written against a **structural** provider type, so the identical code path serves both
 * a real smoldot connection and the F2 recorded transcripts. That is what makes the
 * operation protocol below — started/items/done, waitingForContinue, error, stop —
 * executable per commit with no node and no network, which matters because every branch
 * in it is a failure branch.
 */

import type { HexString } from '@bleavit/shared-types';
import type { FinalizedBlockRef } from './provenance.js';
import type { ChainHeadTransport, StorageItem } from './reads.js';

/* ------------------------------------------------------------------ provider shape */

export type JsonRpcId = string | number | null;

export interface JsonRpcRequestLike {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
  id?: JsonRpcId;
}

export interface JsonRpcMessageLike {
  jsonrpc: '2.0';
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface JsonRpcConnectionLike {
  send: (message: JsonRpcRequestLike) => void;
  disconnect: () => void;
}

/** Structurally PAPI's `JsonRpcProvider`; see `light-client.ts` for the binding. */
export type JsonRpcProviderLike = (
  onMessage: (message: JsonRpcMessageLike) => void,
) => JsonRpcConnectionLike;

/* ------------------------------------------------------------------------- errors */

export class ChainHeadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChainHeadError';
  }
}

/**
 * The follow subscription ended (`stop` event, or the connection dropped).
 *
 * Distinct from a failed read because it means every *pin* is gone, not just one
 * operation: chainHead's guarantees are scoped to a live subscription, so a reader whose
 * subscription stopped is holding a block reference nothing is keeping alive any more.
 */
export class SubscriptionStoppedError extends ChainHeadError {
  constructor(reason: string) {
    super(`the chainHead follow subscription stopped (${reason}); every pinned block is gone`);
    this.name = 'SubscriptionStoppedError';
  }
}

/* ------------------------------------------------------------------ header decoding */

/**
 * Decode a SCALE compact-encoded integer at `offset`, returning the value and its width.
 *
 * Needed because chainHead reports finalized blocks by **hash only** and `Finalized<T>`
 * carries a block number: the number lives in the header, after the 32-byte parent hash,
 * as a compact. Four-mode compact decoding is small enough to do exactly, and the
 * alternative — carrying a number the client never verified, or dropping it from the
 * provenance record — is worse than either.
 */
function decodeCompact(bytes: Uint8Array, offset: number): { value: bigint; width: number } {
  const first = bytes[offset];
  if (first === undefined) throw new ChainHeadError('header ended inside a compact integer');
  const mode = first & 0b11;
  if (mode === 0b00) return { value: BigInt(first >> 2), width: 1 };
  if (mode === 0b01) {
    const second = bytes[offset + 1];
    if (second === undefined) throw new ChainHeadError('header ended inside a two-byte compact');
    return { value: BigInt(((second << 8) | first) >>> 2), width: 2 };
  }
  if (mode === 0b10) {
    let raw = 0n;
    for (let i = 3; i >= 0; i -= 1) {
      const byte = bytes[offset + i];
      if (byte === undefined) throw new ChainHeadError('header ended inside a four-byte compact');
      raw = (raw << 8n) | BigInt(byte);
    }
    return { value: raw >> 2n, width: 4 };
  }
  const extra = (first >> 2) + 4;
  let raw = 0n;
  for (let i = extra; i >= 1; i -= 1) {
    const byte = bytes[offset + i];
    if (byte === undefined) throw new ChainHeadError('header ended inside a big-integer compact');
    raw = (raw << 8n) | BigInt(byte);
  }
  return { value: raw, width: extra + 1 };
}

function hexToBytes(hex: string): Uint8Array {
  const body = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (body.length % 2 !== 0) throw new ChainHeadError(`odd-length hex: ${hex.slice(0, 20)}…`);
  const out = new Uint8Array(body.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(body.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** The block number out of a SCALE-encoded header: parent hash (32 B), then a compact. */
export function blockNumberFromHeader(headerHex: string): number {
  const bytes = hexToBytes(headerHex);
  if (bytes.length < 33) throw new ChainHeadError('header is too short to contain a block number');
  const { value } = decodeCompact(bytes, 32);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ChainHeadError(`block number ${value} exceeds the safe integer range`);
  }
  return Number(value);
}

/* ---------------------------------------------------------------------- connection */

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

interface PendingOperation {
  items: StorageItem[];
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export interface ChainHeadConnectionOptions {
  /** `chainHead_v1_follow(withRuntime)`. Runtime updates are what make `_call` possible. */
  readonly withRuntime?: boolean;
}

/**
 * A live chainHead follow subscription, exposing the two operations the read layer needs.
 *
 * Note what this class does **not** do: it never picks a block. `pinnedBlock()` reports
 * the head it has been told about, and every read takes the block it must read at. A
 * transport that substituted "the latest" for an unavailable pin would turn a
 * hard failure into a silently wrong provenance label (V-84).
 */
export class ChainHeadConnection implements ChainHeadTransport {
  readonly #connection: JsonRpcConnectionLike;
  readonly #pending = new Map<number, PendingRequest>();
  readonly #operations = new Map<string, PendingOperation>();
  readonly #orphanEvents = new Map<string, Record<string, unknown>[]>();
  readonly #headerNumbers = new Map<string, number>();
  #nextId = 1;
  #subscription: string | undefined;
  #finalized: HexString | undefined;
  #initialized: ((hash: HexString) => void) | undefined;
  #stopped: string | undefined;

  private constructor(provider: JsonRpcProviderLike) {
    this.#connection = provider((message) => {
      this.#onMessage(message);
    });
  }

  /** Open a connection and follow the chain, resolving once a finalized block is known. */
  static async open(
    provider: JsonRpcProviderLike,
    options: ChainHeadConnectionOptions = {},
  ): Promise<ChainHeadConnection> {
    const connection = new ChainHeadConnection(provider);
    const firstFinalized = new Promise<HexString>((resolve) => {
      connection.#initialized = resolve;
    });
    const subscription = await connection.#request('chainHead_v1_follow', [options.withRuntime ?? true]);
    if (typeof subscription !== 'string') {
      throw new ChainHeadError(`chainHead_v1_follow returned ${JSON.stringify(subscription)}`);
    }
    connection.#subscription = subscription;
    connection.#finalized = await firstFinalized;
    return connection;
  }

  close(): void {
    this.#connection.disconnect();
  }

  /** How many operations currently have buffered events. Bound assertion only. */
  orphanCountForTest(): number {
    return this.#orphanEvents.size;
  }

  async pinnedBlock(): Promise<FinalizedBlockRef> {
    this.#assertLive();
    const blockHash = this.#finalized;
    if (blockHash === undefined) throw new ChainHeadError('no finalized block has been reported yet');
    return { blockHash, blockNumber: await this.#blockNumber(blockHash) };
  }

  async storage(
    at: FinalizedBlockRef,
    key: string,
    type: 'value' | 'descendantsValues',
  ): Promise<readonly StorageItem[]> {
    this.#assertLive();
    const started = await this.#request('chainHead_v1_storage', [
      this.#followSubscription(),
      at.blockHash,
      [{ key, type }],
      null,
    ]);
    const items = await this.#awaitOperation(started, `storage ${key} at ${at.blockHash}`);
    return items as readonly StorageItem[];
  }

  async call(at: FinalizedBlockRef, api: string, argsHex = '0x'): Promise<string> {
    this.#assertLive();
    const started = await this.#request('chainHead_v1_call', [
      this.#followSubscription(),
      at.blockHash,
      api,
      argsHex,
    ]);
    const output = await this.#awaitOperation(started, `${api} at ${at.blockHash}`);
    if (typeof output !== 'string') {
      throw new ChainHeadError(`${api} produced ${JSON.stringify(output)} rather than a hex output`);
    }
    return output;
  }

  /* ------------------------------------------------------------------- internals */

  #assertLive(): void {
    if (this.#stopped !== undefined) throw new SubscriptionStoppedError(this.#stopped);
  }

  #followSubscription(): string {
    if (this.#subscription === undefined) throw new ChainHeadError('the follow subscription is not open');
    return this.#subscription;
  }

  async #blockNumber(blockHash: string): Promise<number> {
    const cached = this.#headerNumbers.get(blockHash);
    if (cached !== undefined) return cached;
    const header = await this.#request('chainHead_v1_header', [this.#followSubscription(), blockHash]);
    if (typeof header !== 'string') {
      // `null` means the block is no longer pinned. Reporting that as block 0, or as a
      // guess, would attach a number to a provenance record nothing verified.
      throw new ChainHeadError(`chainHead_v1_header returned no header for ${blockHash}; it is not pinned`);
    }
    const number = blockNumberFromHeader(header);
    this.#headerNumbers.set(blockHash, number);
    return number;
  }

  #request(method: string, params: unknown[]): Promise<unknown> {
    const id = this.#nextId;
    this.#nextId += 1;
    return new Promise<unknown>((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#connection.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  /**
   * chainHead operations answer twice: the request returns `{result: 'started',
   * operationId}` and the outcome arrives later as a follow-subscription event. The
   * non-`started` results are refusals, and each is a distinct condition worth naming —
   * a transport that treated `limitReached` as an empty result would report "this account
   * holds no positions" when the truth is "the light client declined to look".
   */
  async #awaitOperation(started: unknown, what: string): Promise<unknown> {
    const response = started as { result?: string; operationId?: string } | null;
    if (response === null || typeof response !== 'object') {
      throw new ChainHeadError(`${what}: malformed operation response ${JSON.stringify(started)}`);
    }
    if (response.result === 'limitReached') {
      throw new ChainHeadError(`${what}: the light client refused the operation (limitReached)`);
    }
    if (response.result !== 'started' || typeof response.operationId !== 'string') {
      throw new ChainHeadError(`${what}: unexpected operation response ${JSON.stringify(started)}`);
    }
    const operationId = response.operationId;
    return new Promise<unknown>((resolve, reject) => {
      this.#operations.set(operationId, { items: [], resolve, reject });
      // **Drain anything that arrived first** (V-85). The `started` response and the
      // operation's own events are separate messages, and awaiting the former yields to
      // the microtask queue — so `operationStorageDone` can be delivered *before* this
      // handler exists. Dropping it there hung the read forever, which on screen is a
      // slow chain: the failure mode that produces a bug report about the network.
      const buffered = this.#orphanEvents.get(operationId);
      if (buffered !== undefined) {
        this.#orphanEvents.delete(operationId);
        for (const event of buffered) this.#onFollowEvent(event);
      }
    });
  }

  /**
   * Buffer an event for an operation that has not been registered yet.
   *
   * Bounded, because the buffer is filled by the node: an operation id we never register
   * is never drained, so an unbounded map here is remote-controlled memory growth against
   * the 10 §9.4 budget. The cap is small — real overlap is one or two operations deep —
   * and dropping the oldest is safe: a dropped orphan can only ever fail a read, never
   * complete one wrongly.
   */
  #bufferOrphan(operationId: string, event: Record<string, unknown>): void {
    const MAX_ORPHAN_OPERATIONS = 32;
    if (
      !this.#orphanEvents.has(operationId) &&
      this.#orphanEvents.size >= MAX_ORPHAN_OPERATIONS
    ) {
      const oldest = this.#orphanEvents.keys().next().value;
      if (oldest !== undefined) this.#orphanEvents.delete(oldest);
    }
    const events = this.#orphanEvents.get(operationId) ?? [];
    events.push(event);
    this.#orphanEvents.set(operationId, events);
  }

  #onMessage(message: JsonRpcMessageLike): void {
    if (message.id !== undefined && message.id !== null) {
      const pending = this.#pending.get(Number(message.id));
      if (pending === undefined) return;
      this.#pending.delete(Number(message.id));
      if (message.error !== undefined) pending.reject(new ChainHeadError(message.error.message));
      else pending.resolve(message.result);
      return;
    }
    if (message.method !== 'chainHead_v1_followEvent') return;
    const params = message.params as { subscription?: string; result?: Record<string, unknown> } | undefined;
    if (params?.subscription !== undefined && this.#subscription !== undefined) {
      if (params.subscription !== this.#subscription) return;
    }
    const event = params?.result;
    if (event === undefined) return;
    this.#onFollowEvent(event);
  }

  #onFollowEvent(event: Record<string, unknown>): void {
    switch (event['event']) {
      case 'initialized': {
        const hashes = event['finalizedBlockHashes'] as string[] | undefined;
        const hash = (hashes?.at(-1) ?? event['finalizedBlockHash']) as HexString | undefined;
        if (hash === undefined) return;
        this.#finalized = hash;
        this.#initialized?.(hash);
        this.#initialized = undefined;
        return;
      }
      case 'finalized': {
        const hashes = event['finalizedBlockHashes'] as string[] | undefined;
        const hash = hashes?.at(-1) as HexString | undefined;
        if (hash !== undefined) this.#finalized = hash;
        return;
      }
      case 'operationStorageItems': {
        const operation = this.#operationFor(event);
        if (operation === undefined) return;
        operation.items.push(...((event['items'] as StorageItem[] | undefined) ?? []));
        return;
      }
      case 'operationStorageDone': {
        const operation = this.#operationFor(event);
        if (operation === undefined) return;
        this.#operations.delete(event['operationId'] as string);
        operation.resolve(operation.items);
        return;
      }
      case 'operationCallDone': {
        const operation = this.#operationFor(event);
        if (operation === undefined) return;
        this.#operations.delete(event['operationId'] as string);
        operation.resolve(event['output']);
        return;
      }
      case 'operationWaitingForContinue': {
        // The operation is not finished; it is paused pending our acknowledgement.
        // Not sending `continue` leaves the read hanging forever, which is the worst of
        // the three outcomes because it looks like a slow chain.
        this.#connection.send({
          jsonrpc: '2.0',
          id: this.#nextId++,
          method: 'chainHead_v1_continue',
          params: [this.#followSubscription(), event['operationId']],
        });
        return;
      }
      case 'operationError':
      case 'operationInaccessible': {
        const id = event['operationId'] as string;
        const operation = this.#operationFor(event);
        if (operation === undefined) return;
        this.#operations.delete(id);
        operation.reject(
          new ChainHeadError(
            `operation ${id} failed: ${String(event['error'] ?? event['event'])}. The block may have ` +
              'been unpinned; re-open a reader rather than retrying against a different block.',
          ),
        );
        return;
      }
      case 'stop': {
        this.#stopped = 'the node ended the subscription';
        this.#orphanEvents.clear();
        for (const [id, operation] of this.#operations) {
          this.#operations.delete(id);
          operation.reject(new SubscriptionStoppedError(this.#stopped));
        }
        for (const [id, pending] of this.#pending) {
          this.#pending.delete(id);
          pending.reject(new SubscriptionStoppedError(this.#stopped));
        }
        return;
      }
      default:
        // `newBlock`, `bestBlockChanged`, `operationBodyDone` and anything a later
        // chainHead revision adds. Ignoring an unknown event is right; guessing at one
        // is not.
        return;
    }
  }

  /**
   * The pending operation an event belongs to, buffering the event when it arrives before
   * the operation is registered. Returning `undefined` after buffering is correct: the
   * event will be replayed through this same path the moment the handler exists.
   */
  #operationFor(event: Record<string, unknown>): PendingOperation | undefined {
    const id = event['operationId'];
    if (typeof id !== 'string') return undefined;
    const operation = this.#operations.get(id);
    if (operation === undefined) this.#bufferOrphan(id, event);
    return operation;
  }
}
