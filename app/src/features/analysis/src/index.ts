// Compilation unit `analysis` (10 §10.2). Its reference set is its package.json dependencies.
export {
  BlockScanError,
  blockScanner,
  watchedAccounts,
  type BlockScanner,
} from './block-scan.js';
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
export {
  HISTORY_DISCLOSURES,
  REPORT_DISCLOSURES,
  bootDisclosure,
  historyDisclosure,
  type DisclosureCopy,
  type DisclosureFact,
  type DisclosureItem,
  type IndexBootState,
  type IndexDisclosureId,
} from './index-disclosure.js';
export { CoveredHistoryDisclosure, IndexBootDisclosure } from './index-disclosure-view.js';
