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
export { CoverageView, EDGE_IS_NOT_A_VERDICT, distinctSources } from './coverage-view.js';
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
// F25 — the local index's disclosure surface. `bootLocalIndex` is `checkIndexAtBoot`'s
// production call site; the two components are its readers. `LocalIndex` itself is deliberately
// not re-exported: this unit is the only one 10 §10.2 lets reach `local-index`, and a
// re-export would make the database constructible from the composition root, which sits above
// the firewall edge that INV-FE-7 rests on.
export {
  bootLocalIndex,
  cannotObserve,
  type IndexBootOutcome,
  type IndexChainIdentity,
  type RangeObserver,
} from './index-boot.js';
// F14 — 10 §9.2's quota manager reaches a running client. `enforceStorageBudget` is
// `applyQuota`'s production call site; `retentionDisclosure` is its reader. `LocalIndex` is
// still not re-exported (see above), and neither is `applyQuota`: the budget is applied through
// the wrapper that names the platform, the row model and the metadata pins, so no caller above
// the firewall can run a pass against a cap it invented.
export {
  MODELLED_ROW_BYTES,
  MODELLED_ROW_SIZES,
  deviceHints,
  enforceStorageBudget,
  storagePlatform,
  type DeviceHints,
  type MetadataPins,
  type RetentionOutcome,
  type StorageBudgetOptions,
  type StorageProfile,
} from './index-quota.js';
export {
  HISTORY_DISCLOSURES,
  REPORT_DISCLOSURES,
  bootDisclosure,
  historyDisclosure,
  retentionDisclosure,
  type DisclosureCopy,
  type DisclosureFact,
  type DisclosureItem,
  type IndexBootState,
  type IndexDisclosureId,
} from './index-disclosure.js';
export { CoveredHistoryDisclosure, IndexBootDisclosure } from './index-disclosure-view.js';
