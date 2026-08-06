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
  type ProviderRefusalCode,
} from './refusals.js';

/** §8.3's ladder. `disabled` carries why — it is not a bare state. */
export type ProviderHealth =
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
 * §8.3's ladder thresholds, its probe interval, and the coverage floor §8.4 reports against.
 *
 * **Release constants, not chain constants** (10 §8.3): a governance vote does not change how
 * fast a third-party HTTP endpoint answers, and there is no chain surface to read them from,
 * so 10 §5.4's no-literal rule does not reach them. They are named — rather than typed at the
 * site that uses them — so a caller can pass a different set instead of a call site inventing
 * one, which is the property `meaningfulAtLeast` was violating while this interface argued for
 * it: the 50 % floor was written as `checked * 2 >= rowsChecked` inside `effectiveCoverage`,
 * where no caller could see it, name it or replace it.
 *
 * They live in this module rather than beside the sampling loop because `effectiveCoverage`
 * needs one of them and is here; the alternative was an import cycle.
 */
export interface LadderThresholds {
  /** Above this, a *response* is `slow`. Slow never disables on its own (§8.3). */
  readonly slowAboveMs: number;
  /** Consecutive failures at which the provider auto-disables (`FE-PROV-001`). */
  readonly disableAfter: number;
  /** §8.3: "on enable + every 10 min". */
  readonly probeEveryMs: number;
  /**
   * The share of sampled rows that must have been **comparable** before a round is reported
   * as meaningful evidence.
   *
   * A release constant with no chain anchor and no calibration behind it, stated plainly
   * rather than derived: what it encodes is *"at least as many rows were compared as were
   * not"*, and no measurement decides where that line belongs. It is deliberately **not** a
   * pass/fail threshold — {@link shouldAutoDisable} ignores it entirely, and a round below it
   * is still clean if everything comparable matched. It only governs whether the client
   * describes the round as evidence, and {@link effectiveCoverage} reports the raw ratio
   * beside the verdict so a caller never has to take the boolean's word for it.
   */
  readonly meaningfulAtLeast: number;
}

export const LADDER: LadderThresholds = Object.freeze({
  slowAboveMs: 2_000,
  disableAfter: 3,
  probeEveryMs: 10 * 60 * 1_000,
  meaningfulAtLeast: 0.5,
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
 */
export function effectiveCoverage(
  result: SampleResult,
  thresholds: LadderThresholds = LADDER,
): {
  readonly checked: number;
  readonly ofTotal: number;
  /** Comparable rows as a share of sampled rows. Reported so the boolean is never the only fact. */
  readonly ratio: number;
  readonly meaningful: boolean;
} {
  const checked = result.rowsChecked - result.unverifiable;
  const ratio = result.rowsChecked > 0 ? checked / result.rowsChecked : 0;
  return {
    checked,
    ofTotal: result.rowsChecked,
    ratio,
    // Below the named floor the round is weak evidence. Stated rather than hidden, so a green
    // sample cannot stand in for a check that did not happen — and named rather than inlined,
    // so a caller with a different view of "weak" can pass one.
    meaningful: result.rowsChecked > 0 && ratio >= thresholds.meaningfulAtLeast,
  };
}

/**
 * Advance the ladder from a sampling round.
 *
 * The **one** place a sampling round disables a provider. `runSamplingRound` routes through
 * it rather than constructing the disabled state itself: the two built the same sentence
 * independently until 2026-08-06, and a second builder is how one of them silently becomes
 * the older wording (see `refusals.ts`'s module note).
 */
export function afterSampling(provider: Provider, result: SampleResult): Provider {
  if (shouldAutoDisable(result)) {
    return {
      ...provider,
      health: {
        kind: 'disabled',
        by: 'auto',
        reason: samplingMismatchReason(result.mismatches, result.rowsChecked),
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
  | { readonly kind: 'serving'; readonly enabled: number; readonly serving: number }
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
  const down = providers.filter((p) => p.health.kind === 'disabled');
  if (down.length < providers.length) {
    return { kind: 'serving', enabled: providers.length, serving: providers.length - down.length };
  }
  return {
    kind: 'all-down',
    enabled: providers.length,
    reasons: down.map((p) => (p.health.kind === 'disabled' ? p.health.reason : '')),
    explainer: INCOMPLETE_HISTORY_EXPLAINER,
    code: 'FE-PROV-001',
  };
}
