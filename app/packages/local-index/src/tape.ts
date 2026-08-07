/**
 * The chain-wide trade tape — 10 §9.1's *"bounded windowed read, never a retained table"* (F8).
 *
 * §9.1 closes its load model with one sentence that decides two things at once:
 *
 * > Chain-wide `Traded` is consumed into the candle aggregates as it is scanned and never stored
 * > row-by-row; a chain-wide trade tape is a **bounded windowed read**, never a retained table.
 *
 * The first clause is the aggregation (`tradeCandles`, folded per block in `ingestBlock`). This
 * module is the second, and it is a *refusal* wearing the shape of a feature: a surface asking
 * for the chain's recent fills gets them from the scan stream over a window it has to name, and
 * gets nothing at all from storage — because there is nothing in storage to get, by §9.1's own
 * ruling and by §9.2's arithmetic.
 *
 * ## The bound is §9.2's own number, re-derived rather than chosen
 *
 * §9.2 publishes the retained equivalent: *"at the chain-permitted `Traded` ceiling (§9.1) the
 * 15 % share holds ~**6.7 h** desktop / ~**1.7 h** mobile of chain-wide trade rows"*. That is the
 * honest ceiling for a window held in memory too — a window the index could not have stored is
 * one the client should not materialise either — so `tradeTapeBound` computes it from the events
 * share, the caller's measured row size and §9.1's per-block fill ceiling, and `tradeTapeHours`
 * reproduces §9.2's two published cells from the same arithmetic. Nothing here is a new
 * parameter: the share is §9.2's, the ceiling is §9.1's, and the row size is the caller's, which
 * is what app-code rule 7 requires of every modelled figure.
 *
 * ## Why the window is refused rather than truncated
 *
 * A truncated answer to *"what has the chain traded"* is a **wrong** answer, not a smaller one:
 * the fills it drops are invisible, and a surface totalling volume over a silently-clipped window
 * reports a quiet market. So an over-wide window throws before a single scan is read, naming the
 * bound it exceeded, and the caller narrows the question instead of being handed an answer to a
 * different one.
 *
 * ## The same reasoning applies to a block the stream never delivered — SQ-900
 *
 * The paragraph above refused an inverted window because *no fills* reads as *the market was
 * quiet*, and then the scan loop skipped a block the stream never delivered with the same
 * `continue` that skips a block outside the window. Those are not the same event: one is the
 * caller's question, the other is a reconnect gap, a paused subscription or a stream that started
 * late — and a window `100..200` answered from scans for `100..150` returns fewer fills and renders
 * as exactly the quiet market this module refuses to report anywhere else.
 *
 * So the read reports **which blocks it saw**, beside the fills. It is the conservative reading of
 * a genuinely open question: 10 §6.3's *"every history query returns data plus the coverage it
 * came from"* is scoped to the layer-3 local index, and §9.1 makes this read deliberately *"a
 * bounded windowed read, never a retained table"* — so §6.3 may not bind it at all. INV-FE-15's
 * *"never silently spliced"* carries no such scoping. SQ-900 asks which governs; until it is ruled
 * the answer discloses, because the unsafe direction is the silent one.
 *
 * The disclosure deliberately does **not** borrow §6.3's vocabulary: these spans are not
 * `CoverageRange`s (they have no origin, no edge and no `ingestedAt` — nothing was ingested) and
 * the gaps are not `Hole`s. Naming them so would answer SQ-900 in the code while the row stayed
 * open. The tracking is bounded by the same bound the fills are: at most `maxBlocks` numbers.
 */

import { tradedFills, type FinalizedBlockScan } from './ingest.js';
import type { RowSizes, StorageBudget } from './quota.js';

export class TradeTapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TradeTapeError';
  }
}

/**
 * §9.1's per-block `Traded` ceiling, pinned by the runtime and published in that section.
 *
 * > The runtime pins that ceiling (`pov_budgets::traded_event_ceiling_per_block_pinned_for_
 * > frontend_budgets`): **93 fills per block**, where proof size binds […] **70 primary + 23
 * > external = 93**, exactly saturating the block bound.
 *
 * A frontend figure with a chain-side origin, so it is stated once, here, with its derivation —
 * and it is not a 02 §9 frozen constant, which is why §5.4's no-literal rule has nothing to read
 * from. It is the *maximum* a block can carry, which is what a bound needs: sizing a window on a
 * typical rate produces a bound that holds until the day it matters.
 *
 * **Neither this constant nor `BLOCK_SECONDS` below is reachable by `check:chain-literals`, and
 * the reason is structural rather than an oversight to be fixed later.** That gate has exactly
 * two rules: **A** binds a 02 §9 frozen constant's *name* to a numeric literal, and neither name
 * appears in that table; **B** catches a distinctive frozen *value* appearing bare and is
 * restricted to four decimal digits or more, because `32` and `64` are hash widths and array
 * sizes on every other line — so `93` and `6` are below the threshold by design, and widening it
 * is what makes a gate noisy enough to be switched off. There is also nothing for a metadata read
 * to replace them with: the runtime pins the fill ceiling in a `pov_budgets` **test function**,
 * not a `#[pallet::constant]`, so it reaches no metadata surface a client could read — which
 * makes 10 §8.3's *release constant* classification the right precedent, the same one this
 * repository already applies to the provider health thresholds and to §9.2's storage caps. The
 * deferral is therefore a classification, not a gap, and it is covered by no gate: what binds it
 * to the chain is this comment and the §9.1 quotation above it.
 */
export const TRADED_FILLS_PER_BLOCK_CEILING = 93;

/**
 * 02 §9's block time, as §9.1's own arithmetic uses it (14,400 blocks/day at 6 s).
 *
 * Classified with `TRADED_FILLS_PER_BLOCK_CEILING` above — see that note for why
 * `check:chain-literals` cannot see either of them.
 */
const BLOCK_SECONDS = 6;

/** One fill as the tape reports it — never stored, so it carries its block rather than a key. */
export interface TapeFill {
  readonly blockNumber: number;
  readonly bookId: string;
  /** 02 §5's `p_after`, 1e9-grid. */
  readonly price1e9: bigint;
  /** Position in the block's event list, so two fills in one block keep chain order. */
  readonly eventIndex: number;
}

export interface TradeTapeBound {
  /** The most rows a window may materialise — the events share divided by the row size. */
  readonly maxRows: number;
  /** The widest window, in blocks, that cannot exceed `maxRows` at §9.1's fill ceiling. */
  readonly maxBlocks: number;
}

/**
 * A contiguous run of block numbers, in this module's own words.
 *
 * Not `Hole` and not `CoverageRange`: those are §6.3's layer-3 vocabulary, and whether §6.3 binds
 * this read at all is SQ-900. A span here is a statement about **what the stream delivered**, with
 * no claim that anything was ingested, stored or verified.
 */
export interface TapeSpan {
  readonly fromBlock: number;
  readonly toBlock: number;
}

/**
 * The tape's answer: the fills, and the blocks the stream actually delivered.
 *
 * `missing` is derived from `observed` and the window rather than supplied, for the reason
 * `CoverageRef.holes` is derived: a stored or caller-supplied gap list drifts from the thing it
 * describes, and the drift is invisible in the one direction that matters — a gap that quietly
 * disappears turns a partial answer back into a complete-looking one.
 */
export interface TradeTapeRead {
  readonly fills: readonly TapeFill[];
  /** The blocks inside the window at least one scan carried, merged into contiguous runs. */
  readonly observed: readonly TapeSpan[];
  /** The blocks inside the window no scan carried. Empty means the window was fully delivered. */
  readonly missing: readonly TapeSpan[];
}

/**
 * The widest chain-wide trade window this platform may read at once.
 *
 * Derived, never chosen: `maxRows` is §9.2's events share over the caller's measured row size,
 * and `maxBlocks` divides that by §9.1's per-block ceiling. `tradeTapeHours` turns the result
 * back into the hours §9.2 publishes, which is what makes the derivation checkable instead of
 * merely stated.
 */
export function tradeTapeBound(budget: StorageBudget, sizes: RowSizes): TradeTapeBound {
  if (!Number.isFinite(sizes.event) || sizes.event <= 0) {
    throw new TradeTapeError(
      `${String(sizes.event)} is not a row size. A zero or absent one makes the window ` +
        'unbounded, which is the one property 10 §9.1 states this read must not have.',
    );
  }
  const maxRows = Math.floor(budget.eventBytes / sizes.event);
  return { maxRows, maxBlocks: Math.floor(maxRows / TRADED_FILLS_PER_BLOCK_CEILING) };
}

/** The bound as §9.2 publishes it — hours of chain time. */
export function tradeTapeHours(bound: TradeTapeBound): number {
  return (bound.maxBlocks * BLOCK_SECONDS) / 3_600;
}

/**
 * Read the chain-wide trade tape over a bounded window of scans.
 *
 * Takes the **scan stream**, not the database, and that is the specification rather than an
 * implementation choice: §9.1 forbids retaining these rows, so there is no table to read and a
 * function that offered one would be the retained tape under another name.
 *
 * Refuses before reading anything when the window is wider than the bound admits, and refuses
 * again if the scans deliver more fills than the bound allows — the first covers a caller asking
 * too much, the second a chain busier than §9.1's ceiling models, and only the second can be
 * discovered part-way. Both throw rather than truncating: a clipped tape reports a quiet market.
 *
 * Scans outside the window are skipped rather than refused, because the caller drives one
 * subscription for the whole ingest loop and cannot be asked to run a second for this. A block
 * *inside* the window that no scan delivered is skipped by the same statement and is a different
 * event entirely, so the answer names the blocks it saw — see the module note and SQ-900.
 */
export async function readTradeTape(
  scans: AsyncIterable<FinalizedBlockScan> | Iterable<FinalizedBlockScan>,
  window: { readonly fromBlock: number; readonly toBlock: number },
  bound: TradeTapeBound,
): Promise<TradeTapeRead> {
  const { fromBlock, toBlock } = window;
  if (!Number.isInteger(fromBlock) || !Number.isInteger(toBlock) || fromBlock < 0) {
    throw new TradeTapeError(`${fromBlock}..${toBlock} is not a block window`);
  }
  if (toBlock < fromBlock) {
    // An inverted window reads as *no fills*, which on a trade tape is *the market was quiet* —
    // the same silent inversion `holesIn` refuses for coverage spans.
    throw new TradeTapeError(`window ${fromBlock}..${toBlock} runs backwards`);
  }
  const blocks = toBlock - fromBlock + 1;
  if (blocks > bound.maxBlocks) {
    throw new TradeTapeError(
      `window ${fromBlock}..${toBlock} is ${blocks} blocks, past the ${bound.maxBlocks} this ` +
        'platform admits. 10 §9.1 makes the chain-wide trade tape a bounded windowed read: at ' +
        `§9.1's ceiling of ${TRADED_FILLS_PER_BLOCK_CEILING} fills per block that window could ` +
        `carry ${blocks * TRADED_FILLS_PER_BLOCK_CEILING} rows against a bound of ` +
        `${bound.maxRows}. Ask a narrower question — a truncated tape reports a quiet market.`,
    );
  }
  const fills: TapeFill[] = [];
  // Every in-window block the stream carried. A set rather than a running cursor, because scans
  // are not guaranteed ordered and a duplicate delivery must not read as two blocks.
  const seen = new Set<number>();
  for await (const scan of scans as AsyncIterable<FinalizedBlockScan>) {
    if (scan.number < fromBlock || scan.number > toBlock) continue;
    seen.add(scan.number);
    for (const fill of tradedFills(scan)) {
      fills.push({ blockNumber: scan.number, ...fill });
      if (fills.length > bound.maxRows) {
        throw new TradeTapeError(
          `the window ${fromBlock}..${toBlock} delivered more than ${bound.maxRows} fills, past ` +
            'what this platform admits in memory. 10 §9.1 sizes the bound at its own per-block ' +
            'ceiling, so this means the chain exceeded it — the window is refused rather than ' +
            'clipped, because a clipped tape is a wrong answer and not a smaller one.',
        );
      }
    }
  }
  const observed = mergeBlocks(seen);
  return { fills, observed, missing: gapsIn(observed, { fromBlock, toBlock }) };
}

/** The block numbers seen, as contiguous runs. Sorted numerically — never by string order. */
function mergeBlocks(seen: ReadonlySet<number>): readonly TapeSpan[] {
  const ordered = [...seen].sort((a, b) => a - b);
  const spans: TapeSpan[] = [];
  for (const block of ordered) {
    const last = spans[spans.length - 1];
    if (last !== undefined && block === last.toBlock + 1) {
      spans[spans.length - 1] = { fromBlock: last.fromBlock, toBlock: block };
      continue;
    }
    spans.push({ fromBlock: block, toBlock: block });
  }
  return spans;
}

/**
 * The window minus what was observed, **including the edges**.
 *
 * The edge case is the one that matters and the one an interior-gaps-only version drops: a stream
 * that starts late or stops early leaves the window's ends undelivered, and those are precisely
 * the blocks a caller asking about `100..200` would otherwise believe were quiet. Same reasoning
 * as `holesIn`'s span-bounded form, reached independently because these are not coverage holes.
 */
function gapsIn(observed: readonly TapeSpan[], window: TapeSpan): readonly TapeSpan[] {
  const gaps: TapeSpan[] = [];
  let cursor = window.fromBlock;
  for (const span of observed) {
    if (span.fromBlock > cursor) gaps.push({ fromBlock: cursor, toBlock: span.fromBlock - 1 });
    cursor = Math.max(cursor, span.toBlock + 1);
  }
  if (cursor <= window.toBlock) gaps.push({ fromBlock: cursor, toBlock: window.toBlock });
  return gaps;
}
