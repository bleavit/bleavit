// Optional acceleration — snapshots and live indexers (10 §8, INV-FE-3/15). F9.
//
// `sampling.js` is re-exported by NAME rather than with `export *`, and the omission is the
// point: **`selectSampleAtRate` and `runSamplingRoundAtRate` are not here.** They take the
// 1-in-16 rate 10 §8.4 states normatively as an argument, so a barrel export hands every
// consumer a way to switch the sampler off by passing a large number — at which point every
// round reports `clean` having compared one row, and nothing fails. They live behind
// `@bleavit/providers/testing`, which production code may not import.
//
// An `export *` would silently re-admit them the moment anyone reformatted this file, which is
// exactly why the list is explicit despite being longer. Same discipline, and the same reason,
// as `@bleavit/local-index`'s barrel.
export * from './health.js';
export * from './import.js';
export * from './import-quota.js';
export * from './mint.js';
export * from './refusals.js';
export * from './snapshot.js';
export * from './suggestions.js';

// §8.5.3's probe driver (F24). Named rather than `export *` for the reason above: `HttpGet` is a
// transport type, and a barrel that re-exported every future transport by wildcard would
// eventually hand one consumer two of them under one name.
export { probe, runProbeRound } from './probe.js';
export type {
  HttpGet,
  ProbeResponse,
  ProbeRound,
  ProbeRoundResult,
  ProbeTarget,
} from './probe.js';

// §8.5.2's range reader (F24). Named for the same reason: `IndexerGet` is the second transport
// type in this package, and the two are deliberately assignable rather than merged while both
// halves of F24 are in flight — see `indexer.ts`.
export {
  NEXT_CURSOR_HEADER,
  coverageHoles,
  mergeCoverage,
  readChain,
  readRange,
  samplingPages,
} from './indexer.js';
export type {
  ChainAnswer,
  IndexerGet,
  IndexerPage,
  IndexerResponse,
  IndexerSource,
  RangeOutcome,
  RangeRead,
} from './indexer.js';

export {
  PAGES_PER_SAMPLED_ROW,
  ProviderCannotServeError,
  afterProbe,
  chainRowCheck,
  livenessRefusal,
  probeDue,
  runSamplingRound,
  selectSample,
} from './sampling.js';
export type {
  ChainRead,
  ChainReadResult,
  ProbeOutcome,
  ProviderPage,
  ProviderRow,
  RowCheck,
  RowMismatch,
  RowVerdict,
  SampleSelection,
  SampledRow,
  SampledRound,
  UnverifiableReason,
} from './sampling.js';
