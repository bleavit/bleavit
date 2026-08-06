/**
 * The platform capability lattice — app-code rule 10, F22.
 *
 * The rule this file makes structural: *"Platform and signer capabilities are a fail-closed
 * lattice: an unproven capability is **absent**, and absence disables the dependent surface
 * with a named reason — never a silent fallback."*
 *
 * **INV-FE-12 is the analogy, not the owner**, and the distinction is worth keeping: that
 * invariant's subject is the *runtime* surface — `restricted` / `read-only-incompatible`,
 * whether the client may sign, how undecodable data renders. It says nothing about platform
 * capabilities. What the two share is the posture (unknown is a state, never a default to the
 * permissive one), and app-code rule 10 is where that posture was extended to this domain.
 *
 * Three properties carry it, and each of them is a shape rather than a convention.
 *
 * ## 1. There is no boolean
 *
 * A capability is `proven` or it is `absent`, and `absent` **carries a reason**. A boolean
 * has room for only one of those two facts, so the surface that has to explain itself to a
 * user reaches for a message written at the call site — and the messages then disagree
 * between the two screens that disable the same button. `absent('')` throws: a reason that
 * says nothing is the silent fallback wearing the type of a named one.
 *
 * ## 2. The record is total, so forgetting one is a type error
 *
 * `CapabilityLattice` is `Record<PlatformCapability, CapabilityState>` — every member of the
 * closed set, always. An optional map defaults a forgotten capability to `undefined`, and
 * `undefined` reads as *absent* to a careful caller and as *falsy, so probably fine* to a
 * hurried one. The direction that hurts is the second, so it is removed rather than
 * documented.
 *
 * ## 3. Combining two capability sets takes the weaker one
 *
 * `meet` is the lattice operation the rule names. A surface that needs two capabilities is
 * enabled only where both are proven, and the refusal it renders names **both** missing
 * halves rather than whichever was checked first — a user told one reason fixes it and
 * meets the next one.
 *
 * ## What is deliberately not here
 *
 * Nothing in this module reads `navigator`, `window`, or a host SDK. Capabilities arrive
 * **injected** (`webPlatform`, `desktopPlatform` in `./adapter.js`), which is the same
 * discipline `packages/llm-handoff`'s transports already follow and for the same reason:
 * a capability this package reached for could not be exercised in the environment where it
 * is absent, which is the only environment whose behaviour matters here.
 */

/**
 * The closed capability set.
 *
 * Every member is something a *surface* depends on, named after the thing the user loses.
 * Adding a member is a deliberate act: it makes every existing `CapabilityLattice` literal
 * a type error until it says what it knows about the new one, which is the point.
 *
 * - `file`, `clipboard`, `share` — 10 §13.4's transports for a handoff capsule.
 * - `external-navigation` — opening a named tool vendor as a top-level navigation (10 §13.4;
 *   not a fetch, so `connect-src` does not govern it — 12 §5.1).
 * - `service-worker` — 12 §5.2's release-scoped worker. The web channel's integrity and
 *   offline mechanism; a desktop shell has neither the need nor the API.
 * - `embedded-tree-attestation` — F22's own: the running process can state that the asset
 *   tree it serves is the attested one. The web channel cannot (see `./adapter.js`).
 */
export const PLATFORM_CAPABILITIES = Object.freeze([
  'file',
  'clipboard',
  'share',
  'external-navigation',
  'service-worker',
  'embedded-tree-attestation',
] as const);

export type PlatformCapability = (typeof PLATFORM_CAPABILITIES)[number];

export type CapabilityState =
  | { readonly kind: 'proven' }
  | { readonly kind: 'absent'; readonly reason: string };

/** Every capability, always. Totality is the control — see the header. */
export type CapabilityLattice = Readonly<Record<PlatformCapability, CapabilityState>>;

export class CapabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CapabilityError';
  }
}

const PROVEN: CapabilityState = Object.freeze({ kind: 'proven' as const });

/** A capability the platform has been shown to have. */
export function proven(): CapabilityState {
  return PROVEN;
}

/**
 * A capability that is not available, with the sentence the dependent surface will render.
 *
 * The reason is validated rather than trusted. An empty or whitespace reason is refused
 * because the invariant's requirement is a *named* reason: a disabled control with no
 * explanation is indistinguishable, to the person looking at it, from a broken one — and
 * the repair they attempt is a reload, which changes nothing.
 */
export function absent(reason: string): CapabilityState {
  if (reason.trim().length === 0) {
    throw new CapabilityError(
      'an absent capability must carry the reason the dependent surface will show; an ' +
        'unexplained disabled control is the silent fallback INV-FE-12 forbids',
    );
  }
  return { kind: 'absent', reason };
}

/**
 * Build a lattice, checking what the type cannot.
 *
 * The record type already forces every capability to be mentioned. What it cannot force is
 * that an `absent` state carries a real reason — a caller writing the object literal by
 * hand can spell `{ kind: 'absent', reason: '' }` without going through `absent()`. This
 * closes that, so the reason rule holds for every lattice in the process rather than only
 * for the ones built through the helper.
 */
export function lattice(states: CapabilityLattice): CapabilityLattice {
  const out: Partial<Record<PlatformCapability, CapabilityState>> = {};
  for (const capability of PLATFORM_CAPABILITIES) {
    out[capability] = normalise(capability, states[capability]);
  }
  return Object.freeze(out as Record<PlatformCapability, CapabilityState>);
}

/**
 * Read one state, refusing anything that is not one of the two.
 *
 * The default direction is the whole point. This function exists *because* the type is not
 * enough — a caller can spell the object literal by hand, and an untyped one (a record
 * rehydrated from storage, a value across a bridge) reaches here with whatever it carries. An
 * `else` branch that returns `proven` therefore turns a typo into a **proven** capability,
 * which is the one direction a fail-closed lattice must never default to. There is no
 * `absent` default either: a fabricated reason would be a sentence no one wrote shown to a
 * user as if it explained something.
 */
function normalise(capability: PlatformCapability, state: CapabilityState): CapabilityState {
  if (state?.kind === 'proven') return PROVEN;
  // Re-runs the reason check, which throws on an empty one.
  if (state?.kind === 'absent') return absent(state.reason);
  throw new CapabilityError(
    `${capability} carries neither \`proven\` nor \`absent\`; refusing rather than reading an ` +
      'unrecognised state as proven, which is how a fail-closed lattice fails open',
  );
}

/**
 * A lattice in which nothing is proven — the fail-closed starting point.
 *
 * This is what a composition root uses before it has established anything, and what an
 * unrecognised host gets. Every capability carries the same reason, which is honest: the
 * platform itself was not identified, so no per-capability statement is available.
 */
export function unprovenLattice(reason: string): CapabilityLattice {
  const state = absent(reason);
  const out: Partial<Record<PlatformCapability, CapabilityState>> = {};
  for (const capability of PLATFORM_CAPABILITIES) out[capability] = state;
  return Object.freeze(out as Record<PlatformCapability, CapabilityState>);
}

/**
 * Whether one or more capabilities are all proven, and what to say when they are not.
 *
 * Returns a verdict rather than a boolean so a caller cannot reach the enabled branch
 * without having a reason available for the disabled one. `required` is a list because
 * surfaces genuinely need combinations, and the refusal names **every** missing member —
 * see the header's third property.
 */
export type CapabilityVerdict =
  | { readonly kind: 'enabled' }
  | { readonly kind: 'disabled'; readonly missing: readonly PlatformCapability[]; readonly reason: string };

export function requireCapabilities(
  available: CapabilityLattice,
  required: readonly PlatformCapability[],
): CapabilityVerdict {
  if (required.length === 0) {
    // A surface that requires nothing has no business asking. Refused rather than returning
    // `enabled`, which would be a vacuous pass produced by an empty input — the failure this
    // repository keeps finding in its own checkers.
    throw new CapabilityError('requireCapabilities was asked about no capability at all');
  }
  const missing: PlatformCapability[] = [];
  const reasons: string[] = [];
  for (const capability of required) {
    const state = available[capability];
    if (state.kind === 'absent') {
      missing.push(capability);
      reasons.push(`${capability}: ${state.reason}`);
    }
  }
  if (missing.length === 0) return { kind: 'enabled' };
  return { kind: 'disabled', missing, reason: reasons.join(' ') };
}

/**
 * The lattice meet — capability by capability, absence wins.
 *
 * Used where two independent statements about the platform must both hold: the host says
 * what it supports, and the release says what it is willing to use. Two absences keep both
 * reasons, because a user who fixes one and is then told about the other has been sent
 * round twice by a checker that knew the answer the first time.
 */
export function meet(left: CapabilityLattice, right: CapabilityLattice): CapabilityLattice {
  const out: Partial<Record<PlatformCapability, CapabilityState>> = {};
  for (const capability of PLATFORM_CAPABILITIES) {
    // Both sides go through the same refusal `lattice` uses, so an unrecognised state cannot
    // enter through a combination either. `meet` is where two independently-sourced records
    // arrive, which makes it the *more* likely entry point, not the less.
    const a = normalise(capability, left[capability]);
    const b = normalise(capability, right[capability]);
    if (a.kind === 'proven' && b.kind === 'proven') {
      out[capability] = PROVEN;
      continue;
    }
    if (a.kind === 'absent' && b.kind === 'absent') {
      out[capability] = a.reason === b.reason ? a : absent(`${a.reason} ${b.reason}`);
      continue;
    }
    out[capability] = a.kind === 'absent' ? a : b;
  }
  return Object.freeze(out as Record<PlatformCapability, CapabilityState>);
}

/**
 * Project the three 10 §13.4 transport capabilities.
 *
 * `packages/llm-handoff`'s `chooseTransport` takes exactly `{ file, clipboard, share }`, and
 * this is how a platform adapter feeds it. It is a projection rather than an import in
 * either direction: `platform` is in `src/features/tx`'s reference set (10 §10.2) and
 * `llm-handoff` is deliberately not, so a production edge between them would put a handoff
 * package one hop from the transaction unit. What binds the two shapes instead is a
 * compile-time assertion in `tests/platform`, which fails if either side renames a member.
 */
export function transportCapabilities(available: CapabilityLattice): {
  readonly file: boolean;
  readonly clipboard: boolean;
  readonly share: boolean;
} {
  return {
    file: available.file.kind === 'proven',
    clipboard: available.clipboard.kind === 'proven',
    share: available.share.kind === 'proven',
  };
}
