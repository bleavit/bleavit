/**
 * The live sampling loop and the §8.3 health ladder — 10 §8.3/§8.4. F9.
 *
 * > **Live indexers:** 1-in-16-page row re-verification against live chain state where the
 * > referenced object still exists, or against the self-ingested overlap window.
 *
 * ## Nothing here reads a chain, and that is structural
 *
 * The comparison is an injected {@link RowCheck}. `packages/providers` may not import the
 * chain SDK (10 §4.1, enforced by `only-chain-client-opens-a-chain-connection`), and it must
 * not be able to *produce* a verified value either — so the module that decides **which** rows
 * to re-verify is deliberately separate from the one that knows **how**. What is left here is
 * selection, tallying and the ladder, which is where the failures that no unit test of a pure
 * comparison would see actually live.
 *
 * ## The sample must be drawn from something the provider does not control
 *
 * This is the load-bearing property, and it is easy to lose while writing correct-looking code.
 * If the sampled index is a function of anything the provider serves — page position, row id,
 * a hash of the page for "deterministic, reproducible sampling" — then the provider knows
 * exactly which rows will be checked and serves honest data at precisely those positions, at a
 * cost of one row per 16 pages. Sampling then verifies the rows that were built to pass it.
 *
 * So {@link selectSample} takes `random: () => number` — a function of **no argument**, which
 * is the same device `defaultProviders()` and `defaultScope()` use, and here it is what makes
 * "seeded from the data" unwritable rather than merely discouraged: there is nothing to seed
 * it with.
 *
 * ## Stratified, not uniform
 *
 * *"1 row per 16 pages"* is read as **one row from each window of 16 pages**, not as N draws
 * over the whole set. The two have the same expected count and different adversarial
 * properties: under uniform draws a forger who clusters every forgery into one region is
 * unsampled there with probability that grows with the dataset, while stratification
 * guarantees every 16-page window contributes a row. The rate is a floor on effort, so the
 * count rounds **up** — rounding down would let any import below 16 pages verify nothing at
 * all and report a clean round, which is the "passes by shrinking" shape.
 *
 * ## What this catches is bounded, and 14 TH-49 says so plainly
 *
 * > sampling (~1 row per 16 pages) quantitatively verifies almost nothing at depth and misses
 * > self-consistent forgeries
 *
 * That sparseness is *why* provider chart manipulation is a declared accepted residual. This
 * module is a liveness and shallow-inconsistency detector; it is not, and must not be
 * presented as, a proof of anything the provider served.
 */

import { effectiveCoverage, shouldAutoDisable, type Provider, type SampleResult } from './health.js';
import { providerRefusal, type ProviderRefusal } from './refusals.js';

// ------------------------------------------------------------------ release constants

/**
 * §8.3's ladder thresholds and probe interval.
 *
 * **Release constants, not chain constants** (10 §8.3): a governance vote does not change how
 * fast a third-party HTTP endpoint answers, and there is no chain surface to read them from,
 * so 10 §5.4's no-literal rule does not reach them. They are a value here for the same reason
 * the import quotas are — and they are named, so a caller can pass a different set rather than
 * a call site inventing one.
 */
export interface LadderThresholds {
  /** Above this, a *response* is `slow`. Slow never disables on its own (§8.3). */
  readonly slowAboveMs: number;
  /** Consecutive failures at which the provider auto-disables (`FE-PROV-001`). */
  readonly disableAfter: number;
  /** §8.3: "on enable + every 10 min". */
  readonly probeEveryMs: number;
}

export const LADDER: LadderThresholds = Object.freeze({
  slowAboveMs: 2_000,
  disableAfter: 3,
  probeEveryMs: 10 * 60 * 1_000,
});

/** 10 §8.4 / 14 TH-49's rate: one sampled row per this many pages. */
export const PAGES_PER_SAMPLED_ROW = 16;

// ------------------------------------------------------------------ the health ladder

export type ProbeOutcome =
  | { readonly kind: 'responded'; readonly latencyMs: number }
  | { readonly kind: 'failed'; readonly why: string };

/**
 * Whether a provider is due a health probe.
 *
 * `lastProbeMs === null` means **never probed**, which is due *now* — that is §8.3's "on
 * enable" half, and writing the predicate as `now - last >= interval` over a `last` initialised
 * to the enable time silently drops it: the provider is first probed ten minutes after the user
 * turned it on, having served reads for the whole window on no evidence at all.
 *
 * A clock that moved **backwards** also reads as due. `now - last` goes negative after a system
 * time adjustment or a DST-adjacent correction, and a provider would then never be probed
 * again — a scheduler that silently stops is worse than one that probes twice.
 */
export function probeDue(
  lastProbeMs: number | null,
  nowMs: number,
  thresholds: LadderThresholds = LADDER,
): boolean {
  if (lastProbeMs === null) return true;
  if (nowMs < lastProbeMs) return true;
  return nowMs - lastProbeMs >= thresholds.probeEveryMs;
}

/**
 * Advance §8.3's ladder from one probe.
 *
 * Three rules, and each is a case the obvious implementation — a pure function of the latest
 * outcome — gets wrong:
 *
 * 1. **`disabled` is terminal, in both of its arms.** A healthy probe does not resurrect a
 *    provider the user switched off, and it does not resurrect one that auto-disabled either:
 *    §8.4 makes re-enabling "an explicit user action", because the source that failed a
 *    sampling round is exactly the source whose next probe will succeed.
 * 2. **`Failing` counts *consecutive* failures**, so a success resets it. A cumulative counter
 *    ratchets, and every provider disables eventually given enough uptime — an auto-disable
 *    whose real cause is age reads to the user as a source that broke.
 * 3. **`Slow` never disables on its own.** A slow provider is an honest one, and converting a
 *    network condition into a missing-data incident is the failure §8.3 names. A slow
 *    *response* is a response, so it resets the failure count too.
 */
export function afterProbe(
  provider: Provider,
  outcome: ProbeOutcome,
  thresholds: LadderThresholds = LADDER,
): Provider {
  if (provider.health.kind === 'disabled') return provider;
  if (outcome.kind === 'responded') {
    return {
      ...provider,
      health:
        outcome.latencyMs > thresholds.slowAboveMs
          ? { kind: 'slow', observedMs: outcome.latencyMs }
          : { kind: 'healthy' },
    };
  }
  const consecutive =
    (provider.health.kind === 'failing' ? provider.health.consecutiveFailures : 0) + 1;
  if (consecutive >= thresholds.disableAfter) {
    return {
      ...provider,
      health: {
        kind: 'disabled',
        by: 'auto',
        reason:
          `This source failed to respond ${consecutive} times in a row (${outcome.why}). It is ` +
          'switched off; the app falls back to what it can read for itself. Nothing you were ' +
          'shown depended on it.',
      },
    };
  }
  return { ...provider, health: { kind: 'failing', consecutiveFailures: consecutive } };
}

/** `FE-PROV-001` for a provider the ladder just auto-disabled. */
export function livenessRefusal(provider: Provider): ProviderRefusal | undefined {
  if (provider.health.kind !== 'disabled' || provider.health.by !== 'auto') return undefined;
  return providerRefusal('FE-PROV-001', provider.health.reason);
}

// ------------------------------------------------------------------ selection

/** One row as the provider served it. */
export interface ProviderRow {
  /**
   * What the checker will re-read — opaque here on purpose. Its shape is the provider
   * protocol's business, and a module that understood it would be a module that could
   * construct one.
   */
  readonly reference: string;
  /** What the provider claims, canonically rendered so a comparison is a string equality. */
  readonly claimed: string;
}

export interface ProviderPage {
  readonly rows: readonly ProviderRow[];
}

export interface SampledRow {
  /** Which window of {@link PAGES_PER_SAMPLED_ROW} pages this row represents. */
  readonly stratum: number;
  readonly page: number;
  readonly index: number;
  readonly row: ProviderRow;
}

export interface SampleSelection {
  readonly rows: readonly SampledRow[];
  /** How many windows the served pages formed. */
  readonly strata: number;
  /**
   * Windows that yielded no row because every page in them was empty. Reported rather than
   * dropped: a provider that answers with empty pages has served nothing to check, and a
   * selection that just returned fewer rows would make that indistinguishable from a small
   * dataset.
   */
  readonly emptyStrata: number;
}

/**
 * Draw the sample.
 *
 * `random` is `() => number` in `[0, 1)` and takes **no argument** — see the module note; that
 * signature is the control, because a selection seeded from the pages is one the provider
 * chooses. An out-of-range value from a hostile or broken source is clamped rather than
 * producing an `undefined` row, which would surface as a crash in the loop that is supposed to
 * be watching the provider.
 */
export function selectSample(
  pages: readonly ProviderPage[],
  random: () => number,
  pagesPerRow: number = PAGES_PER_SAMPLED_ROW,
): SampleSelection {
  if (!Number.isInteger(pagesPerRow) || pagesPerRow < 1) {
    throw new RangeError(`pagesPerRow must be a positive integer, got ${pagesPerRow}`);
  }
  const strata = Math.ceil(pages.length / pagesPerRow);
  const rows: SampledRow[] = [];
  let emptyStrata = 0;
  for (let stratum = 0; stratum < strata; stratum += 1) {
    const first = stratum * pagesPerRow;
    const last = Math.min(first + pagesPerRow, pages.length);
    // Flatten the window and draw one row from it, so a window whose rows are unevenly spread
    // across its pages is still sampled uniformly by row rather than by page.
    const candidates: SampledRow[] = [];
    for (let page = first; page < last; page += 1) {
      const served = pages[page];
      if (served === undefined) continue;
      for (const [index, row] of served.rows.entries()) {
        candidates.push({ stratum, page, index, row });
      }
    }
    if (candidates.length === 0) {
      emptyStrata += 1;
      continue;
    }
    const draw = Math.floor(random() * candidates.length);
    const picked = candidates[Math.max(0, Math.min(candidates.length - 1, draw))];
    if (picked !== undefined) rows.push(picked);
  }
  return { rows, strata, emptyStrata };
}

// ------------------------------------------------------------------ the round

/** Why a row could not be compared. None of these is evidence about the provider. */
export type UnverifiableReason =
  /** §8.4's own condition: the referenced object no longer exists on chain. */
  | 'object-gone'
  /** Depth the light client cannot reach and the self-ingested window does not cover. */
  | 'beyond-reach'
  /** The comparison itself failed — a read error, a malformed reference. */
  | 'check-failed';

export type RowVerdict =
  | { readonly kind: 'match' }
  | { readonly kind: 'mismatch'; readonly expected: string }
  | { readonly kind: 'unverifiable'; readonly why: UnverifiableReason };

/**
 * Re-derive one row from chain state or the self-ingested overlap window.
 *
 * Injected. It may reject with anything; {@link runSamplingRound} converts a thrown error into
 * `unverifiable` rather than letting it abort the round — see that function's note, because the
 * reason is adversarial rather than defensive.
 */
export type RowCheck = (row: SampledRow) => Promise<RowVerdict>;

export interface RowMismatch {
  readonly row: SampledRow;
  readonly expected: string;
}

export interface SamplingRound {
  /** The provider after the round; auto-disabled on any mismatch. */
  readonly provider: Provider;
  /**
   * `clean` — something was compared and all of it matched.
   * `mismatch` — at least one row disagreed; the provider is disabled (`FE-PROV-002`).
   * `inconclusive` — **nothing was comparable**, which is not a pass. Kept as its own outcome
   * rather than folded into `clean`, because a round that verified nothing and a round that
   * verified everything are the two facts a caller most needs to tell apart.
   */
  readonly outcome: 'clean' | 'mismatch' | 'inconclusive';
  readonly result: SampleResult;
  readonly selection: SampleSelection;
  readonly mismatches: readonly RowMismatch[];
  readonly refusal: ProviderRefusal | undefined;
}

export class ProviderDisabledError extends Error {
  constructor(id: string) {
    super(
      `provider ${id} is disabled, so it is serving no reads and there is nothing to sample. ` +
        'Sampling a disabled source would produce a verdict about data nobody was shown.',
    );
    this.name = 'ProviderDisabledError';
  }
}

/**
 * Run one sampling round over the pages a provider served.
 *
 * **Refuses a disabled provider** rather than sampling it: §8.3 makes `Disabled` the one state
 * that stops reads, so a disabled source served nothing, and a round over it would either
 * overwrite the user's own decision with an automatic one or record a clean verdict about rows
 * no user ever saw.
 *
 * **A check that throws is `unverifiable`, and the round continues.** Aborting looks safer and
 * is not: the reference is provider-supplied, so a publisher who embeds one reference whose
 * re-read reliably errors could make every round throw — discarding the mismatches found
 * earlier in that same round and never being disabled. Recording it as unverifiable keeps the
 * mismatches, and `unverifiable` counts neither way, so nothing is laundered into a pass.
 *
 * The rows are checked **sequentially**. Concurrency would be faster and would make the round's
 * own report non-deterministic under the same inputs, which is the property the forged corpus
 * needs in order to assert anything per class.
 */
export async function runSamplingRound(
  provider: Provider,
  pages: readonly ProviderPage[],
  check: RowCheck,
  random: () => number,
  pagesPerRow: number = PAGES_PER_SAMPLED_ROW,
): Promise<SamplingRound> {
  if (provider.health.kind === 'disabled') throw new ProviderDisabledError(provider.id);
  const selection = selectSample(pages, random, pagesPerRow);
  const mismatches: RowMismatch[] = [];
  let unverifiable = 0;
  for (const row of selection.rows) {
    let verdict: RowVerdict;
    try {
      verdict = await check(row);
    } catch {
      verdict = { kind: 'unverifiable', why: 'check-failed' };
    }
    if (verdict.kind === 'mismatch') mismatches.push({ row, expected: verdict.expected });
    else if (verdict.kind === 'unverifiable') unverifiable += 1;
  }
  const result: SampleResult = {
    rowsChecked: selection.rows.length,
    mismatches: mismatches.length,
    unverifiable,
  };
  if (shouldAutoDisable(result)) {
    const detail = mismatches
      .map(
        (mismatch) =>
          `page ${mismatch.row.page} row ${mismatch.row.index}: the source says ` +
          `${mismatch.row.row.claimed}, this device read ${mismatch.expected}`,
      )
      .join('; ');
    return {
      provider: {
        ...provider,
        health: {
          kind: 'disabled',
          by: 'auto',
          reason:
            `${mismatches.length} of ${result.rowsChecked} spot-checked rows did not match what ` +
            'this device read from the chain. The source is switched off; nothing it supplied ' +
            'was ever treated as verified.',
        },
      },
      outcome: 'mismatch',
      result,
      selection,
      mismatches,
      refusal: providerRefusal('FE-PROV-002', detail),
    };
  }
  const coverage = effectiveCoverage(result);
  return {
    provider,
    outcome: coverage.checked > 0 ? 'clean' : 'inconclusive',
    result,
    selection,
    mismatches: [],
    refusal: undefined,
  };
}
