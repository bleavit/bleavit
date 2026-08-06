/**
 * `PlatformAdapter` — the one place a host or native SDK may be named (10 §10.1), F22.
 *
 * 10 §10.1: *"`platform` is the only package permitted to import a host or native SDK
 * (`@tauri-apps/*`, `@parity/product-sdk`); `src/features/tx/**` may reference `platform`
 * but never a concrete platform implementation"*.
 *
 * ## No host SDK is imported here, and that is a decision rather than an omission
 *
 * The rule above is a **permission**, not an obligation, and this package declines it. Two
 * reasons, and the first is F22's whole point:
 *
 * 1. **One tree, byte-identical.** The desktop shell embeds `dist/` and asserts it is the
 *    attested tree, digest for digest. That assertion is only worth something if the
 *    embedded tree is the *published* tree — so there is no desktop-specific bundle, and a
 *    static `import` from `@tauri-apps/api` would either put host code in the web release
 *    or force a second build path. The second is what the milestone forbids.
 * 2. **The bundle's contents are enumerable.** A release whose security argument is a
 *    per-file hash map is one where every added dependency is a file somebody must account
 *    for. A host binding that can be injected costs zero bytes in the channel that does not
 *    use it.
 *
 * So the concrete host arrives as an injected `HostBridge`. The dependency-cruiser rule
 * `only-platform-touches-host-sdks` stays live and is proven non-vacuous by
 * `tests/depcruise-witness/forbidden-external.ts`, which imports `@tauri-apps/api` from
 * outside this package and MUST be reported. A rule proven only by a green run is not proven.
 *
 * ## What the desktop adapter can honestly claim
 *
 * The webview cannot verify itself. Anything the shell injects into the page is readable and
 * writable by page script, so an `attestation` field arriving over the bridge is a **report,
 * not a proof** — 12 §5.2 makes the same withdrawal about the service worker and for the
 * same reason. What makes the desktop claim real is elsewhere: the shell runs the comparison
 * in native code **before it creates a window**, so a mismatching build never renders. This
 * module records the report and says what it is; it does not upgrade it.
 */

import type { CapabilityLattice, CapabilityState } from './capabilities.js';
import { absent, lattice, proven, unprovenLattice } from './capabilities.js';

/**
 * The channels this release is built for.
 *
 * **Deliberately two members, and an app store is not one of them.** This is the mechanical
 * form of Track F Phase 1's *direct-download only* scoping: a store channel re-signs the
 * artifact with a key the project does not hold, which is the single fact that would make
 * INV-FE-8 ("no single operator may silently alter the application") and INV-FE-10
 * (reproducible, independently verifiable builds) false as written. While the union has no
 * store member, adding one is a type-level change that fails every exhaustive `switch` in
 * the tree until somebody argues it — rather than a configuration flag somebody sets.
 *
 * **This property has no citation in `docs/architecture/`.** It lives in PLAN.md's Track F
 * phase grouping and in the Decision log, and Phase 3 is where the store question is
 * scheduled to be answered (scope INV-FE-8/-10 to the canonical channel, add an INV-FE-16
 * channel-honesty invariant). Stating that here rather than implying a spec basis is the
 * honest form; see PLAN.md · Decision log, 2026-08-06.
 */
export const DISTRIBUTION_CHANNELS = Object.freeze(['web', 'direct-download', 'unknown'] as const);

export type DistributionChannel = (typeof DISTRIBUTION_CHANNELS)[number];

/**
 * The channels a release is actually *distributed* on. `unknown` is not one of them.
 *
 * Separated so the no-store property is asserted over the shipping set rather than over a
 * union that also has to carry an unidentified host. `unknown` earns its place for the
 * opposite reason to the other two: an unrecognised host that reported `web` would carry the
 * web channel's meaning — *your integrity control is the service worker* — which is wrong
 * reassurance for a host that may be a native shell with no worker and no attestation.
 */
export const SHIPPING_CHANNELS = Object.freeze(['web', 'direct-download'] as const);

/**
 * What the running process can say about the asset tree it is serving.
 *
 * `not-applicable` is a first-class arm rather than a `null`: the web channel has no
 * embedded tree to attest, and its integrity mechanism is a different one (the release-scoped
 * service worker of 12 §5.2 plus `packages/verify`'s self-check against the signed
 * `release.json`). Collapsing "there is no embedded tree here" into "the embedded tree was
 * not verified" would put a warning in front of every web user about a control their channel
 * does not use.
 */
export type AttestationState =
  | { readonly kind: 'not-applicable'; readonly reason: string }
  | {
      /**
       * The shell reported that it compared its embedded tree against the attested
       * `release.json` and found no divergence. A **report**: see the header.
       */
      readonly kind: 'reported-verified';
      readonly pinnedCount: number;
      readonly sourceCommit: string;
    }
  | {
      /**
       * The shell reported a divergence. Surfaced, never repaired — the same rule
       * `packages/verify` is built around (INV-FE-8's closing sentence).
       */
      readonly kind: 'reported-divergent';
      readonly findings: readonly AttestationFinding[];
    };

/**
 * One divergence, in the three directions that exist.
 *
 * Structurally the `SelfCheckFinding` of `packages/verify`, restated here rather than
 * imported: `platform` is in `src/features/tx`'s 10 §10.2 reference set and `verify` is not,
 * so a production dependency would put `verify` one hop from the transaction unit for the
 * sake of a type. The two shapes are bound at compile time by `tests/platform`, which
 * assigns each to the other and fails to compile if either drifts.
 */
export interface AttestationFinding {
  readonly kind: 'changed' | 'missing' | 'unexpected';
  readonly path: string;
  readonly detail: string;
}

/**
 * How many diverging files the disabled surface names before it stops counting.
 *
 * Bounded on purpose: a wholesale divergence names hundreds, and a reason nobody finishes
 * reading is the unexplained control the lattice exists to prevent. The count is always
 * exact and the full list stays on `PlatformAdapter.attestation`, for the surface whose job
 * is to show it.
 */
const NAMED_FINDINGS = 3;

/**
 * The `embedded-tree-attestation` capability, **derived from the attestation** rather than
 * written beside it.
 *
 * The defect this replaces is worth naming, because it shipped past a review and a green
 * suite. `desktopPlatform` deliberately *returns* on a reported divergence — INV-FE-8
 * surfaces, it never repairs — and the capability written next to that branch was the
 * literal `proven()`. So every surface guarded by
 * `requireCapabilities(..., ['embedded-tree-attestation'])` was enabled in exactly the state
 * where the host had said the embedded tree failed verification: the one state the
 * capability exists to describe.
 *
 * A literal beside a check can fall out of step with it. A value computed from the check
 * cannot. The `switch` is exhaustive over `AttestationState`, so an arm added later fails to
 * compile here rather than inheriting whichever branch happened to be written first.
 *
 * `proven` therefore means one thing only: *the host reported that it compared the embedded
 * tree against the signed release and found no divergence*. It remains a **report** — see
 * the header. What makes the desktop claim real is the native gate that refuses to create a
 * window, not this record of it.
 */
function embeddedTreeCapability(attestation: AttestationState): CapabilityState {
  switch (attestation.kind) {
    case 'reported-verified':
      return proven();
    case 'reported-divergent':
      return absent(divergenceReason(attestation.findings));
    case 'not-applicable':
      // The channel has no embedded tree, and the arm already carries the sentence saying
      // which control it uses instead. Reused rather than restated, so the capability's
      // reason and the attestation's cannot become two accounts of one fact.
      return absent(attestation.reason);
  }
}

/** The sentence a surface disabled by a reported divergence renders. */
function divergenceReason(findings: readonly AttestationFinding[]): string {
  const named = findings
    .slice(0, NAMED_FINDINGS)
    .map((finding) => `${finding.kind} ${finding.path}`)
    .join(', ');
  const rest = findings.length - Math.min(findings.length, NAMED_FINDINGS);
  const more = rest > 0 ? `, and ${rest} more` : '';
  return (
    'the host reported that the asset tree inside this build is not the tree the release ' +
    `signed: ${findings.length} file(s) diverged (${named}${more}). This copy is not the ` +
    'release it says it is, so everything that rests on that check is off. Obtain the ' +
    'release from its permanent content address and verify it, rather than downloading ' +
    'again from wherever these bytes came from.'
  );
}

/**
 * The port. Every field is required, and there is no `undefined` anywhere in it.
 *
 * A tx surface holds this type and never a concrete implementation, which is 10 §10.1's
 * second clause written as a signature: there is nothing here to import a host SDK *from*.
 */
export interface PlatformAdapter {
  readonly channel: DistributionChannel;
  /** A short, stable identifier for the host, for diagnostics. Never parsed for behaviour. */
  readonly host: string;
  readonly capabilities: CapabilityLattice;
  readonly attestation: AttestationState;
}

export class PlatformError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlatformError';
  }
}

/**
 * What a browser has been **shown** to support.
 *
 * Injected, never probed here. A composition root establishes each of these the only way
 * they can honestly be established — by feature-detecting in the document that is running —
 * and hands the results in. Every field is required, so a caller who forgets one gets a type
 * error rather than a surface that offers a transport nobody established.
 */
export interface WebProbes {
  /** `<a download>` or File System Access is usable. */
  readonly file: boolean;
  /** The async Clipboard API is usable (it is permission- and secure-context-gated). */
  readonly clipboard: boolean;
  /** `navigator.share({ files })` is usable. FE-P11's unresolved half — never assumed. */
  readonly share: boolean;
  /**
   * A service worker registered for this release's scope.
   *
   * Not merely `'serviceWorker' in navigator`: 12 §5.2's control is a *registered, activated*
   * worker, and the three ordinary ways to lose it (a private window, a browser with workers
   * disabled, an insecure origin) all leave the API present.
   */
  readonly serviceWorker: boolean;
}

/**
 * The web/PWA adapter — the canonical channel (12 §1, §4).
 *
 * `external-navigation` is proven unconditionally and that is not an assumption: a top-level
 * navigation is the one capability a browser cannot lack, and 10 §13.4 relies on exactly
 * that (an outbound vendor link is a navigation rather than a fetch, which is why 12 §5.1
 * says it adds no `connect-src` entry).
 *
 * `embedded-tree-attestation` is **absent, with the reason**, because the web channel has no
 * embedded tree. That is the fail-closed lattice doing its job rather than a gap: the
 * dependent surface renders "this channel verifies differently, here is how" instead of a
 * green tick it did not earn. It is *derived* from the attestation like every other channel's
 * — the same one-line call — so the two statements this adapter makes about the embedded tree
 * cannot become two different statements.
 */
export function webPlatform(probes: WebProbes): PlatformAdapter {
  const noEmbeddedTree =
    'this is the web release, which serves its files from a gateway rather than from an ' +
    'embedded tree. Its integrity control is the signed release manifest and the ' +
    'release-scoped service worker (12 §5.2), shown in the verification panel.';
  // Annotated rather than inferred: `Object.freeze` widens `'not-applicable'` to `string`,
  // and the arm would then match nothing at a `switch` — an `AttestationState` that reads as
  // none of its own members.
  const attestation: AttestationState = { kind: 'not-applicable', reason: noEmbeddedTree };
  return Object.freeze({
    channel: 'web',
    host: 'browser',
    capabilities: lattice({
      file: probes.file
        ? proven()
        : absent('this browser did not offer a way to save a file, so export by file is off.'),
      clipboard: probes.clipboard
        ? proven()
        : absent(
            'the clipboard is unavailable here — it needs a secure context and, in some ' +
              'browsers, a permission this page was not granted.',
          ),
      share: probes.share
        ? proven()
        : absent('this browser does not offer the system share sheet for files.'),
      'external-navigation': proven(),
      'service-worker': probes.serviceWorker
        ? proven()
        : absent(
            'no service worker is registered for this release, so offline use and the ' +
              'per-file integrity check on each response are both off. A private window, a ' +
              'browser with workers disabled, or an insecure origin each cause this.',
          ),
      'embedded-tree-attestation': embeddedTreeCapability(attestation),
    }),
    attestation,
  });
}

/**
 * What a desktop shell reports across the bridge.
 *
 * Named `HostReport` rather than `HostCapabilities` on purpose: these are claims made by the
 * process hosting the webview, and the webview cannot check them. What the type buys is that
 * a claim is *shaped* — a missing field is a type error at the composition root instead of
 * an `undefined` that reads as `false` in one branch and as "unknown, assume fine" in another.
 */
export interface HostReport {
  /** A stable host identifier, e.g. `tauri`. Diagnostics only. */
  readonly host: string;
  readonly file: boolean;
  readonly clipboard: boolean;
  readonly share: boolean;
  /**
   * The host can open a named tool vendor as a top-level navigation (10 §13.4).
   *
   * Reported rather than assumed, which is the correction of a second hand-written claim.
   * `webPlatform` proves this one unconditionally and is right to: a *browser* cannot lack a
   * top-level navigation. That argument is about browsers, and it was copied to a channel it
   * does not cover. A native shell opens an external URL only where its host grants that, and
   * the shell this milestone ships grants nothing — `src-tauri/gen/schemas/capabilities.json`
   * is `{}` and no host plugin is a dependency — so the copied `proven()` offered a control
   * that would do nothing when clicked. It is a host statement now, exactly like the three
   * transports above it, so a shell that later gains the grant reports it rather than
   * inheriting it.
   */
  readonly externalNavigation: boolean;
  /**
   * The embedded-tree comparison the shell ran before creating a window.
   *
   * `undefined` is not admissible — see `desktopPlatform`, which refuses it. A shell that
   * did not answer is a shell that may not have checked.
   */
  readonly attestation: AttestationState;
}

/**
 * The bridge a host supplies. The concrete Tauri implementation is injected by the shell's
 * composition root; nothing in this package constructs one.
 *
 * It is a plain data port with no method, because the only thing the desktop channel needs
 * from the host at this milestone is what it already knows at startup. Commands, if a later
 * milestone needs any, belong behind their own capability rather than widening this.
 */
export interface HostBridge {
  readonly report: HostReport;
}

/**
 * The desktop adapter — the direct-download channel.
 *
 * Refuses three shapes rather than degrading, each of them a report that cannot be believed
 * as a report:
 *
 * - **A `not-applicable` attestation.** On this channel there *is* an embedded tree, so
 *   "not applicable" is a category error and almost certainly a bridge wired to the web
 *   adapter's value. Accepting it would produce a desktop build whose one distinguishing
 *   control silently reported that it did not apply.
 * - **A divergent attestation with no findings.** A refusal that cannot say what diverged
 *   is a refusal a user cannot act on, and an empty list is what an adapter that lost the
 *   findings on the way across the bridge would produce.
 * - **A verified attestation over zero pinned files.** The exact mirror of the previous one,
 *   and it was missing: "I compared nothing and found no divergence" is the vacuous pass this
 *   repository keeps rediscovering, and it is what a bridge that lost `pinnedCount` produces.
 *   No honest shell can report it — `readPerFileHashes` and the Rust `attest` both refuse an
 *   empty manifest — so the state means the report is wrong, not that the tree is empty.
 *
 * What it does **not** refuse is a divergence that names files: that one returns, because
 * INV-FE-8 surfaces divergence and never repairs it, and a thrown adapter is a divergence
 * nobody can render. It returns claiming nothing, which is the whole of the fix below.
 *
 * `service-worker` is absent with its reason: a native shell serves its own bytes, so the
 * worker has nothing to intercept, and the embedded-tree assertion is the stronger control
 * that replaces it.
 */
export function desktopPlatform(bridge: HostBridge): PlatformAdapter {
  const { report } = bridge;
  if (report.attestation.kind === 'not-applicable') {
    throw new PlatformError(
      'the desktop channel embeds the asset tree, so an attestation of "not applicable" is ' +
        'not a state it can be in; refusing rather than shipping a shell whose one ' +
        'distinguishing control reports that it does not apply',
    );
  }
  if (report.attestation.kind === 'reported-divergent' && report.attestation.findings.length === 0) {
    throw new PlatformError(
      'the host reported a divergent embedded tree and named nothing that diverged; a ' +
        'refusal a user cannot act on is refused here instead',
    );
  }
  if (report.attestation.kind === 'reported-verified' && report.attestation.pinnedCount === 0) {
    throw new PlatformError(
      'the host reported a verified embedded tree having compared no pinned file at all; a ' +
        'comparison over nothing reports success for the one reason that proves nothing, ' +
        'and no honest release can pin an empty manifest',
    );
  }
  return Object.freeze({
    channel: 'direct-download',
    host: report.host,
    capabilities: lattice({
      file: report.file
        ? proven()
        : absent('this build was not granted access to the file system, so export by file is off.'),
      clipboard: report.clipboard
        ? proven()
        : absent('this build was not granted clipboard access, so copying a capsule is off.'),
      share: report.share
        ? proven()
        : absent('this desktop build offers no system share sheet.'),
      'external-navigation': report.externalNavigation
        ? proven()
        : absent(
            'this build cannot open a link in your browser: a downloaded application does ' +
              'that only where its host grants it, and this one reported no such grant. The ' +
              'address is shown so you can open it yourself.',
          ),
      'service-worker': absent(
        'a downloaded application serves its own files, so there is no network response for ' +
          'a service worker to check. The embedded asset tree is verified against the signed ' +
          'release manifest at startup instead.',
      ),
      'embedded-tree-attestation': embeddedTreeCapability(report.attestation),
    }),
    attestation: report.attestation,
  });
}

/**
 * The adapter for a host nobody identified.
 *
 * This exists so a composition root has something correct to return on the unknown branch.
 * Nothing is proven, and every dependent surface is disabled with the same honest reason.
 *
 * **The channel is `unknown` rather than `web`**, and the earlier draft had it wrong. Every
 * capability being absent already stops any surface enabling, so the channel looked like a
 * harmless default — but it is not a capability, it is a *claim about which integrity control
 * applies*. `web` says the release-scoped service worker and the signed manifest are checking
 * these bytes (12 §5.2). Said of a host that might be a native shell with neither, that is
 * reassurance nobody earned. The same reasoning covers `attestation`, whose `not-applicable`
 * reason carries this sentence rather than the web channel's.
 *
 * There is no call to `embeddedTreeCapability` here because there is nothing for it to
 * decide: `unprovenLattice` already gives that capability the same `absent(reason)` the
 * derivation returns for this arm. `tests/platform` asserts the agreement over every
 * constructor rather than leaving it to a reader to notice.
 */
export function unknownPlatform(reason: string): PlatformAdapter {
  const attestation: AttestationState = { kind: 'not-applicable', reason };
  return Object.freeze({
    channel: 'unknown',
    host: 'unidentified',
    capabilities: unprovenLattice(reason),
    attestation,
  });
}
