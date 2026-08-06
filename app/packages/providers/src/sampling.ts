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

import {
  LADDER,
  afterSampling,
  canServeReads,
  effectiveCoverage,
  shouldAutoDisable,
  type LadderThresholds,
  type Provider,
  type SampleResult,
} from './health.js';
import { probeFailureReason, providerRefusal, type ProviderRefusal } from './refusals.js';

// ------------------------------------------------------------------ release constants

/**
 * 10 §8.4 / 14 TH-49's rate: one sampled row per this many pages.
 *
 * Stated **normatively** by §8.4 (*"1-in-16-page row re-verification"*) and depended on by
 * TH-49's residual-risk arithmetic, which is why the production entry points below take no
 * rate argument at all. They took one, with this as its default, and that is a control a
 * caller can switch off by passing a number: at `pagesPerRow = 1e6` every import forms one
 * stratum, one row is compared, and every round still reports `clean`. The loosened form
 * exists — the selection logic has to be testable at other rates — and lives behind
 * `@bleavit/providers/testing`, which production code is forbidden to import.
 */
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
        reason: probeFailureReason(consecutive, outcome.why),
      },
    };
  }
  return { ...provider, health: { kind: 'failing', consecutiveFailures: consecutive } };
}

/**
 * `FE-PROV-001` for a provider the ladder just auto-disabled.
 *
 * ## Only the second of §8.4's two arms emits, and that narrowing is deliberate
 *
 * §8.4's table reads *"A provider fails its §8.3 health probe — **unreachable**, or `Failing`
 * after consecutive errors"*, and this function serves the second arm alone. The first is not
 * forgotten; the two halves of §8 disagree about it and the conservative reading is in force
 * until they are reconciled (PLAN.md · *Spec questions*, SQ-609).
 *
 * The disagreement, stated exactly: §8.3 makes `Failing` count **consecutive** failures
 * precisely so *"one timeout in a healthy series cannot ratchet the ladder"*, and a code that
 * emitted on the first unreachable probe would raise a user-visible refusal for every
 * transient timeout — which is the ratchet in a different costume, and the fastest way to
 * teach somebody to ignore this family. Emitting only at disable leaves the first arm with no
 * call site, which is the finding this note answers rather than hides.
 *
 * What covers the user-visible half meanwhile is `fleetState`: a provider that is merely
 * unreachable is still `failing` and still counted as enabled, and the moment none of them is
 * serving, `all-down` carries this same code with §8.3's incomplete-history explainer. So the
 * situation the first arm describes is reported — as a statement about the fleet, which is
 * what a user can act on, rather than as one alarm per timeout.
 */
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
export function selectSample(pages: readonly ProviderPage[], random: () => number): SampleSelection {
  return selectSampleAtRate(pages, random, PAGES_PER_SAMPLED_ROW);
}

/**
 * {@link selectSample} at a caller-chosen rate. **Not exported from the package barrel.**
 *
 * §8.4 states the 1-in-16 rate normatively and 14 TH-49's residual-risk argument is computed
 * from it, so a production caller does not get to choose: this is reachable only through
 * `@bleavit/providers/testing`, which the `no-loosened-sampling-rate-in-production`
 * dependency-cruiser rule forbids production code from importing — the same shape
 * `@bleavit/local-index/testing` already uses for `selfRange`.
 */
export function selectSampleAtRate(
  pages: readonly ProviderPage[],
  random: () => number,
  pagesPerRow: number,
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

/**
 * What a chain read can answer about one referenced object.
 *
 * Three outcomes, not two, and the third is the one a boolean loses: §8.4 re-verifies *"where
 * the referenced object still exists, or against the self-ingested overlap window"*, so
 * *"absent"* and *"I cannot see that far"* are different facts and only one of them is about the
 * provider. Collapsed into `undefined` they become the same, and a provider serving rows from
 * beyond the pinned window reads as a provider serving rows about objects that were deleted.
 */
export type ChainReadResult =
  | { readonly kind: 'value'; readonly hex: string }
  /** The key has no value at the read block — §8.4's "no longer exists". */
  | { readonly kind: 'absent' }
  /** Outside light-client-reachable depth and outside the self-ingested window. */
  | { readonly kind: 'beyond-reach' };

/** Read one storage key. Injected, because this package may not open a chain connection. */
export type ChainRead = (key: string) => Promise<ChainReadResult>;

/**
 * The adapter: a {@link RowCheck} that re-reads the referenced key and compares.
 *
 * ## Why this exists at all
 *
 * 15 §4.8 makes *"lying indexer ⇒ sampler auto-disable"* a per-PR gate, and until 2026-08-06
 * every test of this loop supplied a synthetic `RowCheck` closure. What that certified is that
 * the ladder behaves **given verdicts** — which is worth having and is not the gated property.
 * The gated property is that a lying indexer *produces* them, and no code turned a served row
 * into a verdict, so nothing in the repository could have been wrong in the way the gate names.
 *
 * ## What a row is, here
 *
 * `ProviderRow.reference` is a storage key and `claimed` is the value the provider says is
 * under it. Both are opaque hex to this module — it never decodes either, and it must not: a
 * comparison that decoded would need the runtime's metadata, which is a chain surface this
 * package cannot reach, and a decoder that guessed would turn an encoding difference into a
 * mismatch and disable an honest source.
 *
 * Hex is compared **case-insensitively**. `0xAB` and `0xab` are one value, and disabling a
 * provider over the case of a nibble would be this loop lying about a lie.
 *
 * ## It never converts a read failure into evidence
 *
 * `beyond-reach` and `absent` are `unverifiable`, which counts neither way (see
 * {@link effectiveCoverage}); a thrown read propagates and {@link runSamplingRound} records it
 * as `check-failed`. Nothing here can produce `match` without an actual comparison, which is the
 * only property that makes a clean round mean anything.
 */
export function chainRowCheck(read: ChainRead): RowCheck {
  return async (row: SampledRow): Promise<RowVerdict> => {
    const result = await read(row.row.reference);
    if (result.kind === 'beyond-reach') return { kind: 'unverifiable', why: 'beyond-reach' };
    if (result.kind === 'absent') return { kind: 'unverifiable', why: 'object-gone' };
    const derived = result.hex.toLowerCase();
    if (row.row.claimed.toLowerCase() === derived) return { kind: 'match' };
    return { kind: 'mismatch', expected: derived };
  };
}

export interface RowMismatch {
  readonly row: SampledRow;
  readonly expected: string;
}

/**
 * The brand that makes *"a sampling round happened"* unassertable.
 *
 * Declared here and **not exported**, the same device `AdmittedSnapshot` and `SpotCheckReport`
 * use, and for the same defect: {@link mintIndexerRows} labels rows `sampled`, and until
 * 2026-08-06 it took a `SpotCheckReport`-shaped object literal — so a caller could mint indexer
 * rows badged *"this row was compared against the chain"* having compared nothing, and the type
 * it was handed belonged to the **snapshot** arm, which §8.4 gives screens rather than sampling.
 * A `SampledRound` can only come from {@link runSamplingRound}.
 */
declare const SAMPLED: unique symbol;

export interface SampledRound {
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
  readonly [SAMPLED]: true;
}

/**
 * A round was asked for over a source that is serving nothing. A caller defect, not user copy.
 *
 * It replaced `ProviderDisabledError` on 2026-08-06, when {@link canServeReads} was wired in here:
 * the refusal now covers `unprobed` as well as `disabled`, and a class whose name says *disabled*
 * would have been a false statement about the more common of the two. The message is built from
 * the state, so the two cases stay distinguishable at a call site.
 *
 * The two reasons, both of which end in a verdict about rows nobody was shown:
 *
 * - **`disabled`** — §8.3's one state that stops reads. Sampling it would either overwrite the
 *   user's own decision with an automatic one, or record a clean verdict about a source that
 *   served nothing.
 * - **`unprobed`** — nothing has answered yet, so the pages handed to this round did not come
 *   from a source this client has established is serving. A caller that *did* fetch them holds
 *   the outcome of that fetch and advances the ladder with {@link afterProbe} first; that is
 *   §8.3's *"probe on enable"* made structural rather than scheduled.
 */
export class ProviderCannotServeError extends Error {
  constructor(provider: Provider) {
    super(
      provider.health.kind === 'disabled'
        ? `provider ${provider.id} is disabled, so it is serving no reads and there is nothing ` +
            'to sample. Sampling a disabled source would produce a verdict about data nobody ' +
            'was shown.'
        : `provider ${provider.id} is ${provider.health.kind}: nothing has answered for it yet, ` +
            'so it is serving no reads and these pages did not come from a source this client ' +
            'has established is live. Advance the ladder with `afterProbe` from the request that ' +
            'fetched them before sampling — a round over an unprobed source is a verdict about ' +
            'data nobody was shown.',
    );
    this.name = 'ProviderCannotServeError';
  }
}

/**
 * Run one sampling round over the pages a provider served.
 *
 * **Refuses a source that is serving nothing** rather than sampling it — {@link canServeReads},
 * which is `disabled` *and* `unprobed`. §8.3 makes `Disabled` the one ladder state that stops
 * reads, so a disabled source served nothing and a round over it would either overwrite the
 * user's own decision with an automatic one or record a clean verdict about rows no user ever saw;
 * an unprobed source has answered nothing at all, so the same is true and more so. Until
 * 2026-08-06 this checked `disabled` inline and `canServeReads` had **no caller anywhere** — the
 * predicate existed, was documented as *"the one predicate a read path calls"*, and no read path
 * called it. See {@link ProviderCannotServeError}.
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
): Promise<SampledRound> {
  return runSamplingRoundAtRate(provider, pages, check, random, PAGES_PER_SAMPLED_ROW);
}

/**
 * {@link runSamplingRound} at a caller-chosen rate. **Not exported from the package barrel** —
 * see {@link selectSampleAtRate} for why the production entry point has no rate argument.
 */
export async function runSamplingRoundAtRate(
  provider: Provider,
  pages: readonly ProviderPage[],
  check: RowCheck,
  random: () => number,
  pagesPerRow: number,
): Promise<SampledRound> {
  if (!canServeReads(provider)) throw new ProviderCannotServeError(provider);
  const selection = selectSampleAtRate(pages, random, pagesPerRow);
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
    const caught: Unbranded = {
      // Through `afterSampling`, not beside it. Both sites built this disabled state
      // independently and each held its own copy of the reason; `refusals.ts` is the one
      // home for the sentence and this is the one home for the transition.
      provider: afterSampling(provider, result),
      outcome: 'mismatch',
      result,
      selection,
      mismatches,
      refusal: providerRefusal('FE-PROV-002', detail),
    };
    return caught as SampledRound;
  }
  const coverage = effectiveCoverage(result);
  const round: Unbranded = {
    provider,
    outcome: coverage.checked > 0 ? 'clean' : 'inconclusive',
    result,
    selection,
    mismatches: [],
    refusal: undefined,
  };
  // The one construction site of the brand. An assertion rather than a literal because the
  // phantom field has no runtime representation and cannot be written — the same shape, and the
  // same single-site discipline, as `admitSnapshot`'s `AdmittedSnapshot`. The local is typed, so
  // the fields are still checked: only the brand is asserted.
  return round as SampledRound;
}

/** The round minus its brand — what the two construction sites below build and assert from. */
type Unbranded = Omit<SampledRound, typeof SAMPLED>;
