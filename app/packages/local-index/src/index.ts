// Three-layer history, gap-tolerant coverage, ingest, backfill (10 §6-§7, INV-FE-7). F8.
//
// `coverage.js` is re-exported by NAME rather than with `export *`, and the omission is the
// point: **`selfRange` is not here.** It mints `origin: 'self'` from three plain numbers, so
// a barrel export handed every consumer — `providers` above all, the one package that
// backfills from unverified sources — the ability to label provider data light-client
// verified, which 10 §6.3/§2.2 give no promotion path for. It lives behind
// `@bleavit/local-index/testing`, which production code may not import.
//
// An `export *` would silently re-admit it the moment anyone reformatted this file, which is
// exactly why the list is explicit despite being longer.
//
// **`rangeForSource` is omitted for the same reason**, and it is the easier one to miss:
// it takes a `HeaderSource`, so `rangeForSource({ origin: 'self' }, …)` reaches `selfRange`
// through a wrapper. Only the ingest loop may name a `self` header. The *type* is exported
// below because callers of `runIngest` have to name it — a type cannot mint anything.
export {
  addRange,
  asSharedCoverageRange,
  boundarySet,
  covered,
  holesIn,
  isVerifiedAt,
  invalidateRange,
  providerRange,
  sanitizeCoverage,
  verifyRange,
  verifyRanges,
  CoverageError,
  EMPTY_COVERAGE,
} from './coverage.js';
export type {
  CoverageRange,
  CoverageRef,
  CoverageRepair,
  CoverageVerification,
  CoveredResult,
  DroppedRange,
  HeaderSource,
  Hole,
  RangeCheck,
  RangeEdge,
  RangeEdgeFacts,
  RangeOrigin,
  RangeVerdict,
  SelfIngested,
} from './coverage.js';
//
// **`isGenesisHash` is not here either, and its absence is a smaller version of the same rule.**
// It had no consumer outside `chain-tag.ts` — `chainTag` is the validated door, and a bare
// predicate beside it invites the shape it exists to prevent (`if (isGenesisHash(x)) use(x)`,
// with the slice done by hand). `packages/providers` restates the regex rather than importing
// this, for a reason that survives: importing this barrel for a predicate pulls Dexie into that
// package's graph.
export { chainTag, ChainTagError } from './chain-tag.js';
export * from './ingest.js';
export * from './backfill.js';
export * from './candles.js';
export * from './loop.js';
export * from './loop-store.js';
export * from './ingest-lock.js';
// `store.js` is re-exported by NAME for the same reason `coverage.js` is, and the omission is
// again the point: **`writeDownsampled` is not here.** Its own doc says it takes no transaction
// of its own and **must** be called inside the `rw` that deletes the rows — 10 §9.2 obligation 1,
// *"the label is written in the same storage transaction that deletes the rows"*. Reached through
// the barrel by any consumer it becomes a way to write §9.2's label with no eviction behind it:
// rows still present, `meta.downsampled` claiming they were folded, which is the phantom label a
// mutation caught inside this package one round ago. `quota.ts` calls it through a relative
// import; the suites reach it through `@bleavit/local-index/testing`, which
// `no-testing-import` forbids production code from touching.
export {
  candleTableFor,
  coveredCandles,
  coveredQuery,
  coveredSamples,
  databaseName,
  evictMetadataToBudget,
  evictPendingRawToBound,
  evictionEnvelope,
  pendingDecoderCount,
  pendingRawBytes,
  pendingRawRows,
  rawEventId,
  readChartDiscard,
  readCoverage,
  readCoverageRepair,
  readDownsampled,
  readMetadataBlob,
  readPendingRawEvicted,
  rebuild,
  writeCoverage,
  LocalIndex,
  StoreError,
  REKEYED_TABLES,
  REKEY_VERSION,
  SCHEMA_V1,
  SCHEMA_V1_VERSION,
  SCHEMA_V3,
  SCHEMA_V3_VERSION,
} from './store.js';
export type {
  CandleKey,
  ChartDiscardRecord,
  ChartDiscardSpan,
  CoveredHistory,
  MetaRow,
  MetadataBlob,
  MetadataBudget,
  PendingRawEviction,
  PendingRawEvictionRecord,
  ProposalArchiveRow,
  RebuildRecord,
  SampleKey,
  SnapshotImport,
  StoredEvent,
  StoredTxRow,
} from './store.js';
export * from './quota.js';
export * from './tape.js';
export * from './boot.js';
