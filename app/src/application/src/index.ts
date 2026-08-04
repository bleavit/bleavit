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
  type UndecodableRead,
} from './chain-reads.js';
