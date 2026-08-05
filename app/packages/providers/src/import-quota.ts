/**
 * Snapshot import quotas — 10 §8.4, F9.
 *
 * > Import quotas (≤ 400 MB uncompressed, ≤ 4 M rows, **streamed**, **eviction preview
 * > before import**) — unchanged.
 *
 * One sentence, and every clause in it is a control that fails a different way.
 *
 * ## "Streamed" is not a performance note — it is where the quota is enforced
 *
 * A quota checked after the file is read is not a quota. The resource it bounds has already
 * been consumed by the time the check runs, so a 4 GB snapshot is refused *by the browser
 * running out of memory*, which is not a refusal — it is a crash with a moral. So
 * `QuotaMeter` accumulates and **refuses at the chunk that crosses the line**, before that
 * chunk is handed on. `admitChunk` returns the decision; there is no variant that reports a
 * breach after the fact.
 *
 * ## Both bounds, because either alone is trivially evaded
 *
 * 400 MB in 100 rows and 4 M rows totalling 10 MB are both inside one bound and outside the
 * other, and both break something real: the first is a memory limit, the second is an
 * IndexedDB row-count limit that shows up as a browser tab that never becomes responsive
 * again. Checking one and mentioning the other is the shape a reviewer skims past.
 *
 * ## "Eviction preview **before** import" — the ordering is the whole control
 *
 * §9.2's ladder means importing a large snapshot evicts existing local data. A preview shown
 * *after* the import is a report. The user's decision is whether to trade what they have for
 * what the snapshot offers, and they can only make it while they still have both.
 *
 * So `planImport` is a **pure function that writes nothing** and returns what would be
 * evicted, and the import entry point takes its result as a required argument. There is no
 * path from a snapshot to the store that does not pass through a plan the caller had to
 * obtain first — the same device `admitIntent` uses for its digest.
 *
 * ## The bounds are release constants, not chain constants
 *
 * 10 §5.4's no-literal rule governs values 02 §9 freezes — things governance can move, which
 * the client must therefore read. These are local resource ceilings this release chose; there
 * is no chain surface to read them from, and a governance vote does not change how much
 * memory a phone has. Same classification as `packages/protocol`'s kernel table.
 */

/** 10 §8.4's two bounds. Release constants — see the module note. */
export const IMPORT_MAX_UNCOMPRESSED_BYTES = 400_000_000;
export const IMPORT_MAX_ROWS = 4_000_000;

export type QuotaBreach = 'bytes' | 'rows';

export interface QuotaState {
  readonly bytes: number;
  readonly rows: number;
}

export type ChunkVerdict =
  | { readonly kind: 'accepted'; readonly state: QuotaState }
  | {
      readonly kind: 'refused';
      readonly breach: QuotaBreach;
      readonly state: QuotaState;
      readonly message: string;
    };

const BREACH_COPY: Readonly<Record<QuotaBreach, string>> = Object.freeze({
  bytes:
    'This snapshot is larger than the import limit. The limit exists because the import is ' +
    'held in memory while it is written, and a browser tab that runs out of memory loses ' +
    'everything already imported as well.',
  rows:
    'This snapshot has more rows than the import limit. Row count is a separate limit from ' +
    'size: several million small rows fit well under the size cap and still leave the local ' +
    'database unusable.',
});

/**
 * Accumulate one streamed chunk and decide whether the import may continue.
 *
 * Pure: the caller holds the state. That is deliberate — a meter that owned mutable state
 * would let a caller reuse one across two imports and carry the first one's totals into the
 * second's headroom, which reads as a smaller snapshot than it is.
 */
export function admitChunk(
  state: QuotaState,
  chunkBytes: number,
  chunkRows: number,
): ChunkVerdict {
  if (!Number.isInteger(chunkBytes) || chunkBytes < 0 || !Number.isInteger(chunkRows) || chunkRows < 0) {
    // A negative or fractional chunk is not a measurement, and treating it as zero would let
    // a malformed producer walk the meter backwards.
    throw new RangeError(
      `a chunk must report non-negative integer bytes and rows, got ${chunkBytes}/${chunkRows}`,
    );
  }
  const next: QuotaState = { bytes: state.bytes + chunkBytes, rows: state.rows + chunkRows };
  // Checked in this order only for determinism of the reported breach; both are checked on
  // every chunk, so neither can be reached by staying under the other.
  if (next.bytes > IMPORT_MAX_UNCOMPRESSED_BYTES) {
    return { kind: 'refused', breach: 'bytes', state: next, message: BREACH_COPY.bytes };
  }
  if (next.rows > IMPORT_MAX_ROWS) {
    return { kind: 'refused', breach: 'rows', state: next, message: BREACH_COPY.rows };
  }
  return { kind: 'accepted', state: next };
}

export const EMPTY_QUOTA: QuotaState = Object.freeze({ bytes: 0, rows: 0 });

// ---------------------------------------------------------------- eviction preview

/** What the local store currently holds, per evictable table. */
export interface LocalFootprint {
  readonly table: string;
  readonly rows: number;
  readonly bytes: number;
  /** Oldest data first — the ladder degrades depth before recency (§9.2). */
  readonly oldestBlock: number;
}

export interface EvictionLine {
  readonly table: string;
  readonly rows: number;
  readonly bytes: number;
  readonly throughBlock: number;
}

/**
 * What an import would cost, computed **without writing anything**.
 *
 * `wouldEvict` empty does not mean "safe" — it means nothing has to go. The distinction the
 * caller must not collapse is between *nothing will be evicted* and *we did not check*, and
 * this function has no failure mode that returns the former for the latter: an unmeasurable
 * footprint is the caller's problem before it gets here.
 */
export interface ImportPlan {
  readonly incoming: QuotaState;
  readonly budgetBytes: number;
  readonly wouldEvict: readonly EvictionLine[];
  readonly evictedBytes: number;
  /** True when even evicting everything listed leaves the import over budget. */
  readonly infeasible: boolean;
}

export function planImport(
  incoming: QuotaState,
  footprint: readonly LocalFootprint[],
  budgetBytes: number,
): ImportPlan {
  const held = footprint.reduce((sum, entry) => sum + entry.bytes, 0);
  const overBy = held + incoming.bytes - budgetBytes;
  if (overBy <= 0) {
    return { incoming, budgetBytes, wouldEvict: [], evictedBytes: 0, infeasible: false };
  }
  // Oldest first — §9.2's ladder gives up depth before recency, and evicting the newest data
  // to make room for a snapshot of old data is the exact inversion of what the user wants.
  const byAge = [...footprint].sort((a, b) => a.oldestBlock - b.oldestBlock);
  const wouldEvict: EvictionLine[] = [];
  let freed = 0;
  for (const entry of byAge) {
    if (freed >= overBy) break;
    wouldEvict.push({
      table: entry.table,
      rows: entry.rows,
      bytes: entry.bytes,
      throughBlock: entry.oldestBlock,
    });
    freed += entry.bytes;
  }
  return {
    incoming,
    budgetBytes,
    wouldEvict,
    evictedBytes: freed,
    // Reported rather than thrown: the user is entitled to see *why* it cannot fit, and a
    // plan that refuses to be constructed cannot show them.
    infeasible: freed < overBy,
  };
}

/** Fixed copy for the preview. Names what is lost, because that is the decision being made. */
export function previewCopy(plan: ImportPlan): string {
  if (plan.infeasible) {
    return (
      'This snapshot does not fit even after evicting every local range that could be freed. ' +
      'Nothing has been imported and nothing has been deleted.'
    );
  }
  if (plan.wouldEvict.length === 0) {
    return 'This snapshot fits without evicting anything already stored.';
  }
  const tables = plan.wouldEvict.map((line) => `${line.table} (${line.rows} rows)`).join(', ');
  return (
    `Importing this snapshot will delete local data to make room: ${tables}. Oldest data goes ` +
    'first. This happens only if you continue, and it cannot be undone from here — the ' +
    'evicted ranges would have to be re-ingested or re-imported.'
  );
}
