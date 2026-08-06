/**
 * The snapshot import, as 10 §8.4 describes it — streamed, previewed, then minted. F9.
 *
 * > Import quotas (≤ 400 MB uncompressed, ≤ 4 M rows, **streamed**, **eviction preview before
 * > import**) — unchanged.
 *
 * ## Why this module exists
 *
 * The four controls in that sentence were each implemented and none of them was **wired**:
 * `admitChunk` had no production caller, `planImport` was bound to nothing, and `admitSnapshot`
 * took the whole file as one string — so a 400 MB snapshot was fully resident before the first
 * screen ran, which is the failure the word *streamed* is in the sentence to prevent. A quota
 * checked after the resource is consumed is not a quota; it is a post-mortem.
 *
 * This is the entry point a screen calls. It is the **only** path from a file to layer-3 rows,
 * and it runs the four controls in the one order that makes each of them mean something:
 *
 *  1. **bytes and rows, per chunk** — refused at the chunk that crosses either line, before that
 *     chunk is retained. A refusal at the bound costs the bound; a refusal after reading costs
 *     the file. The row meter is an upper bound (`rowUpperBound`) because an exact count needs a
 *     parsed document, and 400 MB in 100 rows and 4 M rows in 10 MB are each inside one bound and
 *     outside the other — the second is an unusable local database rather than a dead tab.
 *  2. **screens, over the assembled bytes** — §8.2's canonical form is a property of the file,
 *     so the text has to exist to be compared. It exists inside the quota, which is the point.
 *  3. **rows again, exactly** — countable once the document parses, and checked before anything
 *     is previewed, because the streaming meter deliberately over-counts.
 *  4. **spot re-derivation**, then **eviction preview**, then the mint. The preview is last
 *     before the write and asks a question the user can only answer while they still hold both
 *     sides of it; a rejected snapshot has by then cost them nothing, which is exactly what
 *     `FE-PROV-003`'s recovery promises.
 *
 * ## What "streamed" does not yet buy, stated rather than implied
 *
 * The bytes arrive in chunks and are metered in chunks, and then they are **joined**: this
 * module holds the file text, `admitSnapshot` holds the `JSON.parse` tree and the parsed model,
 * and the pin is taken over one more buffer of the file's bytes. Peak working memory is
 * therefore a multiple of the input, and the multiple is unmeasured. Two things follow, both
 * implemented rather than noted: the duplicates this module *can* remove are removed (the chunk
 * array is released at the join, the canonical-form comparison streams against the text it
 * already holds instead of building a second document, and the pin is taken over those same
 * bytes rather than over a re-serialization), and the byte bound is **the caller's**, because
 * only the caller knows the device — §9.4 budgets a mobile tab 350 MB of memory in total and
 * §9.2 caps its whole local store at 75 MB, neither of which 400 MB of input fits inside.
 * Reconciling §8.4's figure with those is 10's to do: PLAN.md · *Spec questions* SQ-632.
 *
 * A genuine streaming admission — an incremental parser, an incremental canonical comparison and
 * an incremental hash — is a different design and is not F9's: `admitSnapshot`'s contract is that
 * it screens **bytes**, and its `Sha256` is a whole-buffer primitive shared with the producer.
 *
 * ## The whole-text form still exists, for the tool
 *
 * `admitSnapshot` keeps its `(text, admission, sha256)` shape and `app/tools/snapshot`'s CLI
 * keeps calling it. A command-line publisher checking a file it just wrote has the file, has no
 * eviction to preview and no store to mint into, and giving it a streaming loop would be
 * ceremony. What it must not do is admit a document by a *different* rule — so it calls the same
 * function this module calls, and this module adds the surrounding controls rather than a second
 * screen set.
 *
 * ## Nothing is written before the last step
 *
 * Every refusal below returns before {@link mintSnapshotRows}, and the mint returns rows rather
 * than performing a write. So *"nothing is imported and nothing local is evicted"* is true by
 * the shape of the function, not by a cleanup path that has to run.
 */

import {
  afterSampling,
  canSupplyPinnedImport,
  type Provider,
  type SampleResult,
} from './health.js';
import {
  EMPTY_QUOTA,
  EVICTION_DECLINED,
  IMPORT_MAX_ROWS,
  IMPORT_MAX_UNCOMPRESSED_BYTES,
  admitChunk,
  planImport,
  previewCopy,
  rowUpperBound,
  type ImportPlan,
  type LocalFootprint,
  type QuotaBounds,
  type QuotaState,
} from './import-quota.js';
import { mintSnapshotRows, type MintedImport } from './mint.js';
import { providerRefusal, type ProviderRefusal } from './refusals.js';
import {
  admitSnapshot,
  rejectSnapshot,
  spotCheckSnapshot,
  type SnapshotAdmission,
  type SnapshotFinding,
  type SnapshotSpotCheck,
  type Sha256,
  type SpotCheckReport,
} from './snapshot.js';

/**
 * One piece of the file, as it arrives.
 *
 * Text rather than bytes because the canonical-form comparison is over characters and the
 * decode has to happen somewhere; doing it at the boundary keeps exactly one decoder in the
 * path. `bytes` is stated separately and is the **encoded** length, because that is the quota
 * 10 §8.4 sets and a UTF-8 character is not one byte.
 */
export interface SnapshotChunk {
  readonly text: string;
  readonly bytes: number;
}

/** What the caller must supply for an import to be able to finish. */
export interface ImportRequest {
  /**
   * The source this file came from, in the state §8.3's ladder has it in.
   *
   * A `Provider` rather than a bare id, because a chain disagreement is a fact about the
   * **source** and not only about the file: §8.4 binds *"any mismatch against chain state"* to
   * auto-disable, and an importer holding only a string has nothing to disable. See
   * {@link importSnapshotStream}.
   */
  readonly provider: Provider;
  readonly admission: SnapshotAdmission;
  readonly sha256: Sha256;
  /**
   * The largest input this device will admit, in bytes. **Required, and capped by §8.4's 400 MB.**
   *
   * No default, for the reason `packages/protocol`'s tunables have none: a compiled-in figure is
   * one that stops tracking the thing it was chosen for, and the thing here is the device. See
   * {@link QuotaBounds}.
   */
  readonly maxInputBytes: number;
  /** §9.2's budget for the local store, in bytes. The preview is computed against it. */
  readonly budgetBytes: number;
  readonly footprint: readonly LocalFootprint[];
  /** Device clock, recorded on the import row. Never rendered as a chain time. */
  readonly importedAt: number;
}

export interface ImportDependencies {
  /**
   * §8.4's spot re-derivation. **Required**, not optional.
   *
   * Same argument as `admitSnapshot`'s required `sha256`: an optional chain comparison is a
   * chain comparison that defaults off, and a check that defaults off is indistinguishable at
   * the call site from one that passed. A caller with no light client available supplies one
   * that answers `out-of-reach`, which is a *stated* absence of evidence and is counted as such.
   * A caller that has one builds it with `chainSpotCheck`.
   */
  readonly spotCheck: SnapshotSpotCheck;
  /**
   * Show the eviction preview and return the user's decision.
   *
   * The ordering control of §8.4, expressed as a required argument. An import that could not
   * ask has no way to reach the mint, so *"preview before import"* is not a step a caller can
   * omit — it is a value they have to provide.
   */
  readonly confirmEviction: (plan: ImportPlan, copy: string) => Promise<boolean>;
}

export type ImportOutcome =
  | {
      readonly kind: 'imported';
      readonly minted: MintedImport;
      readonly plan: ImportPlan;
      readonly quota: QuotaState;
      readonly spotCheck: SpotCheckReport;
    }
  /** A quota was crossed. Carries the meter's own copy — no sentence is composed here. */
  | {
      readonly kind: 'over-quota';
      readonly breach: 'bytes' | 'rows';
      readonly message: string;
      readonly quota: QuotaState;
    }
  /**
   * A screen fired, or the chain disagreed. `FE-PROV-003` with the cause-specific remedy.
   *
   * `provider` is the source **after** the refusal, and it is not always the one that came in:
   * a document this device re-derived and found wrong disables it (§8.3, `FE-PROV-002`). The
   * two refusals are two facts about two subjects — the file was rejected, and the source that
   * served it was switched off — and a client that reported only the first would leave a
   * publisher caught contradicting the chain still serving every other screen.
   */
  | {
      readonly kind: 'rejected';
      readonly refusal: ProviderRefusal;
      readonly findings: readonly SnapshotFinding[];
      readonly provider: Provider;
      /** `FE-PROV-002`, present exactly when this refusal disabled the source. */
      readonly disabled: ProviderRefusal | undefined;
    }
  /**
   * The user declined the eviction, or it could not fit at all. Nothing was touched.
   *
   * It carries fixed copy and **no `FE-PROV-*` code**, because neither case is an error about
   * the snapshot: one is the user's decision and the other is this device's budget. Attaching
   * `FE-PROV-003` would tell somebody their file was rejected when it was not.
   */
  | {
      readonly kind: 'declined';
      readonly why: 'user' | 'does-not-fit';
      readonly plan: ImportPlan;
      readonly message: string;
    };

/**
 * Import a snapshot from a stream of chunks.
 *
 * `chunks` is an `AsyncIterable`, which is what a `ReadableStream` reader, a `File.stream()` and
 * a test array all already are — so the caller's transport is not this module's business, and
 * there is no path where the whole file has to exist before the first quota check runs.
 *
 * ## Three caller defects are refused before the stream is touched
 *
 * A provider with no id, a byte bound above §8.4's ceiling, and a **source this client switched
 * off** are all mistakes in the *call* rather than in the file, so they throw — and they throw
 * **first**, before a chunk is read, before the user is asked anything, and before anything could
 * have been evicted. The empty id used to surface from the mint, which runs *after* the eviction
 * preview: the user was asked to give up local history and then got a bare `RangeError`, which is
 * both the wrong order and the free-text error §10.4 forbids on a user path.
 *
 * The third is new on 2026-08-06 and closes a hole rather than tidying one. §8.3 says only
 * `Disabled` stops reads, and this path asked nothing about health at all: an import from a source
 * auto-disabled for contradicting the chain succeeded and minted rows badged with its id — while
 * `FE-PROV-002`'s fixed recovery was on screen telling the user that source *"has been switched
 * off"*. See {@link canSupplyPinnedImport} for why the test is that predicate and not
 * `canServeReads`: a pinned file the user already holds does not depend on the endpoint having
 * answered a probe, and gating on one nothing in this release drives would refuse every import
 * from a freshly accepted suggestion, forever.
 */
export async function importSnapshotStream(
  chunks: AsyncIterable<SnapshotChunk>,
  request: ImportRequest,
  deps: ImportDependencies,
): Promise<ImportOutcome> {
  if (request.provider.id.length === 0) {
    throw new RangeError(
      'a provider row must name its provider; INV-FE-15 requires the origin to the pixel, and ' +
        '"some provider" is not an origin a user can act on. Refused before the file is read: ' +
        'an import that cannot label its rows must not cost the user an eviction first',
    );
  }
  if (
    !Number.isInteger(request.maxInputBytes) ||
    request.maxInputBytes < 1 ||
    request.maxInputBytes > IMPORT_MAX_UNCOMPRESSED_BYTES
  ) {
    throw new RangeError(
      `maxInputBytes must be a positive integer no larger than 10 §8.4's ceiling of ` +
        `${IMPORT_MAX_UNCOMPRESSED_BYTES}, got ${request.maxInputBytes}. A caller may bound an ` +
        'import further than the specification does and may not loosen it',
    );
  }
  if (!canSupplyPinnedImport(request.provider)) {
    const reason =
      request.provider.health.kind === 'disabled' ? request.provider.health.reason : '';
    throw new RangeError(
      `provider ${request.provider.id} is switched off (${reason}) and 10 §8.3 makes Disabled ` +
        'the state that stops reads. Its rows are not minted while it is off: FE-PROV-002 tells ' +
        'the user the source was switched off and that turning it back on is their explicit act, ' +
        'and importing under its label in the meantime contradicts the sentence they were shown. ' +
        'Refused before the file is read, so a source that cannot supply rows never costs an ' +
        'eviction first',
    );
  }
  const bounds: QuotaBounds = { maxBytes: request.maxInputBytes, maxRows: IMPORT_MAX_ROWS };

  let quota: QuotaState = EMPTY_QUOTA;
  let parts: string[] = [];
  for await (const chunk of chunks) {
    const verdict = admitChunk(quota, chunk.bytes, rowUpperBound(chunk.text), bounds);
    if (verdict.kind === 'refused') {
      // Before `parts.push`, deliberately. Accumulating the chunk that breaks the bound and
      // then reporting it is the post-mortem shape: the memory is already spent.
      return {
        kind: 'over-quota',
        breach: verdict.breach,
        message: verdict.message,
        quota: verdict.state,
      };
    }
    quota = verdict.state;
    parts.push(chunk.text);
  }
  const text = parts.join('');
  // The pieces are now a second copy of the file and nothing reads them again.
  parts = [];

  const verdict = admitSnapshot(text, request.admission, request.sha256);
  if (verdict.kind === 'rejected') {
    return rejected(verdict.refusal, verdict.findings, request.provider);
  }
  const document = verdict.document;

  // Rows, exactly, now that there are rows to count. The streamed meter above over-counts on
  // purpose, so the document is metered again against its real contents. Every array here is a
  // row somewhere in the local store, so the count is the document's own size rather than one
  // chosen member of it — counting only `ops` would let a publisher spend the whole bound on
  // `balances`.
  const rows =
    document.ops.length +
    document.balances.length +
    document.vaults.length +
    document.coverage.length;
  const rowVerdict = admitChunk({ bytes: quota.bytes, rows: 0 }, 0, rows, bounds);
  if (rowVerdict.kind === 'refused') {
    return {
      kind: 'over-quota',
      breach: rowVerdict.breach,
      message: rowVerdict.message,
      quota: rowVerdict.state,
    };
  }
  quota = rowVerdict.state;

  // §8.4's chain comparison, before the user is asked to give anything up for this document.
  const spotCheck = await spotCheckSnapshot(document, deps.spotCheck);
  if (spotCheck.findings.length > 0) {
    const rejection = rejectSnapshot(spotCheck.findings);
    return rejected(rejection.refusal, rejection.findings, request.provider, spotCheck);
  }

  const plan = planImport(quota, request.footprint, request.budgetBytes);
  const copy = previewCopy(plan);
  if (plan.infeasible) {
    // Not shown as a question. There is no decision to make — nothing the user could agree to
    // makes it fit — and a confirm dialog for an impossible action is a dialog that teaches
    // people to click through.
    return { kind: 'declined', why: 'does-not-fit', plan, message: copy };
  }
  const accepted = await deps.confirmEviction(plan, copy);
  if (!accepted) {
    return { kind: 'declined', why: 'user', plan, message: EVICTION_DECLINED };
  }

  return {
    kind: 'imported',
    minted: mintSnapshotRows(verdict, spotCheck, {
      providerId: request.provider.id,
      pin: request.admission.expectedPin,
      importedAt: request.importedAt,
    }),
    plan,
    quota,
    spotCheck,
  };
}

/**
 * Build the `rejected` outcome, and disable the source when the **chain** is what refused it.
 *
 * §8.4 gives `FE-PROV-002` to *"any mismatch against chain state"* and §8.3 makes auto-disable
 * the response to a sampling mismatch. A spot re-derivation is that comparison — the same
 * question the live sampler asks, over blocks instead of rows — so a publisher this device
 * caught contradicting the chain stops serving, through the same {@link afterSampling} the
 * sampler uses rather than beside it.
 *
 * The three other rejection causes leave the provider untouched, and the distinction is the
 * point: a malformed download, a snapshot of another chain, and a check this device could not
 * finish are all statements about *this file* or *this device*. Only a disagreement is evidence
 * about the publisher.
 *
 * Whether §8.4 intends a snapshot refusal to be file-scoped or source-scoped is the one thing
 * its text leaves open — the section rejects the *document* under `FE-PROV-003` and disables the
 * *source* under `FE-PROV-002`, and a spot re-derivation satisfies both descriptions. This is
 * the conservative reading (a source caught lying once stops serving; re-enabling is the user's
 * explicit act), and PLAN.md · *Spec questions* SQ-630 asks 10 §8.4 to say so or narrow it.
 */
function rejected(
  refusal: ProviderRefusal,
  findings: readonly SnapshotFinding[],
  provider: Provider,
  spotCheck?: SpotCheckReport,
): ImportOutcome {
  const disagreements = findings.filter((finding) => finding.screen === 'spot-check');
  if (spotCheck === undefined || disagreements.length === 0) {
    return { kind: 'rejected', refusal, findings, provider, disabled: undefined };
  }
  // `compared` alone is the denominator, because the sentence this builds says *"N of M blocks
  // this device re-derived from the chain do not match"* — and a block the light client could not
  // reach was not re-derived. Counting the out-of-reach ones inflated M, so a document caught
  // lying in its one readable block was reported as *1 of 3* to the user, which reads as an error
  // rate rather than as the whole of what was checked disagreeing. `unverifiable` is therefore 0
  // and not `outOfReach`: those blocks are outside this denominator entirely, and carrying them
  // here would drive `effectiveCoverage`'s `checked` (rowsChecked − unverifiable) negative.
  const result: SampleResult = {
    rowsChecked: spotCheck.compared,
    mismatches: disagreements.length,
    unverifiable: 0,
  };
  return {
    kind: 'rejected',
    refusal,
    findings,
    provider: afterSampling(provider, result, 'rederived-blocks'),
    disabled: providerRefusal(
      'FE-PROV-002',
      disagreements.map((finding) => finding.why).join('; '),
    ),
  };
}
