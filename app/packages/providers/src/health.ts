/**
 * Provider health, sampling and the honest guarantee — 10 §8.1–§8.4. F9.
 *
 * ## Nothing here can make a value verified, and that is structural elsewhere
 *
 * `Finalized<T>` is constructible only inside `packages/chain-client` (10 §2.1), so this
 * package *cannot* produce one whatever it does — 10 §2.2's never-promote rule is enforced
 * by a symbol this module cannot name, not by a check it performs. What is left to F9 is
 * the part that can still go wrong: **what the client says about a provider**.
 *
 * ## The empty default is a value, not an absence
 *
 * > the app ships an EMPTY provider list. Providers are strictly opt-in in every mode.
 *
 * `defaultProviders()` returns an empty list from a function that takes **no argument it
 * could inherit from**, the same device `defaultScope()` uses for export consent. A
 * configurable default is exactly how "opt-in" quietly becomes "on for most people".
 *
 * ## Auto-disable carries a reason, always
 *
 * §8.3's ladder is `Healthy → Slow → Failing → Disabled(auto, reason)`. The reason is a
 * **required field** of the disabled state, so a provider cannot be switched off silently —
 * a user who sees a source vanish with no explanation reasonably concludes the app is
 * broken, and re-enables it.
 *
 * ## The guarantee statement is fixed copy and deliberately unflattering
 *
 * §8.4 makes it normative UI copy: sampling catches malformed, internally inconsistent and
 * shallow forgeries, and liveness failures — and **does not** detect a self-consistent
 * forgery of history at depth. That sentence is the honest limit of the mechanism, and a
 * client that omitted the second half would be claiming a guarantee the design explicitly
 * declines to make.
 *
 * ## All providers down is a **state**, not the absence of one
 *
 * §8.3 closes with *"All-providers-down ⇒ the default (provider-less) behavior with the
 * standard incomplete-history explainer."* That is a sentence about the **fleet**, and a
 * client with only per-provider health cannot say it: each provider is individually disabled
 * with its own reason, no code holds the aggregate, and the user is shown four separate
 * failures instead of one explanation of what the app is now doing. {@link fleetState} is
 * that aggregate, and it deliberately distinguishes *never enabled any* from *all of the
 * enabled ones are off* — the first is §8.1's tested default posture and needs no incident
 * language at all, while the second is a change the user should be told about.
 */

import {
  INCOMPLETE_HISTORY_EXPLAINER,
  samplingMismatchReason,
  type MismatchSubject,
  type ProviderRefusalCode,
} from './refusals.js';

/**
 * §8.3's ladder. `disabled` carries why — it is not a bare state.
 *
 * `unprobed` is the state before the ladder starts, and it is not decoration. §8.3 requires a
 * probe *"on enable"*, and until 2026-08-06 {@link acceptSuggestion} returned a provider already
 * marked `healthy`: nothing had been asked, nothing had answered, and every read taken before the
 * scheduler's first tick came from a source this client had described to itself as healthy on no
 * evidence. `probeDue(null, …)` answering `true` does not fix that — it tells a caller a probe is
 * *due*, and a caller that serves a read first is not contradicted by anything.
 *
 * So the enable state is one that **cannot serve** ({@link canServeReads}), which is INV-FE-12's
 * fail-closed lattice in its own words: an unproven capability is absent, and absence disables
 * the dependent surface. It is deliberately not `slow` or `failing` either — inventing a
 * pessimistic observation is as wrong as inventing an optimistic one, and both are observations
 * nobody made.
 */
export type ProviderHealth =
  | { readonly kind: 'unprobed' }
  | { readonly kind: 'healthy' }
  | { readonly kind: 'slow'; readonly observedMs: number }
  | { readonly kind: 'failing'; readonly consecutiveFailures: number }
  | {
      readonly kind: 'disabled';
      /** `auto` when the client disabled it; `user` when the user did. */
      readonly by: 'auto' | 'user';
      /** Required. A source that vanishes unexplained reads as a broken app. */
      readonly reason: string;
    };

export interface Provider {
  readonly id: string;
  readonly kind: 'snapshot' | 'indexer';
  readonly health: ProviderHealth;
}

/**
 * May this source be read from at all?
 *
 * The one predicate a read path calls, and the reason `unprobed` is a state rather than a flag:
 * *"has it been probed"* and *"is it switched off"* are two questions with one answer here, and
 * a call site that had to remember both would eventually remember one.
 *
 * ## `failing` serves, and until 2026-08-06 this said otherwise
 *
 * §8.3 states the ladder's normative *shape* in one sentence, and the last clause is unqualified:
 * *"`Slow` is a latency observation and never disables on its own … `Failing` counts
 * **consecutive** failures, so one timeout in a healthy series cannot ratchet the ladder; and only
 * `Disabled` stops reads, always with a reason."* This function excluded `failing`, which is a
 * narrowing §8.3 does not authorise — and it is the same ratchet the *consecutive* rule exists to
 * prevent, moved one clause along: one timeout in a healthy series would have taken the source
 * off every read path while the ladder itself still called it live. The defect was invisible
 * while nothing consulted the predicate; wiring it in is what made its exact shape load-bearing.
 *
 * ## `unprobed` does not serve, and that is not the same narrowing
 *
 * *"Only `Disabled` stops reads"* is a sentence about the **ladder** — `Healthy → Slow → Failing →
 * Disabled` — and `unprobed` is not on it: it is the state before the ladder starts, which §8.3's
 * *"health probe on enable"* half creates and its degradation half never mentions. Refusing it is
 * INV-FE-12's fail-closed lattice (an unproven capability is absent), not a fifth ladder state
 * that serves. Which of §8.3's two sentences governs the gap between enabling a source and its
 * first answer is genuinely open, and PLAN.md · *Spec questions* SQ-771 asks 10 §8.3 to say.
 *
 * The `switch` is exhaustive on purpose: a state added to the ladder later fails to compile here
 * rather than falling through to *serves*, which is the direction that cannot be walked back.
 */
export function canServeReads(provider: Provider): boolean {
  switch (provider.health.kind) {
    case 'healthy':
    case 'slow':
    case 'failing':
      return true;
    case 'unprobed':
    case 'disabled':
      return false;
    default: {
      const unhandled: never = provider.health;
      return unhandled;
    }
  }
}

/**
 * May a **pinned file this source published** still be imported?
 *
 * A second predicate rather than a second call to {@link canServeReads}, because the two answer
 * different questions and differ on exactly one state. A snapshot arrives **out of band**: the
 * user already holds the bytes, and what admits them is the content pin plus §8.4's screens plus
 * the chain re-derivation — none of which asks the endpoint anything. So *"has this source
 * answered a probe"* has no bearing on a file that is already here, and gating on it would refuse
 * every import from a freshly accepted suggestion, permanently, since nothing in this release
 * drives probes (see PLAN.md's F24 — §8.3's probe driver has no owner until the provider wire is
 * specified).
 *
 * `disabled` is different and is refused. `FE-PROV-002`'s fixed recovery tells the user the source
 * *"has been switched off"* and that re-enabling is theirs to do; minting fresh rows badged with
 * that source's id in the meantime contradicts the sentence they were just shown, and unlike the
 * probe it is satisfiable — §8.4 already makes re-enabling an explicit user action.
 *
 * Whether §8.3's ladder gates an out-of-band pinned file **at all** is what 10 §8 does not say:
 * PLAN.md · *Spec questions* SQ-773, alongside SQ-630.
 */
export function canSupplyPinnedImport(provider: Provider): boolean {
  return provider.health.kind !== 'disabled';
}

/**
 * The shipped provider list.
 *
 * Takes **no argument**, so there is nothing for a build, a release channel or a previous
 * session to inherit a default from. 10 §8.1: strictly opt-in in every mode.
 */
export function defaultProviders(): readonly Provider[] {
  return [];
}

// ------------------------------------------------------------------ release constants

/**
 * §8.3's ladder thresholds and its probe interval.
 *
 * **Release constants, not chain constants** (10 §8.3): a governance vote does not change how
 * fast a third-party HTTP endpoint answers, and there is no chain surface to read them from,
 * so 10 §5.4's no-literal rule does not reach them. They are named — rather than written at the
 * site that uses them — so a caller can pass a different set instead of a call site inventing
 * one.
 *
 * They live in this module rather than beside the sampling loop because the ladder and the
 * round report are both consumed here; the alternative was an import cycle.
 *
 * ## What is deliberately **not** in this set
 *
 * There is no sufficiency threshold — no number saying how much of a round must have been
 * comparable before the client calls it evidence. One shipped here as `meaningfulAtLeast: 0.5`
 * and was removed on 2026-08-06: §8.3's release-constant licence covers *"how fast a
 * third-party HTTP endpoint answers"*, which is a fact about networks, and a line between
 * weak and strong evidence is not that. Nothing anchors 0.5 — not a kernel constant, not a
 * 13 §1 key, not published calibration — so it was a value picked rather than derived, which
 * R-2 forbids. {@link effectiveCoverage} now reports the raw ratio and makes no claim about
 * it; a screen that wants to describe a round needs a number the specification names, and
 * PLAN.md · *Spec questions* SQ-633 asks 10 §8.4 for one.
 */
export interface LadderThresholds {
  /** Above this, a *response* is `slow`. Slow never disables on its own (§8.3). */
  readonly slowAboveMs: number;
  /** Consecutive failures at which the provider auto-disables (`FE-PROV-001`). */
  readonly disableAfter: number;
  /** §8.3: "on enable + every 10 min". */
  readonly probeEveryMs: number;
}

export const LADDER: LadderThresholds = Object.freeze({
  slowAboveMs: 2_000,
  disableAfter: 3,
  probeEveryMs: 10 * 60 * 1_000,
});

/** §8.4's normative UI copy, in one place, including the half that is unflattering. */
export const SAMPLING_GUARANTEE =
  'Spot-checking catches malformed data, internally inconsistent data, shallow forgeries ' +
  'and a source that has stopped responding. It does not detect a self-consistent forgery ' +
  'of history at a depth this device cannot reach on its own. The only cross-check for deep ' +
  'history is comparing two independent sources, which this client supports and labels.';

/** What a sampling round found. */
export interface SampleResult {
  readonly rowsChecked: number;
  readonly mismatches: number;
  /** Rows whose referenced object no longer exists, so nothing could be compared. */
  readonly unverifiable: number;
}

/**
 * Whether a sampling round should auto-disable the provider.
 *
 * **Any** mismatch disables: §8.3 says "auto-disable on sampling mismatch", with no
 * threshold, and a threshold is what turns one caught lie into an acceptable error rate.
 *
 * `unverifiable` rows do **not** count toward or against it. A row whose object is gone
 * proves nothing either way, and treating it as a pass would let a provider evade sampling
 * by serving only unverifiable rows — which is the cheapest available evasion.
 */
export function shouldAutoDisable(result: SampleResult): boolean {
  return result.mismatches > 0;
}

/**
 * The sampling coverage actually achieved, as a fraction of rows that *could* be checked.
 *
 * Reported separately from the pass/fail so a round that verified almost nothing is
 * visible as such. A round of 100 rows where 98 were unverifiable is not a 100-row check,
 * and calling it one is the "passes by shrinking" shape this repository keeps refusing.
 *
 * It returns three numbers and **no verdict**. The verdict it used to carry — `meaningful`,
 * true at or above a 50 % floor — is gone for the reason {@link LadderThresholds} states: the
 * floor was invented here, and a client that calls a round *evidence* on a number nobody
 * specified is making a claim §8.4 never authorised. A caller that must describe a round says
 * *"n of m rows were comparable"*, which is a fact, until 10 §8.4 names a line (SQ-633).
 */
export function effectiveCoverage(result: SampleResult): {
  readonly checked: number;
  readonly ofTotal: number;
  /** Comparable rows as a share of sampled rows. `0` when nothing was sampled. */
  readonly ratio: number;
} {
  const checked = result.rowsChecked - result.unverifiable;
  return {
    checked,
    ofTotal: result.rowsChecked,
    ratio: result.rowsChecked > 0 ? checked / result.rowsChecked : 0,
  };
}

/**
 * Advance the ladder from a sampling round.
 *
 * The **one** place a §8.4 comparison against chain state disables a provider. Both callers
 * route through it rather than constructing the disabled state themselves: the sampling loop
 * (`runSamplingRound`, rows re-read from storage) and the snapshot import (`importSnapshotStream`,
 * blocks re-derived by {@link chainSpotCheck}). They once built the same sentence independently,
 * and a second builder is how one of them silently becomes the older wording (see `refusals.ts`).
 *
 * `subject` selects which fixed noun phrase the recorded reason uses — sampled rows or
 * re-derived blocks. It is a typed discriminant rather than a string the caller composes,
 * because §10.4 forbids free text and a template with a hole in it is free text.
 */
export function afterSampling(
  provider: Provider,
  result: SampleResult,
  subject: MismatchSubject = 'sampled-rows',
): Provider {
  if (shouldAutoDisable(result)) {
    return {
      ...provider,
      health: {
        kind: 'disabled',
        by: 'auto',
        reason: samplingMismatchReason(result.mismatches, result.rowsChecked, subject),
      },
    };
  }
  return provider;
}

// ------------------------------------------------------------------ the fleet (§8.3's close)

/**
 * What the whole optional layer is doing, as one value.
 *
 * `none-enabled` is not a degraded state. It is 10 §8.1's shipped posture — *"With zero
 * providers enabled the app is exactly the layer-1+2+3 system, and every INV-FE-4 workflow
 * works — this is the tested default configuration, not an edge case"* — so it carries the
 * explainer without any language suggesting something went wrong.
 */
export type FleetState =
  | { readonly kind: 'none-enabled'; readonly explainer: string }
  | {
      readonly kind: 'serving';
      readonly enabled: number;
      /** Sources that have answered a probe and are not switched off. */
      readonly serving: number;
      /** Sources enabled but not yet probed — serving nothing, and not an incident (§8.3). */
      readonly unprobed: number;
    }
  | {
      readonly kind: 'all-down';
      readonly enabled: number;
      /** Every disabled provider's required reason, so the aggregate names its parts. */
      readonly reasons: readonly string[];
      readonly explainer: string;
      /** `FE-PROV-001` is the code §8.4 binds to a provider that stopped serving. */
      readonly code: ProviderRefusalCode;
    };

/**
 * True when the client is serving no provider reads at all.
 *
 * Deliberately **not** `providers.every(disabled)`: that answers `true` for an empty list,
 * which is §8.1's default rather than an outage, and a UI driven by it would open on an
 * incident banner every first run.
 */
export function allProvidersDown(providers: readonly Provider[]): boolean {
  return providers.length > 0 && providers.every((p) => p.health.kind === 'disabled');
}

export function fleetState(providers: readonly Provider[]): FleetState {
  if (providers.length === 0) {
    return { kind: 'none-enabled', explainer: INCOMPLETE_HISTORY_EXPLAINER };
  }
  // Through {@link allProvidersDown}, not beside it. Both held the same predicate and the
  // exported one had no caller, so §8.3's closing sentence had two implementations and only one
  // of them was ever executed — the shape where an edit to the tested copy changes nothing.
  if (!allProvidersDown(providers)) {
    return {
      kind: 'serving',
      enabled: providers.length,
      // Counted from `canServeReads`, not as "everything that is not disabled": a source waiting
      // for its first probe is serving nothing, and reporting it as serving is the same claim
      // `acceptSuggestion` used to make one layer down.
      serving: providers.filter((p) => canServeReads(p)).length,
      unprobed: providers.filter((p) => p.health.kind === 'unprobed').length,
    };
  }
  return {
    kind: 'all-down',
    enabled: providers.length,
    reasons: providers.map((p) => (p.health.kind === 'disabled' ? p.health.reason : '')),
    explainer: INCOMPLETE_HISTORY_EXPLAINER,
    code: 'FE-PROV-001',
  };
}
