// Compilation unit `analysis` (10 §10.2). Its reference set is its package.json dependencies.
export {
  BlockScanError,
  blockScanner,
  watchedAccounts,
  type BlockScanner,
} from './block-scan.js';

// F23 — the provider surface: 10 §8's mechanisms as screens. `providers` is in this unit's
// reference set and in no other, which is why every one of these lives here rather than beside
// a transaction screen.
export { CoverageView, distinctSources } from './coverage-view.js';
export {
  AWAITING_CHAIN_READ,
  CHAIN_DISAGREES,
  ProviderObjectAction,
  type ProviderObjectActionProps,
} from './provider-action.js';
export {
  EMPTY_BY_DEFAULT,
  FleetSummary,
  NO_PROBE_DRIVER,
  ProviderSettings,
  healthLine,
  type HealthLine,
  type ProviderPanelProps,
} from './provider-panel.js';
export {
  ACCEPT_MEANS,
  AcceptInterstitial,
  NO_SUGGESTIONS,
  SuggestionList,
} from './provider-suggestions.js';
export {
  AGREEMENT_IS_NOT_PROOF,
  CrossCheckView,
  NO_OVERLAP_MEANS,
} from './snapshot-crosscheck.js';
export {
  EvictionPreview,
  ImportOutcomeView,
  ImportProgress,
  QUOTA_NOTE,
} from './snapshot-import.js';
export {
  REACH_COPY,
  ReachDisclosure,
  reachReading,
  wouldBadgeSampled,
  type ReachCopy,
  type ReachReading,
} from './spot-check-reach.js';
