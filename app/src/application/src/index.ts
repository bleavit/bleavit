// The application package's library surface. `main.ts` is the side-effect entry Vite
// builds; this is what other compilation units and the release tooling import.
export {
  activateWaitingRelease,
  isPinned,
  registerReleaseWorker,
  setPinned,
  type WorkerStatus,
} from './release-worker.js';
export { boot } from './main.js';
