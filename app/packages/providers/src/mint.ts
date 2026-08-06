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
 * 1. **The arguments are branded, and each brand certifies the check it names.** The snapshot arm
 *    takes an `AdmittedSnapshot` (the synchronous file screens) *and* a `SpotCheckReport` (§8.4's
 *    chain comparison), and the indexer arm takes a `SampledRound` (§8.4's sampling round). Every
 *    one of those phantom fields is private to the module that runs the check, so a caller holding
 *    a plausible object literal cannot reach either function.
 * 2. **`origin` and `providerId` are written here and are not parameters of the row.** The row
 *    type has no way to express a different origin, so there is no call site that could set one.
 *    `origin: 'snapshot'` is a fact about *how the data arrived*, and a fact about arrival is
 *    known exactly once — at arrival.
 *
 * ## `sampled` is a fact, not an intention — and the brand is what makes it one
 *
 * `VerificationStatus`'s `sampled` boolean is the difference between *"a source we spot-check"*
 * and *"this row's history was compared against the chain"*. Until 2026-08-06 the mint took a
 * plain `{ compared, outOfReach, findings }` object, so **any caller could write `compared: 1`**
 * and mint rows badged as compared having compared nothing — and it ignored `findings`
 * altogether, so a report that had *caught the document contradicting the chain* minted exactly
 * the same status as a clean one. Both halves are closed here: the report is unforgeable, it must
 * name the very document being minted, and a report carrying findings is refused outright.
 *
 * The indexer arm was the same defect with a second face: it took the **snapshot** arm's report
 * type, which §8.4 does not give indexers at all — that section gives snapshots *screens* and
 * indexers *sampling*, and the two produce different evidence. It now takes a `SampledRound`,
 * which only `runSamplingRound` can produce.
 *
 * ## Nothing here writes to storage, and that is deliberate
 *
 * The mint returns rows; it does not open a database. `packages/providers` has no Dexie
 * dependency and gains none — 10 §10.1 puts the store in `local-index`, and a provider package
 * able to write would be a provider package able to write into a table it was not given. The
 * row shapes below mirror 10 §7's `snapshotsImported` columns exactly; the consumer that owns
 * the database performs the write.
 *
 * That is also why `CoverageRange` arrives as a **type-only** import from `@bleavit/local-index`.
 * The range shape is §6.3's and must have one declaration — a local copy of it here dropped
 * `ingestedAt`, which is required there, so every minted range was one field short of the thing
 * it claimed to be. Importing the type costs nothing at runtime (it erases), while importing that
 * package's `providerRange` **value** would pull its barrel — and Dexie behind it — into this
 * package's graph, which is precisely the property the paragraph above is claiming. The `self`
 * arm of that union stays unreachable from here either way: its brand is a symbol this package
 * cannot name (`no-range-minting-outside-ingest` guards the other half).
 */

import type { CoverageRange } from '@bleavit/local-index';
import type { Verified, VerificationStatus } from '@bleavit/shared-types';

import type { SampledRound } from './sampling.js';
import type { AdmittedSnapshot, SnapshotBalance, SnapshotRange, SpotCheckReport } from './snapshot.js';

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

/** What a provider contributes to layer 3: labelled rows and the ranges they cover. */
export interface MintedRows {
  /**
   * §6.3's own range type, minted with this source's origin and never merged with a `self` one.
   */
  readonly coverage: readonly CoverageRange[];
  /**
   * Every balance, each already carrying its status. `Verified<T>` rather than a bare row
   * because INV-FE-9 admits no unlabeled rendering path, and a row that acquires its badge on
   * the way to the screen is a row that can arrive without one.
   */
  readonly balances: readonly Verified<ProviderBalanceRow>[];
  /** The status every row above carries. Exposed so a caller can badge a derived total too. */
  readonly status: VerificationStatus;
}

/**
 * A snapshot import: {@link MintedRows} plus the §7 record that a *file* was imported.
 *
 * The record is on this arm alone. A live indexer serves pages and pins nothing, so there is no
 * content hash to key a `snapshotsImported` row by — the previous shape minted one anyway, with
 * whatever string the call site passed as its primary key, which is a row in the imported-files
 * table describing no file.
 */
export interface MintedImport extends MintedRows {
  readonly record: SnapshotImportRow;
}

/** What the caller supplies for a snapshot mint. The evidence arrives separately, branded. */
export interface SnapshotMintRequest {
  /** The provider this document came from. Its id ends up on every row. */
  readonly providerId: string;
  /** The content pin `admitSnapshot` matched. It is the import's identity. */
  readonly pin: string;
  /** Device clock. Only ever displayed as *when you imported this*, never as a chain time. */
  readonly importedAt: number;
}

/** What the caller supplies for an indexer mint. No pin: there is no file. */
export interface IndexerMintRequest {
  readonly providerId: string;
  readonly importedAt: number;
}

/**
 * Turn an admitted, spot-checked snapshot into layer-3 rows.
 *
 * The **only** function in this package that produces a `provider`-status value from a document,
 * and the only one that produces a `snapshotsImported` record. Both facts are load-bearing:
 * INV-FE-15's *"origin to the pixel"* is a promise about every row, and a promise about every row
 * can only be kept at a place every row goes through.
 *
 * It takes the {@link SpotCheckReport} as a separate branded argument rather than as a field of
 * the request, because a field is something a caller fills in. Three conditions are enforced and
 * each closes a way to mint a badge nobody earned:
 *
 * 1. the report must have come from {@link spotCheckSnapshot} (the brand);
 * 2. it must be **this** document's report, compared by reference against the admitted document,
 *    so a caller holding two files cannot spot-check the honest one and mint the forged one;
 * 3. it must carry **no findings** — a report that caught a disagreement is evidence the document
 *    is forged, and minting from it writes exactly the rows the check refused.
 */
export function mintSnapshotRows(
  admitted: AdmittedSnapshot,
  spotCheck: SpotCheckReport,
  request: SnapshotMintRequest,
): MintedImport {
  if (spotCheck.document !== admitted.document) {
    throw new RangeError(
      'this spot-check report was produced for a different document. The chain comparison and ' +
        'the file it certifies must be the same object, or the badge on the minted rows ' +
        'describes a check that ran over something else',
    );
  }
  if (spotCheck.findings.length > 0) {
    throw new RangeError(
      `this spot-check report carries ${spotCheck.findings.length} finding(s): the document ` +
        'contradicts what this device read from the chain. A document with findings is refused ' +
        '(FE-PROV-003) and never minted',
    );
  }
  const rows = mint('snapshot', admitted.document.balances, admitted.document.coverage, request, {
    // Compared blocks only, and only from a pass that **finished**. `out-of-reach` is §8.4's
    // blind spot rather than a check that passed, and a `ceiling` pass stopped before the
    // mandated set was exhausted — it may have compared hundreds of blocks and still cannot say
    // it ran the check §8.4 requires. `window-floor` and `whole-document` can: there the mandated
    // set is genuinely finished, vacuously in the first case. Understating is the safe direction
    // — a row that says it was not compared costs a badge, and one that says it was buys a claim
    // nothing backs. This is what keeps the ceiling's new *admission* honest (SQ-811).
    sampled: spotCheck.reach !== 'ceiling' && spotCheck.compared > 0,
  });
  const fromBlock = admitted.document.coverage.reduce(
    (lowest, range) => Math.min(lowest, range.fromBlock),
    Number.POSITIVE_INFINITY,
  );
  const toBlock = admitted.document.coverage.reduce(
    (highest, range) => Math.max(highest, range.toBlock),
    -1,
  );
  return {
    ...rows,
    record: {
      id: request.pin,
      providerId: request.providerId,
      importedAt: request.importedAt,
      // An import covering nothing records `0..0` rather than an infinity: a range is a fact
      // about what was stored, and a document with no coverage stored no blocks.
      fromBlock: Number.isFinite(fromBlock) ? fromBlock : 0,
      toBlock: toBlock >= 0 ? toBlock : 0,
    },
  };
}

/**
 * The same mint for a live indexer's rows (§8.2's second kind).
 *
 * It takes balances and coverage directly rather than a branded document because an indexer
 * serves pages rather than a pinned file — there is nothing to admit, which is exactly why
 * §8.4 gives indexers *sampling* where it gives snapshots *screens*. What it must not differ in
 * is the labelling, so it is this function and not another one.
 *
 * The evidence is a {@link SampledRound}, which only `runSamplingRound` produces, and a round
 * whose outcome is `mismatch` is **refused**: that round disabled the provider (§8.3's
 * auto-disable, `FE-PROV-002`), and storing the rows a source served in the same breath as
 * catching it lying is the one thing the ladder exists to prevent. `sampled` is true only when
 * the round actually compared something — an `inconclusive` round mints rows that say so.
 */
export function mintIndexerRows(
  balances: readonly SnapshotBalance[],
  coverage: readonly SnapshotRange[],
  round: SampledRound,
  request: IndexerMintRequest,
): MintedRows {
  if (round.outcome === 'mismatch') {
    throw new RangeError(
      `provider ${round.provider.id} was disabled by this sampling round for contradicting the ` +
        'chain (FE-PROV-002). Its rows are not minted: a source caught serving one wrong value ' +
        'is not a source whose other values are worth storing',
    );
  }
  const compared = round.result.rowsChecked - round.result.unverifiable;
  return mint('indexer', balances, coverage, request, { sampled: compared > 0 });
}

function mint(
  origin: ProviderOrigin,
  balances: readonly SnapshotBalance[],
  coverage: readonly SnapshotRange[],
  request: SnapshotMintRequest | IndexerMintRequest,
  evidence: { readonly sampled: boolean },
): MintedRows {
  if (request.providerId.length === 0) {
    // A row whose `providerId` is empty is a row that renders as *from a provider* and cannot
    // say which, which is the half of "origin to the pixel" that actually helps a user decide
    // whether to trust it. Refused rather than defaulted: there is no honest placeholder.
    //
    // This is a caller defect rather than a user-facing refusal — a provider with no id was
    // never in the enabled list — so it is not one of §10.4's `FE-PROV-*` codes. What §10.4
    // forbids is free text reaching a user, and `importSnapshotStream` makes that impossible by
    // checking the same condition before it reads the first chunk, let alone asks the user
    // anything.
    throw new RangeError(
      'a provider row must name its provider; INV-FE-15 requires the origin to the pixel, and ' +
        '"some provider" is not an origin a user can act on',
    );
  }
  const status: VerificationStatus = {
    kind: 'provider',
    providerId: request.providerId,
    sampled: evidence.sampled,
  };
  return {
    coverage: coverage.map((range) => ({
      origin,
      providerId: request.providerId,
      fromBlock: range.fromBlock,
      toBlock: range.toBlock,
      // §6.3 requires it, and it is the device clock for the same reason `importedAt` is: the
      // one honest thing this client knows about when a row arrived locally.
      ingestedAt: request.importedAt,
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
