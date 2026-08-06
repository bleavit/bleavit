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
export { chainTag, isGenesisHash, ChainTagError } from './chain-tag.js';
export * from './ingest.js';
export * from './backfill.js';
export * from './candles.js';
export * from './loop.js';
export * from './loop-store.js';
export * from './ingest-lock.js';
export * from './store.js';
export * from './quota.js';
export * from './boot.js';
