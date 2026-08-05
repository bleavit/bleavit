/**
 * Backfill arithmetic — 10 §6.4, F8.
 *
 * This section exists because the reviewed text was **inconsistent three ways**: it claimed
 * 50 blk/s, said "~9 days of chain per hour" where that rate gives 12.5, and budgeted
 * 20 blk/s in §21. The spec standardised on 20 blk/s and published a table. So the useful
 * thing to build is not a restatement of that table but a **re-derivation of it** — the same
 * discipline `reference-model/sustainability.py` applies to 08 §10, where an executable form
 * of a document's own arithmetic found two defects on its first run.
 *
 * Every published figure below is therefore computed, and the suite asserts the computed
 * value against §6.4's printed one. A future edit to either side that breaks their agreement
 * fails, which is exactly what the three-way inconsistency needed and did not have.
 *
 * ## The rate is `[VERIFY]`, and it is carried as one
 *
 * 20 blk/s is *budgeted*, not measured — §6.4 tags it `[VERIFY achieved rate — FE-P4]`, and
 * §12 records "backfill arithmetic at 20 blk/s until FE-P4 measures reality" as a
 * conservative assumption in force. So the rate is a **required argument** with no default
 * anywhere in this module: a caller that wants the budgeted figure passes
 * `BUDGETED_INGEST_BLOCKS_PER_SECOND` and is thereby saying which number it means. A default
 * would let a measured rate arrive and never reach the callers that needed it.
 */

/** §6.4's budgeted desktop ingest rate. `[VERIFY achieved rate — FE-P4]`. */
export const BUDGETED_INGEST_BLOCKS_PER_SECOND = 20;

/**
 * Blocks per day is **a required argument, never a constant here**.
 *
 * It is a consequence of the chain's block time, which the client reads from metadata like
 * every other chain value (10 §5.4) — and the 10 §5.4 gate is what caught the first draft
 * compiling `14_400` in, correctly: that number is also `Epoch::DecisionWindowFloor`, and a
 * module that carried it would be one governance change away from computing a day's worth
 * of backfill against a day that no longer exists. Callers pass what the chain says; the
 * suite passes 02 §8's published figure, which is where a literal for it belongs.
 */

/**
 * The layer-2 operator commitment (10 §6.2, 12 §6.1): 30 days, and **the edge of what can
 * be backfilled at all**. §6.4 is blunt about the other side of it — "backfill beyond the
 * operator window *does not exist* (no serving infrastructure; smoldot has no archive
 * access)" — so a plan reaching past it is refused rather than truncated. Truncating would
 * produce a shorter plan that runs to completion and reports success having never fetched
 * the range the caller asked for.
 */
export const OPERATOR_WINDOW_DAYS = 30;

/** The window in blocks, at the chain's actual cadence rather than an assumed one. */
export function operatorWindowBlocks(blocksPerDay: number): number {
  if (!Number.isInteger(blocksPerDay) || blocksPerDay <= 0) {
    throw new BackfillError(`${blocksPerDay} is not a blocks-per-day figure`);
  }
  return OPERATOR_WINDOW_DAYS * blocksPerDay;
}

/** §6.4's newest→oldest chunk size. */
export const BACKFILL_CHUNK_BLOCKS = 1_000;

export class BackfillError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackfillError';
  }
}

function assertRate(blocksPerSecond: number): void {
  if (!Number.isFinite(blocksPerSecond) || blocksPerSecond <= 0) {
    throw new BackfillError(`ingest rate ${blocksPerSecond} is not a positive rate`);
  }
}

/** Blocks of chain ingested per hour of tab time. §6.4 publishes 72,000 at 20 blk/s. */
export function blocksPerTabHour(blocksPerSecond: number): number {
  assertRate(blocksPerSecond);
  return blocksPerSecond * 3_600;
}

/** Days of chain time backfilled per hour of tab time. §6.4 publishes 5.0 at 20 blk/s. */
export function chainDaysPerTabHour(blocksPerSecond: number, blocksPerDay: number): number {
  return blocksPerTabHour(blocksPerSecond) / blocksPerDay;
}

/** Hours of tab time to backfill a block span. §6.4 publishes 6.0 for the full window. */
export function tabHoursFor(blocks: number, blocksPerSecond: number): number {
  assertRate(blocksPerSecond);
  if (!Number.isInteger(blocks) || blocks < 0) {
    throw new BackfillError(`${blocks} is not a block count`);
  }
  return blocks / blocksPerTabHour(blocksPerSecond);
}

export interface BackfillChunk {
  readonly fromBlock: number;
  readonly toBlock: number;
}

export interface BackfillPlan {
  /** Newest→oldest, as §6.4 requires: the most recent history is the most useful, and a
   * plan interrupted halfway leaves the user with the part they were looking at. */
  readonly chunks: readonly BackfillChunk[];
  readonly totalBlocks: number;
  readonly estimatedTabHours: number;
}

/**
 * Plan a backfill of `[fromBlock, toBlock]`, newest chunk first.
 *
 * `head` is the current finalized height, and it is required because the operator window is
 * relative to *now* — a plan validated against a stale head would creep past the window one
 * session at a time, each step looking lawful.
 */
export function planBackfill(
  fromBlock: number,
  toBlock: number,
  head: number,
  blocksPerSecond: number,
  blocksPerDay: number,
  chunkSize = BACKFILL_CHUNK_BLOCKS,
): BackfillPlan {
  for (const [name, value] of [
    ['fromBlock', fromBlock],
    ['toBlock', toBlock],
    ['head', head],
    ['chunkSize', chunkSize],
  ] as const) {
    if (!Number.isInteger(value) || value < 0) throw new BackfillError(`${name} ${value} is not a block height`);
  }
  if (chunkSize === 0) throw new BackfillError('a zero chunk size would plan forever');
  if (toBlock < fromBlock) {
    // Refused rather than normalised: an inverted range is a caller bug, and swapping the
    // ends would silently fetch a range nobody asked for.
    throw new BackfillError(`inverted range ${fromBlock}..${toBlock}`);
  }
  if (toBlock > head) throw new BackfillError(`${toBlock} is beyond the finalized head ${head}`);
  const oldestServable = Math.max(0, head - operatorWindowBlocks(blocksPerDay));
  if (fromBlock < oldestServable) {
    throw new BackfillError(
      `block ${fromBlock} is outside the ${OPERATOR_WINDOW_DAYS}-day operator window (oldest ` +
        `servable is ${oldestServable}). 10 §6.4: backfill beyond the window does not exist — ` +
        'there is no serving infrastructure and smoldot has no archive access. Deep history is ' +
        'the province of snapshots (§8), by design rather than by omission.',
    );
  }

  const chunks: BackfillChunk[] = [];
  for (let end = toBlock; end >= fromBlock; end -= chunkSize) {
    chunks.push({ fromBlock: Math.max(fromBlock, end - chunkSize + 1), toBlock: end });
    if (end - chunkSize + 1 <= fromBlock) break;
  }
  const totalBlocks = toBlock - fromBlock + 1;
  return { chunks, totalBlocks, estimatedTabHours: tabHoursFor(totalBlocks, blocksPerSecond) };
}
