/**
 * The layer-3 origin mint — 10 §8.2, §6.3, §7; INV-FE-15. F9.
 *
 * > Both write only into layer-3 tables with `origin ∈ {snapshot, indexer}`; both are barred
 * > from the tx path structurally (§10). — 10 §8.2
 *
 * ## The badge had no producer
 *
 * 10 §2.1 declares `{ kind: 'provider', providerId, sampled }` and INV-FE-15 requires *"every
 * provider-derived row carries its origin to the pixel"*. Until 2026-08-06 nothing in this
 * package constructed that status and nothing wrote a `snapshotsImported` row, so the badge
 * existed, the table existed, and the step between an admitted document and a labelled row did
 * not. A screen wired to a provider would have had to build the status itself — at which point
 * `providerId` is whatever the call site had in scope, and `sampled` is whatever it believed.
 *
 * ## So the mint is the only path, and `origin` is fixed here
 *
 * Two things make that structural rather than aspirational:
 *
 * 1. **The argument is branded.** {@link mintSnapshotRows} takes an `AdmittedSnapshot`, whose
 *    phantom field only `snapshot.ts` can write. A caller holding a `SnapshotDocument` — parsed,
 *    plausible, unscreened — cannot reach this function at all.
 * 2. **`origin` and `providerId` are written here and are not parameters of the row.** The row
 *    type has no way to express a different origin, so there is no call site that could set one.
 *    `origin: 'snapshot'` is a fact about *how the data arrived*, and a fact about arrival is
 *    known exactly once — at arrival.
 *
 * ## `sampled` is a fact, not an intention
 *
 * `VerificationStatus`'s `sampled` boolean is the difference between *"a source we spot-check"*
 * and *"this row's history was compared against the chain"*. A mint that set it `true` because
 * sampling is configured would be labelling unverified rows as checked. So it is derived from
 * the {@link SpotCheckReport} the importer actually ran: `true` only when at least one covered
 * block was **compared** — `out-of-reach` blocks are not comparisons, and a pass consisting
 * entirely of them is §8.4's stated blind spot rather than evidence.
 *
 * ## Nothing here writes to storage, and that is deliberate
 *
 * The mint returns rows; it does not open a database. `packages/providers` has no Dexie
 * dependency and gains none — 10 §10.1 puts the store in `local-index`, and a provider package
 * able to write would be a provider package able to write into a table it was not given. The
 * row shapes below mirror 10 §7's `snapshotsImported` columns exactly; the consumer that owns
 * the database performs the write.
 */

import type { Verified, VerificationStatus } from '@bleavit/shared-types';

import type { AdmittedSnapshot, SnapshotBalance, SpotCheckReport } from './snapshot.js';

/**
 * The two origins 10 §8.2 permits a provider to write.
 *
 * `'operator'` and `'self'` are deliberately absent: they are layer-2 and layer-1 origins
 * (§6.2/§6.3) and no provider may mint either. A union of two is not a simplification — it is
 * the restriction, expressed where a call site cannot widen it.
 */
export type ProviderOrigin = 'snapshot' | 'indexer';

/** 10 §7's `snapshotsImported` row. Column names are that table's, not this module's. */
export interface SnapshotImportRow {
  /** The content pin. A snapshot's identity **is** its bytes, so it is its own primary key. */
  readonly id: string;
  readonly providerId: string;
  readonly importedAt: number;
  readonly fromBlock: number;
  readonly toBlock: number;
}

/** A holding from an imported snapshot, carrying the origin it can never lose (§6.3). */
export interface ProviderBalanceRow {
  readonly origin: ProviderOrigin;
  readonly providerId: string;
  readonly vault: string;
  readonly account: string;
  readonly branch: string;
  /** Base units as a decimal string — never a JSON number (V-74). */
  readonly amount: string;
}

/** A covered range as layer 3 records it: origin and provider, never merged with a `self` one. */
export interface ProviderCoverageRow {
  readonly origin: ProviderOrigin;
  readonly providerId: string;
  readonly fromBlock: number;
  readonly toBlock: number;
}

export interface MintedImport {
  readonly record: SnapshotImportRow;
  readonly coverage: readonly ProviderCoverageRow[];
  /**
   * Every balance, each already carrying its status. `Verified<T>` rather than a bare row
   * because INV-FE-9 admits no unlabeled rendering path, and a row that acquires its badge on
   * the way to the screen is a row that can arrive without one.
   */
  readonly balances: readonly Verified<ProviderBalanceRow>[];
  /** The status every row above carries. Exposed so a caller can badge a derived total too. */
  readonly status: VerificationStatus;
}

export interface MintRequest {
  /** The provider this document came from. Its id ends up on every row. */
  readonly providerId: string;
  /** The content pin `admitSnapshot` matched. It is the import's identity. */
  readonly pin: string;
  /** Device clock. Only ever displayed as *when you imported this*, never as a chain time. */
  readonly importedAt: number;
  /** What {@link spotCheckSnapshot} actually managed to compare. See the module note. */
  readonly spotCheck: SpotCheckReport;
}

/**
 * Turn an admitted snapshot into layer-3 rows.
 *
 * The **only** function in this package that produces a `provider`-status value, and the only
 * one that produces a `snapshotsImported` record. Both facts are load-bearing: INV-FE-15's
 * *"origin to the pixel"* is a promise about every row, and a promise about every row can only
 * be kept at a place every row goes through.
 *
 * `origin: 'snapshot'` throughout — this mints from a document. The indexer half of §8.2 mints
 * through {@link mintIndexerRows} below, which differs in exactly that constant and shares
 * everything else, so the two origins cannot drift into two different labelling disciplines.
 */
export function mintSnapshotRows(admitted: AdmittedSnapshot, request: MintRequest): MintedImport {
  return mint('snapshot', admitted.document.balances, admitted.document.coverage, request);
}

/**
 * The same mint for a live indexer's rows (§8.2's second kind).
 *
 * It takes balances and coverage directly rather than a branded document because an indexer
 * serves pages rather than a pinned file — there is nothing to admit, which is exactly why
 * §8.4 gives indexers *sampling* where it gives snapshots *screens*. What it must not differ in
 * is the labelling, so it is this function and not another one.
 */
export function mintIndexerRows(
  balances: readonly SnapshotBalance[],
  coverage: readonly { readonly fromBlock: number; readonly toBlock: number }[],
  request: MintRequest,
): MintedImport {
  return mint('indexer', balances, coverage, request);
}

function mint(
  origin: ProviderOrigin,
  balances: readonly SnapshotBalance[],
  coverage: readonly { readonly fromBlock: number; readonly toBlock: number }[],
  request: MintRequest,
): MintedImport {
  if (request.providerId.length === 0) {
    // A row whose `providerId` is empty is a row that renders as *from a provider* and cannot
    // say which, which is the half of "origin to the pixel" that actually helps a user decide
    // whether to trust it. Refused rather than defaulted: there is no honest placeholder.
    throw new RangeError(
      'a provider row must name its provider; INV-FE-15 requires the origin to the pixel, and ' +
        '"some provider" is not an origin a user can act on',
    );
  }
  const status: VerificationStatus = {
    kind: 'provider',
    providerId: request.providerId,
    // Compared blocks only. `out-of-reach` is §8.4's blind spot, not a check that passed.
    sampled: request.spotCheck.compared > 0,
  };
  const fromBlock = coverage.reduce(
    (lowest, range) => Math.min(lowest, range.fromBlock),
    Number.POSITIVE_INFINITY,
  );
  const toBlock = coverage.reduce((highest, range) => Math.max(highest, range.toBlock), -1);
  return {
    record: {
      id: request.pin,
      providerId: request.providerId,
      importedAt: request.importedAt,
      // An import covering nothing records `0..0` rather than an infinity: a range is a fact
      // about what was stored, and a document with no coverage stored no blocks.
      fromBlock: Number.isFinite(fromBlock) ? fromBlock : 0,
      toBlock: toBlock >= 0 ? toBlock : 0,
    },
    coverage: coverage.map((range) => ({
      origin,
      providerId: request.providerId,
      fromBlock: range.fromBlock,
      toBlock: range.toBlock,
    })),
    balances: balances.map((row) => ({
      value: {
        origin,
        providerId: request.providerId,
        vault: row.vault,
        account: row.account,
        branch: row.branch,
        amount: row.amount,
      },
      status,
    })),
    status,
  };
}
