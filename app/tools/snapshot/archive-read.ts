/**
 * `app/tools/snapshot` — the archive-node adapter (10 §8.5.1). F24.
 *
 * This is the half `build.ts` was written to be pure over: it turns an archive node's
 * JSON-RPC answers into the {@link ArchiveExport} the driver folds, pins and publishes. Until
 * 10 §8.5.1 was written there was no document naming the interface, and guessing one is what
 * R-2 forbids — so the file did not exist and the gap was filed as SQ-612. §8.5.1 answers it,
 * and every rule below is that section's rather than this file's.
 *
 * ## The `archive_v1_*` group, and nothing else
 *
 * §8.5.1 binds the producer to the **`archive_v1_*` group of the Polkadot JSON-RPC interface
 * specification** — `genesisHash`, `finalizedHeight`, `hashByHeight`, `header`, `body`,
 * `storage` and `call`. No method outside the group is issued here.
 *
 * **The reason is §8.2's promise, not §4.2's constraint**, and this note had those the wrong way
 * round until 2026-08-07. 10 §4.2 limits the *in-browser light client* to `chainHead_v1_*`, and a
 * producer running `tools/snapshot` against an archive node is not that client — so §4.2 does not
 * reach this file, and leading with it made the binding look derived from a rule that does not
 * apply. What does reach it is §8.2: a snapshot must be *"reproducible byte-identically by
 * anyone"*, which is a promise made to **second producers**, and a second producer can only hold
 * this one to it against a **versioned** contract. The legacy `state_*`/`chain_*` pair has none —
 * no specification fixes its pagination, its ordering or its truncation behaviour, so two
 * producers reading the same node through it can disagree with nobody at fault.
 *
 * That the browser client already speaks the `chainHead_v1_*` sibling is a genuine convenience —
 * one storage model, one key-type vocabulary, and `packages/chain-client`'s transport as a working
 * reference for every event handled below — but it is corroboration, not the derivation.
 *
 * ## The transport is injected, and so is the codec
 *
 * Two seams, for two different reasons.
 *
 * **The transport** ({@link ArchiveTransport}) is injected because the rest of `tools/snapshot`
 * is pure over its input and the suites depend on that: a hardcoded WebSocket makes the
 * pagination discipline below — the load-bearing property of the whole file — testable only
 * against a live node, which means never. It carries `onNotification` beside `request` because
 * `archive_v1_storage` is a **subscription**: the request answers with an opaque operation id
 * and the items arrive later as `archive_v1_storageEvent` notifications. A transport with only
 * `request` could not deliver them, and one that collected them itself would have to know the
 * event protocol, which is exactly what this file exists to get right.
 *
 * **The codec** ({@link ArchiveCodec}) is injected because decoding needs a metadata-driven
 * type registry, and `tools/snapshot` deliberately depends on `@bleavit/providers` and
 * `@bleavit/handoff-envelope` alone (10 §10.1; the app rule that only `chain-client` may open a
 * chain connection points the same way). The split is not a convenience: **this file performs
 * every read and interprets none of them**, so it names no pallet, no storage key and no
 * runtime entry point, and there is no chain constant in it to go stale. A producer supplies
 * the metadata-bound half; §8.5.1's discipline is here, once, for all of them.
 *
 * ## Completeness is established, never inferred — the one property that matters
 *
 * The interface specification says `storageDone` is *"always generated after all `storage`
 * events have been generated"* and says **nothing** about whether a server may stop early, cap
 * a response or discard items. So `storageDone` is a server's claim, not a completeness proof.
 * A reader that took it for one would report an `observed` span it never observed, and the
 * resulting document passes every screen in 10 §8.4 — the movements it *does* carry are
 * perfectly consistent — while describing a history that did not happen. That is the accidental
 * forgery §8.2 exists to prevent, and it is the single most important thing this file gets
 * right.
 *
 * So {@link readDescendants} continues every `descendantsValues`/`descendantsHashes` iteration
 * with `paginationStartKey` until a continuation yields no key it has not already seen, and
 * {@link readArchiveExport} records a span in `observed` **only when every read covering it
 * concluded**. `StorageRead` is therefore a verdict rather than an array: a caller cannot
 * accidentally treat a short answer as a complete one, because the short answer has no `entries`
 * member to reach.
 *
 * ### The line between narrowing and refusing
 *
 * Two failures look alike and are not. **A read that did not conclude is honest ignorance**, and
 * `observed` is precisely the structure for recording it — so an inconclusive read narrows the
 * span and the document says so. **A decode failure is different**: the bytes are in hand and the
 * producer does not know what they say, so any op set it published for that block would be a
 * claim it cannot support. §8.5.1 is explicit — *"a producer that cannot decode a block refuses
 * to publish it rather than emitting it raw"* — and 10 §6.5's raw *"pending decoder"* row is a
 * **client** accommodation for history it could not obtain a decoder for, never a producer's.
 * So an undecodable block refuses the whole read.
 *
 * Refusing the whole read rather than dropping the block is the stricter reading and it names
 * the real cause. Dropping it would leave the movements missing from the fold while the chain
 * read at the last block still counts them, so `buildSnapshot`'s differential would refuse one
 * layer later — with a message about a missing movement rather than about a decoder.
 *
 * ### What this cannot catch, stated rather than papered over
 *
 * A server that answers the first page short, emits `storageDone`, and then answers the
 * continuation **empty** is indistinguishable from one that is finished. The interface
 * publishes no total and no proof, so no reader can close that gap. What closes it is one layer
 * up and by construction: the balance sheet is read from state rather than folded from the ops,
 * so a short holdings read produces a balance sheet the movements over-state, and
 * `buildSnapshot` refuses. That is the whole argument for the differential, arriving here as the
 * backstop for the one hole the wire leaves open.
 *
 * ## Identity is pinned, and the endpoint is never recorded
 *
 * §8.2's reproducibility promise is a property of the **document**, so it must not depend on
 * which node answered. The plan names the chain by `genesisHash`, this file compares it against
 * `archive_v1_genesisHash` and refuses on a mismatch, and range endpoints are pinned by block
 * hash through `archive_v1_hashByHeight`. Any archive node of that chain answers identically,
 * so an addressing convention for endpoints would add a coordination requirement without adding
 * a guarantee. **Nothing here writes an endpoint URL into the export**, and there is no field
 * for one — a producer names its own node and the document does not.
 *
 * ## Historical metadata comes from the block being decoded
 *
 * 10 §6.5's discipline binds the producer exactly as it binds the client: decode with the
 * *producing* runtime's metadata, never guess. The metadata is obtained with `archive_v1_call`
 * at each block whose events are decoded. `[VERIFY — FE-P5]` does not reach this tool — it asks
 * whether the **light client** can retrieve metadata at depth, and it is open because 10 §4.2
 * limits that client to `chainHead_v1_*`; an archive node retains historical state by
 * definition, which is the distinction between the two.
 *
 * ## Cost, stated honestly
 *
 * Five requests per block — metadata call, events storage operation, body, header, and the
 * hash-by-height that named it — plus the holdings iteration at the last block. There is no
 * cross-block batching to be had: `archive_v1_storage` takes one block hash, so items cannot be
 * pooled across heights. A wide range is slow. It is not made fast by reading less.
 */

import type { SnapshotBalance, SnapshotRange, SnapshotVault } from '@bleavit/providers';

import type { ArchiveExport, PositionedOp } from './build.ts';

/* ------------------------------------------------------------------ the transport seam */

/**
 * The JSON-RPC seam — the only way this file reaches a node.
 *
 * `request` resolves a method's `result` and rejects on transport failure or a JSON-RPC
 * `error`; every call site here treats a rejection as a failed read rather than letting it
 * escape, so a producer never loses a partially completed range to an exception.
 *
 * `onNotification` delivers subscription events. It is separate because `archive_v1_storage`
 * is the one method in the group that answers twice: `request` resolves with an operation id
 * and the items follow as `archive_v1_storageEvent` notifications. The listener receives the
 * notification's `method` and its `params` unchanged — parsing them is this file's job, not
 * the transport's.
 */
export interface ArchiveTransport {
  request(method: string, params: readonly unknown[]): Promise<unknown>;
  onNotification(listener: (method: string, params: unknown) => void): () => void;
}

/** One `storage` event. `value` and `hash` are populated per the item's query type. */
export interface StorageEntry {
  readonly key: string;
  readonly value?: string;
  readonly hash?: string;
}

/**
 * What a storage read produced, as a **verdict** rather than an array.
 *
 * The shape is the control. A function returning `StorageEntry[]` invites a caller to use a
 * short answer as though it were a complete one — which is the accidental forgery in one line
 * of code — so an inconclusive read simply has no entries to reach for.
 */
export type StorageRead =
  | { readonly kind: 'concluded'; readonly entries: readonly StorageEntry[] }
  | { readonly kind: 'inconclusive'; readonly why: string };

/** The two iterating query types §8.5.1 names. `value` reads take the other path. */
export type DescendantQuery = 'descendantsValues' | 'descendantsHashes';

/* --------------------------------------------------------------------- the codec seam */

/** A runtime entry point and its SCALE-encoded argument, as `archive_v1_call` takes them. */
export interface RuntimeCall {
  readonly method: string;
  readonly args: string;
}

/**
 * A codec answer.
 *
 * `undecodable` is a value, not an exception, because §8.5.1 makes it an outcome the producer
 * must act on rather than an accident: the block is refused, and the reason travels with the
 * refusal instead of arriving as a stack trace.
 */
export type Decoded<T> =
  | { readonly kind: 'decoded'; readonly value: T }
  | { readonly kind: 'undecodable'; readonly why: string };

/** The runtime-derived half of §8.2's `binding`. `genesisHash` comes from the node, not here. */
export interface RuntimeBinding {
  readonly specVersion: number;
  readonly contractVersion: number;
}

/** One block's bytes, read at that block, with that block's own metadata beside them. */
export interface BlockBytes {
  readonly block: number;
  readonly blockHash: string;
  /** From `archive_v1_call` at **this** block (10 §6.5, §8.5.1). Never carried forward. */
  readonly metadata: string;
  /** The value under {@link ArchiveCodec.eventsKey} at this block. */
  readonly events: string;
  /** `archive_v1_body` — the extrinsics an event's `ApplyExtrinsic(i)` phase indexes into. */
  readonly body: readonly string[];
}

/** What the holdings read at the range's last block decodes to. */
export interface Holdings {
  readonly vaults: readonly SnapshotVault[];
  readonly balances: readonly SnapshotBalance[];
}

/**
 * The metadata-bound half, supplied by the producer.
 *
 * Every member is a **pure function of bytes this file read**. That is what keeps the division
 * honest: the codec never issues a request, and this file never interprets one. A codec that
 * needed to read something would be telling us the plan is incomplete, which is a change here
 * rather than a private round trip there.
 */
export interface ArchiveCodec {
  /** The entry point yielding a block's metadata, issued at each decoded block (§8.5.1). */
  readonly metadataCall: RuntimeCall;
  /** Calls identifying the runtime, issued once at the range's last block. May be empty. */
  readonly bindingCalls: readonly RuntimeCall[];
  /** The storage key holding a block's events, derived from that block's own metadata. */
  eventsKey(metadata: string): string;
  /** The prefix the holdings live under, derived from the last block's metadata. */
  holdingsPrefix(metadata: string): string;
  decodeBinding(input: {
    readonly metadata: string;
    readonly outputs: readonly string[];
  }): Decoded<RuntimeBinding>;
  decodeBlock(input: BlockBytes): Decoded<readonly PositionedOp[]>;
  decodeHoldings(input: {
    readonly metadata: string;
    readonly block: number;
    readonly entries: readonly StorageEntry[];
  }): Decoded<Holdings>;
}

/* --------------------------------------------------------------------------- the plan */

export interface ArchiveReadPlan {
  /**
   * The chain the producer means to snapshot, by genesis hash.
   *
   * Required, with no default, and compared against `archive_v1_genesisHash` before anything
   * else is read. Taking the node's answer as the truth would make the check vacuous: the
   * point is that a producer states which chain it intends and a node pointed at another one
   * is refused rather than silently snapshotted.
   */
  readonly genesisHash: string;
  readonly fromBlock: number;
  readonly toBlock: number;
  /**
   * How many `paginationStartKey` continuations one iteration may take before the read is
   * reported inconclusive.
   *
   * A bound rather than a loop, because the alternative to a bound is a reader that either
   * hangs on a server repeating itself or — far worse — stops silently and calls the result
   * complete. Exceeding it never truncates: it produces `inconclusive`.
   */
  readonly maxContinuations?: number;
}

export type ArchiveReadResult =
  | {
      readonly kind: 'read';
      readonly export: ArchiveExport;
      /**
       * Reads that did not conclude, and therefore blocks `observed` does not cover.
       *
       * Not a warning to be logged and forgotten: each line is the reason a span is missing,
       * and a caller that publishes anyway will meet the same gap at `buildSnapshot` as a
       * refusal about a missing movement.
       */
      readonly notes: readonly string[];
    }
  | { readonly kind: 'refused'; readonly why: readonly string[] };

/** Default continuation budget. Generous: a real iteration ends in a handful of pages. */
const MAX_CONTINUATIONS = 4096;

/* ------------------------------------------------------------------------- hex helpers */

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Lowercase, `0x`-stripped. Comparing normalized hex IS byte order — see {@link compareKeys}. */
function normalizeHex(raw: string): string {
  const body = raw.startsWith('0x') || raw.startsWith('0X') ? raw.slice(2) : raw;
  return body.toLowerCase();
}

/**
 * Byte order over two storage keys.
 *
 * Plain string comparison of normalized hex is byte-lexicographic order, because each byte is
 * exactly two hex digits and `'0' < … < '9' < 'a' < … < 'f'` is nibble order. Stated because it
 * looks like a shortcut and is not: it is only true once both sides are lowercased, which is
 * what {@link normalizeHex} is for.
 */
function compareKeys(left: string, right: string): number {
  const a = normalizeHex(left);
  const b = normalizeHex(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function isU32(raw: unknown): raw is number {
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= 0xffff_ffff;
}

/* ------------------------------------------------------------- the storage subscription */

type StorageOutcome =
  | { readonly kind: 'done'; readonly entries: readonly StorageEntry[] }
  | { readonly kind: 'error'; readonly why: string };

interface PendingOperation {
  readonly entries: StorageEntry[];
  readonly settle: (outcome: StorageOutcome) => void;
}

/**
 * One `archive_v1_storageEvent` listener, dispatching to the operation each event belongs to.
 *
 * **Events can arrive before the operation is registered**, and dropping them there hangs the
 * read forever — which on a producer's console looks like a slow node rather than a defect.
 * `packages/chain-client` records this as V-85 for the `chainHead` sibling and the mechanism is
 * identical: awaiting `request` yields to the microtask queue, so `storageDone` can be
 * delivered before the handler that would consume it exists. Early events are buffered and
 * replayed through the same path.
 *
 * The orphan buffer is **bounded**, because it is filled by the server: an operation id we
 * never register is never drained, so an unbounded map here is remote-controlled memory growth.
 * Dropping the oldest is safe in the only direction that matters — a dropped orphan can fail a
 * read, never complete one wrongly.
 */
class StorageChannel {
  static readonly #MAX_ORPHAN_OPERATIONS = 32;

  readonly #transport: ArchiveTransport;
  readonly #off: () => void;
  readonly #pending = new Map<string, PendingOperation>();
  readonly #orphans = new Map<string, unknown[]>();

  constructor(transport: ArchiveTransport) {
    this.#transport = transport;
    this.#off = transport.onNotification((method, params) => {
      if (method !== 'archive_v1_storageEvent') return;
      const envelope = params as { subscription?: unknown; result?: unknown } | undefined;
      const subscription = envelope?.subscription;
      if (typeof subscription !== 'string') return;
      this.#deliver(subscription, envelope?.result);
    });
  }

  dispose(): void {
    this.#off();
    this.#pending.clear();
    this.#orphans.clear();
  }

  /** Run one storage operation to its `storageDone` or `storageError`. Never throws. */
  async run(blockHash: string, item: Readonly<Record<string, unknown>>): Promise<StorageOutcome> {
    let started: unknown;
    try {
      started = await this.#transport.request('archive_v1_storage', [blockHash, [item], null]);
    } catch (error) {
      return { kind: 'error', why: `archive_v1_storage failed: ${message(error)}` };
    }
    if (typeof started !== 'string' || started.length === 0) {
      return {
        kind: 'error',
        why: `archive_v1_storage answered ${JSON.stringify(started)} rather than an operation id`,
      };
    }
    return new Promise<StorageOutcome>((resolve) => {
      this.#pending.set(started, { entries: [], settle: resolve });
      const buffered = this.#orphans.get(started);
      if (buffered === undefined) return;
      this.#orphans.delete(started);
      for (const event of buffered) this.#deliver(started, event);
    });
  }

  #deliver(subscription: string, raw: unknown): void {
    const pending = this.#pending.get(subscription);
    if (pending === undefined) {
      this.#buffer(subscription, raw);
      return;
    }
    if (typeof raw !== 'object' || raw === null) return;
    const event = raw as Record<string, unknown>;
    switch (event['event']) {
      case 'storage': {
        const key = event['key'];
        if (typeof key !== 'string') {
          this.#settle(subscription, {
            kind: 'error',
            why: `a storage event carried ${JSON.stringify(key)} as its key`,
          });
          return;
        }
        const value = event['value'];
        const hash = event['hash'];
        pending.entries.push({
          key,
          ...(typeof value === 'string' ? { value } : {}),
          ...(typeof hash === 'string' ? { hash } : {}),
        });
        return;
      }
      case 'storageDone':
        this.#settle(subscription, { kind: 'done', entries: pending.entries });
        return;
      case 'storageError':
        this.#settle(subscription, {
          kind: 'error',
          why: `storageError: ${String(event['error'] ?? 'no reason given')}`,
        });
        return;
      default:
        // An event a later revision of the group adds. Ignoring one is right; guessing is not.
        return;
    }
  }

  #settle(subscription: string, outcome: StorageOutcome): void {
    const pending = this.#pending.get(subscription);
    if (pending === undefined) return;
    this.#pending.delete(subscription);
    pending.settle(outcome);
  }

  #buffer(subscription: string, event: unknown): void {
    if (
      !this.#orphans.has(subscription) &&
      this.#orphans.size >= StorageChannel.#MAX_ORPHAN_OPERATIONS
    ) {
      const oldest = this.#orphans.keys().next().value;
      if (oldest !== undefined) this.#orphans.delete(oldest);
    }
    const events = this.#orphans.get(subscription) ?? [];
    events.push(event);
    this.#orphans.set(subscription, events);
  }
}

/* ------------------------------------------------------------------------ storage reads */

/**
 * Read one key. A `value` query has nothing to paginate, so it concludes with its operation.
 *
 * The completeness discipline below does not apply and is not simulated here: §8.5.1 scopes it
 * to `descendantsValues`/`descendantsHashes`, and a single-key query either answers or errors.
 */
async function readValue(
  channel: StorageChannel,
  blockHash: string,
  key: string,
): Promise<StorageRead> {
  const outcome = await channel.run(blockHash, { key, type: 'value' });
  if (outcome.kind === 'error') {
    return { kind: 'inconclusive', why: `reading ${key} at ${blockHash}: ${outcome.why}` };
  }
  return { kind: 'concluded', entries: outcome.entries };
}

/**
 * Iterate a prefix to exhaustion, or report that it could not be established — 10 §8.5.1.
 *
 * The loop continues with `paginationStartKey` **after** `storageDone`, every time, and stops
 * only when a continuation yields no key it has not already seen. The extra round trip on a
 * complete read is the price of establishing completeness rather than inferring it, and §8.5.1
 * spends it deliberately.
 *
 * Two server behaviours are refused rather than accepted, and both are truncations wearing the
 * costume of a finished read:
 *
 *  - **A continuation that returns a key below the resume point.** The interface specification
 *    does not say whether `paginationStartKey` is inclusive or exclusive — it says only that
 *    iteration *"should resume"* from it — so a terminal continuation may legitimately come
 *    back empty or carrying exactly the resume key. It may never carry a key *below* it under
 *    either reading. A server that does has ignored the parameter, most visibly by re-serving
 *    the first page forever, and `storageDone` on such an answer is a claim about a query that
 *    did not run.
 *  - **A continuation that returns an unseen key below the resume point** is the same signal
 *    read from the other end: the resume point is the greatest key we hold, so a key below it
 *    that we have never seen means an earlier page omitted it.
 *
 * Exported because the discipline is the reusable part. A producer reading anything else out of
 * an archive node — a second map, a child trie — needs this function and not a copy of it.
 */
export async function readDescendants(
  transport: ArchiveTransport,
  blockHash: string,
  prefix: string,
  type: DescendantQuery,
  maxContinuations = MAX_CONTINUATIONS,
): Promise<StorageRead> {
  const channel = new StorageChannel(transport);
  try {
    return await iterate(channel, blockHash, prefix, type, maxContinuations);
  } finally {
    channel.dispose();
  }
}

async function iterate(
  channel: StorageChannel,
  blockHash: string,
  prefix: string,
  type: DescendantQuery,
  maxContinuations: number,
): Promise<StorageRead> {
  const seen = new Set<string>();
  const entries: StorageEntry[] = [];
  let start: string | undefined;

  for (let round = 0; round <= maxContinuations; round += 1) {
    const item =
      start === undefined
        ? { key: prefix, type }
        : { key: prefix, type, paginationStartKey: start };
    const outcome = await channel.run(blockHash, item);
    if (outcome.kind === 'error') {
      return {
        kind: 'inconclusive',
        why:
          `iterating ${prefix} at ${blockHash} stopped after ${entries.length} item(s): ` +
          outcome.why,
      };
    }
    if (start !== undefined) {
      const resume = start;
      const below = outcome.entries.find((entry) => compareKeys(entry.key, resume) < 0);
      if (below !== undefined) {
        return {
          kind: 'inconclusive',
          why:
            `iterating ${prefix} at ${blockHash}: the continuation from ${resume} returned ` +
            `${below.key}, which is below the resume point. The server did not honour ` +
            'paginationStartKey, so its storageDone describes a query that did not run — and ' +
            'a reader that stopped here would report a span it never observed.',
        };
      }
    }
    const fresh = outcome.entries.filter((entry) => !seen.has(normalizeHex(entry.key)));
    if (fresh.length === 0) {
      // The continuation yielded no key we had not already seen: the iteration is exhausted.
      // On the first round this means the prefix is empty, which has no resume point and
      // therefore no continuation to issue.
      return { kind: 'concluded', entries };
    }
    for (const entry of fresh) {
      seen.add(normalizeHex(entry.key));
      entries.push(entry);
    }
    // The resume point is the greatest key held, which is what makes "below the resume point"
    // above a statement about omission rather than about ordering.
    start = fresh.reduce(
      (highest, entry) => (compareKeys(entry.key, highest) > 0 ? entry.key : highest),
      fresh[0]!.key,
    );
  }

  return {
    kind: 'inconclusive',
    why:
      `iterating ${prefix} at ${blockHash} exceeded ${maxContinuations} continuations with ` +
      `${entries.length} item(s) held. Reporting what arrived would be exactly the short read ` +
      'this bound exists to refuse.',
  };
}

/* --------------------------------------------------------------------------- the reader */

type Answer<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly why: string };

/**
 * One request, with its answer checked at the boundary and its failure returned as a value.
 *
 * `accept` returns `undefined` for anything unusable, so a node answering `null`, a number
 * where a hash belongs, or nothing at all takes the same path as a dropped connection. That
 * matters more than it looks: every one of those is a read that did not happen, and the whole
 * file turns on never confusing a read that did not happen with an empty result.
 */
function requester(transport: ArchiveTransport) {
  return async function request<T>(
    method: string,
    params: readonly unknown[],
    accept: (raw: unknown) => T | undefined,
  ): Promise<Answer<T>> {
    let raw: unknown;
    try {
      raw = await transport.request(method, params);
    } catch (error) {
      return { ok: false, why: `${method} failed: ${message(error)}` };
    }
    const value = accept(raw);
    if (value === undefined) {
      return { ok: false, why: `${method} answered ${JSON.stringify(raw)}, which is not usable` };
    }
    return { ok: true, value };
  };
}

const asString = (raw: unknown): string | undefined => (typeof raw === 'string' ? raw : undefined);

function asHexList(raw: unknown): readonly string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string') return undefined;
    out.push(entry);
  }
  return out;
}

const asHeight = (raw: unknown): number | undefined => (isU32(raw) ? raw : undefined);

/** `archive_v1_call`: `null` for an unknown block, else `{success}` with a value or a reason. */
function asCallOutput(raw: unknown): string | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const record = raw as Record<string, unknown>;
  if (record['success'] !== true) return undefined;
  const value = record['value'];
  return typeof value === 'string' ? value : undefined;
}

/** Merge a set of observed heights into §8.2's ordered, non-overlapping, maximally-merged form. */
/**
 * Run one codec member, turning a throw into the refusal the caller already handles.
 *
 * The codec's contract is that `undecodable` is a value rather than an exception, and this is
 * what makes that true of a codec that does not honour it. A throw escaping here would leave
 * `readArchiveExport` — which promises to refuse rather than throw — losing a range that was
 * read correctly to a defect in somebody else's decoder.
 */
function guarded<T>(what: string, run: () => Decoded<T>): Decoded<T> {
  try {
    return run();
  } catch (error) {
    return { kind: 'undecodable', why: `${what} threw: ${message(error)}` };
  }
}

function spans(heights: readonly number[]): readonly SnapshotRange[] {
  const sorted = [...heights].sort((left, right) => left - right);
  const merged: SnapshotRange[] = [];
  for (const height of sorted) {
    const last = merged[merged.length - 1];
    if (last !== undefined && height === last.toBlock + 1) {
      merged[merged.length - 1] = { fromBlock: last.fromBlock, toBlock: height };
      continue;
    }
    if (last !== undefined && height === last.toBlock) continue;
    merged.push({ fromBlock: height, toBlock: height });
  }
  return merged;
}

/**
 * Read one range out of an archive node — 10 §8.5.1.
 *
 * Refuses rather than throwing, and returns **all** the reasons: a producer that cannot read
 * needs to know what is wrong with the node or the plan, and an exception carries one reason
 * where there are usually several. What it returns on success is an {@link ArchiveExport}, which
 * `buildSnapshot` then orders, reconciles against the chain read, pins, and runs the client's
 * own admission screens over. Nothing here decides whether the result is publishable.
 */
export async function readArchiveExport(
  transport: ArchiveTransport,
  plan: ArchiveReadPlan,
  codec: ArchiveCodec,
): Promise<ArchiveReadResult> {
  const request = requester(transport);
  const notes: string[] = [];

  if (!isU32(plan.fromBlock) || !isU32(plan.toBlock)) {
    return { kind: 'refused', why: ['the plan\'s range endpoints must be block heights'] };
  }
  if (plan.fromBlock > plan.toBlock) {
    return {
      kind: 'refused',
      why: [`the plan asks for ${plan.fromBlock}..${plan.toBlock}, which is inverted`],
    };
  }

  // --- identity, before anything is read at a block

  const genesis = await request('archive_v1_genesisHash', [], asString);
  if (!genesis.ok) return { kind: 'refused', why: [genesis.why] };
  if (normalizeHex(genesis.value) !== normalizeHex(plan.genesisHash)) {
    return {
      kind: 'refused',
      why: [
        `this node's genesis hash is ${genesis.value} and the plan asks for ${plan.genesisHash}. ` +
          'A snapshot is addressed by chain and block, so a document built from the wrong ' +
          'chain would be pinned, importable, and about a history the consumer does not have.',
      ],
    };
  }

  // --- the range must be finalized history, not a fork the node may still drop

  const finalized = await request('archive_v1_finalizedHeight', [], asHeight);
  if (!finalized.ok) return { kind: 'refused', why: [finalized.why] };
  if (plan.toBlock > finalized.value) {
    return {
      kind: 'refused',
      why: [
        `block ${plan.toBlock} is above this node's finalized height ${finalized.value}. Above ` +
          'it the interface guarantees nothing: hashByHeight may answer with several blocks and ' +
          'body may answer null at any time, so a span read there is not history yet.',
      ],
    };
  }

  // --- pin every height to exactly one hash, and check that the hashes form one chain

  const hashes: string[] = [];
  for (let height = plan.fromBlock; height <= plan.toBlock; height += 1) {
    const answer = await request('archive_v1_hashByHeight', [height], asHexList);
    if (!answer.ok) return { kind: 'refused', why: [answer.why] };
    if (answer.value.length !== 1) {
      return {
        kind: 'refused',
        why: [
          `archive_v1_hashByHeight(${height}) returned ${answer.value.length} hashes. At or ` +
            'below the finalized height it must return exactly one, so this node is not ' +
            'answering about finalized history and no block read at that height can be pinned.',
        ],
      };
    }
    hashes.push(answer.value[0]!);
  }

  for (const [index, blockHash] of hashes.entries()) {
    const header = await request('archive_v1_header', [blockHash], asString);
    if (!header.ok) return { kind: 'refused', why: [header.why] };
    // A SCALE-encoded header opens with its 32-byte parent hash, so the link is the first 64
    // hex digits. No compact decoding is needed: the height is what we asked by.
    const body = normalizeHex(header.value);
    if (body.length < 64) {
      return {
        kind: 'refused',
        why: [`the header at ${blockHash} is ${body.length / 2} bytes; it carries no parent hash`],
      };
    }
    const parent = body.slice(0, 64);
    const previous = hashes[index - 1];
    if (previous !== undefined && parent !== normalizeHex(previous)) {
      return {
        kind: 'refused',
        why: [
          `block ${plan.fromBlock + index} names 0x${parent} as its parent and the block this ` +
            `read pinned one height below is ${previous}. The blocks do not form one chain, so ` +
            'they are not a span of one history — the usual cause is a load-balanced endpoint ' +
            'answering from two nodes.',
        ],
      };
    }
  }

  // --- per block: its own metadata, its events, its body, and a decode that must succeed

  const channel = new StorageChannel(transport);
  try {
    const ops: PositionedOp[] = [];
    const observed: number[] = [];
    let lastMetadata: string | undefined;

    for (const [index, blockHash] of hashes.entries()) {
      const height = plan.fromBlock + index;

      const metadata = await request(
        'archive_v1_call',
        [blockHash, codec.metadataCall.method, codec.metadataCall.args],
        asCallOutput,
      );
      if (!metadata.ok) {
        return {
          kind: 'refused',
          why: [
            `${metadata.why} — this is ${codec.metadataCall.method} at block ${height}. 10 §6.5 ` +
              'requires the producing runtime\'s own metadata, and a block whose metadata cannot ' +
              'be obtained cannot be decoded, so it is refused rather than decoded with another ' +
              'runtime\'s types.',
          ],
        };
      }
      lastMetadata = metadata.value;

      // Asked once and held, so a codec that answered two different keys for one metadata blob
      // could not have this file read one key and look for another.
      let eventsKey: string;
      try {
        eventsKey = codec.eventsKey(metadata.value);
      } catch (error) {
        return {
          kind: 'refused',
          why: [`the codec could not name the events key at block ${height}: ${message(error)}`],
        };
      }

      const read = await readValue(channel, blockHash, eventsKey);
      if (read.kind === 'inconclusive') {
        // Honest ignorance: the block leaves `observed` and its movements are not claimed.
        notes.push(`block ${height} is not observed — ${read.why}`);
        continue;
      }
      const events = read.entries.find(
        (entry) => normalizeHex(entry.key) === normalizeHex(eventsKey),
      )?.value;
      if (events === undefined) {
        return {
          kind: 'refused',
          why: [
            `the events key holds no value at block ${height}. The read concluded, so this is ` +
              'not a short answer: either the key the codec named is wrong or the block is not ' +
              'the one it claims to be. Either way its events cannot be decoded.',
          ],
        };
      }

      const extrinsics = await request('archive_v1_body', [blockHash], asHexList);
      if (!extrinsics.ok) {
        return {
          kind: 'refused',
          why: [
            `${extrinsics.why} — this is the body of block ${height}. At or below the finalized ` +
              'height the interface guarantees a non-null body for a block it named, so an ' +
              'absent one means the node stopped answering about finalized history mid-read.',
          ],
        };
      }

      const decoded = guarded(`decodeBlock at block ${height}`, () =>
        codec.decodeBlock({
          block: height,
          blockHash,
          metadata: metadata.value,
          events,
          body: extrinsics.value,
        }),
      );
      if (decoded.kind === 'undecodable') {
        return {
          kind: 'refused',
          why: [
            `block ${height} could not be decoded: ${decoded.why}. 10 §8.5.1 refuses to publish ` +
              'it rather than emitting it raw — §6.5\'s "pending decoder" row is a client ' +
              'accommodation for history it could not get a decoder for, and a producer that ' +
              'emitted one would be publishing an op set it already knows is incomplete.',
          ],
        };
      }
      ops.push(...decoded.value);
      observed.push(height);
    }

    if (lastMetadata === undefined) {
      return { kind: 'refused', why: ['the range yielded no block to read metadata at'] };
    }

    // --- the binding's runtime half, at the range's last block

    const lastHash = hashes[hashes.length - 1]!;
    const outputs: string[] = [];
    for (const call of codec.bindingCalls) {
      const answer = await request(
        'archive_v1_call',
        [lastHash, call.method, call.args],
        asCallOutput,
      );
      if (!answer.ok) {
        return {
          kind: 'refused',
          why: [`${answer.why} — this is ${call.method} at block ${plan.toBlock}, which the ` +
            'document\'s binding is built from. An unidentified runtime cannot be pinned to.'],
        };
      }
      outputs.push(answer.value);
    }
    const binding = guarded('decodeBinding', () =>
      codec.decodeBinding({ metadata: lastMetadata, outputs }),
    );
    if (binding.kind === 'undecodable') {
      return {
        kind: 'refused',
        why: [`the runtime at block ${plan.toBlock} could not be identified: ${binding.why}`],
      };
    }

    // --- the balance sheet, read from state and never folded from the ops above

    let holdingsPrefix: string;
    try {
      holdingsPrefix = codec.holdingsPrefix(lastMetadata);
    } catch (error) {
      return {
        kind: 'refused',
        why: [
          `the codec could not name the holdings prefix at block ${plan.toBlock}: ${message(error)}`,
        ],
      };
    }
    const holdings = await iterate(
      channel,
      lastHash,
      holdingsPrefix,
      'descendantsValues',
      plan.maxContinuations ?? MAX_CONTINUATIONS,
    );
    if (holdings.kind === 'inconclusive') {
      return {
        kind: 'refused',
        why: [
          `the holdings read at block ${plan.toBlock} did not conclude: ${holdings.why} ` +
            'Publishing the rows that did arrive would state a balance sheet this read cannot ' +
            'support, and publishing none would assert the chain holds nothing. Both are ' +
            'claims about state that was never established, and the balance sheet is the one ' +
            'thing in the document that is supposed to be a differential against the chain.',
        ],
      };
    }
    const decodedHoldings = guarded('decodeHoldings', () =>
      codec.decodeHoldings({
        metadata: lastMetadata,
        block: plan.toBlock,
        entries: holdings.entries,
      }),
    );
    if (decodedHoldings.kind === 'undecodable') {
      return {
        kind: 'refused',
        why: [
          `the holdings at block ${plan.toBlock} could not be decoded: ${decodedHoldings.why}`,
        ],
      };
    }

    return {
      kind: 'read',
      export: {
        binding: {
          genesisHash: genesis.value,
          specVersion: binding.value.specVersion,
          contractVersion: binding.value.contractVersion,
        },
        range: { fromBlock: plan.fromBlock, toBlock: plan.toBlock },
        observed: spans(observed),
        vaults: decodedHoldings.value.vaults,
        ops,
        balances: decodedHoldings.value.balances,
      },
      notes,
    };
  } finally {
    channel.dispose();
  }
}
