// PlatformAdapter — the ONLY package permitted to import @tauri-apps/* or a host SDK. F22.
//
// It imports none. The permission is declined deliberately, so the desktop shell can embed
// the *published* `dist/` byte for byte rather than a desktop-specific rebuild — see
// `./adapter.ts`, which states the reasoning and names the control that keeps the firewall
// rule from going vacuous.
export {
  CapabilityError,
  PLATFORM_CAPABILITIES,
  absent,
  lattice,
  meet,
  proven,
  requireCapabilities,
  transportCapabilities,
  unprovenLattice,
} from './capabilities.js';
export type {
  CapabilityLattice,
  CapabilityState,
  CapabilityVerdict,
  PlatformCapability,
} from './capabilities.js';

export {
  DISTRIBUTION_CHANNELS,
  PlatformError,
  desktopPlatform,
  unknownPlatform,
  webPlatform,
} from './adapter.js';
export type {
  AttestationFinding,
  AttestationState,
  DistributionChannel,
  HostBridge,
  HostReport,
  PlatformAdapter,
  WebProbes,
} from './adapter.js';

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
