// PlatformAdapter — the ONLY package permitted to import @tauri-apps/* or a host SDK. F22.
export {};

// The release-scoped service worker's policy (12 §5.2, F11). Pure over data, so the one
// control that decides whether tampered bytes reach a user is testable outside a browser.
export {
  ACTIVATE_MESSAGE,
  acceptsBytes,
  assetHashesFrom,
  classify,
  releaseScope,
  shouldActivate,
  staleCaches,
} from './service-worker.js';
export type {
  Handling,
  ReleaseAssetHashes,
  ReleaseScope,
  RequestVerdict,
  Sha256Hex,
} from './service-worker.js';
