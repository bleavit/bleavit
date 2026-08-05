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

/**
 * The two `chainHead_v1_storage` query kinds this client issues.
 *
 * Named rather than inlined at `storage()` so a caller deriving the kind from somewhere
 * else — a recorded transcript, most obviously — narrows against *this* declaration
 * instead of re-stating the pair. Two copies of a closed set agree until one of them
 * gains a member.
 */
export type StorageQueryType = 'value' | 'descendantsValues';

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
  /** How many announced blocks to keep pinned. See `PIN_WINDOW`. */
  readonly pinWindow?: number;
}

/**
 * How many announced blocks stay pinned.
 *
 * chainHead pins **every** block it announces and keeps it until we send
 * `chainHead_v1_unpin`; the node's pin budget is finite, and exceeding it makes the node
 * end the subscription. So a transport that never unpins does not leak quietly — it
 * accumulates until the chain kills every read at once, after an uptime long enough that
 * nobody connects the two events.
 *
 * A **window** rather than a reader refcount, deliberately. A refcount is more precise and
 * it can leak: one caller that forgets to release reintroduces exactly the unbounded
 * resource this bound exists to remove, and the failure returns in a form no test of this
 * module can see. The window cannot — it depends on nothing a caller does. What it costs
 * is that a reader older than the window loses its block, which is the behaviour
 * `FinalizedReader` already documents and already fails loudly on ("what ends a reader is
 * its block ceasing to be readable, which the transport reports by failing the read").
 *
 * 16 blocks is ~3 minutes at a 12 s parachain slot — three orders of magnitude beyond the
 * lifetime of a read, and small enough that the pin budget is never the binding constraint.
 */
const PIN_WINDOW = 16;

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
  readonly #pinWindow: number;
  #pinnedOrder: HexString[] = [];
  #nextId = 1;
  #subscription: string | undefined;
  #finalized: HexString | undefined;

  readonly #finalizedListeners = new Set<(hash: HexString) => void>();
  #initialized: ((hash: HexString) => void) | undefined;
  #initializationFailed: ((error: Error) => void) | undefined;
  #stopped: string | undefined;

  private constructor(provider: JsonRpcProviderLike, pinWindow: number) {
    this.#pinWindow = pinWindow;
    this.#connection = provider((message) => {
      this.#onMessage(message);
    });
  }

  /**
   * Open a connection and follow the chain, resolving once a finalized block is known.
   *
   * The wait for that first block has a **failure** path as well as a success one, which
   * it did not when this shipped. `chainHead_v1_follow` can succeed and the subscription
   * then emit `stop` before `initialized` ever arrives — an early worker or connection
   * failure does exactly that. The follow request has already left `#pending` by then, so
   * the `stop` handler had nothing to reject, and boot waited forever instead of failing
   * into a state the caller could retry or degrade from. A promise with no reject path is
   * a hang wearing the costume of an await.
   */
  static async open(
    provider: JsonRpcProviderLike,
    options: ChainHeadConnectionOptions = {},
  ): Promise<ChainHeadConnection> {
    const connection = new ChainHeadConnection(provider, options.pinWindow ?? PIN_WINDOW);
    const firstFinalized = new Promise<HexString>((resolve, reject) => {
      connection.#initialized = resolve;
      connection.#initializationFailed = reject;
    });
    try {
      const subscription = await connection.#request('chainHead_v1_follow', [
        options.withRuntime ?? true,
      ]);
      if (typeof subscription !== 'string') {
        throw new ChainHeadError(`chainHead_v1_follow returned ${JSON.stringify(subscription)}`);
      }
      connection.#subscription = subscription;
      connection.#finalized = await firstFinalized;
    } catch (error) {
      // Never leave a live socket behind a failed boot; the caller has no handle to close.
      connection.#connection.disconnect();
      throw error;
    }
    return connection;
  }

  /**
   * Subscribe to **every** finalized block hash, in order.
   *
   * Not the same thing as the finalized *head*, and the difference is a defect waiting to
   * happen. `chainHead_v1_follow` reports finalization as `finalizedBlockHashes` — an
   * **array**, because several blocks can finalize at once — and this class keeps only
   * `.at(-1)` for its own purposes, which is right for "where is the chain now" and wrong
   * for anything that has to *see* each block.
   *
   * An ingestion consumer built on the head alone would skip every intermediate block in a
   * multi-block finalization. The local index would notice — its coverage would show holes —
   * but it would show them constantly, under entirely normal operation, and a gap indicator
   * that is always on tells a user nothing. So consumers get the whole array, in order.
   *
   * Listeners are called synchronously inside the follow-event handler and must not throw:
   * a throw here would abort the handler mid-event, leaving pins un-trimmed and the
   * subscription's own bookkeeping half-applied. Errors are the listener's to contain.
   */
  onFinalized(listener: (hash: HexString) => void): () => void {
    this.#finalizedListeners.add(listener);
    return () => {
      this.#finalizedListeners.delete(listener);
    };
  }

  close(): void {
    this.#failInitialization('the connection was closed before a finalized block arrived');
    this.#connection.disconnect();
  }

  /** How many operations currently have buffered events. Bound assertion only. */
  orphanCountForTest(): number {
    return this.#orphanEvents.size;
  }

  /** How many blocks this connection believes are pinned. Bound assertion only. */
  pinnedCountForTest(): number {
    return this.#pinnedOrder.length;
  }

  /** How many block numbers are cached. Bound assertion only. */
  headerCacheCountForTest(): number {
    return this.#headerNumbers.size;
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
    type: StorageQueryType,
  ): Promise<readonly StorageItem[]> {
    this.#assertLive();
    const started = await this.#request('chainHead_v1_storage', [
      this.#followSubscription(),
      at.blockHash,
      [{ key, type }],
      null,
    ]);
    const items = await this.#awaitOperation(started, `storage ${key} at ${at.blockHash}`, 1);
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

  /** Fail a boot that is still waiting for its first finalized block. */
  #failInitialization(reason: string): void {
    const fail = this.#initializationFailed;
    this.#initialized = undefined;
    this.#initializationFailed = undefined;
    fail?.(new SubscriptionStoppedError(reason));
  }

  /** Record blocks the node has announced, and therefore pinned on our behalf. */
  #announcePinned(hashes: readonly (HexString | undefined)[]): void {
    for (const hash of hashes) {
      if (hash !== undefined && !this.#pinnedOrder.includes(hash)) this.#pinnedOrder.push(hash);
    }
  }

  /**
   * Release pins, never including the current finalized head.
   *
   * The head is excluded unconditionally rather than by position: `newBlock` announcements
   * arrive between finalizations and could otherwise push the one block every reader is
   * about to pin out of the window.
   */
  #unpin(hashes: readonly HexString[]): void {
    if (this.#subscription === undefined) return; // Announced pre-`open`; trimmed later.
    const releasable = hashes.filter((hash) => hash !== this.#finalized);
    if (releasable.length === 0) return;
    for (const hash of releasable) {
      const at = this.#pinnedOrder.indexOf(hash);
      if (at >= 0) this.#pinnedOrder.splice(at, 1);
      // The block-number cache is keyed by hash and was never evicted either — a second,
      // quieter unbounded map, growing once per finalized block for the life of the tab.
      this.#headerNumbers.delete(hash);
    }
    void this.#request('chainHead_v1_unpin', [this.#subscription, releasable]).catch(() => {
      // A failed unpin means the node has already dropped the block, which is the state
      // we asked for. There is nothing to recover and nothing to report.
    });
  }

  #trimPins(): void {
    if (this.#pinnedOrder.length <= this.#pinWindow) return;
    this.#unpin(this.#pinnedOrder.slice(0, this.#pinnedOrder.length - this.#pinWindow));
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
   *
   * **`discardedItems` is the other door into that same room**, and this code missed it
   * while the paragraph above described it. Under operation pressure the node answers
   * `started` *and* discards some of the requested keys; for a one-key request that means
   * `discardedItems: 1`, `operationStorageDone` with no items, and a resolved read of
   * `[]`. The pinned `@polkadot-api/substrate-client` treats exactly this as an operation
   * limit — `response.result === "limitReached" || response.discardedItems ===
   * inputs.length` raise the same `OperationLimitError` — so a refusal is not a result
   * here either. `requestedItems` is passed for storage and omitted for `_call`, which
   * has no items to discard.
   */
  async #awaitOperation(
    started: unknown,
    what: string,
    requestedItems?: number,
  ): Promise<unknown> {
    const response = started as
      | { result?: string; operationId?: string; discardedItems?: number }
      | null;
    if (response === null || typeof response !== 'object') {
      throw new ChainHeadError(`${what}: malformed operation response ${JSON.stringify(started)}`);
    }
    if (response.result === 'limitReached') {
      throw new ChainHeadError(`${what}: the light client refused the operation (limitReached)`);
    }
    if (response.result !== 'started' || typeof response.operationId !== 'string') {
      throw new ChainHeadError(`${what}: unexpected operation response ${JSON.stringify(started)}`);
    }
    const discarded = response.discardedItems ?? 0;
    if (requestedItems !== undefined && discarded > 0) {
      // Stricter than PAPI, which only errors on a *full* discard. A partial discard
      // silently shortens the answer, and a short `descendantsValues` witness is worse
      // than a refused one: `crossCheckedCall` compares an API result against that prefix,
      // so a truncated witness turns the FE-P2 check into a verdict about how loaded the
      // node was. We request one key, so any discard is a full one anyway.
      throw new ChainHeadError(
        `${what}: the light client discarded ${discarded} of ${requestedItems} requested ` +
          'item(s) under operation pressure. Refusing rather than answering with the ' +
          'items that survived — an empty or short result reads as "this key holds ' +
          'nothing" when the truth is "the query did not run".',
      );
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
        const hashes = event['finalizedBlockHashes'] as HexString[] | undefined;
        const hash = (hashes?.at(-1) ?? event['finalizedBlockHash']) as HexString | undefined;
        if (hash === undefined) return;
        this.#finalized = hash;
        this.#announcePinned(hashes ?? [hash]);
        this.#initialized?.(hash);
        this.#initialized = undefined;
        this.#initializationFailed = undefined;
        return;
      }
      case 'newBlock': {
        // Announced blocks are pinned by the node whether or not we ever read at them,
        // so they have to enter the window; dropping them here would leak the majority
        // of pins, since most blocks are announced and never finalized-and-read.
        this.#announcePinned([event['blockHash'] as HexString | undefined]);
        this.#trimPins();
        return;
      }
      case 'finalized': {
        const hashes = event['finalizedBlockHashes'] as HexString[] | undefined;
        const hash = hashes?.at(-1) as HexString | undefined;
        if (hash !== undefined) this.#finalized = hash;
        this.#announcePinned(hashes ?? []);
        // Every hash, in order — see `onFinalized`. Emitted **after** `#announcePinned` so a
        // listener that immediately reads at one finds it pinned; that is the whole of the
        // ordering requirement. It is deliberately not claimed that emission must precede
        // `#unpin`: that call takes `prunedBlockHashes`, a set disjoint from the finalized
        // ones, so no ordering between them can expose a released hash to a listener.
        for (const finalizedHash of hashes ?? []) {
          for (const listener of this.#finalizedListeners) listener(finalizedHash);
        }
        // Pruned blocks are unreadable from this moment regardless, so releasing them is
        // free; keeping them was pure accumulation.
        this.#unpin((event['prunedBlockHashes'] as HexString[] | undefined) ?? []);
        this.#trimPins();
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
        this.#pinnedOrder = [];
        this.#failInitialization(this.#stopped);
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
        // `bestBlockChanged`, `operationBodyDone` and anything a later chainHead
        // revision adds. Ignoring an unknown event is right; guessing at one is not.
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
