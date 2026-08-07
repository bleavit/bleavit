// The application package's library surface. `main.ts` is the side-effect entry Vite
// builds; this is what other compilation units and the release tooling import.
export {
  activateWaitingRelease,
  isPinned,
  registerReleaseWorker,
  setPinned,
  type WorkerStatus,
} from './release-worker.js';
export { boot, screenForHash } from './boot.js';
export {
  INVENTORY_IDS,
  SCREENS,
  navigationFor,
  placementOf,
  reachableScreens,
  type Navigation,
  type Placement,
  type Screen,
  type ScreenArea,
} from './screens.js';
export { EpochHeader, Shell, sudoBannerFor, type ShellChainState } from './shell.js';
export {
  SHELL_READS,
  assertOnePin,
  readShellState,
  type Decoded,
  type ShellDecoders,
  type ShellRead,
  type ShellStateReader,
  type UndecodableRead,
} from './chain-reads.js';
export {
  Outlet,
  PENDING_SCREENS,
  pendingCopy,
  type PendingScreen as PendingScreenEntry,
  PendingScreen,
  screenFor,
} from './routes.js';
export { CheckpointAgeNotice, VerificationPanelView } from './verification-panel.js';
export {
  PHASE_FLAG_BITS,
  hasPhaseFlag,
  namedPhaseFlags,
  sudoActive,
  type PhaseFlagName,
} from './phase-flags.js';
export { shellDecoders } from './shell-decoders.js';
export {
  DEGRADATION_RESPONSES,
  DEGRADATION_ROWS,
  respondTo,
  type DegradationResponse,
  type DegradationRow,
} from './degradation.js';
export { implementedScreens, unaccountedScreens } from './composition.js';
export { releaseChainSpecs, releaseMetadataPins, releaseParaChain, releaseWorkerSource } from './chain-identity.js';
export {
  UnusablePinError,
  startChainSession,
  type ChainSession,
  type ChainSessionDeps,
  type ChainSpecs,
  type WorkerSource,
} from './chain-session.js';
export { connectChain } from './chain-boot.js';
export {
  fundingArtifacts,
  openDepositLeg,
  openWithdrawLeg,
  type DepositLeg,
  type DepositLegDeps,
  type FundingArtifacts,
  type FundingPins,
  type OpenReader,
  type WithdrawLeg,
  type WithdrawLegDeps,
} from './funding-session.js';
