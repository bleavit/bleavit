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
 * **Both bounds are metered on the stream, and the row one needed {@link rowUpperBound} to be.**
 * Until 2026-08-06 rows were counted only after the document parsed, so *streamed* held for
 * bytes and not for rows: a file of four million tiny rows was fully resident and fully parsed
 * before anything objected, which is the post-mortem shape in the half of the sentence nobody
 * re-read. The streaming meter is an over-count and the exact count still runs after the parse;
 * see that function for why over-counting is the only safe direction.
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

/**
 * The bounds one import is metered against.
 *
 * §8.4's pair is the **ceiling**, not the setting. A device chooses its own byte bound and passes
 * it here: 400 MB of input is not 400 MB of memory — the admission holds the file text, the
 * `JSON.parse` tree, the parsed model and the digest pre-image at once — and §9.4 budgets a
 * mobile tab 350 MB of steady-state memory in total, with §9.2 capping its whole local store at
 * 75 MB. A single constant cannot be right for both device classes, and the one that is wrong on
 * a phone fails as a dead tab rather than as a refusal. The multiple is unmeasured and the
 * reconciliation is 10 §8.4's to make: PLAN.md · *Spec questions* SQ-632.
 *
 * A caller may only ever bound this **further**. {@link importSnapshotStream} refuses a request
 * that names a larger bound than §8.4's rather than clamping it silently — a caller asking for
 * more than the specification allows has misunderstood something, and quietly giving them less
 * is how that misunderstanding survives.
 */
export interface QuotaBounds {
  readonly maxBytes: number;
  readonly maxRows: number;
}

/** §8.4's own pair, as bounds. */
export const SPEC_QUOTA_BOUNDS: QuotaBounds = Object.freeze({
  maxBytes: IMPORT_MAX_UNCOMPRESSED_BYTES,
  maxRows: IMPORT_MAX_ROWS,
});

/**
 * An upper bound on the rows a chunk of the document can contain, computable **while streaming**.
 *
 * §8.4 asks for both quotas to be enforced on a stream, and the row count is only *exact* once
 * the document parses — which is after the whole file is resident, at which point a row quota is
 * a post-mortem exactly as a byte quota checked at the end would be. So the meter counts what it
 * can see: every row this format stores (an op, a balance, a vault, a coverage range) is a JSON
 * **object**, so the number of `{` in the file is at least the number of rows in it. Three extra
 * objects (the document, its binding, its range) and any `{` inside a string label make it an
 * over-count, never an under-count — so refusing on this number can never admit a document that
 * exceeds the bound, and the exact count still runs after the parse.
 *
 * The over-count direction is the one that must be right, and it is the safe one: it can refuse
 * a document slightly under the bound, which costs a user nothing (nothing is imported and
 * nothing is evicted), while an under-count would admit one over it and leave the local database
 * unusable — §8.4's stated reason for having a row bound at all.
 */
export function rowUpperBound(text: string): number {
  let objects = 0;
  for (let at = 0; at < text.length; at += 1) {
    if (text.charCodeAt(at) === 0x7b) objects += 1;
  }
  return objects;
}

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
  bounds: QuotaBounds = SPEC_QUOTA_BOUNDS,
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
  if (next.bytes > bounds.maxBytes) {
    return { kind: 'refused', breach: 'bytes', state: next, message: BREACH_COPY.bytes };
  }
  if (next.rows > bounds.maxRows) {
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

/**
 * What the client says when the user answers the preview with *no*.
 *
 * Fixed copy, here rather than at the import entry point, and deliberately **not** a
 * `FE-PROV-*` refusal: §10.4's family is the error taxonomy, and a user declining an offer is
 * not an error. Labelling it `FE-PROV-003` — *"this snapshot was rejected"* — would tell
 * somebody their file is bad when what happened is that they kept their own data.
 */
export const EVICTION_DECLINED =
  'Nothing was imported and nothing was deleted. The snapshot needed room that your local ' +
  'history is using, and you chose to keep the history. You can import it later, or free room ' +
  'first — the file is unchanged either way.';

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
