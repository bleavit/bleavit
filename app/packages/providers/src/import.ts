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
 *  1. **bytes, per chunk** — refused at the chunk that crosses the line, before that chunk is
 *     retained. A refusal at 400 MB costs 400 MB; a refusal after reading costs the file.
 *  2. **screens, over the assembled bytes** — §8.2's canonical form is a property of the file,
 *     so the text has to exist to be compared. It exists inside the quota, which is the point.
 *  3. **rows** — countable only once the document parses, and checked before anything is
 *     previewed. 400 MB in 100 rows and 4 M rows in 10 MB are each inside one bound and outside
 *     the other, and the second is an unusable local database rather than a dead tab.
 *  4. **spot re-derivation**, then **eviction preview**, then the mint. The preview is last
 *     before the write and asks a question the user can only answer while they still hold both
 *     sides of it; a rejected snapshot has by then cost them nothing, which is exactly what
 *     `FE-PROV-003`'s recovery promises.
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
  EMPTY_QUOTA,
  EVICTION_DECLINED,
  admitChunk,
  planImport,
  previewCopy,
  type ImportPlan,
  type LocalFootprint,
  type QuotaState,
} from './import-quota.js';
import { mintSnapshotRows, type MintedImport } from './mint.js';
import type { ProviderRefusal } from './refusals.js';
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
  readonly providerId: string;
  readonly admission: SnapshotAdmission;
  readonly sha256: Sha256;
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
  /** A screen fired, or the chain disagreed. `FE-PROV-003` with the cause-specific remedy. */
  | {
      readonly kind: 'rejected';
      readonly refusal: ProviderRefusal;
      readonly findings: readonly SnapshotFinding[];
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
 */
export async function importSnapshotStream(
  chunks: AsyncIterable<SnapshotChunk>,
  request: ImportRequest,
  deps: ImportDependencies,
): Promise<ImportOutcome> {
  let quota: QuotaState = EMPTY_QUOTA;
  const parts: string[] = [];
  for await (const chunk of chunks) {
    const verdict = admitChunk(quota, chunk.bytes, 0);
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

  const verdict = admitSnapshot(text, request.admission, request.sha256);
  if (verdict.kind === 'rejected') {
    return { kind: 'rejected', refusal: verdict.refusal, findings: verdict.findings };
  }
  const document = verdict.document;

  // Rows, now that there are rows to count. Every array in the document is a row somewhere in
  // the local store, so the count is the document's own size rather than one chosen member of
  // it — counting only `ops` would let a publisher spend the whole bound on `balances`.
  const rows =
    document.ops.length +
    document.balances.length +
    document.vaults.length +
    document.coverage.length;
  const rowVerdict = admitChunk(quota, 0, rows);
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
    return { kind: 'rejected', refusal: rejection.refusal, findings: rejection.findings };
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
    minted: mintSnapshotRows(verdict, {
      providerId: request.providerId,
      pin: request.admission.expectedPin,
      importedAt: request.importedAt,
      spotCheck,
    }),
    plan,
    quota,
    spotCheck,
  };
}
