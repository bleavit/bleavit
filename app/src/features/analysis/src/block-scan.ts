/**
 * The ingest scanner — 10 §6.5, F8's composition root.
 *
 * `local-index`'s loop consumes a `FinalizedBlockScan` and decides, per block, whether any
 * extrinsic belongs to a watched account. Everything about that decision was built: `ingest.ts`
 * has the phase rules and the correlation-event list, `event-accounts.ts` has the
 * metadata-driven extraction. **Nothing joined them**, and the join cannot live in either
 * package: `local-index` may not import the chain SDK (which is why `IndexedEvent.accounts`
 * was injected in the first place), and `chain-client` may not import anything above it
 * (`nothing-bypasses-chain-client`). So it lives here, in the one compilation unit that
 * depends on both — and which the §10.2 firewall keeps out of the transaction path, exactly
 * as INV-FE-7 requires of anything that reads the local index.
 *
 * ## A block this scanner cannot read is a **refusal**, never an empty scan
 *
 * This is the whole safety property, and it is one line of code either way. An empty
 * `events` array is a well-formed answer meaning *no event in this block names anyone* —
 * `needsBodyFetch` returns false, no body is fetched, and the block is recorded as ingested.
 * So a `System.Events` blob that fails to decode, or a record whose shape this scanner does
 * not recognise, must **throw**: degrade it to an empty scan and the user's transaction
 * disappears from their history with nothing anywhere reporting a problem, and the coverage
 * range then claims the block was seen.
 *
 * That is the same asymmetry `event-accounts.ts` already takes for a metadata surprise, and
 * for the same reason — *a partial account list is precisely the silent-narrow failure*.
 *
 * ## The phase is read, and an unknown phase refuses rather than defaulting
 *
 * Every default is wrong in its own way. Defaulting an unrecognised phase to `finalization`
 * drops the event's attribution silently (a finalization event never attributes, by design).
 * Defaulting it to `apply-extrinsic` needs an index nobody supplied, and a made-up index
 * attributes the event to **a different extrinsic** — which `loop.ts` will then decode and
 * render as the user's. Neither is a state to guess through.
 *
 * ## `extrinsicCount` is never derived from the events (SQ-595)
 *
 * §6.5's cost claim is that a body is fetched only for blocks with a watched extrinsic, so at
 * scan time there is usually no body and no count. Deriving one as `max index + 1` would make
 * `ingest.ts`'s bounds check **vacuous by construction** — a check that cannot fail. It is
 * therefore an optional pass-through argument, and a test asserts this module computes no
 * count of its own.
 *
 * ## Accounts leave as `AccountKey`, and the watched set must be built the same way
 *
 * V-164: PAPI renders a decoded account in *this chain's* SS58 prefix, so a watched set in
 * any other rendering matches nothing ever, presenting as an empty history with no error.
 * `watchedAccounts` is exported beside the scanner so both sides of `watched.has(account)`
 * go through `accountKey` — a caller that builds the set by hand is the one way this can
 * still be got wrong, and giving it a function is cheaper than a comment.
 */

import { accountKey, decodeStorage, type AccountKey, type EventAccountReader } from '@bleavit/chain-client';
import type { ChainCodecs } from '@bleavit/chain-client';
import type { EventPhase, FinalizedBlockScan, IndexedEvent } from '@bleavit/local-index';

/**
 * A block could not be scanned. Never downgraded to an empty scan — see the module note.
 */
export class BlockScanError extends Error {
  readonly blockNumber: number;

  constructor(blockNumber: number, detail: string) {
    super(
      `block ${blockNumber} could not be scanned: ${detail}. Refusing rather than recording ` +
        'an empty scan, which reads as "no event in this block names anyone" — no body is ' +
        'fetched, the block is marked ingested, and the transaction is missing from the ' +
        'history with nothing reporting a problem.',
    );
    this.name = 'BlockScanError';
    this.blockNumber = blockNumber;
  }
}

/** One decoded `System.Events` record, as far as this scanner narrows it. */
interface EventRecord {
  readonly phase: { readonly type: string; readonly value?: unknown };
  readonly event: { readonly type: string; readonly value: { readonly type: string } };
}

function isTagged(candidate: unknown): candidate is { type: string; value?: unknown } {
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    typeof (candidate as { type?: unknown }).type === 'string'
  );
}

function narrowRecord(blockNumber: number, index: number, raw: unknown): EventRecord {
  if (typeof raw !== 'object' || raw === null) {
    throw new BlockScanError(blockNumber, `event record ${index} is not an object`);
  }
  const { phase, event } = raw as { phase?: unknown; event?: unknown };
  if (!isTagged(phase)) {
    throw new BlockScanError(blockNumber, `event record ${index} carries no tagged phase`);
  }
  if (!isTagged(event) || !isTagged(event.value)) {
    throw new BlockScanError(
      blockNumber,
      `event record ${index} is not a tagged pallet event wrapping a tagged variant`,
    );
  }
  return { phase, event: { type: event.type, value: { type: event.value.type } } };
}

/**
 * The three phases FRAME emits. An unrecognised tag refuses — see the module note.
 */
function readPhase(blockNumber: number, index: number, phase: EventRecord['phase']): EventPhase {
  switch (phase.type) {
    case 'ApplyExtrinsic': {
      const extrinsicIndex = phase.value;
      // A non-integer or negative index is refused for the same reason `ingest.ts` refuses an
      // out-of-range one: decoding at a bad index does not throw, it returns a *different*
      // extrinsic, and the client renders someone else's transaction as the user's.
      if (
        typeof extrinsicIndex !== 'number' ||
        !Number.isInteger(extrinsicIndex) ||
        extrinsicIndex < 0
      ) {
        throw new BlockScanError(
          blockNumber,
          `event record ${index} is ApplyExtrinsic with a non-index value`,
        );
      }
      return { kind: 'apply-extrinsic', index: extrinsicIndex };
    }
    case 'Finalization':
      return { kind: 'finalization' };
    case 'Initialization':
      return { kind: 'initialization' };
    default:
      throw new BlockScanError(
        blockNumber,
        `event record ${index} carries an unrecognised phase "${phase.type}"`,
      );
  }
}

/**
 * A scanner bound to one chain's codecs and metadata.
 *
 * Both are taken at composition time, like `fundingKeys` and `eventAccountReader`: a runtime
 * whose events this client cannot read should fail while the app wires itself up, not on the
 * first block of a backfill.
 */
export interface BlockScanner {
  /**
   * Scan one finalized block's `System.Events` value.
   *
   * `eventsHex` is the raw storage value as read at that block — the scanner does not fetch
   * it, because a scanner that could fetch could also fetch at a different block than the one
   * it stamps, which is the read-at-the-block-I-pinned rule `chain-client` makes structural.
   *
   * `extrinsicCount` is passed through untouched and defaults to absent (SQ-595).
   */
  scan(blockNumber: number, eventsHex: string, extrinsicCount?: number): FinalizedBlockScan;
}

export function blockScanner(codecs: ChainCodecs, reader: EventAccountReader): BlockScanner {
  return {
    scan(blockNumber, eventsHex, extrinsicCount) {
      const decoded = decodeStorage<readonly unknown[]>(codecs, 'System', 'Events', eventsHex);
      if (!decoded.ok) {
        throw new BlockScanError(blockNumber, decoded.reason);
      }
      if (!Array.isArray(decoded.value)) {
        throw new BlockScanError(blockNumber, 'System.Events did not decode to a list');
      }
      const events: IndexedEvent[] = decoded.value.map((raw, index) => {
        const record = narrowRecord(blockNumber, index, raw);
        return {
          phase: readPhase(blockNumber, index, record.phase),
          pallet: record.event.type,
          name: record.event.value.type,
          // The whole outer event, not the narrowed copy: the reader walks the declared type
          // tree beside the decoded value and needs the fields the narrowing dropped.
          accounts: reader.accounts((raw as { event: unknown }).event),
        };
      });
      return extrinsicCount === undefined
        ? { number: blockNumber, events }
        : { number: blockNumber, extrinsicCount, events };
    },
  };
}

/**
 * The watched set, built through the same conversion the scanner emits.
 *
 * `watched.has(account)` is a string comparison, so the two sides must agree on the rendering
 * or it matches nothing — and matching nothing presents as an **empty transaction history**,
 * not as an error (V-164). Exported so no caller has to remember that.
 */
export function watchedAccounts(addresses: Iterable<string>): ReadonlySet<AccountKey> {
  const watched = new Set<AccountKey>();
  for (const address of addresses) watched.add(accountKey(address));
  return watched;
}
